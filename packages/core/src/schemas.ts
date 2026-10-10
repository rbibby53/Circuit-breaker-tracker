import { z } from 'zod';
import { LOCATION_KINDS } from './locations';
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

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export const updateUserSchema = z.object({
  displayName: displayNameSchema.optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  isAdmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
