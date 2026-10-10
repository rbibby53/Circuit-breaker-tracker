import * as client from 'openid-client';
import type { Config } from './config';
import { now, type DB } from './db';

type OidcConfig = NonNullable<Config['oidc']>;

let discovered: Promise<client.Configuration> | null = null;

function discover(oidc: OidcConfig): Promise<client.Configuration> {
  discovered ??= client.discovery(new URL(oidc.issuer), oidc.clientId, oidc.clientSecret).catch((err) => {
    discovered = null; // retry on the next attempt
    throw err;
  });
  return discovered;
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
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    .toString();
}

export interface OidcClaims {
  issuer: string;
  subject: string;
  email: string | null;
  name: string | null;
  preferredUsername: string | null;
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
  return {
    claims: {
      issuer: c.iss,
      subject: c.sub,
      email: str(c.email),
      name: str(c.name),
      preferredUsername: str(c.preferred_username),
    },
    state: { inviteToken: row.invite_token, linkUserId: row.link_user_id },
  };
}
