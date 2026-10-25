import { createApiTokenSchema, type AdminApiTokenInfo, type ApiTokenInfo, type CreatedApiToken } from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { createApiToken, MAX_TOKENS_PER_USER, tokenInfo, type ApiTokenRow } from '../apiTokens';
import { audit } from '../audit';
import type { Config } from '../config';
import { requireAdmin, requireAuth } from '../context';
import type { DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';

/** Read-only API tokens: your own under Your account, and everyone's for admins. */
export function apiTokenRoutes(app: FastifyInstance, db: DB, config: Config): void {
  app.get('/api/me/tokens', async (req): Promise<ApiTokenInfo[]> => {
    const auth = requireAuth(req);
    const rows = db
      .prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id DESC')
      .all(auth.realUser.id) as ApiTokenRow[];
    return rows.map(tokenInfo);
  });

  app.post('/api/me/tokens', async (req): Promise<CreatedApiToken> => {
    const auth = requireAuth(req);
    if (!config.settings.get('allowApiTokens')) throw forbidden('API tokens are turned off here.');
    const body = parse(createApiTokenSchema, req.body);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').get(auth.realUser.id) as {
      n: number;
    };
    if (n >= MAX_TOKENS_PER_USER) {
      throw badRequest(`You have ${n} API tokens. Revoke one you no longer use first.`);
    }
    const { token, row } = createApiToken(db, auth.realUser.id, body.name, body.days);
    audit(db, auth, {
      action: 'token.create',
      entity: 'user',
      entityId: auth.realUser.id,
      summary: `Made API token ${row.name}`,
      after: { name: row.name, expiresAt: row.expires_at },
    });
    return { token, info: tokenInfo(row) };
  });

  app.delete('/api/me/tokens/:id', async (req) => {
    const auth = requireAuth(req);
    const id = idParam((req.params as { id: string }).id);
    const row = db.prepare('SELECT * FROM api_tokens WHERE id = ? AND user_id = ?').get(id, auth.realUser.id) as
      ApiTokenRow | undefined;
    if (!row) throw notFound('That token has already been revoked.');
    db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
    audit(db, auth, {
      action: 'token.revoke',
      entity: 'user',
      entityId: auth.realUser.id,
      summary: `Revoked API token ${row.name}`,
    });
    return { ok: true };
  });

  app.get('/api/admin/tokens', async (req): Promise<AdminApiTokenInfo[]> => {
    requireAdmin(requireAuth(req));
    const rows = db
      .prepare(
        `SELECT t.*, u.username, u.display_name FROM api_tokens t JOIN users u ON u.id = t.user_id
          ORDER BY u.display_name COLLATE NOCASE, t.created_at DESC, t.id DESC`,
      )
      .all() as (ApiTokenRow & { username: string; display_name: string })[];
    return rows.map((r) => ({
      ...tokenInfo(r),
      user: { id: r.user_id, username: r.username, displayName: r.display_name },
    }));
  });

  app.delete('/api/admin/tokens/:id', async (req) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const id = idParam((req.params as { id: string }).id);
    const row = db
      .prepare('SELECT t.*, u.display_name FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?')
      .get(id) as (ApiTokenRow & { display_name: string }) | undefined;
    if (!row) throw notFound('That token has already been revoked.');
    db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
    audit(db, auth, {
      action: 'token.revoke',
      entity: 'user',
      entityId: row.user_id,
      summary: `Revoked ${row.display_name}'s API token ${row.name}`,
    });
    return { ok: true };
  });
}
