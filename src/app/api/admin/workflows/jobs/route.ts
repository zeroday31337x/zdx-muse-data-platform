/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/workflows/jobs — cross-tenant job metadata list
// (status, kind, counts, error, lease state). No record bodies, no
// dataset contents.
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
  const status = url.searchParams.get('status') ?? undefined;
  const kind = url.searchParams.get('kind') ?? undefined;
  const db = prisma();
  const jobs = await db.job.findMany({ where: { ...(tenantId ? { tenantId } : {}), ...(status ? { status: status as any } : {}), ...(kind ? { kind } : {}) }, take: 200, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ jobs: (jobs as any[]).map((j: any) => ({ id: j.id, datasetId: j.datasetId, tenantId: j.tenantId, kind: j.kind, status: j.status, total: j.total, committed: j.committed, error: j.error, attempts: j.attempts, leaseOwner: j.leaseOwner, leaseExpiresAt: j.leaseExpiresAt, createdAt: j.createdAt, updatedAt: j.updatedAt })) });
}
