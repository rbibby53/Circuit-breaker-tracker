import {
  ampsLabel,
  atLeast,
  circuitLabel,
  isRelayPanel,
  isSurgeOnly,
  type BreakerDto,
  type MeterSummary,
  type PanelDetail,
  type VerifyStatus,
} from '@cbt/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useCurrentUser } from '../auth';
import { NodeIcon } from '../components/PowerIcon';
import { ErrorNote, formatDate } from '../components/ui';
import { newClientId, sendOrQueue, useOutbox } from '../lib/outbox';
import { useTitle } from '../lib/useTitle';
import { useLocations, usePanels } from '../queries';
import { ancestry, buildTree } from '../tree';

const QUEUED = 'Report saved on this phone; it will be sent when you are back online.';

const checkable = (b: BreakerDto) => !b.isSpare && !isSurgeOnly(b);

/** "3 changes waiting to send", or that the phone is offline. */
function OutboxStatus({ outbox }: { outbox: ReturnType<typeof useOutbox> }) {
  if (!outbox.online || outbox.items.length) {
    return (
      <div className={`field-sync${outbox.online ? '' : ' is-offline'}`} role="status">
        <span>
          {outbox.online ? 'Sending…' : 'No connection.'}{' '}
          {outbox.items.length > 0 &&
            `${outbox.items.length} ${outbox.items.length === 1 ? 'change' : 'changes'} saved on this phone, sent when you're back online.`}
        </span>
        {outbox.online && outbox.items.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => void outbox.send()}>
            Send now
          </button>
        )}
      </div>
    );
  }
  if (outbox.failed.length) {
    return (
      <div className="field-sync is-failed" role="alert">
        <span>Some changes were refused: {outbox.failed.join('; ')}</span>
        <button type="button" className="btn btn-sm" onClick={outbox.clearFailed}>
          OK
        </button>
      </div>
    );
  }
  return null;
}

/**
 * Field mode: one circuit per row in big type, for walking a panel with a phone. Tap "Matches"
 * as each one checks out, or "Doesn't match" to report it. Works without signal: changes wait on
 * the phone and are sent when the connection comes back.
 */
