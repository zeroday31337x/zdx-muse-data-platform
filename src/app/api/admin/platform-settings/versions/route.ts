/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/platform-settings/versions — append-only version
// history (filter: key). No write route exists for versions.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? undefined;
  const db = prisma();
  const rows = await db.platformSettingVersion.findMany({ where: key ? { key } : undefined, take: 200, orderBy: { changedAt: 'desc' } });
  return NextResponse.json({ versions: rows });
}
