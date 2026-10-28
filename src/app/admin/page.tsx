'use client';
import { useEffect, useState } from 'react';
import { adminPageState } from '@/lib/nav';

// Admin dashboard — read-only operator view. Authorization is the
// EXISTING operator flow, unchanged: a tenant session (even for a
// Cognito admin-group member) is never accepted here, because
// /api/admin/* reads only the separate zdx_operator_session cookie.
// States, in order: no operator session → operator sign-in prompt;
// MFA_PENDING → MFA prompt; verified → cross-tenant job metadata
// summary. Job rows carry metadata only (status, kind, counts,
// error) — the route itself strips record bodies, and this page never
// asks for them. Operator accounts are never self-registered: the
// sign-in step requires a pre-provisioned PlatformOperator row plus
// admin-group membership, and a missing one yields a generic denial.
type JobMeta = {
  id: string; tenantId: string; kind: string; status: string;
  total: number; committed: number; error?: string | null; createdAt: string;
};

export default function AdminDashboard() {
  const [state, setState] = useState<'loading' | 'operator-signin' | 'mfa-required' | 'ready' | 'error'>('loading');
  const [jobs, setJobs] = useState<JobMeta[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const mr = await fetch('/api/admin/auth/mfa-status');
        if (mr.status === 401) { setState('operator-signin'); return; }
        if (!mr.ok) { setState('error'); return; }
        const mj = await mr.json().catch(() => ({}));
        if (!mj?.mfaVerified) { setState('mfa-required'); return; }
        const jr = await fetch('/api/admin/workflows/jobs');
        if (!jr.ok) { setState('error'); return; }
        const jj = await jr.json().catch(() => ({}));
        setJobs(Array.isArray(jj?.jobs) ? jj.jobs : []);
        setState(adminPageState('verified', true));
      } catch {
        setState('error');
      }
    })();
  }, []);

  if (state === 'loading') return <main className="page"><p className="muted">Loading…</p></main>;

  if (state === 'operator-signin') {
    return (
      <main className="page">
        <p className="kicker">Admin dashboard</p>
        <h1 className="brand">Operator sign-in required</h1>
        <p className="subtitle">Admin access is separate from your tenant sign-in. Signing in as a tenant — even as a Cognito admin-group member — does not by itself grant operator access.</p>
        <p>Operator sign-in requires a pre-provisioned operator account in the admin Cognito group. There is no self-registration: if your account is not provisioned as an operator, sign-in is denied without saying which check failed.</p>
        <p><a className="btn btn-primary" href="/api/admin/auth/cognito?next=/admin">Sign in as operator</a></p>
        <p className="muted">Already signed in as a tenant? That session stays untouched — operator access uses its own session.</p>
      </main>
    );
  }

  if (state === 'mfa-required') {
    return (
      <main className="page">
        <p className="kicker">Admin dashboard</p>
        <h1 className="brand">Multi-factor authentication required</h1>
        <p className="subtitle">Your operator session exists but is not MFA-verified. Admin routes stay closed until MFA is completed in the hosted UI.</p>
        <p><a className="btn btn-primary" href="/api/admin/auth/mfa-verify">Complete MFA verification</a></p>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main className="page">
        <p className="kicker">Admin dashboard</p>
        <h1 className="brand">Admin data unavailable</h1>
        <p className="muted">The operator jobs summary could not be loaded. No admin data is shown rather than a partial view.</p>
        <p><a href="/api/admin/auth/cognito?next=/admin">Retry operator sign-in →</a></p>
      </main>
    );
  }

  const byStatus = new Map<string, number>();
  for (const j of jobs) byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);
  return (
    <main className="page">
      <p className="kicker">Admin dashboard</p>
      <h1 className="brand">Platform jobs</h1>
      <p className="subtitle">Cross-tenant job metadata only — no dataset contents or record bodies.</p>
      <section className="card">
        <h2>Summary</h2>
        <p className="muted">{jobs.length} job{jobs.length === 1 ? '' : 's'}{byStatus.size > 0 ? ` — ${[...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join(', ')}` : ''}</p>
      </section>
      <section className="card">
        <h2>Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="muted">No jobs recorded.</p>
        ) : (
          <ul>
            {jobs.slice(0, 50).map((j) => (
              <li key={j.id}>
                <span className="muted">{j.kind} · {j.status} · {j.committed}/{j.total}</span>
                {j.error ? <span> · Error: {j.error}</span> : null}
                <span className="muted"> · Tenant {j.tenantId} · {j.createdAt}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
