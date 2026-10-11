import {
  BACKUPS,
  BACKUP_LABELS,
  COMMON_AMPS,
  DEVICES,
  DEVICE_LABELS,
  ampsLabel,
  PROTECTIONS,
  PROTECTION_LABELS,
  allowsTandem,
  circuitLabel,
  circuitVolts,
  maxPoles,
  phasesOf,
  type BreakerDto,
  type Slot,
} from '@cbt/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import type { TreeNode } from '../tree';
import { servesByFloor } from './serves';
import { ServesPicker } from './ServesPicker';
import { TagInput } from './TagInput';
import { sizeOf, validStarts, type EditBreaker, type EditPanel, type Size } from './state';

interface Props {
  doc: EditPanel;
  breaker: EditBreaker;
  server: BreakerDto | undefined;
  byId: Map<number, TreeNode>;
  site: TreeNode | null;
  readOnly: boolean;
  onPatch: (patch: Partial<EditBreaker>, coalesce?: string) => void;
  onSize: (size: Size) => void;
  onMove: (position: number, slot?: Slot) => void;
  onRemove: () => void;
}

export function Inspector({ doc, breaker: b, server, byId, site, readOnly, onPatch, onSize, onMove, onRemove }: Props) {
  const [picking, setPicking] = useState(false);
  const confirm = useConfirm();
  const size = sizeOf(b);
  const groups = servesByFloor(byId, b.serves);
  const hidden = b.serves.filter((s) => s.hidden || !byId.has(s.locationId)).length;
  const feeds = server?.feeds ?? [];
  const sizes: { value: Size; label: string; disabled?: string }[] = [
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
  const phases = phasesOf(doc, b);
  const volts = circuitVolts(doc.voltage, b.poles);
  const where = [
    `Circuit ${circuitLabel(doc, b)}`,
    phases.length ? `Phase ${phases.join(' ')}` : null,
    volts ? `${volts} V` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (readOnly) {
    return (
      <aside className="inspector" aria-label="Breaker details">
        <span className="eyebrow">{where}</span>
        <h2>{b.label || (b.device === 'surge' ? 'Surge protector' : 'Unlabelled')}</h2>
        <dl className="facts">
          <dt>Size</dt>
          <dd>{size === 'tandem' ? 'Tandem (half space)' : `${b.poles}-pole`}</dd>
          <dt>Device</dt>
          <dd>{DEVICE_LABELS[b.device]}</dd>
          <dt>Amps</dt>
          <dd>{b.device === 'surge' && b.amps === 0 ? 'No breakers (surge protection only)' : ampsLabel(b)}</dd>
          {b.device === 'breaker' && (
            <>
              <dt>Type</dt>
              <dd>{PROTECTION_LABELS[b.protection]}</dd>
            </>
          )}
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
        {feeds.length > 0 && <FeedsNote feeds={feeds} />}
        {b.notes && <p className="notes">{b.notes}</p>}
      </aside>
    );
  }

  return (
    <aside className="inspector" aria-label="Breaker details">
      <div className="stack-sm">
        <span className="eyebrow">{where}</span>
        <h2>{b.label || (b.device === 'surge' ? 'Surge protector' : 'New breaker')}</h2>
      </div>

      <label className="field">
        <span className="field-label">Label</span>
        <input
          value={b.label}
          autoFocus={!b.label}
          placeholder="What does it power?"
          onChange={(e) => onPatch({ label: e.target.value }, `label:${b.key}`)}
        />
      </label>

      <fieldset className="field">
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

      <div className="two-col">
        <label className="field">
          <span className="field-label">Starts at space</span>
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
          <span className="field-label">{b.device === 'surge' ? 'Built-in breakers (A)' : 'Amps'}</span>
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
        {b.device === 'breaker' ? (
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
              <span className="muted small block">A breaker is installed but nothing is connected.</span>
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

      {feeds.length > 0 && <FeedsNote feeds={feeds} />}

      <button
        type="button"
        className="btn btn-danger"
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${b.label || 'this breaker'}?`,
            message: feeds.length
              ? `It feeds ${feeds.map((f) => f.panelName).join(', ')}, which will be unlinked. You can undo this.`
              : 'You can undo this.',
            confirmLabel: 'Remove',
            danger: true,
          });
          if (ok) onRemove();
        }}
      >
        {b.device === 'surge' ? 'Remove surge protector' : 'Remove breaker'}
      </button>
    </aside>
  );
}

function FeedsNote({ feeds }: { feeds: BreakerDto['feeds'] }) {
  return (
    <p className="feeds-note">
      Feeds{' '}
      {feeds.map((f, i) => (
        <span key={f.panelId}>
          {i > 0 && ', '}
          <Link to={`/panels/${f.panelId}`}>{f.panelName}</Link>
        </span>
      ))}
    </p>
  );
}
