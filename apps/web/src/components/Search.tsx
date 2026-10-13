import { POWER_DEVICE_LABELS, type SearchResponse } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/** Header search: breakers by label or the room they serve, rooms and panels. Press / to focus. */
export function Search() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  });

  const done = () => {
    setOpen(false);
    setQ('');
  };
  const r = results.data;
  const empty =
    r &&
    !r.breakers.length &&
    !r.locations.length &&
    !r.panels.length &&
    !r.generators.length &&
    !r.devices.length &&
    !r.equipment.length &&
    !r.meters.length;
  const show = open && debounced.length >= 2;

  return (
    <div className="search" ref={box} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <label className="sr-only" htmlFor="global-search">
        Search breakers, rooms and panels
      </label>
      <input
        id="global-search"
        ref={input}
        type="search"
        autoComplete="off"
        placeholder="Search breakers, rooms…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-expanded={show}
        aria-controls="search-results"
      />
      {show && (
        <div className="search-results" id="search-results" role="region" aria-label="Search results">
          {results.isLoading && <p className="muted small">Searching…</p>}
          {empty && <p className="muted small">Nothing matches “{debounced}”.</p>}
          {r && r.breakers.length > 0 && (
            <section>
              <h3>Breakers</h3>
              <ul>
                {r.breakers.map((b) => {
                  const body = (
                    <>
                      <span className="mono strong">{b.circuit}</span>
                      <span className="search-main">
                        <span className="strong">{b.label || 'Unlabelled'}</span> {b.amps}A
                        {b.critical && <span className="badge badge-crit">CRIT</span>}
                        <span className="muted small block">
                          {b.panelName}
                          {b.serves ? ` · serves ${b.serves}` : ''}
                          {b.tags.length > 0 && ` · ${b.tags.join(', ')}`}
                          {!b.canViewPanel && ' · panel outside your access'}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={b.breakerId}>
                      {b.canViewPanel ? (
                        <Link to={`/panels/${b.panelId}?breaker=${b.breakerId}`} onClick={done}>
                          {body}
                        </Link>
                      ) : (
                        <div className="search-static">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {r && r.locations.length > 0 && (
            <section>
              <h3>Places</h3>
              <ul>
                {r.locations.map((l) => (
                  <li key={l.id}>
                    <Link to={`/?loc=${l.id}`} onClick={done}>
                      <span className="search-main">
                        <span className="strong">{l.name}</span>
                        <span className="muted small block">{l.path}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r && r.panels.length > 0 && (
            <section>
              <h3>Panels</h3>
              <ul>
                {r.panels.map((p) => (
                  <li key={p.id}>
                    <Link to={`/panels/${p.id}`} onClick={done}>
                      <span className="search-main">
                        <span className="strong">{p.name}</span>
                        <span className="muted small block">{p.path}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r && r.generators.length > 0 && (
            <section>
              <h3>Generators</h3>
              <ul>
                {r.generators.map((g) => (
                  <li key={g.id}>
                    <Link to={`/generators/${g.id}`} onClick={done}>
                      <span className="search-main">
                        <span className="strong">{g.name}</span>
                        <span className="muted small block">{g.path}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r && r.equipment.length > 0 && (
            <section>
              <h3>Equipment</h3>
              <ul>
                {r.equipment.map((e) => (
                  <li key={e.id}>
                    <Link to={`/equipment/${e.id}`} onClick={done}>
                      <span className="search-main">
                        <span className="strong">{e.tag}</span>{' '}
                        <span className="muted small">{[e.kind, e.description].filter(Boolean).join(' · ')}</span>
                        <span className="small block">
                          {e.fedFrom ? `Fed from ${e.fedFrom}` : 'Feed not set'}
                          <span className="muted"> · {e.path}</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r && r.meters.length > 0 && (
            <section>
              <h3>Meters</h3>
              <ul>
                {r.meters.map((m) => (
                  <li key={m.id}>
                    <Link to={`/meters/${m.id}`} onClick={done}>
                      <span className="search-main">
                        <span className="strong">{m.name}</span>{' '}
                        <span className="muted small">
                          {[m.meterNumber && `#${m.meterNumber}`, m.measures].filter(Boolean).join(' · ')}
                        </span>
                        <span className="muted small block">{m.path}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r && r.devices.length > 0 && (
            <section>
              <h3>Transformers, cubes and disconnects</h3>
              <ul>
                {r.devices.map((d) => (
                  <li key={d.id}>
                    <Link to={`/devices/${d.id}`} onClick={done}>
                      <span className="search-main">
                        <span className="strong">{d.name}</span>{' '}
                        <span className="muted small">
                          {POWER_DEVICE_LABELS[d.kind]}
                          {d.rating && ` · ${d.rating}`}
                        </span>
                        <span className="muted small block">{d.path}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
