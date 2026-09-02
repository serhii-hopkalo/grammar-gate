# grammar-gate

A grammar gate for Claude Code. Every message you type gets checked before Claude answers it.

Built for people working in a second language who want to improve it while getting real work done — not by opening a separate proofreading tool, but as a side effect of the work they were already doing.

## What it does

Two phases, one flow:

1. **Check the prompt.** If something is genuinely wrong, Claude shows a corrected version with only the changed words in bold, one short line per reason — then **stops**.
2. **Answer the prompt.** If nothing is wrong, Claude says so in a few words and answers in the same reply.

```
You:    why the tests is failing after i change the config

Claude: **Why are** the tests failing after I **changed** the config?

        - agreement: "tests" is plural, so "are", not "is"
        - word order: an English question puts the verb first
        - tense: the change already happened, so "changed"
```

You retype it yourself. That pause is the point — producing the sentence is what makes it stick; reading someone else's version is passive.

## Install

```bash
claude plugin marketplace add serhii-hopkalo/grammar-gate
```

```bash
claude plugin install grammar-gate
```

Restart Claude Code. The gate is on for every session.

## `skip`

Don't feel like retyping? Reply `skip`.

Claude answers the message you already sent, exactly as you sent it, with no grammar note. This is the first thing you'll want, so it's worth knowing before you need it.

Two other escape hatches:

- **Send the same wording again, unchanged.** That's how you disagree with a correction. Claude drops it and answers — no second correction, and no "reads fine" either.
- **Nothing is gated except prose.** Slash commands, `!` bash-mode lines, one-word replies (`yes`, `ok`, `continue`, `thanks`), and empty input pass straight through. Pasted code, logs, and quoted material you're asking Claude to work *on* are left alone too — it checks your instruction, not the thing you pasted.

## The correction is never acted on

This is the safety property, not a stylistic choice.

The rewrite Claude shows you is **display only**. What it answers is always the message *you* typed. A rewrite can quietly shift meaning, and a model that acted on its own rewrite could do something you never asked for. Because it doesn't, the worst a wrong correction can do is teach a wrong lesson — visible on screen, and easy to push back on.

## What's not an error

Informal register, lowercase, terse fragments, missing final periods, technical shorthand. You're typing to an assistant, not writing an essay.

Dictation noise isn't corrected either. If speech-to-text turns *bold* into "bolt" or *jargon dump* into "jogging dump", you didn't write that — a transcriber did. Correcting it teaches nothing and buries the real errors.

And it won't manufacture nitpicks. "No changes" is the signal that actually matters — it's how you learn what you already have right.

## Language of the correction

The correction and its reasons come back in the language you wrote in — a Ukrainian message
gets a Ukrainian explanation.

The short label before each colon is a separate matter. It follows the worked example in
`hooks/checker-prompt.txt`, which is in English, so the default is a Ukrainian explanation
under an English label. To move the label as well, the plugin keeps a second worked example
per language in `hooks/examples/` and splices it in when it can tell which language you
wrote in.

Two signals decide that, and neither of them is a guess:

- **the message** — whether it contains Cyrillic at all. It either does or it does not.
- **your keyboard** — which Cyrillic language, read from the selected macOS input source.

The keyboard is there because nothing tells Ukrainian from Russian on a short sentence.
Apple's own `NLLanguageRecognizer` calls a four-word Ukrainian sentence Russian at 0.81
confidence, and the alphabet cannot separate them at all. Your layout can, because you
cannot type `і ї є ґ` on the Russian one. The message keeps the veto, so a Ukrainian
layout left selected while you type English changes nothing.

## How it works

The grammar check does **not** run in your main session. It runs out of process, in a
`claude -p` subprocess on Haiku, and your session never holds the grammar rules at all.

| Piece | Role |
|---|---|
| `hooks/grammar-gate.sh` | A `UserPromptSubmit` hook. Fires on every prompt, filters out anything with nothing to correct, and runs the checker. |
| `hooks/checker-prompt.txt` | The rules, as the checker subprocess's system prompt: what counts as an error, what doesn't, and the output format. |
| `hooks/examples/*.txt` | One extra worked example per language, spliced into that system prompt when the hook can tell which language you wrote in. Optional — with the directory absent, everything else still works. |

Two outcomes. On a clean message the hook injects **nothing**, so the turn costs zero
extra tokens and your session never learns a check happened. On a message with errors it
injects the correction plus a short note to show it and pause. Filtered messages never
reach the subprocess at all.

The subprocess runs with `--safe-mode`, which is what stops the child from firing this
same hook and spawning a checker of its own. It also has `--tools ""`, so the checker has
nothing to act with: it reads your message, however long, and writes one verdict.

### What this costs

Moving the check out of your context buys the tokens back and spends wall clock instead:

| | Before (rules in context) | Now (subprocess) |
|---|---|---|
| Tokens per prose turn | ~300, every turn | ~0 clean, ~60 on a correction |
| Delay before your turn starts | none | **~3–4s** |

About 1.1s of that is process startup. The rest is a single model call.

It used to be 9–43s, and almost none of that was startup either. The checker inherits the
environment of the session that spawns it — `--safe-mode` drops configuration, not
environment — so it ran at whatever effort level you had set and spent up to 3000 thinking
tokens deciding whether a short message had a typo. The hook now sets `MAX_THINKING_TOKENS=0`,
`CLAUDE_EFFORT=low` and `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` on the child explicitly.
Verdicts did not change: across 19 checks spanning clean, agreement, article, pasted-log
and Ukrainian input, thinking-off gave the same answer every time. On one sentence sitting
right on the model's threshold it was the better of the two — thinking-on returned "no
changes" three times out of three on a message with two real errors in it.

The hook gives up at 12s and lets the message through **unchecked**, so on a slow call you
get no correction and no indication that one was skipped. That is deliberate — a gate that
stalls your prompt is worse than a gate that occasionally misses — but it means the check
is best-effort, not guaranteed.

## Requirements

Claude Code, plus:

- **`claude` on your `PATH`** (or at `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`) — the hook shells out to it.
- **`/usr/bin/python3`** — to decode the prompt out of the hook payload. Without it the hook falls back to a naive match and skips any message it cannot decode exactly, rather than risk correcting a fragment.
- **`/usr/bin/defaults`** — macOS only, and optional. Read to tell which Cyrillic keyboard you are typing on. Absent, or on Linux, corrections still work; only the label before each colon stays English.

The hook sets `MAX_THINKING_TOKENS=0`, `CLAUDE_EFFORT=low` and
`CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` on the subprocess. A build that does not recognise
one of them ignores it — the check is slower, not broken.

Earlier versions were pure bash with no external commands. That is no longer true: running
the check in a subprocess means depending on the thing that runs it.

## Uninstall

```bash
claude plugin uninstall grammar-gate
```

## License

MIT
