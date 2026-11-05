import { ROLE_LABELS, type PendingInvite } from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useConfirm } from './ConfirmDialog';
import { ErrorNote, formatDate } from './ui';

/**
 * Invite links nobody has used yet, with a way to take each one back. With `locationId`, the
 * ones made for that location; without, every one in the places you manage.
 */
export function PendingInvites({ locationId }: { locationId?: number }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const all = locationId === undefined;
  const invites = useQuery({
    queryKey: ['invites', locationId ?? 'all'],
    queryFn: () => api.get<PendingInvite[]>(all ? '/api/invites' : `/api/locations/${locationId}/invites`),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api.del(`/api/invites/${id}`),
    // Both lists (this location's and everyone's) may show it.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  if (!invites.data?.length) return null;

  const ask = async (i: PendingInvite) => {
    const ok = await confirm({
      title: `Revoke this ${ROLE_LABELS[i.role]} invite?`,
      message: `${i.note ? `The invite for ${i.note}` : 'The invite'} to ${i.locationPath} stops working straight away. You can make a new one at any time.`,
      confirmLabel: 'Revoke invite',
      danger: true,
    });
    if (ok) revoke.mutate(i.id);
  };

  return (
    <section className={all ? 'panel stack' : 'stack'} aria-labelledby={`pending-invites-${locationId ?? 'all'}`}>
      <h3 id={`pending-invites-${locationId ?? 'all'}`}>
        {all ? `Pending invites (${invites.data.length})` : 'Unused invite links'}
      </h3>
      {all && <p className="muted small">Invite links that nobody has used yet, in the places you manage.</p>}
      <ul className="plain-list">
        {invites.data.map((i) => (
          <li key={i.id} className="row-between">
            <span>
              <span className="strong">
                {ROLE_LABELS[i.role]}
                {i.inviteLimit ? ` (can invite up to ${ROLE_LABELS[i.inviteLimit]})` : ''}
                {i.note ? ` for ${i.note}` : ''}
              </span>
              {all && <> · {i.locationPath}</>}
              <span className="muted small">
                {' '}
                · by {i.createdBy ?? 'someone'} {formatDate(i.createdAt)} · expires {formatDate(i.expiresAt)}
              </span>
            </span>
            {i.canRevoke ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void ask(i)}
                disabled={revoke.isPending && revoke.variables === i.id}
              >
                Revoke
              </button>
            ) : (
              <span className="muted small" title="It gives more access than you can hand out">
                Beyond your invite limit
              </span>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={revoke.error ?? invites.error} />
    </section>
  );
}
