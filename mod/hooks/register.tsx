import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { initial, step } from './check'
import type { Action, Event, State, Verdict } from './check'
import { readVerdict } from './verdict'

const PANE = 'grammar'
const MODEL = 'claude-sonnet-5'
const log = atom({ plugin: 'grammar-gate', key: 'log' } as const, [], { shape: 'log-1' })

const SKIP = /^(skip|yes|yeah|yep|no|nope|ok|okay|k|go|continue|next|stop|sure|thanks|thx|ty|y|n)[.!]?$/i

let rules: string | undefined
let state: State = initial
// Actions apply one dispatch at a time, in order, so a close never overtakes
// the open before it.
let queue: Promise<void> = Promise.resolve()

function dispatch($: EngineInterface, e: Event) {
  const r = step(state, e)
  state = r.state
  queue = queue.then(() => apply($, r.actions)).catch(() => {})
  return queue
}

async function apply($: EngineInterface, actions: Action[]) {
  for (const a of actions) {
    switch (a.type) {
      case 'writeLog':
        await update($, log, () => a.log)
        break
      case 'runFull':
        void runFull($, a.text).then(verdict => dispatch($, { type: 'fullAnswer', id: a.id, verdict }))
        break
      case 'runFast':
        void isClearlyClean($, a.text).then(isClean => dispatch($, { type: 'fastAnswer', id: a.id, isClean }))
        break
      case 'close':
        await $.ui.close({ id: PANE })
        break
      case 'open':
        if (a.delayMs) $.clock.after(a.delayMs, () => void openPane($, a.focus))
        else await openPane($, a.focus)
        break
    }
  }
}

async function openPane($: EngineInterface, focus: boolean) {
  await $.ui.open({ id: PANE, title: 'Grammar', ...(focus ? { focus: true as const } : {}) })
  if (!focus) return
  // Reads the key now, so it is ready before the sentence is retyped.
  void jevKey($)
  // The Input's autoFocus is not honoured everywhere, so the cursor is put in
  // the retype box by hand. Denied, harmlessly, when the pane has no keyboard.
  void $.ui.focus({ requestId: PANE, key: 'retype' })
}

let ukRules: string | undefined

const ANCHOR = 'Bold the whole sentence only if the whole sentence was rewritten.'
const CYRILLIC = /[\u0400-\u04ff]/

// Nothing tells Ukrainian from Russian on a short sentence, so the selected
// macOS keyboard decides. The message keeps the veto: a Ukrainian layout left
// on while typing English changes nothing. Any failure falls back to the base
// rules, which still answer in the message's language under English labels.
async function isUkrainianLayout($: EngineInterface) {
  try {
    const r = await $.process.run(
      ['/usr/bin/defaults', 'read', 'com.apple.HIToolbox', 'AppleSelectedInputSources'],
      { timeoutMs: 2000 },
    )
    const m = /KeyboardLayout Name.*= "?([^";]*)"?;/.exec(r.stdout)
    return r.exitCode === 0 && !!m?.[1]?.startsWith('Ukrainian')
  } catch {
    return false
  }
}

// The base rules with the Ukrainian worked example spliced in after ANCHOR,
// so the label before each colon comes back in Ukrainian too.
async function rulesFor($: EngineInterface, text: string): Promise<string> {
  const base = (rules ??= await $.fs.read(`${$.plugin.root}/hooks/checker-prompt.txt`))
  if (!CYRILLIC.test(text) || !(await isUkrainianLayout($))) return base
  if (ukRules === undefined) {
    try {
      const extra = (await $.fs.read(`${$.plugin.root}/hooks/examples/uk.txt`)).trim()
      ukRules = base.includes(ANCHOR)
        ? base.replace(ANCHOR, `${ANCHOR}\n\n${extra}`)
        : `${base.trimEnd()}\n\n${extra}\n`
    } catch {
      ukRules = base
    }
  }
  return ukRules
}

// A retyped sentence also goes to Jev, which answers well before claude -p.
// Jev returns only the probability of an error, so it can close the pane on a
// clearly clean retype but never write a correction.
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_CLEAN_MAX = 0.3
const HAS_ERROR = {
  type: 'noul',
  instructions:
    'Does `message`, typed by a user to a coding assistant, contain a grammar or spelling error?',
  criteria: {
    true: 'A real error: subject-verb agreement, tense, articles, prepositions, word order, a misspelled or doubled-letter word, or unnatural phrasing a fluent speaker would not use.',
    false:
      "Correct as typed. Lowercase, a missing final period, terse fragments, informal register, technical shorthand, a lowercase word after a question mark, and full forms such as 'will not' are not errors.",
  },
}

