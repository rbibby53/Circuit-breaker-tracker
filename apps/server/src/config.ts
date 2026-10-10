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
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : null;
  const oidcIssuer = env.OIDC_ISSUER?.trim();
  const oidcClientId = env.OIDC_CLIENT_ID?.trim();
  const oidcClientSecret = env.OIDC_CLIENT_SECRET?.trim();
  if (oidcIssuer && !publicUrl) {
    throw new Error('PUBLIC_URL must be set when OIDC_ISSUER is set (it builds the redirect URL).');
  }
  return {
    port: Number(env.PORT ?? 2757),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    publicUrl,
    trustProxy: bool(env.TRUST_PROXY, false),
    cookieSecure: bool(env.COOKIE_SECURE, publicUrl?.startsWith('https://') ?? false),
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
    bootstrapAdmin:
      env.ADMIN_USERNAME && env.ADMIN_PASSWORD ? { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD } : null,
    oidc:
      oidcIssuer && oidcClientId && oidcClientSecret
        ? {
            issuer: oidcIssuer,
            clientId: oidcClientId,
            clientSecret: oidcClientSecret,
            label: env.OIDC_LABEL ?? 'Sign in with Microsoft',
          }
        : null,
    logLevel: env.LOG_LEVEL ?? 'info',
    version: env.APP_VERSION || (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'),
  };
}
