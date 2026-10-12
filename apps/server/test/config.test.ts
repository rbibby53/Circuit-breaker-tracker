import { describe, expect, it } from 'vitest';
import { loadConfig, withSettings } from '../src/config';
import { openDatabase } from '../src/db';
import { SettingsStore } from '../src/settings';

const runtime = (env: Record<string, string>) => {
  const startup = loadConfig(env);
  return withSettings(startup, new SettingsStore(openDatabase(':memory:'), env));
};

describe('startup config', () => {
  it('treats blank values as unset, as Unraid passes them', () => {
    const c = runtime({
      PORT: '',
      LOG_LEVEL: '',
      SESSION_DAYS: ' ',
      PUBLIC_URL: '',
      TRUST_PROXY: '',
      ADMIN_USERNAME: '',
      ADMIN_PASSWORD: '',
      OIDC_ISSUER: '',
      OIDC_LABEL: '',
      APP_VERSION: '',
    });
    expect(c.port).toBe(2757);
    expect(c.settings.get('logLevel')).toBe('info');
    expect(c.sessionDays).toBe(30);
    expect(c.publicUrl).toBeNull();
    expect(c.settings.get('trustProxy')).toBe(false);
    expect(c.bootstrapAdmin).toBeNull();
    expect(c.oidc).toBeNull();
  });

  it('turns on single sign-on from the environment, with a default button label', () => {
    const c = runtime({
      PUBLIC_URL: 'https://b.example/',
      OIDC_ISSUER: 'https://login.microsoftonline.com/t/v2.0',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_LABEL: '',
    });
    expect(c.publicUrl).toBe('https://b.example');
    expect(c.oidc?.label).toBe('Sign in with Microsoft');
    expect(c.oidc?.provider).toBe('Microsoft');
    expect(c.cookieSecure).toBe(true);
  });

  it('keeps single sign-on off until there is a public address to return to', () => {
    const c = runtime({ OIDC_ISSUER: 'https://x.example', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b' });
    expect(c.oidc).toBeNull();
  });

  it('stops startup on settings that make no sense, naming the variable', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => runtime({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
    expect(() => runtime({ SESSION_DAYS: '0' })).toThrow(/SESSION_DAYS/);
    expect(() => runtime({ PUBLIC_URL: 'breakers.local' })).toThrow(/PUBLIC_URL/);
  });

  it('still accepts the old true/false COOKIE_SECURE', () => {
    expect(runtime({ COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
    expect(runtime({ COOKIE_SECURE: 'false', PUBLIC_URL: 'https://x.example' }).cookieSecure).toBe(false);
  });
});
