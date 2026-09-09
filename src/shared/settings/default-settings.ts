import type { AppSettingsDTO } from '../schemas/settings.schema';
import { CAPCUT_OTP_SERVICE } from '../schemas/provider.schema';

export const DEFAULT_APP_SETTINGS: AppSettingsDTO = {
  general: {
    theme: 'dark',
    language: 'vi',
    autoSaveConfig: true,
    sessionRestore: true,
  },
  browser: {
    provider: 'gpm',
    gpm: { port: 19995 },
    multilogin: { port: 35000, launcher: 'api-v3' },
    gologin: { autoPort: true },
    camoufox: { headless: false },
    patchright: { headless: false },
  },
  logs: {
    retention: '30',
  },
  automation: {
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
    proxyRegion: 'random',
    emailSourceMode: 'manual',
    emailApiProvider: 'gmail94',
    otpService: CAPCUT_OTP_SERVICE,
    passwordMode: 'random',
    passwordLength: 12,
    includeUppercase: true,
    includeNumbers: true,
    includeSpecial: false,
  },
  customEmail: {
    domain: 'oldevlk.com',
    apiBaseUrl: 'http://103.116.38.76:3000',
    senderFilter: 'capcut',
  },
  exportConfig: {
    defaultFormat: 'xlsx',
    checkedFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
    availableFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
  },
};
