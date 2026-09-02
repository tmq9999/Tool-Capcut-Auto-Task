import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
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
import { registerLogsIpc } from './ipc/logsIpc';
import { registerAutomationIpc } from './ipc/automationIpc';
import { IPC_EVENTS } from '../shared/contracts/ipc-channels';
import {
  createProviderStack,
  createProviderStackRepositories,
  type ProviderStack
} from './runtime/providerStack';
import { createShutdownManager, type SafeDiagnosticLogger, type ShutdownManager } from './lifecycle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.getName());
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
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0F1115',
    title: 'AutoManager Enterprise',
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

app.whenReady().then(() => {
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
      providerStack.logBus.dispose();
    };

    // 4. Register Baseline & Settings IPC handlers
    currentStage = 'IPC_REGISTRATION';
    const cleanupBaselineIpc = registerBaselineIpc(ipcMain);
    const cleanupSettingsIpc = registerSettingsIpc(ipcMain, settingsService, serviceConnectionManager);
    const cleanupAccountsIpc = registerAccountsIpc(ipcMain, providerStack.accountService);
    const cleanupLogsIpc = registerLogsIpc(ipcMain, logRepo);
    const cleanupAutomationIpc = registerAutomationIpc(
      ipcMain,
      providerStack.automationRunService,
      providerStack.emailPurchaseService
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
      db: dbInstance,
      app,
      logger: staticLogger,
      timeoutMs: 2000,
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
        shutdownManager.handleBeforeQuit(event);
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
  } catch {
    process.stderr.write(`[MAIN_INIT_FAILED] ${currentStage}\n`);
    if (dbInstance && dbInstance.open) {
      try {
        dbInstance.close();
      } catch {
        process.stderr.write('[MAIN_INIT_CLEANUP_FAILED] DB_CLOSE\n');
      }
    }
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
