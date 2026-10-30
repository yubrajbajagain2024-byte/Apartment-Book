#!/bin/sh
# A full backup of production every day, from the owner's Mac, with the token the Supabase CLI keeps in the keychain
# (`npx supabase login`). Keeps the last 14 daily backups. Installed as a launchd agent:
#
#   cp scripts/launchd/com.unibuzz.backup.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.unibuzz.backup.plist     # once; `bootout` removes it
#   launchctl kickstart -k gui/$(id -u)/com.unibuzz.backup                               # run it now
#
# The plist runs it at 09:00 local time; a Mac asleep then runs it when it wakes. Its log: ~/CampConnect-backups/backup.log.
# A full backup holds students' data and password hashes: the folder is readable by the owner only, and never leaves
# this Mac (docs/decisions.md).
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/CampConnect-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH BACKUP_DIR
SUPABASE_ACCESS_TOKEN="$(security find-generic-password -s "Supabase CLI" -w)"
export SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-dskbzoqreandwwpxiplh}"
export SUPABASE_PROJECT_REF
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup starting"
node "$REPO/scripts/backup.mjs" "daily-$(date -u '+%H%M')" --full
# Prune: daily folders older than KEEP_DAYS go; backups taken by hand (other labels) stay.
find "$BACKUP_DIR" -maxdepth 1 -type d -name '*-daily-*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup done"
