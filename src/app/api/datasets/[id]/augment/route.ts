import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadStore, saveStore, newId, estimateTokens, datasetRecords, compositionOf } from '@/lib/store';
import { compositionReport, maxSyntheticForAuthentic } from '@/lib/composition';
export const dynamic = 'force-dynamic';
const schema = z.object({ count: z.number().int().min(1).max(1000) });
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (ds.purpose === 'training') {
    const comp = compositionOf(s, id);
    const allowed = maxSyntheticForAuthentic(comp.authentic);
    if (parsed.data.count > allowed - comp.synthetic) {
      return NextResponse.json({ error: 'SYNTHETIC_CAP_EXCEEDED', authentic: comp.authentic, synthetic: comp.synthetic, allowed, requested: parsed.data.count, remaining: Math.max(0, allowed - comp.synthetic) }, { status: 409 });
    }
  }
  const recs = datasetRecords(s, id).filter((r) => r.provenance === 'AUTHENTIC_VERIFIED');
  if (recs.length === 0) return NextResponse.json({ error: 'NO_AUTHENTIC_RECORDS', message: 'Augmentation requires verified authentic records to stay within the 30% cap.' }, { status: 409 });
  // Template-based synthetic variation for the demo vertical slice.
  // This is NOT claimed as Meta generation. When MODEL_API_KEY is set,
  // a future step should route semantic variation through Meta; the cap
  // and provenance labelling are identical either way.
  const job = { id: newId('job'), datasetId: id, kind: 'augment', status: 'COMPLETED', committed: 0, total: parsed.data.count, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  s.jobs.push(job);
  let committed = 0;
  for (let i = 0; i < parsed.data.count; i++) {
    const base = recs[i % recs.length];
    // Variant metadata lives in meta, NOT in data, so the exported schema
    // stays identical to authentic rows and token accounting is not skewed.
    // Make the synthetic row distinct where an identifier field exists,
    // so it is not just an exact duplicate of its authentic source.
    const data = { ...base.data };
    for (const idField of ['order_id', 'id', 'record_id', 'transaction_id']) {
      if (data[idField] !== undefined && data[idField] !== null) { data[idField] = `SYN-${String(data[idField])}-${i}`; break; }
    }
    const key = `${base.recordKey}-syn${i}`;
    if (s.records.some((r) => r.datasetId === id && r.recordKey === key)) continue;
    s.records.push({ id: newId('rec'), datasetId: id, recordKey: key, data, provenance: 'SYNTHETIC', sourceId: base.sourceId, sourceFamilyId: base.sourceFamilyId, tokens: estimateTokens(data), createdAt: new Date().toISOString(), meta: { syntheticVariantOf: base.id, syntheticIndex: i, generator: 'template-demo' } });
    committed++;
  }
  job.committed = committed; job.updatedAt = new Date().toISOString();
  saveStore(s);
  const comp = compositionOf(s, id);
  return NextResponse.json({ committed, composition: comp, compositionReport: compositionReport(comp), generator: 'template-demo', note: 'Synthetic records are template variations, labelled SYNTHETIC. Meta semantic generation is used only when MODEL_API_KEY is configured and the route is upgraded to call Meta; cap enforcement is the same.' });
}
