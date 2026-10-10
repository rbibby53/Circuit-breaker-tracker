// Response shapes shared by the server and the web app.
import type { LocationKind } from './locations';
import type { EffectiveRole, Role } from './roles';
import type { TreeAccess } from './access';

export interface UserSummary {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
}

export interface MeResponse {
  /** The user whose permissions apply (the viewed user while viewing as someone). */
  user: UserSummary;
  /** The signed-in user. Differs from `user` only while viewing as someone else. */
  realUser: UserSummary;
  viewingAs: boolean;
  hasPassword: boolean;
  identities: { provider: string; email: string | null }[];
}

export interface AuthConfig {
  needsSetup: boolean;
  oidc: { enabled: boolean; label: string };
}

export interface LocationDto {
  id: number;
  parentId: number | null;
  kind: LocationKind;
  name: string;
  notes: string;
  sortOrder: number;
  isDefaultBuilding: boolean;
  access: TreeAccess;
  /** The viewer's role here, or null for breadcrumb-only locations. */
  role: EffectiveRole | null;
}

export interface GrantDto {
  id: number;
  user: UserSummary;
  locationId: number;
  locationName: string;
  locationKind: LocationKind;
  locationPath: string;
  role: Role;
  inviteLimit: Role | null;
  createdAt: string;
  /** Whether the viewer may edit or remove this grant. */
  canManage: boolean;
}

export interface AccessResponse {
  location: { id: number; name: string; kind: LocationKind; path: string };
  /** Grants on this location or above it. */
  applies: (GrantDto & { inherited: boolean })[];
  /** Grants on locations inside this one. */
  inside: GrantDto[];
  /** Strongest role the viewer may hand out here, `admin` meaning unlimited. */
  ceiling: EffectiveRole | null;
  admins: UserSummary[];
}

export interface UserListItem extends UserSummary {
  disabled: boolean;
  lastSeenAt: string | null;
  hasPassword: boolean;
  identities: string[];
  grants: GrantDto[];
  canReset: boolean;
}

export interface InviteInfo {
  locationPath: string;
  locationKind: LocationKind;
  role: Role;
  inviteLimit: Role | null;
  expiresAt: string;
  invitedBy: string;
}

export interface CreatedLink {
  url: string;
  expiresAt: string;
}

export interface ActivityItem {
  id: number;
  at: string;
  user: string;
  actingAs: string | null;
  action: string;
  entity: string;
  entityId: number | null;
  locationPath: string | null;
  summary: string;
}
