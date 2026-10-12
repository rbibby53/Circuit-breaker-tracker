import { createHash } from 'node:crypto';
import {
  KIND_LABELS,
  inGroup,
  pathIds,
  type GrantDto,
  type GrantLike,
  type LocationKind,
  type LocationNode,
  type Role,
  type UserSummary,
} from '@cbt/core';
import type { DB } from './db';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  password_hash: string | null;
  is_admin: number;
  disabled: number;
  created_at: string;
  last_seen_at: string | null;
  /** Base32 secret; set during setup, active once totp_enabled_at is set. */
  totp_secret: string | null;
  totp_enabled_at: string | null;
  /** Last accepted time step, so a code cannot be used twice. */
  totp_last_step: number | null;
  /** JSON array of their groups at their last single sign-on; null if they never used it. */
  sso_groups: string | null;
  sso_groups_at: string | null;
  /** 1 when is_admin was set by an admin group, so leaving the group takes it away. */
  admin_from_sso: number;
}

/** Access for everyone in a single sign-on group. */
export interface GroupGrantRow {
  id: number;
  group_name: string;
  location_id: number;
  role: Role;
  invite_limit: Role | null;
  created_at: string;
}

/** A person's access through one of their groups, worked out from a GroupGrantRow. */
export interface GroupGrant extends GrantLike {
  id: number;
  group: string;
  mappingId: number;
}

/** Someone's groups from their last single sign-on, or null if they never used it. */
export function ssoGroupsOf(u: Pick<UserRow, 'sso_groups'>): string[] | null {
  if (u.sso_groups === null) return null;
  try {
    const v: unknown = JSON.parse(u.sso_groups);
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

export interface LocationRow {
  id: number;
  parent_id: number | null;
  kind: LocationKind;
  name: string;
  notes: string;
  sort_order: number;
  path: string;
  is_default_building: number;
}

export interface GrantRow {
  id: number;
  user_id: number;
  location_id: number;
  role: Role;
  invite_limit: Role | null;
  created_at: string;
}

/** Gravatar's address for an email: a SHA-256 of the trimmed, lower-case address. */
export function gravatarUrl(email: string | null): string | null {
  if (!email) return null;
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `https://gravatar.com/avatar/${hash}?s=96&d=404`;
}

export const toSummary = (u: UserRow): UserSummary => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  email: u.email,
  isAdmin: !!u.is_admin,
  avatarUrl: gravatarUrl(u.email),
});

export const toActor = (u: UserRow) => ({ id: u.id, isAdmin: !!u.is_admin });

export const toNode = (l: LocationRow): LocationNode => ({
  id: l.id,
  parentId: l.parent_id,
  kind: l.kind,
  path: l.path,
});

export const toGrantLike = (g: GrantRow): GrantLike => ({
  id: g.id,
  userId: g.user_id,
  locationId: g.location_id,
  role: g.role,
  inviteLimit: g.invite_limit,
});

export function getUser(db: DB, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function findUserByLogin(db: DB, login: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login) as UserRow | undefined;
}

