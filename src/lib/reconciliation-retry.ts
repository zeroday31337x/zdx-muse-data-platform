// App-side reconciliation retry schedule (contract row B9).
//
// Previously the only retry mechanism was Stripe's own retry on the
// webhook's 5xx after a failed reconciliation fetch, plus lazy grace
// evaluation on gated routes. This module adds the app-side schedule
// and its evaluation on worker ticks (see the worker/run route hook).
// There is no background scheduler process in this architecture, so
// the schedule advances only when worker ticks run — the same
// precondition as job processing itself. If ticks stop, retries pause;
// they never run on a separate timer that could tick against the
// production database by accident.
//
// SCHEDULE VALUES ARE PROPOSED ONLY (unsigned): ~1 min, ~5 min,
// ~30 min, then hourly until grace expiry. They are not approved policy.
// Attempt counting needs no schema change: each retry attempt writes a
// tenant AuditLog row (action RECONCILIATION_RETRY), and the next due
// time is computed from the latest such row (or from graceStartedAt
// when no retry has run yet). Retry candidates are tenants whose
// reconciliation has failed (graceStartedAt set) but whose grace has
// not yet expired into a restriction (accessRestriction null) and who
// have a Stripe subscription to reconcile. Once a restriction is set,
// operator reconciliation is the path — the sweep deliberately stops
// retrying restricted tenants so it cannot silently clear a restriction.
// A retry NEVER changes entitlement on failure: failure writes only
// the audit row and leaves every Stripe-derived field untouched (fail
// closed, same rule as the webhook and operator-reconcile paths).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { applyStripeState, clearGraceRestriction, PLAN_ALLOWLIST, priceIdForPlan } from './billing';
import { retrieveSubscription } from './stripe-client';

/** PROPOSED schedule, in seconds between attempts: 1m, 5m, 30m, then hourly. */
export const RECONCILIATION_RETRY_DELAYS_SEC_PROPOSED = [60, 300, 1800, 3600] as const;

/** Delay before attempt `attemptIndex` (0-based); hourly after the table ends. */
export function delayForReconciliationAttempt(attemptIndex: number): number {
  if (attemptIndex < RECONCILIATION_RETRY_DELAYS_SEC_PROPOSED.length) {
    return RECONCILIATION_RETRY_DELAYS_SEC_PROPOSED[attemptIndex];
  }
  return 3600;
}

/** Next due time for a tenant whose grace started at firstFailedAt. */
export function nextReconciliationRetryAt(
  firstFailedAt: Date,
  attemptCount: number,
  lastAttemptAt: Date | null,
): Date {
  const base = (lastAttemptAt ?? firstFailedAt).getTime();
  return new Date(base + delayForReconciliationAttempt(attemptCount) * 1000);
}

/** True when a retry attempt is due at `now`. */
export function isReconciliationRetryDue(
  firstFailedAt: Date,
  attemptCount: number,
  lastAttemptAt: Date | null,
  now = new Date(),
): boolean {
  return now.getTime() >= nextReconciliationRetryAt(firstFailedAt, attemptCount, lastAttemptAt).getTime();
}

export interface ReconciliationRetrySummary {
  checked: number;
  due: number;
  succeeded: number;
  failed: number;
}

/**
 * Evaluate and run due reconciliation retries. One tenant's failure
 * never aborts the sweep. Returns a summary for the tick response/log.
 * Callers must never let this sweep block job claiming: wrap in
 * try/catch at the call site.
 */
export async function runDueReconciliationRetries(db: any, now = new Date()): Promise<ReconciliationRetrySummary> {
  const summary: ReconciliationRetrySummary = { checked: 0, due: 0, succeeded: 0, failed: 0 };
  const candidates = await db.tenant.findMany({
    where: { graceStartedAt: { not: null }, accessRestriction: null, stripeSubscriptionId: { not: null } },
  });
  for (const tenant of candidates) {
    summary.checked += 1;
    try {
      const attemptCount: number = await db.auditLog.count({
        where: { tenantId: tenant.id, action: 'RECONCILIATION_RETRY' },
      });
      const lastRows = await db.auditLog.findMany({
        where: { tenantId: tenant.id, action: 'RECONCILIATION_RETRY' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      const lastAttemptAt = lastRows.length > 0 ? new Date(lastRows[0].createdAt) : null;
      if (!isReconciliationRetryDue(new Date(tenant.graceStartedAt), attemptCount, lastAttemptAt, now)) {
        continue;
      }
      summary.due += 1;
      let sub: any;
      try {
        sub = await retrieveSubscription(tenant.stripeSubscriptionId);
      } catch {
        await db.auditLog.create({
          data: { tenantId: tenant.id, actor: 'system:reconciliation-retry', action: 'RECONCILIATION_RETRY', entity: `Tenant:${tenant.id}`, details: { attempt: attemptCount, outcome: 'fetch_failed' } },
        });
        summary.failed += 1;
        continue;
      }
      const mapped = applyStripeState({ subscriptionStatus: tenant.subscriptionStatus as string }, sub);
      if (!mapped) {
        await db.auditLog.create({
          data: { tenantId: tenant.id, actor: 'system:reconciliation-retry', action: 'RECONCILIATION_RETRY', entity: `Tenant:${tenant.id}`, details: { attempt: attemptCount, outcome: 'unknown_status', stripeStatus: sub.status } },
        });
        await db.auditLog.create({
          data: { tenantId: tenant.id, actor: 'system:reconciliation-retry', action: 'UNKNOWN_STRIPE_STATUS', entity: `Tenant:${tenant.id}`, details: { stripeStatus: sub.status, via: 'reconciliation-retry' } },
        });
        summary.failed += 1;
        continue;
      }
      let planKey: string | null = tenant.subscriptionPlan ?? null;
      if (sub.priceId) {
        for (const key of Object.keys(PLAN_ALLOWLIST)) {
          if (priceIdForPlan(key) === sub.priceId) { planKey = key; break; }
        }
      }
      const before = tenant.subscriptionStatus as string;
      await db.$transaction(async (tx: any) => {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { stripeSubscriptionStatus: mapped.stripeStatus, subscriptionStatus: mapped.derived, subscriptionPlan: planKey, stripePriceId: sub.priceId, currentPeriodEnd: sub.currentPeriodEnd, lastStripeEventAt: now, ...clearGraceRestriction() },
        });
        await tx.auditLog.create({
          data: { tenantId: tenant.id, actor: 'system:reconciliation-retry', action: 'RECONCILIATION_RETRY', entity: `Tenant:${tenant.id}`, details: { attempt: attemptCount, outcome: 'succeeded', from: before, to: mapped.derived } },
        });
        await tx.auditLog.create({
          data: { tenantId: tenant.id, actor: 'system:reconciliation-retry', action: 'SUBSCRIPTION_TRANSITION', entity: `Tenant:${tenant.id}`, details: { from: before, to: mapped.derived, via: 'reconciliation-retry' } },
        });
      });
      summary.succeeded += 1;
    } catch {
      // Per-tenant sweep failure: counted as failed, sweep continues.
      summary.failed += 1;
    }
  }
  return summary;
}
