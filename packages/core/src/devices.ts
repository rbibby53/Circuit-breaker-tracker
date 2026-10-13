// Power devices between a breaker and what it feeds, and the details panels and transfer switches
// carry on their schedules. A transformer is where 480 V becomes 208 V; a disconnect or UPS sits in
// line; the utility service (with its meter) is where power comes in. Campuses that run their own
// grid distribute medium voltage through switching cubes (pad-mounted MV switchgear) to each
// building's transformer.

export const POWER_DEVICE_KINDS = ['transformer', 'disconnect', 'ups', 'service', 'switch'] as const;
export type PowerDeviceKind = (typeof POWER_DEVICE_KINDS)[number];

export const POWER_DEVICE_LABELS: Record<PowerDeviceKind, string> = {
  transformer: 'Transformer',
  disconnect: 'Disconnect',
  ups: 'UPS',
  service: 'Utility service',
  switch: 'Switching cube',
};

/** What each kind is, for the kind picker. */
export const POWER_DEVICE_HINTS: Record<PowerDeviceKind, string> = {
  transformer: 'Steps voltage down (or up), e.g. 480 V to 120/208 V, or 12.47 kV to 480 V at a building.',
  disconnect: 'A switch, fused or not, ahead of equipment or a panel.',
  ups: 'Battery backup that panels or equipment sit behind.',
  service: 'Where power comes in from the utility, with its meter.',
  switch:
    'Medium-voltage switchgear on a campus grid, such as a pad-mounted switching cube, feeding building transformers through its ways.',
};

/** Plural headings and the add button on location pages. */
export const POWER_DEVICE_PLURALS: Record<PowerDeviceKind, string> = {
  transformer: 'Transformers',
  disconnect: 'Disconnects',
  ups: 'UPS units',
  service: 'Utility services',
  switch: 'Switching cubes',
};

/** Common kVA sizes for dry-type transformers, offered as suggestions. */
export const TRANSFORMER_KVA = [15, 30, 45, 75, 112.5, 150, 225, 300, 500, 750, 1000, 1500, 2000, 2500];

export interface PowerDeviceShape {
  kind: PowerDeviceKind;
  kva: number | null;
  voltage: string;
  secondaryVoltage: string;
  amps: number | null;
  fused: boolean;
  fuseAmps: number | null;
  runtimeMinutes: number | null;
  meter?: string;
}

const kva = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, '')} kVA`;

/**
 * One line describing a device: "75 kVA · 480 V → 208 V", "60 A fused, 45 A fuses",
 * "10 kVA · 15 min", "2000 A · 277/480 V · meter 4471". Empty when nothing is known.
 */
export function deviceRating(d: PowerDeviceShape): string {
  switch (d.kind) {
    case 'transformer': {
      const step =
        d.voltage && d.secondaryVoltage ? `${d.voltage} → ${d.secondaryVoltage}` : d.voltage || d.secondaryVoltage;
      return [d.kva ? kva(d.kva) : '', step].filter(Boolean).join(' · ');
    }
    case 'disconnect': {
      const size = d.amps ? `${d.amps} A ` : '';
      const fuses = d.fused && d.fuseAmps ? `, ${d.fuseAmps} A fuses` : '';
      return `${size}${d.fused ? 'fused' : 'non-fused'}${fuses}${d.voltage ? ` · ${d.voltage}` : ''}`.trim();
    }
    case 'ups':
      return [d.kva ? kva(d.kva) : '', d.runtimeMinutes ? `${d.runtimeMinutes} min` : '', d.voltage]
        .filter(Boolean)
        .join(' · ');
    case 'service':
      return [d.amps ? `${d.amps} A` : '', d.voltage, d.meter ? `meter ${d.meter}` : ''].filter(Boolean).join(' · ');
    case 'switch':
      return [d.voltage, d.amps ? `${d.amps} A` : ''].filter(Boolean).join(' · ');
  }
}

/** The voltage a device puts out: a transformer's secondary, otherwise what comes in. */
export function outputVoltage(d: { kind: PowerDeviceKind; voltage: string; secondaryVoltage: string }): string {
  return d.kind === 'transformer' ? d.secondaryVoltage || d.voltage : d.voltage;
}

// ---- Panel nameplate --------------------------------------------------------------------

export const MOUNTINGS = ['', 'surface', 'flush', 'freestanding'] as const;
export type Mounting = (typeof MOUNTINGS)[number];
export const MOUNTING_LABELS: Record<Mounting, string> = {
  '': 'Not set',
  surface: 'Surface',
  flush: 'Flush',
  freestanding: 'Free-standing',
};

/** Enclosure types offered as suggestions; any text is accepted. */
export const ENCLOSURES = ['NEMA 1', 'NEMA 3R', 'NEMA 4', 'NEMA 4X', 'NEMA 12'];

/** Common interrupting ratings in kA. */
export const AIC_RATINGS = [10, 14, 18, 22, 25, 35, 42, 50, 65, 100];

/**
 * The nameplate details in one line: "400 A bus · 22 kA AIC · Surface · NEMA 1 · Feeder 4 #3/0
 * in 2\" EMT". The bus rating is shown only when it differs from the main.
 */
export function nameplateText(
  n: {
    aicKa: number | null;
    busAmps: number | null;
    mounting: Mounting;
    enclosure: string;
    feederWire: string;
    feederConduit: string;
  },
  mainAmps: number | null,
): string {
  const feeder = [n.feederWire, n.feederConduit].filter(Boolean).join(' in ');
  return [
    n.busAmps && n.busAmps !== mainAmps ? `${n.busAmps} A bus` : '',
    n.aicKa ? `${n.aicKa} kA AIC` : '',
    n.mounting ? MOUNTING_LABELS[n.mounting] : '',
    n.enclosure,
    feeder ? `Feeder ${feeder}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---- Transfer switch duty ---------------------------------------------------------------

export const ATS_DUTIES = ['', 'emergency', 'legally-required', 'optional'] as const;
export type AtsDuty = (typeof ATS_DUTIES)[number];
export const ATS_DUTY_LABELS: Record<AtsDuty, string> = {
  '': 'Not set',
  emergency: 'Emergency (NEC 700, life safety)',
  'legally-required': 'Legally required (NEC 701)',
  optional: 'Optional standby (NEC 702)',
};
/** Short form for badges and the map. */
export const ATS_DUTY_SHORT: Record<AtsDuty, string> = {
  '': '',
  emergency: 'Life safety',
  'legally-required': 'Legally required',
  optional: 'Optional',
};

export const ATS_TRANSITIONS = ['', 'open', 'closed', 'delayed'] as const;
export type AtsTransition = (typeof ATS_TRANSITIONS)[number];
export const ATS_TRANSITION_LABELS: Record<AtsTransition, string> = {
  '': 'Not set',
  open: 'Open transition',
  closed: 'Closed transition',
  delayed: 'Delayed transition',
};

// ---- Equipment register -----------------------------------------------------------------

/** Kinds of equipment offered as suggestions (any text is accepted), with their usual tag prefix. */
export const EQUIPMENT_KINDS = [
  'Air handler (AHU)',
  'Rooftop unit (RTU)',
  'Exhaust fan (EF)',
  'Supply fan (SF)',
  'Fan coil (FCU)',
  'Cooling tower (CT)',
  'Chiller (CH)',
  'Boiler (B)',
  'Pump (P)',
  'Unit heater (UH)',
  'Water heater (WH)',
  'Compressor',
  'Elevator',
  'Kitchen equipment',
  'Lab equipment',
  'Other',
];
