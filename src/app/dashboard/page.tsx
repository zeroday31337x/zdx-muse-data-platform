'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { guardedView, type MeState } from '@/lib/nav';

// User dashboard: signed-in overview only. Unauthenticated visitors
// get a sign-in prompt and NO private data is fetched. For a brand-new
// tenant (no datasets yet) the page shows an explicit empty state with
// first steps instead of dropping the user onto the workbench, which
// is what made a new tenant look like "there's nothing here".
type Ds = { id: string; name: string };
type Billing = { status?: string; plan?: string | null; currentPeriodEnd?: string | null };

export default function Dashboard() {
  const [me, setMe] = useState<MeState | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [datasets, setDatasets] = useState<Ds[] | null>(null);
  const [datasetsFailed, setDatasetsFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me');
        const j = await r.json().catch(() => ({}));
        const state: MeState = { authenticated: Boolean(j?.authenticated), user: j?.user };
        setMe(state);
        // Private data is fetched ONLY in the signed-in branch.
        if (state.authenticated) {
          const br = await fetch('/api/billing/subscription');
          if (br.ok) { const bj = await br.json().catch(() => null); if (bj && typeof bj === 'object') setBilling(bj); }
          const dr = await fetch('/api/datasets');
          if (dr.ok) { const dj = await dr.json().catch(() => null); setDatasets(Array.isArray(dj) ? dj : []); }
          else setDatasetsFailed(true);
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
        <p className="kicker">Dashboard</p>
        <h1 className="brand">Sign in to view your dashboard</h1>
        <p className="subtitle">Your datasets, billing status, and tenant summary live here once you sign in.</p>
        <p><a className="btn btn-primary" href="/api/auth/cognito?mode=login">Sign in with Cognito</a></p>
      </main>
    );
  }
  const empty = !datasetsFailed && datasets !== null && datasets.length === 0;
  return (
    <main className="page">
      <p className="kicker">Dashboard</p>
      <h1 className="brand">Welcome{me?.user?.email ? `, ${me.user.email}` : ''}</h1>
      <section className="card">
        <h2>Profile</h2>
        <p className="muted">Email: {me?.user?.email ?? '—'} · Provider: {me?.user?.provider ?? '—'} · Role: {me?.user?.role ?? '—'}</p>
        <p className="muted">Tenant: {me?.user?.tenantId ?? '—'}</p>
      </section>
      <section className="card">
        <h2>Billing</h2>
        {billing
          ? <p className="muted">Status: {billing.status ?? '—'} · Plan: {billing.plan ?? '—'} · Current period ends: {billing.currentPeriodEnd ?? '—'}</p>
          : <p className="muted">Billing status unavailable.</p>}
        <p><Link href="/settings">Billing details and sign-out →</Link></p>
      </section>
      <section className="card">
        <h2>Your datasets</h2>
        {datasetsFailed && <p className="muted">Datasets could not be loaded.</p>}
        {datasets === null && !datasetsFailed && <p className="muted">Loading…</p>}
        {empty && (
          <div>
            <p><strong>Your tenant is new — no datasets yet.</strong> That is expected, not an error.</p>
            <ol>
              <li><Link href="/">Go to the Workbench</Link> and create your first dataset.</li>
              <li>Ingest a CSV of verified authentic records.</li>
              <li>Run Analyse and Quality, then export — training export stays blocked unless the final dataset is ≥70% verified authentic.</li>
            </ol>
            <p><Link className="btn btn-primary" href="/">Create your first dataset</Link></p>
          </div>
        )}
        {datasets !== null && datasets.length > 0 && (
          <div>
            <p className="muted">{datasets.length} dataset{datasets.length === 1 ? '' : 's'} in this tenant.</p>
            <ul>{datasets.map((d) => (<li key={d.id}>{d.name}</li>))}</ul>
            <p><Link href="/">Open the Workbench →</Link></p>
          </div>
        )}
      </section>
    </main>
  );
}
