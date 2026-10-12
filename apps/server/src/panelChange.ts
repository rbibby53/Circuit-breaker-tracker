// Changing a panel outside its editor (room links accepted in bulk, verification, bulk edits)
// still bumps its version, so an open editor sees someone else saved, and writes its history.

import { audit } from './audit';
import type { DB } from './db';
import {
  breakersOf,
  describeChanges,
  getPanel,
  locationName,
  servesOf,
  snapshot,
  tagsOf,
  type PanelRow,
} from './panels';
import type { AccessData } from './repo';
import type { AuthState } from './sessions';
import { now } from './db';

const snapshotOf = (db: DB, panel: PanelRow) => {
  const breakers = breakersOf(db, panel.id);
  const ids = breakers.map((b) => b.id);
  return snapshot(panel, breakers, servesOf(db, ids), tagsOf(db, ids));
};

/**
 * Run `change` on a panel's rows and record it: a new version and a history entry listing what
 * changed, headed by `what` (e.g. "Linked rooms from breaker labels"). Nothing is recorded when
 * nothing changed. Returns the lines of history written.
 */
export function changePanel(
  db: DB,
  auth: AuthState,
  access: AccessData,
  panel: PanelRow,
  what: string,
  change: () => void,
): string[] {
  let details: string[] = [];
  db.transaction(() => {
    const before = snapshotOf(db, panel);
    change();
    const after = snapshotOf(db, getPanel(db, panel.id)!);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    db.prepare('UPDATE panels SET version = version + 1, updated_at = ? WHERE id = ?').run(now(), panel.id);
    details = describeChanges(panel, before, after, (id) => locationName(access, id));
    audit(
      db,
      auth,
      {
        action: 'panel.update',
        entity: 'panel',
        entityId: panel.id,
        locationId: panel.location_id,
        summary: `${what} on ${panel.name}: ${details.slice(0, 2).join('; ')}${details.length > 2 ? ` and ${details.length - 2} more` : ''}`,
        before,
        after: { ...after, details },
      },
      access,
    );
  })();
  return details;
}
