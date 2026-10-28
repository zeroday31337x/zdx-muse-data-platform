// Consolidated error table — single source of truth for API error codes.
//
// CONTRACT ROW C1 (merged error table, verbatim). This table transcribes the
// proposed merged error table in the final-agreement draft §2.1 (proposal
// only — the draft is UNSIGNED, so this table is a PROPOSAL transcription,
// not a signed agreement). No code outside this table may be used for the
// listed denials in the Cognito+Stripe stage; any new code needs a contract
// amendment. Order rule (draft §2.1, fixed): 401 → 404 (tenant/resource) →
// 402 (entitlement, where applicable) → 429/409/413 (limit / business rule)
// → 409 (business rules including 70/30). 400 INVALID_REQUEST is for
// malformed requests only and sits outside that order: a valid request
// that exceeds a cap or limit is never 400.
//
// MODEL_BUDGET_EXCEEDED — EXPLICIT EXCEPTION (contract row C2, unsigned):
// the draft §2.1 proposes HTTP 409 for this code, but the 409-vs-402 mapping
// choice (C2) is UNSIGNED. This table therefore records 409 as PROPOSED,
// pending the C2 decision — it is NOT presented as decided. Current route
// behaviour is unchanged by this table: analyze / evaluate / schema return
// HTTP 200 with a deterministic fallback and a `metaGate` code when the
// budget gate rejects; they do NOT return HTTP 409 until C2 is decided.
// Reservation/job paths, where a 409 mapping could apply, are unbuilt.
//
// GRACE_EXPIRED_UNVERIFIED is not a Stripe status and not an HTTP code: it
// is an access/entitlement restriction in the entitlement/audit layer (B12).
// The one-time unpaid export-out (B10) is an authorization rule, not an
// error code. Both are recorded here so readers do not mistake them for
// HTTP mappings.

export type ErrorTableStatus =
  | 'draft-proposal' // transcribed from unsigned draft §2.1; not signed
  | 'PROPOSED (pending C2 decision)' // mapping choice unsigned
  | 'in-use, not in §2.1 proposal'; // code used in routes but absent from §2.1

export interface ErrorTableEntry {
  code: string;
  httpStatus: number | null; // null = not an HTTP status (restriction / rule)
  meaning: string;
  status: ErrorTableStatus;
}

