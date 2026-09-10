import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from './database/connection';
import { runMigrations } from './database/migrator';
import { SettingsRepository } from './repositories/SettingsRepository';
import type { CredentialRepository } from './repositories/CredentialRepository';
import type { AccountRepository } from './repositories/AccountRepository';
import type { LogRepository } from './repositories/LogRepository';
import { CredentialVault } from './security/CredentialVault';
import { DatabaseTransactionRunner } from './database/transaction';
import { ServiceConnectionManager } from './services/ServiceConnectionManager';
import { SettingsService } from './services/SettingsService';
import { registerBaselineIpc } from './ipc/registerIpc';
import { registerSettingsIpc } from './ipc/settingsIpc';
import { registerAccountsIpc } from './ipc/accountsIpc';
import { AccountExportService } from './services/AccountExportService';
import { AccountTaskService } from './services/AccountTaskService';
import { registerLogsIpc } from './ipc/logsIpc';
import { registerAutomationIpc } from './ipc/automationIpc';
import { IPC_EVENTS } from '../shared/contracts/ipc-channels';
import {
  createProviderStack,
  createProviderStackRepositories,
  type ProviderStack
} from './runtime/providerStack';
import { runLogRetentionCleanup } from './runtime/logRetention';
import { createShutdownManager, type SafeDiagnosticLogger, type ShutdownManager } from './lifecycle';
import { startPrimaryInstance } from './singleInstance';
import { recoverStaleEmailReservations } from './startupRecovery';
import { configureRolloutUserData } from './rolloutUserData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure rollout user data directory before any storage or windows are opened
configureRolloutUserData(app);

app.setName('CapCut Automation');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.capcut.automation');
}

export type MainInitStage =
  | 'DB_CONNECT'
  | 'MIGRATIONS'
  | 'REPOSITORIES_AND_VAULT'
  | 'IPC_REGISTRATION'
  | 'LIFECYCLE_REGISTRATION'
  | 'WINDOW_CREATE';

export interface MainAppContext {
  db: Database.Database;
  settingsRepo: SettingsRepository;
  credentialRepo: CredentialRepository;
  accountRepo: AccountRepository;
  logRepo: LogRepository;
  credentialVault: CredentialVault;
  transactionRunner: DatabaseTransactionRunner;
  serviceConnectionManager: ServiceConnectionManager;
  settingsService: SettingsService;
  providerStack: ProviderStack;
}

let mainWindow: BrowserWindow | null = null;
let appContext: MainAppContext | null = null;
let cleanupIpc: (() => void) | null = null;
let cleanupSubscriptions: (() => void) | null = null;
let shutdownManager: ShutdownManager | null = null;

/** Pushes a payload to the renderer, tolerating a window that is gone. */
function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

export function getAppContext(): MainAppContext | null {
  return appContext;
}

const staticLogger: SafeDiagnosticLogger = {
  error: (code, message) => {
    // Redacted static diagnostic logging
    process.stderr.write(`[MAIN_LIFECYCLE_ERROR] ${code}: ${message}\n`);
  }
};

