#!/usr/bin/env bash
# Deploy ZDX Muse Data Platform from GitHub main — VPS only.
# GitHub is authoritative; this script only pulls, builds, and restarts.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/node/bin:$PATH"

if [ -n "$(git status --porcelain)" ]; then
  echo "REFUSING: working tree is dirty. VPS must not be edited directly." >&2
  git status --short >&2
  exit 1
fi

# If DEPLOY_REF is set, it is an incident rollback only — see docs/deployment.md.
# Normal deploys always pull origin/main.
if [ -n "${DEPLOY_REF:-}" ]; then
  echo "WARNING: deploying ref $DEPLOY_REF instead of origin/main (rollback only)"
  git fetch origin
  git checkout "$DEPLOY_REF"
else
  git pull --ff-only origin main
fi

npm install
# Prisma 7 generates the client into src/generated/ (git-ignored). Generate
# before typecheck/build so DB routes resolve the generated client at runtime.
# Generate does not need a live database connection.
npm run prisma:generate || echo "WARNING: prisma generate failed; DB routes will report PRISMA_CLIENT_NOT_GENERATED"
npm run typecheck
npm test
npm run build

# Restart production server on port 3000. Stop the old next-server, not this script.
# Use a pattern that cannot match this script's own command line.
OLD_PIDS=$(pgrep -f "next-server" || true)
if [ -n "$OLD_PIDS" ]; then
  echo "Stopping old server: $OLD_PIDS"
  kill $OLD_PIDS || true
  sleep 2
fi

setsid npm run start -- -p 3000 > "$HOME/zdx-platform.log" 2>&1 < /dev/null &
sleep 5
curl -sf http://localhost:3000/api/health
echo
echo "Deployed $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
