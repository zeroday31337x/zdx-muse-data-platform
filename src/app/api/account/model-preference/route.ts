/* eslint-disable @typescript-eslint/no-explicit-any */
// PATCH /api/account/model-preference — tenant-admin sets the tenant
// model default (revised §2.5/§4.2). Body { model: string | null }
// ONLY. The value is validated against the server-side tier allowlist
// on write AND re-validated on every call by the resolver; an outside-
// allowlist value is a generic 400 that does NOT enumerate the
// allowlist. Null clears the preference (tier default then applies).
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
import { allowlistForTenant } from '@/lib/tier-allowlist';
export const dynamic = 'force-dynamic';
export async function PATCH(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  const model = body?.model ?? null;
  if (model !== null && (typeof model !== 'string' || model.length === 0 || model.length > 100)) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  if (model !== null) {
    const allowlist = allowlistForTenant(tenant);
    if (!allowlist.text.includes(model)) {
      // Generic 400 — never enumerates the allowlist.
      return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }
  }
  const updated = await db.tenant.update({ where: { id: tenant.id }, data: { modelPreference: model } });
  await db.auditLog.create({ data: { tenantId: tenant.id, actor: `user:${s.user.id}`, action: 'MODEL_PREFERENCE_CHANGED', entity: `Tenant:${tenant.id}`, details: { modelPreferenceSet: model !== null } } });
  return NextResponse.json({ modelPreference: updated.modelPreference ?? null });
}
