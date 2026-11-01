// Operator TOTP enrollment via Cognito's own user-pool APIs.
//
// Why this exists: the pool is NOT MFA-Required (tenant MFA stays
// optional by decision), so the Cognito hosted UI never offers
// enrollment, and an MFA_PENDING operator session loops forever
// through mfa-verify — each round-trip mints another pending session
// because the hosted UI signs the operator in password-only. This
// module gives operators a way to enroll without forcing MFA on
// tenant users: the operator's own session (MFA_PENDING allowed)
// drives Cognito's AssociateSoftwareToken / VerifySoftwareToken /
// SetUserMFAPreference calls, and only a Cognito SUCCESS marks the
// operator session MFA-verified. The app never verifies a TOTP code
// itself, and enrollment or a DB timestamp alone never verifies MFA.
//
// State handling — READ THIS BEFORE CHANGING IT. The first version
// held the callback's Cognito access token in a process-memory Map,
// keyed by session hash. That failed in production: fresh operator
// sign-ins minted pending sessions, yet setup always answered
// SETUP_SESSION_EXPIRED, even though the code, the session cookie,
// and the single production process all checked out. Route bundles
// in a production Next.js build do not reliably share module-level
// state across routes, so cross-route server memory is NOT a sound
// place for enrollment state. This version therefore keeps the two
// enrollment values in short-lived, HttpOnly, Secure, Path-scoped
// browser cookies instead (see the cookie helpers below): they
// survive restarts and bundling boundaries, because the browser
// carries them back to exactly the routes that need them.
//   - Access token: Path=/api/admin/auth, Max-Age 3600 (the token's
//     own lifetime). Set only by the operator callback, only for
//     pending sessions. Cleared on enrollment success, on token
//     rejection, on attempt exhaustion, and on operator logout.
//   - Associate session: Path=/api/admin/auth, Max-Age 600 (ten
//     minutes is ample to read a secret and type a code). Useless
//     without the access token, and the setup routes additionally
//     require a valid pending operator session, so these cookies
//     alone grant nothing.
//   - Attempt counter: a plain count cookie, same scope. It deters
//     casual guessing; it is NOT tamper-proof (deleting it resets
//     the count), and it is documented as such — the real bounds
//     are the 1-hour token life, the 30-second TOTP rotation, and
//     Cognito's own throttling.
// Revision to the rule in cognito.ts ("never set as cookies"): this
// is the single, deliberate exception — httpOnly (never readable
// by page JavaScript), Secure, narrowly Path-scoped, short-lived,
// never logged, never in the DB, cleared on every terminal path.
// The callback additionally audits OPERATOR_MFA_NO_ACCESS_TOKEN
// (a boolean fact, no token content) when a pending login yields
// no access token, so a token-side failure is distinguishable
// from a transport failure instead of failing silently again.
import type { FetchFn } from './cognito';

export const MAX_VERIFY_ATTEMPTS = 5;

export const ENROLLMENT_ACCESS_COOKIE = 'zdx_op_enroll';
export const ENROLLMENT_ASSOCIATE_COOKIE = 'zdx_op_mfa_session';
export const ENROLLMENT_ATTEMPTS_COOKIE = 'zdx_op_mfa_attempts';
export const ENROLLMENT_ACCESS_MAX_AGE = 3600;
export const ENROLLMENT_ASSOCIATE_MAX_AGE = 600;

function enrollmentCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/api/admin/auth; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

function clearEnrollmentCookie(name: string): string {
  return `${name}=; HttpOnly; Path=/api/admin/auth; SameSite=Lax; Secure; Max-Age=0`;
}

/** Short-lived holder for the callback's Cognito access token (pending sessions only). */
export function enrollmentAccessCookie(accessToken: string): string {
  return enrollmentCookie(ENROLLMENT_ACCESS_COOKIE, accessToken, ENROLLMENT_ACCESS_MAX_AGE);
}

/** Short-lived holder for the Cognito associate session (setup GET -> verify POST). */
export function enrollmentAssociateCookie(associateSession: string): string {
  return enrollmentCookie(ENROLLMENT_ASSOCIATE_COOKIE, associateSession, ENROLLMENT_ASSOCIATE_MAX_AGE);
}

