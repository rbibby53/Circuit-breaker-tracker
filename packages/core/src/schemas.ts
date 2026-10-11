import { z } from 'zod';
import { LOCATION_KINDS } from './locations';
import { BACKUPS, MAIN_TYPES, MAX_SPACES, MIN_SPACES, PANEL_LAYOUTS, PROTECTIONS, SLOTS } from './panel';
import { ROLES } from './roles';

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

export const createPanelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  layout: z.enum(PANEL_LAYOUTS).default('residential'),
  spaces: z.number().int().min(MIN_SPACES).max(MAX_SPACES),
  mainAmps: amps.nullable().default(null),
  mainType: z.enum(MAIN_TYPES).default('breaker'),
  voltage: optionalText(40),
  manufacturer: optionalText(80),
  model: optionalText(80),
  notes: optionalText(2000),
});

export const servesInputSchema = z.object({
  locationId: z.number().int().positive(),
  note: optionalText(80),
});

export const breakerInputSchema = z.object({
  id: z.number().int().positive().optional(),
  /** Client-side key, echoed back so new breakers can be matched to their new ids. */
  clientKey: z.string().min(1).max(64),
  position: z.number().int().min(1).max(MAX_SPACES),
  slot: z.enum(SLOTS).default('full'),
  poles: z.number().int().min(1).max(3),
  amps,
  protection: z.enum(PROTECTIONS).default('standard'),
  label: optionalText(80),
  notes: optionalText(1000),
  isSpare: z.boolean().default(false),
  critical: z.boolean().default(false),
  backup: z.enum(BACKUPS).default('none'),
  serves: z.array(servesInputSchema).max(50).default([]),
  /** What it powers, e.g. Lights, Outlets, Servers. Duplicates (any case) are dropped. */
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});

export const savePanelSchema = createPanelSchema.extend({
  /** The version the client last loaded. A mismatch means someone else saved first. */
  version: z.number().int().min(1),
  /** Omit to leave unchanged; null to clear. */
  fedFromBreakerId: z.number().int().positive().nullable().optional(),
  breakers: z.array(breakerInputSchema).max(MAX_SPACES * 2),
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
