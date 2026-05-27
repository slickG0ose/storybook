#!/usr/bin/env bash
# SessionStart orientation — emits a compact "where am I?" briefing on stdout.
# Whatever this script prints to stdout becomes additional context for Claude's
# first turn. Skipped on `compact` source (the model already has its summary).
set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"

SOURCE=$(printf '%s' "$INPUT" | node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write(j.source || "");
  } catch (e) {}
});
' 2>/dev/null || true)

# Skip on post-compaction restart — model just got a summary, no need to spam more.
if [[ "$SOURCE" == "compact" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# All git/gh calls swallow errors so a half-configured repo never breaks startup.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)")
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || echo "")
AHEAD_BEHIND=""
if [[ -n "$UPSTREAM" ]]; then
  AB=$(git rev-list --left-right --count "@{u}"...HEAD 2>/dev/null || echo "")
  if [[ -n "$AB" ]]; then
    BEHIND=$(printf '%s' "$AB" | awk '{print $1}')
    AHEAD=$(printf '%s' "$AB" | awk '{print $2}')
    AHEAD_BEHIND=" (ahead $AHEAD, behind $BEHIND vs $UPSTREAM)"
  fi
fi

STATUS=$(git status --short 2>/dev/null | head -15 || true)
STATUS_TRUNC=""
TOTAL_DIRTY=$(git status --short 2>/dev/null | wc -l | tr -d ' ' || echo 0)
if (( TOTAL_DIRTY > 15 )); then
  STATUS_TRUNC=" (+$((TOTAL_DIRTY - 15)) more)"
fi

RECENT=$(git log --oneline -5 2>/dev/null || true)

PR_LINE=""
if command -v gh >/dev/null 2>&1; then
  PR_LINE=$(gh pr list --head "$BRANCH" --json number,title,url,isDraft \
    --jq '.[] | "#\(.number) \(.title)\(if .isDraft then " [draft]" else "" end) — \(.url)"' 2>/dev/null || true)
fi

ISSUES=""
if command -v gh >/dev/null 2>&1; then
  ISSUES=$(gh issue list --state open --limit 6 --json number,title,labels \
    --jq '.[] | "#\(.number) \(.title) [\(.labels | map(.name) | join(", "))]"' 2>/dev/null || true)
fi

# --- Emit ---
{
  echo "## Session orientation (auto-injected by .claude/hooks/session-start-orient.sh)"
  echo
  echo "**Branch:** \`$BRANCH\`$AHEAD_BEHIND"
  if [[ -n "$PR_LINE" ]]; then
    echo "**Open PR for this branch:**"
    printf '%s\n' "$PR_LINE" | sed 's/^/- /'
  fi
  echo
  if [[ -n "$STATUS" ]]; then
    echo "**Working tree (\`git status --short\`):**"
    echo '```'
    printf '%s\n' "$STATUS"
    [[ -n "$STATUS_TRUNC" ]] && echo "$STATUS_TRUNC"
    echo '```'
  else
    echo "**Working tree:** clean"
  fi
  echo
  if [[ -n "$RECENT" ]]; then
    echo "**Recent commits:**"
    echo '```'
    printf '%s\n' "$RECENT"
    echo '```'
    echo
  fi
  if [[ -n "$ISSUES" ]]; then
    echo "**Open issues (top 6):**"
    printf '%s\n' "$ISSUES" | sed 's/^/- /'
    echo
  fi
  echo "_Source: \`${SOURCE:-unknown}\`. Skip with: comment out the Bash matcher for SessionStart in \`.claude/settings.json\`._"
}
