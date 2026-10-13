// Response shapes shared by the server and the web app.
import type { LocationKind } from './locations';
import type { PaperSize, SettingKey, SettingValue } from './settings';
import type { Backup, Device, MainType, PanelLayout, PanelSection, Protection, Slot, VerifyStatus } from './panel';
import type { EffectiveRole, Role } from './roles';
import type { TreeAccess } from './access';
import type { AtsKind, Fuel } from './generator';
import type { AtsDuty, AtsTransition, Mounting, PowerDeviceKind, PowerDeviceShape } from './devices';

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
  /** Transformers, disconnects and UPSs it feeds, when the viewer can see them. */
  feedsDevices: { deviceId: number; name: string; kind: PowerDeviceKind }[];
  /** Equipment (AHU-1, EF-2…) on this circuit, directly or through a disconnect. */
  equipment: { id: number; tag: string; kind: string }[];
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
  /** Connected load (VA) and demand factor (%), when recorded. */
  loadVa: number | null;
  demandPct: number | null;
  /** Which section of the panel, from 1. */
  section: number;
  /** Switchboards and MCCs. */
  unit: string;
  frameAmps: number | null;
  wire: string;
  conduit: string;
  starter: string;
  hp: number | null;
  /** Field check: who checked it and when. */
  verifyStatus: VerifyStatus;
  verifiedBy: string;
  verifiedAt: string | null;
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
  /** The transfer switch's name, or '' when the panel is linked to the generator directly. */
  transferSwitch: string;
  ats: { id: number; name: string; kind: AtsKind; duty: AtsDuty } | null;
  via: { panelId: number; panelName: string } | null;
  canView: boolean;
}

/** One step up the feed chain: a breaker and the panel it sits in, or a device in between. */
export type FeedLink = PanelFeedLink | DeviceFeedLink;

export interface PanelFeedLink {
  kind: 'panel';
  panelId: number;
  panelName: string;
  locationPath: string;
  breakerId: number;
  circuit: string;
  label: string;
  amps: number;
  /** Whether the viewer may open that panel. They see this summary either way. */
  canView: boolean;
  /** The panel's voltage, to show the step through a transformer. */
  voltage: string;
}

/** A transformer, disconnect, UPS or utility service in the feed chain. */
export interface DeviceFeedLink {
  kind: 'device';
  deviceId: number;
  deviceKind: PowerDeviceKind;
  name: string;
  /** "75 kVA · 480 V → 208 V" and the like. */
  rating: string;
  /** The voltage it puts out (a transformer's secondary). */
  voltage: string;
  locationPath: string;
  canView: boolean;
}

/** Nameplate details from panel schedules. */
export interface PanelNameplate {
  /** Short-circuit (AIC/SCCR) rating, in kA. */
  aicKa: number | null;
  /** Bus rating, which may be above the main breaker's. */
  busAmps: number | null;
  mounting: Mounting;
  enclosure: string;
  feederWire: string;
  feederConduit: string;
}

/** One rating the load below a panel is checked against. */
export interface CapacityLimit {
  /** "Main breaker 225 A", "Feeder HA 1 + 3 + 5 (100 A)", "Transformer T-LDP1 (75 kVA)". */
  label: string;
  /** What that item carries: demand of everything below it. */
  demandVa: number;
  capacityVa: number;
  /** demandVa over capacityVa, as a fraction. 0.8 and above is flagged. */
  ratio: number;
}

