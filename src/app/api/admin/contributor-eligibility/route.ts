/* eslint-disable @typescript-eslint/no-explicit-any */
// GET/POST /api/admin/contributor-eligibility — operator grant/revoke
// of tenant Contributor eligibility (revised §2.4). The eligibility
// RECORD is the source of truth. Grant requires a reason (attestation
// evidence reviewed). Attesting dataset consent is a separate tenant
// action and does not grant eligibility. Dual-audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? undefined;
  const db = prisma();
  const rows = await db.contributorEligibility.findMany({ where: tenantId ? { tenantId } : undefined, take: 200, orderBy: { grantedAt: 'desc' } });
  return NextResponse.json({ eligibility: rows });
}
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.tenantId !== 'string' || typeof body?.eligible !== 'boolean' || typeof body?.reason !== 'string' || body.reason.trim().length < 3) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: body.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const now = new Date();
  const row = await db.contributorEligibility.upsert({
    where: { tenantId: body.tenantId },
    create: { tenantId: body.tenantId, eligible: body.eligible, grantedBy: s.operator.id, grantedAt: now, reason: body.reason, revokedBy: body.eligible ? null : s.operator.id, revokedAt: body.eligible ? null : now },
    update: { eligible: body.eligible, grantedBy: body.eligible ? s.operator.id : undefined, grantedAt: body.eligible ? now : undefined, reason: body.reason, revokedBy: body.eligible ? null : s.operator.id, revokedAt: body.eligible ? null : now },
  });
  await operatorAudit(db, { operatorId: s.operator.id, action: body.eligible ? 'CONTRIBUTOR_ELIGIBILITY_GRANTED' : 'CONTRIBUTOR_ELIGIBILITY_REVOKED', entity: `Tenant:${body.tenantId}`, tenantId: body.tenantId, details: { reason: body.reason } });
  return NextResponse.json({ tenantId: row.tenantId, eligible: row.eligible, reason: row.reason });
}
