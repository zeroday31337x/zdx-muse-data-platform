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

/** Prompt builders shared by the workflow functions AND by DB routes
 * computing reservation max-cost estimates, so the estimate always
 * matches the prompt actually sent. */
export function schemaPromptFor(records: Record<string, unknown>[]): string {
  const sample = JSON.stringify(records.slice(0, 5)).slice(0, 4000);
  return `Infer a JSON schema for these records. Return ONLY JSON: {"fields":[{"name":string,"type":string,"required":boolean,"description":string}]}. Sample: ${sample}`;
}

export function evaluatePromptFor(records: Record<string, unknown>[]): string {
  return `Review these records for plausibility and consistency issues. Return a short bullet list, no scores, no invented counts. Sample: ${JSON.stringify(records.slice(0, 5)).slice(0, 3000)}`;
}

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

// Workflow results now also surface usage + cost + the Meta error kind
// (additive fields) so DB routes can settle spend reservations:
// - source 'meta' + usage/cost: confirm the reservation at actual cost
//   and write the UsageLedger row.
// - metaError TIMEOUT / NETWORK_ERROR / PROVIDER_5XX: outcome
//   uncertain → mark the reservation PENDING_RECONCILIATION (never $0).
// - any other metaError (4xx, validation): provider refused before
//   processing → the reservation may be released.
// - no metaError and source 'deterministic': no Meta call ran (gated
//   or unconfigured) — no reservation should exist.
export type WorkflowMetaInfo = {
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  estimatedCostUsd: number | null;
  metaError: string | null;
};

export async function inferSchema(records: Record<string, unknown>[], dataClass: string, opts: { metaAllowed?: boolean; modelOverride?: string; maxOutputTokens?: number } = {}): Promise<{ source: 'meta' | 'deterministic'; model: string | null; fields: FieldProposal[]; note: string } & WorkflowMetaInfo> {
  const deterministic = deterministicSchema(records);
  const noMeta = (note: string, model: string | null, metaError: string | null = null): { source: 'deterministic'; model: string | null; fields: FieldProposal[]; note: string } & WorkflowMetaInfo =>
    ({ source: 'deterministic', model, fields: deterministic, note, usage: null, estimatedCostUsd: null, metaError });
  if (opts.metaAllowed === false) {
    return noMeta('Meta call gated by entitlement (ENTITLEMENT_REQUIRED); deterministic schema only, not a Meta result.', null);
  }
  if (!metaConfigured()) {
    return noMeta('Meta not configured: schema is deterministic field observation, not Meta inference.', null);
  }
  const model = opts.modelOverride ?? modelForDataClass(dataClass);
  const prompt = schemaPromptFor(records);
  const result = await withMetaRetry(() => callMetaChat({ model, dataClass, messages: [{ role: 'user', content: prompt }], maxOutputTokens: opts.maxOutputTokens }), { sleepMs: () => 0 });
  if (!result.ok || !result.content) {
    return noMeta(`Meta call failed (${result.error}); falling back to deterministic schema, not a Meta result.`, model, result.error ?? 'UNKNOWN');
  }
  try {
    const jsonText = result.content.slice(result.content.indexOf('{'), result.content.lastIndexOf('}') + 1);
    const parsed = schemaOutSchema.safeParse(JSON.parse(jsonText));
    // The call RAN (tokens consumed) even though its output failed
    // validation: surface usage/cost so the route confirms the
    // reservation at actual cost instead of releasing it as $0.
    if (!parsed.success) return { source: 'deterministic', model, fields: deterministic, note: 'Meta output failed schema validation; deterministic schema used instead.', usage: result.usage, estimatedCostUsd: result.estimatedCostUsd, metaError: 'INVALID_PROVIDER_RESPONSE' };
    return { source: 'meta', model, fields: parsed.data.fields, note: 'Schema inferred by Meta Muse, subject to human review before use.', usage: result.usage, estimatedCostUsd: result.estimatedCostUsd, metaError: null };
  } catch {
    return { source: 'deterministic', model, fields: deterministic, note: 'Meta output was not parseable JSON; deterministic schema used instead.', usage: result.usage, estimatedCostUsd: result.estimatedCostUsd, metaError: 'INVALID_PROVIDER_RESPONSE' };
  }
}

/** Semantic evaluation: deterministic checks + optional Meta judge, labelled. */
export async function evaluateRecords(records: Record<string, unknown>[], dataClass: string, opts: { metaAllowed?: boolean; modelOverride?: string; maxOutputTokens?: number } = {}): Promise<{ source: 'meta' | 'deterministic'; model: string | null; issues: string[]; note: string } & WorkflowMetaInfo> {
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
  const noMeta = (note: string, model: string | null, metaError: string | null = null): { source: 'deterministic'; model: string | null; issues: string[]; note: string } & WorkflowMetaInfo =>
    ({ source: 'deterministic', model, issues: [...new Set(issues)], note, usage: null, estimatedCostUsd: null, metaError });
  if (opts.metaAllowed === false) {
    return noMeta('Meta judge gated by entitlement (ENTITLEMENT_REQUIRED); deterministic issues only, not a Meta result.', null);
  }
  if (!metaConfigured()) {
    return noMeta('Deterministic evaluation only. A Meta judge score is not claimed.', null);
  }
  const model = opts.modelOverride ?? modelForDataClass(dataClass);
  const prompt = evaluatePromptFor(records);
  const result = await withMetaRetry(() => callMetaChat({ model, dataClass, messages: [{ role: 'user', content: prompt }], maxOutputTokens: opts.maxOutputTokens }), { sleepMs: () => 0 });
  if (!result.ok || !result.content) {
    return noMeta(`Meta judge failed (${result.error}); deterministic issues only.`, model, result.error ?? 'UNKNOWN');
  }
  return { source: 'meta', model, issues: [...new Set(issues), `Meta judge: ${result.content.slice(0, 1000)}`], note: 'Meta judge output is an estimate, not objective proof. Deterministic issues are listed first.', usage: result.usage, estimatedCostUsd: result.estimatedCostUsd, metaError: null };
}

/** Error kinds whose outcome is uncertain: reservation must go PENDING, never released as $0. */
export function isUncertainMetaError(metaError: string | null): boolean {
  if (!metaError) return false;
  return metaError === 'TIMEOUT' || metaError === 'NETWORK_ERROR' || metaError.startsWith('PROVIDER_5XX');
}
