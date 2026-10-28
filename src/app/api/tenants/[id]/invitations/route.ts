/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
import { audit } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// POST /api/tenants/[id]/invitations — tenant-admin only; [id] must
// equal the session tenantId, else 404 (cross-tenant is
// indistinguishable from missing). Same-tenant non-admin → 403.
// Role is capped at 'member'. The raw token is shown ONCE; only the
// hash is persisted. Expiry 7 days.
const schema = z.object({ email: z.string().email(), role: z.string().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const { id } = await ctx.params;
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.tenantId !== id) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const inv = await db.tenantInvitation.create({
    data: {
      tenantId: id,
      email: parsed.data.email.toLowerCase(),
      role: 'member',
      tokenHash,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  });
  await audit(id, s.user.email, 'invitation.created', `TenantInvitation:${inv.id}`, { email: parsed.data.email.toLowerCase() });
  return NextResponse.json({ id: inv.id, email: inv.email, role: inv.role, status: 'pending', expiresAt: inv.expiresAt, token: rawToken });
}