export function FieldPanelPage() {
  const { id = '' } = useParams();
  const panelId = Number(id);
  const me = useCurrentUser();
  const qc = useQueryClient();
  const outbox = useOutbox(me.realUser.id);
  const panel = useQuery({
    queryKey: ['field-panel', panelId],
    queryFn: () => api.get<PanelDetail>(`/api/panels/${panelId}`),
    networkMode: 'offlineFirst',
  });
  useTitle(panel.data ? `${panel.data.name} · Field mode` : 'Field mode');
  const [local, setLocal] = useState(() => new Map<number, VerifyStatus>());
  const [onlyLeft, setOnlyLeft] = useState(false);
  // A breaker id, 'panel', or a meter (as `m<id>`) being reported, or null.
  const [reporting, setReporting] = useState<number | 'panel' | `m${number}` | null>(null);
  const [meterLocal, setMeterLocal] = useState(() => new Map<number, VerifyStatus>());
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Meter checks still waiting on this phone.
  const meterWaiting = useMemo(() => {
    const m = new Map<number, VerifyStatus>();
    for (const item of outbox.items) {
      const hit = /^\/api\/meters\/(\d+)\/verify$/.exec(item.url);
      if (item.panelId === panelId && hit) m.set(Number(hit[1]), (item.body as { status: VerifyStatus }).status);
    }
    return m;
  }, [outbox.items, panelId]);

  // Checks still waiting on this phone count as made.
  const waiting = useMemo(() => {
    const m = new Map<number, VerifyStatus>();
    for (const item of outbox.items) {
      if (item.panelId !== panelId || !item.url.endsWith('/verify')) continue;
      for (const b of (item.body as { breakers: { breakerId: number; status: VerifyStatus }[] }).breakers) {
        m.set(b.breakerId, b.status);
      }
    }
    return m;
  }, [outbox.items, panelId]);

  if (panel.isPending) return <div className="page-loading">Loading panel…</div>;
  if (panel.error || !panel.data) {
    return (
      <main className="content field-page">
        <ErrorNote error={panel.error} />
        <p className="muted">
          {navigator.onLine
            ? 'This panel could not be opened.'
            : 'No connection, and this panel was not saved on this phone. Use "Save for offline" before going somewhere without signal.'}
        </p>
      </main>
    );
  }
  const p = panel.data;
  const canCheck = p.canEdit && !me.viewingAs;
  const relay = isRelayPanel(p);
  const statusOf = (b: BreakerDto): VerifyStatus => local.get(b.id) ?? waiting.get(b.id) ?? b.verifyStatus;
  const circuits = [...p.breakers].sort(
    (a, b) => a.section - b.section || a.position - b.position || a.slot.localeCompare(b.slot),
  );
  const toCheck = circuits.filter(checkable);
  const done = toCheck.filter((b) => statusOf(b) === 'verified').length;
  const wrong = toCheck.filter((b) => statusOf(b) === 'wrong').length;
  const shown = onlyLeft ? circuits.filter((b) => checkable(b) && !statusOf(b)) : circuits;
  const pct = toCheck.length ? Math.floor((done / toCheck.length) * 100) : 0;

  const label = (b: BreakerDto) => `${relay ? 'Relay' : 'Circuit'} ${circuitLabel(p, b)}`;

  const check = async (b: BreakerDto, status: VerifyStatus) => {
    setError(null);
    setLocal((m) => new Map(m).set(b.id, status));
    try {
      const how = await sendOrQueue({
        userId: me.realUser.id,
        url: `/api/panels/${p.id}/verify`,
        body: { breakers: [{ breakerId: b.id, status }] },
        panelId: p.id,
        label: `${label(b)} ${status === 'verified' ? 'checked' : 'unchecked'}`,
      });
      if (how === 'sent') void qc.invalidateQueries({ queryKey: ['field-panel', p.id] });
    } catch (e) {
      setLocal((m) => {
        const next = new Map(m);
        next.delete(b.id);
        return next;
      });
      setError(errorMessage(e));
    }
  };

  const meterStatus = (m: MeterSummary): VerifyStatus =>
    meterLocal.get(m.id) ?? meterWaiting.get(m.id) ?? m.verifyStatus;

  const checkMeter = async (m: MeterSummary, status: VerifyStatus) => {
    setError(null);
    setMeterLocal((x) => new Map(x).set(m.id, status));
    try {
      const how = await sendOrQueue({
        userId: me.realUser.id,
        url: `/api/meters/${m.id}/verify`,
        body: { status },
        panelId: p.id,
        label: `Meter ${m.name} ${status === 'verified' ? 'checked' : status === 'wrong' ? 'marked wrong' : 'unchecked'}`,
      });
      if (how === 'sent') void qc.invalidateQueries({ queryKey: ['field-panel', p.id] });
    } catch (e) {
      setMeterLocal((x) => {
        const next = new Map(x);
        next.delete(m.id);
        return next;
      });
      setError(errorMessage(e));
    }
  };

  const report = async () => {
    const meter =
      typeof reporting === 'string' && reporting.startsWith('m')
        ? p.meters.find((x) => `m${x.id}` === reporting)
        : undefined;
    const b =
      typeof reporting === 'number'
        ? p.breakers.find((x) => x.id === reporting)
        : meter?.breakerId
          ? p.breakers.find((x) => x.id === meter.breakerId)
          : undefined;
    setError(null);
    try {
      if (meter) {
        const how = await sendOrQueue({
          userId: me.realUser.id,
          url: `/api/panels/${p.id}/reports`,
          body: { breakerId: b?.id ?? null, message: `Meter ${meter.name}: ${message}`, clientId: newClientId() },
          panelId: p.id,
          label: `Report on meter ${meter.name}`,
        });
        if (canCheck) await checkMeter(meter, 'wrong');
        setNotice(how === 'sent' ? 'Report sent.' : QUEUED);
        setReporting(null);
        setMessage('');
        return;
      }
      const how = await sendOrQueue({
        userId: me.realUser.id,
        url: `/api/panels/${p.id}/reports`,
        body: { breakerId: b?.id ?? null, message, clientId: newClientId(), markWrong: !!b && canCheck },
        panelId: p.id,
        label: b ? `Report on ${label(b).toLowerCase()}` : 'Report on the panel',
      });
      if (b && canCheck) setLocal((m) => new Map(m).set(b.id, 'wrong'));
      setNotice(how === 'sent' ? 'Report sent.' : QUEUED);
      setReporting(null);
      setMessage('');
      if (how === 'sent') void qc.invalidateQueries({ queryKey: ['field-panel', p.id] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const reportForm = (
    <form
      className="field-report"
      onSubmit={(e) => {
        e.preventDefault();
        void report();
      }}
    >
      <label className="field">
        <span className="field-label">What doesn't match?</span>
        <textarea
          rows={3}
          required
          maxLength={1000}
          autoFocus
          value={message}
          placeholder="e.g. Label says Lab 110, but it turns off Office 205."
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <div className="row">
        <button className="btn btn-dark field-big-btn" disabled={!message.trim()}>
          Send report
        </button>
        <button type="button" className="btn field-big-btn" onClick={() => setReporting(null)}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <main className="content field-page">
      <div className="field-head">
        <Link to={`/panels/${p.id}`} className="small">
          ‹ Full panel
        </Link>
        <h1>{p.name}</h1>
        <p className="muted">{p.locationPath}</p>
        <div className="field-progress">
          <span
            className="progress-bar"
            role="meter"
            aria-label={`${pct}% checked`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span className="progress-done" style={{ width: `${pct}%` }} />
            <span
              className="progress-wrong"
              style={{ width: `${toCheck.length ? (wrong / toCheck.length) * 100 : 0}%` }}
            />
          </span>
          <span>
            <strong>
              {done} of {toCheck.length}
            </strong>{' '}
            checked{wrong ? ` · ${wrong} wrong` : ''}
          </span>
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={onlyLeft} onChange={(e) => setOnlyLeft(e.target.checked)} />
            Only show what's left
          </label>
        </div>
        {!canCheck && (
          <p className="small muted">You can report what doesn't match. Checking circuits off needs Editor access.</p>
        )}
      </div>
      <OutboxStatus outbox={outbox} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="field-notice" role="status">
          {/* Once what was waiting has gone, say so rather than leave the offline message up. */}
          {notice === QUEUED && outbox.online && outbox.items.length === 0 ? 'Report sent.' : notice}
        </p>
      )}

      {p.meters.length > 0 && (
        <section className="stack-sm" aria-label="Meters">
          <h2 className="h-caps">Meters</h2>
          <ol className="field-list">
            {p.meters.map((m) => {
              const status = meterStatus(m);
              return (
                <li
                  key={`m${m.id}`}
                  className={`field-item${status ? ` is-${status}` : ''}`}
                  aria-label={`Meter ${m.name}${status ? `, ${status === 'verified' ? 'checked' : 'wrong'}` : ''}`}
                >
                  <div className="field-main">
                    <NodeIcon kind="meter" size={28} />
                    <div className="field-text">
                      <span className="field-label-text">{m.name}</span>
                      <span className="field-rooms">
                        {[m.meterNumber && `#${m.meterNumber}`, m.measures].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </div>
                  {status && (
                    <p className="field-status small">
                      {status === 'verified' ? '✓ Matches' : '✗ Does not match'}
                      {meterLocal.has(m.id) || meterWaiting.has(m.id)
                        ? ' · just now'
                        : m.verifiedBy
                          ? ` · ${m.verifiedBy}, ${formatDate(m.verifiedAt)}`
                          : ''}
                    </p>
                  )}
                  {reporting === `m${m.id}` ? (
                    reportForm
                  ) : (
                    <div className="field-actions">
                      {canCheck && (
                        <button
                          type="button"
                          className={`btn field-big-btn field-yes${status === 'verified' ? ' is-on' : ''}`}
                          aria-pressed={status === 'verified'}
                          onClick={() => void checkMeter(m, status === 'verified' ? '' : 'verified')}
                        >
                          ✓ Matches
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn field-big-btn field-no${status === 'wrong' ? ' is-on' : ''}`}
                        onClick={() => {
                          setNotice(null);
                          setMessage('');
                          setReporting(`m${m.id}`);
                        }}
                      >
                        ✗ Doesn't match
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <h2 className="h-caps">Circuits</h2>
        </section>
      )}
      <ol className="field-list" aria-label="Circuits">
        {shown.map((b) => {
          const status = statusOf(b);
          const rooms = b.serves.flatMap((s) => (s.name ? [s.name] : []));
          return (
            <li
              key={b.id}
              className={`field-item${status ? ` is-${status}` : ''}${checkable(b) ? '' : ' is-spare'}`}
              aria-label={`${label(b)}, ${b.label || 'unlabelled'}${status ? `, ${status === 'verified' ? 'checked' : 'wrong'}` : ''}`}
            >
              <div className="field-main">
                <span className="field-circuit mono">{circuitLabel(p, b)}</span>
                <div className="field-text">
                  <span className="field-label-text">
                    {b.label || (b.isSpare ? 'Spare' : 'Unlabelled')}
                    {b.critical && <span className="badge badge-crit">CRIT</span>}
                  </span>
                  {rooms.length > 0 && <span className="field-rooms">{rooms.join(', ')}</span>}
                  {b.equipment.length > 0 && (
                    <span className="field-rooms">{b.equipment.map((e) => e.tag).join(', ')}</span>
                  )}
                </div>
                <span className="field-amps mono">{ampsLabel(b)}</span>
              </div>
              {status && (
                <p className="field-status small">
                  {status === 'verified' ? '✓ Matches' : '✗ Does not match'}
                  {local.has(b.id) || waiting.has(b.id)
                    ? ' · just now'
                    : b.verifiedBy
                      ? ` · ${b.verifiedBy}, ${formatDate(b.verifiedAt)}`
                      : ''}
                </p>
              )}
              {checkable(b) &&
                (reporting === b.id ? (
                  reportForm
                ) : (
                  <div className="field-actions">
                    {canCheck && (
                      <button
                        type="button"
                        className={`btn field-big-btn field-yes${status === 'verified' ? ' is-on' : ''}`}
                        aria-pressed={status === 'verified'}
                        onClick={() => void check(b, status === 'verified' ? '' : 'verified')}
                      >
                        ✓ Matches
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn field-big-btn field-no${status === 'wrong' ? ' is-on' : ''}`}
                      onClick={() => {
                        setNotice(null);
                        setMessage('');
                        setReporting(b.id);
                      }}
                    >
                      ✗ Doesn't match
                    </button>
                  </div>
                ))}
            </li>
          );
        })}
      </ol>
      {shown.length === 0 && <p className="muted">Every circuit here has been checked.</p>}
      <div className="field-foot">
        {reporting === 'panel' ? (
          reportForm
        ) : (
          <button
            type="button"
            className="btn field-big-btn"
            onClick={() => {
              setNotice(null);
              setMessage('');
              setReporting('panel');
            }}
          >
            Report something else about this panel
          </button>
        )}
      </div>
    </main>
  );
}

const SAVED_KEY = 'cbt-offline-saved';

function savedAt(locId: number): string | null {
  try {
    return (JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, string>)[locId] ?? null;
  } catch {
    return null;
  }
}

function rememberSaved(locId: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, string>;
    all[locId] = new Date().toISOString();
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
  } catch {
    // Storage refused: the panels are still cached, just not the time.
  }
}

/** Field mode for a building or room: its panels, with how far checking has got, and a way to save them for offline use. */
export function FieldIndexPage() {
  const [params] = useSearchParams();
  const locId = Number(params.get('loc')) || 0;
  const me = useCurrentUser();
  const outbox = useOutbox(me.realUser.id);
  const locations = useLocations();
  const panels = usePanels();
  const { byId } = useMemo(() => buildTree(locations.data ?? []), [locations.data]);
  const node = byId.get(locId);
  useTitle(node ? `${node.name} · Field mode` : 'Field mode');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(() => savedAt(locId));
  const here = (panels.data ?? [])
    .filter((p) => ancestry(byId, p.locationId).some((a) => a.id === locId) || p.locationId === locId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (locations.isPending || panels.isPending) return <div className="page-loading">Loading…</div>;

  const saveOffline = async () => {
    let n = 0;
    try {
      for (const p of here) {
        setSaving(`Saving ${p.name} (${++n} of ${here.length})…`);
        // The service worker keeps a copy of each panel it fetches.
        await api.get(`/api/panels/${p.id}`);
      }
      await Promise.all([api.get('/api/locations'), api.get('/api/panels'), api.get('/api/auth/me')]);
      rememberSaved(locId);
      setSaved(savedAt(locId));
      setSaving(null);
    } catch (e) {
      setSaving(`Could not save everything: ${errorMessage(e)}`);
    }
  };

  return (
    <main className="content field-page">
      <div className="field-head">
        <Link to={locId ? `/?loc=${locId}` : '/'} className="small">
          ‹ {node?.name ?? 'Sites'}
        </Link>
        <h1>Field mode</h1>
        <p className="muted">Pick a panel to walk. Each circuit gets a big "Matches" or "Doesn't match" button.</p>
      </div>
      <OutboxStatus outbox={outbox} />
      <section className="panel stack-sm">
        <h2 className="h-caps">No signal down there?</h2>
        <p className="small">
          Save these panels on this phone first. Field mode then opens them without a connection, and your checks and
          reports are sent when you are back online.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn-dark field-big-btn"
            disabled={!!saving || !here.length}
            onClick={() => void saveOffline()}
          >
            Save {here.length} {here.length === 1 ? 'panel' : 'panels'} for offline
          </button>
        </div>
        {saving && (
          <p className="small" role="status">
            {saving}
          </p>
        )}
        {!saving && saved && <p className="small muted">Saved on this phone {formatDate(saved)}.</p>}
      </section>
      <ul className="field-panels">
        {here.map((p) => (
          <li key={p.id}>
            <Link to={`/panels/${p.id}/field`} className="field-panel-link">
              <span className="field-label-text">{p.name}</span>
              <span className="small muted">
                {p.breakerCount} circuits{atLeast(p.role, 'editor') ? '' : ' · view only'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {here.length === 0 && <p className="muted">No panels here yet.</p>}
    </main>
  );
}
