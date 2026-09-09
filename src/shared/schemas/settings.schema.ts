import { z } from 'zod';
import { CAPCUT_OTP_SERVICE } from './provider.schema';
import { ProxyRegionChoiceEnum } from './automation.schema';

export const ExportFieldEnum = z.enum([
  'email',
  'passwordCapcut',
  'emailData',
  'credit',
  'subscription',
  'createdAt'
]);
export type ExportField = z.infer<typeof ExportFieldEnum>;

export const GeneralSettingsSchema = z.object({
  theme: z.enum(['dark', 'light']).default('dark'),
  language: z.enum(['vi', 'en']).default('vi'),
  autoSaveConfig: z.boolean().default(true),
  sessionRestore: z.boolean().default(true)
}).strict();
export type GeneralSettingsDTO = z.infer<typeof GeneralSettingsSchema>;

export const BrowserSettingsSchema = z.object({
  provider: z.enum(['gpm', 'multilogin', 'gologin', 'camoufox', 'patchright']).default('gpm'),
  gpm: z.object({
    port: z.number().int().min(1).max(65535).default(19995)
  }).strict().default({ port: 19995 }),
  multilogin: z.object({
    port: z.number().int().min(1).max(65535).default(35000),
    /**
     * Đường mở quick profile cho Multilogin:
     *   `xcli`   — CLI của Multilogin, đường mà engine automation đã chạy thật
     *              13 account ngày 02/09/2026; nó cũng là đường bơm được
     *              `Preferences` trước khi Chrome mở (tắt dialog "Save password").
     *   `api-v3` — REST `/api/v3/profile/quick`, đã live test 01/09/2026.
     * Chi tiết và bảng so sánh: `docs/MERGE-PLAN.md`.
     */
    launcher: z.enum(['xcli', 'api-v3']).default('api-v3')
  }).strict().default({ port: 35000, launcher: 'api-v3' }),
  gologin: z.object({
    autoPort: z.boolean().default(true)
  }).strict().default({ autoPort: true }),
  camoufox: z.object({
    headless: z.boolean().default(false)
  }).strict().default({ headless: false }),
  patchright: z.object({
    headless: z.boolean().default(false)
  }).strict().default({ headless: false })
}).strict();
export type BrowserSettingsDTO = z.infer<typeof BrowserSettingsSchema>;

export const LogSettingsSchema = z.object({
  retention: z.enum(['7', '30', '90', 'never']).default('30')
}).strict().default({ retention: '30' });
export type LogSettingsDTO = z.infer<typeof LogSettingsSchema>;

export const ExportSettingsSchema = z.object({
  defaultFormat: z.enum(['xlsx', 'csv', 'txt']).default('xlsx'),
  checkedFields: z.array(ExportFieldEnum).default([
    'email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'
  ]),
  availableFields: z.array(ExportFieldEnum).default([
    'email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'
  ])
}).strict();
export type ExportSettingsDTO = z.infer<typeof ExportSettingsSchema>;

/**
 * Persisted automation knobs. Deliberately excludes the three free-text fields
 * that carry secrets — pasted email|password lines, pasted proxy credentials and
 * the custom CapCut password — because app_settings is plaintext JSON
 * (AGENTS.md §13). Those stay in memory for the session only.
 */
