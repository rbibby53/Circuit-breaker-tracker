// Power flow: a map of where power comes from and where it goes for a site, building or room, in
// the spirit of a network topology view. Hover or focus anything to light up its whole path, from
// the utility or generator down to the last relay panel it feeds.

import {
  KIND_LABELS,
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutTopology,
  powerPath,
  type Topology,
  type TopologyEdge,
  type TopologyKind,
  type TopologyNode,
} from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { NodeIcon } from '../components/PowerIcon';
import { ErrorNote } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { useLocations } from '../queries';
import { ancestry, buildTree } from '../tree';

const PAD = 48;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;

const KIND_NAMES: Record<TopologyKind, string> = {
  utility: 'Utility',
  panel: 'Panel',
  relay: 'Relay panel',
  ats: 'Transfer switch',
  generator: 'Generator',
  hidden: 'Panel',
};

const EDGE_NAMES: Record<TopologyEdge['kind'], string> = {
  feed: 'Fed from',
  normal: 'Normal power from',
  emergency: 'Emergency power from',
  load: 'On',
  backup: 'Backed up by',
  relay: 'Switches circuits in',
};

function BoltBadge({ x, y }: { x: number; y: number }) {
  return (
    <g className="pf-bolt" transform={`translate(${x} ${y})`}>
      <circle r="10" />
      <path d="M1.5 -6 -3.5 1h3.5l-1.5 5 5-7h-3.5z" />
    </g>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function PowerPage() {
  const [params, setParams] = useSearchParams();
  const locationId = Number(params.get('loc')) || null;
  const focusId = params.get('focus');
  const locations = useLocations();
  const byId = useMemo(() => buildTree(locations.data ?? []).byId, [locations.data]);
  const topology = useQuery({
    queryKey: ['topology', locationId],
    queryFn: () => api.get<Topology>(`/api/locations/${locationId}/topology`),
    enabled: !!locationId,
  });
  useTitle(topology.data ? `Power flow · ${topology.data.location.name}` : 'Power flow');

  // Sites and buildings you can pick from when none (or a room) is chosen.
  const choices = (locations.data ?? []).filter(
    (l) => (l.kind === 'site' || l.kind === 'building') && l.access !== 'breadcrumb',
  );

  return (
    <main className="content stack-lg">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Sites</Link>
        {locationId &&
          ancestry(byId, locationId).map((c) => (
            <span key={c.id}>
              <span aria-hidden="true"> / </span>
              <Link to={`/?loc=${c.id}`}>{c.name}</Link>
            </span>
          ))}
      </nav>
      <div className="page-head">
        <div>
          <span className="eyebrow">Power flow</span>
          <h1>{topology.data?.location.name ?? 'Power flow'}</h1>
        </div>
        {choices.length > 0 && (
          <div className="toolbar">
            <label className="pf-picker">
              <span className="sr-only">Show power flow for</span>
              <select
                value={locationId ?? ''}
                onChange={(e) => setParams(e.target.value ? { loc: e.target.value } : {})}
              >
                {!locationId && <option value="">Choose a site or building…</option>}
                {locationId && !choices.some((c) => c.id === locationId) && (
                  <option value={locationId}>{topology.data?.location.name ?? '…'}</option>
                )}
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({KIND_LABELS[c.kind].toLowerCase()})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {!locationId && <p className="muted">Pick a site or building to see how power gets to its panels.</p>}
      <ErrorNote error={topology.error} />
      {topology.isLoading && locationId && <p className="muted">Loading…</p>}
      {topology.data && <PowerMap topology={topology.data} focusId={focusId} />}
    </main>
  );
}

function PowerMap({ topology, focusId }: { topology: Topology; focusId: string | null }) {
  const navigate = useNavigate();
  const layout = useMemo(() => layoutTopology(topology.nodes, topology.edges), [topology]);
  const byId = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology]);
  const [hover, setHover] = useState<string | null>(null);
  const [animate, setAnimate] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [listView, setListView] = useState(false);
  const lit = useMemo(() => {
    const at = hover ?? (focusId && byId.has(focusId) ? focusId : null);
    return at ? powerPath(at, topology.edges) : null;
  }, [hover, focusId, byId, topology.edges]);

  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const fitted = useCallback(() => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || !layout.width) return null;
    const k = Math.max(
      MIN_ZOOM,
      Math.min(
        1.1,
        (box.width - PAD * 2) / layout.width,
        (box.height - PAD * 2) / Math.max(layout.height, NODE_HEIGHT),
      ),
    );
    return {
      box,
      view: { k, x: (box.width - layout.width * k) / 2, y: Math.max(PAD, (box.height - layout.height * k) / 2) },
    };
  }, [layout]);
  const fit = useCallback(() => {
    const f = fitted();
    if (f) setView(f.view);
  }, [fitted]);

  // Start with everything in view, and keep it so as the window resizes until the map is moved.
  // Arriving from a panel, centre on it if it would be too small to read.
  const touched = useRef(false);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    touched.current = false;
    const observer = new ResizeObserver(() => {
      const f = fitted();
      if (!f || touched.current) return;
      const p = focusId ? layout.nodes.get(focusId) : undefined;
      if (!p || f.view.k >= 0.7) return setView(f.view);
      const k = 0.9;
      setView({
        k,
        x: f.box.width / 2 - (p.x + NODE_WIDTH / 2) * k,
        y: f.box.height / 2 - (p.y + NODE_HEIGHT / 2) * k,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitted, focusId, layout, listView]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    touched.current = true;
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  }, []);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - box.left, e.clientY - box.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, listView]);

  // Drag to pan. A drag that moves more than a few pixels is not a click on a node.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) (e.currentTarget as Element).setPointerCapture(e.pointerId);
    d.moved = true;
    touched.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    setTimeout(() => (drag.current = null));
  };
  const open = (n: TopologyNode) => {
    if (drag.current?.moved || !n.href) return;
    navigate(n.href);
  };

  const counts = useMemo(() => {
    const c = { panel: 0, relay: 0, generator: 0, ats: 0, backed: 0 };
    for (const n of topology.nodes) {
      if (!n.inScope) continue;
      if (n.kind === 'panel' || n.kind === 'relay' || n.kind === 'generator' || n.kind === 'ats') c[n.kind]++;
      if ((n.kind === 'panel' || n.kind === 'relay') && n.onGenerator) c.backed++;
    }
    return c;
  }, [topology.nodes]);

  if (topology.nodes.length === 0) {
    return (
      <div className="empty">
        <p>Nothing here yet. Add panels, generators or transfer switches and they will appear on the map.</p>
      </div>
    );
  }

  const stat = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : null);
  const stats = [
    stat(counts.panel, 'panel'),
    stat(counts.relay, 'relay panel'),
    stat(counts.generator, 'generator'),
    stat(counts.ats, 'transfer switch', 'transfer switches'),
    counts.backed ? `${counts.backed} of ${counts.panel + counts.relay} panels on backup power` : null,
  ].filter(Boolean);

  return (
    <section className="stack" aria-label="Power flow map">
      <div className="pf-bar">
        <p className="muted pf-stats">{stats.join(' · ')}</p>
        <div className="toolbar">
          <label className="check">
            <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
            Show flow
          </label>
          <div className="segmented two pf-mode" role="group" aria-label="View">
            <button type="button" aria-pressed={!listView} onClick={() => setListView(false)}>
              Map
            </button>
            <button type="button" aria-pressed={listView} onClick={() => setListView(true)}>
              List
            </button>
          </div>
        </div>
      </div>

      {listView ? (
        <PowerList topology={topology} />
      ) : (
        <div
          ref={frame}
          className={`pf-frame${animate ? ' is-animated' : ''}${lit ? ' is-lit' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <svg className="pf-svg" role="group" aria-label={`Power flow for ${topology.location.name}`}>
            <defs>
              <pattern id="pf-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" className="pf-dot" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#pf-dots)" />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <g aria-hidden="true">
                {layout.edges.map((e) => {
                  const on = !lit || (lit.has(e.from) && lit.has(e.to));
                  return (
                    <g key={`${e.from}>${e.to}:${e.kind}`} className={`pf-edge pf-${e.kind}${on ? '' : ' is-dim'}`}>
                      <path className="pf-line" d={e.path} />
                      <path className="pf-flow" d={e.path} />
                    </g>
                  );
                })}
                {layout.edges
                  .filter((e) => e.label && (!lit || (lit.has(e.from) && lit.has(e.to))))
                  .map((e) => (
                    <text
                      key={`l${e.from}>${e.to}:${e.kind}`}
                      className={`pf-label pf-${e.kind}`}
                      x={e.labelX}
                      y={e.labelY}
                      textAnchor="middle"
                    >
                      {clip(e.label, 28)}
                    </text>
                  ))}
              </g>
              {topology.nodes.map((n) => {
                const p = layout.nodes.get(n.id)!;
                const on = !lit || lit.has(n.id);
                const label = [
                  `${KIND_NAMES[n.kind]} ${n.name}`,
                  n.detail,
                  n.locationPath,
                  n.onGenerator && n.kind !== 'generator' ? 'on backup power' : '',
                  n.critical ? `${n.critical} critical circuit${n.critical === 1 ? '' : 's'}` : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                return (
                  <g
                    key={n.id}
                    className={`pf-node pf-${n.kind}${on ? '' : ' is-dim'}${n.inScope ? '' : ' is-context'}${n.href ? ' is-link' : ''}${focusId === n.id ? ' is-focus' : ''}`}
                    transform={`translate(${p.x} ${p.y})`}
                    tabIndex={0}
                    role={n.href ? 'link' : 'img'}
                    aria-label={label}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(n.id)}
                    onBlur={() => setHover(null)}
                    onClick={() => open(n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && n.href) navigate(n.href);
                    }}
                  >
                    <title>{label}</title>
                    <rect className="pf-card" width={NODE_WIDTH} height={NODE_HEIGHT} rx="10" />
                    <rect className="pf-stripe" width="5" height={NODE_HEIGHT} rx="2.5" />
                    <g className="pf-icon" transform="translate(14 20)">
                      <NodeIcon kind={n.kind} />
                    </g>
                    <text className="pf-name" x="48" y={n.locationPath ? 22 : 28}>
                      {clip(n.name, 21)}
                    </text>
                    <text className="pf-detail" x="48" y={n.locationPath ? 39 : 46}>
                      {clip(n.detail, 30)}
                    </text>
                    {n.locationPath && (
                      <text className="pf-where" x="48" y="55">
                        {clip(n.locationPath.split(' › ').slice(-2).join(' › '), 32)}
                      </text>
                    )}
                    {n.onGenerator && n.kind !== 'generator' && <BoltBadge x={NODE_WIDTH - 4} y={4} />}
                    {n.critical > 0 && (
                      <g className="pf-critical" transform={`translate(${NODE_WIDTH - (n.onGenerator ? 28 : 4)} 4)`}>
                        <circle r="10" />
                        <text textAnchor="middle" y="4">
                          {n.critical > 9 ? '9+' : n.critical}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="pf-zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              className="btn"
              aria-label="Zoom in"
              onClick={() => {
                const b = frame.current!.getBoundingClientRect();
                zoomAt(1.25, b.width / 2, b.height / 2);
              }}
            >
              +
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Zoom out"
              onClick={() => {
                const b = frame.current!.getBoundingClientRect();
                zoomAt(0.8, b.width / 2, b.height / 2);
              }}
            >
              −
            </button>
            <button type="button" className="btn" onClick={fit}>
              Fit
            </button>
          </div>
        </div>
      )}
      <Legend />
    </section>
  );
}

function Legend() {
  const line = (kind: string): ReactNode => (
    <svg width="34" height="10" aria-hidden="true" className={`pf-edge pf-${kind}`}>
      <path className="pf-line" d="M 1 5 L 33 5" />
    </svg>
  );
  return (
    <div className="legend pf-legend">
      <span>{line('feed')} Feed</span>
      <span>{line('normal')} Normal source</span>
      <span>{line('emergency')} Generator</span>
      <span>{line('relay')} Relay control</span>
      <span>
        <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true">
          <BoltBadge x={0} y={0} />
        </svg>{' '}
        On backup power
      </span>
      <span>
        <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true" className="pf-critical">
          <circle r="9" />
        </svg>{' '}
        Critical circuits
      </span>
    </div>
  );
}

/** The same graph as a list: each item with what powers it. Easier on a phone or a screen reader. */
function PowerList({ topology }: { topology: Topology }) {
  const byId = new Map(topology.nodes.map((n) => [n.id, n]));
  const order = layoutTopology(topology.nodes, topology.edges).nodes;
  const sorted = [...topology.nodes].sort(
    (a, b) => order.get(a.id)!.layer - order.get(b.id)!.layer || order.get(a.id)!.x - order.get(b.id)!.x,
  );
  return (
    <ul className="pf-list">
      {sorted.map((n) => {
        const into = topology.edges.filter((e) => e.to === n.id);
        return (
          <li key={n.id} className={`pf-${n.kind}`}>
            <span className="pf-list-icon">
              <NodeIcon kind={n.kind} size={20} />
            </span>
            <div>
              <div>
                {n.href ? <Link to={n.href}>{n.name}</Link> : <strong>{n.name}</strong>}{' '}
                <span className="muted">
                  {KIND_NAMES[n.kind]}
                  {n.detail ? ` · ${n.detail}` : ''}
                </span>
                {n.onGenerator && n.kind !== 'generator' && <span className="badge badge-gen">Backup power</span>}
              </div>
              {into.length > 0 && (
                <div className="muted pf-list-from">
                  {into
                    .map(
                      (e) => `${EDGE_NAMES[e.kind]} ${byId.get(e.from)?.name ?? '?'}${e.label ? ` (${e.label})` : ''}`,
                    )
                    .join(' · ')}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
