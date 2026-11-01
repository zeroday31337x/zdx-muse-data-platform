import { describe, it, expect, afterEach } from 'vitest';
import { flowNext, safeNext, resolvePostLoginTarget, buildAuthorizeUrl, getCognitoConfig, OPERATOR_SCOPES } from './cognito';
import { navLinksFor } from './nav';

describe('flowNext: a missing destination is not a choice', () => {
  it('missing param stores empty so the callback falls through to the role default', () => {
    expect(flowNext(null)).toBe('');
    expect(flowNext(undefined)).toBe('');
  });
  it('an explicit relative destination still goes through safeNext', () => {
    expect(flowNext('/admin')).toBe('/admin');
    expect(flowNext('/dashboard')).toBe('/dashboard');
    expect(flowNext('https://evil.example')).toBe('/');
    expect(flowNext('//evil.example')).toBe('/');
  });
  it('safeNext itself is unchanged', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext('/admin')).toBe('/admin');
  });
});

describe('resolvePostLoginTarget with the new flow values', () => {
  it('empty/missing next falls through to the role default', () => {
    expect(resolvePostLoginTarget('', true)).toBe('/admin');
    expect(resolvePostLoginTarget('', false)).toBe('/dashboard');
    expect(resolvePostLoginTarget(null, true)).toBe('/admin');
    expect(resolvePostLoginTarget(null, false)).toBe('/dashboard');
  });
  it('an explicitly supplied / is still honored as a choice', () => {
    expect(resolvePostLoginTarget('/', true)).toBe('/');
    expect(resolvePostLoginTarget('/', false)).toBe('/');
  });
  it('a regular user with a crafted next=/admin still falls back to /dashboard', () => {
    expect(resolvePostLoginTarget('/admin', false)).toBe('/dashboard');
    expect(resolvePostLoginTarget('/admin', true)).toBe('/admin');
  });
});

describe('operator authorize URL uses the operator callback', () => {
  const cfg = {
    region: 'us-east-1', userPoolId: 'us-east-1_test', clientId: 'cid',
    domain: 'https://auth.example.com', redirectUri: 'https://app.example.com/api/auth/callback/cognito',
    operatorRedirectUri: 'https://app.example.com/api/admin/auth/callback/cognito',
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test', adminGroup: 'zdx-data-admin',
  };
  it('override wins over the tenant redirect URI', () => {
    const url = buildAuthorizeUrl(cfg, 'login', { state: 's', nonce: 'n', codeChallenge: 'c' }, cfg.operatorRedirectUri);
    expect(url).toContain(`redirect_uri=${encodeURIComponent(cfg.operatorRedirectUri)}`);
  });
  it('without an override the tenant redirect URI is used', () => {
    const url = buildAuthorizeUrl(cfg, 'login', { state: 's', nonce: 'n', codeChallenge: 'c' });
    expect(url).toContain(`redirect_uri=${encodeURIComponent(cfg.redirectUri)}`);
  });
  it('operator scopes carry the enrollment scope; the default does not', () => {
    expect(OPERATOR_SCOPES).toContain('aws.cognito.signin.user.admin');
    const op = buildAuthorizeUrl(cfg, 'login', { state: 's', nonce: 'n', codeChallenge: 'c' }, cfg.operatorRedirectUri, OPERATOR_SCOPES);
    expect(new URL(op).searchParams.get('scope')).toBe(OPERATOR_SCOPES);
    const tenant = buildAuthorizeUrl(cfg, 'login', { state: 's', nonce: 'n', codeChallenge: 'c' });
    expect(new URL(tenant).searchParams.get('scope')).toBe('openid email profile');
  });
});

describe('getCognitoConfig operator redirect URI', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
  it('reads COGNITO_OPERATOR_REDIRECT_URI when set, null otherwise', () => {
    process.env.COGNITO_REGION = 'us-east-1';
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_test';
    process.env.COGNITO_CLIENT_ID = 'cid';
    process.env.COGNITO_DOMAIN = 'https://auth.example.com';
    process.env.COGNITO_REDIRECT_URI = 'https://app.example.com/api/auth/callback/cognito';
    delete process.env.COGNITO_OPERATOR_REDIRECT_URI;
    expect(getCognitoConfig()?.operatorRedirectUri).toBeNull();
    process.env.COGNITO_OPERATOR_REDIRECT_URI = 'https://app.example.com/api/admin/auth/callback/cognito';
    expect(getCognitoConfig()?.operatorRedirectUri).toBe('https://app.example.com/api/admin/auth/callback/cognito');
  });
});

describe('nav: admin-group members without an operator session', () => {
  it('get the operator sign-in entry point, never the Admin link', () => {
    const links = navLinksFor({ authenticated: true, user: { email: 'a@example.com', tenantId: 't1', cognitoAdmin: true } }, false);
    expect(links.map((l) => l.label)).toContain('Operator sign-in');
    expect(links.map((l) => l.label)).not.toContain('Admin dashboard');
  });
  it('operators keep the Admin link; regular users get neither', () => {
    const op = navLinksFor({ authenticated: true, user: { email: 'a@example.com', tenantId: 't1', cognitoAdmin: true } }, true);
    expect(op.map((l) => l.label)).toContain('Admin dashboard');
    const regular = navLinksFor({ authenticated: true, user: { email: 'b@example.com', tenantId: 't2' } }, false);
    expect(regular.map((l) => l.label)).not.toContain('Admin dashboard');
    expect(regular.map((l) => l.label)).not.toContain('Operator sign-in');
  });
});
