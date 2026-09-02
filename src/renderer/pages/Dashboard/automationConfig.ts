import {
  AutomationRunConfigSchema,
  DEFAULT_TEST_RUN_DURATION_MS,
  type AutomationModule,
  type AutomationRunConfigDTO,
  type BrowserRuntime
} from '../../../shared/schemas/automation.schema';
import type { EmailApiProvider } from '../../../shared/schemas/provider.schema';
import {
  AutomationConfigSettingsSchema,
  type AutomationConfigSettingsDTO
} from '../../../shared/schemas/settings.schema';

/**
 * UI-shaped automation configuration. The Dashboard panels edit this directly;
 * toRunConfig turns it into the validated contract sent over IPC.
 */
export interface AutomationConfigState {
  threadCount: number;
  browser: BrowserRuntime;
  headless: boolean;
  retryCount: number;
  stepDelayMinMs: number;
  stepDelayMaxMs: number;
  typeDelayMinMs: number;
  typeDelayMaxMs: number;
  module: AutomationModule;
  proxyMode: 'direct' | 'proxykey';
  proxyList: string;
  /** One KiotProxy key per line. Empty means every key on the account. */
  proxyKeyList: string;
  emailSourceMode: 'manual' | 'api' | 'custom';
  emailApiProvider: EmailApiProvider;
  otpService: string;
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
  browser: 'multilogin',
  headless: false,
  retryCount: 3,
  stepDelayMinMs: 500,
  stepDelayMaxMs: 2000,
  typeDelayMinMs: 50,
  typeDelayMaxMs: 150,
  module: 'credit',
  proxyMode: 'direct',
  proxyList: '',
  proxyKeyList: '',
  emailSourceMode: 'manual',
  emailApiProvider: 'gmail94',
  otpService: 'facebook',
  emailList: '',
  passwordMode: 'random',
  customPassword: '',
  passwordLength: 12,
  includeUppercase: true,
  includeNumbers: true,
  includeSpecial: false
};

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
  const emailEntries = splitLines(state.emailList);

  if (state.emailSourceMode === 'manual' && emailEntries.length === 0) {
    return {
      ok: false,
      message: 'Hãy nhập danh sách email theo định dạng email|password, hoặc chuyển sang chế độ API.'
    };
  }

  if (state.passwordMode === 'custom' && state.customPassword.trim().length === 0) {
    return { ok: false, message: 'Hãy nhập mật khẩu CapCut khi dùng chế độ tự đặt mật khẩu.' };
  }

  const candidate = {
    threadCount: state.threadCount,
    browser: state.browser,
    headless: state.headless,
    retryCount: state.retryCount,
    stepDelayMinMs: state.stepDelayMinMs,
    stepDelayMaxMs: state.stepDelayMaxMs,
    typeDelayMinMs: state.typeDelayMinMs,
    typeDelayMaxMs: state.typeDelayMaxMs,
    module: state.module,
    emailSource: state.emailSourceMode === 'api'
      ? { mode: 'api' as const, provider: state.emailApiProvider, service: state.otpService }
      : state.emailSourceMode === 'custom'
        ? { mode: 'custom' as const }
        : { mode: 'manual' as const, entries: emailEntries },
    proxy: state.proxyMode === 'proxykey'
      ? { mode: 'proxykey' as const, keys: splitLines(state.proxyKeyList) }
      : { mode: 'direct' as const, entries: splitLines(state.proxyList) },
    password: state.passwordMode === 'custom'
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
    browser: state.browser,
    headless: state.headless,
    retryCount: state.retryCount,
    stepDelayMinMs: state.stepDelayMinMs,
    stepDelayMaxMs: state.stepDelayMaxMs,
    typeDelayMinMs: state.typeDelayMinMs,
    typeDelayMaxMs: state.typeDelayMaxMs,
    module: state.module,
    proxyMode: state.proxyMode,
    emailSourceMode: state.emailSourceMode,
    emailApiProvider: state.emailApiProvider,
    otpService: state.otpService,
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
  const knobs = parsed.success ? parsed.data : toPersistedConfig(DEFAULT_AUTOMATION_CONFIG);

  return {
    ...DEFAULT_AUTOMATION_CONFIG,
    ...knobs,
    emailList: keep?.emailList ?? '',
    proxyList: keep?.proxyList ?? '',
    proxyKeyList: keep?.proxyKeyList ?? '',
    customPassword: keep?.customPassword ?? ''
  };
}
