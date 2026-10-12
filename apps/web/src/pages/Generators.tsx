import {
  FUELS,
  FUEL_LABELS,
  atLeast,
  generatorRating,
  type Fuel,
  type GeneratorDetail,
  type GeneratorInput,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { ErrorNote, Field } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { useGenerators, useLocations } from '../queries';
import { ancestry, buildTree, type TreeNode } from '../tree';
import { isInside } from './SitePanels';

/** Generators at or inside a location, as cards like the panels. */
export function GeneratorsHere({ node, byId }: { node: TreeNode; byId: Map<number, TreeNode> }) {
  const generators = useGenerators();
  const here = (generators.data ?? []).filter((g) => isInside(byId, g.locationId, node.id));
  if (here.length === 0) return null;
  return (
    <section className="stack" aria-label="Generators">
      <h2 className="h-caps">Generators</h2>
      <div className="card-grid">
        {here.map((g) => (
          <Link key={g.id} to={`/generators/${g.id}`} className="card panel-card">
            <span className="gen-icon" aria-hidden="true">
              G
            </span>
            <span className="stack-sm">
              <span className="card-title">{g.name}</span>
              <span className="small">
                {generatorRating(g)}
                {g.voltage && ` · ${g.voltage}`}
              </span>
              <span className="mono small muted">
                Backs up {g.panelCount === 1 ? '1 panel' : `${g.panelCount} panels`}
              </span>
              {g.locationId !== node.id && <span className="small muted">In {byId.get(g.locationId)?.name}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const blank: GeneratorInput = {
  name: '',
  kw: null,
  fuel: 'diesel',
  voltage: '',
  manufacturer: '',
  model: '',
  notes: '',
};

/** Name, size, fuel and the rest of a generator, for adding or editing one. */
function GeneratorFields({ form, setForm }: { form: GeneratorInput; setForm: (f: GeneratorInput) => void }) {
  return (
    <>
      <Field label="Name">
        <input
          required
          value={form.name}
          maxLength={80}
          placeholder="e.g. GEN-1"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Size (kW)">
        <input
          type="number"
          min={1}
          value={form.kw ?? ''}
          onChange={(e) => setForm({ ...form, kw: e.target.value ? Number(e.target.value) : null })}
        />
      </Field>
      <Field label="Fuel">
        <select value={form.fuel} onChange={(e) => setForm({ ...form, fuel: e.target.value as Fuel })}>
          {FUELS.map((f) => (
            <option key={f} value={f}>
              {FUEL_LABELS[f]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Voltage">
        <input
          value={form.voltage}
          maxLength={40}
          placeholder="e.g. 277/480 V 3-phase"
          onChange={(e) => setForm({ ...form, voltage: e.target.value })}
        />
      </Field>
    </>
  );
}

export function AddGeneratorForm({ locationId }: { locationId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<GeneratorInput>(blank);
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>(`/api/locations/${locationId}/generators`, form),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['generators'] });
      navigate(`/generators/${id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + Add a generator
      </button>
    );
  }
  return (
    <form className="panel stack" onSubmit={submit} aria-label="Add a generator">
      <h2 className="h-caps">Add a generator</h2>
      <p className="muted small">
        A standby generator for this site or building. Link the panels it backs up from each panel&apos;s settings;
        panels fed from those are covered too.
      </p>
      <div className="form-row">
        <GeneratorFields form={form} setForm={setForm} />
        <button className="btn btn-dark" disabled={create.isPending}>
          Add generator
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ErrorNote error={create.error} />
    </form>
  );
}

export function GeneratorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const locations = useLocations();
  const { byId } = buildTree(locations.data ?? []);
  const detail = useQuery({
    queryKey: ['generator', Number(id)],
    queryFn: () => api.get<GeneratorDetail>(`/api/generators/${id}`),
    retry: false,
  });
  const g = detail.data;
  useTitle(g?.name ?? 'Generator');
  const [form, setForm] = useState<GeneratorInput | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['generator', Number(id)] }),
      qc.invalidateQueries({ queryKey: ['generators'] }),
    ]);
  const save = useMutation({
    mutationFn: (body: GeneratorInput) => api.patch(`/api/generators/${id}`, body),
    onSuccess: async () => {
      setForm(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/generators/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['generators'] });
      navigate(g ? `/?loc=${g.locationId}` : '/');
    },
  });

  if (detail.isLoading) return <div className="page-loading">Loading generator…</div>;
  if (!g) {
    return (
      <main className="content narrow">
        <h1>Generator not available</h1>
        <ErrorNote error={detail.error ?? new Error('Not found.')} />
        <p>
          <Link to="/">Back to sites</Link>
        </p>
      </main>
    );
  }
  const direct = g.panels.filter((p) => !p.via);
  const through = g.panels.filter((p) => p.via);
  const canEdit = g.canEdit && atLeast(g.role, 'editor');

  return (
    <main className="content stack-lg">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Sites</Link>
        {ancestry(byId, g.locationId).map((c) => (
          <span key={c.id}>
            <span aria-hidden="true"> / </span>
            <Link to={`/?loc=${c.id}`}>{c.name}</Link>
          </span>
        ))}
      </nav>
      <div className="page-head">
        <div>
          <span className="eyebrow">Standby generator</span>
          <h1>{g.name}</h1>
          <p className="muted">
            {[generatorRating(g), g.voltage, [g.manufacturer, g.model].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {canEdit && !form && (
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              onClick={() =>
                setForm({
                  name: g.name,
                  kw: g.kw,
                  fuel: g.fuel,
                  voltage: g.voltage,
                  manufacturer: g.manufacturer,
                  model: g.model,
                  notes: g.notes,
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
                  title: `Delete ${g.name}?`,
                  message: direct.length
                    ? `${direct.length === 1 ? '1 panel is' : `${direct.length} panels are`} linked to it and will be unlinked. Their breakers stay as they are.`
                    : 'This cannot be undone.',
                  confirmLabel: 'Delete generator',
                  danger: true,
                });
                if (ok) remove.mutate();
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <ErrorNote error={remove.error} />

      {form && (
        <form
          className="panel stack"
          aria-label="Edit generator"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <div className="form-row">
            <GeneratorFields form={form} setForm={setForm} />
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
            <textarea
              rows={3}
              value={form.notes}
              placeholder="e.g. Weekly exercise Tuesdays 10 am · fuel 500 gal · service contract with…"
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
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
      {!form && g.notes && <p className="notes">{g.notes}</p>}

      <section className="panel stack" aria-labelledby="gen-panels-h">
        <h2 id="gen-panels-h" className="h-caps">
          Panels on this generator
        </h2>
        {g.panels.length === 0 && g.hiddenPanels === 0 ? (
          <p className="muted">
            None yet. Open a panel&apos;s settings and pick this generator under <strong>Standby generator</strong>.
          </p>
        ) : (
          <ul className="access-list">
            {[...direct, ...through].map((p) => (
              <li key={p.id}>
                <span className="cell-stack">
                  <Link className="strong" to={`/panels/${p.id}`}>
                    {p.name}
                  </Link>
                  <span className="muted small">{p.locationPath}</span>
                </span>
                <span className="small">
                  {p.via ? `Through ${p.via}` : p.transferSwitch ? `Through ${p.transferSwitch}` : 'Linked directly'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {g.hiddenPanels > 0 && (
          <p className="muted small">
            And {g.hiddenPanels} panel{g.hiddenPanels === 1 ? '' : 's'} outside your access.
          </p>
        )}
      </section>
    </main>
  );
}
