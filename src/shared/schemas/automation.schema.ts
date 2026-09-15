import { z } from 'zod';
import { PastedCapcutSourceSchema } from './pasted-capcut.schema';
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

/**
 * Browser THẬT SỰ chạy được. Enum ở trên giữ đủ 5 giá trị để dữ liệu cũ trong
 * `app_settings` còn parse được, nhưng chỉ những giá trị ở đây mới có provider +
 * launcher.
 *
 * Audit 04/09/2026: GoLogin/GPM/Camoufox/Patchright không có một file
 * implementation nào (`find` ra 0 kết quả); `runtime/providerStack.ts` trả
 * `UnsupportedBrowserRuntime`. Mà dropdown Dashboard không khoá gì, và `start()`
 * MUA EMAIL trước khi mở browser — nên chọn nhầm là mất tiền rồi mới báo lỗi.
 * Một nguồn duy nhất để UI khoá và main chặn, không để hai chỗ tự đoán.
 */
export const IMPLEMENTED_BROWSER_RUNTIMES: readonly BrowserRuntime[] = ['multilogin'];

export function isBrowserImplemented(browser: BrowserRuntime): boolean {
  return IMPLEMENTED_BROWSER_RUNTIMES.includes(browser);
}

export const AutomationModuleEnum = z.enum(['trial', 'team', 'credit']);
export type AutomationModule = z.infer<typeof AutomationModuleEnum>;

/** Execution policy. HTTP-only never enters the browser automation engine. */
export const MissionTransportEnum = z.enum(['ui', 'http-only']);
export type MissionTransport = z.infer<typeof MissionTransportEnum>;

export const RolloutStageSchema = z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]);
export type RolloutStage = z.infer<typeof RolloutStageSchema>;

export const EmailSourceConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('manual'),
    entries: z.array(z.string()).default([])
  }).strict(),
  z.object({
    mode: z.literal('api'),
    provider: EmailApiProviderEnum,
    service: z.string().min(1).optional()
  }).strict(),
  // Catch-all domain the operator owns: addresses are generated, not bought.
  z.object({
    mode: z.literal('custom')
  }).strict(),
  z.object({
    mode: z.literal('existing'),
    accountIds: z.array(z.string().min(1)).min(1).max(20).refine(
      (items) => new Set(items).size === items.length,
      { message: 'Danh sách accountIds không được chứa giá trị trùng' }
    )
  }).strict(),
  PastedCapcutSourceSchema
]);
export type EmailSourceConfig = z.infer<typeof EmailSourceConfigSchema>;

/**
 * Vùng KiotProxy gửi kèm khi xin proxy mới. KiotProxy có 4 lựa chọn
 * (`bac`/`trung`/`nam`/`random`) nhưng `random` KHÔNG phải giá trị gửi đi: nó
 * nghĩa là không gửi khoá `region` và để KiotProxy tự chọn — đúng đường đang chạy
 * được hôm nay. Vì vậy contract của một lượt chạy chỉ nhận ba vùng thật.
 */
export const ProxyRegionEnum = z.enum(['bac', 'trung', 'nam']);
export type ProxyRegion = z.infer<typeof ProxyRegionEnum>;

/** Lựa chọn trên Dashboard, có thêm `random` = không chỉ định vùng. */
export const ProxyRegionChoiceEnum = z.enum(['bac', 'trung', 'nam', 'random']);
export type ProxyRegionChoice = z.infer<typeof ProxyRegionChoiceEnum>;

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
    /** Chỉ có khi người dùng chọn một vùng cụ thể; `random` không sinh khoá này. */
    region: ProxyRegionEnum.optional()
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
  }).strict(),
  z.object({
    mode: z.literal('per-account')
  }).strict()
]);
export type PasswordConfig = z.infer<typeof PasswordConfigSchema>;

