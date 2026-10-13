import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { withSettings, type StartupConfig } from './config';
import type { DB } from './db';
import { HttpError } from './errors';
import { logRequest, LogStream, safePath, setLogger } from './log';
import { accessRoutes } from './routes/access';
import { authRoutes } from './routes/auth';
import { locationRoutes } from './routes/locations';
import { exportRoutes } from './routes/export';
import { panelRoutes } from './routes/panels';
import { pdfRoutes } from './routes/pdf';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { ssoGroupRoutes } from './routes/ssoGroups';
import { generatorRoutes } from './routes/generators';
import { topologyRoutes } from './routes/topology';
import { deviceRoutes } from './routes/devices';
import { equipmentRoutes } from './routes/equipment';
import { verifyRoutes } from './routes/verify';
import { impactRoutes } from './routes/impact';
import { searchRoutes } from './routes/search';
import { totpRoutes } from './routes/totp';
import { loadAuth } from './sessions';
import { SettingsStore } from './settings';
import { startupLines } from './startup';
import { Backups } from './backups';

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
  opts: {
    logger?: boolean;
    logStream?: LogStream;
    /** The real server: log the start-up summary and run scheduled jobs. Off in tests. */
    startupReport?: boolean;
  } = {},
): Promise<FastifyInstance> {
  // Throws on an invalid environment variable, which stops startup with a clear message.
  const settings = new SettingsStore(db, startup.env);
  const config = withSettings(startup, settings);
  const stream = opts.logStream ?? new LogStream(settings.get('logFormat'));
  const logging = opts.logger !== false || !!opts.logStream;
  const app = Fastify({
    // No pid or hostname: in a container they say nothing. Requests get one line each, below.
    logger: logging ? { level: settings.get('logLevel'), stream, base: null } : false,
    logController: new LogController({ disableRequestLogging: true }),
    // A function so the admin page can switch it without a restart.
    trustProxy: () => settings.get('trustProxy'),
  });
  setLogger(logging ? app.log : null);
  settings.onChange((key, value) => {
    if (!logging) return;
    if (key === 'logLevel') app.log.level = String(value);
    if (key === 'logFormat') stream.format = value === 'json' ? 'json' : 'text';
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    onExceeded: (req) =>
      req.log.warn(`Too many requests to ${req.method} ${safePath(req)} from ${req.ip}; refusing for now`),
  });

  app.addHook('onResponse', async (req, reply) => logRequest(req, reply));

  // Behind a reverse proxy without Trust proxy, every address in the log is the proxy's.
  let proxyWarned = false;
  app.addHook('onRequest', async (req) => {
    if (proxyWarned || !req.headers['x-forwarded-for'] || settings.get('trustProxy')) return;
    proxyWarned = true;
    req.log.warn(
      `Requests arrive through a reverse proxy (${req.ip}) but "Behind a reverse proxy" is off, so addresses in this log are the proxy's. Turn it on in Settings, or set TRUST_PROXY=true.`,
    );
  });

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
      req.failure ??= err.message;
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      req.failure ??= e.message;
      return reply.code(e.statusCode).send({ error: 'request', message: e.message ?? 'Bad request.' });
    }
    req.log.error({ err }, `Error in ${req.method} ${safePath(req)}`);
    return reply.code(500).send({ error: 'server', message: 'Something went wrong.' });
  });

  const backups = new Backups(db, config.dataDir, settings);
  if (opts.startupReport) {
    for (const line of startupLines(db, config)) app.log[line.level](line.msg);
    app.log.info(backups.describe());
    backups.start();
  }
  app.addHook('onClose', async () => backups.stop());

  app.get('/healthz', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  authRoutes(app, db, config);
  locationRoutes(app, db);
  accessRoutes(app, db, config);
  panelRoutes(app, db);
  generatorRoutes(app, db);
  topologyRoutes(app, db);
  deviceRoutes(app, db);
  equipmentRoutes(app, db);
  verifyRoutes(app, db);
  impactRoutes(app, db);
  pdfRoutes(app, db, config);
  exportRoutes(app, db);
  publicRoutes(app, db, config);
  adminRoutes(app, db, config, backups, stream);
  ssoGroupRoutes(app, db);
  searchRoutes(app, db);
  totpRoutes(app, db, config);

  const webDist = config.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      // Built assets have content hashes in their names; everything else must revalidate.
      setHeaders: (reply, filePath) => {
        reply.header(
          'Cache-Control',
          filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    app.setNotFoundHandler((req, reply) => {
      // Missing built files are a real 404, so a stale page sees "not found" rather than HTML.
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/')) {
        // Always revalidate the page, so an upgrade is picked up and old file names are not asked for.
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: 'Not found.' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Not found.' }));
  }

  return app;
}
