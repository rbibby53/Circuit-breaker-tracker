import {
  AVAILABLE_LAYOUTS,
  BACKUP_LABELS,
  CONTROL_SYSTEMS,
  DEVICE_LABELS,
  LAYOUT_DEFAULTS,
  LAYOUT_LABELS,
  PROTECTION_LABELS,
  VOLTAGE_PRESETS,
  spaceChoices,
  isListLayout,
  MAX_UNITS,
  type PanelLayout,
  type PanelSummary,
  type ServedByItem,
  ampsLabel,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthConfig } from '../auth';
import { ErrorNote, Field } from '../components/ui';
import { usePanels } from '../queries';
import type { TreeNode } from '../tree';

export function isInside(byId: Map<number, TreeNode>, locationId: number, ancestorId: number): boolean {
  let n = byId.get(locationId);
  while (n) {
    if (n.id === ancestorId) return true;
    n = n.parentId !== null ? byId.get(n.parentId) : undefined;
  }
  return false;
}

/** Small picture of a panel: two columns of bars, filled ones light (one column for a switchboard). */
export function PanelThumb({ panel }: { panel: PanelSummary }) {
  const rows = Math.ceil(panel.spaces / 2);
  const bars: boolean[] = [];
  for (let i = 0; i < rows * 2; i++) bars.push(i < panel.usedSpaces);
  if (isListLayout(panel)) {
    return (
      <span className="thumb thumb-list" aria-hidden="true">
        {Array.from({ length: Math.min(12, panel.spaces) }, (_, i) => (
          <span key={i} className={i < panel.usedSpaces ? 'on' : ''} />
        ))}
      </span>
    );
  }
  return (
    <span className="thumb" aria-hidden="true">
      {bars.slice(0, 42).map((on, i) => (
        <span key={i} className={on ? 'on' : ''} />
      ))}
    </span>
  );
}

