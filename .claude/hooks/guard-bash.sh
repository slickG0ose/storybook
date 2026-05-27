#!/usr/bin/env bash
# PreToolUse:Bash guard — mechanically enforces CLAUDE.md "ALWAYS confirm" guardrails
# that are easy for a session to forget. stdin = hook JSON. exit 2 = block + stderr to Claude.
set -euo pipefail

INPUT="$(cat)"

CMD=$(printf '%s' "$INPUT" | node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write((j.tool_input && j.tool_input.command) || "");
  } catch (e) {}
});
')

# Normalize whitespace for matching; keep $CMD intact for the error report.
NORM=$(printf '%s' "$CMD" | tr -s '[:space:]' ' ')

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

# 1) data.json deletion — CLAUDE.md: "NEVER rm — use resetStore() for tests"
if [[ "$NORM" =~ (^|[[:space:];&|\`])rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+[^[:space:]\;\&\|]*data\.json([[:space:]]|$|\;|\&|\|) ]]; then
  block "Refuses to rm data.json — use resetStore() in tests."
fi

# 2) Test-file deletion — CLAUDE.md: "Deleting tests rather than fixing them" requires confirmation
if [[ "$NORM" =~ (^|[[:space:];&|\`])rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+[^[:space:]\;\&\|]*\.(test|spec)\.(ts|tsx|js|jsx)([[:space:]]|$|\;|\&|\|) ]]; then
  block "Refuses to delete a test file — fix tests rather than delete them."
fi

# 3) Local dev DB deletion — CLAUDE.md flow is db:reset (drops + recreates via migrations)
if [[ "$NORM" =~ (^|[[:space:];&|\`])rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+[^[:space:]\;\&\|]*dev\.db([[:space:]]|$|\;|\&|\|) ]]; then
  block "Refuses to rm dev.db directly — use npm run db:reset."
fi

# 4) Force-push to a protected branch
if [[ "$NORM" =~ git[[:space:]]+push[[:space:]]+.*(--force|--force-with-lease|-f([[:space:]]|$)) ]] \
   && [[ "$NORM" =~ [[:space:]](master|main|develop)([[:space:]]|$) ]]; then
  block "Refuses to force-push to master/main/develop."
fi

# 5) Hard reset while currently on a protected branch
if [[ "$NORM" =~ (^|[[:space:];&|\`])git[[:space:]]+reset[[:space:]]+--hard ]]; then
  CURRENT_BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  case "$CURRENT_BRANCH" in
    master|main|develop)
      block "Refuses 'git reset --hard' on protected branch '$CURRENT_BRANCH'."
      ;;
  esac
fi

# 6) .git directory removal
if [[ "$NORM" =~ (^|[[:space:];&|\`])rm([[:space:]]+-[a-zA-Z]+)+[[:space:]]+[^[:space:]\;\&\|]*\.git([[:space:]/]|$|\;|\&|\|) ]]; then
  block "Refuses to remove the .git directory."
fi

exit 0
