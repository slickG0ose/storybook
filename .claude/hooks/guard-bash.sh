#!/usr/bin/env bash
# PreToolUse:Bash guard — mechanically enforces CLAUDE.md "ALWAYS confirm" guardrails
# that are easy for a session to forget. stdin = hook JSON. exit 2 = block + stderr to Claude.
set -euo pipefail

INPUT="$(cat)"

# Parse the tool_input.command field out of the hook JSON.
# Safe-fail: if node is missing or the parse fails, CMD stays empty and every
# regex below misses, so the script exits 0 (allow). The cost of a missed
# parse is "the guard didn't fire"; the cost of a crash here would be a
# spammy non-zero exit on every Bash tool call — worse UX than just allowing.
CMD=""
if command -v node >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write((j.tool_input && j.tool_input.command) || "");
  } catch (e) {}
});
' 2>/dev/null || true)
fi

# Strip heredoc bodies + single-quoted string contents before pattern matching.
# Bash never executes either — so a guarded pattern appearing inside them
# (e.g. inside a `gh issue create --body "$(cat <<'EOF' ... EOF)"` heredoc,
# or inside a quoted log message) must not trigger a false positive.
# Double-quoted strings stay intact: they can contain $(...) substitution
# which IS executable and worth guarding.
CLEANED=$(printf '%s' "$CMD" | awk '
  BEGIN { in_heredoc = 0; delim = "" }
  {
    if (in_heredoc) {
      line = $0
      sub(/^[\t ]+/, "", line)
      if (line == delim) { in_heredoc = 0; print "HEREDOC_END" }
      # else: body line dropped
    } else if (match($0, /<<-?["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?/)) {
      marker = substr($0, RSTART, RLENGTH)
      sub(/^<<-?["\047]?/, "", marker)
      sub(/["\047]?$/, "", marker)
      delim = marker; in_heredoc = 1
      replaced = $0
      sub(/<<-?["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?.*$/, "HEREDOC_START", replaced)
      print replaced
    } else { print }
  }
' | sed "s/'[^']*'/SQ_STRIPPED/g")

# Normalize whitespace for matching; keep $CMD intact for the error report.
NORM=$(printf '%s' "$CLEANED" | tr -s '[:space:]' ' ')

block() {
  local reason="$1"
  {
    printf 'BLOCKED by .claude/hooks/guard-bash.sh\n'
    printf 'Reason : %s\n' "$reason"
    printf 'Command: %s\n' "$CMD"
    printf 'If intentional, ask the user to run this themselves or disable the hook.\n'
  } >&2
  exit 2
}

# Command-start boundary: real shell separators (NOT plain whitespace), so
# `echo "rm data.json"` inside a quoted string doesn't trip rm-rule matches.
# Anchors: start-of-string, ; & | backtick ( — followed by optional whitespace.
# All rules use $CMD_START so they share the same echo-bypass safety.
CMD_START='(^|[;&|`(])[[:space:]]*'

# 1) data.json deletion — CLAUDE.md: "NEVER rm — use resetStore() for tests"
if [[ "$NORM" =~ ${CMD_START}rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+[^[:space:]\;\&\|]*data\.json([[:space:]]|$|\;|\&|\|) ]]; then
  block "Refuses to rm data.json — use resetStore() in tests."
fi

# 2) Test-file deletion — CLAUDE.md: "Deleting tests rather than fixing them" requires confirmation
if [[ "$NORM" =~ ${CMD_START}rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+[^[:space:]\;\&\|]*\.(test|spec)\.(ts|tsx|js|jsx)([[:space:]]|$|\;|\&|\|) ]]; then
  block "Refuses to delete a test file — fix tests rather than delete them."
fi

# 3) Local dev DB deletion — CLAUDE.md flow is db:reset (drops + recreates via migrations)
if [[ "$NORM" =~ ${CMD_START}rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+[^[:space:]\;\&\|]*dev\.db([[:space:]]|$|\;|\&|\|) ]]; then
  block "Refuses to rm dev.db directly — use npm run db:reset."
fi

# 4) Force-push to a protected branch
if [[ "$NORM" =~ ${CMD_START}git[[:space:]]+push[[:space:]]+.*(--force|--force-with-lease|-f([[:space:]]|$)) ]] \
   && [[ "$NORM" =~ [[:space:]](master|main|develop)([[:space:]]|$) ]]; then
  block "Refuses to force-push to master/main/develop."
fi

# 5) Hard reset while currently on a protected branch
if [[ "$NORM" =~ ${CMD_START}git[[:space:]]+reset[[:space:]]+--hard ]]; then
  CURRENT_BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  case "$CURRENT_BRANCH" in
    master|main|develop)
      block "Refuses 'git reset --hard' on protected branch '$CURRENT_BRANCH'."
      ;;
  esac
fi

# 6) .git directory removal
if [[ "$NORM" =~ ${CMD_START}rm([[:space:]]+-[a-zA-Z]+)+[[:space:]]+[^[:space:]\;\&\|]*\.git([[:space:]/]|$|\;|\&|\|) ]]; then
  block "Refuses to remove the .git directory."
fi

# 7) Commit on a protected branch — CLAUDE.md is trunk-based but enforces
#    short-lived feature branches + squash-merge PRs. Direct commits to
#    master|main|develop are also rejected by GitHub branch protection on push;
#    catching them here saves a rebase later.
if [[ "$NORM" =~ ${CMD_START}git[[:space:]]+commit([[:space:]]|$) ]]; then
  CURRENT_BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  case "$CURRENT_BRANCH" in
    master|main|develop)
      block "Refuses 'git commit' on protected branch '$CURRENT_BRANCH' — create a feature branch first per CLAUDE.md (git switch -c <type>/<descriptor>)."
      ;;
  esac
fi

exit 0
