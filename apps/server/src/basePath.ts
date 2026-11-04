// Serving the app under a path prefix (BASE_PATH=/breakers) behind a reverse proxy that passes
// the full path through, such as IIS with URL Rewrite and ARR. Every route is registered at the
// root; requests under the prefix have it taken off before routing, so the rest of the server
// never needs to know about it.

/**
 * `/breakers`, `breakers/`, `//breakers//` → `/breakers`; blank or `/` → '' (served at the root).
 * Throws on anything that is not a plain path, which stops startup with a clear message.
 */
export function normaliseBasePath(value: string | undefined): string {
  const t = value?.trim() ?? '';
  const parts = t.split('/').filter(Boolean);
  if (!parts.length) return '';
  for (const p of parts) {
    // Plain characters only, which also keeps it safe to write into the page as it is.
    if (p === '.' || p === '..' || !/^[A-Za-z0-9._~-]+$/.test(p)) {
      throw new Error(`BASE_PATH must be a path such as /breakers (got "${t}").`);
    }
  }
  return `/${parts.join('/')}`;
}

/** The part of a URL before its query string. */
const pathOf = (url: string) => {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
};

/**
 * The URL the routes see: `/breakers/api/x?y` → `/api/x?y`. Anything outside the prefix is left
 * as it is, for `outsideBase` to answer.
 */
export function stripBasePath(base: string, url: string): string {
  if (!base || !url.startsWith(`${base}/`)) return url;
  return url.slice(base.length);
}

/**
 * How to answer a request that is not under the prefix, by its original URL: a redirect to add
 * the trailing slash, a 404, or null to carry on. `/healthz` also answers at the root so the
 * container's health check works whatever the prefix.
 */
export function outsideBase(
  base: string,
  originalUrl: string,
): { redirect: string; permanent: boolean } | 'not_found' | null {
  if (!base) return null;
  const p = pathOf(originalUrl);
  if (p.startsWith(`${base}/`) || p === '/healthz') return null;
  const rest = originalUrl.slice(p.length);
  if (p === base) return { redirect: `${base}/${rest}`, permanent: true };
  // Someone opening the container's port directly. Not permanent: BASE_PATH may change.
  if (p === '/') return { redirect: `${base}/${rest}`, permanent: false };
  return 'not_found';
}

/**
 * The built page with the prefix filled in. The web app is built with relative file names
 * (`./assets/…`), which would break on a deep link such as /breakers/panels/4, so they become
 * absolute here; and the app reads the prefix from the `cbt-base-path` meta tag (no inline script,
 * which the content security policy forbids). With no prefix the result matches a root build.
 */
export function renderIndex(html: string, base: string): string {
  const meta = `<meta name="cbt-base-path" content="${base}" />`;
  const out = html.replace(/(\s(?:src|href)=")\.\//g, `$1${base}/`);
  return /<meta name="cbt-base-path"[^>]*>/.test(out)
    ? out.replace(/<meta name="cbt-base-path"[^>]*>/, meta)
    : out.replace(/<head>/, `<head>\n    ${meta}`);
}

/** The app's own address: the public address with the prefix added, unless it already has it. */
export function withBasePath(origin: string, base: string): string {
  const trimmed = origin.replace(/\/+$/, '');
  if (!base) return trimmed;
  let pathname = '';
  try {
    pathname = new URL(trimmed).pathname.replace(/\/+$/, '');
  } catch {
    // Not a full URL; just add the prefix.
  }
  return pathname.endsWith(base) ? trimmed : `${trimmed}${base}`;
}
