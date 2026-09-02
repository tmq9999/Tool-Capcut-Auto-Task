# Phase 2 Detailed TDD Implementation Plan: Local Application Data & UI Integration

> **Sub-skill requirement:** This plan is designed for execution under the `executing-plans` or `subagent-driven-development` workflows. Each task contains explicit, isolated RED-GREEN-REFACTOR steps with concrete file paths, schema signatures, focused commands, and verifiable regression gates.

**Goal:** Implement Phase 2 of AutoManager to replace all transient UI mocks with local SQLite persistence, safe OS-level credential encryption via `safeStorage`, transactional application services, typed IPC contracts, live bounded log streaming, and secure multi-format account exports.

**Architecture:** The desktop application follows strict inward dependency layering (`Renderer -> Preload -> Typed IPC -> Application Services -> Repositories/Vault -> SQLite/safeStorage`). Repositories exclusively own database queries and share a single `better-sqlite3` instance wrapped by a synchronous `DatabaseTransactionRunner`. Decrypted secrets remain isolated in the Main process, and status indicators display real cached metadata with zero premature provider network requests.

**Tech Stack:** Electron 35, React 19, TypeScript 5.8, `better-sqlite3` (WAL mode), Tailwind CSS, Vite, Vitest, Zod, and `exceljs` (candidate dependency for Slice 2.4).

**Spec Reference:** [`docs/superpowers/plans/2026-09-01-backend-persistence-real-api-master.md`](file:///d:/GeminiWorkspaceNew/ToolCapCut/docs/superpowers/plans/2026-09-01-backend-persistence-real-api-master.md)  
**Foundation Reference:** [`docs/superpowers/plans/2026-09-01-phase-0-1-contracts-persistence-foundation.md`](file:///d:/GeminiWorkspaceNew/ToolCapCut/docs/superpowers/plans/2026-09-01-phase-0-1-contracts-persistence-foundation.md)  
**Document Status:** SLICE 2.1 IMPLEMENTED — AUTOMATED VERIFIED; MANUAL UI SAVE/RESTART AWAITING USER — SLICES 2.2–2.4 GATED  
**File Location:** `docs/superpowers/plans/2026-09-01-phase-2-local-data-ui-integration.md`

---

## 1. Global Constraints & Architectural Boundaries

1. **Strict SQL Isolation**: Repositories are the **only** layer that executes SQL queries or creates `better-sqlite3` statements. Application services coordinate business logic, encryption, and validation but **never** execute raw SQL.
2. **Synchronous Transaction Abstraction (`DatabaseTransactionRunner`)**:
   - All repositories share the same `better-sqlite3` database instance.
   - `DatabaseTransactionRunner.run<T>(fn: () => T): T` is strictly synchronous and wraps `db.transaction(fn)()`.
   - Multi-table writes (e.g. settings + multi-service credential mutations) are orchestrated by services: the service validates inputs and encrypts secrets in memory *before* entering the transaction, and the transaction commits all repository writes atomically. If encryption or validation fails, the transaction is never entered.
3. **Secret Isolation & Zero Plaintext UI Exposure**:
   - Decrypted secrets **never** leave the Electron Main Process.
   - React Renderer state receives only boolean indicators (`hasPasswordCapcut`, `hasEmailPassword`, `hasEmailData`), masked hints (`••••••••`), and diagnostic status strings.
   - Secret inputs in UI forms are **write-only**: user-entered values are transmitted over typed IPC, encrypted in Main into `Buffer` ciphertexts, and written to SQLite. Form inputs are wiped from pure controller state immediately upon save and on component unmount.
   - Zero copy-to-clipboard buttons, zero reveal-plaintext eye toggles, and zero secrets in React component trees or error toasts.
4. **No Provider Network Calls in Phase 2**:
   - Status indicators in `StatusBar` and `SettingsPage` display cached diagnostic metadata from SQLite (`status: 'unknown' | 'connected' | 'degraded' | 'offline'`).
   - `ServiceConnectionManager` tests for unregistered providers return code `PROVIDER_NOT_IMPLEMENTED` with a user-safe message (`"Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại."`) and an injected clock timestamp. It never writes simulated connected or offline state to SQLite.
   - Startup never makes external network requests.
5. **No Automation Core Execution**:
   - Dashboard Start/Stop actions remain disabled with a neutral message: `"Automation is not available in the current milestone"`. No promised phase/date and zero simulated running state or fake progress timers.
6. **Diagnostic Error Redaction**:
   - Never log secrets, vendor payloads, file paths containing sensitive data, or raw exception messages/stacks.
   - All errors pass through normalized application error codes (`ERR_VAULT_UNAVAILABLE`, `ERR_VALIDATION_FAILED`, `ERR_PERSISTENCE_FAILED`, `ERR_NOT_FOUND`, `PROVIDER_NOT_IMPLEMENTED`, `EXPORT_TARGET_EXISTS`).

---

## 2. Vertical Slice Execution Order & Dependency Graph

Phase 2 is structured into four independently verifiable vertical slices executed strictly in sequence. Each slice has a separate approval and completion gate:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Slice 2.1: Settings, Encrypted Credentials & Cached Diagnostic State    │
│ - Modify settings.schema.ts: add LogSettingsSchema (retention default)  │
│ - Modify diagnostics.schema.ts: add PROVIDER_NOT_IMPLEMENTED & isStale  │
│ - Single atomic SettingsSaveRequest (settings + write-only credentials) │
│ - DatabaseTransactionRunner synchronous atomicity & rollback            │
│ - ServiceConnectionManager (cached diagnostic status, no fake network) │
│ - Backward-compatible settings load (merge missing logs.retention: '30')│
│ - Pure SettingsController (framework-free Node test) & UI wiring       │
│ - Wire main.ts composition & lifecycle cleanup for settings IPC        │
│ - Migrate AccountsPage settings consumer & remove mockSettings.ts       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Verified & Gate Approved)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Slice 2.2: Accounts Persistence & Masked/Write-Only Secret UX           │
│ - AccountService (ID provider, clock, Main-only encryption/decryption)  │
│ - AccountRepository aggregate summary & deterministic list ordering     │
│ - Pure AccountsController (framework-free Node test) & UI wiring        │
│ - Add/Edit Drawers with write-only keep/replace/clear secret ops        │
│ - Dashboard synced to SQLite accounts; disabled automation controls     │
│ - Migrate DashboardPage account consumer & remove mockAccounts.ts       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Verified & Gate Approved)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Slice 2.3: Runtime Logs, Bounded Batching, Retention & Live Stream      │
│ - LogBus ring buffer (10k max, batch 50 / 500ms, DEBUG eviction)       │
│ - Synchronous live event broadcast on accepted enqueue                 │
│ - WebContents-bound IPC push subscription with leak-free cleanup        │
│ - Execute configured retention cleanup ('7' | '30' | '90' | 'never')    │
│ - Pure LogsController (framework-free Node test) & UI confirmation      │
│ - DockedLiveLogs 200-item live dashboard stream                         │
│ - Integrate LogBus into 2000ms shutdown guard & remove mockLogs.ts      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Verified & Gate Approved)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Slice 2.4: Secure Multi-Format Export (ExcelJS, CSV, TXT)               │
│ - ExcelJS candidate preflight evaluation (install only if compatible)   │
│ - AccountRepository.listForExport internal unpaginated BLOB query       │
│ - ExportService: fixed 6-field order, RFC 4180 CSV formula defense,     │
│   TXT pipe/newline/backslash escaping & round-trip parser               │
│ - Temp-file write + atomic rename only if target does not exist         │
│ - EXPORT_TARGET_EXISTS normalization; never delete existing target file │
│ - Pure ExportController (framework-free Node test) & ExportDialog UI    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Slice 2.1: Settings, Encrypted Service Credentials & Cached Diagnostic State

