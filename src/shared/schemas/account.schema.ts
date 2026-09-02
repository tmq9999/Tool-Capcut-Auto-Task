import { z } from 'zod';

export const AccountStatusEnum = z.enum([
  'active', 'processing', 'error', 'disabled', 'waiting', 'done'
]);
export type AccountStatus = z.infer<typeof AccountStatusEnum>;

export const SecretOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('replace'), value: z.string().min(1) }).strict(),
  z.object({ action: z.literal('clear') }).strict()
]);
export type SecretOperation = z.infer<typeof SecretOperationSchema>;

export const AccountCreateInputSchema = z.object({
  email: z.string().email(),
  emailProvider: z.string().min(1),
  emailPassword: z.string().optional(),
  passwordCapcut: z.string().optional(),
  emailData: z.string().optional(),
  credit: z.number().int().min(0).default(0),
  subscription: z.string().optional(),
  status: AccountStatusEnum.default('active'),
  automationStep: z.string().optional(),
  proxy: z.string().optional(),
  browserProvider: z.string().optional(),
  browserProfileId: z.string().optional(),
  notes: z.string().optional()
}).strict();

export type AccountCreateInputDTO = z.infer<typeof AccountCreateInputSchema>;

export const AccountUpdateInputSchema = z.object({
  email: z.string().email().optional(),
  emailProvider: z.string().min(1).optional(),
  emailPasswordOp: SecretOperationSchema.optional(),
  passwordCapcutOp: SecretOperationSchema.optional(),
  emailDataOp: SecretOperationSchema.optional(),
  credit: z.number().int().min(0).optional(),
  subscription: z.string().nullable().optional(),
  status: AccountStatusEnum.optional(),
  automationStep: z.string().nullable().optional(),
  proxy: z.string().nullable().optional(),
  browserProvider: z.string().nullable().optional(),
  browserProfileId: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
}).strict();

export type AccountUpdateInputDTO = z.infer<typeof AccountUpdateInputSchema>;

export const AccountFilterSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  emailProvider: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50)
}).strict();

export type AccountFilterDTO = z.infer<typeof AccountFilterSchema>;

export const AccountListItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailProvider: z.string(),
  hasEmailPassword: z.boolean(),
  hasPasswordCapcut: z.boolean(),
  hasEmailData: z.boolean(),
  credit: z.number(),
  subscription: z.string().nullable(),
  status: AccountStatusEnum,
  automationStep: z.string().nullable(),
  proxy: z.string().nullable(),
  browserProvider: z.string().nullable(),
  browserProfileId: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();

export type AccountListItemDTO = z.infer<typeof AccountListItemSchema>;
