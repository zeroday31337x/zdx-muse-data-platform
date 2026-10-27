import { NextResponse } from 'next/server';
import { dbConfigured } from '@/lib/db';
import { requestCancel } from '@/lib/worker';
export const dynamic = 'force-dynamic';
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const { id } = await ctx.params;
  const r = await requestCancel(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
