import {
  ROLE_LABELS,
  canGrant,
  canManageGrant,
  canResetUser,
  canSeeUser,
  canView,
  grantCeiling,
  grantInputSchema,
  inviteInputSchema,
  isWithin,
  managerScopes,
  pathIds,
  updateGrantSchema,
  updateUserSchema,
  type AccessResponse,
  type ActivityItem,
  type CreatedLink,
  type UserListItem,
} from '@cbt/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from '../audit';
import type { Config } from '../config';
import { actorOf, requireAdmin, requireAuth, requireRealAdmin } from '../context';
import { now, type DB } from '../db';
import { assertCheck, badRequest, conflict, forbidden, idParam, notFound, parse } from '../errors';
import { AccessData, getUser, toActor, toSummary, type GrantRow, type UserRow } from '../repo';
import { destroyUserSessions } from '../sessions';
import { daysFromNow, hoursFromNow, newToken } from '../tokens';
import { adminCount } from '../users';

function baseUrl(config: Config, req: FastifyRequest): string {
  return config.publicUrl ?? `${req.protocol}://${req.host}`;
}

export function accessRoutes(app: FastifyInstance, db: DB, config: Config): void {
  const usersById = () => new Map((db.prepare('SELECT * FROM users').all() as UserRow[]).map((u) => [u.id, u]));

  // ---- Who can see a location -------------------------------------------------------

  app.get('/api/locations/:id/access', async (req): Promise<AccessResponse> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const access = new AccessData(db);
    const node = access.node(id);
    if (!node || !canView(actor, node, access.grants)) throw notFound();
    const ceiling = grantCeiling(actor, node, access.grants);
    if (!ceiling) throw forbidden('Only managers can see who has access here.');

    const users = usersById();
    const chain = new Set(pathIds(node.path));
    const dto = (g: GrantRow) => {
      const gNode = access.node(g.location_id)!;
      return access.grantDto(
        g,
        users.get(g.user_id)!,
        canManageGrant(
          actor,
          gNode,
          {
            userId: g.user_id,
            locationId: g.location_id,
            role: g.role,
            inviteLimit: g.invite_limit,
          },
          access.grants,
        ).ok,
      );
    };
    const l = access.byId.get(id)!;
    return {
      location: { id, name: l.name, kind: l.kind, path: access.pathLabel(id) },
      applies: access.grantRows
        .filter((g) => chain.has(g.location_id))
        .map((g) => ({ ...dto(g), inherited: g.location_id !== id })),
      inside: access.grantRows
        .filter((g) => g.location_id !== id && isWithin(access.node(g.location_id)!, id))
        .map(dto),
      ceiling,
      admins: [...users.values()].filter((u) => u.is_admin && !u.disabled).map(toSummary),
    };
  });

  // ---- Grants -----------------------------------------------------------------------

  app.post('/api/locations/:id/grants', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const body = parse(grantInputSchema, req.body);
    const access = new AccessData(db);
    const node = access.node(id);
    if (!node || !canView(actor, node, access.grants)) throw notFound();
    const target = getUser(db, body.userId);
    // Managers may only pick people they can already see; everyone else is invited by link.
    if (
      !target ||
      target.disabled ||
      !canSeeUser(
        actor,
        access.grants.filter((g) => g.userId === target.id),
        access.nodes,
        access.grants,
      )
    ) {
      throw notFound('User not found. Send them an invite link instead.');
    }
    assertCheck(canGrant(actor, node, body, access.grants));
    if (access.grantRows.some((g) => g.user_id === target.id && g.location_id === id)) {
      throw conflict(`${target.display_name} already has access here. Edit that grant instead.`);
    }
    const r = db
      .prepare(
        'INSERT INTO grants (user_id, location_id, role, invite_limit, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(target.id, id, body.role, body.inviteLimit, auth.user.id, now());
    audit(
      db,
      auth,
      {
        action: 'grant.create',
        entity: 'grant',
        entityId: Number(r.lastInsertRowid),
        locationId: id,
        summary: `Gave ${target.display_name} ${ROLE_LABELS[body.role]} access`,
        after: body,
      },
      access,
    );
    return { id: Number(r.lastInsertRowid) };
  });

  const loadGrant = (actor: ReturnType<typeof actorOf>, access: AccessData, id: number) => {
    const g = access.grantRows.find((x) => x.id === id);
    const node = g ? access.node(g.location_id) : undefined;
    if (!g || !node || !canView(actor, node, access.grants)) throw notFound();
    return { g, node };
  };

  app.patch('/api/grants/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const { g, node } = loadGrant(actor, access, idParam((req.params as { id: string }).id));
    const body = parse(updateGrantSchema, req.body);
    const existing = { userId: g.user_id, locationId: g.location_id, role: g.role, inviteLimit: g.invite_limit };
    assertCheck(canManageGrant(actor, node, existing, access.grants));
    assertCheck(canGrant(actor, node, { userId: g.user_id, ...body }, access.grants));
    db.prepare('UPDATE grants SET role = ?, invite_limit = ? WHERE id = ?').run(body.role, body.inviteLimit, g.id);
    audit(
      db,
      auth,
      {
        action: 'grant.update',
        entity: 'grant',
        entityId: g.id,
        locationId: g.location_id,
        summary: `Changed ${getUser(db, g.user_id)?.display_name ?? 'someone'} to ${ROLE_LABELS[body.role]}`,
        before: { role: g.role, inviteLimit: g.invite_limit },
        after: body,
      },
      access,
    );
    return { ok: true };
  });

  app.delete('/api/grants/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const { g, node } = loadGrant(actor, access, idParam((req.params as { id: string }).id));
    assertCheck(
      canManageGrant(
        actor,
        node,
        { userId: g.user_id, locationId: g.location_id, role: g.role, inviteLimit: g.invite_limit },
        access.grants,
      ),
    );
    db.prepare('DELETE FROM grants WHERE id = ?').run(g.id);
    audit(
      db,
      auth,
      {
        action: 'grant.delete',
        entity: 'grant',
        entityId: g.id,
        locationId: g.location_id,
        summary: `Removed ${getUser(db, g.user_id)?.display_name ?? 'someone'}'s ${ROLE_LABELS[g.role]} access`,
        before: { userId: g.user_id, role: g.role, inviteLimit: g.invite_limit },
      },
      access,
    );
    return { ok: true };
  });

  // ---- Invites ----------------------------------------------------------------------

  app.post('/api/locations/:id/invites', async (req): Promise<CreatedLink> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const body = parse(inviteInputSchema, req.body);
    const access = new AccessData(db);
    const node = access.node(id);
    if (!node || !canView(actor, node, access.grants)) throw notFound();
    assertCheck(canGrant(actor, node, { userId: -1, role: body.role, inviteLimit: body.inviteLimit }, access.grants));
    const { token, hash } = newToken();
    const expiresAt = daysFromNow(config.settings.get('inviteDays'));
    const r = db
      .prepare(
        'INSERT INTO invites (token_hash, location_id, role, invite_limit, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(hash, id, body.role, body.inviteLimit, body.note ?? null, auth.user.id, now(), expiresAt);
    audit(
      db,
      auth,
      {
        action: 'invite.create',
        entity: 'invite',
        entityId: Number(r.lastInsertRowid),
        locationId: id,
        summary: `Created a ${ROLE_LABELS[body.role]} invite${body.note ? ` for ${body.note}` : ''}`,
        after: body,
      },
      access,
    );
    return { url: `${baseUrl(config, req)}/invite/${token}`, expiresAt };
  });

  app.get('/api/locations/:id/invites', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const access = new AccessData(db);
    const node = access.node(id);
    if (!node || !canView(actor, node, access.grants) || !grantCeiling(actor, node, access.grants)) throw notFound();
    const rows = db
      .prepare(
        `SELECT i.id, i.role, i.invite_limit, i.note, i.created_at, i.expires_at, u.display_name AS created_by_name
         FROM invites i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.location_id = ? AND i.used_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`,
      )
      .all(id, now()) as {
      id: number;
      role: string;
      invite_limit: string | null;
      note: string | null;
      created_at: string;
      expires_at: string;
      created_by_name: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      inviteLimit: r.invite_limit,
      note: r.note,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      createdBy: r.created_by_name,
    }));
  });

  app.delete('/api/invites/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const inv = db.prepare('SELECT * FROM invites WHERE id = ? AND used_at IS NULL').get(id) as
      | {
          id: number;
          location_id: number;
          role: 'viewer' | 'editor' | 'manager';
          invite_limit: 'viewer' | 'editor' | 'manager' | null;
        }
      | undefined;
    const access = new AccessData(db);
    const node = inv ? access.node(inv.location_id) : undefined;
    if (!inv || !node || !canView(actor, node, access.grants)) throw notFound();
    assertCheck(
      canManageGrant(
        actor,
        node,
        { userId: -1, locationId: inv.location_id, role: inv.role, inviteLimit: inv.invite_limit },
        access.grants,
      ),
    );
    db.prepare('DELETE FROM invites WHERE id = ?').run(id);
    audit(
      db,
      auth,
      {
        action: 'invite.revoke',
        entity: 'invite',
        entityId: id,
        locationId: inv.location_id,
        summary: 'Revoked an invite',
      },
      access,
    );
    return { ok: true };
  });

  // ---- Users ------------------------------------------------------------------------

  app.get('/api/users', async (req): Promise<UserListItem[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    if (!actor.isAdmin && managerScopes(actor, access.grants).length === 0)
      throw forbidden('Only managers can list people.');
    const users = [...usersById().values()];
    const identities = db.prepare('SELECT user_id, provider FROM user_identities').all() as {
      user_id: number;
      provider: string;
    }[];
    const out: UserListItem[] = [];
    for (const u of users) {
      const theirs = access.grantRows.filter((g) => g.user_id === u.id);
      const theirLike = access.grants.filter((g) => g.userId === u.id);
      if (!actor.isAdmin && !canSeeUser(actor, theirLike, access.nodes, access.grants)) continue;
      // Managers only see the grants inside their own scope.
      const shown = theirs.filter(
        (g) => actor.isAdmin || grantCeiling(actor, access.node(g.location_id)!, access.grants),
      );
      out.push({
        ...toSummary(u),
        disabled: !!u.disabled,
        lastSeenAt: u.last_seen_at,
        hasPassword: !!u.password_hash,
        totp: !!u.totp_enabled_at,
        identities: identities.filter((i) => i.user_id === u.id).map((i) => i.provider),
        grants: shown.map((g) =>
          access.grantDto(
            g,
            u,
            canManageGrant(
              actor,
              access.node(g.location_id)!,
              { userId: g.user_id, locationId: g.location_id, role: g.role, inviteLimit: g.invite_limit },
              access.grants,
            ).ok,
          ),
        ),
        canReset: canResetUser(actor, toActor(u), theirLike, access.nodes, access.grants).ok,
      });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  app.patch('/api/users/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const body = parse(updateUserSchema, req.body);
    const user = getUser(db, id);
    if (!user) throw notFound();
    // Admin rights and disabling are for admins. A name or email (for their picture) can also
    // be set by managers who could send this person a reset link.
    if (body.isAdmin !== undefined || body.disabled !== undefined) requireAdmin(auth);
    else if (!actor.isAdmin) {
      const access = new AccessData(db);
      const theirs = access.grants.filter((g) => g.userId === id);
      if (!canSeeUser(actor, theirs, access.nodes, access.grants)) throw notFound();
      assertCheck(canResetUser(actor, toActor(user), theirs, access.nodes, access.grants));
    }
    if (id === auth.user.id && (body.isAdmin === false || body.disabled === true)) {
      throw badRequest('You cannot remove your own admin rights or disable yourself.');
    }
    if (user.is_admin && (body.isAdmin === false || body.disabled === true) && adminCount(db) <= 1) {
      throw badRequest('There must always be at least one active admin.');
    }
    if (body.email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(body.email, id)) {
      throw conflict('That email is already used by another account.');
    }
    const next = {
      displayName: body.displayName ?? user.display_name,
      email: body.email === undefined ? user.email : body.email || null,
      isAdmin: body.isAdmin ?? !!user.is_admin,
      disabled: body.disabled ?? !!user.disabled,
    };
    db.prepare('UPDATE users SET display_name = ?, email = ?, is_admin = ?, disabled = ? WHERE id = ?').run(
      next.displayName,
      next.email,
      next.isAdmin ? 1 : 0,
      next.disabled ? 1 : 0,
      id,
    );
    if (next.disabled) destroyUserSessions(db, id);
    audit(db, auth, {
      action: 'user.update',
      entity: 'user',
      entityId: id,
      summary: `Updated ${next.displayName}`,
      before: {
        displayName: user.display_name,
        email: user.email,
        isAdmin: !!user.is_admin,
        disabled: !!user.disabled,
      },
      after: next,
    });
    return { ok: true };
  });

  app.delete('/api/users/:id', async (req) => {
    const auth = requireAuth(req);
    requireAdmin(auth);
    const id = idParam((req.params as { id: string }).id);
    const user = getUser(db, id);
    if (!user) throw notFound();
    if (id === auth.user.id) throw badRequest('You cannot delete yourself.');
    if (user.is_admin && adminCount(db) <= 1) throw badRequest('There must always be at least one active admin.');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(db, auth, {
      action: 'user.delete',
      entity: 'user',
      entityId: id,
      summary: `Deleted ${user.display_name}`,
      before: toSummary(user),
    });
    return { ok: true };
  });

  app.delete('/api/users/:id/identities/:provider', async (req) => {
    const auth = requireAuth(req);
    const id = idParam((req.params as { id: string }).id);
    if (id !== auth.realUser.id || auth.readOnly) requireAdmin(auth);
    const user = getUser(db, id);
    if (!user) throw notFound();
    const identities = db.prepare('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?').get(id) as {
      n: number;
    };
    if (!user.password_hash && identities.n <= 1)
      throw badRequest('Set a password first, or the account cannot sign in.');
    db.prepare('DELETE FROM user_identities WHERE user_id = ? AND provider = ?').run(
      id,
      (req.params as { provider: string }).provider,
    );
    audit(db, auth, {
      action: 'user.unlink',
      entity: 'user',
      entityId: id,
      summary: `Unlinked single sign-on from ${user.display_name}`,
    });
    return { ok: true };
  });

  app.post('/api/users/:id/reset-link', async (req): Promise<CreatedLink> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const access = new AccessData(db);
    const user = getUser(db, id);
    if (!user) throw notFound();
    const theirs = access.grants.filter((g) => g.userId === id);
    if (!actor.isAdmin && !canSeeUser(actor, theirs, access.nodes, access.grants)) throw notFound();
    assertCheck(canResetUser(actor, toActor(user), theirs, access.nodes, access.grants));
    const { token, hash } = newToken();
    const expiresAt = hoursFromNow(config.settings.get('resetHours'));
    db.prepare(
      'INSERT INTO reset_tokens (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(hash, id, auth.user.id, now(), expiresAt);
    audit(db, auth, {
      action: 'user.reset_link',
      entity: 'user',
      entityId: id,
      summary: `Created a password reset link for ${user.display_name}`,
    });
    return { url: `${baseUrl(config, req)}/reset/${token}`, expiresAt };
  });

  // ---- View as ----------------------------------------------------------------------

  app.post('/api/admin/view-as/:id', async (req) => {
    const auth = requireAuth(req);
    requireRealAdmin(auth);
    const id = idParam((req.params as { id: string }).id);
    const target = getUser(db, id);
    if (!target) throw notFound();
    if (id === auth.realUser.id) throw badRequest('You are already yourself.');
    db.prepare('UPDATE sessions SET acting_as_user_id = ? WHERE id = ?').run(id, auth.sessionId);
    audit(
      db,
      { ...auth, user: auth.realUser, readOnly: false },
      {
        action: 'view_as.start',
        entity: 'user',
        entityId: id,
        summary: `Started viewing as ${target.display_name}`,
      },
    );
    return { ok: true };
  });

  app.delete('/api/admin/view-as', async (req) => {
    const auth = requireAuth(req);
    requireRealAdmin(auth);
    db.prepare('UPDATE sessions SET acting_as_user_id = NULL WHERE id = ?').run(auth.sessionId);
    if (auth.readOnly) {
      audit(
        db,
        { ...auth, user: auth.realUser, readOnly: false },
        {
          action: 'view_as.stop',
          entity: 'user',
          entityId: auth.user.id,
          summary: `Stopped viewing as ${auth.user.display_name}`,
        },
      );
    }
    return { ok: true };
  });

  // ---- Activity ---------------------------------------------------------------------

  app.get('/api/activity', async (req): Promise<ActivityItem[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const q = req.query as { locationId?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
    const access = new AccessData(db);

    const where: string[] = [];
    const params: unknown[] = [];
    if (q.locationId) {
      const id = idParam(q.locationId);
      const node = access.node(id);
      if (!node || !canView(actor, node, access.grants)) throw notFound();
      where.push('location_path LIKE ?');
      params.push(`%/${id}/%`);
    }
    if (!actor.isAdmin) {
      const scopes = managerScopes(actor, access.grants);
      if (scopes.length === 0) throw forbidden('Only managers can see activity.');
      where.push(`(${scopes.map(() => 'location_path LIKE ?').join(' OR ')})`);
      params.push(...scopes.map((s) => `%/${s.locationId}/%`));
    }
    const rows = db
      .prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit) as {
      id: number;
      at: string;
      user_name: string | null;
      acting_as_name: string | null;
      action: string;
      entity: string;
      entity_id: number | null;
      location_label: string | null;
      summary: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      user: r.user_name ?? 'System',
      actingAs: r.acting_as_name,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      locationPath: r.location_label,
      summary: r.summary,
    }));
  });
}
