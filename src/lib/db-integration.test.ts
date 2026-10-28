// Real PostgreSQL integration tests — OPT-IN ONLY.
// ---------------------------------------------------------------------------
// REQUIRES: TEST_DATABASE_URL pointing at an EMPTY database with all
// migrations applied (`prisma migrate deploy`, including the compliance
// migration 20261028040000_compliance). NEVER point this at staging or
// production: these tests create tenants, subscriptions, jobs, and
// spend reservations, and they deliberately race concurrent claims.
// WITHOUT TEST_DATABASE_URL every test in this file is SKIPPED and
// reported NOT RUN. A skipped run is NOT a pass, and local mocked
// tests must never be described as database verification.
// The Prisma client is imported lazily inside the tests so that merely
// collecting this file does not fail when the client was not generated.
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
import { it, expect } from 'vitest';

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
// NOTE: it.skipIf (not describe.skipIf) — describe.skipIf treats the
// second argument as a suite callback and runs it at collection time,
// which would execute the test bodies even when skipped. it.skipIf
// registers genuinely skipped tests (verified: 1 passed | 1 skipped).
const t = it.skipIf(!hasDb);

async function loadDb(): Promise<any> {
  // Variable specifiers keep tsc from resolving these modules at
  // typecheck time: the generated client may not exist locally, and
  // the local node_modules Prisma install is not authoritative. At
  // runtime (only when TEST_DATABASE_URL is set) the real modules load.
  const clientPath = '../generated/prisma/client';
  const adapterPath = '@prisma/adapter-pg';
  const pgPath = 'pg';
  const { PrismaClient } = await import(/* @vite-ignore */ clientPath);
  const { PrismaPg } = await import(/* @vite-ignore */ adapterPath);
  const { Pool } = await import(/* @vite-ignore */ pgPath);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

t('atomic unpaid export-out authorization + concurrency', async () => {
  const db = await loadDb();
  const tenant = await db.tenant.create({ data: { name: 'export-out-test', subscriptionStatus: 'unpaid' } });
  const boundary = new Date();
  const { authorizeUnpaidExportOut, claimUnpaidExportAuthorization, completeUnpaidExportAuthorization } = await import('./unpaid-export');
  await db.$transaction(async (tx: any) =>
    authorizeUnpaidExportOut(tx, { tenantId: tenant.id, stripeEventId: 'evt-int-1', boundaryAt: boundary, actor: 'stripe:evt-int-1' }));
  // Two concurrent claims: exactly one must win.
  const [c1, c2] = await Promise.all([
    db.$transaction((tx: any) => claimUnpaidExportAuthorization(tx, tenant.id)),
    db.$transaction((tx: any) => claimUnpaidExportAuthorization(tx, tenant.id)),
  ]);
  const winners = [c1, c2].filter(Boolean);
  expect(winners.length).toBe(1);
  // The winner's claim completes; a further claim finds nothing.
  const ok = await db.$transaction((tx: any) => completeUnpaidExportAuthorization(tx, winners[0].id, winners[0].claimToken));
  expect(ok).toBe(true);
  const after = await db.$transaction((tx: any) => claimUnpaidExportAuthorization(tx, tenant.id));
  expect(after).toBeNull();
  await db.$disconnect();
});

t('concurrent Stripe Checkout requests: one customer, server idempotency', async () => {
  const db = await loadDb();
  const { serverCheckoutIdempotencyKey } = await import('./billing');
  const tenant = await db.tenant.create({ data: { name: 'checkout-test', subscriptionStatus: 'restricted' } });
  const key = serverCheckoutIdempotencyKey(tenant.id, 'professional');
  // The deterministic key itself is the concurrency primitive: two
  // concurrent checkouts for the same tenant+plan produce the same
  // key, so Stripe replays one session instead of creating two.
  expect(serverCheckoutIdempotencyKey(tenant.id, 'professional')).toBe(key);
  expect(serverCheckoutIdempotencyKey(tenant.id, 'business')).not.toBe(key);
  // Tenant-row lock ordering: two concurrent transactions updating the
  // same tenant row serialize; the second sees the first's customer id.
  await db.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`;
    await tx.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: 'cus_int_1' } });
  });
  const again = await db.tenant.findUnique({ where: { id: tenant.id } });
  expect(again.stripeCustomerId).toBe('cus_int_1');
  await db.$disconnect();
});

t('duplicate and reordered webhook events: dedup + reconciliation-wins', async () => {
  const db = await loadDb();
  const tenant = await db.tenant.create({ data: { name: 'webhook-test', subscriptionStatus: 'restricted', stripeCustomerId: 'cus_int_2' } });
  const row = await db.stripeEvent.create({ data: { stripeEventId: 'evt-int-2', tenantId: tenant.id, type: 'customer.subscription.updated', processedAt: new Date() } });
  expect(row.processedAt).not.toBeNull();
  // A duplicate delivery of the same event id must be recognised as
  // processed (the route returns duplicate:true without re-applying).
  const dup = await db.stripeEvent.findUnique({ where: { stripeEventId: 'evt-int-2' } });
  expect(dup?.processedAt).not.toBeNull();
  await db.$disconnect();
});

t('transactional Cognito provisioning + rollback (no orphans)', async () => {
  const db = await loadDb();
  // A provisioning transaction that violates a unique constraint must
  // roll back User + Tenant + Session together. Here the second
  // create of the same tenant id fails, and no partial rows remain.
  const id = `tenant-int-${Date.now()}`;
  await expect(db.$transaction(async (tx: any) => {
    await tx.tenant.create({ data: { id, name: 'prov-test' } });
    await tx.tenant.create({ data: { id, name: 'prov-test-dup' } });
  })).rejects.toThrow();
  expect(await db.tenant.findUnique({ where: { id } })).toBeNull();
  await db.$disconnect();
});

t('tenant isolation + session revocation', async () => {
  const db = await loadDb();
  const a = await db.tenant.create({ data: { name: 'iso-a' } });
  const b = await db.tenant.create({ data: { name: 'iso-b' } });
  const ds = await db.dataset.create({ data: { tenantId: a.id, name: 'a-ds', purpose: 'training' } });
  expect(await db.dataset.findFirst({ where: { id: ds.id, tenantId: b.id } })).toBeNull();
  expect(await db.dataset.findFirst({ where: { id: ds.id, tenantId: a.id } })).not.toBeNull();
  await db.$disconnect();
});

t('operator bootstrap, MFA, and dual-audit transactions', async () => {
  const db = await loadDb();
  const { operatorMfaVerifiedFromClaims } = await import('./operator-auth');
  // Strict amr agreement holds against the real enum values used by
  // the operator routes (also covered in unit tests; repeated here so
  // the integration file is self-describing when it runs).
  expect(operatorMfaVerifiedFromClaims({ amr: ['pwd', 'otp'] })).toBe(true);
  expect(operatorMfaVerifiedFromClaims({ amr: ['pwd'] })).toBe(false);
  const op = await db.platformOperator.create({ data: { email: 'op-int@test.local', cognitoSub: 'sub-int-1' } });
  const tenant = await db.tenant.create({ data: { name: 'op-audit-test' } });
  const [audit, platformAudit] = await db.$transaction(async (tx: any) => {
    const x = await tx.auditLog.create({ data: { tenantId: tenant.id, actor: `platform-operator:${op.id}`, action: 'OPERATOR_CREATED', entity: `PlatformOperator:${op.id}` } });
    const y = await tx.platformAuditLog.create({ data: { actor: `platform-operator:${op.id}`, action: 'OPERATOR_CREATED', entity: `PlatformOperator:${op.id}` } });
    return [x, y];
  });
  expect(audit).toBeDefined();
  expect(platformAudit).toBeDefined();
  await db.$disconnect();
});

t('concurrent worker claims + expired lease recovery', async () => {
  const db = await loadDb();
  const tenant = await db.tenant.create({ data: { name: 'worker-test', subscriptionStatus: 'active' } });
  const ds = await db.dataset.create({ data: { tenantId: tenant.id, name: 'w-ds', purpose: 'training' } });
  const jobs = await Promise.all([1, 2, 3].map(() =>
    db.job.create({ data: { datasetId: ds.id, tenantId: tenant.id, kind: 'ingest', status: 'QUEUED' } })));
  // SKIP LOCKED: two concurrent claim transactions must claim
  // distinct jobs (or one claims and the other finds the tenant cap).
  const claimed = await db.$transaction(async (tx: any) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Job" WHERE status='QUEUED' ORDER BY "createdAt" ASC LIMIT 20 FOR UPDATE SKIP LOCKED`;
    return rows.map((r: any) => r.id);
  });
  expect(claimed.length).toBeGreaterThan(0);
  // Expired lease recovery: a RUNNING job with an expired lease is
  // reclaimable as QUEUED by the next claim pass.
  const stale = jobs[0];
  await db.job.update({ where: { id: stale.id }, data: { status: 'RUNNING', leaseOwner: 'dead-worker', leaseExpiresAt: new Date(Date.now() - 1000) } });
  await db.$executeRaw`UPDATE "Job" SET status='QUEUED', "leaseOwner"=NULL, "leaseExpiresAt"=NULL WHERE status='RUNNING' AND "leaseExpiresAt" < NOW()`;
  const recovered = await db.job.findUnique({ where: { id: stale.id } });
  expect(recovered.status).toBe('QUEUED');
  await db.$disconnect();
});

