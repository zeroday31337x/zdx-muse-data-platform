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
// Token handling — a deliberate, narrow exception to the "never
// stored" rule in cognito.ts, which bars DB, cookie, and log
// persistence: the Cognito access token from the operator sign-in
// callback is held ONLY in this process's memory, keyed by the
// operator session token hash, TTL 1 hour (the access token's own
// lifetime), and deleted on enrollment success, on verify-attempt
// exhaustion, or on expiry. It is never written to the DB, never set
// as a cookie, never logged, and never leaves the server except in
// Cognito API calls. A server restart drops it: the operator simply
// signs in again (SETUP_SESSION_EXPIRED). This retention is
// unavoidable for a two-step enrollment — the associate step and
// the verify step are separated by the user reading a secret and
// typing a code — and it is the smallest retention that works.
import type { FetchFn } from './cognito';

export const ENROLLMENT_TTL_MS = 60 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;

type EnrollmentEntry = {
  accessToken: string;
  associateSession?: string;
  attempts: number;
  expiresAt: number;
};

const entries = new Map<string, EnrollmentEntry>();

function prune(now = Date.now()): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

/** Hold the callback's access token for a pending operator session. */
export function storeEnrollmentAccessToken(sessionTokenHash: string, accessToken: string): void {
  prune();
  entries.set(sessionTokenHash, { accessToken, attempts: 0, expiresAt: Date.now() + ENROLLMENT_TTL_MS });
}

export function getEnrollmentEntry(sessionTokenHash: string): EnrollmentEntry | undefined {
  prune();
  return entries.get(sessionTokenHash);
}

export function setEnrollmentAssociateSession(sessionTokenHash: string, associateSession: string): void {
  prune();
  const entry = entries.get(sessionTokenHash);
  if (entry) entry.associateSession = associateSession;
}

export function deleteEnrollmentEntry(sessionTokenHash: string): void {
  entries.delete(sessionTokenHash);
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

async function idpCall(
  region: string,
  target: string,
  body: Record<string, unknown>,
  fetchFn?: IdpFetch,
): Promise<Record<string, unknown>> {
  const fn = fetchFn ?? defaultFetch();
  const res = await fn(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = JSON.parse(await res.text()) as Record<string, unknown>;
  if (!res.ok) {
    const type = typeof data.__type === 'string' ? data.__type : '';
    if (type.includes('NotAuthorizedException')) throw new Error('COGNITO_NOT_AUTHORIZED');
    throw new Error('COGNITO_IDP_FAILED');
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
  if (typeof data.SecretCode !== 'string' || typeof data.Session !== 'string') throw new Error('COGNITO_IDP_FAILED');
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
