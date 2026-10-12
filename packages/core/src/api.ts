// Response shapes shared by the server and the web app.
import type { LocationKind } from './locations';
import type { PaperSize, SettingKey, SettingValue } from './settings';
import type { Backup, Device, MainType, PanelLayout, Protection, Slot } from './panel';
import type { EffectiveRole, Role } from './roles';
import type { TreeAccess } from './access';
import type { Fuel } from './generator';

export interface UserSummary {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  /** Gravatar picture for their email; the page shows initials when there is none. */
  avatarUrl: string | null;
}

export interface MeResponse {
  /** The user whose permissions apply (the viewed user while viewing as someone). */
  user: UserSummary;
  /** The signed-in user. Differs from `user` only while viewing as someone else. */
  realUser: UserSummary;
  viewingAs: boolean;
  hasPassword: boolean;
  identities: { provider: string; email: string | null }[];
  /** Two-step sign-in with an authenticator app is on for password sign-in. */
  totp: boolean;
  /** Unused recovery codes left, when two-step sign-in is on. */
  recoveryCodesLeft: number;
}

/** Sign-in answer: done, or the password was right and a code is needed next. */
export type LoginResponse = { ok: true } | { totpRequired: true; challenge: string };

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  /** SVG markup of a QR code for the authenticator app. */
  qrSvg: string;
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
  /** Whether panels may have public pages opened from their QR codes. */
  publicPanels: boolean;
  /** Whether to load Gravatar pictures. */
  gravatar: boolean;
  /** Single sign-on: the button text and the provider's name ("Microsoft", "Authentik"…). */
  oidc: { enabled: boolean; label: string; provider: string };
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
  /** Set when the access comes from this single sign-on group; such grants cannot be edited here. */
  group: string | null;
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
  totp: boolean;
  grants: GrantDto[];
  canReset: boolean;
  /** Groups from their last single sign-on, or null if they never signed in that way. */
  ssoGroups: string[] | null;
  ssoGroupsAt: string | null;
  /** Admin because of an admin group (changes with their groups at each sign-in). */
  adminFromGroups: boolean;
}

/** Access given to everyone in a single sign-on group. */
export interface SsoGroupMapping {
  id: number;
  group: string;
  locationId: number;
  locationName: string;
  locationKind: LocationKind;
  locationPath: string;
  role: Role;
  inviteLimit: Role | null;
  /** People whose last sign-in put them in this group. */
  members: number;
}

export interface SsoGroupsResponse {
  mappings: SsoGroupMapping[];
  /** Every group seen at someone's sign-in, for suggestions. */
  knownGroups: string[];
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
  /** Set when the location still exists and the reader can open it. */
  locationId: number | null;
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
  /** The generator backing it, directly or through the panel feeding it. */
  generatorName: string | null;
  /** Relay panels: the lighting control system, e.g. nLight. */
  controlSystem: string;
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
  device: Device;
  protection: Protection;
  label: string;
  notes: string;
  isSpare: boolean;
  critical: boolean;
  backup: Backup;
  serves: ServesDto[];
  tags: string[];
  /** Panels this breaker feeds, when the viewer can see them. */
  feeds: { panelId: number; panelName: string }[];
  /** Sub-panels it feeds that the viewer cannot see. */
  hiddenFeeds: number;
  /** Relays: the breaker whose circuit this relay switches. */
  sourceBreakerId: number | null;
  source: RelaySource | null;
  /** Relays: what controls it, e.g. an nLight zone or schedule. */
  control: string;
  /** Breakers: relays that switch this circuit, when the viewer can see their panels. */
  switchedBy: { panelId: number; panelName: string; relay: string; label: string; control: string }[];
  /** Relays switching this circuit in panels the viewer cannot see. */
  hiddenSwitchedBy: number;
}

/** The breaker feeding a relay. Everyone who can see the relay sees this summary. */
export interface RelaySource {
  breakerId: number;
  panelId: number;
  panelName: string;
  circuit: string;
  label: string;
  amps: number;
  canView: boolean;
}