### 3.1 Overview & Touchpoints
- **Shared Schemas**: `src/shared/schemas/settings.schema.ts` (adds `LogSettingsSchema` with `retention: '30'`), `src/shared/schemas/diagnostics.schema.ts` (adds `PROVIDER_NOT_IMPLEMENTED` code and `isStale: boolean`), `src/shared/schemas/settings-save.schema.ts` [NEW].
- **Renderer Components**: `src/renderer/pages/Settings/SettingsPage.tsx`, `GeneralSettingsPanel.tsx`, `BrowserSettingsPanel.tsx`, `EmailProviderPanel.tsx`, `ExportSettingsPanel.tsx`, `src/renderer/layouts/StatusBar.tsx`, `src/renderer/pages/Accounts/AccountsPage.tsx` (consumes export settings).
- **Extracted Pure Controller**: `src/renderer/pages/Settings/settingsController.ts` [NEW].
- **Mocks to Remove**: `src/renderer/mocks/mockSettings.ts`.
- **Preload / Contracts**: `src/shared/contracts/ipc-channels.ts`, `src/shared/contracts/api.ts`, `src/preload/preload.ts`.
- **Main / Services**: `src/main/database/transaction.ts`, `src/main/services/SettingsService.ts`, `src/main/services/ServiceConnectionManager.ts`, `src/main/ipc/settingsIpc.ts`, `src/main/main.ts`.
- **Repositories & Security**: `src/main/repositories/SettingsRepository.ts`, `src/main/repositories/CredentialRepository.ts`, `src/main/security/CredentialVault.ts`.

---

### Task 2.1.1: [RED] DatabaseTransactionRunner, Schema Extensions, Backward-Compatible Settings & SettingsService Unit Tests

- [x] **Write failing tests**: Create `src/main/database/__tests__/transaction.test.ts` and `src/main/services/__tests__/SettingsService.test.ts`.
  - Use a fresh file-backed temporary database (`createDatabaseConnection(dbPath)` with `runMigrations(db)`).
  - In `transaction.test.ts`:
    - Assert `DatabaseTransactionRunner.run(() => T)` executes synchronously and returns `T`.
    - Assert throwing an exception inside `run()` rolls back intermediate writes across multiple tables.
  - In `SettingsService.test.ts`:
    - **Backward Compatibility Test**: Save an old raw JSON record into `app_settings` lacking the `logs` key (simulating pre-Phase-2 data). Assert `getSettingsWithCredentials()` merges defaults (`logs: { retention: '30' }`) without throwing `DataCorruptionError` and without deleting/resetting the database.
    - **Single Atomic Save & Credential Mutations**:
      - `keep`: Assert existing credential row and ciphertext remain untouched.
      - `replace`: Assert new secret payload is encrypted via `CredentialVault.encrypt()` and stored.
      - `clear`: Assert `CredentialRepository.delete(serviceName)` deletes the row because `encrypted_credentials` is `NOT NULL`.
    - **Multi-Mutation Rollback Test**: When updating `app_settings` and two credentials, simulate a failure on the second credential mutation. Assert the transaction rolls back completely: `app_settings` and all `service_credentials` rows remain in their original state.
    - **ServiceConnectionManager Test**:
      - Assert `getDiagnosticStatuses()` reads SQLite metadata only with zero network calls.
      - Assert `isStale` is `true` when `lastTestedAt` exists and `clock.now() - new Date(lastTestedAt).getTime() > 86_400_000`; assert `isStale` is `false` when `lastTestedAt` is `undefined`.
      - Assert calling `testConnection('gmail94')` (valid service name absent from empty Phase-2 registry) returns code `'PROVIDER_NOT_IMPLEMENTED'`, user-safe message `'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.'`, and injected timestamp without modifying cached metadata in SQLite.
- [x] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/database/__tests__/transaction.test.ts src/main/services/__tests__/SettingsService.test.ts
  ```
  *Expected Failure*: Modules `../transaction` and `../SettingsService` not found; schema fields missing.

---

### Task 2.1.2: [GREEN] DatabaseTransactionRunner, Schemas, Default Settings, SettingsService, ServiceConnectionManager & CredentialRepository.delete

- [x] **Implement minimal code**:
  - Update `src/shared/schemas/settings.schema.ts`:
    ```typescript
    export const LogSettingsSchema = z.object({
      retention: z.enum(['7', '30', '90', 'never']).default('30')
    }).strict().default({ retention: '30' });
    export type LogSettingsDTO = z.infer<typeof LogSettingsSchema>;

    export const AppSettingsSchema = z.object({
      general: GeneralSettingsSchema,
      browser: BrowserSettingsSchema,
      logs: LogSettingsSchema,
      exportConfig: ExportSettingsSchema
    }).strict();
    ```
  - Create `src/shared/settings/default-settings.ts` [NEW]:
    ```typescript
    import type { AppSettingsDTO } from '../schemas/settings.schema';

    export const DEFAULT_APP_SETTINGS: AppSettingsDTO = {
      general: {
        theme: 'dark',
        language: 'vi',
        autoSaveConfig: true,
        sessionRestore: true
      },
      browser: {
        provider: 'gpm',
        gpm: { port: 19995 },
        multilogin: { port: 35000 },
        gologin: { autoPort: true },
        camoufox: { headless: false },
        patchright: { headless: false }
      },
      logs: {
        retention: '30'
      },
      exportConfig: {
        defaultFormat: 'xlsx',
        checkedFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
        availableFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt']
      }
    };
    ```
  - Update `src/shared/schemas/diagnostics.schema.ts`:
    - Add `'PROVIDER_NOT_IMPLEMENTED'` to `SanitizedDiagnosticResultSchema.code`.
    - Add `isStale: z.boolean()` to `CredentialStatusDTOSchema`.
  - Add `delete(serviceName: string): boolean` to `src/main/repositories/CredentialRepository.ts`:
    ```typescript
    delete(serviceName: string): boolean {
      const res = this.db.prepare('DELETE FROM service_credentials WHERE service_name = ?').run(serviceName);
      return res.changes > 0;
    }
    ```
  - Create `src/main/database/transaction.ts`:
    ```typescript
    import type Database from 'better-sqlite3';

    export interface ITransactionRunner {
      run<T>(fn: () => T): T;
    }

    export class DatabaseTransactionRunner implements ITransactionRunner {
      constructor(private readonly db: Database.Database) {}
      run<T>(fn: () => T): T {
        return this.db.transaction(fn)();
      }
    }
    ```
  - Update `src/main/repositories/SettingsRepository.ts` to merge `DEFAULT_APP_SETTINGS.logs` when reading pre-Phase-2 settings records lacking the `logs` key before strict parsing.
  - Create `src/shared/schemas/settings-save.schema.ts` defining `SettingsSaveRequestSchema`.
  - Create `src/main/services/ServiceConnectionManager.ts`:
    ```typescript
    export interface IProviderRegistry {
      get(serviceName: string): unknown | undefined;
      has(serviceName: string): boolean;
    }

    export class EmptyProviderRegistry implements IProviderRegistry {
      get(_serviceName: string): undefined { return undefined; }
      has(_serviceName: string): boolean { return false; }
    }

    export type StatusPublisher = (statuses: CredentialStatusDTO[]) => void;
    ```
    - Injects `CredentialRepository`, `ICredentialVault`, `IProviderRegistry`, `ClockProvider`, and `StatusPublisher`.
    - `getDiagnosticStatuses()`: Reads SQLite metadata; derives `isStale = lastTestedAt ? (clock.now() - new Date(lastTestedAt).getTime() > 86400000) : false`; invokes `statusPublisher(statuses)`.
    - `testConnection(serviceName)`: If service is absent from registry, returns `{ code: 'PROVIDER_NOT_IMPLEMENTED', message: 'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.', timestamp: new Date(clock.now()).toISOString() }`.
  - Create `src/main/services/SettingsService.ts`:
    - Coordinates atomic settings + credential mutations via `DatabaseTransactionRunner`.
- [x] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/database/__tests__/transaction.test.ts src/main/services/__tests__/SettingsService.test.ts
  ```
  *Expected Output*: PASS (100% tests green).

---

### Task 2.1.3: [RED/GREEN] Settings IPC Handlers & Typed Preload Bridge

