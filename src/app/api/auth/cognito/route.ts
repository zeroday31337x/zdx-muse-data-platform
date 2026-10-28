import { NextResponse } from 'next/server';
import {
  getCognitoConfig, buildAuthorizeUrl, newCodeVerifier, codeChallenge,
  newRandomToken, flowCookie, safeNext, type CognitoMode,
} from '@/lib/cognito';
export const dynamic = 'force-dynamic';

// GET /api/auth/cognito?mode=login|signup|forgot&next=/relative
// 302 to the Cognito hosted UI. Registration, email verification,
// password recovery, and MFA enrollment are hosted-UI flows, not
// custom forms. Unknown mode → 400 (fail closed, no silent fallback).
export async function GET(req: Request) {
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  const url = new URL(req.url);
  const modeParam = url.searchParams.get('mode') ?? 'login';
  if (modeParam !== 'login' && modeParam !== 'signup' && modeParam !== 'forgot') {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  const mode = modeParam as CognitoMode;
  const next = safeNext(url.searchParams.get('next'));
  const state = newRandomToken();
  const nonce = newRandomToken();
  const verifier = newCodeVerifier();
  const target = buildAuthorizeUrl(cfg, mode, { state, nonce, codeChallenge: codeChallenge(verifier) });
  const res = NextResponse.redirect(target);
  res.headers.append('Set-Cookie', flowCookie('zdx_cognito_state', state));
  res.headers.append('Set-Cookie', flowCookie('zdx_cognito_nonce', nonce));
  res.headers.append('Set-Cookie', flowCookie('zdx_cognito_verifier', verifier));
  res.headers.append('Set-Cookie', flowCookie('zdx_cognito_next', next));
  return res;
}
