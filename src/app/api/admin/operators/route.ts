/* eslint-disable @typescript-eslint/no-explicit-any */
// GET/POST /api/admin/operators — operator CRUD (metadata only).
// Creating an operator row does NOT grant access by itself: login
// still requires Cognito admin-group membership + the operator row +
// (for full access) an MFA event. Bootstrap: when NO operator exists,
// creation requires the server-side OPERATOR_BOOTSTRAP_TOKEN header
// (never in git/chat); if that env is unset, bootstrap is 503. Once
// an operator exists, only a full-MFA operator may create another.
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
function timingSafeEqualStr(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const db = prisma();
  const ops = await db.platformOperator.findMany({ take: 200, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ operators: (ops as any[]).map((o: any) => ({ id: o.id, email: o.email, disabledAt: o.disabledAt, createdAt: o.createdAt })) });
}
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const db = prisma();
  const count = await db.platformOperator.count();
  let actorId: string | null = null;
  if (count === 0) {
    const token = process.env.OPERATOR_BOOTSTRAP_TOKEN;
    const provided = req.headers.get('x-operator-bootstrap-token');
    if (!token || !provided || !timingSafeEqualStr(provided, token)) {
      return NextResponse.json({ error: token ? 'BOOTSTRAP_UNAUTHORIZED' : 'BOOTSTRAP_NOT_CONFIGURED' }, { status: token ? 401 : 503 });
    }
    actorId = 'bootstrap';
  } else {
    const s = await requireOperator(req);
    if (!isOperatorResult(s)) return s.response;
    actorId = s.operator.id;
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.email !== 'string' || !body.email.includes('@') || typeof body?.cognitoSub !== 'string' || body.cognitoSub.length === 0) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  try {
    const op = await db.platformOperator.create({ data: { email: body.email.toLowerCase(), cognitoSub: body.cognitoSub } });
    if (actorId !== 'bootstrap') {
      await operatorAudit(db, { operatorId: actorId as string, action: 'OPERATOR_CREATED', entity: `PlatformOperator:${op.id}` });
    } else {
      await db.platformAuditLog.create({ data: { actor: 'bootstrap', action: 'OPERATOR_CREATED', entity: `PlatformOperator:${op.id}`, details: { firstOperator: true } } });
    }
    return NextResponse.json({ id: op.id, email: op.email, note: 'Operator row created. Cognito admin-group membership is still required at login.' });
  } catch {
    return NextResponse.json({ error: 'OPERATOR_EXISTS' }, { status: 409 });
  }
}
