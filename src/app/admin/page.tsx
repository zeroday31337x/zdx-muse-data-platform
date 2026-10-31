'use client';
import { useEffect, useState } from 'react';
import { adminPageState } from '@/lib/nav';

// Admin console (admin-console-v1). Authorization is the EXISTING
// operator flow, unchanged: a tenant session (even for a Cognito
// admin-group member) is never accepted here, because /api/admin/*
// reads only the separate zdx_operator_session cookie. States, in
// order: no operator session → operator sign-in prompt; MFA_PENDING
// → MFA prompt; verified → the console below.
//
// Every section here is wired to an existing /api/admin/* route from
// the revised admin spec (docs/coord-admin.md). The console adds no
// new authorization and no new data access: operator visibility stays
// metadata-only (counts, composition summaries, status, job metadata
// — never dataset contents, record bodies, or job payloads). Locked
// settings, tier allowlists, and resource limits are read-only in v1
// by the routes themselves (PATCH → SETTING_LOCKED); this page shows
// them as such instead of pretending an edit would apply.
type Row = Record<string, unknown>;
const s = (r: Row, k: string): string => {
  const v = r[k];
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};
async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Row }> {
  const r = await fetch(path, init);
  const body = (await r.json().catch(() => ({}))) as Row;
  return { ok: r.ok, status: r.status, body };
}
const errText = (b: Row): string => (typeof b.error === 'string' ? b.error : 'Request failed');

type Section = 'jobs' | 'tenants' | 'users' | 'invitations' | 'eligibility' | 'billing' | 'settings' | 'allowlist' | 'operators' | 'audit';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'tenants', label: 'Tenants' },
  { id: 'users', label: 'Users' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'eligibility', label: 'Contributor eligibility' },
  { id: 'billing', label: 'Billing' },
  { id: 'settings', label: 'Platform settings' },
  { id: 'allowlist', label: 'Allowlist & limits' },
  { id: 'operators', label: 'Operators' },
  { id: 'audit', label: 'Audit' },
];

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: '0.5rem' }}>
      <span className="muted">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ display: 'block', width: '100%', marginTop: '0.25rem' }} />
    </label>
  );
}

