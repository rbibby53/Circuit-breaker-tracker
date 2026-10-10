import { pathIds, type LocationNode } from './locations';
import { atLeast, roleRank, strongest, type EffectiveRole, type Role } from './roles';

export interface Actor {
  id: number;
  isAdmin: boolean;
}

export interface GrantLike {
  id?: number;
  userId: number;
  locationId: number;
  role: Role;
  /** Only meaningful on manager grants: the strongest role this manager may hand out. */
  inviteLimit: Role | null;
}

export type Check = { ok: true } | { ok: false; reason: string };

const OK: Check = { ok: true };
const no = (reason: string): Check => ({ ok: false, reason });

function grantsOf(actor: Actor, grants: readonly GrantLike[]): GrantLike[] {
  return grants.filter((g) => g.userId === actor.id);
}

/**
 * The actor's role at a location: the strongest of their grants on that location or any
 * location above it. Admins are `admin` everywhere. `null` means no access.
 */
export function effectiveRole(
  actor: Actor,
  node: Pick<LocationNode, 'path'>,
  grants: readonly GrantLike[],
): EffectiveRole | null {
  if (actor.isAdmin) return 'admin';
  const chain = new Set(pathIds(node.path));
  return strongest(grantsOf(actor, grants).filter((g) => chain.has(g.locationId)).map((g) => g.role));
}

export type TreeAccess = 'full' | 'breadcrumb';

/**
 * Which locations the actor may see. `full` locations sit at or inside one of their grants;
 * `breadcrumb` locations are the ancestors of a grant, shown by name only so the path makes
 * sense. Anything else is hidden.
 */
export function visibleLocations(
  actor: Actor,
  locations: readonly LocationNode[],
  grants: readonly GrantLike[],
): Map<number, { access: TreeAccess; role: EffectiveRole | null }> {
  const out = new Map<number, { access: TreeAccess; role: EffectiveRole | null }>();
  if (actor.isAdmin) {
    for (const l of locations) out.set(l.id, { access: 'full', role: 'admin' });
    return out;
  }
  const mine = grantsOf(actor, grants);
  if (mine.length === 0) return out;
  const byId = new Map(locations.map((l) => [l.id, l]));
  const breadcrumb = new Set<number>();
  for (const g of mine) {
    const node = byId.get(g.locationId);
    if (!node) continue;
    for (const id of pathIds(node.path)) if (id !== g.locationId) breadcrumb.add(id);
  }
  for (const l of locations) {
    const role = effectiveRole(actor, l, mine);
    if (role) out.set(l.id, { access: 'full', role });
    else if (breadcrumb.has(l.id)) out.set(l.id, { access: 'breadcrumb', role: null });
  }
  return out;
}

export function canView(actor: Actor, node: Pick<LocationNode, 'path'>, grants: readonly GrantLike[]): boolean {
  return effectiveRole(actor, node, grants) !== null;
}

/** Creating something directly inside `parent` (or a company, when parent is null). */
export function canCreateChild(actor: Actor, parent: LocationNode | null, grants: readonly GrantLike[]): Check {
  if (actor.isAdmin) return OK;
  if (!parent) return no('Only an admin can create a company.');
  return atLeast(effectiveRole(actor, parent, grants), 'editor')
    ? OK
    : no('You need Editor access here to add locations.');
}

/**
 * Renaming a location: allowed when it sits strictly inside the actor's editable scope, or
 * when the actor manages the location itself.
 */
export function canRenameLocation(
  actor: Actor,
  node: LocationNode,
  parent: LocationNode | null,
  grants: readonly GrantLike[],
): Check {
  if (actor.isAdmin) return OK;
  if (parent && atLeast(effectiveRole(actor, parent, grants), 'editor')) return OK;
  if (atLeast(effectiveRole(actor, node, grants), 'manager')) return OK;
  return no('You can only rename locations inside your scope, or ones you manage.');
}

/** Deleting a location: it must sit strictly inside the actor's editable scope. */
export function canDeleteLocation(
  actor: Actor,
  node: LocationNode,
  parent: LocationNode | null,
  grants: readonly GrantLike[],
): Check {
  if (actor.isAdmin) return OK;
  if (!parent) return no('Only an admin can delete a company.');
  return atLeast(effectiveRole(actor, parent, grants), 'editor')
    ? OK
    : no('You can only delete locations inside your scope.');
}

