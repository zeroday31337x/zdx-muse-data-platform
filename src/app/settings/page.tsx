'use client';
import { useEffect, useState } from 'react';
import { guardedView, type MeState } from '@/lib/nav';

// Settings: profile, billing summary, sign-out, password recovery.
// No password-change forms live here: Cognito password changes belong
// to the hosted UI, so Cognito users get the hosted forgot-password
// link and nothing else. Billing is a read-only summary from the
// existing subscription route (safe shape only, no secrets or ids).
type Billing = {
  status?: string; plan?: string | null; currentPeriodEnd?: string | null;
  hasCustomer?: boolean; portalEligible?: boolean; checkoutEligible?: boolean;
};

export default function Settings() {
  const [me, setMe] = useState<MeState | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me');
        const j = await r.json().catch(() => ({}));
        const state: MeState = { authenticated: Boolean(j?.authenticated), user: j?.user };
        setMe(state);
        if (state.authenticated) {
          const br = await fetch('/api/billing/subscription');
          if (br.ok) { const bj = await br.json().catch(() => null); if (bj && typeof bj === 'object') setBilling(bj); }
        }
      } catch {
        setMe({ authenticated: false });
      }
    })();
  }, []);

  const view = guardedView(me === null ? null : me.authenticated);
  if (view === 'loading') return <main className="page"><p className="muted">Loading…</p></main>;
  if (view === 'signed-out') {
    return (
      <main className="page">
        <p className="kicker">Settings</p>
        <h1 className="brand">Sign in to view settings</h1>
        <p><a className="btn btn-primary" href="/api/auth/cognito?mode=login">Sign in with Cognito</a></p>
      </main>
    );
  }

  const signOut = async () => {
    setMsg('Signing out…');
    try {
      const r = await fetch('/api/auth/logout', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (j?.cognitoLogoutUrl) { window.location.href = j.cognitoLogoutUrl; return; }
    } catch {
      // Cookie is cleared server-side regardless; Home is still signed out.
    }
    window.location.href = '/';
  };

  return (
    <main className="page">
      <p className="kicker">Settings</p>
      <h1 className="brand">Settings</h1>
      <section className="card">
        <h2>Profile</h2>
        <p className="muted">Email: {me?.user?.email ?? '—'}</p>
        <p className="muted">Provider: {me?.user?.provider ?? '—'} · Role: {me?.user?.role ?? '—'} · Tenant: {me?.user?.tenantId ?? '—'}</p>
      </section>
      <section className="card">
        <h2>Billing / subscription</h2>
        {billing ? (
          <div>
            <p className="muted">Status: {billing.status ?? '—'} · Plan: {billing.plan ?? '—'}</p>
            <p className="muted">Current period ends: {billing.currentPeriodEnd ?? '—'}</p>
            <p className="muted">Customer on file: {billing.hasCustomer ? 'yes' : 'no'} · Billing portal available: {billing.portalEligible ? 'yes' : 'no'} · Checkout available: {billing.checkoutEligible ? 'yes' : 'no'}</p>
          </div>
        ) : (
          <p className="muted">Billing status unavailable.</p>
        )}
      </section>
      <section className="card">
        <h2>Account security</h2>
        {me?.user?.provider === 'cognito' ? (
          <p>Password changes and recovery for Cognito accounts happen in the hosted sign-in UI, not on this page. <a href="/api/auth/cognito?mode=forgot">Recover or change your Cognito password →</a></p>
        ) : (
          <p className="muted">This account does not sign in through Cognito, so hosted password recovery does not apply.</p>
        )}
        <p><button type="button" className="btn" onClick={signOut}>Sign out</button>{msg ? <span className="muted"> {msg}</span> : null}</p>
      </section>
    </main>
  );
}
