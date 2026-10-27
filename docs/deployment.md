# Deployment — GitHub is authoritative, VPS runs it

Rule, set 2026-10-27 by the founder:

- **GitHub `main` on `zeroday31337x/zdx-muse-data-platform` is the only authoritative source for the build.**
- **Oracle VPS free-vm-1 is the deployment and running infrastructure, not a source of truth.**
- No tarball, scp, or hand-edited file on the VPS is a deployment. If it is not on GitHub main, it is not deployed.
- Never edit code directly in `~/zdx-muse-data-platform` on the VPS. Edit locally (or in a branch), push to GitHub, then deploy on the VPS by pulling.

## Layout on the VPS

- Running app: `~/zdx-muse-data-platform` — a git checkout of origin/main, production server on port 3000.
- Runtime data: `~/zdx-muse-data-platform/data/store.json` — git-ignored, never committed, never copied from GitHub.
- Secrets: environment variables on the VPS only, never in git. There is no `.env` in the repo.
- Node: `~/node` (Node 22 LTS, aarch64), on PATH in `~/.profile`.

## Deploy (VPS, after a push to GitHub main)

```bash
cd ~/zdx-muse-data-platform
git status --short          # must be clean; if not, stop — the VPS was edited directly
git pull --ff-only origin main
export PATH=$HOME/node/bin:$PATH
npm install
npm run typecheck
npm test
npm run build
# restart the production server on port 3000
```

Or run the checked-in script, which does the same steps and refuses on a dirty tree:

```bash
./scripts/deploy.sh
```

The script restarts the server by starting a new `next start` on port 3000 after stopping the old one. It does not delete `data/`.

## Rollback

```bash
cd ~/zdx-muse-data-platform
git log --oneline -5
git checkout <previous-commit>   # only to stop a bad deploy; then fix forward on GitHub main
./scripts/deploy.sh              # after checking out a tagged/known commit, re-pull is skipped by design — see script
```

In practice, prefer fixing forward: revert or fix on GitHub main, push, and deploy again. A VPS-side checkout that is not on main is a temporary incident state, not a new source of truth.

## One-time migration from the tarball install (2026-10-27)

The first VPS install was copied by tarball before this rule was set. That install is not git-tracked and must not be kept as the deployment. After the Phase 1 commit is pushed to GitHub main, run the migration once:

```bash
git clone https://github.com/zeroday31337x/zdx-muse-data-platform.git /tmp/zdx-migrate
bash /tmp/zdx-migrate/scripts/migrate-to-git-deploy.sh
```

It stops the old server, moves the old directory to a timestamped backup, clones main to `~/zdx-muse-data-platform`, restores `data/` (runtime data, never source), installs, tests, builds, and restarts on port 3000. After that, `scripts/deploy.sh` is the only deploy path.

## What must never happen

- Editing files on the VPS and calling that the build.
- Copying a local tarball over the VPS checkout — it breaks git tracking and hides provenance.
- Committing `data/`, `.env`, keys, or customer data.
- Deploying a branch other than main without a recorded, founder-approved exception.