- [x] **Write failing tests**: Create `src/main/ipc/__tests__/settingsIpc.test.ts` and update `src/preload/__tests__/preload.test.ts`.
  - Assert `settings:get` returns `IpcEnvelope<{ settings: AppSettingsDTO; credentials: CredentialStatusDTO[] }>`.
  - Assert `settings:save` accepts `SettingsSaveRequestDTO` and rejects malformed inputs with normalized `ERR_VALIDATION_FAILED` envelope without leaking raw payloads or secrets in error messages.
  - Assert `credentials:test` accepts `{ serviceName: string }` and returns `SanitizedDiagnosticResult` with `PROVIDER_NOT_IMPLEMENTED`.
  - Assert returned unregister function removes all 3 IPC handlers cleanly and idempotently.
- [x] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/settingsIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Failure*: Channel constants or handlers missing.
- [x] **Implement minimal code**:
  - Update `src/main/ipc/registerIpc.ts`: Generalize `IpcHandler` signature to support typed request arguments `(req?: unknown) => Promise<IpcEnvelope<unknown>> | IpcEnvelope<unknown>` (discovered implementation dependency).
  - Update `src/shared/contracts/ipc-channels.ts`: Add `SETTINGS_GET: 'settings:get'`, `SETTINGS_SAVE: 'settings:save'`, `CREDENTIALS_TEST: 'credentials:test'`.
  - Update `src/shared/contracts/api.ts`: Add request/response schemas to `IpcContractRegistry` and update `ElectronBridge`.
  - Create `src/main/ipc/settingsIpc.ts` with `registerSettingsIpc(registrar, settingsService, connectionManager)`.
  - Update `src/preload/preload.ts` exposing `window.electronAPI.settings` and `window.electronAPI.credentials.test`.
- [x] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/settingsIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Output*: PASS.

---

### Task 2.1.4: [RED/GREEN] Pure SettingsController Unit Tests, UI Integration, Main Composition & Mock Removal

- [x] **Write failing tests**: Create `src/renderer/pages/Settings/__tests__/settingsController.test.ts`.
  - Test framework-free pure controller class `SettingsController` using typed `ISettingsBridge`:
    - `getState()`: Returns initial state with `isLoading: true`, `DEFAULT_APP_SETTINGS`, and all secret drafts defaulted to `{ action: 'keep' }`.
    - `load()`: Calls `bridge.settings.get()`, populates `settings` and `credentialStatuses`, resets secret drafts, and sets `isLoading: false`.
    - `load()` error handling: On failed load envelope, populates normalized `error` without raw exception/stack.
    - `updateSettings(updater)`: Mutates non-secret settings in state.
    - `setSimpleDraft(service, draft)` / `setMultiloginDraft(draft)`: Sets write-only secret replacement/clear operations.
    - `save()`: Builds atomic `SettingsSaveRequestDTO` containing current non-secret settings and all mapped credential mutations.
    - **Wipe on Success**: Asserts all simple and Multilogin secret drafts are reset to `{ action: 'keep' }` upon successful save and `isSaved: true`.
    - **Wipe and Preserve on Error**: If IPC save fails, non-secret form edits are preserved, secret drafts are immediately wiped (security boundary), and normalized error is exposed.
    - **Double Submit Prevention**: Second `save()` call while `isSaving === true` is ignored with zero additional IPC calls.
    - `dispose()`: Immediately wipes all secret drafts from memory.
- [x] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/renderer/pages/Settings/__tests__/settingsController.test.ts
  ```
  *Expected Failure*: `settingsController` module missing.
- [x] **Implement minimal code**:
  - Create `src/renderer/pages/Settings/settingsController.ts`.
  - Update `src/renderer/pages/Settings/SettingsPage.tsx` to wrap `SettingsController`.
  - **Remove Reveal Eye Toggles**: Delete `Eye`, `EyeOff`, `showGmailKey`, `showDongVanKey`, `showGoLoginKey`, `showMultiloginPass` from `BrowserSettingsPanel.tsx` and `EmailProviderPanel.tsx`. Replace with write-only inputs showing placeholder `Đã lưu: ••••••••` if configured, `Chưa thiết lập` if empty.
  - **Real Status Badges**: Replace fake `Connected` green labels with neutral badges (e.g. `Configured: Port 19995`, `Chưa thiết lập`, `Đã cấu hình`).
  - Update `src/renderer/layouts/StatusBar.tsx` to display real cached diagnostic status.
  - **Migrate `AccountsPage.tsx`**: Update export settings consumer to load from `window.electronAPI.settings.get()` instead of importing `initialMockSettings`.
  - **Wire `src/main/main.ts` Composition**:
    - Construct `EmptyProviderRegistry`, `ServiceConnectionManager`, `SettingsService`, and `DatabaseTransactionRunner`.
    - Call `registerSettingsIpc(ipcMain, settingsService, connectionManager)` and add unregister callback to shutdown manager cleanup.
  - **Delete `src/renderer/mocks/mockSettings.ts`**.
- [x] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/renderer/pages/Settings/__tests__/settingsController.test.ts
  ```
  *Expected Output*: PASS.

---

### 3.2 Slice 2.1 Completion Gate

```powershell
npm run test:node
npm run test:electron
npm run lint
npm run typecheck
npm run build
rg "mockSettings" src/renderer
```

*Required Criteria*:
- [x] 1. All Node & Electron tests pass (0 failures).
- [x] 2. ESLint (0 warnings, 0 errors) and TypeScript typecheck clean.
- [x] 3. `rg "mockSettings" src/renderer` returns 0 matches.
- [ ] 4. Manual verification: Launch app, edit settings, enter API key, click save, restart Electron, verify persisted settings reload and secret input is blank with `Đã lưu` indicator.

---

## 4. Slice 2.2: Accounts Persistence & Masked/Write-Only Secret UX

### 4.1 Overview & Touchpoints
- **Renderer Components**: `src/renderer/pages/Accounts/AccountsPage.tsx`, `AccountsSummaryBar.tsx`, `AccountsToolbar.tsx`, `AddAccountDrawer.tsx`, `EditAccountDrawer.tsx`, `DeleteAccountDialog.tsx`, `src/renderer/pages/Accounts/columns.tsx`, `src/renderer/pages/Dashboard/DashboardPage.tsx`, `src/renderer/pages/Dashboard/DashboardActionBar.tsx`, `src/renderer/pages/Dashboard/columns.tsx`.
- **Extracted Pure Controller**: `src/renderer/pages/Accounts/accountsController.ts` [NEW].
- **Mocks to Remove**: `src/renderer/mocks/mockAccounts.ts`.
- **Preload / Contracts**: `src/shared/contracts/ipc-channels.ts`, `src/shared/contracts/api.ts`, `src/preload/preload.ts`.
- **Main / Services**: `src/main/services/AccountService.ts`, `src/main/ipc/accountsIpc.ts`, `src/main/main.ts`.
- **Repositories & Security**: `src/main/repositories/AccountRepository.ts`, `src/main/security/CredentialVault.ts`.

---

### Task 2.2.1: [RED] AccountRepository Aggregate Summary Query & AccountService Unit Tests

