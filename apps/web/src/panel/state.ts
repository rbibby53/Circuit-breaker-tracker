import {
  MAX_UNITS,
  checkChange,
  freeAt,
  isListLayout,
  sectionShape,
  sectionsOf,
  validateSections,
  type Backup,
  type BreakerInput,
  type Device,
  type MainType,
  type PanelDetail,
  type PanelLayout,
  type PanelNameplate,
  type PanelSection,
  type VerifyStatus,
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
  /** Connected load (VA) and demand factor (%), when recorded. */
  loadVa: number | null;
  demandPct: number | null;
  /** Which section of the panel, from 1. */
  section: number;
  /** Switchboards and MCCs: unit number, frame, feeder wire and conduit; MCC starter and HP. */
  unit: string;
  frameAmps: number | null;
  wire: string;
  conduit: string;
  starter: string;
  hp: number | null;
  /** Field check: not checked, verified or wrong. */
  verifyStatus: VerifyStatus;
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
  /** Sections after the first. */
  sections: PanelSection[];
  generatorId: number | null;
  transferSwitch: string;
  controlSystem: string;
  atsId: number | null;
  breakers: EditBreaker[];
  /** Which way of the device feeding it, e.g. "Way 3" of a switching cube. */
  fedWay: string;
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
    sections: p.sections.map((x) => ({ ...x })),
    fedWay: p.fedWay,
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
      loadVa: b.loadVa,
      demandPct: b.demandPct,
      section: b.section,
      unit: b.unit,
      frameAmps: b.frameAmps,
      wire: b.wire,
      conduit: b.conduit,
      starter: b.starter,
      hp: b.hp,
      verifyStatus: b.verifyStatus,
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
    loadVa: b.loadVa,
    demandPct: b.demandPct,
    section: b.section,
    unit: b.unit,
    frameAmps: b.frameAmps,
    wire: b.wire,
    conduit: b.conduit,
    starter: b.starter,
    hp: b.hp,
    verifyStatus: b.verifyStatus,
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
    sections: doc.sections,
    fedWay: doc.fedWay,
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

const shape = (b: EditBreaker) => ({
  key: b.key,
  position: b.position,
  slot: b.slot,
  poles: b.poles,
  label: b.label,
  section: b.section,
});

/** The breakers in one section, as layout shapes. */
const inSection = (doc: EditPanel, section: number) => doc.breakers.filter((b) => b.section === section).map(shape);

function replace(doc: EditPanel, next: EditBreaker): Result {
  if (next.section > sectionsOf(doc).length) return { ok: false, error: 'That section is gone.' };
  const error = checkChange(sectionShape(doc, next.section), inSection(doc, next.section), shape(next));
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

export function addBreaker(
  doc: EditPanel,
  position: number,
  slot: Slot = 'full',
  section = 1,
): Result & { key?: string } {
  const key = newKey();
  const units = isListLayout(doc);
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
    loadVa: null,
    demandPct: null,
    section,
    unit: units ? String(position) : '',
    frameAmps: null,
    wire: '',
    conduit: '',
    starter: '',
    hp: null,
    verifyStatus: '',
  });
  return r.ok ? { ...r, key } : r;
}

/** Add a unit to a switchboard or MCC on the first free row, adding a row when all are used. */
export function addUnit(doc: EditPanel): Result & { key?: string } {
  const used = new Set(doc.breakers.filter((b) => b.section === 1).map((b) => b.position));
  let position = 1;
  while (used.has(position)) position++;
  const grown = position > doc.spaces ? { ...doc, spaces: position } : doc;
  if (position > MAX_UNITS) return { ok: false, error: `A switchboard or MCC has up to ${MAX_UNITS} units.` };
  return addBreaker(grown, position, 'full', 1);
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
    const free = freeAt(sectionShape(doc, b.section), inSection(doc, b.section), b.position, key);
    const slot: Slot = free.A ? 'A' : free.B ? 'B' : 'A';
    return updateBreaker(doc, key, { poles: 1, slot });
  }
  return updateBreaker(doc, key, { poles: Number(size), slot: 'full' });
}

/** Move a breaker to start at `position` (in `section`, or its own), keeping it a tandem half when it is one. */
export function moveBreaker(doc: EditPanel, key: string, position: number, slot?: Slot, section?: number): Result {
  const b = doc.breakers.find((x) => x.key === key);
  if (!b) return { ok: false, error: 'That breaker is gone.' };
  const to = section ?? b.section;
  if (b.slot === 'full') return updateBreaker(doc, key, { position, slot: 'full', section: to });
  const free = freeAt(sectionShape(doc, to), inSection(doc, to), position, key);
  const target: Slot = slot ?? (free[b.slot] ? b.slot : free.A ? 'A' : 'B');
  return updateBreaker(doc, key, { position, slot: target, section: to });
}

export function removeBreaker(doc: EditPanel, key: string): EditPanel {
  return { ...doc, breakers: doc.breakers.filter((b) => b.key !== key) };
}

/** Change panel-level fields; checks that the breakers still fit. */
export function updatePanel(doc: EditPanel, patch: Partial<Omit<EditPanel, 'breakers'>>): Result {
  const next = { ...doc, ...patch };
  const issue = validateSections(next, next.breakers.map(shape))[0];
  return issue ? { ok: false, error: issue.message } : { ok: true, doc: next };
}

/** Spaces a breaker could start at (for the "starts at" picker). */
export function validStarts(doc: EditPanel, key: string): number[] {
  const b = doc.breakers.find((x) => x.key === key);
  const spaces = sectionShape(doc, b?.section ?? 1).spaces;
  const out: number[] = [];
  for (let p = 1; p <= spaces; p++) if (moveBreaker(doc, key, p).ok) out.push(p);
  return out;
}

/** The first place a breaker fits in another section (its own position first), or null. */
export function firstFitIn(doc: EditPanel, key: string, section: number): number | null {
  const b = doc.breakers.find((x) => x.key === key);
  if (!b) return null;
  const spaces = sectionShape(doc, section).spaces;
  const order = [b.position, ...Array.from({ length: spaces }, (_, i) => i + 1)];
  for (const p of order) if (p <= spaces && moveBreaker(doc, key, p, undefined, section).ok) return p;
  return null;
}

/** Change several breakers at once (bulk edit); the whole panel must still be valid. */
export function bulkUpdate(
  doc: EditPanel,
  keys: ReadonlySet<string>,
  patch: Partial<EditBreaker> | ((b: EditBreaker) => Partial<EditBreaker>),
): Result {
  if (keys.size === 0) return { ok: false, error: 'Select some breakers first.' };
  const next = {
    ...doc,
    breakers: doc.breakers.map((b) =>
      keys.has(b.key) ? { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } : b,
    ),
  };
  const issue = validateSections(next, next.breakers.map(shape))[0];
  return issue ? { ok: false, error: issue.message } : { ok: true, doc: next };
}

/**
 * Move the selected breakers by `delta` spaces (or unit rows), keeping their order: renumbering
 * a range. On two-column panels a move of 2 keeps each breaker on its side.
 */
export function shiftBreakers(doc: EditPanel, keys: ReadonlySet<string>, delta: number): Result {
  return bulkUpdate(doc, keys, (b) => ({
    position: b.position + delta,
    ...(isListLayout(doc) && /^\d+$/.test(b.unit) && Number(b.unit) === b.position
      ? { unit: String(b.position + delta) }
      : {}),
  }));
}
