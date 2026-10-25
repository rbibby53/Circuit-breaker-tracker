import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, CSRF_HEADER } from '../src/app';
import { loadConfig } from '../src/config';
import { openDatabase, type DB } from '../src/db';

export async function testApp(env: Record<string, string> = {}): Promise<{ app: FastifyInstance; db: DB }> {
  const config = loadConfig({ DATA_DIR: '/tmp/unused', ...env });
  const db = openDatabase(':memory:');
  const app = await buildApp(config, db, { logger: false });
  return { app, db };
}

/** A tiny cookie-jar client around app.inject. */
export class Client {
  private cookie: string | null = null;
  constructor(private app: FastifyInstance) {}

  async req(method: InjectOptions['method'], url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as InjectOptions['payload']),
      headers: {
        ...(method !== 'GET' ? { [CSRF_HEADER]: '1' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
    });
    const set = res.cookies.find((c) => c.name === 'cbt_session');
    if (set) this.cookie = set.value ? `cbt_session=${set.value}` : null;
    let json: any;
    try {
      json = res.json();
    } catch {
      json = null;
    }
    return { status: res.statusCode, body: json };
  }

  /** A GET that keeps the raw body and headers, for files such as PDFs. */
  async raw(url: string) {
    const res = await this.app.inject({ method: 'GET', url, headers: this.cookie ? { cookie: this.cookie } : {} });
    return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);
}

export const PASSWORD = 'correct horse battery';

export async function setupAdmin(app: FastifyInstance): Promise<Client> {
  const c = new Client(app);
  const r = await c.post('/api/setup', { username: 'admin', displayName: 'Admin', password: PASSWORD });
  if (r.status !== 200) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
  return c;
}

export async function createLocation(c: Client, parentId: number | null, kind: string, name: string): Promise<number> {
  const r = await c.post('/api/locations', { parentId, kind, name });
  if (r.status !== 200) throw new Error(`create ${kind} failed: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

/** Create an invite as `inviter` and accept it as a brand-new user. */
export async function invite(
  app: FastifyInstance,
  inviter: Client,
  locationId: number,
  role: string,
  username: string,
  inviteLimit: string | null = null,
): Promise<Client> {
  const r = await inviter.post(`/api/locations/${locationId}/invites`, { role, inviteLimit });
  if (r.status !== 200) throw new Error(`invite failed: ${JSON.stringify(r.body)}`);
  const token = String(r.body.url).split('/invite/')[1];
  const c = new Client(app);
  const a = await c.post(`/api/invites/${token}/accept`, { username, displayName: username, password: PASSWORD });
  if (a.status !== 200) throw new Error(`accept failed: ${JSON.stringify(a.body)}`);
  return c;
}
