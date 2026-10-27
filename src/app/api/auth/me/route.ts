import { NextResponse } from 'next/server';
import { getSessionFromCookie } from '@/lib/auth';
import { dbConfigured } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ authenticated: false, mode: 'demo-no-db' });
  const session = await getSessionFromCookie(req.headers.get('cookie'));
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, user: { id: session.user.id, email: session.user.email, tenantId: session.user.tenantId, role: session.user.role } });
}
