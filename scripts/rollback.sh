#!/usr/bin/env bash
# Roll back the VPS production server to a previous deployed SHA.
# Usage: ./scripts/rollback.sh [SHA]
#   With no SHA, uses the previous_sha from the latest entry in
#   $HOME/zdx-deploy-history.jsonl (or $HOME/zdx-platform-version.json).
# This is an incident-only path. A rollback checkout is temporary:
# fix forward on GitHub main as soon as possible, then deploy main again.
# GitHub main remains authoritative; this script never commits.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/node/bin:$PATH"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # Roll back to the last actually different deployed version, not to
  # the previous_sha of the latest entry: a deploy that pulled nothing
  # records previous_sha == new_sha == current HEAD, which would be a
  # no-op rollback. Scan history newest-first for a new_sha that is
  # not the current HEAD.
  CURRENT="$(git rev-parse HEAD)"
  if [ -f "$HOME/zdx-deploy-history.jsonl" ]; then
    TARGET="$(tac "$HOME/zdx-deploy-history.jsonl" | sed -n 's/.*"new_sha":"\([^"]*\)".*/\1/p' | while read -r sha; do
      if [ "$sha" != "$CURRENT" ] && [ "$sha" != "tarball-pre-git" ]; then echo "$sha"; break; fi
    done)"
  fi
  if [ -z "$TARGET" ] && [ -f "$HOME/zdx-platform-version.json" ]; then
    TARGET="$(sed -n 's/.*"previous_sha":"\([^"]*\)".*/\1/p' "$HOME/zdx-platform-version.json")"
  fi
fi
if [ -z "$TARGET" ]; then
  echo "REFUSING: no target SHA given and no previous SHA found in deploy history." >&2
  echo "Usage: ./scripts/rollback.sh <previous-commit-sha>" >&2
  exit 1
fi
if ! git cat-file -e "$TARGET^{commit}" 2>/dev/null; then
  echo "REFUSING: $TARGET is not a commit in this checkout. Fetch first." >&2
  exit 1
fi
if [ -n "$(git diff --numstat)" ] || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "REFUSING: working tree has content changes. VPS must not be edited directly." >&2
  git status --short >&2
  exit 1
fi

PREV_SHA="$(git rev-parse HEAD)"
echo "Rolling back from $PREV_SHA to $TARGET"
git checkout "$TARGET"

npm install
npm run prisma:generate || echo "WARNING: prisma generate failed; DB routes will report PRISMA_CLIENT_NOT_GENERATED"
npm run typecheck
npm test
npm run build

# Next.js rewrites next-env.d.ts on every build; restore the tracked
# version so the tree stays clean for the next deploy's dirty check.
git checkout -- next-env.d.ts 2>/dev/null || true

# Match the process name only (pgrep -x), never a full-command-line
# pattern, which can match the invoking shell itself.
OLD_PIDS=$(pgrep -x "next-server" || true)
if [ -n "$OLD_PIDS" ]; then
  echo "Stopping old server: $OLD_PIDS"
  kill $OLD_PIDS || true
  sleep 2
fi

setsid npm run start -- -p 3000 > "$HOME/zdx-platform.log" 2>&1 < /dev/null &
sleep 5
if curl -sf http://localhost:3000/api/health > /dev/null; then
  echo
  echo "Rolled back to $(git rev-parse --short HEAD)"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"timestamp":"%s","previous_sha":"%s","new_sha":"%s","branch":"%s","rollback":true,"status":"ok"}\n' \
    "$ts" "$PREV_SHA" "$(git rev-parse HEAD)" "$(git rev-parse --abbrev-ref HEAD)" >> "$HOME/zdx-deploy-history.jsonl"
  printf '{"sha":"%s","previous_sha":"%s","timestamp":"%s","rollback":true,"status":"ok"}\n' \
    "$(git rev-parse HEAD)" "$PREV_SHA" "$ts" > "$HOME/zdx-platform-version.json"
else
  echo "HEALTH CHECK FAILED after rollback. Server left running for diagnosis." >&2
  echo "Previous SHA before this rollback was $PREV_SHA; restore from the tarball backup if the git checkout cannot be recovered." >&2
  exit 1
fi
