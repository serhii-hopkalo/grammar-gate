import type { Verdict } from './check'

// The Full check's output contract, as checker-prompt.txt asks for it: CLEAN
// or FIX on the first line, and after FIX the whole message again with the
// changed words in **bold**, then optionally a blank line and "- " reasons.

const norm = (s: string) =>
  s.replace(/\*\*/g, '').toLowerCase().trim().replace(/[\s.?!…]+$/, '').replace(/\s+/g, ' ')

// The corrected message, without the trailing reason bullets.
const messagePart = (body: string) => {
  const cut = body.lastIndexOf('\n\n')
  if (cut <= 0) return body
  const tail = body.slice(cut + 2).trim().split('\n')
  return tail.every(l => l.trimStart().startsWith('- ')) ? body.slice(0, cut) : body
}

export function readVerdict(exitCode: number, stdout: string, original: string): Verdict {
  if (exitCode !== 0) return { kind: 'failed', text: `Check failed (exit ${exitCode}).` }
  const out = stdout.trim()
  const nl = out.indexOf('\n')
  const first = (nl < 0 ? out : out.slice(0, nl)).trim()
  const body = nl < 0 ? '' : out.slice(nl + 1).trim()
  if (first === 'CLEAN') return { kind: 'clean' }
  if (first !== 'FIX' || !body) return { kind: 'failed', text: 'Check failed (unexpected answer).' }
  const head = messagePart(body)
  // The model named a change but repeated the message as typed. Showing nothing
  // would hide a real error, so it is reported as a failed check.
  if (head.replace(/\*\*/g, '').trim() === original.trim())
    return { kind: 'failed', text: 'Check failed (correction not applied).' }
  // A message that only re-cases words or changes ending punctuation.
  if (norm(head) === norm(original)) return { kind: 'clean' }
  return { kind: 'fix', body }
}
