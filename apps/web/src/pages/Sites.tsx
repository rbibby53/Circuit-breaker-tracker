import { CHILD_KIND, KIND_LABELS, atLeast, type LocationKind } from '@cbt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { useConfirm } from '../components/ConfirmDialog';
import { LocationTree } from '../components/LocationTree';
import { Sidebar } from '../components/Sidebar';
import { PrintButton, locationPrintStyles } from '../components/PrintDialog';
import { ErrorNote, Field } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { useLocations, usePanels } from '../queries';
import { ancestry, buildTree, hiddenBuilding, shownChildren, type TreeNode } from '../tree';
import { AddDeviceForm, DevicesHere } from './Devices';
import { AddGeneratorForm, GeneratorsHere } from './Generators';
import { AddPanelForm, PanelsHere, ServedBy } from './SitePanels';

const plural = (kind: LocationKind, n: number) => `${n} ${KIND_LABELS[kind].toLowerCase()}${n === 1 ? '' : 's'}`;

export function SitesPage() {
  const me = useCurrentUser();
  const locations = useLocations();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('loc') ? Number(params.get('loc')) : null;
  const select = (id: number | null) => setParams(id ? { loc: String(id) } : {});

  const { roots, byId } = buildTree(locations.data ?? []);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  useTitle(selected?.name ?? 'Sites');
  if (locations.isLoading) return <div className="page-loading">Loading…</div>;

  return (
    <div className="with-sidebar">
      <Sidebar
        label="Locations"
        current={selected?.name ?? null}
        selectedId={selectedId}
        head={
          <>
            <span className="eyebrow">Locations</span>
            <button type="button" className="link-btn" onClick={() => select(null)}>
              All
            </button>
          </>
        }
      >
        <LocationTree roots={roots} selectedId={selectedId} onSelect={select} />
      </Sidebar>
      <main className="content">
        {selected ? (
          <LocationView node={selected} byId={byId} onSelect={select} readOnly={me.viewingAs} />
        ) : (
          <Overview roots={roots} isAdmin={me.user.isAdmin} readOnly={me.viewingAs} onSelect={select} />
        )}
      </main>
    </div>
  );
}

function Overview({
  roots,
  isAdmin,
  readOnly,
  onSelect,
}: {
  roots: TreeNode[];
  isAdmin: boolean;
  readOnly: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Sites</h1>
          <p className="muted">Everything you have access to, by company.</p>
        </div>
      </div>
      {roots.length === 0 &&
        (isAdmin ? (
          <section className="panel stack" aria-label="Getting started">
            <h2>Getting started</h2>
            <ol className="steps">
              <li>
                <strong>Add a company.</strong> Use one for your own places (for example “Personal”) and one per
                organisation, such as your employer.
              </li>
              <li>
                <strong>Add a site inside it,</strong> then its floors and rooms. For a house, add floors straight to
                the site.
              </li>
              <li>
                <strong>Put a panel in a room</strong> and click its empty spaces to add breakers.
              </li>
              <li>
                <strong>Invite people</strong> from Access, scoped to just the places they need.
              </li>
            </ol>
          </section>
        ) : (
          <div className="empty">
            <p>You don't have access to anything yet. Ask whoever invited you to share a location.</p>
          </div>
        ))}
      {roots.map((company) => (
        <section key={company.id} className="stack">
          <div className="section-head">
            <h2>
              <button type="button" className="link-btn h2-btn" onClick={() => onSelect(company.id)}>
                {company.name}
              </button>
            </h2>
            <span className="muted">{KIND_LABELS[company.kind]}</span>
          </div>
          <ChildCards nodes={shownChildren(company)} onSelect={onSelect} />
        </section>
      ))}
      {isAdmin && !readOnly && (
        <div className="add-actions">
          <AddForm parentId={null} kind="company" startOpen={roots.length === 0} />
        </div>
      )}
    </div>
  );
}