export const AutomationRunConfigSchema = z.object({
  missionTransport: MissionTransportEnum.optional(),
  threadCount: z.number().int().min(1).max(200),
  /** Account acquisition cap; billable dispatches have a separate explicit budget. */
  mailLimit: z.number().int().min(0).max(200).optional(),
  maxBillablePurchases: z.number().int().min(0).max(200).optional(),
  rolloutStage: RolloutStageSchema.optional(),
  approvedMailboxes: z.number().int().min(0).max(200).optional(),
  stopAfter: z.number().int().min(0).max(200).optional(),
  browser: BrowserRuntimeEnum,
  headless: z.boolean(),
  retryCount: z.number().int().min(0).max(10),
  stepDelayMinMs: z.number().int().min(0).max(600_000),
  stepDelayMaxMs: z.number().int().min(0).max(600_000),
  typeDelayMinMs: z.number().int().min(0).max(60_000),
  typeDelayMaxMs: z.number().int().min(0).max(60_000),
  module: AutomationModuleEnum,
  /**
   * Bỏ qua account không có ưu đãi Pro ≥ 7 ngày thay vì vẫn chạy 12 nhiệm vụ.
   * Mặc định của Dashboard là `false` (fail-open): cổng trial đọc bằng selector,
   * mà lượt 02/09/2026 chứng minh fail-closed sẽ âm thầm loại cả 21 account khi
   * selector vỡ — trong app thì mỗi account bỏ qua là một hộp thư đã trả tiền.
   */
  skipWithoutTrial: z.boolean(),
  emailSource: EmailSourceConfigSchema,
  emailRetryIntervalSeconds: z.number().int().min(5).max(300).default(15).optional(),
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
  })
  .superRefine((config, ctx) => {
    const reject = (field: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [field], message });
    };
    const pasted = config.emailSource.mode === 'pasted-existing';
    if (pasted !== (config.password.mode === 'per-account')) {
      reject('password', 'Nguồn dán tài khoản có sẵn phải dùng mật khẩu theo từng dòng.');
    }
    if (pasted) {
      if (config.missionTransport === 'http-only') {
        reject('missionTransport', 'Nguồn dán tài khoản có sẵn không hỗ trợ HTTP-only.');
      }
      if (config.approvedMailboxes !== undefined) {
        reject('approvedMailboxes', 'Nguồn dán tài khoản có sẵn không nhận approvedMailboxes.');
      }
      if (config.stopAfter !== undefined) {
        reject('stopAfter', 'Nguồn dán tài khoản có sẵn không nhận stopAfter.');
      }
    }
    if (config.emailSource.mode === 'api') {
      if (config.maxBillablePurchases === undefined) {
        reject('maxBillablePurchases', 'Phải chỉ định giới hạn mua hộp thư.');
      }
    } else if ((config.maxBillablePurchases ?? 0) !== 0) {
      reject('maxBillablePurchases', 'Nguồn không mua hộp thư phải có ngân sách bằng 0.');
    }
    if (config.rolloutStage === undefined) return;
    if (config.headless || (config.missionTransport ?? 'ui') !== 'ui' || config.module !== 'credit') {
      reject('rolloutStage', 'Rollout chỉ hỗ trợ headed UI credit.');
    }
    if (config.emailSource.mode === 'api') {
      for (const field of ['threadCount', 'mailLimit', 'approvedMailboxes', 'stopAfter', 'maxBillablePurchases'] as const) {
        if (config[field] !== config.rolloutStage) reject(field, 'Giới hạn phải bằng rollout stage.');
      }
    } else if (config.emailSource.mode === 'existing') {
      if (config.rolloutStage !== 3 || config.threadCount !== 3 || config.emailSource.accountIds.length !== 3) {
        reject('rolloutStage', 'Resume rollout yêu cầu đúng ba tài khoản và ba luồng.');
      }
      if ((config.mailLimit ?? 0) !== 0 || config.approvedMailboxes !== undefined || config.stopAfter !== undefined) {
        reject('emailSource', 'Resume không nhận giới hạn mua hộp thư.');
      }
    } else {
      reject('emailSource', 'Nguồn không hỗ trợ rollout.');
    }
  });

export type AutomationRunConfigDTO = z.infer<typeof AutomationRunConfigSchema>;

export const RunHealthRequestSchema = z.object({
  threadCount: z.union([z.literal(3), z.literal(10)]),
  rolloutStage: z.union([z.literal(3), z.literal(10)]),
  headless: z.literal(false)
}).strict().refine((request) => request.threadCount === request.rolloutStage, {
  message: 'Health stage phải bằng số luồng.'
});
export type RunHealthRequestDTO = z.infer<typeof RunHealthRequestSchema>;

export const RunHealthResponseSchema = z.object({
  runId: z.string().min(1), artifactBasename: z.string().min(1),
  attempted: z.number().int().min(0), healthy: z.number().int().min(0),
  stopped: z.number().int().min(0), cleanupFailures: z.number().int().min(0)
}).strict();
export type RunHealthResponseDTO = z.infer<typeof RunHealthResponseSchema>;

export const AutomationRunStateEnum = z.enum([
  'idle',
  'preparing',
  'running',
  'stopping',
  'completed',
  'stopped',
  'blocked',
  'failed'
]);
export type AutomationRunState = z.infer<typeof AutomationRunStateEnum>;

export const AutomationTerminalCodeEnum = z.enum([
  'MAIL_LIMIT_REACHED',
  'MANUAL_EXHAUSTED',
  'USER_STOP',
  'APP_SHUTDOWN',
  'INSUFFICIENT_FUNDS',
  'PROVIDER_AUTH_REQUIRED',
  'PROVIDER_CONFIG_ERROR',
  'PROVIDER_RETRY_EXHAUSTED',
  'PURCHASE_OUTCOME_UNKNOWN',
  'BILLABLE_PURCHASE_LIMIT_REACHED',
  'HEALTH_CHECK_COMPLETED',
  'PROXY_CAPACITY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'TASK_CHECKPOINT_PERSISTENCE_FAILED',
  'RESOURCE_CLEANUP_FAILED'
]);
export type AutomationTerminalCode = z.infer<typeof AutomationTerminalCodeEnum>;

export const AutomationTerminalReasonSchema = z.object({
  code: AutomationTerminalCodeEnum,
  provider: z.string().min(1).optional(),
  details: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ).optional()
}).strict();
export type AutomationTerminalReasonDTO = z.infer<typeof AutomationTerminalReasonSchema>;

export const AutomationRunCountersSchema = z.object({
  workerTarget: z.number().int().min(0),
  workersActive: z.number().int().min(0),
  accountsAccepted: z.number().int().min(0),
  accountsCompleted: z.number().int().min(0),
  accountsFailed: z.number().int().min(0),
  accountsStopped: z.number().int().min(0)
}).strict();
export type AutomationRunCountersDTO = z.infer<typeof AutomationRunCountersSchema>;

export const RunningThreadInfoSchema = z.object({
  accountId: z.string().min(1),
  email: z.string().min(1),
  /** Optional for backward compatibility; HTTP-only threads have no profile. */
  profileId: z.string().min(1).optional(),
  transport: MissionTransportEnum.optional()
}).strict();
export type RunningThreadInfoDTO = z.infer<typeof RunningThreadInfoSchema>;

export const AutomationRunProgressSchema = z.object({
  runId: z.string().min(1),
  state: AutomationRunStateEnum,
  ...AutomationRunCountersSchema.shape,
  message: z.string(),
  terminalReason: AutomationTerminalReasonSchema.optional()
}).strict();
export type AutomationRunProgressDTO = z.infer<typeof AutomationRunProgressSchema>;
