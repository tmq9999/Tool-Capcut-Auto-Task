import {
  AutomationRunConfigSchema,
  DEFAULT_TEST_RUN_DURATION_MS,
  type AutomationModule,
  type AutomationRunConfigDTO,
  type BrowserRuntime,
  type ProxyRegionChoice
} from '../../../shared/schemas/automation.schema';
import { CAPCUT_OTP_SERVICE, type EmailApiProvider } from '../../../shared/schemas/provider.schema';
import {
  AutomationConfigSettingsSchema,
  type AutomationConfigSettingsDTO
} from '../../../shared/schemas/settings.schema';
import {
  parsePastedCapcutText,
  formatPastedCapcutIssues
} from '../../../shared/schemas/pasted-capcut.schema';

/**
 * UI-shaped automation configuration. The Dashboard panels edit this directly;
 * toRunConfig turns it into the validated contract sent over IPC.
 */
export interface AutomationConfigState {
  threadCount: number;
  mailLimit: number;
  maxBillablePurchases: number;
  browser: BrowserRuntime;
  headless: boolean;
  retryCount: number;
  stepDelayMinMs: number;
  stepDelayMaxMs: number;
  typeDelayMinMs: number;
  typeDelayMaxMs: number;
  module: AutomationModule;
  /** Bỏ qua account không có trial Pro ≥ 7 ngày (mặc định: vẫn chạy). */
  skipWithoutTrial: boolean;
  proxyMode: 'direct' | 'proxykey';
  proxyList: string;
  /** One KiotProxy key per line. Empty means every key on the account. */
  proxyKeyList: string;
  /** Vùng KiotProxy; `random` = không chỉ định. Chỉ dùng ở chế độ proxy key. */
  proxyRegion: ProxyRegionChoice;
  emailSourceMode: 'manual' | 'api' | 'custom';
  emailApiProvider: EmailApiProvider;
  emailRetryIntervalSeconds: number;
  emailList: string;
  passwordMode: 'custom' | 'random';
  customPassword: string;
  passwordLength: number;
  includeUppercase: boolean;
  includeNumbers: boolean;
  includeSpecial: boolean;
}

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfigState = {
  threadCount: 10,
  mailLimit: 0,
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
  proxyList: '',
  proxyKeyList: '',
  proxyRegion: 'random',
  emailSourceMode: 'manual',
  emailApiProvider: 'gmail94',
  emailRetryIntervalSeconds: 15,
  emailList: '',
  passwordMode: 'random',
  customPassword: '',
  passwordLength: 12,
  includeUppercase: true,
  includeNumbers: true,
  includeSpecial: false
};

/**
 * Kẹp giá trị ô nhập số về đúng dải mà schema chấp nhận.
 *
 * Đo được 04/09/2026: `<Input type="number">` không có min/max và không kẹp gì.
 * Xoá trắng ô "Luồng" → `Number('') === 0` → `threadCount: 0` vi phạm `.min(1)`
 * của `AutomationConfigSettingsSchema`. Autosave bật mặc định nên nó gửi
 * `settings.save` ngay và nhận VALIDATION_ERROR ⇒ cấu hình lặng lẽ không được
 * lưu. Đường `run.start` KHÔNG dính vì `toRunConfig` tự validate trước — chỉ
 * đường autosave thiếu bước đó.
 *
 * Kẹp ngay tại ô nhập là chỗ rẻ nhất: state Dashboard không bao giờ mang giá trị
 * mà schema từ chối.
 *
 * @param current giá trị đang dùng, để lùi về khi người dùng gõ chữ không phải số
 */
