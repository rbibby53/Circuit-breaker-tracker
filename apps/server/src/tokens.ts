import { createHash, randomBytes } from 'node:crypto';

/** A random URL-safe token and the hash we store for it. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const daysFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();
export const hoursFromNow = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();
export const isExpired = (iso: string): boolean => Date.parse(iso) <= Date.now();
