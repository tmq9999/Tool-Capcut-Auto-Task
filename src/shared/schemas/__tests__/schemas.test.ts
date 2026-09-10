import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AppSettingsSchema, AutomationConfigSettingsSchema, ExportFieldEnum } from '../settings.schema';
import { CAPCUT_OTP_SERVICE } from '../provider.schema';
import { DEFAULT_APP_SETTINGS } from '../../settings/default-settings';
import { SaveCredentialInputSchema } from '../credentials.schema';
import { CanonicalRuntimeLogSchema, LogFilterSchema } from '../log.schema';
import {
  AccountCreateInputSchema,
  AccountUpdateInputSchema,
  AccountFilterSchema,
  AccountListItemSchema
} from '../account.schema';
import { CredentialDiagnosticMetadataSchema } from '../diagnostics.schema';
import { createIpcEnvelopeSchema } from '../ipc-envelope.schema';

describe('Strict Runtime Zod Schemas (Task 2 RED)', () => {
  describe('AppSettingsSchema', () => {
    const validMinimalSettings = {
      general: {
        theme: 'dark' as const,
        language: 'vi' as const,
        autoSaveConfig: true,
        sessionRestore: true
      },
      browser: {
        provider: 'gpm' as const,
        gpm: { port: 19995 },
        multilogin: { port: 35000 },
        gologin: { autoPort: true },
        camoufox: { headless: false },
        patchright: { headless: false }
      },
      exportConfig: {
        defaultFormat: 'xlsx' as const,
        checkedFields: [
          'email',
          'passwordCapcut',
          'emailData',
          'credit',
          'subscription',
          'createdAt'
        ] as const,
        availableFields: [
          'email',
          'passwordCapcut',
          'emailData',
          'credit',
          'subscription',
          'createdAt'
        ] as const
      }
    };

    it('accepts valid minimal AppSettings', () => {
      const result = AppSettingsSchema.safeParse(validMinimalSettings);
      expect(result.success).toBe(true);
    });

    it('accepts boundary GPM ports 1 and 65535', () => {
      const port1 = {
        ...validMinimalSettings,
        browser: { ...validMinimalSettings.browser, gpm: { port: 1 } }
      };
      expect(AppSettingsSchema.safeParse(port1).success).toBe(true);

      const port65535 = {
        ...validMinimalSettings,
        browser: { ...validMinimalSettings.browser, gpm: { port: 65535 } }
      };
      expect(AppSettingsSchema.safeParse(port65535).success).toBe(true);
    });

    it('rejects out-of-boundary GPM ports 0 and 65536', () => {
      const port0 = {
        ...validMinimalSettings,
        browser: { ...validMinimalSettings.browser, gpm: { port: 0 } }
      };
      expect(AppSettingsSchema.safeParse(port0).success).toBe(false);

      const port65536 = {
        ...validMinimalSettings,
        browser: { ...validMinimalSettings.browser, gpm: { port: 65536 } }
      };
      expect(AppSettingsSchema.safeParse(port65536).success).toBe(false);
    });

    it('rejects unknown top-level and nested keys (strict)', () => {
      const withExtraTopKey = {
        ...validMinimalSettings,
        unexpectedProperty: 'malicious'
      };
      expect(AppSettingsSchema.safeParse(withExtraTopKey).success).toBe(false);

      const withExtraNestedKey = {
        ...validMinimalSettings,
        general: {
          ...validMinimalSettings.general,
          extraField: true
        }
      };
      expect(AppSettingsSchema.safeParse(withExtraNestedKey).success).toBe(false);
    });

    it('rejects apiKey, token, or password injected into AppSettings', () => {
      const withApiKey = {
        ...validMinimalSettings,
        general: {
          ...validMinimalSettings.general,
          apiKey: 'sk-123456'
        }
      };
      expect(AppSettingsSchema.safeParse(withApiKey).success).toBe(false);

      const withPassword = {
        ...validMinimalSettings,
        browser: {
          ...validMinimalSettings.browser,
          password: 'plain-password'
        }
      };
      expect(AppSettingsSchema.safeParse(withPassword).success).toBe(false);
    });

    it('restricts export fields strictly to the approved six enum values', () => {
      expect(ExportFieldEnum.options).toEqual([
        'email',
        'passwordCapcut',
        'emailData',
        'credit',
        'subscription',
        'createdAt'
      ]);

      const withInvalidExportField = {
        ...validMinimalSettings,
        exportConfig: {
          ...validMinimalSettings.exportConfig,
          checkedFields: ['email', 'unapprovedField']
        }
      };
      expect(AppSettingsSchema.safeParse(withInvalidExportField).success).toBe(false);
    });
  });

  describe('SaveCredentialInputSchema & Multilogin Validation', () => {
    it('accepts Multilogin automationToken mode', () => {
      const res = SaveCredentialInputSchema.safeParse({
        serviceName: 'multilogin',
        auth: { mode: 'token', automationToken: 'ml-token-secret-123' }
      });
      expect(res.success).toBe(true);
    });

    it('accepts Multilogin email+password mode', () => {
      const res = SaveCredentialInputSchema.safeParse({
        serviceName: 'multilogin',
        auth: {
          mode: 'credentials',
          email: 'user@example.com',
          password: 'secretPassword123'
        }
      });
      expect(res.success).toBe(true);
    });

    it('rejects Multilogin auth with both token and password', () => {
      const res = SaveCredentialInputSchema.safeParse({
        serviceName: 'multilogin',
        auth: {
          mode: 'token',
          automationToken: 'ml-token-secret-123',
          password: 'extraPassword'
        }
      });
      expect(res.success).toBe(false);
    });

    it('rejects Multilogin auth with neither token nor credentials', () => {
      const res = SaveCredentialInputSchema.safeParse({
        serviceName: 'multilogin',
        auth: {}
      });
      expect(res.success).toBe(false);
    });

    it('rejects Multilogin auth with incomplete email+password (missing password)', () => {
      const res = SaveCredentialInputSchema.safeParse({
        serviceName: 'multilogin',
        auth: {
          mode: 'credentials',
          email: 'user@example.com'
        }
      });
      expect(res.success).toBe(false);
    });

    it('rejects Multilogin auth with extra unapproved fields (strict)', () => {
      const res = SaveCredentialInputSchema.safeParse({
        serviceName: 'multilogin',
        auth: {
          mode: 'token',
          automationToken: 'ml-token-secret-123',
          extraField: 'not-allowed'
        }
      });
      expect(res.success).toBe(false);
    });

    it('accepts each approved credential shape (Gmail94, KiotProxy, DongVanFB, GoLogin)', () => {
      expect(
        SaveCredentialInputSchema.safeParse({
          serviceName: 'gmail94',
          apiKey: 'g94-api-key'
        }).success
      ).toBe(true);

      expect(
        SaveCredentialInputSchema.safeParse({
          serviceName: 'kiotproxy',
          apiToken: 'kp-token-value'
        }).success
      ).toBe(true);

      expect(
        SaveCredentialInputSchema.safeParse({
          serviceName: 'dongvanfb',
          apiKey: 'dvfb-api-key'
        }).success
      ).toBe(true);

      expect(
        SaveCredentialInputSchema.safeParse({
          serviceName: 'gologin',
          apiToken: 'gl-api-token'
        }).success
      ).toBe(true);
    });
  });

  describe('CanonicalRuntimeLogSchema & Log Filters', () => {
    const validLog = {
      id: 'log-uuid-1',
      accountId: 'acc-uuid-1',
      email: 'worker1@example.com',
      step: 'Proxy Check',
      status: 'INFO' as const,
      message: 'Proxy verified successfully',
      createdAt: '2026-09-01T00:00:00.000Z'
    };

    it('accepts all six canonical statuses (INFO, SUCCESS, WARNING, WAITING, ERROR, DEBUG)', () => {
      const statuses = ['INFO', 'SUCCESS', 'WARNING', 'WAITING', 'ERROR', 'DEBUG'] as const;
      for (const status of statuses) {
        const res = CanonicalRuntimeLogSchema.safeParse({
          ...validLog,
          status
        });
        expect(res.success).toBe(true);
      }
    });

    it('rejects non-canonical statuses OK and WARN', () => {
      expect(
        CanonicalRuntimeLogSchema.safeParse({
          ...validLog,
          status: 'OK'
        }).success
      ).toBe(false);

      expect(
        CanonicalRuntimeLogSchema.safeParse({
          ...validLog,
          status: 'WARN'
        }).success
      ).toBe(false);
    });

    it('rejects non-ISO timestamps and unknown keys', () => {
      expect(
        CanonicalRuntimeLogSchema.safeParse({
          ...validLog,
          createdAt: '10:24:00'
        }).success
      ).toBe(false);

      expect(
        CanonicalRuntimeLogSchema.safeParse({
          ...validLog,
          extraField: 'leaked'
        }).success
      ).toBe(false);
    });

    it('enforces bounds on LogFilterSchema', () => {
      const validFilter = { page: 1, pageSize: 100 };
      expect(LogFilterSchema.safeParse(validFilter).success).toBe(true);

      const invalidPageSize = { page: 1, pageSize: 1000 };
      expect(LogFilterSchema.safeParse(invalidPageSize).success).toBe(false);

      const invalidPage = { page: 0, pageSize: 50 };
      expect(LogFilterSchema.safeParse(invalidPage).success).toBe(false);
    });
  });

  describe('Account Operations & Write-Only Secrets', () => {
    it('validates AccountCreateInput with write-only optional secrets', () => {
      const createInput = {
        email: 'acc@example.com',
        emailProvider: 'Gmail',
        passwordCapcut: 'capcutPassSecret',
        emailPassword: 'emailPassSecret',
        emailData: 'fullDataDumpSecret',
        credit: 100,
        status: 'active' as const,
        notes: 'Initial account'
      };
      const res = AccountCreateInputSchema.safeParse(createInput);
      expect(res.success).toBe(true);
    });

    it('validates AccountUpdateInput with write-only keep/replace/clear secret operations', () => {
      const updateInput = {
        email: 'acc-updated@example.com',
        passwordCapcutOp: { action: 'replace' as const, value: 'newCapcutSecret' },
        emailPasswordOp: { action: 'keep' as const },
        emailDataOp: { action: 'clear' as const },
        credit: 200
      };
      const res = AccountUpdateInputSchema.safeParse(updateInput);
      expect(res.success).toBe(true);
    });

    it('ensures AccountListItemDTO validates optional passwordCapcut for personal tool dashboard display', () => {
      const listItem = {
        id: 'acc-1',
        email: 'user@example.com',
        emailProvider: 'Gmail',
        hasEmailPassword: true,
        hasPasswordCapcut: true,
        hasEmailData: false,
        credit: 50,
        subscription: 'Pro 1 Month',
        status: 'active' as const,
        automationStep: 'Idle',
        proxy: '127.0.0.1:8080',
        browserProvider: 'gpm',
        browserProfileId: 'gpm-profile-10',
        notes: 'Active worker',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
      };
      const parsed = AccountListItemSchema.safeParse(listItem);
      expect(parsed.success).toBe(true);

      // R08 allows plaintext password for personal Dashboard viewing
      const withPasswordItem = {
        ...listItem,
        passwordCapcut: 'plaintext-secret'
      };
      expect(AccountListItemSchema.safeParse(withPasswordItem).success).toBe(true);
    });

    it('enforces bounds on AccountFilterSchema', () => {
      expect(AccountFilterSchema.safeParse({ page: 1, pageSize: 50 }).success).toBe(true);
      expect(AccountFilterSchema.safeParse({ page: -1, pageSize: 50 }).success).toBe(false);
      expect(AccountFilterSchema.safeParse({ page: 1, pageSize: 600 }).success).toBe(false);
    });
  });

  describe('Credential Diagnostic Metadata', () => {
    it('validates sanitized diagnostic metadata with allowlisted details', () => {
      const metadata = {
        maskedHint: 'gl-••••36a3',
        status: 'connected' as const,
        lastTestedAt: '2026-09-01T00:00:00.000Z',
        lastTestResult: {
          code: 'OK' as const,
          message: 'Connected successfully',
          timestamp: '2026-09-01T00:00:00.000Z',
          details: {
            latencyMs: 150,
            profileCount: 12,
            isOnline: true
          }
        },
        balance: 250000,
        balanceFetchedAt: '2026-09-01T00:00:00.000Z'
      };
      expect(CredentialDiagnosticMetadataSchema.safeParse(metadata).success).toBe(true);
    });

    it('rejects raw vendor response objects in diagnostic metadata (strict)', () => {
      const invalidMeta = {
        maskedHint: 'gl-••••36a3',
        status: 'connected' as const,
        rawVendorResponse: { token: 'raw-secret-token' }
      };
      expect(CredentialDiagnosticMetadataSchema.safeParse(invalidMeta).success).toBe(false);
    });
  });

  describe('createIpcEnvelopeSchema Factory', () => {
    const PingPayloadSchema = z.object({
      pong: z.literal(true),
      timestamp: z.number()
    }).strict();

    const PingEnvelopeSchema = createIpcEnvelopeSchema(PingPayloadSchema);

    it('validates matching typed success envelope', () => {
      const successPayload = {
        success: true as const,
        data: {
          pong: true as const,
          timestamp: Date.now()
        }
      };
      expect(PingEnvelopeSchema.safeParse(successPayload).success).toBe(true);
    });

    it('rejects success envelope with mismatched inner payload', () => {
      const invalidPayload = {
        success: true as const,
        data: {
          pong: false,
          timestamp: 'not-a-number'
        }
      };
      expect(PingEnvelopeSchema.safeParse(invalidPayload).success).toBe(false);
    });

    it('rejects success envelope with unexpected extra fields (strict)', () => {
      const extraPayload = {
        success: true as const,
        data: {
          pong: true as const,
          timestamp: Date.now(),
          extraKey: 'forbidden'
        }
      };
      expect(PingEnvelopeSchema.safeParse(extraPayload).success).toBe(false);
    });

    it('validates normalized error envelope', () => {
      const errorPayload = {
        success: false as const,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API Key is invalid or expired',
          details: { service: 'gmail94' }
        }
      };
      expect(PingEnvelopeSchema.safeParse(errorPayload).success).toBe(true);
    });
  });
});

/**
 * Slug OTP mặc định của một máy MỚI. Sai slug thì gmail94 thuê hộp thư cho dịch
 * vụ khác và mã CapCut không bao giờ về (xem `CAPCUT_OTP_SERVICE`).
 */
describe('slug OTP mặc định', () => {
  it('máy mới mặc định thuê hộp thư dịch vụ capcut', () => {
    const fresh = AutomationConfigSettingsSchema.parse(undefined);
    expect(fresh.otpService).toBe(CAPCUT_OTP_SERVICE);
  });

  it('DEFAULT_APP_SETTINGS cũng dùng đúng slug đó', () => {
    expect(DEFAULT_APP_SETTINGS.automation.otpService).toBe(CAPCUT_OTP_SERVICE);
  });
});
