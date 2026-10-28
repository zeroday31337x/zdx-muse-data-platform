/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/audit — append-only platform audit search (filters:
// tenantId, actor, action, from, to; take ≤ 200). There is NO delete
// or update route for audit rows, by design.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? undefined;
  const actor = url.searchParams.get('actor') ?? undefined;
  const action = url.searchParams.get('action') ?? undefined;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const take = Math.min(Math.max(Number(url.searchParams.get('take') ?? '100') || 100, 1), 200);
  const db = prisma();
  const rows = await db.platformAuditLog.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(actor ? { actor: { contains: actor } } : {}),
      ...(action ? { action } : {}),
      ...((from || to) ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    },
    take, orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ audit: rows });
}
