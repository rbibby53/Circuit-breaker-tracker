import { z } from 'zod';
import { LOCATION_KINDS } from './locations';
import {
  BACKUPS,
  DEVICES,
  MAIN_TYPES,
  MAX_SECTIONS,
  MAX_SPACES,
  MAX_UNITS,
  PANEL_LAYOUTS,
  PROTECTIONS,
  SLOTS,
  VERIFY_STATUSES,
} from './panel';
import { ROLES } from './roles';
import { ATS_DUTIES, ATS_TRANSITIONS, MOUNTINGS, POWER_DEVICE_KINDS } from './devices';
import { ATS_KINDS, FUELS } from './generator';

export const usernameSchema = z
  .string()
  .trim()
  .min(2, 'At least 2 characters')
  .max(64)
  .regex(/^[A-Za-z0-9._@-]+$/, 'Letters, numbers and . _ @ - only');

export const passwordSchema = z.string().min(10, 'At least 10 characters').max(200);

export const displayNameSchema = z.string().trim().min(1).max(100);

export const roleSchema = z.enum(ROLES);
export const locationKindSchema = z.enum(LOCATION_KINDS);

export const setupSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

export const totpCodeSchema = z.object({ code: z.string().trim().min(6).max(20) });

export const totpLoginSchema = z.object({
  challenge: z.string().min(1).max(100),
  code: z.string().trim().min(6).max(20),
});

export const confirmPasswordSchema = z.object({ password: z.string().min(1).max(200) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordSchema,
});

export const createLocationSchema = z.object({
  parentId: z.number().int().positive().nullable(),
  kind: locationKindSchema,
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(2000).optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).optional(),
  sortOrder: z.number().int().optional(),
});

export const grantInputSchema = z.object({
  userId: z.number().int().positive(),
  role: roleSchema,
  inviteLimit: roleSchema.nullable().default(null),
});

/** Access that members of a single sign-on group get on a location. */
export const ssoGroupMappingSchema = z.object({
  group: z.string().trim().min(1, 'Enter the group name.').max(200),
  locationId: z.number().int().positive(),
  role: roleSchema,
  inviteLimit: roleSchema.nullable().default(null),
});

export const updateGrantSchema = z.object({
  role: roleSchema,
  inviteLimit: roleSchema.nullable().default(null),
});

export const inviteInputSchema = z.object({
  role: roleSchema,
  inviteLimit: roleSchema.nullable().default(null),
  note: z.string().trim().max(200).optional(),
});

export const acceptInviteSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const updateMeSchema = z.object({
  displayName: displayNameSchema.optional(),
  /** Optional; used for Gravatar pictures and to sign in. Empty clears it. */
  email: z
    .union([z.literal(''), z.string().trim().toLowerCase().email().max(200)])
    .nullable()
    .optional(),
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export const updateUserSchema = z.object({
  displayName: displayNameSchema.optional(),
  /** An empty string clears it. */
  email: z
    .union([z.literal(''), z.string().trim().toLowerCase().email().max(200)])
    .nullable()
    .optional(),
  isAdmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

// ---- Panels ---------------------------------------------------------------------------

const amps = z.number().int().min(1).max(4000);
const optionalText = (max: number) => z.string().trim().max(max).default('');

export const sectionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  spaces: z.number().int().min(1).max(MAX_UNITS),
  throughLugs: z.boolean().default(false),
});

export const createPanelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  layout: z.enum(PANEL_LAYOUTS).default('residential'),
  /** Spaces in the first section (units on a switchboard or MCC); checked per layout. */
  spaces: z.number().int().min(1).max(MAX_UNITS),
  mainAmps: amps.nullable().default(null),
  mainType: z.enum(MAIN_TYPES).default('breaker'),
  voltage: optionalText(40),
  manufacturer: optionalText(80),
  model: optionalText(80),
  notes: optionalText(2000),
  /** The standby generator backing this panel, through a transfer switch. */
  generatorId: z.number().int().positive().nullable().default(null),
  /** Which transfer switch, e.g. "ATS-1" (1.1; transfer switches are now their own items). */
  transferSwitch: optionalText(40),
  /** The transfer switch the panel is on. Its generator backs the panel. */
  atsId: z.number().int().positive().nullable().default(null),
  /** Relay panels: the lighting control system, e.g. nLight. */
  controlSystem: optionalText(60),
  /** Nameplate: short-circuit rating (kA), bus rating, mounting, enclosure, feeder wire and conduit. */
  aicKa: z.number().int().min(1).max(500).nullable().default(null),
  busAmps: amps.nullable().default(null),
  mounting: z.enum(MOUNTINGS).default(''),
  enclosure: optionalText(40),
  feederWire: optionalText(80),
  feederConduit: optionalText(40),
  /** Sections after the first, each numbered from 1. */
  sections: z
    .array(sectionSchema)
    .max(MAX_SECTIONS - 1)
    .default([]),
});