export default function AdminDashboard() {
  const [state, setState] = useState<'loading' | 'operator-signin' | 'mfa-required' | 'ready' | 'error'>('loading');
  const [section, setSection] = useState<Section>('jobs');
  const [notice, setNotice] = useState('');
  const [jobs, setJobs] = useState<Row[]>([]);
  const [tenants, setTenants] = useState<Row[]>([]);
  const [tenantDetail, setTenantDetail] = useState<Row | null>(null);
  const [users, setUsers] = useState<Row[]>([]);
  const [eligibility, setEligibility] = useState<Row[]>([]);
  const [dunning, setDunning] = useState<Row[]>([]);
  const [settingsRows, setSettingsRows] = useState<Row[]>([]);
  const [editableKeys, setEditableKeys] = useState<string[]>([]);
  const [versions, setVersions] = useState<Row[]>([]);
  const [allowlist, setAllowlist] = useState<Row | null>(null);
  const [limits, setLimits] = useState<Row | null>(null);
  const [operators, setOperators] = useState<Row[]>([]);
  const [auditRows, setAuditRows] = useState<Row[]>([]);

  const [invTenant, setInvTenant] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invToken, setInvToken] = useState('');
  const [revokeInv, setRevokeInv] = useState('');
  const [eligTenant, setEligTenant] = useState('');
  const [eligReason, setEligReason] = useState('');
  const [eligValue, setEligValue] = useState('true');
  const [billTenant, setBillTenant] = useState('');
  const [priceKey, setPriceKey] = useState('');
  const [billUrl, setBillUrl] = useState('');
  const [settingKey, setSettingKey] = useState('announcement');
  const [settingValue, setSettingValue] = useState('');
  const [opEmail, setOpEmail] = useState('');
  const [opSub, setOpSub] = useState('');
  const [auditQ, setAuditQ] = useState({ tenantId: '', actor: '', action: '', take: '100' });
  const [renameName, setRenameName] = useState('');

  const loadJobs = async () => {
    const { ok, body } = await api('/api/admin/workflows/jobs');
    if (ok) setJobs(Array.isArray(body.jobs) ? (body.jobs as Row[]) : []);
  };
  const loadSection = async (sec: Section) => {
    setNotice('');
    if (sec === 'jobs') return loadJobs();
    if (sec === 'tenants') {
      const { ok, body } = await api('/api/admin/tenants');
      if (ok) setTenants(Array.isArray(body.tenants) ? (body.tenants as Row[]) : []);
    } else if (sec === 'users') {
      const { ok, body } = await api('/api/admin/users');
      if (ok) setUsers(Array.isArray(body.users) ? (body.users as Row[]) : []);
    } else if (sec === 'eligibility') {
      const { ok, body } = await api('/api/admin/contributor-eligibility');
      if (ok) setEligibility(Array.isArray(body.eligibility) ? (body.eligibility as Row[]) : []);
    } else if (sec === 'billing') {
      const { ok, body } = await api('/api/admin/billing/dunning');
      if (ok) setDunning(Array.isArray(body.dunning) ? (body.dunning as Row[]) : []);
    } else if (sec === 'settings') {
      const { ok, body } = await api('/api/admin/platform-settings');
      if (ok) {
        setSettingsRows(Array.isArray(body.settings) ? (body.settings as Row[]) : []);
        setEditableKeys(Array.isArray(body.editableKeys) ? (body.editableKeys as string[]) : []);
      }
      const v = await api('/api/admin/platform-settings/versions');
      if (v.ok) setVersions(Array.isArray(v.body.versions) ? (v.body.versions as Row[]) : []);
    } else if (sec === 'allowlist') {
      const a = await api('/api/admin/tier-allowlist');
      if (a.ok) setAllowlist(a.body);
      const l = await api('/api/admin/resource-limits');
      if (l.ok) setLimits(l.body);
    } else if (sec === 'operators') {
      const { ok, body } = await api('/api/admin/operators');
      if (ok) setOperators(Array.isArray(body.operators) ? (body.operators as Row[]) : []);
    }
  };

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

  const pick = (sec: Section) => { setSection(sec); void loadSection(sec); };
  const act = async (fn: () => Promise<{ ok: boolean; body: Row }>, okMsg: string) => {
    const r = await fn();
    setNotice(r.ok ? okMsg : `Failed: ${errText(r.body)}`);
    return r;
  };

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
  for (const j of jobs) byStatus.set(s(j, 'status'), (byStatus.get(s(j, 'status')) ?? 0) + 1);
  return (
    <main className="page">
      <p className="kicker">Admin dashboard</p>
      <h1 className="brand">Platform control</h1>
      <p className="subtitle">Cross-tenant metadata only — no dataset contents, record bodies, or job payloads. Every tenant-affecting action is audited.</p>
      <nav aria-label="Admin sections" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        {SECTIONS.map((sec) => (
          <button key={sec.id} type="button" className="btn" aria-pressed={section === sec.id} onClick={() => pick(sec.id)}>{sec.label}</button>
        ))}
      </nav>
      {notice && <p className="muted">{notice}</p>}

      {section === 'jobs' && (
        <section className="card">
          <h2>Jobs — {jobs.length} total{byStatus.size > 0 ? ` — ${[...byStatus.entries()].map(([st, n]) => `${st}: ${n}`).join(', ')}` : ''}</h2>
          {jobs.length === 0 ? <p className="muted">No jobs recorded.</p> : (
            <ul>
              {jobs.slice(0, 100).map((j) => (
                <li key={s(j, 'id')}>
                  <span className="muted">{s(j, 'kind')} · {s(j, 'status')} · {s(j, 'committed')}/{s(j, 'total')} · Tenant {s(j, 'tenantId')}</span>
                  {s(j, 'error') !== '—' ? <span> · Error: {s(j, 'error')}</span> : null}
                  <span> </span>
                  {['pause', 'resume', 'cancel', 'retry', 'reclaim-lease'].map((a) => (
                    <button key={a} type="button" className="btn" onClick={async () => { await act(() => api(`/api/admin/workflows/jobs/${s(j, 'id')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: a }) }), `Job ${a} requested.`); await loadJobs(); }}>{a}</button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === 'tenants' && (
        <section className="card">
          <h2>Tenants</h2>
          {tenants.length === 0 ? <p className="muted">No tenants, or list failed to load.</p> : (
            <ul>
              {tenants.map((t) => (
                <li key={s(t, 'id')}>
                  <span className="muted">{s(t, 'name')} · {s(t, 'subscriptionStatus')} · plan {s(t, 'subscriptionPlan')} · users {s(t, 'userCount')} · datasets {s(t, 'datasetCount')} · jobs {s(t, 'jobCount')}</span>
                  <span> </span>
                  <button type="button" className="btn" onClick={async () => { const r = await api(`/api/admin/tenants/${s(t, 'id')}`); if (r.ok) setTenantDetail(r.body); else setNotice(`Failed: ${errText(r.body)}`); }}>Detail</button>
                  <button type="button" className="btn" onClick={async () => { await act(() => api(`/api/admin/tenants/${s(t, 'id')}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: true }) }), 'Tenant users disabled.'); await loadSection('tenants'); }}>Disable users</button>
                  <button type="button" className="btn" onClick={async () => { await act(() => api(`/api/admin/tenants/${s(t, 'id')}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: false }) }), 'Tenant users enabled.'); await loadSection('tenants'); }}>Enable users</button>
                </li>
              ))}
            </ul>
          )}
          {tenantDetail && (
            <div style={{ marginTop: '1rem' }}>
              <h3>Tenant detail</h3>
              <Field label="New name (rename)" value={renameName} onChange={setRenameName} />
              <button type="button" className="btn btn-primary" onClick={async () => { const id = s(tenantDetail, 'id'); if (id === '—' || !renameName) { setNotice('Pick a tenant detail and enter a name first.'); return; } await act(() => api(`/api/admin/tenants/${id}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: renameName }) }), 'Tenant renamed (name only; entitlement and plan keys are locked).'); }}>Rename tenant</button>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(tenantDetail, null, 2)}</pre>
            </div>
          )}
          <p className="muted">Tenant settings are name-only. Entitlement, plan, allowlist, and preference keys are locked by the route (SETTING_LOCKED).</p>
        </section>
      )}

      {section === 'users' && (
        <section className="card">
          <h2>Users</h2>
          {users.length === 0 ? <p className="muted">No users, or list failed to load.</p> : (
            <ul>
              {users.map((u) => (
                <li key={s(u, 'id')}>
                  <span className="muted">{s(u, 'email')} · tenant {s(u, 'tenantId')} · role {s(u, 'role')} · {s(u, 'authProvider')}{s(u, 'disabledAt') !== '—' ? ' · DISABLED' : ''}</span>
                  <span> </span>
                  <button type="button" className="btn" onClick={async () => { await act(() => api(`/api/admin/users/${s(u, 'id')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: s(u, 'role') === 'admin' ? 'member' : 'admin' }) }), 'User role updated.'); await loadSection('users'); }}>Toggle admin/member</button>
                  <button type="button" className="btn" onClick={async () => { await act(() => api(`/api/admin/users/${s(u, 'id')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: s(u, 'disabledAt') === '—' }) }), 'User status updated.'); await loadSection('users'); }}>{s(u, 'disabledAt') === '—' ? 'Disable' : 'Enable'}</button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">Last-admin protection applies (LAST_ADMIN): the final admin of a tenant cannot be demoted or disabled.</p>
        </section>
      )}

      {section === 'invitations' && (
        <section className="card">
          <h2>Invitations</h2>
          <Field label="Tenant ID" value={invTenant} onChange={setInvTenant} />
          <Field label="Email" value={invEmail} onChange={setInvEmail} />
          <button type="button" className="btn btn-primary" onClick={async () => { const r = await act(() => api('/api/admin/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: invTenant, email: invEmail }) }), 'Invitation created.'); if (r.ok) setInvToken(typeof r.body.token === 'string' ? r.body.token : ''); }}>Create invitation (role capped to member)</button>
          {invToken && <p><strong>Token shown once — store it now, it is not retrievable later:</strong> {invToken}</p>}
          <p className="muted">Revoke an invitation from its ID (accept already requires a pending invitation):</p>
          <Field label="Invitation ID to revoke" value={revokeInv} onChange={setRevokeInv} />
          <button type="button" className="btn" onClick={async () => { if (!revokeInv) { setNotice('Enter an invitation ID first.'); return; } await act(() => api(`/api/admin/invitations/${revokeInv}/revoke`, { method: 'POST' }), 'Invitation revoked.'); }}>Revoke invitation</button>
        </section>
      )}

      {section === 'eligibility' && (
        <section className="card">
          <h2>Contributor eligibility</h2>
          <p className="muted">Eligibility is never automatic: public data is not authorized for Contributor mode without an explicit grant and a reason. This record is the source of truth.</p>
          <Field label="Tenant ID" value={eligTenant} onChange={setEligTenant} />
          <Field label="Reason (required, 3+ characters)" value={eligReason} onChange={setEligReason} />
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <span className="muted">Eligible</span>
            <select value={eligValue} onChange={(e) => setEligValue(e.target.value)} style={{ display: 'block', marginTop: '0.25rem' }}>
              <option value="true">Grant (eligible)</option>
              <option value="false">Revoke (not eligible)</option>
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={async () => { await act(() => api('/api/admin/contributor-eligibility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: eligTenant, eligible: eligValue === 'true', reason: eligReason }) }), 'Eligibility updated.'); await loadSection('eligibility'); }}>Save eligibility</button>
          <ul>
            {eligibility.map((e, i) => (
              <li key={i}><span className="muted">Tenant {s(e, 'tenantId')} · eligible {s(e, 'eligible')} · {s(e, 'reason')}</span></li>
            ))}
          </ul>
        </section>
      )}

      {section === 'billing' && (
        <section className="card">
          <h2>Billing operations</h2>
          <p className="muted">Production charging stays disabled until the platform is finished and cost runs are done; these operations use Stripe state only and never invent prices. The operator generates checkout/portal URLs — the tenant&apos;s own admin completes checkout, the operator never does.</p>
          <h3>Dunning (past-due tenants)</h3>
          {dunning.length === 0 ? <p className="muted">No past-due tenants listed.</p> : (
            <ul>{dunning.map((d) => (<li key={s(d, 'tenantId')}><span className="muted">{s(d, 'name')} · {s(d, 'subscriptionStatus')} · Stripe {s(d, 'stripeSubscriptionStatus')} · days past period end {s(d, 'daysPastPeriodEnd')}</span></li>))}</ul>
          )}
          <Field label="Tenant ID (reconcile / checkout / portal)" value={billTenant} onChange={setBillTenant} />
          <button type="button" className="btn" onClick={async () => { await act(() => api('/api/admin/billing/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: billTenant }) }), 'Reconcile requested (authoritative Stripe fetch; unknown status changes nothing).'); }}>Reconcile from Stripe</button>
          <span> </span>
          <button type="button" className="btn" onClick={async () => { const r = await act(() => api('/api/admin/billing/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: billTenant }) }), 'Portal URL generated.'); if (r.ok && typeof r.body.url === 'string') setBillUrl(r.body.url); }}>Generate portal URL</button>
          <Field label="Price key (checkout; server allowlist validates it)" value={priceKey} onChange={setPriceKey} />
          <button type="button" className="btn" onClick={async () => { const r = await act(() => api('/api/admin/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: billTenant, priceKey }) }), 'Checkout URL generated.'); if (r.ok && typeof r.body.url === 'string') setBillUrl(r.body.url); }}>Generate checkout URL</button>
          {billUrl && <p>Send this URL to the tenant admin: <a href={billUrl}>{billUrl}</a></p>}
        </section>
      )}

      {section === 'settings' && (
        <section className="card">
          <h2>Platform settings</h2>
          <p className="muted">Editable in v1: {editableKeys.length > 0 ? editableKeys.join(', ') : 'announcement, supportEmail, maintenanceMode'}. Locked keys (70/30, isolation, provenance, secrets, audit append-only, entitlement derivation, tier allowlist, resource limits, hard ceiling, Stripe/Cognito/Meta namespaces) are read-only and rejected on write — never silently ignored. Values above the hard ceiling are rejected at write time. Versions are append-only.</p>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <span className="muted">Key</span>
            <select value={settingKey} onChange={(e) => setSettingKey(e.target.value)} style={{ display: 'block', marginTop: '0.25rem' }}>
              {(editableKeys.length > 0 ? editableKeys : ['announcement', 'supportEmail', 'maintenanceMode']).map((k) => (<option key={k} value={k}>{k}</option>))}
            </select>
          </label>
          <Field label="Value (use true/false for maintenanceMode)" value={settingValue} onChange={setSettingValue} />
          <button type="button" className="btn btn-primary" onClick={async () => { const value = settingKey === 'maintenanceMode' ? settingValue === 'true' : settingValue; await act(() => api('/api/admin/platform-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: settingKey, value }) }), 'Setting saved (versioned).'); await loadSection('settings'); }}>Save setting</button>
          <h3>Current settings</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(settingsRows, null, 2)}</pre>
          <h3>Versions (append-only)</h3>
          <ul>{versions.slice(0, 50).map((v, i) => (<li key={i}><span className="muted">{s(v, 'key')} · {JSON.stringify(v.value)} · by {s(v, 'changedBy')} · {s(v, 'createdAt')}</span></li>))}</ul>
        </section>
      )}

      {section === 'allowlist' && (
        <section className="card">
          <h2>Tier allowlist &amp; resource limits — read-only in v1</h2>
          <p className="muted">Changes here require a server config change + redeploy under separate approval. Nothing on this tab edits anything. Resource-limit values are PROPOSED, not approved policy.</p>
          <h3>Allowlist</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{allowlist ? JSON.stringify(allowlist, null, 2) : 'Not loaded.'}</pre>
          <h3>Resource limits</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{limits ? JSON.stringify(limits, null, 2) : 'Not loaded.'}</pre>
        </section>
      )}

      {section === 'operators' && (
        <section className="card">
          <h2>Operators</h2>
          <p className="muted">An operator row alone never grants access — Cognito admin-group membership is still checked at login. You cannot disable yourself, and the last active operator cannot be disabled.</p>
          <Field label="Email (new operator)" value={opEmail} onChange={setOpEmail} />
          <Field label="Cognito sub (new operator)" value={opSub} onChange={setOpSub} />
          <button type="button" className="btn btn-primary" onClick={async () => { await act(() => api('/api/admin/operators', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: opEmail, cognitoSub: opSub }) }), 'Operator row created. Cognito admin-group membership is still required at login.'); await loadSection('operators'); }}>Create operator</button>
          <ul>
            {operators.map((o) => (
              <li key={s(o, 'id')}>
                <span className="muted">{s(o, 'email')}{s(o, 'disabledAt') !== '—' ? ' · DISABLED' : ''}</span>
                <span> </span>
                <button type="button" className="btn" onClick={async () => { await act(() => api(`/api/admin/operators/${s(o, 'id')}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: s(o, 'disabledAt') === '—' }) }), 'Operator status updated.'); await loadSection('operators'); }}>{s(o, 'disabledAt') === '—' ? 'Disable' : 'Enable'}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {section === 'audit' && (
        <section className="card">
          <h2>Audit search (append-only — no delete exists)</h2>
          <Field label="Tenant ID (optional)" value={auditQ.tenantId} onChange={(v) => setAuditQ({ ...auditQ, tenantId: v })} />
          <Field label="Actor contains (optional)" value={auditQ.actor} onChange={(v) => setAuditQ({ ...auditQ, actor: v })} />
          <Field label="Action (optional)" value={auditQ.action} onChange={(v) => setAuditQ({ ...auditQ, action: v })} />
          <button type="button" className="btn btn-primary" onClick={async () => { const q = new URLSearchParams(); if (auditQ.tenantId) q.set('tenantId', auditQ.tenantId); if (auditQ.actor) q.set('actor', auditQ.actor); if (auditQ.action) q.set('action', auditQ.action); q.set('take', auditQ.take); const r = await api(`/api/admin/audit?${q.toString()}`); if (r.ok) setAuditRows(Array.isArray(r.body.audit) ? (r.body.audit as Row[]) : []); else setNotice(`Failed: ${errText(r.body)}`); }}>Search audit</button>
          <ul>
            {auditRows.slice(0, 100).map((a, i) => (
              <li key={i}><span className="muted">{s(a, 'createdAt')} · {s(a, 'actor')} · {s(a, 'action')} · {s(a, 'entity')} · tenant {s(a, 'tenantId')}</span></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
