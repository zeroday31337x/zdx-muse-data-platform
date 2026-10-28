# Branch 2 — Model-per-tier amendment (revised) + core reconciliation

Branch `coord/integration` (model-tier commit `2968ca7`, merge commit
`eac3df4`). Local-only: NOT merged, NOT pushed, NOT deployed, NO
migration applied to any server database.

## Implemented (model tiers)

- **Pure resolver** (`src/lib/model-resolver.ts`): gate order
  entitlement → data class → tier allowlist → Contributor
  eligibility/consent → price verification/Wonder → budget.
  **Explicit rejection, no silent substitution**: a rejected model
  returns `resolvedModel = null`, `modelResolutionReason = 'rejected'`
  and a `modelRejectionCode`; the withdrawn `data-class-override` /
  `tier-fallback` / `budget-fallback` resolutions are never produced.
  A labelled deterministic result is `none-deterministic`, never
  presented with a model name or Meta cost/usage.
- **Server-side tier allowlist** (`src/lib/tier-allowlist.ts`):
  basic/legacy = Standard + Contributor; restricted = Contributor
  only (public data only, with eligibility + consent); past_due/
  unpaid/canceled/paused/incomplete* = empty (no new Meta).
  Per-job caps are PROPOSED ($2.00 entitled, $0.10 restricted).
  Hard ceiling from env (`HARD_META_*`); unset → existing
  meta-budget caps as PROPOSED fallback (explicit value still a
  blocker). Wonder always `MODEL_DISABLED_WONDER` in this branch
  (no verified Wonder pricing). SAM/image/voice always
  `MODEL_PRICE_UNVERIFIED` (never $0, never in any allowlist value).
- **Requested-model determination** (§10.4): job preference >
  tenant preference > tier default, recorded AS `requestedModel`.
  `Tenant.modelPreference` is a choice, validated against the
  allowlist on write AND on every call; outside-allowlist writes are
  a generic 400 that does not enumerate the allowlist.
- **Contributor eligibility + consent**: `ContributorEligibility`
  record (operator-granted, Branch 3) is the source of truth — no
  Tenant boolean cache. `DatasetContributorConsent` is attested by a
  tenant admin for their own dataset, scope `public-demo-only`;
  attesting does NOT grant eligibility. The resolver requires BOTH
  at call time.
- **Wiring**: analyze/evaluate/schema Meta paths resolve through
  `resolveMetaCall` (replacing data-class-only selection;
  `modelForDataClass` survives only as the data-class layer inside
  workflows when no override is passed). Analyze UsageLedger rows
  now carry `datasetId`, `dataClass`, `planSnapshot`,
  `contributorConsentId`; invariant: `UsageLedger.model` equals the
  resolved model, which equals `requestedModel`.
- **Routes**: `GET /api/account/models` (separate authenticated
  endpoint; public `/api/models` UNCHANGED), `PATCH
  /api/account/model-preference` (tenant admin), `POST
  /api/account/datasets/[id]/contributor-consent` (tenant admin,
  own dataset). Tenant UI gains a models panel (allowed/default/
  preference + Contributor eligibility note).
- **Schema / migration (NOT applied)**: `20261028020000_model_tiers`
  (additive): `Tenant.modelPreference`, `ContributorEligibility`,
  `DatasetContributorConsent`, Job requested/resolved/reason/
  rejection/dataClass (the single combined Job change-set per
  Checkpoint 3), UsageLedger audit linkage fields. `UsageLedger.costUsd`
  stays confirmed-only.

## Core reconciliation (merge `eac3df4`)

- Merged `core-platform-hardening` (`eb2d162` + `d475569`) into the
  integration line WITHOUT editing the core branch. Exactly ONE
  content conflict (ingest route imports), resolved by keeping both
  imports. Verified post-merge: worker/run keeps BOTH Branch 1
  entitlement revalidation (`ENTITLEMENT_REVOKED` pause) and core
  lease guards; ingest keeps BOTH billing batch/quota checks and
  core content-length check; `composition-db.ts` and `meta.ts`
  merged cleanly (Branch 1 had deliberately avoided editing them).
- Core's mocked tests are preserved as mocked tests; nothing mocked
  is presented as live evidence. DB-level worker recovery (two
  concurrent ticks, real Postgres lease takeover) and the groupBy
  query remain staging-validation items.

## Gates (local only)

- Branch 2 pre-merge: typecheck clean, tests 65/65 (40 + 25 new),
  build pass.
- Post-merge: typecheck clean, tests 90/90 (40 + 25 + 25 core),
  build pass.
- NOT evidenced locally (no local Postgres): route-level DB
  behaviour, including resolver DB reads (eligibility/consent) and
  the merged worker/run path. Staging items, not claims.
