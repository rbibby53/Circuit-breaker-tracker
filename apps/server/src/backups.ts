// Automatic daily backups: consistent copies of the database in <data>/backups, with the
// oldest removed once there are more than the "Daily backups to keep" setting.

import fs from 'node:fs';
import path from 'node:path';
import type { BackupFile, BackupList } from '@cbt/core';
import type { DB } from './db';
import { localTime, logger } from './log';
import type { SettingsStore } from './settings';

const NAME = /^breakers-\d{4}-\d\d-\d\d-\d{6}\.db$/;
const DAY_MS = 86_400_000;
/** How often the scheduler looks whether a backup is due. */
const TICK_MS = 5 * 60_000;

export const isBackupName = (name: string) => NAME.test(name);

function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export class Backups {
  readonly dir: string;
  lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<BackupFile> | null = null;

  constructor(
    private readonly db: DB,
    dataDir: string,
    private readonly settings: SettingsStore,
  ) {
    this.dir = path.join(dataDir, 'backups');
  }

  /** Newest first. */
  list(): BackupFile[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter(isBackupName)
      .map((name) => {
        const stat = fs.statSync(path.join(this.dir, name));
        return { name, bytes: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }

  file(name: string): string | null {
    if (!isBackupName(name)) return null;
    const full = path.join(this.dir, name);
    return fs.existsSync(full) ? full : null;
  }

  /** The scheduled time the latest backup should cover: today's, or yesterday's if it is not time yet. */
  private lastSlot(now: Date): Date {
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), this.settings.get('backupHour'));
    return now >= slot ? slot : new Date(slot.getTime() - DAY_MS);
  }

  /** When the next automatic backup happens: now if one was missed, else the next scheduled time. */
  nextAt(now = new Date()): Date | null {
    if (this.settings.get('backupKeep') === 0) return null;
    const slot = this.lastSlot(now);
    const latest = this.list()[0];
    if (!latest || new Date(latest.createdAt) < slot) return now;
    const next = new Date(slot);
    next.setDate(next.getDate() + 1);
    return next;
  }

  summary(now = new Date()): BackupList {
    const next = this.nextAt(now);
    return {
      dir: this.dir,
      keep: this.settings.get('backupKeep'),
      hour: this.settings.get('backupHour'),
      nextAt: next ? next.toISOString() : null,
      files: this.list(),
      lastError: this.lastError,
    };
  }

  /** Save a copy now. Safe while the app is in use: SQLite's online backup. */
  run(reason: 'scheduled' | 'manual'): Promise<BackupFile> {
    // Two at once (a click during the nightly run) would just make the same copy twice.
    this.running ??= this.copy(reason).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async copy(reason: 'scheduled' | 'manual'): Promise<BackupFile> {
    fs.mkdirSync(this.dir, { recursive: true });
    const name = `breakers-${localTime(Date.now()).replace(' ', '-').replace(/:/g, '')}.db`;
    const full = path.join(this.dir, name);
    const partial = path.join(this.dir, `.${name}.partial`);
    try {
      await this.db.backup(partial);
      fs.renameSync(partial, full);
    } catch (err) {
      fs.rmSync(partial, { force: true });
      throw err;
    }
    const bytes = fs.statSync(full).size;
    const removed = this.prune();
    this.lastError = null;
    logger()?.info(
      `${reason === 'scheduled' ? 'Daily backup' : 'Backup'} saved: ${name} (${sizeText(bytes)})` +
        (removed.length ? `; removed ${removed.length} older` : ''),
    );
    return { name, bytes, createdAt: new Date().toISOString() };
  }

  /** Keep the newest `backupKeep` copies. With automatic backups off, nothing is removed. */
  prune(): string[] {
    const keep = this.settings.get('backupKeep');
    if (keep === 0) return [];
    const extra = this.list().slice(keep);
    for (const f of extra) fs.rmSync(path.join(this.dir, f.name), { force: true });
    return extra.map((f) => f.name);
  }

  remove(name: string): boolean {
    const full = this.file(name);
    if (!full) return false;
    fs.rmSync(full, { force: true });
    return true;
  }

  /** Run a backup if one is due. Failures are logged and shown in Settings, and retried next tick. */
  async tick(now = new Date()): Promise<void> {
    const next = this.nextAt(now);
    if (!next || next > now) return;
    try {
      await this.run('scheduled');
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      logger()?.error({ err }, `Daily backup failed: ${this.lastError}`);
    }
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** For the start-up summary. */
  describe(): string {
    const keep = this.settings.get('backupKeep');
    if (keep === 0) return 'Automatic backups are off (Settings → Automatic backups)';
    const latest = this.list()[0];
    const hour = String(this.settings.get('backupHour')).padStart(2, '0');
    return (
      `Automatic backups daily at ${hour}:00 to ${this.dir}, keeping ${keep}` +
      ` · ${latest ? `latest ${latest.name}` : 'none yet'}`
    );
  }
}
