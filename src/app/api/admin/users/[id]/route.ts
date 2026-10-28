/* eslint-disable @typescript-eslint/no-explicit-any */
// PATCH /api/admin/users/[id] { role?, disabled? } — operator user
// role/status. Last-admin protection: demoting or disabling the last
// active admin of a tenant is 409 LAST_ADMIN (a tenant must always
// retain an admin). Revocation deletes that user's sessions in the
// same transaction (existing sessions then fail). Dual-audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (body?.role !== undefined && body.role !== 'admin' && body.role !== 'member') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  if (body?.disabled !== undefined && typeof body.disabled !== 'boolean') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  if (body?.role === undefined && body?.disabled === undefined) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const demotingAdmin = user.role === 'admin' && body.role === 'member';
  const disablingAdmin = user.role === 'admin' && body.disabled === true && !user.disabledAt;
  if (demotingAdmin || disablingAdmin) {
    const otherAdmins = await db.user.count({ where: { tenantId: user.tenantId, role: 'admin', disabledAt: null, id: { not: id } } });
    if (otherAdmins === 0) return NextResponse.json({ error: 'LAST_ADMIN' }, { status: 409 });
  }
  const now = new Date();
  const updated = await db.$transaction(async (tx: any) => {
    const u = await tx.user.update({ where: { id }, data: { ...(body.role !== undefined ? { role: body.role } : {}), ...(body.disabled !== undefined ? { disabledAt: body.disabled ? now : null } : {}) } });
    if (body.disabled === true) {
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({ data: { tenantId: user.tenantId, actor: `platform-operator:${s.operator.id}`, action: 'SESSION_REVOKED', entity: `User:${id}`, details: { reason: 'operator-disable' } } });
    }
    return u;
  });
  await operatorAudit(db, { operatorId: s.operator.id, action: 'USER_ROLE_STATUS_CHANGED', entity: `User:${id}`, tenantId: user.tenantId, details: { role: body.role ?? undefined, disabled: body.disabled ?? undefined } });
  return NextResponse.json({ id: updated.id, email: updated.email, tenantId: updated.tenantId, role: updated.role, disabledAt: updated.disabledAt });
}
