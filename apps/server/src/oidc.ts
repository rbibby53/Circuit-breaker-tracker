import { groupsFromClaims, parseGroupList } from '@cbt/core';
import * as client from 'openid-client';
import type { Config } from './config';
import { now, type DB } from './db';
import { logger } from './log';

type OidcConfig = NonNullable<Config['oidc']>;

// Cached per provider settings, so changing them in the admin page takes effect at once.
let discovered: { key: string; config: Promise<client.Configuration> } | null = null;

export function discover(oidc: OidcConfig): Promise<client.Configuration> {
  const key = JSON.stringify([oidc.issuer, oidc.clientId, oidc.clientSecret]);
  if (discovered?.key !== key) {
    const config = discoverIssuer(oidc).catch((err) => {
      if (discovered?.key === key) discovered = null; // retry on the next attempt
      throw err;
    });
    discovered = { key, config };
  }
  return discovered.config;
}

/**
 * The provider's metadata. The issuer must match the provider's own exactly, and Authentik's
 * ends with a slash that is easy to leave off (or Microsoft's has none), so the other form is
 * tried when the first fails. Plain http is allowed only when the issuer is http, e.g. a
 * provider on the local network.
 */
async function discoverIssuer(oidc: OidcConfig): Promise<client.Configuration> {
  const options = oidc.issuer.startsWith('http://') ? { execute: [client.allowInsecureRequests] } : undefined;
  const find = (issuer: string) =>
    client.discovery(new URL(issuer), oidc.clientId, oidc.clientSecret, undefined, options);
  try {
    return await find(oidc.issuer);
  } catch (err) {
    const other = oidc.issuer.endsWith('/') ? oidc.issuer.replace(/\/+$/, '') : `${oidc.issuer}/`;
    try {
      return await find(other);
    } catch {
      throw err;
    }
  }
}

export const redirectUri = (config: Config) => `${config.publicUrl}/api/auth/oidc/callback`;

const STATE_TTL_MS = 10 * 60_000;

/** Build the provider's authorization URL and remember the PKCE verifier for the callback. */
export async function startOidc(
  db: DB,
  config: Config,
  opts: { inviteToken?: string; linkUserId?: number },
): Promise<string> {
  const oidc = config.oidc!;
  const cfg = await discover(oidc);
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  db.prepare('DELETE FROM oidc_states WHERE created_at < ?').run(new Date(Date.now() - STATE_TTL_MS).toISOString());
  db.prepare(
    'INSERT INTO oidc_states (state, code_verifier, nonce, invite_token, link_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(state, codeVerifier, nonce, opts.inviteToken ?? null, opts.linkUserId ?? null, now());
  return client
    .buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri(config),
      scope: scopes(config),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    .toString();
}

/** The scopes to ask for, always including `openid`. */
function scopes(config: Config): string {
  const list = config.settings
    .get('oidcScopes')
    .split(/[\s,]+/)
    .filter(Boolean);
  return [...new Set(['openid', ...list])].join(' ');
}

/** Whether anything uses groups, so they are worth an extra request when the token has none. */
export function groupsInUse(db: DB, config: Config): boolean {
  return (
    parseGroupList(config.settings.get('oidcAdminGroups')).length > 0 ||
    parseGroupList(config.settings.get('oidcAllowedGroups')).length > 0 ||
    !!db.prepare('SELECT 1 FROM sso_group_grants LIMIT 1').get()
  );
}

export interface OidcClaims {
  issuer: string;
  subject: string;
  email: string | null;
  name: string | null;
  preferredUsername: string | null;
  /** The groups claim, or null when the provider sent none. */
  groups: string[] | null;
}

export interface OidcState {
  inviteToken: string | null;
  linkUserId: number | null;
}

/** Exchange the authorization code and return the verified identity claims. */
export async function finishOidc(
  db: DB,
  config: Config,
  callbackUrl: URL,
): Promise<{ claims: OidcClaims; state: OidcState }> {
  const oidc = config.oidc!;
  const cfg = await discover(oidc);
  const stateParam = callbackUrl.searchParams.get('state') ?? '';
  const row = db.prepare('SELECT * FROM oidc_states WHERE state = ?').get(stateParam) as
    | {
        code_verifier: string;
        nonce: string;
        invite_token: string | null;
        link_user_id: number | null;
        created_at: string;
      }
    | undefined;
  db.prepare('DELETE FROM oidc_states WHERE state = ?').run(stateParam);
  if (!row || Date.now() - Date.parse(row.created_at) > STATE_TTL_MS) {
    throw new Error('Sign-in took too long or was started elsewhere. Please try again.');
  }
  const tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
    pkceCodeVerifier: row.code_verifier,
    expectedState: stateParam,
    expectedNonce: row.nonce,
    idTokenExpected: true,
  });
  const c = tokens.claims();
  if (!c) throw new Error('The identity provider did not return an ID token.');
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const claim = config.settings.get('oidcGroupsClaim');
  let groups = groupsFromClaims(c, claim);
  // Some providers only put groups in the user info, not the ID token.
  if (groups === null && groupsInUse(db, config)) {
    try {
      groups = groupsFromClaims(await client.fetchUserInfo(cfg, tokens.access_token, c.sub), claim);
    } catch (err) {
      logger()?.warn(
        `Could not read groups from the provider's user info: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return {
    claims: {
      issuer: c.iss,
      subject: c.sub,
      email: str(c.email),
      name: str(c.name),
      preferredUsername: str(c.preferred_username),
      groups,
    },
    state: { inviteToken: row.invite_token, linkUserId: row.link_user_id },
  };
}
