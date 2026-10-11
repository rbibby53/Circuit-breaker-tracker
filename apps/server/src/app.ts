import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { withSettings, type StartupConfig } from './config';
import type { DB } from './db';
import { HttpError } from './errors';
import { accessRoutes } from './routes/access';
import { authRoutes } from './routes/auth';
import { locationRoutes } from './routes/locations';
import { exportRoutes } from './routes/export';
import { panelRoutes } from './routes/panels';
import { pdfRoutes } from './routes/pdf';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { searchRoutes } from './routes/search';
import { totpRoutes } from './routes/totp';
import { loadAuth } from './sessions';
import { SettingsStore } from './settings';

export const CSRF_HEADER = 'x-cbt-csrf';

/** Writes still allowed while viewing as someone else: leaving that mode, and signing out. */
const READ_ONLY_ALLOWED = new Set(['/api/admin/view-as', '/api/auth/logout']);

/**
 * The web app is served from this origin with self-hosted fonts and no inline scripts, so a
 * strict policy fits. Inline styles are allowed because React sets element styles.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Gravatar pictures (when turned on in Settings) are the only outside resource.
  "img-src 'self' data: https://gravatar.com https://*.gravatar.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(
  startup: StartupConfig,
  db: DB,
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  // Throws on an invalid environment variable, which stops startup with a clear message.
  const settings = new SettingsStore(db, startup.env);
  const config = withSettings(startup, settings);
  const app = Fastify({
    logger: opts.logger === false ? false : { level: settings.get('logLevel') },
    // A function so the admin page can switch it without a restart.
    trustProxy: () => settings.get('trustProxy'),
  });
  settings.onChange((key, value) => {
    if (key === 'logLevel' && opts.logger !== false) app.log.level = String(value);
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('auth', null);

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // Panels and public pages are not meant for search engines.
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // Browsers show PDFs in their own viewer, which a page policy can break.
    if (!String(reply.getHeader('content-type') ?? '').startsWith('application/pdf')) {
      reply.header('Content-Security-Policy', CSP);
    }
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=15552000');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // CSRF: browsers cannot add custom headers to cross-site form posts or simple requests.
    if (mutating && req.headers[CSRF_HEADER] !== '1') {
      return reply.code(403).send({ error: 'csrf', message: 'Missing request header.' });
    }
    req.auth = loadAuth(db, req);
    if (mutating && req.auth?.readOnly && !READ_ONLY_ALLOWED.has(req.url.split('?')[0]!)) {
      return reply
        .code(403)
        .send({ error: 'read_only', message: 'You are viewing as someone else. Exit to make changes.' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: 'request', message: e.message ?? 'Bad request.' });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'server', message: 'Something went wrong.' });
  });

  app.get('/healthz', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  authRoutes(app, db, config);
  locationRoutes(app, db);
  accessRoutes(app, db, config);
  panelRoutes(app, db);
  pdfRoutes(app, db, config);
  exportRoutes(app, db);
  publicRoutes(app, db, config);
  adminRoutes(app, db, config);
  searchRoutes(app, db);
  totpRoutes(app, db, config);

  const webDist = config.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      // Built assets have content hashes in their names; everything else must revalidate.
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found', message: 'Not found.' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Not found.' }));
  }

  return app;
}
