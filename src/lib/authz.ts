// Authorization helpers for DB-backed routes.
// Rules, from the repo AGENTS.md security invariant:
// - Tenant identity comes ONLY from the authenticated session, never
//   from a client-supplied tenant id, query param, or body field.
// - A resource belonging to another tenant is indistinguishable from
//   a missing resource: routes return 404, never 403 with a tenant
//   hint, and never the resource itself.
// - Unauthenticated requests get 401; DB-unconfigured requests get
//   503 (the caller decides whether to fall back to demo file mode,
//   which is explicitly demo-only and must never hold private data).
// - The worker endpoint is NOT session-authenticated: it uses a
//   separate service secret, so a browser session can never drive
//   the worker directly.
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getSessionFromCookie } from './auth';
import { dbConfigured, prisma } from './db';

export type SessionUser = { id: string; email: string; tenantId: string; role: string; provider: 'db' | 'cognito' };

export async function requireSession(req: Request): Promise<{ user: SessionUser } | { response: Response }> {
  if (!dbConfigured()) {
    return { response: NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 }) };
  }
  const session = await getSessionFromCookie(req.headers.get('cookie'));
  if (!session) {
    return { response: NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  return { user: { id: session.user.id, email: session.user.email, tenantId: session.user.tenantId, role: session.user.role, provider: session.provider === 'cognito' ? 'cognito' : 'db' } };
}

/** Tenant-admin gate: same tenant + role 'admin'. Cross-tenant = 404. */
export async function requireTenantAdmin(req: Request, tenantId: string): Promise<{ user: SessionUser } | { response: Response }> {
  const s = await requireSession(req);
  if (!('user' in s)) return s;
  if (s.user.tenantId !== tenantId) return { response: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) };
  if (s.user.role !== 'admin') return { response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  return s;
}

export function isSessionResult(v: { user: SessionUser } | { response: Response }): v is { user: SessionUser } {
  return 'user' in v;
}

/** Load a dataset only if it belongs to this tenant; otherwise null (404). */
export async function datasetForTenant(datasetId: string, tenantId: string) {
  const db = prisma();
  return db.dataset.findFirst({ where: { id: datasetId, tenantId } });
}

/** Load a job only if it belongs to this tenant; otherwise null (404). */
export async function jobForTenant(jobId: string, tenantId: string) {
  const db = prisma();
  return db.job.findFirst({ where: { id: jobId, tenantId } });
}

/** Composition counts for one dataset, from committed DB records only. */
export async function compositionDb(datasetId: string) {
  const db = prisma();
  const counts = await db.record.groupBy({ by: ['provenance'], where: { datasetId }, _count: { _all: true } });
  const by = new Map<string, number>(counts.map((c: { provenance: string; _count: { _all: number } }) => [String(c.provenance), Number(c._count._all)]));
  const authentic = by.get('AUTHENTIC_VERIFIED') ?? 0;
  const synthetic = (by.get('SYNTHETIC') ?? 0) + (by.get('AI_AUGMENTED') ?? 0);
  const unknown = (by.get('UNKNOWN') ?? 0) + (by.get('AUTHENTIC_UNVERIFIED') ?? 0);
  const total = authentic + synthetic + unknown + (by.get('DERIVED_SOURCE_PRESERVING') ?? 0);
  // Token-weighted counts, for reporting only (record gate is primary).
  const rows = await db.record.findMany({ where: { datasetId }, select: { provenance: true, tokens: true } });
  let authenticTokens = 0;
  let syntheticTokens = 0;
  for (const r of rows) {
    if (r.provenance === 'AUTHENTIC_VERIFIED') authenticTokens += r.tokens;
    if (r.provenance === 'SYNTHETIC' || r.provenance === 'AI_AUGMENTED') syntheticTokens += r.tokens;
  }
  return { authentic, synthetic, unknown, total, authenticTokens, syntheticTokens };
}

/** Worker service authentication: timing-safe compare against WORKER_SECRET. */
export function workerAuth(req: Request): { ok: true } | { response: Response } {
  const secret = process.env.WORKER_SECRET;
  if (!secret) {
    return { response: NextResponse.json({ error: 'WORKER_NOT_CONFIGURED', message: 'Set WORKER_SECRET on the server; the worker endpoint is never open without it.' }, { status: 503 }) };
  }
  const provided = req.headers.get('x-worker-secret') ?? '';
  // Constant-time compare on equal-length buffers; length mismatch is a fail.
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { response: NextResponse.json({ error: 'WORKER_UNAUTHORIZED' }, { status: 401 }) };
    }
  } catch {
    return { response: NextResponse.json({ error: 'WORKER_UNAUTHORIZED' }, { status: 401 }) };
  }
  return { ok: true };
}
