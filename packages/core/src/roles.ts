export const ROLES = ['viewer', 'editor', 'manager'] as const;
export type Role = (typeof ROLES)[number];

/** A role on a location, or `admin` for users with the global admin flag. */
export type EffectiveRole = Role | 'admin';

const RANK: Record<EffectiveRole, number> = { viewer: 1, editor: 2, manager: 3, admin: 4 };

export function roleRank(role: EffectiveRole | null | undefined): number {
  return role ? RANK[role] : 0;
}

export function atLeast(role: EffectiveRole | null | undefined, min: EffectiveRole): boolean {
  return roleRank(role) >= RANK[min];
}

export function strongest<R extends EffectiveRole>(roles: Iterable<R | null | undefined>): R | null {
  let best: R | null = null;
  for (const r of roles) {
    if (r && roleRank(r) > roleRank(best)) best = r;
  }
  return best;
}

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  manager: 'Manager',
  admin: 'Admin',
};

export const INVITE_LIMIT_LABELS: Record<Role, string> = {
  viewer: 'Viewers only',
  editor: 'Viewers and editors',
  manager: 'Up to managers',
};
