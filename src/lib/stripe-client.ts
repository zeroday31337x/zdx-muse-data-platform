// Minimal Stripe REST client (no SDK dependency). All calls are
// server-side only, TEST MODE ONLY in this branch (see billing.ts).
// The fetch implementation is injectable so tests never touch the
// network and no live billing is ever exercised by a test.
// Secrets come from server env only and are never logged or returned.
import crypto from 'node:crypto';

export type StripeFetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const defaultFetch: StripeFetch = async (url: string, init: RequestInit) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, text: () => res.text() };
};

export function stripeSecret(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

async function stripeCall(
  path: string,
  params: Record<string, string>,
  opts: { fetchFn?: StripeFetch; idempotencyKey?: string },
): Promise<Record<string, unknown>> {
  const secret = stripeSecret();
  if (!secret) throw new Error('STRIPE_NOT_CONFIGURED');
  const fn = opts.fetchFn ?? defaultFetch;
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Bearer ${secret}`,
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const body = new URLSearchParams(params).toString();
  const res = await fn(`https://api.stripe.com/v1${path}`, { method: 'POST', headers, body });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* leave empty on non-JSON */ }
  if (!res.ok) {
    const err = (data.error as Record<string, unknown> | undefined)?.message;
    throw new Error(`STRIPE_API_ERROR:${res.status}:${typeof err === 'string' ? err : 'request failed'}`);
  }
  return data;
}

async function stripeGet(
  path: string,
  opts: { fetchFn?: StripeFetch },
): Promise<Record<string, unknown>> {
  const secret = stripeSecret();
  if (!secret) throw new Error('STRIPE_NOT_CONFIGURED');
  const fn = opts.fetchFn ?? defaultFetch;
  const res = await fn(`https://api.stripe.com/v1${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* leave empty */ }
  if (!res.ok) throw new Error(`STRIPE_API_ERROR:${res.status}`);
  return data;
}

export async function createStripeCustomer(
  email: string,
  tenantId: string,
  opts: { fetchFn?: StripeFetch } = {},
): Promise<{ id: string }> {
  const data = await stripeCall('/customers', { email, 'metadata[tenantId]': tenantId }, opts);
  if (typeof data.id !== 'string') throw new Error('STRIPE_API_ERROR:missing customer id');
  return { id: data.id };
}

export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
  opts: { fetchFn?: StripeFetch; idempotencyKey?: string } = {},
): Promise<{ url: string; id: string }> {
  const data = await stripeCall('/checkout/sessions', {
    customer: customerId,
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, opts);
  if (typeof data.url !== 'string' || typeof data.id !== 'string') throw new Error('STRIPE_API_ERROR:missing checkout session');
  return { url: data.url, id: data.id };
}

export async function createPortalSession(
  customerId: string,
  returnUrl: string,
  opts: { fetchFn?: StripeFetch } = {},
): Promise<{ url: string }> {
  const data = await stripeCall('/billing_portal/sessions', { customer: customerId, return_url: returnUrl }, opts);
  if (typeof data.url !== 'string') throw new Error('STRIPE_API_ERROR:missing portal session');
  return { url: data.url };
}

export async function retrieveSubscription(
  subscriptionId: string,
  opts: { fetchFn?: StripeFetch } = {},
): Promise<{ id: string; status: string; priceId: string | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; customer: string | null }> {
  const data = await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`, opts);
  const items = (data.items as { data?: Array<{ price?: { id?: unknown } }> } | undefined)?.data ?? [];
  const priceId = typeof items[0]?.price?.id === 'string' ? (items[0].price.id as string) : null;
  const cpe = typeof data.current_period_end === 'number' ? new Date(data.current_period_end * 1000) : null;
  return {
    id: typeof data.id === 'string' ? data.id : subscriptionId,
    status: typeof data.status === 'string' ? data.status : '',
    priceId,
    currentPeriodEnd: cpe,
    cancelAtPeriodEnd: data.cancel_at_period_end === true,
    customer: typeof data.customer === 'string' ? data.customer : null,
  };
}

/**
 * Verify a Stripe webhook signature (v1 scheme, HMAC-SHA256).
 * Returns true only on an exact match within the tolerance window.
 * Never throws provider internals to the caller; returns false.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string, toleranceSeconds = 300, nowSeconds?: number): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(',').map((p) => p.trim());
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    if (part.startsWith('v1=')) signatures.push(part.slice(3));
  }
  if (!timestamp || signatures.length === 0) return false;
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return signatures.some((sig) => {
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}