export function clampConfigNumber(
  raw: string,
  min: number,
  max: number,
  current: number
): number {
  if (raw.trim().length === 0) return min;

  const value = Number(raw);
  if (!Number.isFinite(value)) return current;

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export type RunConfigResult =
  | { ok: true; config: AutomationRunConfigDTO }
  | { ok: false; message: string };

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Builds the validated run contract. Returns a user-facing Vietnamese message
 * instead of throwing, so the Dashboard can show it inline.
 */
export function toRunConfig(state: AutomationConfigState): RunConfigResult {
  let parsedPastedEntries: Array<{ email: string; capcutPassword: string }> = [];

  if (state.emailSourceMode === 'manual') {
    if (state.emailList.trim().length === 0) {
      return {
        ok: false,
        message:
          'Hãy nhập danh sách tài khoản theo định dạng email|mật khẩu CapCut, ' +
          'hoặc chuyển sang chế độ API.'
      };
    }

    const parsed = parsePastedCapcutText(state.emailList);
    if (parsed.issues.length > 0) {
      return {
        ok: false,
        message: formatPastedCapcutIssues(parsed.issues)
      };
    }

    if (parsed.entries.length === 0) {
      return {
        ok: false,
        message:
          'Hãy nhập danh sách tài khoản theo định dạng email|mật khẩu CapCut, ' +
          'hoặc chuyển sang chế độ API.'
      };
    }

    parsedPastedEntries = parsed.entries;
  }

  if (state.emailSourceMode === 'custom') {
    return {
      ok: false,
      message: 'Chức năng Mail Domain (Custom) hiện đang tạm khóa. Vui lòng chọn API hoặc Danh sách thủ công.'
    };
  }

  if (
    state.emailSourceMode !== 'manual' &&
    state.passwordMode === 'custom' &&
    state.customPassword.trim().length === 0
  ) {
    return { ok: false, message: 'Hãy nhập mật khẩu CapCut khi dùng chế độ tự đặt mật khẩu.' };
  }

  const candidate = {
    threadCount: state.threadCount,
    mailLimit: state.mailLimit,
    maxBillablePurchases: state.emailSourceMode === 'api' ? state.maxBillablePurchases : 0,
    browser: state.browser,
    headless: state.headless,
    retryCount: state.retryCount,
    stepDelayMinMs: state.stepDelayMinMs,
    stepDelayMaxMs: state.stepDelayMaxMs,
    typeDelayMinMs: state.typeDelayMinMs,
    typeDelayMaxMs: state.typeDelayMaxMs,
    module: state.module,
    skipWithoutTrial: state.skipWithoutTrial,
    emailRetryIntervalSeconds: state.emailRetryIntervalSeconds,
    emailSource: state.emailSourceMode === 'api'
      // Không gửi `service`: slug OTP là hằng của site (`CAPCUT_OTP_SERVICE`) và
      // do main process quyết, nên giá trị cũ trong app_settings không theo vào.
      ? { mode: 'api' as const, provider: state.emailApiProvider }
      : { mode: 'pasted-existing' as const, entries: parsedPastedEntries },
    /**
     * Vùng CHỈ đi kèm chế độ proxy key, và `random` thì không sinh khoá `region`
     * (để KiotProxy tự chọn — đúng đường đang chạy được). Proxy dán tay
     * `http://ip:port` không có vùng nên nhánh `direct` không mang khoá này.
     */
    proxy: state.proxyMode === 'proxykey'
      ? {
          mode: 'proxykey' as const,
          keys: splitLines(state.proxyKeyList),
          ...(state.proxyRegion === 'random' ? {} : { region: state.proxyRegion })
        }
      : { mode: 'direct' as const, entries: splitLines(state.proxyList) },
    password: state.emailSourceMode === 'manual'
      ? { mode: 'per-account' as const }
      : state.passwordMode === 'custom'
        ? {
            mode: 'custom' as const,
            value: state.customPassword.trim(),
            length: state.passwordLength,
            uppercase: state.includeUppercase,
            numbers: state.includeNumbers,
            special: state.includeSpecial
          }
        : {
            mode: 'random' as const,
            length: state.passwordLength,
            uppercase: state.includeUppercase,
            numbers: state.includeNumbers,
            special: state.includeSpecial
          },
    testDurationMs: DEFAULT_TEST_RUN_DURATION_MS
  };

  const parsed = AutomationRunConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? 'Cấu hình chạy không hợp lệ.' };
  }

  return { ok: true, config: parsed.data };
}

