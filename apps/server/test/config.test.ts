import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('treats blank values as unset, as Unraid passes them', () => {
    const c = loadConfig({
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
    expect(c).toMatchObject({ port: 2757, logLevel: 'info', sessionDays: 30, publicUrl: null, trustProxy: false });
    expect(c.bootstrapAdmin).toBeNull();
    expect(c.oidc).toBeNull();
  });

  it('uses a default SSO label when the label is blank', () => {
    const c = loadConfig({
      PUBLIC_URL: 'https://b.example/',
      OIDC_ISSUER: 'https://login.example/t/v2.0',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_LABEL: '',
    });
    expect(c.publicUrl).toBe('https://b.example');
    expect(c.oidc?.label).toBe('Sign in with Microsoft');
    expect(c.cookieSecure).toBe(true);
  });

  it('rejects settings that would break startup with a clear message', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
    expect(() => loadConfig({ OIDC_ISSUER: 'https://x', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b' })).toThrow(
      /PUBLIC_URL/,
    );
  });
});
