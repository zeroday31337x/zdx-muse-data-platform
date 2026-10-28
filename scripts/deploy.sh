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

# Next.js rewrites next-env.d.ts on every build. Restore the tracked
# version so the tree stays clean for the next deploy's dirty check.
git checkout -- next-env.d.ts 2>/dev/null || true

# Restart production server on port 3000 only. Scope by listening port,
# never by process name alone: pgrep -x next-server would also match the
# staging server on port 3001, and a -f pattern can match the invoking
# shell itself and kill the deploy. The health route returns mode and
# inference only, no SHA, so a health pass alone cannot prove which
# build is serving — that is how earlier deploys falsely recorded "ok"
# while the old server kept serving and the new build died EADDRINUSE.
# So: wait until port 3000 is actually free before starting, then verify
# the listener after the restart is a new PID, not an old one.
# port_pids takes the port as $1 and returns ONLY that port's listeners.
# A previous version omitted the port filter and returned every listener,
# so a production deploy killed the staging server on port 3001 too.
# Never drop the ":$1 " filter.
port_pids() {
  ss -ltnp 2>/dev/null | grep ":$1 " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
}
port_free() {
  ! ss -ltn 2>/dev/null | grep -q ':3000 '
}
OLD_PIDS=$(port_pids 3000 || true)
if [ -n "$OLD_PIDS" ]; then
  echo "Stopping old server on port 3000: $OLD_PIDS"
  kill $OLD_PIDS || true
  for _ in $(seq 1 30); do
    if [ -z "$(port_pids 3000 || true)" ] && port_free; then
      break
    fi
    sleep 1
  done
  if [ -n "$(port_pids 3000 || true)" ] || ! port_free; then
    echo "FAILED: port 3000 still in use after 30s; not starting a new server." >&2
    record_deploy "$(git rev-parse HEAD)" "health-failed" false
    exit 1
  fi
fi

setsid npm run start -- -p 3000 > "$HOME/zdx-platform.log" 2>&1 < /dev/null &
HEALTH_OK=""
for _ in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health > /dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
NEW_PIDS=$(port_pids 3000 || true)
STALE_PID=""
for pid in $NEW_PIDS; do
  for old in $OLD_PIDS; do
    if [ "$pid" = "$old" ]; then
      STALE_PID="$pid"
    fi
  done
done
if [ -n "$HEALTH_OK" ] && [ -n "$NEW_PIDS" ] && [ -z "$STALE_PID" ]; then
  echo
  echo "Deployed $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD) (new server PID: $NEW_PIDS)"
  record_deploy "$(git rev-parse HEAD)" "ok" false
else
  if [ -n "$STALE_PID" ]; then
    echo "HEALTH CHECK FAILED: port 3000 is still served by old PID $STALE_PID, not a new build." >&2
  else
    echo "HEALTH CHECK FAILED after deploy. Server left running for diagnosis." >&2
  fi
  echo "Roll back with: bash scripts/rollback.sh $PREV_SHA" >&2
  record_deploy "$(git rev-parse HEAD)" "health-failed" false
  exit 1
fi
