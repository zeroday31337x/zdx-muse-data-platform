// GET/PATCH /api/admin/resource-limits — v1: READ-ONLY view of the
// free-tier/VPS safety limits (PROPOSED values from server config).
// PATCH is 403 SETTING_LOCKED in v1, same reasoning as the tier
// allowlist: limit changes are config changes under separate
// approval, never dashboard writes.
import { NextResponse } from 'next/server';
import { dbConfigured } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
import { FREE_TIER_LIMITS_PROPOSED } from '@/lib/billing';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  return NextResponse.json({ limits: FREE_TIER_LIMITS_PROPOSED, proposed: true, note: 'All values PROPOSED, not approved policy. Read-only in v1.' });
}
export async function PATCH(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  return NextResponse.json({ error: 'SETTING_LOCKED', note: 'Resource limits are server config in v1; dashboard edits are locked.' }, { status: 403 });
}
