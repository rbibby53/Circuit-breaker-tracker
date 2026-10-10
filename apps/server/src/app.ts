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
import { loadAuth } from './sessions';

export const CSRF_HEADER = 'x-cbt-csrf';

/** Writes still allowed while viewing as someone else: leaving that mode, and signing out. */
const READ_ONLY_ALLOWED = new Set(['/api/admin/view-as', '/api/auth/logout']);

export async function buildApp(config: Config, db: DB, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // CSRF: browsers cannot add custom headers to cross-site form posts or simple requests.
    if (mutating && req.headers[CSRF_HEADER] !== '1') {
      return reply.code(403).send({ error: 'csrf', message: 'Missing request header.' });
    }
    req.auth = loadAuth(db, req);
    if (mutating && req.auth?.readOnly && !READ_ONLY_ALLOWED.has(req.url.split('?')[0]!)) {
      return reply.code(403).send({ error: 'read_only', message: 'You are viewing as someone else. Exit to make changes.' });
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

  const webDist = config.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found', message: 'Not found.' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Not found.' }));
  }

  return app;
}
