import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../src/app';
import { normaliseBasePath, renderIndex, stripBasePath, withBasePath } from '../src/basePath';
import { loadConfig, withSettings } from '../src/config';
import { openDatabase } from '../src/db';
import { redirectUri } from '../src/oidc';
import { panelQrUrl } from '../src/pdf/document';
import { SettingsStore } from '../src/settings';
import { createLocation, PASSWORD, testApp } from './helpers';

// What `vite build` writes with `base: './'`.
const BUILT_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="cbt-base-path" content="" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <script type="module" crossorigin src="./assets/index-abc123.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/chunk-def456.js">
    <link rel="stylesheet" crossorigin href="./assets/index-ghi789.css">
  </head>
  <body><div id="root"></div></body>
</html>
`;

let webDist: string;

beforeAll(() => {
  webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-web-'));
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'index.html'), BUILT_INDEX);
  fs.writeFileSync(path.join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(webDist, 'sw.js'), '// service worker');
  fs.writeFileSync(path.join(webDist, 'assets', 'index-abc123.js'), 'console.log(1);');
});

afterAll(() => fs.rmSync(webDist, { recursive: true, force: true }));

const sessionCookie = (res: { cookies: { name: string; value: string; path?: string }[] }) =>
  res.cookies.find((c) => c.name === 'cbt_session');

async function setup(app: FastifyInstance, prefix: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${prefix}/api/setup`,
    headers: { [CSRF_HEADER]: '1' },
    payload: { username: 'admin', displayName: 'Admin', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res;
}

describe('BASE_PATH values', () => {
  it('normalises slashes, and treats blank or / as the root', () => {
    expect(normaliseBasePath(undefined)).toBe('');
    expect(normaliseBasePath('')).toBe('');
    expect(normaliseBasePath(' / ')).toBe('');
    expect(normaliseBasePath('/breakers')).toBe('/breakers');
    expect(normaliseBasePath('breakers/')).toBe('/breakers');
    expect(normaliseBasePath('//plant//breakers//')).toBe('/plant/breakers');
  });

  it('refuses anything that is not a plain path', () => {
    for (const bad of ['/a/../b', '/a b', 'https://host/breakers', '/a?b', '/a#b']) {
      expect(() => normaliseBasePath(bad), bad).toThrow(/BASE_PATH/);
    }
    expect(() => loadConfig({ BASE_PATH: '/x/..' })).toThrow(/BASE_PATH/);
  });

  it('strips the prefix only on a whole path segment', () => {
    expect(stripBasePath('/breakers', '/breakers/api/x?y=1')).toBe('/api/x?y=1');
    expect(stripBasePath('/breakers', '/breakers/')).toBe('/');
    expect(stripBasePath('/breakers', '/breakersx/api')).toBe('/breakersx/api');
    expect(stripBasePath('', '/api/x')).toBe('/api/x');
  });

  it('adds the prefix to the public address unless it is already there', () => {
    expect(withBasePath('https://host', '/breakers')).toBe('https://host/breakers');
    expect(withBasePath('https://host/', '/breakers')).toBe('https://host/breakers');
    expect(withBasePath('https://host/breakers', '/breakers')).toBe('https://host/breakers');
    expect(withBasePath('https://host/breakers/', '/breakers')).toBe('https://host/breakers');
    expect(withBasePath('https://host', '')).toBe('https://host');
  });

  it('fills the prefix into the built page, and leaves a root build as it would be at /', () => {
    const root = renderIndex(BUILT_INDEX, '');
    expect(root).toContain('src="/assets/index-abc123.js"');
    expect(root).toContain('href="/favicon.svg"');
    expect(root).toContain('<meta name="cbt-base-path" content="" />');
    expect(root).not.toContain('"./');

    const prefixed = renderIndex(BUILT_INDEX, '/breakers');
    expect(prefixed).toContain('src="/breakers/assets/index-abc123.js"');
    expect(prefixed).toContain('href="/breakers/assets/chunk-def456.js"');
    expect(prefixed).toContain('href="/breakers/assets/index-ghi789.css"');
    expect(prefixed).toContain('href="/breakers/favicon.svg"');
    expect(prefixed).toContain('<meta name="cbt-base-path" content="/breakers" />');
  });
});

describe('served at the root (no BASE_PATH)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    ({ app } = await testApp({ WEB_DIST: webDist }));
  });

  it('serves the page with absolute asset paths, on deep links too', async () => {
    for (const url of ['/', '/panels/4/field', '/settings?x=1', '/index.html']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('src="/assets/index-abc123.js"');
      expect(res.body).toContain('content=""');
    }
  });

  it('serves assets and the API where they always were', async () => {
    const js = await app.inject({ url: '/assets/index-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ url: '/favicon.svg' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/assets/missing.js' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/auth/config' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/healthz' })).json()).toEqual({ ok: true });
  });

  it('sets the session cookie for the whole site', async () => {
    expect(sessionCookie(await setup(app, ''))?.path).toBe('/');
  });
});

