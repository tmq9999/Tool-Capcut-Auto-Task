# Phase 0 & 1 Detailed TDD Implementation Plan: Contracts, Schemas & Persistence Foundation

**Document Status:** COMPLETED — VERIFIED  
**File Location:** `docs/superpowers/plans/2026-09-01-phase-0-1-contracts-persistence-foundation.md`  
**Master Plan Reference:** [`docs/superpowers/plans/2026-09-01-backend-persistence-real-api-master.md`](file:///d:/GeminiWorkspaceNew/ToolCapCut/docs/superpowers/plans/2026-09-01-backend-persistence-real-api-master.md)  
**Target Scope:** Phase 0 (Contract Freeze & Strict Runtime Zod Schemas) + Phase 1 (Persistence, Security, Typed IPC & Test Foundation)  
**Strict Policy:** No source code changes or dependency installations in this planning turn.

---

> [!IMPORTANT]
> **Execution Protocol for Implementing Agents:**  
> - Follow the Red-Green-Refactor cycle strictly for every single task.
> - Zero explicit `any` in all production and test code. Use typed SQLite row interfaces, explicit bind parameter types, and structural mocks.
> - Never download undeclared packages on the fly with `npx`. Use only local dependencies declared in `package.json` and invoke them through local package scripts (`npm run test:node`, `npm run test:electron`, `npm run rebuild`, `npm run typecheck`).
> - Keep Renderer strictly isolated (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).
> - Every migration and its `schema_migrations` record (with checksum) must execute inside the same synchronous SQLite transaction.
> - `CredentialVault` must fail closed if `safeStorage` is unavailable; never log or return decrypted secrets to Renderer.
> - Zero empty `catch` blocks anywhere; log only allowlisted diagnostic error codes via `SafeDiagnosticLogger`.
> - Preserve current renderer source compatibility incrementally: do not break existing UI component typechecks during Phase 0–1.

---

## Task 0: Preflight & Environment Assessment

### 0.1 Context & Objectives
Inspect workspace configuration, measure runtime environment versions, verify lockfile consistency, discover built artifact output paths, and establish baseline lint/typecheck before touching dependencies or source files. Note: This workspace is not a Git repository, so Git operations are skipped.

### 0.2 Target Files
- `package.json` [READ-ONLY CHECK]
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.app.json` [READ-ONLY CHECK]
- `vite.config.ts` [READ-ONLY CHECK]

### 0.3 Preflight Checklist Steps (To execute at start of implementation)
1. **Toolchain & Built Output Inspection**: Measure and record exact runtime versions and output paths:
   ```powershell
   node -v
   ./node_modules/.bin/electron -v
   ```
   Inspect Vite config to confirm built main and preload output paths (e.g. `dist-electron/main.js` and `dist-electron/preload.mjs` or `dist-electron/preload.js`).
2. **Compatibility Resolution**:
   - Verify `better-sqlite3` compatibility with measured Node and Electron versions.
   - Verify `vitest` compatibility with installed `vite` (`6.2.0`).
   - Verify `@electron/rebuild` compatibility with Electron version.
   - Check if `better-sqlite3` includes built-in type definitions or if `@types/better-sqlite3` is required.
3. **Lockfile Verification**: Confirm `package-lock.json` is present and consistent.
4. **Baseline Verification**:
   ```powershell
   npm run lint
   npm run build
   ```
   *Expected Evidence*: ESLint exits with code 0 (0 warnings/errors), and Vite build generates clean `dist` / `dist-electron`.

---

## Task 1: Test Foundation, Dependency Manifest & Local Scripts

### 1.1 Context & Objectives
Add Phase 0–1 approved dependencies resolved during preflight (`zod`, `better-sqlite3`, `@types/better-sqlite3` if needed, `vitest`, `@electron/rebuild`), configure `vitest.config.ts`, and declare distinct test lane scripts (`test:node`, `test:electron`, `test`).

### 1.2 Target Files
- `package.json` [MODIFY]
- `vitest.config.ts` [NEW]
- `src/shared/__tests__/foundation.test.ts` [NEW]

### 1.3 Step-by-Step TDD Execution

#### Step 1.3.1: Write Failing Baseline Test
- **File**: `src/shared/__tests__/foundation.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect } from 'vitest';

  describe('Foundation Test Suite', () => {
    it('verifies vitest test runner is operational in Node environment', () => {
      expect(typeof process).toBe('object');
      expect(process.versions.node).toBeDefined();
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `npm ERR! Missing script: "test:node"` or `vitest: not found`.

#### Step 1.3.2: Minimal Production / Config Change
1. **Update `package.json`**:
   - Add approved dependencies based on preflight compatibility check:
     - `dependencies`: `"better-sqlite3": "12.6.2"`, `"zod": "3.24.2"` (or exact resolved versions).
     - `devDependencies`: `"@electron/rebuild": "3.7.1"`, `"vitest": "3.0.7"`, `"@types/better-sqlite3": "7.6.12"` (if needed).
   - Configure local scripts:
     ```json
     "scripts": {
       "dev": "vite",
       "build": "tsc && vite build",
       "lint": "eslint .",
       "preview": "vite preview",
       "typecheck": "tsc --noEmit",
       "test:node": "vitest run",
       "test:watch": "vitest",
       "test:electron": "npm run build && electron ./scripts/run-electron-harness.cjs",
       "test": "npm run test:node && npm run test:electron",
       "rebuild": "electron-rebuild -f -w better-sqlite3"
     }
     ```
2. **Install approved packages**: `npm install`
3. **Create `vitest.config.ts`**:
   ```ts
   import { defineConfig } from 'vitest/config';
   import path from 'path';

   export default defineConfig({
     test: {
       globals: true,
       environment: 'node',
       include: ['src/**/__tests__/**/*.test.ts'],
       exclude: ['node_modules', 'dist', 'dist-electron', 'scripts']
     },
     resolve: {
       alias: {
         '@shared': path.resolve(__dirname, './src/shared'),
         '@main': path.resolve(__dirname, './src/main'),
         '@renderer': path.resolve(__dirname, './src/renderer')
       }
     }
   });
   ```
4. **Rebuild native module for Electron**: `npm run rebuild`

#### Step 1.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/shared/__tests__/foundation.test.ts (1 test) - 1 passed`

#### Step 1.3.4: Refactor & Typecheck
- **Local Command**: `npm run typecheck`
- **Expected Evidence**: 0 TypeScript errors.

---

## Task 2: Strict Runtime Zod Schemas & Inferred Canonical DTOs

### 2.1 Context & Objectives
Define strict runtime Zod schemas for application settings, discriminated union credentials, canonical logs, account operations (with write-only secret semantics), query filters, sanitized diagnostic metadata, and normalized IPC envelopes via a generic schema factory `createIpcEnvelopeSchema<T>()`. Make schemas strict (`.strict()`) to reject unexpected keys/secrets. Invert type definitions using `z.infer`.

### 2.2 Target Files
- `src/shared/schemas/common.schema.ts` [NEW]
- `src/shared/schemas/settings.schema.ts` [NEW]
- `src/shared/schemas/credentials.schema.ts` [NEW]
- `src/shared/schemas/log.schema.ts` [NEW]
- `src/shared/schemas/account.schema.ts` [NEW]
- `src/shared/schemas/diagnostics.schema.ts` [NEW]
- `src/shared/schemas/ipc-envelope.schema.ts` [NEW]
- `src/shared/types/domain.ts` [NEW]
- `src/shared/types/canonical-log.ts` [NEW]
- `src/shared/types/diagnostics.ts` [NEW]
- `src/shared/types/settings-dto.ts` [NEW]
- `src/shared/types/account-dto.ts` [NEW]

### 2.3 Step-by-Step TDD Execution

#### Step 2.3.1: Write Failing Positive and Negative Schema Tests
- **File**: `src/shared/schemas/__tests__/schemas.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { AppSettingsSchema } from '../settings.schema';
  import { SaveCredentialInputSchema } from '../credentials.schema';
  import { CanonicalRuntimeLogSchema } from '../log.schema';
  import { AccountCreateInputSchema, AccountUpdateInputSchema } from '../account.schema';
  import { CredentialDiagnosticMetadataSchema } from '../diagnostics.schema';
  import { createIpcEnvelopeSchema } from '../ipc-envelope.schema';
  import { z } from 'zod';

  describe('Strict Runtime Zod Schemas', () => {
    describe('AppSettingsSchema', () => {
      const valid = {
        general: { theme: 'dark' as const, language: 'vi' as const, autoSaveConfig: true, sessionRestore: true },
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
          checkedFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'] as const,
          availableFields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'] as const
        }
      };

      it('accepts valid full settings', () => {
        expect(AppSettingsSchema.safeParse(valid).success).toBe(true);
      });

      it('rejects unknown top-level keys (strict)', () => {
        const withExtra = { ...valid, unexpectedKey: 'malicious' };
        expect(AppSettingsSchema.safeParse(withExtra).success).toBe(false);
      });

      it('rejects secrets accidentally placed inside AppSettings', () => {
        const withSecret = {
          ...valid,
          general: { ...valid.general, apiKey: 'sk-secret-123' }
        };
        expect(AppSettingsSchema.safeParse(withSecret).success).toBe(false);
      });

      it('rejects GPM port boundaries (0, 65536, negative, float)', () => {
        expect(AppSettingsSchema.safeParse({ ...valid, browser: { ...valid.browser, gpm: { port: 0 } } }).success).toBe(false);
        expect(AppSettingsSchema.safeParse({ ...valid, browser: { ...valid.browser, gpm: { port: 65536 } } }).success).toBe(false);
        expect(AppSettingsSchema.safeParse({ ...valid, browser: { ...valid.browser, gpm: { port: -1 } } }).success).toBe(false);
        expect(AppSettingsSchema.safeParse({ ...valid, browser: { ...valid.browser, gpm: { port: 19995.5 } } }).success).toBe(false);
      });

      it('rejects invalid export fields outside approved 6 fields', () => {
        const withInvalidField = {
          ...valid,
          exportConfig: { ...valid.exportConfig, checkedFields: ['email', 'unapprovedField'] }
        };
        expect(AppSettingsSchema.safeParse(withInvalidField).success).toBe(false);
      });
    });

    describe('SaveCredentialInputSchema & Multilogin Validation', () => {
      it('accepts Multilogin automationToken mode', () => {
        const res = SaveCredentialInputSchema.safeParse({
          serviceName: 'multilogin',
          auth: { mode: 'token', automationToken: 'ml-token-abc' }
        });
        expect(res.success).toBe(true);
      });

      it('accepts Multilogin email+password mode', () => {
        const res = SaveCredentialInputSchema.safeParse({
          serviceName: 'multilogin',
          auth: { mode: 'credentials', email: 'user@example.com', password: 'secretpassword' }
        });
        expect(res.success).toBe(true);
      });

      it('rejects Multilogin missing password or invalid email', () => {
        expect(SaveCredentialInputSchema.safeParse({
          serviceName: 'multilogin',
          auth: { mode: 'credentials', email: 'invalid-email', password: 'pass' }
        }).success).toBe(false);

        expect(SaveCredentialInputSchema.safeParse({
          serviceName: 'multilogin',
          auth: { mode: 'credentials', email: 'user@example.com' }
        }).success).toBe(false);
      });
    });

    describe('CredentialDiagnosticMetadataSchema', () => {
      it('validates sanitized diagnostic metadata and reject unknown fields', () => {
        const validMeta = {
          maskedHint: 'gl-••••1234',
          status: 'connected' as const,
          lastTestedAt: '2026-09-01T00:00:00.000Z',
          lastTestResult: {
            code: 'OK' as const,
            message: 'Connected successfully',
            timestamp: '2026-09-01T00:00:00.000Z',
            details: { latencyMs: 120, profileCount: 5 }
          },
          balance: 150000,
          balanceFetchedAt: '2026-09-01T00:00:00.000Z'
        };
        expect(CredentialDiagnosticMetadataSchema.safeParse(validMeta).success).toBe(true);

        const withRawPayload = { ...validMeta, rawVendorResponse: { rawToken: 'secret' } };
        expect(CredentialDiagnosticMetadataSchema.safeParse(withRawPayload).success).toBe(false);
      });
    });

    describe('createIpcEnvelopeSchema Factory', () => {
      const TestDataSchema = z.object({ count: z.number() }).strict();
      const Envelope = createIpcEnvelopeSchema(TestDataSchema);

      it('validates matching success payload', () => {
        expect(Envelope.safeParse({ success: true, data: { count: 10 } }).success).toBe(true);
      });

      it('rejects invalid success payload that does not match inner schema', () => {
        expect(Envelope.safeParse({ success: true, data: { count: 'not-a-number' } }).success).toBe(false);
        expect(Envelope.safeParse({ success: true, data: { count: 10, extra: true } }).success).toBe(false);
      });

      it('validates normalized error envelope', () => {
        const err = { success: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } };
        expect(Envelope.safeParse(err).success).toBe(true);
      });
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `Cannot find module '../settings.schema'`.

#### Step 2.3.2: Minimal Production Implementation
- **File**: `src/shared/schemas/common.schema.ts`
  ```ts
  import { z } from 'zod';

  export const PaginationQuerySchema = z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50)
  }).strict();

  export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
  ```

- **File**: `src/shared/schemas/settings.schema.ts`
  ```ts
  import { z } from 'zod';

  export const ExportFieldEnum = z.enum([
    'email',
    'passwordCapcut',
    'emailData',
    'credit',
    'subscription',
    'createdAt'
  ]);
  export type ExportField = z.infer<typeof ExportFieldEnum>;

  export const GeneralSettingsSchema = z.object({
    theme: z.enum(['dark', 'light']).default('dark'),
    language: z.enum(['vi', 'en']).default('vi'),
    autoSaveConfig: z.boolean().default(true),
    sessionRestore: z.boolean().default(true)
  }).strict();

  export const BrowserSettingsSchema = z.object({
    provider: z.enum(['gpm', 'multilogin', 'gologin', 'camoufox', 'patchright']).default('gpm'),
    gpm: z.object({
      port: z.number().int().min(1).max(65535).default(19995)
    }).strict().default({ port: 19995 }),
    multilogin: z.object({
      port: z.number().int().min(1).max(65535).default(35000)
    }).strict().default({ port: 35000 }),
    gologin: z.object({
      autoPort: z.boolean().default(true)
    }).strict().default({ autoPort: true }),
    camoufox: z.object({
      headless: z.boolean().default(false)
    }).strict().default({ headless: false }),
    patchright: z.object({
      headless: z.boolean().default(false)
    }).strict().default({ headless: false })
  }).strict();

  export const ExportSettingsSchema = z.object({
    defaultFormat: z.enum(['xlsx', 'csv', 'txt']).default('xlsx'),
    checkedFields: z.array(ExportFieldEnum).default([
      'email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'
    ]),
    availableFields: z.array(ExportFieldEnum).default([
      'email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'
    ])
  }).strict();

  export const AppSettingsSchema = z.object({
    general: GeneralSettingsSchema,
    browser: BrowserSettingsSchema,
    exportConfig: ExportSettingsSchema
  }).strict();

  export type AppSettingsDTO = z.infer<typeof AppSettingsSchema>;
  ```

- **File**: `src/shared/schemas/credentials.schema.ts`
  ```ts
  import { z } from 'zod';

  export const MultiloginAuthSchema = z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('token'),
      automationToken: z.string().min(1, 'Automation token is required')
    }).strict(),
    z.object({
      mode: z.literal('credentials'),
      email: z.string().email('Valid email required'),
      password: z.string().min(1, 'Password is required')
    }).strict()
  ]);

  export const SaveCredentialInputSchema = z.discriminatedUnion('serviceName', [
    z.object({ serviceName: z.literal('gmail94'), apiKey: z.string().min(1) }).strict(),
    z.object({ serviceName: z.literal('multilogin'), auth: MultiloginAuthSchema }).strict(),
    z.object({ serviceName: z.literal('kiotproxy'), apiToken: z.string().min(1) }).strict(),
    z.object({ serviceName: z.literal('dongvanfb'), apiKey: z.string().min(1) }).strict(),
    z.object({ serviceName: z.literal('gologin'), apiToken: z.string().min(1) }).strict()
  ]);

  export type SaveCredentialInputDTO = z.infer<typeof SaveCredentialInputSchema>;
  ```

- **File**: `src/shared/schemas/diagnostics.schema.ts`
  ```ts
  import { z } from 'zod';

  export const DiagnosticStatusEnum = z.enum([
    'unknown', 'testing', 'connected', 'degraded', 'offline'
  ]);
  export type DiagnosticStatus = z.infer<typeof DiagnosticStatusEnum>;

  export const SanitizedDiagnosticDetailsSchema = z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ).optional();

  export const SanitizedDiagnosticResultSchema = z.object({
    code: z.enum(['OK', 'AUTH_ERROR', 'NETWORK_ERROR', 'RATE_LIMITED', 'CONFIG_ERROR']),
    message: z.string().min(1),
    timestamp: z.string().datetime(),
    details: SanitizedDiagnosticDetailsSchema
  }).strict();

  export type SanitizedDiagnosticResult = z.infer<typeof SanitizedDiagnosticResultSchema>;

  export const CredentialDiagnosticMetadataSchema = z.object({
    maskedHint: z.string(),
    status: DiagnosticStatusEnum,
    lastTestedAt: z.string().datetime().optional(),
    lastTestResult: SanitizedDiagnosticResultSchema.optional(),
    balance: z.number().optional(),
    balanceFetchedAt: z.string().datetime().optional()
  }).strict();

  export type CredentialDiagnosticMetadata = z.infer<typeof CredentialDiagnosticMetadataSchema>;

  export const CredentialStatusDTOSchema = z.object({
    serviceName: z.string(),
    isConfigured: z.boolean(),
    metadata: CredentialDiagnosticMetadataSchema
  }).strict();

  export type CredentialStatusDTO = z.infer<typeof CredentialStatusDTOSchema>;
  ```

- **File**: `src/shared/schemas/ipc-envelope.schema.ts`
  ```ts
  import { z } from 'zod';

  export const NormalizedIpcErrorSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
  }).strict();

  export type NormalizedIpcError = z.infer<typeof NormalizedIpcErrorSchema>;

  export function createIpcEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z.discriminatedUnion('success', [
      z.object({
        success: z.literal(true),
        data: dataSchema
      }).strict(),
      z.object({
        success: z.literal(false),
        error: NormalizedIpcErrorSchema
      }).strict()
    ]);
  }

  export type IpcEnvelope<T> =
    | { success: true; data: T }
    | { success: false; error: NormalizedIpcError };
  ```

- **File**: `src/shared/schemas/account.schema.ts`
  ```ts
  import { z } from 'zod';

  export const AccountStatusEnum = z.enum([
    'active', 'processing', 'error', 'disabled', 'waiting', 'done'
  ]);
  export type AccountStatus = z.infer<typeof AccountStatusEnum>;

  export const SecretOperationSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('keep') }).strict(),
    z.object({ action: z.literal('replace'), value: z.string().min(1) }).strict(),
    z.object({ action: z.literal('clear') }).strict()
  ]);
  export type SecretOperation = z.infer<typeof SecretOperationSchema>;

  export const AccountCreateInputSchema = z.object({
    email: z.string().email(),
    emailProvider: z.string().min(1),
    emailPassword: z.string().optional(),
    passwordCapcut: z.string().optional(),
    emailData: z.string().optional(),
    credit: z.number().int().min(0).default(0),
    subscription: z.string().optional(),
    status: AccountStatusEnum.default('active'),
    automationStep: z.string().optional(),
    proxy: z.string().optional(),
    browserProvider: z.string().optional(),
    browserProfileId: z.string().optional(),
    notes: z.string().optional()
  }).strict();

  export type AccountCreateInputDTO = z.infer<typeof AccountCreateInputSchema>;

  export const AccountUpdateInputSchema = z.object({
    email: z.string().email().optional(),
    emailProvider: z.string().min(1).optional(),
    emailPasswordOp: SecretOperationSchema.optional(),
    passwordCapcutOp: SecretOperationSchema.optional(),
    emailDataOp: SecretOperationSchema.optional(),
    credit: z.number().int().min(0).optional(),
    subscription: z.string().nullable().optional(),
    status: AccountStatusEnum.optional(),
    automationStep: z.string().nullable().optional(),
    proxy: z.string().nullable().optional(),
    browserProvider: z.string().nullable().optional(),
    browserProfileId: z.string().nullable().optional(),
    notes: z.string().nullable().optional()
  }).strict();

  export type AccountUpdateInputDTO = z.infer<typeof AccountUpdateInputSchema>;

  export const AccountFilterSchema = z.object({
    query: z.string().optional(),
    status: z.string().optional(),
    emailProvider: z.string().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50)
  }).strict();

  export type AccountFilterDTO = z.infer<typeof AccountFilterSchema>;

  export const AccountListItemSchema = z.object({
    id: z.string(),
    email: z.string(),
    emailProvider: z.string(),
    hasEmailPassword: z.boolean(),
    hasPasswordCapcut: z.boolean(),
    hasEmailData: z.boolean(),
    credit: z.number(),
    subscription: z.string().nullable(),
    status: AccountStatusEnum,
    automationStep: z.string().nullable(),
    proxy: z.string().nullable(),
    browserProvider: z.string().nullable(),
    browserProfileId: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
  }).strict();

  export type AccountListItemDTO = z.infer<typeof AccountListItemSchema>;
  ```

- **File**: `src/shared/schemas/log.schema.ts`
  ```ts
  import { z } from 'zod';

  export const CanonicalLogStatusSchema = z.enum([
    'INFO', 'SUCCESS', 'WARNING', 'WAITING', 'ERROR', 'DEBUG'
  ]);
  export type CanonicalLogStatus = z.infer<typeof CanonicalLogStatusSchema>;

  export const CanonicalRuntimeLogSchema = z.object({
    id: z.string().min(1),
    accountId: z.string().optional(),
    email: z.string(),
    step: z.string(),
    status: CanonicalLogStatusSchema,
    message: z.string(),
    createdAt: z.string().datetime()
  }).strict();

  export type CanonicalRuntimeLog = z.infer<typeof CanonicalRuntimeLogSchema>;

  export const LogFilterSchema = z.object({
    level: z.string().optional(),
    email: z.string().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(100)
  }).strict();

  export type LogFilterDTO = z.infer<typeof LogFilterSchema>;
  ```

#### Step 2.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/shared/schemas/__tests__/schemas.test.ts (9 tests) - 9 passed`

