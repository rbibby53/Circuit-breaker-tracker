import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SETTING_BY_KEY,
  parseSetting,
  type AdminSettingsResponse,
  type BackupFile,
  type BackupList,
  type LogLines,
  type RestoreUpload,
  type SettingKey,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import type { Backups } from '../backups';
import { disposition } from '../download';
import { RECENT_LINES, type LogStream } from '../log';
import type { Config } from '../config';
import { requireAdmin, requireAuth } from '../context';
import type { DB } from '../db';
import { badRequest, notFound, parse } from '../errors';
import { discover, redirectUri } from '../oidc';
import { inspectBackup, restoreFrom } from '../restore';
import { clearSessionCookie } from '../sessions';

/** Largest backup accepted for restore. */
const MAX_RESTORE_BYTES = 512 * 1024 * 1024;
/** Uploaded backups waiting for confirmation are removed after this long. */
const PENDING_RESTORE_MS = 60 * 60_000;

const startedAt = new Date().toISOString();

const count = (db: DB, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

export function adminRoutes(app: FastifyInstance, db: DB, config: Config, backups: Backups, logs: LogStream): void {
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

  // ---- Restore: upload and check a backup, then apply it once the admin confirms ----------

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_RESTORE_BYTES },
    (_req, body, done) => done(null, body),
  );

  const pendingFile = (id: string) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw badRequest('Unknown upload.');
    return path.join(config.dataDir, `.restore-${id}.db`);
  };
  const removeStaleUploads = () => {
    for (const f of fs.readdirSync(config.dataDir)) {
      if (!/^\.restore-[a-f0-9]{32}\.db$/.test(f)) continue;
      const full = path.join(config.dataDir, f);
      if (Date.now() - fs.statSync(full).mtimeMs > PENDING_RESTORE_MS) fs.rmSync(full, { force: true });
    }
  };

  app.post('/api/admin/restore', { bodyLimit: MAX_RESTORE_BYTES }, async (req): Promise<RestoreUpload> => {
    requireAdmin(requireAuth(req));
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest('Choose a backup file to upload.');
    }
    fs.mkdirSync(config.dataDir, { recursive: true });
    removeStaleUploads();
    const id = randomBytes(16).toString('hex');
    const file = pendingFile(id);
    fs.writeFileSync(file, req.body);
    try {
      return { id, summary: inspectBackup(file) };
    } catch (err) {
      fs.rmSync(file, { force: true });
      throw err;
    }
  });

  app.post('/api/admin/restore/:id', async (req, reply) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const file = pendingFile((req.params as { id: string }).id);
    if (!fs.existsSync(file)) throw badRequest('That upload has expired. Upload the backup again.');
    const summary = inspectBackup(file);

    // Keep what is there now, in case the wrong file was picked.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safetyCopy = `breakers-before-restore-${stamp}.db`;
    await db.backup(path.join(config.dataDir, safetyCopy));

    restoreFrom(db, file);
    fs.rmSync(file, { force: true });
    config.settings.reload();
    audit(db, auth, {
      action: 'backup.restore',
      entity: 'settings',
      summary: `Restored the database from a backup (${summary.counts.panels} panels, ${summary.counts.users} people). The previous data was saved as ${safetyCopy}.`,
    });
    // Sessions are not restored, so everyone, including this admin, signs in again.
    clearSessionCookie(config, reply);
    return { ok: true, safetyCopy };
  });

  app.delete('/api/admin/restore/:id', async (req) => {
    requireAdmin(requireAuth(req));
    fs.rmSync(pendingFile((req.params as { id: string }).id), { force: true });
    return { ok: true };
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

  // ---- Automatic backups --------------------------------------------------------------

  app.get('/api/admin/backups', async (req): Promise<BackupList> => {
    requireAdmin(requireAuth(req));
    return backups.summary();
  });

  app.post('/api/admin/backups', async (req): Promise<BackupFile> => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const made = await backups.run('manual');
    audit(db, auth, { action: 'backup.create', entity: 'settings', summary: `Saved a backup now (${made.name})` });
    return made;
  });

  const backupFile = (name: string) => {
    const file = backups.file(name);
    if (!file) throw notFound('That backup is not there any more.');
    return file;
  };

  app.get('/api/admin/backups/:name', async (req, reply) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const { name } = req.params as { name: string };
    const file = backupFile(name);
    audit(db, auth, { action: 'backup.download', entity: 'settings', summary: `Downloaded the backup ${name}` });
    return reply
      .header('Content-Type', 'application/vnd.sqlite3')
      .header(
        'Content-Disposition',
        disposition(`circuit-breaker-tracker-${name.replace(/^breakers-/, '').replace(/\.db$/, '')}`, 'db', true),
      )
      .send(fs.createReadStream(file));
  });

  /** Stage a saved backup for restore, exactly like an upload: check it, then confirm. */
  app.post('/api/admin/backups/:name/restore', async (req): Promise<RestoreUpload> => {
    requireAdmin(requireAuth(req));
    const file = backupFile((req.params as { name: string }).name);
    removeStaleUploads();
    const id = randomBytes(16).toString('hex');
    const staged = pendingFile(id);
    fs.copyFileSync(file, staged);
    try {
      return { id, summary: inspectBackup(staged) };
    } catch (err) {
      fs.rmSync(staged, { force: true });
      throw err;
    }
  });

  app.delete('/api/admin/backups/:name', async (req) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const { name } = req.params as { name: string };
    if (!backups.remove(name)) throw notFound('That backup is not there any more.');
    audit(db, auth, { action: 'backup.delete', entity: 'settings', summary: `Deleted the backup ${name}` });
    return { ok: true };
  });

  // ---- Log viewer -------------------------------------------------------------------

  const LEVEL_NUMBERS = { debug: 20, info: 30, warn: 40, error: 50 } as const;
  const levelName = (n: number): LogLines['lines'][number]['level'] =>
    n >= 50 ? 'error' : n >= 40 ? 'warn' : n >= 30 ? 'info' : 'debug';

  app.get('/api/admin/logs', async (req): Promise<LogLines> => {
    requireAdmin(requireAuth(req));
    const { level } = parse(
      z.object({ level: z.enum(['debug', 'info', 'warn', 'error']).default('debug') }),
      req.query,
    );
    return {
      level: config.settings.get('logLevel'),
      capacity: RECENT_LINES,
      lines: logs.recent(LEVEL_NUMBERS[level]).map((l) => ({
        time: new Date(l.time).toISOString(),
        level: levelName(l.level),
        text: l.text,
      })),
    };
  });
}