describe('served under BASE_PATH=/breakers', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    // A trailing slash is fine.
    ({ app } = await testApp({ WEB_DIST: webDist, BASE_PATH: '/breakers/' }));
  });

  it('redirects the bare prefix (and the root) to the prefix with a trailing slash', async () => {
    for (const [url, to, code] of [
      ['/breakers', '/breakers/', 301],
      ['/breakers?next=%2Fpanels', '/breakers/?next=%2Fpanels', 301],
      ['/', '/breakers/', 302],
    ] as const) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(code);
      expect(res.headers.location).toBe(to);
    }
  });

  it('serves the page with prefixed asset paths, on deep links and refreshes', async () => {
    for (const url of ['/breakers/', '/breakers/panels/4/field', '/breakers/settings?x=1', '/breakers/index.html']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('src="/breakers/assets/index-abc123.js"');
      expect(res.body).toContain('href="/breakers/favicon.svg"');
      expect(res.body).toContain('<meta name="cbt-base-path" content="/breakers" />');
    }
  });

  it('serves assets and the API under the prefix only', async () => {
    const js = await app.inject({ url: '/breakers/assets/index-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.body).toBe('console.log(1);');
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ url: '/breakers/favicon.svg' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/breakers/sw.js' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/breakers/assets/missing.js' })).statusCode).toBe(404);

    const config = await app.inject({ url: '/breakers/api/auth/config' });
    expect(config.statusCode).toBe(200);
    expect(config.headers['cache-control']).toBe('no-store');
    expect(config.json()).toHaveProperty('needsSetup');

    // Outside the prefix there is nothing, so the page can never load assets from the wrong place.
    for (const url of ['/api/auth/config', '/assets/index-abc123.js', '/panels/4', '/breakersx/']) {
      expect((await app.inject({ url })).statusCode, url).toBe(404);
    }
  });

  it('keeps /healthz at the root for the container health check, and under the prefix', async () => {
    expect((await app.inject({ url: '/healthz' })).json()).toEqual({ ok: true });
    expect((await app.inject({ url: '/breakers/healthz' })).json()).toEqual({ ok: true });
  });

  it('scopes the session cookie to the prefix, and signs in through it', async () => {
    const res = await setup(app, '/breakers');
    const cookie = sessionCookie(res)!;
    expect(cookie.path).toBe('/breakers');
    const headers = { cookie: `cbt_session=${cookie.value}` };
    const me = await app.inject({ url: '/breakers/api/auth/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('admin');

    const out = await app.inject({
      method: 'POST',
      url: '/breakers/api/auth/logout',
      headers: { ...headers, [CSRF_HEADER]: '1' },
    });
    expect(sessionCookie(out)).toMatchObject({ value: '', path: '/breakers' });
  });
});

describe('links and QR codes under BASE_PATH', () => {
  const runtime = (env: Record<string, string>) =>
    withSettings(loadConfig(env), new SettingsStore(openDatabase(':memory:'), env));

  it('include the prefix whether or not the public address has it', () => {
    for (const publicUrl of ['https://plant.example.edu', 'https://plant.example.edu/breakers']) {
      const c = runtime({ BASE_PATH: '/breakers', PUBLIC_URL: publicUrl, OIDC_ISSUER: 'https://id.example.com' });
      expect(c.appUrl).toBe('https://plant.example.edu/breakers');
      expect(redirectUri(c)).toBe('https://plant.example.edu/breakers/api/auth/oidc/callback');
      expect(panelQrUrl({ qrBase: c.appUrl, publicPanels: true }, { id: 4, publicPath: '/p/tok' })).toBe(
        'https://plant.example.edu/breakers/p/tok',
      );
      expect(panelQrUrl({ qrBase: c.appUrl, publicPanels: false }, { id: 4, publicPath: null })).toBe(
        'https://plant.example.edu/breakers/panels/4/field',
      );
    }
    expect(runtime({ PUBLIC_URL: 'https://plant.example.edu' }).appUrl).toBe('https://plant.example.edu');
  });

  it('puts the prefix in invite links', async () => {
    const { app } = await testApp({ BASE_PATH: '/breakers', PUBLIC_URL: 'https://plant.example.edu' });
    const res = await setup(app, '/breakers');
    const cookie = `cbt_session=${sessionCookie(res)!.value}`;
    const client = {
      post: async (url: string, payload: object) => {
        const r = await app.inject({
          method: 'POST',
          url: `/breakers${url}`,
          headers: { cookie, [CSRF_HEADER]: '1' },
          payload,
        });
        return { status: r.statusCode, body: r.json() };
      },
    };
    const co = await createLocation(client as never, null, 'company', 'KSU');
    const inv = await client.post(`/api/locations/${co}/invites`, { role: 'viewer', inviteLimit: null });
    expect(inv.status).toBe(200);
    expect(inv.body.url).toMatch(/^https:\/\/plant\.example\.edu\/breakers\/invite\/[A-Za-z0-9_-]+$/);
  });
});
