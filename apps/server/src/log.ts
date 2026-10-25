// Container logging. Pino (inside Fastify) produces JSON; this turns it into one readable line
// per event for log viewers such as Unraid's, or passes the JSON through for log collectors.

import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';

export type LogFormat = 'text' | 'json';

const LEVELS: Record<number, string> = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' };
/** Pino's own fields, and Fastify's request plumbing, which a reader does not need. */
const HIDDEN = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'reqId', 'req', 'res', 'responseTime', 'err']);

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Local time (the container's TZ), the way people read a log: 2026-10-11 14:05:09. */
export function localTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function fieldText(value: unknown): string {
  if (typeof value === 'string') return /[\s"=]/.test(value) || value === '' ? JSON.stringify(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return JSON.stringify(value);
}

/** One pino JSON record as a readable line, with an error's stack indented underneath. */
export function formatLine(record: Record<string, unknown>): string {
  const level = (LEVELS[Number(record.level)] ?? 'INFO').padEnd(5);
  const time = typeof record.time === 'number' ? record.time : Date.parse(String(record.time)) || Date.now();
  const extra = Object.entries(record)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== undefined)
    .map(([k, v]) => `${k}=${fieldText(v)}`);
  let line = `${localTime(time)} ${level} ${String(record.msg ?? '')}${extra.length ? `  ${extra.join(' ')}` : ''}`;
  const err = record.err as { message?: string; stack?: string } | undefined;
  if (err) {
    const stack = err.stack ?? err.message ?? String(err);
    line += `\n${stack
      .split('\n')
      .map((l) => `    ${l.trim()}`)
      .join('\n')}`;
  }
  return line;
}

/** A line kept for the log viewer in Settings. */
export interface RecentLine {
  time: number;
  level: number;
  text: string;
}

/** How many lines the log viewer can show. Kept in memory only, so a restart clears them. */
export const RECENT_LINES = 500;

/** Where pino writes. The format can change at runtime from Settings. */
export class LogStream {
  private recentLines: RecentLine[] = [];

  constructor(
    public format: LogFormat,
    private out: (s: string) => void = (s) => process.stdout.write(s),
  ) {}

  write(chunk: string): void {
    for (const raw of chunk.split('\n')) {
      if (!raw) continue;
      let record: Record<string, unknown> | null;
      try {
        record = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        record = null;
      }
      const text = record ? formatLine(record) : raw;
      this.out(`${this.format === 'json' ? raw : text}\n`);
      this.recentLines.push({
        time: typeof record?.time === 'number' ? record.time : Date.now(),
        level: Number(record?.level ?? 30),
        text,
      });
      if (this.recentLines.length > RECENT_LINES) this.recentLines.splice(0, this.recentLines.length - RECENT_LINES);
    }
  }

  /** Oldest first, at or above a pino level number (30 info, 40 warn, 50 error). */
  recent(minLevel = 0): RecentLine[] {
    return this.recentLines.filter((l) => l.level >= minLevel);
  }
}

// ---- Shared logger -----------------------------------------------------------------------
// Code without a request at hand (the audit trail, the cleanup job) logs through this.

let shared: FastifyBaseLogger | null = null;

export function setLogger(log: FastifyBaseLogger | null): void {
  shared = log;
}

export function logger(): FastifyBaseLogger | null {
  return shared;
}

// ---- Requests --------------------------------------------------------------------------

/** Path segments that are secrets (invite, reset and public links) are never written out. */
const SECRET_PARAMS = /token/i;

/**
 * The request's path with secret parameters masked and the query string dropped (it can hold
 * sign-in codes). Uses the route's pattern when there is one: /api/invites/:token → /api/invites/…
 */
export function safePath(req: FastifyRequest): string {
  const pattern = req.routeOptions?.url;
  const params = (req.params ?? {}) as Record<string, string>;
  if (pattern && !pattern.includes('*')) {
    return pattern.replace(/:(\w+)/g, (_, name: string) =>
      SECRET_PARAMS.test(name) ? '…' : encodeURIComponent(params[name] ?? `:${name}`),
    );
  }
  const path = req.url.split('?')[0]!;
  // Web pages for links: /invite/<token>, /reset/<token>, /p/<token>.
  return path.replace(/^\/(invite|reset|p)\/[^/]+/, '/$1/…');
}

/** Who made a request, for the end of a log line: "ryan", "ryan as sam", or the address. */
export function who(req: FastifyRequest): string {
  const auth = req.auth;
  const name = auth
    ? auth.readOnly
      ? `${auth.realUser.username} as ${auth.user.username}`
      : auth.realUser.username
    : '';
  return name ? `${name} @ ${req.ip}` : req.ip;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Why the request was refused, for the request's log line. */
    failure?: string;
  }
}

/**
 * One line per request. Everyday traffic is debug; refused changes are warnings with the reason;
 * server errors are errors. Health checks and static files only show at trace.
 */
export function logRequest(req: FastifyRequest, reply: FastifyReply): void {
  const status = reply.statusCode;
  const path = safePath(req);
  const ms = Math.round(reply.elapsedTime);
  const api = path.startsWith('/api/');
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const level = status >= 500 ? 'error' : !api ? 'trace' : status >= 400 && write && status !== 401 ? 'warn' : 'debug';
  const reason = req.failure ? ` · ${req.failure}` : '';
  req.log[level](`${req.method} ${path} → ${status} in ${ms} ms · ${who(req)}${reason}`);
}
