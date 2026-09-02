import { z } from 'zod';
import { AppSettingsSchema } from './settings.schema';
import { MultiloginAuthSchema } from './credentials.schema';

export const SimpleSecretOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('replace'), value: z.string().min(1, 'Replacement secret cannot be empty') }).strict(),
  z.object({ action: z.literal('clear') }).strict()
]);
export type SimpleSecretOperation = z.infer<typeof SimpleSecretOperationSchema>;

export const MultiloginSecretOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('replace'), auth: MultiloginAuthSchema }).strict(),
  z.object({ action: z.literal('clear') }).strict()
]);
export type MultiloginSecretOperation = z.infer<typeof MultiloginSecretOperationSchema>;

export const CredentialMutationSchema = z.discriminatedUnion('serviceName', [
  z.object({ serviceName: z.literal('gmail94'), operation: SimpleSecretOperationSchema }).strict(),
  z.object({ serviceName: z.literal('multilogin'), operation: MultiloginSecretOperationSchema }).strict(),
  z.object({ serviceName: z.literal('kiotproxy'), operation: SimpleSecretOperationSchema }).strict(),
  z.object({ serviceName: z.literal('dongvanfb'), operation: SimpleSecretOperationSchema }).strict(),
  z.object({ serviceName: z.literal('gologin'), operation: SimpleSecretOperationSchema }).strict()
]);
export type CredentialMutationDTO = z.infer<typeof CredentialMutationSchema>;

export const SettingsSaveRequestSchema = z.object({
  settings: AppSettingsSchema,
  credentials: z.array(CredentialMutationSchema)
}).strict();

export type SettingsSaveRequestDTO = z.infer<typeof SettingsSaveRequestSchema>;
