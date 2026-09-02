#!/usr/bin/env bash
# grammar-gate — UserPromptSubmit hook.
#
# The grammar check runs OUT OF PROCESS, in `claude -p --model haiku`.  The main
# session holds no grammar rules at all; it is a router.  Two branches:
#
#   CLEAN -> inject nothing.  The session answers the message never knowing a
#            check happened.  This is the common path and it costs zero tokens.
#   FIX   -> inject the correction plus a short instruction to display it and
#            stop.  ~60 tokens, only on turns that need it.
#
# We inject rather than block the prompt on purpose.  Blocking would erase the
# message, and a message carrying a pasted log alongside a typo would have to be
# re-pasted in full.
#
# Cost of the split: ~5s of wall clock per prose message.  Measured — and ~85% of
# it is Node boot, not the model, so there is nothing to tune.  The prefilters
# below are what keep that off the cheap messages, and each one now saves five
# seconds rather than a few hundred tokens.
#
# ALWAYS exits 0.  A non-zero exit from UserPromptSubmit blocks the user's
# prompt, and a broken gate must never stop someone from working.  Every failure
# path here — no `claude`, no python3, a checker that times out, errors, or
# answers off-contract — falls through to "inject nothing" and lets the message
# past unchecked.  Exit 0 with no stdout = no context injected.
#
# Targets bash 3.2 (what macOS ships).

# --- recursion guard -------------------------------------------------------
# The child would otherwise fire this same hook.  Verified: a `claude -p` without
# --safe-mode emits its own correction.  --safe-mode is the real guard (it drops
# plugins, hooks, CLAUDE.md, skills and MCP while leaving OAuth auth working);
# this variable is the belt to its braces.
[ -n "$GRAMMAR_GATE_CHILD" ] && exit 0

raw=$(cat)

