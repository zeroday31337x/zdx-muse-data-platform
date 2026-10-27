/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { callMetaChat, modelForDataClass, metaConfigured } from '@/lib/meta';
import { qualityReport } from '@/lib/quality';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant, compositionDb } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    const recs = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const dataRows = recs.map((r: any) => r.data as Record<string, unknown>);
    const comp = await compositionDb(id);
    const q = qualityReport(dataRows);
    const fields = new Set<string>(); dataRows.forEach((r: Record<string, unknown>) => Object.keys(r).forEach((k: string) => fields.add(k)));
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
    const sample = JSON.stringify(dataRows.slice(0, 3)).slice(0, 4000);
    const result = await callMetaChat({ model, dataClass, messages: [{ role: 'user', content: `Analyse this dataset sample for schema, field types, and risks. Return concise JSON-like text, no invented counts beyond the sample. Sample: ${sample}` }] });
    if (!result.ok) return NextResponse.json({ ...deterministic, meta: { error: result.error, model }, note: 'Meta call failed; deterministic analysis only.' });
    // UsageLedger: metadata only (model, tokens, cost, tenant) — never data.
    await db.usageLedger.create({ data: { tenantId: s.user.tenantId, model, purpose: 'analyze', promptTokens: result.usage.prompt_tokens, completionTokens: result.usage.completion_tokens, costUsd: result.estimatedCostUsd } });
    return NextResponse.json({ ...deterministic, meta: { model, content: result.content, usage: result.usage, estimatedCostUsd: result.estimatedCostUsd } });
  }
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  const comp = compositionOf(s, id);
  const q = qualityReport(recs.map((r: any) => r.data));
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
  const u = s.usage.find((x) => x.model === model);
  if (u) { u.promptTokens += result.usage.prompt_tokens; u.completionTokens += result.usage.completion_tokens; u.costUsd += result.estimatedCostUsd; u.calls += 1; }
  else s.usage.push({ model, promptTokens: result.usage.prompt_tokens, completionTokens: result.usage.completion_tokens, costUsd: result.estimatedCostUsd, calls: 1 });
  const { saveStore } = await import('@/lib/store'); saveStore(s);
  return NextResponse.json({ ...deterministic, meta: { model, content: result.content, usage: result.usage, estimatedCostUsd: result.estimatedCostUsd } });
}
