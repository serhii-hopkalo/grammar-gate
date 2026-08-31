#!/usr/bin/env bash
# grammar-gate — UserPromptSubmit hook.
#
# Re-injects the two-phase grammar gate on every user prompt, so the rule stays
# fresh instead of decaying over a long session the way a CLAUDE.md import does.
#
# Phase 1 = grammar check (gram skill).  Phase 2 = answer the message the user typed.
# The correction is only ever display; it is never the thing that gets acted on.
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

printf '%s\n' '[grammar gate] Phase 1: grammar-check the message above. Clean -> say so briefly and continue. Needs fixing -> correction with only the changed words bold, reasons one line each, then stop; they retype it themselves. Phase 2: answer what they typed, never your own rewrite; a retype replaces wording, not context. "skip" = answer it as sent. Load the grammar-gate:gram skill for the full rules before deciding.'
exit 0
