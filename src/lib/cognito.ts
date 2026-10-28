// AWS Cognito hosted-UI auth for the Data Intelligence Platform.
// Public client + PKCE (S256). There is NO client secret: the app client
// is a public client, and no secret is ever read, stored, or sent.
// Raw Cognito tokens are never stored in the DB, never set as cookies,
// and never logged. The callback mints a standard DB Session row (see
// the callback route); Cognito JWTs are verified once at callback time
// and are NOT re-verified on every request.
//
// MFA interpretation (staging blocker, see report): operator MFA is
// established from an authenticated Cognito MFA event. In v1 this is
// read from the standard OIDC `amr` claim: the session counts as
// MFA-verified only when `amr` contains a known second-factor method
// (STRICT_MFA_AMR: otp, sms, webauthn, mfa, software_token_mfa,
// phone_number_mfa). If `amr` is absent, or pwd-only, MFA is NOT
// verified. The pool MFA policy must be confirmed against the actual
// pool configuration before staging operator journeys are claimed to
// work; this code deliberately does not invent a custom claim name.
// (Compliance correction 2026-10-27: the previous "any non-pwd amr"
// reading was a latent defect and is removed.)
import crypto from 'node:crypto';

export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  domain: string;
  redirectUri: string;
  issuer: string;
  adminGroup: string;
};

