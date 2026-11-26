#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TODO_FILE="$PROJECT_DIR/TODO.md"
ARCHIVE_FILE="$PROJECT_DIR/TODO_ARCHIVE.md"

APPLY=0
if [[ "${1-}" == "-Apply" ]]; then
  APPLY=1
fi

if [[ ! -f "$TODO_FILE" ]]; then
  echo "Error: $TODO_FILE not found."
  exit 1
fi

TMP_ACTIVE="/tmp/todo_active_$$.md"
TMP_ARCHIVE="/tmp/todo_archive_$$.md"

> "$TMP_ACTIVE"
> "$TMP_ARCHIVE"

awk '
BEGIN {
  archive_mode = 0
  active_file = "'"$TMP_ACTIVE"'"
  archive_file = "'"$TMP_ARCHIVE"'"
  archived_count = 0
}
{
  if ($0 ~ /^## /) {
    if ($0 ~ /^## .* (완료|폐기|취소)/) {
      archive_mode = 1
      archived_count++
    } else {
      archive_mode = 0
    }
  }

  if (archive_mode) {
    print $0 >> archive_file
  } else {
    print $0 >> active_file
  }
}
END {
  print archived_count > "'"/tmp/archived_count_$$"'"
}
' "$TODO_FILE"

ARCHIVED_COUNT=$(cat "/tmp/archived_count_$$")

if [ "$ARCHIVED_COUNT" -gt 0 ]; then
  if [ "$APPLY" -eq 1 ]; then
    echo "Found $ARCHIVED_COUNT completed tasks. Archiving..."
    
    # Append to ARCHIVE_FILE safely
    TMP_NEW_ARCHIVE="/tmp/todo_new_archive_$$.md"
    if [ -f "$ARCHIVE_FILE" ]; then
      cat "$ARCHIVE_FILE" > "$TMP_NEW_ARCHIVE"
      echo "" >> "$TMP_NEW_ARCHIVE"
    fi
    cat "$TMP_ARCHIVE" >> "$TMP_NEW_ARCHIVE"
    
    # Update TODO.md
    "$SCRIPT_DIR/safe_doc_write.sh" --target TODO.md --new "$TMP_ACTIVE" --force --reason "auto_archive_todo"
    
    # Update TODO_ARCHIVE.md
    "$SCRIPT_DIR/safe_doc_write.sh" --target TODO_ARCHIVE.md --new "$TMP_NEW_ARCHIVE" --force --reason "auto_archive_todo appended"
    
    rm -f "$TMP_NEW_ARCHIVE"
  else
    echo "Found $ARCHIVED_COUNT completed tasks. Run with -Apply to move them."
  fi
else
  echo "No completed tasks to archive."
fi

rm -f "$TMP_ACTIVE" "$TMP_ARCHIVE" "/tmp/archived_count_$$"