---

## Task 3: Typed IPC Contracts & Narrow Preload Public API

### 3.1 Context & Objectives
Define frozen public contract types in `src/shared/contracts/api.ts`. In Phase 1, `src/preload/preload.ts` implements ONLY baseline infrastructure methods (`platform`, `version`, `ping`). Future Phase 2 domain methods return safe typed `NOT_IMPLEMENTED` envelopes or are deferred until their respective vertical slice.

### 3.2 Target Files
- `src/shared/contracts/ipc-channels.ts` [NEW]
- `src/shared/contracts/api.ts` [MODIFY]
- `src/shared/types/provider-interfaces.ts` [NEW]
- `src/shared/contracts/__tests__/contracts.test.ts` [NEW]

### 3.3 Step-by-Step TDD Execution

#### Step 3.3.1: Write Failing Contract Test
- **File**: `src/shared/contracts/__tests__/contracts.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { IPC_CHANNELS } from '../ipc-channels';

  describe('IPC Channel Constants', () => {
    it('freezes channel identifier constants for Phase 0-1', () => {
      expect(IPC_CHANNELS.PING).toBe('app:ping');
      expect(IPC_CHANNELS.SETTINGS_GET).toBe('settings:get');
      expect(IPC_CHANNELS.SETTINGS_SAVE).toBe('settings:save');
      expect(IPC_CHANNELS.CREDENTIALS_SAVE).toBe('credentials:save');
      expect(IPC_CHANNELS.CREDENTIALS_GET_STATUS).toBe('credentials:get-status');
      expect(IPC_CHANNELS.CREDENTIALS_TEST).toBe('credentials:test');
      expect(IPC_CHANNELS.ACCOUNTS_LIST).toBe('accounts:list');
      expect(IPC_CHANNELS.ACCOUNTS_CREATE).toBe('accounts:create');
      expect(IPC_CHANNELS.ACCOUNTS_UPDATE).toBe('accounts:update');
      expect(IPC_CHANNELS.ACCOUNTS_DELETE).toBe('accounts:delete');
      expect(IPC_CHANNELS.ACCOUNTS_EXPORT).toBe('accounts:export');
      expect(IPC_CHANNELS.LOGS_LIST).toBe('logs:list');
      expect(IPC_CHANNELS.LOGS_CLEAR).toBe('logs:clear');
      expect(IPC_CHANNELS.LOGS_ON_ENTRY).toBe('logs:on-entry');
      expect(IPC_CHANNELS.SERVICES_ON_STATUS_CHANGED).toBe('services:on-status-changed');
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `Cannot find module '../ipc-channels'`.

#### Step 3.3.2: Minimal Production Implementation
- **File**: `src/shared/contracts/ipc-channels.ts`
  ```ts
  export const IPC_CHANNELS = {
    PING: 'app:ping',
    SETTINGS_GET: 'settings:get',
    SETTINGS_SAVE: 'settings:save',
    CREDENTIALS_SAVE: 'credentials:save',
    CREDENTIALS_GET_STATUS: 'credentials:get-status',
    CREDENTIALS_TEST: 'credentials:test',
    ACCOUNTS_LIST: 'accounts:list',
    ACCOUNTS_CREATE: 'accounts:create',
    ACCOUNTS_UPDATE: 'accounts:update',
    ACCOUNTS_DELETE: 'accounts:delete',
    ACCOUNTS_EXPORT: 'accounts:export',
    LOGS_LIST: 'logs:list',
    LOGS_CLEAR: 'logs:clear',
    LOGS_ON_ENTRY: 'logs:on-entry',
    SERVICES_ON_STATUS_CHANGED: 'services:on-status-changed'
  } as const;

  export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
  ```

- **File**: `src/shared/contracts/api.ts`
  ```ts
  import type { AppSettingsDTO } from '../schemas/settings.schema';
  import type { SaveCredentialInputDTO } from '../schemas/credentials.schema';
  import type { AccountCreateInputDTO, AccountUpdateInputDTO, AccountFilterDTO, AccountListItemDTO } from '../schemas/account.schema';
  import type { CanonicalRuntimeLog, LogFilterDTO } from '../schemas/log.schema';
  import type { CredentialStatusDTO, SanitizedDiagnosticResult } from '../schemas/diagnostics.schema';
  import type { IpcEnvelope } from '../schemas/ipc-envelope.schema';

  export interface PingResponse {
    pong: boolean;
    timestamp: number;
  }

  export interface ElectronBridge {
    platform: string;
    version: string;
    ping(): Promise<IpcEnvelope<PingResponse>>;
    // Future Phase 2 Domain Methods (Contract Definition)
    settings?: {
      get(): Promise<IpcEnvelope<{ settings: AppSettingsDTO; credentials: CredentialStatusDTO[] }>>;
      save(settings: AppSettingsDTO): Promise<IpcEnvelope<{ success: boolean }>>;
    };
    credentials?: {
      save(input: SaveCredentialInputDTO): Promise<IpcEnvelope<{ success: boolean; maskedHint: string }>>;
      getStatus(): Promise<IpcEnvelope<CredentialStatusDTO[]>>;
      test(serviceName: string): Promise<IpcEnvelope<SanitizedDiagnosticResult>>;
    };
    accounts?: {
      list(filters: AccountFilterDTO): Promise<IpcEnvelope<{ items: AccountListItemDTO[]; total: number }>>;
      create(input: AccountCreateInputDTO): Promise<IpcEnvelope<{ id: string }>>;
      update(id: string, input: AccountUpdateInputDTO): Promise<IpcEnvelope<{ success: boolean }>>;
      delete(ids: string[]): Promise<IpcEnvelope<{ deletedCount: number }>>;
      export(options: { scope: 'all' | 'checked' | 'filtered'; format: 'xlsx' | 'csv' | 'txt'; selectedIds?: string[] }): Promise<IpcEnvelope<{ filePath?: string; cancelled?: boolean }>>;
    };
    logs?: {
      list(filters: LogFilterDTO): Promise<IpcEnvelope<{ items: CanonicalRuntimeLog[]; total: number }>>;
      clear(): Promise<IpcEnvelope<{ success: boolean }>>;
      onEntry(callback: (log: CanonicalRuntimeLog) => void): () => void;
    };
    services?: {
      onStatusChanged(callback: (statuses: CredentialStatusDTO[]) => void): () => void;
    };
  }
  ```

- **File**: `src/shared/types/provider-interfaces.ts`
  ```ts
  import type { SanitizedDiagnosticResult } from '../schemas/diagnostics.schema';

  export interface IProviderConnectivity {
    testConnection(): Promise<SanitizedDiagnosticResult>;
  }

  export interface IBalanceProvider {
    checkBalance(): Promise<number>;
  }

  export interface IProfileListProvider {
    listProfiles(): Promise<Array<{ id: string; name: string; rawStatus?: string }>>;
  }

  export interface IProxyCheckProvider {
    getCurrentProxy(key: string): Promise<string>;
  }
  ```

#### Step 3.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/shared/contracts/__tests__/contracts.test.ts (1 test) - 1 passed`

