import path from 'node:path';
import { buildApp } from './app';
import { purgeExpired } from './cleanup';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { countUsers } from './repo';
import { createUser } from './users';

const config = loadConfig();
const db = openDatabase(path.join(config.dataDir, 'breakers.db'));

let bootstrapped: string | null = null;
if (config.bootstrapAdmin && countUsers(db) === 0) {
  await createUser(db, {
    username: config.bootstrapAdmin.username,
    displayName: config.bootstrapAdmin.username,
    password: config.bootstrapAdmin.password,
    isAdmin: true,
  });
  bootstrapped = config.bootstrapAdmin.username;
}

const app = await buildApp(config, db, { startupReport: true });
if (bootstrapped) app.log.info(`Created the admin account "${bootstrapped}" from ADMIN_USERNAME`);

const LABELS = {
  sessions: ['expired session', 'expired sessions'],
  states: ['abandoned single sign-on', 'abandoned single sign-ons'],
  challenges: ['unfinished two-step sign-in', 'unfinished two-step sign-ins'],
  invites: ['old invite link', 'old invite links'],
  resets: ['old reset link', 'old reset links'],
  tokens: ['expired API token', 'expired API tokens'],
} as const;

const purge = () => {
  try {
    const removed = purgeExpired(db);
    const parts = (Object.keys(LABELS) as (keyof typeof LABELS)[])
      .filter((k) => removed[k] > 0)
      .map((k) => `${removed[k]} ${LABELS[k][removed[k] === 1 ? 0 : 1]}`);
    if (parts.length) app.log.info(`Cleaned up ${parts.join(', ')}`);
  } catch (err) {
    app.log.error({ err }, 'Cleaning up expired records failed');
  }
};
purge();
setInterval(purge, 60 * 60_000).unref();

const shutdown = async (signal: string) => {
  app.log.info(`Stopping (${signal})`);
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
// Anything that escapes a request still ends up in the log, with its stack, before the
// container restarts.
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'Crashed on an unexpected error');
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  app.log.error({ err }, 'Unhandled promise rejection');
});

await app.listen({
  port: config.port,
  host: config.host,
  listenTextResolver: (address) => `Web UI listening at ${address}`,
});
