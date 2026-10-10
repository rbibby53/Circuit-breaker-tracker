import { describe, expect, it } from 'vitest';
import {
  canCreateChild,
  canDeleteLocation,
  canGrant,
  canManageGrant,
  canRenameLocation,
  canResetUser,
  canSeeUser,
  effectiveRole,
  grantCeiling,
  visibleLocations,
  type Actor,
  type GrantLike,
} from './access';
import { isWithin, makePath, type LocationKind, type LocationNode } from './locations';

// Personal(1) > Home(2), Apartment(3), Parents(4)
// KSU(10) > Campus(11) > Building A(12) > Basement(13) > Electrical room(14)
//                                      > Floor 2(15)
//                      > Building B(16)
const raw: [number, number | null, LocationKind][] = [
  [1, null, 'company'],
  [2, 1, 'site'],
  [3, 1, 'site'],
  [4, 1, 'site'],
  [10, null, 'company'],
  [11, 10, 'site'],
  [12, 11, 'building'],
  [13, 12, 'floor'],
  [14, 13, 'room'],
  [15, 12, 'floor'],
  [16, 11, 'building'],
];
const nodes = new Map<number, LocationNode>();
for (const [id, parentId, kind] of raw) {
  nodes.set(id, { id, parentId, kind, path: makePath(parentId ? nodes.get(parentId)!.path : null, id) });
}
const N = (id: number) => nodes.get(id)!;
const all = [...nodes.values()];

const admin: Actor = { id: 1, isAdmin: true };
const supervisor: Actor = { id: 2, isAdmin: false };
const coworker: Actor = { id: 3, isAdmin: false };
const roommate: Actor = { id: 4, isAdmin: false };
const parent: Actor = { id: 5, isAdmin: false };
const buildingMgr: Actor = { id: 6, isAdmin: false };
const contractor: Actor = { id: 7, isAdmin: false };

const grants: GrantLike[] = [
  { id: 1, userId: 2, locationId: 10, role: 'manager', inviteLimit: 'editor' },
  { id: 2, userId: 3, locationId: 11, role: 'viewer', inviteLimit: null },
  { id: 3, userId: 3, locationId: 15, role: 'editor', inviteLimit: null },
  { id: 4, userId: 4, locationId: 3, role: 'editor', inviteLimit: null },
  { id: 5, userId: 5, locationId: 4, role: 'viewer', inviteLimit: null },
  { id: 6, userId: 6, locationId: 12, role: 'manager', inviteLimit: 'viewer' },
  { id: 7, userId: 7, locationId: 14, role: 'viewer', inviteLimit: null },
];

describe('paths', () => {
  it('matches whole ids only', () => {
    expect(isWithin({ path: '/11/4/' }, 1)).toBe(false);
    expect(isWithin({ path: '/11/4/' }, 11)).toBe(true);
    expect(isWithin({ path: '/21/4/' }, 1)).toBe(false);
  });
});

describe('effectiveRole', () => {
  it('admins are admin everywhere', () => {
    expect(effectiveRole(admin, N(14), grants)).toBe('admin');
    expect(effectiveRole(admin, N(2), [])).toBe('admin');
  });

  it('grants flow down, never up or sideways', () => {
    expect(effectiveRole(supervisor, N(14), grants)).toBe('manager');
    expect(effectiveRole(supervisor, N(1), grants)).toBeNull();
    expect(effectiveRole(supervisor, N(2), grants)).toBeNull();
    expect(effectiveRole(parent, N(4), grants)).toBe('viewer');
    expect(effectiveRole(parent, N(3), grants)).toBeNull();
    expect(effectiveRole(contractor, N(13), grants)).toBeNull();
    expect(effectiveRole(contractor, N(14), grants)).toBe('viewer');
  });

  it('the strongest overlapping grant wins', () => {
    expect(effectiveRole(coworker, N(13), grants)).toBe('viewer');
    expect(effectiveRole(coworker, N(15), grants)).toBe('editor');
    expect(effectiveRole(coworker, N(16), grants)).toBe('viewer');
  });
});

describe('visibleLocations', () => {
  it('admins see everything', () => {
    expect(visibleLocations(admin, all, grants).size).toBe(all.length);
  });

  it('shows ancestors as breadcrumbs and hides siblings', () => {
    const v = visibleLocations(contractor, all, grants);
    expect([...v.keys()].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14]);
    expect(v.get(14)).toEqual({ access: 'full', role: 'viewer' });
    expect(v.get(12)).toEqual({ access: 'breadcrumb', role: null });
    expect(v.has(15)).toBe(false);
    expect(v.has(1)).toBe(false);
  });

  it('a supervisor on KSU never sees Personal', () => {
    const v = visibleLocations(supervisor, all, grants);
    for (const id of [1, 2, 3, 4]) expect(v.has(id)).toBe(false);
    for (const id of [10, 11, 12, 13, 14, 15, 16]) expect(v.get(id)?.access).toBe('full');
  });

  it('people with no grants see nothing', () => {
    expect(visibleLocations({ id: 99, isAdmin: false }, all, grants).size).toBe(0);
  });
});

