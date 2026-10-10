import {
  KIND_LABELS,
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

export const toSummary = (u: UserRow): UserSummary => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  email: u.email,
  isAdmin: !!u.is_admin,
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

/** Everything the access rules need, loaded once per request. */
export class AccessData {
  readonly locations: LocationRow[];
  readonly byId: Map<number, LocationRow>;
  readonly nodes: Map<number, LocationNode>;
  readonly grantRows: GrantRow[];
  readonly grants: GrantLike[];

  constructor(db: DB) {
    this.locations = allLocations(db);
    this.byId = new Map(this.locations.map((l) => [l.id, l]));
    this.nodes = new Map(this.locations.map((l) => [l.id, toNode(l)]));
    this.grantRows = allGrants(db);
    this.grants = this.grantRows.map(toGrantLike);
  }

  node(id: number): LocationNode | undefined {
    return this.nodes.get(id);
  }

  /** "KSU › Campus › Building A" for a location. */
  pathLabel(id: number): string {
    const l = this.byId.get(id);
    if (!l) return '';
    return pathIds(l.path)
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
    };
  }

  describe(id: number): string {
    const l = this.byId.get(id);
    return l ? `${KIND_LABELS[l.kind].toLowerCase()} ${this.pathLabel(id)}` : 'unknown location';
  }
}
