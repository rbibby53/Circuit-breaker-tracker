import {
  BACKUPS,
  BACKUP_LABELS,
  COMMON_AMPS,
  DEVICES,
  DEVICE_LABELS,
  ampsLabel,
  formatVa,
  vaFromText,
  PROTECTIONS,
  PROTECTION_LABELS,
  allowsTandem,
  circuitLabel,
  circuitVolts,
  MCC_CONTROLS,
  VERIFY_LABELS,
  STARTER_SIZES,
  isListLayout,
  isRelayPanel,
  maxPoles,
  sectionsOf,
  phasesOf,
  type BreakerDto,
  type FeedCandidate,
  type Slot,
} from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { ImpactButton } from '../components/Impact';
import { formatDate } from '../components/ui';
import type { TreeNode } from '../tree';
import { servesByFloor } from './serves';
import { ServesPicker } from './ServesPicker';
import { TagInput } from './TagInput';
import { firstFitIn, sizeOf, validStarts, type EditBreaker, type EditPanel, type Size } from './state';

interface Props {
  panelId: number;
  doc: EditPanel;
  breaker: EditBreaker;
  server: BreakerDto | undefined;
  byId: Map<number, TreeNode>;
  site: TreeNode | null;
  readOnly: boolean;
  onPatch: (patch: Partial<EditBreaker>, coalesce?: string) => void;
  onSize: (size: Size) => void;
  onMove: (position: number, slot?: Slot, section?: number) => void;
  onRemove: () => void;
}

