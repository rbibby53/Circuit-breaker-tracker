export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-cbt-csrf': '1' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T = { ok: true }>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T = { ok: true }>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T = { ok: true }>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T = { ok: true }>(url: string) => request<T>('DELETE', url),
};

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong.';
