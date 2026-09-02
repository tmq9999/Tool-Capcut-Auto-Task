import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS, IPC_EVENTS, FUTURE_IPC_CHANNELS } from '../ipc-channels';
import { PingResponseSchema, PingEnvelopeSchema } from '../api';
import type { ElectronBridge, PingResponse } from '../api';

describe('Typed IPC Contracts & Preload Boundary (Task 3 RED)', () => {
  it('defines active Slice 2.1 runtime IPC channels', () => {
    expect(IPC_CHANNELS).toMatchObject({
      PING: 'app:ping',
      SETTINGS_GET: 'settings:get',
      SETTINGS_SAVE: 'settings:save',
      CREDENTIALS_TEST: 'credentials:test',
      ACCOUNTS_LIST: 'accounts:list',
      ACCOUNTS_CREATE: 'accounts:create',
      ACCOUNTS_UPDATE: 'accounts:update',
      ACCOUNTS_DELETE: 'accounts:delete',
      LOGS_LIST: 'logs:list',
      LOGS_CLEAR: 'logs:clear',
      RUN_START: 'run:start',
      RUN_STOP: 'run:stop',
      RUN_STOP_THREAD: 'run:stop-thread',
      RUN_THREADS: 'run:threads',
      RUN_PROGRESS: 'run:progress',
      EMAIL_PROVIDERS: 'email:providers',
      EMAIL_READ_OTP: 'email:read-otp'
    });
    expect(Object.keys(IPC_CHANNELS)).toEqual([
      'PING',
      'SETTINGS_GET',
      'SETTINGS_SAVE',
      'CREDENTIALS_TEST',
      'ACCOUNTS_LIST',
      'ACCOUNTS_CREATE',
      'ACCOUNTS_UPDATE',
      'ACCOUNTS_DELETE',
      'LOGS_LIST',
      'LOGS_CLEAR',
      'RUN_START',
      'RUN_STOP',
      'RUN_STOP_THREAD',
      'RUN_THREADS',
      'RUN_PROGRESS',
      'EMAIL_PROVIDERS',
      'EMAIL_READ_OTP'
    ]);
  });

  it('keeps main-to-renderer push channels separate from invokable channels', () => {
    expect(IPC_EVENTS).toEqual({
      LOG_ENTRY: 'logs:on-entry',
      RUN_PROGRESS: 'run:on-progress',
      SERVICE_STATUS: 'services:on-status-changed'
    });

    const invokable = new Set(Object.values(IPC_CHANNELS) as string[]);
    for (const eventChannel of Object.values(IPC_EVENTS) as string[]) {
      expect(invokable.has(eventChannel)).toBe(false);
    }
  });

  it('freezes unpromoted future IPC channel constants separately without duplicate active channels', () => {
    const futureRecord = FUTURE_IPC_CHANNELS as Record<string, string>;
    expect(futureRecord.SETTINGS_GET).toBeUndefined();
    expect(futureRecord.SETTINGS_SAVE).toBeUndefined();
    expect(futureRecord.CREDENTIALS_TEST).toBeUndefined();

    expect(futureRecord.ACCOUNTS_LIST).toBeUndefined();
    expect(futureRecord.LOGS_LIST).toBeUndefined();
    expect(FUTURE_IPC_CHANNELS.ACCOUNTS_EXPORT).toBe('accounts:export');
  });

  it('validates strict PingResponseSchema against positive and negative payloads', () => {
    const validPing: PingResponse = {
      pong: true,
      timestamp: 1725148800000
    };
    expect(PingResponseSchema.safeParse(validPing).success).toBe(true);

    const invalidPong = {
      pong: false,
      timestamp: 1725148800000
    };
    expect(PingResponseSchema.safeParse(invalidPong).success).toBe(false);

    const withExtra = {
      pong: true,
      timestamp: 1725148800000,
      extra: 'unexpected'
    };
    expect(PingResponseSchema.safeParse(withExtra).success).toBe(false);
  });

  it('validates PingEnvelopeSchema against envelope wrappers', () => {
    const validSuccessEnvelope = {
      success: true as const,
      data: {
        pong: true as const,
        timestamp: Date.now()
      }
    };
    expect(PingEnvelopeSchema.safeParse(validSuccessEnvelope).success).toBe(true);

    const validErrorEnvelope = {
      success: false as const,
      error: {
        code: 'IPC_HANDLER_ERROR',
        message: 'Internal handler failure'
      }
    };
    expect(PingEnvelopeSchema.safeParse(validErrorEnvelope).success).toBe(true);

    const invalidEnvelope = {
      success: true as const,
      data: {
        pong: true,
        extra: 'bad'
      }
    };
    expect(PingEnvelopeSchema.safeParse(invalidEnvelope).success).toBe(false);
  });

  it('preserves ElectronBridge compile-time structure and platform/version compatibility', () => {
    const mockBridge: ElectronBridge = {
      platform: 'win32',
      version: '2.4.0',
      ping: async () => ({
        success: true,
        data: { pong: true, timestamp: Date.now() }
      }),
      settings: {
        get: async () => ({
          success: true,
          data: {
            settings: {
              general: { theme: 'dark', language: 'vi', autoSaveConfig: true, sessionRestore: true },
              browser: {
                provider: 'gpm',
                gpm: { port: 19995 },
                multilogin: { port: 35000, launcher: 'xcli' },
                gologin: { autoPort: true },
                camoufox: { headless: false },
                patchright: { headless: false }
              },
              logs: { retention: '30' },
              automation: {
                threadCount: 10,
                browser: 'multilogin',
                headless: false,
                retryCount: 3,
                stepDelayMinMs: 500,
                stepDelayMaxMs: 2000,
                typeDelayMinMs: 50,
                typeDelayMaxMs: 150,
                module: 'trial',
                proxyMode: 'direct',
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
                checkedFields: ['email'],
                availableFields: ['email']
              }
            },
            credentials: []
          }
        }),
        save: async () => ({
          success: true,
          data: { success: true }
        })
      },
      credentials: {
        test: async () => ({
          success: true,
          data: {
            code: 'PROVIDER_NOT_IMPLEMENTED',
            message: 'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.',
            timestamp: new Date().toISOString()
          }
        })
      },
      accounts: {
        list: async () => ({ success: true, data: { items: [], total: 0 } }),
        create: async () => ({ success: true, data: { id: 'acc-1' } }),
        update: async () => ({ success: true, data: { success: true } }),
        remove: async () => ({ success: true, data: { deletedCount: 0 } })
      },
      logs: {
        list: async () => ({ success: true, data: { items: [], total: 0 } }),
        clear: async () => ({ success: true, data: { success: true } }),
        onEntry: () => () => {}
      },
      run: {
        start: async () => ({ success: true, data: { runId: 'run-1' } }),
        stop: async () => ({ success: true, data: { success: true } }),
        stopThread: async () => ({ success: true, data: { stopped: true } }),
        threads: async () => ({ success: true, data: [] }),
        progress: async () => ({
          success: true,
          data: {
            runId: 'none',
            state: 'idle',
            threadTotal: 0,
            threadsStarted: 0,
            threadsStopped: 0,
            threadsFailed: 0,
            message: 'Chưa chạy'
          }
        }),
        onProgress: () => () => {}
      },
      email: {
        providers: async () => ({ success: true, data: [] }),
        readOtp: async () => ({ success: true, data: { otp: null } })
      },
      services: {
        onStatusChanged: () => () => {}
      }
    };

    expect(typeof mockBridge.platform).toBe('string');
    expect(typeof mockBridge.version).toBe('string');
    expect(typeof mockBridge.ping).toBe('function');
    expect(typeof mockBridge.settings.get).toBe('function');
    expect(typeof mockBridge.settings.save).toBe('function');
    expect(typeof mockBridge.credentials.test).toBe('function');
    expect(typeof mockBridge.accounts.list).toBe('function');
    expect(typeof mockBridge.logs.onEntry).toBe('function');
    expect(typeof mockBridge.run.start).toBe('function');
    expect(typeof mockBridge.email.providers).toBe('function');
    expect(typeof mockBridge.services.onStatusChanged).toBe('function');
  });
});
