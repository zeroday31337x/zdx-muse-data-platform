/* eslint-disable @typescript-eslint/no-explicit-any */
// GET/PATCH /api/admin/platform-settings — versioned settings.
// GET returns current values (LOCKED keys listed as locked, values
// never editable). PATCH { key, value, note? }: locked key → 403
// SETTING_LOCKED; unknown key → 400; above-hard-ceiling cap → 400
// SETTING_ABOVE_HARD_CEILING. Every write appends a
// PlatformSettingVersion row in the same transaction (append-only
// history; no update/delete route exists for versions).
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
import { EDITABLE_SETTING_KEYS, isLockedSettingKey, validateSettingValue, ceilingCheck } from '@/lib/platform-settings';
import { hardCeiling } from '@/lib/tier-allowlist';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const db = prisma();
  const rows = await db.platformSetting.findMany({ take: 200, orderBy: { key: 'asc' } });
  return NextResponse.json({ settings: rows, editableKeys: Object.keys(EDITABLE_SETTING_KEYS), note: 'Locked keys (70/30, isolation, provenance, secrets, audit append-only, entitlement derivation, tier allowlist, resource limits, hard ceiling) are read-only and rejected on write.' });
}
export async function PATCH(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  const key = body?.key;
  if (typeof key !== 'string' || key.length === 0) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  if (isLockedSettingKey(key) || !EDITABLE_SETTING_KEYS[key]) return NextResponse.json({ error: 'SETTING_LOCKED' }, { status: 403 });
  const shapeError = validateSettingValue(key, body.value);
  if (shapeError) return NextResponse.json({ error: shapeError }, { status: shapeError === 'SETTING_LOCKED' ? 403 : 400 });
  const ceiling = hardCeiling();
  const ceilingError = ceilingCheck(key, body.value, ceiling.perJobUsd);
  if (ceilingError) return NextResponse.json({ error: ceilingError }, { status: 400 });
  const db = prisma();
  const row = await db.$transaction(async (tx: any) => {
    const r = await tx.platformSetting.upsert({ where: { key }, create: { key, value: body.value, updatedBy: s.operator.id }, update: { value: body.value, updatedBy: s.operator.id } });
    await tx.platformSettingVersion.create({ data: { key, value: body.value, changedBy: s.operator.id, note: typeof body.note === 'string' ? body.note.slice(0, 500) : null } });
    return r;
  });
  await operatorAudit(db, { operatorId: s.operator.id, action: 'PLATFORM_SETTING_CHANGED', entity: `PlatformSetting:${key}` });
  return NextResponse.json({ key: row.key, value: row.value });
}
