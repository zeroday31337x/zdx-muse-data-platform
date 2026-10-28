/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/account/invitations/[id]/revoke — tenant-admin revokes
// their OWN tenant's invitation (status 'revoked'; accept then 404s
// generically). Cross-tenant id → 404. Audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(_req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const db = prisma();
  const inv = await db.tenantInvitation.findFirst({ where: { id, tenantId: s.user.tenantId } });
  if (!inv) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const updated = await db.tenantInvitation.update({ where: { id }, data: { status: 'revoked' } });
  await db.auditLog.create({ data: { tenantId: s.user.tenantId, actor: `user:${s.user.id}`, action: 'INVITATION_REVOKED', entity: `TenantInvitation:${id}`, details: {} } });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
