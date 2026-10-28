// Structured, redacted operator logging + job-health predicates.
// No log line may contain a secret, a token, a password, an API key,
// or a full record body. Values for sensitive keys are replaced,
// and long string values are truncated.

const SENSITIVE_KEYS = ['authorization', 'token', 'secret', 'password', 'api_key', 'apikey', 'cookie', 'session'];

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) return '[REDACTED]';
  if (typeof value === 'string' && value.length > 200) return value.slice(0, 200) + '…[truncated]';
  return value;
}

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = redactValue(k, v);
  return out;
}

export function logEvent(event: string, fields: Record<string, unknown> = {}): string {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...redactFields(fields) });
  console.log(line);
  return line;
}

/** A RUNNING job whose lease has expired is stalled and reclaimable. */
export function isJobStalled(job: { status: string; leaseExpiresAt: Date | string | null }, now = new Date()): boolean {
  if (job.status !== 'RUNNING' || !job.leaseExpiresAt) return false;
  return new Date(job.leaseExpiresAt).getTime() < now.getTime();
}

/** Operator job-health summary: no record data, no secrets. */
export function jobHealthSummary(job: { id: string; status: string; committed: number; total: number; attempts: number; leaseExpiresAt: Date | string | null; error: string | null }, now = new Date()): Record<string, unknown> {
  return {
    jobId: job.id,
    status: job.status,
    committed: job.committed,
    total: job.total,
    attempts: job.attempts,
    stalled: isJobStalled(job, now),
    error: job.error ? 'PRESENT' : null,
  };
}
