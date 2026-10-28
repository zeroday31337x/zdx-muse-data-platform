// Pure navigation + page-guard helpers (no DOM, no network), so the
// rules below are unit-testable without a browser:
// - Nav links are derived from /api/auth/me state only. The Admin link
//   appears only when the browser ALSO holds a valid operator session
//   (mfa-status 200): a tenant session alone — even for a Cognito
//   admin-group member — is never presented as operator access,
//   because /api/admin/* accepts only the separate operator cookie.
// - Sign-in / Create-account links go to the Cognito initiator route,
//   which 302s to the hosted UI. They are auth entry points, not pages,
//   and are the only non-page links in the nav.
// - Dashboard/settings guards: private data is fetched only in the
//   signed-in branch. Unauthenticated visitors get a sign-in prompt
//   and no dataset, billing, or tenant data is requested.

export type MeState = {
  authenticated: boolean;
  user?: { email: string; tenantId: string; role?: string; provider?: string };
};

export type NavLink = { href: string; label: string };

export function navLinksFor(me: MeState | null, isOperator: boolean): NavLink[] {
  if (!me?.authenticated) {
    return [
      { href: '/', label: 'Home' },
      { href: '/api/auth/cognito?mode=login', label: 'Sign in with Cognito' },
      { href: '/api/auth/cognito?mode=signup', label: 'Create account' },
    ];
  }
  const links: NavLink[] = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/', label: 'Workbench' },
    { href: '/settings', label: 'Settings' },
  ];
  if (isOperator) links.push({ href: '/admin', label: 'Admin dashboard' });
  return links;
}

/** Page guard view from the /api/auth/me result. null = not loaded yet. */
export function guardedView(authenticated: boolean | null): 'loading' | 'signed-out' | 'signed-in' {
  if (authenticated === null) return 'loading';
  return authenticated ? 'signed-in' : 'signed-out';
}

export type AdminPageState = 'operator-signin' | 'mfa-required' | 'ready' | 'error';

/**
 * /admin page state from the two operator fetches, in order.
 * mfa: result of GET /api/admin/auth/mfa-status — 'unauthenticated'
 * (401: no operator session), 'mfa-required' (200, not verified),
 * 'verified' (200, verified), 'error' (any other failure).
 * jobsOk: whether GET /api/admin/workflows/jobs then succeeded.
 * A tenant session is never an input here: without an operator
 * session the page shows the operator sign-in prompt, never data.
 */
export function adminPageState(
  mfa: 'unauthenticated' | 'mfa-required' | 'verified' | 'error',
  jobsOk: boolean,
): AdminPageState {
  if (mfa === 'unauthenticated') return 'operator-signin';
  if (mfa === 'error') return 'error';
  if (mfa === 'mfa-required') return 'mfa-required';
  return jobsOk ? 'ready' : 'error';
}
