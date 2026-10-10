import type { ActivityItem } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { ErrorNote, formatDate } from '../components/ui';

export function ActivityPage() {
  const items = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.get<ActivityItem[]>('/api/activity?limit=200'),
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

  return (
    <main className="content narrow">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted">Every change, newest first. Managers see changes inside their scope.</p>
        </div>
      </div>
      <ErrorNote error={items.error} />
      <ol className="activity">
        {(items.data ?? []).map((i) => (
          <li key={i.id}>
            <time dateTime={i.at}>{formatDate(i.at)}</time>
            <div>
              <span className="strong">{i.user}</span>
              {i.actingAs && <span className="muted"> (viewing as {i.actingAs})</span>} · {i.summary}
              {i.locationPath && <div className="muted small">{i.locationPath}</div>}
            </div>
          </li>
        ))}
      </ol>
      {items.data?.length === 0 && <p className="muted">Nothing yet.</p>}
    </main>
  );
}
