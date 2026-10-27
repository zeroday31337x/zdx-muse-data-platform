import { NextResponse } from 'next/server';
import { loadStore } from '@/lib/store';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const db = prisma();
    const jobs = await db.job.findMany({ where: { tenantId: s.user.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return NextResponse.json(jobs);
  }
  const s = loadStore(); return NextResponse.json(s.jobs.slice(-50).reverse());
}
