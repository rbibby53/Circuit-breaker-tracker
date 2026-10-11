import { ROLE_LABELS, type CreatedLink, type UserListItem } from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useCurrentUser } from '../auth';
import { useConfirm } from '../components/ConfirmDialog';
import { useTitle } from '../lib/useTitle';
import { Avatar } from '../components/Avatar';
import { InviteDialog, ManageAccess } from '../components/ManageAccess';
import { ErrorNote, LinkBox, relativeTime } from '../components/ui';
import { useViewAs } from './Access';

export function UsersPage() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserListItem[]>('/api/users'), retry: false });
  const viewAs = useViewAs();
  const confirm = useConfirm();
  useTitle('People');
  const [link, setLink] = useState<{ name: string; link: CreatedLink } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const resetLink = useMutation({
    mutationFn: (u: UserListItem) =>
      api.post<CreatedLink>(`/api/users/${u.id}/reset-link`).then((l) => ({ name: u.displayName, link: l })),
    onSuccess: setLink,
  });
  const update = useMutation({
    mutationFn: (v: { id: number; body: object }) => api.patch(`/api/users/${v.id}`, v.body),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/users/${id}`), onSuccess: invalidate });
  const totpOff = useMutation({ mutationFn: (id: number) => api.del(`/api/users/${id}/totp`), onSuccess: invalidate });

  if (users.error instanceof ApiError && users.error.status === 403) {
    return (
      <main className="content narrow">
        <h1>People</h1>
        <div className="empty">
          <p>Only managers and admins can see the people list.</p>
        </div>
      </main>
    );
  }

  const isAdmin = me.user.isAdmin && !me.viewingAs;
  const q = query.trim().toLowerCase();
  const shown = (users.data ?? []).filter(
    (u) =>
      !q ||
      [u.displayName, u.username, u.email ?? '', ...u.grants.map((g) => g.locationPath)]
        .join(' ')
        .toLowerCase()
        .includes(q),
  );
  const managed = users.data?.find((u) => u.id === managing) ?? null;
  const canViewAs = me.realUser.isAdmin && !me.viewingAs;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">
            {me.user.isAdmin
              ? 'Everyone with an account.'
              : 'People with access somewhere you manage. You only see their access inside your scope.'}
          </p>
        </div>
        <button type="button" className="btn btn-dark" onClick={() => setInviting(true)}>
          Invite someone
        </button>
      </div>
      {link && (
        <div className="panel stack">
          <span className="strong">Password reset link for {link.name}</span>
          <LinkBox url={link.link.url} expiresAt={link.link.expiresAt} onClose={() => setLink(null)} />
        </div>
      )}
      <ErrorNote
        error={users.error ?? resetLink.error ?? update.error ?? remove.error ?? totpOff.error ?? viewAs.error}
      />
      <input
        type="search"
        className="people-search"
        placeholder="Find someone by name, username, email or location"
        aria-label="Find someone"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {managed && <ManageAccess user={managed} open onClose={() => setManaging(null)} />}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Signs in with</th>
              <th>Access</th>
              <th>Last seen</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.disabled ? 'is-disabled' : undefined}>
                <td>
                  <div className="person">
                    <Avatar name={u.displayName} url={u.avatarUrl} light />
                    <span className="cell-stack">
                      <span className="strong">
                        {u.displayName} {u.isAdmin && <span className="role role-admin">Admin</span>}
                        {u.disabled && <span className="role">Disabled</span>}
                      </span>
                      <span className="muted small">
                        {u.username}
                        {u.email ? ` · ${u.email}` : ''}
                      </span>
                    </span>
                  </div>
                </td>
                <td>
                  {[
                    u.hasPassword ? (u.totp ? 'Password + code' : 'Password') : null,
                    u.identities.length ? 'Microsoft' : null,
                  ]
                    .filter(Boolean)
                    .join(' + ') || '—'}
                </td>
                <td>
                  {u.isAdmin ? (
                    'Everywhere'
                  ) : u.grants.length === 0 ? (
                    <span className="muted">No access</span>
                  ) : (
                    <ul className="grant-list">
                      {u.grants.map((g) => (
                        <li key={g.id}>
                          <span className={`role role-${g.role}`}>{ROLE_LABELS[g.role]}</span>{' '}
                          <Link to={`/access?loc=${g.locationId}`}>{g.locationPath}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>{relativeTime(u.lastSeenAt)}</td>
                <td className="actions">
                  {!u.isAdmin && !me.viewingAs && (
                    <button className="btn btn-sm btn-dark" onClick={() => setManaging(u.id)}>
                      Manage access
                    </button>
                  )}
                  {canViewAs && u.id !== me.realUser.id && (
                    <button className="btn btn-sm btn-outline" onClick={() => viewAs.mutate(u.id)}>
                      View as
                    </button>
                  )}
                  {u.canReset && u.id !== me.realUser.id && !me.viewingAs && (
                    <button className="btn btn-sm" onClick={() => resetLink.mutate(u)}>
                      Reset link
                    </button>
                  )}
                  {u.canReset && u.totp && u.id !== me.realUser.id && !me.viewingAs && (
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Turn off two-step sign-in for ${u.displayName}?`,
                          message:
                            'For when they have lost their phone. They can sign in with just their password and set it up again under Account.',
                          confirmLabel: 'Turn off',
                          danger: true,
                        });
                        if (ok) totpOff.mutate(u.id);
                      }}
                    >
                      Turn off 2-step
                    </button>
                  )}
                  {isAdmin && u.id !== me.realUser.id && (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() => update.mutate({ id: u.id, body: { isAdmin: !u.isAdmin } })}
                      >
                        {u.isAdmin ? 'Remove admin' : 'Make admin'}
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => update.mutate({ id: u.id, body: { disabled: !u.disabled } })}
                      >
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Delete ${u.displayName}?`,
                            message: 'Their account and all their access are removed. This cannot be undone.',
                            confirmLabel: 'Delete',
                            danger: true,
                          });
                          if (ok) remove.mutate(u.id);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