export const AutomationConfigSettingsSchema = z.object({
  threadCount: z.number().int().min(1).max(200).default(10),
  mailLimit: z.number().int().min(0).max(200).optional(),
  maxBillablePurchases: z.number().int().min(0).max(200).default(0),
  browser: z.enum(['multilogin', 'gologin', 'gpm', 'camoufox', 'patchright']).default('multilogin'),
  headless: z.boolean().default(false),
  retryCount: z.number().int().min(0).max(10).default(3),
  stepDelayMinMs: z.number().int().min(0).max(600_000).default(500),
  stepDelayMaxMs: z.number().int().min(0).max(600_000).default(2000),
  typeDelayMinMs: z.number().int().min(0).max(60_000).default(50),
  typeDelayMaxMs: z.number().int().min(0).max(60_000).default(150),
  // Chỉ `credit` có engine thật (đăng ký/đăng nhập + 12 nhiệm vụ free credits).
  // `trial`/`team` giữ trong enum để dữ liệu cũ còn parse được, nhưng UI khoá lại
  // và main process từ chối chạy — xem AGENTS.md §30.
  module: z.enum(['trial', 'team', 'credit']).default('credit'),
  /** Bỏ qua account không có trial Pro ≥ 7 ngày. Xem `AutomationRunConfigSchema`. */
  skipWithoutTrial: z.boolean().default(false),
  proxyMode: z.enum(['direct', 'proxykey']).default('direct'),
  /**
   * Vùng KiotProxy cho chế độ proxy key. `random` = không chỉ định vùng. Proxy dán
   * tay (`http://ip:port`) không có vùng nên khoá này không ảnh hưởng.
   */
  proxyRegion: ProxyRegionChoiceEnum.default('random'),
  emailSourceMode: z.enum(['manual', 'api', 'custom']).default('manual'),
  emailApiProvider: z.enum(['gmail94', 'dongvanfb']).default('gmail94'),
  /**
   * Slug dịch vụ gmail94. KHÔNG còn là nút điều chỉnh: Dashboard luôn ghi
   * `CAPCUT_OTP_SERVICE` (xem `automationConfig.toPersistedConfig`). Khoá vẫn ở
   * đây vì schema là `.strict()` — bỏ khoá thì row đã lưu trên máy người dùng
   * parse thất bại và mất sạch nút điều chỉnh.
   */
  otpService: z.string().min(1).max(64).default(CAPCUT_OTP_SERVICE),
  passwordMode: z.enum(['custom', 'random']).default('random'),
  passwordLength: z.number().int().min(6).max(64).default(12),
  includeUppercase: z.boolean().default(true),
  includeNumbers: z.boolean().default(true),
  includeSpecial: z.boolean().default(false)
}).strict().default({
  threadCount: 10,
  maxBillablePurchases: 0,
  browser: 'multilogin',
  headless: false,
  retryCount: 3,
  stepDelayMinMs: 500,
  stepDelayMaxMs: 2000,
  typeDelayMinMs: 50,
  typeDelayMaxMs: 150,
  module: 'credit',
  skipWithoutTrial: false,
  proxyMode: 'direct',
  proxyRegion: 'random',
  emailSourceMode: 'manual',
  emailApiProvider: 'gmail94',
  otpService: CAPCUT_OTP_SERVICE,
  passwordMode: 'random',
  passwordLength: 12,
  includeUppercase: true,
  includeNumbers: true,
  includeSpecial: false
});
export type AutomationConfigSettingsDTO = z.infer<typeof AutomationConfigSettingsSchema>;

/**
 * Catch-all domain the operator owns. Addresses are generated locally and read
 * back over HTTP, so nothing here is a secret and it lives in plain settings.
 */
export const CustomEmailSettingsSchema = z.object({
  domain: z.string().min(3).max(253).default('oldevlk.com'),
  apiBaseUrl: z.string().url().default('http://103.116.38.76:3000'),
  senderFilter: z.string().min(1).max(64).default('capcut')
}).strict().default({
  domain: 'oldevlk.com',
  apiBaseUrl: 'http://103.116.38.76:3000',
  senderFilter: 'capcut'
});
export type CustomEmailSettingsDTO = z.infer<typeof CustomEmailSettingsSchema>;

export const AppSettingsSchema = z.object({
  general: GeneralSettingsSchema,
  browser: BrowserSettingsSchema,
  logs: LogSettingsSchema,
  automation: AutomationConfigSettingsSchema,
  customEmail: CustomEmailSettingsSchema,
  exportConfig: ExportSettingsSchema
}).strict();

export type AppSettingsDTO = z.infer<typeof AppSettingsSchema>;
