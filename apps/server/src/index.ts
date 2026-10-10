import path from 'node:path';
import { buildApp } from './app';
import { purgeExpired } from './cleanup';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { countUsers } from './repo';
import { createUser } from './users';

const config = loadConfig();
const db = openDatabase(path.join(config.dataDir, 'breakers.db'));

if (config.bootstrapAdmin && countUsers(db) === 0) {
  await createUser(db, {
    username: config.bootstrapAdmin.username,
    displayName: config.bootstrapAdmin.username,
    password: config.bootstrapAdmin.password,
    isAdmin: true,
  });
  console.log(`Created admin user "${config.bootstrapAdmin.username}" from ADMIN_USERNAME.`);
}

const app = await buildApp(config, db);

const purge = () => {
  const removed = purgeExpired(db);
  if (Object.values(removed).some((n) => n > 0)) app.log.info({ removed }, 'Removed expired records');
};
purge();
setInterval(purge, 60 * 60_000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