/**
 * The strongest role the actor may hand out at `node`: the best invite limit across their
 * manager grants that cover it. Admins may hand out anything (`admin` means unlimited).
 */
export function grantCeiling(
  actor: Actor,
  node: Pick<LocationNode, 'path'>,
  grants: readonly GrantLike[],
): EffectiveRole | null {
  if (actor.isAdmin) return 'admin';
  const chain = new Set(pathIds(node.path));
  return strongest(
    grantsOf(actor, grants)
      .filter((g) => g.role === 'manager' && chain.has(g.locationId))
      .map((g) => g.inviteLimit ?? 'viewer'),
  );
}

export interface GrantRequest {
  userId: number;
  role: Role;
  inviteLimit: Role | null;
}

/** May the actor create (or change a grant into) `req` at `node`? */
export function canGrant(
  actor: Actor,
  node: Pick<LocationNode, 'path'>,
  req: GrantRequest,
  grants: readonly GrantLike[],
): Check {
  if (req.role === 'manager' && !req.inviteLimit) return no('A manager grant needs an invite limit.');
  if (req.role !== 'manager' && req.inviteLimit) return no('Only manager grants carry an invite limit.');
  if (!actor.isAdmin && req.userId === actor.id) return no('You cannot change your own access.');
  const ceiling = grantCeiling(actor, node, grants);
  if (!ceiling) return no('You can only grant access inside locations you manage.');
  if (roleRank(req.role) > roleRank(ceiling)) return no(`You can grant at most ${ceiling} here.`);
  if (req.inviteLimit && roleRank(req.inviteLimit) > roleRank(ceiling)) {
    return no('The invite limit cannot be higher than your own.');
  }
  return OK;
}

/** May the actor edit or remove an existing grant? */
export function canManageGrant(
  actor: Actor,
  node: Pick<LocationNode, 'path'>,
  existing: GrantLike,
  grants: readonly GrantLike[],
): Check {
  if (actor.isAdmin) return OK;
  if (existing.userId === actor.id) return no('You cannot change your own access.');
  const ceiling = grantCeiling(actor, node, grants);
  if (!ceiling) return no('This grant is outside the locations you manage.');
  if (roleRank(existing.role) > roleRank(ceiling)) return no('This grant is stronger than you can manage.');
  if (existing.inviteLimit && roleRank(existing.inviteLimit) > roleRank(ceiling)) {
    return no('This grant is stronger than you can manage.');
  }
  return OK;
}

/** Locations where the actor holds a manager grant (their management scopes). */
export function managerScopes(actor: Actor, grants: readonly GrantLike[]): GrantLike[] {
  return grantsOf(actor, grants).filter((g) => g.role === 'manager');
}

/** True when `node` sits inside one of the actor's manager scopes (or the actor is admin). */
export function managesLocation(actor: Actor, node: Pick<LocationNode, 'path'>, grants: readonly GrantLike[]): boolean {
  return grantCeiling(actor, node, grants) !== null;
}

/**
 * May the actor see another user in user lists? Admins see everyone; managers see people
 * holding at least one grant inside their scope.
 */
export function canSeeUser(
  actor: Actor,
  targetGrants: readonly GrantLike[],
  nodes: ReadonlyMap<number, LocationNode>,
  grants: readonly GrantLike[],
): boolean {
  if (actor.isAdmin) return true;
  return targetGrants.some((g) => {
    const n = nodes.get(g.locationId);
    return n ? managesLocation(actor, n, grants) : false;
  });
}

/**
 * May the actor issue a password-reset link for `target`? A manager may only do so when
 * every one of the target's grants is inside their scope and within their invite limit;
 * otherwise a manager could take over an account that reaches places they cannot see.
 */
export function canResetUser(
  actor: Actor,
  target: Actor,
  targetGrants: readonly GrantLike[],
  nodes: ReadonlyMap<number, LocationNode>,
  grants: readonly GrantLike[],
): Check {
  if (actor.isAdmin) return OK;
  if (target.isAdmin) return no('Only an admin can reset an admin.');
  if (target.id === actor.id) return no('Use change password for your own account.');
  if (targetGrants.length === 0) return no('This person has no access you manage.');
  for (const g of targetGrants) {
    const n = nodes.get(g.locationId);
    if (!n) return no('This person has access outside the locations you manage.');
    const check = canManageGrant(actor, n, g, grants);
    if (!check.ok) return no('This person has access outside what you manage.');
  }
  return OK;
}

