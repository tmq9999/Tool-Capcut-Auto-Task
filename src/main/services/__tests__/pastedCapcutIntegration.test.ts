import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AutomationRunService,
  type AutomationRunCollaborators,
  type CapcutTaskRunner
} from '../AutomationRunService';
import {
  createAutomationWorkSourceFactory
} from '../AutomationWorkSource';
import { AutomationRunConfigSchema } from '../../../shared/schemas/automation.schema';
import type { BrowserLauncher } from '../capcut/launcher';
import type { AccountCreateInputDTO, AccountUpdateInputDTO } from '../../../shared/schemas/account.schema';
import type { AccountIdentity } from '../AccountService';
import { ProviderError } from '../../providers/ProviderError';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrator';
import { AccountRepository } from '../../repositories/AccountRepository';
import { AccountService } from '../AccountService';
import type { ICredentialVault } from '../../security/CredentialVault';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(plainText: string): Buffer { return Buffer.from('enc:' + plainText, 'utf8'); }
  decrypt(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : raw;
  }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pasted-capcut-test-'));
}

describe('pasted-existing CapCut accounts integration', () => {
  it('assigns exact pasted password to each account without invoking generator (2 rows, 2 distinct passwords)', async () => {
    const userDataDir = createTempDir();
    const workSources = createAutomationWorkSourceFactory({
      openAcquisitionSession: vi.fn()
    });

    const receivedCalls: Array<{ email: string; password: string; isNewAccount: boolean; authAttempt?: string; getOtp: unknown }> = [];

    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        receivedCalls.push({
          email: input.email,
          password: input.password,
          isNewAccount: input.isNewAccount,
          authAttempt: input.authAttempt,
          getOtp: input.getOtp
        });
        const receipt = {
          runId: input.runId!,
          sessionAlias: input.sessionAlias!,
          observedAt: new Date().toISOString(),
          requiredAfter: new Date().toISOString(),
          fresh: true,
          final: true,
          serverTotal: 1,
          serverDone: 1,
          complete: true
        };
        const rows = [{ key: 'capcut_web_newbie_register', title: 'test', reward: 10, status: 4 }];
        await input.onTaskCheckpoint({ rows, receipt, unsettledProofs: [] });
        return {
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: rows,
          unsettledProofs: [],
          verification: receipt
        };
      }
    };

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `profile-${Math.random()}`;
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9222, page: {} as never, context: {} as never };
      },
      stop: async () => {}
    };

    const createdAccounts: AccountCreateInputDTO[] = [];
    const accountsSink = {
      create: (input: AccountCreateInputDTO) => {
        createdAccounts.push(input);
        return { id: `acc-created-${createdAccounts.length}` };
      },
      update: (_id: string, _data: AccountUpdateInputDTO) => ({ success: true }),
      findByEmail: (_email: string): AccountIdentity[] => []
    };

    const service = new AutomationRunService({
      workSources,
      emailOtp: { readOtp: async () => '999999' },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: accountsSink,
      logBus: { emit: () => {} },
      launcher: () => launcher,
      capcut,
      taskProgress: { record: async () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-pasted-1' });

    const config = AutomationRunConfigSchema.parse({
      threadCount: 2,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'pasted-existing',
        entries: [
          { line: 1, email: 'alpha@example.com', capcutPassword: 'AlphaPass!123|extra' },
          { line: 2, email: 'beta@example.com', capcutPassword: 'BetaPass 456  ' }
        ]
      },
      proxy: { mode: 'direct', entries: ['127.0.0.1:8080', '127.0.0.2:8080'] },
      password: { mode: 'per-account' }
    });

    await service.start(config);
    const summary = await service.waitForCompletion();
    expect(summary.accountsCompleted).toBe(2);
    expect(summary.accountsFailed).toBe(0);

    expect(receivedCalls).toHaveLength(2);
    const alphaCall = receivedCalls.find((c) => c.email === 'alpha@example.com');
    const betaCall = receivedCalls.find((c) => c.email === 'beta@example.com');

    expect(alphaCall).toBeDefined();
    expect(alphaCall!.password).toBe('AlphaPass!123|extra');
    expect(alphaCall!.isNewAccount).toBe(false);
    expect(alphaCall!.authAttempt).toBe('existing-only');
    expect(alphaCall!.getOtp).toBeUndefined();

    expect(betaCall).toBeDefined();
    expect(betaCall!.password).toBe('BetaPass 456  ');
    expect(betaCall!.isNewAccount).toBe(false);
    expect(betaCall!.authAttempt).toBe('existing-only');
    expect(betaCall!.getOtp).toBeUndefined();

    // Check tracking row creation in DB for 0 matches
    expect(createdAccounts).toHaveLength(2);
    expect(createdAccounts[0].email).toBe('alpha@example.com');
    expect(createdAccounts[0].passwordCapcut).toBe('AlphaPass!123|extra');
    expect(createdAccounts[0].emailProvider).toBe('manual');
    expect(createdAccounts[1].email).toBe('beta@example.com');
    expect(createdAccounts[1].passwordCapcut).toBe('BetaPass 456  ');

    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('reuses existing local DB account when findByEmail matches 1 row and does not overwrite stored secret', async () => {
    const userDataDir = createTempDir();
    const workSources = createAutomationWorkSourceFactory({
      openAcquisitionSession: vi.fn()
    });

    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        const receipt = {
          runId: input.runId!,
          sessionAlias: input.sessionAlias!,
          observedAt: new Date().toISOString(),
          requiredAfter: new Date().toISOString(),
          fresh: true,
          final: true,
          serverTotal: 1,
          serverDone: 1,
          complete: true
        };
        const rows = [{ key: 'capcut_web_newbie_register', title: 'test', reward: 10, status: 4 }];
        await input.onTaskCheckpoint({ rows, receipt, unsettledProofs: [] });
        return {
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: rows,
          unsettledProofs: [],
          verification: receipt
        };
      }
    };

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `profile-${Math.random()}`;
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9222, page: {} as never, context: {} as never };
      },
      stop: async () => {}
    };

    const createdAccounts: AccountCreateInputDTO[] = [];
    const updatedCalls: Array<{ id: string; data: AccountUpdateInputDTO }> = [];
    const accountsSink = {
      create: (input: AccountCreateInputDTO) => {
        createdAccounts.push(input);
        return { id: `acc-created-${createdAccounts.length}` };
      },
      update: (id: string, data: AccountUpdateInputDTO) => {
        updatedCalls.push({ id, data });
        return { success: true };
      },
      findByEmail: (email: string): AccountIdentity[] => {
        if (email.toLowerCase().trim() === 'existing@example.com') {
          return [{ id: 'existing-db-id-123', email: 'existing@example.com' }];
        }
        return [];
      }
    };

    const service = new AutomationRunService({
      workSources,
      emailOtp: { readOtp: async () => '999999' },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: accountsSink,
      logBus: { emit: () => {} },
      launcher: () => launcher,
      capcut,
      taskProgress: { record: async () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-pasted-2' });

    const config = AutomationRunConfigSchema.parse({
      threadCount: 1,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'pasted-existing',
        entries: [
          { line: 1, email: 'existing@example.com', capcutPassword: 'TransientPastedPass999!' }
        ]
      },
      proxy: { mode: 'direct', entries: ['127.0.0.1:8080'] },
      password: { mode: 'per-account' }
    });

    await service.start(config);
    const summary = await service.waitForCompletion();
    expect(summary.accountsCompleted).toBe(1);

    // No new account row should be created in DB!
    expect(createdAccounts).toHaveLength(0);

    // Should update existing-db-id-123, but NEVER write passwordCapcut
    expect(updatedCalls.length).toBeGreaterThan(0);
    for (const call of updatedCalls) {
      expect(call.id).toBe('existing-db-id-123');
      expect((call.data as Record<string, unknown>).passwordCapcut).toBeUndefined();
    }

    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('fails per-account when login fails, does not attempt signup or OTP, and lets other accounts continue', async () => {
    const userDataDir = createTempDir();
    const workSources = createAutomationWorkSourceFactory({
      openAcquisitionSession: vi.fn()
    });

    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        if (input.email === 'bad@example.com') {
          return {
            authenticated: false,
            fatalError: 'Đăng nhập thất bại: Tài khoản hoặc mật khẩu không chính xác',
            done: 0,
            total: 0,
            credits: 0,
            creditsTotal: 0,
            missing: [],
            tasks: [],
            unsettledProofs: [],
            verification: null
          };
        }
        const receipt = {
          runId: input.runId!,
          sessionAlias: input.sessionAlias!,
          observedAt: new Date().toISOString(),
          requiredAfter: new Date().toISOString(),
          fresh: true,
          final: true,
          serverTotal: 1,
          serverDone: 1,
          complete: true
        };
        const rows = [{ key: 'capcut_web_newbie_register', title: 'test', reward: 10, status: 4 }];
        await input.onTaskCheckpoint({ rows, receipt, unsettledProofs: [] });
        return {
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: rows,
          unsettledProofs: [],
          verification: receipt
        };
      }
    };

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `profile-${Math.random()}`;
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9222, page: {} as never, context: {} as never };
      },
      stop: async () => {}
    };

    const readOtpMock = vi.fn().mockResolvedValue('123456');
    const createdAccounts: AccountCreateInputDTO[] = [];
    const accountsSink = {
      create: (input: AccountCreateInputDTO) => {
        createdAccounts.push(input);
        return { id: `acc-created-${createdAccounts.length}` };
      },
      update: (_id: string, _data: AccountUpdateInputDTO) => ({ success: true }),
      findByEmail: (_email: string): AccountIdentity[] => []
    };

    const service = new AutomationRunService({
      workSources,
      emailOtp: { readOtp: readOtpMock },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: accountsSink,
      logBus: { emit: () => {} },
      launcher: () => launcher,
      capcut,
      taskProgress: { record: async () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-pasted-3' });

    const config = AutomationRunConfigSchema.parse({
      threadCount: 2,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'pasted-existing',
        entries: [
          { line: 1, email: 'bad@example.com', capcutPassword: 'WrongPassword123!' },
          { line: 2, email: 'good@example.com', capcutPassword: 'RightPassword123!' }
        ]
      },
      proxy: { mode: 'direct', entries: ['127.0.0.1:8080', '127.0.0.2:8080'] },
      password: { mode: 'per-account' }
    });

    await service.start(config);
    const summary = await service.waitForCompletion();
    expect(summary.accountsCompleted).toBe(1);
    expect(summary.accountsFailed).toBe(1);

    // readOtp must never be called
    expect(readOtpMock).not.toHaveBeenCalled();

    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('adjusts effective workerTarget to queue length (threadCount: 10, pasted: 2 -> workerTarget: 2, only 2 proxies needed)', async () => {
    const userDataDir = createTempDir();
    const workSources = createAutomationWorkSourceFactory({
      openAcquisitionSession: vi.fn()
    });

    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        const receipt = {
          runId: input.runId!,
          sessionAlias: input.sessionAlias!,
          observedAt: new Date().toISOString(),
          requiredAfter: new Date().toISOString(),
          fresh: true,
          final: true,
          serverTotal: 1,
          serverDone: 1,
          complete: true
        };
        const rows = [{ key: 'capcut_web_newbie_register', title: 'test', reward: 10, status: 4 }];
        await input.onTaskCheckpoint({ rows, receipt, unsettledProofs: [] });
        return {
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: rows,
          unsettledProofs: [],
          verification: receipt
        };
      }
    };

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `profile-${Math.random()}`;
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9222, page: {} as never, context: {} as never };
      },
      stop: async () => {}
    };

    let accCounter = 0;
    const accountsSink = {
      create: () => ({ id: `acc-${++accCounter}` }),
      update: () => ({ success: true }),
      findByEmail: () => []
    };

    const service = new AutomationRunService({
      workSources,
      emailOtp: { readOtp: async () => '123456' },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: accountsSink,
      logBus: { emit: () => {} },
      launcher: () => launcher,
      capcut,
      taskProgress: { record: async () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-pasted-4' });

    // Thread count 10, but ONLY 2 proxies provided!
    // If workerTarget was 10, parseDirectProxyList would throw CONFIG_ERROR because 2 < 10 proxies.
    // With effective capacity workerTarget = min(10, 2) = 2, 2 proxies is sufficient and run succeeds!
    const config = AutomationRunConfigSchema.parse({
      threadCount: 10,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'pasted-existing',
        entries: [
          { line: 1, email: 'acc1@example.com', capcutPassword: 'Pass1!' },
          { line: 2, email: 'acc2@example.com', capcutPassword: 'Pass2!' }
        ]
      },
      proxy: { mode: 'direct', entries: ['127.0.0.1:8080', '127.0.0.2:8080'] },
      password: { mode: 'per-account' }
    });

    await service.start(config);
    const summary = await service.waitForCompletion();
    expect(summary.workerTarget).toBe(2);
    expect(summary.accountsCompleted).toBe(2);

    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('rejects at preflight before resources if findByEmail returns multiple DB matches for an email', async () => {
    const userDataDir = createTempDir();
    const workSources = createAutomationWorkSourceFactory({
      openAcquisitionSession: vi.fn()
    });

    const launchSpy = vi.fn();
    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: launchSpy,
      stop: async () => {}
    };

    const accountsSink = {
      create: () => ({ id: 'acc-1' }),
      update: () => ({ success: true }),
      findByEmail: (email: string): AccountIdentity[] => {
        if (email === 'conflict@example.com') {
          return [
            { id: 'db-1', email: 'conflict@example.com' },
            { id: 'db-2', email: 'conflict@example.com' }
          ];
        }
        return [];
      }
    };

    const service = new AutomationRunService({
      workSources,
      emailOtp: { readOtp: async () => '123456' },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: accountsSink,
      logBus: { emit: () => {} },
      launcher: () => launcher,
      taskProgress: { record: async () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-pasted-5' });

    // Provide 2 proxies so proxy parsing would pass if checked
    const config = AutomationRunConfigSchema.parse({
      threadCount: 2,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'pasted-existing',
        entries: [
          { line: 5, email: 'conflict@example.com', capcutPassword: 'Pass!' }
        ]
      },
      proxy: { mode: 'direct', entries: ['127.0.0.1:8080', '127.0.0.2:8080'] },
      password: { mode: 'per-account' }
    });

    await expect(service.start(config)).rejects.toThrow(/trùng với.*bản ghi trong cơ sở dữ liệu/);
    expect(launchSpy).not.toHaveBeenCalled();

    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('rejects at preflight if accountsSink is missing findByEmail method for pasted-existing mode', async () => {
    const userDataDir = createTempDir();
    const workSources = createAutomationWorkSourceFactory({
      openAcquisitionSession: vi.fn()
    });

    const accountsSink = {
      create: () => ({ id: 'acc-1' }),
      update: () => ({ success: true })
      // findByEmail is undefined
    };

    const service = new AutomationRunService({
      workSources,
      emailOtp: { readOtp: async () => '123456' },
      proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
      browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
      accounts: accountsSink,
      logBus: { emit: () => {} }
    } as unknown as AutomationRunCollaborators, { userDataDir, nextId: () => 'run-pasted-6' });

    const config = AutomationRunConfigSchema.parse({
      threadCount: 1,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'pasted-existing',
        entries: [
          { line: 1, email: 'test@example.com', capcutPassword: 'Pass!' }
        ]
      },
      proxy: { mode: 'direct', entries: ['127.0.0.1:8080'] },
      password: { mode: 'per-account' }
    });

    await expect(service.start(config)).rejects.toThrow(/chưa hỗ trợ tra cứu email/);

    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  describe('direct admission validation at start()', () => {
    const invalidConfigCases = [
      {
        name: 'pasted-existing with random password mode',
        patch: {
          password: { mode: 'random', length: 10, uppercase: true, numbers: true, special: true }
        }
      },
      {
        name: 'pasted-existing with http-only transport',
        patch: {
          missionTransport: 'http-only'
        }
      },
      {
        name: 'pasted-existing with billable budget (maxBillablePurchases: 1)',
        patch: {
          maxBillablePurchases: 1
        }
      },
      {
        name: 'pasted-existing with rolloutStage: 3',
        patch: {
          rolloutStage: 3
        }
      },
      {
        name: 'pasted-existing with approvedMailboxes: 1',
        patch: {
          approvedMailboxes: 1
        }
      },
      {
        name: 'pasted-existing with stopAfter: 1',
        patch: {
          stopAfter: 1
        }
      },
      {
        name: 'legacy manual with per-account password',
        patch: {
          emailSource: { mode: 'manual', entries: ['user@example.com'] },
          password: { mode: 'per-account' }
        }
      },
      {
        name: 'pasted-existing with line 0',
        patch: {
          emailSource: {
            mode: 'pasted-existing',
            entries: [{ line: 0, email: 'user@example.com', capcutPassword: 'pass' }]
          }
        }
      },
      {
        name: 'pasted-existing with conflicting passwords for same email',
        patch: {
          emailSource: {
            mode: 'pasted-existing',
            entries: [
              { line: 1, email: 'dup@example.com', capcutPassword: 'pass1' },
              { line: 2, email: 'DUP@example.com', capcutPassword: 'pass2' }
            ]
          },
          mailLimit: 1
        }
      }
    ];

    for (const testCase of invalidConfigCases) {
      it(`rejects ${testCase.name} before side effects`, async () => {
        const userDataDir = createTempDir();
        const createWorkSourceSpy = vi.fn();
        const workSources = {
          create: createWorkSourceSpy
        };
        const captureSpy = vi.fn();
        const logReset = {
          capture: captureSpy
        };
        const findByEmailSpy = vi.fn().mockReturnValue([]);
        const accounts = {
          create: vi.fn(),
          update: vi.fn().mockReturnValue({ success: true }),
          findByEmail: findByEmailSpy
        };
        const acquireProxySpy = vi.fn();
        const proxies = {
          acquire: acquireProxySpy,
          release: vi.fn(),
          releaseAll: vi.fn()
        };

        const service = new AutomationRunService(
          {
            workSources,
            emailOtp: { readOtp: async () => '123456' },
            proxies,
            browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
            accounts,
            logBus: { emit: () => {} },
            logReset
          } as unknown as AutomationRunCollaborators,
          { userDataDir, nextId: () => 'run-invalid-admission' }
        );

        const baseConfig: Record<string, unknown> = {
          threadCount: 1,
          browser: 'multilogin',
          headless: false,
          retryCount: 0,
          stepDelayMinMs: 0,
          stepDelayMaxMs: 0,
          typeDelayMinMs: 0,
          typeDelayMaxMs: 0,
          module: 'credit',
          skipWithoutTrial: false,
          emailSource: {
            mode: 'pasted-existing',
            entries: [{ line: 1, email: 'valid@example.com', capcutPassword: 'pass' }]
          },
          proxy: { mode: 'direct', entries: ['127.0.0.1:8080'] },
          password: { mode: 'per-account' },
          testDurationMs: 10000,
          ...testCase.patch
        };

        const startPromise = service.start(baseConfig as never);
        await expect(startPromise).rejects.toThrow(ProviderError);
        await expect(startPromise).rejects.toThrow(/Cấu hình tài khoản dán không hợp lệ/);

        expect(service.isRunning()).toBe(false);
        expect(service.getProgress().state).toBe('idle');
        expect(captureSpy).not.toHaveBeenCalled();
        expect(createWorkSourceSpy).not.toHaveBeenCalled();
        expect(findByEmailSpy).not.toHaveBeenCalled();
        expect(accounts.create).not.toHaveBeenCalled();
        expect(acquireProxySpy).not.toHaveBeenCalled();

        fs.rmSync(userDataDir, { recursive: true, force: true });
      });
    }
  });

  it('G12.1: strengthens paste integration with real in-memory SQLite, preserving byte-exact password across 2 consecutive runs and 2 accounts', async () => {
    const userDataDir = createTempDir();
    const db = new Database(':memory:');
    runMigrations(db);
    const repo = new AccountRepository(db);
    const vault = new PlainVault();
    let idCounter = 0;
    const accountService = new AccountService(repo, vault, { nextId: () => 'acc-pasted-' + ++idCounter });

    // Pre-insert a known account
    const knownEmail = 'known@example.com';
    const knownPassword = 'ExactKnownPass#123!';
    const existing = accountService.create({
      email: knownEmail,
      emailProvider: 'custom',
      passwordCapcut: knownPassword,
      credit: 20,
      status: 'active'
    });
    expect(existing.id).toBe('acc-pasted-1');

    const workSources = createAutomationWorkSourceFactory({
      openAcquisitionSession: vi.fn()
    });

    const receivedCalls: Array<{ email: string; password: string; isNewAccount: boolean }> = [];
    const capcut: CapcutTaskRunner = {
      runAccount: async (input) => {
        receivedCalls.push({
          email: input.email,
          password: input.password,
          isNewAccount: input.isNewAccount
        });
        const receipt = {
          runId: input.runId!,
          sessionAlias: input.sessionAlias!,
          observedAt: new Date().toISOString(),
          requiredAfter: new Date().toISOString(),
          fresh: true,
          final: true,
          serverTotal: 1,
          serverDone: 1,
          complete: true
        };
        const rows = [{ key: 'capcut_web_newbie_register', title: 'test', reward: 10, status: 4 }];
        if (input.onTaskCheckpoint) {
          await input.onTaskCheckpoint({ rows, receipt, unsettledProofs: [] });
        }
        return {
          authenticated: true,
          done: 1,
          total: 1,
          credits: 10,
          creditsTotal: 10,
          missing: [],
          tasks: rows,
          unsettledProofs: [],
          verification: receipt
        };
      }
    };

    const launcher: BrowserLauncher = {
      name: 'api-v3',
      launch: async (options) => {
        const profileId = `profile-${Math.random()}`;
        options.onProfileStarted?.(profileId);
        return { profileId, port: 9222, page: {} as never, context: {} as never };
      },
      stop: async () => {}
    };

    let runCounter = 0;
    const service = new AutomationRunService(
      {
        workSources,
        emailOtp: { readOtp: async () => '999999' },
        proxies: { acquire: async () => ({ leaseId: 'unused' } as never), release: async () => {}, releaseAll: async () => {} },
        browser: { startProfile: async () => { throw new Error('unused'); }, stopProfile: async () => {} },
        accounts: accountService,
        logBus: { emit: () => {} },
        launcher: () => launcher,
        capcut,
        taskProgress: { record: async () => {} }
      } as unknown as AutomationRunCollaborators,
      { userDataDir, nextId: () => 'run-real-sqlite-' + ++runCounter }
    );

    const config = AutomationRunConfigSchema.parse({
      threadCount: 2,
      browser: 'multilogin',
      headless: false,
      retryCount: 0,
      stepDelayMinMs: 0,
      stepDelayMaxMs: 0,
      typeDelayMinMs: 0,
      typeDelayMaxMs: 0,
      module: 'credit',
      skipWithoutTrial: false,
      emailSource: {
        mode: 'pasted-existing',
        entries: [
          { line: 1, email: knownEmail, capcutPassword: knownPassword },
          { line: 2, email: 'newacc@example.com', capcutPassword: 'BrandNewSecret%789' }
        ]
      },
      proxy: { mode: 'direct', entries: ['127.0.0.1:8080', '127.0.0.2:8080'] },
      password: { mode: 'per-account' }
    });

    try {
      // Run 1
      await service.start(config);
      const summary1 = await service.waitForCompletion();
      expect(summary1.state).toBe('completed');

      // Check DB after run 1
      const allAfterRun1 = repo.listAccounts({ page: 1, pageSize: 50 }).items;
      expect(allAfterRun1).toHaveLength(2);

      const items1 = accountService.list({ page: 1, pageSize: 50 }).items;
      const knownAfter1 = items1.find((i) => i.id === 'acc-pasted-1');
      expect(knownAfter1).toBeDefined();
      expect(knownAfter1?.passwordCapcut).toBe(knownPassword);

      const newAfter1 = items1.find((i) => i.id === 'acc-pasted-2');
      expect(newAfter1).toBeDefined();
      expect(newAfter1?.email).toBe('newacc@example.com');
      expect(newAfter1?.passwordCapcut).toBe('BrandNewSecret%789');
      const rawNew1 = repo.getAccountById('acc-pasted-2');
      expect(rawNew1?.emailPasswordEncrypted).toBeNull();

      // Run 2 on same service instance and DB
      await service.start(config);
      const summary2 = await service.waitForCompletion();
      expect(summary2.state).toBe('completed');

      // Check DB after run 2: exactly 2 rows remain with same IDs
      const allAfterRun2 = repo.listAccounts({ page: 1, pageSize: 50 }).items;
      expect(allAfterRun2).toHaveLength(2);
      expect(idCounter).toBe(2); // No new IDs created!

      const items2 = accountService.list({ page: 1, pageSize: 50 }).items;
      const knownAfter2 = items2.find((i) => i.id === 'acc-pasted-1');
      expect(knownAfter2?.passwordCapcut).toBe(knownPassword);

      const newAfter2 = items2.find((i) => i.id === 'acc-pasted-2');
      expect(newAfter2?.passwordCapcut).toBe('BrandNewSecret%789');
      const rawNew2 = repo.getAccountById('acc-pasted-2');
      expect(rawNew2?.emailPasswordEncrypted).toBeNull();
    } finally {
      db.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
