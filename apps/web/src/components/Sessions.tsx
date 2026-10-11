import type { SessionInfo } from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useConfirm } from './ConfirmDialog';
import { ErrorNote, relativeTime } from './ui';

/** "Where you're signed in": every browser with a live session, and a way to end each one. */
export function SessionsSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionInfo[]>('/api/me/sessions') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['sessions'] });
  const end = useMutation({
    mutationFn: (s: SessionInfo) => api.del(`/api/me/sessions/${s.id}`),
    onSuccess: (_r, s) => (s.current ? window.location.assign('/login') : refresh()),
  });
  const others = useMutation({ mutationFn: () => api.post('/api/me/sessions/sign-out-others'), onSuccess: refresh });
  const sessions = list.data ?? [];
  const otherCount = sessions.filter((s) => !s.current).length;

  return (
    <section className="panel stack" aria-labelledby="sessions-h">
      <div className="row-between">
        <h2 id="sessions-h" className="h-caps">
          Where you’re signed in
        </h2>
        {otherCount > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={others.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Sign out everywhere else?',
                message: `Your ${otherCount} other ${otherCount === 1 ? 'sign-in ends' : 'sign-ins end'}. This browser stays signed in.`,
                confirmLabel: 'Sign out others',
              });
              if (ok) others.mutate();
            }}
          >
            Sign out everywhere else
          </button>
        )}
      </div>
      <ul className="session-list">
        {sessions.map((s) => (
          <li key={s.id}>
            <span className="cell-stack">
              <span className="strong">
                {s.device} {s.current && <span className="chip chip-ok">This browser</span>}
              </span>
              <span className="muted small">
                {[
                  s.ip,
                  s.method ? `signed in with ${s.method}` : null,
                  `last active ${s.current ? 'now' : relativeTime(s.lastSeenAt ?? s.createdAt).replace('Just now', 'just now')}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <button type="button" className="btn btn-sm" disabled={end.isPending} onClick={() => end.mutate(s)}>
              {s.current ? 'Sign out' : 'Sign out this one'}
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Lost a phone or used a shared computer? End that sign-in here.</p>
      <ErrorNote error={list.error ?? end.error ?? others.error} />
    </section>
  );
}
