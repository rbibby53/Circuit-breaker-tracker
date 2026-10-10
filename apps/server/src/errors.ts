import type { ZodType, ZodTypeDef } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: string = 'error',
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');
export const unauthorized = (msg = 'Please sign in.') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have access to that.') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found.') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict');
export const gone = (msg: string) => new HttpError(410, msg, 'gone');

/** Validate a request body or query with a zod schema, throwing a 400 on failure. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    throw badRequest(`${where}${first?.message ?? 'Invalid input.'}`);
  }
  return r.data;
}

export function idParam(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid id.');
  return n;
}

export function assertCheck(check: { ok: true } | { ok: false; reason: string }): void {
  if (!check.ok) throw forbidden(check.reason);
}
