/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/operators/[id]/status { disabled: boolean }.
// Guards: an operator cannot disable THEMSELVES (a second operator
// must do it); the last active operator cannot be disabled (409).
// Disabling deletes ALL of that operator's sessions in the same
// transaction (revocation). Platform-audited.
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
  if (body.disabled && id === s.operator.id) {
    return NextResponse.json({ error: 'CANNOT_DISABLE_SELF', note: 'Self-disable requires a second operator.' }, { status: 403 });
  }
  const db = prisma();
  const target = await db.platformOperator.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (body.disabled && !target.disabledAt) {
    const otherActive = await db.platformOperator.count({ where: { disabledAt: null, id: { not: id } } });
    if (otherActive === 0) return NextResponse.json({ error: 'LAST_OPERATOR' }, { status: 409 });
  }
  const now = new Date();
  await db.$transaction(async (tx: any) => {
    await tx.platformOperator.update({ where: { id }, data: { disabledAt: body.disabled ? now : null } });
    if (body.disabled) await tx.platformOperatorSession.deleteMany({ where: { operatorId: id } });
  });
  await operatorAudit(db, { operatorId: s.operator.id, action: body.disabled ? 'OPERATOR_DISABLED' : 'OPERATOR_ENABLED', entity: `PlatformOperator:${id}` });
  return NextResponse.json({ id, disabled: body.disabled });
}
