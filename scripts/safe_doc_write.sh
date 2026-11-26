#!/usr/bin/env bash
#
# safe_doc_write.sh — the ONLY sanctioned way to bulk-overwrite a
# hand-maintained doc (TODO.md, BLUEPRINT.md, CHANGELOG.md, etc.) in this
# or any repo. macOS/Linux counterpart of safe_doc_write.ps1.
#
# WHY THIS EXISTS
#   incident 2026-07-24: an AI agent doing TODO.md cleanup ran an ad-hoc
#   one-liner that rebuilt the file's content and wrote it back. The
#   rebuild step silently produced empty output, and the write happened
#   anyway -- a 1465-line file with real project history was replaced with
#   0 bytes in one command, with no backup and no recent git commit to
#   fall back on. ~1000 lines of real history were permanently lost.
#
#   Two independent failures had to both be true for this to become
#   unrecoverable: (1) no backup was taken before the write, and (2) the
#   file had not been committed to git recently, so git history itself
#   was stale. This script closes both gaps on every single write.
#
# WHAT IT DOES
#   1. Refuses to run if the new content is empty, or has shrunk by more
#      than 40% of the old line count -- unless --force is passed with an
#      explicit --reason.
#   2. Copies the CURRENT file to <repo root>/.doc_backups/<name>_<timestamp>.bak
#      before touching anything.
#   3. Writes the new content.
#   4. Immediately git-adds and git-commits both the updated file and the
#      new backup snapshot, so git history is never more than one edit
#      stale.
#   5. Prunes backups older than the most recent N (default 200) for that
#      target file.
#
# USAGE
#   New content must already be written to a temp file -- never inline a
#   shell variable/heredoc as the source of truth for a multi-hundred-line
#   markdown file (that's exactly the pattern that caused the incident).
#   Write the intended file with a normal text-editor tool, save it to a
#   temp path, then call:
#
#     scripts/safe_doc_write.sh --target BLUEPRINT.md --new /tmp/new_blueprint.md
#
#   If a deliberate large cleanup legitimately shrinks the file by >40%:
#
#     scripts/safe_doc_write.sh --target BLUEPRINT.md --new /tmp/new_blueprint.md \
#       --force --reason "intentional cleanup, see chat log"
#
# NOTE ON SMALL EDITS
#   This script is for LARGE rewrites/regenerations only. A normal small
#   edit (checking off one TODO item, adding one line) should just use a
#   targeted text-editor tool directly against the file -- that's already
#   safe, it's a diff against real content, not a full-file regeneration.

set -euo pipefail

TARGET_PATH=""
NEW_CONTENT_PATH=""
FORCE=0
REASON=""
KEEP_BACKUPS=200

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET_PATH="$2"; shift 2 ;;
    --new) NEW_CONTENT_PATH="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --reason) REASON="$2"; shift 2 ;;
    --keep-backups) KEEP_BACKUPS="$2"; shift 2 ;;
    *) echo "SAFETY ABORT: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

if [ -z "$TARGET_PATH" ] || [ -z "$NEW_CONTENT_PATH" ]; then
  echo "SAFETY ABORT: --target and --new are both required. Nothing was touched." >&2
  echo "Usage: $0 --target <file> --new <temp-file-with-full-new-content> [--force --reason \"why\"]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

case "$TARGET_PATH" in
  /*) : ;;
  *) TARGET_PATH="$REPO_ROOT/$TARGET_PATH" ;;
esac

BACKUP_DIR="$REPO_ROOT/.doc_backups"

if [ ! -f "$NEW_CONTENT_PATH" ]; then
  echo "SAFETY ABORT: --new '$NEW_CONTENT_PATH' does not exist. Nothing was touched." >&2
  exit 1
fi

if [ "$FORCE" -eq 1 ] && [ -z "$REASON" ]; then
  echo "SAFETY ABORT: --force requires --reason so the shrink is explained in git history." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TARGET_EXISTED=0
OLD_COUNT=0
if [ -f "$TARGET_PATH" ]; then
  TARGET_EXISTED=1
  OLD_COUNT=$(wc -l < "$TARGET_PATH" | tr -d ' ')
fi

NEW_COUNT=$(wc -l < "$NEW_CONTENT_PATH" | tr -d ' ')

if [ "$NEW_COUNT" -eq 0 ]; then
  echo "SAFETY ABORT: new content is 0 lines. Refusing to overwrite '$TARGET_PATH' ($OLD_COUNT lines) with an empty file. This is exactly the 2026-07-24 incident's failure mode -- check whatever produced --new before retrying." >&2
  exit 1
fi

if [ "$TARGET_EXISTED" -eq 1 ] && [ "$OLD_COUNT" -gt 0 ]; then
  # Integer-only shrink check: refuse if new*100/old < 60 (i.e. >40% drop).
  RATIO=$(( NEW_COUNT * 100 / OLD_COUNT ))
  if [ "$RATIO" -lt 60 ] && [ "$FORCE" -ne 1 ]; then
    echo "SAFETY ABORT: new content is $NEW_COUNT lines vs. current $OLD_COUNT lines (a drop of more than 40%). If this is a deliberate cleanup, re-run with --force --reason \"<why>\". Nothing was touched." >&2
    exit 1
  fi
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
TARGET_NAME="$(basename "$TARGET_PATH")"
BACKUP_PATH="$BACKUP_DIR/${TARGET_NAME}_${STAMP}.bak"

if [ "$TARGET_EXISTED" -eq 1 ]; then
  cp -p "$TARGET_PATH" "$BACKUP_PATH"
  echo "Backed up current '$TARGET_NAME' ($OLD_COUNT lines) -> $BACKUP_PATH"
else
  echo "'$TARGET_NAME' did not exist yet -- no backup needed, this is a new file."
fi

cp -p "$NEW_CONTENT_PATH" "$TARGET_PATH"
echo "Wrote $NEW_COUNT lines to $TARGET_PATH"

pushd "$REPO_ROOT" > /dev/null

COMMIT_MSG="safe_doc_write: $TARGET_NAME $OLD_COUNT -> $NEW_COUNT lines ($STAMP)"
if [ "$FORCE" -eq 1 ]; then
  COMMIT_MSG="$COMMIT_MSG [FORCED SHRINK: $REASON]"
fi

if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  git add -- "$TARGET_PATH" || true
  if [ "$TARGET_EXISTED" -eq 1 ]; then
    git add -- "$BACKUP_PATH" || true
  fi
  if git commit -m "$COMMIT_MSG" > /dev/null 2>&1; then
    echo "Committed: $COMMIT_MSG"
  else
    echo "WARNING: git commit did not succeed (possibly nothing changed, or not a git repo). The file WAS still written and backed up locally -- only the git safety net is missing for this write. Commit manually." >&2
  fi
else
  echo "WARNING: $REPO_ROOT is not a git repository -- file written and backed up locally, but no git safety net exists. Consider running 'git init' and committing." >&2
fi

popd > /dev/null

# Prune old backups for this target, keep the most recent $KEEP_BACKUPS.
# List by mtime, newest first; anything past KEEP_BACKUPS gets removed.
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR/${TARGET_NAME}"_*.bak 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -gt "$KEEP_BACKUPS" ]; then
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR/${TARGET_NAME}"_*.bak | tail -n +"$((KEEP_BACKUPS + 1))" | while IFS= read -r f; do
    rm -f "$f"
  done
  echo "Pruned old backup(s), kept the most recent $KEEP_BACKUPS."
fi

echo "Done. Backup: $BACKUP_PATH"
