import { atLeast, type DuplicatePanelResponse, type PanelDetail } from '@cbt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote } from '../components/ui';
import { useLocations } from '../queries';
import { ancestry, buildTree } from '../tree';
import { siteOf } from './serves';

/** Copy this panel and its breakers into a room, e.g. for identical apartments. */
export function DuplicatePanel({ panel }: { panel: PanelDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const locations = useLocations();
  const { byId } = buildTree(locations.data ?? []);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${panel.name} (copy)`);
  const [roomId, setRoomId] = useState(panel.locationId);

  const rooms = [...byId.values()]
    .filter((n) => n.kind === 'room' && atLeast(n.role, 'editor'))
    .map((n) => ({
      id: n.id,
      label: ancestry(byId, n.id)
        .map((a) => a.name)
        .join(' › '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const tags = panel.breakers.reduce((n, b) => n + b.serves.filter((s) => s.name !== null).length, 0);
  const otherSite = siteOf(byId, roomId)?.id !== siteOf(byId, panel.locationId)?.id;

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);

  const copy = useMutation({
    mutationFn: () =>
      api.post<DuplicatePanelResponse>(`/api/panels/${panel.id}/duplicate`, { name, locationId: roomId }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['panels'] });
      setOpen(false);
      navigate(`/panels/${id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    copy.mutate();
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} disabled={rooms.length === 0}>
        Duplicate panel
      </button>
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby="duplicate-title"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        {open && (
          <form className="stack" onSubmit={submit}>
            <h2 id="duplicate-title">Duplicate {panel.name}</h2>
            <p className="muted">
              Copies the layout and all {panel.breakers.length} breakers with their labels, amps, flags and notes. The
              copy is not fed from anything until you set it.
            </p>
            <label className="field">
              <span className="field-label">Name of the copy</span>
              <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span className="field-label">Room</span>
              <select value={roomId} onChange={(e) => setRoomId(Number(e.target.value))}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {tags > 0 && (
              <p className="small muted">
                {otherSite
                  ? `That room is in another site, so the ${tags} room tag${tags === 1 ? '' : 's'} will be left off. Tag the new rooms after copying.`
                  : `The ${tags} room tag${tags === 1 ? '' : 's'} will be copied too.`}
              </p>
            )}
            <ErrorNote error={copy.error} />
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-dark" disabled={copy.isPending || !name.trim()}>
                Duplicate
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
