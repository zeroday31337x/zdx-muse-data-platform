// GET/PATCH /api/admin/tier-allowlist — v1: READ-ONLY view of the
// server-side tier allowlist (from server config, not the DB).
// PATCH is 403 SETTING_LOCKED in v1: allowlist changes are config
// changes (separate approval + redeploy), not dashboard writes, so
// the allowlist can never be widened from the dashboard alone.
// Per-job caps shown are PROPOSED, not approved policy.
import { NextResponse } from 'next/server';
import { dbConfigured } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
import { TIER_ALLOWLISTS, hardCeiling } from '@/lib/tier-allowlist';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const ceiling = hardCeiling();
  return NextResponse.json({ allowlists: TIER_ALLOWLISTS, perJobBudgetCapsProposed: true, hardCeilingConfigured: ceiling.perJobUsd !== null || ceiling.dailyUsd !== null || ceiling.totalUsd !== null, note: 'Read-only in v1. Allowlist changes require a server config change + redeploy under separate approval.' });
}
export async function PATCH(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  return NextResponse.json({ error: 'SETTING_LOCKED', note: 'Tier allowlist is server config in v1; dashboard edits are locked.' }, { status: 403 });
}
