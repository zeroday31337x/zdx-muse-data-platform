// Upload-size enforcement (contract §3e, row B4: proposed 10 MB per file,
// 50 MB total uploads per restricted tenant — PROPOSED values, NOT
// approved policy and NOT commercial quotas).
//
// Per-file enforcement is fully implemented: Content-Length is checked
// before parsing (api-validation.ts, FILE_TOO_LARGE) and actual UTF-8
// bytes are checked after parsing (checkUploadBytes below), because a
// declared Content-Length may be absent (chunked bodies) and a zod
// string .max() counts characters, not bytes.
//
// Per-tenant TOTAL enforcement: the ledger column now exists in the schema
// (Tenant.totalUploadBytes, migration 20261028050000_upload_ledger — FILE
// ONLY, UNAPPLIED to any server database). Once the migration is applied,
// Prisma returns the column (0 for all rows at migration time, then
// incremented by the ingest route after each successful restricted ingest),
// so the hook below reports enforced:true and the route's 413
// FILE_TOO_LARGE path is live for totals. Until the migration is applied,
// a tenant record read by old code has no such field and the hook keeps
// reporting enforced:false (rolling-deploy safety net, never mistaken for
// zero usage). The 50 MB total remains a PROPOSED value, NOT approved
// policy and NOT a commercial quota.
// LIMITATION: the ledger starts at 0 at migration time — pre-migration
// uploads are not counted (their byte sizes are not recoverable from
// stored records). The total counts uploaded actual UTF-8 bytes
// (byteCheck.bytes in the ingest route), the same measure as the per-file
// actual-byte check; declared Content-Length is a pre-parse guard only
// (it includes JSON framing) and is NOT added to the ledger.

export const FILE_TOO_LARGE = 'FILE_TOO_LARGE';

/** Actual-byte check on already-parsed upload text. */
export function checkUploadBytes(
  text: string,
  maxBytes: number,
): { ok: true; bytes: number } | { ok: false; code: string; bytes: number } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) return { ok: false, code: FILE_TOO_LARGE, bytes };
  return { ok: true, bytes };
}

/** Pure total-upload check: used + new against the tenant total limit. */
export function checkTotalUploadBytes(
  usedBytes: number,
  newBytes: number,
  limitBytes: number,
): { ok: true } | { ok: false; code: string } {
  if (usedBytes + newBytes > limitBytes) return { ok: false, code: FILE_TOO_LARGE };
  return { ok: true };
}

/**
 * Total-upload limit for a tenant. Restricted tenants: the PROPOSED
 * 50 MB total. Entitled tenants: no total is specified by the contract
 * row, so null (no cap) — an entitled total would be a new decision,
 * not something this helper invents.
 */
export function totalUploadLimitForTenant(restricted: boolean): number | null {
  return restricted ? 50 * 1024 * 1024 : null;
}

/**
 * Route hook. Reads Tenant.totalUploadBytes (migration
 * 20261028050000_upload_ledger, FILE ONLY — unapplied). Once the migration
 * is applied, Prisma returns the column (never null: NOT NULL DEFAULT 0),
 * so the hook reports enforced:true. It still reports enforced:false when
 * the ledger value is absent (pre-migration reads, rolling-deploy safety
 * net) so callers never mistake "no ledger" for "zero usage".
 */
export function enforceTotalUpload(
  tenant: { totalUploadBytes?: number | null },
  newBytes: number,
  restricted: boolean,
): { enforced: true; ok: boolean; code?: string } | { enforced: false; reason: string } {
  const limit = totalUploadLimitForTenant(restricted);
  if (limit === null) return { enforced: true, ok: true };
  const used = tenant.totalUploadBytes;
  if (used === undefined || used === null) {
    return { enforced: false, reason: 'TOTAL_UPLOAD_LEDGER_MISSING' };
  }
  const check = checkTotalUploadBytes(used, newBytes, limit);
  if (!check.ok) return { enforced: true, ok: false, code: check.code };
  return { enforced: true, ok: true };
}
