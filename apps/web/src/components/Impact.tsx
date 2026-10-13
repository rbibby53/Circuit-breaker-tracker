import { POWER_DEVICE_LABELS, type ImpactReport } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { NodeIcon } from './PowerIcon';
import { ErrorNote } from './ui';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The report as plain text, for an outage notice or a lockout/tagout sheet. */
function reportText(r: ImpactReport): string {
  const lines = [`Opening ${r.title}: ${plural(r.circuits, 'circuit')} lose power.`];
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push('', `${title}:`, ...items.map((i) => `- ${i}`));
  };
  section(
    'Critical circuits',
    r.critical.map((c) => `${c.panelName} ${c.circuit} ${c.label}${c.backup ? ` (${c.backup})` : ''}`.trim()),
  );
  section(
    'Panels',
    r.panels.map((p) => `${p.name} (${p.path})${p.backup ? ` — ${p.backup}` : ''}`),
  );
  section(
    'Transformers, disconnects and UPSs',
    r.devices.map((d) => `${d.name} (${d.path})${d.backup ? ` — ${d.backup}` : ''}`),
  );
  section(
    'Equipment',
    r.equipment.map((e) => `${e.tag}${e.kind ? ` ${e.kind}` : ''} (${e.path})`),
  );
  section(
    'Relays',
    r.relays.map((x) => `${x.panelName} relay ${x.relay} ${x.label}`.trim()),
  );
  section(
    'Rooms',
    r.rooms.map((x) => x.path),
  );
  if (r.hidden) lines.push('', `${plural(r.hidden, 'more item')} outside your access.`);
  return lines.join('\n');
}

/**
 * "What loses power?": a button that opens everything downstream of a breaker, a panel's main or
 * a transformer or disconnect — panels, equipment, relays, rooms — for lockout/tagout and outage
 * planning.
 */
export function ImpactButton({
  query,
  label = 'What loses power?',
  className = 'btn',
}: {
  /** e.g. breaker=12, panel=4, device=3 */
  query: string;
  label?: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const report = useQuery({
    queryKey: ['impact', query],
    queryFn: () => api.get<ImpactReport>(`/api/impact?${query}`),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);

  const r = report.data;
  const nothing = r && r.circuits === 0 && !r.panels.length && !r.devices.length && !r.equipment.length;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setCopied(false);
          setOpen(true);
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="dialog impact-dialog"
        aria-labelledby="impact-title"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        {open && (
          <div className="stack">
            <h2 id="impact-title">What loses power</h2>
            {report.isPending && <p className="muted">Following the feeds…</p>}
            {report.error && <ErrorNote error={report.error} />}
            {r && (
              <>
                <p className="impact-lead">
                  Opening <strong>{r.title}</strong>{' '}
                  {nothing ? (
                    'takes nothing else down that is recorded here.'
                  ) : (
                    <>
                      takes down <strong>{plural(r.circuits, 'circuit')}</strong>
                      {r.panels.length > 0 && <> in {plural(r.panels.length, 'panel')}</>}.
                    </>
                  )}
                </p>
                <div className="impact-body">
                  {r.critical.length > 0 && (
                    <section className="impact-section impact-critical" aria-label="Critical circuits">
                      <h3 className="h-caps">Critical circuits</h3>
                      <ul>
                        {r.critical.map((c) => (
                          <li key={`${c.panelId}:${c.circuit}`}>
                            <Link to={`/panels/${c.panelId}`} onClick={() => setOpen(false)}>
                              {c.panelName} · {c.circuit}
                            </Link>{' '}
                            {c.label}
                            {c.backup && <span className="impact-backup">{c.backup}</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {r.panels.length > 0 && (
                    <section className="impact-section" aria-label="Panels">
                      <h3 className="h-caps">Panels</h3>
                      <ul>
                        {r.panels.map((p) => (
                          <li key={p.id}>
                            <NodeIcon kind="panel" size={16} />
                            <Link to={`/panels/${p.id}`} onClick={() => setOpen(false)}>
                              {p.name}
                            </Link>{' '}
                            <span className="muted small">
                              {plural(p.circuits, 'circuit')} · {p.path}
                            </span>
                            {p.backup && <span className="impact-backup">{p.backup}</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {r.devices.length > 0 && (
                    <section className="impact-section" aria-label="Transformers, disconnects and UPSs">
                      <h3 className="h-caps">Transformers, disconnects and UPSs</h3>
                      <ul>
                        {r.devices.map((d) => (
                          <li key={d.id}>
                            <NodeIcon kind={d.kind} size={16} />
                            <Link to={`/devices/${d.id}`} onClick={() => setOpen(false)}>
                              {d.name}
                            </Link>{' '}
                            <span className="muted small">
                              {POWER_DEVICE_LABELS[d.kind]} · {d.path}
                            </span>
                            {d.backup && <span className="impact-backup">{d.backup}</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {r.equipment.length > 0 && (
                    <section className="impact-section" aria-label="Equipment">
                      <h3 className="h-caps">Equipment</h3>
                      <ul>
                        {r.equipment.map((e) => (
                          <li key={e.id}>
                            <NodeIcon kind="equipment" size={16} />
                            <Link to={`/equipment/${e.id}`} onClick={() => setOpen(false)}>
                              {e.tag}
                            </Link>{' '}
                            <span className="muted small">{[e.kind, e.path].filter(Boolean).join(' · ')}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {r.relays.length > 0 && (
                    <section className="impact-section" aria-label="Relays">
                      <h3 className="h-caps">Relays</h3>
                      <ul>
                        {r.relays.map((x) => (
                          <li key={`${x.panelId}:${x.relay}`}>
                            <Link to={`/panels/${x.panelId}`} onClick={() => setOpen(false)}>
                              {x.panelName} relay {x.relay}
                            </Link>{' '}
                            {x.label}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {r.rooms.length > 0 && (
                    <section className="impact-section" aria-label="Rooms">
                      <h3 className="h-caps">Rooms</h3>
                      <ul>
                        {r.rooms.map((x) => (
                          <li key={x.id}>
                            <Link to={`/?loc=${x.id}`} onClick={() => setOpen(false)}>
                              {x.name}
                            </Link>{' '}
                            <span className="muted small">{x.path.split(' › ').slice(0, -1).join(' › ')}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {r.hidden > 0 && (
                    <p className="muted small">
                      And {plural(r.hidden, 'more item')} outside your access. Check with whoever looks after them
                      before switching off.
                    </p>
                  )}
                </div>
                <p className="muted small">
                  From the feeds, rooms and equipment recorded here. Always test before touching.
                </p>
              </>
            )}
            <div className="dialog-actions">
              {r && !nothing && (
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(reportText(r)).catch(() => undefined);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Copied' : 'Copy as text'}
                </button>
              )}
              <button type="button" className="btn btn-dark" onClick={() => setOpen(false)} autoFocus>
                Close
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
