import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceName } from '../src/device';
import { Client, PASSWORD, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
afterEach(async () => app?.close());

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function signIn(username: string, ua: string) {
  const c = new Client(app);
  const r = await c.req('POST', '/api/auth/login', { username, password: PASSWORD }, { 'user-agent': ua });
  expect(r.status).toBe(200);
  return c;
}

describe('where you are signed in', () => {
  it('names browsers', () => {
    expect(deviceName(CHROME_WIN)).toBe('Chrome on Windows');
    expect(deviceName(SAFARI_IPHONE)).toBe('Safari on iPhone');
    expect(deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(
      'Firefox on Linux',
    );
    expect(deviceName(null)).toBe('Unknown browser');
  });

  it('lists your sessions and ends one, or all the others', async () => {
    ({ app } = await testApp());
    const laptop = await setupAdmin(app);
    const phone = await signIn('admin', SAFARI_IPHONE);
    const desk = await signIn('admin', CHROME_WIN);

    const list = (await laptop.get('/api/me/sessions')).body as any[];
    expect(list).toHaveLength(3);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const phoneRow = list.find((s) => s.device === 'Safari on iPhone');
    expect(phoneRow).toMatchObject({ method: 'password', ip: '127.0.0.1', current: false });

    expect((await laptop.del(`/api/me/sessions/${phoneRow.id}`)).status).toBe(200);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    expect((await desk.get('/api/auth/me')).status).toBe(200);

    expect((await laptop.post('/api/me/sessions/sign-out-others')).body.signedOut).toBe(1);
    expect((await desk.get('/api/auth/me')).status).toBe(401);
    expect((await laptop.get('/api/auth/me')).status).toBe(200);
  });

  it('never ends someone else’s session through your own list', async () => {
    ({ app } = await testApp());
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Acme');
    const sam = await invite(app, admin, co, 'viewer', 'sam');
    const adminSession = (await admin.get('/api/me/sessions')).body[0].id;
    expect((await sam.del(`/api/me/sessions/${adminSession}`)).status).toBe(404);
    expect((await admin.get('/api/auth/me')).status).toBe(200);
  });

  it('lets admins and their managers sign someone out everywhere', async () => {
    ({ app } = await testApp());
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Acme');
    const home = await createLocation(admin, co, 'site', 'Home');
    const shop = await createLocation(admin, co, 'site', 'Shop');
    const boss = await invite(app, admin, home, 'manager', 'boss', 'editor');
    const sam = await invite(app, boss, home, 'viewer', 'sam');
    const pat = await invite(app, admin, shop, 'viewer', 'pat');
    const idOf = async (c: Client) => (await c.get('/api/auth/me')).body.user.id as number;
    const [samId, patId] = [await idOf(sam), await idOf(pat)];

    expect((await boss.post(`/api/users/${patId}/sign-out`)).status).toBe(404);
    const r = await boss.post(`/api/users/${samId}/sign-out`);
    expect(r.body).toEqual({ ok: true, signedOut: 1 });
    expect((await sam.get('/api/auth/me')).status).toBe(401);
    expect((await admin.post(`/api/users/${patId}/sign-out`)).status).toBe(200);
    expect((await pat.get('/api/auth/me')).status).toBe(401);
  });
});
