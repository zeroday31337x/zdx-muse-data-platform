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
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <p style={{ color: '#7dd3fc', letterSpacing: '0.12em' }}>ZERODRIVEX / META AI HACKATHON — STARTUP TRACK</p>
      <h1>ZDX Muse Data Platform</h1>
      <p>Real-data-first processing, verified provenance, and controlled synthetic augmentation. Muse models only. Training export is blocked unless the final dataset is ≥70% verified authentic and ≤30% synthetic.</p>
      <p style={{ background: '#1e293b', padding: 12, borderRadius: 8 }}>30% cap rule: synthetic ≤ floor(3 × authentic / 7). Example: 10,000 authentic → max 4,285 synthetic. Unknown provenance never counts as authentic.</p>
      <p style={{ background: '#1e293b', padding: 12, borderRadius: 8 }}>
        Mode: {me?.mode ?? '…'} · {me?.authenticated ? `Signed in as ${me.user?.email} (tenant ${me.user?.tenantId})` : 'Not signed in — datasets shown are the demo file store, not private data.'}
        {me && !me.authenticated && me.mode !== 'demo-no-db' ? (
          <span style={{ display: 'block', marginTop: 8 }}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" style={{ padding: 8, marginRight: 8 }} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" style={{ padding: 8, marginRight: 8 }} />
            <button onClick={async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const j = await r.json().catch(() => ({})); setMsg(`Login: ${r.status} ${JSON.stringify(j).slice(0, 300)}`); await loadMe(); await load(); }} style={{ padding: 8 }}>Sign in</button>
          </span>
        ) : null}
        {me?.authenticated ? (
          <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); setMe(null); await loadMe(); }} style={{ marginLeft: 8, padding: 8 }}>Sign out</button>
        ) : null}
      </p>

      <section style={{ border: '1px solid #334155', padding: 20, borderRadius: 12, marginTop: 20 }}>
        <h2>1. Create dataset</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 8, width: '60%' }} />
        <button onClick={() => call(async () => fetch('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, purpose: 'training', sourceName: 'Demo sample', sourceLicense: 'Demo sample — mark verified only if you own/rights it' }) }), 'Create dataset')} style={{ marginLeft: 8, padding: 8 }}>Create training dataset</button>
        <div style={{ marginTop: 12 }}>
          <label>Dataset: </label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id}) — {d.composition?.total ?? 0} records</option>)}
          </select>
        </div>
      </section>

      <section style={{ border: '1px solid #334155', padding: 20, borderRadius: 12, marginTop: 20 }}>
        <h2>2. Ingest (CSV, verified authentic)</h2>
        <p>Sample below is a demo sample, not real customer data. In production, mark AUTHENTIC_VERIFIED only when you have source + licence evidence.</p>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} style={{ width: '100%', padding: 8 }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'csv', text: csv, provenance: 'AUTHENTIC_VERIFIED', sourceName: 'Demo sample', sourceLicense: 'Demo sample' }) }), 'Ingest')} style={{ padding: 8 }}>Ingest as verified authentic</button>
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'csv', text: csv, provenance: 'AUTHENTIC_UNVERIFIED', sourceName: 'Demo sample', sourceLicense: 'Demo sample' }) }), 'Ingest unverified')} style={{ marginLeft: 8, padding: 8 }}>Ingest as unverified (export will block)</button>
        </div>
      </section>

      <section style={{ border: '1px solid #334155', padding: 20, borderRadius: 12, marginTop: 20 }}>
        <h2>3. Analyse, augment, quality, export</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/analyze`, { method: 'POST' }), 'Analyse')} style={{ padding: 8 }}>Analyse</button>
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/schema`, { method: 'POST' }), 'Infer schema')} style={{ padding: 8 }}>Infer schema (review required)</button>
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/evaluate`, { method: 'POST' }), 'Evaluate')} style={{ padding: 8 }}>Evaluate</button>
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/quality`), 'Quality')} style={{ padding: 8 }}>Quality</button>
          <input type="number" value={augmentCount} onChange={(e) => setAugmentCount(Number(e.target.value))} style={{ width: 80, padding: 8 }} />
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/augment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: augmentCount }) }), 'Augment')} style={{ padding: 8 }}>Augment (capped)</button>
          <button onClick={async () => {
            if (!selected) return; setMsg('Export…');
            const r = await fetch(`/api/datasets/${selected}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'jsonl' }) });
            const j = await r.json().catch(() => ({})); setMsg(`Export: ${r.status} ${JSON.stringify(j.manifest ?? j).slice(0, 800)}`); if (j.content) setExportText(j.content);
          }} style={{ padding: 8 }}>Export JSONL (gated)</button>
        </div>
        <pre style={{ background: '#0f172a', padding: 12, whiteSpace: 'pre-wrap', marginTop: 12 }}>{msg}</pre>
        {detail ? <pre style={{ background: '#0f172a', padding: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail, null, 2).slice(0, 2000)}</pre> : null}
        {exportText ? <pre style={{ background: '#0f172a', padding: 12, whiteSpace: 'pre-wrap' }}>{exportText.slice(0, 4000)}</pre> : null}
      </section>

      <section style={{ border: '1px solid #334155', padding: 20, borderRadius: 12, marginTop: 20 }}>
        <h2>4. Jobs — status, progress, failures, retry</h2>
        <p>Durable jobs run on the server worker (service-authenticated; the browser never holds the worker secret). Pause, resume, and cancel are tenant-scoped. Resume also retries a failed job.</p>
        <button onClick={load} style={{ padding: 8 }}>Refresh jobs</button>
        <ul>
          {jobs.map((j) => (
            <li key={j.id} style={{ marginTop: 8 }}>
              {j.kind} · {j.status} · {j.committed}/{j.total} · {j.id} {j.error ? `· error: ${j.error}` : ''}
              {me?.authenticated ? (
                <span style={{ marginLeft: 8 }}>
                  <button onClick={() => call(async () => fetch(`/api/jobs/${j.id}/pause`, { method: 'POST' }), 'Pause job')} style={{ marginRight: 4, padding: 4 }}>Pause</button>
                  <button onClick={() => call(async () => fetch(`/api/jobs/${j.id}/resume`, { method: 'POST' }), 'Resume job')} style={{ marginRight: 4, padding: 4 }}>Resume / retry</button>
                  <button onClick={() => call(async () => fetch(`/api/jobs/${j.id}/cancel`, { method: 'POST' }), 'Cancel job')} style={{ padding: 4 }}>Cancel</button>
                </span>
              ) : null}
            </li>
          ))}
          {jobs.length === 0 ? <li>No jobs yet.</li> : null}
        </ul>
        <button onClick={async () => {
          if (!selected) return; setMsg('Export…');
          const r = await fetch(`/api/datasets/${selected}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'jsonl' }) });
          const j = await r.json().catch(() => ({})); setMsg(`Export: ${r.status} ${JSON.stringify(j.manifest ?? j).slice(0, 800)}`);
          if (j.content) { setExportText(j.content); const blob = new Blob([j.content], { type: 'application/x-ndjson' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${selected}.jsonl`; a.click(); }
        }} style={{ padding: 8 }}>Export JSONL + download file (gated)</button>
      </section>

      {me?.authenticated ? (
        <section style={{ border: '1px solid #334155', padding: 20, borderRadius: 12, marginTop: 20 }}>
          <h2>5. Targeted repair (DB mode)</h2>
          <p>Creating a case never changes data. Approving applies the repaired row in a transaction and records the case id in the record — provenance is not changed by repair.</p>
          <input value={repairRecordId} onChange={(e) => setRepairRecordId(e.target.value)} placeholder="record id" style={{ padding: 8, marginRight: 8, width: '40%' }} />
          <input value={repairIssue} onChange={(e) => setRepairIssue(e.target.value)} placeholder="issue description" style={{ padding: 8, marginRight: 8, width: '40%' }} />
          <textarea value={repairData} onChange={(e) => setRepairData(e.target.value)} placeholder='{"field": "fixed value"} (optional, repaired row JSON)' rows={3} style={{ width: '100%', padding: 8, marginTop: 8 }} />
          <button onClick={() => selected && call(async () => fetch(`/api/datasets/${selected}/repair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId: repairRecordId, issue: repairIssue, repairedData: repairData ? JSON.parse(repairData) : undefined }) }), 'Create repair case')} style={{ padding: 8, marginTop: 8 }}>Create repair case</button>
          <ul>
            {repairs.map((c) => (
              <li key={c.id} style={{ marginTop: 8 }}>
                {c.status} · {c.issue} · record {c.recordId}
                {c.status === 'open' ? (
                  <span style={{ marginLeft: 8 }}>
                    <button onClick={() => call(async () => fetch(`/api/datasets/${selected}/repair/${c.id}/approve`, { method: 'POST' }), 'Approve repair')} style={{ marginRight: 4, padding: 4 }}>Approve</button>
                    <button onClick={() => call(async () => fetch(`/api/datasets/${selected}/repair/${c.id}/reject`, { method: 'POST' }), 'Reject repair')} style={{ padding: 4 }}>Reject</button>
                  </span>
                ) : null}
              </li>
            ))}
            {repairs.length === 0 ? <li>No repair cases for this dataset.</li> : null}
          </ul>
        </section>
      ) : null}

      <section style={{ border: '1px solid #334155', padding: 20, borderRadius: 12, marginTop: 20 }}>
        <h2>Model split — read before you send private data</h2>
        <ul>
          <li><b>muse-spark-1.3-contributor</b> — public/demo only. Meta may use it for training. $0.10 / $0.002 cached / $0.20 per million tokens.</li>
          <li><b>muse-spark-1.3</b> — private only. Not used for training. $1.25 / $0.15 cached / $4.25 per million tokens.</li>
          <li><b>muse-image-1.0</b> — $0.01/image, on demand. <b>sam-3.1</b> — segmentation, on demand. <b>muse-voice-transcribe-1.0</b> — $0.18/hour. <b>Multimodal ingestion is NOT operational yet</b> — no verified endpoint functions exist, and the /api/multimodal endpoint returns 503 rather than a simulated result.</li>
          <li><b>No Wonder by default</b> — $4/$20 would burn the $150 grant.</li>
        </ul>
        <p>Full split, EULA, and documentation are in the repo docs. Never paste an API key into this UI — keys are server-side only.</p>
        <p><a href="/api/health" style={{ color: '#7dd3fc' }}>Health (real store counts)</a> · <a href="/api/models" style={{ color: '#7dd3fc' }}>Models</a> · <a href="/api/jobs" style={{ color: '#7dd3fc' }}>Jobs</a></p>
      </section>
    </main>
  );
}
