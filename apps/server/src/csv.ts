import {
  DEVICE_LABELS,
  BACKUP_LABELS,
  PROTECTION_LABELS,
  circuitLabel,
  isRelayPanel,
  phasesOf,
  type PanelDetail,
} from '@cbt/core';

/**
 * Spreadsheet-safe cell: quoted when needed, and text that a spreadsheet would run as a formula
 * (starting with = + - @ or a control character) is prefixed with a quote so it stays text.
 */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  let s = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | boolean | null)[][]): string {
  // The byte-order mark makes Excel read the file as UTF-8.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const BREAKER_COLUMNS = [
  'Location',
  'Panel',
  'Circuit',
  'Phase',
  'Poles',
  'Type',
  'Amps',
  'Load (VA)',
  'Demand %',
  'Label',
  'Protection',
  'Critical',
  'Backup power',
  'Spare',
  'Serves',
  'Feeds',
  'Fed by',
  'Control',
  'Switched by',
  'Generator',
  'Tags',
  'Notes',
];

/** One row per breaker, in panel order. Locations the reader cannot see are counted, not named. */
export function breakerRows(panel: PanelDetail): (string | number | boolean | null)[][] {
  return panel.breakers.map((b) => {
    const shown = b.serves.filter((s) => s.name !== null);
    const hidden = b.serves.length - shown.length;
    const serves = [
      ...shown.map((s) => `${s.path ?? s.name}${s.note ? ` (${s.note})` : ''}`),
      ...(hidden ? [`${hidden} more not shown`] : []),
    ].join('; ');
    const feeds = [
      ...b.feeds.map((f) => f.panelName),
      ...b.feedsDevices.map((d) => d.name),
      ...(b.hiddenFeeds ? [`${b.hiddenFeeds} more not shown`] : []),
    ].join('; ');
    return [
      panel.locationPath,
      panel.name,
      circuitLabel(panel, b),
      phasesOf(panel, b).join(' '),
      b.poles,
      isRelayPanel(panel) ? 'Relay' : DEVICE_LABELS[b.device],
      // A surge protector without breakers has no rating.
      b.amps === 0 ? '' : b.amps,
      b.loadVa ?? '',
      b.loadVa && b.demandPct !== null ? b.demandPct : '',
      b.label,
      PROTECTION_LABELS[b.protection],
      b.critical,
      b.backup === 'none' ? '' : BACKUP_LABELS[b.backup],
      b.isSpare,
      serves,
      feeds,
      b.source ? `${b.source.panelName} ${b.source.circuit}${b.source.label ? ` ${b.source.label}` : ''}` : '',
      b.control,
      [
        ...b.switchedBy.map((r) => `${r.panelName} relay ${r.relay}`),
        ...(b.hiddenSwitchedBy ? [`${b.hiddenSwitchedBy} more not shown`] : []),
      ].join('; '),
      panel.generator ? panel.generator.name : '',
      b.tags.join('; '),
      b.notes,
    ];
  });
}
