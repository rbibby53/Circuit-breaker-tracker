// Meters: the site's own meters on switchgear, panels and circuits. A list, a page for each with
// its details and field check, an add/edit form, and the short lists shown on panels, devices
// and location pages.

import {
  METER_PROTOCOLS,
  METER_PROTOCOL_LABELS,
  POWER_DEVICE_LABELS,
  VERIFY_LABELS,
  circuitLabel,
  type MeterDto,
  type MeterInput,
  type MeterSummary,
  type PanelDetail,
  type VerifyStatus,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { NodeIcon } from '../components/PowerIcon';
import { ErrorNote, Field, formatDate } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { useLocations, usePanels, usePowerDevices } from '../queries';
import { ancestry, buildTree, type TreeNode } from '../tree';
import { useSwitchPlaces } from './Generators';
import { isInside } from './SitePanels';

export const useMeters = () => useQuery({ queryKey: ['meters'], queryFn: () => api.get<MeterDto[]>('/api/meters') });

const checkText = (m: Pick<MeterSummary, 'verifyStatus' | 'verifiedBy' | 'verifiedAt'>) =>
  m.verifyStatus
    ? `${VERIFY_LABELS[m.verifyStatus]}${m.verifiedBy ? ` by ${m.verifiedBy}` : ''}${m.verifiedAt ? ` on ${formatDate(m.verifiedAt)}` : ''}`
    : 'Not checked';

function CheckMark({ status }: { status: VerifyStatus }) {
  if (!status) return null;
  return (
    <span className={`badge ${status === 'verified' ? 'badge-ups' : 'badge-crit'}`}>
      {status === 'verified' ? '✓ Verified' : '✗ Wrong'}
    </span>
  );
}

/** The meters on a panel, breaker or device, with a way to add one there. */
export function MetersOn({
  meters,
  add,
  canAdd,
  title = 'Meters',
}: {
  meters: MeterSummary[];
  add: { panelId?: number; breakerId?: number; deviceId?: number; locationId: number };
  canAdd: boolean;
  title?: string;
}) {
  if (meters.length === 0 && !canAdd) return null;
  const q = new URLSearchParams({ loc: String(add.locationId) });
  if (add.panelId) q.set('panel', String(add.panelId));
  if (add.breakerId) q.set('breaker', String(add.breakerId));
  if (add.deviceId) q.set('device', String(add.deviceId));
  return (
    <section className="meters-on stack-sm" aria-label={title}>
      <div className="row space-between">
        <h2 className="h-caps">{title}</h2>
        {canAdd && (
          <Link className="btn btn-sm" to={`/meters/new?${q}`}>
            + Add a meter
          </Link>
        )}
      </div>
      {meters.length === 0 ? (
        <p className="muted small">None recorded.</p>
      ) : (
        <ul className="meter-chips">
          {meters.map((m) => (
            <li key={m.id}>
              <NodeIcon kind="meter" size={16} />
              <Link to={`/meters/${m.id}`} className="strong">
                {m.name}
              </Link>
              <span className="muted small">
                {[m.meterNumber && `#${m.meterNumber}`, m.measures].filter(Boolean).join(' · ')}
              </span>
              <CheckMark status={m.verifyStatus} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Meters at or inside a location, as cards. */
export function MetersHere({ node, byId }: { node: TreeNode; byId: Map<number, TreeNode> }) {
  const meters = useMeters();
  const here = (meters.data ?? []).filter((m) => isInside(byId, m.locationId, node.id));
  if (here.length === 0) return null;
  return (
    <section className="stack" aria-label="Meters">
      <h2 className="h-caps">Meters</h2>
      <div className="card-grid">
        {here.map((m) => (
          <Link key={m.id} to={`/meters/${m.id}`} className="card panel-card">
            <span className="gen-icon device-icon dev-meter" aria-hidden="true">
              <NodeIcon kind="meter" />
            </span>
            <span className="stack-sm">
              <span className="card-title">{m.name}</span>
              <span className="small">{m.measures || 'Not on anything yet'}</span>
              <span className="small muted">
                {[m.meterNumber && `#${m.meterNumber}`, checkText(m)].filter(Boolean).join(' · ')}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

type Target = 'none' | 'panel' | 'breaker' | 'device';

const blank = (locationId: number): MeterInput => ({
  name: '',
  locationId,
  meterNumber: '',
  manufacturer: '',
  model: '',
  serial: '',
  ctRatio: '',
  ptRatio: '',
  multiplier: null,
  protocol: '',
  address: '',
  notes: '',
  panelId: null,
  breakerId: null,
  deviceId: null,
});

/** The meter's details and what it measures: nothing yet, a panel's main, a breaker or a device. */
function MeterForm({
  initial,
  breakerPanelId,
  onSave,
  onCancel,
  saving,
  error,
  label,
}: {
  initial: MeterInput;
  breakerPanelId: number | null;
  onSave: (m: MeterInput) => void;
  onCancel: () => void;
  saving: boolean;
  error: unknown;
  label: string;
}) {
  const [form, setForm] = useState(initial);
  const [target, setTarget] = useState<Target>(
    initial.breakerId ? 'breaker' : initial.panelId ? 'panel' : initial.deviceId ? 'device' : 'none',
  );
  const [panelForBreaker, setPanelForBreaker] = useState<number | null>(breakerPanelId);
  const places = useSwitchPlaces();
  const panels = usePanels();
  const devices = usePowerDevices();
  const breakers = useQuery({
    queryKey: ['panel', panelForBreaker, 'for-meter'],
    queryFn: () => api.get<PanelDetail>(`/api/panels/${panelForBreaker}`),
    enabled: target === 'breaker' && panelForBreaker !== null,
  });
  const set = (patch: Partial<MeterInput>) => setForm({ ...form, ...patch });
  const choose = (t: Target) => {
    setTarget(t);
    set({ panelId: null, breakerId: null, deviceId: null });
  };
  const panelList = (panels.data ?? []).filter((p) => p.layout !== 'relay');
  return (
    <form
      className="panel stack"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <div className="form-row">
        <Field label="Name">
          <input
            required
            maxLength={60}
            value={form.name}
            placeholder="e.g. M-MSB1"
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label="Where">
          <select value={form.locationId} onChange={(e) => set({ locationId: Number(e.target.value) })}>
            {!places.some((p) => p.id === form.locationId) && <option value={form.locationId}>Current place</option>}
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="field">
        <legend className="field-label">What it measures</legend>
        <div className="segmented four" role="group" aria-label="What it measures">
          {(
            [
              ['none', 'Not set'],
              ['panel', "A panel's main"],
              ['breaker', 'A breaker'],
              ['device', 'Cube or transformer'],
            ] as [Target, string][]
          ).map(([t, text]) => (
            <button key={t} type="button" aria-pressed={target === t} onClick={() => choose(t)}>
              {text}
            </button>
          ))}
        </div>
        <span className="muted small">
          A meter fed from a breaker measures that circuit. One on a switchboard or panel main measures the whole panel.
        </span>
      </fieldset>
      <div className="form-row">
        {target === 'panel' && (
          <Field label="Panel">
            <select
              required
              value={form.panelId ?? ''}
              onChange={(e) => set({ panelId: Number(e.target.value) || null })}
            >
              <option value="">Choose a panel…</option>
              {panelList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {target === 'breaker' && (
          <>
            <Field label="Panel">
              <select
                required
                value={panelForBreaker ?? ''}
                onChange={(e) => {
                  setPanelForBreaker(Number(e.target.value) || null);
                  set({ breakerId: null });
                }}
              >
                <option value="">Choose a panel…</option>
                {panelList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Breaker">
              <select
                required
                value={form.breakerId ?? ''}
                disabled={!breakers.data}
                onChange={(e) => set({ breakerId: Number(e.target.value) || null })}
              >
                <option value="">Choose a breaker…</option>
                {(breakers.data?.breakers ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {circuitLabel(breakers.data!, b)} {b.label || 'Unlabelled'} ({b.amps}A)
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {target === 'device' && (
          <Field label="Switching cube, transformer or other device">
            <select
              required
              value={form.deviceId ?? ''}
              onChange={(e) => set({ deviceId: Number(e.target.value) || null })}
            >
              <option value="">Choose…</option>
              {(devices.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {POWER_DEVICE_LABELS[d.kind]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="form-row">
        <Field label="Meter number">
          <input value={form.meterNumber} maxLength={60} onChange={(e) => set({ meterNumber: e.target.value })} />
        </Field>
        <Field label="Manufacturer">
          <input
            value={form.manufacturer}
            maxLength={80}
            placeholder="e.g. Schneider"
            onChange={(e) => set({ manufacturer: e.target.value })}
          />
        </Field>
        <Field label="Model">
          <input
            value={form.model}
            maxLength={80}
            placeholder="e.g. PM5560"
            onChange={(e) => set({ model: e.target.value })}
          />
        </Field>
        <Field label="Serial">
          <input value={form.serial} maxLength={60} onChange={(e) => set({ serial: e.target.value })} />
        </Field>
        <Field label="CT ratio">
          <input
            value={form.ctRatio}
            maxLength={30}
            placeholder="e.g. 2000:5"
            onChange={(e) => set({ ctRatio: e.target.value })}
          />
        </Field>
        <Field label="PT ratio">
          <input
            value={form.ptRatio}
            maxLength={30}
            placeholder="e.g. 480:120"
            onChange={(e) => set({ ptRatio: e.target.value })}
          />
        </Field>
        <Field label="Multiplier">
          <input
            type="number"
            min={0}
            step="any"
            value={form.multiplier ?? ''}
            onChange={(e) => set({ multiplier: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
        <Field label="Communication">
          <select value={form.protocol} onChange={(e) => set({ protocol: e.target.value as MeterInput['protocol'] })}>
            {METER_PROTOCOLS.map((p) => (
              <option key={p} value={p}>
                {METER_PROTOCOL_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        {form.protocol && (
          <Field label="Address">
            <input
              value={form.address}
              maxLength={120}
              placeholder="e.g. 10.1.4.20, unit 3"
              onChange={(e) => set({ address: e.target.value })}
            />
          </Field>
        )}
      </div>
      <Field label="Notes">
        <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      <div className="row">
        <button className="btn btn-primary" disabled={saving}>
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

/** /meters/new?loc=&panel=&breaker=&device= */
export function NewMeterPage() {
  useTitle('Add a meter');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const n = (k: string) => Number(params.get(k)) || null;
  // From a breaker, ?panel= is the panel it is in (for picking), not the meter's target.
  const initial = {
    ...blank(n('loc') ?? 0),
    panelId: n('breaker') ? null : n('panel'),
    breakerId: n('breaker'),
    deviceId: n('device'),
  };
  const create = useMutation({
    mutationFn: (m: MeterInput) => api.post<{ id: number }>('/api/meters', m),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['meters'] });
      navigate(`/meters/${id}`, { replace: true });
    },
  });
  return (
    <main className="content stack-lg">
      <div className="page-head">
        <div>
          <span className="eyebrow">Meters</span>
          <h1>Add a meter</h1>
        </div>
      </div>
      <MeterForm
        initial={initial}
        breakerPanelId={n('breaker') ? n('panel') : null}
        onSave={(m) => create.mutate(m)}
        onCancel={() => navigate(-1)}
        saving={create.isPending}
        error={create.error}
        label="Add a meter"
      />
    </main>
  );
}

export function MeterPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const locations = useLocations();
  const { byId } = buildTree(locations.data ?? []);
  const meter = useQuery({
    queryKey: ['meter', Number(id)],
    queryFn: () => api.get<MeterDto>(`/api/meters/${id}`),
    retry: false,
  });
  const m = meter.data;
  useTitle(m?.name ?? 'Meter');
  const [editing, setEditing] = useState(false);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['meter', Number(id)] }),
      qc.invalidateQueries({ queryKey: ['meters'] }),
    ]);
  const save = useMutation({
    mutationFn: (body: MeterInput) => api.put(`/api/meters/${id}`, body),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const verify = useMutation({
    mutationFn: (status: VerifyStatus) => api.post<MeterDto>(`/api/meters/${id}/verify`, { status }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/meters/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['meters'] });
      navigate(m ? `/?loc=${m.locationId}` : '/meters');
    },
  });
  if (meter.isLoading) return <main className="content">Loading…</main>;
  if (!m) {
    return (
      <main className="content">
        <ErrorNote error={meter.error} />
      </main>
    );
  }
  const measuresLink = m.breakerPanelId
    ? `/panels/${m.breakerPanelId}`
    : m.panelId
      ? `/panels/${m.panelId}`
      : m.deviceId
        ? `/devices/${m.deviceId}`
        : null;
  const details: [string, string][] = [
    ['Meter number', m.meterNumber],
    ['Make and model', [m.manufacturer, m.model].filter(Boolean).join(' ')],
    ['Serial', m.serial],
    ['CT ratio', m.ctRatio],
    ['PT ratio', m.ptRatio],
    ['Multiplier', m.multiplier !== null ? `× ${m.multiplier}` : ''],
    ['Communication', m.protocol ? [METER_PROTOCOL_LABELS[m.protocol], m.address].filter(Boolean).join(' · ') : ''],
  ];
  return (
    <main className="content stack-lg">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/meters">Meters</Link>
        {ancestry(byId, m.locationId).map((c) => (
          <span key={c.id}>
            <span aria-hidden="true"> / </span>
            <Link to={`/?loc=${c.id}`}>{c.name}</Link>
          </span>
        ))}
      </nav>
      <div className="page-head">
        <div>
          <span className="eyebrow">Meter</span>
          <h1>{m.name}</h1>
          <p className="muted">
            Measures{' '}
            {m.measures ? (
              measuresLink ? (
                <Link to={measuresLink}>{m.measures}</Link>
              ) : (
                m.measures
              )
            ) : (
              'nothing recorded yet'
            )}
          </p>
        </div>
        {m.canEdit && !editing && (
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (await confirm({ title: `Delete ${m.name}?`, confirmLabel: 'Delete', danger: true }))
                  remove.mutate();
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <ErrorNote error={remove.error} />
      {editing ? (
        <MeterForm
          initial={{ ...m }}
          breakerPanelId={m.breakerPanelId}
          onSave={(body) => save.mutate(body)}
          onCancel={() => setEditing(false)}
          saving={save.isPending}
          error={save.error}
          label={`Edit ${m.name}`}
        />
      ) : (
        <>
          <section className="panel stack-sm" aria-label="Field check">
            <h2 className="h-caps">Field check</h2>
            <p>
              <CheckMark status={m.verifyStatus} /> {checkText(m)}
            </p>
            {m.canEdit && (
              <div className="segmented three" role="group" aria-label="Set the field check">
                {(['verified', 'wrong', ''] as VerifyStatus[]).map((s) => (
                  <button
                    key={s || 'none'}
                    type="button"
                    aria-pressed={m.verifyStatus === s}
                    disabled={verify.isPending}
                    onClick={() => verify.mutate(s)}
                  >
                    {VERIFY_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
            <ErrorNote error={verify.error} />
          </section>
          {details.some(([, v]) => v) && (
            <dl className="facts about">
              {details
                .filter(([, v]) => v)
                .flatMap(([k, v]) => [<dt key={`${k}-t`}>{k}</dt>, <dd key={`${k}-d`}>{v}</dd>])}
            </dl>
          )}
          {m.notes && <p className="notes">{m.notes}</p>}
        </>
      )}
    </main>
  );
}

/** Every meter the person can see, with a filter. */
export function MetersListPage() {
  useTitle('Meters');
  const meters = useMeters();
  const [q, setQ] = useState('');
  const [check, setCheck] = useState<'all' | VerifyStatus>('all');
  const needle = q.trim().toLowerCase();
  const list = (meters.data ?? [])
    .filter((m) => check === 'all' || m.verifyStatus === check)
    .filter(
      (m) =>
        !needle ||
        [m.name, m.meterNumber, m.serial, m.measures, m.locationPath, m.address]
          .join(' ')
          .toLowerCase()
          .includes(needle),
    );
  return (
    <main className="content stack-lg">
      <div className="page-head">
        <div>
          <span className="eyebrow">Register</span>
          <h1>Meters</h1>
          <p className="muted">
            Your own meters on switchgear, panels and circuits. Add one from a location, panel or breaker.
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn" to="/equipment">
            Equipment
          </Link>
        </div>
      </div>
      <div className="row">
        <label className="field equipment-filter">
          <span className="field-label">Find</span>
          <input
            type="search"
            value={q}
            placeholder="Name, number, serial, panel…"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Field check</span>
          <select value={check} onChange={(e) => setCheck(e.target.value as 'all' | VerifyStatus)}>
            <option value="all">All</option>
            <option value="">Not checked</option>
            <option value="verified">Verified</option>
            <option value="wrong">Wrong</option>
          </select>
        </label>
      </div>
      <ErrorNote error={meters.error} />
      {meters.data && list.length === 0 && (
        <p className="muted">
          {meters.data.length === 0
            ? 'No meters yet. Use "+ Add a meter" on a panel, a switching cube or a location page.'
            : 'No meters match.'}
        </p>
      )}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Meter</th>
                <th scope="col">Measures</th>
                <th scope="col">Number</th>
                <th scope="col">CT / PT</th>
                <th scope="col">Field check</th>
                <th scope="col">Where</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link className="strong" to={`/meters/${m.id}`}>
                      {m.name}
                    </Link>
                  </td>
                  <td>{m.measures || <span className="muted">Not set</span>}</td>
                  <td className="mono">{m.meterNumber}</td>
                  <td className="mono">{[m.ctRatio, m.ptRatio].filter(Boolean).join(' · ')}</td>
                  <td>
                    <CheckMark status={m.verifyStatus} />
                    <span className="small muted block">
                      {m.verifyStatus
                        ? [m.verifiedBy, formatDate(m.verifiedAt)].filter(Boolean).join(', ')
                        : 'Not checked'}
                    </span>
                  </td>
                  <td className="small muted">{m.locationPath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
