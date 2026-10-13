// The equipment register: AHU-1, EF-2, CT-1… with what feeds each, so "what feeds AHU-2?" is one
// look. A list with a filter, a page per item, cards on location pages, and room links suggested
// from breaker labels.

import {
  EQUIPMENT_KINDS,
  atLeast,
  type EquipmentDto,
  type EquipmentInput,
  type FeedOptions,
  type RoomLinkSuggestion,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { FeedChainStrip } from '../components/FeedChain';
import { ErrorNote, Field } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { useLocations } from '../queries';
import { ancestry, buildTree, type TreeNode } from '../tree';
import { FeedField } from './Devices';
import { useSwitchPlaces } from './Generators';
import { isInside } from './SitePanels';

export const useEquipment = () =>
  useQuery({ queryKey: ['equipment'], queryFn: () => api.get<EquipmentDto[]>('/api/equipment') });

type Feed = { breakerId: number | null; deviceId: number | null };
type Form = EquipmentInput & { feed: Feed };

const blank = (locationId: number): Form => ({
  tag: '',
  kind: '',
  description: '',
  locationId,
  hp: null,
  voltage: '',
  manufacturer: '',
  model: '',
  notes: '',
  feed: { breakerId: null, deviceId: null },
});

const detailLine = (e: EquipmentDto) =>
  [e.kind, e.description, e.hp ? `${e.hp} HP` : '', e.voltage].filter(Boolean).join(' · ');

/** Tag, kind, size, voltage, place and what feeds it. */
function EquipmentFields({
  form,
  setForm,
  current,
}: {
  form: Form;
  setForm: (f: Form) => void;
  current: string | null;
}) {
  const places = useSwitchPlaces();
  const options = useQuery({
    queryKey: ['feed-options', 'equipment'],
    queryFn: () => api.get<FeedOptions>('/api/feed-options'),
  });
  return (
    <div className="form-row">
      <Field label="Tag">
        <input
          required
          value={form.tag}
          maxLength={40}
          placeholder="e.g. AHU-1"
          onChange={(e) => setForm({ ...form, tag: e.target.value })}
        />
      </Field>
      <Field label="Kind">
        <input
          value={form.kind}
          maxLength={60}
          list="equipment-kinds"
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
        />
        <datalist id="equipment-kinds">
          {EQUIPMENT_KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </Field>
      <Field label="Description">
        <input
          value={form.description}
          maxLength={120}
          placeholder="e.g. Lab 110 supply"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      <Field label="HP">
        <input
          type="number"
          min={0}
          step="any"
          value={form.hp ?? ''}
          onChange={(e) => setForm({ ...form, hp: e.target.value ? Number(e.target.value) : null })}
        />
      </Field>
      <Field label="Voltage">
        <input
          value={form.voltage}
          maxLength={40}
          placeholder="e.g. 460 V 3-phase"
          onChange={(e) => setForm({ ...form, voltage: e.target.value })}
        />
      </Field>
      <Field label="Where">
        <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: Number(e.target.value) })}>
          {!places.some((p) => p.id === form.locationId) && <option value={form.locationId}>Current place</option>}
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <FeedField
        value={form.feed}
        options={options.data}
        current={current}
        onChange={(feed) => setForm({ ...form, feed })}
      />
    </div>
  );
}

const toBody = (f: Form) => {
  const { feed, ...rest } = f;
  return { ...rest, fedFromBreakerId: feed.breakerId, fedFromDeviceId: feed.deviceId };
};

/** "+ Add equipment" on a location page. */
export function AddEquipmentForm({ locationId }: { locationId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/equipment', toBody(form!)),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['equipment'] });
      navigate(`/equipment/${id}`);
    },
  });
  if (!form) {
    return (
      <button type="button" className="btn" onClick={() => setForm(blank(locationId))}>
        + Add equipment
      </button>
    );
  }
  return (
    <form
      className="panel stack"
      aria-label="Add equipment to the register"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2 className="h-caps">Add equipment</h2>
      <p className="muted small">
        Air handlers, fans, pumps, chillers… with the breaker or disconnect that feeds them, so anyone can find what
        feeds AHU-2 with one search.
      </p>
      <EquipmentFields form={form} setForm={setForm} current={null} />
      <div className="row">
        <button className="btn btn-dark" disabled={create.isPending}>
          Add equipment
        </button>
        <button type="button" className="btn" onClick={() => setForm(null)}>
          Cancel
        </button>
      </div>
      <ErrorNote error={create.error} />
    </form>
  );
}

