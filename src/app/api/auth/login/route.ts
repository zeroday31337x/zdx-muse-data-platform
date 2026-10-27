import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, dbConfigured } from '@/lib/db';
import { verifyPassword, newSessionToken, sessionCookie, audit } from '@/lib/auth';
export const dynamic = 'force-dynamic';
const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED', message: 'Auth requires PostgreSQL. Set DATABASE_URL.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
  const { token, tokenHash } = newSessionToken();
  await db.session.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) } });
  await audit(user.tenantId, user.email, 'auth.login', `user:${user.id}`);
  const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, tenantId: user.tenantId, role: user.role } });
  res.headers.set('Set-Cookie', sessionCookie(token));
  return res;
}
