import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Backups } from '../src/backups';
import { openDatabase } from '../src/db';
import { SettingsStore } from '../src/settings';
import { Client, createLocation, setupAdmin, testApp } from './helpers';

let app: FastifyInstance | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-backups-'));
  dirs.push(d);
  return d;
};

describe('automatic backups', () => {
  it('is due at the set hour each day, and catches up on a missed one', async () => {
    const dir = tmpDir();
    const db = openDatabase(':memory:');
    const settings = new SettingsStore(db, { BACKUP_HOUR: '3' });
    const b = new Backups(db, dir, settings);
    const at = (h: number, day = 11) => new Date(2026, 9, day, h, 30);

    // Nothing saved yet: due straight away.
    expect(b.nextAt(at(1))).toEqual(at(1));
    await b.tick(at(1));
    expect(b.list()).toHaveLength(1);
    // Saved after yesterday's 03:00, so the next one is today at 03:00.
    expect(b.nextAt(at(1))).toEqual(new Date(2026, 9, 11, 3));

    settings.set('backupKeep', 0, null);
    expect(b.nextAt(at(5))).toBeNull();
  });

  it('keeps only the newest copies, and never prunes with automatic backups off', async () => {
    const dir = tmpDir();
    const db = openDatabase(':memory:');
    const settings = new SettingsStore(db, {});
    settings.set('backupKeep', 2, null);
    const b = new Backups(db, dir, settings);
    fs.mkdirSync(b.dir, { recursive: true });
    for (const [i, name] of [
      'breakers-2026-10-01-030000.db',
      'breakers-2026-10-02-030000.db',
      'breakers-2026-10-03-030000.db',
    ].entries()) {
      const f = path.join(b.dir, name);
      fs.writeFileSync(f, 'x');
      fs.utimesSync(f, new Date(2026, 9, i + 1), new Date(2026, 9, i + 1));
    }
    fs.writeFileSync(path.join(b.dir, 'notes.txt'), 'not a backup');
    expect(b.prune()).toEqual(['breakers-2026-10-01-030000.db']);
    expect(fs.existsSync(path.join(b.dir, 'notes.txt'))).toBe(true);
    settings.set('backupKeep', 0, null);
    await b.run('manual');
    expect(b.list()).toHaveLength(3);
  });

  it('lets admins back up now, download, restore from and delete a saved backup', async () => {
    const dataDir = tmpDir();
    ({ app } = await testApp({ DATA_DIR: dataDir }));
    const admin = await setupAdmin(app);
    await createLocation(admin, null, 'company', 'Acme');

    const made = await admin.post('/api/admin/backups');
    expect(made.status).toBe(200);
    expect(made.body.name).toMatch(/^breakers-\d{4}-\d\d-\d\d-\d{6}\.db$/);
    const list = (await admin.get('/api/admin/backups')).body;
    expect(list).toMatchObject({ keep: 14, hour: 3, dir: path.join(dataDir, 'backups'), lastError: null });
    expect(list.files.map((f: { name: string }) => f.name)).toEqual([made.body.name]);

    const file = await admin.raw(`/api/admin/backups/${made.body.name}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('attachment; filename="circuit-breaker-tracker-');
    expect(file.body.subarray(0, 15).toString()).toBe('SQLite format 3');

    const staged = await admin.post(`/api/admin/backups/${made.body.name}/restore`);
    expect(staged.status).toBe(200);
    expect(staged.body.summary.counts.locations).toBe(1);
    await admin.del(`/api/admin/restore/${staged.body.id}`);

    // Names are checked, so nothing outside the backups folder can be reached.
    expect((await admin.raw('/api/admin/backups/..%2Fbreakers.db')).status).toBe(404);
    expect((await admin.del(`/api/admin/backups/${made.body.name}`)).status).toBe(200);
    expect((await admin.get('/api/admin/backups')).body.files).toEqual([]);

    // Admins only.
    expect((await new Client(app).get('/api/admin/backups')).status).toBe(401);
  });
});
