// Meta Model API adapter — Muse only, server-side only.
// No non-Meta provider is ever called. If a model is unavailable, the
// feature fails clearly instead of silently falling back.
import { z } from 'zod';

export const META_BASE_URL = process.env.META_API_BASE_URL || 'https://api.meta.ai/v1';

// Allowlist, verified against Meta Model API pricing/docs as of 2026-10-27.
// muse-wonder-1.0 is intentionally NOT in the default allowlist: at
// $4/$20 per million tokens it would burn the $150 grant, and it has no
// Contributor discount. Enable only with MUSE_ALLOW_WONDER=true.
export const MODEL_ALLOWLIST = [
  'muse-spark-1.3',
  'muse-spark-1.3-contributor',
  'muse-image-1.0',
  'muse-voice-transcribe-1.0',
  'sam-3.1',
] as const;
export type ModelId = (typeof MODEL_ALLOWLIST)[number];

export const MODEL_PRICING: Record<string, { input: number; cached: number; output: number; trains: boolean; rpm: number; tpm: number }> = {
  'muse-spark-1.3': { input: 1.25, cached: 0.15, output: 4.25, trains: false, rpm: 3000, tpm: 4000000 },
  'muse-spark-1.3-contributor': { input: 0.10, cached: 0.002, output: 0.20, trains: true, rpm: 100, tpm: 3000000 },
  'muse-image-1.0': { input: 0, cached: 0, output: 0, trains: false, rpm: 0, tpm: 0 },
  'muse-voice-transcribe-1.0': { input: 0, cached: 0, output: 0, trains: false, rpm: 0, tpm: 0 },
  'sam-3.1': { input: 0, cached: 0, output: 0, trains: false, rpm: 0, tpm: 0 },
};

export const IMAGE_PRICE_PER_IMAGE = 0.01;
export const VOICE_PRICE_PER_HOUR = 0.18;
export const WEB_SEARCH_PRICE_PER_1000 = 2.5;

/** Choose model by data class. Missing/unknown class = Standard (fail closed). */
export function modelForDataClass(dataClass: string, purpose: 'public' | 'private' = 'public'): ModelId {
  if (dataClass === 'private' || dataClass === 'secret' || dataClass === 'unknown' || purpose === 'private') {
    return 'muse-spark-1.3';
  }
  return 'muse-spark-1.3-contributor';
}

export function isModelAllowed(model: string): boolean {
  if (MODEL_ALLOWLIST.includes(model as ModelId)) return true;
  if (model === 'muse-wonder-1.0' && process.env.MUSE_ALLOW_WONDER === 'true') return true;
  return false;
}

export function metaConfigured(): boolean {
  return Boolean(process.env.MODEL_API_KEY);
}

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }).passthrough() })).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).passthrough().optional(),
}).passthrough();

export type MetaCallResult = {
  ok: boolean;
  model: string;
  content: string | null;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  estimatedCostUsd: number;
  error?: string;
  status?: number;
};

/** Call Meta chat completions, OpenAI-compatible shape. Returns a classified error, never a fallback. */
export async function callMetaChat(opts: {
  model: string;
  messages: { role: string; content: string }[];
  dataClass: string;
  timeoutMs?: number;
}): Promise<MetaCallResult> {
  const { model, messages, dataClass } = opts;
  if (!isModelAllowed(model)) {
    return { ok: false, model, content: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimatedCostUsd: 0, error: 'MODEL_NOT_ALLOWED' };
  }
  if (dataClass === 'secret') {
    return { ok: false, model, content: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimatedCostUsd: 0, error: 'SECRET_DATA_REFUSED' };
  }
  // Contributor must never receive private data — enforced in code, not just docs.
  if (model.endsWith('-contributor') && (dataClass === 'private' || dataClass === 'unknown')) {
    return { ok: false, model, content: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimatedCostUsd: 0, error: 'PRIVATE_DATA_TO_CONTRIBUTOR_REFUSED' };
  }
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    return { ok: false, model, content: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimatedCostUsd: 0, error: 'MODEL_API_KEY_NOT_CONFIGURED' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
  try {
    const res = await fetch(`${META_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const kind = res.status === 401 || res.status === 403 ? 'AUTH_OR_ENTITLEMENT' : res.status === 402 ? 'BILLING' : res.status === 429 ? 'RATE_LIMIT' : res.status >= 500 ? 'PROVIDER_5XX' : 'INVALID_REQUEST';
      return { ok: false, model, content: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimatedCostUsd: 0, error: `${kind}:${res.status}`, status: res.status };
    }
    const parsed = chatResponseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return { ok: false, model, content: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimatedCostUsd: 0, error: 'INVALID_PROVIDER_RESPONSE' };
    }
    const usage = {
      prompt_tokens: parsed.data.usage?.prompt_tokens ?? 0,
      completion_tokens: parsed.data.usage?.completion_tokens ?? 0,
      total_tokens: parsed.data.usage?.total_tokens ?? 0,
    };
    const price = MODEL_PRICING[model];
    const cost = price ? (usage.prompt_tokens * price.input + usage.completion_tokens * price.output) / 1_000_000 : 0;
    const content = parsed.data.choices?.[0]?.message?.content ?? null;
    return { ok: true, model, content, usage, estimatedCostUsd: cost };
  } catch (e) {
    return { ok: false, model, content: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimatedCostUsd: 0, error: e instanceof Error && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timeout);
  }
}