- [ ] **Write failing tests**: Create `src/main/repositories/__tests__/accountSummary.test.ts` and `src/main/services/__tests__/AccountService.test.ts`.
  - Use a file-backed temp SQLite database.
  - In `accountSummary.test.ts`:
    - Assert `AccountRepository.getAccountSummary()` executes `SELECT status, COUNT(*) as count FROM accounts GROUP BY status` and returns typed record `{ total: number, active: number, processing: number, waiting: number, error: number, done: number, disabled: number }`.
  - In `AccountService.test.ts`:
    - Injects `AccountRepository`, `ICredentialVault`, `IIdProvider` (deterministic fake ID generator), and `ClockProvider`.
    - Asserts `createAccount(input)` generates unique ID, encrypts secret fields (`passwordCapcut`, `emailPassword`, `emailData`) to `Buffer` ciphertexts, and saves record to repository.
    - Asserts `updateAccount(id, input)` supports `{ action: 'keep' }` (no decryption or re-encryption), `{ action: 'replace', value }` (encrypts new string), and `{ action: 'clear' }` (sets `null`).
    - Asserts `getAccountEditDetails(id)` returns non-secret fields and boolean secret flags (`hasPasswordCapcut`, etc.) with **zero** plaintext passwords.
    - Asserts `listAccounts(filter)` enforces deterministic pagination (1–500) and `created_at DESC, id ASC` ordering.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/repositories/__tests__/accountSummary.test.ts src/main/services/__tests__/AccountService.test.ts
  ```
  *Expected Failure*: Methods and module missing.

---

### Task 2.2.2: [GREEN] AccountRepository Summary Query & AccountService Implementation

- [ ] **Implement minimal code**:
  - Add `getAccountSummary()` to `src/main/repositories/AccountRepository.ts`:
    ```typescript
    export interface AccountSummaryRecord {
      total: number;
      active: number;
      processing: number;
      waiting: number;
      error: number;
      done: number;
      disabled: number;
    }

    getAccountSummary(): AccountSummaryRecord {
      const rows = this.db.prepare('SELECT status, COUNT(*) as count FROM accounts GROUP BY status').all() as { status: string; count: number }[];
      const summary: AccountSummaryRecord = { total: 0, active: 0, processing: 0, waiting: 0, error: 0, done: 0, disabled: 0 };
      for (const row of rows) {
        summary.total += row.count;
        if (row.status in summary) {
          summary[row.status as keyof Omit<AccountSummaryRecord, 'total'>] = row.count;
        }
      }
      return summary;
    }
    ```
  - Create `src/main/services/AccountService.ts` coordinating CRUD, encryption, pagination, and summary.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/repositories/__tests__/accountSummary.test.ts src/main/services/__tests__/AccountService.test.ts
  ```
  *Expected Output*: PASS.

---

### Task 2.2.3: [RED/GREEN] Accounts IPC Handlers & Typed Preload Bridge

- [ ] **Write failing tests**: Create `src/main/ipc/__tests__/accountsIpc.test.ts` and update `src/preload/__tests__/preload.test.ts`.
  - Assert `accounts:list`, `accounts:get-edit-details`, `accounts:create`, `accounts:update`, `accounts:delete`, `accounts:summary` validate request schemas and return typed envelopes.
  - Assert unregister function removes all account IPC handlers cleanly.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/accountsIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Failure*: Channel constants or handlers missing.
- [ ] **Implement minimal code**:
  - Add channel constants to `src/shared/contracts/ipc-channels.ts`.
  - Add schemas and DTOs to `src/shared/contracts/api.ts`.
  - Create `src/main/ipc/accountsIpc.ts` with `registerAccountsIpc(registrar, accountService)`.
  - Update `src/preload/preload.ts` exposing `window.electronAPI.accounts`.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/accountsIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Output*: PASS.

---

### Task 2.2.4: [RED/GREEN] Pure AccountsController Unit Tests, UI Integration, Main Composition & Mock Removal

- [ ] **Write failing tests**: Create `src/renderer/pages/Accounts/__tests__/accountsController.test.ts`.
  - Test framework-free pure controller `AccountsController`:
    - **Request Sequencing**: Monotonic `requestId` counter discards out-of-order search responses.
    - **Pagination & Filters**: Clamping bounds, resetting to page 1 on query change.
    - **Form State**: Create form clears inputs on success; Edit form initializes `keep` operations and handles `replace`/`clear`.
    - **Wipe on Unmount**: Asserts secret buffers in controller are zeroed/wiped.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/renderer/pages/Accounts/__tests__/accountsController.test.ts
  ```
  *Expected Failure*: `accountsController` module missing.
- [ ] **Implement minimal code**:
  - Create `src/renderer/pages/Accounts/accountsController.ts`.
  - Update `src/renderer/pages/Accounts/AccountsPage.tsx` and drawers to wrap `AccountsController`.
  - In `src/renderer/pages/Accounts/columns.tsx`: render `Badge: Đã thiết lập` (green) if `hasPasswordCapcut === true`, else `Chưa thiết lập` (gray). Email data renders `Badge: Đã thiết lập` if `hasEmailData === true`. Zero copy/reveal buttons.
  - In `src/renderer/pages/Dashboard/DashboardPage.tsx`: Read accounts from `window.electronAPI.accounts.list()`. Start/Stop buttons disabled with copy: `"Automation is not available in the current milestone"`. Preserve mockLogs usage until Slice 2.3.
  - **Wire `src/main/main.ts` Composition**: Register `accountsIpc` and add cleanup to shutdown manager.
  - **Delete `src/renderer/mocks/mockAccounts.ts`**.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/renderer/pages/Accounts/__tests__/accountsController.test.ts
  ```
  *Expected Output*: PASS.

---

### 4.2 Slice 2.2 Completion Gate

```powershell
npm run test:node
npm run test:electron
npm run lint
npm run typecheck
npm run build
rg "mockAccounts" src/renderer
```

*Required Criteria*:
1. All Node & Electron tests pass (0 failures).
2. ESLint and TypeScript clean.
3. `rg "mockAccounts" src/renderer` returns 0 matches.
4. Manual verification: Add accounts, edit proxy, delete, restart Electron, verify persistence, summary counts match, password columns show configured badges with zero plaintext leak.

---

## 5. Slice 2.3: Runtime Logs, Bounded Batching, Retention & Live Stream

### 5.1 Overview & Touchpoints
- **Renderer Components**: `src/renderer/pages/Logs/LogsPage.tsx`, `LogsFilterBar.tsx`, `src/renderer/pages/Logs/columns.tsx`, `src/renderer/pages/Dashboard/DockedLiveLogs.tsx`, `src/renderer/pages/Dashboard/DashboardPage.tsx`.
- **Extracted Pure Controller**: `src/renderer/pages/Logs/logsController.ts` [NEW].
- **Mocks to Remove**: `src/renderer/mocks/mockLogs.ts`.
- **Preload / Contracts**: `src/shared/contracts/ipc-channels.ts`, `src/shared/contracts/api.ts`, `src/preload/preload.ts`.
- **Main / Infrastructure**: `src/main/logging/LogBus.ts`, `src/main/services/LogService.ts`, `src/main/ipc/logsIpc.ts`, `src/main/lifecycle.ts`, `src/main/main.ts`.
- **Repositories & Schemas**: `src/main/repositories/LogRepository.ts`.

---

### Task 2.3.1: [RED] LogBus Deterministic Backpressure, Immediate Broadcast & Batching Unit Tests

- [ ] **Write failing tests**: Create `src/main/logging/__tests__/LogBus.test.ts`.
  - Use Vitest fake timers (`vi.useFakeTimers()`) and a mock `LogRepository`.
  - **Batching**: Logs pushed to `LogBus.push(log)` flush to `LogRepository.insertBatch()` at 50 items or on 500ms debounce.
  - **Synchronous Live Broadcast**: Assert subscribed live listeners are notified synchronously upon accepted enqueue (`accepted: true`). Broadcast is **not** debounced.
  - **Deterministic Backpressure (10,000 Cap)**:
    - When queue reaches 10,000 items:
      - Incoming `DEBUG` is dropped immediately (`accepted: false`).
      - Incoming non-DEBUG evicts the oldest queued `DEBUG` item.
      - If no `DEBUG` item exists, rejects incoming log with `{ accepted: false }` and increments `overflowDroppedCount`. Never silently drops a non-DEBUG log.
  - **Repository Failure Retention**: If `LogRepository.insertBatch()` throws, the failed batch remains queued for bounded retry.
  - **Flush**: `LogBus.flush()` drains all pending queue items immediately within synchronous database transaction.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/logging/__tests__/LogBus.test.ts
  ```
  *Expected Failure*: `LogBus` module missing.

---

### Task 2.3.2: [GREEN] LogBus & LogService Implementation

- [ ] **Implement minimal code**:
  - Create `src/main/logging/LogBus.ts` implementing `FlushableLogBus` with 10,000 ring buffer and synchronous live broadcast.
  - Create `src/main/services/LogService.ts`: Exposes `queryLogs(filter)`, `clearAllLogs()`, `applyRetentionPolicy(policy)`, and `subscribeLive(listener)`.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/logging/__tests__/LogBus.test.ts
  ```
  *Expected Output*: PASS.

