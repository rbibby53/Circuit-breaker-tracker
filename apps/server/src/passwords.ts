import { hash, verify } from '@node-rs/argon2';

// argon2id with the library defaults (OWASP-recommended memory and time cost).
export const hashPassword = (password: string): Promise<string> => hash(password);

let dummy: Promise<string> | null = null;

/**
 * Verify a password. When there is no stored hash (unknown user, or SSO-only account) we
 * still run a verification against a throwaway hash so timing does not reveal which.
 */
export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  if (!stored) {
    dummy ??= hash('timing-equaliser-not-a-real-password');
    await verify(await dummy, password).catch(() => false);
    return false;
  }
  return verify(stored, password).catch(() => false);
}