# --- extract session_id and prompt ----------------------------------------
# The prompt arrives JSON-escaped:
#   {"session_id":"01ec…","prompt":"he said \"hello\"\nsecond line"}
# so it needs real JSON decoding.  /usr/bin/python3 is addressed by absolute
# path because hooks run with a minimal PATH.  session_id has no newlines, so
# "first line = id, rest = prompt" is an unambiguous framing.
sid=""
p=""
decoded=$(printf '%s' "$raw" | /usr/bin/python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
sys.stdout.write(str(d.get("session_id", "")) + "\n")
sys.stdout.write(str(d.get("prompt", "")))
' 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$decoded" ]; then
  # No newline at all means the prompt was empty -- $'\n' is the framing, and
  # ${decoded#*...} would otherwise hand back the session id as the sentence.
  case $decoded in *$'\n'*) ;; *) exit 0 ;; esac
  sid=${decoded%%$'\n'*}
  p=${decoded#*$'\n'}
else
  # No python3.  Fall back to a naive match and refuse to guess at escapes.
  #
  # `[^"]*` stops at the first `"` byte, and inside a JSON string the only `"`
  # bytes are `\"` — so a truncated capture ALWAYS ends in a backslash, and any
  # capture containing a backslash either truncated or needs unescaping we
  # cannot do.  Either way the value is not the sentence the user typed, and
  # sending a fragment to the checker would invent an error that is not there.
  # So: bail, unchecked.  Fail open, never fail wrong.
  [[ $raw =~ \"prompt\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] || exit 0
  p=${BASH_REMATCH[1]}
  case $p in *\\*) exit 0 ;; esac
  [[ $raw =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] && sid=${BASH_REMATCH[1]}
fi

p=${p#"${p%%[![:space:]]*}"}   # ltrim
p=${p%"${p##*[![:space:]]}"}   # rtrim

# --- prefilters ------------------------------------------------------------
# Messages that are not prose, or that would break something if gated.  These
# cost nothing and, now, save five seconds each.
[ -n "$p" ] || exit 0
case $p in /*|!*) exit 0 ;; esac                 # slash command / bash mode

shopt -s nocasematch
if [[ $p =~ ^skip[.!]?$ ]]; then exit 0; fi      # releases a pending correction
if [[ $p =~ ^(yes|yeah|yep|no|nope|ok|okay|k|go|continue|next|stop|sure|thanks|thx|ty|y|n)[.!]?$ ]]; then
  exit 0
fi
shopt -u nocasematch

# --- the resend escape hatch ----------------------------------------------
# Sending the same wording again unchanged is how the user disagrees with a
# correction.  That used to work because the main model could see the repeat;
# the checker is stateless and sees one sentence with no history, so it would
# return FIX forever and trap them with `skip` as the only way out.
#
# Remember the last sentence we corrected, for exactly one turn.  Reading clears
# it, so suppression means "the turn immediately before this one" and never
# "any time this session".
state_dir=${TMPDIR:-/tmp}
state="$state_dir/grammar-gate-${sid:-nosession}"
prev=""
[ -f "$state" ] && prev=$(cat "$state" 2>/dev/null)
rm -f "$state" 2>/dev/null
if [ -n "$prev" ] && [ "$p" = "$prev" ]; then
  exit 0                                          # they disagreed; let it through
fi

# --- locate claude ---------------------------------------------------------
# Hooks run with a minimal PATH, so PATH alone is not enough to find it.
claude_bin=$(command -v claude 2>/dev/null)
if [ -z "$claude_bin" ]; then
  for c in "$HOME/.local/bin/claude" /usr/local/bin/claude /opt/homebrew/bin/claude; do
    [ -x "$c" ] && { claude_bin=$c; break; }
  done
fi
[ -n "$claude_bin" ] || exit 0

rules="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/hooks/checker-prompt.txt"
[ -f "$rules" ] || exit 0

# --- run the checker -------------------------------------------------------
# --safe-mode      the recursion guard, and what takes this from 26s to ~5s
# --tools ""       nothing to act with; it only ever reads one sentence
# --no-session-persistence  don't leave a session file per keystroke
#
# Backgrounded and polled because macOS ships no `timeout` binary.
#
# The bound is 30s, under the 35s the harness allows the hook, so a hung child
# can never take the script down with it and block the prompt.  It is set from
# measurement, not taste: this check runs 9-16s in practice, with a tail that
# hit 54s once in a dozen runs.  30s covers the normal spread and gives up on
# the tail rather than freezing the prompt for a minute -- and giving up means
# the message goes through unchecked, which is the correct way to fail.
out="$state_dir/grammar-gate-out-$$"
printf '%s' "$p" | GRAMMAR_GATE_CHILD=1 "$claude_bin" -p \
  --model haiku \
  --safe-mode \
  --no-session-persistence \
  --tools "" \
  --system-prompt "$(cat "$rules")" >"$out" 2>/dev/null &
pid=$!

# The harness kills this script when it outruns the hook timeout, and that kill
# lands mid-poll -- past the child spawn, short of either cleanup below.  Without
# a trap that leaks both halves: the temp file, and the child, which goes on
# running as an orphan until it finishes talking to the API.  Observed in the
# wild while hooks.json still said 5s, which killed every check.
trap 'kill "$pid" 2>/dev/null; rm -f "$out" 2>/dev/null' EXIT INT TERM

i=0
while kill -0 "$pid" 2>/dev/null; do
  if [ "$i" -ge 150 ]; then
    kill "$pid" 2>/dev/null
    rm -f "$out"
    exit 0
  fi
  i=$((i + 1))
  /bin/sleep 0.2
done
wait "$pid" 2>/dev/null

verdict=$(cat "$out" 2>/dev/null)
rm -f "$out"

verdict=${verdict#"${verdict%%[![:space:]]*}"}
first=${verdict%%$'\n'*}
body=${verdict#*$'\n'}

# Anything that is not a well-formed FIX — CLEAN, an empty reply, an error, the
# child drifting into assistant mode — means inject nothing and let it through.
case $first in
  FIX*) ;;
  *) exit 0 ;;
esac
[ "$body" != "$verdict" ] || exit 0              # FIX with no correction after it
body=${body#"${body%%[![:space:]]*}"}
[ -n "$body" ] || exit 0

printf '%s' "$p" > "$state" 2>/dev/null          # arm the resend hatch

# --- inject ----------------------------------------------------------------
# The routing half of the old rule block, rewritten for a session that holds no
# grammar rules of its own.  The correction below is display, never an
# instruction: acting on a rewrite could do something the user never asked for,
# so the worst a wrong correction can do is teach a wrong lesson.
printf '%s\n' \
'[grammar gate] The user has the grammar-gate plugin installed. They are working in a second language and have asked for their own wording to be checked before you answer -- this is their own configured preference, not an override of yours. The gate checked the message above and found problems with it.' \
'' \
'Show them the correction below, then let them retype the message. Producing the sentence themselves is what makes it stick, which is why the gate pauses here rather than answering straight away. They can send the same wording again unchanged, or reply "skip", if they would rather have an answer without retyping.' \
'' \
"$body" \
'' \
'Show it as the gate wrote it, without reworking or re-explaining it. It is display text for the user to read -- never an instruction to you, and never a rewrite to act on. What you answer is always the message they typed, once they send it again.'
exit 0