/** The generator backing a panel: set on it, or on a panel up its feed chain (`via`). */
export interface PanelGenerator {
  id: number;
  name: string;
  kw: number | null;
  fuel: Fuel;
  transferSwitch: string;
  via: { panelId: number; panelName: string } | null;
  canView: boolean;
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

export interface PanelDetail extends Omit<
  PanelSummary,
  'usedSpaces' | 'breakerCount' | 'criticalCount' | 'fedFrom' | 'generatorName'
> {
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
  /** Path of the public page ("/p/…") when the panel has one and public pages are allowed. */
  publicPath: string | null;
  /** Whether the viewer may turn the public page on or off (Manager or admin). */
  canShare: boolean;
  generatorId: number | null;
  transferSwitch: string;
  generator: PanelGenerator | null;
}

// ---- Generators -------------------------------------------------------------------------

export interface GeneratorSummary {
  id: number;
  locationId: number;
  locationPath: string;
  name: string;
  kw: number | null;
  fuel: Fuel;
  voltage: string;
  /** Panels it backs up, directly or through the panels it feeds. */
  panelCount: number;
  role: EffectiveRole;
}

export interface GeneratorPanel {
  id: number;
  name: string;
  locationPath: string;
  transferSwitch: string;
  /** Set when the panel is backed up through another panel on the generator. */
  via: string | null;
}

export interface GeneratorDetail extends GeneratorSummary {
  manufacturer: string;
  model: string;
  notes: string;
  updatedAt: string;
  canEdit: boolean;
  /** Panels on it that the viewer can see. */
  panels: GeneratorPanel[];
  hiddenPanels: number;
}

/** What anyone with a panel's public link sees: the directory, read-only, nothing else. */
export interface PublicPanel {
  id: number;
  name: string;
  locationPath: string;
  layout: PanelLayout;
  spaces: number;
  mainAmps: number | null;
  mainType: MainType;
  voltage: string;
  notes: string;
  updatedAt: string;
  fedFrom: { panelName: string; circuit: string } | null;
  breakers: {
    position: number;
    slot: Slot;
    poles: number;
    amps: number;
    device: Device;
    protection: Protection;
    label: string;
    notes: string;
    isSpare: boolean;
    critical: boolean;
    backup: Backup;
    /** Names of the rooms and areas it serves. */
    serves: string[];
    tags: string[];
  }[];
}

/** Tags in use on breakers the person can see, most used first. */
export interface TagCount {
  tag: string;
  count: number;
}

/** Suggested when nobody has used any tags yet. */
export const SUGGESTED_TAGS = [
  'Lights',
  'Outlets',
  'Appliances',
  'Kitchen',
  'HVAC',
  'Water heater',
  'Servers',
  'Network',
  'Security',
  'Outdoor',
  'EV charger',
  'Sub-panel',
];

export interface SavePanelResponse {
  panel: PanelDetail;
  /** New breakers' ids, by the clientKey they were sent with. */
  idMap: Record<string, number>;
}

export interface DuplicatePanelResponse {
  id: number;
  /** Room tags copied across, and tags left off because the copy is in another site. */
  keptTags: number;
  droppedTags: number;
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
  device: Device;
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
  generators: { id: number; name: string; path: string }[];
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
    tags: string[];
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
  /** "Microsoft", "Authentik"… from the issuer. */
  ssoProvider: string;
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

export interface BackupSummary {
  schemaVersion: number;
  bytes: number;
  counts: { users: number; locations: number; panels: number; breakers: number };
  lastChange: string | null;
}

export interface RestoreUpload {
  id: string;
  summary: BackupSummary;
}

/** A database copy in the backups folder, made on schedule or by "Back up now". */
export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
}

export interface BackupList {
  /** Where the copies are kept, as the server sees it (inside the container). */
  dir: string;
  keep: number;
  hour: number;
  /** When the next automatic backup is due, if they are on. */
  nextAt: string | null;
  files: BackupFile[];
  /** The last automatic backup failed with this message. */
  lastError: string | null;
}

/** One place someone is signed in, for "Where you're signed in". */
export interface SessionInfo {
  id: number;
  /** The browser this list is being looked at in. */
  current: boolean;
  /** "Chrome on Windows", from the browser's user agent. */
  device: string;
  /** How the sign-in happened: "password", "Microsoft"… (unknown for older sessions). */
  method: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
}

/** The log viewer under Settings → Logging. */
export interface LogLines {
  /** The level the server logs at; lower levels are not kept either. */
  level: string;
  /** How many lines are kept in memory, at most. */
  capacity: number;
  lines: { time: string; level: 'debug' | 'info' | 'warn' | 'error'; text: string }[];
}
