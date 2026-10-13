import { describe, expect, it } from 'vitest';
import { SETTING_BY_KEY, parseSetting } from './settings';
import { groupsFromClaims, inAnyGroup, withParentGroups, parseGroupList, ssoButtonLabel, ssoProviderName } from './sso';

describe('ssoProviderName', () => {
  it('names common providers from the issuer', () => {
    expect(ssoProviderName('https://login.microsoftonline.com/tenant/v2.0')).toBe('Microsoft');
    expect(ssoProviderName('https://auth.example.com/application/o/breakers/')).toBe('Authentik');
    expect(ssoProviderName('https://authentik.lan')).toBe('Authentik');
    expect(ssoProviderName('https://kc.example.com/realms/home')).toBe('Keycloak');
    expect(ssoProviderName('https://idp.example.com')).toBe('single sign-on');
    expect(ssoProviderName('not a url')).toBe('single sign-on');
  });

  it('picks the button text when none is set', () => {
    expect(ssoButtonLabel('https://auth.example.com/application/o/x/', '')).toBe('Sign in with Authentik');
    expect(ssoButtonLabel('https://idp.example.com', '')).toBe('Single sign-on');
    expect(ssoButtonLabel('https://idp.example.com', ' Staff login ')).toBe('Staff login');
  });
});

describe('groups', () => {
  it('parses a comma-separated list without blanks or repeats', () => {
    expect(parseGroupList(' admins, Electricians ,,ADMINS ')).toEqual(['admins', 'Electricians']);
    expect(parseGroupList('')).toEqual([]);
  });

  it('matches group names ignoring case', () => {
    expect(inAnyGroup(['Electricians'], ['electricians'])).toBe(true);
    expect(inAnyGroup(['Electricians'], ['plumbers'])).toBe(false);
    expect(inAnyGroup([], [])).toBe(false);
  });

  it('reads the groups claim, nested claims and single values', () => {
    expect(groupsFromClaims({ groups: ['a', 'b', 3, 'a'] }, 'groups')).toEqual(['a', 'b']);
    expect(groupsFromClaims({ realm_access: { roles: ['x'] } }, 'realm_access.roles')).toEqual(['x']);
    expect(groupsFromClaims({ role: 'staff' }, 'role')).toEqual(['staff']);
    expect(groupsFromClaims({ 'a.b': ['flat'] }, 'a.b')).toEqual(['flat']);
    expect(groupsFromClaims({ sub: 'x' }, 'groups')).toBeNull();
    expect(groupsFromClaims({ groups: [] }, '')).toEqual([]);
  });

  it('counts the groups above a nested group sent as a path', () => {
    expect(groupsFromClaims({ groups: ['/Facilities/Electrical/Electricians', 'admins'] }, 'groups')).toEqual([
      '/Facilities/Electrical/Electricians',
      '/Facilities/Electrical',
      '/Facilities',
      'Facilities',
      'Electrical',
      'Electricians',
      'admins',
    ]);
    // Only paths are split: a plain name with a slash stays whole.
    expect(withParentGroups(['HVAC/Plumbing'])).toEqual(['HVAC/Plumbing']);
    expect(inAnyGroup(withParentGroups(['/Facilities/Electricians']), ['facilities'])).toBe(true);
  });
});

describe('issuer setting', () => {
  it('keeps the trailing slash Authentik issuers need, and trims it elsewhere', () => {
    expect(parseSetting(SETTING_BY_KEY.get('oidcIssuer')!, 'https://auth.example.com/application/o/x/')).toEqual({
      ok: true,
      value: 'https://auth.example.com/application/o/x/',
    });
    expect(parseSetting(SETTING_BY_KEY.get('publicUrl')!, 'https://breakers.example.com/')).toEqual({
      ok: true,
      value: 'https://breakers.example.com',
    });
  });
});
