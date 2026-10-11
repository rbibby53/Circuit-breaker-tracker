import {
  INVITE_LIMIT_LABELS,
  ROLES,
  ROLE_LABELS,
  atLeast,
  type AccessResponse,
  type Role,
  type UserListItem,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { InviteForm, RoleFields, rolesUpTo } from '../pages/Access';
import { useLocations } from '../queries';
import { ancestry, buildTree } from '../tree';
import { useConfirm } from './ConfirmDialog';
import { ErrorNote, Field } from './ui';

/** A modal dialog driven by `open`. */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog dialog-wide"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className="stack">
          <div className="row-between">
            <h2>{title}</h2>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Locations where the signed-in person can hand out access, labelled with their path. */
function useGrantableLocations() {
  const locations = useLocations();
  const { byId } = buildTree(locations.data ?? []);
  return [...byId.values()]
    .filter((n) => n.access === 'full' && atLeast(n.role, 'manager'))
    .filter((n) => !(n.kind === 'building' && n.isDefaultBuilding))
    .map((n) => ({
      id: n.id,
      label: ancestry(byId, n.id)
        .map((a) => a.name)
        .join(' › '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The roles the signed-in person may hand out at a location. */
function useCeiling(locationId: number | '') {
  const access = useQuery({
    queryKey: ['access', locationId],
    queryFn: () => api.get<AccessResponse>(`/api/locations/${locationId}/access`),
    enabled: locationId !== '',
  });
  return { choices: rolesUpTo(access.data?.ceiling ?? null), name: access.data?.location.name ?? '' };
}

/** Everything about one person's access, on one screen: change, remove, or add somewhere new. */
export function ManageAccess({ user, open, onClose }: { user: UserListItem; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const places = useGrantableLocations();
  const [locationId, setLocationId] = useState<number | ''>('');
  const [role, setRole] = useState<Role>('viewer');
  const [limit, setLimit] = useState<Role>('viewer');
  const { choices } = useCeiling(locationId);
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['access'] })]);

  const update = useMutation({
    mutationFn: (v: { id: number; role: Role; inviteLimit: Role | null }) =>
      api.patch(`/api/grants/${v.id}`, { role: v.role, inviteLimit: v.inviteLimit }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/grants/${id}`), onSuccess: refresh });
  const add = useMutation({
    mutationFn: () =>
      api.post(`/api/locations/${locationId}/grants`, {
        userId: user.id,
        role,
        inviteLimit: role === 'manager' ? limit : null,
      }),
    onSuccess: async () => {
      setLocationId('');
      await refresh();
    },
  });
  const already = new Set(user.grants.map((g) => g.locationId));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Access for ${user.displayName}`}>
      {user.isAdmin ? (
        <p>{user.displayName} is an admin and can see and change everything.</p>
      ) : user.grants.length === 0 ? (
        <p className="muted">No access anywhere you manage yet.</p>
      ) : (
        <ul className="access-list">
          {user.grants.map((g) => (
            <li key={g.id}>
              <span className="cell-stack">
                <span className="strong">{g.locationName}</span>
                <span className="muted small">{g.locationPath}</span>
              </span>
              {g.canManage ? (
                <span className="row">
                  <select
                    aria-label={`Role at ${g.locationName}`}
                    value={g.role}
                    onChange={(e) => {
                      const r = e.target.value as Role;
                      update.mutate({
                        id: g.id,
                        role: r,
                        inviteLimit: r === 'manager' ? (g.inviteLimit ?? 'viewer') : null,
                      });
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  {g.role === 'manager' && (
                    <select
                      aria-label={`Who they can invite at ${g.locationName}`}
                      value={g.inviteLimit ?? 'viewer'}
                      onChange={(e) => update.mutate({ id: g.id, role: g.role, inviteLimit: e.target.value as Role })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {INVITE_LIMIT_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Remove ${user.displayName}'s access to ${g.locationName}?`,
                        message: 'They lose access to it and everything inside it, unless they have access above it.',
                        confirmLabel: 'Remove',
                        danger: true,
                      });
                      if (ok) remove.mutate(g.id);
                    }}
                  >
                    Remove
                  </button>
                </span>
              ) : (
                <span className={`role role-${g.role}`}>{ROLE_LABELS[g.role]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={update.error ?? remove.error} />

      {!user.isAdmin && !user.disabled && places.length > 0 && (
        <form className="form-band" onSubmit={submit}>
          <h3>Give access somewhere</h3>
          <div className="form-row">
            <Field label="Location">
              <select
                required
                value={locationId}
                onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Choose…</option>
                {places
                  .filter((p) => !already.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </Field>
            {locationId !== '' && choices.length > 0 && (
              <RoleFields choices={choices} role={role} limit={limit} setRole={setRole} setLimit={setLimit} />
            )}
            <button className="btn btn-dark" disabled={add.isPending || locationId === ''}>
              Grant access
            </button>
          </div>
          <p className="muted small">Access covers the location and everything inside it.</p>
          <ErrorNote error={add.error} />
        </form>
      )}
    </Modal>
  );
}

/** Invite a new person from the People page: pick where, then the usual invite form. */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const places = useGrantableLocations();
  const [locationId, setLocationId] = useState<number | ''>('');
  const { choices, name } = useCeiling(locationId);
  return (
    <Modal open={open} onClose={onClose} title="Invite someone">
      <Field label="Where should they have access?">
        <select value={locationId} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Choose a location…</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {locationId !== '' && choices.length > 0 && (
        <InviteForm key={locationId} locationId={locationId} locationName={name} choices={choices} />
      )}
    </Modal>
  );
}
