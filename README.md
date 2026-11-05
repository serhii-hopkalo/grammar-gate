# grammar-gate

A grammar pane for Claude Code. Every message you send is checked in the background, and the correction shows in a pane on the right while Claude answers.

Built for people working in a second language who want to improve it as a side effect of the work they were already doing.

## What it does

1. You send a message. It goes to Claude unchanged and is never held back.
2. The check runs alongside. A clean message shows nothing. On an error the Grammar pane opens with your message and a correction, only the changed words in bold and one short line per reason.
3. The pane takes the keyboard, with the cursor in a retype box. Type the sentence yourself and press Enter to check it again. Once it comes back clean, the pane closes and the keyboard returns to the main prompt.

```
> why the tests is failing after i change the config

why **are** the tests failing after i **changed** the config

- agreement: "tests" is plural, so "are", not "is"
- word order: an English question puts the verb before the subject
- tense: the change already happened, so "changed"
```

Each check replaces the pane, so only the latest correction shows.

The pane takes the keyboard only while the main prompt is empty, so it never interrupts typing. When the app does not hand the pane the keyboard, the pane shows a line saying how to reach the retype box. Click the pane or press ctrl+x then tab to focus it by hand, and Esc to return. `/grammar` reopens a closed pane.

## Install

```bash
claude plugin marketplace add serhii-hopkalo/grammar-gate
claude plugin install grammar-gate@grammar-gate
```

Then run `/reload-plugins` or restart Claude Code.

## What is checked

Slash commands, `!` lines, one-word replies (`yes`, `ok`, `skip`, `thanks`), and messages over 4,000 characters are not checked.

Not errors: informal register, lowercase, terse fragments, missing final periods, technical shorthand, full forms where a contraction would also work, and dictation slips. Pasted code, logs and quoted material are left alone. The checker reports nothing rather than invent a nitpick, and a correction that only changes capitalization or the final punctuation is dropped.

Corrections and reasons come back in the language you wrote in. The short label before each colon follows an English example by default. For a Cyrillic message typed on a Ukrainian macOS keyboard, the mod adds a Ukrainian example from `mod/hooks/examples/uk.txt`, so the label comes back in Ukrainian too. The keyboard decides because nothing tells Ukrainian from Russian on a short sentence.

## How it works

| Piece | Role |
|---|---|
| `mod/hooks/register.tsx` | The mod. A `prompt.submit` hook starts the check without waiting on it, and a `Pane` render draws the result and the retype box. |
| `mod/hooks/checker-prompt.txt` | The checker's rules: what counts as an error, what does not, and the output format. |
| `mod/hooks/examples/uk.txt` | A Ukrainian worked example, added to the rules for a Cyrillic message on a Ukrainian keyboard. |

The check runs `claude -p --system-prompt <rules>` with `--safe-mode`, `--tools ""`, no session file, low effort and no thinking. It uses `claude -p` rather than the mod API's `$.model.complete` because the latter keeps Claude Code's own system prompt ahead of the rules, and with it the checker misses plain typos.

The check is bounded at 30 seconds. A failure opens the pane with "Check failed" and never affects the message.

### The retype check

A sentence typed in the retype box also goes to Jev, TypeSafe's decision model, at the same time as the `claude -p` check. Jev answers in about 0.2 seconds, against about 2.5 seconds for `claude -p`, but it returns only the probability that the sentence has an error and cannot write a correction. When that probability is 0.3 or lower, the pane closes at once. The `claude -p` check still runs, and a correction from it reopens the pane.

Jev runs only when `TYPESAFE_API_KEY` is set, in Claude Code's environment or in your interactive shell, for example exported in `~/.zshrc`. The desktop app starts Claude Code without your shell's environment, so the mod reads the key once from `$SHELL -ic`. Without a key, or when the request fails, the retype check works as before. The retyped sentence is sent to `api.typesafe.ai`.

## Requirements

Claude Code with mod support, and `claude` on your `PATH`. Optional: a TypeSafe API key in `TYPESAFE_API_KEY` for the faster retype check.

## Uninstall

```bash
claude plugin uninstall grammar-gate@grammar-gate
```

## License

MIT
