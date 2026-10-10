import {
  AVAILABLE_LAYOUTS,
  BACKUP_LABELS,
  LAYOUT_LABELS,
  MAX_SPACES,
  MIN_SPACES,
  PANEL_LAYOUTS,
  PROTECTION_LABELS,
  type PanelLayout,
  type PanelSummary,
  type ServedByItem,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, Field } from '../components/ui';
import type { TreeNode } from '../tree';

export const usePanels = () => useQuery({ queryKey: ['panels'], queryFn: () => api.get<PanelSummary[]>('/api/panels') });

function isInside(byId: Map<number, TreeNode>, locationId: number, ancestorId: number): boolean {
  let n = byId.get(locationId);
  while (n) {
    if (n.id === ancestorId) return true;
    n = n.parentId !== null ? byId.get(n.parentId) : undefined;
  }
  return false;
}

/** Small picture of a panel: two columns of bars, filled ones light. */
export function PanelThumb({ panel }: { panel: PanelSummary }) {
  const rows = Math.ceil(panel.spaces / 2);
  const bars: boolean[] = [];
  for (let i = 0; i < rows * 2; i++) bars.push(i < panel.usedSpaces);
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
                {p.voltage || LAYOUT_LABELS[p.layout]} · {p.mainType === 'lugs' ? 'main lugs' : `${p.mainAmps ?? '?'} A main`}
              </span>
              <span className="mono small muted">
                {p.usedSpaces}/{p.spaces} spaces{p.criticalCount ? ` · ${p.criticalCount} critical` : ''}
              </span>
              {p.fedFrom && <span className="small muted">Fed from {p.fedFrom}</span>}
              {p.locationId !== node.id && <span className="small muted">In {byId.get(p.locationId)?.name}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function AddPanelForm({ roomId }: { roomId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [layout, setLayout] = useState<PanelLayout>('residential');
  const [form, setForm] = useState({ name: '', spaces: 24, mainType: 'breaker' as 'breaker' | 'lugs', mainAmps: 200, voltage: '120/240 V split-phase' });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>(`/api/locations/${roomId}/panels`, {
        ...form,
        layout,
        mainAmps: form.mainType === 'lugs' ? null : form.mainAmps,
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
  return (
    <form className="panel stack" onSubmit={submit} aria-label="Add a panel">
      <h2 className="h-caps">Add a panel</h2>
      <div className="layout-picks" role="radiogroup" aria-label="Layout">
        {PANEL_LAYOUTS.map((l) => {
          const available = AVAILABLE_LAYOUTS.includes(l);
          return (
            <label key={l} className={`layout-pick${layout === l ? ' is-on' : ''}${available ? '' : ' is-off'}`}>
              <input type="radio" name="layout" value={l} checked={layout === l} disabled={!available} onChange={() => setLayout(l)} />
              <span className="strong">{LAYOUT_LABELS[l]}</span>
              <span className="small muted">
                {l === 'residential' && 'Two columns, odd left and even right. 1- and 2-pole, tandems.'}
                {l === 'commercial' && 'Three-phase, 1-, 2- and 3-pole. Coming in the next update.'}
                {l === 'single' && 'One column for small sub-panels. Coming later.'}
              </span>
            </label>
          );
        })}
      </div>
      <div className="form-row">
        <Field label="Name">
          <input required value={form.name} placeholder="e.g. Main panel, Garage sub-panel" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Spaces">
          <select value={form.spaces} onChange={(e) => setForm({ ...form, spaces: Number(e.target.value) })}>
            {Array.from({ length: (MAX_SPACES - MIN_SPACES) / 2 + 1 }, (_, i) => MIN_SPACES + i * 2).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Main">
          <select value={form.mainType} onChange={(e) => setForm({ ...form, mainType: e.target.value as 'breaker' | 'lugs' })}>
            <option value="breaker">Main breaker</option>
            <option value="lugs">Main lugs only</option>
          </select>
        </Field>
        {form.mainType === 'breaker' && (
          <Field label="Main amps">
            <input type="number" min={1} value={form.mainAmps} onChange={(e) => setForm({ ...form, mainAmps: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Voltage">
          <input value={form.voltage} onChange={(e) => setForm({ ...form, voltage: e.target.value })} />
        </Field>
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
                  <span className="strong">{i.label || 'Unlabelled'}</span>{' '}
                  {i.critical && <span className="badge badge-crit">CRIT</span>}
                  {i.backup !== 'none' && <span className={`badge badge-${i.backup === 'ups' ? 'ups' : 'gen'}`}>{BACKUP_LABELS[i.backup].toUpperCase().slice(0, 3)}</span>}
                </td>
                <td className="mono">{i.amps}A</td>
                <td>{PROTECTION_LABELS[i.protection]}</td>
                <td>
                  <div className="cell-stack">
                    {i.canViewPanel ? <Link to={`/panels/${i.panelId}`}>{i.panelName}</Link> : <span className="strong">{i.panelName}</span>}
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