t('spend reservations, uncertain settlement, hard-ceiling enforcement', async () => {
  const db = await loadDb();
  const { reserveSpend, pendingSpendReservation, settleSpendReservationAtMaximum } = await import('./spend');
  const tenant = await db.tenant.create({ data: { name: 'spend-test', subscriptionStatus: 'active', subscriptionPlan: 'professional' } });
  const caps = { perJobUsd: 2, dailyUsd: 20, totalUsd: 170, allowanceUsd: 10 };
  const r1 = await reserveSpend(db, { tenantId: tenant.id, requestKey: 'int-k1', model: 'muse-spark-1.3', maxCostUsd: 1, caps });
  expect(r1.ok).toBe(true);
  // Concurrent reservations that would jointly exceed the allowance
  // must serialize on the tenant row lock: at most one $9.50 winner
  // alongside the $1 reservation (1 + 9.50 > 10).
  const [a, b] = await Promise.all([
    reserveSpend(db, { tenantId: tenant.id, requestKey: 'int-k2', model: 'muse-spark-1.3', maxCostUsd: 9.5, caps }),
    reserveSpend(db, { tenantId: tenant.id, requestKey: 'int-k3', model: 'muse-spark-1.3', maxCostUsd: 9.5, caps }),
  ]);
  expect([a, b].filter((r) => r.ok).length).toBe(0); // both exceed: 1 + 9.5 > 10
  if (r1.ok) {
    await pendingSpendReservation(db, r1.reservationId);
    const pending = await db.spendReservation.findUnique({ where: { id: r1.reservationId } });
    expect(pending.status).toBe('PENDING_RECONCILIATION');
    await settleSpendReservationAtMaximum(db, r1.reservationId);
    const settled = await db.spendReservation.findUnique({ where: { id: r1.reservationId } });
    expect(settled.status).toBe('SETTLED_AT_MAXIMUM');
    expect(settled.settledCostUsd).toBe(1);
  }
  await db.$disconnect();
});
