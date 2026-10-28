/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
import { audit } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// POST /api/auth/invitations/accept — authenticated. Body {token}.
// Hash the token; pending + unexpired + addressed to the signed-in
// user's email (case-insensitive), else generic 404 (no enumeration);
// expired → 410; tenant differs → 409 INVITATION_TENANT_MISMATCH
// (invitation stays pending, primary tenant unchanged). Accepting
// records acceptance; it does NOT change the user's primary tenant.
const schema = z.object({ token: z.string().min(1) });

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const inv = await db.tenantInvitation.findUnique({ where: { tokenHash } });
  if (!inv || inv.status !== 'pending' || inv.email.toLowerCase() !== s.user.email.toLowerCase()) {
    return NextResponse.json({ error: 'INVITATION_NOT_FOUND' }, { status: 404 });
  }
  if (inv.expiresAt < new Date()) {
    return NextResponse.json({ error: 'INVITATION_EXPIRED' }, { status: 410 });
  }
  if (inv.tenantId !== s.user.tenantId) {
    return NextResponse.json({ error: 'INVITATION_TENANT_MISMATCH' }, { status: 409 });
  }
  await db.tenantInvitation.update({ where: { id: inv.id }, data: { status: 'accepted', acceptedAt: new Date() } });
  await audit(s.user.tenantId, s.user.email, 'invitation.accepted', `TenantInvitation:${inv.id}`);
  return NextResponse.json({ ok: true });
}
