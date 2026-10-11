import type { ActivityItem } from '@cbt/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTitle } from '../lib/useTitle';
import { api, ApiError } from '../api';
import { ErrorNote } from '../components/ui';

const PAGE = 100;

/** "Today", "Yesterday", or the date, for the group headings. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/** Where an entry leads: the panel it is about, or its location. */
function linkOf(i: ActivityItem): string | null {
  if (i.entity === 'panel' && i.entityId && !i.action.endsWith('delete')) return `/panels/${i.entityId}`;
  return i.locationId ? `/?loc=${i.locationId}` : null;
}

export function ActivityPage() {
  useTitle('Activity');
  const [filter, setFilter] = useState('');
  const items = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) =>
      api.get<ActivityItem[]>(`/api/activity?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)!.id : undefined),
    retry: false,
  });

  if (items.error instanceof ApiError && items.error.status === 403) {
    return (
      <main className="content narrow">
        <h1>Activity</h1>
        <div className="empty">
          <p>Only managers and admins can see the activity log.</p>
        </div>
      </main>
    );
  }

  const q = filter.trim().toLowerCase();
  const all = items.data?.pages.flat() ?? [];
  const shown = q
    ? all.filter((i) => `${i.user} ${i.actingAs ?? ''} ${i.summary} ${i.locationPath ?? ''}`.toLowerCase().includes(q))
    : all;
  const days: { label: string; items: ActivityItem[] }[] = [];
  for (const i of shown) {
    const label = dayLabel(i.at);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push(i);
  }

  return (
    <main className="content narrow">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted">Every change, newest first. Managers see changes inside their scope.</p>
        </div>
      </div>
      <input
        type="search"
        className="people-search"
        placeholder="Filter by person, change or place"
        aria-label="Filter activity"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ErrorNote error={items.error} />
      {items.isLoading && <p className="muted">Loading…</p>}
      {days.map((d) => (
        <section key={d.label} className="activity-day" aria-label={d.label}>
          <h2 className="h-caps">{d.label}</h2>
          <ol className="activity">
            {d.items.map((i) => {
              const to = linkOf(i);
              return (
                <li key={i.id}>
                  <time dateTime={i.at} title={new Date(i.at).toLocaleString()}>
                    {new Date(i.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </time>
                  <div>
                    <span className="strong">{i.user}</span>
                    {i.actingAs && <span className="muted"> (viewing as {i.actingAs})</span>} · {i.summary}
                    {i.locationPath && (
                      <div className="muted small">{to ? <Link to={to}>{i.locationPath}</Link> : i.locationPath}</div>
                    )}
                    {!i.locationPath && to && (
                      <div className="small">
                        <Link to={to}>Open</Link>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {items.data && shown.length === 0 && (
        <p className="muted">{q ? `Nothing matches “${filter.trim()}” in what is loaded.` : 'Nothing yet.'}</p>
      )}
      {items.hasNextPage && (
        <div>
          <button
            type="button"
            className="btn"
            onClick={() => void items.fetchNextPage()}
            disabled={items.isFetchingNextPage}
          >
            {items.isFetchingNextPage ? 'Loading…' : 'Show older changes'}
          </button>
        </div>
      )}
    </main>
  );
}
