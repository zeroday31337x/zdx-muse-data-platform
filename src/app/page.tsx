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

export default function Home() {
  const [datasets, setDatasets] = useState<Ds[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('Ecommerce demo');
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [augmentCount, setAugmentCount] = useState(2);
  const [exportText, setExportText] = useState('');

  const load = async () => {
    const r = await fetch('/api/datasets'); const j = await r.json(); setDatasets(j);
    if (j[0] && !selected) setSelected(j[0].id);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
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
        <h2>Model split — read before you send private data</h2>
        <ul>
          <li><b>muse-spark-1.3-contributor</b> — public/demo only. Meta may use it for training. $0.10 / $0.002 cached / $0.20 per million tokens.</li>
          <li><b>muse-spark-1.3</b> — private only. Not used for training. $1.25 / $0.15 cached / $4.25 per million tokens.</li>
          <li><b>muse-image-1.0</b> — $0.01/image, on demand. <b>sam-3.1</b> — segmentation, on demand. <b>muse-voice-transcribe-1.0</b> — $0.18/hour.</li>
          <li><b>No Wonder by default</b> — $4/$20 would burn the $150 grant.</li>
        </ul>
        <p>Full split, EULA, and documentation are in the repo docs. Never paste an API key into this UI — keys are server-side only.</p>
        <p><a href="/api/health" style={{ color: '#7dd3fc' }}>Health (real store counts)</a> · <a href="/api/models" style={{ color: '#7dd3fc' }}>Models</a> · <a href="/api/jobs" style={{ color: '#7dd3fc' }}>Jobs</a></p>
      </section>
    </main>
  );
}
