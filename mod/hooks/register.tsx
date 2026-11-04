import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'

const PANE = 'grammar'
const MODEL = 'claude-sonnet-5'
const log = atom({ plugin: 'grammar-pane', key: 'log' } as const, [], { shape: 'log-1' })

const SKIP = /^(skip|yes|yeah|yep|no|nope|ok|okay|k|go|continue|next|stop|sure|thanks|thx|ty|y|n)[.!]?$/i

let seq = 0
let rules: string | undefined

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

// Runs the check and appends its verdict. The prompt itself is never held.
async function check($: EngineInterface, text: string) {
  const you: Entry = { id: ++seq, role: 'you', text }
  const gate: Entry = { id: ++seq, role: 'gate', text: 'Checking…', status: 'checking' }
  await update($, log, l => [...l, you, gate].slice(-60))
  void $.ui.open({ id: PANE, title: 'Grammar' })

  const set = (patch: Partial<Entry>) =>
    update($, log, l => l.map(x => (x.id === gate.id ? { ...x, ...patch } : x)))

  rules ??= await $.fs.read(`${$.plugin.root}/hooks/checker-prompt.txt`)
  // `claude -p` with --system-prompt replaces the whole system prompt.
  // $.model.complete keeps the CLI identity block, and with it the checker
  // misses plain typos ("checck" comes back CLEAN).
  let run
  try {
    run = await $.process.run(
      ['claude', '-p', '--model', MODEL, '--safe-mode', '--no-session-persistence',
        '--tools', '', '--effort', 'low', '--system-prompt', rules],
      {
        stdin: text,
        timeoutMs: 30000,
        env: { GRAMMAR_GATE_CHILD: '1', MAX_THINKING_TOKENS: '0', CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1' },
      },
    )
  } catch {
    return set({ text: 'Check failed (claude did not run).', status: 'error' })
  }
  if (run.exitCode !== 0) return set({ text: `Check failed (exit ${run.exitCode}).`, status: 'error' })

  const out = run.stdout.trim()
  const nl = out.indexOf('\n')
  const first = (nl < 0 ? out : out.slice(0, nl)).trim()
  const body = nl < 0 ? '' : out.slice(nl + 1).trim()
  if (first === 'FIX' && body && !isTrivial(body, text)) {
    return set({ text: body, status: 'fix' })
  }
  return set({ text: 'No changes needed.', status: 'clean' })
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