export interface LoadCheck {
  /** Demand of this panel's own circuits. */
  demandVa: number;
  /** This panel plus everything it feeds, through sub-panels and transformers. */
  totalDemandVa: number;
  limits: CapacityLimit[];
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
  /** The transformer, disconnect, UPS or service feeding it, instead of a breaker. */
  fedFromDeviceId: number | null;
  nameplate: PanelNameplate;
  /** Sections after the first, each numbered from 1. */
  sections: PanelSection[];
  /** Demand below the panel against its main, feeder and transformer. */
  loadCheck: LoadCheck;
  /** Things that look wrong, e.g. a voltage that does not match the feed. */
  warnings: string[];
  /** Path of the public page ("/p/…") when the panel has one and public pages are allowed. */
  publicPath: string | null;
  /** Whether the viewer may turn the public page on or off (Manager or admin). */
  canShare: boolean;
  generatorId: number | null;
  transferSwitch: string;
  /** The transfer switch the panel is on, if any. */
  atsId: number | null;
  generator: PanelGenerator | null;
  /** Discrepancy reports not yet resolved. */
  openReports: number;
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
  tankGallons: number | null;
  runtimeHours: number | null;
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
  transferSwitches: TransferSwitchDto[];
}

export interface TransferSwitchDto {
  id: number;
  name: string;
  kind: AtsKind;
  duty: AtsDuty;
  transition: AtsTransition;
  /** Order loads come back on: 1 first. */
  priority: number | null;
  amps: number | null;
  generatorId: number | null;
  generatorName: string | null;
  locationId: number;
  locationPath: string;
  notes: string;
  /** Panels on it that the viewer can see. */
  panels: { id: number; name: string; locationPath: string }[];
  canEdit: boolean;
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
    section: number;
    unit: string;
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
  devices: { id: number; name: string; kind: PowerDeviceKind; rating: string; path: string }[];
  /** Equipment by tag or description, with what feeds it. */
  equipment: { id: number; tag: string; kind: string; description: string; path: string; fedFrom: string | null }[];
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

// ---- Power flow (topology) ------------------------------------------------------------------

export type TopologyKind = 'utility' | 'panel' | 'relay' | 'ats' | 'generator' | 'hidden' | PowerDeviceKind;

export interface TopologyNode {
  /** "p12" (panel), "a3" (transfer switch), "g2" (generator), "u" (utility), "h45" (out of access). */
  id: string;
  kind: TopologyKind;
  name: string;
  /** One line under the name: voltage and main, relay count, kW and fuel… */
  detail: string;
  /** Where clicking goes, or null. */
  href: string | null;
  locationPath: string;
  /** Backed up by a generator (directly, through a transfer switch, or upstream). */
  onGenerator: boolean;
  critical: number;
  /** Inside the location the view is for. Upstream and backing items outside it are shown too. */
  inScope: boolean;
}

export interface TopologyEdge {
  from: string;
  to: string;
  /**
   * feed: a breaker feeding a panel. normal / emergency: the two sides of a transfer switch.
   * load: a transfer switch to the panel on it. backup: a generator straight to a panel.
   * relay: relays in a relay panel switching circuits from a breaker panel.
   */
  kind: 'feed' | 'normal' | 'emergency' | 'load' | 'backup' | 'relay';
  label: string;
}

export interface Topology {
  location: { id: number; name: string; path: string };
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ---- Power devices ----------------------------------------------------------------------

export interface PowerDeviceSummary extends PowerDeviceShape {
  id: number;
  name: string;
  locationId: number;
  locationPath: string;
  meter: string;
  utility: string;
  /** "75 kVA · 480 V → 208 V" and the like. */
  rating: string;
  /** Short text for what feeds it, e.g. "MSB · 1 + 3 + 5" or "T-1". */
  fedFrom: string | null;
  role: EffectiveRole;
}

/** What a device feeds: panels and other devices. */
export interface DeviceLoad {
  kind: 'panel' | 'device' | 'equipment';
  id: number;
  name: string;
  /** Panel voltage, or the device's rating. */
  detail: string;
  locationPath: string;
}

export interface PowerDeviceDetail extends PowerDeviceSummary {
  manufacturer: string;
  model: string;
  notes: string;
  updatedAt: string;
  canEdit: boolean;
  fedFromBreakerId: number | null;
  fedFromDeviceId: number | null;
  /** From the breaker or device feeding it up to the service. */
  feedChain: FeedLink[];
  /** Demand of everything it feeds, and for a transformer or UPS how much of its kVA that is. */
  demandVa: number;
  ratio: number | null;
  warnings: string[];
  loads: DeviceLoad[];
  hiddenLoads: number;
}

/** What could feed a panel or device without making a loop. */
export interface FeedOptions {
  breakers: FeedCandidate[];
  devices: { id: number; name: string; kind: PowerDeviceKind; rating: string; locationPath: string }[];
}

// ---- Equipment register -----------------------------------------------------------------

export interface EquipmentDto {
  id: number;
  tag: string;
  kind: string;
  description: string;
  locationId: number;
  locationPath: string;
  hp: number | null;
  voltage: string;
  manufacturer: string;
  model: string;
  notes: string;
  fedFromBreakerId: number | null;
  fedFromDeviceId: number | null;
  /** "LP-1A · 5 + 7 + 9 (30 A)" or "DS-AHU1": the nearest thing feeding it. */
  fedFrom: string | null;
  /** From its breaker or disconnect up to the service. */
  feedChain: FeedLink[];
  /** E.g. a 277 V motor on a 208 V circuit. */
  warnings: string[];
  canEdit: boolean;
}

/** A breaker whose label names a room it does not serve yet. */
export interface RoomLinkSuggestion {
  breakerId: number;
  panelId: number;
  panelName: string;
  circuit: string;
  label: string;
  locationId: number;
  roomName: string;
  roomPath: string;
}

/** How far field verification has got under a location. */
export interface VerifyProgress {
  locationId: number;
  name: string;
  kind: LocationKind;
  path: string;
  /** Circuits that can be checked (not spares). */
  circuits: number;
  verified: number;
  wrong: number;
  panels: number;
  /** Panels with every circuit verified. */
  panelsDone: number;
}

export interface ProgressReport {
  /** The location asked about, then each site and building under it. */
  total: VerifyProgress;
  parts: VerifyProgress[];
  /** Panels under it, least verified first. */
  panels: { id: number; name: string; path: string; circuits: number; verified: number; wrong: number }[];
}

// ---- Shutdown impact ----------------------------------------------------------------------

/** What loses power when a breaker opens, a panel's main is shut off, or a device is opened. */
export interface ImpactReport {
  /** "LP-1A circuit 5 + 7 + 9 (Water heater WH-1)", "Panel HA", "T-LDP1". */
  title: string;
  /** Circuits that go dark, counting every downstream panel's circuits. */
  circuits: number;
  panels: {
    id: number;
    name: string;
    path: string;
    circuits: number;
    /** Set when it is on a transfer switch or generator: it moves to the generator instead. */
    backup: string | null;
  }[];
  devices: { id: number; name: string; kind: PowerDeviceKind; path: string; backup: string | null }[];
  equipment: { id: number; tag: string; kind: string; path: string }[];
  /** Relay circuits that lose power because the circuit they switch does. */
  relays: { panelId: number; panelName: string; relay: string; label: string }[];
  /** Critical circuits that go dark; `backup` when the circuit has its own UPS or generator. */
  critical: { panelId: number; panelName: string; circuit: string; label: string; backup: string | null }[];
  rooms: { id: number; name: string; path: string }[];
  /** Panels and items downstream the viewer cannot see. */
  hidden: number;
}

export interface ReportDto {
  id: number;
  panelId: number;
  panelName: string;
  locationPath: string;
  breakerId: number | null;
  /** As it read when reported, e.g. "5 + 7 Lab lights". */
  circuit: string;
  message: string;
  reporter: string;
  source: 'app' | 'public';
  status: 'open' | 'resolved';
  resolution: string;
  resolvedBy: string;
  resolvedAt: string | null;
  createdAt: string;
  canResolve: boolean;
}
