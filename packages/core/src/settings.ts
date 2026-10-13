// App-wide settings an admin can change in the web UI. Each one can also be pinned by an
// environment variable, which then wins and shows as read-only in the UI.

export type SettingType = 'text' | 'url' | 'boolean' | 'int' | 'enum' | 'secret';
export type SettingValue = string | number | boolean;

export interface SettingDef {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  description: string;
  type: SettingType;
  env: string;
  default: SettingValue;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: { value: string; label: string }[];
  /** URL settings: keep a trailing slash (Authentik's issuer ends in one and must match exactly). */
  keepTrailingSlash?: boolean;
}

export const SETTING_GROUPS = [
  { id: 'general', title: 'General' },
  { id: 'signin', title: 'Sign-in' },
  { id: 'sso', title: 'Single sign-on' },
  { id: 'links', title: 'Invite and reset links' },
  { id: 'panels', title: 'New panel defaults' },
  { id: 'printing', title: 'Printing and QR codes' },
  { id: 'network', title: 'Network and security' },
  { id: 'logging', title: 'Logging' },
  { id: 'backups', title: 'Automatic backups' },
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number]['id'];

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export const PAPER_SIZES = ['letter', 'a4'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export interface Settings {
  appName: string;
  publicUrl: string;
  gravatar: boolean;
  allowLocalLogin: boolean;
  sessionDays: number;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcLabel: string;
  oidcScopes: string;
  oidcGroupsClaim: string;
  oidcAdminGroups: string;
  oidcAllowedGroups: string;
  oidcCreateAccounts: boolean;
  inviteDays: number;
  resetHours: number;
  defaultSpaces: number;
  defaultMainAmps: number;
  defaultVoltage: string;
  paperSize: PaperSize;
  printQr: boolean;
  publicPanels: boolean;
  printNote: string;
  trustProxy: boolean;
  cookieSecure: 'auto' | 'always' | 'never';
  logLevel: (typeof LOG_LEVELS)[number];
  logFormat: 'text' | 'json';
  backupKeep: number;
  backupHour: number;
}
export type SettingKey = keyof Settings;

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'appName',
    group: 'general',
    label: 'App name',
    description: 'Shown in the header, browser tabs and sign-in pages.',
    type: 'text',
    env: 'APP_NAME',
    default: 'Circuit Breaker Tracker',
    maxLength: 60,
  },
  {
    key: 'publicUrl',
    group: 'general',
    label: 'Public address',
    description:
      'The address people use to reach this app, e.g. https://breakers.example.com or http://192.168.1.10:2757. Used in invite and reset links, and required for single sign-on.',
    type: 'url',
    env: 'PUBLIC_URL',
    default: '',
  },
  {
    key: 'gravatar',
    group: 'general',
    label: 'Show Gravatar pictures',
    description:
      'People with a picture on gravatar.com for their email address show it instead of their initials. Browsers fetch the pictures from Gravatar, which learns a hash of each email shown.',
    type: 'boolean',
    env: 'GRAVATAR',
    default: true,
  },
  {
    key: 'allowLocalLogin',
    group: 'signin',
    label: 'Allow password sign-in',
    description:
      'Turn off to make everyone except admins use single sign-on. Admins can always use their password, so you cannot lock yourself out.',
    type: 'boolean',
    env: 'ALLOW_LOCAL_LOGIN',
    default: true,
  },
  {
    key: 'sessionDays',
    group: 'signin',
    label: 'Stay signed in for (days)',
    description: 'How long a sign-in lasts before people have to sign in again. Applies to new sign-ins.',
    type: 'int',
    env: 'SESSION_DAYS',
    default: 30,
    min: 1,
    max: 365,
  },
  {
    key: 'oidcIssuer',
    group: 'sso',
    label: 'Issuer URL',
    description:
      'Microsoft Entra ID: https://login.microsoftonline.com/<directory-tenant-id>/v2.0. Authentik: the provider’s OpenID Configuration Issuer, e.g. https://auth.example.com/application/o/<app-slug>/ (keep the slash at the end).',
    type: 'url',
    env: 'OIDC_ISSUER',
    default: '',
    keepTrailingSlash: true,
  },
  {
    key: 'oidcClientId',
    group: 'sso',
    label: 'Client ID',
    description: 'The application (client) ID of the app registration, or the Client ID of the Authentik provider.',
    type: 'text',
    env: 'OIDC_CLIENT_ID',
    default: '',
    maxLength: 200,
  },
  {
    key: 'oidcClientSecret',
    group: 'sso',
    label: 'Client secret',
    description:
      'Microsoft: the secret value from Certificates & secrets. Authentik: the provider’s Client Secret. Stored in the database; never shown again.',
    type: 'secret',
    env: 'OIDC_CLIENT_SECRET',
    default: '',
    maxLength: 500,
  },
  {
    key: 'oidcLabel',
    group: 'sso',
    label: 'Button text',
    description: 'Text on the sign-in button. Blank picks one from the issuer, e.g. “Sign in with Authentik”.',
    type: 'text',
    env: 'OIDC_LABEL',
    default: '',
    maxLength: 60,
  },
  {
    key: 'oidcScopes',
    group: 'sso',
    label: 'Scopes',
    description:
      'What to ask the provider for. Authentik and Microsoft send groups with the default; add “groups” for providers that need it, such as Authelia or Keycloak.',
    type: 'text',
    env: 'OIDC_SCOPES',
    default: 'openid profile email',
    maxLength: 200,
  },
  {
    key: 'oidcGroupsClaim',
    group: 'sso',
    label: 'Groups claim',
    description:
      'The claim that lists someone’s groups: “groups” for Authentik, Microsoft and most others. Use dots for a nested claim, e.g. realm_access.roles. Groups sent as paths (/Facilities/Electricians) count for the groups above them too.',
    type: 'text',
    env: 'OIDC_GROUPS_CLAIM',
    default: 'groups',
    maxLength: 100,
  },
  {
    key: 'oidcAdminGroups',
    group: 'sso',
    label: 'Admin groups',
    description:
      'Members of these groups are admins, and stop being admins when they leave them. Separate several with commas. Admins made by hand are never changed. Blank: groups do not decide who is an admin.',
    type: 'text',
    env: 'OIDC_ADMIN_GROUPS',
    default: '',
    maxLength: 500,
  },
  {
    key: 'oidcAllowedGroups',
    group: 'sso',
    label: 'Only allow these groups',
    description:
      'Single sign-on is refused for anyone not in at least one of these groups. Separate several with commas. Blank: anyone the provider signs in, as long as they have an account here.',
    type: 'text',
    env: 'OIDC_ALLOWED_GROUPS',
    default: '',
    maxLength: 500,
  },
  {
    key: 'oidcCreateAccounts',
    group: 'sso',
    label: 'Create accounts from groups',
    description:
      'When someone signs in for the first time and their groups give them access (an admin group or a group under Group access below), make their account without needing an invite.',
    type: 'boolean',
    env: 'OIDC_CREATE_ACCOUNTS',
    default: true,
  },
  {
    key: 'inviteDays',
    group: 'links',
    label: 'Invite links last (days)',
    description: 'How long a new invite link works before it expires.',
    type: 'int',
    env: 'INVITE_DAYS',
    default: 7,
    min: 1,
    max: 90,
  },
  {
    key: 'resetHours',
    group: 'links',
    label: 'Password reset links last (hours)',
    description: 'How long a new password reset link works.',
    type: 'int',
    env: 'RESET_HOURS',
    default: 48,
    min: 1,
    max: 720,
  },
  {
    key: 'defaultSpaces',
    group: 'panels',
    label: 'Spaces',
    description: 'Pre-filled when someone adds a panel.',
    type: 'int',
    env: 'DEFAULT_PANEL_SPACES',
    default: 24,
    min: 2,
    max: 84,
  },
  {
    key: 'defaultMainAmps',
    group: 'panels',
    label: 'Main breaker (amps)',
    description: 'Pre-filled when someone adds a panel.',
    type: 'int',
    env: 'DEFAULT_MAIN_AMPS',
    default: 200,
    min: 1,
    max: 4000,
  },
  {
    key: 'defaultVoltage',
    group: 'panels',
    label: 'Voltage',
    description: 'Pre-filled when someone adds a panel.',
    type: 'text',
    env: 'DEFAULT_VOLTAGE',
    default: '120/240 V split-phase',
    maxLength: 40,
  },
  {
    key: 'paperSize',
    group: 'printing',
    label: 'Paper size',
    description: 'The size PDFs start with. People can still pick the other one when they print.',
    type: 'enum',
    env: 'PAPER_SIZE',
    default: 'letter',
    options: [
      { value: 'letter', label: 'US Letter' },
      { value: 'a4', label: 'A4' },
    ],
  },
  {
    key: 'printQr',
    group: 'printing',
    label: 'Print a QR code on each panel',
    description: 'Scanning it opens the panel in the app. Needs the public address under General.',
    type: 'boolean',
    env: 'PRINT_QR',
    default: true,
  },
  {
    key: 'publicPanels',
    group: 'printing',
    label: 'Allow public panel pages',
    description:
      'Managers can let a panel be opened from its QR code without signing in. Turn off to make every QR code ask for a sign-in, even on panels marked public.',
    type: 'boolean',
    env: 'PUBLIC_PANELS',
    default: true,
  },
  {
    key: 'printNote',
    group: 'printing',
    label: 'Note at the bottom of every page',
    description: 'For example who to call before working on a panel. Leave blank for none.',
    type: 'text',
    env: 'PRINT_NOTE',
    default: '',
    maxLength: 120,
  },
  {
    key: 'trustProxy',
    group: 'network',
    label: 'Behind a reverse proxy',
    description:
      'Turn on when Nginx Proxy Manager, SWAG, Caddy or Traefik sits in front of the app, so it sees real client addresses and HTTPS.',
    type: 'boolean',
    env: 'TRUST_PROXY',
    default: false,
  },
  {
    key: 'cookieSecure',
    group: 'network',
    label: 'HTTPS-only sign-in cookies',
    description: 'Automatic follows the public address: on when it starts with https://.',
    type: 'enum',
    env: 'COOKIE_SECURE',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Automatic' },
      { value: 'always', label: 'Always' },
      { value: 'never', label: 'Never' },
    ],
  },
  {
    key: 'logLevel',
    group: 'logging',
    label: 'Log level',
    description:
      'How much the server writes to the container log. Info: start-up, sign-ins, every change and any problems. Debug: also every request.',
    type: 'enum',
    env: 'LOG_LEVEL',
    default: 'info',
    options: LOG_LEVELS.map((l) => ({ value: l, label: l[0]!.toUpperCase() + l.slice(1) })),
  },
  {
    key: 'logFormat',
    group: 'logging',
    label: 'Log format',
    description: 'Readable lines for log viewers such as Unraid, or JSON for log collectors (Loki, Graylog…).',
    type: 'enum',
    env: 'LOG_FORMAT',
    default: 'text',
    options: [
      { value: 'text', label: 'Readable text' },
      { value: 'json', label: 'JSON' },
    ],
  },
  {
    key: 'backupKeep',
    group: 'backups',
    label: 'Daily backups to keep',
    description:
      'A copy of the database is saved once a day in the backups folder inside the data folder, and older copies are removed. 0 turns automatic backups off.',
    type: 'int',
    env: 'BACKUP_KEEP',
    default: 14,
    min: 0,
    max: 365,
  },
  {
    key: 'backupHour',
    group: 'backups',
    label: 'Time of day (hour, 0–23)',
    description:
      'When the daily backup runs, in the server’s time zone. If the server was off then, it runs as soon as it is back.',
    type: 'int',
    env: 'BACKUP_HOUR',
    default: 3,
    min: 0,
    max: 23,
  },
];

