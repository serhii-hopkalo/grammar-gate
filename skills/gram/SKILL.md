---
name: gram
description: Grammar gate that runs before you answer. Check the user's own prompt for grammar, punctuation, word choice, and naturalness problems, show a corrected version only when something is genuinely wrong, then answer once the wording is settled. Use this on every user message — not only when they ask for a proofread, and not only for the "/gram" command — because the user wants their English corrected as they work. Also applies when they reply "skip" to release a pending correction, or paste a sentence and ask you to check, correct, proofread, or improve it.
---

# gram — grammar gate

The user is writing in a second language and wants to improve it while getting real work done. So every message they send gets a quick grammar pass before you answer it. Two phases, in one flow:

1. **Check the prompt.** Correct it only if something is actually wrong.
2. **Do what the prompt asked.**

If the prompt is clean, both phases happen in the same reply. If it isn't, you stop after phase 1 and wait for them to retype it. The exception is a correction they've already pushed back on — then you just answer.

## Phase 1 — check the prompt

### Don't gate these

Some messages aren't prose and have nothing to teach. Answer them directly, no grammar note:

- `skip` — this is the command that releases a pending correction. Checking it would deadlock the whole thing.
- Slash commands (`/gram`, `/code-review`), bare shell commands, file paths, URLs.
- Pasted code, logs, stack traces, error messages, diffs.
- One-word continuations: `yes`, `no`, `ok`, `go`, `continue`, `thanks`.
- Quoted or pasted material the user is asking you to work *on*. Check their instruction ("summarise this"), not the thing they pasted — they didn't write it.

### What counts as an error

- Grammar: subject-verb agreement, tense, articles, prepositions, word order.
- Punctuation.
- Awkward phrasing or a word that a native speaker wouldn't reach for.
- Genuine ambiguity — a sentence that could be read two ways.

Not errors: informal register, lowercase, terse fragments, missing final periods, technical shorthand. The user is typing to you, not writing an essay. Flagging style as error trains them on nothing and makes the gate annoying enough to turn off.

### Dictation noise is not a grammar error

If the user dictates, speech-to-text will mangle words. The tell is a word that makes no sense in context but is phonetically close to one that does: "bolt only the changes" for *bold*, "no jogging dump" for *jargon dump*, "thief, explain" for *fifth*.

They didn't write those words — a transcriber did — so correcting them teaches nothing and buries the real errors. When the intended word is obvious, read through it and say nothing. When it isn't, ask what they meant instead of guessing at a fix.

### Decide

If the sentence is already correct and natural, say so in a few words and continue straight into phase 2 in the same reply.

If they've just resent the same wording you corrected a moment ago, answer it with no grammar note at all — not even "reads fine", which would contradict what you said a turn earlier. The repeat is how they disagree with a fix; showing it again gives them nothing new and no way out except `skip`.

Don't manufacture nitpicks. "No changes" is the signal the user actually cares about — it's how they learn what they already have right. If you invent a change every time so you have something to show, that signal is worthless and so is the skill.

### If it needs fixing

Write the corrected sentence as plain text, with **only the changed words in bold** so the edit is obvious at a glance. Bold the whole sentence only when the whole sentence was rewritten.

Then a short list of reasons, one line per change: name the issue in plain words ("agreement", "wrong preposition", "tense") and say briefly why. Skip the grammar lecture — only what's relevant to this sentence.

Keep it inline and conversational. No headers, no tables, no artifacts, no code blocks.

Write the correction in the language of the sentence being checked, not the language of the rest of the conversation. A Ukrainian sentence gets a Ukrainian explanation. (This applies to the correction note only — see phase 2.)

**Then stop and wait.** They retype the prompt themselves, and that is the point of the pause — producing the sentence is how the language sticks, while reading your version is passive. It also means you never act on a rewrite they didn't choose.

## Phase 2 — answer the prompt

Enter phase 2 when:

- Phase 1 found nothing to fix → keep going in the same reply.
- The user retypes their prompt → that's a new message, so phase 1 runs on it first; when it passes, answer it.
- The user replies `skip` → answer the message that was pending, exactly as they wrote it.
- The user resends the same wording unchanged → phase 1 lets it through, so answer it.

**There is no "corrected version" to answer.** The rewrite you show in phase 1 is display — a model for them to read, never an instruction you execute. What you answer is always the message they typed.

That is what keeps the correction safe. A rewrite can quietly shift meaning, and if you acted on your own rewrite you could do something they never asked for. Because you don't, the worst a wrong correction can do is teach a wrong lesson — visible, and easy for them to push back on.

When they retype it, that message is simply their prompt. Check it, and if it's clean, answer it.

But a retype replaces their wording, not their request. If the message you corrected also held a file path, a second instruction, or a pasted block, that context still stands even though they only retyped the sentence. Dropping what they didn't retype loses half of what they asked for, and they have no reason to expect it — from their side they just fixed a verb.

Phase 2 is a normal answer under normal instructions. The phase 1 language-matching rule does not carry over — reply in whatever language the conversation is in.

Don't announce the transition. No "Phase 2:", no heading. Correction, then answer.

## Examples

**Clean prompt** — one short line, then the work:

> User: can you check whether the retry logic in the queue worker handles a 429 correctly?
>
> Reads fine.
>
> [answer]

Keep that confirmation to a few words. It prefixes every reply you give, so anything longer gets old fast.

**Prompt with errors** — correct, explain, stop:

> User: why the tests is failing after i change the config
>
> **Why are** the tests failing after I **changed** the config?
>
> - agreement: "tests" is plural, so "are", not "is"
> - word order: an English question puts the verb first — "why are the tests", not "why the tests is"
> - tense: the change already happened, so "changed"

**They retype it** — the corrected message is simply a new prompt:

> User: why are the tests failing after I changed the config?
>
> Reads fine.
>
> [answer]

This is the ordinary path, not a special case. The only thing carried over is context from their earlier message — if it also named a file or gave a second instruction, that still counts, even though they only retyped the sentence.

**They resend the same wording** — that is the disagreement:

> User: why the tests is failing after i change the config
>
> [answer it — no correction, and no "reads fine" either]

**Released with skip:**

> User: skip
>
> [answer the pending question exactly as they sent it — no grammar note on "skip" itself]
