// One-time unpaid export-out authorization (contract §11.9(a) / B10).
// Exactly ONE export-out per VERIFIED transition into 'unpaid', over
// the pre-transition snapshot only (records with createdAt <=
// boundaryAt). Concurrency: claims use SELECT ... FOR UPDATE inside
// the caller's transaction, so two concurrent export attempts cannot
// both claim the same authorization. A CLAIMED row older than the
// claim timeout is an interrupted export: it may be RECLAIMED (retry),
// but completion is terminal — a COMPLETED authorization can never
// produce a second successful export. The claim timeout below is
// PROPOSED (interrupted-export recovery window), not approved policy;
// it bounds recovery, it does not extend eligibility.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const EXPORT_OUT_CLAIM_TIMEOUT_MS = 60 * 60 * 1000; // PROPOSED 1h

export function isClaimStale(claimedAt: Date | null | undefined, now: Date, timeoutMs = EXPORT_OUT_CLAIM_TIMEOUT_MS): boolean {
  if (!claimedAt) return false;
  return now.getTime() - new Date(claimedAt).getTime() > timeoutMs;
}

export type ExportOutClaim = { id: string; claimToken: string; boundaryAt: Date; reclaimed: boolean };

/**
 * Atomically claim one available unpaid export-out authorization for
 * the tenant (oldest first). Returns null when none is available and
 * none is stale — the caller must then deny with 402
 * ENTITLEMENT_REQUIRED (exportOut: consumed/claimed/unavailable).
 * Requires the caller to run inside a transaction; the FOR UPDATE
 * lock serializes concurrent claimants.
 */
export async function claimUnpaidExportAuthorization(
  tx: any,
  tenantId: string,
  now = new Date(),
): Promise<ExportOutClaim | null> {
  const claimToken = `export-out-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const available = await tx.$queryRaw<{ id: string; boundaryAt: Date }[]>`
    SELECT id, "boundaryAt" FROM "UnpaidExportAuthorization"
    WHERE "tenantId" = ${tenantId} AND status = 'AVAILABLE'
    ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE`;
  if (available.length > 0) {
    const row = available[0];
    const updated = await tx.unpaidExportAuthorization.updateMany({
      where: { id: row.id, status: 'AVAILABLE' },
      data: { status: 'CLAIMED', claimToken, claimedAt: now },
    });
    if (updated.count > 0) return { id: row.id, claimToken, boundaryAt: new Date(row.boundaryAt), reclaimed: false };
    return null;
  }
  // No available row: reclaim a stale (interrupted) claim, if any.
  const cutoff = new Date(now.getTime() - EXPORT_OUT_CLAIM_TIMEOUT_MS);
  const stale = await tx.$queryRaw<{ id: string; boundaryAt: Date }[]>`
    SELECT id, "boundaryAt" FROM "UnpaidExportAuthorization"
    WHERE "tenantId" = ${tenantId} AND status = 'CLAIMED' AND "claimedAt" < ${cutoff}
    ORDER BY "claimedAt" ASC LIMIT 1 FOR UPDATE`;
  if (stale.length === 0) return null;
  const row = stale[0];
  const updated = await tx.unpaidExportAuthorization.updateMany({
    where: { id: row.id, status: 'CLAIMED' },
    data: { claimToken, claimedAt: now },
  });
  if (updated.count === 0) return null;
  return { id: row.id, claimToken, boundaryAt: new Date(row.boundaryAt), reclaimed: true };
}

/** Mark a claimed authorization COMPLETED (terminal). Token must match. */
export async function completeUnpaidExportAuthorization(tx: any, id: string, claimToken: string, now = new Date()): Promise<boolean> {
  const updated = await tx.unpaidExportAuthorization.updateMany({
    where: { id, claimToken, status: 'CLAIMED' },
    data: { status: 'COMPLETED', completedAt: now },
  });
  return updated.count > 0;
}

/** Release a claim back to AVAILABLE (generation failed before delivery). */
export async function releaseUnpaidExportAuthorization(tx: any, id: string, claimToken: string): Promise<boolean> {
  const updated = await tx.unpaidExportAuthorization.updateMany({
    where: { id, claimToken, status: 'CLAIMED' },
    data: { status: 'AVAILABLE', claimToken: null, claimedAt: null },
  });
  return updated.count > 0;
}

/**
 * Create one authorization for a verified transition into 'unpaid'.
 * Idempotent per (tenantId, stripeEventId): a second call for the same
 * transition event creates nothing. Also writes the attributable audit
 * row in the same transaction. Callers MUST only invoke this after a
 * verified reconciliation (webhook reconcile-wins or operator
 * reconcile), never from a client claim.
 */
export async function authorizeUnpaidExportOut(
  tx: any,
  opts: { tenantId: string; stripeEventId: string; boundaryAt: Date; actor: string },
): Promise<{ created: boolean }> {
  const existing = await tx.unpaidExportAuthorization.findFirst({
    where: { tenantId: opts.tenantId, stripeEventId: opts.stripeEventId },
  });
  if (existing) return { created: false };
  const auth = await tx.unpaidExportAuthorization.create({
    data: { tenantId: opts.tenantId, stripeEventId: opts.stripeEventId, boundaryAt: opts.boundaryAt, status: 'AVAILABLE' },
  });
  await tx.auditLog.create({
    data: {
      tenantId: opts.tenantId,
      actor: opts.actor,
      action: 'UNPAID_EXPORT_AUTHORIZED',
      entity: `UnpaidExportAuthorization:${auth.id}`,
      details: { stripeEventId: opts.stripeEventId, boundaryAt: opts.boundaryAt.toISOString() },
    },
  });
  return { created: true };
}