export const SETTING_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

const TRUE = ['1', 'true', 'yes', 'on'];
const FALSE = ['0', 'false', 'no', 'off'];

/**
 * Check and normalise a value for a setting. Accepts the typed value (from the UI) or a
 * string (from an environment variable). Empty text means "not set" and is returned as ''.
 */
export function parseSetting(
  def: SettingDef,
  raw: unknown,
): { ok: true; value: SettingValue } | { ok: false; error: string } {
  const str = typeof raw === 'string' ? raw.trim() : raw;
  switch (def.type) {
    case 'boolean': {
      if (typeof str === 'boolean') return { ok: true, value: str };
      const s = String(str).toLowerCase();
      if (TRUE.includes(s)) return { ok: true, value: true };
      if (FALSE.includes(s)) return { ok: true, value: false };
      return { ok: false, error: 'must be true or false' };
    }
    case 'int': {
      const n = typeof str === 'number' ? str : Number(str);
      if (!Number.isInteger(n)) return { ok: false, error: 'must be a whole number' };
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        return { ok: false, error: `must be between ${def.min} and ${def.max}` };
      }
      return { ok: true, value: n };
    }
    case 'enum': {
      let s = String(str).toLowerCase();
      // COOKIE_SECURE used to be a plain true/false.
      if (def.key === 'cookieSecure' && TRUE.includes(s)) s = 'always';
      if (def.key === 'cookieSecure' && FALSE.includes(s)) s = 'never';
      if (!def.options?.some((o) => o.value === s)) {
        return { ok: false, error: `must be one of ${def.options?.map((o) => o.value).join(', ')}` };
      }
      return { ok: true, value: s };
    }
    case 'url': {
      if (typeof str !== 'string') return { ok: false, error: 'must be text' };
      if (str === '') return { ok: true, value: '' };
      let u: URL;
      try {
        u = new URL(str);
      } catch {
        return { ok: false, error: 'must be a full address starting with http:// or https://' };
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, error: 'must start with http:// or https://' };
      }
      return { ok: true, value: def.keepTrailingSlash ? str : str.replace(/\/+$/, '') };
    }
    default: {
      if (typeof str !== 'string') return { ok: false, error: 'must be text' };
      if (def.maxLength && str.length > def.maxLength) {
        return { ok: false, error: `must be at most ${def.maxLength} characters` };
      }
      return { ok: true, value: str };
    }
  }
}
