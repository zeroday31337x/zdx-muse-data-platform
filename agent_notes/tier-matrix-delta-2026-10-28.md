# Tier matrix delta — 2026-10-28 (coord/compliance, tier implementation)

Scope: ONLY the tier-affected rows of `contract-to-code-traceability-matrix.md`
(39 rows, as of 5bf3fef). No other row is rewritten here. This delta is a
worktree-local record for the parent to apply to the goals matrix; the
goals matrix itself was not edited from this worktree.

Headline: **no status movements.** Totals stay PASS 5 / FAIL 0 /
BLOCKED 22 / NOT TESTED 12. The tier work strengthens code mechanisms and
adds pure-logic tests, but every tier row is still blocked on an unapproved
value, an unexecuted migration, or unrun route/DB behaviour — so no row
moves to PASS, and no BLOCKED row clears.

## A3 — Meta-call gating (NOT TESTED → NOT TESTED, evidence updated)

What changed in code:
- File-mode (no-DB) Meta bypass CLOSED: analyze file branch is now
  deterministic-only (it previously called Meta, including Contributor for
  public demo data, with no entitlement, allowlist, consent, budget,
  ceiling, or reservation check); evaluate and schema file branches now
  pass `{ metaAllowed: false }` to `evaluateRecords` / `inferSchema`.
  The DB paths are unchanged and remain the only Meta paths, gated by
  `resolveMetaCall` (entitlement → data class → tier allowlist →
  Contributor eligibility/consent → price/Wonder → budget).
- `/api/models` now labels pricing verification: text verified; image /
  voice / SAM explicitly unverified placeholders, rejected by the resolver
  with `MODEL_PRICE_UNVERIFIED`, never billed as free.
- New `src/lib/tier-spec.ts` (single source of truth) + 18 pure tests in
  `src/lib/tier-spec.test.ts` (all passing; suite total now 167 passed /
  8 skipped, the 8 being DB-integration NOT RUN).

Why NOT TESTED stays: route/DB behaviour is still untested (no staging
deployment, no live Meta beyond the single prior staging analyze), and
Meta-backed augment is still NOT built (Option A hook only).

## A6 — Free/trial export allowance: NONE in v1 (NOT TESTED → NOT TESTED, evidence updated)

What changed in code:
- Restricted-export rule re-verified against the shared contract §3d/§1A
  and found MATCHING (restricted/incomplete → export denied; past_due →
  existing-only; canceled/unpaid → export-out only; paused → read only).
  No discrepancy found on the DB export gate; no code change needed there.
- Export file-mode branch now returns 503 `DATABASE_NOT_CONFIGURED`
  instead of a demo-file export, per shared-contract item 9 ("export
  without a DB must yield 503, not a demo-file export"). Demo reads
  (records/quality) are unchanged; demo data must never be presented as
  an entitled export.

Why NOT TESTED stays: route/DB behaviour untested; B10 export-out is the
separate, single exception and is itself NOT TESTED at DB level.

## B1 — Restricted record limit (BLOCKED → BLOCKED, evidence updated)

What changed in code:
- Ingest cap strengthened: the check is now tenant-wide
  `existing + incoming > cap` (409 `QUOTA_EXCEEDED`), replacing the
  previous `existing >= cap` check that let a tenant just under the cap
  overshoot by up to one call. Duplicates count toward the cap (check
  runs before dedup, fail-closed).
- Augment gains the record-cap check it previously lacked entirely:
  pre-check + in-transaction re-check (tenant-wide), 409
  `QUOTA_EXCEEDED`, job FAILED on breach.
- Worker/run gains an execution-time cap check for ingest batches
  (remaining rows) and augment jobs (payload count): over-cap jobs FAIL
  with `QUOTA_EXCEEDED` (caps only grow, so retrying cannot help),
  rather than pausing.
- Values now live in one place: `src/lib/tier-spec.ts` — restricted
  5,000 PROPOSED, professional 100,000 PROPOSED — with drift-guard tests
  against `FREE_TIER_LIMITS_PROPOSED.recordsPerTenant` and
  `PROFESSIONAL_RECORD_LIMIT_STAGING_TEST`.

Why BLOCKED stays: the restricted 5,000 remains an UNAPPROVED proposed
safety value (not a finalized tier limit), the professional 100,000
remains PROPOSED and capacity-UNVERIFIED, and DB-level behaviour is
NOT RUN.

## B3 — Concurrency caps (BLOCKED → BLOCKED, evidence updated)

What changed in code:
- No concurrency VALUE changed (1 restricted / 2 entitled remain
  PROPOSED safety values, enforced at augment creation + worker claim).
- Jobs resume is now gated as new work (entitlement + grace check):
  a canceled/unpaid/paused or grace-expired tenant cannot resume a job.
  Pause/cancel stay owner-allowed (they only reduce work); a resumed job
  is still revalidated at worker claim time.
- Values recorded in `src/lib/tier-spec.ts` (restricted 1 PROPOSED,
  professional 2 PROPOSED) with tests.

Why BLOCKED stays: approved per-tier caps are still a blocked input, and
DB concurrency behaviour is NOT RUN.

## SEQ-4 — Model-per-tier amendment, AS REVISED (BLOCKED → BLOCKED, evidence updated)

What changed in code: the tier model now has a single source of truth
(`src/lib/tier-spec.ts`) consistent with the resolver/allowlist (restricted
text allowlist empty, Contributor disabled; professional text
[muse-spark-1.3, muse-spark-1.3-contributor], Contributor gated on
eligibility + consent + public data class; Wonder always rejected;
no substitution).

Why BLOCKED stays: C2 budget mapping still unsigned, the Professional
per-job cap still undefined (BLOCKED input), Meta augment still unbuilt,
and `basic` remains unmapped (never silently mapped to professional).

## Gap with no matrix row: storage quotas (flagged, no row invented)

The tier spec records storage quotas (restricted 250 MB PROPOSED,
professional 5 GB PROPOSED) but there is NO enforcement mechanism and the
DEFINITION itself is unconfirmed (DB rows only vs uploads + export
artifacts + backups). The upload-total ledger (`totalUploadBytes`, B4)
is uploads only and must not be conflated with storage. No matrix row
currently tracks storage; this delta does not invent a 40th row — the
parent should decide at the next matrix revision whether storage gets
its own BLOCKED row.

## Explicitly NOT changed by the tier work (left for their own rows)

B2 (rate values), B4 (50 MB value + migration execution), B5 (ingest
batch value), B6 (registration rate value), B9 (reconciliation schedule),
C1 (error-table signing), C2 (budget mapping), C5 (hard-ceiling values),
C8 (Stripe test inputs), C9 (worker secret/procedure), A12 (staging
Cognito callbacks), Gate 6A append decision. No schema change was needed
by the tier work, so no new migration file and no Gate 6A append note
were produced.