export function getCognitoConfig(): CognitoConfig | null {
  const region = process.env.COGNITO_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const domain = process.env.COGNITO_DOMAIN;
  const redirectUri = process.env.COGNITO_REDIRECT_URI;
  if (!region || !userPoolId || !clientId || !domain || !redirectUri) return null;
  const issuer = process.env.COGNITO_ISSUER || `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  return { region, userPoolId, clientId, domain, redirectUri, issuer, adminGroup: process.env.COGNITO_ADMIN_GROUP || 'zdx-data-admin' };
}

export function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

export function newCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

export function codeChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

export function newRandomToken(bytes = 32): string {
  return base64url(crypto.randomBytes(bytes));
}

export type CognitoMode = 'login' | 'signup' | 'forgot';

export function authorizePath(mode: CognitoMode): string {
  if (mode === 'signup') return '/signup';
  if (mode === 'forgot') return '/forgotPassword';
  return '/oauth2/authorize';
}

export function buildAuthorizeUrl(cfg: CognitoConfig, mode: CognitoMode, flow: { state: string; nonce: string; codeChallenge: string }): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: flow.codeChallenge,
    code_challenge_method: 'S256',
  });
  const domain = cfg.domain.replace(/\/$/, '');
  return `${domain}${authorizePath(mode)}?${params.toString()}`;
}

export function buildCognitoLogoutUrl(cfg: CognitoConfig, postLogoutRedirect: string): string {
  const params = new URLSearchParams({ client_id: cfg.clientId, logout_uri: postLogoutRedirect });
  return `${cfg.domain.replace(/\/$/, '')}/logout?${params.toString()}`;
}

export type CognitoClaims = {
  sub: string;
  email: string;
  email_verified?: boolean | string;
  amr?: string[];
  groups?: string[];
  [key: string]: unknown;
};

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(base64urlDecode(part).toString('utf8')) as Record<string, unknown>;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Verify an ID token (RS256 via issuer JWKS). Throws generic errors only. */
export async function verifyIdToken(
  idToken: string,
  opts: { issuer: string; clientId: string; nonce?: string; fetchFn?: FetchFn },
): Promise<CognitoClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('INVALID_ID_TOKEN');
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    throw new Error('INVALID_ID_TOKEN');
  }
  const kid = header.kid;
  if (typeof kid !== 'string' || header.alg !== 'RS256') throw new Error('INVALID_ID_TOKEN');
  const fetchFn: FetchFn = opts.fetchFn ?? (async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  });
  const jwksRes = await fetchFn(`${opts.issuer}/.well-known/jwks.json`);
  if (!jwksRes.ok) throw new Error('JWKS_FETCH_FAILED');
  const jwks = JSON.parse(await jwksRes.text()) as { keys?: Array<Record<string, unknown>> };
  const jwk = (jwks.keys ?? []).find((k) => k.kid === kid);
  if (!jwk) throw new Error('UNKNOWN_KEY_ID');
  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
  } catch {
    throw new Error('INVALID_KEY');
  }
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = base64urlDecode(parts[2]);
  const valid = crypto.verify('sha256', signingInput, publicKey, signature);
  if (!valid) throw new Error('INVALID_SIGNATURE');
  if (payload.iss !== opts.issuer) throw new Error('INVALID_ISSUER');
  if (payload.aud !== opts.clientId) throw new Error('INVALID_AUDIENCE');
  if (payload.token_use !== 'id') throw new Error('INVALID_TOKEN_USE');
  const exp = payload.exp;
  if (typeof exp !== 'number' || exp * 1000 <= Date.now()) throw new Error('TOKEN_EXPIRED');
  if (opts.nonce !== undefined && payload.nonce !== opts.nonce) throw new Error('NONCE_MISMATCH');
  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== 'string' || typeof email !== 'string') throw new Error('MISSING_CLAIMS');
  const amr = Array.isArray(payload.amr) ? (payload.amr as string[]) : undefined;
  const groups = Array.isArray(payload['cognito:groups']) ? (payload['cognito:groups'] as string[]) : undefined;
  return { sub, email, email_verified: payload.email_verified as boolean | string | undefined, amr, groups, ...payload };
}

/** Exchange an authorization code for tokens (public client, PKCE, no secret). */
export async function exchangeCode(
  cfg: CognitoConfig,
  code: string,
  codeVerifier: string,
  fetchFn?: FetchFn,
): Promise<{ idToken: string; accessToken?: string }> {
  const fn: FetchFn = fetchFn ?? (async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  });
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fn(`${cfg.domain.replace(/\/$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error('COGNITO_EXCHANGE_FAILED');
  const data = JSON.parse(await res.text()) as { id_token?: unknown; access_token?: unknown };
  if (typeof data.id_token !== 'string') throw new Error('COGNITO_EXCHANGE_FAILED');
  return { idToken: data.id_token, accessToken: typeof data.access_token === 'string' ? data.access_token : undefined };
}

/**
 * MFA-verified only when the authenticated token's `amr` claim shows a
 * second factor beyond password. Absent `amr` = NOT verified (fail
 * closed). This is the v1 interpretation of "MFA from an authenticated
 * Cognito MFA event"; the pool's MFA policy must be confirmed at
 * staging before operator journeys are claimed working.
 */
/**
 * Strict MFA verification from an authenticated token's amr (compliance
 * correction, 2026-10-27). PREVIOUSLY this counted ANY non-'pwd' amr
 * value as MFA-verified (e.g. 'face', 'pop', 'kba' would have passed)
 * — a latent defect: it was used in no production route (operator
 * paths always used the strict operator check), so it was NOT an
 * active auth bypass, but any future caller would have inherited the
 * loose reading. Now both helpers share this single strict set.
 * This changes NO authorization policy: tenant sessions do not gate
 * on MFA in v1 (MFA gating is operator-only); it only removes the
 * loose reading for any future use.
 */
export const STRICT_MFA_AMR = new Set(['otp', 'sms', 'webauthn', 'mfa', 'software_token_mfa', 'phone_number_mfa']);

export function mfaVerifiedFromClaims(claims: { amr?: string[] }): boolean {
  const amr = claims.amr ?? [];
  return amr.some((m) => STRICT_MFA_AMR.has(m));
}

/** Flow-cookie helpers. Values are random tokens, never user data. */
export function flowCookie(name: string, value: string, maxAgeSeconds = 600): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function clearFlowCookie(name: string): string {
  return `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Next must be a relative path, else '/'. Never an absolute external URL. */
export function safeNext(next: string | null | undefined): string {
  if (!next) return '/';
  if (next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}
