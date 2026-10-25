import { now, type DB } from './db';
import { logger } from './log';
import type { AccessData } from './repo';
import { viewingAs, type AuthState } from './sessions';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: number | null;
  locationId?: number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Record a change. `access` should be loaded before the change for deletes, so the
 * location's path can still be resolved.
 */
export function audit(db: DB, auth: AuthState | null, entry: AuditEntry, access?: AccessData): void {
  const loc = entry.locationId && access ? access.byId.get(entry.locationId) : undefined;
  const actingAs = auth && viewingAs(auth) ? auth.user : null;
  db.prepare(
    `INSERT INTO audit_log (at, user_id, user_name, acting_as_user_id, acting_as_name, location_id, location_path,
       location_label, action, entity, entity_id, summary, before, after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    now(),
    auth?.realUser.id ?? null,
    auth?.realUser.display_name ?? null,
    actingAs?.id ?? null,
    actingAs?.display_name ?? null,
    entry.locationId ?? null,
    loc?.path ?? null,
    loc && access ? access.pathLabel(loc.id) : null,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.summary,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  );
  // The same record in the container log: who did what, and where (unless the summary says).
  const by = auth ? `${auth.realUser.username}${actingAs ? ` (as ${actingAs.username})` : ''}: ` : '';
  const label = loc && access ? access.pathLabel(loc.id) : '';
  const where = label && !entry.summary.includes(label) ? ` · ${label}` : '';
  logger()?.info(`${by}${entry.summary}${where}`);
}
