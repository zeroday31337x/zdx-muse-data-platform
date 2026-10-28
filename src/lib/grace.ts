// Lazy grace-expiry enforcement (contract §11.9 / B12).
// Expiry itself is evaluated lazily on the paths where the restriction
// matters (export, augment, ingest, meta gate): if the tenant's grace
// started longer than the configured GRACE_HOURS ago and the tenant is
// not yet restricted, this helper restricts the tenant row + writes the
// audit row in one transaction and returns the restricted tenant. When
// GRACE_HOURS is unset, no expiry runs (snapshot preserved indefinitely
// — interim behaviour pending the B8 duration decision).
// NOTE (compliance fix, B9): the app-side reconciliation RETRY schedule
// now exists separately (src/lib/reconciliation-retry.ts, evaluated on
// worker ticks). It retries failed reconciliations; it does not replace
// these lazy expiry checks, and lazy expiry enforcement remains the
// enforcement for expiry, recorded as such in the audit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { graceHoursConfigured, graceRestrictionActive, applyGraceExpiry, GRACE_RESTRICTION_CODE } from './billing';

export async function ensureGraceRestriction(db: any, tenant: any): Promise<any> {
  if (!tenant || graceRestrictionActive(tenant)) return tenant;
  const graceHours = graceHoursConfigured();
  if (graceHours === null) return tenant;
  const expiry = applyGraceExpiry(tenant, graceHours);
  if (!expiry) return tenant;
  const updated = await db.$transaction(async (tx: any) => {
    const t = await tx.tenant.update({
      where: { id: tenant.id },
      data: { accessRestriction: expiry.accessRestriction, accessRestrictedAt: expiry.accessRestrictedAt },
    });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actor: 'system:grace-expiry',
        action: 'GRACE_EXPIRED',
        entity: `Tenant:${tenant.id}`,
        details: { code: GRACE_RESTRICTION_CODE, graceStartedAt: tenant.graceStartedAt ? new Date(tenant.graceStartedAt).toISOString() : null, restrictedAt: expiry.accessRestrictedAt.toISOString() },
      },
    });
    return t;
  });
  return updated;
}
