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

## How it works

Two pieces, and the split is deliberate:

| Piece | Role |
|---|---|
| `hooks/grammar-gate.sh` | A `UserPromptSubmit` hook. Fires on **every** prompt, filters out anything with nothing to correct, and injects the compressed rule. |
| `skills/gram/SKILL.md` | The full rules — what counts as an error, the output format, the edge cases. Loaded on demand. |

The hook is what makes this fire every time rather than only when the model happens to reach for the skill, and it re-injects on every turn so the rule can't fade over a long session. Filtered messages cost zero tokens.

**No CLAUDE.md edit needed.** If you've seen a hand-rolled version of this, it probably lived partly in `CLAUDE.md`. That isn't necessary and isn't done here — the hook covers it, and covers it better.

## Requirements

Claude Code, and nothing else.

The hook is pure bash with no external commands — no python, no `jq`, no dependency on what's on your `PATH`. It targets bash 3.2, so the `/bin/bash` that ships with macOS is fine.

## Uninstall

```bash
claude plugin uninstall grammar-gate
```

## License

MIT
