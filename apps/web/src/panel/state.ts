import {
  checkChange,
  freeAt,
  validateLayout,
  type Backup,
  type BreakerInput,
  type Device,
  type MainType,
  type PanelDetail,
  type PanelLayout,
  type PanelNameplate,
  type Protection,
  type Slot,
} from '@cbt/core';

export interface EditServe {
  locationId: number;
  note: string;
  /** Tags on locations this person cannot see. Kept by the server; never sent. */
  hidden: boolean;
}

export interface EditBreaker {
  key: string;
  id?: number;
  position: number;
  slot: Slot;
  poles: number;
  /** 0 for a surge protector with no breakers of its own. */
  amps: number;
  device: Device;
  protection: Protection;
  label: string;
  notes: string;
  isSpare: boolean;
  critical: boolean;
  backup: Backup;
  serves: EditServe[];
  tags: string[];
  /** Relays: the breaker whose circuit this relay switches. */
  sourceBreakerId: number | null;
  /** Relays: what controls it, e.g. an nLight zone. */
  control: string;
}

export interface EditPanel {
  name: string;
  layout: PanelLayout;
  spaces: number;
  mainAmps: number | null;
  mainType: MainType;
  voltage: string;
  manufacturer: string;
  model: string;
  notes: string;
  fedFromBreakerId: number | null;
  /** A transformer, disconnect, UPS or service feeding it instead of a breaker. */
  fedFromDeviceId: number | null;
  nameplate: PanelNameplate;
  generatorId: number | null;
  transferSwitch: string;
  controlSystem: string;
  atsId: number | null;
  breakers: EditBreaker[];
}