function createWindow(): void {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '../build/icon.ico')
    : path.join(__dirname, '../build/icon.png');

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0F1115',
    title: 'CapCut Automation',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    autoHideMenuBar: true,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initializePrimaryInstance(): void {
  let dbInstance: Database.Database | null = null;
  let currentStage: MainInitStage = 'DB_CONNECT';
  try {
    // 1. Initialize SQLite Database in Electron userData directory
    currentStage = 'DB_CONNECT';
    const dbPath = path.join(app.getPath('userData'), 'automanager.db');
    dbInstance = createDatabaseConnection(dbPath);

    // 2. Run bundled migrations synchronously with transaction atomicity
    currentStage = 'MIGRATIONS';
    runMigrations(dbInstance);

    // 3. Instantiate domain repositories, CredentialVault, transaction runner, and application services
    currentStage = 'REPOSITORIES_AND_VAULT';
    const settingsRepo = new SettingsRepository(dbInstance);
    const credentialVault = new CredentialVault(safeStorage);
    const transactionRunner = new DatabaseTransactionRunner(dbInstance);

    const stackRepositories = createProviderStackRepositories(dbInstance);
    recoverStaleEmailReservations(stackRepositories.purchasedEmailRepo, (msg) => {
      process.stderr.write(msg + '\n');
    });

    const providerStack = createProviderStack(stackRepositories, credentialVault, undefined, {
      userDataDir: app.getPath('userData')
    });
    const credentialRepo = stackRepositories.credentialRepo;
    const accountRepo = stackRepositories.accountRepo;
    const logRepo = stackRepositories.logRepo;

    const serviceConnectionManager = new ServiceConnectionManager(
      credentialRepo,
      credentialVault,
      providerStack.providerRegistry,
      { now: () => Date.now() },
      (statuses) => sendToRenderer(IPC_EVENTS.SERVICE_STATUS, statuses)
    );
    const settingsService = new SettingsService(
      settingsRepo,
      credentialRepo,
      transactionRunner,
      credentialVault,
      serviceConnectionManager
    );

    appContext = {
      db: dbInstance,
      settingsRepo,
      credentialRepo,
      accountRepo,
      logRepo,
      credentialVault,
      transactionRunner,
      serviceConnectionManager,
      settingsService,
      providerStack,
    };

    // Stream runtime logs and run progress to the renderer, and start the
    // batched SQLite writer for logs.
    const unsubscribeLogs = providerStack.logBus.subscribe((entry) => {
      sendToRenderer(IPC_EVENTS.LOG_ENTRY, entry);
    });
    const unsubscribeProgress = providerStack.automationRunService.subscribe((progress) => {
      sendToRenderer(IPC_EVENTS.RUN_PROGRESS, progress);
    });
    providerStack.logBus.start();
    cleanupSubscriptions = () => {
      unsubscribeLogs();
      unsubscribeProgress();
    };

    /**
     * Dọn log quá hạn — AGENTS.md §18. Chạy SAU `logBus.start()` để dòng tổng kết
     * được ghi xuống DB, và trước khi mở cửa sổ.
     *
     * `runLogRetentionCleanup` không bao giờ ném: dọn log là việc dọn dẹp, không
     * phải điều kiện để app mở được (xem `runtime/logRetention.ts`).
     */
    runLogRetentionCleanup({
      repositories: {
        logRepo: providerStack.repositories.logRepo,
        settingsRepo: providerStack.repositories.settingsRepo
      },
      logBus: providerStack.logBus
    });

    /**
     * Xuất account: hộp thoại lưu file là API của Electron nên khoá `dialog` được
     * bơm từ đây, còn service ở `services/AccountExportService.ts` không biết gì
     * về Electron (nhờ vậy test chạy được bằng Node thuần).
     *
     * KHÔNG ghi runtime log cho lượt xuất: `RuntimeLog` bắt buộc có `email` của
     * một account (AGENTS §16), một lượt xuất N account không thuộc account nào.
     */
    const accountExportService = new AccountExportService(accountRepo, credentialVault, {
      chooseSavePath: async (suggestedFileName: string) => {
        const extension = path.extname(suggestedFileName).replace('.', '') || 'txt';
        const result = await dialog.showSaveDialog({
          title: 'Xuất danh sách tài khoản',
          defaultPath: path.join(app.getPath('downloads'), suggestedFileName),
          filters: [
            { name: extension.toUpperCase(), extensions: [extension] },
            { name: 'Tất cả', extensions: ['*'] }
          ]
        });
        return result.canceled || !result.filePath ? null : result.filePath;
      }
    });

    // 4. Register Baseline & Settings IPC handlers
    currentStage = 'IPC_REGISTRATION';
    const cleanupBaselineIpc = registerBaselineIpc(ipcMain);
    const cleanupSettingsIpc = registerSettingsIpc(ipcMain, settingsService, serviceConnectionManager);
    const cleanupAccountsIpc = registerAccountsIpc(
      ipcMain,
      providerStack.accountService,
      accountExportService,
      new AccountTaskService(providerStack.repositories.accountTaskRepo)
    );
    const cleanupLogsIpc = registerLogsIpc(ipcMain, logRepo, providerStack.logBus);
    const cleanupAutomationIpc = registerAutomationIpc(
      ipcMain,
      providerStack.automationRunService,
      providerStack.emailPurchaseService,
      logRepo
    );

    cleanupIpc = () => {
      cleanupBaselineIpc();
      cleanupSettingsIpc();
      cleanupAccountsIpc();
      cleanupLogsIpc();
      cleanupAutomationIpc();
    };

    // 5. Instantiate and attach Shutdown Lifecycle Manager
    currentStage = 'LIFECYCLE_REGISTRATION';
    shutdownManager = createShutdownManager({
      automation: providerStack.automationRunService,
      db: dbInstance,
      logBus: {
        flush: async () => {
          providerStack.logBus.dispose();
        }
      },
      app,
      logger: staticLogger,
      automationTimeoutMs: 15_000,
      logFlushTimeoutMs: 2_000,
    });

    app.on('before-quit', (event) => {
      if (cleanupIpc) {
        cleanupIpc();
        cleanupIpc = null;
      }
      if (cleanupSubscriptions) {
        cleanupSubscriptions();
        cleanupSubscriptions = null;
      }
      if (shutdownManager) {
        void shutdownManager.handleBeforeQuit(event);
      }
    });

    // 6. Create application window
    currentStage = 'WINDOW_CREATE';
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (err: unknown) {
    /**
     * PHẢI in nguyên nhân, không chỉ in tên bước (AGENTS.md §27).
     *
     * Bản cũ là `catch {}` trơn: bản đóng gói 04/09/2026 chết với đúng một dòng
     * `[MAIN_INIT_FAILED] DB_CONNECT` và không có cách nào biết vì sao —
     * `better-sqlite3` không load được, sai đường dẫn DB, hay quyền ghi, ba
     * nguyên nhân đó cần ba cách sửa khác nhau. Ở đây không có secret nào:
     * `currentStage` là hằng trong code, còn message là lỗi native/đường dẫn.
     */
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[MAIN_INIT_FAILED] ${currentStage}: ${message}\n`);
    if (err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    if (dbInstance && dbInstance.open) {
      try {
        dbInstance.close();
      } catch {
        process.stderr.write('[MAIN_INIT_CLEANUP_FAILED] DB_CLOSE\n');
      }
    }
    app.exit(1);
  }
}

startPrimaryInstance(app, () => mainWindow, () => {
  void app.whenReady().then(() => {
    initializePrimaryInstance();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