/**
 * The three fields that hold secrets and therefore never reach app_settings:
 * pasted email|password lines, pasted proxy credentials, and the custom CapCut
 * password. Everything else is a knob and is safe to persist.
 */
type SecretField = 'emailList' | 'proxyList' | 'proxyKeyList' | 'customPassword';

/** Strips the secret-bearing fields, leaving the knobs to persist. */
export function toPersistedConfig(state: AutomationConfigState): AutomationConfigSettingsDTO {
  return {
    threadCount: state.threadCount,
    ...(state.mailLimit > 0 ? { mailLimit: state.mailLimit } : {}),
    maxBillablePurchases: state.maxBillablePurchases,
    browser: state.browser,
    headless: state.headless,
    retryCount: state.retryCount,
    stepDelayMinMs: state.stepDelayMinMs,
    stepDelayMaxMs: state.stepDelayMaxMs,
    typeDelayMinMs: state.typeDelayMinMs,
    typeDelayMaxMs: state.typeDelayMaxMs,
    module: state.module,
    skipWithoutTrial: state.skipWithoutTrial,
    proxyMode: state.proxyMode,
    proxyRegion: state.proxyRegion,
    proxyList: state.proxyList,
    proxyKeyList: state.proxyKeyList,
    emailSourceMode: state.emailSourceMode,
    emailApiProvider: state.emailApiProvider,
    emailRetryIntervalSeconds: state.emailRetryIntervalSeconds,
    /**
     * Khoá `otpService` còn trong `AutomationConfigSettingsSchema` vì schema là
     * `.strict()`: bỏ khoá đi thì row đã lưu trên máy người dùng parse thất bại
     * và MẤT toàn bộ nút điều chỉnh. Nên khoá được giữ nhưng luôn ghi hằng —
     * giá trị `facebook` sai chết ở lần lưu kế tiếp.
     */
    otpService: CAPCUT_OTP_SERVICE,
    passwordMode: state.passwordMode,
    passwordLength: state.passwordLength,
    includeUppercase: state.includeUppercase,
    includeNumbers: state.includeNumbers,
    includeSpecial: state.includeSpecial
  };
}

/**
 * Rebuilds the editable config from what was persisted. Secret fields come from
 * `keep` (what the user is currently typing) and default to empty, because they
 * were never stored.
 */
export function fromPersistedConfig(
  persisted: unknown,
  keep?: Partial<Pick<AutomationConfigState, SecretField>>
): AutomationConfigState {
  const parsed = AutomationConfigSettingsSchema.safeParse(persisted);
  const stored = parsed.success ? parsed.data : toPersistedConfig(DEFAULT_AUTOMATION_CONFIG);
  // `otpService` không còn là nút điều chỉnh (xem `toPersistedConfig`), nên giá
  // trị đọc từ đĩa bị bỏ ở đây thay vì lọt vào state của Dashboard.
  const { otpService: _legacyOtpService, ...knobs } = stored;

  const emailSourceMode =
    knobs.emailSourceMode === 'custom'
      ? 'api'
      : (knobs.emailSourceMode ?? DEFAULT_AUTOMATION_CONFIG.emailSourceMode);

  return {
    ...DEFAULT_AUTOMATION_CONFIG,
    ...knobs,
    mailLimit: knobs.mailLimit ?? 0,
    emailSourceMode,
    emailList: keep?.emailList ?? '',
    proxyList: keep?.proxyList !== undefined && keep.proxyList !== ''
      ? keep.proxyList
      : (knobs.proxyList ?? ''),
    proxyKeyList: keep?.proxyKeyList !== undefined && keep.proxyKeyList !== ''
      ? keep.proxyKeyList
      : (knobs.proxyKeyList ?? ''),
    customPassword: keep?.customPassword ?? ''
  };
}