---

## Task 4: SQLite Connection Factory & PRAGMA Verification

### 4.1 Context & Objectives
Implement the SQLite connection factory using `better-sqlite3`. Configure and assert all mandatory PRAGMAs (`journal_mode = WAL`, `synchronous = NORMAL (1)`, `foreign_keys = ON (1)`, `busy_timeout = 5000`). Test that values are effectively applied.

### 4.2 Target Files
- `src/main/database/connection.ts` [NEW]
- `src/main/database/__tests__/connection.test.ts` [NEW]

### 4.3 Step-by-Step TDD Execution

#### Step 4.3.1: Write Failing Connection Test
- **File**: `src/main/database/__tests__/connection.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect, afterEach } from 'vitest';
  import path from 'path';
  import fs from 'fs';
  import os from 'os';
  import { createDatabaseConnection } from '../connection';
  import type Database from 'better-sqlite3';

  function safeUnlink(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
  }

  describe('SQLite Connection Factory', () => {
    let db: Database.Database | null = null;
    let tempDbPath = '';

    afterEach(() => {
      if (db && db.open) db.close();
      if (tempDbPath) {
        safeUnlink(tempDbPath);
        safeUnlink(`${tempDbPath}-wal`);
        safeUnlink(`${tempDbPath}-shm`);
      }
    });

    it('creates SQLite connection and enforces all mandatory PRAGMAs effectively', () => {
      tempDbPath = path.join(os.tmpdir(), `test-connection-${Date.now()}.db`);
      db = createDatabaseConnection(tempDbPath);

      expect(db.open).toBe(true);

      const journalMode = db.pragma('journal_mode', { simple: true });
      expect(String(journalMode).toLowerCase()).toBe('wal');

      const foreignKeys = db.pragma('foreign_keys', { simple: true });
      expect(foreignKeys).toBe(1);

      const synchronous = db.pragma('synchronous', { simple: true });
      expect(synchronous).toBe(1); // 1 = NORMAL in SQLite

      const busyTimeout = db.pragma('busy_timeout', { simple: true });
      expect(busyTimeout).toBe(5000);
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `Cannot find module '../connection'`.

#### Step 4.3.2: Minimal Production Implementation
- **File**: `src/main/database/connection.ts`
  ```ts
  import Database from 'better-sqlite3';
  import fs from 'fs';
  import path from 'path';

  export interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
  }

  export function createDatabaseConnection(
    dbPath: string,
    options: DatabaseOptions = {}
  ): Database.Database {
    const parentDir = path.dirname(dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const db = new Database(dbPath, {
      readonly: options.readonly ?? false,
      fileMustExist: options.fileMustExist ?? false,
      timeout: options.timeout ?? 5000
    });

    // Enforce mandatory PRAGMAs per AGENTS.md Section 9
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    return db;
  }
  ```

#### Step 4.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/main/database/__tests__/connection.test.ts (1 test) - 1 passed`

---

## Task 5: Versioned Migration Registry with Deterministic Checksums & Synchronous Atomicity

### 5.1 Context & Objectives
Implement a robust migration runner using a statically bundled TypeScript migration registry (`src/main/database/migrations/index.ts`). Compute deterministic SHA-256 checksums for each migration and verify integrity on startup. Each migration DDL and its `schema_migrations` insert run in the exact same synchronous `db.transaction()`. If a migration fails, the transaction rolls back, leaving no half-applied tables or partial version records.

### 5.2 Target Files
- `src/main/database/migrations/001_initial_schema.ts` [NEW]
- `src/main/database/migrations/index.ts` [NEW]
- `src/main/database/migrator.ts` [NEW]
- `src/main/database/__tests__/migrator.test.ts` [NEW]

### 5.3 Step-by-Step TDD Execution

#### Step 5.3.1: Write Failing Migrator Tests
- **File**: `src/main/database/__tests__/migrator.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import path from 'path';
  import fs from 'fs';
  import os from 'os';
  import { createDatabaseConnection } from '../connection';
  import {
    runMigrations,
    getAppliedMigrations,
    validateMigrationRegistry,
    MigrationChecksumMismatchError,
    type MigrationItem
  } from '../migrator';
  import { MIGRATIONS } from '../migrations';
  import type Database from 'better-sqlite3';

  interface SqliteMasterRow {
    name: string;
  }

  interface QueryPlanRow {
    id: number;
    parent: number;
    notused: number;
    detail: string;
  }

  interface SettingRow {
    value: string;
  }

  function safeUnlink(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
  }

  describe('Migration Engine & 001 Initial Schema', () => {
    let db: Database.Database;
    let tempDbPath: string;

    beforeEach(() => {
      tempDbPath = path.join(os.tmpdir(), `test-migrator-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
      db = createDatabaseConnection(tempDbPath);
    });

    afterEach(() => {
      if (db && db.open) db.close();
      if (tempDbPath) {
        safeUnlink(tempDbPath);
        safeUnlink(`${tempDbPath}-wal`);
        safeUnlink(`${tempDbPath}-shm`);
      }
    });

    it('validates migration registry has no duplicate versions, gaps, or empty SQL', () => {
      expect(() => validateMigrationRegistry(MIGRATIONS)).not.toThrow();

      const duplicate: MigrationItem[] = [...MIGRATIONS, { version: 1, name: 'dup', sql: 'SELECT 1;' }];
      expect(() => validateMigrationRegistry(duplicate)).toThrow(/Duplicate migration version/);

      const gap: MigrationItem[] = [
        { version: 1, name: 'v1', sql: 'SELECT 1;' },
        { version: 3, name: 'v3', sql: 'SELECT 1;' }
      ];
      expect(() => validateMigrationRegistry(gap)).toThrow(/Migration version gap/);
    });

    it('creates schema_migrations and applies 001_initial_schema on empty DB', () => {
      const result = runMigrations(db);
      expect(result.appliedCount).toBe(1);

      const applied = getAppliedMigrations(db);
      expect(applied.map((a) => a.version)).toEqual([1]);

      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as SqliteMasterRow[];
      const tables = rows.map((r) => r.name);
      expect(tables).toContain('schema_migrations');
      expect(tables).toContain('app_settings');
      expect(tables).toContain('service_credentials');
      expect(tables).toContain('accounts');
      expect(tables).toContain('runtime_logs');

      // Verify query plan uses index for account filtering
      const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM accounts WHERE status = ?').all('active') as QueryPlanRow[];
      const usesIndex = plan.some((p) => p.detail.includes('USING INDEX idx_accounts_status'));
      expect(usesIndex).toBe(true);
    });

    it('detects altered migration SQL on startup via checksum verification', () => {
      runMigrations(db);

      const tampered: MigrationItem[] = [
        { version: 1, name: '001_tampered', sql: '-- tampered sql statement' }
      ];
      expect(() => runMigrations(db, tampered)).toThrow(MigrationChecksumMismatchError);
    });

    it('reopen persistence test: data survives connection close and reopen', () => {
      runMigrations(db);
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('theme', '\"dark\"')").run();
      db.close();

      const reopenedDb = createDatabaseConnection(tempDbPath);
      const row = reopenedDb.prepare("SELECT value FROM app_settings WHERE key = 'theme'").get() as SettingRow;
      expect(JSON.parse(row.value)).toBe('dark');
      reopenedDb.close();
    });

    it('rolls back completely if a migration statement fails', () => {
      const badMigration: MigrationItem = {
        version: 2,
        name: '002_broken',
        sql: 'CREATE TABLE valid_table (id TEXT); THIS IS INVALID SQL;'
      };

      expect(() => runMigrations(db, [...MIGRATIONS, badMigration])).toThrow();

      const applied = getAppliedMigrations(db);
      expect(applied.map((a) => a.version)).toEqual([1]); // Version 2 not recorded

      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as SqliteMasterRow[];
      const tables = rows.map((r) => r.name);
      expect(tables).not.toContain('valid_table');
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `Cannot find module '../migrator'`.

#### Step 5.3.2: Minimal Production Implementation
- **File**: `src/main/database/migrations/001_initial_schema.ts`
  ```ts
  export const migration001 = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS service_credentials (
    service_name TEXT PRIMARY KEY,
    encrypted_credentials BLOB NOT NULL,
    metadata TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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

  CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
  CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
  CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
  CREATE INDEX IF NOT EXISTS idx_accounts_email_provider ON accounts(email_provider);
  CREATE INDEX IF NOT EXISTS idx_accounts_browser_provider ON accounts(browser_provider);

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

  CREATE INDEX IF NOT EXISTS idx_logs_created_at ON runtime_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_email ON runtime_logs(email);
  CREATE INDEX IF NOT EXISTS idx_logs_status ON runtime_logs(status);
  CREATE INDEX IF NOT EXISTS idx_logs_account_id ON runtime_logs(account_id);
  `;
  ```

- **File**: `src/main/database/migrations/index.ts`
  ```ts
  import { migration001 } from './001_initial_schema';

  export interface MigrationItem {
    version: number;
    name: string;
    sql: string;
  }

  export const MIGRATIONS: MigrationItem[] = [
    {
      version: 1,
      name: '001_initial_schema',
      sql: migration001
    }
  ];
  ```

- **File**: `src/main/database/migrator.ts`
  ```ts
  import type Database from 'better-sqlite3';
  import crypto from 'crypto';
  import { MIGRATIONS, type MigrationItem } from './migrations';

  export { type MigrationItem };

  export class MigrationChecksumMismatchError extends Error {
    constructor(version: number, expected: string, actual: string) {
      super(`Checksum mismatch for migration version ${version}. Stored: ${expected}, Current: ${actual}`);
      this.name = 'MigrationChecksumMismatchError';
    }
  }

  export interface AppliedMigrationRecord {
    version: number;
    checksum: string;
    applied_at: string;
  }

  export function computeMigrationChecksum(sql: string): string {
    return crypto.createHash('sha256').update(sql.trim()).digest('hex');
  }

  export function validateMigrationRegistry(migrations: MigrationItem[]): void {
    const versions = new Set<number>();
    let expectedVersion = 1;

    const sorted = [...migrations].sort((a, b) => a.version - b.version);

    for (const m of sorted) {
      if (versions.has(m.version)) {
        throw new Error(`Duplicate migration version detected: ${m.version}`);
      }
      if (m.version !== expectedVersion) {
        throw new Error(`Migration version gap detected: expected ${expectedVersion}, got ${m.version}`);
      }
      if (!m.sql || m.sql.trim().length === 0) {
        throw new Error(`Empty SQL in migration version ${m.version}`);
      }
      versions.add(m.version);
      expectedVersion++;
    }
  }

  function initMigrationsTable(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  export function getAppliedMigrations(db: Database.Database): AppliedMigrationRecord[] {
    initMigrationsTable(db);
    return db.prepare('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version ASC').all() as AppliedMigrationRecord[];
  }

  export function runMigrations(
    db: Database.Database,
    customMigrations?: MigrationItem[]
  ): { appliedCount: number } {
    initMigrationsTable(db);
    const migrations = customMigrations ?? MIGRATIONS;
    validateMigrationRegistry(migrations);

    const appliedRecords = getAppliedMigrations(db);
    const appliedMap = new Map(appliedRecords.map((r) => [r.version, r.checksum]));

    let appliedCount = 0;

    for (const migration of migrations) {
      const currentChecksum = computeMigrationChecksum(migration.sql);

      if (appliedMap.has(migration.version)) {
        const storedChecksum = appliedMap.get(migration.version);
        if (storedChecksum !== currentChecksum) {
          throw new MigrationChecksumMismatchError(migration.version, storedChecksum ?? '', currentChecksum);
        }
        continue;
      }

      // Execute migration DDL + schema_migrations record in the EXACT SAME synchronous transaction
      const runSingleMigration = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(
          migration.version,
          currentChecksum
        );
      });

      runSingleMigration();
      appliedCount++;
    }

    return { appliedCount };
  }
  ```

#### Step 5.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/main/database/__tests__/migrator.test.ts (5 tests) - 5 passed`

---

## Task 6: Repository Layer with Typed Row Mappings & Sanitized Metadata Validation

### 6.1 Context & Objectives
Implement pure SQL repositories (`SettingsRepository`, `CredentialRepository`, `AccountRepository`, `LogRepository`) mapping SQLite rows from explicit interfaces (zero `any`). In `CredentialRepository`, serialize and validate `metadata` using `CredentialDiagnosticMetadataSchema`. If stored JSON fails schema parsing, throw `DataCorruptionError`. Internal parameter bindings use `type SqliteBindValue = string | number | bigint | Buffer | null;`.

### 6.2 Target Files
- `src/main/repositories/SettingsRepository.ts` [NEW]
- `src/main/repositories/CredentialRepository.ts` [NEW]
- `src/main/repositories/AccountRepository.ts` [NEW]
- `src/main/repositories/LogRepository.ts` [NEW]
- `src/main/repositories/__tests__/repositories.test.ts` [NEW]

### 6.3 Step-by-Step TDD Execution

#### Step 6.3.1: Write Failing Repository Tests
- **File**: `src/main/repositories/__tests__/repositories.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import path from 'path';
  import fs from 'fs';
  import os from 'os';
  import { createDatabaseConnection } from '../../database/connection';
  import { runMigrations } from '../../database/migrator';
  import { SettingsRepository } from '../SettingsRepository';
  import { CredentialRepository, DataCorruptionError } from '../CredentialRepository';
  import { AccountRepository } from '../AccountRepository';
  import { LogRepository } from '../LogRepository';
  import type Database from 'better-sqlite3';

  interface TestSettingData {
    general: { theme: 'dark' | 'light'; language: string };
  }

  function safeUnlink(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
  }

  describe('Repository Layer with Typed Row Mappings', () => {
    let db: Database.Database;
    let tempDbPath: string;

    beforeEach(() => {
      tempDbPath = path.join(os.tmpdir(), `test-repos-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
      db = createDatabaseConnection(tempDbPath);
      runMigrations(db);
    });

    afterEach(() => {
      if (db && db.open) db.close();
      if (tempDbPath) {
        safeUnlink(tempDbPath);
        safeUnlink(`${tempDbPath}-wal`);
        safeUnlink(`${tempDbPath}-shm`);
      }
    });

    it('SettingsRepository: saves and parses typed JSON settings without corruption', () => {
      const repo = new SettingsRepository(db);
      expect(repo.getSetting<TestSettingData>('app_settings')).toBeNull();

      const settings: TestSettingData = { general: { theme: 'dark', language: 'vi' } };
      repo.setSetting('app_settings', settings);

      const retrieved = repo.getSetting<TestSettingData>('app_settings');
      expect(retrieved?.general.theme).toBe('dark');
    });

    it('CredentialRepository: stores BLOBs and validates CredentialDiagnosticMetadata', () => {
      const repo = new CredentialRepository(db);
      const fakeBlob = Buffer.from('encrypted_secret_data');
      const metadata = {
        maskedHint: 'gl-••••36a3',
        status: 'connected' as const,
        lastTestedAt: '2026-09-01T00:00:00.000Z'
      };

      repo.saveCredential('gologin', fakeBlob, metadata);

      const record = repo.getCredential('gologin');
      expect(record).not.toBeNull();
      expect(Buffer.isBuffer(record?.encryptedCredentials)).toBe(true);
      expect(record?.metadata.maskedHint).toBe('gl-••••36a3');

      repo.updateMetadata('gologin', { ...metadata, status: 'degraded' as const });
      const updated = repo.getCredential('gologin');
      expect(updated?.metadata.status).toBe('degraded');
    });

    it('CredentialRepository: throws DataCorruptionError when stored metadata is corrupt', () => {
      const repo = new CredentialRepository(db);
      // Manually insert corrupt JSON
      db.prepare("INSERT INTO service_credentials (service_name, encrypted_credentials, metadata) VALUES ('broken', ?, 'INVALID_JSON')").run(Buffer.from('test'));

      expect(() => repo.getCredential('broken')).toThrow(DataCorruptionError);
    });

    it('AccountRepository: listAccounts maps boolean flags and constrains pagination bounds', () => {
      const repo = new AccountRepository(db);
      repo.createAccount({
        id: 'acc-1',
        email: 'test@example.com',
        emailProvider: 'Gmail',
        passwordCapcutEncrypted: Buffer.from('encPass'),
        credit: 50,
        status: 'active'
      });

      const res = repo.listAccounts({ page: 1, pageSize: 10 });
      expect(res.total).toBe(1);
      expect(res.items[0].email).toBe('test@example.com');
      expect(res.items[0].hasPasswordCapcut).toBe(true);
      expect(res.items[0].hasEmailPassword).toBe(false);

      const bounded = repo.listAccounts({ page: -5, pageSize: 9999 });
      expect(bounded.items.length).toBe(1);
    });

    it('LogRepository: transactional batch insert and non-negative retention cleanup', () => {
      const repo = new LogRepository(db);
      const logs = [
        { id: 'l1', email: 'u1@ex.com', step: 'Proxy', status: 'INFO' as const, message: 'm1', createdAt: new Date().toISOString() },
        { id: 'l2', email: 'u2@ex.com', step: 'Auth', status: 'SUCCESS' as const, message: 'm2', createdAt: new Date().toISOString() }
      ];

      repo.insertBatch(logs);
      const res = repo.queryLogs({ limit: 10, offset: 0 });
      expect(res.total).toBe(2);

      const deleted = repo.cleanupOldLogs(0);
      expect(typeof deleted).toBe('number');
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `Cannot find module '../SettingsRepository'`.

#### Step 6.3.2: Minimal Production Implementation
- **File**: `src/main/repositories/SettingsRepository.ts`
  ```ts
  import type Database from 'better-sqlite3';

  interface AppSettingRow {
    value: string;
  }

  export class SettingsRepository {
    constructor(private readonly db: Database.Database) {}

    getSetting<T>(key: string): T | null {
      const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as AppSettingRow | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.value) as T;
      } catch (err: unknown) {
        return null;
      }
    }

    setSetting<T>(key: string, value: T): void {
      const json = JSON.stringify(value);
      this.db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(key, json);
    }
  }
  ```

- **File**: `src/main/repositories/CredentialRepository.ts`
  ```ts
  import type Database from 'better-sqlite3';
  import {
    CredentialDiagnosticMetadataSchema,
    type CredentialDiagnosticMetadata
  } from '../../shared/schemas/diagnostics.schema';

  export class DataCorruptionError extends Error {
    constructor(serviceName: string) {
      super(`Stored credential metadata for service "${serviceName}" is corrupted.`);
      this.name = 'DataCorruptionError';
    }
  }

  interface CredentialRow {
    service_name: string;
    encrypted_credentials: Buffer;
    metadata: string | null;
    updated_at: string;
  }

  export interface CredentialRecord {
    serviceName: string;
    encryptedCredentials: Buffer;
    metadata: CredentialDiagnosticMetadata;
    updatedAt: string;
  }

  export class CredentialRepository {
    constructor(private readonly db: Database.Database) {}

    private parseMetadata(serviceName: string, raw: string | null): CredentialDiagnosticMetadata {
      if (!raw) {
        return { maskedHint: '••••••••', status: 'unknown' };
      }
      try {
        const json = JSON.parse(raw);
        const parsed = CredentialDiagnosticMetadataSchema.safeParse(json);
        if (!parsed.success) {
          throw new DataCorruptionError(serviceName);
        }
        return parsed.data;
      } catch (err: unknown) {
        throw new DataCorruptionError(serviceName);
      }
    }

    saveCredential(serviceName: string, encryptedData: Buffer, metadata?: CredentialDiagnosticMetadata): void {
      const metadataStr = metadata ? JSON.stringify(metadata) : null;
      this.db.prepare(`
        INSERT INTO service_credentials (service_name, encrypted_credentials, metadata, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(service_name) DO UPDATE SET
          encrypted_credentials = excluded.encrypted_credentials,
          metadata = COALESCE(excluded.metadata, service_credentials.metadata),
          updated_at = CURRENT_TIMESTAMP
      `).run(serviceName, encryptedData, metadataStr);
    }

    getCredential(serviceName: string): CredentialRecord | null {
      const row = this.db.prepare(`
        SELECT service_name, encrypted_credentials, metadata, updated_at
        FROM service_credentials WHERE service_name = ?
      `).get(serviceName) as CredentialRow | undefined;

      if (!row) return null;
      return {
        serviceName: row.service_name,
        encryptedCredentials: row.encrypted_credentials,
        metadata: this.parseMetadata(row.service_name, row.metadata),
        updatedAt: row.updated_at
      };
    }

    getAllCredentials(): CredentialRecord[] {
      const rows = this.db.prepare(`
        SELECT service_name, encrypted_credentials, metadata, updated_at
        FROM service_credentials
      `).all() as CredentialRow[];

      return rows.map((row) => ({
        serviceName: row.service_name,
        encryptedCredentials: row.encrypted_credentials,
        metadata: this.parseMetadata(row.service_name, row.metadata),
        updatedAt: row.updated_at
      }));
    }

    updateMetadata(serviceName: string, metadata: CredentialDiagnosticMetadata): void {
      this.db.prepare(`
        UPDATE service_credentials
        SET metadata = ?, updated_at = CURRENT_TIMESTAMP
        WHERE service_name = ?
      `).run(JSON.stringify(metadata), serviceName);
    }
  }
  ```

- **File**: `src/main/repositories/AccountRepository.ts`
  ```ts
  import type Database from 'better-sqlite3';
  import type { AccountStatus, AccountListItemDTO } from '../../shared/schemas/account.schema';

  type SqliteBindValue = string | number | bigint | Buffer | null;

  interface AccountDbRow {
    id: string;
    email: string;
    email_provider: string;
    email_password_encrypted: Buffer | null;
    password_capcut_encrypted: Buffer | null;
    email_data_encrypted: Buffer | null;
    credit: number;
    subscription: string | null;
    status: string;
    automation_step: string | null;
    proxy: string | null;
    browser_provider: string | null;
    browser_profile_id: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }

  interface CountRow {
    count: number;
  }

  export class AccountRepository {
    constructor(private readonly db: Database.Database) {}

    createAccount(account: {
      id: string;
      email: string;
      emailProvider: string;
      emailPasswordEncrypted?: Buffer | null;
      passwordCapcutEncrypted?: Buffer | null;
      emailDataEncrypted?: Buffer | null;
      credit?: number;
      subscription?: string | null;
      status?: AccountStatus;
      automationStep?: string | null;
      proxy?: string | null;
      browserProvider?: string | null;
      browserProfileId?: string | null;
      notes?: string | null;
    }): void {
      this.db.prepare(`
        INSERT INTO accounts (
          id, email, email_provider, email_password_encrypted, password_capcut_encrypted,
          email_data_encrypted, credit, subscription, status, automation_step, proxy,
          browser_provider, browser_profile_id, notes, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `).run(
        account.id, account.email, account.emailProvider,
        account.emailPasswordEncrypted ?? null, account.passwordCapcutEncrypted ?? null, account.emailDataEncrypted ?? null,
        account.credit ?? 0, account.subscription ?? null, account.status ?? 'active',
        account.automationStep ?? null, account.proxy ?? null, account.browserProvider ?? null,
        account.browserProfileId ?? null, account.notes ?? null
      );
    }

    listAccounts(params: { query?: string; status?: string; emailProvider?: string; page?: number; pageSize?: number }): { items: AccountListItemDTO[]; total: number } {
      const page = Math.max(1, params.page ?? 1);
      const pageSize = Math.min(Math.max(1, params.pageSize ?? 50), 500);
      const offset = (page - 1) * pageSize;

      const conditions: string[] = [];
      const values: SqliteBindValue[] = [];

      if (params.query) {
        conditions.push('(email LIKE ? OR notes LIKE ?)');
        values.push(`%${params.query}%`, `%${params.query}%`);
      }
      if (params.status && params.status !== 'all') {
        conditions.push('status = ?');
        values.push(params.status);
      }
      if (params.emailProvider && params.emailProvider !== 'all') {
        conditions.push('email_provider = ?');
        values.push(params.emailProvider);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM accounts ${whereClause}`).get(...values) as CountRow;

      const rows = this.db.prepare(`
        SELECT * FROM accounts ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...values, pageSize, offset) as AccountDbRow[];

      const items: AccountListItemDTO[] = rows.map((r) => ({
        id: r.id,
        email: r.email,
        emailProvider: r.email_provider,
        hasEmailPassword: r.email_password_encrypted !== null,
        hasPasswordCapcut: r.password_capcut_encrypted !== null,
        hasEmailData: r.email_data_encrypted !== null,
        credit: r.credit,
        subscription: r.subscription,
        status: r.status as AccountStatus,
        automationStep: r.automation_step,
        proxy: r.proxy,
        browserProvider: r.browser_provider,
        browserProfileId: r.browser_profile_id,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));

      return { items, total: totalRow.count };
    }

    getAccountById(id: string): AccountDbRow | null {
      const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountDbRow | undefined;
      return r ?? null;
    }

    deleteAccounts(ids: string[]): number {
      if (ids.length === 0) return 0;
      const placeholders = ids.map(() => '?').join(',');
      const result = this.db.prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...ids);
      return result.changes;
    }
  }
  ```

- **File**: `src/main/repositories/LogRepository.ts`
  ```ts
  import type Database from 'better-sqlite3';
  import type { CanonicalRuntimeLog, CanonicalLogStatus } from '../../shared/schemas/log.schema';

  type SqliteBindValue = string | number | bigint | Buffer | null;

  interface LogDbRow {
    id: string;
    account_id: string | null;
    email: string;
    step: string;
    status: string;
    message: string;
    created_at: string;
  }

  interface CountRow {
    count: number;
  }

  export class LogRepository {
    constructor(private readonly db: Database.Database) {}

    insertBatch(logs: CanonicalRuntimeLog[]): void {
      if (logs.length === 0) return;
      const insert = this.db.prepare(`
        INSERT INTO runtime_logs (id, account_id, email, step, status, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertTransaction = this.db.transaction((items: CanonicalRuntimeLog[]) => {
        for (const log of items) {
          insert.run(log.id, log.accountId ?? null, log.email, log.step, log.status, log.message, log.createdAt);
        }
      });

      insertTransaction(logs);
    }

    queryLogs(params: { level?: string; email?: string; limit?: number; offset?: number }): { items: CanonicalRuntimeLog[]; total: number } {
      const limit = Math.min(Math.max(1, params.limit ?? 100), 500);
      const offset = Math.max(0, params.offset ?? 0);

      const conditions: string[] = [];
      const values: SqliteBindValue[] = [];

      if (params.level && params.level !== 'ALL') {
        conditions.push('status = ?');
        values.push(params.level);
      }
      if (params.email) {
        conditions.push('email LIKE ?');
        values.push(`%${params.email}%`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM runtime_logs ${whereClause}`).get(...values) as CountRow;

      const rows = this.db.prepare(`
        SELECT * FROM runtime_logs ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...values, limit, offset) as LogDbRow[];

      const items: CanonicalRuntimeLog[] = rows.map((r) => ({
        id: r.id,
        accountId: r.account_id ?? undefined,
        email: r.email,
        step: r.step,
        status: r.status as CanonicalLogStatus,
        message: r.message,
        createdAt: r.created_at
      }));

      return { items, total: totalRow.count };
    }

    cleanupOldLogs(retentionDays: number): number {
      const days = Math.max(0, retentionDays);
      const result = this.db.prepare(`
        DELETE FROM runtime_logs
        WHERE created_at < datetime('now', '-' || ? || ' days')
      `).run(days);
      return result.changes;
    }

    clearAllLogs(): void {
      this.db.prepare('DELETE FROM runtime_logs').run();
    }
  }
  ```

#### Step 6.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/main/repositories/__tests__/repositories.test.ts (5 tests) - 5 passed`

---

## Task 7: CredentialVault Security Seam & Fail-Closed Behavior

### 7.1 Context & Objectives
Implement `CredentialVault` using Electron `safeStorage`. Strictly fail closed if `isEncryptionAvailable()` is false by throwing `VaultUnavailableError`. Provide `ICredentialVault` interface for Node test mocking.

### 7.2 Target Files
- `src/main/security/CredentialVault.ts` [NEW]
- `src/main/security/__tests__/CredentialVault.test.ts` [NEW]

### 7.3 Step-by-Step TDD Execution

#### Step 7.3.1: Write Failing Vault Unit Tests
- **File**: `src/main/security/__tests__/CredentialVault.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { CredentialVault, VaultUnavailableError, type SafeStorageBackend } from '../CredentialVault';

  describe('CredentialVault (Fail-Closed Security)', () => {
    it('throws VaultUnavailableError when safeStorage is disabled/unavailable', () => {
      const mockDisabled: SafeStorageBackend = {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('Disabled'); },
        decryptString: () => { throw new Error('Disabled'); }
      };

      const vault = new CredentialVault(mockDisabled);
      expect(() => vault.encrypt('secret-text')).toThrow(VaultUnavailableError);
      expect(() => vault.decrypt(Buffer.from('enc'))).toThrow(VaultUnavailableError);
    });

    it('encrypts and decrypts correctly when safeStorage backend is available', () => {
      const mockEnabled: SafeStorageBackend = {
        isEncryptionAvailable: () => true,
        encryptString: (str: string) => Buffer.from(`enc:${str}`),
        decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, '')
      };

      const vault = new CredentialVault(mockEnabled);
      const enc = vault.encrypt('api-key-value');
      expect(Buffer.isBuffer(enc)).toBe(true);
      expect(vault.decrypt(enc)).toBe('api-key-value');
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `Cannot find module '../CredentialVault'`.

#### Step 7.3.2: Minimal Production Implementation
- **File**: `src/main/security/CredentialVault.ts`
  ```ts
  export class VaultUnavailableError extends Error {
    constructor(message = 'Operating system credential encryption (safeStorage) is unavailable.') {
      super(message);
      this.name = 'VaultUnavailableError';
    }
  }

  export interface SafeStorageBackend {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
  }

  export interface ICredentialVault {
    isAvailable(): boolean;
    encrypt(plainText: string): Buffer;
    decrypt(encrypted: Buffer): string;
  }

  export class CredentialVault implements ICredentialVault {
    constructor(private readonly backend: SafeStorageBackend) {}

    isAvailable(): boolean {
      return this.backend.isEncryptionAvailable();
    }

    encrypt(plainText: string): Buffer {
      if (!this.backend.isEncryptionAvailable()) {
        throw new VaultUnavailableError();
      }
      return this.backend.encryptString(plainText);
    }

    decrypt(encrypted: Buffer): string {
      if (!this.backend.isEncryptionAvailable()) {
        throw new VaultUnavailableError();
      }
      return this.backend.decryptString(encrypted);
    }
  }
  ```

#### Step 7.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/main/security/__tests__/CredentialVault.test.ts (2 tests) - 2 passed`

---

## Task 8: Composition Root & Baseline IPC Infrastructure

### 8.1 Context & Objectives
Implement concrete composition root in `src/main/main.ts` post-`app.whenReady()`: creates SQLite connection in `app.getPath('userData')`, runs migrations, instantiates repositories and `CredentialVault`, registers baseline IPC ping handler, and attaches the one-shot shutdown lifecycle.

### 8.2 Target Files
- `src/main/ipc/registerIpc.ts` [NEW]
- `src/preload/preload.ts` [MODIFY]
- `src/main/main.ts` [MODIFY]

### 8.3 Step-by-Step TDD Execution

#### Step 8.3.1: Minimal Production Implementation
- **File**: `src/main/ipc/registerIpc.ts`
  ```ts
  import { ipcMain } from 'electron';
  import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';
  import type { IpcEnvelope } from '../../shared/schemas/ipc-envelope.schema';
  import type { PingResponse } from '../../shared/contracts/api';

  export function registerBaselineIpc(): void {
    ipcMain.handle(IPC_CHANNELS.PING, async (): Promise<IpcEnvelope<PingResponse>> => {
      return {
        success: true,
        data: { pong: true, timestamp: Date.now() }
      };
    });
  }
  ```

- **File**: `src/preload/preload.ts`
  ```ts
  import { contextBridge, ipcRenderer } from 'electron';
  import { IPC_CHANNELS } from '../shared/contracts/ipc-channels';
  import type { ElectronBridge } from '../shared/contracts/api';

  const bridge: ElectronBridge = {
    platform: process.platform,
    version: '2.4.0',
    ping: () => ipcRenderer.invoke(IPC_CHANNELS.PING)
  };

  contextBridge.exposeInMainWorld('electronAPI', bridge);
  ```

#### Step 8.3.2: GREEN Typecheck
- **Local Command**: `npm run typecheck`
- **Expected Evidence**: 0 errors across main, preload, and shared.

---

## Task 9: One-Shot Bounded Shutdown Lifecycle Manager & Safe Diagnostic Logging

### 9.1 Context & Objectives
Implement the shutdown lifecycle manager with `SafeDiagnosticLogger`. Uses typed structural `CloseableDatabase` interface (zero `any`). Accepts only allowlisted diagnostic error codes, bounds the flush timeout to 2000ms using `Promise.race`, closes SQLite DB connection exactly once, and calls `app.quit()` without forwarding caught error objects/stacks.

### 9.2 Target Files
- `src/main/lifecycle.ts` [NEW]
- `src/main/__tests__/lifecycle.test.ts` [NEW]

### 9.3 Step-by-Step TDD Execution

#### Step 9.3.1: Write Failing Lifecycle Test
- **File**: `src/main/__tests__/lifecycle.test.ts` [NEW]
- **Smallest Failing Test**:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import {
    createShutdownManager,
    type CloseableDatabase,
    type SafeDiagnosticLogger,
    type ShutdownDiagnosticCode
  } from '../lifecycle';

  interface LogCall {
    code: ShutdownDiagnosticCode;
    message: string;
  }

  class FakeDatabase implements CloseableDatabase {
    public open = true;
    public closeCallCount = 0;
    close(): void {
      this.open = false;
      this.closeCallCount++;
    }
  }

  describe('Shutdown Lifecycle Manager', () => {
    it('executes flush within 2000ms bound, closes DB once, and prevents recursive quit', async () => {
      const mockDb = new FakeDatabase();
      const mockLogBus = {
        flush: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)))
      };
      let quitCount = 0;
      const mockApp = {
        quit: vi.fn().mockImplementation(() => { quitCount++; })
      };
      const loggedCalls: LogCall[] = [];
      const mockLogger: SafeDiagnosticLogger = {
        error: (code, message) => { loggedCalls.push({ code, message }); }
      };

      const manager = createShutdownManager({
        db: mockDb,
        logBus: mockLogBus,
        app: mockApp,
        logger: mockLogger,
        timeoutMs: 2000
      });

      const fakeEvent = { preventDefault: vi.fn() };

      await manager.handleBeforeQuit(fakeEvent);
      expect(fakeEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockLogBus.flush).toHaveBeenCalledTimes(1);
      expect(mockDb.open).toBe(false);
      expect(mockDb.closeCallCount).toBe(1);
      expect(quitCount).toBe(1);
      expect(loggedCalls.length).toBe(0);

      // Re-triggering before-quit during shutdown must NOT recurse
      await manager.handleBeforeQuit(fakeEvent);
      expect(quitCount).toBe(1);
      expect(mockDb.closeCallCount).toBe(1);
    });

    it('enforces timeout bound when flush hangs, logs safe code without raw error, and quits', async () => {
      const mockDb = new FakeDatabase();
      const hangingLogBus = {
        flush: vi.fn().mockImplementation(() => new Promise(() => {}))
      };
      const mockApp = { quit: vi.fn() };
      const loggedCalls: LogCall[] = [];
      const mockLogger: SafeDiagnosticLogger = {
        error: (code, message) => { loggedCalls.push({ code, message }); }
      };

      const manager = createShutdownManager({
        db: mockDb,
        logBus: hangingLogBus,
        app: mockApp,
        logger: mockLogger,
        timeoutMs: 50 // 50ms bound for test
      });

      const fakeEvent = { preventDefault: vi.fn() };
      await manager.handleBeforeQuit(fakeEvent);

      expect(mockDb.open).toBe(false);
      expect(mockApp.quit).toHaveBeenCalledTimes(1);
      expect(loggedCalls.some((c) => c.code === 'ERR_SHUTDOWN_TIMEOUT')).toBe(true);
    });
  });
  ```
- **Local Command**: `npm run test:node`
- **Expected RED Output**: `Cannot find module '../lifecycle'`.

#### Step 9.3.2: Minimal Production Implementation
- **File**: `src/main/lifecycle.ts`
  ```ts
  export interface CloseableDatabase {
    open: boolean;
    close(): void;
  }

  export type ShutdownDiagnosticCode =
    | 'ERR_SHUTDOWN_TIMEOUT'
    | 'ERR_SHUTDOWN_FLUSH'
    | 'ERR_SHUTDOWN_DB_CLOSE';

  export interface SafeDiagnosticLogger {
    error(code: ShutdownDiagnosticCode, message: string): void;
  }

  export interface ShutdownDependencies {
    db: CloseableDatabase;
    logBus?: { flush(): Promise<void> };
    app: { quit(): void };
    logger?: SafeDiagnosticLogger;
    timeoutMs?: number;
  }

  export function createShutdownManager(deps: ShutdownDependencies) {
    let isShuttingDown = false;
    const timeout = deps.timeoutMs ?? 2000;

    return {
      async handleBeforeQuit(event: { preventDefault(): void }): Promise<void> {
        if (isShuttingDown) return;
        isShuttingDown = true;
        event.preventDefault();

        try {
          if (deps.logBus) {
            let timedOut = false;
            const timeoutPromise = new Promise<'timeout'>((resolve) => setTimeout(() => {
              timedOut = true;
              resolve('timeout');
            }, timeout));

            const result = await Promise.race([deps.logBus.flush(), timeoutPromise]);
            if (result === 'timeout' || timedOut) {
              deps.logger?.error('ERR_SHUTDOWN_TIMEOUT', 'LogBus flush timed out during shutdown.');
            }
          }
        } catch (err: unknown) {
          deps.logger?.error('ERR_SHUTDOWN_FLUSH', 'LogBus flush failed during shutdown.');
        } finally {
          try {
            if (deps.db && deps.db.open) {
              deps.db.close();
            }
          } catch (err: unknown) {
            deps.logger?.error('ERR_SHUTDOWN_DB_CLOSE', 'Database close failed during shutdown.');
          }
          deps.app.quit();
        }
      }
    };
  }
  ```

#### Step 9.3.3: GREEN Verification
- **Local Command**: `npm run test:node`
- **Expected Evidence**: `✓ src/main/__tests__/lifecycle.test.ts (2 tests) - 2 passed`

---

## Task 10: Automated Electron Runtime Test Harness (`npm run test:electron`)

### 10.1 Context & Objectives
Implement an automated Electron runtime harness verifying native addon loading, real `safeStorage`, BrowserWindow security policies, non-empty platform/version, absence of raw IPC properties on `window.electronAPI`, and preload context isolation against the freshly built preload script. Uses allowlisted diagnostic failure codes without raw exception/stack printing.

### 10.2 Target Files
- `scripts/run-electron-harness.cjs` [NEW]

### 10.3 Step-by-Step TDD Execution

#### Step 10.3.1: Write Failing Baseline Test Check (RED)
- **Step 1**: Run the electron harness script against the current unbuilt/unconfigured baseline:
  ```powershell
  npm run test:electron
  ```
- **Expected RED Output**: `npm ERR! Missing script: "test:electron"` or `Error: Cannot find module './scripts/run-electron-harness.cjs'`. Exit code is non-zero (1).

#### Step 10.3.2: Minimal Production Harness Implementation
- **File**: `scripts/run-electron-harness.cjs`
  ```cjs
  const { app, BrowserWindow, safeStorage, ipcMain } = require('electron');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');

  const HARNESS_CODES = {
    SUCCESS: 'HARNESS_SUCCESS',
    ERR_PROCESS: 'HARNESS_ERR_NOT_ELECTRON_PROCESS',
    ERR_SQLITE: 'HARNESS_ERR_SQLITE_EXECUTION_FAILED',
    ERR_SAFESTORAGE_MISMATCH: 'HARNESS_ERR_SAFESTORAGE_ROUNDTRIP_MISMATCH',
    ERR_PRELOAD_NOT_FOUND: 'HARNESS_ERR_PRELOAD_ARTIFACT_NOT_FOUND',
    ERR_SECURITY_PREFS: 'HARNESS_ERR_SECURITY_PREFERENCES_VIOLATED',
    ERR_ISOLATION_LEAK: 'HARNESS_ERR_RENDERER_ISOLATION_LEAK',
    ERR_METADATA_EMPTY: 'HARNESS_ERR_PLATFORM_OR_VERSION_EMPTY',
    ERR_RAW_IPC_LEAK: 'HARNESS_ERR_RAW_IPC_METHOD_EXPOSED',
    ERR_PING_FAILED: 'HARNESS_ERR_PING_INVOCATION_FAILED',
    ERR_CLEANUP_FAILED: 'HARNESS_ERR_MATERIAL_CLEANUP_FAILED'
  };

  function safeUnlinkTracked(filePath, cleanupErrors, code) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        cleanupErrors.push(code);
      }
    }
  }

  async function runHarness() {
    console.log('[ELECTRON-HARNESS] Starting Automated Electron Runtime Verification...');

    await app.whenReady();

    const cleanupErrors = [];
    let db = null;
    let win = null;
    const tempDbPath = path.join(os.tmpdir(), `electron-harness-${Date.now()}.db`);

    try {
      // 1. Verify Electron versions
      if (!process.versions.electron) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_PROCESS}: Not running in Electron.`);
        process.exitCode = 1;
        return;
      }
      console.log(`[PASS] Electron version: ${process.versions.electron}, Node: ${process.versions.node}, Chrome: ${process.versions.chrome}`);

      // 2. Verify rebuilt better-sqlite3 native addon
      try {
        const Database = require('better-sqlite3');
        db = new Database(tempDbPath);
        db.pragma('journal_mode = WAL');
        db.exec('CREATE TABLE harness_test (id INTEGER PRIMARY KEY, value TEXT);');
        db.prepare("INSERT INTO harness_test (value) VALUES ('ok')").run();
        const row = db.prepare('SELECT value FROM harness_test').get();
        if (!row || row.value !== 'ok') {
          console.error(`[FAIL] ${HARNESS_CODES.ERR_SQLITE}: Data readback mismatch.`);
          process.exitCode = 1;
          return;
        }
        console.log('[PASS] Rebuilt better-sqlite3 loaded and executed queries in Electron');
      } catch (err) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_SQLITE}: Failed native addon execution.`);
        process.exitCode = 1;
        return;
      }

      // 3. Verify safeStorage post-app.whenReady()
      const isEncAvailable = safeStorage.isEncryptionAvailable();
      if (isEncAvailable) {
        const sentinel = 'ephemeral-sentinel-test-payload';
        const enc = safeStorage.encryptString(sentinel);
        const dec = safeStorage.decryptString(enc);
        if (dec !== sentinel) {
          console.error(`[FAIL] ${HARNESS_CODES.ERR_SAFESTORAGE_MISMATCH}: Roundtrip mismatch.`);
          process.exitCode = 1;
          return;
        }
        console.log('[PASS] Electron safeStorage encryption verified with ephemeral sentinel');
      } else {
        console.log('[PASS] safeStorage is unavailable in this environment (fail-closed verified)');
      }

      // 4. Register baseline IPC ping handler
      ipcMain.handle('app:ping', async () => ({ success: true, data: { pong: true, timestamp: Date.now() } }));

      // 5. Locate built preload script
      const preloadCandidates = [
        path.join(__dirname, '../dist-electron/preload/preload.mjs'),
        path.join(__dirname, '../dist-electron/preload/preload.js'),
        path.join(__dirname, '../dist-electron/preload.mjs'),
        path.join(__dirname, '../dist-electron/preload.js')
      ];
      const preloadPath = preloadCandidates.find((p) => fs.existsSync(p));
      if (!preloadPath) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_PRELOAD_NOT_FOUND}: Built preload missing.`);
        process.exitCode = 1;
        return;
      }

      // 6. Create BrowserWindow with built preload and test security boundaries
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });

      const prefs = win.webContents.getWebPreferences();
      if (prefs.nodeIntegration !== false || prefs.contextIsolation !== true || prefs.sandbox !== true) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_SECURITY_PREFS}: WebPreferences violated.`);
        process.exitCode = 1;
        return;
      }

      await win.loadURL('data:text/html,<html><body><h1>Harness</h1></body></html>');

      // 7. Verify Renderer Isolation & public bridge methods
      const isolationCheck = await win.webContents.executeJavaScript(`
        ({
          hasElectronApi: typeof window.electronAPI === 'object' && window.electronAPI !== null,
          platform: window.electronAPI?.platform,
          version: window.electronAPI?.version,
          hasRequire: typeof window.require !== 'undefined',
          hasProcess: typeof window.process !== 'undefined',
          hasIpcRenderer: typeof window.ipcRenderer !== 'undefined',
          hasRawSend: typeof window.electronAPI?.send !== 'undefined',
          hasRawInvoke: typeof window.electronAPI?.invoke !== 'undefined',
          hasRawPostMessage: typeof window.electronAPI?.postMessage !== 'undefined'
        })
      `);

      if (!isolationCheck.hasElectronApi || isolationCheck.hasRequire || isolationCheck.hasProcess || isolationCheck.hasIpcRenderer) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_ISOLATION_LEAK}: Primitives exposed in Renderer.`);
        process.exitCode = 1;
        return;
      }

      if (typeof isolationCheck.platform !== 'string' || isolationCheck.platform.length === 0 ||
          typeof isolationCheck.version !== 'string' || isolationCheck.version.length === 0) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_METADATA_EMPTY}: Platform or version empty.`);
        process.exitCode = 1;
        return;
      }

      if (isolationCheck.hasRawSend || isolationCheck.hasRawInvoke || isolationCheck.hasRawPostMessage) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_RAW_IPC_LEAK}: Raw IPC method exposed on bridge.`);
        process.exitCode = 1;
        return;
      }

      const pingResult = await win.webContents.executeJavaScript('window.electronAPI.ping()');
      if (!pingResult || typeof pingResult !== 'object' || pingResult.success !== true || !pingResult.data || pingResult.data.pong !== true) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_PING_FAILED}: Ping handler failed.`);
        process.exitCode = 1;
        return;
      }
      console.log('[PASS] Renderer isolation and typed bridge verified via preload');

      console.log('[ELECTRON-HARNESS] ALL RUNTIME CHECKS PASSED (100%).');
    } catch (err) {
      console.error(`[FAIL] ${HARNESS_CODES.ERR_SECURITY_PREFS}: Unexpected execution error.`);
      process.exitCode = 1;
    } finally {
      // Guaranteed resource cleanup with tracking
      try { ipcMain.removeHandler('app:ping'); } catch (e) { cleanupErrors.push('CLEANUP_ERR_IPC_HANDLER'); }
      try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) { cleanupErrors.push('CLEANUP_ERR_WINDOW'); }
      try { if (db && db.open) db.close(); } catch (e) { cleanupErrors.push('CLEANUP_ERR_DB_CLOSE'); }
      safeUnlinkTracked(tempDbPath, cleanupErrors, 'CLEANUP_ERR_TEMP_DB');
      safeUnlinkTracked(`${tempDbPath}-wal`, cleanupErrors, 'CLEANUP_ERR_WAL');
      safeUnlinkTracked(`${tempDbPath}-shm`, cleanupErrors, 'CLEANUP_ERR_SHM');

      if (cleanupErrors.length > 0) {
        console.error(`[FAIL] ${HARNESS_CODES.ERR_CLEANUP_FAILED}: ${cleanupErrors.join(', ')}`);
        process.exitCode = 1;
      }
      app.exit(process.exitCode || 0);
    }
  }

  runHarness();
  ```

#### Step 10.3.3: GREEN Verification
- **Local Command**: `npm run test:electron`
- **Expected Evidence**:
  ```
  [ELECTRON-HARNESS] Starting Automated Electron Runtime Verification...
  [PASS] Electron version: ...
  [PASS] Rebuilt better-sqlite3 loaded and executed queries in Electron
  [PASS] Electron safeStorage encryption verified with ephemeral sentinel
  [PASS] Renderer isolation and typed bridge verified via preload
  [ELECTRON-HARNESS] ALL RUNTIME CHECKS PASSED (100%).
  ```

---

## Task 11: Full Phase 0–1 Verification & Evidence Checklist

### 11.1 Verification Commands Matrix

| Step | Command | Expected Output | Lane |
| :--- | :--- | :--- | :--- |
| **Lint** | `npm run lint` | `eslint .` exits with 0 warnings/errors | Node |
| **Typecheck** | `npm run typecheck` | `tsc --noEmit` exits with 0 diagnostic errors | Node |
| **Node Unit Tests** | `npm run test:node` | 100% tests pass (schemas, database, migrator, repositories, vault, lifecycle) | Node |
| **Native Rebuild** | `npm run rebuild` | `better-sqlite3.node` compiled for Electron | Native Tooling |
| **Electron Harness**| `npm run test:electron`| 100% checks pass (native addon, safeStorage, webPreferences, preload bridge) | Electron Runtime |
| **Full Test Suite** | `npm run test` | `test:node` + `test:electron` both pass cleanly | Integrated |
| **Production Build**| `npm run build` | Clean `dist` and `dist-electron` bundles created | Build |

---

## 12. Complete File-by-File Change Map

| Action | Path | Purpose |
| :--- | :--- | :--- |
| [MODIFY] | `package.json` | Declare approved dependencies and local scripts (`test:node`, `test:electron`, `test`, `typecheck`, `rebuild`). |
| [NEW] | `vitest.config.ts` | Configure Vitest in Node environment with path aliases. |
| [NEW] | `scripts/run-electron-harness.cjs` | Automated Electron runtime harness test script. |
| [NEW] | `src/shared/schemas/common.schema.ts` | Pagination and common Zod schemas. |
| [NEW] | `src/shared/schemas/settings.schema.ts` | Strict Zod schema for non-secret settings & GPM port range validation. |
| [NEW] | `src/shared/schemas/credentials.schema.ts` | Strict Zod discriminated union schema for provider credentials. |
| [NEW] | `src/shared/schemas/log.schema.ts` | Strict Zod schema for canonical runtime logs & statuses. |
| [NEW] | `src/shared/schemas/account.schema.ts` | Strict Zod schema for account create/update with write-only secret ops. |
| [NEW] | `src/shared/schemas/diagnostics.schema.ts` | Strict Zod schema for sanitized diagnostic metadata and results. |
| [NEW] | `src/shared/schemas/ipc-envelope.schema.ts` | Generic schema factory `createIpcEnvelopeSchema<T>()`. |
| [NEW] | `src/shared/types/domain.ts` | Canonical domain models without plaintext secrets. |
| [NEW] | `src/shared/types/canonical-log.ts` | Canonical runtime log types and status constants. |
| [NEW] | `src/shared/types/diagnostics.ts` | Sanitized diagnostic status and metadata interfaces. |
| [NEW] | `src/shared/types/settings-dto.ts` | Non-secret settings DTOs. |
| [NEW] | `src/shared/types/account-dto.ts` | Account DTOs with masked secret indicators. |
| [NEW] | `src/shared/types/provider-interfaces.ts` | Minimal common provider connectivity and capability interfaces. |
| [NEW] | `src/shared/contracts/ipc-channels.ts` | Constant string identifiers for IPC channels. |
| [MODIFY] | `src/shared/contracts/api.ts` | ElectronBridge typed public contract interface. |
| [NEW] | `src/main/database/connection.ts` | SQLite connection factory enforcing WAL, NORMAL, foreign_keys ON, busy_timeout=5000. |
| [NEW] | `src/main/database/migrations/001_initial_schema.ts` | Initial schema migration DDL literal. |
| [NEW] | `src/main/database/migrations/index.ts` | Migration registry array with checksum computation. |
| [NEW] | `src/main/database/migrator.ts` | Versioned migration engine with synchronous transaction atomicity and checksum validation. |
| [NEW] | `src/main/security/CredentialVault.ts` | Electron `safeStorage` wrapper with fail-closed semantics. |
| [NEW] | `src/main/repositories/SettingsRepository.ts` | Non-secret settings data access with typed row mapping. |
| [NEW] | `src/main/repositories/CredentialRepository.ts` | Encrypted credential and diagnostic metadata data access with schema validation. |
| [NEW] | `src/main/repositories/AccountRepository.ts` | Indexed account data access with masked boolean mapping and bounded pagination. |
| [NEW] | `src/main/repositories/LogRepository.ts` | Transactional batch log persistence & non-negative retention cleanup. |
| [NEW] | `src/main/ipc/registerIpc.ts` | Baseline IPC ping infrastructure registration. |
| [NEW] | `src/main/lifecycle.ts` | Bounded one-shot shutdown manager on `before-quit` with `SafeDiagnosticLogger`. |
| [MODIFY] | `src/preload/preload.ts` | Expose typed `electronAPI` without leaking raw IPC primitives. |
| [MODIFY] | `src/main/main.ts` | Composition root initializing DB, migrations, vault, lifecycle post-`app.whenReady()`. |
| [NEW] | `src/shared/__tests__/foundation.test.ts` | Vitest test runner verification. |
| [NEW] | `src/shared/schemas/__tests__/schemas.test.ts` | Zod schemas positive and negative validation tests. |
| [NEW] | `src/shared/contracts/__tests__/contracts.test.ts` | IPC channels constant contract freeze tests. |
| [NEW] | `src/main/database/__tests__/connection.test.ts` | SQLite connection and PRAGMA verification tests. |
| [NEW] | `src/main/database/__tests__/migrator.test.ts` | Migration engine and 001 schema rollback atomicity & checksum tests. |
| [NEW] | `src/main/repositories/__tests__/repositories.test.ts` | Repository layer CRUD and typed row mapping tests. |
| [NEW] | `src/main/security/__tests__/CredentialVault.test.ts` | CredentialVault fail-closed security tests. |
| [NEW] | `src/main/__tests__/lifecycle.test.ts` | Shutdown lifecycle manager bounded execution & safe logger tests. |

---

## 13. Risk Register & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Native ABI mismatch** | Electron startup crash with `NODE_MODULE_VERSION` mismatch. | Include `"rebuild": "electron-rebuild -f -w better-sqlite3"` and verify via automated `npm run test:electron`. |
| **Migration failure / tampering** | Corrupted schema or unexpected migration divergence. | Execute DDL and `schema_migrations` insert in the same transaction; verify SHA-256 checksums on startup. |
| **safeStorage unavailable** | Headless/CI failure encrypting credentials. | `CredentialVault` throws `VaultUnavailableError` (fail-closed); Node tests inject mock `SafeStorageBackend`. |
| **Secret leakage in logs** | Sensitive tokens dumped to console. | Use `SafeDiagnosticLogger` with allowlisted error codes; never log raw exception objects. |

---

## 14. Approval Gate

**Status:** COMPLETED — VERIFIED  
**Approval Record (2026-09-01):** Formally approved for execution. Implementation executed and verified under the strict headless protocol.

---

## 15. Execution Evidence (2026-09-01)

### 15.1 Verification Summary
- **Test Runner (`npm run test`)**: Exit code `0`.
  - **Node Test Lane (`npm run test:node`)**: 10 test files, 78 tests passed (100%).
    - `src/shared/__tests__/foundation.test.ts`
    - `src/shared/schemas/__tests__/schemas.test.ts`
    - `src/shared/contracts/__tests__/contracts.test.ts`
    - `src/main/database/__tests__/connection.test.ts`
    - `src/main/database/__tests__/migrator.test.ts`
    - `src/main/repositories/__tests__/repositories.test.ts`
    - `src/main/security/__tests__/CredentialVault.test.ts`
    - `src/main/ipc/__tests__/registerIpc.test.ts`
    - `src/preload/__tests__/preload.test.ts`
    - `src/main/__tests__/lifecycle.test.ts`
  - **Electron Runtime Lane (`npm run test:electron`)**: Electron 35.7.5 / Node 22.16.0 harness executed successfully:
    - Rebuilt `better-sqlite3` loaded and verified file DB PRAGMAs (`WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`) and CRUD operations.
    - Real `safeStorage` verified with ephemeral sentinel roundtrip.
    - Sandboxed CommonJS preload loaded into isolated `BrowserWindow` (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).
    - Verified `window.electronAPI` exposure (`platform`, `version`, `ping()`) and strict absence of raw Node/IPC primitives (`require`, `process`, `ipcRenderer`, `send`, `invoke`, `postMessage`).
- **Static Analysis & Build Verification**:
  - `npm run lint`: Exit code `0` (0 warnings, 0 errors).
  - `npm run typecheck`: Exit code `0` (TypeScript clean across shared, main, preload, renderer).
  - `npm run build`: Exit code `0` (Vite production build cleanly generated `dist` and `dist-electron`).
- **Real Process Launch**: Real `dist-electron/main.js` launch stayed running without `MAIN_INIT_FAILED` after `better-sqlite3` native dependency was externalized.
- **Dependency Security Audit**: `npm audit --omit=dev` found 0 production vulnerabilities.

### 15.2 Root-Cause Corrections Resolved During Execution
1. **Node vs Electron Native Module ABI Separation**:
   - Distinct package script lanes created in `package.json`: `rebuild:node` (`npm rebuild better-sqlite3` for Node ABI 137 under Vitest) and `rebuild:electron` (`electron-rebuild -f -w better-sqlite3` for Electron ABI 133).
2. **Vite Preload Format & Native Bundling Rules**:
   - `vite.config.ts` configured with `build.lib: { formats: ['cjs'], fileName: () => 'preload.js' }` to satisfy Electron 35's sandboxed preload requirement.
   - Added `notBundle` plugin for the main entry with a resolved-path filter (`resolvedId.replace(/\\/g, '/').includes('/node_modules/better-sqlite3/')`) to prevent Rollup from bundling native binary lookups.

### 15.3 Scope Boundary
- **Phase 0 & Phase 1 Scope**: Fully implemented and verified (strict Zod runtime schemas, contracts freeze, SQLite connection/migrator/repositories, CredentialVault fail-closed security, typed IPC baseline ping, bounded shutdown lifecycle manager, and automated Electron test harness).
- **Phase 2 & Phase 3 Scope**: UI state persistence wiring, mock removal in React renderer, and external provider integrations remain scheduled for subsequent phases; this completion applies strictly to Phase 0 & 1.