---

### Task 2.3.3: [RED/GREEN] Logs IPC Handlers, Push Subscriptions & WebContents Lifecycle

- [ ] **Write failing tests**: Create `src/main/ipc/__tests__/logsIpc.test.ts` and update `src/preload/__tests__/preload.test.ts`.
  - Assert `logs:list` and `logs:clear` handlers work with normalized envelopes.
  - Assert `logs:subscribe` binds to `event.sender` (`WebContents`), broadcasts valid `CanonicalRuntimeLog`, prevents duplicate subscriptions, and cleans up on renderer unsubscribe or `event.sender.on('destroyed')`.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/logsIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Failure*: Channel constants or handlers missing.
- [ ] **Implement minimal code**:
  - Add channel constants to `src/shared/contracts/ipc-channels.ts`.
  - Update `src/shared/contracts/api.ts` and `src/preload/preload.ts`.
  - Create `src/main/ipc/logsIpc.ts` with `registerLogsIpc(registrar, logService)`.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/logsIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Output*: PASS.

---

### Task 2.3.4: [RED/GREEN] Pure LogsController Unit Tests, UI Integration, Main Composition & Mock Removal

- [ ] **Write failing tests**: Create `src/renderer/pages/Logs/__tests__/logsController.test.ts`.
  - Test framework-free pure controller `LogsController`:
    - Stream pause/resume buffer behavior.
    - 200-item FIFO buffer cap for docked live logs view.
    - Level and email filtering.
    - Confirmation requirement before clear.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/renderer/pages/Logs/__tests__/logsController.test.ts
  ```
  *Expected Failure*: `logsController` module missing.
- [ ] **Implement minimal code**:
  - Create `src/renderer/pages/Logs/logsController.ts`.
  - Update `src/renderer/pages/Logs/LogsPage.tsx`, `DockedLiveLogs.tsx`, and `DashboardPage.tsx` to wrap `LogsController`.
  - Add modal confirmation before calling `logs.clear()`.
  - In `src/main/main.ts`: Inject `logBus` into `createShutdownManager({ db, logBus, app, logger, timeoutMs: 2000 })` and register `logsIpc`.
  - **Delete `src/renderer/mocks/mockLogs.ts`**.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/renderer/pages/Logs/__tests__/logsController.test.ts
  ```
  *Expected Output*: PASS.

---

### 5.2 Slice 2.3 Completion Gate

```powershell
npm run test:node
npm run test:electron
npm run lint
npm run typecheck
npm run build
rg "mockLogs" src/renderer
```

*Required Criteria*:
1. All Node & Electron tests pass (0 failures).
2. Zero imports from `mockLogs.ts` across entire codebase.
3. Automated test confirms `LogBus.flush()` drains before DB closes during 2000ms shutdown sequence.
4. Manual verification: Emit logs, observe live stream in `DockedLiveLogs` and `LogsPage`, filter by `ERROR`, clear logs with confirmation dialog, restart app, verify clean history.

---

## 6. Slice 2.4: Secure Multi-Format Export (ExcelJS, CSV, TXT)

### 6.1 Overview & Touchpoints
- **Candidate Dependency**: `exceljs` (conditional candidate version evaluated during Task 2.4.1 preflight).
- **Renderer Components**: `src/renderer/pages/Accounts/ExportDialog.tsx`, `src/renderer/pages/Accounts/AccountsPage.tsx`.
- **Extracted Pure Controller**: `src/renderer/pages/Accounts/exportController.ts` [NEW].
- **Preload / Contracts**: `src/shared/contracts/ipc-channels.ts`, `src/shared/contracts/api.ts`, `src/preload/preload.ts`.
- **Main / Services**: `src/main/services/ExportService.ts`, `src/main/ipc/exportIpc.ts`, `src/main/main.ts`.
- **Repositories & Security**: `src/main/repositories/AccountRepository.ts`, `src/main/security/CredentialVault.ts`.

---

### Task 2.4.1: Candidate Dependency Assessment & Installation (`exceljs`)

- [ ] **Run preflight metadata inspection**:
  ```powershell
  npm view exceljs version engines
  ```
  Inspect output to evaluate compatibility with Node 22/24 and Electron 35. If metadata review or security check fails to establish compatibility, abort Slice 2.4 execution and report immediately without modifying `package.json`.
- [ ] **Install candidate version with exact flag (conditional on passing preflight)**:
  ```powershell
  npm install --save-exact exceljs@4.4.0
  ```
- [ ] **Audit and compile gate**:
  ```powershell
  npm audit --omit=dev
  npm run typecheck
  npm run build
  ```
  *Expected Output*: 0 vulnerabilities, clean compilation.

---

### Task 2.4.2: [RED] Internal Export Query & ExportService Unit Tests

- [ ] **Write failing tests**: Create `src/main/repositories/__tests__/accountExportQuery.test.ts` and `src/main/services/__tests__/ExportService.test.ts`.
  - In `accountExportQuery.test.ts`:
    - Assert `AccountRepository.listForExport(scope, checkedIds, filter)` returns internal `AccountDbRecord[]` with encrypted `Buffer` columns. Never applies UI pagination limits.
    - Scope `'checked'`: asserts non-empty IDs required.
    - Scope `'filtered'`: asserts SQL matches `AccountFilterSchema`.
    - Scope `'all'`: returns all records ordered by `created_at DESC, id ASC`.
  - In `ExportService.test.ts`:
    - **Fixed 6-Field Order**: `Email`, `Password CapCut`, `Email Data`, `Credit`, `Subscription`, `Create At`.
    - **Missing Secret Handling**: If password or emailData is `null`, outputs empty string `""`.
    - **CSV Formula Defense**: Prepends `'` if field starts with `=`, `+`, `-`, `@`, `\t`, `\r`, then applies RFC 4180 quotes.
    - **TXT Escaping & Roundtrip Parser**: Escapes `\` ➔ `\\`, `|` ➔ `\|`, `\r` ➔ `\r`, `\n` ➔ `\n`. Test includes complementary parser verifying 100% roundtrip fidelity.
    - **Temp-File Write & Atomic Rename (Destination Collision Safety)**:
      - Generates exact temp path `path.join(destDir, `.export_${uuid}.tmp`)`.
      - Writes to temp file and renames only when destination does not already exist.
      - If destination already exists, rename collision is normalized to `EXPORT_TARGET_EXISTS` error instructing the user to choose a new filename (never deletes or overwrites the target).
      - In `finally`, unlinks only the exact owned literal temp path (`fs.unlinkSync(tempPath)`). Never uses wildcards or recursive deletion.
    - **Memory Lifecycle**: XLSX workbook references are released after `Workbook.xlsx.writeFile(tempPath)` completes.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/repositories/__tests__/accountExportQuery.test.ts src/main/services/__tests__/ExportService.test.ts
  ```
  *Expected Failure*: Methods and module missing.

---

### Task 2.4.3: [GREEN] Export Repository Query & ExportService Implementation

