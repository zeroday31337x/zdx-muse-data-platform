# Independent QA and acceptance framework

## Purpose
A contract-first test suite runnable **before** a live Meta API, working database, or finished app. This suite is not a substitute for integration, security, or production verification. It is additive to Muse's implementation.

## Workflow and evidence
| Gate | Scope | Runs | Release policy |
|---|---|---|---|
| Q0 | Static QA contracts and fixture integrity | Every push/PR | Block on failure |
| Q1 | Typecheck/lint/unit tests | Every push/PR once app dependencies stabilize | Block on failure |
| Q2 | Database migration, tenant and lineage integration | Isolated disposable Postgres | Block on failure |
| Q3 | Worker crash/resume and concurrency | Disposable worker + Postgres | Block on failure |
| Q4 | Live Meta model invocation and budget behavior | Secrets-controlled opt-in CI | Block claiming Meta-ready |
| Q5 | Browser journey: ingest → approve → process → validate → export | Staging | Block feature release |
| Q6 | Production staging hardening: backups, restore, security, latency | Before submission | Block deployment claim |
| Q7 | Competition/legal evidence: original work, source rights, license, demo, submission form | Before submission | Human sign-off |

Green Q0 does NOT mean Q1–Q7 passed.

## Acceptance journeys
1. **Real-data-first CSV:** upload licensed authentic input; parser and schema; Meta semantic classification; traceable output; optional synthetic contribution; export manifest.
2. **Document extraction:** extract from licensed document, source citations to evidence, uncertainty and conflicting values visible.
3. **Training tool trajectories:** source-grounded transformations, valid tool-call schema, leakage scan, governed augmentation.
4. **Commerce real-data processing:** import legitimate product/order fixtures; check calculations, deduplication, joins, transactional correctness. Never present fictitious transactions as historical truth.
5. **Failure recovery:** worker abort in inference window, after response, before commit, after commit; record exactly once, charge accounting transparent.
6. **Tenant security:** authorization and all object/record paths fail closed across tenants.

## Test taxonomy and minimum checks
**Composition:** 70/30 exact boundary, 1 above, unknown, empty, derived duplicates, record and token ratios, multi-version merges and transaction races. Ratio denominator is final output.
**Provenance:** checksum and source/license evidence, reimports and transformations cannot launder synthetic into authentic.
**Ingestion:** malicious ZIP/paths, MIME discrepancy, decompression ceiling, CSV formula, large files, malformed PDF, XLSX external relationships, hostile markdown instructions, URL SSRF with redirects.
**Model:** invalid schema, refusal, partial streaming, token usage absent, account inaccessible, unauthorized 401, payment 402, 403, rate-limit 429, 5xx, hanging request, canceled job, disabled model.
**Processing:** duplicate queue delivery, lease fencing, restart replay, cold start, cancellation race, monotonically committed progress, export abort and cleanup.
**Security:** cross-tenant ID guessing, tenant header spoofing, admin role escalation, object signed URL scope, session/CSRF controls, leaked env vars/logs.
**Operations:** full disk, low memory, PostgreSQL restart, object store outage, backup/restore, deployed SHA vs GitHub, ARM64 build.
**Quality:** reference holdout data, rejection samples, drift, near-duplicates, privacy leaks, measured coverage and judge calibration.

## Evidence requirements
Every gate produces a SHA, timestamp, runner/environment, commands, redacted results and failures. Use docs/qa/RELEASE_CHECKLIST.md to track actual status; blank means not verified.
Disable outbound model calls in normal CI. No real secrets, customer documents, production data, or live credentials in fixtures.

## Implementation mapping
Q0 is implemented now with Node's built-in test runner and JSON fixture specification. Q1 may already have Vitest in the app; do not replace Muse's tests. Q2–Q7 are explicit contracts for adding tests *after* routes and schemas are available. Never fabricate API paths or model results.
