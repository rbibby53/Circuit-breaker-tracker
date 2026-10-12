// Group access: what everyone in a single sign-on group may do at a location. Admins only.

import {
  ROLE_LABELS,
  dedupeGroups,
  inGroup,
  ssoGroupMappingSchema,
  type SsoGroupMapping,
  type SsoGroupsResponse,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { requireAdmin, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, conflict, idParam, notFound, parse } from '../errors';
import { AccessData, allGroupGrants, ssoGroupsOf, type GroupGrantRow, type UserRow } from '../repo';

export function ssoGroupRoutes(app: FastifyInstance, db: DB): void {
  const knownGroups = () =>
    (db.prepare('SELECT sso_groups FROM users WHERE sso_groups IS NOT NULL').all() as UserRow[]).map(
      (u) => ssoGroupsOf(u) ?? [],
    );

  app.get('/api/admin/sso-groups', async (req): Promise<SsoGroupsResponse> => {
    requireAdmin(requireAuth(req));
    const access = new AccessData(db);
    const everyone = knownGroups();
    const mappings: SsoGroupMapping[] = allGroupGrants(db).map((m) => {
      const l = access.byId.get(m.location_id)!;
      return {
        id: m.id,
        group: m.group_name,
        locationId: l.id,
        locationName: l.name,
        locationKind: l.kind,
        locationPath: access.pathLabel(l.id),
        role: m.role,
        inviteLimit: m.invite_limit,
        members: everyone.filter((groups) => inGroup(groups, m.group_name)).length,
      };
    });
    const known = dedupeGroups(everyone.flat()).sort((a, b) => a.localeCompare(b));
    return { mappings, knownGroups: known };
  });

  app.post('/api/admin/sso-groups', async (req) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const body = parse(ssoGroupMappingSchema, req.body);
    if (body.role === 'manager' && !body.inviteLimit) throw badRequest('A manager grant needs an invite limit.');
    if (body.role !== 'manager' && body.inviteLimit) throw badRequest('Only manager grants carry an invite limit.');
    const access = new AccessData(db);
    if (!access.byId.has(body.locationId)) throw notFound('Location not found.');
    if (
      db
        .prepare('SELECT 1 FROM sso_group_grants WHERE group_name = ? AND location_id = ?')
        .get(body.group, body.locationId)
    ) {
      throw conflict(`The ${body.group} group already has access here. Remove it first to change it.`);
    }
    const r = db
      .prepare(
        'INSERT INTO sso_group_grants (group_name, location_id, role, invite_limit, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(body.group, body.locationId, body.role, body.inviteLimit, auth.user.id, now());
    audit(
      db,
      auth,
      {
        action: 'group.grant',
        entity: 'sso_group',
        entityId: Number(r.lastInsertRowid),
        locationId: body.locationId,
        summary: `Gave the ${body.group} group ${ROLE_LABELS[body.role]} access`,
        after: body,
      },
      access,
    );
    return { id: Number(r.lastInsertRowid) };
  });

  app.delete('/api/admin/sso-groups/:id', async (req) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const id = idParam((req.params as { id: string }).id);
    const m = db.prepare('SELECT * FROM sso_group_grants WHERE id = ?').get(id) as GroupGrantRow | undefined;
    if (!m) throw notFound();
    const access = new AccessData(db);
    db.prepare('DELETE FROM sso_group_grants WHERE id = ?').run(id);
    audit(
      db,
      auth,
      {
        action: 'group.revoke',
        entity: 'sso_group',
        entityId: id,
        locationId: m.location_id,
        summary: `Removed ${ROLE_LABELS[m.role]} access from the ${m.group_name} group`,
        before: { group: m.group_name, role: m.role, inviteLimit: m.invite_limit },
      },
      access,
    );
    return { ok: true };
  });
}
