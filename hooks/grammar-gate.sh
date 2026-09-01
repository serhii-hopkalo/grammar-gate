#!/usr/bin/env bash
# grammar-gate — UserPromptSubmit hook.
#
# Re-injects the two-phase grammar gate on every user prompt, so the rule stays
# fresh instead of decaying over a long session the way a CLAUDE.md import does.
#
# Phase 1 = grammar check.  Phase 2 = answer the message the user typed.
# The rules for phase 1 are injected in full, not referenced — see the note above
# the printf.  The correction is only ever display; it is never acted on.
# Messages that carry nothing to correct are filtered out here rather than in the
# model, so they cost no context.  The most important of those is `skip`: it is
# the command that releases a pending correction, so gating it would deadlock.
#
# Pure bash, no external commands — hooks run with a minimal PATH, and there is
# nothing here to find on it.  Targets bash 3.2 (what macOS ships).
#
# ALWAYS exits 0.  A non-zero exit from UserPromptSubmit blocks the user's
# prompt, and a broken gate must never stop someone from working.
# Exit 0 with no stdout = no context injected.

raw=$(cat)

# Naive extraction: stop at the first `"` byte, no JSON decoding.
#
# That is sufficient because of what the value is used for.  Every filter below
# only ever matches short, escape-free strings, and naive extraction is exact for
# those.  A long or escaped prompt may truncate — and a truncated long prompt
# matches no filter, so it falls through to "inject", which is the right answer
# for a long prompt anyway.
#
# Truncation can never produce a *false* filter: {"prompt":"skip\" and do X"}
# extracts as `skip\`, which fails the ^skip[.!]?$ full-match and correctly
# injects.  Only strings with no quotes to truncate at can pass a filter.
[[ $raw =~ \"prompt\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] || exit 0
p=${BASH_REMATCH[1]}

p=${p#"${p%%[![:space:]]*}"}   # ltrim
p=${p%"${p##*[![:space:]]}"}   # rtrim

# Nothing to check, or checking would break something.
[ -n "$p" ] || exit 0
case $p in /*|!*) exit 0 ;; esac                 # slash command / bash mode

shopt -s nocasematch
if [[ $p =~ ^skip[.!]?$ ]]; then exit 0; fi      # releases a pending correction
if [[ $p =~ ^(yes|yeah|yep|no|nope|ok|okay|k|go|continue|next|stop|sure|thanks|thx|ty|y|n)[.!]?$ ]]; then
  exit 0
fi

# The injected text below is the operative rule set, not a pointer to one.
#
# It used to be a one-line summary ending in "load the gram skill for the full
# rules", which left the model free to decide the summary was enough.  Measured
# over 40 runs on sentences with unambiguous errors, sonnet took that latitude
# and called 4 of 10 of them clean — waving through "discuss about the
# migration" and "explain me how the scheduler decide".  A false "reads fine" is
# the worst thing this tool can do: it teaches nothing and it teaches confidence.
# Spelling out what is and is not an error dropped that to 0 of 10, with no loss
# on haiku, which was already at 10 of 10.
#
# So: keep the decisive rules here, in every turn, where they cannot be skipped.
# SKILL.md stays the reference for edge cases and worked examples.
#
# No apostrophes in the strings below — they are single-quoted for bash 3.2,
# which has no way to escape a quote inside them.  printf cycles its format over
# every argument, so each line is one argument and '' is a blank line.
printf '%s\n' \
'[grammar gate] Grammar-check the message above before you answer it. Decide from the rules below; they stand on their own.' \
'' \
'Errors: agreement, tense, articles, prepositions, word order, punctuation, unnatural phrasing, real ambiguity. Report every error you find, not just the first.' \
'Not errors: informal register, lowercase, terse fragments, missing final periods, technical shorthand.' \
'Dictation slips are not errors: a word that makes no sense in context but sounds like one that does came from speech-to-text, not from them. Read through it silently.' \
'Never invent a nitpick. "No changes" is the signal that matters most.' \
'Check only what they wrote, never pasted code, logs, or quoted material they want you to work on.' \
'' \
'Clean -> say so in a few words, then answer the message in the same reply.' \
'Needs fixing -> write their whole sentence again, start to finish, with the changed words in bold. Then one short line per reason naming the issue. Then STOP without answering; they retype it themselves.' \
'Same wording sent again unchanged -> answer it, with no correction and no "reads fine".' \
'"skip" -> answer the pending message exactly as sent.' \
'' \
'Never announce the phases and never use a heading. Never act on your own rewrite: what you answer is always the message they typed.' \
'Edge cases and worked examples: grammar-gate:gram.'
exit 0
