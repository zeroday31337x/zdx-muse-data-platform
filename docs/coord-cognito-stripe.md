# Branch 1 — Cognito + Stripe (coord/cognito-stripe)

Local-only implementation branch off `f17fea5`. NOT merged, NOT pushed,
NOT deployed, NO migration applied to any server database. The migration
SQL in `prisma/migrations/20261028010000_cognito_stripe/` is a reviewed
artifact for the separate Gate 6B per-migration review.

## Implemented (tested, see src/lib/coord1.test.ts)
- Prisma schema (contract §1): `SubscriptionStatus` enum, Tenant Stripe
  fields, nullable `User.passwordHash`, `authProvider`, `cognitoSub`
  (unique), `User.disabledAt`, `Session.provider` + `refreshTokenHash`
  (record only), `TenantInvitation`, `StripeEvent`, `SpendReservation`.
- Cognito hosted-UI auth: authorize (login/signup/forgot), PKCE S256,
  callback with ID-token JWKS verification, transactional
  provisioning (new tenant starts `restricted`), sub-only linking
  (email match with a different/no sub → 409 LINK_CONFLICT for manual
  audited admin resolution), standard DB session minting, logout that
  deletes the session row, canonical `/api/auth/session`.
- Stripe (TEST MODE ONLY): plan-key allowlist (`basic` only; price ID
  from env, never invented), admin checkout/portal with server-derived
  URLs, tenant-row locking for customer ensure, server-generated
  deterministic idempotency keys, safe subscription view, webhook with
  signature verification, event dedup, livemode guard, tenant
  resolution from verified Stripe data only, and reconciliation-first
  application (fetched subscription wins; fetch failure = stored,
  unchanged, 5xx for Stripe retry).
- Entitlement gates wired into dataset create, ingest (plus PROPOSED
  free-tier batch/record caps), export (with `existing_only` scope),
  analyze/evaluate/schema Meta calls (deterministic fallback when
  gated), and worker claim-time revalidation (canceled tenants pause
  jobs with checkpoints preserved).
- Three-way spend accounting (confirmed / reserved /
  pending-reconciliation / settled-at-maximum); a timeout never
  releases a reservation as $0, and settled-at-maximum is never
  presented as verified usage.

## Proposed only (marked PROPOSED in code; NOT approved policy)
- All free-tier numbers (contract §3e), the 72h grace window (§3g),
  per-job budget caps. Final numbers are a §11 blocker.

## Mocked / not done here (staging-gated, not claimed)
- No route-level DB integration test runs locally (no local Postgres
  binary in this environment). Route behaviour is evidenced by pure-lib
  tests + typecheck + build; DB behaviour must be exercised on the
  isolated staging DB before any promotion claim.
- Meta augment remains template-only (Option A is separately
  authorized and is NOT part of this branch).
- Model-per-tier resolver lands in the next branch; branch-1 analyze
  still uses data-class-only model selection.

## Conflicts resolved in this branch (recorded, not hidden)
- C1: Contract §7 merge-gate vs the build directive — resolved by
  building in a local-only branch: no merge, push, deploy, or
  migration. Merge approval remains outstanding.
- C2: Tenant `contributorEligible` boolean vs `ContributorEligibility`
  record — the record (next branch) is the source of truth; no boolean
  column was added here.
- C3: `tenantDisabledAt` vs per-user disablement — per-user
  disablement (contract rule) is implemented; tenant disablement is
  achieved by disabling that tenant's users. No `tenantDisabledAt`
  column was added.
- C4: Reservation fields on UsageLedger vs a separate table — a
  separate `SpendReservation` table; `UsageLedger.costUsd` stays
  confirmed-only.
- C5: Paused-tenant export — read-only existing data only, export
  denied (interpretation of §1A "read-only"; to confirm at staging
  review).
- C6: Export "existing only" granularity for past_due/canceled/unpaid
  — the gate allows export subject to 70/30; create/ingest are blocked
  for canceled/unpaid, so no new data can enter after transition, but
  a record-level pre-transition cutoff is NOT enforced in v1 (known
  gap for staging review).