export const ERROR_TABLE: Record<string, ErrorTableEntry> = {
  // ---- Draft §2.1 proposal (unsigned) ----
  INVALID_PRICE: { code: 'INVALID_PRICE', httpStatus: 400, meaning: 'priceKey not in the backend allowlist (generic, does not enumerate the allowlist).', status: 'draft-proposal' },
  INVALID_REQUEST: { code: 'INVALID_REQUEST', httpStatus: 400, meaning: 'Unknown auth mode, or otherwise malformed request (fail closed). Reserved for malformed requests only — never for a valid request exceeding a batch, quota, concurrency, or rate limit.', status: 'draft-proposal' },
  INVALID_SIGNATURE: { code: 'INVALID_SIGNATURE', httpStatus: 400, meaning: 'Stripe webhook signature missing or failed; no state change, no event row required.', status: 'draft-proposal' },
  AUTHENTICATION_FAILED: { code: 'AUTHENTICATION_FAILED', httpStatus: 400, meaning: 'Cognito callback failure (generic; no provider error detail, no tokens in body or logs).', status: 'draft-proposal' },
  UNAUTHENTICATED: { code: 'UNAUTHENTICATED', httpStatus: 401, meaning: 'No valid session; also DB-login failure on null/empty password or authProvider=cognito (generic, no oracle), post-logout replay, and missing/invalid operator authentication (a tenant session is never operator authentication).', status: 'draft-proposal' },
  ENTITLEMENT_REQUIRED: { code: 'ENTITLEMENT_REQUIRED', httpStatus: 402, meaning: 'Entitlement/paywall denial (export, gated Meta actions), with the tenant\'s own current status in the body.', status: 'draft-proposal' },
  FORBIDDEN: { code: 'FORBIDDEN', httpStatus: 403, meaning: 'Within-own-tenant role denial (non-admin checkout/portal/invitation).', status: 'draft-proposal' },
  MFA_REQUIRED: { code: 'MFA_REQUIRED', httpStatus: 403, meaning: 'Authenticated operator whose required MFA verification is absent. Distinct from 401 (missing/invalid operator authentication) and from 403 FORBIDDEN (role denial).', status: 'draft-proposal' },
  NOT_FOUND: { code: 'NOT_FOUND', httpStatus: 404, meaning: 'Cross-tenant access (never a tenant hint), missing tenant/resource, or invitation not found (generic, no enumeration).', status: 'draft-proposal' },
  LINK_CONFLICT: { code: 'LINK_CONFLICT', httpStatus: 409, meaning: 'Verified ID-token email matches an existing DB user but cognitoSub differs; manual admin resolution only.', status: 'draft-proposal' },
  INVITATION_TENANT_MISMATCH: { code: 'INVITATION_TENANT_MISMATCH', httpStatus: 409, meaning: 'Existing user accepts an invitation for a different tenant; invitation stays pending, primary tenant unchanged.', status: 'draft-proposal' },
  SUBSCRIPTION_ALREADY_ACTIVE: { code: 'SUBSCRIPTION_ALREADY_ACTIVE', httpStatus: 409, meaning: 'Checkout attempted while active/trialing.', status: 'draft-proposal' },
  USE_PORTAL_TO_RESOLVE_PAST_DUE: { code: 'USE_PORTAL_TO_RESOLVE_PAST_DUE', httpStatus: 409, meaning: 'Checkout attempted while past_due; use Portal instead.', status: 'draft-proposal' },
  NO_BILLING_CUSTOMER: { code: 'NO_BILLING_CUSTOMER', httpStatus: 409, meaning: 'Portal attempted with no stripeCustomerId; complete Checkout first.', status: 'draft-proposal' },
  QUOTA_EXCEEDED: { code: 'QUOTA_EXCEEDED', httpStatus: 409, meaning: 'Free-tier storage/record quota exceeded.', status: 'draft-proposal' },
  CONCURRENCY_LIMIT: { code: 'CONCURRENCY_LIMIT', httpStatus: 429, meaning: 'Free-tier concurrent-job limit prevents creation. At worker claim, excess jobs remain QUEUED, never FAILED for this reason.', status: 'draft-proposal' },
  BATCH_TOO_LARGE: { code: 'BATCH_TOO_LARGE', httpStatus: 409, meaning: 'A valid ingest call exceeds the tenant\'s batch cap. A malformed request is 400 INVALID_REQUEST, never BATCH_TOO_LARGE.', status: 'draft-proposal' },
  SYNTHETIC_CAP_EXCEEDED: { code: 'SYNTHETIC_CAP_EXCEEDED', httpStatus: 409, meaning: 'Augment would exceed the 70/30 cap, with remaining allowance.', status: 'draft-proposal' },
  MODEL_BUDGET_EXCEEDED: { code: 'MODEL_BUDGET_EXCEEDED', httpStatus: 409, meaning: 'Budget/reservation block, including a block caused by a held pending reservation. PROPOSED ONLY — the C2 mapping decision (409 vs 402) is unsigned; current analyze/evaluate/schema behaviour (HTTP 200 + deterministic fallback with a metaGate code) is unchanged until C2 is decided.', status: 'PROPOSED (pending C2 decision)' },
  INVITATION_EXPIRED: { code: 'INVITATION_EXPIRED', httpStatus: 410, meaning: 'Invitation token expired.', status: 'draft-proposal' },
  RATE_LIMITED: { code: 'RATE_LIMITED', httpStatus: 429, meaning: 'Free-tier request-rate or registration-rate limit exceeded. Concurrency limits use the separate code 429 CONCURRENCY_LIMIT.', status: 'draft-proposal' },
  FILE_TOO_LARGE: { code: 'FILE_TOO_LARGE', httpStatus: 413, meaning: 'File/total upload size exceeded.', status: 'draft-proposal' },
  DATABASE_NOT_CONFIGURED: { code: 'DATABASE_NOT_CONFIGURED', httpStatus: 503, meaning: 'DB unconfigured (DB-only routes, never a file-store fallback).', status: 'draft-proposal' },
  COGNITO_NOT_CONFIGURED: { code: 'COGNITO_NOT_CONFIGURED', httpStatus: 503, meaning: 'Cognito env missing for a Cognito route.', status: 'draft-proposal' },
  BILLING_NOT_CONFIGURED: { code: 'BILLING_NOT_CONFIGURED', httpStatus: 503, meaning: 'Stripe unconfigured (missing secret or empty allowlist) — fail closed.', status: 'draft-proposal' },
  STRIPE_UNAVAILABLE: { code: 'STRIPE_UNAVAILABLE', httpStatus: 503, meaning: 'Stripe API failure; no Stripe error internals leaked.', status: 'draft-proposal' },
  // ---- Non-HTTP concepts recorded so they are not mistaken for codes ----
  GRACE_EXPIRED_UNVERIFIED: { code: 'GRACE_EXPIRED_UNVERIFIED', httpStatus: null, meaning: 'Access/entitlement restriction recorded at grace expiry (B12). Not a Stripe status, not an HTTP code; the last verified Stripe status is preserved separately.', status: 'draft-proposal' },
  // ---- Additional codes used in routes, not part of the §2.1 proposal ----
  PARSE_ERROR: { code: 'PARSE_ERROR', httpStatus: 400, meaning: 'Ingest payload could not be parsed.', status: 'in-use, not in §2.1 proposal' },
  EMPTY_SOURCE: { code: 'EMPTY_SOURCE', httpStatus: 400, meaning: 'Ingest payload contained no rows.', status: 'in-use, not in §2.1 proposal' },
  TOO_MANY_ROWS: { code: 'TOO_MANY_ROWS', httpStatus: 400, meaning: 'Ingest call exceeds the 10,000-row platform maximum. NOTE (matrix row B5 deviation): this is a valid request exceeding a cap returning 400, against B13\'s "400 for malformed only" — recorded here, not silently fixed, because the platform-max behaviour is a separate decision.', status: 'in-use, not in §2.1 proposal' },
  INVALID_CONTENT_LENGTH: { code: 'INVALID_CONTENT_LENGTH', httpStatus: 400, meaning: 'Request Content-Length header is not a finite number.', status: 'in-use, not in §2.1 proposal' },
  INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', httpStatus: 401, meaning: 'DB login failure (generic, no oracle).', status: 'in-use, not in §2.1 proposal' },
  STALE_LEASE: { code: 'STALE_LEASE', httpStatus: 409, meaning: 'Worker lease changed hands; the stale worker must not overwrite the new owner\'s progress.', status: 'in-use, not in §2.1 proposal' },
  ENTITLEMENT_REVOKED: { code: 'ENTITLEMENT_REVOKED', httpStatus: 409, meaning: 'Worker-side: tenant lost entitlement after enqueue; job pauses, never runs, never FAILED for this reason.', status: 'in-use, not in §2.1 proposal' },
  EXPORT_BLOCKED_NONCOMPLIANT: { code: 'EXPORT_BLOCKED_NONCOMPLIANT', httpStatus: 409, meaning: 'Training export blocked by 70/30 composition.', status: 'in-use, not in §2.1 proposal' },
  NO_AUTHENTIC_RECORDS: { code: 'NO_AUTHENTIC_RECORDS', httpStatus: 409, meaning: 'Augmentation requires verified authentic records to stay within the 30% cap.', status: 'in-use, not in §2.1 proposal' },
  NO_BILLING_SUBSCRIPTION: { code: 'NO_BILLING_SUBSCRIPTION', httpStatus: 409, meaning: 'Operator reconcile attempted with no stripeSubscriptionId.', status: 'in-use, not in §2.1 proposal' },
  RECONCILIATION_FAILED: { code: 'RECONCILIATION_FAILED', httpStatus: 500, meaning: 'Authoritative Stripe reconciliation fetch failed; no state change (Stripe retries on 5xx; the app-side retry schedule also runs on worker ticks).', status: 'in-use, not in §2.1 proposal' },
  MULTIMODAL_NOT_OPERATIONAL: { code: 'MULTIMODAL_NOT_OPERATIONAL', httpStatus: 503, meaning: 'Multimodal ingestion is gated off, never silently partial.', status: 'in-use, not in §2.1 proposal' },
};

export function errorTableEntry(code: string): ErrorTableEntry | null {
  return ERROR_TABLE[code] ?? null;
}

/** HTTP status for a table code, or null when the code has no HTTP mapping. */
export function httpStatusForErrorCode(code: string): number | null {
  return ERROR_TABLE[code]?.httpStatus ?? null;
}
