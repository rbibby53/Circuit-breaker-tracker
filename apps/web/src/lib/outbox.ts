// Field changes made without signal (an electrical room in a basement) wait here, on this phone,
// and are sent in order when the connection comes back. Checks are safe to send twice, and
// reports carry an id so the server records each only once.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../api';

export interface OutboxItem {
  id: string;
  /** Who made it: only their own changes are sent while they are signed in. */
  userId: number;
  url: string;
  body: unknown;
  panelId: number;
  /** What it was, for the list of waiting changes, e.g. "Circuit 5 checked". */
  label: string;
  at: string;
}

const KEY = 'cbt-outbox';
const EVENT = 'cbt-outbox';

function read(): OutboxItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]): void {
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage refused (private window): nothing more can be kept.
  }
  window.dispatchEvent(new Event(EVENT));
}

export const newClientId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 32);

/** Network trouble (rather than the server saying no): worth keeping and trying again. */
const offline = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 502;

/**
 * Send now, or keep it for later when there is no connection. Resolves 'sent' or 'queued';
 * throws when the server refuses it, so the person sees why.
 */
export async function sendOrQueue(item: Omit<OutboxItem, 'id' | 'at'>): Promise<'sent' | 'queued'> {
  if (navigator.onLine) {
    try {
      await api.post(item.url, item.body);
      return 'sent';
    } catch (e) {
      if (!offline(e)) throw e;
    }
  }
  write([...read(), { ...item, id: newClientId(), at: new Date().toISOString() }]);
  return 'queued';
}

let flushing: Promise<{ sent: number; failed: string[] }> | null = null;

/** Send what is waiting, oldest first. Stops at the first network failure; drops what the server refuses. */
export function flush(userId: number): Promise<{ sent: number; failed: string[] }> {
  flushing ??= (async () => {
    let sent = 0;
    const failed: string[] = [];
    try {
      for (const item of read().filter((i) => i.userId === userId)) {
        try {
          await api.post(item.url, item.body);
          sent++;
        } catch (e) {
          if (offline(e)) break;
          failed.push(`${item.label}: ${errorMessage(e)}`);
        }
        write(read().filter((i) => i.id !== item.id));
      }
    } finally {
      flushing = null;
    }
    return { sent, failed };
  })();
  return flushing;
}

/** What is waiting to be sent, kept up to date; sends it whenever the connection returns. */
export function useOutbox(userId: number | null) {
  const [items, setItems] = useState<OutboxItem[]>(() => read());
  const [failed, setFailed] = useState<string[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);

  const send = useCallback(async () => {
    if (userId === null) return { sent: 0, failed: [] };
    const result = await flush(userId);
    if (result.failed.length) setFailed((f) => [...f, ...result.failed]);
    return result;
  }, [userId]);

  useEffect(() => {
    const refresh = () => setItems(read());
    const up = () => {
      setOnline(true);
      void send();
    };
    const down = () => setOnline(false);
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // Whatever was left from last time goes as soon as the page is up.
    const start = setTimeout(() => navigator.onLine && void send(), 0);
    return () => {
      clearTimeout(start);
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [send]);

  return { items: items.filter((i) => i.userId === userId), failed, online, send, clearFailed: () => setFailed([]) };
}
