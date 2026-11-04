import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'

const PANE = 'grammar'
const MODEL = 'claude-sonnet-5'
const log = atom({ plugin: 'grammar-pane', key: 'log' } as const, [], { shape: 'log-1' })

const SKIP = /^(skip|yes|yeah|yep|no|nope|ok|okay|k|go|continue|next|stop|sure|thanks|thx|ty|y|n)[.!]?$/i

let seq = 0
let rules: string | undefined
// While a question dialog is up the pane stays closed, and a verdict that
// arrives then waits for the dialog to end.
let isAsking = false
let isOpenPending = false

function showPane($: EngineInterface, focus: boolean) {
  if (isAsking) {
    isOpenPending = true
    return
  }
  void $.ui.open({ id: PANE, title: 'Grammar', ...(focus ? { focus: true as const } : {}) })
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

const norm = (s: string) =>
  s.replace(/\*\*/g, '').toLowerCase().trim().replace(/[\s.?!…]+$/, '').replace(/\s+/g, ' ')

// Drops a correction that only re-cases words or changes ending punctuation.
const isTrivial = (body: string, original: string) => {
  const cut = body.lastIndexOf('\n\n')
  let head = body
  if (cut > 0) {
    const tail = body.slice(cut + 2).trim().split('\n')
    if (tail.every(l => l.trimStart().startsWith('- '))) head = body.slice(0, cut)
  }
  return norm(head) === norm(original)
}

// Runs the check and shows its verdict. The prompt itself is never held.
// The pane opens only for a correction or a failure and closes on a clean
// verdict, which also hands the keyboard back to the prompt.
async function check($: EngineInterface, text: string) {
  const you: Entry = { id: ++seq, role: 'you', text }
  const gate: Entry = { id: ++seq, role: 'gate', text: 'Checking…', status: 'checking' }
  // Each check replaces the pane: only the latest message and its verdict show.
  await update($, log, () => [you, gate])

  const set = (patch: Partial<Entry>) =>
    update($, log, l => l.map(x => (x.id === gate.id ? { ...x, ...patch } : x)))
  const fail = async (text: string) => {
    await set({ text, status: 'error' })
    showPane($, false)
  }

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
        env: { GRAMMAR_GATE_CHILD: '1', MAX_THINKING_TOKENS: '0', CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1' },
      },
    )
  } catch {
    return fail('Check failed (claude did not run).')
  }
  if (run.exitCode !== 0) return fail(`Check failed (exit ${run.exitCode}).`)

  const out = run.stdout.trim()
  const nl = out.indexOf('\n')
  const first = (nl < 0 ? out : out.slice(0, nl)).trim()
  const body = nl < 0 ? '' : out.slice(nl + 1).trim()
  if (first === 'FIX' && body && !isTrivial(body, text)) {
    await set({ text: body, status: 'fix' })
    // Granted only while the prompt is empty, so it never takes keys mid-typing.
    showPane($, true)
    return
  }
  await set({ text: 'No changes needed.', status: 'clean' })
  isOpenPending = false
  await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'grammar', description: 'Open the grammar pane' })
    return next(e)
  })

  on('command.run', { command: 'grammar' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Grammar' })
    return { text: 'Grammar pane opened.' }
  })

  // A question dialog takes the keyboard from any pane, mid-typing included,
  // and nothing lets the mod refuse it. Closing the pane first leaves no
  // half-typed retype behind it.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    isAsking = true
    await $.ui.close({ id: PANE })
    try {
      return await next(e)
    } finally {
      isAsking = false
      if (isOpenPending) {
        isOpenPending = false
        // The dialog still holds the keys as the tool call returns, and the
        // pane's focus request is refused while it does. A short wait lets the
        // keys return to the prompt first.
        $.clock.after(300, () => showPane($, true))
      }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const p = e.text.trim()
    if (!e.command && p && !p.startsWith('!') && !SKIP.test(p) && p.length <= 4000) {
      void check($, p)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Input } = $.ui.resolve(e)
    const list = await read($, log)
    const room = Math.max(2, (e.viewport?.rows ?? 30) - 6)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" flexGrow={1}>
          {list.length === 0 && <Text dimColor>Send a prompt to check it.</Text>}
          {list.slice(-room).map(x =>
            x.role === 'you' ? (
              <Text bold>{'> ' + x.text}</Text>
            ) : (
              <Box marginBottom={1}>
                <Text
                  color={x.status === 'fix' ? 'yellow' : x.status === 'clean' ? 'green' : undefined}
                  dimColor={x.status === 'checking' || x.status === 'error'}
                >
                  {x.text}
                </Text>
              </Box>
            ),
          )}
        </Box>
        <Input
          key="retype"
          autoFocus
          placeholder="Retype the corrected sentence to practise"
          onSubmit={value => {
            const v = value.trim()
            if (v) void check($, v)
          }}
        />
      </Box>
    )
  })
}