export const servesInputSchema = z.object({
  locationId: z.number().int().positive(),
  note: optionalText(80),
});

export const breakerInputSchema = z
  .object({
    id: z.number().int().positive().optional(),
    /** Client-side key, echoed back so new breakers can be matched to their new ids. */
    clientKey: z.string().min(1).max(64),
    position: z.number().int().min(1).max(MAX_UNITS),
    /** Which section of the panel, from 1. */
    section: z.number().int().min(1).max(MAX_SECTIONS).default(1),
    slot: z.enum(SLOTS).default('full'),
    poles: z.number().int().min(1).max(3),
    /** 0 only for a surge protector without breakers of its own. */
    amps: z.number().int().min(0).max(4000),
    device: z.enum(DEVICES).default('breaker'),
    protection: z.enum(PROTECTIONS).default('standard'),
    label: optionalText(80),
    notes: optionalText(1000),
    isSpare: z.boolean().default(false),
    critical: z.boolean().default(false),
    backup: z.enum(BACKUPS).default('none'),
    serves: z.array(servesInputSchema).max(50).default([]),
    /** What it powers, e.g. Lights, Outlets, Servers. Duplicates (any case) are dropped. */
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
    /** Relays: the breaker (in another panel) whose circuit this relay switches. */
    sourceBreakerId: z.number().int().positive().nullable().default(null),
    /** Relays: what controls it, e.g. an nLight zone, channel or schedule. */
    control: optionalText(120),
    /** Connected load in volt-amps, from the panel schedule. */
    loadVa: z.number().min(0).max(100_000_000).nullable().default(null),
    /** Demand factor in percent (unset means 100%). */
    demandPct: z.number().int().min(0).max(200).nullable().default(null),
    /** Switchboards and MCCs: unit number as written, frame size, feeder wire and conduit. */
    unit: optionalText(20),
    frameAmps: z.number().int().min(1).max(10000).nullable().default(null),
    wire: optionalText(80),
    conduit: optionalText(40),
    /** MCC buckets: starter size and motor horsepower (control type goes in `control`). */
    starter: optionalText(30),
    hp: z.number().min(0).max(100000).nullable().default(null),
    /** Field check. Omit to leave an existing breaker's as it is. */
    verifyStatus: z.enum(VERIFY_STATUSES).optional(),
  })
  .refine((b) => b.amps > 0 || b.device === 'surge', {
    message: 'A breaker needs a rating of at least 1 A.',
    path: ['amps'],
  });

export const savePanelSchema = createPanelSchema.extend({
  /** The version the client last loaded. A mismatch means someone else saved first. */
  version: z.number().int().min(1),
  /** Omit to leave unchanged; null to clear. */
  fedFromBreakerId: z.number().int().positive().nullable().optional(),
  /** A transformer, disconnect, UPS or service feeding it instead of a breaker. Omit to leave unchanged. */
  fedFromDeviceId: z.number().int().positive().nullable().optional(),
  /** Which way (position) of a switching cube or other device feeds it, e.g. "Way 3". Omit to leave unchanged. */
  fedWay: z.string().trim().max(20).optional(),
  /** Omit any of these to leave them as they are. */
  generatorId: z.number().int().positive().nullable().optional(),
  transferSwitch: z.string().trim().max(40).optional(),
  atsId: z.number().int().positive().nullable().optional(),
  controlSystem: z.string().trim().max(60).optional(),
  aicKa: z.number().int().min(1).max(500).nullable().optional(),
  busAmps: amps.nullable().optional(),
  mounting: z.enum(MOUNTINGS).optional(),
  enclosure: z.string().trim().max(40).optional(),
  feederWire: z.string().trim().max(80).optional(),
  feederConduit: z.string().trim().max(40).optional(),
  breakers: z.array(breakerInputSchema).max(MAX_SPACES * 2 * MAX_SECTIONS),
  /** Omit to leave unchanged. */
  sections: z
    .array(sectionSchema)
    .max(MAX_SECTIONS - 1)
    .optional(),
});

