import {
  LAYOUT_LABELS,
  columnsFor,
  isListLayout,
  maxPoles,
  sectionsOf,
  spacesText,
  POWER_DEVICE_LABELS,
  generatorRating,
  nameplateText,
  type PanelDetail,
  type PanelHistoryItem,
  type SavePanelResponse,
  type Slot,
} from '@cbt/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../api';
import { useCurrentUser } from '../auth';
import { NodeIcon } from '../components/PowerIcon';
import { ImpactButton } from '../components/Impact';
import { PanelReports } from '../components/Reports';
import { PANEL_PRINT_STYLES, PrintButton } from '../components/PrintDialog';
import { ErrorNote, formatDate } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { Inspector } from '../panel/Inspector';
import { LoadSummary } from '../panel/LoadSummary';
import { UnitList } from '../panel/UnitList';
import { BulkBar } from '../panel/BulkBar';
import { PanelGrid } from '../panel/PanelGrid';
import { PanelSettings } from '../panel/PanelSettings';
import { siteOf } from '../panel/serves';
import {
  addBreaker,
  addUnit,
  bulkUpdate,
  shiftBreakers,
  applyIds,
  feedKey,
  fromDetail,
  moveBreaker,
  removeBreaker,
  setSize,
  toRequest,
  updateBreaker,
  updatePanel,
  type EditBreaker,
  type EditPanel,
  type Result,
  type Size,
} from '../panel/state';
import { ancestry, buildTree } from '../tree';
import { useLocations } from '../queries';

export function PanelEditorPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const breakerParam = params.get('breaker');
  const panelId = Number(id);
  const [reloads, setReloads] = useState(0);
  const detail = useQuery({
    queryKey: ['panel', panelId, reloads],
    queryFn: () => api.get<PanelDetail>(`/api/panels/${panelId}`),
    staleTime: Infinity,
    retry: false,
  });
  if (detail.isLoading) return <div className="page-loading">Loading panel…</div>;
  if (detail.error || !detail.data) {
    return (
      <main className="content narrow">
        <h1>Panel not available</h1>
        <ErrorNote error={detail.error ?? new Error('Not found.')} />
        <p>
          <Link to="/">Back to sites</Link>
        </p>
      </main>
    );
  }
  return (
    <Editor
      key={`${panelId}:${reloads}`}
      initial={detail.data}
      initialSelected={breakerParam ? `id-${breakerParam}` : null}
      onReload={() => setReloads((n) => n + 1)}
    />
  );
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
const SAVE_DELAY_MS = 700;
const COALESCE_MS = 1500;
const MAX_UNDO = 100;

