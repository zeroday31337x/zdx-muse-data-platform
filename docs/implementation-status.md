# Implementation status

Updated: 2026-10-27, Phase 1 vertical slice

| Capability | State | Evidence |
|---|---|---|
| Repository instructions and public-safe capsules | IMPLEMENTED | Committed Markdown files |
| Next.js application shell | TESTED | `npm run dev` on port 3100, health 200, UI renders |
| Deterministic composition helper | TESTED | 15 unit tests pass, incl. 10,000→4,285 / 4,286 rejected, source-family dedup |
| Meta API adapter (Muse only, server-side) | IMPLEMENTED, NOT VERIFIED_WITH_META | Adapter + routing + error classification unit-tested; no live call yet (no key in this env) |
| Dataset create / ingest CSV/JSON/JSONL | TESTED | Live dev flow: 7 verified rows ingested, checksum recorded, duplicates de-duplicated |
| Analyse (deterministic, Meta when key present) | TESTED (deterministic path) | Analyse route returns deterministic report; Meta path returns clear error when unconfigured |
| Controlled augmentation within 30% cap | TESTED | 7 authentic → 3 synthetic allowed, 4th rejected with exact remaining allowance |
| Quality lab (deterministic) | TESTED | Completeness / uniqueness / missing fields reported live |
| Export policy enforcement (JSONL/CSV + manifest) | TESTED | 7+3 export succeeds at exactly 70/30; over-cap and unknown export blocked (409) |
| Records pagination (server-side cursor) | TESTED | limit/cursor round-trip verified |
| SSRF guard, CSV injection neutralisation | TESTED | Unit tests for blocked hosts, https-only, formula cells |
| Authentication and multi-tenant isolation | PLANNED | Single demo-tenant only — do not use for real customer data yet |
| Durable worker (separate process, leases, SSE) | PLANNED | Jobs are persisted, but complete synchronously for bounded batches |
| PostgreSQL + Prisma, S3, Docker Compose | PLANNED | Phase 1 uses `data/store.json`; see architecture.md for the deviation and why |
| Image / voice / SAM multimodal routes | PLANNED | Allowlist + pricing documented, routes not built, no live test |
| Production deployment | TESTED (VPS) | Oracle VPS free-vm-1: Node 22.20.0, repo in ~/zdx-muse-data-platform, `npm run build` passes, production server on port 3000, health verified via Tailscale proxy, full VPS flow verified: 7 verified → 3 synthetic → export at 70/30 (dataset ds_mvqyom4s_6s06qj). No public URL yet — access is via Tailscale, not the public internet. |
| Demo video, submission package | PLANNED | Due before 4 Nov 2026 21:00 ET |

## Phase 2 milestone (2026-10-27, in progress — not yet deployed)

| Capability | State | Evidence |
|---|---|---|
| Meta workflows (schema, evaluation) | IMPLEMENTED, NOT VERIFIED_WITH_META | `src/lib/meta-workflows.ts`, deterministic fallback labelled, Meta path gated on key |
| Spending limits + retry budgets | IMPLEMENTED, unit TESTED | `src/lib/meta-budget.ts`, `src/lib/worker.test.ts` |
| PostgreSQL + Prisma schema | IMPLEMENTED, not yet migrated | `prisma/schema.prisma`, unique record keys, tenant-scoped tables |
| Durable worker state machine | IMPLEMENTED, unit TESTED | `src/lib/worker.ts`, leases, checkpoints, pause/resume/cancel transitions |
| Transactional composition gate | IMPLEMENTED, not yet live | `src/lib/composition-db.ts`, FOR UPDATE + count + rollback |
| Auth + tenant isolation + audit | IMPLEMENTED, DB-required | `src/lib/auth.ts`, `/api/auth/*`, scrypt hashes, HttpOnly cookies |
| Schema / evaluate API routes | IMPLEMENTED | `/api/datasets/[id]/schema`, `/api/datasets/[id]/evaluate` |
| Postgres integration test | PLANNED / BLOCKED | Local apt install of PostgreSQL still running; VPS Postgres install not yet started |
| Live Meta call | PLANNED / BLOCKED | Billing/grant activation + server-side key required |
| GitHub push + VPS SHA verification | BLOCKED | gh not logged in, GitHub connector not connected; local commits ready, see Phase 2 report |
| Standalone worker process | PLANNED | State machine done, loop process not yet wired |
| Targeted repair workflow | PLANNED | RepairCase schema done, human-approved repair flow not yet built |

## Phase 1 live evidence (2026-10-27, local dev)

- `npm run typecheck` passes, `npm test` 15/15 pass, `npx eslint src/` clean except pre-existing generated-file noise on full `npm run lint`.
- End-to-end: create dataset → ingest 7 verified → augment 3 (cap) → augment 1 more rejected → export JSONL with manifest at 70/30, token-weighted 29.9% synthetic.
- Meta live status: NOT VERIFIED. The founder's dev.meta.ai team, $150 grant, and server-side key are not in this environment. Do not claim a live Meta call until one succeeds and its usage is logged.

Never mark TESTED, DEPLOYED, or VERIFIED without corresponding evidence.

## 2026-10-27 — Priorities 1–4 implementation (local: typecheck + build pass, tests 20/20; staging validation pending)

- P1 tenant isolation: session + tenant scoping on datasets, records, ingest, augment, evaluate, quality, export, schema, analyze, jobs list, and job pause/resume/cancel; cross-tenant resources return 404. Worker endpoint requires WORKER_SECRET (503 unset, 401 wrong secret). Health in DB mode reports mode only, no per-tenant counts.
- P2 worker lifecycle: claimNextJob reclaims expired leases and finalises expired CANCELLING jobs; multi-batch ingest requeues atomically (no 5-minute stall); lease-guarded checkpoint/finish/requeue return 409 STALE_LEASE for stale workers; QUEUED/PAUSED cancel is immediate, RUNNING cancel finalises after the current batch.
- P3 PostgreSQL integration: DB-backed dataset creation/list/get, records (offset pagination), ingest (chunked createMany, skipDuplicates), augment (transactional gate + createMany), evaluate, quality, export (gated, manifest + caveat), schema (proposal persisted), analyze (UsageLedger on Meta success). UI: login/logout, mode indicator, jobs list with pause/resume/retry/cancel, export download as a file.
- P4 repair + multimodal: repair cases (create never changes data; approve applies repairedData in a transaction, records repairCaseId in meta, provenance unchanged; reject marks rejected) with UI in DB mode. Multimodal endpoint is gated 503 MULTIMODAL_NOT_OPERATIONAL — no verified endpoint functions, never a simulated result.
- Still NOT verified: live Meta inference (no key in this environment, no paid call made), staging validation of the new code, and production promotion. File/demo mode remains demo-only.
