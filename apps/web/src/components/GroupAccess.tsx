import { INVITE_LIMIT_LABELS, ROLES, ROLE_LABELS, type Role, type SsoGroupsResponse } from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { RoleFields } from '../pages/Access';
import { useConfirm } from './ConfirmDialog';
import { useGrantableLocations } from './ManageAccess';
import { ErrorNote, Field } from './ui';

/**
 * Settings → Single sign-on: give everyone in a group access to a location. People get it at
 * their next sign-in, when their groups are read; changing a rule applies to them at once.
 */
export function GroupAccess({ provider }: { provider: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const places = useGrantableLocations();
  const data = useQuery({
    queryKey: ['sso-groups'],
    queryFn: () => api.get<SsoGroupsResponse>('/api/admin/sso-groups'),
  });
  const [group, setGroup] = useState('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [role, setRole] = useState<Role>('viewer');
  const [limit, setLimit] = useState<Role>('viewer');
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['sso-groups'] }),
      qc.invalidateQueries({ queryKey: ['users'] }),
      qc.invalidateQueries({ queryKey: ['access'] }),
    ]);
  const add = useMutation({
    mutationFn: () =>
      api.post('/api/admin/sso-groups', {
        group,
        locationId,
        role,
        inviteLimit: role === 'manager' ? limit : null,
      }),
    onSuccess: async () => {
      setGroup('');
      setLocationId('');
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/sso-groups/${id}`),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const from = provider === 'single sign-on' ? 'your identity provider' : provider;

  return (
    <section className="stack group-access" aria-labelledby="group-access-h">
      <h3 id="group-access-h">Group access</h3>
      <p className="muted small">
        Give everyone in a group in {from} access to a location, as if each had a grant there. People pick it up when
        they sign in; changes here apply to them straight away. Access people were given by hand stays as it is.
      </p>
      {data.data && data.data.mappings.length > 0 ? (
        <ul className="access-list">
          {data.data.mappings.map((m) => (
            <li key={m.id}>
              <span className="cell-stack">
                <span className="strong">{m.group}</span>
                <span className="muted small">
                  {m.locationPath} · {m.members === 1 ? '1 person' : `${m.members} people`} so far
                </span>
              </span>
              <span className="row">
                <span className={`role role-${m.role}`}>{ROLE_LABELS[m.role]}</span>
                {m.role === 'manager' && (
                  <span className="muted small">{INVITE_LIMIT_LABELS[m.inviteLimit ?? 'viewer']}</span>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove the ${m.group} group's access to ${m.locationName}?`,
                      message: 'Its members lose this access now, unless something else gives it to them.',
                      confirmLabel: 'Remove',
                      danger: true,
                    });
                    if (ok) remove.mutate(m.id);
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        data.data && <p className="muted small">No groups have access yet.</p>
      )}
      <ErrorNote error={data.error ?? remove.error} />

      <form className="form-band" onSubmit={submit}>
        <div className="form-row">
          <Field label="Group">
            <input
              required
              list="known-sso-groups"
              value={group}
              maxLength={200}
              placeholder="e.g. Electricians"
              onChange={(e) => setGroup(e.target.value)}
            />
            <datalist id="known-sso-groups">
              {data.data?.knownGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <Field label="Location">
            <select
              required
              value={locationId}
              onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Choose…</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <RoleFields choices={[...ROLES]} role={role} limit={limit} setRole={setRole} setLimit={setLimit} />
          <button className="btn btn-dark" disabled={add.isPending}>
            Give access
          </button>
        </div>
        <ErrorNote error={add.error} />
      </form>
    </section>
  );
}