/** Equipment at or inside a location, as a compact list. */
export function EquipmentHere({ node, byId }: { node: TreeNode; byId: Map<number, TreeNode> }) {
  const equipment = useEquipment();
  const here = (equipment.data ?? []).filter((e) => isInside(byId, e.locationId, node.id));
  if (here.length === 0) return null;
  return (
    <section className="stack" aria-label="Equipment">
      <h2 className="h-caps">
        Equipment <span className="muted">({here.length})</span>
      </h2>
      <EquipmentTable list={here.slice(0, 50)} />
      {here.length > 50 && (
        <Link to={`/equipment?loc=${node.id}`} className="small">
          See all {here.length}
        </Link>
      )}
    </section>
  );
}

function EquipmentTable({ list }: { list: EquipmentDto[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">What</th>
            <th scope="col">Where</th>
            <th scope="col">Fed from</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id}>
              <th scope="row">
                <Link to={`/equipment/${e.id}`} className="strong">
                  {e.tag}
                </Link>
              </th>
              <td className="small">{detailLine(e)}</td>
              <td className="small muted">{e.locationPath}</td>
              <td className="small">
                {e.fedFrom ?? <span className="muted">Not set</span>}
                {e.warnings.length > 0 && (
                  <span className="badge badge-warn" title={e.warnings.join(' ')}>
                    Check
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every piece of equipment the person can see, with a filter. */
export function EquipmentListPage() {
  useTitle('Equipment');
  const equipment = useEquipment();
  const locations = useLocations();
  const { byId } = useMemo(() => buildTree(locations.data ?? []), [locations.data]);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const loc = Number(params.get('loc')) || null;
  const needle = q.trim().toLowerCase();
  const list = (equipment.data ?? []).filter(
    (e) =>
      (!loc || isInside(byId, e.locationId, loc)) &&
      (!needle ||
        [e.tag, e.kind, e.description, e.locationPath, e.fedFrom ?? ''].some((t) => t.toLowerCase().includes(needle))),
  );
  return (
    <main className="content stack-lg">
      <div className="page-head">
        <div>
          <span className="eyebrow">Register</span>
          <h1>Equipment</h1>
          <p className="muted">Air handlers, fans, pumps and the rest, with what feeds each.</p>
        </div>
        <div className="toolbar">
          <Link className="btn" to="/meters">
            Meters
          </Link>
        </div>
      </div>
      <label className="field equipment-filter">
        <span className="field-label">Find</span>
        <input
          type="search"
          value={q}
          placeholder="Tag, kind, room or panel, e.g. AHU-2"
          onChange={(e) => setParams(e.target.value ? { q: e.target.value, ...(loc ? { loc: String(loc) } : {}) } : {})}
        />
      </label>
      <ErrorNote error={equipment.error} />
      {equipment.isLoading ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <div className="empty">
          <p>
            {needle
              ? 'Nothing matches.'
              : 'No equipment yet. Add it from a building or room page with "+ Add equipment".'}
          </p>
        </div>
      ) : (
        <EquipmentTable list={list} />
      )}
    </main>
  );
}

export function EquipmentPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const locations = useLocations();
  const { byId } = buildTree(locations.data ?? []);
  const detail = useQuery({
    queryKey: ['equipment', Number(id)],
    queryFn: () => api.get<EquipmentDto>(`/api/equipment/${id}`),
    retry: false,
  });
  const e = detail.data;
  useTitle(e?.tag ?? 'Equipment');
  const [form, setForm] = useState<Form | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['equipment', Number(id)] }),
      qc.invalidateQueries({ queryKey: ['equipment'] }),
    ]);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/equipment/${id}`, toBody(form!)),
    onSuccess: async () => {
      setForm(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/equipment/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['equipment'] });
      navigate(e ? `/?loc=${e.locationId}` : '/equipment');
    },
  });

  if (detail.isLoading) return <main className="content">Loading…</main>;
  if (!e) {
    return (
      <main className="content">
        <ErrorNote error={detail.error} />
      </main>
    );
  }
  return (
    <main className="content stack-lg">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/equipment">Equipment</Link>
        {ancestry(byId, e.locationId).map((c) => (
          <span key={c.id}>
            <span aria-hidden="true"> / </span>
            <Link to={`/?loc=${c.id}`}>{c.name}</Link>
          </span>
        ))}
      </nav>
      <div className="page-head">
        <div>
          <span className="eyebrow">{e.kind || 'Equipment'}</span>
          <h1>{e.tag}</h1>
          <p className="muted">
            {[e.description, e.hp ? `${e.hp} HP` : '', e.voltage, [e.manufacturer, e.model].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <FeedChainStrip chain={e.feedChain} here={e.tag} hereKind="equipment" />
        </div>
        {e.canEdit && !form && (
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              onClick={() => setForm({ ...e, feed: { breakerId: e.fedFromBreakerId, deviceId: e.fedFromDeviceId } })}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (
                  await confirm({
                    title: `Delete ${e.tag}?`,
                    message: 'It comes off the register. The breaker feeding it is not changed.',
                    confirmLabel: 'Delete',
                    danger: true,
                  })
                )
                  remove.mutate();
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {e.warnings.map((w) => (
        <p key={w} className="load-warning small" role="note">
          {w}
        </p>
      ))}
      <ErrorNote error={remove.error} />
      {form && (
        <form
          className="panel stack"
          aria-label={`Edit ${e.tag}`}
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <EquipmentFields form={form} setForm={setForm} current={e.fedFrom} />
          <div className="form-row">
            <Field label="Manufacturer">
              <input
                value={form.manufacturer}
                maxLength={80}
                onChange={(ev) => setForm({ ...form, manufacturer: ev.target.value })}
              />
            </Field>
            <Field label="Model">
              <input
                value={form.model}
                maxLength={80}
                onChange={(ev) => setForm({ ...form, model: ev.target.value })}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea rows={3} value={form.notes} onChange={(ev) => setForm({ ...form, notes: ev.target.value })} />
          </Field>
          <div className="row">
            <button className="btn btn-primary" disabled={save.isPending}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
          <ErrorNote error={save.error} />
        </form>
      )}
      {!form && e.notes && <p className="notes">{e.notes}</p>}
    </main>
  );
}

/**
 * Breakers whose label names a room they do not serve yet ("RECEPT ROOM 3002"), to accept in
 * bulk. Shown on site and building pages to editors.
 */
export function RoomLinkSuggestions({ node }: { node: TreeNode }) {
  const qc = useQueryClient();
  const suggestions = useQuery({
    queryKey: ['room-links', node.id],
    queryFn: () => api.get<RoomLinkSuggestion[]>(`/api/locations/${node.id}/room-links`),
    enabled: atLeast(node.role, 'editor'),
  });
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const list = suggestions.data ?? [];
  const key = (s: RoomLinkSuggestion) => `${s.breakerId}:${s.locationId}`;
  const accept = useMutation({
    mutationFn: () =>
      api.post<{ linked: number }>('/api/room-links', {
        links: list.filter((s) => !off.has(key(s))).map((s) => ({ breakerId: s.breakerId, locationId: s.locationId })),
      }),
    onSuccess: async () => {
      setOff(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['room-links', node.id] }),
        qc.invalidateQueries({ queryKey: ['served-by'] }),
      ]);
    },
  });
  if (list.length === 0) {
    return accept.data ? (
      <p className="small ok-note" role="status">
        Linked {accept.data.linked} breaker{accept.data.linked === 1 ? '' : 's'} to rooms.
      </p>
    ) : null;
  }
  const chosen = list.length - off.size;
  return (
    <section className="panel stack room-links" aria-label="Suggested room links">
      <div className="row space-between">
        <span>
          <strong>
            {list.length} breaker label{list.length === 1 ? '' : 's'}
          </strong>{' '}
          name a room the breaker does not serve yet.
        </span>
        <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Review'}
        </button>
      </div>
      {open && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Link</span>
                  </th>
                  <th scope="col">Breaker</th>
                  <th scope="col">Label</th>
                  <th scope="col">Room</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={key(s)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Link ${s.panelName} ${s.circuit} to ${s.roomName}`}
                        checked={!off.has(key(s))}
                        onChange={(ev) => {
                          const next = new Set(off);
                          if (ev.target.checked) next.delete(key(s));
                          else next.add(key(s));
                          setOff(next);
                        }}
                      />
                    </td>
                    <td className="small">
                      <Link to={`/panels/${s.panelId}`}>{s.panelName}</Link> · {s.circuit}
                    </td>
                    <td className="small">{s.label}</td>
                    <td className="small">
                      {s.roomName} <span className="muted">· {s.roomPath}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-dark"
              disabled={!chosen || accept.isPending}
              onClick={() => accept.mutate()}
            >
              Link {chosen} breaker{chosen === 1 ? '' : 's'} to {chosen === 1 ? 'its room' : 'their rooms'}
            </button>
            <span className="muted small">Each panel&apos;s history records the change.</span>
          </div>
          <ErrorNote error={accept.error} />
        </>
      )}
    </section>
  );
}
