// Response shapes shared by the server and the web app.
import type { LocationKind } from './locations';
import type { PaperSize, SettingKey, SettingValue } from './settings';
import type { Backup, MainType, PanelLayout, Protection, Slot } from './panel';
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
  version: string;
  appName: string;
  /** False when only admins may use passwords (everyone else signs in with SSO). */
  localLogin: boolean;
  panelDefaults: { spaces: number; mainAmps: number; voltage: string };
  /** Paper size the print dialog starts with. */
  paperSize: PaperSize;
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

// ---- Panels ---------------------------------------------------------------------------

export interface PanelSummary {
  id: number;
  locationId: number;
  name: string;
  layout: PanelLayout;
  spaces: number;
  mainAmps: number | null;
  mainType: MainType;
  voltage: string;
  /** Spaces with something in them. */
  usedSpaces: number;
  breakerCount: number;
  criticalCount: number;
  fedFrom: string | null;
  role: EffectiveRole;
}

export interface ServesDto {
  locationId: number;
  note: string;
  /** null when the viewer cannot see that location. */
  name: string | null;
  kind: LocationKind | null;
  path: string | null;
}

export interface BreakerDto {
  id: number;
  position: number;
  slot: Slot;
  poles: number;
  amps: number;
  protection: Protection;
  label: string;
  notes: string;
  isSpare: boolean;
  critical: boolean;
  backup: Backup;
  serves: ServesDto[];
  /** Panels this breaker feeds, when the viewer can see them. */
  feeds: { panelId: number; panelName: string }[];
  /** Sub-panels it feeds that the viewer cannot see. */
  hiddenFeeds: number;
}

/** One step up the feed chain: the breaker feeding a panel, and the panel it sits in. */
export interface FeedLink {
  panelId: number;
  panelName: string;
  locationPath: string;
  breakerId: number;
  circuit: string;
  label: string;
  amps: number;
  /** Whether the viewer may open that panel. They see this summary either way. */
  canView: boolean;
}

export interface PanelDetail extends Omit<PanelSummary, 'usedSpaces' | 'breakerCount' | 'criticalCount' | 'fedFrom'> {
  locationPath: string;
  manufacturer: string;
  model: string;
  notes: string;
  version: number;
  updatedAt: string;
  canEdit: boolean;
  breakers: BreakerDto[];
  /** From the breaker feeding this panel up to the service. Empty when fed by the utility. */
  feedChain: FeedLink[];
  fedFromBreakerId: number | null;
}

export interface SavePanelResponse {
  panel: PanelDetail;
  /** New breakers' ids, by the clientKey they were sent with. */
  idMap: Record<string, number>;
}

export interface FeedCandidate {
  breakerId: number;
  panelId: number;
  panelName: string;
  locationPath: string;
  circuit: string;
  label: string;
  amps: number;
}

export interface ServedByItem {
  breakerId: number;
  circuit: string;
  label: string;
  amps: number;
  poles: number;
  protection: Protection;
  critical: boolean;
  backup: Backup;
  isSpare: boolean;
  panelId: number;
  panelName: string;
  panelPath: string;
  canViewPanel: boolean;
  /** What the breaker is tagged with: this location, something inside it, or something above it. */
  via: string;
}

export interface PanelHistoryItem {
  id: number;
  at: string;
  user: string;
  actingAs: string | null;
  summary: string;
  details: string[];
}

export interface SearchResponse {
  locations: { id: number; name: string; kind: LocationKind; path: string }[];
  panels: { id: number; name: string; path: string }[];
  breakers: {
    breakerId: number;
    panelId: number;
    panelName: string;
    panelPath: string;
    canViewPanel: boolean;
    circuit: string;
    label: string;
    amps: number;
    critical: boolean;
    /** Why it matched when the label did not: the room or area it serves. */
    serves: string | null;
  }[];
}

export interface AdminSetting {
  key: SettingKey;
  /** Secrets come back as '' with `hasValue` telling whether one is saved. */
  value: SettingValue;
  hasValue: boolean;
  /** Where the current value comes from. `env` values cannot be changed in the UI. */
  source: 'env' | 'saved' | 'default';
}

export interface AdminSettingsResponse {
  settings: AdminSetting[];
  ssoEnabled: boolean;
  /** What to register as the redirect URI with the identity provider. */
  redirectUri: string | null;
  about: {
    version: string;
    nodeVersion: string;
    dataDir: string;
    databaseBytes: number;
    startedAt: string;
    counts: { users: number; locations: number; panels: number; breakers: number };
  };
}
