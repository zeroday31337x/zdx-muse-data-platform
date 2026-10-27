# Phase 2 — status and tradeoffs

## What Phase 2 adds (this milestone)

- **Meta workflows, honestly labelled:** schema inference, semantic evaluation, and repair scaffolding in `src/lib/meta-workflows.ts`. When `MODEL_API_KEY` is set, they call Muse (Standard for private, Contributor only for public/demo) with retry budgets. When it is not set, they return deterministic results and say so. No live Meta call is claimed until one succeeds.
- **Spending and retry budgets:** `src/lib/meta-budget.ts` — daily $20 / total $170 defaults (interim card + $150 grant), refused before a call, never after. Retry only transient 429/5xx/timeout, max 3 attempts, exponential backoff.
- **PostgreSQL + Prisma schema:** `prisma/schema.prisma` — Tenant, User, Session, Dataset, Record (unique datasetId+recordKey), Job with leases/checkpoints, UsageLedger, AuditLog, SchemaProposal, RepairCase. Tenant isolation is in queries, not just UI.
- **Durable worker:** `src/lib/worker.ts` — claim with FOR UPDATE SKIP LOCKED, 5-minute leases, stale-lease reclaim, checkpointing, validated pause/resume/cancel transitions, crash recovery by design.
- **Transactional composition:** `src/lib/composition-db.ts` — lock dataset row, count committed records, insert synthetic only if the final count passes, roll back the whole batch on violation. This handles concurrent augmentation, which the Phase 1 file store could not.
- **Auth:** scrypt password hashes, random session tokens (only SHA-256 stored), HttpOnly SameSite cookies, audit logging for login/export/augment actions. Auth routes require PostgreSQL and return 503 without it — they do not silently fall back to open demo mode.
- **New API routes:** `/api/auth/login|logout|me`, `/api/jobs/[id]/pause|resume|cancel`, `/api/datasets/[id]/schema`, `/api/datasets/[id]/evaluate`.

## Tradeoffs, documented

- **Postgres is not yet the default store.** Phase 1 file routes still serve the demo, because a hard switch without a migrated, tested Postgres deployment would break the working demo days before Nov 4. The DB layer is implemented and tested at unit level; the migration to DB-by-default is the next step, gated on a successful Postgres migration + integration test on the VPS.
- **Worker execution is not yet a separate process.** The state machine, leases, and transitions are implemented; a standalone worker process that claims jobs in a loop is still to be wired to `scripts/worker.mjs` in the next milestone. Do not claim a running worker until that process is started and its logs show claims.
- **Repair is scaffolding, not a full workflow.** RepairCase is in the schema and evaluation reports issues; targeted repair with human approval and re-validation is next.
- **Multimodal (image/voice/SAM) is still not routed.** It remains allowlist + pricing only, until a live test passes.

## Verification status

- Unit tests: worker transitions, spending limits, retry budgets — see `src/lib/worker.test.ts`.
- Integration test with a real Postgres DB: pending, blocked on the Postgres install finishing locally and on the VPS.
- Live Meta call: pending, blocked on billing/grant activation and a server-side key.
- GitHub push: pending, blocked on GitHub authorisation (gh not logged in, connector not connected). Local commits are ready; VPS SHA verification cannot happen until the push lands.
