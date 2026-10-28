/* eslint-disable @typescript-eslint/no-explicit-any */
// Platform-operator authentication (revised spec §2.2). A SEPARATE
// principal from tenant User, with a SEPARATE cookie
// (zdx_operator_session) and a SEPARATE session table. Tenant cookies
// are never read here, so a tenant session can never be accepted on
// /api/admin/* — by construction, not by a flag check.
// MFA: mfaVerifiedAt records an authenticated Cognito MFA event (the
// verified ID token's amr, via mfaVerifiedFromClaims). Enrollment or
// a DB timestamp alone never verifies MFA. A session with null
// mfaVerifiedAt is MFA_PENDING and may call only mfa-status and the
// MFA redirect; every other /api/admin/* route returns 403
// MFA_REQUIRED. Disabled operators get 401 on every use.
// Session lifetime is PROPOSED 8 hours (not a decided value).
import { createHash, randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from './db';
import { readCookie, STRICT_MFA_AMR } from './cognito';

export const OPERATOR_COOKIE = 'zdx_operator_session';
export const OPERATOR_SESSION_MS = 8 * 60 * 60 * 1000; // PROPOSED
export const OPERATOR_ADMIN_GROUP = 'zdx-data-admin';

/**
 * Operator MFA interpretation (shared strict set with the tenant
 * helper since the 2026-10-27 compliance correction): verified only
 * when the authenticated token's amr contains a known second-factor
 * method. Absent amr, or amr=['pwd'] only, = NOT verified
 * (MFA_PENDING). This is the v1 interpretation of "MFA from an
 * authenticated Cognito MFA event"; the pool's MFA policy and amr
 * values must be confirmed at staging before operator journeys are
 * claimed working.
 */
// Re-exported so existing imports keep working.
export { STRICT_MFA_AMR as OPERATOR_MFA_AMR } from './cognito';
export function operatorMfaVerifiedFromClaims(claims: { amr?: string[] }): boolean {
  return (claims.amr ?? []).some((m) => STRICT_MFA_AMR.has(m));
}

export function hashOperatorToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function operatorSessionCookie(raw: string): string {
  return `${OPERATOR_COOKIE}=${raw}; HttpOnly; Path=/api/admin; SameSite=Lax; Secure; Max-Age=${Math.floor(OPERATOR_SESSION_MS / 1000)}`;
}

export function clearOperatorSessionCookie(): string {
  return `${OPERATOR_COOKIE}=; HttpOnly; Path=/api/admin; SameSite=Lax; Secure; Max-Age=0`;
}

export type OperatorSession = { operator: any; session: any };

/** Read + validate an operator session. Returns null for any failure
 * (no cookie, unknown token, expired, disabled operator) — all 401. */
export async function getOperatorSession(req: Request): Promise<OperatorSession | null> {
  const raw = readCookie(req.headers.get('cookie'), OPERATOR_COOKIE);
  if (!raw) return null;
  const db = prisma();
  let session: any;
  try {
    session = await db.platformOperatorSession.findUnique({ where: { tokenHash: hashOperatorToken(raw) }, include: { operator: true } });
  } catch { return null; }
  if (!session || !session.operator) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.operator.disabledAt) return null;
  return { operator: session.operator, session };
}

/**
 * Operator guard. allowMfaPending=true only for mfa-status and the
 * MFA redirect. Otherwise MFA_PENDING → 403 MFA_REQUIRED.
 * Returns { operator, session } or { response }.
 */
export async function requireOperator(req: Request, opts: { allowMfaPending?: boolean } = {}): Promise<OperatorSession | { response: Response }> {
  const s = await getOperatorSession(req);
  if (!s) return { response: NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!opts.allowMfaPending && !s.session.mfaVerifiedAt) {
    return { response: NextResponse.json({ error: 'MFA_REQUIRED' }, { status: 403 }) };
  }
  return s;
}

export function isOperatorResult(v: OperatorSession | { response: Response }): v is OperatorSession {
  return 'operator' in v;
}

/** Mint an operator session row + return the raw token for the cookie. */
export async function mintOperatorSession(operatorId: string, mfaVerified: boolean): Promise<{ raw: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OPERATOR_SESSION_MS);
  const db = prisma();
  await db.platformOperatorSession.create({
    data: { operatorId, tokenHash: hashOperatorToken(raw), mfaVerifiedAt: mfaVerified ? now : null, expiresAt },
  });
  return { raw, expiresAt };
}

/** Dual-write audit: platform log AND tenant log for tenant-affecting
 * actions, actor 'platform-operator:<id>'. Never record bodies,
 * tokens, or secrets in details. */
export async function operatorAudit(db: any, input: { operatorId: string; action: string; entity: string; tenantId?: string | null; details?: Record<string, unknown> }) {
  const actor = `platform-operator:${input.operatorId}`;
  await db.platformAuditLog.create({ data: { actor, action: input.action, entity: input.entity, tenantId: input.tenantId ?? null, details: input.details ?? {} } });
  if (input.tenantId) {
    await db.auditLog.create({ data: { tenantId: input.tenantId, actor, action: input.action, entity: input.entity, details: input.details ?? {} } });
  }
}
