import {
  INVITE_LIMIT_LABELS,
  KIND_LABELS,
  ROLES,
  ROLE_LABELS,
  atLeast,
  roleRank,
  type AccessResponse,
  type CreatedLink,
  type EffectiveRole,
  type GrantDto,
  type Role,
  type UserListItem,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { initials } from '../components/Layout';
import { LocationTree } from '../components/LocationTree';
import { ErrorNote, Field, LinkBox, formatDate } from '../components/ui';
import { buildTree } from '../tree';
import { useLocations } from './Sites';

const rolesUpTo = (ceiling: EffectiveRole | null): Role[] => ROLES.filter((r) => roleRank(r) <= roleRank(ceiling));

/** Start viewing as someone, then show the app through their eyes. */
export function useViewAs() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (userId: number) => api.post(`/api/admin/view-as/${userId}`),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/');
    },
  });
}

export function AccessPage() {
  const me = useCurrentUser();
  const locations = useLocations();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('loc') ? Number(params.get('loc')) : null;
  const select = (id: number) => setParams({ loc: String(id) });

  const { roots, byId } = buildTree(locations.data ?? []);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const canManageAnything = me.user.isAdmin || (locations.data ?? []).some((l) => l.role === 'manager');

  return (
    <div className="with-sidebar">
      <aside className="sidebar" aria-label="Location tree">
        <div className="sidebar-head">
          <span className="eyebrow">Pick a location</span>
        </div>
        <LocationTree
          roots={roots}
          selectedId={selectedId}
          onSelect={select}
          badge={(n) => (n.role === 'manager' && !me.user.isAdmin ? 'Manager' : null)}
        />
      </aside>
      <main className="content">
        <div className="page-head">
          <div>
            <h1>Users &amp; access</h1>
            <p className="muted">
              Give someone a role on any company, site, building, floor or room. It applies to everything inside it, and nothing else.
            </p>
          </div>
        </div>
        {!canManageAnything ? (
          <div className="empty">
            <p>Only managers and admins can share access. Ask a manager if someone needs to see a location.</p>
          </div>
        ) : !selected ? (
          <div className="empty">
            <p>Pick a location on the left to see who can see it and to invite people.</p>
          </div>
        ) : !(me.user.isAdmin || atLeast(selected.role, 'manager')) ? (
          <div className="empty">
            <p>You don't manage {selected.name}, so you can't see or change who has access to it.</p>
          </div>
        ) : (
          <LocationAccess key={selected.id} locationId={selected.id} onSelect={select} />
        )}
        <RulesAndRoles />
      </main>
    </div>
  );
}

