import { expect, test } from 'bun:test'

import { DIALOG_REOPEN_MS, initial, step } from './check'
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
  const r1 = run([{ type: 'submit', text: 'one' }])
  const oldId = r1.state.current!.id
  const r2 = run([{ type: 'submit', text: 'two' }], r1.state)
  const r3 = step(r2.state, { type: 'fullAnswer', id: oldId, verdict: { kind: 'fix', body: 'One.' } })
  expect(r3.actions).toEqual([])
  expect(r3.state).toBe(r2.state)
  expect(gate(r3.state)?.status).toBe('checking')
})

test('a fast clean closes the pane, then a full fix reopens it with focus', () => {
  const r1 = run([{ type: 'retype', text: 'he go' }])
  const id = r1.state.current!.id
  expect(r1.actions.map(a => a.type)).toContain('runFast')

  const r2 = step(r1.state, { type: 'fastAnswer', id, isClean: true })
  expect(pane(r2.actions)).toEqual([{ type: 'close' }])
  expect(gate(r2.state)?.status).toBe('clean')

  const r3 = step(r2.state, { type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } })
  expect(pane(r3.actions)).toEqual([{ type: 'open', focus: true }])
  expect(gate(r3.state)).toMatchObject({ text: 'he **goes**', status: 'fix' })
})

test('a submit never runs the fast check', () => {
  const r = run([{ type: 'submit', text: 'x' }])
  expect(r.actions.map(a => a.type)).not.toContain('runFast')
})

test('a fix during a dialog opens with focus after the dialog ends', () => {
  const r1 = run([{ type: 'submit', text: 'he go' }, { type: 'dialogStart' }])
  expect(r1.actions).toEqual([{ type: 'close' }])
  const id = r1.state.current!.id
  const r2 = step(r1.state, { type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } })
  expect(pane(r2.actions)).toEqual([])
  const r3 = step(r2.state, { type: 'dialogEnd' })
  expect(r3.actions).toEqual([{ type: 'open', focus: true, delayMs: DIALOG_REOPEN_MS }])
})

test('a failure during a dialog opens without focus', () => {
  const r1 = run([{ type: 'submit', text: 'x' }, { type: 'dialogStart' }])
  const id = r1.state.current!.id
  const r2 = step(r1.state, { type: 'fullAnswer', id, verdict: { kind: 'failed', text: 'Check failed (exit 1).' } })
  const r3 = step(r2.state, { type: 'dialogEnd' })
  expect(r3.actions).toEqual([{ type: 'open', focus: false, delayMs: DIALOG_REOPEN_MS }])
})

test('a fix shown before a dialog is not restored after it', () => {
  const r1 = run([{ type: 'submit', text: 'he go' }])
  const id = r1.state.current!.id
  const r2 = run(
    [{ type: 'fullAnswer', id, verdict: { kind: 'fix', body: 'he **goes**' } }, { type: 'dialogStart' }, { type: 'dialogEnd' }],
    r1.state,
  )
  expect(r2.actions).toEqual([])
})
