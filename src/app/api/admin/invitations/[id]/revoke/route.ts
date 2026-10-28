/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/invitations/[id]/revoke — sets status 'revoked'.
// The accept route already requires status 'pending', so a revoked
// invitation is then a generic 404 there (no oracle). Dual-audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(_req);
  if (!isOperatorResult(s)) return s.response;
  const db = prisma();
  const inv = await db.tenantInvitation.findUnique({ where: { id } });
  if (!inv) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const updated = await db.tenantInvitation.update({ where: { id }, data: { status: 'revoked' } });
  await operatorAudit(db, { operatorId: s.operator.id, action: 'INVITATION_REVOKED', entity: `TenantInvitation:${id}`, tenantId: inv.tenantId });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
