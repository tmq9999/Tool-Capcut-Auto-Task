import type Database from 'better-sqlite3';
import { FetchHttpClient, type HttpClient } from '../providers/HttpClient';
import {
  ObservedHttpClient,
  type HttpObservationSink,
  type ObservationScope
} from '../providers/ObservedHttpClient';
import { MultiloginProvider } from '../providers/MultiloginProvider';
import { KiotProxyProvider } from '../providers/KiotProxyProvider';
import { Gmail94Provider } from '../providers/Gmail94Provider';
import { DongVanFBProvider } from '../providers/DongVanFBProvider';
import { CustomDomainMailProvider } from '../providers/CustomDomainMailProvider';
import {
  DongVanFBConnectivity,
  Gmail94Connectivity,
  KiotProxyConnectivity,
  MultiloginConnectivity
} from '../providers/connectivity';
import { CredentialRepository } from '../repositories/CredentialRepository';
import { SettingsRepository } from '../repositories/SettingsRepository';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings/default-settings';
import { AccountRepository } from '../repositories/AccountRepository';
import { AccountTaskRepository } from '../repositories/AccountTaskRepository';
import { LogRepository } from '../repositories/LogRepository';
import { PurchasedEmailRepository } from '../repositories/PurchasedEmailRepository';
import { ProxyLeaseRepository } from '../repositories/ProxyLeaseRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import { SecretReader } from '../services/SecretReader';
import { MultiloginAuthService } from '../services/MultiloginAuthService';
import { ProxyLeaseManager } from '../services/ProxyLeaseManager';
import { LazyProxyLeaseSource } from '../services/LazyProxyLeaseSource';
import { EmailPurchaseService } from '../services/EmailPurchaseService';
import type { DiagnosticMutationContext } from '../services/EmailPurchaseService';
import { AccountService } from '../services/AccountService';
import { LogBus } from '../services/LogBus';
import { AutomationRunService } from '../services/AutomationRunService';
import { createAutomationWorkSourceFactory } from '../services/AutomationWorkSource';
import { CapcutEngineService } from '../services/CapcutEngineService';
import {
  createBrowserLauncher,
  isBrowserLauncherKind,
  type BrowserLauncher
} from '../services/capcut/launcher';
import { ProviderRegistry, type ConnectivityProvider } from '../services/ProviderRegistry';
import {
  DispatchingBrowserRuntime,
  MultiloginBrowserRuntime,
  UnsupportedBrowserRuntime
} from '../services/browserRuntime';
import {
  AutomationTerminalError
} from '../services/AutomationTerminalError';
import type {
  HttpOnlyAccountRunner,
  IBrowserRuntimeApi,
  ICapcutTaskProgressSink
} from '../services/AutomationRunService';

export interface ProviderStackRepositories {
  credentialRepo: CredentialRepository;
  settingsRepo: SettingsRepository;
  accountRepo: AccountRepository;
  logRepo: LogRepository;
  purchasedEmailRepo: PurchasedEmailRepository;
  proxyLeaseRepo: ProxyLeaseRepository;
  /** Tiến độ từng nhiệm vụ CapCut của mỗi account (migration 004). */
  accountTaskRepo: AccountTaskRepository;
}

export interface ProviderStack {
  logBus: LogBus;
  accountService: AccountService;
  emailPurchaseService: EmailPurchaseService;
  automationRunService: AutomationRunService;
  multiloginAuth: MultiloginAuthService;
  providerRegistry: ProviderRegistry;
  repositories: ProviderStackRepositories;
}

export function createProviderStackRepositories(db: Database.Database): ProviderStackRepositories {
  return {
    credentialRepo: new CredentialRepository(db),
    settingsRepo: new SettingsRepository(db),
    accountRepo: new AccountRepository(db),
    logRepo: new LogRepository(db),
    purchasedEmailRepo: new PurchasedEmailRepository(db),
    proxyLeaseRepo: new ProxyLeaseRepository(db),
    accountTaskRepo: new AccountTaskRepository(db)
  };
}

