import { NextResponse } from 'next/server';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { callMetaChat, modelForDataClass, metaConfigured } from '@/lib/meta';
import { qualityReport } from '@/lib/quality';
export const dynamic = 'force-dynamic';
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  const comp = compositionOf(s, id);
  const q = qualityReport(recs.map((r) => r.data));
  const fields = new Set<string>(); recs.forEach((r) => Object.keys(r.data).forEach((k) => fields.add(k)));
  const deterministic = {
    source: 'deterministic',
    recordCount: recs.length,
    fields: [...fields],
    composition: comp,
    quality: q,
    summary: recs.length === 0 ? 'No records yet.' : `Dataset has ${recs.length} records across ${fields.size} fields. Completeness ${(q.completeness * 100).toFixed(1)}%, uniqueness ${(q.uniqueness * 100).toFixed(1)}%.`,
  };
  if (!metaConfigured()) {
    return NextResponse.json({ ...deterministic, meta: null, note: 'Meta not configured: analysis is deterministic only, not a Meta model result.' });
  }
  const dataClass = comp.unknown > 0 || comp.synthetic > 0 ? 'private' : 'public';
  const model = modelForDataClass(dataClass);
  const sample = JSON.stringify(recs.slice(0, 3).map((r) => r.data)).slice(0, 4000);
  const result = await callMetaChat({ model, dataClass, messages: [{ role: 'user', content: `Analyse this dataset sample for schema, field types, and risks. Return concise JSON-like text, no invented counts beyond the sample. Sample: ${sample}` }] });
  if (!result.ok) return NextResponse.json({ ...deterministic, meta: { error: result.error, model }, note: 'Meta call failed; deterministic analysis only.' });
  // Record usage (metadata only)
  const u = s.usage.find((x) => x.model === model);
  if (u) { u.promptTokens += result.usage.prompt_tokens; u.completionTokens += result.usage.completion_tokens; u.costUsd += result.estimatedCostUsd; u.calls += 1; }
  else s.usage.push({ model, promptTokens: result.usage.prompt_tokens, completionTokens: result.usage.completion_tokens, costUsd: result.estimatedCostUsd, calls: 1 });
  const { saveStore } = await import('@/lib/store'); saveStore(s);
  return NextResponse.json({ ...deterministic, meta: { model, content: result.content, usage: result.usage, estimatedCostUsd: result.estimatedCostUsd } });
}