let typesafeKey: Promise<string | undefined> | undefined

// The desktop app starts Claude Code without the login shell's environment,
// so a key exported in ~/.zshrc is read once from an interactive shell.
function jevKey($: EngineInterface) {
  return (typesafeKey ??= (async () => {
    const key = await $.env.get('TYPESAFE_API_KEY')
    if (key) return key
    try {
      const shell = (await $.env.get('SHELL')) ?? '/bin/zsh'
      const r = await $.process.run([shell, '-ic', 'printenv TYPESAFE_API_KEY'], { timeoutMs: 5000 })
      const line = r.stdout.trim().split('\n').pop()?.trim()
      return r.exitCode === 0 && line ? line : undefined
    } catch {
      return undefined
    }
  })())
}

// True only when Jev is confident the text has no error. Any failure, a
// missing key included, answers false and leaves the verdict to claude -p.
async function isClearlyClean($: EngineInterface, text: string) {
  const key = await jevKey($)
  if (!key) return false
  try {
    const r = await $.http.fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { message: text },
        questions: { has_error: HAS_ERROR },
      }),
    })
    if (!r.ok) return false
    const p = JSON.parse(r.text)?.answers?.has_error?.noul
    return typeof p === 'number' && p <= JEV_CLEAN_MAX
  } catch {
    return false
  }
}

// Runs the Full check.
async function runFull($: EngineInterface, text: string): Promise<Verdict> {
  const system = await rulesFor($, text)
  // `claude -p` with --system-prompt replaces the whole system prompt.
  // $.model.complete keeps the CLI identity block, and with it the checker
  // misses plain typos ("checck" comes back CLEAN).
  let run
  try {
    run = await $.process.run(
      ['claude', '-p', '--model', MODEL, '--safe-mode', '--no-session-persistence',
        '--tools', '', '--effort', 'low', '--system-prompt', system],
      {
        stdin: text,
        timeoutMs: 30000,
        // Without CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC the child waits ~2.5s
        // on a second API call after the answer is complete.
        env: {
          GRAMMAR_GATE_CHILD: '1',
          MAX_THINKING_TOKENS: '0',
          CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
      },
    )
  } catch {
    return { kind: 'failed', text: 'Check failed (claude did not run).' }
  }
  return readVerdict(run.exitCode, run.stdout, text)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'grammar', description: 'Open the grammar pane' })
    return next(e)
  })

  on('command.run', { command: 'grammar' }, async $ => {
    await dispatch($, { type: 'manualOpen' })
    return { text: 'Grammar pane opened.' }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await dispatch($, { type: 'dialogStart' })
    try {
      return await next(e)
    } finally {
      void dispatch($, { type: 'dialogEnd' })
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const p = e.text.trim()
    if (!e.command && p && !p.startsWith('!') && !SKIP.test(p) && p.length <= 4000) {
      void dispatch($, { type: 'submit', text: p })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Input, Button } = $.ui.resolve(e)
    const list = await read($, log)
    const room = Math.max(2, (e.viewport?.rows ?? 30) - 6)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" flexGrow={1}>
          {list.length === 0 && <Text size="title" dimColor>Send a prompt to check it.</Text>}
          {list.slice(-room).map(x =>
            x.role === 'you' ? (
              <Text size="title" bold>{'> ' + x.text}</Text>
            ) : (
              <Box marginBottom={1}>
                <Text
                  size="title"
                  color={x.status === 'fix' ? 'text' : x.status === 'clean' ? 'success' : undefined}
                  dimColor={x.status === 'checking' || x.status === 'error'}
                >
                  {x.text.split('**').map((part, i) => (i % 2 ? <Text bold color="error">{part}</Text> : part))}
                </Text>
              </Box>
            ),
          )}
        </Box>
        {/* The pane's focus request is the surface's to grant and may be
            refused, so the pane says how to reach the box. */}
        {!e.props.isFocused && list.some(x => x.status === 'fix') && (
          <Text dimColor>
            {e.surface === 'terminal' ? 'Press ctrl+x then tab to retype.' : 'Click the box below to retype.'}
          </Text>
        )}
        {/* Input has no text size or width of its own, so it is made bigger by
            rows and by a column Box as wide as the pane body, which stretches it. */}
        <Box flexDirection="column" alignItems="stretch" width={e.props.bodyColumns}>
          <Input
            key="retype"
            autoFocus
            rows={3}
            placeholder="Retype the corrected sentence to practise"
            onSubmit={value => {
              const v = value.trim()
              if (v) void dispatch($, { type: 'retype', text: v })
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Button role="dismiss" onPress={() => void $.ui.close({ id: PANE })}>Close</Button>
        </Box>
      </Box>
    )
  })
}
