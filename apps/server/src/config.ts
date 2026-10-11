import path from 'node:path';
import type { SettingsStore } from './settings';

// Replaced at build time by esbuild (see build.mjs); undefined when running from source.
declare const __APP_VERSION__: string | undefined;

/** What the server needs before it can open the database. Everything else is a setting. */
export interface StartupConfig {
  port: number;
  host: string;
  dataDir: string;
  webDist: string | null;
  bootstrapAdmin: { username: string; password: string } | null;
  version: string;
  /** Kept for the settings store: environment variables pin settings. */
  env: NodeJS.ProcessEnv;
}

/** Startup values plus live settings (changes in the admin page apply without a restart). */
export interface Config extends StartupConfig {
  settings: SettingsStore;
  readonly publicUrl: string | null;
  readonly cookieSecure: boolean;
  readonly sessionDays: number;
  readonly oidc: { issuer: string; clientId: string; clientSecret: string; label: string } | null;
}

/** A value, treating blank as unset (Unraid and compose files often pass empty strings). */
function text(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** A positive whole number, or the fallback when blank. Invalid values stop startup. */
function int(v: string | undefined, fallback: number, name: string): number {
  const t = text(v);
  if (t === undefined) return fallback;
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number (got "${t}").`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StartupConfig {
  const adminUser = text(env.ADMIN_USERNAME);
  const adminPassword = text(env.ADMIN_PASSWORD);
  return {
    port: int(env.PORT, 2757, 'PORT'),
    host: text(env.HOST) ?? '0.0.0.0',
    dataDir: path.resolve(text(env.DATA_DIR) ?? './data'),
    webDist: text(env.WEB_DIST) ? path.resolve(text(env.WEB_DIST)!) : null,
    bootstrapAdmin: adminUser && adminPassword ? { username: adminUser, password: adminPassword } : null,
    version: text(env.APP_VERSION) ?? (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'),
    env,
  };
}

export function withSettings(startup: StartupConfig, settings: SettingsStore): Config {
  return {
    ...startup,
    settings,
    get publicUrl() {
      return settings.get('publicUrl') || null;
    },
    get cookieSecure() {
      const mode = settings.get('cookieSecure');
      return mode === 'always' || (mode === 'auto' && settings.get('publicUrl').startsWith('https://'));
    },
    get sessionDays() {
      return settings.get('sessionDays');
    },
    /** Single sign-on is on when the provider is filled in and there is an address to come back to. */
    get oidc() {
      const issuer = settings.get('oidcIssuer');
      const clientId = settings.get('oidcClientId');
      const clientSecret = settings.get('oidcClientSecret');
      if (!issuer || !clientId || !clientSecret || !settings.get('publicUrl')) return null;
      return { issuer, clientId, clientSecret, label: settings.get('oidcLabel') || 'Sign in with Microsoft' };
    },
  };
}