export function createTaskProgressSink(
  repo: Pick<AccountTaskRepository, 'recordCheckpoint' | 'upsertMany'> & Partial<Pick<AccountTaskRepository, 'recordUnsettledProofs'>>
): ICapcutTaskProgressSink {
  return {
    record: async (accountId, checkpoint) => {
      try {
        repo.recordCheckpoint(accountId, {
          rows: checkpoint.rows,
          unsettledProofs: checkpoint.unsettledProofs,
          receipt: {
            runId: checkpoint.receipt.runId,
            sessionAlias: checkpoint.receipt.sessionAlias,
            observedAt: checkpoint.receipt.observedAt,
            requiredAfter: checkpoint.receipt.requiredAfter,
            serverTotal: checkpoint.receipt.serverTotal,
            serverDone: checkpoint.receipt.serverDone,
            isFresh: checkpoint.receipt.fresh,
            isFinal: checkpoint.receipt.final
          }
        });
      } catch (error: unknown) {
        const cause = error instanceof Error ? error : new Error('TASK_CHECKPOINT_RECORD_FAILED');
        throw new AutomationTerminalError(
          'failed',
          { code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED' },
          'Không lưu được checkpoint nhiệm vụ.',
          cause
        );
      }
    },
    recordUnsettled: async (accountId, runId, proofs) => {
      if (typeof repo.recordUnsettledProofs !== 'function') {
        throw new AutomationTerminalError(
          'failed',
          {
            code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED',
            details: { failure: 'ACK_PROOF_PERSISTENCE_FAILED' }
          },
          'Không lưu được bằng chứng nhiệm vụ đã được xác nhận.',
          new Error('MISSING_RECORD_UNSETTLED_PROOFS')
        );
      }
      try {
        repo.recordUnsettledProofs(accountId, runId, proofs);
      } catch (error: unknown) {
        const cause = error instanceof Error ? error : new Error('UNSETTLED_PROOFS_RECORD_FAILED');
        throw new AutomationTerminalError(
          'failed',
          {
            code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED',
            details: { failure: 'ACK_PROOF_PERSISTENCE_FAILED' }
          },
          'Không lưu được bằng chứng nhiệm vụ đã được xác nhận.',
          cause
        );
      }
    },
    recordLegacy: (accountId, rows) => {
      repo.upsertMany(accountId, rows);
    }
  };
}

/**
 * Composition root for the provider layer. Wires the four implemented vendors
 * (Multilogin, KiotProxy, Gmail94, DongVanFB) into the services the IPC layer
 * exposes. Browsers and services that are not implemented yet are deliberately
 * left out of the registry, which makes Settings report them as unsupported
 * rather than pretending they work.
 */
export interface ProviderStackOptions {
  /**
   * `app.getPath('userData')`. Có thì engine automation CapCut được bật: luồng
   * chạy nhiệm vụ thật thay vì chỉ giữ browser. Không truyền (test, script) thì
   * hành vi giữ đúng như trước khi gộp.
   */
  userDataDir?: string;
  /** Explicit HTTP-only composition; absent means HTTP-only runs fail closed. */
  httpOnlyRunner?: HttpOnlyAccountRunner;
  /** Opt-in sanitized provider HTTP metadata sink. No sink means no decorator. */
  httpObserver?: HttpObservationSink;
  /** Explicit durable purchase/acquisition fence; omitted for legacy callers. */
  mutationContext?: DiagnosticMutationContext;
}

export function createProviderStack(
  repositories: ProviderStackRepositories,
  vault: ICredentialVault,
  http?: HttpClient,
  options: ProviderStackOptions = {}
): ProviderStack {
  let observation: ObservationScope | undefined;
  let providerHttp: HttpClient;
  if (options.httpObserver) {
    let captureResponseHeaders = (_metadata: { status: number; ok: boolean }): void => {};
    const transport = http ?? new FetchHttpClient(
      globalThis.fetch,
      (metadata) => captureResponseHeaders(metadata)
    );
    const observed = new ObservedHttpClient(transport, options.httpObserver);
    captureResponseHeaders = (metadata) => observed.captureResponseHeaders(metadata);
    observation = observed;
    providerHttp = observed;
  } else {
    providerHttp = http ?? new FetchHttpClient();
  }
  const secrets = new SecretReader(repositories.credentialRepo, vault);

  const multiloginProvider = new MultiloginProvider(providerHttp);
  const kiotProxyProvider = new KiotProxyProvider(providerHttp);
  const gmail94Provider = new Gmail94Provider(providerHttp);
  const dongVanFBProvider = new DongVanFBProvider(providerHttp);
  const customDomainProvider = new CustomDomainMailProvider(providerHttp);

  const multiloginAuth = new MultiloginAuthService(
    repositories.credentialRepo,
    vault,
    multiloginProvider,
    undefined,
    observation
  );

  const logBus = new LogBus(
    repositories.logRepo,
    {},
    {
      onPersistenceNotice: ({ kind, pending }) => {
        console.error('[LogPersistence]', kind, 'pending=' + pending);
      }
    }
  );
  const activeServiceHolder: { current: AutomationRunService | null } = { current: null };
  const accountService = new AccountService(repositories.accountRepo, vault, {
    isAccountActive: (accountId) => activeServiceHolder.current?.isAccountActive(accountId) ?? false
  });

  const emailPurchaseService = new EmailPurchaseService(
    repositories.credentialRepo,
    repositories.purchasedEmailRepo,
    vault,
    { gmail94: gmail94Provider, dongvanfb: dongVanFBProvider, customdomain: customDomainProvider },
    {
      // Read fresh each time so editing the domain in Settings takes effect at once.
      customEmail: () => {
        try {
          return repositories.settingsRepo.getAppSettings()?.customEmail ?? DEFAULT_APP_SETTINGS.customEmail;
        } catch {
          return DEFAULT_APP_SETTINGS.customEmail;
        }
      },
      observation,
      mutationContext: options.mutationContext
    }
  );

  const proxySource = new LazyProxyLeaseSource(secrets, (options) =>
    new ProxyLeaseManager(kiotProxyProvider, repositories.proxyLeaseRepo, options, { observation })
  );

  const browserRuntimes = new Map<string, IBrowserRuntimeApi>([
    ['multilogin', new MultiloginBrowserRuntime(multiloginAuth, multiloginProvider)],
    ['gologin', new UnsupportedBrowserRuntime('GoLogin')],
    ['gpm', new UnsupportedBrowserRuntime('GPM Login')],
    ['camoufox', new UnsupportedBrowserRuntime('Camoufox')],
    ['patchright', new UnsupportedBrowserRuntime('Patchright')]
  ]);

  /**
   * Đường mở profile đọc LẠI mỗi lượt chạy, y như `customEmail` ở trên: đổi
   * `launcher` trong Settings là có tác dụng ngay, không cần khởi động lại app.
   */
  const launcherFactory = (): BrowserLauncher | null => {
    let kind: unknown = DEFAULT_APP_SETTINGS.browser.multilogin.launcher;
    try {
      kind = repositories.settingsRepo.getAppSettings()?.browser.multilogin.launcher ?? kind;
    } catch {
      // Đọc settings lỗi thì dùng mặc định, không làm vỡ cả lượt chạy.
    }
    if (!isBrowserLauncherKind(kind)) return null;
    return createBrowserLauncher(kind, {
      log: (message) => logBus.emit({ email: 'system', step: 'Browser', status: 'INFO', message }),
      multilogin: { auth: multiloginAuth, api: multiloginProvider }
    });
  };

  const workSources = createAutomationWorkSourceFactory(
    emailPurchaseService,
    (id) => accountService.getAutomationCredential(id),
    observation
  );
  const automationRunService = new AutomationRunService({
    workSources,
    emailOtp: emailPurchaseService,
    proxies: proxySource,
    browser: new DispatchingBrowserRuntime(browserRuntimes),
    accounts: accountService,
    logBus,
    logReset: logBus,
    launcher: launcherFactory,
    // Chưa có `userDataDir` (test, script) thì không bật engine: luồng giữ browser
    // như trước, không có đường nào tự ý chạy nhiệm vụ thật.
    capcut: options.userDataDir
      ? new CapcutEngineService({ userDataDir: options.userDataDir })
      : undefined,
    httpOnlyRunner: options.httpOnlyRunner,
    taskProgress: createTaskProgressSink(repositories.accountTaskRepo),
    observation,
    mutationContext: options.mutationContext
  }, { userDataDir: options.userDataDir });
  activeServiceHolder.current = automationRunService;

  const providerRegistry = new ProviderRegistry(
    new Map<string, () => ConnectivityProvider>([
      ['gmail94', () => new Gmail94Connectivity(secrets, gmail94Provider)],
      ['dongvanfb', () => new DongVanFBConnectivity(secrets, dongVanFBProvider)],
      ['kiotproxy', () => new KiotProxyConnectivity(secrets, kiotProxyProvider)],
      ['multilogin', () => new MultiloginConnectivity(multiloginAuth, multiloginProvider)]
    ])
  );

  return {
    logBus,
    accountService,
    emailPurchaseService,
    automationRunService,
    multiloginAuth,
    providerRegistry,
    repositories
  };
}
