// Time-based one-time passwords (RFC 6238): the 6-digit codes from authenticator apps.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashToken } from './tokens';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, as base32 for authenticator apps. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Check a code against the current step and one either side (clock drift). Returns the step it
 * matched, or null. Steps at or before `lastStep` are refused so a code cannot be used twice.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: '30' });
  return `otpauth://totp/${label}?${q}`;
}

/** Recovery codes look like "k3f9-2mqx-7d"; spaces, dashes and case do not matter when typed. */
export const normalizeRecoveryCode = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, '');

export function newRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`;
  });
  return { codes, hashes: codes.map((c) => hashToken(normalizeRecoveryCode(c))) };
}
