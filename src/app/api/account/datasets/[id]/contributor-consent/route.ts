/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/account/datasets/[id]/contributor-consent — tenant admin
// attests or revokes Contributor consent for their OWN dataset
// (revised §2.4/§4.2). Body { consented: boolean }. Scope is fixed
// 'public-demo-only' in v1. Attesting consent does NOT grant tenant
// eligibility and does NOT authorize Contributor by itself; the
// resolver requires BOTH eligibility and consent at call time.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const ds = await datasetForTenant(id, s.user.tenantId);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.consented !== 'boolean') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const now = new Date();
  const consent = await db.datasetContributorConsent.upsert({
    where: { datasetId: id },
    create: {
      datasetId: id, tenantId: s.user.tenantId, consented: body.consented,
      consentedBy: s.user.id, consentedAt: body.consented ? now : null, scope: 'public-demo-only',
      revokedBy: body.consented ? null : s.user.id, revokedAt: body.consented ? null : now,
    },
    update: {
      tenantId: s.user.tenantId, consented: body.consented,
      consentedBy: s.user.id, consentedAt: body.consented ? now : null,
      revokedBy: body.consented ? null : s.user.id, revokedAt: body.consented ? null : now,
    },
  });
  await db.auditLog.create({ data: { tenantId: s.user.tenantId, actor: `user:${s.user.id}`, action: body.consented ? 'CONTRIBUTOR_CONSENT_GRANTED' : 'CONTRIBUTOR_CONSENT_REVOKED', entity: `Dataset:${id}`, details: { scope: 'public-demo-only' } } });
  return NextResponse.json({ datasetId: id, consented: consent.consented, scope: consent.scope, consentedAt: consent.consentedAt });
}
