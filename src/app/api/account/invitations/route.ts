/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/account/invitations { email } — tenant-admin creates an
// invitation for their OWN tenant. Role capped at member. Raw token
// shown once; only tokenHash persisted; 7-day expiry. Audited.
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.email !== 'string' || !body.email.includes('@')) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const inv = await db.tenantInvitation.create({ data: { tenantId: s.user.tenantId, email: body.email.toLowerCase(), role: 'member', tokenHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  await db.auditLog.create({ data: { tenantId: s.user.tenantId, actor: `user:${s.user.id}`, action: 'INVITATION_CREATED', entity: `TenantInvitation:${inv.id}`, details: { email: body.email.toLowerCase() } } });
  return NextResponse.json({ id: inv.id, email: inv.email, role: inv.role, token: rawToken, expiresAt: inv.expiresAt, note: 'Raw token shown once; store it now. It is not retrievable later.' });
}
