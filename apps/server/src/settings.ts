import {
  SETTING_BY_KEY,
  SETTING_DEFS,
  parseSetting,
  type AdminSetting,
  type SettingKey,
  type SettingValue,
  type Settings,
} from '@cbt/core';
import { now, type DB } from './db';

type Listener = (key: SettingKey, value: SettingValue) => void;

/**
 * Settings saved in the database, with environment variables taking priority. Values are
 * cached in memory; changes made through `set` apply immediately.
 */
export class SettingsStore {
  private readonly fromEnv = new Map<SettingKey, SettingValue>();
  private readonly saved = new Map<SettingKey, SettingValue>();
  private readonly listeners: Listener[] = [];

  constructor(
    private readonly db: DB,
    env: NodeJS.ProcessEnv,
  ) {
    for (const def of SETTING_DEFS) {
      const raw = env[def.env];
      if (raw === undefined || raw.trim() === '') continue;
      const r = parseSetting(def, raw);
      if (!r.ok) throw new Error(`${def.env} ${r.error} (got "${raw}").`);
      this.fromEnv.set(def.key, r.value);
    }
    this.load();
  }

  /** Read saved values from the database, e.g. after a restore replaced them. */
  reload(): void {
    this.saved.clear();
    this.load();
    for (const def of SETTING_DEFS) for (const l of this.listeners) l(def.key, this.get(def.key));
  }

  private load(): void {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    for (const row of rows) {
      const def = SETTING_BY_KEY.get(row.key as SettingKey);
      if (!def) continue; // a setting from a newer or older version
      try {
        const r = parseSetting(def, JSON.parse(row.value));
        if (r.ok) this.saved.set(def.key, r.value);
      } catch {
        // ignore unreadable rows; the default applies
      }
    }
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    const def = SETTING_BY_KEY.get(key)!;
    return (this.fromEnv.get(key) ?? this.saved.get(key) ?? def.default) as Settings[K];
  }

  source(key: SettingKey): AdminSetting['source'] {
    if (this.fromEnv.has(key)) return 'env';
    return this.saved.has(key) ? 'saved' : 'default';
  }

  /** Save a value, or clear it with null to go back to the default. Returns an error message. */
  set(key: SettingKey, raw: unknown, userId: number | null): string | null {
    const def = SETTING_BY_KEY.get(key);
    if (!def) return 'Unknown setting.';
    if (this.fromEnv.has(key)) return `${def.label} is set by the ${def.env} environment variable.`;
    if (raw === null) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      this.saved.delete(key);
    } else {
      const r = parseSetting(def, raw);
      if (!r.ok) return `${def.label} ${r.error}.`;
      this.db
        .prepare(
          `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .run(key, JSON.stringify(r.value), now(), userId);
      this.saved.set(key, r.value);
    }
    const value = this.get(key);
    for (const l of this.listeners) l(key, value);
    return null;
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Everything, for the admin page. Secrets are never sent back. */
  list(): AdminSetting[] {
    return SETTING_DEFS.map((def) => {
      const value = this.get(def.key);
      const secret = def.type === 'secret';
      return {
        key: def.key,
        value: secret ? '' : value,
        hasValue: value !== '',
        source: this.source(def.key),
      };
    });
  }
}
