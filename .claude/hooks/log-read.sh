#!/usr/bin/env bash
# PreToolUse:Read logger — appends tab-delimited (timestamp, file_path) records to read.log
set -euo pipefail

LOG_FILE="$(dirname "$0")/read.log"
INPUT="$(cat)"
FILE_PATH=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch(e){}})')
TIMESTAMP=$(date '+%Y-%m-%dT%H:%M:%S%z')
printf '%s\t%s\n' "$TIMESTAMP" "$FILE_PATH" >> "$LOG_FILE"
