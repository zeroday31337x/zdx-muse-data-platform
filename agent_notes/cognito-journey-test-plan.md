# Cognito live-journey test plan (staging) — NOT YET RUN

Status: PLAN ONLY. No live Cognito journey (registration, email
confirmation, login, logout, password recovery) has been verified. Code
inspection + unit tests verify wiring; they do NOT verify a live journey.
Do not report Cognito login as working until this plan passes on staging.

## What code inspection verified (wiring, not a live journey)

- Existing pool only, via env: region `us-east-1`, pool
  `us-east-1_cqTMJqSpX`, app client `1untf4m06a434j2ora8vulpt3j`,
  domain prefix `zdx-data-intelligence-auth`, Authorization Code flow,
  scopes `openid email profile`. Public client + PKCE (S256); NO client
  secret anywhere in code (never read, stored, or sent).
- Hosted-UI URLs built from env only: login → `/oauth2/authorize`,
  signup → `/signup`, password recovery → `/forgotPassword` (hosted-UI
  flow; there is no custom password form). State/nonce/verifier in
  HttpOnly flow cookies; redirects restricted to relative paths.
- `verifyIdToken`: RS256 via issuer JWKS with iss/aud/token_use/exp/
  nonce checks; generic errors only; raw tokens never stored, logged,
  or cookied.
- Callback links by `cognitoSub` ONLY: an email match with a different
  sub returns 409 `LINK_CONFLICT` for manual admin resolution (never an
  automatic merge).
- Transactional provisioning: new Tenant (`restricted`) + User (member,
  Cognito-only, `passwordHash: null`) + Session + audit rows, idempotent
  on sub/email unique races. Registration rate 3/IP/24h PROPOSED,
  enforced for genuinely new registrations only (in-memory v1 counter;
  durable counter migration pending).
- Logout DELETES the DB session row, clears the cookie, and returns the
  hosted-UI logout URL for Cognito sessions. The logout URI is
  origin-derived, so it must be a REGISTERED logout URI in Cognito for
  the origin under test — this matters for staging origins.

## Blockers (all must clear before this plan runs)

1. Staging transport decision: the git-bundle transfer for staging-only
   transport is UNAPPROVED (awaiting Justen's explicit exception). Until
   it clears, the corrected branch cannot reach staging at all.
2. Staging Cognito callbacks: the staging origin's callback + logout
   URIs must be REGISTERED in the app client (production callback
   `https://data.zerodrivex.com/api/auth/callback/cognito` and logout
   `https://data.zerodrivex.com/` do not cover a staging origin).
3. Staging deployment of the corrected branch (staging-only checkout,
   d475569 fallback intact, exact-PID restart on port 3001 only).
4. Performer + verifier names for the journey runs (currently unnamed).
5. Staging test accounts: use staging-only test users. NEVER use the
   production admin (`admin@support.zerodrivex.com`) or production
   credentials for staging tests.

## Journey steps (staging only, in order)

J1 — Registration: start hosted-UI signup from staging; complete with a
staging test email. Expect: Cognito user created; callback provisions a
`restricted` tenant + member user + session; user lands on the platform
signed in. Capture: HTTP status chain, tenant row status (`restricted`),
audit rows (no secrets in evidence).
J2 — Email confirmation: confirm via the Cognito verification email.
Expect: user confirms; subsequent login succeeds without a
confirmation prompt. Capture: confirmation outcome + login result.
J3 — Login: hosted-UI login with the confirmed test user. Expect:
session created, tenant isolation holds (user sees only their tenant's
datasets). Capture: session cookie presence (value never recorded),
tenant-scoped dataset list.
J4 — Logout: log out from staging. Expect: DB session row DELETED
(verify by row absence, not by cookie alone), cookie cleared, hosted-UI
logout redirect lands on the staging origin. Capture: row-absence check
+ redirect target.
J5 — Password recovery: hosted-UI forgot-password flow for the test
user; set a new password; log in with it. Expect: recovery completes
via Cognito; new password works; old password does not. Capture: flow
outcome only (no passwords in evidence).
J6 — Negative cases: (a) login with an email whose sub differs from the
linked account → 409 `LINK_CONFLICT`, no automatic merge; (b) 4th
registration from one IP within 24h → generic 429 `RATE_LIMITED`
(PROPOSED rule); (c) callback with a tampered state/nonce → generic
rejection, no session created.

## Non-goals (explicit)

- No production Cognito test: production login is verified only after a
  SEPARATE production promotion approval. A staging pass never implies
  production login works.
- No live billing, no paid Meta calls, no Meta-backed augment during
  these journeys.
- No new pool, no pool reconfiguration, no duplicate resources.

## Notification chain (per Justen's 2026-10-28 ~06:03 EDT request)

Report "Cognito login works" ONLY when J1–J5 pass on staging (and, for
production, after the separate promotion approval + a production pass).
Until then the correct report is: Cognito login is NOT verified working
— current production (f17fea5) and staging (d475569) checkouts contain
no Cognito implementation, so Cognito login cannot work on either today.
