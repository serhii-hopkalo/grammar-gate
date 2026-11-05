import { expect, test } from 'bun:test'

import { readVerdict } from './verdict'

// Outputs captured from claude -p with checker-prompt.txt on claude-sonnet-5.

test('a fix with reason bullets', () => {
  const body =
    'why the tests **are** failing after i **changed** the config\n\n' +
    '- agreement: "tests" is plural, so "are", not "is"\n' +
    '- tense: the change already happened, so "changed"'
  expect(readVerdict(0, `FIX\n${body}\n`, 'why the tests is failing after i change the config')).toEqual({
    kind: 'fix',
    body,
  })
})

test('a fix that only re-cases words is clean', () => {
  expect(readVerdict(0, 'FIX\nfix the login test\n', 'Fix The Login Test')).toEqual({ kind: 'clean' })
})

test('a fix that only adds an apostrophe is a fix', () => {
  expect(readVerdict(0, "FIX\n**let's** check it\n", 'lets check it')).toEqual({
    kind: 'fix',
    body: "**let's** check it",
  })
})

// The model named the error in a reason but did not apply it to the message.
test('a fix whose message part is unchanged is a failure', () => {
  const out = 'FIX\nlets check it\n\n- punctuation/contraction: "lets" should be "let\'s" (let us)\n'
  expect(readVerdict(0, out, 'lets check it')).toEqual({
    kind: 'failed',
    text: 'Check failed (correction not applied).',
  })
})

test('CLEAN, with or without extra lines', () => {
  expect(readVerdict(0, 'CLEAN\n', 'fix the login test, it will not pass on ci since friday')).toEqual({ kind: 'clean' })
  expect(readVerdict(0, 'CLEAN\nNo errors found.', 'x')).toEqual({ kind: 'clean' })
})

test('an unknown first line or an empty FIX is a failure', () => {
  const failed = { kind: 'failed', text: 'Check failed (unexpected answer).' }
  expect(readVerdict(0, 'The message looks fine.', 'x')).toEqual(failed)
  expect(readVerdict(0, 'FIX\n', 'x')).toEqual(failed)
})

test('a non-zero exit is a failure', () => {
  expect(readVerdict(1, '', 'x')).toEqual({ kind: 'failed', text: 'Check failed (exit 1).' })
})
