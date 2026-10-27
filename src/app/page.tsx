'use client';
import { useEffect, useState } from 'react';

type Ds = { id: string; name: string; purpose: string; composition?: { authentic: number; synthetic: number; unknown: number; total: number } };

const SAMPLE_CSV = `order_id,customer,product,amount
1001,Ana,Notebook,24.99
1002,Ben,Pen,3.50
1003,Ana,Notebook,24.99
1004,Cara,Backpack,59.00
1005,Dan,Pen,3.50
1006,Eve,Notebook,24.99
1007,Frank,Backpack,59.00`;

type Job = { id: string; datasetId: string; kind: string; status: string; committed: number; total: number; error?: string | null };
type Me = { authenticated: boolean; mode?: string; user?: { email: string; tenantId: string } };
type RepairCase = { id: string; recordId: string; issue: string; status: string; repairedData?: unknown };

function jobPill(status: string): string {
  if (status === 'COMPLETED') return 'pill pill-ok';
  if (status === 'FAILED' || status === 'PARTIAL') return 'pill pill-bad';
  if (status === 'RUNNING' || status === 'QUEUED' || status === 'PAUSED' || status === 'CANCELLING') return 'pill pill-warn';
  return 'pill pill-neutral';
}

export default function Home() {
  const [datasets, setDatasets] = useState<Ds[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('Ecommerce demo');
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [augmentCount, setAugmentCount] = useState(2);
  const [exportText, setExportText] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [repairs, setRepairs] = useState<RepairCase[]>([]);
  const [repairRecordId, setRepairRecordId] = useState('');
  const [repairIssue, setRepairIssue] = useState('');
  const [repairData, setRepairData] = useState('');

  const load = async () => {
    const r = await fetch('/api/datasets'); const j = await r.json(); setDatasets(Array.isArray(j) ? j : []);
    if (j[0] && !selected) setSelected(j[0].id);
    const jr = await fetch('/api/jobs'); const jj = await jr.json().catch(() => []); if (Array.isArray(jj)) setJobs(jj);
  };
  const loadMe = async () => {
    const r = await fetch('/api/auth/me'); const j = await r.json().catch(() => ({})); setMe(j);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadMe(); load(); }, []);
  useEffect(() => {
    if (!selected || !me?.authenticated) { setRepairs([]); return; }
    fetch(`/api/datasets/${selected}/repair`).then((r) => r.json()).then((j) => { if (Array.isArray(j)) setRepairs(j); }).catch(() => {});
  }, [selected, me]);
  useEffect(() => {
    if (!selected) return;
    fetch(`/api/datasets/${selected}`).then((r) => r.json()).then(setDetail).catch(() => {});
  }, [selected, datasets]);

  const call = async (fn: () => Promise<Response>, label: string) => {
    setMsg(`${label}…`); setExportText('');
    try {
      const r = await fn(); const j = await r.json().catch(() => ({}));
      setMsg(`${label}: ${r.status} ${JSON.stringify(j).slice(0, 800)}`);
      await load();
    } catch (e) { setMsg(`${label} failed: ${e}`); }
  };

  return (
    <main className="page">
      <p className="kicker">ZeroDriveX / Meta AI Hackathon — Startup Track</p>
      <h1 className="brand">ZeroDriveX Data Intelligence Platform</h1>
      <p className="subtitle">Real-data-first processing, verified provenance, and controlled synthetic augmentation. <strong>Powered by Meta Muse models.</strong> Training export is blocked unless the final dataset is ≥70% verified authentic and ≤30% synthetic.</p>

      <div className="callout"><strong>30% cap rule:</strong> synthetic ≤ floor(3 × authentic / 7). Example: 10,000 authentic → max 4,285 synthetic. Unknown provenance never counts as authentic.</div>

      <div className="statusbar">
        <span><span className="pill pill-neutral">Mode: {me?.mode ?? '…'}</span></span>
        <span className="muted">{me?.authenticated ? `Signed in as ${me.user?.email} (tenant ${me.user?.tenantId})` : 'Not signed in — datasets shown are the demo file store, not private data.'}</span>
        {me && !me.authenticated && me.mode !== 'demo-no-db' ? (
          <span className="formrow" style={{ marginTop: 0 }}>
            <input className="input input-flex" aria-label="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
            <input className="input input-flex" aria-label="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
            <button className="btn btn-primary" onClick={async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const j = await r.json().catch(() => ({})); setMsg(`Login: ${r.status} ${JSON.stringify(j).slice(0, 300)}`); await loadMe(); await load(); }}>Sign in</button>
          </span>
        ) : null}
        {me?.authenticated ? (
          <button className="btn" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); setMe(null); await loadMe(); }}>Sign out</button>
        ) : null}
      </div>

      <section className="card">
        <h2>1. Create dataset</h2>
        <p>Start with a named training dataset, then select it for the steps below.</p>
        <div className="formrow">
          <label className="field" style={{ flex: '1 1 260px' }}>Dataset name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={() => call(async () => fetch('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, purpose: 'training', sourceName: 'Demo sample', sourceLicense: 'Demo sample — mark verified only if you own/rights it' }) }), 'Create dataset')}>Create training dataset</button>
        </div>
        <div className="formrow">
          <label className="field" style={{ flex: '1 1 260px' }}>Dataset
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id}) — {d.composition?.total ?? 0} records</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>2. Ingest (CSV, verified authentic)</h2>
        <p>Sample below is a demo sample, not real customer data. In production, mark AUTHENTIC_VERIFIED only when you have source + licence evidence.</p>
        <textarea className="input input-wide" value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} />
        <div className="formrow">
          <button className="btn btn-primary" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'csv', text: csv, provenance: 'AUTHENTIC_VERIFIED', sourceName: 'Demo sample', sourceLicense: 'Demo sample' }) }), 'Ingest')}>Ingest as verified authentic</button>
          <button className="btn" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'csv', text: csv, provenance: 'AUTHENTIC_UNVERIFIED', sourceName: 'Demo sample', sourceLicense: 'Demo sample' }) }), 'Ingest unverified')}>Ingest as unverified (export will block)</button>
        </div>
      </section>

      <section className="card">
        <h2>3. Analyse, augment, quality, export</h2>
        <p>Each action runs against the selected dataset and reports its result below.</p>
        <div className="formrow">
          <button className="btn" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/analyze`, { method: 'POST' }), 'Analyse')}>Analyse</button>
          <button className="btn" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/schema`, { method: 'POST' }), 'Infer schema')}>Infer schema (review required)</button>
          <button className="btn" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/evaluate`, { method: 'POST' }), 'Evaluate')}>Evaluate</button>
          <button className="btn" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/quality`), 'Quality')}>Quality</button>
          <label className="field">Synthetic rows
            <input className="input input-narrow" aria-label="synthetic rows" type="number" value={augmentCount} onChange={(e) => setAugmentCount(Number(e.target.value))} />
          </label>
          <button className="btn" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/augment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: augmentCount }) }), 'Augment')}>Augment (capped)</button>
          <button className="btn btn-primary" disabled={!selected} onClick={async () => {
            if (!selected) return; setMsg('Export…');
            const r = await fetch(`/api/datasets/${selected}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'jsonl' }) });
            const j = await r.json().catch(() => ({})); setMsg(`Export: ${r.status} ${JSON.stringify(j.manifest ?? j).slice(0, 800)}`); if (j.content) setExportText(j.content);
          }}>Export JSONL (gated)</button>
        </div>
        <pre className="output">{msg}</pre>
        {detail ? <pre className="output">{JSON.stringify(detail, null, 2).slice(0, 2000)}</pre> : null}
        {exportText ? <pre className="output">{exportText.slice(0, 4000)}</pre> : null}
      </section>

      <section className="card">
        <h2>4. Jobs — status, progress, failures, retry</h2>
        <p>Durable jobs run on the server worker (service-authenticated; the browser never holds the worker secret). Pause, resume, and cancel are tenant-scoped. Resume also retries a failed job.</p>
        <div className="formrow">
          <button className="btn" onClick={load}>Refresh jobs</button>
          <button className="btn btn-primary" disabled={!selected} onClick={async () => {
            if (!selected) return; setMsg('Export…');
            const r = await fetch(`/api/datasets/${selected}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'jsonl' }) });
            const j = await r.json().catch(() => ({})); setMsg(`Export: ${r.status} ${JSON.stringify(j.manifest ?? j).slice(0, 800)}`);
            if (j.content) { setExportText(j.content); const blob = new Blob([j.content], { type: 'application/x-ndjson' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${selected}.jsonl`; a.click(); }
          }}>Export JSONL + download file (gated)</button>
        </div>
        <ul className="joblist">
          {jobs.map((j) => (
            <li key={j.id} className="jobrow">
              <span><strong>{j.kind}</strong></span>
              <span className={jobPill(j.status)}>{j.status}</span>
              <span>{j.committed}/{j.total}</span>
              <span className="mono">{j.id}</span>
              {j.error ? <span className="err">error: {j.error}</span> : null}
              {me?.authenticated ? (
                <span className="actions">
                  <button className="btn btn-sm" onClick={() => call(async () => fetch(`/api/jobs/${j.id}/pause`, { method: 'POST' }), 'Pause job')}>Pause</button>
                  <button className="btn btn-sm" onClick={() => call(async () => fetch(`/api/jobs/${j.id}/resume`, { method: 'POST' }), 'Resume job')}>Resume / retry</button>
                  <button className="btn btn-sm" onClick={() => call(async () => fetch(`/api/jobs/${j.id}/cancel`, { method: 'POST' }), 'Cancel job')}>Cancel</button>
                </span>
              ) : null}
            </li>
          ))}
          {jobs.length === 0 ? <li className="jobrow"><span className="muted">No jobs yet.</span></li> : null}
        </ul>
      </section>

      {me?.authenticated ? (
        <section className="card">
          <h2>5. Targeted repair (DB mode)</h2>
          <p>Creating a case never changes data. Approving applies the repaired row in a transaction and records the case id in the record — provenance is not changed by repair.</p>
          <div className="formrow">
            <input className="input input-flex" value={repairRecordId} onChange={(e) => setRepairRecordId(e.target.value)} placeholder="record id" />
            <input className="input input-flex" value={repairIssue} onChange={(e) => setRepairIssue(e.target.value)} placeholder="issue description" />
          </div>
          <textarea className="input input-wide" value={repairData} onChange={(e) => setRepairData(e.target.value)} placeholder='{"field": "fixed value"} (optional, repaired row JSON)' rows={3} style={{ marginTop: 8 }} />
          <div className="formrow">
            <button className="btn btn-primary" disabled={!selected} onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/repair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId: repairRecordId, issue: repairIssue, repairedData: repairData ? JSON.parse(repairData) : undefined }) }), 'Create repair case')}>Create repair case</button>
          </div>
          <ul className="joblist">
            {repairs.map((c) => (
              <li key={c.id} className="jobrow">
                <span className={jobPill(c.status)}>{c.status}</span>
                <span>{c.issue}</span>
                <span className="mono">record {c.recordId}</span>
                {c.status === 'open' ? (
                  <span className="actions">
                    <button className="btn btn-sm" onClick={() => call(async () => fetch(`/api/datasets/${selected}/repair/${c.id}/approve`, { method: 'POST' }), 'Approve repair')}>Approve</button>
                    <button className="btn btn-sm" onClick={() => call(async () => fetch(`/api/datasets/${selected}/repair/${c.id}/reject`, { method: 'POST' }), 'Reject repair')}>Reject</button>
                  </span>
                ) : null}
              </li>
            ))}
            {repairs.length === 0 ? <li className="jobrow"><span className="muted">No repair cases for this dataset.</span></li> : null}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <h2>Model split — read before you send private data</h2>
        <ul className="tight">
          <li><b>muse-spark-1.3-contributor</b> — public/demo only. Meta may use it for training. $0.10 / $0.002 cached / $0.20 per million tokens.</li>
          <li><b>muse-spark-1.3</b> — private only. Not used for training. $1.25 / $0.15 cached / $4.25 per million tokens.</li>
          <li><b>muse-image-1.0</b> — $0.01/image, on demand. <b>sam-3.1</b> — segmentation, on demand. <b>muse-voice-transcribe-1.0</b> — $0.18/hour. <b>Multimodal ingestion is NOT operational yet</b> — no verified endpoint functions exist, and the /api/multimodal endpoint returns 503 rather than a simulated result.</li>
          <li><b>No Wonder by default</b> — $4/$20 would burn the $150 grant.</li>
        </ul>
        <p>Full split, EULA, and documentation are in the repo docs. Never paste an API key into this UI — keys are server-side only.</p>
      </section>

      <footer className="footer">
        <span>ZeroDriveX Data Intelligence Platform</span>
        <span>Built with Muse · Meta AI Hackathon, Startup Track</span>
        <span><a href="/api/health">Health</a> · <a href="/api/models">Models</a> · <a href="/api/jobs">Jobs</a></span>
      </footer>
    </main>
  );
}