export const duplicatePanelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** The room the copy goes in. */
  locationId: z.number().int().positive(),
});

export const sharePanelSchema = z.object({
  enabled: z.boolean(),
  /** Replace the link, so the old one (and QR codes printed with it) stops working. */
  renew: z.boolean().default(false),
});

export type CreatePanelInput = z.infer<typeof createPanelSchema>;
export type BreakerInput = z.infer<typeof breakerInputSchema>;
export type SavePanelInput = z.infer<typeof savePanelSchema>;

// ---- Generators -------------------------------------------------------------------------

export const generatorInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the generator a name.').max(80),
  kw: z.number().int().min(1).max(100000).nullable().default(null),
  fuel: z.enum(FUELS).default('diesel'),
  voltage: optionalText(40),
  manufacturer: optionalText(80),
  model: optionalText(80),
  notes: optionalText(2000),
  tankGallons: z.number().int().min(1).max(1000000).nullable().default(null),
  runtimeHours: z.number().min(0.1).max(10000).nullable().default(null),
});

export type GeneratorInput = z.infer<typeof generatorInputSchema>;

export const transferSwitchInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the transfer switch a name.').max(80),
  kind: z.enum(ATS_KINDS).default('automatic'),
  duty: z.enum(ATS_DUTIES).default(''),
  transition: z.enum(ATS_TRANSITIONS).default(''),
  priority: z.number().int().min(1).max(99).nullable().default(null),
  amps: z.number().int().min(1).max(10000).nullable().default(null),
  /** The generator on its emergency side. */
  generatorId: z.number().int().positive().nullable().default(null),
  /** Where it is. */
  locationId: z.number().int().positive(),
  notes: optionalText(2000),
});

export type TransferSwitchInput = z.infer<typeof transferSwitchInputSchema>;

// ---- Power devices ----------------------------------------------------------------------

const kva = z.number().min(0.1).max(100000).nullable().default(null);

export const powerDeviceInputSchema = z.object({
  kind: z.enum(POWER_DEVICE_KINDS),
  name: z.string().trim().min(1, 'Give it a name, e.g. T-LDP1.').max(80),
  locationId: z.number().int().positive(),
  kva,
  /** Primary (or only) voltage. */
  voltage: optionalText(40),
  /** Transformers: secondary voltage. */
  secondaryVoltage: optionalText(40),
  amps: amps.nullable().default(null),
  fused: z.boolean().default(false),
  fuseAmps: amps.nullable().default(null),
  runtimeMinutes: z.number().int().min(1).max(100000).nullable().default(null),
  meter: optionalText(60),
  utility: optionalText(80),
  manufacturer: optionalText(80),
  model: optionalText(80),
  notes: optionalText(2000),
  /** What feeds it: a breaker, or another device (one or neither). Omit to leave unchanged. */
  fedFromBreakerId: z.number().int().positive().nullable().optional(),
  fedFromDeviceId: z.number().int().positive().nullable().optional(),
  /** Which way of the device feeding it, e.g. "Way 3" of a switching cube. Omit to leave unchanged. */
  fedWay: z.string().trim().max(20).optional(),
});

export type PowerDeviceInput = z.infer<typeof powerDeviceInputSchema>;

export const equipmentInputSchema = z.object({
  tag: z.string().trim().min(1, 'Give it a tag, e.g. AHU-1.').max(40),
  kind: optionalText(60),
  description: optionalText(120),
  locationId: z.number().int().positive(),
  hp: z.number().min(0).max(100000).nullable().default(null),
  voltage: optionalText(40),
  manufacturer: optionalText(80),
  model: optionalText(80),
  notes: optionalText(2000),
  /** What feeds it: a breaker, or a disconnect or other device. Omit to leave unchanged. */
  fedFromBreakerId: z.number().int().positive().nullable().optional(),
  fedFromDeviceId: z.number().int().positive().nullable().optional(),
});

