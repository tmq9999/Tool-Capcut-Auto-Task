import { z } from 'zod';
import { EmailApiProviderEnum } from './provider.schema';

/**
 * Connectivity-check duration for a run. Automation scripts do not exist yet,
 * so a run starts the configured number of browsers, holds them for this long,
 * then stops them.
 */
export const DEFAULT_TEST_RUN_DURATION_MS = 10_000;

export const BrowserRuntimeEnum = z.enum([
  'multilogin', 'gologin', 'gpm', 'camoufox', 'patchright'
]);
export type BrowserRuntime = z.infer<typeof BrowserRuntimeEnum>;

export const AutomationModuleEnum = z.enum(['trial', 'team', 'credit']);
export type AutomationModule = z.infer<typeof AutomationModuleEnum>;

export const EmailSourceConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('manual'),
    entries: z.array(z.string().min(1)).default([])
  }).strict(),
  z.object({
    mode: z.literal('api'),
    provider: EmailApiProviderEnum,
    service: z.string().min(1).optional()
  }).strict(),
  // Catch-all domain the operator owns: addresses are generated, not bought.
  z.object({
    mode: z.literal('custom')
  }).strict()
]);
export type EmailSourceConfig = z.infer<typeof EmailSourceConfigSchema>;

export const ProxyConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('direct'),
    entries: z.array(z.string().min(1)).default([])
  }).strict(),
  z.object({
    mode: z.literal('proxykey'),
    /**
     * Exactly which proxy keys this run may use. Empty means "every key on the
     * account", so an operator can reserve the rest for another tool.
     */
    keys: z.array(z.string().min(1)).default([]),
    region: z.string().optional()
  }).strict()
]);
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

export const PasswordConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('custom'),
    value: z.string().min(1),
    length: z.number().int().min(6).max(64),
    uppercase: z.boolean(),
    numbers: z.boolean(),
    special: z.boolean()
  }).strict(),
  z.object({
    mode: z.literal('random'),
    length: z.number().int().min(6).max(64),
    uppercase: z.boolean(),
    numbers: z.boolean(),
    special: z.boolean()
  }).strict()
]);
export type PasswordConfig = z.infer<typeof PasswordConfigSchema>;

export const AutomationRunConfigSchema = z.object({
  threadCount: z.number().int().min(1).max(200),
  browser: BrowserRuntimeEnum,
  headless: z.boolean(),
  retryCount: z.number().int().min(0).max(10),
  stepDelayMinMs: z.number().int().min(0).max(600_000),
  stepDelayMaxMs: z.number().int().min(0).max(600_000),
  typeDelayMinMs: z.number().int().min(0).max(60_000),
  typeDelayMaxMs: z.number().int().min(0).max(60_000),
  module: AutomationModuleEnum,
  emailSource: EmailSourceConfigSchema,
  proxy: ProxyConfigSchema,
  password: PasswordConfigSchema,
  testDurationMs: z.number().int().min(0).max(600_000).default(DEFAULT_TEST_RUN_DURATION_MS)
}).strict()
  .refine((c) => c.stepDelayMinMs <= c.stepDelayMaxMs, {
    message: 'Delay thao tác: giá trị Min phải nhỏ hơn hoặc bằng Max',
    path: ['stepDelayMaxMs']
  })
  .refine((c) => c.typeDelayMinMs <= c.typeDelayMaxMs, {
    message: 'Delay gõ phím: giá trị Min phải nhỏ hơn hoặc bằng Max',
    path: ['typeDelayMaxMs']
  });

export type AutomationRunConfigDTO = z.infer<typeof AutomationRunConfigSchema>;

export const AutomationRunStateEnum = z.enum([
  'idle', 'preparing', 'running', 'stopping', 'stopped', 'failed'
]);
export type AutomationRunState = z.infer<typeof AutomationRunStateEnum>;

export const RunningThreadInfoSchema = z.object({
  accountId: z.string().min(1),
  email: z.string().min(1),
  profileId: z.string().min(1)
}).strict();
export type RunningThreadInfoDTO = z.infer<typeof RunningThreadInfoSchema>;

export const AutomationRunProgressSchema = z.object({
  runId: z.string().min(1),
  state: AutomationRunStateEnum,
  threadTotal: z.number().int().min(0),
  threadsStarted: z.number().int().min(0),
  threadsStopped: z.number().int().min(0),
  threadsFailed: z.number().int().min(0),
  message: z.string()
}).strict();
export type AutomationRunProgressDTO = z.infer<typeof AutomationRunProgressSchema>;
