import fs from 'node:fs';
import path from 'node:path';
import { SETTING_BY_KEY, parseSetting, type AdminSettingsResponse, type SettingKey } from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import type { Config } from '../config';
import { requireAdmin, requireAuth } from '../context';
import type { DB } from '../db';
import { badRequest, parse } from '../errors';
import { discover, redirectUri } from '../oidc';

const startedAt = new Date().toISOString();

const count = (db: DB, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

export function adminRoutes(app: FastifyInstance, db: DB, config: Config): void {
  const dbFile = path.join(config.dataDir, 'breakers.db');
  const fileSize = (f: string) => {
    try {
      return fs.statSync(f).size;
    } catch {
      return 0;
    }
  };

  app.get('/api/admin/settings', async (req): Promise<AdminSettingsResponse> => {
    requireAdmin(requireAuth(req));
    return {
      settings: config.settings.list(),
      ssoEnabled: !!config.oidc,
      redirectUri: config.publicUrl ? redirectUri(config) : null,
      about: {
        version: config.version,
        nodeVersion: process.version,
        dataDir: config.dataDir,
        databaseBytes: fileSize(dbFile) + fileSize(`${dbFile}-wal`),
        startedAt,
        counts: {
          users: count(db, 'users'),
          locations: count(db, 'locations'),
          panels: count(db, 'panels'),
          breakers: count(db, 'breakers'),
        },
      },
    };
  });

  app.patch('/api/admin/settings', async (req) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const body = parse(z.record(z.string(), z.unknown()), req.body);
    const entries = Object.entries(body) as [SettingKey, unknown][];
    if (entries.length === 0) throw badRequest('Nothing to change.');

    // Check everything first so a bad value changes nothing.
    for (const [key, value] of entries) {
      const def = SETTING_BY_KEY.get(key);
      if (!def) throw badRequest(`Unknown setting "${key}".`);
      if (config.settings.source(key) === 'env') {
        throw badRequest(`${def.label} is set by the ${def.env} environment variable. Change it there.`);
      }
      if (value !== null) {
        const r = parseSetting(def, value);
        if (!r.ok) throw badRequest(`${def.label} ${r.error}.`);
      }
    }

    const mask = (key: SettingKey, v: unknown) => (SETTING_BY_KEY.get(key)!.type === 'secret' ? (v ? '••••' : '') : v);
    const before = Object.fromEntries(entries.map(([k]) => [k, mask(k, config.settings.get(k))]));
    for (const [key, value] of entries) {
      const error = config.settings.set(key, value, auth.user.id);
      if (error) throw badRequest(error);
    }
    const after = Object.fromEntries(entries.map(([k]) => [k, mask(k, config.settings.get(k))]));
    audit(db, auth, {
      action: 'settings.update',
      entity: 'settings',
      summary: `Changed settings: ${entries.map(([k]) => SETTING_BY_KEY.get(k)!.label).join(', ')}`,
      before,
      after,
    });
    return { ok: true };
  });

  /** Check that the identity provider answers with the saved settings. */
  app.post('/api/admin/sso-check', async (req) => {
    requireAdmin(requireAuth(req));
    const oidc = config.oidc;
    if (!oidc) {
      throw badRequest('Fill in the public address, issuer URL, client ID and client secret first, then save.');
    }
    try {
      const found = await discover(oidc);
      return { ok: true, issuer: found.serverMetadata().issuer };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Could not reach the identity provider.' };
    }
  });

  /** A consistent copy of the whole database, safe to take while the app is running. */
  app.get('/api/admin/backup', async (req, reply) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const tmp = path.join(config.dataDir, `.backup-${Date.now()}.db`);
    fs.mkdirSync(config.dataDir, { recursive: true });
    await db.backup(tmp);
    audit(db, auth, { action: 'backup.download', entity: 'settings', summary: 'Downloaded a database backup' });
    const stamp = new Date().toISOString().slice(0, 10);
    const stream = fs.createReadStream(tmp);
    stream.on('close', () => fs.rm(tmp, { force: true }, () => undefined));
    return reply
      .header('Content-Type', 'application/vnd.sqlite3')
      .header('Content-Disposition', `attachment; filename="circuit-breaker-tracker-${stamp}.db"`)
      .send(stream);
  });
}
