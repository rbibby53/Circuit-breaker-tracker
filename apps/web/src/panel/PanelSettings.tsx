import {
  AVAILABLE_LAYOUTS,
  LAYOUT_DEFAULTS,
  LAYOUT_LABELS,
  VOLTAGE_PRESETS,
  spaceChoices,
  type FeedCandidate,
  type PanelDetail,
  type PanelLayout,
} from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
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
  const candidates = useQuery({
    queryKey: ['feed-candidates', server.id],
    queryFn: () => api.get<FeedCandidate[]>(`/api/panels/${server.id}/feed-candidates`),
  });
  const known = new Set((candidates.data ?? []).map((c) => c.breakerId));
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
  for (const c of candidates.data ?? []) byPanel.set(c.panelId, [...(byPanel.get(c.panelId) ?? []), c]);

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
          <select value={doc.layout} onChange={(e) => changeLayout(e.target.value as PanelLayout)}>
            {AVAILABLE_LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {LAYOUT_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Spaces</span>
          <select value={doc.spaces} onChange={(e) => onChange({ spaces: Number(e.target.value) })}>
            {spaces.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
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
        {doc.mainType === 'breaker' && (
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
        <label className="field span-2">
          <span className="field-label">Fed from</span>
          <select
            value={doc.fedFromBreakerId ?? ''}
            onChange={(e) => onChange({ fedFromBreakerId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">The utility service (this is a main panel)</option>
            {doc.fedFromBreakerId !== null && !known.has(doc.fedFromBreakerId) && (
              <option value={doc.fedFromBreakerId}>
                {server.feedChain[0]
                  ? `${server.feedChain[0].panelName} · ${server.feedChain[0].circuit} ${server.feedChain[0].label}`
                  : 'Current feeder'}
              </option>
            )}
            {[...byPanel.entries()].map(([panelId, list]) => (
              <optgroup key={panelId} label={`${list[0]!.panelName} (${list[0]!.locationPath})`}>
                {list.map((c) => (
                  <option key={c.breakerId} value={c.breakerId}>
                    {c.circuit} {c.label || 'Unlabelled'} ({c.amps}A)
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span className="field-label">Notes</span>
          <textarea rows={2} value={doc.notes} onChange={(e) => onChange({ notes: e.target.value }, 'notes')} />
        </label>
      </div>
      <SharePanel panel={server} />
      <div className="row">
        <DuplicatePanel panel={server} />
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            const ok = await confirm({
              title: `Delete ${server.name}?`,
              message: 'All its breakers and their labels go too. This cannot be undone.',
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