function LocationAccess({ locationId, onSelect }: { locationId: number; onSelect: (id: number) => void }) {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['access', locationId],
    queryFn: () => api.get<AccessResponse>(`/api/locations/${locationId}/access`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['access', locationId] });
  const viewAs = useViewAs();

  const update = useMutation({
    mutationFn: (v: { id: number; role: Role; inviteLimit: Role | null }) =>
      api.patch(`/api/grants/${v.id}`, { role: v.role, inviteLimit: v.inviteLimit }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/grants/${id}`), onSuccess: invalidate });

  if (data.isLoading) return <div className="page-loading">Loading…</div>;
  if (data.error) return <ErrorNote error={data.error} />;
  const a = data.data!;
  const readOnly = me.viewingAs;
  const canViewAs = me.realUser.isAdmin && !me.viewingAs;
  const choices = rolesUpTo(a.ceiling);

  const changeRole = (g: GrantDto, role: Role) =>
    update.mutate({ id: g.id, role, inviteLimit: role === 'manager' ? (g.inviteLimit ?? 'viewer') : null });

  return (
    <section className="panel stack-lg">
      <div>
        <span className="eyebrow">{a.location.path.split(' › ').slice(0, -1).join(' › ') || 'Top level'}</span>
        <h2 className="h-xl">
          {a.location.name} <span className="muted h-sub">{KIND_LABELS[a.location.kind]}</span>
        </h2>
      </div>

      <div className="table-wrap">
        <table className="table">
          <caption>Who can see this {KIND_LABELS[a.location.kind].toLowerCase()}</caption>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Can invite</th>
              <th>Granted on</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {a.admins.map((u) => (
              <tr key={`admin-${u.id}`}>
                <td>
                  <Person name={u.displayName} sub={u.username} />
                </td>
                <td>
                  <span className="role role-admin">Admin</span>
                </td>
                <td>Anyone</td>
                <td>Everywhere</td>
                <td />
              </tr>
            ))}
            {a.applies.map((g) => (
              <tr key={g.id}>
                <td>
                  <Person name={g.user.displayName} sub={g.user.username} />
                </td>
                <td>
                  {g.canManage && !readOnly ? (
                    <select aria-label={`Role for ${g.user.displayName}`} value={g.role} onChange={(e) => changeRole(g, e.target.value as Role)}>
                      {choices.concat(choices.includes(g.role) ? [] : [g.role]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`role role-${g.role}`}>{ROLE_LABELS[g.role]}</span>
                  )}
                </td>
                <td>
                  {g.role !== 'manager' ? (
                    <span className="muted">—</span>
                  ) : g.canManage && !readOnly ? (
                    <select
                      aria-label={`Invite limit for ${g.user.displayName}`}
                      value={g.inviteLimit ?? 'viewer'}
                      onChange={(e) => update.mutate({ id: g.id, role: 'manager', inviteLimit: e.target.value as Role })}
                    >
                      {choices.map((r) => (
                        <option key={r} value={r}>
                          {INVITE_LIMIT_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    INVITE_LIMIT_LABELS[g.inviteLimit ?? 'viewer']
                  )}
                </td>
                <td>
                  <div className="cell-stack">
                    <span className="strong">{g.locationName}</span>
                    <span className="muted small">{g.inherited ? `Inherited from ${KIND_LABELS[g.locationKind].toLowerCase()}` : 'Granted here'}</span>
                  </div>
                </td>
                <td className="actions">
                  {canViewAs && g.user.id !== me.realUser.id && (
                    <button className="btn btn-sm btn-outline" onClick={() => viewAs.mutate(g.user.id)}>
                      View as
                    </button>
                  )}
                  {g.inherited ? (
                    <button className="btn btn-sm btn-link" onClick={() => onSelect(g.locationId)}>
                      Go to grant
                    </button>
                  ) : (
                    g.canManage &&
                    !readOnly && (
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          if (confirm(`Remove ${g.user.displayName}'s access here?`)) remove.mutate(g.id);
                        }}
                      >
                        Remove
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote error={update.error ?? remove.error ?? viewAs.error} />

      {a.inside.length > 0 && (
        <div className="subtle-box">
          <span className="strong">Also has access to parts inside</span>
          <ul className="plain-list">
            {a.inside.map((g) => (
              <li key={g.id}>
                {g.user.displayName} · {ROLE_LABELS[g.role]} on{' '}
                <button className="link-btn" onClick={() => onSelect(g.locationId)}>
                  {g.locationName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && (
        <>
          <InviteForm locationId={locationId} locationName={a.location.name} choices={choices} />
          <AddExistingForm locationId={locationId} choices={choices} existing={a.applies.filter((g) => !g.inherited).map((g) => g.user.id)} />
          <PendingInvites locationId={locationId} />
        </>
      )}
    </section>
  );
}

function Person({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="person">
      <span className="avatar avatar-light" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="cell-stack">
        <span className="strong">{name}</span>
        <span className="muted small">{sub}</span>
      </span>
    </div>
  );
}

function RoleFields({
  choices,
  role,
  limit,
  setRole,
  setLimit,
}: {
  choices: Role[];
  role: Role;
  limit: Role;
  setRole: (r: Role) => void;
  setLimit: (r: Role) => void;
}) {
  return (
    <>
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {choices.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      {role === 'manager' && (
        <Field label="Can invite">
          <select value={limit} onChange={(e) => setLimit(e.target.value as Role)}>
            {choices.map((r) => (
              <option key={r} value={r}>
                {INVITE_LIMIT_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

function InviteForm({ locationId, locationName, choices }: { locationId: number; locationName: string; choices: Role[] }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>('viewer');
  const [limit, setLimit] = useState<Role>('viewer');
  const [note, setNote] = useState('');
  const [link, setLink] = useState<CreatedLink | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post<CreatedLink>(`/api/locations/${locationId}/invites`, {
        role,
        inviteLimit: role === 'manager' ? limit : null,
        note: note || undefined,
      }),
    onSuccess: (l) => {
      setLink(l);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['invites', locationId] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form className="form-band" onSubmit={submit}>
      <h3>Invite someone new</h3>
      <div className="form-row">
        <Field label="Who is it for? (optional, for your records)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Mum, or a coworker's name" />
        </Field>
        <RoleFields choices={choices} role={role} limit={limit} setRole={setRole} setLimit={setLimit} />
        <button className="btn btn-dark" disabled={create.isPending}>
          Create invite link
        </button>
      </div>
      <p className="muted small">
        Applies to {locationName} and everything inside it. They can create a password or sign in with Microsoft.
      </p>
      <ErrorNote error={create.error} />
      {link && <LinkBox url={link.url} expiresAt={link.expiresAt} onClose={() => setLink(null)} />}
    </form>
  );
}

function AddExistingForm({ locationId, choices, existing }: { locationId: number; choices: Role[]; existing: number[] }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserListItem[]>('/api/users') });
  const [userId, setUserId] = useState<number | ''>('');
  const [role, setRole] = useState<Role>('viewer');
  const [limit, setLimit] = useState<Role>('viewer');
  const add = useMutation({
    mutationFn: () =>
      api.post(`/api/locations/${locationId}/grants`, { userId, role, inviteLimit: role === 'manager' ? limit : null }),
    onSuccess: async () => {
      setUserId('');
      await qc.invalidateQueries({ queryKey: ['access', locationId] });
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const options = (users.data ?? []).filter((u) => !u.isAdmin && !u.disabled && !existing.includes(u.id));
  if (options.length === 0) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form className="form-band" onSubmit={submit}>
      <h3>Add someone who already has an account</h3>
      <div className="form-row">
        <Field label="Person">
          <select required value={userId} onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Choose…</option>
            {options.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.username})
              </option>
            ))}
          </select>
        </Field>
        <RoleFields choices={choices} role={role} limit={limit} setRole={setRole} setLimit={setLimit} />
        <button className="btn btn-dark" disabled={add.isPending || userId === ''}>
          Grant access
        </button>
      </div>
      <ErrorNote error={add.error} />
    </form>
  );
}

function PendingInvites({ locationId }: { locationId: number }) {
  const qc = useQueryClient();
  const invites = useQuery({
    queryKey: ['invites', locationId],
    queryFn: () =>
      api.get<{ id: number; role: Role; inviteLimit: Role | null; note: string | null; expiresAt: string; createdBy: string | null }[]>(
        `/api/locations/${locationId}/invites`,
      ),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api.del(`/api/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', locationId] }),
  });
  if (!invites.data?.length) return null;
  return (
    <div className="stack">
      <h3>Unused invite links</h3>
      <ul className="plain-list">
        {invites.data.map((i) => (
          <li key={i.id} className="row-between">
            <span>
              {ROLE_LABELS[i.role]}
              {i.note ? ` for ${i.note}` : ''} · by {i.createdBy ?? 'someone'} · expires {formatDate(i.expiresAt)}
            </span>
            <button className="btn btn-sm" onClick={() => revoke.mutate(i.id)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={revoke.error} />
    </div>
  );
}

function RulesAndRoles() {
  return (
    <div className="card-grid two">
      <section className="panel stack">
        <h3 className="h-caps">Rules</h3>
        <ol className="rules">
          <li>A grant covers its location and everything inside it, never the locations around it.</li>
          <li>Someone with several grants gets the strongest role at each place.</li>
          <li>A manager can only grant access inside their own scope, and only up to their invite limit.</li>
          <li>Nobody but an admin can see a company they were never given a role in.</li>
          <li>View as shows exactly what that person sees, read-only, and is logged.</li>
        </ol>
      </section>
      <section className="panel stack">
        <h3 className="h-caps">Roles</h3>
        <dl className="roles">
          <dt>Viewer</dt>
          <dd>See panels, search, print PDFs</dd>
          <dt>Editor</dt>
          <dd>Viewer, plus edit breakers, rooms, floors and panels</dd>
          <dt>Manager</dt>
          <dd>Editor, plus invite people within their scope, up to their invite limit</dd>
          <dt>Admin</dt>
          <dd>Everything everywhere: all companies, users, backups</dd>
        </dl>
      </section>
    </div>
  );
}