let counter = 0;
export const newKey = () => `new-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function fromDetail(p: PanelDetail): EditPanel {
  return {
    name: p.name,
    layout: p.layout,
    spaces: p.spaces,
    mainAmps: p.mainAmps,
    mainType: p.mainType,
    voltage: p.voltage,
    manufacturer: p.manufacturer,
    model: p.model,
    notes: p.notes,
    fedFromBreakerId: p.fedFromBreakerId,
    fedFromDeviceId: p.fedFromDeviceId,
    nameplate: { ...p.nameplate },
    generatorId: p.generatorId,
    transferSwitch: p.transferSwitch,
    controlSystem: p.controlSystem,
    atsId: p.atsId,
    breakers: p.breakers.map((b) => ({
      key: `id-${b.id}`,
      id: b.id,
      position: b.position,
      slot: b.slot,
      poles: b.poles,
      amps: b.amps,
      device: b.device,
      protection: b.protection,
      label: b.label,
      notes: b.notes,
      isSpare: b.isSpare,
      critical: b.critical,
      backup: b.backup,
      serves: b.serves.map((s) => ({ locationId: s.locationId, note: s.note, hidden: s.name === null })),
      tags: b.tags,
      sourceBreakerId: b.sourceBreakerId,
      control: b.control,
    })),
  };
}

/** What feeds a panel, as one comparable value. */
export const feedKey = (p: { fedFromBreakerId: number | null; fedFromDeviceId: number | null }) =>
  `${p.fedFromBreakerId ?? ''}:${p.fedFromDeviceId ?? ''}`;

/**
 * The save request body. The feed is only sent when it changed. Ids the server no
 * longer has (a breaker brought back by undo after being deleted) are sent as new breakers.
 */
export function toRequest(doc: EditPanel, version: number, baselineFeed: string, knownIds: Set<number>) {
  const breakers: BreakerInput[] = doc.breakers.map((b) => ({
    id: b.id !== undefined && knownIds.has(b.id) ? b.id : undefined,
    clientKey: b.key,
    position: b.position,
    slot: b.slot,
    poles: b.poles,
    amps: b.amps,
    device: b.device,
    protection: b.protection,
    label: b.label,
    notes: b.notes,
    isSpare: b.isSpare,
    critical: b.critical,
    backup: b.backup,
    serves: b.serves.filter((s) => !s.hidden).map((s) => ({ locationId: s.locationId, note: s.note })),
    tags: b.tags,
    sourceBreakerId: b.sourceBreakerId,
    control: b.control,
  }));
  return {
    name: doc.name,
    layout: doc.layout,
    spaces: doc.spaces,
    mainAmps: doc.mainType === 'lugs' ? null : doc.mainAmps,
    mainType: doc.mainType,
    voltage: doc.voltage,
    manufacturer: doc.manufacturer,
    model: doc.model,
    notes: doc.notes,
    generatorId: doc.generatorId,
    transferSwitch: doc.transferSwitch,
    controlSystem: doc.controlSystem,
    atsId: doc.atsId,
    ...doc.nameplate,
    version,
    breakers,
    ...(feedKey(doc) !== baselineFeed
      ? { fedFromBreakerId: doc.fedFromBreakerId, fedFromDeviceId: doc.fedFromDeviceId }
      : {}),
  };
}

/** Give newly saved breakers their server ids (by the key they were sent with). */
export function applyIds(doc: EditPanel, idMap: Record<string, number>): EditPanel {
  if (!doc.breakers.some((b) => idMap[b.key] !== undefined && b.id !== idMap[b.key])) return doc;
  return { ...doc, breakers: doc.breakers.map((b) => (idMap[b.key] !== undefined ? { ...b, id: idMap[b.key] } : b)) };
}

export type Result = { ok: true; doc: EditPanel } | { ok: false; error: string };

const shape = (b: EditBreaker) => ({ key: b.key, position: b.position, slot: b.slot, poles: b.poles, label: b.label });

function replace(doc: EditPanel, next: EditBreaker): Result {
  const error = checkChange(doc, doc.breakers.map(shape), shape(next));
  if (error) return { ok: false, error };
  const exists = doc.breakers.some((b) => b.key === next.key);
  return {
    ok: true,
    doc: {
      ...doc,
      breakers: exists ? doc.breakers.map((b) => (b.key === next.key ? next : b)) : [...doc.breakers, next],
    },
  };
}

export function addBreaker(doc: EditPanel, position: number, slot: Slot = 'full'): Result & { key?: string } {
  const key = newKey();
  const r = replace(doc, {
    key,
    position,
    slot,
    poles: 1,
    amps: 20,
    device: 'breaker',
    protection: 'standard',
    label: '',
    notes: '',
    isSpare: false,
    critical: false,
    backup: 'none',
    serves: [],
    tags: [],
    sourceBreakerId: null,
    control: '',
  });
  return r.ok ? { ...r, key } : r;
}

export function updateBreaker(doc: EditPanel, key: string, patch: Partial<EditBreaker>): Result {
  const b = doc.breakers.find((x) => x.key === key);
  if (!b) return { ok: false, error: 'That breaker is gone.' };
  return replace(doc, { ...b, ...patch });
}

export type Size = '1' | '2' | '3' | 'tandem';

export function sizeOf(b: EditBreaker): Size {
  return b.slot !== 'full' ? 'tandem' : (String(b.poles) as Size);
}

export function setSize(doc: EditPanel, key: string, size: Size): Result {
  const b = doc.breakers.find((x) => x.key === key);
  if (!b) return { ok: false, error: 'That breaker is gone.' };
  if (size === 'tandem') {
    const free = freeAt(doc, doc.breakers.map(shape), b.position, key);
    const slot: Slot = free.A ? 'A' : free.B ? 'B' : 'A';
    return updateBreaker(doc, key, { poles: 1, slot });
  }
  return updateBreaker(doc, key, { poles: Number(size), slot: 'full' });
}

/** Move a breaker to start at `position`, keeping it a tandem half when it is one. */
export function moveBreaker(doc: EditPanel, key: string, position: number, slot?: Slot): Result {
  const b = doc.breakers.find((x) => x.key === key);
  if (!b) return { ok: false, error: 'That breaker is gone.' };
  if (b.slot === 'full') return updateBreaker(doc, key, { position, slot: 'full' });
  const free = freeAt(doc, doc.breakers.map(shape), position, key);
  const target: Slot = slot ?? (free[b.slot] ? b.slot : free.A ? 'A' : 'B');
  return updateBreaker(doc, key, { position, slot: target });
}

export function removeBreaker(doc: EditPanel, key: string): EditPanel {
  return { ...doc, breakers: doc.breakers.filter((b) => b.key !== key) };
}

/** Change panel-level fields; checks that the breakers still fit. */
export function updatePanel(doc: EditPanel, patch: Partial<Omit<EditPanel, 'breakers'>>): Result {
  const next = { ...doc, ...patch };
  const issue = validateLayout(next, next.breakers.map(shape))[0];
  return issue ? { ok: false, error: issue.message } : { ok: true, doc: next };
}

/** Spaces a breaker could start at (for the "starts at" picker). */
export function validStarts(doc: EditPanel, key: string): number[] {
  const out: number[] = [];
  for (let p = 1; p <= doc.spaces; p++) if (moveBreaker(doc, key, p).ok) out.push(p);
  return out;
}