export function PanelsHere({ node, byId }: { node: TreeNode; byId: Map<number, TreeNode> }) {
  const panels = usePanels();
  const here = (panels.data ?? []).filter((p) => isInside(byId, p.locationId, node.id));
  if (here.length === 0) {
    return node.kind === 'room' ? (
      <div className="empty">
        <p>No panels in this room yet.</p>
      </div>
    ) : null;
  }
  return (
    <section className="stack" aria-label="Panels">
      <h2 className="h-caps">Panels</h2>
      <div className="card-grid">
        {here.map((p) => (
          <Link key={p.id} to={`/panels/${p.id}`} className="card panel-card">
            <PanelThumb panel={p} />
            <span className="stack-sm">
              <span className="card-title">{p.name}</span>
              <span className="small">
                {p.layout === 'relay'
                  ? `${p.controlSystem ? `${p.controlSystem} ` : ''}relay panel${p.voltage ? ` · ${p.voltage}` : ''}`
                  : `${p.voltage || LAYOUT_LABELS[p.layout]} · ${p.mainType === 'lugs' ? 'main lugs' : `${p.mainAmps ?? '?'} A main`}`}
              </span>
              <span className="mono small muted">
                {p.usedSpaces}/{p.spaces} {p.layout === 'relay' ? 'relays' : isListLayout(p) ? 'units' : 'spaces'}
                {p.criticalCount ? ` · ${p.criticalCount} critical` : ''}
              </span>
              {p.fedFrom && <span className="small muted">Fed from {p.fedFrom}</span>}
              {p.generatorName && <span className="small muted">On generator {p.generatorName}</span>}
              {p.locationId !== node.id && <span className="small muted">In {byId.get(p.locationId)?.name}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function AddPanelForm({ roomId, startOpen }: { roomId: number; startOpen: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(startOpen);
  const [layout, setLayout] = useState<PanelLayout>('residential');
  const defaults = useAuthConfig().data?.panelDefaults;
  const [form, setForm] = useState({
    name: '',
    spaces: defaults?.spaces ?? 24,
    mainType: 'breaker' as 'breaker' | 'lugs',
    mainAmps: defaults?.mainAmps ?? 200,
    voltage: defaults?.voltage ?? '120/240 V split-phase',
    controlSystem: 'nLight',
  });
  const relay = layout === 'relay';
  // Admins set the defaults for homes in Settings; other layouts start from their own.
  const pickLayout = (l: PanelLayout) => {
    const d = l === 'residential' && defaults ? defaults : LAYOUT_DEFAULTS[l];
    setLayout(l);
    setForm((f) => ({ ...f, spaces: d.spaces, mainAmps: d.mainAmps, voltage: d.voltage }));
  };
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>(`/api/locations/${roomId}/panels`, {
        ...form,
        layout,
        mainType: relay ? 'lugs' : form.mainType,
        mainAmps: relay || form.mainType === 'lugs' ? null : form.mainAmps,
        controlSystem: relay ? form.controlSystem : '',
      }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['panels'] });
      navigate(`/panels/${id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  if (!open) {
    return (
      <div className="add-actions">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          + Add a panel
        </button>
      </div>
    );
  }
  return (
    <form className="panel stack" onSubmit={submit} aria-label="Add a panel">
      <h2 className="h-caps">Add a panel</h2>
      <div className="layout-picks" role="radiogroup" aria-label="Layout">
        {AVAILABLE_LAYOUTS.map((l) => {
          return (
            <label key={l} className={`layout-pick${layout === l ? ' is-on' : ''}`}>
              <input type="radio" name="layout" value={l} checked={layout === l} onChange={() => pickLayout(l)} />
              <span className="strong">{LAYOUT_LABELS[l]}</span>
              <span className="small muted">
                {l === 'residential' && 'Two columns, odd left and even right. 1- and 2-pole, tandems.'}
                {l === 'commercial' && 'Three-phase, rows on phases A, B and C. 1-, 2- and 3-pole, no tandems.'}
                {l === 'relay' &&
                  'Lighting control relays (nLight and others), numbered 1 up. Each relay switches a circuit from a breaker panel.'}
                {l === 'switchboard' &&
                  'Distribution boards and switchboards with feeders numbered 1, 2, 3… as units: frame, trip, wire and conduit.'}
                {l === 'mcc' && 'Buckets numbered as units, with starter size, motor HP and control type.'}
              </span>
            </label>
          );
        })}
      </div>
      <div className="form-row">
        <Field label="Name">
          <input
            required
            value={form.name}
            placeholder={relay ? 'e.g. RP-1' : 'e.g. Main panel, Garage sub-panel'}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        {isListLayout({ layout }) ? (
          <Field label="Units">
            <input
              type="number"
              min={1}
              max={MAX_UNITS}
              value={form.spaces}
              onChange={(e) => setForm({ ...form, spaces: Number(e.target.value) || 1 })}
            />
          </Field>
        ) : (
          <Field label={relay ? 'Relays' : 'Spaces'}>
            <select value={form.spaces} onChange={(e) => setForm({ ...form, spaces: Number(e.target.value) })}>
              {spaceChoices(layout).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        )}
        {relay ? (
          <Field label="Control system">
            <input
              value={form.controlSystem}
              list="new-panel-control-systems"
              maxLength={60}
              onChange={(e) => setForm({ ...form, controlSystem: e.target.value })}
            />
            <datalist id="new-panel-control-systems">
              {CONTROL_SYSTEMS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        ) : (
          <Field label="Main">
            <select
              value={form.mainType}
              onChange={(e) => setForm({ ...form, mainType: e.target.value as 'breaker' | 'lugs' })}
            >
              <option value="breaker">Main breaker</option>
              <option value="lugs">Main lugs only</option>
            </select>
          </Field>
        )}
        {!relay && form.mainType === 'breaker' && (
          <Field label="Main amps">
            <input
              type="number"
              min={1}
              value={form.mainAmps}
              onChange={(e) => setForm({ ...form, mainAmps: Number(e.target.value) })}
            />
          </Field>
        )}
        <Field label="Voltage">
          <input
            value={form.voltage}
            list="new-panel-voltages"
            onChange={(e) => setForm({ ...form, voltage: e.target.value })}
          />
        </Field>
        <datalist id="new-panel-voltages">
          {VOLTAGE_PRESETS[layout].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <button className="btn btn-dark" disabled={create.isPending}>
          Create panel
        </button>
      </div>
      <ErrorNote error={create.error} />
    </form>
  );
}

export function ServedBy({ node }: { node: TreeNode }) {
  const items = useQuery({
    queryKey: ['served-by', node.id],
    queryFn: () => api.get<ServedByItem[]>(`/api/locations/${node.id}/served-by`),
  });
  if (!items.data?.length) return null;
  return (
    <section className="stack" aria-label="Breakers serving this location">
      <h2 className="h-caps">Breakers serving {node.name}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Circuit</th>
              <th>Label</th>
              <th>Amps</th>
              <th>Type</th>
              <th>Panel</th>
              <th>Tagged as</th>
            </tr>
          </thead>
          <tbody>
            {items.data.map((i) => (
              <tr key={i.breakerId}>
                <td className="mono strong">{i.circuit}</td>
                <td>
                  <span className="strong">
                    {i.label || (i.device === 'surge' ? DEVICE_LABELS.surge : 'Unlabelled')}
                  </span>{' '}
                  {i.critical && <span className="badge badge-crit">CRIT</span>}
                  {i.backup !== 'none' && (
                    <span className={`badge badge-${i.backup === 'ups' ? 'ups' : 'gen'}`}>
                      {BACKUP_LABELS[i.backup].toUpperCase().slice(0, 3)}
                    </span>
                  )}
                </td>
                <td className="mono">{ampsLabel(i)}</td>
                <td>{i.device === 'surge' ? DEVICE_LABELS.surge : PROTECTION_LABELS[i.protection]}</td>
                <td>
                  <div className="cell-stack">
                    {i.canViewPanel ? (
                      <Link to={`/panels/${i.panelId}`}>{i.panelName}</Link>
                    ) : (
                      <span className="strong">{i.panelName}</span>
                    )}
                    <span className="muted small">{i.panelPath}</span>
                  </div>
                </td>
                <td>{i.via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
