import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  associateSoftwareToken,
  verifySoftwareToken,
  enableSoftwareTokenMfa,
  isValidTotpCode,
  storeEnrollmentAccessToken,
  getEnrollmentEntry,
  setEnrollmentAssociateSession,
  deleteEnrollmentEntry,
  ENROLLMENT_TTL_MS,
} from './operator-mfa-enrollment';

function mockFetch(body: Record<string, unknown>, ok = true, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok, status, text: async () => JSON.stringify(body) };
  };
  return { fn: fn as Parameters<typeof associateSoftwareToken>[2], calls };
}

describe('operator MFA enrollment helpers', () => {
  it('associates and returns the secret + session', async () => {
    const { fn, calls } = mockFetch({ SecretCode: 'ABCDEF', Session: 'sess-1' });
    const out = await associateSoftwareToken('us-east-1', 'tok', fn);
    expect(out).toEqual({ secretCode: 'ABCDEF', session: 'sess-1' });
    expect(calls[0].url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
    const init = calls[0].init as { headers: Record<string, string>; body: string };
    expect(init.headers['X-Amz-Target']).toBe('AWSCognitoIdentityProviderService.AssociateSoftwareToken');
    expect(JSON.parse(init.body)).toEqual({ AccessToken: 'tok' });
  });

  it('rejects a malformed associate response', async () => {
    const { fn } = mockFetch({ SecretCode: 'ABCDEF' });
    await expect(associateSoftwareToken('us-east-1', 'tok', fn)).rejects.toThrow('COGNITO_IDP_FAILED');
  });

  it('maps verify SUCCESS true and anything else false', async () => {
    const yes = mockFetch({ Status: 'SUCCESS' });
    expect(await verifySoftwareToken('us-east-1', 'tok', 'sess', '123456', yes.fn)).toBe(true);
    const no = mockFetch({ Status: 'ERROR' });
    expect(await verifySoftwareToken('us-east-1', 'tok', 'sess', '000000', no.fn)).toBe(false);
  });

  it('maps NotAuthorized to COGNITO_NOT_AUTHORIZED', async () => {
    const { fn } = mockFetch({ __type: 'NotAuthorizedException', message: 'expired' }, false, 400);
    await expect(associateSoftwareToken('us-east-1', 'tok', fn)).rejects.toThrow('COGNITO_NOT_AUTHORIZED');
  });

  it('enables software-token MFA as preferred', async () => {
    const { fn, calls } = mockFetch({});
    await enableSoftwareTokenMfa('us-east-1', 'tok', fn);
    const init = calls[0].init as { headers: Record<string, string>; body: string };
    expect(init.headers['X-Amz-Target']).toBe('AWSCognitoIdentityProviderService.SetUserMFAPreference');
    expect(JSON.parse(init.body)).toEqual({
      AccessToken: 'tok',
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    });
  });

  it('validates TOTP codes as exactly 6 digits', () => {
    expect(isValidTotpCode('123456')).toBe(true);
    expect(isValidTotpCode('12345')).toBe(false);
    expect(isValidTotpCode('1234567')).toBe(false);
    expect(isValidTotpCode('12345a')).toBe(false);
    expect(isValidTotpCode(123456)).toBe(false);
    expect(isValidTotpCode(undefined)).toBe(false);
  });
});

describe('enrollment entry store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds an entry, then drops it after the TTL', () => {
    storeEnrollmentAccessToken('hash-1', 'tok-1');
    const entry = getEnrollmentEntry('hash-1');
    expect(entry?.accessToken).toBe('tok-1');
    expect(entry?.attempts).toBe(0);
    setEnrollmentAssociateSession('hash-1', 'sess-9');
    expect(getEnrollmentEntry('hash-1')?.associateSession).toBe('sess-9');
    vi.advanceTimersByTime(ENROLLMENT_TTL_MS + 1);
    expect(getEnrollmentEntry('hash-1')).toBeUndefined();
  });

  it('deletes on demand', () => {
    storeEnrollmentAccessToken('hash-2', 'tok-2');
    deleteEnrollmentEntry('hash-2');
    expect(getEnrollmentEntry('hash-2')).toBeUndefined();
  });
});
