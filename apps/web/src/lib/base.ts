// The path prefix the app is served under (BASE_PATH on the server, e.g. /breakers), or '' at
// the root. The server writes it into the page's `cbt-base-path` meta tag; the Vite dev server
// leaves it empty.

function readBasePath(): string {
  if (typeof document === 'undefined') return '';
  const value = document.querySelector<HTMLMetaElement>('meta[name="cbt-base-path"]')?.content ?? '';
  return value.replace(/\/+$/, '');
}

export const BASE_PATH = readBasePath();

/** An app path such as `/api/panels` or `/login`, as the browser must ask for it. */
export const withBase = (path: string): string => (path.startsWith('/') ? `${BASE_PATH}${path}` : path);
