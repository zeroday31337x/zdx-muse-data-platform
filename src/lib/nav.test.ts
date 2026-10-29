import { describe, it, expect } from 'vitest';
import { publicOrigin, resolvePostLoginTarget } from './cognito';
import { navLinksFor, guardedView, adminPageState } from './nav';

describe('publicOrigin', () => {
  it('derives the public origin from the registered callback URI, never localhost', () => {
    expect(publicOrigin('https://data.zerodrivex.com/api/auth/callback/cognito', 'http://localhost:3000'))
      .toBe('https://data.zerodrivex.com');
  });
  it('falls back to the request origin only when no redirect URI is configured', () => {
    expect(publicOrigin(null, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(publicOrigin(undefined, 'https://example.com')).toBe('https://example.com');
  });
  it('falls back on a malformed redirect URI', () => {
    expect(publicOrigin('not a url', 'https://example.com')).toBe('https://example.com');
  });
});

describe('resolvePostLoginTarget', () => {
  it('sends admin-group members to /admin and regular users to /dashboard by default', () => {
    expect(resolvePostLoginTarget(null, true)).toBe('/admin');
    expect(resolvePostLoginTarget(null, false)).toBe('/dashboard');
    expect(resolvePostLoginTarget(undefined, true)).toBe('/admin');
    expect(resolvePostLoginTarget(undefined, false)).toBe('/dashboard');
  });
  it('honors a same-site page next value for both roles', () => {
    expect(resolvePostLoginTarget('/dashboard', true)).toBe('/dashboard');
    expect(resolvePostLoginTarget('/dashboard', false)).toBe('/dashboard');
    expect(resolvePostLoginTarget('/settings', false)).toBe('/settings');
    expect(resolvePostLoginTarget('/', false)).toBe('/');
  });
  it('honors /admin paths only for admin-group members', () => {
    expect(resolvePostLoginTarget('/admin', true)).toBe('/admin');
    expect(resolvePostLoginTarget('/admin/workflows', true)).toBe('/admin/workflows');
    expect(resolvePostLoginTarget('/admin', false)).toBe('/dashboard');
    expect(resolvePostLoginTarget('/admin/workflows', false)).toBe('/dashboard');
  });
  it('never redirects to an absolute or protocol-relative URL', () => {
    expect(resolvePostLoginTarget('https://evil.example.com/', false)).toBe('/dashboard');
    expect(resolvePostLoginTarget('https://evil.example.com/', true)).toBe('/admin');
    expect(resolvePostLoginTarget('//evil.example.com/', false)).toBe('/dashboard');
  });
  it('never forwards to API routes; unknown paths fall back to the role default', () => {
    expect(resolvePostLoginTarget('/api/datasets', false)).toBe('/dashboard');
    expect(resolvePostLoginTarget('/api/datasets', true)).toBe('/admin');
    expect(resolvePostLoginTarget('/no-such-page', false)).toBe('/dashboard');
  });
  it('never emits localhost in a redirect target built on the public origin', () => {
    for (const next of [null, '/admin', '/dashboard', 'https://evil.example.com/']) {
      const target = resolvePostLoginTarget(next, false);
      const full = new URL(target, publicOrigin('https://data.zerodrivex.com/api/auth/callback/cognito', 'http://localhost:3000')).toString();
      expect(full).not.toContain('localhost');
      expect(full.startsWith('https://data.zerodrivex.com/')).toBe(true);
    }
  });
});

describe('navLinksFor', () => {
  it('signed-out visitors get Home, Sign in, Create account — and no dashboard links', () => {
    const links = navLinksFor(null, false).map((l) => l.label);
    expect(links).toEqual(['Home', 'Sign in with Cognito', 'Create account']);
    expect(navLinksFor({ authenticated: false }, false).map((l) => l.label)).toEqual(links);
  });
  it('signed-in users get Dashboard, Workbench, Settings — no Admin link without an operator session', () => {
    const me = { authenticated: true, user: { email: 'a@b.c', tenantId: 't1', role: 'member', provider: 'cognito' } };
    expect(navLinksFor(me, false).map((l) => l.label)).toEqual(['Dashboard', 'Workbench', 'Settings']);
  });
  it('an operator session adds the Admin dashboard link', () => {
    const me = { authenticated: true, user: { email: 'a@b.c', tenantId: 't1', role: 'member', provider: 'cognito' } };
    expect(navLinksFor(me, true).map((l) => l.label)).toEqual(['Dashboard', 'Workbench', 'Settings', 'Admin dashboard']);
  });
});

describe('guardedView', () => {
  it('maps null to loading, false to signed-out, true to signed-in', () => {
    expect(guardedView(null)).toBe('loading');
    expect(guardedView(false)).toBe('signed-out');
    expect(guardedView(true)).toBe('signed-in');
  });
});

describe('adminPageState', () => {
  it('no operator session means the operator sign-in prompt, never data', () => {
    expect(adminPageState('unauthenticated', false)).toBe('operator-signin');
    expect(adminPageState('unauthenticated', true)).toBe('operator-signin');
  });
  it('unverified MFA means the MFA prompt', () => {
    expect(adminPageState('mfa-required', false)).toBe('mfa-required');
  });
  it('verified MFA plus a successful jobs fetch means ready; a failed jobs fetch means error', () => {
    expect(adminPageState('verified', true)).toBe('ready');
    expect(adminPageState('verified', false)).toBe('error');
  });
  it('an MFA-status failure means error, never data', () => {
    expect(adminPageState('error', true)).toBe('error');
  });
});
