// API hardening helpers: pagination, bounded bodies, safe errors.
// Pure functions, unit-tested. They never include stack traces,
// database messages, or record contents in an error response.

export function parsePagination(searchParams: URLSearchParams, opts: { defaultLimit?: number; maxLimit?: number } = {}): { limit: number; offset: number } {
  const maxLimit = opts.maxLimit ?? 100;
  const defaultLimit = opts.defaultLimit ?? 20;
  const rawLimit = Number(searchParams.get('limit') ?? defaultLimit);
  const rawOffset = Number(searchParams.get('offset') ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(maxLimit, Math.max(1, Math.floor(rawLimit))) : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  return { limit, offset };
}

/** Content-Length guard: returns an error code, or null if acceptable.
 * Oversize uses FILE_TOO_LARGE (contract B4/B13, 413) — never
 * REQUEST_TOO_LARGE, which is not a table code. */
export function assertContentLength(req: Request, maxBytes: number): string | null {
  const raw = req.headers.get('content-length');
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'INVALID_CONTENT_LENGTH';
  if (n > maxBytes) return 'FILE_TOO_LARGE';
  return null;
}

/** Map any thrown value to a safe, generic error code. Never leaks internals. */
export function safeErrorCode(e: unknown, fallback = 'INTERNAL_ERROR'): string {
  if (e instanceof Error) {
    const known = ['SYNTHETIC_CAP_EXCEEDED', 'STALE_LEASE', 'INVALID_REQUEST', 'PARSE_ERROR', 'EMPTY_SOURCE', 'TOO_MANY_ROWS', 'NOT_FOUND', 'UNAUTHENTICATED', 'WORKER_UNAUTHORIZED'];
    if (known.includes(e.message)) return e.message;
  }
  return fallback;
}
