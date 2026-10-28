import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, dbConfigured } from '@/lib/db';
import { verifyPassword, newSessionToken, sessionCookie, audit } from '@/lib/auth';
import { checkRequestRate } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';
const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED', message: 'Auth requires PostgreSQL. Set DATABASE_URL.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  // Request rate (B2, PROPOSED values): IP key only — no session exists
  // yet. The denial is generic so it reveals nothing about credentials.
  if (checkRequestRate(req, null).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const db = prisma();
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  // No oracle: Cognito-only users (null password) and DB users with a
  // wrong password get the same generic 401. Disabled users likewise.
  if (!user || user.disabledAt || !user.passwordHash || user.authProvider === 'cognito' || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
  const { token, tokenHash } = newSessionToken();
  await db.session.create({ data: { userId: user.id, tokenHash, provider: 'db', expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) } });
  await audit(user.tenantId, user.email, 'auth.login', `user:${user.id}`);
  const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, tenantId: user.tenantId, role: user.role, provider: 'db' } });
  res.headers.set('Set-Cookie', sessionCookie(token));
  return res;
}
