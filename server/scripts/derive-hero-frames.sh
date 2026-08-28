#!/usr/bin/env bash
#
# derive-hero-frames.sh -- derive the hero-rotation pool frames.
#
# This is ADR-014's documented one-liner grown a loop, and deliberately nothing more:
# no pipeline, no CI step, no build hook. Run it by hand when the frame list below
# changes, then commit the outputs. See server/public/hero/README.md for provenance and
# .code-captain/specs/hero-rotation/spec.md for why the artifacts are committed.
#
#   Usage:  bash server/scripts/derive-hero-frames.sh          # derive + report
#           bash server/scripts/derive-hero-frames.sh --check  # report only, derive nothing
#
# Hard constraints this script exists to keep honest:
#
#   * NO NEW DEPENDENCY. sharp-cli runs through `npx -y`, i.e. out of the npx cache.
#     Nothing enters any package.json or the lockfile. If npx cannot reach sharp-cli,
#     the sanctioned fallback is `sips -s format jpeg` INSIDE the byte budget -- and if
#     that does not fit, stop and ask. Do not `npm i sharp`; that is a separate,
#     unrelated confirmation (CLAUDE.md size gate).
#   * SOURCES ARE READ ONLY. server/public/illustrations/** is never written to.
#   * ONLY CANONICAL PAGES. Every source below is a file that
#     server/prisma/demo-seed-fixtures/spot-for-sunny.json actually points at. The
#     orphaned `-v3`/`-v4` revisions are NOT canonical, and page-4-v4.png in particular
#     renders Sunny as a golden retriever -- the exact defect the v2 feedback corrected.
#   * NO CROP. Sources are 1024x1024 and the hero box is 1:1 (ADR-014 decision 6), so
#     `resize N N` is a straight downscale and sharp's default `cover` fit crops nothing.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$REPO_ROOT/server/public/illustrations"
OUT_ROOT="$REPO_ROOT/server/public/hero"

# Byte budget -- must stay in lockstep with server/src/__tests__/heroFrameAssets.test.ts.
MAX_SINGLE_BYTES=$((150 * 1024))
MAX_TOTAL_BYTES=$((400 * 1024))

# Quality settings are ADR-014's, unchanged: q=72 on the 960 (q=75 encodes to ~151 KB,
# which clears the 150 KB cap by too little to survive a different sharp build), q=75 on
# the 480, --effort 6 on both (pure compression search; free at runtime on a committed
# artifact).
Q_960=72
Q_480=75
EFFORT=6

# The frame list. One line per pool frame:  <book_id>|<page_number>|<source filename>
#
# Page numbers are the book's own page numbers, because that is the key
# server/src/lib/heroPool.ts resolves an artifact by: p<page_number>-960.webp.
#
# Chosen (repo owner, 2026-08-26, after reviewing 420px renders): page 1, the dynamic
# schoolyard shot, and page 5, the wide group scene under the oak. Page 3 was rejected
# rather than merely unchosen -- a single centred figure reads as "sad kid alone" at hero
# scale. Page 4 is skipped because it IS frame 0 (the bundled bench frame), and a
# rotation that fades to the same picture is a bug report waiting to happen.
FRAMES=(
  "b2fa23cf-3156-4b89-83e7-82d98c32c8b7|1|page-1.png"
  "b2fa23cf-3156-4b89-83e7-82d98c32c8b7|5|page-5.png"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

derive() {
  local src="$1" out="$2" size="$3" quality="$4"
  npx -y sharp-cli \
    --input "$src" \
    --output "$out" \
    --format webp --quality "$quality" --effort "$EFFORT" \
    resize "$size" "$size" >/dev/null
}

bytes_of() { wc -c <"$1" | tr -d ' '; }
kb_of() { awk -v b="$1" 'BEGIN { printf "%.1f KB", b / 1024 }'; }

if [[ $CHECK_ONLY -eq 0 ]]; then
  for frame in "${FRAMES[@]}"; do
    IFS='|' read -r book_id page_number source <<<"$frame"
    src="$SRC_DIR/$book_id/$source"
    [[ -f "$src" ]] || { echo "missing source: $src" >&2; exit 1; }
    mkdir -p "$OUT_ROOT/$book_id"
    echo "deriving $book_id page $page_number from $source"
    derive "$src" "$OUT_ROOT/$book_id/p${page_number}-960.webp" 960 "$Q_960"
    derive "$src" "$OUT_ROOT/$book_id/p${page_number}-480.webp" 480 "$Q_480"
  done
fi

# Report + enforce. The authoritative gate is the Vitest suite (it runs in CI); this is
# the same arithmetic at derivation time, so an over-budget frame is caught before it is
# ever committed.
echo
echo "server/public/hero/ contents:"
total=0
over=0
while IFS= read -r file; do
  b="$(bytes_of "$file")"
  total=$((total + b))
  rel="${file#"$OUT_ROOT"/}"
  flag=""
  if [[ $b -gt $MAX_SINGLE_BYTES ]]; then
    flag="  <-- OVER the per-file cap"
    over=1
  fi
  printf '  %-52s %10s (%s bytes)%s\n' "$rel" "$(kb_of "$b")" "$b" "$flag"
done < <(find "$OUT_ROOT" -type f | sort)

echo "  ----"
printf '  %-52s %10s (%s bytes)\n' "total" "$(kb_of "$total")" "$total"
printf '  %-52s %10s\n' "budget" "$(kb_of "$MAX_TOTAL_BYTES")"

if [[ $total -gt $MAX_TOTAL_BYTES ]]; then
  echo "OVER the $(kb_of "$MAX_TOTAL_BYTES") directory budget." >&2
  over=1
fi
[[ $over -eq 0 ]] || exit 1
echo "within budget."
