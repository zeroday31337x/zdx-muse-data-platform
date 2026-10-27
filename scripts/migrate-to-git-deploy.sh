#!/usr/bin/env bash
# One-time migration: VPS tarball install -> GitHub-authoritative git checkout.
# Run AFTER the Phase 1 commit is pushed to GitHub main.
# This script is meant to be fetched from a fresh clone, not from the old dir:
#   git clone https://github.com/zeroday31337x/zdx-muse-data-platform.git /tmp/zdx-migrate
#   bash /tmp/zdx-migrate/scripts/migrate-to-git-deploy.sh
# It preserves runtime data (data/) and never commits it.
set -euo pipefail
export PATH="$HOME/node/bin:$PATH"
APP="$HOME/zdx-muse-data-platform"
BACKUP="$HOME/zdx-muse-data-platform.tarball-backup-$(date +%Y%m%d-%H%M%S)"
TMPCLONE="/tmp/zdx-migrate-clone"

echo "Stopping old server (next-server only)..."
pkill -f "next-server" || true
sleep 2

echo "Backing up $APP to $BACKUP"
mv "$APP" "$BACKUP"

echo "Cloning GitHub main to $APP"
git clone https://github.com/zeroday31337x/zdx-muse-data-platform.git "$APP"
cd "$APP"

if [ -d "$BACKUP/data" ]; then
  echo "Restoring runtime data/ (git-ignored, not source)"
  cp -r "$BACKUP/data" "$APP/data"
fi

npm install
npm run typecheck
npm test
npm run build
setsid npm run start -- -p 3000 > "$HOME/zdx-platform.log" 2>&1 < /dev/null &
sleep 5
curl -sf http://localhost:3000/api/health
echo
echo "Migrated. Old tarball install is at $BACKUP"
echo "From now on, deploy only with ./scripts/deploy.sh (git pull from main)"
