/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/tenants/[id]/status { disabled: boolean } — tenant
// disablement in v1 is per-user disablement (contract rule, branch 1
// decision C3): disabling a tenant disables ALL of its users (new
// sessions rejected, existing sessions fail the disabledAt check on
// every use); enabling clears all. No tenantDisabledAt column is
// added. Dual-audited. Jobs are NOT silently cancelled: revocation
// pauses in-flight jobs at the next batch boundary via the worker's
// claim-time revalidation (existing behaviour).
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.disabled !== 'boolean') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const now = new Date();
  await db.$transaction(async (tx: any) => {
    await tx.user.updateMany({ where: { tenantId: id }, data: { disabledAt: body.disabled ? now : null } });
    await tx.platformAuditLog.create({ data: { actor: `platform-operator:${s.operator.id}`, action: body.disabled ? 'TENANT_DISABLED' : 'TENANT_ENABLED', entity: `Tenant:${id}`, tenantId: id, details: {} } });
    await tx.auditLog.create({ data: { tenantId: id, actor: `platform-operator:${s.operator.id}`, action: body.disabled ? 'TENANT_DISABLED' : 'TENANT_ENABLED', entity: `Tenant:${id}`, details: {} } });
  });
  return NextResponse.json({ tenantId: id, disabled: body.disabled });
}
