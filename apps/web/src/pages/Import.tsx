import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  LAYOUT_LABELS,
  atLeast,
  guessMapping,
  isListLayout,
  looksLikeHeader,
  matchPlace,
  mergeBreakers,
  parseDelimited,
  readRows,
  sectionsOf,
  spacesToFit,
  splitServe,
  validateSections,
  type ImportChange,
  type ImportField,
  type ImportIssue,
  type ImportedBreaker,
  type ImportedPanel,
  type PanelDetail,
  type PanelLayout,
  type PanelSummary,
  type PlaceCandidate,
  type SavePanelResponse,
} from '@cbt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useCurrentUser } from '../auth';
import { ErrorNote } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { siteOf } from '../panel/serves';
import { feedKey, fromDetail, newKey, toRequest, type EditBreaker, type EditPanel } from '../panel/state';
import { useLocations, usePanels } from '../queries';
import { ancestry, buildTree, type TreeNode } from '../tree';

type Step = 'source' | 'columns' | 'review' | 'done';
type Mode = 'merge' | 'replace';

const NEW_LAYOUTS: PanelLayout[] = ['commercial', 'residential', 'switchboard', 'mcc'];

interface Plan {
  key: string;
  name: string;
  existing: PanelSummary | null;
  /** Where a new panel goes. */
  roomId: number | null;
  layout: PanelLayout;
  version: number;
  baselineFeed: string;
  knownIds: Set<number>;
  doc: EditPanel | null;
  changes: ImportChange[];
  issues: ImportIssue[];
  /** Why this panel cannot be imported, if it cannot. */
  blocker: string | null;
}

interface Outcome {
  key: string;
  name: string;
  panelId: number | null;
  error: string | null;
}

const pathOf = (byId: Map<number, TreeNode>, id: number) =>
  ancestry(byId, id)
    .map((n) => n.name)
    .join(' › ');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function blankBreaker(row: ImportedBreaker, defaultAmps: number): EditBreaker {
  return {
    key: newKey(),
    position: row.position,
    slot: row.slot,
    poles: row.poles,
    device: 'breaker',
    protection: 'standard',
    label: '',
    notes: '',
    isSpare: false,
    critical: false,
    backup: 'none',
    serves: [],
    tags: [],
    sourceBreakerId: null,
    control: '',
    loadVa: null,
    demandPct: null,
    section: row.section,
    unit: row.unit,
    frameAmps: null,
    wire: '',
    conduit: '',
    starter: '',
    hp: null,
    verifyStatus: '',
    ...row.values,
    amps: row.values.amps ?? defaultAmps,
  };
}

/** The highest space a section's rows reach, counting every pole. */
function highestIn(rows: readonly ImportedBreaker[], section: number, layout: PanelLayout): number {
  const step = layout === 'commercial' || layout === 'residential' ? 2 : 1;
  return Math.max(
    0,
    ...rows
      .filter((r) => r.section === section)
      .map((r) => (isListLayout({ layout }) ? r.position : r.position + (r.poles - 1) * step)),
  );
}

/** A new panel shaped to hold the rows: each section sized to its highest circuit. */
function newPanelDoc(p: ImportedPanel, layout: PanelLayout): EditPanel {
  const list = isListLayout({ layout });
  const sectionCount = Math.max(1, ...p.breakers.map((b) => b.section));
  const size = (n: number) =>
    list
      ? Math.max(1, p.breakers.filter((b) => b.section === n).length, highestIn(p.breakers, n, layout))
      : spacesToFit(layout, Math.max(1, highestIn(p.breakers, n, layout)));
  return {
    name: p.name.slice(0, 80),
    layout,
    spaces: size(1),
    mainAmps: null,
    mainType: 'breaker',
    voltage: p.voltage.slice(0, 40),
    manufacturer: '',
    model: '',
    notes: '',
    fedFromBreakerId: null,
    fedFromDeviceId: null,
    nameplate: { aicKa: null, busAmps: null, mounting: '', enclosure: '', feederWire: '', feederConduit: '' },
    fedWay: '',
    sections: Array.from({ length: sectionCount - 1 }, (_, i) => ({
      name: `Section ${i + 2}`,
      spaces: size(i + 2),
      throughLugs: false,
    })),
    generatorId: null,
    transferSwitch: '',
    controlSystem: '',
    atsId: null,
    breakers: [],
  };
}

