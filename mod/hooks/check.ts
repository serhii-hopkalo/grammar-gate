import type { Entry } from '../types'

// The Check: decides what the pane log shows and when the pane opens or
// closes, from events alone. It runs nothing itself. register.tsx runs the
// checkers, feeds their answers back as events and applies the actions.

export type Verdict =
  | { kind: 'clean' }
  | { kind: 'fix'; body: string }
  | { kind: 'failed'; text: string }

export type Event =
  | { type: 'submit'; text: string }
  | { type: 'retype'; text: string }
  | { type: 'fastAnswer'; id: number; isClean: boolean }
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

type Current = { id: number; isFastClean: boolean; isAnswered: boolean }

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
      const you: Entry = { id: s.seq + 1, role: 'you', text: e.text }
      const gate: Entry = { id: s.seq + 2, role: 'gate', text: 'Checking…', status: 'checking' }
      const log = [you, gate]
      const actions: Action[] = [{ type: 'writeLog', log }, { type: 'runFull', id: gate.id, text: e.text }]
      // Only a retype gets the fast check: it answers well before claude -p.
      if (e.type === 'retype') actions.push({ type: 'runFast', id: gate.id, text: e.text })
      return {
        state: { ...s, seq: gate.id, log, current: { id: gate.id, isFastClean: false, isAnswered: false } },
        actions,
      }
    }

    case 'fastAnswer': {
      const c = s.current
      if (!c || c.id !== e.id || c.isAnswered || !e.isClean) return { state: s, actions: [] }
      const next = setGate({ ...s, current: { ...c, isFastClean: true }, pending: undefined }, {
        text: CLEAN_TEXT,
        status: 'clean',
      })
      return { state: next, actions: [{ type: 'writeLog', log: next.log }, { type: 'close' }] }
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

    case 'manualOpen':
      return show(s, false)
  }
}