function ChildCards({ nodes, onSelect }: { nodes: TreeNode[]; onSelect: (id: number) => void }) {
  if (nodes.length === 0) return <p className="muted">Nothing inside yet.</p>;
  return (
    <div className="card-grid">
      {nodes.map((n) => {
        const kids = shownChildren(n);
        const kidKind = kids[0]?.kind;
        return (
          <button
            key={n.id}
            type="button"
            className={`card card-btn${n.access === 'breadcrumb' ? ' is-crumb' : ''}`}
            onClick={() => onSelect(n.id)}
          >
            <span className="eyebrow">{KIND_LABELS[n.kind]}</span>
            <span className="card-title">{n.name}</span>
            <span className="muted small">
              {kidKind ? plural(kidKind, kids.length) : n.kind === 'room' ? 'Room' : 'Empty'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LocationView({
  node,
  byId,
  onSelect,
  readOnly,
}: {
  node: TreeNode;
  byId: Map<number, TreeNode>;
  onSelect: (id: number) => void;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const panels = usePanels();
  const [editing, setEditing] = useState(false);
  const chain = ancestry(byId, node.id);
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  // For a floor inside a hidden building, the site is the parent people think of.
  const grandparent = parent?.parentId ? byId.get(parent.parentId) : undefined;
  const shownParent = grandparent && hiddenBuilding(grandparent) === parent ? grandparent : parent;
  const crumbOnly = node.access === 'breadcrumb';
  const canEdit = !readOnly && atLeast(node.role, 'editor');
  const canRename = !readOnly && (atLeast(parent?.role, 'editor') || atLeast(node.role, 'manager'));
  const canDelete = !readOnly && (node.kind === 'company' ? node.role === 'admin' : atLeast(parent?.role, 'editor'));
  const kids = shownChildren(node);
  const hb = hiddenBuilding(node);

  const remove = useMutation({
    mutationFn: () => api.del(`/api/locations/${node.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['locations'] });
      onSelect(shownParent?.id ?? 0);
    },
  });

  // What can be added here, given hidden buildings.
  const addKinds: LocationKind[] = [];
  if (node.kind === 'site') {
    if (hb || node.children.length === 0) addKinds.push('floor');
    addKinds.push('building');
  } else {
    const k = CHILD_KIND[node.kind];
    if (k) addKinds.push(k);
  }

  return (
    <div className="stack-lg">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="link-btn" onClick={() => onSelect(0)}>
          Sites
        </button>
        {chain.slice(0, -1).map((c) => (
          <span key={c.id}>
            <span aria-hidden="true"> / </span>
            <button type="button" className="link-btn" onClick={() => onSelect(c.id)}>
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="page-head">
        <div>
          <span className="eyebrow">{KIND_LABELS[node.kind]}</span>
          <h1>{node.name}</h1>
          {node.notes && <p className="notes">{node.notes}</p>}
          {crumbOnly && (
            <p className="muted">You only have access to parts inside this {KIND_LABELS[node.kind].toLowerCase()}.</p>
          )}
        </div>
        <div className="toolbar">
          {!crumbOnly && (
            <PrintButton
              endpoint={`/api/locations/${node.id}/pdf`}
              csv={`/api/locations/${node.id}/csv`}
              styles={locationPrintStyles(node.name)}
              subject={node.name}
            />
          )}
          {!crumbOnly && node.kind !== 'company' && (
            <Link className="btn" to={`/power?loc=${node.id}`}>
              Power flow
            </Link>
          )}
          {canRename && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              Rename
            </button>
          )}
          {atLeast(node.role, 'manager') && (
            <Link className="btn" to={`/access?loc=${node.id}`}>
              Who has access
            </Link>
          )}
          {canDelete && (
            <button
              className="btn btn-danger"
              disabled={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${node.name}?`,
                  message: 'This cannot be undone.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (ok) remove.mutate();
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={remove.error} />
      {editing && <EditForm node={node} onDone={() => setEditing(false)} />}

      <PanelsHere node={node} byId={byId} />
      <GeneratorsHere node={node} byId={byId} />
      <DevicesHere node={node} byId={byId} />
      {node.kind === 'room' && canEdit && (
        <AddPanelForm
          key={node.id}
          roomId={node.id}
          startOpen={!(panels.data ?? []).some((p) => p.locationId === node.id)}
        />
      )}
      {node.kind !== 'room' && <ChildCards nodes={kids} onSelect={onSelect} />}
      {canEdit && (addKinds.length > 0 || node.kind !== 'company') && (
        <div className="add-actions">
          {node.kind !== 'company' && <AddGeneratorForm key={`gen-${node.id}`} locationId={node.id} />}
          {node.kind !== 'company' && <AddDeviceForm key={`dev-${node.id}`} locationId={node.id} />}
          {addKinds.map((k) => (
            <AddForm
              key={`${node.id}-${k}`}
              parentId={node.id}
              kind={k}
              startOpen={kids.length === 0 && k !== 'building'}
            />
          ))}
        </div>
      )}
      {(node.kind === 'room' || node.kind === 'floor') && !crumbOnly && <ServedBy node={node} />}
    </div>
  );
}

function EditForm({ node, onDone }: { node: TreeNode; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(node.name);
  const [notes, setNotes] = useState(node.notes);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/locations/${node.id}`, { name, notes }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['locations'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form className="panel stack" onSubmit={submit}>
      <Field label="Name">
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorNote error={save.error} />
      <div className="row">
        <button className="btn btn-primary" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const PLACEHOLDERS: Record<LocationKind, string> = {
  company: 'e.g. Personal, or your employer',
  site: 'e.g. Home, Apartment, Main campus',
  building: 'e.g. Science Hall',
  floor: 'e.g. Basement, Floor 2',
  room: 'e.g. Utility room, Electrical room 2B',
};

function AddForm({
  parentId,
  kind,
  startOpen = false,
}: {
  parentId: number | null;
  kind: LocationKind;
  startOpen?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/locations', { parentId, kind, name }),
    onSuccess: async () => {
      setName('');
      await qc.invalidateQueries({ queryKey: ['locations'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const label = KIND_LABELS[kind].toLowerCase();
  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + Add {label}
      </button>
    );
  }
  return (
    <form className="add-row" onSubmit={submit}>
      <Field label={`Add a ${label}`}>
        <input
          required
          autoFocus={!startOpen}
          value={name}
          placeholder={PLACEHOLDERS[kind]}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <button className="btn btn-dark" disabled={add.isPending}>
        Add {label}
      </button>
      {!startOpen && (
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Done
        </button>
      )}
      <ErrorNote error={add.error} />
    </form>
  );
}
