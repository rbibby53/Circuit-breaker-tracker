// What the server says when it starts: enough to tell from the container log alone which
// version is running, where its data is, and how people can sign in.

import fs from 'node:fs';
import path from 'node:path';
import { SETTING_DEFS, parseGroupList } from '@cbt/core';
import type { Config } from './config';
import type { DB } from './db';

export interface StartupLine {
  level: 'info' | 'warn';
  msg: string;
}

const count = (db: DB, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function startupLines(db: DB, config: Config, env: NodeJS.ProcessEnv = process.env): StartupLine[] {
  const s = config.settings;
  const lines: StartupLine[] = [];
  const info = (msg: string) => lines.push({ level: 'info', msg });
  const warn = (msg: string) => lines.push({ level: 'warn', msg });

  const tz = env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  info(`${s.get('appName')} ${config.version} starting · Node ${process.version} · times in this log are ${tz}`);

  const file = path.join(config.dataDir, 'breakers.db');
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const schema = (db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined)?.version;
  const users = count(db, 'users');
  info(
    `Database ${file} (${size(bytes)}, schema ${schema ?? '?'}): ${users} people, ${count(db, 'locations')} locations, ` +
      `${count(db, 'panels')} panels, ${count(db, 'breakers')} breakers`,
  );
  if (users === 0) info('No accounts yet: open the web UI to create the first admin.');

  const publicUrl = s.get('publicUrl');
  info(
    publicUrl
      ? `Public address ${publicUrl}`
      : 'Public address not set: links and QR codes use the address each browser used. Set it under Settings if this is reached from outside your network.',
  );

  const ways: string[] = [];
  ways.push(s.get('allowLocalLogin') ? 'passwords' : 'passwords (admins only)');
  if (config.oidc) {
    const groups = [
      parseGroupList(s.get('oidcAdminGroups')).length ? 'admin groups' : '',
      parseGroupList(s.get('oidcAllowedGroups')).length ? 'allowed groups' : '',
      count(db, 'sso_group_grants') ? `${count(db, 'sso_group_grants')} group access rules` : '',
    ].filter(Boolean);
    ways.push(
      `${config.oidc.provider === 'single sign-on' ? 'single sign-on' : config.oidc.provider} via ${new URL(config.oidc.issuer).host}` +
        (groups.length ? ` (${groups.join(', ')})` : ''),
    );
  }
  info(`Sign-in: ${ways.join(', ')} · sessions last ${s.get('sessionDays')} days`);
  const ssoParts = [s.get('oidcIssuer'), s.get('oidcClientId'), s.get('oidcClientSecret')].filter(Boolean).length;
  if (!config.oidc && ssoParts > 0) {
    warn(
      ssoParts < 3
        ? 'Single sign-on is partly set up (it needs the issuer, client ID and client secret), so it is off.'
        : 'Single sign-on needs the public address to be set, so it is off.',
    );
  }

  info(
    `Network: behind a reverse proxy ${s.get('trustProxy') ? 'yes' : 'no'} · HTTPS-only cookies ${config.cookieSecure ? 'yes' : 'no'}`,
  );

  const fromEnv = SETTING_DEFS.filter((d) => s.source(d.key) === 'env').map((d) => d.env);
  if (fromEnv.length) info(`Set by environment variables (locked in Settings): ${fromEnv.join(', ')}`);
  info(`Logging at ${s.get('logLevel')} level as ${s.get('logFormat') === 'json' ? 'JSON' : 'text'}`);
  return lines;
}