- [ ] **Implement minimal code**:
  - Add `listForExport(scope, checkedIds, filter): AccountDbRecord[]` to `src/main/repositories/AccountRepository.ts`.
  - Create `src/main/services/ExportService.ts` implementing XLSX, CSV, TXT writers with formula protection, TXT escaping, and temp-file write plus safe rename.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/repositories/__tests__/accountExportQuery.test.ts src/main/services/__tests__/ExportService.test.ts
  ```
  *Expected Output*: PASS.

---

### Task 2.4.4: [RED/GREEN] Export IPC Handlers & Native Dialog Test Seam

- [ ] **Write failing tests**: Create `src/main/ipc/__tests__/exportIpc.test.ts` and update `src/preload/__tests__/preload.test.ts`.
  - Injects `ShowSaveDialogFn` seam: tests cancel (`{ canceled: true }`) and confirm without opening real OS dialog.
  - Asserts response to renderer is strictly `{ canceled: boolean; exportedCount?: number }` (zero `filePath` or decrypted data returned).
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/exportIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Failure*: Handler or bridge missing.
- [ ] **Implement minimal code**:
  - Add `ACCOUNTS_EXPORT: 'accounts:export'` to `src/shared/contracts/ipc-channels.ts`.
  - Update `src/shared/contracts/api.ts` and `src/preload/preload.ts`.
  - Create `src/main/ipc/exportIpc.ts` with `registerExportIpc(registrar, exportService, showSaveDialogFn)`.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/main/ipc/__tests__/exportIpc.test.ts src/preload/__tests__/preload.test.ts
  ```
  *Expected Output*: PASS.

---

### Task 2.4.5: [RED/GREEN] Pure ExportController Unit Tests, UI Integration & Main Composition

- [ ] **Write failing tests**: Create `src/renderer/pages/Accounts/__tests__/exportController.test.ts`.
  - Test framework-free pure controller `ExportController`:
    - Constructs export request matching format (`xlsx`, `csv`, `txt`) and scope (`all`, `checked`, `filtered`).
    - State transitions: `isExporting` flag, error handling for `EXPORT_TARGET_EXISTS`, silent close on cancel.
- [ ] **Run test and confirm RED**:
  ```powershell
  npm run test:node -- src/renderer/pages/Accounts/__tests__/exportController.test.ts
  ```
  *Expected Failure*: `exportController` module missing.
- [ ] **Implement minimal code**:
  - Create `src/renderer/pages/Accounts/exportController.ts`.
  - Update `src/renderer/pages/Accounts/ExportDialog.tsx` to wrap `ExportController` and call `window.electronAPI.accounts.export()`.
  - In `src/main/main.ts`: Register `exportIpc` and add cleanup to shutdown manager.
- [ ] **Rerun test and confirm GREEN**:
  ```powershell
  npm run test:node -- src/renderer/pages/Accounts/__tests__/exportController.test.ts
  ```
  *Expected Output*: PASS.

---

### 6.2 Slice 2.4 Completion Gate

