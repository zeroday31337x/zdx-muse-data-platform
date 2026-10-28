/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
import { entitlementGate, graceRestrictionActive } from '@/lib/billing';
import { ensureGraceRestriction } from '@/lib/grace';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const ds = await datasetForTenant(id, s.user.tenantId);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const db = prisma();
  // Approval mutates tenant data (it applies repairedData to a record), so
  // it is gated as new local work: denied for canceled/unpaid/paused
  // tenants and under grace expiry, like ingest. (Reject stays
  // owner-allowed: it only declines a case and changes no tenant data.)
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const gate = entitlementGate(tenant.subscriptionStatus as string, 'ingest');
  if (!gate.allowed) return NextResponse.json({ error: gate.code, status: tenant.subscriptionStatus }, { status: 402 });
  const graceTenant = await ensureGraceRestriction(db, tenant);
  if (graceRestrictionActive(graceTenant)) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: tenant.subscriptionStatus, restriction: 'GRACE_EXPIRED_UNVERIFIED' }, { status: 402 });
  const c = await db.repairCase.findFirst({ where: { id: caseId, datasetId: id } });
  if (!c || c.status !== 'open') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!c.repairedData) return NextResponse.json({ error: 'NO_REPAIRED_DATA', message: 'Case has no repairedData to apply.' }, { status: 409 });
  const rec = await db.record.findFirst({ where: { id: c.recordId, datasetId: id } });
  if (!rec) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // Provenance is NOT changed by repair: human approval is recorded in
  // meta, and the repair case id is retained for audit.
  const updated = await db.$transaction(async (tx: any) => {
    const meta = { ...((rec.meta as Record<string, unknown>) ?? {}), repaired: true, repairCaseId: c.id, repairedAt: new Date().toISOString() };
    const r = await tx.record.update({ where: { id: rec.id }, data: { data: c.repairedData, meta } });
    const cc = await tx.repairCase.update({ where: { id: c.id }, data: { status: 'approved' } });
    return { record: r, case: cc };
  });
  return NextResponse.json(updated);
}
