// Request-rate and registration-rate enforcement (contract §3e, rows B2/B6).
//
// B2: the RateLimiter helper existed in billing.ts but no route wired it.
// This module is the wiring layer: routes call checkRequestRate after
// session (401) and tenant/resource (404) checks and after the
// entitlement gate (402), so a denial surfaces as 429 RATE_LIMITED in
// the contract order 401 → 404 → 402 → 429/409/413.
//
// VALUES ARE PROPOSED ONLY (contract §3e, §11 — unapproved, NOT policy):
// 120 requests/minute per tenant, 300/minute per IP, 3 new tenant
// registrations per IP per 24 hours. They are VPS safety limits, not
// approved commercial quotas, and must never be presented as decided.
//
// LIMITATIONS, recorded honestly:
// - Counters are in-memory and single-process (same v1 limitation as
//   billing.ts RateLimiter). A restart resets them; a multi-process
//   deployment would need a shared store. Durable per-IP registration
//   counters are a proposed schema addition (see the RegistrationAttempt
//   note below), not something this module invents silently.
// - IP is a rate signal only, never an identity (contract row B2). The
//   client IP is read from x-forwarded-for (first entry) / x-real-ip,
//   which is trustworthy only behind a trusted proxy (the nginx front
//   end in this deployment). Where no trusted proxy exists, the IP key
//   degrades to a best-effort signal; the tenant key still applies on
//   authenticated routes.
import { FREE_TIER_LIMITS_PROPOSED, RateLimiter, globalRateLimiter } from './billing';

/** Client IP for rate-limit keying. 'unknown' when no header is present. */
export function clientIpFromHeaders(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp?.trim()) return realIp.trim();
  return 'unknown';
}

/** Tenant-scoped request rate. Returns true when the request is allowed. */
export function checkTenantRateLimit(
  tenantId: string,
  now = Date.now(),
  limiter: RateLimiter = globalRateLimiter,
): boolean {
  return limiter.hit(`tenant:${tenantId}`, FREE_TIER_LIMITS_PROPOSED.requestsPerMinutePerTenant, now);
}

/** IP-scoped request rate. Returns true when the request is allowed. */
export function checkIpRateLimit(
  ip: string,
  now = Date.now(),
  limiter: RateLimiter = globalRateLimiter,
): boolean {
  return limiter.hit(`ip:${ip}`, FREE_TIER_LIMITS_PROPOSED.requestsPerMinutePerIp, now);
}

/**
 * Combined route-entry check. When tenantId is null (unauthenticated
 * routes such as login), only the IP key applies. Returns null when
 * allowed, otherwise the denial scope for a 429 RATE_LIMITED response.
 * The response body itself must stay generic ({ error: 'RATE_LIMITED' })
 * — never an oracle for which key tripped or whether an email/IP is
 * already registered.
 */
export function checkRequestRate(
  req: Request,
  tenantId: string | null,
  now = Date.now(),
  limiter: RateLimiter = globalRateLimiter,
): { limited: false } | { limited: true; scope: 'tenant' | 'ip' } {
  if (tenantId !== null && !checkTenantRateLimit(tenantId, now, limiter)) {
    return { limited: true, scope: 'tenant' };
  }
  const ip = clientIpFromHeaders(req);
  if (!checkIpRateLimit(ip, now, limiter)) {
    return { limited: true, scope: 'ip' };
  }
  return { limited: false };
}

/**
 * Registration-rate tracker (contract row B6: 3 new tenant registrations
 * per IP per 24 hours, PROPOSED value). Fixed-window per IP over a
 * rolling 24-hour window of attempt timestamps. attempt() both checks
 * and records: a new-registration attempt counts whether or not the
 * subsequent provisioning transaction succeeds, so failed attempts
 * cannot be used to probe the limit or the registry.
 *
 * PROPOSED DURABLE COUNTER (not implemented here — needs its own
 * migration + review package, not a silent schema change):
 *   model RegistrationAttempt {
 *     id String @id @default(cuid())
 *     ipHash String // SHA-256 of the IP, never the raw IP
 *     createdAt DateTime @default(now())
 *     @@index([ipHash, createdAt])
 *   }
 * With that table, attempt() becomes a transactional count-and-insert
 * and the counter survives restarts and spans processes. Until then,
 * this in-memory tracker is the v1 mechanism for the single-process
 * deployment, and its reset-on-restart limitation is recorded in the
 * audit matrix (row B6) rather than hidden.
 */
export class RegistrationAttemptTracker {
  private attempts = new Map<string, number[]>();
  constructor(
    private windowMs = 24 * 60 * 60 * 1000,
    private limit = FREE_TIER_LIMITS_PROPOSED.registrationsPerIpPerDay,
  ) {}
  /** Returns true when this registration attempt is allowed (and records it). */
  attempt(ip: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(ip) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.attempts.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(ip, recent);
    return true;
  }
  /** Count of attempts from this IP inside the window (test/diagnostic aid). */
  count(ip: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    return (this.attempts.get(ip) ?? []).filter((t) => t > cutoff).length;
  }
}

export const globalRegistrationTracker = new RegistrationAttemptTracker();
