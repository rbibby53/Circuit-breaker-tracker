import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db';
import { MIGRATIONS } from '../src/migrations';
import { Client, PASSWORD, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: DB;
let dataDir: string;

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-restore-'));
  ({ app, db } = await testApp({ DATA_DIR: dataDir }));
});

const upload = (c: Client, bytes: Buffer) =>
  c.req('POST', '/api/admin/restore', bytes, { 'content-type': 'application/octet-stream' });

async function signIn(username = 'admin') {
  const c = new Client(app);
  const r = await c.post('/api/auth/login', { username, password: PASSWORD });
  return { c, status: r.status };
}

describe('restore from backup', () => {
  it('checks the file, then replaces everything and signs everyone out', async () => {
    const admin = await setupAdmin(app);
    await createLocation(admin, null, 'company', 'Before');
    const backup = (await admin.raw('/api/admin/backup')).body;

    // Changes made after the backup, which the restore should undo.
    await createLocation(admin, null, 'company', 'After');
    await admin.patch('/api/admin/settings', { appName: 'Renamed later' });

    const checked = await upload(admin, backup);
    expect(checked.status).toBe(200);
    expect(checked.body.summary).toMatchObject({
      schemaVersion: MIGRATIONS.length,
      counts: { users: 1, locations: 1, panels: 0, breakers: 0 },
    });

    const applied = await admin.post(`/api/admin/restore/${checked.body.id}`);
    expect(applied.status).toBe(200);
    expect(fs.existsSync(path.join(dataDir, applied.body.safetyCopy))).toBe(true);
    expect(fs.readdirSync(dataDir).some((f) => f.startsWith('.restore-'))).toBe(false);

    // Everyone is signed out, including the admin who restored.
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    const again = await signIn();
    expect(again.status).toBe(200);
    expect((await again.c.get('/api/locations')).body.map((l: { name: string }) => l.name)).toEqual(['Before']);
    expect((await new Client(app).get('/api/auth/config')).body.appName).toBe('Circuit Breaker Tracker');
    const activity = (await again.c.get('/api/activity')).body;
    expect(activity[0].summary).toMatch(/^Restored the database from a backup/);
  });

  it('brings a backup from an older version up to date', async () => {
    const admin = await setupAdmin(app);
    const hash = (db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as any).password_hash;
    // A backup made when the app only had its first two migrations.
    const old = path.join(dataDir, 'old.db');
    const src = new Database(old);
    src.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (2);');
    src.exec(MIGRATIONS[0]!);
    src.exec(MIGRATIONS[1]!);
    src
      .prepare('INSERT INTO users (username, display_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)')
      .run('oldadmin', 'Old admin', hash, new Date().toISOString());
    src.close();

    const checked = await upload(admin, fs.readFileSync(old));
    expect(checked.body.summary.schemaVersion).toBe(2);
    expect((await admin.post(`/api/admin/restore/${checked.body.id}`)).status).toBe(200);
    expect((await signIn('oldadmin')).status).toBe(200);
    // Tables from later versions exist and settings still work.
    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(
      MIGRATIONS.length,
    );
  });

  it('refuses files that are not backups, or from a newer version', async () => {
    const admin = await setupAdmin(app);
    const junk = await upload(admin, Buffer.from('not a database at all'));
    expect(junk.status).toBe(400);
    expect(junk.body.message).toMatch(/not a database backup/);

    const other = path.join(dataDir, 'other.db');
    new Database(other).exec('CREATE TABLE notes (id INTEGER)').close();
    expect((await upload(admin, fs.readFileSync(other))).body.message).toMatch(/not a Circuit Breaker Tracker backup/);

    const backup = (await admin.raw('/api/admin/backup')).body;
    const newer = path.join(dataDir, 'newer.db');
    fs.writeFileSync(newer, backup);
    new Database(newer).exec(`UPDATE schema_version SET version = ${MIGRATIONS.length + 1}`).close();
    expect((await upload(admin, fs.readFileSync(newer))).body.message).toMatch(/newer version/);

    expect((await admin.post(`/api/admin/restore/${'0'.repeat(32)}`)).status).toBe(400);
    expect((await admin.post('/api/admin/restore/not-an-id')).status).toBe(400);
  });

  it('is for admins only, and a pending upload can be discarded', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Co');
    const manager = await invite(app, admin, co, 'manager', 'boss', 'editor');
    const backup = (await admin.raw('/api/admin/backup')).body;
    expect((await upload(manager, backup)).status).toBe(403);

    const checked = await upload(admin, backup);
    expect((await admin.del(`/api/admin/restore/${checked.body.id}`)).status).toBe(200);
    expect((await admin.post(`/api/admin/restore/${checked.body.id}`)).body.message).toMatch(/expired/);
  });
});
