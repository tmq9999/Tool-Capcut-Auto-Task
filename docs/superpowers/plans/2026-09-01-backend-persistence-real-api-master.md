# Master Implementation Plan: Backend Persistence & Real API Service Integration

**Document Status:** APPROVED — READY FOR PHASE PLANNING  
**File Location:** `docs/superpowers/plans/2026-09-01-backend-persistence-real-api-master.md`  
**Target Application:** AutoManager Enterprise Desktop (`Capcut AutoManager`)  
**Architecture Policy:** Strict compliance with [`AGENTS.md`](file:///d:/GeminiWorkspaceNew/ToolCapCut/AGENTS.md)  
**Execution Mode:** PLAN-ONLY (Master Plan Document Write)

---

> [!IMPORTANT]
> **Planning & Execution Protocol:**  
> This Master Plan is the binding architectural roadmap. Following the Superpowers methodology, **each individual phase (Phase 0, 1, 2, 3, 4) and vertical slice will receive its own dedicated, bite-sized TDD implementation plan** before any code changes or dependency installations take place.

---

## 1. Current-State Evidence (Codebase Fact Check)

The following facts have been verified by inspecting the repository:

| File / Component | Verified Repository State | Architectural Reality & Required Action |
| :--- | :--- | :--- |
| [`package.json`](file:///d:/GeminiWorkspaceNew/ToolCapCut/package.json) | React 19.1, TypeScript 5.8, Electron 35.0, Vite 6.2. Scripts: `"dev"`, `"build"`, `"lint"`, `"preview"`. | No persistent database (`better-sqlite3` absent). No test runner (`vitest` absent). No runtime validator (`zod` absent). No native rebuild tooling. |
| [`src/main/main.ts`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/main/main.ts) | Electron `BrowserWindow` with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. | No database connection factory. No IPC handlers registered. `CredentialVault` not instantiated. No clean shutdown lifecycle. |
| [`src/preload/preload.ts`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/preload/preload.ts) | Exposes minimal object: `{ platform: process.platform, version: '2.4.0' }`. | Missing typed IPC context bridges for Settings, Credentials, Accounts, Logs, and Services. |
| [`src/shared/contracts/api.ts`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/shared/contracts/api.ts) | Minimal `ElectronBridge` placeholder interface. | Missing typed domain-specific request/response IPC contracts. |
| [`src/shared/types/account.ts`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/shared/types/account.ts) | Contains `password`, `provider`, `fullData`, `browserProfile`, and persistent `stt`. | Conflates runtime `status` and `automationStep`. Secrets are plaintext. `stt` should be derived in UI. |
| [`src/shared/types/log.ts`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/shared/types/log.ts) | `RuntimeLog` uses local `time: string` and unnormalized statuses (`WARN`, `OK`). | Violates Section 16 of `AGENTS.md`. Lacks canonical `createdAt` ISO UTC timestamp and 6 canonical statuses. |
| [`src/shared/types/settings.ts`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/shared/types/settings.ts) | `AppSettings` directly contains plaintext `apiKey`, `password`. | Violates Section 13 of `AGENTS.md`. Decrypted secrets are embedded in general settings. |
| [`src/shared/types/services.ts`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/shared/types/services.ts) | Hardcoded boolean statuses (`multiloginConnected: boolean`). | Missing timestamped diagnostic metadata (`lastTestedAt`, `lastTestResult`, stale state semantics). |
| `src/renderer/mocks/*` | Static mock datasets for accounts, logs, settings, and status indicators. | Production mock data must be progressively removed slice-by-slice once backed by SQLite. |

---

## 2. Goals and Explicit Non-Goals

### Core Goals (In-Scope)
1. **Contract Freeze & Runtime Schemas**: Establish canonical domain models, non-secret DTOs, Zod runtime validation guards for all IPC/external boundaries, small capability-specific provider interfaces, and typed IPC channel contracts.
2. **Persistence & Security Foundation**: Implement SQLite via `better-sqlite3` with Write-Ahead Logging (WAL), versioned transactional migrations, isolated Repositories, and an Electron `safeStorage`-backed `CredentialVault` with strictly fail-closed semantics.
3. **Local Application Data Slices**: Incrementally deliver 4 vertical slices (Settings & Credentials ➔ Accounts ➔ Runtime Logs ➔ Account Export) wired directly to the React UI, eliminating production persistence and diagnostic mock data per slice.
4. **Sequential Provider Integrations**: Build 6 external service adapters (Gmail94, Multilogin, KiotProxy, DongVanFB, GPM Login, GoLogin) one by one, each verified through deterministic unit tests and safe, read-only smoke tests.
5. **Hardening & Verification**: Validate type safety, linting, migration transactions, secret redaction, and separate verification across Node, Electron, and UI runtime lanes.

### Explicit Non-Goals (Strictly Forbidden in this Phase)
- **NO Automation Core**: No registration workflows, OTP auto-fill scripts, payment engines, or CapCut account creation runners.
- **NO Browser Automation Orchestration**: No Playwright/Puppeteer/Selenium script automation executing browser actions.
- **NO Simulated Automation in Dashboard**: Dashboard "Start All" / "Stop All" buttons will be disabled with a transparent tooltip/badge stating that the automation engine is scheduled for a subsequent phase; they must not simulate active running states or emit fake progress.
- **NO Plaintext Secret Exposure**: No decryption or clipboard copying of account passwords in the Renderer.
- **NO New Pages or Navigation**: No new sidebar routes, System Health monitors, Cluster nodes, or analytics dashboards.
- **NO Visual Redesign**: Dashboard visual tokens, component hierarchy, and layout remain strictly preserved as implemented.

---

## 3. Architecture, Layering & Security Boundaries

Tuân thủ nghiêm ngặt mô hình **Dependency Inward** theo Mục 6 & 7 của `AGENTS.md`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             RENDERER PROCESS (React 19)                     │
│  - Receives only non-secret DTOs and masked credential hints                │
│  - Never imports better-sqlite3, fs, or Node runtime modules                │
│  - Never accesses raw decrypted credentials (Write-Only Edit Semantics)     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ window.electronAPI (Strictly Typed)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                              PRELOAD BRIDGE (Context Isolation)             │
│  - Exposes narrow, typed domain methods (settings, accounts, logs, services)│
│  - Never exposes raw ipcRenderer.send / ipcRenderer.invoke                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Typed IPC Channels
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                           MAIN PROCESS (Electron Main)                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ IPC Handlers with Runtime Validation (Zod Schemas)                    │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │ Application Services (Business Logic & Orchestration):                │  │
│  │ - SettingsService      - AccountService                               │  │
│  │ - LogService (LogBus)  - ExportService                                │  │
│  │ - ServiceConnectionManager                                            │  │
│  └───────┬───────────────────────────┬───────────────────────────┬───────┘  │
│          │                           │                           │          │
│          │ uses                      │ uses                      │ uses     │
│  ┌───────▼──────────────────┐ ┌──────▼──────────────────────┐ ┌──▼───────┐  │
│  │ Security Subsystem:      │ │ Repositories (Data Access): │ │ External │  │
│  │ - CredentialVault        │ │ - SettingsRepository        │ │ Provider │  │
│  │   (safeStorage post-     │ │ - CredentialRepository      │ │ Adapters:│  │
│  │    app.whenReady, strictly│ │ - AccountRepository         │ │ 1..6     │  │
│  │    fail-closed)          │ │ - LogRepository             │ └────┬─────┘  │
│  └──────────────────────────┘ └──────────────┬──────────────┘      │        │
└──────────────────────────────────────────────┼─────────────────────┼────────┘
                                               │                     │
┌──────────────────────────────────────────────▼────┐ ┌──────────────▼────────┐
│   SQLite Database (userData/automanager.db)       │ │ External Service APIs │
│   - WAL Mode, Foreign Keys ON, busy_timeout=5000  │ │ (Read-only smoke test)│
│   - Tables: app_settings, service_credentials,    │ └───────────────────────┘
│     accounts, runtime_logs, schema_migrations     │
└───────────────────────────────────────────────────┘
```

### Layering Rules (Strictly Enforced)
1. **IPC handlers MUST NEVER call Repositories directly**. Every IPC invocation delegates to an Application Service.
2. **`CredentialVault` is an application security dependency**, consumed by `SettingsService`, `AccountService`, `ExportService`, and `ServiceConnectionManager`. It is **not** nested inside repositories.
3. **`SettingsService` Coordination & Failure Atomicity**:
   - `SettingsService` coordinates `SettingsRepository` (for non-secret settings), `CredentialVault` (for encryption), `CredentialRepository` (for storing encrypted BLOBs and metadata), and `ServiceConnectionManager` (for updating diagnostic cache).
   - **Partial Failure Handling**: If credential encryption/persistence fails while updating settings, the operation rolls back or returns a structured error, preventing desynchronization between settings and credentials.
4. **Secret Isolation**: Decrypted credentials exist exclusively in Main Process memory during active provider operations and deliberate export; they are never returned to Renderer React state.

---

## 4. Complete Production Mock-Removal Map

| UI Surface / Component | Current Mock Data Usage | Replacement Architecture | Milestone / Slice |
| :--- | :--- | :--- | :--- |
| **Settings Page** ([`SettingsPage.tsx`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/renderer/pages/Settings/SettingsPage.tsx)) | `initialMockSettings` | `SettingsService.getSettings()` returning `AppSettingsDTO` + masked credential status. Saves via `SettingsService.saveSettings()`. | Slice 2.1 |
| **Accounts Page** ([`AccountsPage.tsx`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/renderer/pages/Accounts/AccountsPage.tsx)) | `initialMockAccounts` | `AccountService.listAccounts(filters)` backed by `AccountRepository`. | Slice 2.2 |
| **Dashboard Table** ([`DashboardPage.tsx`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/renderer/pages/Dashboard/DashboardPage.tsx)) | `initialMockAccounts` | Shared `AccountService.listAccounts()` feeding both Accounts & Dashboard mini-grid from SQLite. | Slice 2.2 |
| **Password Columns** (Accounts & Dashboard) | Plaintext mock passwords | Replaced with masked representation (`••••••••` / `Configured`). **No reveal or clipboard copying allowed**. | Slice 2.2 |
| **Logs Page** ([`LogsPage.tsx`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/renderer/pages/Logs/LogsPage.tsx)) | `initialMockLogs` | `LogService.queryLogs(filters)` backed by `LogRepository`. | Slice 2.3 |
| **Docked Live Logs** ([`DockedLiveLogs.tsx`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/renderer/pages/Dashboard/DockedLiveLogs.tsx)) | `initialMockLogs` | Real-time IPC event stream `logs:on-entry` from `LogBus`. | Slice 2.3 |
| **Status Bar** ([`StatusBar.tsx`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/renderer/layouts/StatusBar.tsx)) | Hardcoded connected flags | Initialized to `'unknown'`. Receives cached timestamped diagnostics from `ServiceConnectionManager`. | Slice 2.1 / Phase 3 |
| **Export Dialog** ([`ExportDialog.tsx`](file:///d:/GeminiWorkspaceNew/ToolCapCut/src/renderer/pages/Accounts/ExportDialog.tsx)) | Frontend mock export generation | `ExportService.exportAccounts()` streaming directly to disk from Main Process. | Slice 2.4 |
| **Dashboard Automation Controls** | Simulated start/stop state | Controls explicitly disabled with badge: *"Automation engine scheduled for subsequent milestone"*. | Slice 2.2 |

---

## 5. Phase 0–4 Implementation Plan

---

### 🔷 PHASE 0 — Contract Freeze & Runtime Schemas

#### 1. Scope
Define canonical domain models, Zod runtime validation schemas for every IPC and external boundary, non-secret DTOs, discriminated union credential validation schemas, minimal provider connectivity contracts, sanitized diagnostic structures, and typed IPC channel contracts in `src/shared/`.

#### 2. Explicit Non-Goals
No database creation, no service calls, no UI modifications.

#### 3. Ordered Tasks
- [ ] **Task 0.1: Domain Models (`src/shared/types/domain.ts`)**:
  - `AccountDomain`: `id`, `email`, `emailProvider`, `credit`, `subscription`, `status` (`'active' | 'processing' | 'error' | 'disabled' | 'waiting' | 'done'`), `automationStep` (`string`), `proxy`, `browserProvider`, `browserProfileId`, `notes`, `createdAt`, `updatedAt`.
  - `AccountSecretPayload`: `emailPassword?: string`, `passwordCapcut?: string`, `emailData?: string`.
  - Derive `stt` dynamically in UI: `(pageIndex * pageSize) + index + 1`.
- [ ] **Task 0.2: Canonical Logging (`src/shared/types/canonical-log.ts`)**:
  - `CanonicalLogStatus`: `'INFO' | 'SUCCESS' | 'WARNING' | 'WAITING' | 'ERROR' | 'DEBUG'`.
  - `CanonicalRuntimeLog`: `id`, `accountId?`, `email`, `step`, `status: CanonicalLogStatus`, `message`, `createdAt: string` (ISO 8601 UTC).
  - Helper: `formatLogTime(createdAt: string) -> string` (`HH:mm:ss`).
- [ ] **Task 0.3: Non-Secret Settings DTO & Zod Schemas (`src/shared/schemas/settings.schema.ts`)**:
  - Runtime Zod schemas for: `GeneralSettingsSchema` (`theme`, `language`, `autoSaveConfig`, `sessionRestore`), `BrowserSettingsSchema` (`provider`, `gpm: { port: z.number().int().min(1).max(65535) }`, `gologin`, `multilogin`, `camoufox`, `patchright`), `ExportSettingsSchema` (`defaultFormat`, `checkedFields`, `availableFields`).
  - GPM Port is validated as non-secret configuration (integer range 1–65535, default 19995).
  - `AppSettingsDTO`: Inferred type `z.infer<typeof AppSettingsSchema>`. **Contains zero secrets**.
- [ ] **Task 0.4: Discriminated Union Credential Validation Schemas (`src/shared/schemas/credentials.schema.ts`)**:
  - `Gmail94CredentialSchema`: `{ serviceName: z.literal('gmail94'), apiKey: z.string().min(1) }`.
  - `MultiloginCredentialSchema`: `{ serviceName: z.literal('multilogin'), auth: z.discriminatedUnion('mode', [ z.object({ mode: z.literal('token'), automationToken: z.string().min(1) }), z.object({ mode: z.literal('credentials'), email: z.string().email(), password: z.string().min(1) }) ]) }`. (Rejects incomplete credentials or both token + password).
  - `KiotProxyCredentialSchema`: `{ serviceName: z.literal('kiotproxy'), apiToken: z.string().min(1) }`.
  - `DongVanFbCredentialSchema`: `{ serviceName: z.literal('dongvanfb'), apiKey: z.string().min(1) }`.
  - `GoLoginCredentialSchema`: `{ serviceName: z.literal('gologin'), apiToken: z.string().min(1) }`.
  - `SaveCredentialInputSchema`: `z.discriminatedUnion('serviceName', [...])`.
- [ ] **Task 0.5: Sanitized Diagnostic Status & Metadata Structures (`src/shared/types/diagnostics.ts`)**:
  - `DiagnosticStatus`: `'unknown' | 'testing' | 'connected' | 'degraded' | 'offline'`.
  - `SanitizedDiagnosticResult`:
    ```ts
    export interface SanitizedDiagnosticResult {
      code: 'OK' | 'AUTH_ERROR' | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'CONFIG_ERROR';
      message: string;
      timestamp: string; // ISO UTC
      details?: Record<string, string | number | boolean>; // Redacted, non-secret
    }
    ```
  - `CredentialStatusDTO`: `serviceName`, `isConfigured: boolean`, `maskedHint: string` (e.g. `gl-live-••••36a3`), `status: DiagnosticStatus`, `lastTestedAt?: string`, `lastTestResult?: SanitizedDiagnosticResult`, `balance?: number`, `balanceFetchedAt?: string`.
- [ ] **Task 0.6: Minimal Common Provider Interfaces (`src/shared/types/provider-interfaces.ts`)**:
  - `IProviderConnectivity`: `testConnection(): Promise<SanitizedDiagnosticResult>`.
  - `IBalanceProvider`: `checkBalance(): Promise<number>`.
  - `IProfileListProvider`: `listProfiles(): Promise<BaseProfileInfo[]>`.
  - `IProxyCheckProvider`: `getCurrentProxy(key: string): Promise<string>`.
- [ ] **Task 0.7: IPC Channel Contracts (`src/shared/contracts/ipc-channels.ts`)**:
  - Typed invoke/handle and event contracts for: `settings:get`, `settings:save`, `credentials:save`, `credentials:test`, `accounts:list`, `accounts:create`, `accounts:update`, `accounts:delete`, `accounts:export`, `logs:list`, `logs:clear`, `logs:stream`, `services:getStatus`, `services:on-status-changed`.

#### 4. Type Migration Matrix

| Legacy Property | Current Problem | Canonical Standardization | Migration / Display Strategy |
| :--- | :--- | :--- | :--- |
| `RuntimeLog.time` | Local string lacks date | `createdAt: string` (ISO UTC) | Stored as ISO 8601 in SQLite. Formatted via `formatLogTime(createdAt)`. |
| `LogStatus: WARN, OK` | Non-canonical | `WARNING`, `SUCCESS` | Mapped on ingestion: `WARN -> WARNING`, `OK -> SUCCESS`. UI Badge maps 1:1. |
| `Account.stt` | Persistent sequence | Derived in UI | Removed from DB schema. Derived from table row index `(pageIndex * pageSize) + index + 1`. |
| `Account.password` | Ambiguous plaintext | `password_capcut_encrypted` | Stored as BLOB in SQLite. Masked as `••••••••` in Renderer. |
| `Account.provider` | Free-form string | `email_provider: string` | Normalized to `'Gmail' \| 'DongVanFB' \| 'Custom'`. |
| `Account.fullData` | Ambiguous dump string | `email_data_encrypted` | Stored as BLOB in SQLite. Decrypted only during deliberate export workflow. |
| `Account.browserProfile` | Combined string | `browser_provider` & `browser_profile_id` | Split into two indexed columns in SQLite for efficient querying. |
| `Account.status` | Conflates status/step | `status` & `automation_step` | Split: `status: 'active'`, `automation_step: 'Waiting for OTP'`. |
| `GpmConfig.port` | Placed in credentials | Moved to non-secret settings | Validated as integer port 1–65535 in `AppSettingsDTO.browser.gpm.port`. |

#### 5. Acceptance Criteria & Completion Gate
- `tsc --noEmit` exits with 0 errors.
- All IPC boundaries backed by runtime Zod schemas.
- Existing React components compile cleanly against updated types.
- **Completion Gate**: Phase 0 domain contracts and schemas frozen before Phase 1 begins.

---

### 🔷 PHASE 1 — Persistence, Security, Typed IPC & Test Foundation

#### 1. Scope
Initialize SQLite with `better-sqlite3`, versioned migration engine, Repositories, `CredentialVault` using Electron `safeStorage` (strictly fail-closed), Preload bridge, IPC composition root, and clean shutdown lifecycle.

#### 2. Explicit Non-Goals
No external HTTP network calls. No UI integration yet. Domain-specific IPC handlers are registered alongside Application Services in Phase 2 slices.

#### 3. Ordered Tasks
- [ ] **Task 1.1: Database Connection Factory (`src/main/database/connection.ts`)**:
  - Path: `path.join(app.getPath("userData"), "automanager.db")`.
  - Enforce PRAGMAs:
    ```sql
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    ```
- [ ] **Task 1.2: Migration Engine & Initial Schema (`src/main/database/migrator.ts`)**:
  - Tracking table: `schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME NOT NULL)`.
  - Transaction atomicity: Each migration file executes inside an explicit `db.transaction()`. The version record is inserted in the **exact same transaction**.
  - Initial migration: `001_initial_schema.sql`:
    ```sql
    -- 1. Non-secret Application Settings
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Encrypted Service Credentials & Diagnostic Metadata
    CREATE TABLE IF NOT EXISTS service_credentials (
      service_name TEXT PRIMARY KEY,
      encrypted_credentials BLOB NOT NULL,
      metadata TEXT, -- Sanitized JSON containing masked hints, status, balance, last_tested_at, lastTestResult
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Accounts Storage with Encrypted Secrets
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      email_provider TEXT NOT NULL,
      email_password_encrypted BLOB,
      password_capcut_encrypted BLOB,
      email_data_encrypted BLOB,
      credit INTEGER DEFAULT 0,
      subscription TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      automation_step TEXT,
      proxy TEXT,
      browser_provider TEXT,
      browser_profile_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Query-driven indexes matching UI filters:
    CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
    CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
    CREATE INDEX IF NOT EXISTS idx_accounts_email_provider ON accounts(email_provider);
    CREATE INDEX IF NOT EXISTS idx_accounts_browser_provider ON accounts(browser_provider);

    -- 4. Canonical Runtime Logs
    CREATE TABLE IF NOT EXISTS runtime_logs (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      email TEXT NOT NULL,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );
    -- Query-driven indexes matching UI log filters:
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON runtime_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_email ON runtime_logs(email);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON runtime_logs(status);
    CREATE INDEX IF NOT EXISTS idx_logs_account_id ON runtime_logs(account_id);
    ```
- [ ] **Task 1.3: CredentialVault (`src/main/security/CredentialVault.ts`)**:
  - Strictly accessed **after Electron `app.whenReady()`**.
  - **Fail-Closed rule**: If `safeStorage.isEncryptionAvailable()` is false, throw `VaultUnavailableError`. **Never silently downgrade to custom unverified encryption**.
  - Interface `ICredentialVault` allows unit tests to inject an in-memory mock vault in the Node test lane.
- [ ] **Task 1.4: Repositories (Data Access Layer)**:
  - `SettingsRepository`: Get/Set validated non-secret JSON settings.
  - `CredentialRepository`: CRUD for `service_credentials` BLOBs and sanitized metadata.
  - `AccountRepository`: CRUD, filter queries using indexed columns.
  - `LogRepository`: Transactional `insertBatch(logs: CanonicalRuntimeLog[])`, `queryLogs(filters)`, `cleanupOldLogs(days)`. **Zero in-memory queue inside the repository**.
- [ ] **Task 1.5: Preload Bridge & IPC Composition Root**:
  - `src/preload/preload.ts`: Expose typed invoke wrappers without leaking raw `ipcRenderer`.
  - `src/main/ipc/registerIpc.ts`: Composition root to register domain handlers as they are implemented in Phase 2.
- [ ] **Task 1.6: Clean Shutdown Lifecycle Guard (`src/main/lifecycle.ts`)**:
  - Implement one-shot bounded shutdown guard:
    ```ts
    let isShuttingDown = false;
    app.on('before-quit', async (event) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      event.preventDefault();
      try {
        await logBus.flushWithTimeout(2000);
        dbConnection.close();
      } finally {
        app.quit();
      }
    });
    ```

#### 4. Acceptance Criteria & Completion Gate
- **Node Test Lane (`npm run test`)**:
  - Database initialization applies `001_initial_schema.sql` on empty DB.
  - Migration transactions insert version record atomically; failed migration rolls back.
  - Reopen persistence: Data survives connection close and reopen.
  - Repository CRUD operations succeed with query-driven indexes.
- **Electron Runtime Lane (`npm run dev` smoke)**:
  - Native `better-sqlite3` loads inside Electron process after rebuild.
  - `CredentialVault` encrypts/decrypts via real `safeStorage` post-`app.whenReady()`.
  - `CredentialVault` throws `VaultUnavailableError` when encryption is unavailable.
  - Preload bridge blocks access to Node primitives.
- **Completion Gate**: All Lane 1 and Lane 2 checks verified before Phase 2 begins.

---

### 🔷 PHASE 2 — Local Application Data Slices & Production Mock Removal

Triển khai 4 lát cắt (vertical slices), mỗi slice hoàn thành từ Backend ➔ IPC ➔ UI ➔ Gỡ mock data của slice đó.

---

#### 1. Slice 2.1: Settings, Credentials & ServiceConnectionManager
- **Backend Services**:
  - `SettingsService`: Coordinates `SettingsRepository` (non-secret settings) and `CredentialRepository` + `CredentialVault` (encrypted secrets). Handles partial persistence failure by rolling back or surfacing structured errors.
  - `ServiceConnectionManager`:
    - Explicit dependencies: `CredentialRepository`, `CredentialVault`, `ProviderRegistry`, and `CredentialRepository` (for diagnostic metadata).
    - Manages diagnostic status cache in memory.
    - Persists sanitized metadata (`lastTestedAt`, `lastTestResult: SanitizedDiagnosticResult`, `status`, `balance`, `balanceFetchedAt`) into `service_credentials.metadata`.
    - Defaults all services to `'unknown'` on fresh startup.
    - Connection tests trigger **only** on explicit user action (save/test/refresh); never executes network requests on startup.
    - Computes stale state if `lastTestedAt` > 1 hour.
- **IPC Handlers**: `settings:get`, `settings:save`, `credentials:save` (Zod validated discriminated union), `credentials:getStatus`, `credentials:test`.
- **UI Integration & Mock Removal**:
  - `SettingsPage` loads settings on mount from SQLite via IPC.
  - "LƯU CÀI ĐẶT" writes non-secret settings to `app_settings` and encrypted credentials to `service_credentials`.
  - `StatusBar` displays timestamped diagnostic status from `ServiceConnectionManager`.
  - **Remove `initialMockSettings` from production bundle**.

#### 2. Slice 2.2: Accounts Persistence & Masked Secret UX
- **Backend Services**:
  - `AccountService`: Manages account CRUD and encryption/decryption of account secrets.
- **Account Secret UX (Write-Only Semantics)**:
  - List/Read DTOs contain **zero** decrypted secrets.
  - Table columns display `••••••••` or `Configured` badge. **No password reveal or clipboard copy controls exist**.
  - `EditAccountDrawer` uses write-only fields: leaving blank keeps existing secret; entering text replaces secret; explicit clear button wipes secret.
- **IPC Handlers**: `accounts:list`, `accounts:create`, `accounts:update`, `accounts:delete`, `accounts:getMetrics`.
- **UI Integration & Mock Removal**:
  - `AccountsPage`, `AddAccountDrawer`, `EditAccountDrawer`, `DeleteAccountDialog` wired to IPC.
  - `DashboardPage` mini-grid consumes the same `AccountService.listAccounts()` query.
  - Dashboard "Start All" / "Stop All" controls disabled with honest unavailable badge.
  - **Remove `initialMockAccounts` from production bundle**.

#### 3. Slice 2.3: Runtime Logs, Batching & Retention
- **Backend Services**:
  - `LogBus`: Buffers logs in memory. Flushes to `LogRepository.insertBatch()` every `500ms` or when queue reaches `50 items`. Flushes on `app.on('before-quit')` with 2000ms timeout.
  - **Backpressure policy**: Bounded queue (drops lowest priority `DEBUG` logs if queue exceeds `10,000` items, tracking dropped log metrics).
  - `LogRetentionJob`: Deletes logs older than configured retention (`7`, `30`, `90` days, or skip if `Never`).
- **IPC Handlers**: `logs:list(filters, page)`, `logs:clear()`, and Event Stream `logs:on-entry` with client unmount unsubscribe cleanup.
- **UI Integration & Mock Removal**:
  - `LogsPage` loads history from SQLite with level/email filtering and pagination.
  - `DockedLiveLogs` on Dashboard receives live stream from `logs:on-entry`.
  - **Remove `initialMockLogs` from production bundle**.

#### 4. Slice 2.4: Secure Account Export
- **Backend Services**:
  - `ExportService` in Main Process:
    - Receives `accounts:export(scope, format, selectedIds, filters)`.
    - Prompts native save dialog (`dialog.showSaveDialog`). If cancelled, returns `{ success: false, cancelled: true }`.
    - Queries accounts, decrypts CapCut passwords inside Main Process, and formats stream:
      - **Field Order**: 1. Email, 2. Password CapCut, 3. Email Data, 4. Credit, 5. Subscription, 6. Create At.
      - **CSV Formula Injection Defense**: Values starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with single quote `'`.
      - **TXT Delimiter Escaping**: Pipes `|` and newlines within fields are escaped.
      - **XLSX Generation**: Uses ExcelJS workbook API, writes to temporary file (`.tmp`), and atomically renames to target destination. On write failure/cancellation, cleans up temporary file.
      - **Zero secrets returned to Renderer**.
- **UI Integration**: `ExportDialog` triggers Main Process export.

#### 5. Acceptance Criteria & Completion Gate
- Application restart preserves all created accounts and settings from SQLite.
- Bounded LogBus flushes smoothly under 500 rapid log events without blocking UI.
- Export writes valid `.xlsx`, `.csv`, `.txt` files with decrypted fields without leaking secrets to React state.
- **Completion Gate**: All 4 vertical slices verified in live Electron app with 0 production persistence or diagnostic mock data.

---

### 🔷 PHASE 3 — External Providers Implemented Sequentially

Each provider is an independent completion gate executed strictly in sequence:  
**1. Gmail94 ➔ 2. Multilogin ➔ 3. KiotProxy ➔ 4. DongVanFB ➔ 5. GPM Login ➔ 6. GoLogin**.

#### Universal Provider Rules:
1. **Scope Control**: Implement only Authentication / Connectivity and Safe Read operations. Defer all state-changing, transactional, or billable methods.
2. **Secret Redaction & URL Sanitization**: Strip API keys/tokens from URLs (e.g. `?apikey=...` or `?token=...`) in all error messages and log outputs.
3. **Response Validation**: Parse external API JSON with Zod schemas to guard against malformed vendor responses.
4. **Token Expiry**: Manage issued Bearer token expiration (e.g. Multilogin 30-min lifetime).
5. **Real-Service Gate Rule**: If real credentials are not available for a provider, require an explicit user decision to record status as *"Implemented, but not verified against the real service"* before proceeding to the next provider.

---

#### 1. Provider Gate 3.1: Gmail94 Provider
- **Contract Source**: Inspected Postman Collection `022e2ee2-3a7b-4841-9cc2-e528bd0e9bfa`.
- **Approved Scope**:
  - `testConnection(apiKey: string)`: Calls `GET https://gmail94.com/api/user/profile?token={apiKey}`.
  - `getServiceList(apiKey: string)`: Calls `GET https://gmail94.com/api/services?token={apiKey}`.
- **Deferred Scope**: Creating OTP orders, reading OTPs, purchasing email accounts.
- **Files**: `src/main/providers/email/Gmail94Provider.ts` [NEW], `src/main/providers/email/__tests__/Gmail94Provider.test.ts` [NEW].
- **Acceptance Criteria**: Unit tests pass 100%. Safe smoke test returns valid balance or normalized 401 error.

#### 2. Provider Gate 3.2: Multilogin Provider
- **Contract Source**: Inspected Postman Collection `9878db68-02d3-45fd-aa7e-066b8eb1db84`.
- **Approved Scope**:
  - `testConnection(credentials)`: Calls `POST https://api.multilogin.com/user/signin` or validates token.
  - `getWorkspaces(token: string)`: Calls `GET https://api.multilogin.com/workspace/list`.
- **Deferred Scope**: Launching quick profiles, starting browser profiles, stopping profiles, deleting browser cores.
- **Files**: `src/main/providers/browser/MultiloginProvider.ts` [NEW], `src/main/providers/browser/__tests__/MultiloginProvider.test.ts` [NEW].
- **Acceptance Criteria**: Unit tests pass 100%. Safe smoke test verifies authentication token without profile side-effects.

#### 3. Provider Gate 3.3: KiotProxy Provider
- **Contract Source**: Inspected Postman Collection `b73aa581-f070-44b7-af64-54210fdc459b`.
- **Approved Scope**:
  - `testConnection(apiToken: string)`: Calls `GET https://api.kiotproxy.com/api/v1/account/user-info` with header `Api-token`.
  - `getMyIp()`: Calls `GET https://api.kiotproxy.com/api/v1/account/my-ip`.
  - `getCurrentProxy(key: string)`: Calls `GET https://api.kiotproxy.com/api/v1/proxy/get-current?key={key}` (Safe read, does not rotate).
- **Deferred Scope**: `get-next` rotating proxy, buying proxy keys, extending proxy keys.
- **Files**: `src/main/providers/proxy/KiotProxyProvider.ts` [NEW], `src/main/providers/proxy/__tests__/KiotProxyProvider.test.ts` [NEW].
- **Acceptance Criteria**: Unit tests pass 100%. Safe smoke test retrieves user balance / current IP without triggering IP rotation.

#### 4. Provider Gate 3.4: DongVanFB Provider
- **Contract Source**: Inspected Postman Collection `04b6a884-9507-4c64-95b8-9b098da76d34` (Endpoints remain unverified until official documentation and real-response verification in Phase 3).
- **Approved Scope**:
  - `testConnection(apiKey: string)`: Calls `GET https://api.dongvanfb.net/user/balance?apikey={apiKey}`.
  - `getAccountTypes(apiKey: string)`: Calls `GET https://api.dongvanfb.net/user/account_type?apikey={apiKey}`.
- **Deferred Scope**: Purchasing email accounts (`/user/buy`), creating mail servers (`/user/create_mail_server`), requesting OAuth2 tokens with credentials.
- **Files**: `src/main/providers/email/DongVanFBProvider.ts` [NEW], `src/main/providers/email/__tests__/DongVanFBProvider.test.ts` [NEW].
- **Acceptance Criteria**: Unit tests pass 100%. Safe smoke test returns balance and available mail catalog without deductions.

#### 5. Provider Gate 3.5: GPM Login Provider
- **Contract Source**: Local GPM API Specification (`http://127.0.0.1:19995`).
- **Approved Scope**:
  - `testConnection(port = 19995)`: Calls `GET http://127.0.0.1:{port}/api/v3/profiles` with connection timeout (2000ms).
  - `listProfiles(port = 19995)`: Parses list of local GPM profiles.
- **Deferred Scope**: Starting browser profile (`/api/v3/start`), stopping browser profile (`/api/v3/stop`), deleting profiles.
- **Files**: `src/main/providers/browser/GpmLoginProvider.ts` [NEW], `src/main/providers/browser/__tests__/GpmLoginProvider.test.ts` [NEW].
- **Acceptance Criteria**: Unit tests pass 100%. When GPM daemon is offline, returns clear diagnostic error `GPM API offline on port 19995`. When GPM is open, lists profiles.

#### 6. Provider Gate 3.6: GoLogin Provider
- **Contract Source**: Inspected Postman Collection `2dfa8ec8-e4ba-4db4-b6be-d24b6069245f`.
- **Approved Scope**:
  - `testConnection(apiToken: string)`: Calls `GET https://api.gologin.com/user/data` with header `Authorization: Bearer {token}`.
  - `listProfiles(apiToken: string)`: Calls `GET https://api.gologin.com/browser/v2`.
- **Deferred Scope**: Starting cloud profiles, starting local profiles, updating fingerprints, purchasing proxies.
- **Files**: `src/main/providers/browser/GoLoginProvider.ts` [NEW], `src/main/providers/browser/__tests__/GoLoginProvider.test.ts` [NEW].
- **Acceptance Criteria**: Unit tests pass 100%. Safe smoke test retrieves user profile metadata.

---

### 🔷 PHASE 4 — Hardening & Release Verification

#### 1. Scope
Execute complete cross-lane verification, native rebuild confirmation, migration integrity checks, and secret redaction audit.

#### 2. Ordered Tasks
- [ ] **Task 4.1**: Typecheck: Run `npm run typecheck` (`tsc --noEmit`) across main, preload, shared, and renderer (0 errors).
- [ ] **Task 4.2**: Linting: Run `npm run lint` (`eslint . --max-warnings 0`) with 0 warnings.
- [ ] **Task 4.3**: Unit Test Suite: Run `npm run test` across Repositories, Vault, Services, and Providers (100% PASS).
- [ ] **Task 4.4**: Electron Runtime Verification: Launch app in Electron dev runtime and verify native `better-sqlite3` loading and `safeStorage` encryption.
- [ ] **Task 4.5**: Secret Redaction Audit: Review all IPC payload schemas, error serializations, and log outputs to ensure 0 secret leakage.
- [ ] **Task 4.6**: Final Provider Status Reporting: Clearly report for each provider whether it was *VERIFIED AGAINST REAL SERVICE* or *Implemented, but not verified against the real service*.

---

## 6. Provider Capability Matrix

| Provider | Discovered Postman / Documentation Capabilities | Approved for Current Implementation Phase | Deferred Capabilities |
| :--- | :--- | :--- | :--- |
| **Gmail94** | Profile Info, Service List, Create OTP Order, Get OTP, Buy Email Accounts | `testConnection()`, `getProfileInfo()`, `getServiceList()` | Create OTP Order, Get OTP, Buy Email Accounts |
| **Multilogin** | Sign In, Refresh Token, Workspaces, Profile CRUD, Quick Profile v3 Launcher, Start/Stop Profile, Profile Status | `testConnection()`, `getWorkspaces()` | Create/Update/Delete Profile, Start Profile, Stop Profile, Quick Profile v3 Launcher |
| **KiotProxy** | Get My IP, User Info, Key CRUD, Get Current Proxy, Get Next Proxy (Rotate) | `testConnection()`, `getMyIp()`, `getCurrentProxy()` | Get Next Proxy (Rotate), Buy Key, Extend Key, Delete Key |
| **DongVanFB** | Check Balance, Account Types, Buy Mail, Get OAuth2, Create Mail Server, Get Mail Server Code | `testConnection()`, `checkBalance()`, `getAccountTypes()` | Buy Mail, Request OAuth2 Token, Create Mail Server Domain, Get Mail Server OTP |
| **GPM Login** | List Profiles, Profile Details, Start Profile, Stop Profile, Delete Profile | `testConnection()`, `listProfiles()` | Start Profile, Stop Profile, Delete Profile |
| **GoLogin** | User Data, User Balance, List Profiles, Fingerprints, Start Cloud Profile, Start Local Profile | `testConnection()`, `getUserData()`, `listProfiles()` | Start Cloud Profile, Start Local Profile, Generate Fingerprint, Set Proxy |

---

## 7. Real API Safety Matrix

| Provider | Operation | Category | Expected Side Effects | Allowed in Smoke Test | Required Approval | Documentation Source | Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Gmail94** | `GET /api/user/profile` | Authentication/connectivity | None | ✅ Yes | Default approved | Postman `022e2ee2` | Unverified — credentials required |
| **Gmail94** | `GET /api/services` | Read-only | None | ✅ Yes | Default approved | Postman `022e2ee2` | Unverified — credentials required |
| **Gmail94** | `POST /api/order/create` | Billable/transactional | Deducts balance, creates order | ❌ No | Explicit user opt-in | Postman `022e2ee2` | Deferred |
| **Multilogin** | `POST /user/signin` | Authentication/connectivity | Issues temporary Bearer token | ✅ Yes | Default approved | Postman `9878db68` | Unverified — credentials required |
| **Multilogin** | `GET /workspace/list` | Read-only | None | ✅ Yes | Default approved | Postman `9878db68` | Unverified — credentials required |
| **Multilogin** | `POST /launcher/profile/start` | State-changing | Spawns browser process on host | ❌ No | Explicit user opt-in | Postman `9878db68` | Deferred |
| **KiotProxy** | `GET /api/v1/account/user-info` | Authentication/connectivity | None | ✅ Yes | Default approved | Postman `b73aa581` | Unverified — credentials required |
| **KiotProxy** | `GET /api/v1/proxy/get-current` | Read-only | Returns active IP info | ✅ Yes | Default approved | Postman `b73aa581` | Unverified — credentials required |
| **KiotProxy** | `GET /api/v1/proxy/get-next` | State-changing | Rotates IP address on proxy key | ❌ No | Explicit user opt-in | Postman `b73aa581` | Deferred |
| **DongVanFB** | `GET /user/balance` | Authentication/connectivity | None | ✅ Yes | Default approved | Postman `04b6a884` | Unverified — credentials required |
| **DongVanFB** | `GET /user/account_type` | Read-only | None | ✅ Yes | Default approved | Postman `04b6a884` | Unverified — credentials required |
| **DongVanFB** | `GET /user/buy` | Billable/transactional | Deducts balance, allocates mail | ❌ No | Explicit user opt-in | Postman `04b6a884` | Deferred |
| **GPM Login** | `GET /api/v3/profiles` | Read-only | Queries local GPM daemon | ✅ Yes | Default approved | GPM Local API Spec | Unverified — GPM app required |
| **GPM Login** | `GET /api/v3/start` | State-changing | Spawns Chrome browser instance | ❌ No | Explicit user opt-in | GPM Local API Spec | Deferred |
| **GoLogin** | `GET /user/data` | Authentication/connectivity | None | ✅ Yes | Default approved | Postman `2dfa8ec8` | Unverified — credentials required |
| **GoLogin** | `GET /browser/v2` | Read-only | None | ✅ Yes | Default approved | Postman `2dfa8ec8` | Unverified — credentials required |
| **GoLogin** | `POST /browser/start` | State-changing | Spawns Orbita browser instance | ❌ No | Explicit user opt-in | Postman `2dfa8ec8` | Deferred |

---

## 8. Dependency Approval Table

| Proposed Package | Type | Purpose | Alternatives Considered | Electron 35 / ABI Compatibility | Native Rebuild & Packaging Requirement | Approval Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`better-sqlite3`** | Production | High-performance synchronous SQLite database engine required by `AGENTS.md`. | `sqlite3` (callback overhead), `sql.js` (no WAL persistence). | Native C++ addon compiled against Node ABI. Must match Electron 35 internal ABI. | Rebuilt via `@electron/rebuild` during development. | **Approved** (Versions resolved in Phase 1 plan) |
| **`@types/better-sqlite3`** | DevOnly | TypeScript definitions for `better-sqlite3`. | Custom `.d.ts` file. | None (compile-time only). | None. | **Approved** |
| **`@electron/rebuild`** | DevOnly | Standalone utility to rebuild native Node addons against Electron header versions. | `electron-builder install-app-deps`. | Rebuilds `better-sqlite3.node` for Electron 35 ABI. | Executed via `"rebuild": "electron-rebuild -f -w better-sqlite3"`. | **Approved** |
| **`vitest`** | DevOnly | Fast test runner compatible with Vite & TypeScript for unit and integration testing. | `jest` (heavy Babel/ts-jest bridge), manual node test runner. | Runs in standard Node environment. Test suites mock Electron APIs or test Node services directly. | None. | **Approved** |
| **`zod`** | Production | Runtime schema validation at IPC and external API boundaries. | Handwritten type guards (tedious, error-prone for discriminated unions). | Pure TypeScript/JS; zero native addon requirements. | None. | **Approved** |
| **`exceljs`** | Production | Production-grade workbook generation for XLSX account export. | `xlsx` / `sheetjs` (security concerns & licensing quirks), manual XML templating. | Pure JavaScript; works in Node.js / Electron Main Process. | None. | **Approved** (Subject to version API verification) |

---

## 9. Separate Verification Lanes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LANE 1: NODE.JS / VITEST (Automated)                   │
│  - Database migrations on temporary file-backed DB                          │
│  - Repository CRUD, transactional batch inserts, queries, retention cleanup │
│  - Application Services with injected mock ICredentialVault                 │
│  - Zod runtime schema validation on invalid inputs                          │
│  - Provider Adapters with Fake HTTP Transport (200, 401, 429, 500, timeout) │
│  - ExportService formatting (CSV injection defense, TXT delimiter escape)  │
│  - LogBus batch timer and bounded queue backpressure                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    LANE 2: ELECTRON RUNTIME (Automated & Harness)           │
│  - Native better-sqlite3 loading inside Electron Main Process               │
│  - Electron safeStorage encryption availability & fail-closed behavior      │
│  - Preload bridge context isolation (no window.require / no raw ipcRenderer)│
│  - IPC invoke/handle roundtrip and event stream subscription/unsubscription │
│  - Clean application shutdown flush sequence                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                       LANE 3: MANUAL UI & INTEGRATION (Desktop)             │
│  - App launch & restart persistence (accounts & settings survive restart)   │
│  - Settings save & masked credential display                                │
│  - Account CRUD, write-only edit drawer, and masked password UX             │
│  - Live logs streaming to DockedLiveLogs & history pagination in Logs Page  │
│  - Native file save dialog for XLSX/CSV/TXT account export                  │
│  - StatusBar diagnostic indicators with stale time calculation              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Verification Matrix (Command Status Classification)

| Verification Item | Command / Harness | Command Status | Expected Success Evidence |
| :--- | :--- | :--- | :--- |
| **Code Linting** | `npm run lint` | **Existing Command** | `eslint . --max-warnings 0` exits with code 0. |
| **Production Build** | `npm run build` | **Existing Command** | `tsc && vite build` produces clean `dist` and `dist-electron` bundles. |
| **TypeScript Typecheck** | `npm run typecheck` | **Proposed Script** (`"typecheck": "tsc --noEmit"`) | 0 TypeScript diagnostic errors across all tsconfigs. |
| **Native Addon Rebuild** | `npm run rebuild` | **Proposed Script** (`"rebuild": "electron-rebuild -f -w better-sqlite3"`) | `better-sqlite3.node` compiled successfully for Electron 35. |
| **Automated Unit Tests** | `npm run test` | **Proposed Script** (`"test": "vitest run"`) | 100% unit tests pass across database, services, and providers. |
| **Safe Smoke Test Runner** | `npm run test:smoke` | **Proposed Script** (Optional secondary CLI reading from `process.env` / stdin) | Outputs safe JSON connectivity response reading credentials from `process.env` or stdin. |
| **Electron Runtime Smoke** | `npm run dev` | **Existing Command** | Desktop window opens, loads SQLite settings/accounts without errors. |

---

## 10. Risk Register & Rollback Behavior

| Risk ID | Description | Impact | Mitigation Strategy | Rollback Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **R-01** | `better-sqlite3` native ABI mismatch during Electron launch. | Application crashes on startup with `NODE_MODULE_VERSION` error. | Add `@electron/rebuild` script and verify in Electron dev runtime before Phase 2. | Clean reinstall and re-run rebuild script. |
| **R-02** | Database migration failure during schema upgrade. | Partially applied schema. | Execute every migration file inside an explicit SQLite `BEGIN TRANSACTION ... COMMIT`. | Rollback transaction; database remains on previous verified version. |
| **R-03** | Electron `safeStorage` unavailable in headless / CI environment. | Credential persistence fails. | Fail closed with normalized error `VaultUnavailableError`. Unit tests inject mock `ICredentialVault`. | Return diagnostic error without corrupting database. |
| **R-04** | Accidental billable or state-changing action during API testing. | Financial charge or loss of external resources. | Hard-gate smoke test runner: only endpoints in the `Read-Only` safety category can be called. | Smoke test runner aborts if non-approved endpoint is requested. |

---

## 11. Approval Record & Accepted Decisions

The following architectural decisions have been formally approved:

1. **Test Runner**: `vitest` approved as dev dependency.
2. **Database Engine & Rebuild**: `better-sqlite3`, `@types/better-sqlite3`, and `@electron/rebuild` approved. Compatible versions will be resolved from official documentation in Phase 1 plan prior to installation.
3. **Runtime Schema Validation**: `zod` approved for IPC input guards and provider response schema validation.
4. **XLSX Export**: `exceljs` approved subject to API verification during implementation.
5. **CLI Smoke Runner (`tsx`)**: Deferred until Phase 3; in-app diagnostic action in `SettingsPage` serves as primary real-service verification mode.
6. **Packaging Tooling (`electron-builder`)**: Deferred to a separate release packaging milestone; Electron runtime rebuild verification remains in current scope.
7. **Secret UX**: Approved as masked/configured state only (`••••••••`), with write-only keep/replace/clear drawer semantics and zero reveal/clipboard copy options.
8. **Dashboard Controls**: Start/Stop automation controls remain disabled with honest unavailable badge until Automation Core is explicitly scheduled.

---

**APPROVED — READY FOR PHASE 0 DETAILED IMPLEMENTATION PLAN.**
