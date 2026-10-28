/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/workflows/jobs/[id] { action } — operator workflow
// control. Actions: pause, resume, cancel, retry, reclaim-lease.
// Transitions use the canonical state machine (canTransition); an
// illegal transition is 409. reclaim-lease works ONLY for expired
// leases (isStalledLease) — a live lease is never stolen. Pause
// preserves the checkpoint. Dual-audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
import { canTransition, isStalledLease } from '@/lib/worker-transitions';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  const action = body?.action;
  if (!['pause', 'resume', 'cancel', 'retry', 'reclaim-lease'].includes(action)) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  const db = prisma();
  const job = await db.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  let target: string | null = null;
  let clearLease = false;
  if (action === 'pause') { target = canTransition(job.status, 'PAUSED') ? 'PAUSED' : null; clearLease = true; }
  if (action === 'resume') { target = canTransition(job.status, 'QUEUED') ? 'QUEUED' : null; clearLease = true; }
  if (action === 'cancel') {
    if (job.status === 'RUNNING') target = 'CANCELLING'; // worker finishes to CANCELLED
    else target = canTransition(job.status, 'CANCELLED') ? 'CANCELLED' : null;
    clearLease = target === 'CANCELLED';
  }
  if (action === 'retry') { target = canTransition(job.status, 'QUEUED') ? 'QUEUED' : null; clearLease = true; }
  if (action === 'reclaim-lease') {
    if (!isStalledLease(job)) return NextResponse.json({ error: 'LEASE_NOT_STALLED' }, { status: 409 });
    target = 'QUEUED'; clearLease = true;
  }
  if (!target) return NextResponse.json({ error: 'INVALID_TRANSITION' }, { status: 409 });
  const updated = await db.job.update({ where: { id }, data: { status: target as any, ...(clearLease ? { leaseOwner: null, leaseExpiresAt: null } : {}) } });
  await operatorAudit(db, { operatorId: s.operator.id, action: `JOB_${action.toUpperCase()}`, entity: `Job:${id}`, tenantId: job.tenantId, details: { from: job.status, to: target } });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
