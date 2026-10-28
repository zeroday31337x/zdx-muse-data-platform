# Branch 3 — Admin / model-tier (revised spec §2–§4)

Branch `coord/admin`, off the integration line (`coord/integration` @
`eac3df4`, which already contains Branch 1 Cognito+Stripe, Branch 2
model tiers, and reconciled core). Local-only: NOT merged, NOT pushed,
NOT deployed, NO migration applied to any server database.

## Implemented

- **Separate operator principal**: `PlatformOperator` +
  `PlatformOperatorSession`, cookie `zdx_operator_session`
  (Path `/api/admin`, HttpOnly, 8h PROPOSED). Tenant sessions are
  never read on `/api/admin/*` — by construction, not by a flag.
- **Operator auth via Cognito hosted UI** (distinct callback
  `/api/admin/auth/callback/cognito`, distinct `zdx_op_*` flow
  cookies): admin-group membership (`zdx-data-admin`) + an existing
  `PlatformOperator` row are BOTH required; no self-registration;
  disabled operators get 401. **MFA from the authenticated token's
  `amr` only** (strict set: otp/sms/webauthn/mfa/software_token_mfa/
  phone_number_mfa); absent or pwd-only amr = MFA_PENDING, which may
  call only `mfa-status` + `mfa-verify`; everything else 403
  `MFA_REQUIRED`. Logout deletes the session row, then clears the
  cookie.
- **First-operator bootstrap**: when no operator exists, creation
  requires server env `OPERATOR_BOOTSTRAP_TOKEN` via header
  `x-operator-bootstrap-token` (timing-safe compare; 503 if unset).
  Afterwards, only a full-MFA operator may create another. An
  operator row alone never grants access — Cognito group membership
  is still checked at login.
- **Metadata-only operator visibility (v1)**: no route returns
  dataset contents or record bodies. Tenant-affecting operator
  actions dual-write `PlatformAuditLog` + tenant `AuditLog` with
  actor `platform-operator:<id>`.
- **Operator routes**: tenants list/detail/status (bulk user
  disable/enable — per-user disablement, no `tenantDisabledAt`
  column, per Branch 1 decision C3)/settings (name only; entitlement/
  plan/allowlist/preference keys → 403 `SETTING_LOCKED`); users list/
  role+status (last-admin protection → 409 `LAST_ADMIN`; disablement
  revokes sessions in-transaction); invitations create (role capped
  member, token shown once)/revoke (`status='revoked'`; accept already
  requires `pending`); contributor-eligibility grant/revoke (reason
  required; the record is the source of truth); billing dunning list/
  reconcile (authoritative Stripe fetch, unknown status → audit + no
  change, fetch failure → 503 with no change)/checkout/portal
  (operator generates URLs the tenant's own admin completes; the
  operator never completes checkout or mints a tenant session);
  workflows jobs list + pause/resume/cancel/retry/reclaim-lease
  (canonical state machine; reclaim only for expired leases);
  platform settings (versioned, append-only versions) + versions
  view; tier-allowlist + resource-limits (read-only in v1, PATCH →
  403 `SETTING_LOCKED`); operators list/create/status (no
  self-disable → 403; last active operator → 409); audit search
  (append-only view; no delete route exists).
- **Tenant account routes** (§4.2): `GET /api/account`, tenant
  settings (name only, TA), usage (confirmed UsageLedger only),
  users (own tenant), invitations create/revoke (TA, own tenant).
- **Versioned settings policy**: LOCKED keys (70/30, isolation,
  provenance, secrets, audit append-only, entitlement derivation,
  tier allowlist, resource limits, hard ceiling, stripe/cognito/meta
  namespaces) are rejected, never silently ignored; cap values above
  the hard ceiling are rejected at write time
  (`SETTING_ABOVE_HARD_CEILING`). Editable in v1: announcement,
  supportEmail, maintenanceMode only.

## Deliberate v1 limitations (documented, not hidden)

- **No operator dashboard UI**: admin surface is API-only in this
  branch. A read-only operator UI page is deferred (separate work).
- **Tier-allowlist and resource-limits are read-only** via the admin
  API: changes remain server-config changes (separate approval +
  redeploy). This preserves the "allowlist in server config/env only"
  rule; it does not silently widen anything.
- **Tenant settings are name-only** (operator and tenant routes):
  modelPreference changes go through the tenant account route.
- **Tenant MFA helper discrepancy (flagged, not changed here)**:
  `mfaVerifiedFromClaims` (tenant) counts ANY non-`pwd` amr value as
  MFA; the operator check uses a strict second-factor set. The
  tenant helper's looser reading should be reviewed before operator
  journeys are claimed equivalent — it was not silently tightened
  here because that would change Branch 1 behaviour.
- **Operator callback registration**: `/api/admin/auth/callback/cognito`
  is a NEW callback URL that must be registered in the Cognito app
  client (staging + production) before operator journeys can run.
  This is in addition to the tenant callback registration blocker.

## Gates (local only)

- `npm run typecheck`: clean (two real bugs caught and fixed during
  this branch: `applyStripeState` return shape, `createPortalSession`
  arity — both fixed to match the existing helpers, not worked
  around).
- `npm test`: 100/100 (90 integration-line + 10 new admin policy
  tests: strict MFA interpretation, cookie separation, token hash,
  locked/ceiling setting guards, workflow transitions, schema
  contract).
- `npm run build`: passes; all 25 new admin routes + 6 new account
  routes listed in the build output.
- NOT evidenced locally (no local Postgres): route-level DB behaviour
  (operator login flow, last-admin guards, dual audit writes,
  bootstrap gate). These are staging-validation items, not claims.

## Schema / migration (NOT applied)

- `prisma/migrations/20261028030000_admin/migration.sql` (additive
  only): `PlatformOperator`, `PlatformOperatorSession`,
  `PlatformSetting`, `PlatformSettingVersion`, `PlatformAuditLog`.
  Execution requires Gate 7A integrated review + Gate 7B
  per-migration review. This branch does NOT close Gate 7A/7B.