/**
 * Import panel schedules from a spreadsheet: paste cells or choose a CSV file, say which column
 * is which, review what each panel gains or changes, then save. Each panel is saved like an edit
 * in the panel editor, with its history.
 */
export function ImportPage() {
  useTitle('Import');
  const [params] = useSearchParams();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const locations = useLocations();
  const panels = usePanels();
  const { byId } = useMemo(() => buildTree(locations.data ?? []), [locations.data]);
  const startPanel = (panels.data ?? []).find((p) => p.id === Number(params.get('panel')));
  const startLoc = Number(params.get('loc')) || startPanel?.locationId || null;

  const [step, setStep] = useState<Step>('source');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [chosenRoom, setRoom] = useState<number | null>(null);
  const [panelName, setPanelName] = useState<string | null>(null);
  const [defaultAmps, setDefaultAmps] = useState('20');
  const [mode, setMode] = useState<Mode>('merge');
  const [layout, setLayout] = useState<PanelLayout>('commercial');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [layouts, setLayouts] = useState<Record<string, PanelLayout>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const details = useRef(new Map<number, PanelDetail>());

  // Rooms the person can add panels to, nearest the place they came from first.
  const scopeId = startLoc ? (siteOf(byId, startLoc)?.id ?? null) : null;
  const rooms = [...byId.values()]
    .filter((n) => n.kind === 'room' && n.access === 'full' && atLeast(n.role, 'editor'))
    .filter((n) => !scopeId || siteOf(byId, n.id)?.id === scopeId)
    .map((n) => ({ id: n.id, path: pathOf(byId, n.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const defaultRoom =
    startLoc && byId.get(startLoc)?.kind === 'room' && rooms.some((r) => r.id === startLoc)
      ? startLoc
      : rooms.length === 1
        ? rooms[0]!.id
        : null;
  const room = chosenRoom ?? defaultRoom;
  const name = panelName ?? startPanel?.name ?? '';

  const cells = useMemo(() => parseDelimited(text), [text]);
  const width = Math.max(0, ...cells.map((r) => r.length));
  const headers = hasHeader && cells[0] ? cells[0] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const body = hasHeader ? cells.slice(1) : cells;
  const panelColumn = mapping.includes('panel');

  const readOnly = me.viewingAs;

  const toColumns = () => {
    const header = looksLikeHeader(cells[0] ?? []);
    setHasHeader(header);
    const guessed = header ? guessMapping(cells[0]!) : [];
    setMapping(
      Array.from(
        { length: width },
        (_, i) => guessed[i] ?? (header ? null : ((['circuit', 'label', 'amps'] as const)[i] ?? null)),
      ),
    );
    setStep('columns');
  };

  const buildPlans = async (layoutFor: Record<string, PanelLayout> = layouts) => {
    setBusy('Reading rows and matching panels…');
    setError(null);
    try {
      const amps = Math.max(1, Math.min(4000, Math.round(Number(defaultAmps) || 20)));
      const imported = readRows(body, mapping, { panelName: name, defaultAmps: amps }, hasHeader ? 2 : 1);
      const all = panels.data ?? [];
      const out: Plan[] = [];
      for (const p of imported) {
        const key = p.name.toLowerCase();
        const issues = [...p.issues];
        const base: Plan = {
          key,
          name: p.name,
          existing: null,
          roomId: null,
          layout: layoutFor[key] ?? layout,
          version: 0,
          baselineFeed: '',
          knownIds: new Set(),
          doc: null,
          changes: [],
          issues,
          blocker: null,
        };
        // Panels are matched by name within the site the import is for.
        const siteId = room ? siteOf(byId, room)?.id : scopeId;
        const sameName = all.filter(
          (x) => x.name.trim().toLowerCase() === key && (!siteId || siteOf(byId, x.locationId)?.id === siteId),
        );
        const placeFor = (siteNode: TreeNode | null): PlaceCandidate[] =>
          [...byId.values()]
            .filter(
              (n) =>
                n.access === 'full' &&
                n.kind !== 'company' &&
                n.kind !== 'site' &&
                (!siteNode || siteOf(byId, n.id)?.id === siteNode.id),
            )
            .map((n) => ({ id: n.id, name: n.name, path: pathOf(byId, n.id) }));
        const locationRoom = p.location ? matchPlace(p.location, placeFor(siteId ? byId.get(siteId)! : null)) : null;
        let existing = sameName.length === 1 ? sameName[0]! : null;
        if (sameName.length > 1) {
          existing = sameName.find((x) => x.locationId === locationRoom?.id) ?? null;
          if (!existing) {
            out.push({
              ...base,
              blocker: `${sameName.length} panels in this site are called ${p.name}. Add a panel location column to say which.`,
            });
            continue;
          }
        }
        let doc: EditPanel;
        let plan: Plan;
        if (existing) {
          if (!atLeast(existing.role, 'editor')) {
            out.push({ ...base, existing, blocker: `You can view ${existing.name} but not change it.` });
            continue;
          }
          let detail = details.current.get(existing.id);
          if (!detail) {
            detail = await api.get<PanelDetail>(`/api/panels/${existing.id}`);
            details.current.set(existing.id, detail);
          }
          if (detail.layout === 'relay') {
            out.push({ ...base, existing, blocker: 'Relay panels are not imported from spreadsheets yet.' });
            continue;
          }
          doc = fromDetail(detail);
          plan = {
            ...base,
            existing,
            layout: detail.layout,
            version: detail.version,
            baselineFeed: feedKey(detail),
            knownIds: new Set(detail.breakers.map((b) => b.id)),
            doc,
          };
        } else {
          const roomId = locationRoom && byId.get(locationRoom.id)?.kind === 'room' ? locationRoom.id : room;
          if (!roomId || !rooms.some((r) => r.id === roomId)) {
            out.push({ ...base, blocker: 'Choose a room for new panels.' });
            continue;
          }
          doc = newPanelDoc(p, base.layout);
          plan = { ...base, roomId, doc };
        }

        // Rooms each row serves, among the places in the panel's site.
        const panelRoom = existing?.locationId ?? plan.roomId!;
        const places = placeFor(siteOf(byId, panelRoom));
        const resolve = (row: ImportedBreaker) => {
          if (!row.serves.length) return null;
          const found: { locationId: number; note: string }[] = [];
          for (const text of row.serves) {
            const whole = matchPlace(text, places);
            const { place, note } = splitServe(text);
            const hit = whole ?? matchPlace(place, places);
            if (hit) {
              if (!found.some((f) => f.locationId === hit.id))
                found.push({ locationId: hit.id, note: whole ? '' : note });
            } else
              issues.push({ line: row.line, level: 'warning', message: `No room "${text}" in this site; left off.` });
          }
          return found;
        };
        const amps = Math.max(1, Math.min(4000, Math.round(Number(defaultAmps) || 20)));
        const merged = mergeBreakers(
          doc,
          doc.breakers,
          p.breakers,
          resolve,
          (row) => blankBreaker(row, amps),
          mode === 'replace',
        );
        plan.doc = { ...doc, breakers: merged.breakers };
        plan.changes = merged.changes;
        const problems = validateSections(
          plan.doc,
          merged.breakers.map((b) => ({
            key: b.key,
            position: b.position,
            slot: b.slot,
            poles: b.poles,
            label: b.label,
            section: b.section,
          })),
        );
        if (problems.length) {
          const lineOf = new Map(merged.changes.map((c) => [c.key, 'line' in c ? c.line : 0]));
          for (const x of problems) {
            const line = x.key ? (lineOf.get(x.key) ?? 0) : 0;
            issues.push({ line, level: 'error', message: x.message });
          }
          plan.blocker = `${plural(problems.length, 'problem')} to fix in the file (or the panel) first.`;
        }
        out.push(plan);
      }
      setPlans(out);
      setSkip(new Set(out.filter((p) => p.blocker).map((p) => p.key)));
      setStep('review');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    const chosen = plans.filter((p) => !skip.has(p.key) && !p.blocker && p.doc);
    const results: Outcome[] = [];
    setError(null);
    for (const [i, p] of chosen.entries()) {
      setBusy(`Saving ${p.name} (${i + 1} of ${chosen.length})…`);
      try {
        let panelId = p.existing?.id ?? null;
        let doc = p.doc!;
        let version = p.version;
        let baselineFeed = p.baselineFeed;
        let knownIds = p.knownIds;
        if (!panelId) {
          const created = await api.post<{ id: number }>(`/api/locations/${p.roomId}/panels`, {
            name: doc.name,
            layout: doc.layout,
            spaces: doc.spaces,
            voltage: doc.voltage,
            sections: doc.sections,
          });
          panelId = created.id;
          const detail = await api.get<PanelDetail>(`/api/panels/${panelId}`);
          doc = { ...fromDetail(detail), breakers: doc.breakers };
          version = detail.version;
          baselineFeed = feedKey(detail);
          knownIds = new Set();
        }
        if (p.changes.some((c) => c.kind !== 'same')) {
          await api.put<SavePanelResponse>(`/api/panels/${panelId}`, toRequest(doc, version, baselineFeed, knownIds));
        }
        details.current.delete(panelId);
        results.push({ key: p.key, name: p.name, panelId, error: null });
      } catch (e) {
        results.push({ key: p.key, name: p.name, panelId: p.existing?.id ?? null, error: errorMessage(e) });
      }
    }
    setBusy(null);
    setOutcomes(results);
    setStep('done');
    void qc.invalidateQueries();
  };

  if (locations.isPending || panels.isPending) return <div className="page-loading">Loading…</div>;
  if (readOnly) {
    return (
      <main className="content">
        <p className="readonly-note">Viewing as someone else: importing is turned off.</p>
      </main>
    );
  }

  const counts = (p: Plan) => ({
    added: p.changes.filter((c) => c.kind === 'new').length,
    changed: p.changes.filter((c) => c.kind === 'changed').length,
    same: p.changes.filter((c) => c.kind === 'same').length,
    removed: p.changes.filter((c) => c.kind === 'removed').length,
    errors: p.issues.filter((x) => x.level === 'error').length,
  });
  const going = plans.filter((p) => !skip.has(p.key) && !p.blocker);
  const total = going.reduce(
    (t, p) => {
      const c = counts(p);
      return { added: t.added + c.added, changed: t.changed + c.changed, removed: t.removed + c.removed };
    },
    { added: 0, changed: 0, removed: 0 },
  );

  const nothingToDo =
    going.length === 0 || (total.added + total.changed + total.removed === 0 && going.every((p) => p.existing));

  return (
    <main className="content stack-lg import-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Import</span>
          <h1>Import panel schedules</h1>
          <p className="muted">
            Bring in circuits from a spreadsheet: one row per breaker, with a panel name, circuit number and label. You
            review everything before it's saved, and each panel's history shows what changed.
          </p>
        </div>
      </div>
      <ol className="import-steps" aria-label="Steps">
        {(['source', 'columns', 'review', 'done'] as Step[]).map((s, i) => (
          <li key={s} aria-current={step === s ? 'step' : undefined} className={step === s ? 'is-current' : ''}>
            {i + 1}. {{ source: 'Choose data', columns: 'Match columns', review: 'Review', done: 'Done' }[s]}
          </li>
        ))}
      </ol>
      {error ? <ErrorNote error={error} /> : null}
      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}

      {step === 'source' && (
        <section className="panel stack" aria-label="Choose data">
          <label className="field">
            <span className="field-label">CSV file</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setText(await f.text());
              }}
            />
            <span className="muted small">
              From Excel or Google Sheets: File › Save as (or Download) › CSV. One sheet at a time.
            </span>
          </label>
          <label className="field">
            <span className="field-label">Or paste cells from a spreadsheet</span>
            <textarea
              rows={8}
              className="mono"
              value={text}
              placeholder={'Panel\tCircuit\tDescription\tAmps\nLP-1A\t1\tLab 110 receptacles\t20'}
              onChange={(e) => {
                setFileName('');
                setText(e.target.value);
              }}
            />
          </label>
          {text && (
            <p className="small muted">
              {fileName ? `${fileName}: ` : ''}
              {plural(cells.length, 'row')}, {plural(width, 'column')}.
            </p>
          )}
          <div className="import-options">
            <label className="field">
              <span className="field-label">New panels go in</span>
              <select value={room ?? ''} onChange={(e) => setRoom(Number(e.target.value) || null)}>
                <option value="">Choose a room…</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.path}
                  </option>
                ))}
              </select>
              <span className="muted small">Unless a panel location column names another room.</span>
            </label>
            <label className="field">
              <span className="field-label">New panels are</span>
              <select value={layout} onChange={(e) => setLayout(e.target.value as PanelLayout)}>
                {NEW_LAYOUTS.map((l) => (
                  <option key={l} value={l}>
                    {LAYOUT_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Rating for unrated breakers (A)</span>
              <input
                type="number"
                min={1}
                max={4000}
                value={defaultAmps}
                onChange={(e) => setDefaultAmps(e.target.value)}
              />
              <span className="muted small">They stay "Not checked" so they show up for field checks.</span>
            </label>
          </div>
          <fieldset className="field">
            <legend className="field-label">Panels that already exist</legend>
            <label className="radio-row">
              <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span>
                <strong>Update the circuits listed</strong>
                <span className="muted small block">
                  Blank cells and circuits not in the file are left as they are.
                </span>
              </span>
            </label>
            <label className="radio-row">
              <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <strong>Replace all circuits</strong>
                <span className="muted small block">
                  Circuits not in the file are removed. You can undo this from the panel's history.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="row">
            <button type="button" className="btn btn-dark" disabled={cells.length === 0} onClick={toColumns}>
              Next: match columns
            </button>
          </div>
        </section>
      )}

      {step === 'columns' && (
        <section className="panel stack" aria-label="Match columns">
          <label className="check">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => {
                setHasHeader(e.target.checked);
                if (e.target.checked && cells[0]) setMapping(guessMapping(cells[0]));
              }}
            />
            <span>The first row is column names</span>
          </label>
          <div className="import-scroll">
            <table className="import-table">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} scope="col">
                      <span className="import-header">{h || `Column ${i + 1}`}</span>
                      <select
                        aria-label={`Column ${i + 1}${h ? ` (${h})` : ''} is`}
                        value={mapping[i] ?? ''}
                        onChange={(e) => {
                          const v = (e.target.value || null) as ImportField | null;
                          setMapping((m) => {
                            const next = [...m];
                            // Each field comes from one column.
                            if (v) for (let j = 0; j < next.length; j++) if (next[j] === v) next[j] = null;
                            next[i] = v;
                            return next;
                          });
                        }}
                      >
                        <option value="">Skip</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {IMPORT_FIELD_LABELS[f]}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    {headers.map((_, j) => (
                      <td key={j} className={mapping[j] ? '' : 'is-skipped'}>
                        {r[j] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Showing {Math.min(6, body.length)} of {plural(body.length, 'row')}.
          </p>
          {!panelColumn && (
            <label className="field">
              <span className="field-label">Panel name for every row</span>
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setPanelName(e.target.value)}
                placeholder="e.g. LP-1A"
              />
              <span className="muted small">There is no panel name column, so all rows go to this panel.</span>
            </label>
          )}
          {!mapping.includes('circuit') && <p className="error">Say which column holds the circuit or unit number.</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep('source')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-dark"
              disabled={!mapping.includes('circuit') || (!panelColumn && !name.trim()) || !!busy}
              onClick={() => void buildPlans()}
            >
              Next: review
            </button>
          </div>
        </section>
      )}

      {step === 'review' && (
        <section className="stack" aria-label="Review">
          <div className="panel stack-sm">
            <h2 className="h-caps">Ready to import</h2>
            <p>
              {plural(going.length, 'panel')} ({going.filter((p) => !p.existing).length} new,{' '}
              {going.filter((p) => p.existing).length} updated): {plural(total.added, 'new circuit')}, {total.changed}{' '}
              changed{total.removed ? `, ${total.removed} removed` : ''}.
            </p>
            {plans.some((p) => p.blocker) && (
              <p className="small error">
                {plural(plans.filter((p) => p.blocker).length, 'panel')} can't be imported as they are. See below.
              </p>
            )}
            <div className="row">
              <button type="button" className="btn" onClick={() => setStep('columns')}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={nothingToDo || !!busy}
                onClick={() => void apply()}
              >
                {nothingToDo && going.length ? 'Nothing to change' : `Import ${plural(going.length, 'panel')}`}
              </button>
            </div>
          </div>
          {plans.map((p) => {
            const c = counts(p);
            const where = p.existing
              ? `Updates the panel in ${pathOf(byId, p.existing.locationId)}`
              : p.roomId
                ? `New panel in ${pathOf(byId, p.roomId)} · ${
                    p.doc
                      ? `${LAYOUT_LABELS[p.layout]}, ${sectionsOf(p.doc)
                          .map((s) => s.spaces)
                          .join(' + ')} ${isListLayout(p.doc) ? 'units' : 'spaces'}`
                      : ''
                  }`
                : 'New panel';
            return (
              <article
                key={p.key}
                className={`panel stack-sm import-plan${p.blocker ? ' is-blocked' : ''}`}
                aria-label={`Panel ${p.name}`}
              >
                <div className="row space-between">
                  <label className="check">
                    <input
                      type="checkbox"
                      disabled={!!p.blocker}
                      checked={!skip.has(p.key) && !p.blocker}
                      onChange={(e) =>
                        setSkip((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.delete(p.key);
                          else next.add(p.key);
                          return next;
                        })
                      }
                    />
                    <strong className="import-name">{p.name}</strong>
                    <span className={`badge ${p.existing ? 'badge-ups' : 'badge-gen'}`}>
                      {p.existing ? 'Update' : 'New'}
                    </span>
                  </label>
                  {!p.existing && !p.blocker && (
                    <select
                      aria-label={`Layout for ${p.name}`}
                      value={p.layout}
                      onChange={(e) => {
                        const next = { ...layouts, [p.key]: e.target.value as PanelLayout };
                        setLayouts(next);
                        void buildPlans(next);
                      }}
                    >
                      {NEW_LAYOUTS.map((l) => (
                        <option key={l} value={l}>
                          {LAYOUT_LABELS[l]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="small muted">{where}</p>
                {p.blocker ? (
                  <p className="error small">{p.blocker}</p>
                ) : (
                  <p className="import-counts small">
                    <span>{c.added} new</span>
                    <span>{c.changed} changed</span>
                    <span>{c.same} unchanged</span>
                    {c.removed > 0 && <span className="is-removed">{c.removed} removed</span>}
                  </p>
                )}
                {p.issues.length > 0 && (
                  <ul className="import-issues">
                    {p.issues.slice(0, 50).map((x, i) => (
                      <li key={i} className={x.level === 'error' ? 'error' : 'muted'}>
                        {x.line ? `Row ${x.line}: ` : ''}
                        {x.message}
                      </li>
                    ))}
                    {p.issues.length > 50 && <li className="muted">And {p.issues.length - 50} more.</li>}
                  </ul>
                )}
                {p.changes.length > 0 && (
                  <details>
                    <summary>Show circuits</summary>
                    <table className="import-table import-changes">
                      <thead>
                        <tr>
                          <th scope="col">Row</th>
                          <th scope="col">Circuit</th>
                          <th scope="col">Label</th>
                          <th scope="col">What happens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.changes.map((ch) => (
                          <tr key={`${ch.kind}:${ch.key}`} className={`is-${ch.kind}`}>
                            <td>{'line' in ch ? ch.line : ''}</td>
                            <td className="mono">{ch.circuit}</td>
                            <td>{ch.label || <span className="muted">Unlabelled</span>}</td>
                            <td>
                              {ch.kind === 'new'
                                ? 'Added'
                                : ch.kind === 'changed'
                                  ? `Changes ${ch.fields.join(', ')}`
                                  : ch.kind === 'removed'
                                    ? 'Removed'
                                    : 'No change'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </article>
            );
          })}
        </section>
      )}

      {step === 'done' && (
        <section className="panel stack" aria-label="Done">
          <h2 className="h-caps">Import finished</h2>
          <p>
            {plural(outcomes.filter((o) => !o.error).length, 'panel')} saved
            {outcomes.some((o) => o.error) ? `, ${outcomes.filter((o) => o.error).length} not saved` : ''}.
          </p>
          <ul className="import-results">
            {outcomes.map((o) => (
              <li key={o.key}>
                {o.panelId ? <Link to={`/panels/${o.panelId}`}>{o.name}</Link> : <strong>{o.name}</strong>}{' '}
                {o.error ? <span className="error small">{o.error}</span> : <span className="muted small">Saved</span>}
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText('');
                setPlans([]);
                setOutcomes([]);
                setStep('source');
              }}
            >
              Import more
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
