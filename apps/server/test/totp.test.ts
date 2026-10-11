import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  newRecoveryCodes,
  normalizeRecoveryCode,
  stepAt,
  verifyTotp,
} from '../src/totp';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('round-trips base32', () => {
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(SECRET).toString()).toBe('12345678901234567890');
  });

  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    expect(hotp(SECRET, stepAt(59_000))).toBe('287082');
    expect(hotp(SECRET, stepAt(1_111_111_109_000))).toBe('081804');
    expect(hotp(SECRET, stepAt(1_234_567_890_000))).toBe('005924');
    expect(hotp(SECRET, stepAt(20_000_000_000_000))).toBe('353130');
  });

  it('accepts one step of clock drift and never the same step twice', () => {
    const now = 1_234_567_890_000;
    const step = stepAt(now);
    expect(verifyTotp(SECRET, hotp(SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(SECRET, hotp(SECRET, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(SECRET, hotp(SECRET, step - 2), null, now)).toBeNull();
    expect(verifyTotp(SECRET, hotp(SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(SECRET, 'abcdef', null, now)).toBeNull();
  });

  it('makes recovery codes that survive sloppy typing', () => {
    const { codes, hashes } = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(hashes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{2}$/);
    expect(normalizeRecoveryCode(` ${codes[0]!.toUpperCase().replace(/-/g, ' ')} `)).toBe(
      normalizeRecoveryCode(codes[0]!),
    );
  });
});
