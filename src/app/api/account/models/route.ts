/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/account/models — tenant-specific model availability.
// This is the SEPARATE authenticated endpoint from the revised spec
// §2.6. The public GET /api/models stays UNCHANGED (global allowlist
// + pricing, no session, no tenant filtering, no entitlement fields).
// This endpoint is own-tenant only: it never accepts a tenant id from
// the caller, never exposes another tenant's data, never exposes
// price IDs, customer IDs, or the hard-ceiling value.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
import { allowlistForTenant, tierKeyForTenant } from '@/lib/tier-allowlist';
import { MODEL_PRICING, metaConfigured } from '@/lib/meta';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const allowlist = allowlistForTenant(tenant);
  const configured = metaConfigured();
  // pricingNotes: verified prices only, text models only (code
  // pricing; re-verification pending before billing-adjacent display).
  const pricingNotes: Record<string, { inputPerM: number; outputPerM: number; source: string }> = {};
  for (const model of allowlist.text) {
    const p = (MODEL_PRICING as Record<string, any>)[model];
    if (p) pricingNotes[model] = { inputPerM: p.input, outputPerM: p.output, source: 'code-pricing-reverification-pending' };
  }
  let contributorEligible = false;
  try {
    const elig = await db.contributorEligibility.findUnique({ where: { tenantId: tenant.id } });
    contributorEligible = Boolean(elig?.eligible && !elig?.revokedAt);
  } catch { contributorEligible = false; }
  let contributorConsentedDatasets: string[] = [];
  try {
    const consents = await db.datasetContributorConsent.findMany({ where: { tenantId: tenant.id, consented: true, revokedAt: null } });
    contributorConsentedDatasets = consents.filter((c: any) => !c.expiresAt || c.expiresAt >= new Date()).map((c: any) => c.datasetId);
  } catch { contributorConsentedDatasets = []; }
  return NextResponse.json({
    planKey: tenant.subscriptionPlan ?? tierKeyForTenant(tenant),
    tierKey: tierKeyForTenant(tenant),
    allowedModels: { text: allowlist.text, image: allowlist.image, voice: allowlist.voice, sam: allowlist.sam, wonderEnabled: allowlist.wonder },
    defaultModel: allowlist.defaultModel,
    tenantPreference: tenant.modelPreference ?? null,
    configured,
    pricingNotes,
    contributorEligible,
    contributorConsentedDatasets,
  });
}