export type EquipmentInput = z.infer<typeof equipmentInputSchema>;

/** Room links suggested from breaker labels, accepted in bulk. */
export const acceptRoomLinksSchema = z.object({
  links: z
    .array(z.object({ breakerId: z.number().int().positive(), locationId: z.number().int().positive() }))
    .min(1)
    .max(2000),
});

/** Set the field check of several circuits at once (field mode, bulk edit). */
export const verifyBreakersSchema = z.object({
  breakers: z
    .array(z.object({ breakerId: z.number().int().positive(), status: z.enum(VERIFY_STATUSES) }))
    .min(1)
    .max(1000),
});

/** "This doesn't match": a report from field mode about a circuit (or the panel as a whole). */
export const reportInputSchema = z.object({
  breakerId: z.number().int().positive().nullable().default(null),
  message: z.string().trim().min(1, 'Say what does not match.').max(1000),
  /** Set by field mode so a report sent again after being offline is only recorded once. */
  clientId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  /** Also mark the circuit wrong (Editor access needed). */
  markWrong: z.boolean().default(false),
});

/** A report from a panel's public page: the circuit by its place in the panel, and an optional name. */
export const publicReportSchema = z.object({
  section: z.number().int().min(1).max(MAX_SECTIONS).nullable().default(null),
  position: z.number().int().min(1).max(MAX_UNITS).nullable().default(null),
  slot: z.enum(SLOTS).default('full'),
  message: z.string().trim().min(1, 'Say what does not match.').max(1000),
  name: optionalText(80),
  /** Left empty by people; filled in by form-filling bots. */
  website: z.string().max(200).default(''),
});

export const resolveReportSchema = z.object({
  status: z.enum(['open', 'resolved']),
  resolution: optionalText(1000),
});

export const METER_PROTOCOLS = ['', 'modbus-tcp', 'modbus-rtu', 'bacnet-ip', 'bacnet-mstp', 'pulse', 'other'] as const;
export type MeterProtocol = (typeof METER_PROTOCOLS)[number];
export const METER_PROTOCOL_LABELS: Record<MeterProtocol, string> = {
  '': 'None',
  'modbus-tcp': 'Modbus TCP',
  'modbus-rtu': 'Modbus RTU',
  'bacnet-ip': 'BACnet/IP',
  'bacnet-mstp': 'BACnet MS/TP',
  pulse: 'Pulse output',
  other: 'Other',
};

/**
 * A meter and what it measures: one breaker's circuit (a meter fed from a breaker), a whole panel
 * or switchboard at its main, or a transformer, switching cube or other device. At most one.
 */
export const meterInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give it a name, e.g. M-MSB1.').max(60),
    locationId: z.number().int().positive(),
    meterNumber: optionalText(60),
    manufacturer: optionalText(80),
    model: optionalText(80),
    serial: optionalText(60),
    /** "2000:5" */
    ctRatio: optionalText(30),
    /** "480:120" */
    ptRatio: optionalText(30),
    multiplier: z.number().positive().max(1_000_000).nullable().default(null),
    protocol: z.enum(METER_PROTOCOLS).default(''),
    /** IP address and unit ID, MS/TP MAC, BACnet device instance… */
    address: optionalText(120),
    notes: optionalText(2000),
    panelId: z.number().int().positive().nullable().default(null),
    breakerId: z.number().int().positive().nullable().default(null),
    deviceId: z.number().int().positive().nullable().default(null),
  })
  .refine((m) => [m.panelId, m.breakerId, m.deviceId].filter((x) => x !== null).length <= 1, {
    message: 'A meter measures one thing: a breaker, a panel or a device.',
    path: ['panelId'],
  });

export type MeterInput = z.infer<typeof meterInputSchema>;

/** Set the field check of a meter. */
export const verifyMeterSchema = z.object({ status: z.enum(VERIFY_STATUSES) });
