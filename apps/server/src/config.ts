import path from 'node:path';

// Replaced at build time by esbuild (see build.mjs); undefined when running from source.
declare const __APP_VERSION__: string | undefined;

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Public base URL without a trailing slash, e.g. https://breakers.example.com */
  publicUrl: string | null;
  trustProxy: boolean;
  cookieSecure: boolean;
  sessionDays: number;
  webDist: string | null;
  bootstrapAdmin: { username: string; password: string } | null;
  oidc: { issuer: string; clientId: string; clientSecret: string; label: string } | null;
  logLevel: string;
  version: string;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

/** A setting's value, treating blank as unset (Unraid and compose files often pass empty strings). */
function text(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** A positive whole number, or the fallback when blank or invalid. */
function int(v: string | undefined, fallback: number, name: string): number {
  const t = text(v);
  if (t === undefined) return fallback;
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number (got "${t}").`);
  return n;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = text(env.PUBLIC_URL)?.replace(/\/+$/, '') ?? null;
  const oidcIssuer = text(env.OIDC_ISSUER);
  const oidcClientId = text(env.OIDC_CLIENT_ID);
  const oidcClientSecret = text(env.OIDC_CLIENT_SECRET);
  if (oidcIssuer && !publicUrl) {
    throw new Error('PUBLIC_URL must be set when OIDC_ISSUER is set (it builds the redirect URL).');
  }
  const logLevel = text(env.LOG_LEVEL)?.toLowerCase() ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`);
  const adminUser = text(env.ADMIN_USERNAME);
  const adminPassword = text(env.ADMIN_PASSWORD);
  return {
    port: int(env.PORT, 2757, 'PORT'),
    host: text(env.HOST) ?? '0.0.0.0',
    dataDir: path.resolve(text(env.DATA_DIR) ?? './data'),
    publicUrl,
    trustProxy: bool(env.TRUST_PROXY, false),
    cookieSecure: bool(env.COOKIE_SECURE, publicUrl?.startsWith('https://') ?? false),
    sessionDays: int(env.SESSION_DAYS, 30, 'SESSION_DAYS'),
    webDist: text(env.WEB_DIST) ? path.resolve(text(env.WEB_DIST)!) : null,
    bootstrapAdmin: adminUser && adminPassword ? { username: adminUser, password: adminPassword } : null,
    oidc:
      oidcIssuer && oidcClientId && oidcClientSecret
        ? {
            issuer: oidcIssuer,
            clientId: oidcClientId,
            clientSecret: oidcClientSecret,
            label: text(env.OIDC_LABEL) ?? 'Sign in with Microsoft',
          }
        : null,
    logLevel,
    version: text(env.APP_VERSION) ?? (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'),
  };
}
