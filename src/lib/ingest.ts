import crypto from 'node:crypto';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB demo cap, documented
export const ALLOWED_EXTENSIONS = ['csv', 'json', 'jsonl', 'txt', 'md'];

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** CSV formula injection: neutralise leading = + - @ tab CR in a cell. */
export function safeCell(value: string): string {
  if (/^[=\+\-@\t\r]/.test(value)) return "'" + value;
  return value;
}

export function parseCsv(text: string): Record<string, string>[] {
  // Small, deterministic CSV parser: handles quotes, commas, newlines in quotes.
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cur.push(field); field = ''; }
    else if (ch === '\n') { cur.push(field); field = ''; rows.push(cur); cur = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const headers = nonEmpty[0].map((h) => h.trim() || 'field');
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = safeCell((r[idx] ?? '').trim()); });
    return obj;
  });
}

export function parseJsonl(text: string): Record<string, unknown>[] {
  return text.split('\n').filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l) as Record<string, unknown>; } catch { throw new Error(`Invalid JSON on line ${i + 1}`); }
  });
}

/** SSRF guard: block private/loopback/link-local/reserved hosts and IPs. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (['localhost', 'metadata.google.internal'].includes(h)) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '127.0.0.1' || h === '::1' || h.startsWith('169.254.') || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (/^0\./.test(h)) return true;
  return false;
}

export function validateUrlForImport(raw: string): { ok: boolean; error?: string } {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return { ok: false, error: 'ONLY_HTTPS_ALLOWED' };
    if (isBlockedHost(u.hostname)) return { ok: false, error: 'BLOCKED_HOST_SSRF' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }
}