```powershell
npm run test:node
npm run test:electron
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

*Required Criteria*:
1. All Node & Electron unit/integration tests pass (0 failures).
2. `npm audit --omit=dev` shows 0 vulnerabilities with installed `exceljs`.
3. Manual verification: Export accounts as XLSX, CSV, and TXT. Verify correct files created on disk, open in Excel / notepad, confirm headers, column order, formula protection, and clean decrypted values.

---

## 7. Master File-by-File Change Map

| Slice | Action | File Path | Description |
| :--- | :--- | :--- | :--- |
| **2.1** | [MODIFY] | `src/shared/schemas/settings.schema.ts` | Add `LogSettingsSchema` and `logs` field with default retention `'30'`. |
| **2.1** | [NEW] | `src/shared/settings/default-settings.ts` | Export strict typed `DEFAULT_APP_SETTINGS: AppSettingsDTO`. |
| **2.1** | [MODIFY] | `src/shared/schemas/diagnostics.schema.ts` | Add `PROVIDER_NOT_IMPLEMENTED` code and `isStale: boolean`. |
| **2.1** | [NEW] | `src/shared/schemas/settings-save.schema.ts` | Strict schema for atomic settings + credential mutations. |
| **2.1** | [MODIFY] | `src/main/ipc/registerIpc.ts` | Generalize IpcHandler signature for typed request payloads. |
| **2.1** | [NEW] | `src/main/database/transaction.ts` | Synchronous `DatabaseTransactionRunner` wrapping SQLite transactions. |
| **2.1** | [NEW] | `src/main/services/SettingsService.ts` | Settings & atomic write-only credential orchestration service. |
| **2.1** | [NEW] | `src/main/services/ServiceConnectionManager.ts` | Diagnostic provider status manager with cached metadata and `EmptyProviderRegistry`. |
| **2.1** | [NEW] | `src/main/ipc/settingsIpc.ts` | Settings and credentials IPC handlers with idempotent cleanup. |
| **2.1** | [NEW] | `src/main/database/__tests__/transaction.test.ts` | Transaction rollback & atomicity tests. |
| **2.1** | [NEW] | `src/main/services/__tests__/SettingsService.test.ts` | SettingsService unit tests on temp SQLite DB. |
| **2.1** | [NEW] | `src/main/ipc/__tests__/settingsIpc.test.ts` | Settings IPC handler validation tests. |
| **2.1** | [NEW] | `src/renderer/pages/Settings/settingsController.ts` | Extracted pure framework-free settings controller. |
| **2.1** | [NEW] | `src/renderer/pages/Settings/__tests__/settingsController.test.ts` | Pure settings controller unit tests (Node lane). |
| **2.1** | [MODIFY] | `src/shared/contracts/ipc-channels.ts` | Add settings/credentials IPC channels. |
| **2.1** | [MODIFY] | `src/shared/contracts/api.ts` | Add settings/credentials contracts to `ElectronBridge`. |
| **2.1** | [MODIFY] | `src/preload/preload.ts` | Expose typed `settings` and `credentials` APIs on bridge. |
| **2.1** | [MODIFY] | `src/preload/__tests__/preload.test.ts` | Test settings/credentials bridge exposure. |
| **2.1** | [MODIFY] | `src/renderer/pages/Settings/SettingsPage.tsx` | Wire real SQLite settings & write-only credential state. |
| **2.1** | [MODIFY] | `src/renderer/pages/Settings/BrowserSettingsPanel.tsx` | Remove reveal buttons; add configured badges. |
| **2.1** | [MODIFY] | `src/renderer/pages/Settings/EmailProviderPanel.tsx` | Remove reveal buttons; add write-only masked fields. |
| **2.1** | [MODIFY] | `src/renderer/layouts/StatusBar.tsx` | Wire real cached diagnostic indicators. |
| **2.1** | [MODIFY] | `src/renderer/pages/Accounts/AccountsPage.tsx` | Migrate export settings consumer to real settings API. |
| **2.1** | [MODIFY] | `src/main/main.ts` | Construct `ServiceConnectionManager`, `SettingsService`, and register `settingsIpc`. |
| **2.1** | [REMOVE] | `src/renderer/mocks/mockSettings.ts` | Delete mock settings file. |
| **2.2** | [MODIFY] | `src/main/repositories/AccountRepository.ts` | Add `getAccountSummary()` SQL aggregation query. |
| **2.2** | [NEW] | `src/main/services/AccountService.ts` | Account CRUD, encryption, pagination, and summaries. |
| **2.2** | [NEW] | `src/main/ipc/accountsIpc.ts` | Accounts IPC request/response handlers. |
| **2.2** | [NEW] | `src/main/repositories/__tests__/accountSummary.test.ts` | AccountRepository summary query tests. |
| **2.2** | [NEW] | `src/main/services/__tests__/AccountService.test.ts` | AccountService unit tests on temp SQLite DB. |
| **2.2** | [NEW] | `src/main/ipc/__tests__/accountsIpc.test.ts` | Accounts IPC handler tests. |
| **2.2** | [NEW] | `src/renderer/pages/Accounts/accountsController.ts` | Extracted pure framework-free accounts controller. |
| **2.2** | [NEW] | `src/renderer/pages/Accounts/__tests__/accountsController.test.ts` | Pure accounts controller unit tests (Node lane). |
| **2.2** | [MODIFY] | `src/shared/contracts/ipc-channels.ts` | Add accounts IPC channels. |
| **2.2** | [MODIFY] | `src/shared/contracts/api.ts` | Add accounts contracts to `ElectronBridge`. |
| **2.2** | [MODIFY] | `src/preload/preload.ts` | Expose typed `accounts` API on bridge. |
| **2.2** | [MODIFY] | `src/preload/__tests__/preload.test.ts` | Test accounts bridge exposure. |
| **2.2** | [MODIFY] | `src/renderer/pages/Accounts/AccountsPage.tsx` | Wire real SQLite accounts list, server pagination, and filters. |
| **2.2** | [MODIFY] | `src/renderer/pages/Accounts/columns.tsx` | Replace password strings with configured badges; remove reveal/copy. |
| **2.2** | [MODIFY] | `src/renderer/pages/Accounts/AddAccountDrawer.tsx` | Wire write-only account creation. |
| **2.2** | [MODIFY] | `src/renderer/pages/Accounts/EditAccountDrawer.tsx` | Wire keep/replace/clear secret updates. |
| **2.2** | [MODIFY] | `src/renderer/pages/Accounts/DeleteAccountDialog.tsx` | Wire account deletion with count prompt. |
| **2.2** | [MODIFY] | `src/renderer/pages/Dashboard/DashboardPage.tsx` | Sync table view with real SQLite accounts data. |
| **2.2** | [MODIFY] | `src/renderer/pages/Dashboard/DashboardActionBar.tsx` | Neutral disabled automation message. |
| **2.2** | [MODIFY] | `src/renderer/pages/Dashboard/columns.tsx` | Sync columns with masked boolean DTO. |
| **2.2** | [MODIFY] | `src/main/main.ts` | Register `accountsIpc` and add cleanup to shutdown manager. |
| **2.2** | [REMOVE] | `src/renderer/mocks/mockAccounts.ts` | Delete mock accounts file. |
| **2.3** | [NEW] | `src/main/logging/LogBus.ts` | Bounded ring buffer (10k max, batch 50 / 500ms, DEBUG eviction). |
| **2.3** | [NEW] | `src/main/services/LogService.ts` | Log query, retention cleanup, and live stream service. |
| **2.3** | [NEW] | `src/main/ipc/logsIpc.ts` | Logs query, clear, and WebContents-bound push handlers. |
| **2.3** | [NEW] | `src/main/logging/__tests__/LogBus.test.ts` | LogBus unit tests with fake timers. |
| **2.3** | [NEW] | `src/main/ipc/__tests__/logsIpc.test.ts` | Logs IPC handler & leak-free subscription tests. |
| **2.3** | [NEW] | `src/renderer/pages/Logs/logsController.ts` | Extracted pure framework-free logs controller. |
| **2.3** | [NEW] | `src/renderer/pages/Logs/__tests__/logsController.test.ts` | Pure logs controller unit tests (Node lane). |
| **2.3** | [MODIFY] | `src/shared/contracts/ipc-channels.ts` | Add logs IPC channels. |
| **2.3** | [MODIFY] | `src/shared/contracts/api.ts` | Add logs contracts and push event types to `ElectronBridge`. |
| **2.3** | [MODIFY] | `src/preload/preload.ts` | Expose `logs` API and `logs.onEntry` listener on bridge. |
| **2.3** | [MODIFY] | `src/preload/__tests__/preload.test.ts` | Test logs bridge exposure and push listener cleanup. |
| **2.3** | [MODIFY] | `src/renderer/pages/Logs/LogsPage.tsx` | Wire SQLite log history, live subscription, and clear confirmation. |
| **2.3** | [MODIFY] | `src/renderer/pages/Dashboard/DockedLiveLogs.tsx` | Wire live log stream to docked dashboard panel (200 item cap). |
| **2.3** | [MODIFY] | `src/main/main.ts` | Inject `LogBus` into `createShutdownManager` for 2000ms flush and register `logsIpc`. |
| **2.3** | [REMOVE] | `src/renderer/mocks/mockLogs.ts` | Delete mock logs file. |
| **2.4** | [MODIFY] | `src/main/repositories/AccountRepository.ts` | Add `listForExport()` returning internal encrypted BLOB records. |
| **2.4** | [NEW] | `src/main/services/ExportService.ts` | XLSX, CSV, and TXT export generator with formula defense. |
| **2.4** | [NEW] | `src/main/ipc/exportIpc.ts` | Native save dialog and export IPC handler. |
| **2.4** | [NEW] | `src/main/repositories/__tests__/accountExportQuery.test.ts` | Internal export query tests. |
| **2.4** | [NEW] | `src/main/services/__tests__/ExportService.test.ts` | ExportService unit tests (XLSX, CSV, TXT, temp-file write and safe rename). |
| **2.4** | [NEW] | `src/main/ipc/__tests__/exportIpc.test.ts` | Export IPC handler & dialog seam tests. |
| **2.4** | [NEW] | `src/renderer/pages/Accounts/exportController.ts` | Extracted pure framework-free export controller. |
| **2.4** | [NEW] | `src/renderer/pages/Accounts/__tests__/exportController.test.ts` | Pure export controller unit tests (Node lane). |
| **2.4** | [MODIFY] | `src/shared/contracts/ipc-channels.ts` | Add `accounts:export` IPC channel. |
| **2.4** | [MODIFY] | `src/shared/contracts/api.ts` | Add export contracts to `ElectronBridge`. |
| **2.4** | [MODIFY] | `src/preload/preload.ts` | Expose `accounts.export` on bridge. |
| **2.4** | [MODIFY] | `src/renderer/pages/Accounts/ExportDialog.tsx` | Wire real export execution and progress. |
| **2.4** | [MODIFY] | `src/main/main.ts` | Register `exportIpc` and add cleanup to shutdown manager. |

---

## 8. Candidate Dependency Decision: `exceljs`

- **Package**: `exceljs@4.4.0` (conditional candidate version).
- **Candidate Evaluation**: Native Node/Electron library supporting styled `.xlsx` generation, explicit column widths, header formatting, and numeric/date cell typing via `Workbook.xlsx.writeFile(tempPath)`.
- **Preflight Requirement**: Task 2.4.1 runs `npm view exceljs version engines` and evaluates compatibility with Node 22/24 and Electron 35 before modifying `package.json`. If compatibility or security checks fail to demonstrate support, Slice 2.4 execution stops immediately.
- **Timing**: Installed strictly at Task 2.4.1. Zero new dependencies installed during Slices 2.1–2.3.
- **Security Audit**: `npm audit --omit=dev` must return 0 vulnerabilities immediately upon installation.

---

## 9. Mock Removal Map & `rg` Verification

| Mock File | Consumers Migrated First | Removal Slice | Verification Command |
| :--- | :--- | :--- | :--- |
| `src/renderer/mocks/mockSettings.ts` | `SettingsPage.tsx`, `AccountsPage.tsx` | Slice 2.1 (Task 2.1.4) | `rg "mockSettings" src/renderer` ➔ 0 lines |
| `src/renderer/mocks/mockAccounts.ts` | `AccountsPage.tsx`, `DashboardPage.tsx` | Slice 2.2 (Task 2.2.4) | `rg "mockAccounts" src/renderer` ➔ 0 lines |
| `src/renderer/mocks/mockLogs.ts` | `LogsPage.tsx`, `DashboardPage.tsx`, `DockedLiveLogs.tsx` | Slice 2.3 (Task 2.3.4) | `rg "mockLogs" src/renderer` ➔ 0 lines |

---

## 10. Secret Data-Flow & Privacy Audit

| Boundary | Secret Representation | Protection Mechanism |
| :--- | :--- | :--- |
| **User Input (React Form)** | Plaintext in `<input type="password">` | Wiped from pure controller state immediately upon save and on unmount. |
| **Renderer ➔ Main (IPC)** | Write-only `SettingsSaveRequestDTO` / `AccountCreateInputDTO` | Handled over isolated IPC; never logged or serialized to console. |
| **Main Process (Service)** | Ephemeral string in local scope | Encrypted immediately via `safeStorage` into `Buffer`. |
| **SQLite Storage** | `BLOB` (ciphertext bytes) | Stored in `service_credentials` / `accounts` tables; never plaintext. |
| **Main ➔ Renderer (IPC Response)** | Boolean flags (`hasPasswordCapcut`) | Plaintext password strings are strictly excluded from response DTOs. |
| **Table Display (React UI)** | Badge (`Đã thiết lập`) | Zero secret text rendered to DOM; no reveal/copy buttons. |
| **Export Generation (Main)** | Decrypted row-by-row during export | Streamed directly to disk file for CSV/TXT; workbook released after XLSX write; zero decrypted content returned to UI. |

---

## 11. Failure & Rollback Matrix

| Failure Mode | Impact | Recovery / Rollback Procedure |
| :--- | :--- | :--- |
| **safeStorage unavailable** | Credential encryption fails | `CredentialVault` throws `VaultUnavailableError`; returns normalized error envelope `ERR_VAULT_UNAVAILABLE` without partial write. |
| **SQLite write failure during composite save** | Incomplete settings/credentials | `DatabaseTransactionRunner` rolls back entire transaction atomically. |
| **Log queue overflow (>10,000 items)** | Memory pressure | `LogBus` drops `DEBUG` first, evicts oldest `DEBUG` for non-DEBUG, and increments `overflowDroppedCount`. |
| **Renderer disconnect during log stream** | Dangling IPC listener | WebContents `destroyed` event cleans up subscription automatically. |
| **Export destination file already exists** | Collision on rename | `ExportService` catches rename collision, cleans up temp file, and returns normalized `EXPORT_TARGET_EXISTS` instructing user to choose a new filename (never deletes target). |

---

## 12. Risk Register & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Formula Injection in CSV Export** | Spreadsheet script execution | Sanitize leading `=`, `+`, `-`, `@`, `\t`, `\r` by prefixing with `'` in `ExportService`. |
| **Log Stream UI Render Overload** | React UI freezing during bursts | Controller caps displayed live logs buffer to 200 items. |
| **Shutdown Hang on Heavy Log Flush** | Application slow to quit | 2000ms bounded race in `createShutdownManager` guarantees DB close and quit even if flush stalls. |
| **Accidental Plaintext Password Leak** | Credentials compromised | Strict `AccountListItemSchema` strips password fields; verified by automated unit tests and `columns.tsx` badge rendering. |

