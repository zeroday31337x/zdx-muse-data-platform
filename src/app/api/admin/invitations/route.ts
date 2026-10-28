/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/invitations { tenantId, email, role? } — operator
// creates an invitation for a tenant. Role capped at member. Raw token
// shown once; only tokenHash persisted; 7-day expiry. Dual-audited.
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.tenantId !== 'string' || typeof body?.email !== 'string' || !body.email.includes('@')) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: body.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const inv = await db.tenantInvitation.create({ data: { tenantId: body.tenantId, email: body.email.toLowerCase(), role: 'member', tokenHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  await operatorAudit(db, { operatorId: s.operator.id, action: 'INVITATION_CREATED', entity: `TenantInvitation:${inv.id}`, tenantId: body.tenantId, details: { email: body.email.toLowerCase() } });
  return NextResponse.json({ id: inv.id, tenantId: inv.tenantId, email: inv.email, role: inv.role, token: rawToken, expiresAt: inv.expiresAt, note: 'Raw token shown once; store it now. It is not retrievable later.' });
}
