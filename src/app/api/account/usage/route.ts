/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/account/usage — own-tenant usage summary from confirmed
// UsageLedger rows only (costUsd is confirmed cost; reservations and
// settled-at-maximum figures are NOT mixed in here). Metadata only.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const db = prisma();
  const rows = await db.usageLedger.findMany({ where: { tenantId: s.user.tenantId } });
  const total = (rows as any[]).reduce((sum: number, r: any) => sum + (r.costUsd ?? 0), 0);
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const today = (rows as any[]).filter((r: any) => new Date(r.createdAt) >= startOfDay).reduce((sum: number, r: any) => sum + (r.costUsd ?? 0), 0);
  const byModel: Record<string, { rows: number; costUsd: number; promptTokens: number; completionTokens: number }> = {};
  for (const r of rows as any[]) {
    const m = byModel[r.model] ?? { rows: 0, costUsd: 0, promptTokens: 0, completionTokens: 0 };
    m.rows += 1; m.costUsd += r.costUsd ?? 0; m.promptTokens += r.promptTokens ?? 0; m.completionTokens += r.completionTokens ?? 0;
    byModel[r.model] = m;
  }
  return NextResponse.json({ tenantId: s.user.tenantId, totalCostUsd: total, todayCostUsd: today, rows: rows.length, byModel, note: 'Confirmed cost only. Outstanding reservations are not included.' });
}