---

## 13. Data & Backward Compatibility Notes

1. **Zero Legacy Data Migration**: Legacy plaintext renderer mock records are **not** imported into SQLite. SQLite database starts empty and is populated strictly through real user interactions.
2. **Schema Versioning & Settings Loading**: SQLite database schema remains at version `001_initial_schema`. Persisted settings records lacking `logs` are merged with defaults (`logs: { retention: '30' }`) before strict parsing, preserving existing database files without requiring migration or database deletion.
3. **Database Integrity**: Never delete existing user databases or reset SQLite data.

---

## 14. Pre-Execution Self-Review Checklist

- [x] **Superpowers Header & Constraints**: Explicit sub-skill requirement, Goal, Architecture, Tech Stack, Spec Path, and Global Constraints present at document top.
- [x] **Spec & Task Coverage**: All 4 vertical slices (2.1 to 2.4) contain complete RED-GREEN-REFACTOR task breakdowns with exact checkbox steps.
- [x] **No Placeholders**: Zero `TODO`, `TBD`, or generic `"handle errors"` statements. All schemas, signatures, and commands are concrete.
- [x] **Type & Signature Consistency**: Shared DTOs, repository interfaces, and IPC registries match throughout all files (`SanitizedDiagnosticResultSchema` includes `PROVIDER_NOT_IMPLEMENTED`, `CredentialStatusDTOSchema` includes `isStale: boolean`, `LogSettingsSchema` defined in Slice 2.1).
- [x] **Forbidden Mock Imports**: All mock files have clear consumer migration tasks and automated `rg` verification gates.
- [x] **Forbidden Reveal / Copy Controls**: All password visibility eye toggles and copy-to-clipboard buttons are eliminated.
- [x] **Forbidden Fake Connected Labels**: GPM and unverified services display neutral configured/unknown badges, never fake green connected badges.
- [x] **Zero Raw `any`**: Explicit types used across all TypeScript interfaces and test mocks.
- [x] **Status & Error Code Consistency**: Uniform use of `PROVIDER_NOT_IMPLEMENTED`, `EXPORT_TARGET_EXISTS`, `ERR_VAULT_UNAVAILABLE`, `ERR_VALIDATION_FAILED`.
- [x] **No Git Commands**: All task steps use standard local PowerShell commands; git commits are omitted.

---

## 15. Approval Gate

**Status:** SLICE 2.1 IMPLEMENTED — AUTOMATED VERIFIED; MANUAL UI SAVE/RESTART AWAITING USER — SLICES 2.2–2.4 GATED  
**Approval Record (2026-09-01):** The controlling reviewer formally approved Slice 2.1 on 2026-09-01. Slices 2.2–2.4 remain gated and require separate formal approval upon completion and verification of preceding slices.

---

## 16. Slice 2.1 Execution Evidence (2026-09-01)

- **Task 2.1.1 (Persistence & Services Foundation)**:
  - TDD RED: Confirmed missing `transaction.ts`, `SettingsService.ts`, `ServiceConnectionManager.ts`, and schema extensions.
  - Focused GREEN: `npm run test:node -- src/main/database/__tests__/transaction.test.ts src/main/services/__tests__/SettingsService.test.ts` passed 18/18 tests.
- **Task 2.1.3 (Settings IPC & Preload Bridge)**:
  - TDD RED: Confirmed missing settings IPC handlers, active channels, and preload bridge properties.
  - Focused GREEN: `npm run test:node -- src/main/ipc/__tests__/settingsIpc.test.ts src/preload/__tests__/preload.test.ts` passed 13/13 tests.
- **Task 2.1.4 (Pure Controller & UI Integration)**:
  - TDD RED: Confirmed missing `src/renderer/pages/Settings/settingsController.ts`.
  - Focused GREEN: `npm run test:node -- src/renderer/pages/Settings/__tests__/settingsController.test.ts` passed 12/12 tests.
- **Automated Regression Suite Verification**:
  - `npm run test:node`: 14 test files, 119 tests passed, exit 0.
  - `npm run typecheck`: exit 0 (strict TypeScript compiler clean).
  - `npm run lint`: exit 0 (ESLint zero warnings, zero errors).
  - `npm run build`: exit 0; production bundle built cleanly (renderer, main, and CommonJS sandbox preload).
  - `npm run test:electron` (outside sandbox): exit 0; Electron 35.7.5 / Node 22.16.0 / Chrome 134 verified better-sqlite3 WAL query execution, real safeStorage roundtrip, context isolation, ping, `settings.get` (`logs.retention === '30'`), `settings.save` request delivery, and `credentials.test` sanitized `PROVIDER_NOT_IMPLEMENTED` response.
- **Production Main Process Smoke Verification**:
  - Launched `dist-electron/main.js` on isolated temporary user-data directories twice; stayed running >10 seconds each time, initialized `automanager.db` plus WAL/SHM files, restarted on existing database without `MAIN_INIT_FAILED`, and exact temp directories were safely unlinked.
- **Static & Security Boundary Audits**:
  - Zero `mockSettings` imports or files remain (`rg "mockSettings" src/` returned 0 matches).
  - Eliminated all plaintext password visibility `Eye` / `EyeOff` toggles, copy buttons, and fake `setTimeout` connection simulation timers.
  - GPM displays neutral `Đã cấu hình: Port <n>` badge; credential inputs are strictly write-only password fields.
- **Visual UI Inspection & Manual Signoff Status**:
  - Windows Computer Use visual inspection confirmed `SettingsPage` renders with canonical defaults, neutral status badges, write-only Gmail/DongVan fields, and six canonical export fields.
  - Because user interacted with the window during automation, the controlling agent stopped rather than competing for input.
  - Manual GUI Save + restart verification was not completed and must remain **unchecked/pending**.
  - Playwright/CDP fallback was not used because Playwright is not installed (no dependencies added).
  - Slices 2.2–2.4 remain **strictly gated** until manual UI Save/restart signoff.
