import {
  LAYOUT_LABELS,
  positionsOf,
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
import { ErrorNote, formatDate } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { Inspector } from '../panel/Inspector';
import { PanelGrid } from '../panel/PanelGrid';
import { PanelSettings } from '../panel/PanelSettings';
import { siteOf } from '../panel/serves';
import {
  addBreaker,
  applyIds,
  fromDetail,
  moveBreaker,
  removeBreaker,
  setSize,
  toRequest,
  updateBreaker,
  updatePanel,
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
  // Undo/redo stacks live in a ref: they change together with `doc`, which drives re-renders.
  const stacks = useRef<{ past: EditPanel[]; future: EditPanel[] }>({ past: [], future: [] });
  const [selected, setSelected] = useState<string | null>(initialSelected);
  // A search result can point at another breaker while this panel is already open.
  useEffect(() => {
    if (initialSelected) setSelected(initialSelected);
  }, [initialSelected]);
  const [message, setMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const docRef = useRef(doc);
  const version = useRef(initial.version);
  const baselineFed = useRef(initial.fedFromBreakerId);
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

  const commit = useCallback((next: EditPanel, coalesce?: string) => {
    const t = Date.now();
    const last = lastCoalesce.current;
    const merge = coalesce && last && last.key === coalesce && t - last.at < COALESCE_MS;
    if (!merge) {
      stacks.current = { past: [...stacks.current.past, docRef.current].slice(-MAX_UNDO), future: [] };
    }
    lastCoalesce.current = coalesce ? { key: coalesce, at: t } : null;
    setMessage(null);
    setDocNow(next);
  }, []);

  const apply = (r: Result, coalesce?: string) => {
    if (r.ok) commit(r.doc, coalesce);
    else setMessage(r.error);
    return r.ok;
  };

  const undo = useCallback(() => {
    const s = stacks.current;
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    stacks.current = { past: s.past.slice(0, -1), future: [docRef.current, ...s.future] };
    lastCoalesce.current = null;
    setMessage(null);
    setDocNow(prev);
  }, []);

  const redo = useCallback(() => {
    const s = stacks.current;
    const next = s.future[0];
    if (!next) return;
    stacks.current = { past: [...s.past, docRef.current], future: s.future.slice(1) };
    lastCoalesce.current = null;
    setMessage(null);
    setDocNow(next);
  }, []);

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
      baselineFed.current = res.panel.fedFromBreakerId;
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
  const used = new Set(doc.breakers.flatMap((b) => positionsOf(doc, b)));
  const critical = doc.breakers.filter((b) => b.critical).length;
  const onBackup = doc.breakers.filter((b) => b.backup !== 'none').length;

  const deletePanel = async () => {
    try {
      await api.del(`/api/panels/${initial.id}`);
      await qc.invalidateQueries({ queryKey: ['panels'] });
      navigate(`/?loc=${initial.locationId}`);
    } catch (err) {
      setMessage(errorMessage(err));
    }
  };

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
              {LAYOUT_LABELS[doc.layout]}
              {doc.voltage && ` · ${doc.voltage}`} · {doc.spaces} spaces ·{' '}
              {doc.mainType === 'lugs' ? 'main lugs' : `${doc.mainAmps ?? '?'} A main`}
              {(doc.manufacturer || doc.model) && ` · ${[doc.manufacturer, doc.model].filter(Boolean).join(' ')}`}
            </p>
            <FeedLine panel={server} />
          </div>
          <div className="toolbar">
            {!readOnly && <SaveBadge state={saveState} />}
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={undo}
                  disabled={stacks.current.past.length === 0}
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={redo}
                  disabled={stacks.current.future.length === 0}
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
          <Legend />
          <PanelGrid
            doc={doc}
            byId={byId}
            selectedKey={selected}
            readOnly={readOnly}
            onSelect={setSelected}
            onAdd={(position: number, slot: Slot) => {
              const r = addBreaker(docRef.current, position, slot);
              if (apply(r) && r.ok && 'key' in r && r.key) setSelected(r.key);
            }}
            onMove={(key, position, slot) => apply(moveBreaker(docRef.current, key, position, slot))}
            feeds={
              new Map(
                server.breakers.map((b) => [
                  b.id,
                  [
                    ...b.feeds.map((f) => f.panelName),
                    ...(b.hiddenFeeds ? [`${b.hiddenFeeds} more panel${b.hiddenFeeds === 1 ? '' : 's'}`] : []),
                  ],
                ]),
              )
            }
          />
          <p className="panel-stats">
            {used.size} of {doc.spaces} spaces filled · {doc.breakers.length} breakers · {critical} critical ·{' '}
            {onBackup} on backup power
          </p>
        </section>
        {selectedBreaker ? (
          <Inspector
            key={selectedBreaker.key}
            doc={doc}
            breaker={selectedBreaker}
            server={serverBreaker}
            byId={byId}
            site={site}
            readOnly={readOnly}
            onPatch={(patch, coalesce) => apply(updateBreaker(docRef.current, selectedBreaker.key, patch), coalesce)}
            onSize={(size: Size) => apply(setSize(docRef.current, selectedBreaker.key, size))}
            onMove={(position, slot) => apply(moveBreaker(docRef.current, selectedBreaker.key, position, slot))}
            onRemove={() => {
              commit(removeBreaker(docRef.current, selectedBreaker.key));
              setSelected(null);
            }}
          />
        ) : (
          <aside className="inspector inspector-empty">
            <h2>{readOnly ? 'Pick a breaker' : 'Pick or add a breaker'}</h2>
            <p className="muted">
              {readOnly
                ? 'Select any breaker to see what it powers.'
                : 'Click an empty space to add a breaker, click a breaker to edit it, or drag it to another space. Changes save automatically.'}
            </p>
            {initial.notes && <p className="notes">{initial.notes}</p>}
          </aside>
        )}
      </div>
    </main>
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

function FeedLine({ panel }: { panel: PanelDetail }) {
  if (panel.feedChain.length === 0) {
    return (
      <p className="feed-line">
        Fed from: {panel.mainType === 'lugs' ? 'not set yet (Panel settings → Fed from)' : 'the utility service'}
      </p>
    );
  }
  return (
    <p className="feed-line">
      Fed from:{' '}
      {panel.feedChain.map((f, i) => (
        <span key={f.breakerId}>
          {i > 0 && <span aria-hidden="true"> ← </span>}
          {f.canView ? <Link to={`/panels/${f.panelId}`}>{f.panelName}</Link> : <strong>{f.panelName}</strong>} ·{' '}
          {f.circuit} {f.label || 'unlabelled'} ({f.amps}A) <span className="muted">in {f.locationPath}</span>
        </span>
      ))}
    </p>
  );
}

function Legend() {
  return (
    <div className="legend">
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
