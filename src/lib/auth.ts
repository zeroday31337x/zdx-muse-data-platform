import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from './db';

const scrypt = promisify(crypto.scrypt);

// Passwords are scrypt hashes, never plaintext, never in logs.
// Sessions are random tokens; only their SHA-256 hash is stored.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [, salt, hash] = stored.split(':');
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'));
  } catch { return false; }
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export async function getSessionFromCookie(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)zdx_session=([^;]+)/);
  if (!match) return null;
  const tokenHash = crypto.createHash('sha256').update(decodeURIComponent(match[1])).digest('hex');
  const session = await prisma().session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export function sessionCookie(token: string, maxAgeSeconds = 7 * 24 * 3600): string {
  return `zdx_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `zdx_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export async function audit(tenantId: string, actor: string, action: string, entity: string, details?: Record<string, unknown>) {
  // Audit details must never contain secrets, keys, or full record bodies.
  await prisma().auditLog.create({ data: { tenantId, actor, action, entity, details: details ?? {} } });
}
