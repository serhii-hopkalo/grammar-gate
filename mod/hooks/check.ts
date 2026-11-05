import type { Entry } from '../types'

// The Check: decides what the pane log shows and when the pane opens or
// closes, from events alone. It runs nothing itself. register.tsx runs the
// checkers, feeds their answers back as events and applies the actions.

export type Verdict =
  | { kind: 'clean' }
  | { kind: 'fix'; body: string }
  | { kind: 'failed'; text: string }

export type Event =
  | { type: 'submit'; text: string; isCommand: boolean }
  | { type: 'retype'; text: string }
  // p is Jev's probability that the message has an error, undefined when the
  // Fast check did not answer (no key, a failed request).
  | { type: 'fastAnswer'; id: number; p: number | undefined }
  | { type: 'fullAnswer'; id: number; verdict: Verdict }
  | { type: 'dialogStart' }
  | { type: 'dialogEnd' }
  | { type: 'manualOpen' }

export type Action =
  | { type: 'runFull'; id: number; text: string }
  | { type: 'runFast'; id: number; text: string }
  | { type: 'writeLog'; log: Entry[] }
  | { type: 'open'; focus: boolean; delayMs?: number }
  | { type: 'close' }

type Current = { id: number; text: string; isFastClean: boolean; isAnswered: boolean }

export type State = {
  seq: number
  log: Entry[]
  current?: Current
  isAsking: boolean
  // An open that arrived during a dialog and waits for it to end.
  pending?: { focus: boolean }
}

export const initial: State = { seq: 0, log: [], isAsking: false }

// The dialog still holds the keys as it ends, and the host refuses the pane's
// focus request while it does. The wait lets the keys return to the prompt.
export const DIALOG_REOPEN_MS = 300

const CLEAN_TEXT = 'No changes needed.'

// At or below GATE_MAX the Full check does not run. At or below EARLY_CLOSE_MAX
// the pane closes at once, but the Full check still runs and can reopen it.
// Measured on 40 sentences: 0.1 called no error clean, 0.3 called 2 of 20 clean.
export const GATE_MAX = 0.1
export const EARLY_CLOSE_MAX = 0.3

export const MAX_LENGTH = 4000
const SKIP = /^(skip|yes|yeah|yep|no|nope|ok|okay|k|go|continue|next|stop|sure|thanks|thx|ty|y|n)[.!]?$/i

// Commands, shell escapes, short replies, long pastes and an empty retype are
// not prose to check.
export const isSkipped = (text: string, isCommand = false) =>
  isCommand || !text || text.startsWith('!') || SKIP.test(text) || text.length > MAX_LENGTH

type Result = { state: State; actions: Action[] }

const setGate = (s: State, patch: Partial<Entry>): State => ({
  ...s,
  log: s.log.map(x => (x.id === s.current?.id ? { ...x, ...patch } : x)),
})

const show = (s: State, focus: boolean): Result =>
  s.isAsking
    ? { state: { ...s, pending: { focus } }, actions: [] }
    : { state: s, actions: [{ type: 'open', focus }] }

export function step(s: State, e: Event): Result {
  switch (e.type) {
    case 'submit':
    case 'retype': {
      const text = e.text.trim()
      if (isSkipped(text, e.type === 'submit' && e.isCommand)) {
        // A skipped message still ends the previous Check and its correction.
        if (!s.current && s.log.length === 0) return { state: s, actions: [] }
        return {
          state: { ...s, log: [], current: undefined, pending: undefined },
          actions: [{ type: 'writeLog', log: [] }, { type: 'close' }],
        }
      }
      const you: Entry = { id: s.seq + 1, role: 'you', text }
      const gate: Entry = { id: s.seq + 2, role: 'gate', text: 'Checking…', status: 'checking' }
      const log = [you, gate]
      return {
        state: {
          ...s,
          seq: gate.id,
          log,
          current: { id: gate.id, text, isFastClean: false, isAnswered: false },
        },
        // The Fast check answers in about 0.2s, and decides whether the Full check runs.
        actions: [{ type: 'writeLog', log }, { type: 'runFast', id: gate.id, text }],
      }
    }

    case 'fastAnswer': {
      const c = s.current
      if (!c || c.id !== e.id || c.isAnswered) return { state: s, actions: [] }
      const runFull: Action = { type: 'runFull', id: c.id, text: c.text }
      if (e.p === undefined || e.p > EARLY_CLOSE_MAX) return { state: s, actions: [runFull] }
      const isGated = e.p <= GATE_MAX
      const next = setGate(
        { ...s, current: { ...c, isFastClean: true, isAnswered: isGated }, pending: undefined },
        { text: CLEAN_TEXT, status: 'clean' },
      )
      const actions: Action[] = [{ type: 'writeLog', log: next.log }, { type: 'close' }]
      if (!isGated) actions.push(runFull)
      return { state: next, actions }
    }

    case 'fullAnswer': {
      const c = s.current
      if (!c || c.id !== e.id || c.isAnswered) return { state: s, actions: [] }
      const answered = { ...s, current: { ...c, isAnswered: true } }
      const v = e.verdict
      if (v.kind === 'failed') {
        // The fast check already showed a clean verdict, and a failure adds nothing.
        if (c.isFastClean) return { state: answered, actions: [] }
        const next = setGate(answered, { text: v.text, status: 'error' })
        const r = show(next, false)
        return { state: r.state, actions: [{ type: 'writeLog', log: next.log }, ...r.actions] }
      }
      if (v.kind === 'fix') {
        const next = setGate(answered, { text: v.body, status: 'fix' })
        const r = show(next, true)
        return { state: r.state, actions: [{ type: 'writeLog', log: next.log }, ...r.actions] }
      }
      const next = setGate({ ...answered, pending: undefined }, { text: CLEAN_TEXT, status: 'clean' })
      return { state: next, actions: [{ type: 'writeLog', log: next.log }, { type: 'close' }] }
    }

    // A dialog takes the keyboard from any pane, mid-typing included. Closing
    // the pane first leaves no half-typed retype behind it.
    case 'dialogStart':
      return { state: { ...s, isAsking: true }, actions: [{ type: 'close' }] }

    case 'dialogEnd': {
      const next = { ...s, isAsking: false, pending: undefined }
      if (!s.pending) return { state: next, actions: [] }
      return { state: next, actions: [{ type: 'open', focus: s.pending.focus, delayMs: DIALOG_REOPEN_MS }] }
    }

    // Focus only helps when there is a correction to retype. Otherwise the
    // next prompt would land in the retype box.
    case 'manualOpen':
      return show(s, s.log.some(x => x.status === 'fix'))
  }
}
