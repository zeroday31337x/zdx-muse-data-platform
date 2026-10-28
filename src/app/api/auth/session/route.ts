import { NextResponse } from 'next/server';
import { getSessionFromCookie } from '@/lib/auth';
import { dbConfigured } from '@/lib/db';
export const dynamic = 'force-dynamic';

// Canonical session shape (contract §3a): /me plus authProvider and
// hasCognitoLink (boolean presence flag only). /me stays frozen.
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ authenticated: false, mode: 'demo-no-db' });
  const session = await getSessionFromCookie(req.headers.get('cookie'));
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  const user = session.user;
  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      provider: session.provider === 'cognito' ? 'cognito' : 'db',
      authProvider: session.provider === 'cognito' ? 'cognito' : 'db',
      hasCognitoLink: Boolean(user.cognitoSub),
    },
  });
}
