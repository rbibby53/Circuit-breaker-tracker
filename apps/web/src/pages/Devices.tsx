// Transformers, disconnects, UPSs and utility services: cards on location pages, an add form,
// and a page for each with what feeds it and what it feeds.

import {
  POWER_DEVICE_HINTS,
  POWER_DEVICE_KINDS,
  POWER_DEVICE_LABELS,
  TRANSFORMER_KVA,
  atLeast,
  formatVa,
  type CampusFeed,
  type FeedCandidate,
  type FeedOptions,
  type PowerDeviceDetail,
  type PowerDeviceInput,
  type PowerDeviceKind,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { ImpactButton } from '../components/Impact';
import { NodeIcon } from '../components/PowerIcon';
import { ErrorNote, Field } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { useLocations, usePowerDevices } from '../queries';
import { ancestry, buildTree, type TreeNode } from '../tree';
import { useSwitchPlaces } from './Generators';
import { MetersOn } from './Meters';
import { isInside } from './SitePanels';

/** Transformers and other equipment at or inside a location, as cards. */
export function DevicesHere({ node, byId }: { node: TreeNode; byId: Map<number, TreeNode> }) {
  const devices = usePowerDevices();
  const here = (devices.data ?? []).filter((d) => isInside(byId, d.locationId, node.id));
  if (here.length === 0) return null;
  return (
    <section className="stack" aria-label="Transformers and disconnects">
      <h2 className="h-caps">Transformers and disconnects</h2>
      <div className="card-grid">
        {here.map((d) => (
          <Link key={d.id} to={`/devices/${d.id}`} className="card panel-card">
            <span className={`gen-icon device-icon dev-${d.kind}`} aria-hidden="true">
              <NodeIcon kind={d.kind} />
            </span>
            <span className="stack-sm">
              <span className="card-title">{d.name}</span>
              <span className="small">
                {POWER_DEVICE_LABELS[d.kind]}
                {d.rating && ` · ${d.rating}`}
              </span>
              <span className="mono small muted">{d.fedFrom ? `Fed from ${d.fedFrom}` : 'Feed not set'}</span>
              {d.locationId !== node.id && <span className="small muted">In {byId.get(d.locationId)?.name}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const blank = (kind: PowerDeviceKind, locationId: number): PowerDeviceInput => ({
  kind,
  name: '',
  locationId,
  kva: null,
  voltage: kind === 'transformer' ? '480 V' : kind === 'switch' ? '12.47 kV' : '',
  secondaryVoltage: kind === 'transformer' ? '120/208 V' : '',
  fedWay: '',
  amps: null,
  fused: false,
  fuseAmps: null,
  runtimeMinutes: null,
  meter: '',
  utility: '',
  manufacturer: '',
  model: '',
  notes: '',
});

const PLACEHOLDERS: Record<PowerDeviceKind, string> = {
  transformer: 'e.g. T-LDP1',
  disconnect: 'e.g. DS-AHU1',
  ups: 'e.g. UPS-1',
  service: 'e.g. Service 1',
  switch: 'e.g. SC-2',
};

const num = (v: string) => (v ? Number(v) : null);

/** The fields that matter for each kind of device. */
function DeviceFields({ form, setForm }: { form: PowerDeviceInput; setForm: (f: PowerDeviceInput) => void }) {
  const set = (patch: Partial<PowerDeviceInput>) => setForm({ ...form, ...patch });
  return (
    <>
      <Field label="Name">
        <input
          required
          value={form.name}
          maxLength={80}
          placeholder={PLACEHOLDERS[form.kind]}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      {(form.kind === 'transformer' || form.kind === 'ups') && (
        <Field label="kVA">
          <input
            type="number"
            min={0.1}
            step="any"
            list={form.kind === 'transformer' ? 'transformer-kva' : undefined}
            value={form.kva ?? ''}
            onChange={(e) => set({ kva: num(e.target.value) })}
          />
          <datalist id="transformer-kva">
            {TRANSFORMER_KVA.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </Field>
      )}
      {(form.kind === 'disconnect' || form.kind === 'service' || form.kind === 'switch') && (
        <Field label="Amps">
          <input type="number" min={1} value={form.amps ?? ''} onChange={(e) => set({ amps: num(e.target.value) })} />
        </Field>
      )}
      <Field label={form.kind === 'transformer' ? 'Primary voltage' : 'Voltage'}>
        <input
          value={form.voltage}
          maxLength={40}
          placeholder={form.kind === 'transformer' ? '480 V' : 'e.g. 277/480 V 3-phase'}
          onChange={(e) => set({ voltage: e.target.value })}
        />
      </Field>
      {form.kind === 'transformer' && (
        <Field label="Secondary voltage">
          <input
            value={form.secondaryVoltage}
            maxLength={40}
            placeholder="120/208 V"
            onChange={(e) => set({ secondaryVoltage: e.target.value })}
          />
        </Field>
      )}
      {form.kind === 'disconnect' && (
        <>
          <label className="check field-check">
            <input type="checkbox" checked={form.fused} onChange={(e) => set({ fused: e.target.checked })} />
            Fused
          </label>
          {form.fused && (
            <Field label="Fuse size (A)">
              <input
                type="number"
                min={1}
                value={form.fuseAmps ?? ''}
                onChange={(e) => set({ fuseAmps: num(e.target.value) })}
              />
            </Field>
          )}
        </>
      )}
      {form.kind === 'ups' && (
        <Field label="Runtime (minutes)">
          <input
            type="number"
            min={1}
            value={form.runtimeMinutes ?? ''}
            onChange={(e) => set({ runtimeMinutes: num(e.target.value) })}
          />
        </Field>
      )}
      {form.kind === 'service' && (
        <>
          <Field label="Meter number">
            <input value={form.meter} maxLength={60} onChange={(e) => set({ meter: e.target.value })} />
          </Field>
          <Field label="Utility and account">
            <input
              value={form.utility}
              maxLength={80}
              placeholder="e.g. Georgia Power #12345"
              onChange={(e) => set({ utility: e.target.value })}
            />
          </Field>
        </>
      )}
    </>
  );
}

/**
 * "Fed from": a breaker in a breaker panel, or another device, and (with `onWay`) which way of
 * that device, e.g. a switching cube's "Way 3". Not shown for a utility service.
 */
export function FeedField({
  value,
  options,
  current,
  onChange,
  way,
  onWay,
}: {
  value: { breakerId: number | null; deviceId: number | null };
  options: FeedOptions | undefined;
  current: string | null;
  onChange: (v: { breakerId: number | null; deviceId: number | null }) => void;
  way?: string;
  onWay?: (way: string) => void;
}) {
  const byPanel = new Map<number, FeedCandidate[]>();
  for (const c of options?.breakers ?? []) byPanel.set(c.panelId, [...(byPanel.get(c.panelId) ?? []), c]);
  const known =
    (value.breakerId && options?.breakers.some((b) => b.breakerId === value.breakerId)) ||
    (value.deviceId && options?.devices.some((d) => d.id === value.deviceId));
  const selected = value.deviceId ? `d:${value.deviceId}` : value.breakerId ? `b:${value.breakerId}` : '';
  return (
    <>
      <Field label="Fed from">
        <select
          value={selected}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(':');
            onChange({ breakerId: kind === 'b' ? Number(id) : null, deviceId: kind === 'd' ? Number(id) : null });
          }}
        >
          <option value="">Not set</option>
          {selected && !known && <option value={selected}>{current ?? 'Current feed'}</option>}
          {(options?.devices ?? []).length > 0 && (
            <optgroup label="Switching cubes, transformers and disconnects">
              {options!.devices.map((d) => (
                <option key={d.id} value={`d:${d.id}`}>
                  {d.name} · {POWER_DEVICE_LABELS[d.kind]} ({d.locationPath})
                </option>
              ))}
            </optgroup>
          )}
          {[...byPanel.entries()].map(([panelId, list]) => (
            <optgroup key={panelId} label={`${list[0]!.panelName} (${list[0]!.locationPath})`}>
              {list.map((c) => (
                <option key={c.breakerId} value={`b:${c.breakerId}`}>
                  {c.circuit} {c.label || 'Unlabelled'} ({c.amps}A)
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {onWay && value.deviceId !== null && (
        <Field label="Way or position">
          <input value={way ?? ''} maxLength={20} placeholder="e.g. Way 3" onChange={(e) => onWay(e.target.value)} />
        </Field>
      )}
    </>
  );
}

/** "+ Add a transformer or disconnect" on a site, building or room. */
export function AddDeviceForm({ locationId }: { locationId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<PowerDeviceInput | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/power-devices', form),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['power-devices'] });
      navigate(`/devices/${id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  if (!form) {
    return (
      <button type="button" className="btn" onClick={() => setForm(blank('transformer', locationId))}>
        + Add a transformer, switching cube or disconnect
      </button>
    );
  }
  return (
    <form className="panel stack" onSubmit={submit} aria-label="Add equipment">
      <h2 className="h-caps">Add equipment</h2>
      <div className="segmented five" role="group" aria-label="Kind">
        {POWER_DEVICE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={form.kind === k}
            onClick={() => setForm({ ...blank(k, locationId), name: form.name })}
          >
            {POWER_DEVICE_LABELS[k]}
          </button>
        ))}
      </div>
      <p className="muted small">
        {POWER_DEVICE_HINTS[form.kind]}{' '}
        {form.kind === 'service'
          ? 'Feed the main switchboard from it.'
          : 'Set what feeds it on its page, then pick it under Fed from in what it feeds.'}
      </p>
      <div className="form-row">
        <DeviceFields form={form} setForm={setForm} />
        <button className="btn btn-dark" disabled={create.isPending}>
          Add {POWER_DEVICE_LABELS[form.kind].toLowerCase()}
        </button>
        <button type="button" className="btn" onClick={() => setForm(null)}>
          Cancel
        </button>
      </div>
      <ErrorNote error={create.error} />
    </form>
  );
}

export function DevicePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const locations = useLocations();
  const { byId } = buildTree(locations.data ?? []);
  const places = useSwitchPlaces();
  const detail = useQuery({
    queryKey: ['power-device', Number(id)],
    queryFn: () => api.get<PowerDeviceDetail>(`/api/power-devices/${id}`),
    retry: false,
  });
  const d = detail.data;
  useTitle(d?.name ?? 'Equipment');
  const [form, setForm] = useState<
    (PowerDeviceInput & { feed: { breakerId: number | null; deviceId: number | null } }) | null
  >(null);
  const options = useQuery({
    queryKey: ['feed-options', 'device', Number(id)],
    queryFn: () => api.get<FeedOptions>(`/api/feed-options?device=${id}`),
    enabled: !!form && d?.kind !== 'service',
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['power-device', Number(id)] }),
      qc.invalidateQueries({ queryKey: ['power-devices'] }),
    ]);
  const save = useMutation({
    mutationFn: () => {
      const { feed, ...body } = form!;
      return api.patch(`/api/power-devices/${id}`, {
        ...body,
        fedFromBreakerId: feed.breakerId,
        fedFromDeviceId: feed.deviceId,
      });
    },
    onSuccess: async () => {
      setForm(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/power-devices/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['power-devices'] });
      navigate(d ? `/?loc=${d.locationId}` : '/');
    },
  });

  if (detail.isLoading) return <main className="content">Loading…</main>;
  if (!d) {
    return (
      <main className="content">
        <ErrorNote error={detail.error} />
      </main>
    );
  }
  const canEdit = d.canEdit && atLeast(d.role, 'editor');
  const chain = [...d.feedChain].reverse();

  return (
    <main className="content stack-lg">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Sites</Link>
        {ancestry(byId, d.locationId).map((c) => (
          <span key={c.id}>
            <span aria-hidden="true"> / </span>
            <Link to={`/?loc=${c.id}`}>{c.name}</Link>
          </span>
        ))}
      </nav>
      <div className="page-head">
        <div>
          <span className="eyebrow">{POWER_DEVICE_LABELS[d.kind]}</span>
          <h1>{d.name}</h1>
          <p className="muted">
            {[d.rating, d.kind === 'service' ? d.utility : '', [d.manufacturer, d.model].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {d.kind !== 'service' && (
            <div className="power-strip">
              <ol className="ps-chain" aria-label="Fed from">
                {chain.length === 0 ? (
                  <li className="ps-chip ps-warn">Fed from: not set yet</li>
                ) : (
                  chain.map((f) =>
                    f.kind === 'device' ? (
                      <li key={`d${f.deviceId}`} className={`ps-chip ps-${f.deviceKind}`}>
                        <NodeIcon kind={f.deviceKind} size={16} />
                        {f.canView ? <Link to={`/devices/${f.deviceId}`}>{f.name}</Link> : <strong>{f.name}</strong>}
                        {f.rating && <span className="ps-ckt">{f.rating}</span>}
                        {f.way && <span className="ps-ckt">{f.way}</span>}
                      </li>
                    ) : (
                      <li key={f.breakerId} className="ps-chip">
                        <NodeIcon kind={f.canView ? 'panel' : 'hidden'} size={16} />
                        {f.canView ? (
                          <Link to={`/panels/${f.panelId}`}>{f.panelName}</Link>
                        ) : (
                          <strong>{f.panelName}</strong>
                        )}
                        <span className="ps-ckt">
                          {f.circuit} · {f.amps}A
                        </span>
                      </li>
                    ),
                  )
                )}
                <li className="ps-chip ps-here" aria-current="true">
                  <NodeIcon kind={d.kind} size={16} />
                  {d.name}
                </li>
              </ol>
            </div>
          )}
        </div>
        <div className="toolbar">
          <Link className="btn" to={`/power?loc=${d.locationId}&focus=d${d.id}`}>
            Power flow
          </Link>
          {d.kind !== 'service' && <ImpactButton query={`device=${d.id}`} />}
          {canEdit && !form && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setForm({
                    ...d,
                    feed: { breakerId: d.fedFromBreakerId, deviceId: d.fedFromDeviceId },
                  })
                }
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${d.name}?`,
                    message: d.loads.length
                      ? `${d.loads.map((l) => l.name).join(', ')} will have no feed set.`
                      : 'This cannot be undone.',
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (ok) remove.mutate();
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <ErrorNote error={remove.error} />
      {d.warnings.map((w) => (
        <p key={w} className="load-warning small" role="note">
          {w}
        </p>
      ))}
      {(d.demandVa > 0 || d.ratio !== null) && (
        <p className="small">
          Load below it: <strong>{formatVa(d.demandVa)}</strong>
          {d.ratio !== null && (
            <>
              {' '}
              · <strong>{Math.round(d.ratio * 100)}%</strong> of its {d.kva} kVA
            </>
          )}
        </p>
      )}

      {form && (
        <form
          className="panel stack"
          aria-label={`Edit ${d.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="form-row">
            <DeviceFields form={form} setForm={(f) => setForm({ ...form, ...f })} />
            <Field label="Where">
              <select
                value={form.locationId}
                onChange={(e) => setForm({ ...form, locationId: Number(e.target.value) })}
              >
                {!places.some((p) => p.id === form.locationId) && (
                  <option value={form.locationId}>{d.locationPath}</option>
                )}
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            {d.kind !== 'service' && (
              <FeedField
                value={form.feed}
                options={options.data}
                current={d.fedFrom}
                onChange={(feed) => setForm({ ...form, feed })}
                way={form.fedWay ?? ''}
                onWay={(fedWay) => setForm({ ...form, fedWay })}
              />
            )}
            <Field label="Manufacturer">
              <input
                value={form.manufacturer}
                maxLength={80}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              />
            </Field>
            <Field label="Model">
              <input value={form.model} maxLength={80} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
      {!form && d.notes && <p className="notes">{d.notes}</p>}

      {(d.kind === 'switch' || d.buildings.length > 0) && (
        <section className="panel stack" aria-labelledby="dev-buildings-h">
          <h2 id="dev-buildings-h" className="h-caps">
            Buildings fed
          </h2>
          {d.buildings.length === 0 ? (
            <p className="muted">
              None yet. Feed a building&apos;s transformer or main switchboard from <strong>{d.name}</strong> (under{' '}
              <strong>Fed from</strong>), with the way it comes off.
            </p>
          ) : (
            <ul className="access-list">
              {d.buildings.map((b) => (
                <li key={`${b.locationId}:${b.way}`}>
                  <span className="cell-stack">
                    <Link className="strong" to={`/?loc=${b.locationId}`}>
                      {b.name}
                    </Link>
                    <span className="muted small">
                      {[b.way, `through ${b.via}`, b.path].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <MetersOn meters={d.meters} add={{ deviceId: d.id, locationId: d.locationId }} canAdd={canEdit} />
      <section className="panel stack" aria-labelledby="dev-loads-h">
        <h2 id="dev-loads-h" className="h-caps">
          What it feeds
        </h2>
        {d.loads.length === 0 && d.hiddenLoads === 0 ? (
          <p className="muted">
            Nothing yet. In a panel&apos;s settings, pick <strong>{d.name}</strong> under <strong>Fed from</strong>.
          </p>
        ) : (
          <ul className="access-list">
            {d.loads.map((l) => (
              <li key={`${l.kind}${l.id}`}>
                <span className="cell-stack">
                  <Link className="strong" to={l.kind === 'panel' ? `/panels/${l.id}` : `/devices/${l.id}`}>
                    {l.name}
                  </Link>
                  <span className="muted small">{[l.detail, l.locationPath].filter(Boolean).join(' · ')}</span>
                </span>
              </li>
            ))}
            {d.hiddenLoads > 0 && <li className="muted small">And {d.hiddenLoads} more outside your access</li>}
          </ul>
        )}
      </section>
    </main>
  );
}

/** A building's place on a campus grid: the switching cubes it ties back to, by way. */
export function CampusFeedCard({ locationId }: { locationId: number }) {
  const feed = useQuery({
    queryKey: ['campus-feed', locationId],
    queryFn: () => api.get<CampusFeed>(`/api/locations/${locationId}/campus-feed`),
  });
  const cubes = feed.data?.cubes ?? [];
  if (cubes.length === 0) return null;
  return (
    <section className="panel stack-sm campus-feed" aria-label="Campus feed">
      <h2 className="h-caps">Campus feed</h2>
      <ul className="access-list">
        {cubes.map((c) => (
          <li key={`${c.id}:${c.way}`}>
            <span className={`gen-icon device-icon dev-switch`} aria-hidden="true">
              <NodeIcon kind="switch" />
            </span>
            <span className="cell-stack">
              <span>
                {c.canView ? (
                  <Link className="strong" to={`/devices/${c.id}`}>
                    {c.name}
                  </Link>
                ) : (
                  <strong>{c.name}</strong>
                )}
                {c.way && <span className="mono"> · {c.way}</span>}
              </span>
              <span className="muted small">
                Into {c.via} · cube in {c.path}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
