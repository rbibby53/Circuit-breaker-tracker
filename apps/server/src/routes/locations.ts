import {
  KIND_LABELS,
  PARENT_KIND,
  canCreateChild,
  canDeleteLocation,
  canRenameLocation,
  canView,
  createLocationSchema,
  makePath,
  updateLocationSchema,
  visibleLocations,
  type LocationDto,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { assertCheck, badRequest, conflict, idParam, notFound, parse } from '../errors';
import { AccessData, type LocationRow } from '../repo';

export const DEFAULT_BUILDING_NAME = 'Main building';

export function locationRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/locations', async (req): Promise<LocationDto[]> => {
    const auth = requireAuth(req);
    const access = new AccessData(db);
    const visible = visibleLocations(actorOf(auth), [...access.nodes.values()], access.grants);
    return access.locations
      .filter((l) => visible.has(l.id))
      .map((l) => {
        const v = visible.get(l.id)!;
        return {
          id: l.id,
          parentId: l.parent_id,
          kind: l.kind,
          name: l.name,
          notes: v.access === 'full' ? l.notes : '',
          sortOrder: l.sort_order,
          isDefaultBuilding: !!l.is_default_building,
          access: v.access,
          role: v.role,
        };
      });
  });

  app.post('/api/locations', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const body = parse(createLocationSchema, req.body);
    const access = new AccessData(db);

    let parent: LocationRow | null = null;
    let createBuildingIn: LocationRow | null = null;
    if (body.parentId !== null) {
      parent = access.byId.get(body.parentId) ?? null;
      if (!parent || !canView(actor, parent, access.grants)) throw notFound('Parent location not found.');
      // Floors added straight under a site go into its only building (homes hide that level).
      if (body.kind === 'floor' && parent.kind === 'site') {
        const buildings = access.locations.filter((l) => l.parent_id === parent!.id && l.kind === 'building');
        const hidden = buildings.length === 1 && buildings[0]!.is_default_building === 1 ? buildings[0]! : null;
        if (buildings.length > 0 && !hidden) throw badRequest('This site has buildings. Add the floor to one of them.');
        assertCheck(canCreateChild(actor, access.node(parent.id)!, access.grants));
        if (hidden) parent = hidden;
        else createBuildingIn = parent;
      }
    }
    const expected = PARENT_KIND[body.kind];
    if (!createBuildingIn && (parent?.kind ?? null) !== expected) {
      throw badRequest(
        expected
          ? `A ${KIND_LABELS[body.kind].toLowerCase()} must be inside a ${KIND_LABELS[expected].toLowerCase()}.`
          : 'A company cannot be inside another location.',
      );
    }
    assertCheck(canCreateChild(actor, parent ? access.node(parent.id)! : null, access.grants));

    const created = db.transaction(() => {
      if (createBuildingIn) parent = insertLocation(db, createBuildingIn, 'building', DEFAULT_BUILDING_NAME, '', true);
      const row = insertLocation(db, parent, body.kind, body.name, body.notes ?? '');
      return row;
    })();
    const after = new AccessData(db);
    audit(
      db,
      auth,
      {
        action: 'location.create',
        entity: 'location',
        entityId: created.id,
        locationId: created.id,
        summary: `Added ${KIND_LABELS[created.kind].toLowerCase()} ${created.name}`,
        after: { name: created.name, kind: created.kind },
      },
      after,
    );
    return { id: created.id };
  });

  app.patch('/api/locations/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const body = parse(updateLocationSchema, req.body);
    const access = new AccessData(db);
    const node = access.byId.get(id);
    if (!node || !canView(actor, node, access.grants)) throw notFound();
    const parent = node.parent_id ? access.byId.get(node.parent_id)! : null;
    const parentNode = parent ? access.node(parent.id)! : null;

    if (body.name !== undefined || body.notes !== undefined) {
      assertCheck(canRenameLocation(actor, access.node(id)!, parentNode, access.grants));
    }
    if (body.sortOrder !== undefined) assertCheck(canCreateChild(actor, parentNode, access.grants));

    const before = { name: node.name, notes: node.notes, sortOrder: node.sort_order };
    const next = { name: body.name ?? node.name, notes: body.notes ?? node.notes, sortOrder: body.sortOrder ?? node.sort_order };
    db.prepare('UPDATE locations SET name = ?, notes = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(
      next.name,
      next.notes,
      next.sortOrder,
      now(),
      id,
    );
    audit(
      db,
      auth,
      {
        action: 'location.update',
        entity: 'location',
        entityId: id,
        locationId: id,
        summary: next.name !== node.name ? `Renamed ${node.name} to ${next.name}` : `Updated ${node.name}`,
        before,
        after: next,
      },
      access,
    );
    return { ok: true };
  });

  app.delete('/api/locations/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const access = new AccessData(db);
    const node = access.byId.get(id);
    if (!node || !canView(actor, node, access.grants)) throw notFound();
    const parent = node.parent_id ? access.node(node.parent_id)! : null;
    assertCheck(canDeleteLocation(actor, access.node(id)!, parent, access.grants));

    const children = access.locations.filter((l) => l.parent_id === id);
    // A site whose only child is its empty, automatic building counts as empty.
    const removable =
      children.length === 0 ||
      (node.kind === 'site' &&
        children.length === 1 &&
        children[0]!.is_default_building === 1 &&
        !access.locations.some((l) => l.parent_id === children[0]!.id));
    if (!removable) throw conflict(`Remove everything inside ${node.name} first.`);
    const panels = db.prepare('SELECT COUNT(*) AS n FROM panels WHERE location_id = ?').get(id) as { n: number };
    if (panels.n > 0) throw conflict(`Delete or move the panels in ${node.name} first.`);

    audit(
      db,
      auth,
      {
        action: 'location.delete',
        entity: 'location',
        entityId: id,
        locationId: id,
        summary: `Deleted ${KIND_LABELS[node.kind].toLowerCase()} ${node.name}`,
        before: { name: node.name, kind: node.kind },
      },
      access,
    );
    db.transaction(() => {
      for (const c of children) db.prepare('DELETE FROM locations WHERE id = ?').run(c.id);
      db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    })();
    return { ok: true };
  });
}

function insertLocation(
  db: DB,
  parent: LocationRow | null,
  kind: LocationRow['kind'],
  name: string,
  notes: string,
  isDefaultBuilding = false,
): LocationRow {
  const t = now();
  const r = db
    .prepare(
      'INSERT INTO locations (parent_id, kind, name, notes, is_default_building, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(parent?.id ?? null, kind, name, notes, isDefaultBuilding ? 1 : 0, t, t);
  const id = Number(r.lastInsertRowid);
  db.prepare('UPDATE locations SET path = ? WHERE id = ?').run(makePath(parent?.path ?? null, id), id);
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as LocationRow;
}
