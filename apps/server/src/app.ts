import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import type { DB } from './db';
import { HttpError } from './errors';
import { accessRoutes } from './routes/access';
import { authRoutes } from './routes/auth';
import { locationRoutes } from './routes/locations';
import { panelRoutes } from './routes/panels';
import { searchRoutes } from './routes/search';
import { loadAuth } from './sessions';

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
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(config: Config, db: DB, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('auth', null);

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('Content-Security-Policy', CSP);
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
  searchRoutes(app, db);

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
