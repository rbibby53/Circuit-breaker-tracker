import {
  AIC_RATINGS,
  AVAILABLE_LAYOUTS,
  MAX_SECTIONS,
  MAX_UNITS,
  isListLayout,
  CONTROL_SYSTEMS,
  ENCLOSURES,
  MOUNTINGS,
  MOUNTING_LABELS,
  POWER_DEVICE_LABELS,
  LAYOUT_DEFAULTS,
  LAYOUT_LABELS,
  VOLTAGE_PRESETS,
  spaceChoices,
  type FeedCandidate,
  type FeedOptions,
  type Mounting,
  type PanelDetail,
  type PanelLayout,
  type PanelSection,
} from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { useGenerators, useTransferSwitches } from '../queries';
import { DuplicatePanel } from './DuplicatePanel';
import { SharePanel } from './SharePanel';
import type { EditPanel } from './state';

export function PanelSettings({
  doc,
  server,
  onChange,
  onDelete,
}: {
  doc: EditPanel;
  server: PanelDetail;
  onChange: (patch: Partial<Omit<EditPanel, 'breakers'>>, coalesce?: string) => void;
  onDelete: () => void;
}) {
  const confirm = useConfirm();
  const options = useQuery({
    queryKey: ['feed-options', 'panel', server.id],
    queryFn: () => api.get<FeedOptions>(`/api/feed-options?panel=${server.id}`),
  });
  const known = new Set((options.data?.breakers ?? []).map((c) => c.breakerId));
  const knownDevices = new Set((options.data?.devices ?? []).map((d) => d.id));
  const current = server.feedChain[0];
  const nameplate = (patch: Partial<EditPanel['nameplate']>, coalesce?: string) =>
    onChange({ nameplate: { ...doc.nameplate, ...patch } }, coalesce);
  const generators = useGenerators();
  const switches = useTransferSwitches();
  const relay = doc.layout === 'relay';
  // A relay panel stays one, a switchboard or MCC stays a list, and a panelboard stays a grid.
  const units = isListLayout(doc);
  const layouts = AVAILABLE_LAYOUTS.filter((l) => (l === 'relay') === relay && isListLayout({ layout: l }) === units);
  const inherited = server.generator?.via ? server.generator : null;
  const spaces = spaceChoices(doc.layout);
  if (!spaces.includes(doc.spaces)) spaces.push(doc.spaces);

  // Switching layout keeps what still fits: the nearest valid space count, and the voltage
  // unless it was the old layout's stock value.
  const changeLayout = (layout: PanelLayout) => {
    const choices = spaceChoices(layout);
    const nextSpaces = choices.includes(doc.spaces)
      ? doc.spaces
      : (choices.find((n) => n >= doc.spaces) ?? choices[choices.length - 1]!);
    const stock = VOLTAGE_PRESETS[doc.layout].includes(doc.voltage) || !doc.voltage;
    onChange({ layout, spaces: nextSpaces, ...(stock ? { voltage: LAYOUT_DEFAULTS[layout].voltage } : {}) });
  };

  const byPanel = new Map<number, FeedCandidate[]>();
  for (const c of options.data?.breakers ?? []) byPanel.set(c.panelId, [...(byPanel.get(c.panelId) ?? []), c]);

  return (
    <section className="panel stack" aria-label="Panel settings">
      <h2 className="h-caps">Panel settings</h2>
      <div className="settings-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input value={doc.name} onChange={(e) => onChange({ name: e.target.value }, 'name')} />
        </label>
        <label className="field">
          <span className="field-label">Layout</span>
          <select value={doc.layout} disabled={relay} onChange={(e) => changeLayout(e.target.value as PanelLayout)}>
            {layouts.map((l) => (
              <option key={l} value={l}>
                {LAYOUT_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        {units ? (
          <label className="field">
            <span className="field-label">Units (rows)</span>
            <input
              type="number"
              min={1}
              max={MAX_UNITS}
              value={doc.spaces}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= MAX_UNITS) onChange({ spaces: n }, 'spaces');
              }}
            />
          </label>
        ) : (
          <label className="field">
            <span className="field-label">
              {relay ? 'Relays' : doc.sections.length ? 'Spaces (section 1)' : 'Spaces'}
            </span>
            <select value={doc.spaces} onChange={(e) => onChange({ spaces: Number(e.target.value) })}>
              {spaces.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {relay ? (
          <label className="field">
            <span className="field-label">Control system</span>
            <input
              value={doc.controlSystem}
              list="control-systems"
              maxLength={60}
              placeholder="e.g. nLight"
              onChange={(e) => onChange({ controlSystem: e.target.value }, 'controlSystem')}
            />
            <datalist id="control-systems">
              {CONTROL_SYSTEMS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        ) : (
          <label className="field">
            <span className="field-label">Main</span>
            <select
              value={doc.mainType}
              onChange={(e) => onChange({ mainType: e.target.value as EditPanel['mainType'] })}
            >
              <option value="breaker">Main breaker</option>
              <option value="lugs">Main lugs only (fed from elsewhere)</option>
            </select>
          </label>
        )}
        {!relay && doc.mainType === 'breaker' && (
          <label className="field">
            <span className="field-label">Main breaker amps</span>
            <input
              type="number"
              min={1}
              value={doc.mainAmps ?? ''}
              onChange={(e) => onChange({ mainAmps: e.target.value ? Number(e.target.value) : null }, 'mainAmps')}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">Voltage</span>
          <input
            value={doc.voltage}
            list="panel-voltages"
            placeholder={LAYOUT_DEFAULTS[doc.layout].voltage}
            onChange={(e) => onChange({ voltage: e.target.value }, 'voltage')}
          />
          <datalist id="panel-voltages">
            {VOLTAGE_PRESETS[doc.layout].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">Manufacturer</span>
          <input
            value={doc.manufacturer}
            onChange={(e) => onChange({ manufacturer: e.target.value }, 'manufacturer')}
          />
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <input value={doc.model} onChange={(e) => onChange({ model: e.target.value }, 'model')} />
        </label>
        {!relay && (
          <>
            <label className="field">
              <span className="field-label">Bus rating (A)</span>
              <input
                type="number"
                min={1}
                value={doc.nameplate.busAmps ?? ''}
                placeholder={doc.mainAmps ? String(doc.mainAmps) : ''}
                onChange={(e) => nameplate({ busAmps: e.target.value ? Number(e.target.value) : null }, 'busAmps')}
              />
            </label>
            <label className="field">
              <span className="field-label">AIC / SCCR (kA)</span>
              <input
                type="number"
                min={1}
                list="aic-ratings"
                value={doc.nameplate.aicKa ?? ''}
                onChange={(e) => nameplate({ aicKa: e.target.value ? Number(e.target.value) : null }, 'aicKa')}
              />
              <datalist id="aic-ratings">
                {AIC_RATINGS.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </label>
          </>
        )}
        <label className="field">
          <span className="field-label">Mounting</span>
          <select value={doc.nameplate.mounting} onChange={(e) => nameplate({ mounting: e.target.value as Mounting })}>
            {MOUNTINGS.map((m) => (
              <option key={m} value={m}>
                {MOUNTING_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Enclosure</span>
          <input
            value={doc.nameplate.enclosure}
            list="enclosures"
            maxLength={40}
            placeholder="e.g. NEMA 1"
            onChange={(e) => nameplate({ enclosure: e.target.value }, 'enclosure')}
          />
          <datalist id="enclosures">
            {ENCLOSURES.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">Feeder wire</span>
          <input
            value={doc.nameplate.feederWire}
            maxLength={80}
            placeholder="e.g. 4 #3/0 + #6 G"
            onChange={(e) => nameplate({ feederWire: e.target.value }, 'feederWire')}
          />
        </label>
        <label className="field">
          <span className="field-label">Feeder conduit</span>
          <input
            value={doc.nameplate.feederConduit}
            maxLength={40}
            placeholder='e.g. 2" EMT'
            onChange={(e) => nameplate({ feederConduit: e.target.value }, 'feederConduit')}
          />
        </label>
        <label className="field span-2">
          <span className="field-label">{relay ? 'Control power from' : 'Fed from'}</span>
          <select
            value={
              doc.fedFromDeviceId ? `d:${doc.fedFromDeviceId}` : doc.fedFromBreakerId ? `b:${doc.fedFromBreakerId}` : ''
            }
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              onChange({
                fedFromBreakerId: kind === 'b' ? Number(id) : null,
                fedFromDeviceId: kind === 'd' ? Number(id) : null,
              });
            }}
          >
            <option value="">{relay ? 'Not set' : 'The utility service (this is a main panel)'}</option>
            {doc.fedFromBreakerId !== null && !known.has(doc.fedFromBreakerId) && (
              <option value={`b:${doc.fedFromBreakerId}`}>
                {current?.kind === 'panel'
                  ? `${current.panelName} · ${current.circuit} ${current.label}`
                  : 'Current feeder'}
              </option>
            )}
            {doc.fedFromDeviceId !== null && !knownDevices.has(doc.fedFromDeviceId) && (
              <option value={`d:${doc.fedFromDeviceId}`}>
                {current?.kind === 'device' ? current.name : 'Current feeder'}
              </option>
            )}
            {(options.data?.devices ?? []).length > 0 && (
              <optgroup label="Transformers, disconnects and UPSs">
                {options.data!.devices.map((d) => (
                  <option key={d.id} value={`d:${d.id}`}>
                    {d.name} · {POWER_DEVICE_LABELS[d.kind]}
                    {d.rating ? ` · ${d.rating}` : ''} ({d.locationPath})
                  </option>
                ))}
              </optgroup>
            )}
            {[...byPanel.entries()].map(([panelId, list]) => (
              <optgroup key={panelId} label={`${list[0]!.panelName} (${list[0]!.locationPath})`}>
                {list.map((c) => (
                  <option key={c.breakerId} value={`b:${c.breakerId}`}>
                    {c.circuit} {c.label || 'Unlabelled'} ({c.amps}A)
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span className="field-label">Backup power</span>
          <select
            aria-describedby="backup-power-hint"
            value={doc.atsId ? `ats:${doc.atsId}` : doc.generatorId ? `gen:${doc.generatorId}` : ''}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              onChange({
                atsId: kind === 'ats' ? Number(id) : null,
                generatorId: kind === 'gen' ? Number(id) : null,
              });
            }}
          >
            <option value="">
              {inherited ? `None of its own (on ${inherited.name} through ${inherited.via!.panelName})` : 'None'}
            </option>
            {doc.atsId !== null && !(switches.data ?? []).some((t) => t.id === doc.atsId) && (
              <option value={`ats:${doc.atsId}`}>{server.generator?.ats?.name ?? 'Current transfer switch'}</option>
            )}
            {doc.generatorId !== null && !(generators.data ?? []).some((g) => g.id === doc.generatorId) && (
              <option value={`gen:${doc.generatorId}`}>{server.generator?.name ?? 'Current generator'}</option>
            )}
            {(switches.data ?? []).length > 0 && (
              <optgroup label="On a transfer switch">
                {(switches.data ?? []).map((t) => (
                  <option key={t.id} value={`ats:${t.id}`}>
                    {t.name}
                    {t.generatorName ? ` → ${t.generatorName}` : ' (no generator)'} · {t.locationPath}
                  </option>
                ))}
              </optgroup>
            )}
            {(generators.data ?? []).length > 0 && (
              <optgroup label="Straight from a generator">
                {(generators.data ?? []).map((g) => (
                  <option key={g.id} value={`gen:${g.id}`}>
                    {g.name} ({g.locationPath})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <p id="backup-power-hint" className="muted small span-2 field-note">
          Add transfer switches on the generator&apos;s page. The normal side stays the &quot;Fed from&quot; breaker.
        </p>
        <label className="field span-2">
          <span className="field-label">Notes</span>
          <textarea rows={2} value={doc.notes} onChange={(e) => onChange({ notes: e.target.value }, 'notes')} />
        </label>
      </div>
      {!relay && !units && <SectionsEditor doc={doc} onChange={onChange} />}
      <SharePanel panel={server} />
      <div className="row">
        <DuplicatePanel panel={server} />
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            const ok = await confirm({
              title: `Delete ${server.name}?`,
              message: `All its ${relay ? 'relays' : 'breakers'} and their labels go too. This cannot be undone.`,
              confirmLabel: 'Delete panel',
              danger: true,
            });
            if (ok) onDelete();
          }}
        >
          Delete panel
        </button>
      </div>
    </section>
  );
}

/**
 * Sections after the first: the second half of a panel numbered from 1 again, or the rest of a
 * panel past 84 circuits. Each has its own spaces, and may be fed through the first's lugs.
 */
function SectionsEditor({
  doc,
  onChange,
}: {
  doc: EditPanel;
  onChange: (patch: Partial<Omit<EditPanel, 'breakers'>>, coalesce?: string) => void;
}) {
  const choices = spaceChoices(doc.layout);
  const set = (i: number, patch: Partial<PanelSection>, coalesce?: string) =>
    onChange({ sections: doc.sections.map((x, n) => (n === i ? { ...x, ...patch } : x)) }, coalesce);
  return (
    <div className="stack-sm sections-editor">
      <span className="field-label">Sections</span>
      <p className="muted small">
        For a panel whose second half is numbered from 1 again, or that goes past {choices[choices.length - 1]}{' '}
        circuits. Each section has its own numbering.
      </p>
      {doc.sections.map((sec, i) => (
        <div key={i} className="form-row section-row">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={sec.name}
              maxLength={40}
              onChange={(e) => set(i, { name: e.target.value }, `section-name-${i}`)}
            />
          </label>
          <label className="field">
            <span className="field-label">Spaces</span>
            <select value={sec.spaces} onChange={(e) => set(i, { spaces: Number(e.target.value) })}>
              {(choices.includes(sec.spaces) ? choices : [...choices, sec.spaces]).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="check field-check">
            <input
              type="checkbox"
              checked={sec.throughLugs}
              onChange={(e) => set(i, { throughLugs: e.target.checked })}
            />
            Fed through lugs
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onChange({ sections: doc.sections.filter((_, n) => n !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      {doc.sections.length < MAX_SECTIONS - 1 && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            onChange({
              sections: [
                ...doc.sections,
                { name: `Section ${doc.sections.length + 2}`, spaces: doc.spaces, throughLugs: true },
              ],
            })
          }
        >
          + Add a section
        </button>
      )}
    </div>
  );
}
