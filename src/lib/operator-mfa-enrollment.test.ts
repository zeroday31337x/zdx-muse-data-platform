import { describe, it, expect } from 'vitest';
import {
  associateSoftwareToken,
  verifySoftwareToken,
  enableSoftwareTokenMfa,
  isValidTotpCode,
  enrollmentAccessCookie,
  enrollmentAssociateCookie,
  enrollmentAttemptsCookie,
  clearEnrollmentCookies,
  parseEnrollmentAttempts,
  cognitoTypeOf,
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

  it('preserves the Cognito error kind on non-NotAuthorized failures', async () => {
    const { fn } = mockFetch({ __type: 'InvalidParameterException', message: 'bad' }, false, 400);
    const err = await associateSoftwareToken('us-east-1', 'tok', fn).catch((e: unknown) => e);
    expect((err as Error).message).toBe('COGNITO_IDP_FAILED');
    expect(cognitoTypeOf(err)).toBe('InvalidParameterException');
  });

  it('tags network failures and malformed responses distinctly', async () => {
    const net = async () => { throw new Error('boom'); };
    const netErr = await associateSoftwareToken('us-east-1', 'tok', net as Parameters<typeof associateSoftwareToken>[2]).catch((e: unknown) => e);
    expect(cognitoTypeOf(netErr)).toBe('NETWORK');
    const bad = async () => ({ ok: true, status: 200, text: async () => 'not-json' });
    const badErr = await associateSoftwareToken('us-east-1', 'tok', bad as Parameters<typeof associateSoftwareToken>[2]).catch((e: unknown) => e);
    expect(cognitoTypeOf(badErr)).toBe('BAD_RESPONSE');
    expect(cognitoTypeOf(new Error('plain'))).toBeNull();
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

describe('enrollment cookies', () => {
  it('holds the access token in a short-lived, httpOnly, Secure, Path-scoped cookie', () => {
    const c = enrollmentAccessCookie('tok-1');
    expect(c).toContain('zdx_op_enroll=tok-1');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('Path=/api/admin/auth');
    expect(c).toContain('Max-Age=3600');
  });

  it('holds the associate session for ten minutes', () => {
    expect(enrollmentAssociateCookie('sess-9')).toContain('Max-Age=600');
  });

  it('clears all three enrollment cookies', () => {
    const cleared = clearEnrollmentCookies();
    expect(cleared).toHaveLength(3);
    for (const c of cleared) expect(c).toContain('Max-Age=0');
    expect(cleared.join(' ')).toContain('zdx_op_enroll=');
    expect(cleared.join(' ')).toContain('zdx_op_mfa_session=');
    expect(cleared.join(' ')).toContain('zdx_op_mfa_attempts=');
  });

  it('parses the attempt counter defensively', () => {
    expect(parseEnrollmentAttempts('3')).toBe(3);
    expect(parseEnrollmentAttempts(null)).toBe(0);
    expect(parseEnrollmentAttempts('abc')).toBe(0);
    expect(parseEnrollmentAttempts('-1')).toBe(0);
    expect(parseEnrollmentAttempts('2.9')).toBe(2);
    expect(enrollmentAttemptsCookie(4)).toContain('zdx_op_mfa_attempts=4');
  });
});
