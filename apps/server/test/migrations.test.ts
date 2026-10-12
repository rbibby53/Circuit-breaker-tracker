import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db';
import { MIGRATIONS } from '../src/migrations';

/** A database at `version`, as an older release left it. */
function databaseAt(version: number) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
  for (const sql of MIGRATIONS.slice(0, version)) db.exec(sql);
  return db;
}

describe('upgrading to generators and relay panels', () => {
  it('rebuilds panels without losing breakers, feeds, public links or tags', () => {
    const db = databaseAt(9);
    const at = '2026-10-01T00:00:00.000Z';
    db.prepare(
      "INSERT INTO locations (id, parent_id, kind, name, path, created_at, updated_at) VALUES (1, NULL, 'company', 'Home', '/1/', ?, ?)",
    ).run(at, at);
    const panel = (id: number, name: string, fedFrom: number | null, token: string | null) =>
      db
        .prepare(
          `INSERT INTO panels (id, location_id, name, layout, spaces, main_amps, voltage, fed_from_breaker_id, created_at, updated_at, public_token)
           VALUES (?, 1, ?, 'residential', 24, 200, '120/240 V', ?, ?, ?, ?)`,
        )
        .run(id, name, fedFrom, at, at, token);
    panel(1, 'Main', null, 'tok-main');
    db.prepare(
      "INSERT INTO breakers (id, panel_id, position, poles, amps, label, device) VALUES (10, 1, 1, 2, 60, 'Garage', 'breaker')",
    ).run();
    db.prepare(
      "INSERT INTO breakers (id, panel_id, position, poles, amps, label) VALUES (11, 1, 3, 1, 20, 'Kitchen')",
    ).run();
    panel(2, 'Garage', 10, null);
    db.prepare(
      "INSERT INTO breakers (id, panel_id, position, poles, amps, label) VALUES (20, 2, 1, 1, 20, 'Door')",
    ).run();
    db.prepare("INSERT INTO breaker_tags (breaker_id, tag) VALUES (11, 'Outlets')").run();
    db.prepare("INSERT INTO breaker_serves (breaker_id, location_id, note) VALUES (11, 1, '')").run();

    migrate(db);

    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(
      MIGRATIONS.length,
    );
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(
      db
        .prepare(
          'SELECT id, name, fed_from_breaker_id, public_token, generator_id, transfer_switch FROM panels ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        id: 1,
        name: 'Main',
        fed_from_breaker_id: null,
        public_token: 'tok-main',
        generator_id: null,
        transfer_switch: '',
      },
      { id: 2, name: 'Garage', fed_from_breaker_id: 10, public_token: null, generator_id: null, transfer_switch: '' },
    ]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM breakers').get() as { n: number }).n).toBe(3);
    expect(db.prepare('SELECT tag FROM breaker_tags').all()).toEqual([{ tag: 'Outlets' }]);
    expect(db.prepare('SELECT breaker_id FROM breaker_serves').all()).toEqual([{ breaker_id: 11 }]);

    // The rebuilt table keeps its links: deleting a panel still removes its breakers.
    db.prepare('DELETE FROM panels WHERE id = 2').run();
    expect((db.prepare('SELECT COUNT(*) AS n FROM breakers WHERE panel_id = 2').get() as { n: number }).n).toBe(0);
    // And relay panels can now be stored.
    db.prepare(
      "INSERT INTO panels (location_id, name, layout, spaces, created_at, updated_at) VALUES (1, 'RP-1', 'relay', 16, ?, ?)",
    ).run(at, at);
  });

  it('turns 1.1 transfer switch names into transfer switches', () => {
    const db = databaseAt(10);
    const at = '2026-10-12T00:00:00.000Z';
    db.prepare(
      "INSERT INTO locations (id, parent_id, kind, name, path, created_at, updated_at) VALUES (1, NULL, 'company', 'KSU', '/1/', ?, ?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO generators (id, location_id, name, created_at, updated_at) VALUES (7, 1, 'GEN-1', ?, ?)",
    ).run(at, at);
    const panel = (id: number, generator: number | null, ats: string) =>
      db
        .prepare(
          `INSERT INTO panels (id, location_id, name, layout, spaces, generator_id, transfer_switch, created_at, updated_at)
           VALUES (?, 1, ?, 'commercial', 42, ?, ?, ?, ?)`,
        )
        .run(id, `P${id}`, generator, ats, at, at);
    panel(1, 7, 'ATS-1');
    panel(2, 7, 'ATS-1');
    panel(3, 7, '');
    panel(4, null, '');

    migrate(db);

    expect(db.prepare('SELECT name, generator_id, location_id FROM transfer_switches').all()).toEqual([
      { name: 'ATS-1', generator_id: 7, location_id: 1 },
    ]);
    expect(db.prepare('SELECT id, generator_id, ats_id, transfer_switch FROM panels ORDER BY id').all()).toEqual([
      { id: 1, generator_id: null, ats_id: 1, transfer_switch: '' },
      { id: 2, generator_id: null, ats_id: 1, transfer_switch: '' },
      { id: 3, generator_id: 7, ats_id: null, transfer_switch: '' },
      { id: 4, generator_id: null, ats_id: null, transfer_switch: '' },
    ]);
  });
});
