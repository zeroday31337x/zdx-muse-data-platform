// Meta-backed augment helpers (Option A). Pure functions only: no Prisma,
// no fetch, no secrets — unit-testable without a database or a Meta key.
//
// Design contract (see the milestone plan, WP2):
// - The Meta path is a DISTINCT generator from the template path. Its
//   response label is 'meta', never 'template-demo', and a Meta failure
//   fails the job — it never silently substitutes template rows.
// - Generated rows are validated structurally (Zod) BEFORE persistence.
//   Any invalid row, or a row count other than the requested count,
//   fails the whole job and persists nothing.
// - ID-like fields are rewritten deterministically (SYN- prefix), the
//   same way the template path does, so generated rows can never
//   collide with authentic record keys.
import { z } from 'zod';

/** Generator label for Meta-backed augment rows. Distinct from 'template-demo'. */
export const META_AUGMENT_GENERATOR = 'meta';

/** Explicit per-job bound: the professional per-job budget cap is
 * undefined (BLOCKED input), so the record-count bound is load-bearing
 * and lives in code, not in tier config. */
export const META_AUGMENT_MAX_RECORDS = 100;

/** Maximum completion tokens for one Meta augment call. This is what
 * makes the call's maximum cost finite for spend reservation. */
export const META_AUGMENT_MAX_OUTPUT_TOKENS = 4096;

/** Reject a Meta augment count outside the per-job bound. */
export function assertMetaAugmentCount(count: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'INVALID_REQUEST' };
  if (count > META_AUGMENT_MAX_RECORDS) return { ok: false, error: 'META_AUGMENT_COUNT_EXCEEDS_PER_JOB_BOUND' };
  return { ok: true };
}

/** Build the generation prompt from authentic examples. The model is
 * instructed to return ONLY a JSON array of exactly `count` objects
 * with the same fields, new plausible values, and no explanation. */
export function buildAugmentPrompt(examples: Record<string, unknown>[], count: number): string {
  const fields: string[] = [];
  for (const ex of examples) {
    for (const k of Object.keys(ex)) if (!fields.includes(k)) fields.push(k);
  }
  const shown = examples.slice(0, 5);
  return [
    `Generate exactly ${count} new synthetic data records as a JSON array.`,
    `Each record must have exactly these fields: ${fields.join(', ') || '(no fields observed)'}.`,
    'Rules: values must be JSON scalars (string, number, boolean, or null) — no nested objects or arrays. ' +
      'Values must be new and plausible for the field, not copies of the examples. ' +
      'Do not include real personal data. Do not explain anything.',
    'Example records (for shape only, do not copy their values):',
    JSON.stringify(shown),
    'Return ONLY the JSON array, with no surrounding text or code fences.',
  ].join('\n');
}

/** A generated row must be a non-empty flat object of JSON scalars. */
const generatedRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const generatedRowsSchema = z.array(generatedRowSchema);

/** Extract a JSON array from model content (tolerating code fences)
 * and validate every row. Returns the rows only when the array parses,
 * every row is valid, and the count is exactly `expectedCount`. */
export function parseGeneratedRows(
  content: string | null,
  expectedCount: number,
): { ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string } {
  if (!content) return { ok: false, error: 'META_AUGMENT_EMPTY_RESPONSE' };
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1].trim();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'META_AUGMENT_INVALID_OUTPUT' };
  }
  const parsed = generatedRowsSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'META_AUGMENT_INVALID_OUTPUT' };
  const rows = parsed.data as Record<string, unknown>[];
  if (rows.some((r) => Object.keys(r).length === 0)) return { ok: false, error: 'META_AUGMENT_INVALID_OUTPUT' };
  if (rows.length !== expectedCount) return { ok: false, error: 'META_AUGMENT_COUNT_MISMATCH' };
  return { ok: true, rows };
}

/** Rewrite the first ID-like field of a generated row to a synthetic
 * identifier, mirroring the template path. Rows without an ID-like
 * field are returned unchanged. */
export function rewriteGeneratedRowIds(row: Record<string, unknown>, index: number): Record<string, unknown> {
  const out = { ...row };
  for (const f of ['order_id', 'id', 'record_id']) {
    if (out[f] !== undefined && out[f] !== null) {
      out[f] = `SYN-${String(out[f])}-${index}`;
      break;
    }
  }
  return out;
}