function Editor({
  initial,
  initialSelected,
  onReload,
}: {
  initial: PanelDetail;
  initialSelected: string | null;
  onReload: () => void;
}) {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const locations = useLocations();
  const { byId } = buildTree(locations.data ?? []);

  const [doc, setDoc] = useState<EditPanel>(() => fromDetail(initial));
  const [server, setServer] = useState(initial);
  // Undo/redo stacks live in a ref so handlers always see the latest; their sizes are state so
  // the Undo and Redo buttons re-render when they change.
  const stacks = useRef<{ past: EditPanel[]; future: EditPanel[] }>({ past: [], future: [] });
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const setStacks = useCallback((next: { past: EditPanel[]; future: EditPanel[] }) => {
    stacks.current = next;
    setHistory({ undo: next.past.length, redo: next.future.length });
  }, []);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  // A search result can point at another breaker while this panel is already open.
  const [lastInitial, setLastInitial] = useState(initialSelected);
  if (initialSelected !== lastInitial) {
    setLastInitial(initialSelected);
    if (initialSelected) setSelected(initialSelected);
  }
  const [message, setMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Highlight the breakers with one tag, e.g. every "Servers" circuit.
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Field checking: show only circuits not checked yet (or found wrong), and pick many at once.
  const [checkFilter, setCheckFilter] = useState<'' | 'unchecked' | 'wrong'>('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const docRef = useRef(doc);
  const version = useRef(initial.version);
  const baselineFed = useRef(feedKey(initial));
  const knownIds = useRef(new Set(initial.breakers.map((b) => b.id)));
  const editSeq = useRef(0);
  const saving = useRef(false);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);

  const readOnly = !initial.canEdit || me.viewingAs;

  const setDocNow = (next: EditPanel) => {
    docRef.current = next;
    setDoc(next);
    editSeq.current++;
    setSaveState('pending');
  };

  const commit = useCallback(
    (next: EditPanel, coalesce?: string) => {
      const t = Date.now();
      const last = lastCoalesce.current;
      const merge = coalesce && last && last.key === coalesce && t - last.at < COALESCE_MS;
      if (!merge) {
        setStacks({ past: [...stacks.current.past, docRef.current].slice(-MAX_UNDO), future: [] });
      }
      lastCoalesce.current = coalesce ? { key: coalesce, at: t } : null;
      setMessage(null);
      setDocNow(next);
    },
    [setStacks],
  );

  const apply = (r: Result, coalesce?: string) => {
    if (r.ok) commit(r.doc, coalesce);
    else setMessage(r.error);
    return r.ok;
  };

  const undo = useCallback(() => {
    const s = stacks.current;
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    setStacks({ past: s.past.slice(0, -1), future: [docRef.current, ...s.future] });
    lastCoalesce.current = null;
    setMessage(null);
    setDocNow(prev);
  }, [setStacks]);

  const redo = useCallback(() => {
    const s = stacks.current;
    const next = s.future[0];
    if (!next) return;
    setStacks({ past: [...s.past, docRef.current], future: s.future.slice(1) });
    lastCoalesce.current = null;
    setMessage(null);
    setDocNow(next);
  }, [setStacks]);

  // ---- Autosave ----------------------------------------------------------------------

  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    const seq = editSeq.current;
    setSaveState('saving');
    try {
      const body = toRequest(docRef.current, version.current, baselineFed.current, knownIds.current);
      const res = await api.put<SavePanelResponse>(`/api/panels/${initial.id}`, body);
      version.current = res.panel.version;
      baselineFed.current = feedKey(res.panel);
      knownIds.current = new Set(res.panel.breakers.map((b) => b.id));
      setServer(res.panel);
      const withIds = applyIds(docRef.current, res.idMap);
      if (withIds !== docRef.current) {
        docRef.current = withIds;
        setDoc(withIds);
      }
      stacks.current = {
        past: stacks.current.past.map((d) => applyIds(d, res.idMap)),
        future: stacks.current.future.map((d) => applyIds(d, res.idMap)),
      };
      setSaveError(null);
      setSaveState(editSeq.current === seq ? 'saved' : 'pending');
      void qc.invalidateQueries({ queryKey: ['panels'] });
      void qc.invalidateQueries({ queryKey: ['panel-history', initial.id] });
      void qc.invalidateQueries({ queryKey: ['tags'] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setSaveState('conflict');
      else {
        setSaveState('error');
        setSaveError(errorMessage(err));
      }
    } finally {
      saving.current = false;
    }
  }, [initial.id, qc]);

  useEffect(() => {
    if (saveState !== 'pending' || readOnly) return;
    const t = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [doc, saveState, flush, readOnly]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === 'pending' || saveState === 'saving' || saveState === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('dialog')) return;
      if (e.key === 'Escape') {
        setSelected(null);
        return;
      }
      if (readOnly || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, undo, redo]);

  // On narrow screens the details sit below the panel: bring them into view on selection.
  useEffect(() => {
    if (!selected || !window.matchMedia('(max-width: 960px)').matches) return;
    requestAnimationFrame(() =>
      document.querySelector('.inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, [selected]);

  useTitle(doc.name);

  // ---- Derived -----------------------------------------------------------------------

  const selectedBreaker = doc.breakers.find((b) => b.key === selected) ?? null;
  const serverBreaker = selectedBreaker?.id ? server.breakers.find((b) => b.id === selectedBreaker.id) : undefined;
  const site = siteOf(byId, initial.locationId);
  const chain = ancestry(byId, initial.locationId);
  // The power-flow map of the nearest building (or site), centred on this panel.
  const flowAt = [...chain].reverse().find((c) => c.kind === 'building' || c.kind === 'site');
  const flowHref = `/power?loc=${flowAt?.id ?? initial.locationId}&focus=p${initial.id}`;

  // Save pending edits first so the PDF matches what is on screen.
  const printFlush = async () => {
    if (saveState === 'pending' || saveState === 'error') await flush();
  };

  const deletePanel = async () => {
    try {
      await api.del(`/api/panels/${initial.id}`);
      await qc.invalidateQueries({ queryKey: ['panels'] });
      navigate(`/?loc=${initial.locationId}`);
    } catch (err) {
      setMessage(errorMessage(err));
    }
  };

  const dimmed =
    tagFilter || checkFilter
      ? (b: EditBreaker) =>
          (!!tagFilter && !b.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())) ||
          (checkFilter === 'unchecked' && b.verifyStatus !== '') ||
          (checkFilter === 'wrong' && b.verifyStatus !== 'wrong')
      : undefined;
  const onPick = (key: string) => {
    if (!selecting) return setSelected(key);
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const bulk = (r: Result) => apply(r);

  // What the rows are called in words.
  const thing =
    doc.layout === 'mcc' ? 'bucket' : isListLayout(doc) ? 'unit' : doc.layout === 'relay' ? 'relay' : 'breaker';
  const feedsMap = new Map(
    server.breakers.map((b) => [
      b.id,
      [
        ...b.feedsDevices.map((d) => d.name),
        ...b.feeds.map((f) => f.panelName),
        ...(b.hiddenFeeds ? [`${b.hiddenFeeds} more`] : []),
      ],
    ]),
  );
  const relaySources =
    doc.layout === 'relay'
      ? new Map(
          server.breakers.map((b) => [b.id, b.source ? `${b.source.panelName} · ${b.source.circuit}` : 'Feed not set']),
        )
      : undefined;

  return (
    <main className="editor">
      <div className="editor-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">Sites</Link>
          {chain.map((c) => (
            <span key={c.id}>
              <span aria-hidden="true"> / </span>
              <Link to={`/?loc=${c.id}`}>{c.name}</Link>
            </span>
          ))}
        </nav>
        <div className="page-head">
          <div>
            <h1>{doc.name}</h1>
            <p className="muted">
              {doc.layout === 'relay' && doc.controlSystem
                ? `${doc.controlSystem} relay panel`
                : LAYOUT_LABELS[doc.layout]}
              {doc.voltage && ` · ${doc.voltage}`} · {spacesText(doc)}
              {doc.layout !== 'relay' &&
                (doc.mainType === 'lugs' ? ' · main lugs' : ` · ${doc.mainAmps ?? '?'} A main`)}
              {(doc.manufacturer || doc.model) && ` · ${[doc.manufacturer, doc.model].filter(Boolean).join(' ')}`}
            </p>
            {nameplateText(doc.nameplate, doc.mainType === 'lugs' ? null : doc.mainAmps) && (
              <p className="muted small nameplate">
                {nameplateText(doc.nameplate, doc.mainType === 'lugs' ? null : doc.mainAmps)}
              </p>
            )}
            <PowerStrip panel={server} flowHref={flowHref} />
          </div>
          <div className="toolbar">
            {!readOnly && <SaveBadge state={saveState} />}
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={undo}
                  disabled={history.undo === 0}
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={redo}
                  disabled={history.redo === 0}
                  aria-label="Redo"
                  title="Redo (Ctrl+Shift+Z)"
                >
                  Redo
                </button>
              </>
            )}
            <button type="button" className="btn" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
              History
            </button>
            <Link className="btn" to={`/panels/${initial.id}/field`}>
              Field mode
            </Link>
            <ImpactButton query={`panel=${initial.id}`} label="Shutdown impact" />
            <PrintButton
              endpoint={`/api/panels/${initial.id}/pdf`}
              csv={`/api/panels/${initial.id}/csv`}
              styles={PANEL_PRINT_STYLES}
              subject={doc.name}
              beforeOpen={readOnly ? undefined : printFlush}
              warning={
                !readOnly && saveState !== 'saved'
                  ? 'Your latest changes are not saved yet, so they will not be in the PDF.'
                  : null
              }
            />
            {!readOnly && (
              <button
                type="button"
                className="btn btn-dark"
                aria-expanded={showSettings}
                onClick={() => setShowSettings((v) => !v)}
              >
                Panel settings
              </button>
            )}
          </div>
        </div>
        {readOnly && (
          <p className="readonly-note">
            {me.viewingAs ? 'Viewing as someone else: read-only.' : 'You can view this panel but not change it.'}
          </p>
        )}
      </div>

      <PanelReports panelId={initial.id} count={initial.openReports} />
      {saveState === 'conflict' && (
        <div className="banner banner-warn" role="alert">
          <span>Someone else saved this panel while you were editing. Your last change was not saved.</span>
          <button type="button" className="btn btn-dark" onClick={onReload}>
            Load their version
          </button>
        </div>
      )}
      {saveState === 'error' && (
        <div className="banner banner-error" role="alert">
          <span>Could not save: {saveError}</span>
          <button type="button" className="btn" onClick={() => void flush()}>
            Try again
          </button>
        </div>
      )}
      {message && (
        <div className="banner banner-error" role="alert">
          <span>{message}</span>
          <button type="button" className="btn btn-sm" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {showSettings && !readOnly && (
        <PanelSettings
          doc={doc}
          server={server}
          onChange={(patch, coalesce) => apply(updatePanel(docRef.current, patch), coalesce)}
          onDelete={() => void deletePanel()}
        />
      )}
      {showHistory && <History panelId={initial.id} />}

      <div className="editor-body">
        <section className="editor-center" aria-label="Panel">
          <Legend relay={doc.layout === 'relay'} />
          {doc.layout !== 'relay' && (
            <LoadSummary
              panel={doc}
              breakers={doc.breakers}
              mainAmps={doc.mainType === 'lugs' ? null : doc.mainAmps}
              check={server.loadCheck}
              warnings={server.warnings}
              onFillFromNotes={
                readOnly
                  ? undefined
                  : (loads) =>
                      commit({
                        ...docRef.current,
                        breakers: docRef.current.breakers.map((b) =>
                          loads.has(b.key) ? { ...b, loadVa: loads.get(b.key)! } : b,
                        ),
                      })
              }
            />
          )}
          <div className="editor-filters">
            <TagFilter breakers={doc.breakers} value={tagFilter} onChange={setTagFilter} />
            <CheckFilter breakers={doc.breakers} value={checkFilter} onChange={setCheckFilter} />
            {!readOnly && (
              <button
                type="button"
                className="btn btn-sm"
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting(!selecting);
                  setPicked(new Set());
                  setSelected(null);
                }}
              >
                {selecting ? 'Stop selecting' : 'Select several'}
              </button>
            )}
          </div>
          {isListLayout(doc) ? (
            <UnitList
              doc={doc}
              byId={byId}
              highlightTag={tagFilter}
              dimmed={dimmed}
              picked={selecting ? picked : undefined}
              selectedKey={selected}
              readOnly={readOnly}
              onSelect={onPick}
              onAdd={() => {
                const r = addUnit(docRef.current);
                if (apply(r) && r.ok && 'key' in r && r.key) setSelected(r.key);
              }}
              feeds={feedsMap}
            />
          ) : (
            sectionsOf(doc).map((sec, i) => (
              <div key={i} className="pg-section">
                {i > 0 && (
                  <h3 className="pg-section-title">
                    {sec.name}
                    {sec.throughLugs && <span className="muted"> · fed through lugs</span>}
                  </h3>
                )}
                <PanelGrid
                  doc={{ ...doc, spaces: sec.spaces, breakers: doc.breakers.filter((b) => b.section === i + 1) }}
                  heading={i === 0 ? undefined : sec.throughLugs ? 'THROUGH LUGS' : sec.name.toUpperCase()}
                  highlightTag={tagFilter}
                  dimmed={dimmed}
                  picked={selecting ? picked : undefined}
                  byId={byId}
                  selectedKey={selected}
                  readOnly={readOnly}
                  onSelect={onPick}
                  onAdd={(position: number, slot: Slot) => {
                    const r = addBreaker(docRef.current, position, slot, i + 1);
                    if (apply(r) && r.ok && 'key' in r && r.key) setSelected(r.key);
                  }}
                  onMove={(key, position, slot) => apply(moveBreaker(docRef.current, key, position, slot, i + 1))}
                  relaySources={relaySources}
                  feeds={feedsMap}
                />
              </div>
            ))
          )}
        </section>
        {selecting && !readOnly ? (
          <BulkBar
            count={picked.size}
            maxPoles={maxPoles(doc)}
            rowStep={columnsFor(doc)}
            onAmps={(amps) => bulk(bulkUpdate(docRef.current, picked, { amps }))}
            onPoles={(poles) => bulk(bulkUpdate(docRef.current, picked, { poles, slot: 'full' }))}
            onTag={(tag, add) =>
              bulk(
                bulkUpdate(docRef.current, picked, (b) => ({
                  tags: add
                    ? b.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
                      ? b.tags
                      : [...b.tags, tag]
                    : b.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()),
                })),
              )
            }
            onCheck={(verifyStatus) => bulk(bulkUpdate(docRef.current, picked, { verifyStatus }))}
            onShift={(delta) => bulk(shiftBreakers(docRef.current, picked, delta))}
            onSelectAll={() => setPicked(new Set(doc.breakers.filter((b) => !dimmed || !dimmed(b)).map((b) => b.key)))}
            onClear={() => setPicked(new Set())}
            onDone={() => {
              setSelecting(false);
              setPicked(new Set());
            }}
          />
        ) : selectedBreaker ? (
          <Inspector
            key={selectedBreaker.key}
            panelId={initial.id}
            doc={doc}
            breaker={selectedBreaker}
            server={serverBreaker}
            byId={byId}
            site={site}
            readOnly={readOnly}
            onPatch={(patch, coalesce) => apply(updateBreaker(docRef.current, selectedBreaker.key, patch), coalesce)}
            onSize={(size: Size) => apply(setSize(docRef.current, selectedBreaker.key, size))}
            onMove={(position, slot, section) =>
              apply(moveBreaker(docRef.current, selectedBreaker.key, position, slot, section))
            }
            onRemove={() => {
              commit(removeBreaker(docRef.current, selectedBreaker.key));
              setSelected(null);
            }}
          />
        ) : (
          <aside className="inspector inspector-empty">
            <h2>{readOnly ? `Pick a ${thing}` : `Pick or add a ${thing}`}</h2>
            <p className="muted">
              {readOnly
                ? `Select any ${thing} to see what it powers.`
                : isListLayout(doc)
                  ? `Add a ${thing} below the list, or click one to edit it. Changes save automatically.`
                  : 'Click an empty space to add a breaker, click a breaker to edit it, or drag it to another space. Changes save automatically.'}
            </p>
            {initial.notes && <p className="notes">{initial.notes}</p>}
          </aside>
        )}
      </div>
    </main>
  );
}

/** Show only circuits not checked yet, or found wrong, while walking a panel. */
function CheckFilter({
  breakers,
  value,
  onChange,
}: {
  breakers: EditBreaker[];
  value: '' | 'unchecked' | 'wrong';
  onChange: (v: '' | 'unchecked' | 'wrong') => void;
}) {
  const circuits = breakers.filter((b) => !b.isSpare);
  const unchecked = circuits.filter((b) => !b.verifyStatus).length;
  const wrong = circuits.filter((b) => b.verifyStatus === 'wrong').length;
  const verified = circuits.length - unchecked - wrong;
  if (!circuits.length) return null;
  return (
    <div className="tag-filter" role="group" aria-label="Show by field check">
      <span className="small muted">
        Checked {verified}/{circuits.length}:
      </span>
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={value === 'unchecked'}
        onClick={() => onChange(value === 'unchecked' ? '' : 'unchecked')}
      >
        Not checked <span className="muted">{unchecked}</span>
      </button>
      {wrong > 0 && (
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={value === 'wrong'}
          onClick={() => onChange(value === 'wrong' ? '' : 'wrong')}
        >
          Wrong <span className="muted">{wrong}</span>
        </button>
      )}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const text = {
    saved: 'All changes saved',
    pending: 'Unsaved changes…',
    saving: 'Saving…',
    error: 'Not saved',
    conflict: 'Not saved',
  }[state];
  return (
    <span className={`save-badge is-${state}`} role="status" aria-live="polite">
      {text}
    </span>
  );
}

/**
 * Where power comes from, as a strip of chips: the utility, each panel feeding this one with the
 * circuit it is on, then this panel; and the generator that backs it up, with how.
 */
function PowerStrip({ panel, flowHref }: { panel: PanelDetail; flowHref: string }) {
  const chain = [...panel.feedChain].reverse();
  const g = panel.generator;
  const relay = panel.layout === 'relay';
  const notSet = chain.length === 0 && panel.mainType === 'lugs' && !relay;
  // A utility service at the top is the start of the chain itself.
  const top = chain[0];
  const fromService = top?.kind === 'device' && top.deviceKind === 'service';
  return (
    <div className="power-strip">
      {!(relay && chain.length === 0) && (
        <ol className="ps-chain" aria-label="Fed from">
          {notSet ? (
            <li className="ps-chip ps-warn">Fed from: not set yet (Panel settings → Fed from)</li>
          ) : (
            !fromService && (
              <li className="ps-chip ps-utility">
                <NodeIcon kind="utility" size={16} />
                Utility
              </li>
            )
          )}
          {chain.map((f) =>
            f.kind === 'device' ? (
              <li key={`d${f.deviceId}`} className={`ps-chip ps-${f.deviceKind}`}>
                <NodeIcon kind={f.deviceKind} size={16} />
                {f.canView ? <Link to={`/devices/${f.deviceId}`}>{f.name}</Link> : <strong>{f.name}</strong>}
                {f.rating && (
                  <span className="ps-ckt" title={`${POWER_DEVICE_LABELS[f.deviceKind]} in ${f.locationPath}`}>
                    {f.rating}
                  </span>
                )}
              </li>
            ) : (
              <li key={f.breakerId} className="ps-chip">
                <NodeIcon kind={f.canView ? 'panel' : 'hidden'} size={16} />
                {f.canView ? <Link to={`/panels/${f.panelId}`}>{f.panelName}</Link> : <strong>{f.panelName}</strong>}
                <span className="ps-ckt" title={`${f.label || 'Unlabelled'} · in ${f.locationPath}`}>
                  {f.circuit} · {f.amps}A
                </span>
              </li>
            ),
          )}
          <li className="ps-chip ps-here" aria-current="true">
            <NodeIcon kind={relay ? 'relay' : 'panel'} size={16} />
            {panel.name}
            {panel.voltage && chain.some((f) => f.kind === 'device' && f.deviceKind === 'transformer') && (
              <span className="ps-ckt">{panel.voltage}</span>
            )}
          </li>
        </ol>
      )}
      {g && (
        <p className="ps-chip ps-gen">
          <NodeIcon kind="generator" size={16} />
          <span>
            On generator {g.canView ? <Link to={`/generators/${g.id}`}>{g.name}</Link> : <strong>{g.name}</strong>} (
            {generatorRating(g)})
            {g.via ? (
              <>
                {' '}
                through <Link to={`/panels/${g.via.panelId}`}>{g.via.panelName}</Link>
              </>
            ) : (
              g.transferSwitch && ` through ${g.transferSwitch}`
            )}
          </span>
        </p>
      )}
      <Link className="ps-flow" to={flowHref}>
        Power flow →
      </Link>
    </div>
  );
}

function Legend({ relay }: { relay: boolean }) {
  return (
    <div className="legend">
      {/* Relays have no GFCI/AFCI protection of their own. */}
      {!relay && (
        <>
          <span>
            <i className="sw" style={{ background: '#6B737A' }} />
            Standard
          </span>
          <span>
            <i className="sw" style={{ background: '#2F6FD6' }} />
            GFCI
          </span>
          <span>
            <i className="sw" style={{ background: '#F59E2A' }} />
            AFCI
          </span>
          <span>
            <i className="sw" style={{ background: '#C9B3FF' }} />
            Dual function
          </span>
        </>
      )}
      <span>
        <span className="badge badge-crit">CRIT</span> Critical
      </span>
      <span>
        <span className="badge badge-ups">UPS</span>
        <span className="badge badge-gen">GEN</span> Backup power
      </span>
    </div>
  );
}

function History({ panelId }: { panelId: number }) {
  const history = useQuery({
    queryKey: ['panel-history', panelId],
    queryFn: () => api.get<PanelHistoryItem[]>(`/api/panels/${panelId}/history`),
  });
  return (
    <section className="panel stack" aria-label="Panel history">
      <h2 className="h-caps">History</h2>
      <ErrorNote error={history.error} />
      {history.data?.length === 0 && <p className="muted">No changes yet.</p>}
      <ol className="activity">
        {(history.data ?? []).map((h) => (
          <li key={h.id}>
            <time dateTime={h.at}>{formatDate(h.at)}</time>
            <div>
              <span className="strong">{h.user}</span>
              {h.actingAs && <span className="muted"> (viewing as {h.actingAs})</span>}
              {h.details.length > 0 ? (
                <ul className="plain-list small">
                  {h.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              ) : (
                <div>{h.summary}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Tags used on this panel; picking one dims every breaker without it. */
function TagFilter({
  breakers,
  value,
  onChange,
}: {
  breakers: { tags: string[] }[];
  value: string | null;
  onChange: (tag: string | null) => void;
}) {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const b of breakers) {
    for (const t of b.tags) {
      const c = counts.get(t.toLowerCase()) ?? { tag: t, n: 0 };
      c.n++;
      counts.set(t.toLowerCase(), c);
    }
  }
  const tags = [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  if (tags.length === 0) return null;
  return (
    <div className="tag-filter" role="group" aria-label="Highlight by tag">
      <span className="small muted">Highlight:</span>
      {tags.map(({ tag, n }) => {
        const on = value?.toLowerCase() === tag.toLowerCase();
        return (
          <button
            key={tag}
            type="button"
            className="btn btn-sm"
            aria-pressed={on}
            onClick={() => onChange(on ? null : tag)}
          >
            {tag} <span className="muted">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