export function countUsers(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function allLocations(db: DB): LocationRow[] {
  return db.prepare('SELECT * FROM locations ORDER BY sort_order, name COLLATE NOCASE').all() as LocationRow[];
}

export function getLocation(db: DB, id: number): LocationRow | undefined {
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as LocationRow | undefined;
}

export function allGrants(db: DB): GrantRow[] {
  return db.prepare('SELECT * FROM grants').all() as GrantRow[];
}

export function grantsForUser(db: DB, userId: number): GrantRow[] {
  return db.prepare('SELECT * FROM grants WHERE user_id = ?').all(userId) as GrantRow[];
}

export function allGroupGrants(db: DB): GroupGrantRow[] {
  return db.prepare('SELECT * FROM sso_group_grants ORDER BY group_name COLLATE NOCASE').all() as GroupGrantRow[];
}

/**
 * Everyone's access through their groups: one entry per person per group mapping they are in.
 * Ids are negative so they never clash with grant ids.
 */
export function groupGrantsFor(
  mappings: readonly GroupGrantRow[],
  members: readonly { id: number; groups: readonly string[] }[],
): GroupGrant[] {
  const out: GroupGrant[] = [];
  for (const m of mappings) {
    for (const u of members) {
      if (!inGroup(u.groups, m.group_name)) continue;
      out.push({
        id: -(m.id * 1_000_000 + u.id),
        userId: u.id,
        locationId: m.location_id,
        role: m.role,
        inviteLimit: m.invite_limit,
        group: m.group_name,
        mappingId: m.id,
      });
    }
  }
  return out;
}

/** Everything the access rules need, loaded once per request. */
export class AccessData {
  readonly locations: LocationRow[];
  readonly byId: Map<number, LocationRow>;
  readonly nodes: Map<number, LocationNode>;
  readonly grantRows: GrantRow[];
  /** Access people have through their single sign-on groups. */
  readonly groupGrants: GroupGrant[];
  /** Everything the access rules look at: grants and group access together. */
  readonly grants: GrantLike[];

  /** Automatic buildings of single-building sites: hidden in the UI and in path labels. */
  readonly hiddenBuildings: Set<number>;

  constructor(db: DB) {
    this.locations = allLocations(db);
    this.byId = new Map(this.locations.map((l) => [l.id, l]));
    this.nodes = new Map(this.locations.map((l) => [l.id, toNode(l)]));
    this.grantRows = allGrants(db);
    const mappings = allGroupGrants(db);
    const members = mappings.length
      ? (db.prepare('SELECT id, sso_groups FROM users WHERE sso_groups IS NOT NULL').all() as UserRow[]).map((u) => ({
          id: u.id,
          groups: ssoGroupsOf(u) ?? [],
        }))
      : [];
    this.groupGrants = groupGrantsFor(mappings, members);
    this.grants = [...this.grantRows.map(toGrantLike), ...this.groupGrants];
    const buildingsBySite = new Map<number, LocationRow[]>();
    for (const l of this.locations) {
      if (l.kind === 'building' && l.parent_id !== null) {
        buildingsBySite.set(l.parent_id, [...(buildingsBySite.get(l.parent_id) ?? []), l]);
      }
    }
    this.hiddenBuildings = new Set(
      [...buildingsBySite.values()].filter((b) => b.length === 1 && b[0]!.is_default_building).map((b) => b[0]!.id),
    );
  }

  node(id: number): LocationNode | undefined {
    return this.nodes.get(id);
  }

  /** "KSU › Campus › Building A" for a location. */
  pathLabel(id: number): string {
    const l = this.byId.get(id);
    if (!l) return '';
    return pathIds(l.path)
      .filter((pid) => pid === id || !this.hiddenBuildings.has(pid))
      .map((pid) => this.byId.get(pid)?.name ?? '?')
      .join(' › ');
  }

  grantDto(g: GrantRow, user: UserRow, canManage: boolean): GrantDto {
    const l = this.byId.get(g.location_id)!;
    return {
      id: g.id,
      user: toSummary(user),
      locationId: l.id,
      locationName: l.name,
      locationKind: l.kind,
      locationPath: this.pathLabel(l.id),
      role: g.role,
      inviteLimit: g.invite_limit,
      createdAt: g.created_at,
      canManage,
      group: null,
    };
  }

  /** Access through a group, shown beside grants. It is changed in the identity provider. */
  groupGrantDto(g: GroupGrant, user: UserRow): GrantDto {
    const l = this.byId.get(g.locationId)!;
    return {
      id: g.id,
      user: toSummary(user),
      locationId: l.id,
      locationName: l.name,
      locationKind: l.kind,
      locationPath: this.pathLabel(l.id),
      role: g.role,
      inviteLimit: g.inviteLimit,
      createdAt: user.sso_groups_at ?? user.created_at,
      canManage: false,
      group: g.group,
    };
  }

  describe(id: number): string {
    const l = this.byId.get(id);
    return l ? `${KIND_LABELS[l.kind].toLowerCase()} ${this.pathLabel(id)}` : 'unknown location';
  }
}
