import { NextResponse } from 'next/server';
import { requireSession, isSessionResult, jobForTenant } from '@/lib/authz';
import { requestCancel } from '@/lib/worker';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const { id } = await ctx.params;
  const job = await jobForTenant(id, s.user.tenantId);
  if (!job) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const r = await requestCancel(id, s.user.tenantId);
  if (!r.ok && r.error === 'NOT_FOUND') return NextResponse.json(r, { status: 404 });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
