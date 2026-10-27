import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const ds = await datasetForTenant(id, s.user.tenantId);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const db = prisma();
  const c = await db.repairCase.findFirst({ where: { id: caseId, datasetId: id } });
  if (!c || c.status !== 'open') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const updated = await db.repairCase.update({ where: { id: c.id }, data: { status: 'rejected' } });
  return NextResponse.json(updated);
}