describe('locations', () => {
  it('only admins create companies', () => {
    expect(canCreateChild(admin, null, grants).ok).toBe(true);
    expect(canCreateChild(supervisor, null, grants).ok).toBe(false);
  });

  it('editors add inside their scope, viewers cannot', () => {
    expect(canCreateChild(roommate, N(3), grants).ok).toBe(true);
    expect(canCreateChild(parent, N(4), grants).ok).toBe(false);
    expect(canCreateChild(roommate, N(4), grants).ok).toBe(false);
  });

  it('editors cannot rename or delete their own granted location, managers can rename it', () => {
    expect(canRenameLocation(roommate, N(3), N(1), grants).ok).toBe(false);
    expect(canDeleteLocation(roommate, N(3), N(1), grants).ok).toBe(false);
    expect(canRenameLocation(supervisor, N(10), null, grants).ok).toBe(true);
    expect(canDeleteLocation(supervisor, N(10), null, grants).ok).toBe(false);
    expect(canDeleteLocation(supervisor, N(16), N(11), grants).ok).toBe(true);
  });
});

describe('granting', () => {
  it('managers grant only inside their scope', () => {
    expect(canGrant(supervisor, N(15), { userId: 9, role: 'viewer', inviteLimit: null }, grants).ok).toBe(true);
    expect(canGrant(supervisor, N(10), { userId: 9, role: 'editor', inviteLimit: null }, grants).ok).toBe(true);
    const outside = canGrant(supervisor, N(2), { userId: 9, role: 'viewer', inviteLimit: null }, grants);
    expect(outside.ok).toBe(false);
  });

  it('managers cannot exceed their invite limit', () => {
    expect(canGrant(supervisor, N(11), { userId: 9, role: 'manager', inviteLimit: 'editor' }, grants).ok).toBe(false);
    expect(canGrant(buildingMgr, N(12), { userId: 9, role: 'editor', inviteLimit: null }, grants).ok).toBe(false);
    expect(canGrant(buildingMgr, N(12), { userId: 9, role: 'viewer', inviteLimit: null }, grants).ok).toBe(true);
  });

  it('a manager with an "up to managers" limit cannot give a higher limit than their own', () => {
    const g: GrantLike[] = [{ userId: 20, locationId: 10, role: 'manager', inviteLimit: 'manager' }];
    const m: Actor = { id: 20, isAdmin: false };
    expect(canGrant(m, N(11), { userId: 9, role: 'manager', inviteLimit: 'manager' }, g).ok).toBe(true);
    const limited: GrantLike[] = [{ userId: 21, locationId: 10, role: 'manager', inviteLimit: 'editor' }];
    expect(canGrant({ id: 21, isAdmin: false }, N(11), { userId: 9, role: 'manager', inviteLimit: 'viewer' }, limited).ok).toBe(false);
  });

  it('non-managers cannot grant at all', () => {
    expect(canGrant(coworker, N(15), { userId: 9, role: 'viewer', inviteLimit: null }, grants).ok).toBe(false);
    expect(grantCeiling(coworker, N(15), grants)).toBeNull();
  });

  it('nobody but an admin changes their own access', () => {
    expect(canGrant(supervisor, N(11), { userId: 2, role: 'viewer', inviteLimit: null }, grants).ok).toBe(false);
    expect(canManageGrant(supervisor, N(10), grants[0]!, grants).ok).toBe(false);
    expect(canManageGrant(admin, N(10), grants[0]!, grants).ok).toBe(true);
  });

  it('validates invite limits against the role', () => {
    expect(canGrant(admin, N(11), { userId: 9, role: 'manager', inviteLimit: null }, grants).ok).toBe(false);
    expect(canGrant(admin, N(11), { userId: 9, role: 'viewer', inviteLimit: 'viewer' }, grants).ok).toBe(false);
  });

  it('managers cannot touch grants stronger than they could give', () => {
    // buildingMgr (limit viewer) cannot remove coworker's editor grant on Floor 2.
    expect(canManageGrant(buildingMgr, N(15), grants[2]!, grants).ok).toBe(false);
    // ...but can manage the contractor's viewer grant in the electrical room.
    expect(canManageGrant(buildingMgr, N(14), grants[6]!, grants).ok).toBe(true);
    // supervisor (limit editor) cannot manage the building manager's grant.
    expect(canManageGrant(supervisor, N(12), grants[5]!, grants).ok).toBe(false);
  });
});

describe('users', () => {
  const targetGrants = (id: number) => grants.filter((g) => g.userId === id);

  it('managers only see people inside their scope', () => {
    expect(canSeeUser(supervisor, targetGrants(7), nodes, grants)).toBe(true);
    expect(canSeeUser(supervisor, targetGrants(5), nodes, grants)).toBe(false);
    expect(canSeeUser(admin, targetGrants(5), nodes, grants)).toBe(true);
  });

  it('managers can reset only people entirely inside what they manage', () => {
    expect(canResetUser(supervisor, contractor, targetGrants(7), nodes, grants).ok).toBe(true);
    expect(canResetUser(supervisor, roommate, targetGrants(4), nodes, grants).ok).toBe(false);
    // Someone with access in both KSU and Personal cannot be reset by the supervisor.
    const mixed: GrantLike[] = [
      ...grants,
      { userId: 30, locationId: 11, role: 'viewer', inviteLimit: null },
      { userId: 30, locationId: 2, role: 'viewer', inviteLimit: null },
    ];
    const t = { id: 30, isAdmin: false };
    expect(canResetUser(supervisor, t, mixed.filter((g) => g.userId === 30), nodes, mixed).ok).toBe(false);
    expect(canResetUser(supervisor, admin, [], nodes, grants).ok).toBe(false);
  });
});
