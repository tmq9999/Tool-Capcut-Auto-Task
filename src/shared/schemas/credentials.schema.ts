import { z } from 'zod';

export const MultiloginAuthSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('token'),
    automationToken: z.string().min(1, 'Automation token is required')
  }).strict(),
  z.object({
    mode: z.literal('credentials'),
    email: z.string().email('Valid email required'),
    password: z.string().min(1, 'Password is required')
  }).strict()
]);
export type MultiloginAuth = z.infer<typeof MultiloginAuthSchema>;

export const SaveCredentialInputSchema = z.discriminatedUnion('serviceName', [
  z.object({ serviceName: z.literal('gmail94'), apiKey: z.string().min(1) }).strict(),
  z.object({ serviceName: z.literal('multilogin'), auth: MultiloginAuthSchema }).strict(),
  z.object({ serviceName: z.literal('kiotproxy'), apiToken: z.string().min(1) }).strict(),
  z.object({ serviceName: z.literal('dongvanfb'), apiKey: z.string().min(1) }).strict(),
  z.object({ serviceName: z.literal('gologin'), apiToken: z.string().min(1) }).strict()
]);

export type SaveCredentialInputDTO = z.infer<typeof SaveCredentialInputSchema>;
