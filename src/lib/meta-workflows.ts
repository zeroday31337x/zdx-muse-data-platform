// Meta-powered workflows: schema inference, semantic evaluation, repair.
// All three follow the same honesty rule:
// - If MODEL_API_KEY is set, call Muse (Standard for private, Contributor
//   only for public/demo) via callMetaChat, with spending checks in the
//   caller, and validate the structured output with Zod.
// - If not set, return a deterministic result and label it as such.
//   Deterministic results are never presented as Meta results.
// - Model output is untrusted data, never executed, never used to change
//   quotas, authorizations, or composition accounting.
import { z } from 'zod';
import { callMetaChat, modelForDataClass, metaConfigured } from './meta';
import { withMetaRetry } from './meta-budget';

export type FieldProposal = { name: string; type: string; required: boolean; description: string };

const fieldSchema = z.object({ name: z.string(), type: z.string(), required: z.boolean().default(false), description: z.string().default('') });
const schemaOutSchema = z.object({ fields: z.array(fieldSchema) });

export function deterministicSchema(records: Record<string, unknown>[]): FieldProposal[] {
  const fields = new Map<string, { type: string; missing: number; total: number }>();
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      const f = fields.get(k) ?? { type: typeof v, missing: 0, total: 0 };
      f.total++;
      if (v === null || v === undefined || v === '') f.missing++;
      fields.set(k, f);
    }
  }
  return [...fields.entries()].map(([name, f]) => ({
    name, type: f.type, required: f.missing === 0, description: `Observed in ${f.total} records, ${f.missing} missing.`,
  }));
}

export async function inferSchema(records: Record<string, unknown>[], dataClass: string): Promise<{ source: 'meta' | 'deterministic'; model: string | null; fields: FieldProposal[]; note: string }> {
  const deterministic = deterministicSchema(records);
  if (!metaConfigured()) {
    return { source: 'deterministic', model: null, fields: deterministic, note: 'Meta not configured: schema is deterministic field observation, not Meta inference.' };
  }
  const model = modelForDataClass(dataClass);
  const sample = JSON.stringify(records.slice(0, 5)).slice(0, 4000);
  const result = await withMetaRetry(() => callMetaChat({ model, dataClass, messages: [{ role: 'user', content: `Infer a JSON schema for these records. Return ONLY JSON: {"fields":[{"name":string,"type":string,"required":boolean,"description":string}]}. Sample: ${sample}` }] }), { sleepMs: () => 0 });
  if (!result.ok || !result.content) {
    return { source: 'deterministic', model, fields: deterministic, note: `Meta call failed (${result.error}); falling back to deterministic schema, not a Meta result.` };
  }
  try {
    const jsonText = result.content.slice(result.content.indexOf('{'), result.content.lastIndexOf('}') + 1);
    const parsed = schemaOutSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) return { source: 'deterministic', model, fields: deterministic, note: 'Meta output failed schema validation; deterministic schema used instead.' };
    return { source: 'meta', model, fields: parsed.data.fields, note: 'Schema inferred by Meta Muse, subject to human review before use.' };
  } catch {
    return { source: 'deterministic', model, fields: deterministic, note: 'Meta output was not parseable JSON; deterministic schema used instead.' };
  }
}

/** Semantic evaluation: deterministic checks + optional Meta judge, labelled. */
export async function evaluateRecords(records: Record<string, unknown>[], dataClass: string): Promise<{ source: 'meta' | 'deterministic'; model: string | null; issues: string[]; note: string }> {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const k = JSON.stringify(r);
    if (seen.has(k)) issues.push('Duplicate record');
    seen.add(k);
    for (const [field, v] of Object.entries(r)) {
      if (v === null || v === undefined || v === '') issues.push(`Missing value in field ${field}`);
    }
  }
  if (!metaConfigured()) {
    return { source: 'deterministic', model: null, issues: [...new Set(issues)], note: 'Deterministic evaluation only. A Meta judge score is not claimed.' };
  }
  const model = modelForDataClass(dataClass);
  const result = await withMetaRetry(() => callMetaChat({ model, dataClass, messages: [{ role: 'user', content: `Review these records for plausibility and consistency issues. Return a short bullet list, no scores, no invented counts. Sample: ${JSON.stringify(records.slice(0, 5)).slice(0, 3000)}` }] }), { sleepMs: () => 0 });
  if (!result.ok || !result.content) {
    return { source: 'deterministic', model, issues: [...new Set(issues)], note: `Meta judge failed (${result.error}); deterministic issues only.` };
  }
  return { source: 'meta', model, issues: [...new Set(issues), `Meta judge: ${result.content.slice(0, 1000)}`], note: 'Meta judge output is an estimate, not objective proof. Deterministic issues are listed first.' };
}