/** Best-effort attempt counter (see header: bypassable by deleting it, bounded by token TTL). */
export function enrollmentAttemptsCookie(count: number): string {
  return enrollmentCookie(ENROLLMENT_ATTEMPTS_COOKIE, String(count), ENROLLMENT_ACCESS_MAX_AGE);
}

/** All three enrollment cookies, cleared. */
export function clearEnrollmentCookies(): string[] {
  return [
    clearEnrollmentCookie(ENROLLMENT_ACCESS_COOKIE),
    clearEnrollmentCookie(ENROLLMENT_ASSOCIATE_COOKIE),
    clearEnrollmentCookie(ENROLLMENT_ATTEMPTS_COOKIE),
  ];
}

/** Parse the attempt counter defensively: anything malformed counts as 0. */
export function parseEnrollmentAttempts(value: string | null): number {
  if (!value) return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** A TOTP code is exactly 6 digits. Anything else is rejected before any Cognito call. */
export function isValidTotpCode(code: unknown): code is string {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

type IdpFetch = FetchFn;

function defaultFetch(): IdpFetch {
  return async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  };
}

// Cognito IDP failures carry their __type on the error so callers can
// audit the failure KIND (never token/secret content). Without this,
// every non-NotAuthorized associate failure collapsed into a bare
// 502 and the setup page's generic "Enrollment unavailable" — the
// cause (InvalidParameter, throttling, network, oversize session,
// malformed response) was unobservable server-side.
export function idpError(message: string, cognitoType: string): Error {
  const e = new Error(message);
  (e as unknown as { cognitoType: string }).cognitoType = cognitoType;
  return e;
}

export function cognitoTypeOf(e: unknown): string | null {
  if (e instanceof Error) {
    const t = (e as unknown as { cognitoType?: unknown }).cognitoType;
    if (typeof t === 'string' && t) return t;
  }
  return null;
}

async function idpCall(
  region: string,
  target: string,
  body: Record<string, unknown>,
  fetchFn?: IdpFetch,
): Promise<Record<string, unknown>> {
  const fn = fetchFn ?? defaultFetch();
  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fn(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw idpError('COGNITO_IDP_FAILED', 'NETWORK');
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await res.text()) as Record<string, unknown>;
  } catch {
    throw idpError('COGNITO_IDP_FAILED', 'BAD_RESPONSE');
  }
  if (!res.ok) {
    const type = typeof data.__type === 'string' ? data.__type : '';
    if (type.includes('NotAuthorizedException')) throw idpError('COGNITO_NOT_AUTHORIZED', type);
    throw idpError('COGNITO_IDP_FAILED', type || 'UNKNOWN');
  }
  return data;
}

/** Start enrollment: returns the shared secret for manual authenticator entry. */
export async function associateSoftwareToken(
  region: string,
  accessToken: string,
  fetchFn?: IdpFetch,
): Promise<{ secretCode: string; session: string }> {
  const data = await idpCall(region, 'AssociateSoftwareToken', { AccessToken: accessToken }, fetchFn);
  if (typeof data.SecretCode !== 'string' || typeof data.Session !== 'string') throw idpError('COGNITO_IDP_FAILED', 'BAD_RESPONSE');
  return { secretCode: data.SecretCode, session: data.Session };
}

/** Verify the user-typed code against Cognito. True only on SUCCESS. */
export async function verifySoftwareToken(
  region: string,
  accessToken: string,
  associateSession: string,
  code: string,
  fetchFn?: IdpFetch,
): Promise<boolean> {
  const data = await idpCall(
    region,
    'VerifySoftwareToken',
    { AccessToken: accessToken, Session: associateSession, UserCode: code },
    fetchFn,
  );
  return data.Status === 'SUCCESS';
}

/** Enable software-token MFA as the preferred method for this user. */
export async function enableSoftwareTokenMfa(
  region: string,
  accessToken: string,
  fetchFn?: IdpFetch,
): Promise<void> {
  await idpCall(
    region,
    'SetUserMFAPreference',
    { AccessToken: accessToken, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } },
    fetchFn,
  );
}
