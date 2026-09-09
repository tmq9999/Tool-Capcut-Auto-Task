import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerSettingsIpc } from '../settingsIpc';
import type { IpcRegistrar } from '../registerIpc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import type { SettingsService } from '../../services/SettingsService';
import type { ServiceConnectionManager } from '../../services/ServiceConnectionManager';
import type { AppSettingsDTO } from '../../../shared/schemas/settings.schema';
import type { CredentialStatusDTO } from '../../../shared/schemas/diagnostics.schema';
import type { SettingsSaveRequestDTO } from '../../../shared/schemas/settings-save.schema';
import { createIpcEnvelopeSchema, type IpcEnvelope } from '../../../shared/schemas/ipc-envelope.schema';
import { AppSettingsSchema } from '../../../shared/schemas/settings.schema';
import { CredentialStatusDTOSchema, SanitizedDiagnosticResultSchema } from '../../../shared/schemas/diagnostics.schema';

type GenericHandler = (event?: unknown, req?: unknown) => Promise<IpcEnvelope<unknown>> | IpcEnvelope<unknown>;

class FakeIpcRegistrar implements IpcRegistrar {
  public handlers = new Map<string, GenericHandler>();
  public removedChannels: string[] = [];

  handle(channel: string, listener: GenericHandler): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Handler already registered for channel: ${channel}`);
    }
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
    this.removedChannels.push(channel);
  }
}

describe('Settings IPC Registration (Task 2.1.3 RED)', () => {
  const SETTINGS_GET_CHANNEL = IPC_CHANNELS.SETTINGS_GET;
  const SETTINGS_SAVE_CHANNEL = IPC_CHANNELS.SETTINGS_SAVE;
  const CREDENTIALS_TEST_CHANNEL = IPC_CHANNELS.CREDENTIALS_TEST;

  const validSettings: AppSettingsDTO = {
    general: {
      theme: 'dark',
      language: 'vi',
      autoSaveConfig: true,
      sessionRestore: true,
    },
    browser: {
      provider: 'gpm',
      gpm: { port: 19995 },
      multilogin: { port: 35000, launcher: 'xcli' },
      gologin: { autoPort: true },
      camoufox: { headless: false },
      patchright: { headless: false },
    },
    logs: {
      retention: '30',
    },
    automation: {
      maxBillablePurchases: 0,
      threadCount: 10,
      browser: 'multilogin',
      headless: false,
      retryCount: 3,
      stepDelayMinMs: 500,
      stepDelayMaxMs: 2000,
      typeDelayMinMs: 50,
      typeDelayMaxMs: 150,
      module: 'trial',
      skipWithoutTrial: false,
      proxyMode: 'direct',
      proxyRegion: 'random',
      emailSourceMode: 'manual',
      emailApiProvider: 'gmail94',
      otpService: 'facebook',
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
      checkedFields: ['email', 'passwordCapcut', 'createdAt'],
      availableFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
    },
  };

  const validCredentialStatuses: CredentialStatusDTO[] = [
    {
      serviceName: 'gmail94',
      isConfigured: true,
      isStale: false,
      metadata: {
        maskedHint: 'sk-live-••••',
        status: 'unknown',
      },
    },
  ];

  const SettingsGetResponseSchema = z.object({
    settings: AppSettingsSchema,
    credentials: z.array(CredentialStatusDTOSchema),
  }).strict();
  const SettingsGetEnvelopeSchema = createIpcEnvelopeSchema(SettingsGetResponseSchema);

  const SettingsSaveResponseSchema = z.object({
    success: z.boolean(),
  }).strict();
  const SettingsSaveEnvelopeSchema = createIpcEnvelopeSchema(SettingsSaveResponseSchema);

  const CredentialsTestEnvelopeSchema = createIpcEnvelopeSchema(SanitizedDiagnosticResultSchema);

  it('registers exactly SETTINGS_GET, SETTINGS_SAVE, and CREDENTIALS_TEST channels', () => {
    const registrar = new FakeIpcRegistrar();
    const fakeSettingsService = {} as SettingsService;
    const fakeConnectionManager = {} as ServiceConnectionManager;

    registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    expect(registrar.handlers.size).toBe(3);
    expect(registrar.handlers.has(SETTINGS_GET_CHANNEL)).toBe(true);
    expect(registrar.handlers.has(SETTINGS_SAVE_CHANNEL)).toBe(true);
    expect(registrar.handlers.has(CREDENTIALS_TEST_CHANNEL)).toBe(true);
  });

  it('settings:get calls SettingsService and returns valid settings envelope response', async () => {
    const registrar = new FakeIpcRegistrar();
    const getSettingsWithCredentialsMock = vi.fn().mockReturnValue({
      settings: validSettings,
      credentials: validCredentialStatuses,
    });
    const fakeSettingsService = {
      getSettingsWithCredentials: getSettingsWithCredentialsMock,
    } as unknown as SettingsService;
    const fakeConnectionManager = {} as ServiceConnectionManager;

    registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    const handler = registrar.handlers.get(SETTINGS_GET_CHANNEL);
    expect(handler).toBeDefined();

    const response = await handler!({});
    expect(getSettingsWithCredentialsMock).toHaveBeenCalledTimes(1);

    const validation = SettingsGetEnvelopeSchema.safeParse(response);
    expect(validation.success).toBe(true);
    if (validation.success && validation.data.success) {
      expect(validation.data.data.settings.browser.gpm.port).toBe(19995);
      expect(validation.data.data.credentials).toHaveLength(1);
    }
  });

  it('settings:save validates full SettingsSaveRequestDTO before service invocation and returns success', async () => {
    const registrar = new FakeIpcRegistrar();
    const saveSettingsWithCredentialsMock = vi.fn();
    const fakeSettingsService = {
      saveSettingsWithCredentials: saveSettingsWithCredentialsMock,
    } as unknown as SettingsService;
    const fakeConnectionManager = {} as ServiceConnectionManager;

    registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    const handler = registrar.handlers.get(SETTINGS_SAVE_CHANNEL);
    expect(handler).toBeDefined();

    const validSaveRequest: SettingsSaveRequestDTO = {
      settings: validSettings,
      credentials: [
        {
          serviceName: 'gmail94',
          operation: { action: 'replace', value: 'sk-live-new-secret-key' },
        },
      ],
    };

    const response = await handler!({}, validSaveRequest);
    expect(saveSettingsWithCredentialsMock).toHaveBeenCalledTimes(1);
    expect(saveSettingsWithCredentialsMock).toHaveBeenCalledWith(validSaveRequest);

    const validation = SettingsSaveEnvelopeSchema.safeParse(response);
    expect(validation.success).toBe(true);
    if (validation.success && validation.data.success) {
      expect(validation.data.data.success).toBe(true);
    }
  });

  it('malformed settings:save returns fixed ERR_VALIDATION_FAILED and does not invoke service', async () => {
    const registrar = new FakeIpcRegistrar();
    const saveSettingsWithCredentialsMock = vi.fn();
    const fakeSettingsService = {
      saveSettingsWithCredentials: saveSettingsWithCredentialsMock,
    } as unknown as SettingsService;
    const fakeConnectionManager = {} as ServiceConnectionManager;

    registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    const handler = registrar.handlers.get(SETTINGS_SAVE_CHANNEL);
    expect(handler).toBeDefined();

    const malformedRequest = {
      settings: {
        ...validSettings,
        browser: { provider: 'invalid-provider' },
      },
      credentials: [],
    };

    const response = await handler!({}, malformedRequest);
    expect(saveSettingsWithCredentialsMock).not.toHaveBeenCalled();

    /**
     * Từ 04/09/2026 lỗi validation phải NÊU TÊN FIELD. Câu cũ là
     * "Invalid settings save payload." — tiếng Anh giữa UI tiếng Việt và không
     * nói gì; xoá trắng ô "Luồng" trên Dashboard rơi đúng vào đây và autosave
     * hỏng im lặng. `code` giữ nguyên nên renderer không phải đổi cách bắt lỗi.
     */
    expect(response.success).toBe(false);
    if (response.success) return;
    expect(response.error.code).toBe('ERR_VALIDATION_FAILED');
    expect(String(response.error.details?.field)).toContain('browser');
    expect(response.error.message).toContain('browser');
  });

  it('failing service returns fixed normalized ERR_PERSISTENCE_FAILED without leaking raw errors or secrets', async () => {
    const registrar = new FakeIpcRegistrar();
    const sensitiveSecret = 'SUPER_SECRET_TOKEN_DO_NOT_LEAK';
    const rawSensitiveError = new Error(`SQLite crash at /Users/private/automanager.db with secret ${sensitiveSecret}`);
    const saveSettingsWithCredentialsMock = vi.fn().mockImplementation(() => {
      throw rawSensitiveError;
    });
    const fakeSettingsService = {
      saveSettingsWithCredentials: saveSettingsWithCredentialsMock,
    } as unknown as SettingsService;
    const fakeConnectionManager = {} as ServiceConnectionManager;

    registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    const handler = registrar.handlers.get(SETTINGS_SAVE_CHANNEL);
    expect(handler).toBeDefined();

    const validSaveRequest: SettingsSaveRequestDTO = {
      settings: validSettings,
      credentials: [
        {
          serviceName: 'kiotproxy',
          operation: { action: 'replace', value: sensitiveSecret },
        },
      ],
    };

    const response = await handler!({}, validSaveRequest);

    expect(response).toEqual({
      success: false,
      error: {
        code: 'ERR_PERSISTENCE_FAILED',
        message: 'Failed to persist application settings or credentials.',
      },
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(sensitiveSecret);
    expect(serialized).not.toContain('SQLite crash');
    expect(serialized).not.toContain('/Users/private/automanager.db');
  });

  it('credentials:test validates known service request and returns schema-valid sanitized result', async () => {
    const registrar = new FakeIpcRegistrar();
    const fakeSettingsService = {} as SettingsService;
    const testConnectionMock = vi.fn().mockResolvedValue({
      code: 'PROVIDER_NOT_IMPLEMENTED',
      message: 'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.',
      timestamp: '2026-09-01T12:00:00.000Z',
    });
    const fakeConnectionManager = {
      testConnection: testConnectionMock,
    } as unknown as ServiceConnectionManager;

    registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    const handler = registrar.handlers.get(CREDENTIALS_TEST_CHANNEL);
    expect(handler).toBeDefined();

    const response = await handler!({}, { serviceName: 'gmail94' });
    expect(testConnectionMock).toHaveBeenCalledWith('gmail94');

    const validation = CredentialsTestEnvelopeSchema.safeParse(response);
    expect(validation.success).toBe(true);
    if (validation.success && validation.data.success) {
      expect(validation.data.data.code).toBe('PROVIDER_NOT_IMPLEMENTED');
    }
  });

  it('malformed credentials:test is rejected with fixed validation error and no manager call', async () => {
    const registrar = new FakeIpcRegistrar();
    const fakeSettingsService = {} as SettingsService;
    const testConnectionMock = vi.fn();
    const fakeConnectionManager = {
      testConnection: testConnectionMock,
    } as unknown as ServiceConnectionManager;

    registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    const handler = registrar.handlers.get(CREDENTIALS_TEST_CHANNEL);
    expect(handler).toBeDefined();

    const response = await handler!({}, { serviceName: '' });
    expect(testConnectionMock).not.toHaveBeenCalled();

    expect(response.success).toBe(false);
    if (response.success) return;
    expect(response.error.code).toBe('ERR_VALIDATION_FAILED');
    expect(String(response.error.details?.field)).toContain('serviceName');
  });

  it('cleanup removes all three handlers exactly once and is idempotent', () => {
    const registrar = new FakeIpcRegistrar();
    const fakeSettingsService = {} as SettingsService;
    const fakeConnectionManager = {} as ServiceConnectionManager;

    const cleanup = registerSettingsIpc(registrar as never, fakeSettingsService, fakeConnectionManager);

    expect(registrar.handlers.size).toBe(3);

    cleanup();
    expect(registrar.handlers.size).toBe(0);
    expect(registrar.removedChannels).toHaveLength(3);
    expect(registrar.removedChannels).toContain(SETTINGS_GET_CHANNEL);
    expect(registrar.removedChannels).toContain(SETTINGS_SAVE_CHANNEL);
    expect(registrar.removedChannels).toContain(CREDENTIALS_TEST_CHANNEL);

    expect(() => cleanup()).not.toThrow();
    expect(registrar.removedChannels).toHaveLength(3);
  });
});
