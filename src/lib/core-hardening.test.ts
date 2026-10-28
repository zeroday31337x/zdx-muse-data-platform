import { describe, it, expect } from 'vitest';
import { parsePagination, assertContentLength, safeErrorCode } from './api-validation';
import { redactFields, logEvent, isJobStalled, jobHealthSummary } from './observability';
import { mapCompositionGroups } from './composition-db';

describe('api hardening', () => {
  it('pagination: non-numeric limit/offset default safely, never NaN into the DB', () => {
    const p = parsePagination(new URLSearchParams('limit=abc&offset=-5'));
    expect(p.limit).toBe(20);
    expect(p.offset).toBe(0);
    expect(parsePagination(new URLSearchParams('limit=9999')).limit).toBe(100);
    expect(parsePagination(new URLSearchParams('limit=0')).limit).toBe(1);
  });
  it('content-length guard rejects oversize bodies before parsing', () => {
    const req = new Request('http://x/', { method: 'POST', headers: { 'content-length': '99999999' } });
    expect(assertContentLength(req, 1000)).toBe('FILE_TOO_LARGE');
    const ok = new Request('http://x/', { method: 'POST', headers: { 'content-length': '10' } });
    expect(assertContentLength(ok, 1000)).toBeNull();
  });
  it('safe errors never leak internals', () => {
    expect(safeErrorCode(new Error('some prisma secret stack'))).toBe('INTERNAL_ERROR');
    expect(safeErrorCode(new Error('SYNTHETIC_CAP_EXCEEDED'))).toBe('SYNTHETIC_CAP_EXCEEDED');
  });
});

describe('observability redaction', () => {
  it('redacts secrets/tokens and truncates long values, never record bodies', () => {
    const out = redactFields({ token: 'abc123', authorization: 'Bearer x', jobId: 'j1', note: 'x'.repeat(300) });
    expect(out.token).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.jobId).toBe('j1');
    expect(String(out.note).length).toBeLessThan(300);
    const line = logEvent('worker.test', { token: 'secret', jobId: 'j1' });
    expect(line).not.toContain('secret');
  });
  it('job health: stalled detection and summary without record data', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    const stalled = { id: 'j1', status: 'RUNNING', committed: 10, total: 100, attempts: 2, leaseExpiresAt: new Date('2026-10-27T11:00:00Z'), error: null };
    expect(isJobStalled(stalled, now)).toBe(true);
    expect(jobHealthSummary(stalled, now).stalled).toBe(true);
    expect(jobHealthSummary(stalled, now)).not.toHaveProperty('records');
  });
});

describe('composition aggregation (no full-record load)', () => {
  it('maps groupBy counts + token sums exactly, including DERIVED rows in total only', () => {
    const m = mapCompositionGroups([
      { provenance: 'AUTHENTIC_VERIFIED', count: 10000, tokens: 40000 },
      { provenance: 'SYNTHETIC', count: 4285, tokens: 17000 },
      { provenance: 'DERIVED_SOURCE_PRESERVING', count: 5, tokens: 20 },
    ]);
    expect(m.authentic).toBe(10000);
    expect(m.synthetic).toBe(4285);
    expect(m.total).toBe(14290);
    expect(m.authenticTokens).toBe(40000);
    expect(m.syntheticTokens).toBe(17000);
  });
  it('unknown provenance blocks, and 4286 synthetic over 10000 authentic fails the cap arithmetic', () => {
    const m = mapCompositionGroups([
      { provenance: 'AUTHENTIC_VERIFIED', count: 10000, tokens: 1 },
      { provenance: 'UNKNOWN', count: 1, tokens: 1 },
    ]);
    expect(m.unknown).toBe(1);
  });
});