export function Inspector({
  panelId,
  doc,
  breaker: b,
  server,
  byId,
  site,
  readOnly,
  onPatch,
  onSize,
  onMove,
  onRemove,
}: Props) {
  const [picking, setPicking] = useState(false);
  const confirm = useConfirm();
  const relay = isRelayPanel(doc);
  const units = isListLayout(doc);
  const mcc = doc.layout === 'mcc';
  const sections = sectionsOf(doc);
  const thing = relay ? 'relay' : b.device === 'surge' ? 'surge protector' : 'breaker';
  const size = sizeOf(b);
  const groups = servesByFloor(byId, b.serves);
  const hidden = b.serves.filter((s) => s.hidden || !byId.has(s.locationId)).length;
  const feeds = server?.feeds ?? [];
  const feedsDevices = server?.feedsDevices ?? [];
  const allSizes: { value: Size; label: string; disabled?: string }[] = [
    { value: '1', label: '1-pole' },
    { value: '2', label: '2-pole' },
    {
      value: '3',
      label: '3-pole',
      disabled: maxPoles(doc) < 3 ? 'Split-phase panels have no 3-pole breakers' : undefined,
    },
    {
      value: 'tandem',
      label: 'Tandem',
      disabled: allowsTandem(doc) ? undefined : 'Three-phase panelboards take no tandems',
    },
  ];
  // Relays come in 1- and 2-pole; switchboard and MCC units have no tandems.
  const sizes = relay ? allSizes.slice(0, 2) : units ? allSizes.slice(0, 3) : allSizes;
  const phases = phasesOf(doc, b);
  const volts = circuitVolts(doc.voltage, b.poles);
  const where = [
    `${relay ? 'Relay' : units ? 'Unit' : 'Circuit'} ${circuitLabel(doc, b)}`,
    phases.length ? `Phase ${phases.join(' ')}` : null,
    volts ? `${volts} V` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (readOnly) {
    return (
      <aside className="inspector" aria-label={relay ? 'Relay details' : 'Breaker details'}>
        <span className="eyebrow">{where}</span>
        <h2>{b.label || (b.device === 'surge' ? 'Surge protector' : 'Unlabelled')}</h2>
        <dl className="facts">
          <dt>Size</dt>
          <dd>{size === 'tandem' ? 'Tandem (half space)' : `${b.poles}-pole`}</dd>
          {relay ? (
            <>
              <dt>Fed by</dt>
              <dd>
                <SourceText source={server?.source ?? null} />
              </dd>
              <dt>Control</dt>
              <dd>{b.control || 'Not set'}</dd>
            </>
          ) : (
            <>
              <dt>Device</dt>
              <dd>{DEVICE_LABELS[b.device]}</dd>
            </>
          )}
          <dt>{relay ? 'Rating' : 'Amps'}</dt>
          <dd>{b.device === 'surge' && b.amps === 0 ? 'No breakers (surge protection only)' : ampsLabel(b)}</dd>
          {b.device === 'breaker' && !relay && (
            <>
              <dt>Type</dt>
              <dd>{PROTECTION_LABELS[b.protection]}</dd>
            </>
          )}
          {units && (
            <>
              <dt>Frame</dt>
              <dd>{b.frameAmps ? `${b.frameAmps} A` : 'Not set'}</dd>
              <dt>Feeder</dt>
              <dd>{[b.wire, b.conduit].filter(Boolean).join(' in ') || 'Not set'}</dd>
            </>
          )}
          {mcc && (
            <>
              <dt>Starter</dt>
              <dd>{[b.starter, b.hp ? `${b.hp} HP` : '', b.control].filter(Boolean).join(' · ') || 'Not set'}</dd>
            </>
          )}
          {b.loadVa ? (
            <>
              <dt>Load</dt>
              <dd>
                {formatVa(b.loadVa)}
                {b.demandPct !== null && b.demandPct !== 100 && ` at ${b.demandPct}% demand`}
              </dd>
            </>
          ) : null}
          <dt>Field check</dt>
          <dd>{checkText(b, server)}</dd>
          <dt>Flags</dt>
          <dd>
            {[b.critical && 'Critical', b.backup !== 'none' && `On ${BACKUP_LABELS[b.backup]}`, b.isSpare && 'Spare']
              .filter(Boolean)
              .join(', ') || 'None'}
          </dd>
          <dt>Tags</dt>
          <dd>{b.tags.join(', ') || 'None'}</dd>
          <dt>Serves</dt>
          <dd>
            {groups.flatMap((g) => g.items.map((i) => (g.floor ? `${g.floor} · ${i.label}` : i.label))).join(', ') ||
              'Not tagged'}
            {hidden > 0 && ` (+${hidden} outside your access)`}
          </dd>
        </dl>
        {(feeds.length > 0 || feedsDevices.length > 0) && <FeedsNote feeds={feeds} devices={feedsDevices} />}
        {server && <EquipmentNote breaker={server} />}
        {server && <SwitchedByNote breaker={server} />}
        {b.notes && <p className="notes">{b.notes}</p>}
        {server && !relay && !b.isSpare && <ImpactButton query={`breaker=${server.id}`} />}
      </aside>
    );
  }

  return (
    <aside className="inspector" aria-label={relay ? 'Relay details' : 'Breaker details'}>
      <div className="stack-sm">
        <span className="eyebrow">{where}</span>
        <h2>{b.label || (b.device === 'surge' ? 'Surge protector' : `New ${thing}`)}</h2>
      </div>

      <label className="field">
        <span className="field-label">Label</span>
        <input
          value={b.label}
          autoFocus={!b.label}
          placeholder={relay ? 'What does it switch? e.g. Corridor lights' : 'What does it power?'}
          onChange={(e) => onPatch({ label: e.target.value }, `label:${b.key}`)}
        />
      </label>

      {units && <UnitFields b={b} mcc={mcc} onPatch={onPatch} />}

      {relay && (
        <>
          <RelaySourceField
            panelId={panelId}
            value={b.sourceBreakerId}
            current={server?.source ?? null}
            onChange={(sourceBreakerId) => onPatch({ sourceBreakerId })}
          />
          <label className="field">
            <span className="field-label">Control</span>
            <input
              value={b.control}
              maxLength={120}
              placeholder="e.g. nLight zone 3 · schedule 6 am–10 pm, occupancy"
              onChange={(e) => onPatch({ control: e.target.value }, `control:${b.key}`)}
            />
          </label>
        </>
      )}

      <fieldset className="field" hidden={relay}>
        <legend className="field-label">Device</legend>
        <div className="segmented two">
          {DEVICES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={b.device === d}
              onClick={() =>
                onPatch(
                  d === 'surge'
                    ? // Most in-panel surge protectors are 2-pole and have no breakers of their own.
                      { device: d, amps: 0, protection: 'standard', isSpare: false }
                    : { device: d, amps: b.amps || 20 },
                )
              }
            >
              {DEVICE_LABELS[d]}
            </button>
          ))}
        </div>
        {b.device === 'surge' && (
          <span className="muted small">
            A surge protector that fits in breaker spaces, such as a Square D SurgeBreaker or Eaton CHSPT2ULTRA.
          </span>
        )}
      </fieldset>

      <fieldset className="field">
        <legend className="field-label">Size</legend>
        <div className="segmented four">
          {sizes.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={size === s.value}
              disabled={!!s.disabled}
              title={s.disabled}
              onClick={() => onSize(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      {sections.length > 1 && (
        <label className="field">
          <span className="field-label">Section</span>
          <select
            value={b.section}
            onChange={(e) => {
              const n = Number(e.target.value);
              onMove(firstFitIn(doc, b.key, n) ?? b.position, undefined, n);
            }}
          >
            {sections.map((sec, n) => (
              <option key={n} value={n + 1}>
                {sec.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="two-col">
        <label className="field">
          <span className="field-label">{relay ? 'Relay number' : units ? 'Row' : 'Starts at space'}</span>
          <select value={b.position} onChange={(e) => onMove(Number(e.target.value))}>
            {validStarts(doc, b.key).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {size === 'tandem' ? (
          <label className="field">
            <span className="field-label">Half</span>
            <select value={b.slot} onChange={(e) => onMove(b.position, e.target.value as Slot)}>
              <option value="A">A (top)</option>
              <option value="B">B (bottom)</option>
            </select>
          </label>
        ) : (
          <span />
        )}
      </div>

      <div className="two-col">
        <label className="field">
          <span className="field-label">
            {b.device === 'surge' ? 'Built-in breakers (A)' : relay ? 'Rating (A)' : 'Amps'}
          </span>
          <input
            type="number"
            min={b.device === 'surge' ? 0 : 1}
            max={4000}
            list="amp-sizes"
            value={b.amps}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && (v > 0 || (v === 0 && b.device === 'surge'))) {
                onPatch({ amps: v }, `amps:${b.key}`);
              }
            }}
          />
          {b.device === 'surge' && (
            <span className="muted small">0 if it only protects, with no breakers of its own.</span>
          )}
          <datalist id="amp-sizes">
            {COMMON_AMPS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        {b.device === 'breaker' && !relay ? (
          <label className="field">
            <span className="field-label">Protection</span>
            <select
              value={b.protection}
              onChange={(e) => onPatch({ protection: e.target.value as EditBreaker['protection'] })}
            >
              {PROTECTIONS.map((p) => (
                <option key={p} value={p}>
                  {PROTECTION_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
      </div>
      {!relay && !(b.device === 'surge' && b.amps === 0) && <LoadFields b={b} onPatch={onPatch} />}

      {!relay && (
        <fieldset className="field">
          <legend className="field-label">Field check</legend>
          <div className="segmented three">
            {(['verified', 'wrong', ''] as const).map((st) => (
              <button
                key={st || 'none'}
                type="button"
                aria-pressed={b.verifyStatus === st}
                onClick={() => onPatch({ verifyStatus: st })}
              >
                {st ? VERIFY_LABELS[st] : 'Not checked'}
              </button>
            ))}
          </div>
          {server && server.verifyStatus === b.verifyStatus && server.verifiedBy && (
            <span className="muted small">{checkText(b, server)}</span>
          )}
        </fieldset>
      )}

      <fieldset className="flags">
        <legend className="field-label">Flags</legend>
        <label className="check">
          <input type="checkbox" checked={b.critical} onChange={(e) => onPatch({ critical: e.target.checked })} />
          <span>
            <span className="strong">Critical</span>
            <span className="muted small block">Printed in bold with a marker. Check before switching off.</span>
          </span>
        </label>
        <div className="field">
          <span className="field-label">Backup power</span>
          <div className="segmented three">
            {BACKUPS.map((k) => (
              <button key={k} type="button" aria-pressed={b.backup === k} onClick={() => onPatch({ backup: k })}>
                {BACKUP_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        {b.device === 'breaker' && (
          <label className="check">
            <input type="checkbox" checked={b.isSpare} onChange={(e) => onPatch({ isSpare: e.target.checked })} />
            <span>
              <span className="strong">Spare</span>
              <span className="muted small block">
                {relay ? 'A relay with nothing connected.' : 'A breaker is installed but nothing is connected.'}
              </span>
            </span>
          </label>
        )}
      </fieldset>

      <div className="field">
        <div className="row-between">
          <span className="field-label">Serves</span>
          {site && (
            <button type="button" className="btn btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
              {picking ? 'Done' : 'Choose rooms'}
            </button>
          )}
        </div>
        {picking && site ? (
          <ServesPicker site={site} serves={b.serves} onChange={(serves) => onPatch({ serves })} />
        ) : (
          <div className="serve-groups">
            {groups.length === 0 && hidden === 0 && <span className="muted small">Not tagged yet.</span>}
            {groups.map((g) => (
              <div key={g.floor} className="serve-group">
                {g.floor && <span className="serve-floor">{g.floor}</span>}
                {g.items.map((i) => (
                  <span key={i.locationId} className="tag">
                    {i.label}
                  </span>
                ))}
              </div>
            ))}
            {hidden > 0 && <span className="muted small">+{hidden} outside your access (kept as is)</span>}
          </div>
        )}
      </div>

      <TagInput tags={b.tags} onChange={(tags) => onPatch({ tags })} />

      <label className="field">
        <span className="field-label">Notes</span>
        <textarea rows={2} value={b.notes} onChange={(e) => onPatch({ notes: e.target.value }, `notes:${b.key}`)} />
      </label>

      {(feeds.length > 0 || feedsDevices.length > 0) && <FeedsNote feeds={feeds} devices={feedsDevices} />}
      {server && <EquipmentNote breaker={server} />}
      {server && <SwitchedByNote breaker={server} />}
      {server && !relay && !b.isSpare && <ImpactButton query={`breaker=${server.id}`} />}

      <button
        type="button"
        className="btn btn-danger"
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${b.label || `this ${thing}`}?`,
            message: feeds.length
              ? `It feeds ${feeds.map((f) => f.panelName).join(', ')}, which will be unlinked. You can undo this.`
              : 'You can undo this.',
            confirmLabel: 'Remove',
            danger: true,
          });
          if (ok) onRemove();
        }}
      >
        {`Remove ${thing}`}
      </button>
    </aside>
  );
}

function FeedsNote({ feeds, devices = [] }: { feeds: BreakerDto['feeds']; devices?: BreakerDto['feedsDevices'] }) {
  const links = [
    ...devices.map((d) => ({ key: `d${d.deviceId}`, to: `/devices/${d.deviceId}`, name: d.name })),
    ...feeds.map((f) => ({ key: `p${f.panelId}`, to: `/panels/${f.panelId}`, name: f.panelName })),
  ];
  return (
    <p className="feeds-note">
      Feeds{' '}
      {links.map((l, i) => (
        <span key={l.key}>
          {i > 0 && ', '}
          <Link to={l.to}>{l.name}</Link>
        </span>
      ))}
    </p>
  );
}

/** "LP-1 · 7 Corridor lights (20 A)", linked when the person can open that panel. */
function SourceText({ source }: { source: BreakerDto['source'] }) {
  if (!source) return <>Not set</>;
  const text = `${source.panelName} · ${source.circuit}${source.label ? ` ${source.label}` : ''} (${source.amps} A)`;
  return source.canView ? <Link to={`/panels/${source.panelId}`}>{text}</Link> : <>{text}</>;
}

/** Pick the breaker whose circuit a relay switches, from breakers in breaker panels. */
function RelaySourceField({
  panelId,
  value,
  current,
  onChange,
}: {
  panelId: number;
  value: number | null;
  current: BreakerDto['source'];
  onChange: (id: number | null) => void;
}) {
  const candidates = useQuery({
    queryKey: ['feed-candidates', panelId, 'relay'],
    queryFn: () => api.get<FeedCandidate[]>(`/api/panels/${panelId}/feed-candidates?for=relay`),
  });
  const list = candidates.data ?? [];
  // A feeding breaker the person cannot open is kept, and shown as it is.
  const missing = value !== null && !list.some((c) => c.breakerId === value);
  return (
    <label className="field">
      <span className="field-label">Fed by circuit</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Not set</option>
        {missing && (
          <option value={value}>
            {current ? `${current.panelName} · ${current.circuit} ${current.label}` : 'A breaker outside your access'}
          </option>
        )}
        {list.map((c) => (
          <option key={c.breakerId} value={c.breakerId}>
            {c.panelName} · {c.circuit} {c.label || 'Unlabelled'} ({c.amps} A)
          </option>
        ))}
      </select>
      <span className="muted small">The breaker whose circuit this relay switches.</span>
    </label>
  );
}

/** "Switched by RP-1 relay 5 (zone 3)" on a breaker whose circuit goes through relays. */
function SwitchedByNote({ breaker }: { breaker: BreakerDto }) {
  if (!breaker.switchedBy.length && !breaker.hiddenSwitchedBy) return null;
  return (
    <p className="feeds-note">
      Switched by{' '}
      {breaker.switchedBy.map((r, i) => (
        <span key={`${r.panelId}-${r.relay}`}>
          {i > 0 && ', '}
          <Link to={`/panels/${r.panelId}`}>
            {r.panelName} relay {r.relay}
          </Link>
          {r.control && ` (${r.control})`}
        </span>
      ))}
      {breaker.hiddenSwitchedBy > 0 &&
        `${breaker.switchedBy.length ? ' and ' : ''}${breaker.hiddenSwitchedBy} relay${breaker.hiddenSwitchedBy === 1 ? '' : 's'} outside your access`}
    </p>
  );
}

/** Connected load and demand factor, with the VA from the notes offered when it is there. */
function LoadFields({
  b,
  onPatch,
}: {
  b: EditBreaker;
  onPatch: (patch: Partial<EditBreaker>, coalesce?: string) => void;
}) {
  const fromNotes = b.loadVa ? null : vaFromText(`${b.label} ${b.notes}`);
  return (
    <div className="two-col">
      <label className="field">
        <span className="field-label">Load (VA)</span>
        <input
          type="number"
          min={0}
          step="any"
          value={b.loadVa ?? ''}
          placeholder="Connected load"
          onChange={(e) => onPatch({ loadVa: e.target.value ? Number(e.target.value) : null }, `load:${b.key}`)}
        />
        {fromNotes !== null && (
          <button type="button" className="link-btn small" onClick={() => onPatch({ loadVa: fromNotes })}>
            Use {formatVa(fromNotes)} from the notes
          </button>
        )}
      </label>
      <label className="field">
        <span className="field-label">Demand %</span>
        <input
          type="number"
          min={0}
          max={200}
          value={b.demandPct ?? ''}
          placeholder="100"
          disabled={!b.loadVa}
          onChange={(e) => onPatch({ demandPct: e.target.value ? Number(e.target.value) : null }, `demand:${b.key}`)}
        />
      </label>
    </div>
  );
}

/** Switchboard and MCC units: the unit number as written, frame, feeder; MCC starter, HP, control. */
function UnitFields({
  b,
  mcc,
  onPatch,
}: {
  b: EditBreaker;
  mcc: boolean;
  onPatch: (patch: Partial<EditBreaker>, coalesce?: string) => void;
}) {
  const num = (v: string) => (v ? Number(v) : null);
  return (
    <>
      <div className="two-col">
        <label className="field">
          <span className="field-label">Unit number</span>
          <input
            value={b.unit}
            maxLength={20}
            placeholder={String(b.position)}
            onChange={(e) => onPatch({ unit: e.target.value }, `unit:${b.key}`)}
          />
        </label>
        <label className="field">
          <span className="field-label">Frame (A)</span>
          <input
            type="number"
            min={1}
            value={b.frameAmps ?? ''}
            onChange={(e) => onPatch({ frameAmps: num(e.target.value) }, `frame:${b.key}`)}
          />
        </label>
      </div>
      <div className="two-col">
        <label className="field">
          <span className="field-label">Feeder wire</span>
          <input
            value={b.wire}
            maxLength={80}
            placeholder="e.g. 4 #500 kcmil + #3 G"
            onChange={(e) => onPatch({ wire: e.target.value }, `wire:${b.key}`)}
          />
        </label>
        <label className="field">
          <span className="field-label">Conduit</span>
          <input
            value={b.conduit}
            maxLength={40}
            placeholder='e.g. 3" EMT'
            onChange={(e) => onPatch({ conduit: e.target.value }, `conduit:${b.key}`)}
          />
        </label>
      </div>
      {mcc && (
        <div className="three-col">
          <label className="field">
            <span className="field-label">Starter</span>
            <input
              value={b.starter}
              maxLength={30}
              list="starter-sizes"
              onChange={(e) => onPatch({ starter: e.target.value }, `starter:${b.key}`)}
            />
            <datalist id="starter-sizes">
              {STARTER_SIZES.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">HP</span>
            <input
              type="number"
              min={0}
              step="any"
              value={b.hp ?? ''}
              onChange={(e) => onPatch({ hp: num(e.target.value) }, `hp:${b.key}`)}
            />
          </label>
          <label className="field">
            <span className="field-label">Control</span>
            <input
              value={b.control}
              maxLength={120}
              list="mcc-controls"
              placeholder="e.g. FVNR"
              onChange={(e) => onPatch({ control: e.target.value }, `control:${b.key}`)}
            />
            <datalist id="mcc-controls">
              {MCC_CONTROLS.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
        </div>
      )}
    </>
  );
}

/** "Equipment: AHU-2, EF-1", linked to the register. */
function EquipmentNote({ breaker }: { breaker: BreakerDto }) {
  if (!breaker.equipment.length) return null;
  return (
    <p className="feeds-note">
      Equipment{' '}
      {breaker.equipment.map((e, i) => (
        <span key={e.id}>
          {i > 0 && ', '}
          <Link to={`/equipment/${e.id}`}>{e.tag}</Link>
        </span>
      ))}
    </p>
  );
}

/** "Verified by Ryan on Oct 12, 2026", "Not checked". */
function checkText(b: EditBreaker, server: BreakerDto | undefined): string {
  if (!b.verifyStatus) return 'Not checked';
  const label = VERIFY_LABELS[b.verifyStatus];
  if (!server || server.verifyStatus !== b.verifyStatus || !server.verifiedBy) return label;
  return `${label} by ${server.verifiedBy}${server.verifiedAt ? ` on ${formatDate(server.verifiedAt)}` : ''}`;
}
