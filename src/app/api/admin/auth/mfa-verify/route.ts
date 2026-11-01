// GET /api/admin/auth/mfa-verify — MFA_PENDING redirect. Sends the
// operator back to the Cognito hosted UI, where MFA enrollment and
// challenge happen (hosted-UI flows, not custom forms). A full session
// is not required to reach this route; an MFA_PENDING session is.
import { NextResponse } from 'next/server';
import { getCognitoConfig, buildAuthorizeUrl, newCodeVerifier, codeChallenge, newRandomToken, flowCookie, OPERATOR_SCOPES } from '@/lib/cognito';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  // Same operator-callback rule as operator sign-in (admin-console-v1
  // follow-up): the MFA round-trip must return to the operator
  // callback, which mints the MFA-verified operator session. Sending
  // it to the tenant callback would fail, since that callback reads
  // tenant flow cookies, not operator ones.
  if (!cfg.operatorRedirectUri) return NextResponse.json({ error: 'OPERATOR_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req, { allowMfaPending: true });
  if (!isOperatorResult(s)) return s.response;
  const state = newRandomToken();
  const nonce = newRandomToken();
  const verifier = newCodeVerifier();
  const target = buildAuthorizeUrl(cfg, 'login', { state, nonce, codeChallenge: codeChallenge(verifier) }, cfg.operatorRedirectUri, OPERATOR_SCOPES);
  const res = NextResponse.redirect(target);
  res.headers.append('Set-Cookie', flowCookie('zdx_op_state', state));
  res.headers.append('Set-Cookie', flowCookie('zdx_op_nonce', nonce));
  res.headers.append('Set-Cookie', flowCookie('zdx_op_verifier', verifier));
  return res;
}
