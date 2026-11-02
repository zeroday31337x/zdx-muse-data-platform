import { describe, it, expect } from 'vitest';
import { navLinksFor, guardedView, adminPageState } from './nav';

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
