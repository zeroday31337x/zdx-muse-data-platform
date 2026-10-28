// GET /api/admin/auth/cognito — operator sign-in start. 302 to the
// Cognito hosted UI (login only; operators are never self-registered
// here). Flow cookies are operator-scoped (zdx_op_*), distinct from
// tenant flow cookies. The callback is /api/admin/auth/callback/cognito.
import { NextResponse } from 'next/server';
import { getCognitoConfig, buildAuthorizeUrl, newCodeVerifier, codeChallenge, newRandomToken, flowCookie, safeNext } from '@/lib/cognito';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  const state = newRandomToken();
  const nonce = newRandomToken();
  const verifier = newCodeVerifier();
  const target = buildAuthorizeUrl(cfg, 'login', { state, nonce, codeChallenge: codeChallenge(verifier) });
  const res = NextResponse.redirect(target);
  res.headers.append('Set-Cookie', flowCookie('zdx_op_state', state));
  res.headers.append('Set-Cookie', flowCookie('zdx_op_nonce', nonce));
  res.headers.append('Set-Cookie', flowCookie('zdx_op_verifier', verifier));
  res.headers.append('Set-Cookie', flowCookie('zdx_op_next', next));
  return res;
}
