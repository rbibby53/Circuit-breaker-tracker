// Single sign-on helpers shared by the server and the web app: naming the provider, and
// reading and matching the groups an identity provider sends.

/** A short name for the provider behind an issuer URL, for buttons, logs and messages. */
export function ssoProviderName(issuer: string): string {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return 'single sign-on';
  }
  const host = url.hostname.toLowerCase();
  if (host.endsWith('microsoftonline.com') || host.endsWith('microsoftonline.us')) return 'Microsoft';
  if (url.pathname.startsWith('/application/o/') || host.includes('authentik')) return 'Authentik';
  if (host === 'accounts.google.com') return 'Google';
  if (url.pathname.includes('/realms/')) return 'Keycloak';
  if (host.includes('authelia')) return 'Authelia';
  if (host.endsWith('okta.com')) return 'Okta';
  return 'single sign-on';
}

/** The sign-in button text when none is set: "Sign in with Authentik", or "Single sign-on". */
export function ssoButtonLabel(issuer: string, label: string): string {
  if (label.trim()) return label.trim();
  const name = ssoProviderName(issuer);
  return name === 'single sign-on' ? 'Single sign-on' : `Sign in with ${name}`;
}

/** "admins, Electricians ,x" → ["admins", "Electricians", "x"]: a comma-separated setting. */
export function parseGroupList(text: string): string[] {
  return dedupeGroups(text.split(','));
}

const groupKey = (g: string) => g.trim().toLowerCase();

/** Trimmed, without blanks or repeats (compared ignoring case), in the order given. */
export function dedupeGroups(groups: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    const t = g.trim();
    if (!t || seen.has(groupKey(t))) continue;
    seen.add(groupKey(t));
    out.push(t);
  }
  return out;
}

/** Whether someone's groups include `group`. Group names are compared ignoring case. */
export function inGroup(groups: readonly string[], group: string): boolean {
  const key = groupKey(group);
  return groups.some((g) => groupKey(g) === key);
}

/** Whether someone's groups include any of `wanted`. */
export function inAnyGroup(groups: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((w) => inGroup(groups, w));
}

/**
 * The groups in a token's claims, at `claim` (dots reach into nested objects, e.g.
 * `realm_access.roles`). A single string counts as one group; anything else is ignored.
 * Returns null when the claim is not there at all.
 */
export function groupsFromClaims(claims: Record<string, unknown>, claim: string): string[] | null {
  const path = claim.trim() || 'groups';
  let value: unknown = path in claims ? claims[path] : undefined;
  if (value === undefined && path.includes('.')) {
    value = path.split('.').reduce<unknown>((v, key) => {
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined;
    }, claims);
  }
  if (value === undefined || value === null) return null;
  const list = Array.isArray(value) ? value : [value];
  return withParentGroups(list.filter((g): g is string => typeof g === 'string'));
}

/**
 * Nested groups: a group sent as a full path ("/Facilities/Electricians", as Keycloak does) also
 * makes someone a member of every group above it ("/Facilities"), and each group can be named
 * on its own ("Facilities", "Electricians"). Other names are kept as they are.
 */
export function withParentGroups(groups: readonly string[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const t = g.trim();
    out.push(t);
    if (!t.startsWith('/')) continue;
    const parts = t
      .split('/')
      .map((x) => x.trim())
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 1; i--) out.push(`/${parts.slice(0, i).join('/')}`);
    out.push(...parts);
  }
  return dedupeGroups(out);
}
