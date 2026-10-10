import { canGrant, roleRank, type InviteInfo, type Role } from '@cbt/core';
import { audit } from './audit';
import { now, type DB } from './db';
import { gone, notFound } from './errors';
import { AccessData, getUser, toActor } from './repo';
import type { AuthState } from './sessions';
import { hashToken, isExpired } from './tokens';

export interface InviteRow {
  id: number;
  token_hash: string;
  location_id: number;
  role: Role;
  invite_limit: Role | null;
  note: string | null;
  created_by: number;
  created_at: string;
  expires_at: string;
  used_by: number | null;
  used_at: string | null;
}

/**
 * Look up an invite by its token and make sure it can still be used: not used, not
 * expired, and the person who created it still has the right to grant that access.
 */
export function usableInvite(db: DB, token: string): { invite: InviteRow; access: AccessData } {
  const invite = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hashToken(token)) as InviteRow | undefined;
  if (!invite) throw notFound('This invite link is not valid.');
  if (invite.used_at) throw gone('This invite link has already been used.');
  if (isExpired(invite.expires_at)) throw gone('This invite link has expired. Ask for a new one.');
  const access = new AccessData(db);
  const inviter = getUser(db, invite.created_by);
  const node = access.node(invite.location_id);
  const stillAllowed =
    inviter &&
    !inviter.disabled &&
    node &&
    canGrant(toActor(inviter), node, { userId: -1, role: invite.role, inviteLimit: invite.invite_limit }, access.grants).ok;
  if (!stillAllowed) throw gone('This invite is no longer valid. Ask for a new one.');
  return { invite, access };
}

export function inviteInfo(db: DB, invite: InviteRow, access: AccessData): InviteInfo {
  const inviter = getUser(db, invite.created_by);
  return {
    locationPath: access.pathLabel(invite.location_id),
    locationKind: access.byId.get(invite.location_id)!.kind,
    role: invite.role,
    inviteLimit: invite.invite_limit,
    expiresAt: invite.expires_at,
    invitedBy: inviter?.display_name ?? 'Someone',
  };
}

/** Give `userId` the invite's access (keeping any stronger grant they already hold) and use it up. */
export function applyInvite(db: DB, invite: InviteRow, access: AccessData, userId: number, auth: AuthState | null): void {
  db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM grants WHERE user_id = ? AND location_id = ?')
      .get(userId, invite.location_id) as { id: number; role: Role; invite_limit: Role | null } | undefined;
    if (!existing) {
      const r = db
        .prepare(
          'INSERT INTO grants (user_id, location_id, role, invite_limit, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(userId, invite.location_id, invite.role, invite.invite_limit, invite.created_by, now());
      audit(
        db,
        auth,
        {
          action: 'invite.accept',
          entity: 'grant',
          entityId: Number(r.lastInsertRowid),
          locationId: invite.location_id,
          summary: `${getUser(db, userId)?.display_name ?? 'Someone'} accepted an invite as ${invite.role}`,
          after: { userId, role: invite.role, inviteLimit: invite.invite_limit },
        },
        access,
      );
    } else if (
      roleRank(invite.role) > roleRank(existing.role) ||
      (invite.role === existing.role && roleRank(invite.invite_limit) > roleRank(existing.invite_limit))
    ) {
      db.prepare('UPDATE grants SET role = ?, invite_limit = ? WHERE id = ?').run(
        invite.role,
        invite.invite_limit,
        existing.id,
      );
      audit(
        db,
        auth,
        {
          action: 'invite.accept',
          entity: 'grant',
          entityId: existing.id,
          locationId: invite.location_id,
          summary: `Invite raised access to ${invite.role}`,
          before: { role: existing.role, inviteLimit: existing.invite_limit },
          after: { role: invite.role, inviteLimit: invite.invite_limit },
        },
        access,
      );
    }
    db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?').run(userId, now(), invite.id);
  })();
}
