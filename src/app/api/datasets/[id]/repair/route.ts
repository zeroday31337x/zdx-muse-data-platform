import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
import { entitlementGate, graceRestrictionActive } from '@/lib/billing';
import { ensureGraceRestriction } from '@/lib/grace';
export const dynamic = 'force-dynamic';
const schema = z.object({ recordId: z.string().min(1), issue: z.string().min(1).max(1000), repairedData: z.record(z.string(), z.unknown()).optional() });
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED', note: 'Repair cases require the PostgreSQL store.' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const ds = await datasetForTenant(id, s.user.tenantId);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const db = prisma();
  const cases = await db.repairCase.findMany({ where: { datasetId: id }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(cases);
}
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const ds = await datasetForTenant(id, s.user.tenantId);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  const db = prisma();
  // Creating a case is new workflow work (it stages a future data
  // mutation), so it is gated like ingest: denied for canceled/unpaid/
  // paused tenants and under grace expiry. Approval is gated the same
  // way; reject stays owner-allowed (it only declines a case).
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const gate = entitlementGate(tenant.subscriptionStatus as string, 'ingest');
  if (!gate.allowed) return NextResponse.json({ error: gate.code, status: tenant.subscriptionStatus }, { status: 402 });
  const graceTenant = await ensureGraceRestriction(db, tenant);
  if (graceRestrictionActive(graceTenant)) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: tenant.subscriptionStatus, restriction: 'GRACE_EXPIRED_UNVERIFIED' }, { status: 402 });
  const rec = await db.record.findFirst({ where: { id: parsed.data.recordId, datasetId: id } });
  if (!rec) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // Creating a case never changes data. Approval is a separate, explicit step.
  const c = await db.repairCase.create({ data: { datasetId: id, recordId: parsed.data.recordId, issue: parsed.data.issue, repairedData: parsed.data.repairedData ?? null } });
  return NextResponse.json(c, { status: 201 });
}
