import { expect, test } from 'bun:test'

import { DIALOG_REOPEN_MS, EARLY_CLOSE_MAX, GATE_MAX, initial, isSkipped, step } from './check'
import type { Action, Event, State } from './check'

function run(events: Event[], from: State = initial) {
  let state = from
  let actions: Action[] = []
  for (const e of events) {
    const r = step(state, e)
    state = r.state
    actions = r.actions
  }
  return { state, actions }
}

const gate = (s: State) => s.log.find(x => x.role === 'gate')
const pane = (actions: Action[]) => actions.filter(a => a.type === 'open' || a.type === 'close')

test('an answer for an older check changes nothing', () => {
  const r1 = run([{ type: 'submit', isCommand: false, text: 'one' }])
  const oldId = r1.state.current!.id
  const r2 = run([{ type: 'submit', isCommand: false, text: 'two' }], r1.state)
  const r3 = step(r2.state, { type: 'fullAnswer', id: oldId, verdict: { kind: 'fix', body: 'One.' } })
  expect(r3.actions).toEqual([])
  expect(r3.state).toBe(r2.state)
  expect(gate(r3.state)?.status).toBe('checking')
})

test('an early close shuts the pane, then a full fix reopens it with focus', () => {
  const r1 = run([{ type: 'retype', text: 'he go' }])
  const id = r1.state.current!.id
  expect(r1.actions.map(a => a.type)).toEqual(['writeLog', 'runFast'])

  const r2 = step(r1.state, { type: 'fastAnswer', id, p: 0.2 })
  expect(pane(r2.actions)).toEqual([{ type: 'close' }])
  expect(r2.actions.map(a => a.type)).toContain('runFull')
  expect(gate(r2.state)?.status).toBe('clean')

  const r3 = step(r2.state, { type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } })
  expect(pane(r3.actions)).toEqual([{ type: 'open', focus: true }])
  expect(gate(r3.state)).toMatchObject({ text: 'he **goes**', status: 'fix' })
})

test('the fast check gates the full check at or below GATE_MAX', () => {
  for (const type of ['submit', 'retype'] as const) {
    const r1 = run([{ type, text: 'run the tests', isCommand: false } as Event])
    const id = r1.state.current!.id
    const r2 = step(r1.state, { type: 'fastAnswer', id, p: GATE_MAX })
    expect(r2.actions.map(a => a.type)).toEqual(['writeLog', 'close'])
    expect(gate(r2.state)?.status).toBe('clean')
    // A late full answer for a gated check changes nothing.
    expect(step(r2.state, { type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'x' } }).actions).toEqual([])
  }
})

test('above EARLY_CLOSE_MAX or with no fast answer, only the full check runs', () => {
  for (const p of [EARLY_CLOSE_MAX + 0.01, undefined]) {
    const r1 = run([{ type: 'submit', isCommand: false, text: 'he go' }])
    const r2 = step(r1.state, { type: 'fastAnswer', id: r1.state.current!.id, p })
    expect(r2.actions).toEqual([{ type: 'runFull', id: r1.state.current!.id, text: 'he go' }])
  }
})

test('skip rules', () => {
  expect(isSkipped('ok')).toBe(true)
  expect(isSkipped('Thanks!')).toBe(true)
  expect(isSkipped('!ls')).toBe(true)
  expect(isSkipped('fix it', true)).toBe(true)
  expect(isSkipped('x'.repeat(4001))).toBe(true)
  expect(isSkipped('x'.repeat(4000))).toBe(false)
  expect(isSkipped('ok, run the tests')).toBe(false)
})

test('a skipped message closes the pane and makes the older check stale', () => {
  const r1 = run([{ type: 'submit', isCommand: false, text: 'he go' }])
  const id = r1.state.current!.id
  const r2 = step(r1.state, { type: 'submit', isCommand: false, text: 'ok' })
  expect(r2.actions).toEqual([{ type: 'writeLog', log: [] }, { type: 'close' }])
  expect(step(r2.state, { type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } }).actions).toEqual([])
})

test('Enter on an empty retype box is a skip', () => {
  const r1 = run([{ type: 'submit', isCommand: false, text: 'he go' }])
  expect(step(r1.state, { type: 'retype', text: '  ' }).actions).toEqual([{ type: 'writeLog', log: [] }, { type: 'close' }])
})

test('a fix during a dialog opens with focus after the dialog ends', () => {
  const r1 = run([{ type: 'submit', isCommand: false, text: 'he go' }, { type: 'dialogStart' }])
  expect(r1.actions).toEqual([{ type: 'close' }])
  const id = r1.state.current!.id
  const r2 = step(r1.state, { type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } })
  expect(pane(r2.actions)).toEqual([])
  const r3 = step(r2.state, { type: 'dialogEnd' })
  expect(r3.actions).toEqual([{ type: 'open', focus: true, delayMs: DIALOG_REOPEN_MS }])
})

test('a failure during a dialog opens without focus', () => {
  const r1 = run([{ type: 'submit', isCommand: false, text: 'x' }, { type: 'dialogStart' }])
  const id = r1.state.current!.id
  const r2 = step(r1.state, { type: 'fullAnswer', id, verdict: { kind: 'failed', text: 'Check failed (exit 1).' } })
  const r3 = step(r2.state, { type: 'dialogEnd' })
  expect(r3.actions).toEqual([{ type: 'open', focus: false, delayMs: DIALOG_REOPEN_MS }])
})

test('a fix shown before a dialog is not restored after it', () => {
  const r1 = run([{ type: 'submit', isCommand: false, text: 'he go' }])
  const id = r1.state.current!.id
  const r2 = run(
    [{ type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } }, { type: 'dialogStart' }, { type: 'dialogEnd' }],
    r1.state,
  )
  expect(r2.actions).toEqual([])
})

test('/grammar focuses the pane only when a correction is showing', () => {
  expect(run([{ type: 'manualOpen' }]).actions).toEqual([{ type: 'open', focus: false }])
  const r1 = run([{ type: 'submit', isCommand: false, text: 'he go' }])
  const id = r1.state.current!.id
  const r2 = run([{ type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } }, { type: 'manualOpen' }], r1.state)
  expect(r2.actions).toEqual([{ type: 'open', focus: true }])
})
