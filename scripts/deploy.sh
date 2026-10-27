#!/usr/bin/env bash
# Deploy ZDX Muse Data Platform from GitHub main — VPS only.
# GitHub is authoritative; this script only pulls, builds, and restarts.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/node/bin:$PATH"

# Refuse on content changes or untracked files, but allow mode-only
# changes (e.g. chmod +x after a pull): git diff --numstat is empty for
# mode-only changes, so a mode change alone does not block a deploy.
if [ -n "$(git diff --numstat)" ] || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "REFUSING: working tree has content changes. VPS must not be edited directly." >&2
  git status --short >&2
  exit 1
fi

# Versioning: the deployed version is exactly the git HEAD after this
# script runs. It is recorded outside the repo (so the tree stays clean)
# in $HOME/zdx-deploy-history.jsonl (append-only) and
# $HOME/zdx-platform-version.json (current version only). GitHub main is
# authoritative; a VPS checkout that is not on main is a temporary
# incident state, not a new source of truth.
PREV_SHA="$(git rev-parse HEAD)"
HISTORY_FILE="$HOME/zdx-deploy-history.jsonl"
VERSION_FILE="$HOME/zdx-platform-version.json"
record_deploy() {
  local new_sha="$1" status="$2" rollback="${3:-false}"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"timestamp":"%s","previous_sha":"%s","new_sha":"%s","branch":"%s","rollback":%s,"status":"%s"}\n' \
    "$ts" "$PREV_SHA" "$new_sha" "$(git rev-parse --abbrev-ref HEAD)" "$rollback" "$status" >> "$HISTORY_FILE"
  printf '{"sha":"%s","previous_sha":"%s","timestamp":"%s","rollback":%s,"status":"%s"}\n' \
    "$new_sha" "$PREV_SHA" "$ts" "$rollback" "$status" > "$VERSION_FILE"
}

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
if curl -sf http://localhost:3000/api/health > /dev/null; then
  echo
  echo "Deployed $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
  record_deploy "$(git rev-parse HEAD)" "ok" false
else
  echo "HEALTH CHECK FAILED after deploy. Server left running for diagnosis." >&2
  echo "Roll back with: ./scripts/rollback.sh $PREV_SHA" >&2
  record_deploy "$(git rev-parse HEAD)" "health-failed" false
  exit 1
fi
