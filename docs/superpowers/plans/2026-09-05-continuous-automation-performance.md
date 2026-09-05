# Continuous Automation And Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `threadCount` into a true concurrency limit, continuously refill API/custom workers, make Gmail94 acquisition atomic and just-in-time, preserve honest outcomes, and remove redundant CapCut reconciliation waits.

**Architecture:** `AutomationRunService` will consume a run-scoped finite or continuous work source and own one cancellable worker loop per concurrency slot. Paid mailbox reuse/purchase moves behind an SQLite reservation plus a serialized provider acquisition session; CapCut proof and snapshot reconciliation share one deadline and retain proof memory across rounds.

**Tech Stack:** Electron 35, React 19, TypeScript 5.8 strict mode, Vite 6, Vitest 4, SQLite/`better-sqlite3`, `playwright-core`.

**Spec:** `docs/superpowers/specs/2026-09-05-continuous-automation-performance-design.md`

## Global Constraints

- `threadCount` remains persisted with range 1-200 and means worker concurrency only.
- Manual input is finite; API and custom-domain input are continuous until Stop or a typed terminal condition.
- Acquire proxy capacity before materializing a billable email; acquire only one email per ready worker.
- Gmail94 preflight uses only unreserved `capcut`-service rows plus current
  balance and current `capcut` price; no incompatible legacy slug and no silent
  concurrency reduction.
- A live Gmail94 order is forbidden unless the user separately approves it and `VERIFY_GMAIL94_BUY=1` is present.
- Public run states are `idle`, `preparing`, `running`, `stopping`, `completed`, `stopped`, `blocked`, and `failed`.
- Public counters are `workerTarget`, `workersActive`, `accountsAccepted`, `accountsCompleted`, `accountsFailed`, and `accountsStopped`.
- Resource cleanup releases ownership only; it never rewrites an account's workload outcome.
- PWA evidence deadline is 12,000 ms; notification evidence deadline is 20,000 ms; Design Studio remains 90,000 ms; Video Studio remains 240,000 ms.
- Inter-round event wait is at most 8,000 ms and final snapshot wait is at most 10,000 ms.
- Preserve `human.ts`, measured jitter, hit-target/inert/render/enabled guards, and CapCut's two-signal proof rule.
- Renderer isolation, typed preload/IPC, SQLite repository boundaries, and secret redaction remain intact.
- `playwright-core` and `better-sqlite3` remain external from the Vite main bundle.
- Add no dependency for this change.
- Do not commit unless the user authorizes commits for the execution session.
- During Tasks 1-5, retain the four legacy progress counters only as a typed
  compatibility bridge and make the six canonical counters optional on the
  public schema. Task 5 uses the canonical counters internally and keeps the
  aliases derived; Task 6 removes the aliases and makes all canonical counters
  required. Never ship or finish the branch between those two cutover points.

## File Map

- `src/shared/schemas/automation.schema.ts`: canonical run states, terminal reason, and progress counters.
- `src/shared/schemas/diagnostics.schema.ts`: normalized `INSUFFICIENT_FUNDS` provider error.
- `src/shared/schemas/account.schema.ts` and `src/shared/types/account.ts`: explicit stopped account status.
- `src/main/services/AutomationTerminalError.ts`: typed main-process terminal condition.
- `src/main/database/migrations/005_purchased_email_reservations.ts`: additive reservation columns and availability index.
- `src/main/repositories/PurchasedEmailRepository.ts`: atomic reserve/consume/release/recovery operations.
- `src/main/services/EmailPurchaseService.ts`: safe capacity preflight and serialized one-item acquisition sessions.
- `src/main/services/AutomationWorkSource.ts`: finite manual and continuous provider work sources.
- `src/main/services/AutomationRunService.ts`: continuous worker loops, cancellation, counters, and terminal outcome ownership.
- `src/main/services/stageTiming.ts`: monotonic elapsed-time helper.
- `src/main/services/capcut/missionRunner.ts` and `src/main/services/capcut/runTasks.ts`: shared proof/snapshot deadline and proof memory.
- `src/main/services/capcut/pageRecovery.ts` and `src/main/services/CapcutEngineService.ts`: one-replacement main-page recovery.
- `src/main/lifecycle.ts`: bounded automation-first shutdown.
- `src/main/singleInstance.ts`, `src/main/startupRecovery.ts`, and
  `src/main/main.ts`: pre-initialization lock plus stale-reservation recovery.
- `src/renderer/pages/Dashboard/*` and typed IPC/preload files: state/counter/copy integration.
- `tools/verify-selectors.ts`: evidence-based repair of the current selector gate.

## Acceptance-Criterion Coverage

| Spec AC | Primary implementation task(s) | Required evidence |
| --- | --- | --- |
| 1 | Tasks 4-5 | Continuous-source refill, concurrency ceiling, Stop/block worker-loop tests |
| 2 | Tasks 4-6 | Full manual queue, natural exhaustion, `completed / MANUAL_EXHAUSTED`, Dashboard state |
| 3 | Tasks 1, 4-6, 12 | Canonical schema/service/UI counters, copy, old-field zero-match scan, docs |
| 4 | Tasks 2-3, 5-6 | Service-compatible Gmail94 preflight and typed blocked IPC details before any order |
| 5 | Tasks 2 and 10 | Migration-from-v4, atomic ownership tests, startup stale-reservation recovery |
| 6 | Tasks 3, 5, and 8 | Proxy-before-email worker ordering, serialized one-item purchase, stage timings |
| 7 | Task 5 | Workload failure survives cleanup and increments exactly one failed outcome |
| 8 | Tasks 1, 5-6 | Distinct typed run states/reasons through service, IPC, preload, and Dashboard |
| 9 | Tasks 7-8 and 12 | Shared 12-second PWA deadline, no second 45-second wait, measured live timing |
| 10 | Tasks 7 and 9 | Proof-memory selection test and recovery orchestration no-replay test |
| 11 | Tasks 8 and 12 | Sanitized monotonic stage logs plus bounded non-billable live run |
| 12 | Tasks 7 and 9 | One-replacement resolver tests and proof-backed recovery test |
| 13 | Task 10 | Shutdown ordering/idempotency/timeouts and pre-initialization single-instance tests |
| 14 | Task 11 | Red selector fixture evidence followed by a fully green selector gate |
| 15 | Task 12 | Static, focused, full Node, Electron, selector, and environment-blocker ledger |
| 16 | Tasks 3, 8, and 12 | Fake/fixture tests, opt-in harness guard, and explicit billable verification status |

---

### Task 1: Establish Shared Run, Error, Counter, And Account Contracts

**Files:**

- Create: `src/main/services/AutomationTerminalError.ts`
- Modify: `src/shared/schemas/automation.schema.ts`
- Modify: `src/shared/schemas/diagnostics.schema.ts`
- Modify: `src/shared/schemas/account.schema.ts`
- Modify: `src/shared/types/account.ts`
- Test: `src/shared/schemas/__tests__/automation.schema.test.ts`
- Test: `src/shared/schemas/__tests__/schemas.test.ts`
- Test: `src/shared/contracts/__tests__/contracts.test.ts`

**Interfaces:**

- Produces: `AutomationTerminalCode`, `AutomationTerminalReasonDTO`,
  `AutomationRunCountersDTO`, and the transitional progress schema consumed by
  Tasks 5-6.
- Produces: `AutomationTerminalError(state, reason, message)` for Tasks 3-5.
- Produces: account status `stopped` for Tasks 5-6.
- Transitional only: keeps legacy progress counters required and accepts the six
  canonical counters optionally so current call sites still typecheck. Task 6
  performs the final public DTO cutover.

- [ ] **Step 1: Write failing schema tests for every new state, counter, reason, and account status**

Add these focused assertions:

~~~ts
it.each(['completed', 'blocked'] as const)('accepts terminal run state %s', (state) => {
  const parsed = AutomationRunProgressSchema.parse({
    runId: 'run-1',
    state,
    threadTotal: 3,
    threadsStarted: 4,
    threadsStopped: 4,
    threadsFailed: 1,
    workerTarget: 3,
    workersActive: 0,
    accountsAccepted: 4,
    accountsCompleted: 3,
    accountsFailed: 1,
    accountsStopped: 0,
    message: 'terminal',
    terminalReason: {
      code: state === 'completed' ? 'MANUAL_EXHAUSTED' : 'INSUFFICIENT_FUNDS',
      provider: state === 'blocked' ? 'gmail94' : undefined,
      details: state === 'blocked' ? { balance: 1000, unitPrice: 1000 } : undefined
    }
  });

  expect(parsed.state).toBe(state);
});

it('accepts INSUFFICIENT_FUNDS as a sanitized provider code', () => {
  expect(SanitizedDiagnosticResultSchema.parse({
    code: 'INSUFFICIENT_FUNDS',
    message: 'Số dư Gmail94 không đủ.',
    timestamp: '2026-09-05T00:00:00.000Z',
    details: { balance: 1000, unitPrice: 1000 }
  }).code).toBe('INSUFFICIENT_FUNDS');
});

it('accepts stopped as an account status', () => {
  expect(AccountStatusEnum.parse('stopped')).toBe('stopped');
});
~~~

Keep the legacy fields in existing progress fixtures during this task. Add the
six new counters only to assertions that exercise the new contract; Task 6 owns
the repository-wide removal of the legacy fields.

- [ ] **Step 2: Run focused tests and confirm the old contracts are red**

Run:

~~~powershell
npx vitest run src/shared/schemas/__tests__/automation.schema.test.ts src/shared/schemas/__tests__/schemas.test.ts src/shared/contracts/__tests__/contracts.test.ts
~~~

Expected: FAIL because `completed`, `blocked`, `INSUFFICIENT_FUNDS`, `stopped`, and the six counter fields are not accepted.

- [ ] **Step 3: Add the approved contract behind a compile-safe transition bridge**

In `automation.schema.ts`, replace the old state/progress declarations with:

~~~ts
export const AutomationRunStateEnum = z.enum([
  'idle',
  'preparing',
  'running',
  'stopping',
  'completed',
  'stopped',
  'blocked',
  'failed'
]);
export type AutomationRunState = z.infer<typeof AutomationRunStateEnum>;

export const AutomationTerminalCodeEnum = z.enum([
  'MANUAL_EXHAUSTED',
  'USER_STOP',
  'APP_SHUTDOWN',
  'INSUFFICIENT_FUNDS',
  'PROVIDER_AUTH_REQUIRED',
  'PROVIDER_CONFIG_ERROR',
  'PROVIDER_RETRY_EXHAUSTED',
  'PROXY_CAPACITY_UNAVAILABLE',
  'INTERNAL_ERROR'
]);
export type AutomationTerminalCode = z.infer<typeof AutomationTerminalCodeEnum>;

export const AutomationTerminalReasonSchema = z.object({
  code: AutomationTerminalCodeEnum,
  provider: z.string().min(1).optional(),
  details: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ).optional()
}).strict();
export type AutomationTerminalReasonDTO = z.infer<typeof AutomationTerminalReasonSchema>;

export const AutomationRunCountersSchema = z.object({
  workerTarget: z.number().int().min(0),
  workersActive: z.number().int().min(0),
  accountsAccepted: z.number().int().min(0),
  accountsCompleted: z.number().int().min(0),
  accountsFailed: z.number().int().min(0),
  accountsStopped: z.number().int().min(0)
}).strict();
export type AutomationRunCountersDTO = z.infer<typeof AutomationRunCountersSchema>;

export const AutomationRunProgressSchema = z.object({
  runId: z.string().min(1),
  state: AutomationRunStateEnum,
  // Transitional input for Tasks 1-5; Task 6 makes these required.
  ...AutomationRunCountersSchema.partial().shape,
  threadTotal: z.number().int().min(0),
  threadsStarted: z.number().int().min(0),
  threadsStopped: z.number().int().min(0),
  threadsFailed: z.number().int().min(0),
  message: z.string(),
  terminalReason: AutomationTerminalReasonSchema.optional()
}).strict();
export type AutomationRunProgressDTO = z.infer<typeof AutomationRunProgressSchema>;
~~~

Add `INSUFFICIENT_FUNDS` to `SanitizedDiagnosticResultSchema.code`. Add `stopped` to both account-status unions.

- [ ] **Step 4: Add the main-process terminal error without leaking provider payloads**

Create `AutomationTerminalError.ts`:

~~~ts
import type {
  AutomationRunState,
  AutomationTerminalReasonDTO
} from '../../shared/schemas/automation.schema';

type TerminalState = Extract<AutomationRunState, 'blocked' | 'failed'>;

export class AutomationTerminalError extends Error {
  constructor(
    public readonly state: TerminalState,
    public readonly reason: AutomationTerminalReasonDTO,
    message: string
  ) {
    super(message);
    this.name = 'AutomationTerminalError';
  }
}
~~~

Do not attach raw vendor responses or credentials to `reason.details`.

- [ ] **Step 5: Run the focused contract suite**

Run:

~~~powershell
npx vitest run src/shared/schemas/__tests__/automation.schema.test.ts src/shared/schemas/__tests__/schemas.test.ts src/shared/contracts/__tests__/contracts.test.ts
npm run typecheck
~~~

Expected: all focused tests PASS and global TypeScript remains green because the
legacy fields are still present only as the documented transition bridge.

- [ ] **Step 6: Commit when commit authorization exists**

~~~powershell
git add src/shared/schemas/automation.schema.ts src/shared/schemas/diagnostics.schema.ts src/shared/schemas/account.schema.ts src/shared/types/account.ts src/main/services/AutomationTerminalError.ts src/shared/schemas/__tests__/automation.schema.test.ts src/shared/schemas/__tests__/schemas.test.ts src/shared/contracts/__tests__/contracts.test.ts
git commit -m "feat: define continuous automation run contracts"
~~~

If commits are not authorized, leave the changes staged state untouched and continue without committing.

---

### Task 2: Add Migration 005 And Atomic Purchased-Email Reservations

**Files:**

- Create: `src/main/database/migrations/005_purchased_email_reservations.ts`
- Modify: `src/main/database/migrations/index.ts`
- Modify: `src/main/repositories/PurchasedEmailRepository.ts`
- Test: `src/main/database/__tests__/migrator.test.ts`
- Test: `src/main/repositories/__tests__/purchasedEmailRepository.test.ts`

**Interfaces:**

- Produces: `reserveOldestAvailable(provider, reservationId, requiredService?)`.
- Produces: `insertReserved(input, reservationId)`.
- Produces: `consumeReserved(id, reservationId, accountId)`.
- Produces: `releaseReservation(id, reservationId)`.
- Produces: `countAvailable(provider, requiredService?)` and `clearStaleReservations()`.
- Consumed by: `EmailPurchaseService.openAcquisitionSession()` in Task 3.

- [ ] **Step 1: Write failing migration and ownership tests**

Add tests that prove an existing version-4 database upgrades without row loss and that reservation ownership is conditional:

~~~ts
it('migration 005 preserves rows and adds reservation columns', () => {
  const before = MIGRATIONS.slice(0, 4);
  runMigrations(db, before);
  db.prepare(
    "INSERT INTO purchased_emails (id, provider, email) VALUES ('old-1', 'gmail94', 'old@gmail.com')"
  ).run();

  runMigrations(db);

  const columns = db.prepare('PRAGMA table_info(purchased_emails)').all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toContain('reserved_by');
  expect(columns.map((column) => column.name)).toContain('reserved_at');
  expect(db.prepare("SELECT email FROM purchased_emails WHERE id = 'old-1'").get()).toEqual({
    email: 'old@gmail.com'
  });
});

it('reserves distinct oldest rows and enforces reservation ownership', () => {
  const repo = new PurchasedEmailRepository(db);
  repo.insert({ id: 'pe-1', provider: 'gmail94', email: 'one@gmail.com' });
  repo.insert({ id: 'pe-2', provider: 'gmail94', email: 'two@gmail.com' });

  const first = repo.reserveOldestAvailable('gmail94', 'run-1:worker-1');
  const second = repo.reserveOldestAvailable('gmail94', 'run-1:worker-2');

  expect(first?.id).toBe('pe-1');
  expect(second?.id).toBe('pe-2');
  expect(repo.releaseReservation('pe-1', 'wrong-owner')).toBe(false);
  expect(repo.consumeReserved('pe-1', 'wrong-owner', null)).toBe(false);
  expect(repo.consumeReserved('pe-1', 'run-1:worker-1', null)).toBe(true);
  expect(repo.reserveOldestAvailable('gmail94', 'run-1:worker-3')).toBeNull();
});

it('excludes a Gmail94 row purchased for a different service', () => {
  const repo = new PurchasedEmailRepository(db);
  repo.insert({
    id: 'legacy-facebook',
    provider: 'gmail94',
    email: 'legacy@gmail.com',
    service: 'facebook'
  });
  repo.insert({
    id: 'capcut-ready',
    provider: 'gmail94',
    email: 'capcut@gmail.com',
    service: 'capcut'
  });

  expect(repo.countAvailable('gmail94', 'capcut')).toBe(1);
  expect(repo.reserveOldestAvailable(
    'gmail94',
    'run-1:worker-1',
    'capcut'
  )?.id).toBe('capcut-ready');
});

it('clears only stale unconsumed reservations at startup', () => {
  const repo = new PurchasedEmailRepository(db);
  repo.insertReserved(
    { id: 'free-after-restart', provider: 'gmail94', email: 'free@gmail.com' },
    'old-process'
  );
  repo.insertReserved(
    { id: 'consumed', provider: 'gmail94', email: 'used@gmail.com' },
    'old-process'
  );
  repo.consumeReserved('consumed', 'old-process', null);

  expect(repo.clearStaleReservations()).toBe(1);
  expect(repo.reserveOldestAvailable('gmail94', 'new-process')?.id).toBe('free-after-restart');
});

it('uses the availability index for the reservation candidate query', () => {
  const plan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT id FROM purchased_emails' +
    ' WHERE provider = ? AND service = ?' +
    ' AND consumed_at IS NULL AND reserved_by IS NULL' +
    ' ORDER BY purchased_at ASC, id ASC LIMIT 1'
  ).all('gmail94', 'capcut') as Array<{ detail: string }>;

  expect(plan.some((row) =>
    row.detail.includes('idx_purchased_emails_available')
  )).toBe(true);
});
~~~

- [ ] **Step 2: Run tests and verify the migration/repository API is red**

Run:

~~~powershell
npx vitest run src/main/database/__tests__/migrator.test.ts src/main/repositories/__tests__/purchasedEmailRepository.test.ts
~~~

Expected: FAIL because migration 005 and all reservation methods are absent.

- [ ] **Step 3: Add the additive migration and register it as version 5**

Create:

~~~ts
export const migration005 = `
ALTER TABLE purchased_emails ADD COLUMN reserved_by TEXT;
ALTER TABLE purchased_emails ADD COLUMN reserved_at TEXT;

CREATE INDEX idx_purchased_emails_available
  ON purchased_emails(
    provider,
    service,
    consumed_at,
    reserved_by,
    purchased_at,
    id
  );
`;
~~~

Import it in `migrations/index.ts` and append exactly:

~~~ts
{
  version: 5,
  name: '005_purchased_email_reservations',
  sql: migration005
}
~~~

Do not modify migrations 001-004.

- [ ] **Step 4: Implement transactional reservation methods**

Extend `PurchasedEmailRow` with `reserved_by` and `reserved_at`. Add a private row reader:

~~~ts
private getDtoById(id: string): PurchasedEmailDTO | null {
  const row = this.db.prepare('SELECT * FROM purchased_emails WHERE id = ?')
    .get(id) as PurchasedEmailRow | undefined;
  return row ? toDto(row) : null;
}
~~~

Implement the exact ownership operations:

~~~ts
reserveOldestAvailable(
  provider: EmailSourceProvider,
  reservationId: string,
  requiredService?: string
): PurchasedEmailDTO | null {
  return this.db.transaction(() => {
    const candidate = requiredService
      ? this.db.prepare(
          'SELECT id FROM purchased_emails' +
          ' WHERE provider = ? AND service = ?' +
          ' AND consumed_at IS NULL AND reserved_by IS NULL' +
          ' ORDER BY purchased_at ASC, id ASC LIMIT 1'
        ).get(provider, requiredService) as { id: string } | undefined
      : this.db.prepare(
          'SELECT id FROM purchased_emails' +
          ' WHERE provider = ?' +
          ' AND consumed_at IS NULL AND reserved_by IS NULL' +
          ' ORDER BY purchased_at ASC, id ASC LIMIT 1'
        ).get(provider) as { id: string } | undefined;
    if (!candidate) return null;

    const changed = this.db.prepare(
      "UPDATE purchased_emails SET reserved_by = ?, reserved_at = datetime('now')" +
      ' WHERE id = ? AND consumed_at IS NULL AND reserved_by IS NULL'
    ).run(reservationId, candidate.id);
    if (changed.changes !== 1) return null;
    return this.getDtoById(candidate.id);
  })();
}

insertReserved(input: InsertPurchasedEmailInput, reservationId: string): PurchasedEmailDTO {
  this.db.prepare(
    'INSERT INTO purchased_emails (' +
    ' id, provider, email, password_encrypted, refresh_token_encrypted,' +
    ' client_id, order_id, service, raw_payload_encrypted, reserved_by, reserved_at, purchased_at' +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
  ).run(
    input.id,
    input.provider,
    input.email,
    input.passwordEncrypted ?? null,
    input.refreshTokenEncrypted ?? null,
    input.clientId ?? null,
    input.orderId ?? null,
    input.service ?? null,
    input.rawPayloadEncrypted ?? null,
    reservationId
  );
  const row = this.getDtoById(input.id);
  if (!row) throw new Error('Purchased email insert did not return its row.');
  return row;
}

consumeReserved(id: string, reservationId: string, accountId: string | null): boolean {
  const changed = this.db.prepare(
    "UPDATE purchased_emails SET consumed_at = datetime('now'), account_id = ?," +
    ' reserved_by = NULL, reserved_at = NULL' +
    ' WHERE id = ? AND consumed_at IS NULL AND reserved_by = ?'
  ).run(accountId, id, reservationId);
  return changed.changes === 1;
}

releaseReservation(id: string, reservationId: string): boolean {
  const changed = this.db.prepare(
    'UPDATE purchased_emails SET reserved_by = NULL, reserved_at = NULL' +
    ' WHERE id = ? AND consumed_at IS NULL AND reserved_by = ?'
  ).run(id, reservationId);
  return changed.changes === 1;
}

countAvailable(
  provider: EmailSourceProvider,
  requiredService?: string
): number {
  const row = requiredService
    ? this.db.prepare(
        'SELECT COUNT(*) AS count FROM purchased_emails' +
        ' WHERE provider = ? AND service = ?' +
        ' AND consumed_at IS NULL AND reserved_by IS NULL'
      ).get(provider, requiredService) as { count: number }
    : this.db.prepare(
        'SELECT COUNT(*) AS count FROM purchased_emails' +
        ' WHERE provider = ?' +
        ' AND consumed_at IS NULL AND reserved_by IS NULL'
      ).get(provider) as { count: number };
  return row.count;
}

clearStaleReservations(): number {
  const changed = this.db.prepare(
    'UPDATE purchased_emails SET reserved_by = NULL, reserved_at = NULL' +
    ' WHERE consumed_at IS NULL AND reserved_by IS NOT NULL'
  ).run();
  return changed.changes;
}
~~~

Change `listUnconsumed` to include `reserved_by IS NULL` so legacy readers cannot steal a reservation.

- [ ] **Step 5: Run database and repository tests**

Run:

~~~powershell
npx vitest run src/main/database/__tests__/migrator.test.ts src/main/repositories/__tests__/purchasedEmailRepository.test.ts
npm run typecheck
~~~

Expected: all focused tests PASS; migration registry integrity remains green.

- [ ] **Step 6: Commit when commit authorization exists**

~~~powershell
git add src/main/database/migrations/005_purchased_email_reservations.ts src/main/database/migrations/index.ts src/main/repositories/PurchasedEmailRepository.ts src/main/database/__tests__/migrator.test.ts src/main/repositories/__tests__/purchasedEmailRepository.test.ts
git commit -m "feat: reserve purchased emails atomically"
~~~

---

### Task 3: Add Gmail94 Capacity Preflight And Serialized One-Item Acquisition

**Files:**

- Create: `src/main/providers/__tests__/fixtures/gmail94-insufficient-funds.json`
- Modify: `src/main/providers/Gmail94Provider.ts`
- Modify: `src/main/providers/__tests__/Gmail94Provider.test.ts`
- Modify: `src/main/providers/__live__/providers.live.test.ts`
- Modify: `src/main/services/EmailPurchaseService.ts`
- Modify: `src/main/services/__tests__/EmailPurchaseService.test.ts`

**Interfaces:**

- Produces: `EmailCapacitySnapshot`.
- Produces: `ReservedEmail`.
- Produces: `EmailAcquisitionSession.acquireOne(workerId, signal)`, `commit`, and `release`.
- Produces: `EmailPurchaseService.openAcquisitionSession(provider: EmailSourceProvider, initialConcurrency: number, options: PurchaseOptions, signal: AbortSignal): Promise<EmailAcquisitionSession>`.
- Consumes: Task 2 reservation methods.
- Consumed by: continuous work sources in Task 4.

- [ ] **Step 1: Add red provider tests for the observed insufficient-funds envelope**

Create the sanitized response fixture:

~~~json
{
  "success": false,
  "message": "Không đủ tiền"
}
~~~

Add `import fs from 'node:fs';` to `Gmail94Provider.test.ts`, then add this
provider test:

~~~ts
it('classifies the observed Gmail94 order balance failure', async () => {
  const http = new FakeHttpClient();
  const body = JSON.parse(
    fs.readFileSync(
      'src/main/providers/__tests__/fixtures/gmail94-insufficient-funds.json',
      'utf8'
    )
  ) as unknown;
  http.enqueue({ body });
  const provider = new Gmail94Provider(http);

  const error = await provider.createOtpOrder(TOKEN, 'capcut')
    .catch((caught: unknown) => caught as ProviderError);

  expect(error).toMatchObject({
    code: 'INSUFFICIENT_FUNDS',
    serviceName: 'gmail94'
  });
  expect(error.message).not.toContain(TOKEN);
  expect(error.message).not.toContain(JSON.stringify(body));
});
~~~

- [ ] **Step 2: Add red service tests for preflight, JIT acquisition, serialization, and retry**

Extend `StubGmail94` with the exact safe-read and queued-failure controls used by
the tests:

~~~ts
class StubGmail94 implements IGmail94EmailApi {
  public createCalls: Array<{ token: string; service: string }> = [];
  public otpByOrder = new Map<string, string>();
  public profile: Gmail94Profile = {
    name: null,
    email: null,
    balance: 0
  };
  public services: Gmail94Service[] = [];
  public orderFailures: ProviderError[] = [];
  public createGate: Promise<void> | null = null;
  public profileCalls = 0;
  public failAfter = Number.POSITIVE_INFINITY;
  private counter = 0;

  async getProfile(): Promise<Gmail94Profile> {
    this.profileCalls += 1;
    return this.profile;
  }

  async listServices(): Promise<Gmail94Service[]> {
    return this.services;
  }

  async createOtpOrder(
    token: string,
    service: string
  ): Promise<{ email: string; orderId: string }> {
    this.createCalls.push({ token, service });
    if (this.createGate) await this.createGate;
    const failure = this.orderFailures.shift();
    if (failure) throw failure;
    this.counter += 1;
    if (this.counter > this.failAfter) throw new Error('quota exhausted');
    return {
      email: 'mail' + this.counter + '@gmail.com',
      orderId: 'order-' + this.counter
    };
  }

  async readOtp(
    _token: string,
    orderId: string,
    _service: string
  ): Promise<string | null> {
    return this.otpByOrder.get(orderId) ?? null;
  }
}
~~~

Import `Gmail94Profile` and `Gmail94Service` from `Gmail94Provider`. Add these
tests with fake timers:

~~~ts
it('preflight combines reusable rows with current balance and capcut price', async () => {
  storeKey('gmail94', 'GM-KEY');
  purchasedRepo.insert({
    id: 'paid-1',
    provider: 'gmail94',
    email: 'paid@gmail.com',
    service: 'capcut'
  });
  purchasedRepo.insert({
    id: 'legacy-facebook',
    provider: 'gmail94',
    email: 'legacy@gmail.com',
    service: 'facebook'
  });
  gmail.profile = { name: 'operator', email: 'owner@gmail.com', balance: 2500 };
  gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

  const session = await createService().openAcquisitionSession(
    'gmail94',
    3,
    { service: 'capcut' },
    new AbortController().signal
  );

  expect(session.capacity).toMatchObject({
    provider: 'gmail94',
    service: 'capcut',
    balance: 2500,
    unitPrice: 1000,
    reusableCount: 1,
    affordablePurchaseCount: 2,
    totalAvailableCount: 3
  });
  expect(session.capacity?.checkedAt).toEqual(expect.any(String));
  expect(gmail.createCalls).toHaveLength(0);
});

it('blocks an unaffordable initial wave before an order', async () => {
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 999 };
  gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];

  await expect(createService().openAcquisitionSession(
    'gmail94',
    2,
    {},
    new AbortController().signal
  )).rejects.toMatchObject({
    state: 'blocked',
    reason: { code: 'INSUFFICIENT_FUNDS', provider: 'gmail94' }
  });
  expect(gmail.createCalls).toHaveLength(0);
});

it('serializes two workers and never returns the same reusable row', async () => {
  storeKey('gmail94', 'GM-KEY');
  purchasedRepo.insert({
    id: 'paid-1',
    provider: 'gmail94',
    email: 'paid@gmail.com',
    service: 'capcut'
  });
  gmail.profile = { name: null, email: null, balance: 1000 };
  gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
  const session = await createService().openAcquisitionSession(
    'gmail94',
    2,
    {},
    new AbortController().signal
  );

  const [first, second] = await Promise.all([
    session.acquireOne('worker-1', new AbortController().signal),
    session.acquireOne('worker-2', new AbortController().signal)
  ]);

  expect(new Set([first.purchasedEmail.id, second.purchasedEmail.id]).size).toBe(2);
  expect(gmail.createCalls).toHaveLength(1);
});

it('pins Gmail94 purchases to the capcut service despite a stale saved slug', async () => {
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 1000 };
  gmail.services = [
    { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
  ];
  const session = await createService().openAcquisitionSession(
    'gmail94',
    1,
    { service: 'facebook' },
    new AbortController().signal
  );

  await session.acquireOne('worker-1', new AbortController().signal);

  expect(gmail.createCalls).toEqual([
    { token: 'GM-KEY', service: 'capcut' }
  ]);
});

it('refreshes balance after the run-local purchase budget is spent', async () => {
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 1000 };
  gmail.services = [
    { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
  ];
  const session = await createService().openAcquisitionSession(
    'gmail94',
    1,
    {},
    new AbortController().signal
  );

  const first = await session.acquireOne(
    'worker-1',
    new AbortController().signal
  );
  session.commit(first, 'account-1');
  gmail.profile = { name: null, email: null, balance: 1000 };
  const second = await session.acquireOne(
    'worker-1',
    new AbortController().signal
  );

  expect(second.purchasedEmail.email).toBe('mail2@gmail.com');
  expect(gmail.profileCalls).toBe(2);
  expect(gmail.createCalls).toHaveLength(2);
});

it('refreshes once and reports fresh safe details on early insufficient funds', async () => {
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 5000 };
  gmail.services = [
    { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
  ];
  const session = await createService().openAcquisitionSession(
    'gmail94',
    1,
    {},
    new AbortController().signal
  );
  gmail.profile = { name: null, email: null, balance: 250 };
  gmail.orderFailures = [
    new ProviderError(
      'INSUFFICIENT_FUNDS',
      'Số dư Gmail94 không đủ.',
      'gmail94'
    )
  ];

  await expect(session.acquireOne(
    'worker-1',
    new AbortController().signal
  )).rejects.toMatchObject({
    state: 'blocked',
    reason: {
      code: 'INSUFFICIENT_FUNDS',
      provider: 'gmail94',
      details: {
        balance: 250,
        unitPrice: 1000,
        affordablePurchaseCount: 0
      }
    }
  });
  expect(gmail.profileCalls).toBe(2);
  expect(gmail.createCalls).toHaveLength(1);
});

it('retries only transient purchase failures with 500ms and 1500ms backoff', async () => {
  vi.useFakeTimers();
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 5000 };
  gmail.services = [{ id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }];
  gmail.orderFailures = [
    new ProviderError('NETWORK_ERROR', 'network', 'gmail94'),
    new ProviderError('RATE_LIMITED', 'rate', 'gmail94')
  ];
  const session = await createService().openAcquisitionSession(
    'gmail94',
    1,
    {},
    new AbortController().signal
  );

  const acquisition = session.acquireOne('worker-1', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(gmail.createCalls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(499);
  expect(gmail.createCalls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(gmail.createCalls).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1499);
  expect(gmail.createCalls).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  await expect(acquisition).resolves.toMatchObject({
    purchasedEmail: { email: 'mail1@gmail.com' }
  });
  expect(gmail.createCalls).toHaveLength(3);
  vi.useRealTimers();
});
~~~

Add the non-retry and cancellation regressions exactly:

~~~ts
it.each(['AUTH_ERROR', 'CONFIG_ERROR', 'INSUFFICIENT_FUNDS'] as const)(
  'does not retry terminal provider error %s',
  async (code) => {
    storeKey('gmail94', 'GM-KEY');
    gmail.profile = { name: null, email: null, balance: 5000 };
    gmail.services = [
      { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
    ];
    gmail.orderFailures = [new ProviderError(code, 'sanitized', 'gmail94')];
    const session = await createService().openAcquisitionSession(
      'gmail94',
      1,
      {},
      new AbortController().signal
    );

    await expect(
      session.acquireOne('worker-1', new AbortController().signal)
    ).rejects.toBeInstanceOf(Error);
    expect(gmail.createCalls).toHaveLength(1);
  }
);

it('cancels a transient backoff before another Gmail94 order', async () => {
  vi.useFakeTimers();
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 5000 };
  gmail.services = [
    { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
  ];
  gmail.orderFailures = [
    new ProviderError('NETWORK_ERROR', 'network', 'gmail94')
  ];
  const session = await createService().openAcquisitionSession(
    'gmail94',
    1,
    {},
    new AbortController().signal
  );
  const controller = new AbortController();

  const acquisition = session.acquireOne('worker-1', controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(new Error('test cancellation'));
  await vi.advanceTimersByTimeAsync(500);

  await expect(acquisition).rejects.toThrow('test cancellation');
  expect(gmail.createCalls).toHaveLength(1);
});

it('blocks with PROVIDER_RETRY_EXHAUSTED after exactly three transient attempts', async () => {
  vi.useFakeTimers();
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 5000 };
  gmail.services = [
    { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
  ];
  gmail.orderFailures = [
    new ProviderError('NETWORK_ERROR', 'one', 'gmail94'),
    new ProviderError('RATE_LIMITED', 'two', 'gmail94'),
    new ProviderError('NETWORK_ERROR', 'three', 'gmail94')
  ];
  const session = await createService().openAcquisitionSession(
    'gmail94',
    1,
    {},
    new AbortController().signal
  );

  const acquisition = session.acquireOne(
    'worker-1',
    new AbortController().signal
  );
  await vi.advanceTimersByTimeAsync(2_000);

  await expect(acquisition).rejects.toMatchObject({
    state: 'blocked',
    reason: {
      code: 'PROVIDER_RETRY_EXHAUSTED',
      provider: 'gmail94',
      details: { attempts: 3 }
    }
  });
  expect(gmail.createCalls).toHaveLength(3);
});

it('cancels a worker waiting behind the serialized purchase queue', async () => {
  storeKey('gmail94', 'GM-KEY');
  gmail.profile = { name: null, email: null, balance: 5000 };
  gmail.services = [
    { id: 29, name: 'CapCut', slug: 'capcut', price: 1000 }
  ];
  let releaseFirst: () => void = () => {};
  gmail.createGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const session = await createService().openAcquisitionSession(
    'gmail94',
    2,
    {},
    new AbortController().signal
  );
  const first = session.acquireOne('worker-1', new AbortController().signal);
  while (gmail.createCalls.length === 0) await Promise.resolve();

  const controller = new AbortController();
  let secondError = '';
  const second = session.acquireOne('worker-2', controller.signal)
    .catch((error: unknown) => { secondError = (error as Error).message; });
  controller.abort(new Error('queue cancelled'));
  await second;
  const rejectedBeforeFirstFinished = secondError === 'queue cancelled';

  const third = session.acquireOne(
    'worker-3',
    new AbortController().signal
  );
  await Promise.resolve();
  expect(gmail.createCalls).toHaveLength(1);

  releaseFirst();
  await first;
  await third;

  expect(rejectedBeforeFirstFinished).toBe(true);
  expect(gmail.createCalls).toHaveLength(2);
});
~~~

Call `vi.useRealTimers()` in the existing `afterEach` so a failed fake-timer
assertion cannot leak clock state into later database tests.

Strengthen only the existing read-only Gmail94 live test; do not touch the
billable test or its flag:

~~~ts
expect(typeof profile.balance).toBe('number');
expect(Number.isFinite(profile.balance)).toBe(true);
expect(profile.balance as number).toBeGreaterThanOrEqual(0);

const capcut = services.find((entry) => entry.slug === 'capcut');
expect(capcut).toBeDefined();
expect(typeof capcut?.price).toBe('number');
expect(Number.isFinite(capcut?.price)).toBe(true);
expect(capcut?.price as number).toBeGreaterThan(0);
~~~

- [ ] **Step 3: Run provider and service tests and confirm RED**

Run:

~~~powershell
npx vitest run src/main/providers/__tests__/Gmail94Provider.test.ts src/main/services/__tests__/EmailPurchaseService.test.ts
~~~

Expected: FAIL because insufficient funds is generic, safe preflight is absent, and acquisition is still a bulk partial-success API.

- [ ] **Step 4: Classify only the observed Gmail94 balance message**

In `Gmail94Provider.unwrap`, classify the known order failure without copying the vendor body:

~~~ts
const message = readString(envelope, 'message');
const insufficient =
  action === 'mua email' &&
  typeof message === 'string' &&
  /không đủ tiền/i.test(message);

throw new ProviderError(
  insufficient ? 'INSUFFICIENT_FUNDS' : 'CONFIG_ERROR',
  insufficient
    ? 'Số dư Gmail94 không đủ để mua email CapCut.'
    : 'Gmail94 ' + action + ' thất bại: ' + (message ?? 'không rõ nguyên nhân') + '.',
  GMAIL94_SERVICE_NAME
);
~~~

Do not broaden this regex without a new captured response fixture.

- [ ] **Step 5: Add exact acquisition-session types and safe preflight**

Add:

~~~ts
export interface EmailCapacitySnapshot {
  provider: 'gmail94';
  service: 'capcut';
  balance: number;
  unitPrice: number;
  reusableCount: number;
  affordablePurchaseCount: number;
  totalAvailableCount: number;
  checkedAt: string;
}

export interface ReservedEmail {
  purchasedEmail: PurchasedEmailDTO;
  reservationId: string;
}

export interface EmailAcquisitionSession {
  readonly capacity?: EmailCapacitySnapshot;
  acquireOne(workerId: string, signal: AbortSignal): Promise<ReservedEmail>;
  commit(reservation: ReservedEmail, accountId: string): void;
  release(reservation: ReservedEmail): void;
}
~~~

Expose the session factory with this exact non-optional cancellation contract:

~~~ts
openAcquisitionSession(
  provider: EmailSourceProvider,
  initialConcurrency: number,
  options: PurchaseOptions,
  signal: AbortSignal
): Promise<EmailAcquisitionSession>
~~~

Extend `IGmail94EmailApi`:

~~~ts
getProfile(token: string): Promise<Gmail94Profile>;
listServices(): Promise<Gmail94Service[]>;
~~~

Implement preflight with parallel safe reads:

~~~ts
private async preflightGmail94(
  initialConcurrency: number,
  signal: AbortSignal
): Promise<EmailCapacitySnapshot> {
  signal.throwIfAborted();
  const serviceSlug = CAPCUT_OTP_SERVICE;
  const token = this.readApiKey('gmail94');
  const [profile, services] = await Promise.all([
    this.apis.gmail94.getProfile(token),
    this.apis.gmail94.listServices()
  ]);
  signal.throwIfAborted();
  const service = services.find((entry) => entry.slug === serviceSlug);
  const balance = profile.balance;
  const unitPrice = service?.price;

  if (balance === null || !Number.isFinite(balance) || balance < 0) {
    throw new ProviderError('CONFIG_ERROR', 'Gmail94 không trả về số dư hợp lệ.', 'gmail94');
  }
  if (
    !service ||
    typeof unitPrice !== 'number' ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0
  ) {
    throw new ProviderError('CONFIG_ERROR', 'Không đọc được giá dịch vụ capcut từ Gmail94.', 'gmail94');
  }

  const reusableCount = this.purchasedRepo.countAvailable(
    'gmail94',
    CAPCUT_OTP_SERVICE
  );
  const affordablePurchaseCount = Math.floor(balance / unitPrice);
  const snapshot: EmailCapacitySnapshot = {
    provider: 'gmail94',
    service: 'capcut',
    balance,
    unitPrice,
    reusableCount,
    affordablePurchaseCount,
    totalAvailableCount: reusableCount + affordablePurchaseCount,
    checkedAt: new Date().toISOString()
  };

  if (snapshot.totalAvailableCount < initialConcurrency) {
    throw new AutomationTerminalError(
      'blocked',
      {
        code: 'INSUFFICIENT_FUNDS',
        provider: 'gmail94',
        details: {
          requestedWorkers: initialConcurrency,
          reusableCount,
          balance,
          unitPrice,
          affordablePurchaseCount,
          checkedAt: snapshot.checkedAt
        }
      },
      'Số dư Gmail94 không đủ cho toàn bộ số luồng ban đầu.'
    );
  }
  return snapshot;
}
~~~

For Gmail94, `openAcquisitionSession` must always use
`CAPCUT_OTP_SERVICE`. Ignore a stale `options.service` value for order creation;
the field remains only for compatibility with persisted pre-change config.

At the start of `openAcquisitionSession`, establish the Gmail94 session state in
the same method that creates `acquireOne`; this keeps every identifier used by
the critical-section snippet below in scope:

~~~ts
const capacity = provider === 'gmail94'
  ? await this.preflightGmail94(initialConcurrency, signal)
  : undefined;
const gmailToken = provider === 'gmail94'
  ? this.readApiKey('gmail94')
  : null;
const gmailServiceSlug = CAPCUT_OTP_SERVICE;
let remainingAffordablePurchases =
  capacity?.affordablePurchaseCount ?? 0;
~~~

Do not derive `gmailServiceSlug` from `options.service`. A Gmail94 row is
reusable only when `service === gmailServiceSlug`; rows with `null`,
`facebook`, or any other legacy service value remain excluded.

- [ ] **Step 6: Implement the serialized JIT critical section and bounded retry**

Use one promise tail per provider:

~~~ts
private readonly acquisitionTails = new Map<EmailSourceProvider, Promise<void>>();

private async exclusive<T>(
  provider: EmailSourceProvider,
  signal: AbortSignal,
  operation: () => Promise<T>
): Promise<T> {
  const previous = this.acquisitionTails.get(provider) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => gate);
  this.acquisitionTails.set(provider, current);
  void current.then(() => {
    if (this.acquisitionTails.get(provider) === current) {
      this.acquisitionTails.delete(provider);
    }
  });
  try {
    await this.awaitTurn(previous.catch(() => undefined), signal);
    signal.throwIfAborted();
    return await operation();
  } finally {
    release();
  }
}

private async awaitTurn(turn: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([turn, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
~~~

Do not delete the map entry directly from an aborted waiter's `finally`: its
`current` promise deliberately remains behind the predecessor until that
predecessor exits. Keeping it as the tail prevents a third worker from bypassing
the still-running first purchase.

Use an abort-aware delay:

~~~ts
private wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
  return new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    function cleanup(): void {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    function onAbort(): void {
      cleanup();
      reject(signal.reason ?? new Error('Aborted'));
    }
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
~~~

The Gmail order loop must use exactly `[0, 500, 1500]` delays, retry only `NETWORK_ERROR` and `RATE_LIMITED`, and throw a sanitized `PROVIDER_RETRY_EXHAUSTED` terminal error after attempt three. Inside the `provider === 'gmail94'` branch of the exclusive section, `gmailToken` is non-null and the purchase body is:

~~~ts
const reservationId = workerId + ':' + this.nextId();
const requiredService = provider === 'gmail94'
  ? CAPCUT_OTP_SERVICE
  : undefined;
const reusable = this.purchasedRepo.reserveOldestAvailable(
  provider,
  reservationId,
  requiredService
);
if (reusable) return { purchasedEmail: reusable, reservationId };

if (gmailToken === null) {
  throw new Error('Gmail94 acquisition session lost its credential.');
}
const order = await this.createGmail94OrderWithRetry(
  gmailToken,
  gmailServiceSlug,
  signal
);
const purchasedEmail = this.purchasedRepo.insertReserved({
  id: this.nextId(),
  provider: 'gmail94',
  email: order.email,
  orderId: order.orderId,
  service: gmailServiceSlug
}, reservationId);
remainingAffordablePurchases -= 1;
return { purchasedEmail, reservationId };
~~~

Call `exclusive(provider, signal, operation)` for every one-item provider
acquisition, and call `signal.throwIfAborted()` immediately before every live
vendor order so an aborted queue entrant can never spend balance.

When `remainingAffordablePurchases` reaches zero, call `getProfile` once more,
validate the returned balance, and set
`remainingAffordablePurchases = Math.floor(balance / unitPrice)`. Proceed only
when the refreshed value is positive; otherwise throw the typed block with the
fresh `checkedAt`. If an order throws `INSUFFICIENT_FUNDS`, refresh profile
exactly once and include only refreshed balance, unit price, reusable/affordable
counts, and timestamp in the terminal reason.

For `customdomain`, generate exactly one unique address inside its provider-exclusive section and insert it already reserved. For `dongvanfb`, move the existing one-mail purchase/OAuth normalization body into the same one-item path and call `insertReserved` with its encrypted fields; do not bulk-buy.

`openAcquisitionSession` calls `preflightGmail94(initialConcurrency, signal)`.

Implement commit and release exactly:

~~~ts
const commit = (reservation: ReservedEmail, accountId: string): void => {
  const consumed = this.purchasedRepo.consumeReserved(
    reservation.purchasedEmail.id,
    reservation.reservationId,
    accountId
  );
  if (!consumed) {
    throw new AutomationTerminalError(
      'failed',
      { code: 'INTERNAL_ERROR' },
      'Quyền sở hữu email đã mua không còn hợp lệ.'
    );
  }
};

const release = (reservation: ReservedEmail): void => {
  this.purchasedRepo.releaseReservation(
    reservation.purchasedEmail.id,
    reservation.reservationId
  );
};

return { capacity, acquireOne, commit, release };
~~~

These are arrow closures inside `openAcquisitionSession`, so `this` remains the
`EmailPurchaseService`. `release` deliberately ignores `false`: an
already-consumed or already-released row is an idempotent no-op, not a reason to
overwrite account outcome.

For compile-safe sequencing, retain the old `purchase`, `markConsumed`,
`release`, and `EmailPurchaseResult` surface unchanged through Task 4. Do not
route any new code through it. Task 5 deletes that compatibility surface as soon
as `AutomationRunService` and every constructor test have switched to
`workSources` plus `emailOtp`.

- [ ] **Step 7: Run focused acquisition tests**

Run:

~~~powershell
npx vitest run src/main/providers/__tests__/Gmail94Provider.test.ts src/main/services/__tests__/EmailPurchaseService.test.ts
npm run typecheck
~~~

Expected: all focused tests PASS; no test invokes a live URL and no assertion output contains the API key.

- [ ] **Step 8: Commit when commit authorization exists**

~~~powershell
git add src/main/providers/Gmail94Provider.ts src/main/providers/__tests__/Gmail94Provider.test.ts src/main/providers/__live__/providers.live.test.ts src/main/providers/__tests__/fixtures/gmail94-insufficient-funds.json src/main/services/EmailPurchaseService.ts src/main/services/__tests__/EmailPurchaseService.test.ts
git commit -m "feat: acquire gmail mailboxes just in time"
~~~

---

### Task 4: Introduce Finite And Continuous Automation Work Sources

**Files:**

- Create: `src/main/services/AutomationWorkSource.ts`
- Create: `src/main/services/__tests__/AutomationWorkSource.test.ts`
- Modify: `src/shared/schemas/automation.schema.ts`
- Modify: `src/shared/schemas/__tests__/automation.schema.test.ts`
- Modify: `src/renderer/pages/Dashboard/automationConfig.ts`
- Modify: `src/renderer/pages/Dashboard/__tests__/automationConfig.test.ts`

**Interfaces:**

- Produces: `WorkSourceKind`, `AutomationWorkItem`, `SourceReadiness`, `AutomationWorkSource`, and `AutomationWorkSourceFactory`.
- Produces: `createAutomationWorkSourceFactory(emailService)`.
- Consumes: `EmailPurchaseService.openAcquisitionSession()` from Task 3.
- Consumed by: `AutomationRunService` in Task 5.

- [ ] **Step 1: Write red tests for finite exhaustion, full manual validation, duplicates, and continuous refill**

Create tests using a fake acquisition session:

~~~ts
const CONFIG = AutomationRunConfigSchema.parse({
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
  emailSource: { mode: 'manual', entries: ['seed@example.com'] },
  proxy: { mode: 'direct', entries: [] },
  password: {
    mode: 'random',
    length: 12,
    uppercase: true,
    numbers: true,
    special: false
  }
});

class FakeAcquisitionSession implements EmailAcquisitionSession {
  public acquireCalls: string[] = [];
  public committed: Array<{ reservationId: string; accountId: string }> = [];
  public released: string[] = [];
  private counter = 0;

  async acquireOne(
    workerId: string,
    _signal: AbortSignal
  ): Promise<ReservedEmail> {
    this.acquireCalls.push(workerId);
    this.counter += 1;
    return {
      reservationId: 'reservation-' + this.counter,
      purchasedEmail: {
        id: 'pe-' + this.counter,
        provider: 'gmail94',
        email: 'mail' + this.counter + '@gmail.com',
        hasPassword: false,
        hasOauth: false,
        orderId: 'order-' + this.counter,
        service: 'capcut',
        purchasedAt: '2026-09-05T00:00:00.000Z',
        consumedAt: null
      }
    };
  }

  commit(reservation: ReservedEmail, accountId: string): void {
    this.committed.push({ reservationId: reservation.reservationId, accountId });
  }

  release(reservation: ReservedEmail): void {
    this.released.push(reservation.reservationId);
  }
}

let fakeSession: FakeAcquisitionSession;
let fakeEmailService: {
  openCalls: Array<{ provider: string; initialConcurrency: number }>;
  openAcquisitionSession(
    provider: EmailSourceProvider,
    initialConcurrency: number,
    options: { service?: string },
    signal: AbortSignal
  ): Promise<EmailAcquisitionSession>;
};

beforeEach(() => {
  fakeSession = new FakeAcquisitionSession();
  fakeEmailService = {
  openCalls: [] as Array<{ provider: string; initialConcurrency: number }>,
  async openAcquisitionSession(
    provider: EmailSourceProvider,
    initialConcurrency: number,
    _options: { service?: string },
    _signal: AbortSignal
  ): Promise<EmailAcquisitionSession> {
    this.openCalls.push({ provider, initialConcurrency });
    return fakeSession;
  }
  };
});

it('manual source returns every valid line once and then exhausts', async () => {
  const factory = createAutomationWorkSourceFactory(fakeEmailService);
  const source = factory.create({
    ...CONFIG,
    threadCount: 2,
    emailSource: {
      mode: 'manual',
      entries: ['one@example.com|pw1', 'two@example.com|pw2', 'one@example.com|pw1']
    }
  }, 'run-1');

  await expect(source.prepare(2, new AbortController().signal)).resolves.toEqual({
    workerTarget: 2
  });
  await expect(source.next('worker-1', new AbortController().signal))
    .resolves.toMatchObject({ email: 'one@example.com', emailPassword: 'pw1' });
  await expect(source.next('worker-2', new AbortController().signal))
    .resolves.toMatchObject({ email: 'two@example.com', emailPassword: 'pw2' });
  await expect(source.next('worker-1', new AbortController().signal))
    .resolves.toMatchObject({ email: 'one@example.com', emailPassword: 'pw1' });
  await expect(source.next('worker-1', new AbortController().signal)).resolves.toBeNull();
});

it('manual source rejects the complete set of invalid one-based line numbers', async () => {
  const source = createAutomationWorkSourceFactory(fakeEmailService).create({
    ...CONFIG,
    emailSource: {
      mode: 'manual',
      entries: ['good@example.com', 'not-an-email', '', 'also-bad']
    }
  }, 'run-1');

  await expect(source.prepare(2, new AbortController().signal)).rejects.toMatchObject({
    code: 'CONFIG_ERROR',
    message: expect.stringContaining('2, 4')
  });
});

it('continuous source opens one session and asks it for every next item', async () => {
  const source = createAutomationWorkSourceFactory(fakeEmailService).create({
    ...CONFIG,
    threadCount: 1,
    emailSource: { mode: 'api', provider: 'gmail94', service: 'capcut' }
  }, 'run-2');
  const signal = new AbortController().signal;

  await source.prepare(1, signal);
  const first = await source.next('worker-1', signal);
  source.commit(first as AutomationWorkItem, 'account-1');
  const second = await source.next('worker-1', signal);

  expect(first?.email).toBe('mail1@gmail.com');
  expect(second?.email).toBe('mail2@gmail.com');
  expect(fakeEmailService.openCalls).toHaveLength(1);
  expect(fakeSession.acquireCalls).toEqual(['run-2:worker-1', 'run-2:worker-1']);
});
~~~

Add the short-manual-list regression exactly:

~~~ts
it('reduces only manual workerTarget when the finite list is shorter', async () => {
  const source = createAutomationWorkSourceFactory(fakeEmailService).create({
    ...CONFIG,
    threadCount: 5,
    emailSource: {
      mode: 'manual',
      entries: ['one@example.com', 'two@example.com']
    }
  }, 'run-short-manual');
  const signal = new AbortController().signal;

  await expect(source.prepare(5, signal)).resolves.toEqual({ workerTarget: 2 });
  await expect(source.next('worker-1', signal))
    .resolves.toMatchObject({ sourceId: 'manual:1', email: 'one@example.com' });
  await expect(source.next('worker-2', signal))
    .resolves.toMatchObject({ sourceId: 'manual:2', email: 'two@example.com' });
  await expect(source.next('worker-1', signal)).resolves.toBeNull();
});
~~~

In `automationConfig.test.ts`, replace the old assertion that drops blank lines
with:

~~~ts
it('preserves manual textarea positions so validation reports original line numbers', () => {
  const result = toRunConfig(state({
    emailList: 'good@example.com|pw\n\nnot-an-email\nlast@example.com\n'
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.config.emailSource).toEqual({
    mode: 'manual',
    entries: [
      'good@example.com|pw',
      '',
      'not-an-email',
      'last@example.com',
      ''
    ]
  });
});
~~~

In `automation.schema.test.ts`, add:

~~~ts
it('accepts blank manual elements as textarea position markers', () => {
  const parsed = AutomationRunConfigSchema.parse({
    ...baseConfig,
    module: 'credit',
    emailSource: {
      mode: 'manual',
      entries: ['good@example.com', '', 'bad-line']
    }
  });

  expect(parsed.emailSource).toEqual({
    mode: 'manual',
    entries: ['good@example.com', '', 'bad-line']
  });
});
~~~

An empty element is positional information, not a work item.

- [ ] **Step 2: Run the new suite and confirm RED**

Run:

~~~powershell
npx vitest run src/main/services/__tests__/AutomationWorkSource.test.ts
~~~

Expected: FAIL because the work-source file and factory do not exist.

- [ ] **Step 3: Define the exact provider-neutral work-source contract**

Create `AutomationWorkSource.ts` with:

~~~ts
import { z } from 'zod';
import type {
  AutomationRunConfigDTO
} from '../../shared/schemas/automation.schema';
import type { EmailSourceProvider } from '../../shared/schemas/provider.schema';
import { ProviderError } from '../providers/ProviderError';
import type {
  EmailAcquisitionSession,
  EmailCapacitySnapshot,
  EmailPurchaseService,
  ReservedEmail
} from './EmailPurchaseService';

export type WorkSourceKind = 'finite' | 'continuous';

export interface AutomationWorkItem {
  sourceId: string;
  email: string;
  emailProvider: string;
  emailPassword?: string;
  purchasedEmailId?: string;
  reservationId?: string;
}

export interface SourceReadiness {
  workerTarget: number;
  capacity?: EmailCapacitySnapshot;
}

export interface AutomationWorkSource {
  readonly kind: WorkSourceKind;
  prepare(initialConcurrency: number, signal: AbortSignal): Promise<SourceReadiness>;
  next(workerId: string, signal: AbortSignal): Promise<AutomationWorkItem | null>;
  commit(item: AutomationWorkItem, accountId: string): void;
  release(item: AutomationWorkItem): void;
}

export interface AutomationWorkSourceFactory {
  create(config: AutomationRunConfigDTO, runId: string): AutomationWorkSource;
}
~~~

- [ ] **Step 4: Implement finite manual parsing without silently dropping a line**

First change the manual branch of `EmailSourceConfigSchema` to
`entries: z.array(z.string()).default([])`. In `toRunConfig`, preserve textarea
positions only for manual email input:

~~~ts
const manualEntries = state.emailList.split(/\r?\n/);
const hasManualEntry = manualEntries.some(
  (line) => line.trim().length > 0
);

if (state.emailSourceMode === 'manual' && !hasManualEntry) {
  return {
    ok: false,
    message:
      'Hãy nhập danh sách email theo định dạng email|password, ' +
      'hoặc chuyển sang chế độ API.'
  };
}
~~~

Use `{ mode: 'manual', entries: manualEntries }` in the candidate. Keep the
existing filtered `splitLines` helper for proxy and proxy-key input.

Use `z.string().email()` and preserve duplicates:

~~~ts
class ManualWorkSource implements AutomationWorkSource {
  readonly kind = 'finite' as const;
  private queue: AutomationWorkItem[] = [];

  constructor(private readonly entries: string[]) {}

  async prepare(initialConcurrency: number): Promise<SourceReadiness> {
    const invalid: number[] = [];
    this.queue = this.entries.flatMap((raw, index) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return [];
      const [emailPart, passwordPart] = trimmed.split('|').map((part) => part.trim());
      if (!z.string().email().safeParse(emailPart).success) {
        invalid.push(index + 1);
        return [];
      }
      return [{
        sourceId: 'manual:' + (index + 1),
        email: emailPart,
        emailProvider: 'manual',
        emailPassword: passwordPart || undefined
      }];
    });

    if (invalid.length > 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Email thủ công không hợp lệ ở dòng: ' + invalid.join(', ') + '.'
      );
    }
    if (this.queue.length === 0) {
      throw new ProviderError('CONFIG_ERROR', 'Danh sách email thủ công đang trống.');
    }
    return { workerTarget: Math.min(initialConcurrency, this.queue.length) };
  }

  async next(): Promise<AutomationWorkItem | null> {
    return this.queue.shift() ?? null;
  }

  commit(): void {}
  release(): void {}
}
~~~

Blank lines remain ignored, so displayed line numbers continue to match the pasted textarea.

- [ ] **Step 5: Implement continuous sources with private reservation ownership**

The continuous source keeps the full `ReservedEmail` in a private map and exposes only normalized IDs:

~~~ts
class ContinuousEmailWorkSource implements AutomationWorkSource {
  readonly kind = 'continuous' as const;
  private session: EmailAcquisitionSession | null = null;
  private readonly reservations = new Map<string, ReservedEmail>();

  constructor(
    private readonly emailService: Pick<EmailPurchaseService, 'openAcquisitionSession'>,
    private readonly provider: EmailSourceProvider,
    private readonly service: string | undefined,
    private readonly runId: string
  ) {}

  async prepare(initialConcurrency: number, signal: AbortSignal): Promise<SourceReadiness> {
    this.session = await this.emailService.openAcquisitionSession(
      this.provider,
      initialConcurrency,
      { service: this.service },
      signal
    );
    return {
      workerTarget: initialConcurrency,
      capacity: this.session.capacity
    };
  }

  async next(workerId: string, signal: AbortSignal): Promise<AutomationWorkItem> {
    if (!this.session) throw new Error('Continuous source was not prepared.');
    const reservation = await this.session.acquireOne(this.runId + ':' + workerId, signal);
    this.reservations.set(reservation.reservationId, reservation);
    return {
      sourceId: reservation.reservationId,
      email: reservation.purchasedEmail.email,
      emailProvider: reservation.purchasedEmail.provider,
      purchasedEmailId: reservation.purchasedEmail.id,
      reservationId: reservation.reservationId
    };
  }

  commit(item: AutomationWorkItem, accountId: string): void {
    if (!item.reservationId || !this.session) return;
    const reservation = this.reservations.get(item.reservationId);
    if (!reservation) throw new Error('Email reservation ownership was lost.');
    this.session.commit(reservation, accountId);
    this.reservations.delete(item.reservationId);
  }

  release(item: AutomationWorkItem): void {
    if (!item.reservationId || !this.session) return;
    const reservation = this.reservations.get(item.reservationId);
    if (!reservation) return;
    this.session.release(reservation);
    this.reservations.delete(item.reservationId);
  }
}
~~~

Map API providers directly. Map `emailSource.mode === 'custom'` to provider `customdomain`. The factory must not read SQLite or secrets itself.

- [ ] **Step 6: Export the exact factory without prematurely changing composition**

Add:

~~~ts
export function createAutomationWorkSourceFactory(
  emailService: Pick<EmailPurchaseService, 'openAcquisitionSession'>
): AutomationWorkSourceFactory {
  return {
    create(config, runId) {
      if (config.emailSource.mode === 'manual') {
        return new ManualWorkSource(config.emailSource.entries);
      }
      const provider: EmailSourceProvider =
        config.emailSource.mode === 'custom'
          ? 'customdomain'
          : config.emailSource.provider;
      const service = config.emailSource.mode === 'api'
        ? config.emailSource.service
        : undefined;
      return new ContinuousEmailWorkSource(
        emailService,
        provider,
        service,
        runId
      );
    }
  };
}
~~~

Do not pass `workSources` into `AutomationRunService` in this task because the
service contract does not change until Task 5. Task 5 performs the atomic
composition cutover and retains `EmailPurchaseService` separately for OTP reads.

- [ ] **Step 7: Run work-source tests and global typecheck**

Run:

~~~powershell
npx vitest run src/shared/schemas/__tests__/automation.schema.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/renderer/pages/Dashboard/__tests__/automationConfig.test.ts
npm run typecheck
~~~

Expected: all focused tests and global TypeScript PASS, and no purchased-email
DTO exposes a reservation owner or secret.

- [ ] **Step 8: Commit when commit authorization exists**

~~~powershell
git add src/shared/schemas/automation.schema.ts src/shared/schemas/__tests__/automation.schema.test.ts src/main/services/AutomationWorkSource.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/renderer/pages/Dashboard/automationConfig.ts src/renderer/pages/Dashboard/__tests__/automationConfig.test.ts
git commit -m "feat: add finite and continuous work sources"
~~~

---

### Task 5: Rebuild AutomationRunService Around Continuous Cancellable Worker Slots

**Files:**

- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/EmailPurchaseService.ts`
- Modify: `src/main/services/ProxyLeaseManager.ts`
- Modify: `src/main/services/LazyProxyLeaseSource.ts`
- Modify: `src/main/services/__tests__/AutomationRunService.test.ts`
- Modify: `src/main/services/__tests__/EmailPurchaseService.test.ts`
- Modify: `src/main/services/__tests__/ProxyLeaseManager.test.ts`
- Modify: `src/main/services/__tests__/LazyProxyLeaseSource.test.ts`
- Modify: `src/main/services/__tests__/automationTaskProgress.test.ts`
- Modify: `src/main/services/__tests__/capcutSignupPath.test.ts`
- Modify: `src/main/services/__tests__/proxyQueueIntegration.test.ts`
- Modify: `src/main/runtime/providerStack.ts`
- Modify: `src/main/runtime/__tests__/providerStack.test.ts`

**Interfaces:**

- Consumes: `AutomationWorkSourceFactory` and Task 1 progress/reason contracts.
- Produces: `IEmailOtpSource.readOtp(purchasedEmailId, type?)`; acquisition and
  OTP remain separate dependencies after the composition cutover.
- Changes: `IProxyLeaseSource.acquire(signal?: AbortSignal)`.
- Changes: `AutomationRunService.stop(code?: 'USER_STOP' | 'APP_SHUTDOWN')`.
- Changes: `CapcutTaskRunner.runAccount(input)` receives the iteration
  `signal: AbortSignal`.
- Produces: honest `ThreadOutcome` and continuous `waitForCompletion()` behavior.
- Preserves: `start(config): Promise<{ runId: string }>`, `stopThread(accountId)`, progress subscription, and browser/runtime abstractions.

- [ ] **Step 1: Replace the partial-purchase regression with red continuous-worker tests**

Delete the assertion that requested three emails may run as one. Add these regressions:

Add these imports to `AutomationRunService.test.ts`, and remove the obsolete
bulk-email fake imports once their old tests are deleted:

~~~ts
import { AutomationTerminalError } from '../AutomationTerminalError';
import type {
  AutomationWorkItem,
  AutomationWorkSource,
  SourceReadiness,
  WorkSourceKind
} from '../AutomationWorkSource';
import type { RunningThreadInfo } from '../AutomationRunService';
~~~

~~~ts
// Extend the existing browser fake so concurrency is measured independently
// from cumulative start calls.
class StubBrowserRuntime implements IBrowserRuntimeApi {
  public startCalls: Array<{ headless: boolean; proxyHost?: string }> = [];
  public stopped: string[] = [];
  public peakOpenProfiles = 0;
  public failAtCall = Number.POSITIVE_INFINITY;
  public failStopFor = new Set<string>();
  private openProfiles = 0;
  private counter = 0;

  async startProfile(params: {
    headless: boolean;
    proxy?: { host: string };
  }): Promise<StartedProfile> {
    this.counter += 1;
    if (this.counter === this.failAtCall) throw new Error('launcher refused');
    this.openProfiles += 1;
    this.peakOpenProfiles = Math.max(this.peakOpenProfiles, this.openProfiles);
    this.startCalls.push({
      headless: params.headless,
      proxyHost: params.proxy?.host
    });
    return {
      profileId: 'profile-' + this.counter,
      port: 50_000 + this.counter,
      browserType: 'mimic'
    };
  }

  async stopProfile(profileId: string): Promise<void> {
    this.openProfiles = Math.max(0, this.openProfiles - 1);
    if (this.failStopFor.has(profileId)) throw new Error('stop failed with token=secret');
    this.stopped.push(profileId);
  }
}

class StubWorkSource implements AutomationWorkSource {
  public prepareCalls = 0;
  public nextCalls = 0;
  public maxConcurrentNext = 0;
  public committed: string[] = [];
  public released: string[] = [];
  public terminalError: Error | null = null;
  public terminalThrown = false;
  public gatedNextCall: number | null = null;
  public nextGate: Promise<void> | null = null;
  private activeNext = 0;
  private readonly queue: AutomationWorkItem[];

  constructor(
    public readonly kind: WorkSourceKind,
    items: AutomationWorkItem[],
    private readonly workerTarget: number
  ) {
    this.queue = [...items];
  }

  async prepare(
    _initialConcurrency: number,
    _signal: AbortSignal
  ): Promise<SourceReadiness> {
    this.prepareCalls += 1;
    return { workerTarget: this.workerTarget };
  }

  async next(_workerId: string, signal: AbortSignal): Promise<AutomationWorkItem | null> {
    this.nextCalls += 1;
    const callNumber = this.nextCalls;
    this.activeNext += 1;
    this.maxConcurrentNext = Math.max(this.maxConcurrentNext, this.activeNext);
    try {
      if (this.gatedNextCall === callNumber && this.nextGate) {
        await Promise.race([
          this.nextGate,
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(signal.reason ?? new Error('Aborted')),
              { once: true }
            );
          })
        ]);
      }
      const item = this.queue.shift();
      if (item) return item;
      if (this.kind === 'finite') return null;
      if (this.terminalError) {
        this.terminalThrown = true;
        throw this.terminalError;
      }
      return await new Promise<AutomationWorkItem>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(signal.reason ?? new Error('Aborted')),
          { once: true }
        );
      });
    } finally {
      this.activeNext -= 1;
    }
  }

  commit(item: AutomationWorkItem, _accountId: string): void {
    this.committed.push(item.sourceId);
  }

  release(item: AutomationWorkItem): void {
    this.released.push(item.sourceId);
  }
}

function makeItems(count: number, provider = 'gmail94'): AutomationWorkItem[] {
  return Array.from({ length: count }, (_value, index) => ({
    sourceId: 'source-' + (index + 1),
    email: 'mail' + (index + 1) + '@gmail.com',
    emailProvider: provider,
    purchasedEmailId: 'pe-' + (index + 1),
    reservationId: 'reservation-' + (index + 1)
  }));
}

async function waitFor(
  predicate: () => boolean,
  description: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for ' + description);
}

class WorkloadGate {
  public callCount = 0;
  private readonly releases: Array<() => void> = [];

  constructor(private readonly holdFromCall: number | null) {}

  readonly sleep = async (ms: number): Promise<void> => {
    if (ms < 100_000) return;
    this.callCount += 1;
    if (this.holdFromCall === null || this.callCount < this.holdFromCall) return;
    await new Promise<void>((resolve) => this.releases.push(resolve));
  };

  releaseAll(): void {
    for (const release of this.releases.splice(0)) release();
  }
}

interface HarnessOptions {
  kind: WorkSourceKind;
  threadCount: number;
  items: AutomationWorkItem[];
  holdFromWorkload?: number;
  emailSource: AutomationRunConfigDTO['emailSource'];
  proxy?: AutomationRunConfigDTO['proxy'];
}

function createHarness(options: HarnessOptions) {
  const source = new StubWorkSource(
    options.kind,
    options.items,
    options.kind === 'finite'
      ? Math.min(options.threadCount, options.items.length)
      : options.threadCount
  );
  const accounts = new StubAccounts();
  const browser = new StubBrowserRuntime();
  const proxies = new StubProxySource();
  const sink = new CollectingSink();
  const logBus = new LogBus(sink, { maxBatchSize: 1000 });
  const workloads = new WorkloadGate(options.holdFromWorkload ?? null);
  let id = 0;
  const config = baseConfig({
    threadCount: options.threadCount,
    module: 'credit',
    emailSource: options.emailSource,
    proxy: options.proxy ?? { mode: 'direct', entries: [] },
    testDurationMs: options.holdFromWorkload === undefined ? 0 : 100_000
  });
  const service = new AutomationRunService(
    {
      workSources: { create: () => source },
      emailOtp: { readOtp: async () => '123456' },
      proxies,
      browser,
      accounts,
      logBus
    },
    {
      nextId: () => 'id-' + ++id,
      sleep: workloads.sleep
    }
  );

  return {
    service,
    source,
    accounts,
    browser,
    proxies,
    sink,
    logBus,
    workloads,
    config,
    waitForAccepted: (count: number) =>
      waitFor(
        () => service.getProgress().accountsAccepted >= count,
        count + ' accepted accounts'
      ),
    waitForRunningAccount: async (excludeId?: string) => {
      await waitFor(
        () => service.getRunningThreads().some((row) => row.accountId !== excludeId),
        'running account'
      );
      return service.getRunningThreads().find((row) => row.accountId !== excludeId) as RunningThreadInfo;
    }
  };
}

function createContinuousHarness(options: {
  threadCount: number;
  items: number;
  holdFromWorkload?: number;
  proxy?: AutomationRunConfigDTO['proxy'];
}) {
  return createHarness({
    kind: 'continuous',
    threadCount: options.threadCount,
    items: makeItems(options.items),
    holdFromWorkload: options.holdFromWorkload,
    emailSource: { mode: 'api', provider: 'gmail94', service: 'capcut' },
    proxy: options.proxy
  });
}

function createManualHarness(options: {
  threadCount: number;
  entries: string[];
}) {
  const items = options.entries.map((email, index) => ({
    sourceId: 'manual:' + (index + 1),
    email,
    emailProvider: 'manual'
  }));
  return createHarness({
    kind: 'finite',
    threadCount: options.threadCount,
    items,
    emailSource: { mode: 'manual', entries: options.entries },
    proxy: { mode: 'direct', entries: [] }
  });
}

it('threadCount one refills the slot with a second API account', async () => {
  const harness = createContinuousHarness({ threadCount: 1, items: 2 });
  await harness.service.start(harness.config);
  await harness.waitForAccepted(2);

  expect(harness.source.maxConcurrentNext).toBe(1);
  expect(harness.accounts.created.map((row) => row.email)).toEqual([
    'mail1@gmail.com',
    'mail2@gmail.com'
  ]);

  await harness.service.stop();
});

it('never exceeds threadCount active API worker iterations', async () => {
  const harness = createContinuousHarness({
    threadCount: 2,
    items: 5,
    holdFromWorkload: 1
  });
  await harness.service.start(harness.config);
  await harness.waitForAccepted(2);
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(harness.browser.peakOpenProfiles).toBe(2);
  expect(harness.service.getProgress().workersActive).toBe(2);
  expect(harness.service.getProgress().accountsAccepted).toBe(2);

  await harness.service.stop();
});

it('does not let a fast worker consume refill work before the initial API wave is acquired', async () => {
  const harness = createContinuousHarness({ threadCount: 2, items: 3 });
  let releaseSecond: () => void = () => {};
  harness.source.gatedNextCall = 2;
  harness.source.nextGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });

  const starting = harness.service.start(harness.config);
  await waitFor(() => harness.source.nextCalls === 2, 'two initial acquisitions');
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(harness.source.nextCalls).toBe(2);
  expect(harness.service.getProgress().workerTarget).toBe(2);

  releaseSecond();
  await starting;
  await harness.waitForAccepted(3);
  await harness.service.stop();
});

it('manual mode processes every entry with threadCount only as concurrency', async () => {
  const harness = createManualHarness({
    threadCount: 2,
    entries: [
      'one@example.com',
      'two@example.com',
      'three@example.com',
      'four@example.com',
      'five@example.com'
    ]
  });

  await harness.service.start(harness.config);
  const summary = await harness.service.waitForCompletion();

  expect(harness.accounts.created).toHaveLength(5);
  expect(harness.browser.peakOpenProfiles).toBe(2);
  expect(summary.state).toBe('completed');
  expect(summary.terminalReason).toEqual({ code: 'MANUAL_EXHAUSTED' });
  expect(summary.accountsAccepted).toBe(5);
  expect(summary.accountsCompleted).toBe(5);
});

it('stopThread stops one account and refills that worker while the run stays active', async () => {
  const harness = createContinuousHarness({
    threadCount: 1,
    items: 3,
    holdFromWorkload: 1
  });
  await harness.service.start(harness.config);
  const first = await harness.waitForRunningAccount();

  await expect(harness.service.stopThread(first.accountId)).resolves.toBe(true);
  const second = await harness.waitForRunningAccount(first.accountId);

  expect(second.accountId).not.toBe(first.accountId);
  expect(harness.service.getProgress().state).toBe('running');
  expect(harness.service.getProgress().accountsStopped).toBe(1);
  await harness.service.stop();
});
~~~

In `automationTaskProgress.test.ts`, add the workload-failure regression using
its existing `StubLauncher` and CapCut test path:

~~~ts
class RejectingCapcutRunner implements CapcutTaskRunner {
  async runAccount(): Promise<CapcutAccountResult> {
    throw new Error('signup failed');
  }
}

it('preserves a CapCut workload error after launcher cleanup', async () => {
  const service = createService(new RejectingCapcutRunner());
  await service.start(baseConfig());
  const summary = await service.waitForCompletion();

  expect(accounts.updates.at(-1)?.data).toMatchObject({
    status: 'error',
    automationStep: 'Lỗi khi làm nhiệm vụ'
  });
  expect(summary.accountsFailed).toBe(1);
  expect(summary.accountsCompleted).toBe(0);
  expect(launcher.stopped).toEqual(['profile-1']);
});

it('treats a fresh incomplete CapCut result as one failed account', async () => {
  const progress = new RecordingProgressSink();
  const service = createService(new StubCapcutRunner(fullResult()), progress);
  await service.start(baseConfig());
  const summary = await service.waitForCompletion();

  expect(accounts.updates.at(-1)?.data).toMatchObject({
    status: 'error',
    automationStep: 'Còn thiếu 1 nhiệm vụ'
  });
  expect(summary.accountsFailed).toBe(1);
  expect(summary.accountsCompleted).toBe(0);
  expect(progress.calls[0].rows.some((row) => row.status === 4)).toBe(true);
});
~~~

Add the remaining lifecycle regressions exactly:

~~~ts
it('global Stop prevents another source.next after the active account', async () => {
  const harness = createContinuousHarness({
    threadCount: 1,
    items: 2,
    holdFromWorkload: 1
  });
  await harness.service.start(harness.config);
  await harness.waitForAccepted(1);

  await harness.service.stop();

  expect(harness.source.nextCalls).toBe(1);
  expect(harness.service.getProgress()).toMatchObject({
    state: 'stopped',
    terminalReason: { code: 'USER_STOP' }
  });
});

it('stops only unfinished work and preserves an earlier completed account', async () => {
  const harness = createContinuousHarness({
    threadCount: 1,
    items: 2,
    holdFromWorkload: 2
  });
  await harness.service.start(harness.config);
  await harness.waitForAccepted(2);

  await harness.service.stop();
  const summary = await harness.service.waitForCompletion();
  const lastStatus = new Map<string, unknown>();
  for (const update of harness.accounts.updates) {
    if (update.data.status) lastStatus.set(update.id, update.data.status);
  }

  expect(summary.accountsCompleted).toBe(1);
  expect(summary.accountsStopped).toBe(1);
  expect(lastStatus.get('acc-1')).toBe('done');
  expect(lastStatus.get('acc-2')).toBe('stopped');
});

it('blocks a short proxy-key wave before requesting an email', async () => {
  const harness = createContinuousHarness({
    threadCount: 2,
    items: 2,
    proxy: { mode: 'proxykey', keys: ['only-one-key'] }
  });
  harness.proxies.keyCount = 1;

  await expect(harness.service.start(harness.config)).rejects.toMatchObject({
    state: 'blocked',
    reason: {
      code: 'PROXY_CAPACITY_UNAVAILABLE',
      details: { requestedWorkers: 2, availableSlots: 1 }
    }
  });
  expect(harness.source.nextCalls).toBe(0);
  expect(harness.browser.startCalls).toHaveLength(0);
});

it.each([
  { module: 'trial' as const, browser: 'multilogin' as const },
  { module: 'credit' as const, browser: 'gologin' as const }
])('rejects unsupported work before preparing an email source', async (unsupported) => {
  const harness = createContinuousHarness({ threadCount: 1, items: 1 });

  await expect(harness.service.start({
    ...harness.config,
    module: unsupported.module,
    browser: unsupported.browser
  })).rejects.toBeInstanceOf(Error);

  expect(harness.source.prepareCalls).toBe(0);
  expect(harness.source.nextCalls).toBe(0);
  expect(harness.browser.startCalls).toHaveLength(0);
});

it('releases an uncommitted mailbox when browser launch fails', async () => {
  const harness = createContinuousHarness({ threadCount: 1, items: 1 });
  harness.browser.failAtCall = 1;
  await harness.service.start(harness.config);
  await waitFor(
    () => harness.source.released.includes('source-1'),
    'released mailbox reservation'
  );

  expect(harness.source.committed).toEqual([]);
  expect(harness.source.released).toEqual(['source-1']);
  await harness.service.stop();
});

it('assigns exactly one terminal counter to every accepted account', async () => {
  const harness = createManualHarness({
    threadCount: 2,
    entries: ['one@example.com', 'two@example.com', 'three@example.com']
  });
  harness.browser.failAtCall = 2;

  await harness.service.start(harness.config);
  const summary = await harness.service.waitForCompletion();

  expect(summary.accountsAccepted).toBe(3);
  expect(summary.accountsCompleted).toBe(2);
  expect(summary.accountsFailed).toBe(1);
  expect(summary.accountsStopped).toBe(0);
  expect(
    summary.accountsCompleted + summary.accountsFailed + summary.accountsStopped
  ).toBe(summary.accountsAccepted);
});

it('retains the workload outcome when cleanup fails and reports the cleanup count', async () => {
  const harness = createManualHarness({
    threadCount: 1,
    entries: ['one@example.com']
  });
  harness.browser.failStopFor.add('profile-1');

  await harness.service.start(harness.config);
  const summary = await harness.service.waitForCompletion();

  expect(summary.accountsCompleted).toBe(1);
  expect(summary.accountsFailed).toBe(0);
  expect(summary.state).toBe('completed');
  expect(summary.terminalReason).toMatchObject({
    code: 'MANUAL_EXHAUSTED',
    details: { cleanupFailures: 1 }
  });
  expect(harness.accounts.updates.at(-1)?.data.status).toBe('done');
});

it('reports a partial initial API wave as blocked without lowering workerTarget', async () => {
  const harness = createContinuousHarness({ threadCount: 2, items: 1 });
  harness.source.terminalError = new AutomationTerminalError(
    'blocked',
    { code: 'INSUFFICIENT_FUNDS', provider: 'gmail94' },
    'Số dư Gmail94 không đủ.'
  );

  await harness.service.start(harness.config);
  const summary = await harness.service.waitForCompletion();

  expect(summary.workerTarget).toBe(2);
  expect(summary.state).toBe('blocked');
  expect(summary.terminalReason).toMatchObject({
    code: 'INSUFFICIENT_FUNDS',
    provider: 'gmail94'
  });
  expect(summary.state).not.toBe('completed');
});

it('lets an in-flight workload settle before publishing a provider block', async () => {
  const harness = createContinuousHarness({
    threadCount: 2,
    items: 2,
    holdFromWorkload: 2
  });
  harness.source.terminalError = new AutomationTerminalError(
    'blocked',
    { code: 'INSUFFICIENT_FUNDS', provider: 'gmail94' },
    'Số dư Gmail94 không đủ.'
  );
  await harness.service.start(harness.config);
  const completion = harness.service.waitForCompletion();
  let settled = false;
  void completion.then(() => { settled = true; });

  await waitFor(() => harness.source.terminalThrown, 'provider terminal error');
  expect(settled).toBe(false);
  expect(harness.browser.stopped).toHaveLength(1);

  harness.workloads.releaseAll();
  const summary = await completion;
  expect(summary.state).toBe('blocked');
  expect(summary.terminalReason).toMatchObject({
    code: 'INSUFFICIENT_FUNDS',
    provider: 'gmail94'
  });
  expect(summary.accountsCompleted).toBe(2);
});

it('keeps waitForCompletion pending for a continuous source until Stop', async () => {
  const harness = createContinuousHarness({ threadCount: 1, items: 1 });
  await harness.service.start(harness.config);
  await harness.waitForAccepted(1);
  const completion = harness.service.waitForCompletion();
  let settled = false;
  void completion.then(() => { settled = true; });

  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);

  await harness.service.stop();
  await expect(completion).resolves.toMatchObject({
    state: 'stopped',
    terminalReason: { code: 'USER_STOP' }
  });
});

it('publishes failed for an unexpected continuous-source invariant', async () => {
  const harness = createContinuousHarness({ threadCount: 1, items: 0 });
  harness.source.terminalError = new Error('unexpected invariant');

  await harness.service.start(harness.config);
  const summary = await harness.service.waitForCompletion();

  expect(summary).toMatchObject({
    state: 'failed',
    terminalReason: { code: 'INTERNAL_ERROR' },
    accountsAccepted: 0,
    accountsFailed: 0
  });
});
~~~

- [ ] **Step 2: Run focused service tests and verify RED**

Run:

~~~powershell
npx vitest run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts
~~~

Expected: FAIL because the current fixed plan queue terminates, shutdown writes `done`, and old counters cannot represent the assertions.

- [ ] **Step 3: Make proxy acquisition cancellation-aware**

Change the interface and both implementations:

~~~ts
export interface IProxyLeaseSource {
  acquire(signal?: AbortSignal): Promise<AcquiredProxyLease>;
  release(lease: AcquiredProxyLease): Promise<void>;
  releaseAll(): Promise<void>;
  availableSlots?(): Promise<number | null>;
  configure?(options: { keys?: string[]; region?: string }): void;
}
~~~

In `ProxyLeaseManager.acquire`, check `signal?.throwIfAborted()` before key scans and replace the wait with:

~~~ts
private wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return this.sleep(ms);
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason ?? new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void this.sleep(ms).then(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}
~~~

`LazyProxyLeaseSource.acquire(signal)` forwards the signal. In
`ProxyLeaseManager.test.ts`, add the abort regression using the existing provider
fake:

~~~ts
it('aborts a busy-key wait before requesting another proxy', async () => {
  const api = new StubProxyApi(['K1']);
  api.setIps('K1', ['20.0.0.1', '20.0.0.2']);
  const manager = createManager(api, { acquireTimeoutMs: 5_000 });
  const controller = new AbortController();
  const first = await manager.acquire();
  onSleep = () => controller.abort(new Error('stop requested'));

  await expect(manager.acquire(controller.signal)).rejects.toThrow('stop requested');
  expect(api.getNewCalls).toEqual(['K1']);
  expect(sleepCalls).toEqual([100]);
  await manager.release(first);
});
~~~

In `LazyProxyLeaseSource.test.ts`, extend `FakeManager` with
`public acquireSignals: Array<AbortSignal | undefined> = []` and change its
method to `async acquire(signal?: AbortSignal)` so it pushes the signal before
returning the lease. Then add:

~~~ts
it('forwards the caller AbortSignal to the lazily created source', async () => {
  const built: FakeManager[] = [];
  const source = new LazyProxyLeaseSource(
    { readSimpleKey: () => 'TOKEN' },
    (options: ProxyLeaseManagerOptions) => {
      const manager = new FakeManager(options.apiToken, options.keys);
      built.push(manager);
      return manager;
    }
  );
  const controller = new AbortController();

  await source.acquire(controller.signal);

  expect(built).toHaveLength(1);
  expect(built[0].acquireSignals).toEqual([controller.signal]);
});
~~~

- [ ] **Step 4: Define one terminal outcome per accepted account**

Add the exact union:

~~~ts
type ThreadOutcome =
  | { kind: 'completed'; status: 'done'; step: string }
  | { kind: 'failed'; status: 'error'; step: string }
  | { kind: 'stopped'; status: 'stopped'; step: string };
~~~

Make `runThreadWorkload` return `Promise<ThreadOutcome>`. It must return:

~~~ts
{ kind: 'completed', status: 'done', step: thread.outcomeStep ?? 'Hoàn tất' }
~~~

only when every applicable task is verified, or for an intentional
`skipWithoutTrial` result. For a skip, first set the precise existing step
`Bỏ qua — không đủ điều kiện` on `thread.outcomeStep`.

When `result.missing.length > 0`, persist the task rows as usual, set:

~~~ts
thread.outcomeStep = 'Còn thiếu ' + result.missing.length + ' nhiệm vụ';
return {
  kind: 'failed',
  status: 'error',
  step: thread.outcomeStep
};
~~~

An incomplete fresh CapCut snapshot is a workload failure, not a completed
account. It increments `accountsFailed` exactly once while preserving all
verified per-task rows for the next run.

Return:

~~~ts
{ kind: 'failed', status: 'error', step: 'Lỗi khi làm nhiệm vụ' }
~~~

for a workload exception, and:

~~~ts
{ kind: 'stopped', status: 'stopped', step: 'Đã dừng theo yêu cầu' }
~~~

when the iteration-local abort signal is set.

Centralize persistence/counters:

~~~ts
private recordOutcome(thread: ThreadRuntime, outcome: ThreadOutcome): void {
  if (thread.outcome) return;
  thread.outcome = outcome;
  this.deps.accounts.update(thread.accountId, {
    status: outcome.status,
    automationStep: outcome.step
  });
  if (outcome.kind === 'completed') this.increment('accountsCompleted');
  if (outcome.kind === 'failed') this.increment('accountsFailed');
  if (outcome.kind === 'stopped') this.increment('accountsStopped');
}
~~~

Remove every status/automation-step write from `shutdownThread`. Cleanup may clear `browserProfileId` and log diagnostics only.

- [ ] **Step 5: Replace the fixed queue with worker loops**

Replace the acquisition-bearing `IEmailSourceApi` dependency with two narrow
contracts while keeping every other existing collaborator field unchanged:

~~~ts
export interface IEmailOtpSource {
  readOtp(purchasedEmailId: string, type?: string): Promise<string | null>;
}

export interface AutomationRunCollaborators {
  workSources: AutomationWorkSourceFactory;
  emailOtp: IEmailOtpSource;
  proxies: IProxyLeaseSource;
  browser: IBrowserRuntimeApi;
  accounts: IAccountSink;
  logBus: Pick<LogBus, 'emit'>;
  launcher?: () => BrowserLauncher | null;
  capcut?: CapcutTaskRunner;
  taskProgress?: ICapcutTaskProgressSink;
}
~~~

`buildOtpReader` must call `this.deps.emailOtp.readOtp(...)`; it must never
reach back into the work source or reservation map. Update the
`automationTaskProgress.test.ts` service factory to pass its existing OTP fake as
`emailOtp`.

Add run ownership:

~~~ts
private runAbort: AbortController | null = null;
private acquisitionAbort: AbortController | null = null;
private terminalIntent: AutomationTerminalReasonDTO | null = null;
private readonly iterationAbort = new Map<string, AbortController>();
private cleanupFailures = 0;
~~~

Add a run-local acquisition barrier. It prevents a fast first worker from
consuming a refill mailbox while another configured worker is still acquiring
its first mailbox, but it does not delay browser work after an item is acquired:

~~~ts
class InitialWaveBarrier {
  private arrived = 0;
  private open = false;
  private release: () => void = () => {};
  private readonly ready = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  constructor(private readonly target: number) {
    if (target === 0) this.openBarrier();
  }

  arrive(): void {
    if (this.open) return;
    this.arrived += 1;
    if (this.arrived >= this.target) this.openBarrier();
  }

  private openBarrier(): void {
    if (this.open) return;
    this.open = true;
    this.release();
  }

  async wait(signal: AbortSignal): Promise<void> {
    if (this.open) return;
    signal.throwIfAborted();
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.ready, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }
}
~~~

Create one barrier with `readiness.workerTarget` for continuous runs and pass it
to every worker. Each worker tracks `let firstIteration = true`. Immediately
after its first successful continuous `source.next`, call
`initialWave.arrive()` and continue launching its browser normally. After that
iteration's cleanup and before requesting a refill, call
`await initialWave.wait(acquisitionSignal)`. If the signal was aborted by a
typed terminal condition, return from the worker. This preserves the pipeline
while proving every configured slot attempted its first acquisition before any
slot consumes item `workerTarget + 1`.

Task 1 intentionally leaves canonical counters optional on the public type. Use
an internal required intersection until Task 6 completes the public cutover:

~~~ts
type RuntimeAutomationRunProgress =
  AutomationRunProgressDTO & AutomationRunCountersDTO;

export type AutomationRunSummary = RuntimeAutomationRunProgress & {
  startedProfiles: string[];
};
~~~

Type the private `progress` field and `getProgress()` return as
`RuntimeAutomationRunProgress`. Initialize it with both the six canonical
counters and the four legacy aliases. Until Task 6 removes the aliases, derive
them in `publish` so they cannot drift:

~~~ts
private publish(
  state: AutomationRunState,
  message: string,
  patch: Partial<RuntimeAutomationRunProgress> = {}
): void {
  const next: RuntimeAutomationRunProgress = {
    ...this.progress,
    ...patch,
    state,
    message
  };
  this.progress = {
    ...next,
    threadTotal: next.workerTarget,
    threadsStarted: next.accountsAccepted,
    threadsStopped:
      next.accountsCompleted + next.accountsFailed + next.accountsStopped,
    threadsFailed: next.accountsFailed
  };
  for (const listener of this.listeners) listener(this.progress);
}
~~~

`runAbort` represents an explicit whole-run Stop. `acquisitionAbort` is also
aborted for a provider/proxy block so workers waiting for proxy, purchase queue,
retry backoff, or the next work item wake up, while already-running account
workloads keep their own `iterationAbort` signal and may settle normally.

Initialize progress with all six zero counters. Use this increment helper:

~~~ts
private increment(
  key: keyof Pick<
    AutomationRunCountersDTO,
    'accountsAccepted' | 'accountsCompleted' | 'accountsFailed' | 'accountsStopped'
  >
): void {
  this.publish(this.progress.state, this.progress.message, {
    [key]: this.progress[key] + 1
  });
}
~~~

The worker loop ordering must be:

~~~ts
private async workerLoop(
  workerId: string,
  source: AutomationWorkSource,
  config: AutomationRunConfigDTO,
  slotProxy: BrowserProxySettings | undefined,
  acquisitionSignal: AbortSignal,
  initialWave: InitialWaveBarrier | null
): Promise<void> {
  let firstIteration = true;
  while (!acquisitionSignal.aborted && !this.terminalIntent) {
    let item: AutomationWorkItem | null =
      source.kind === 'finite'
        ? await source.next(workerId, acquisitionSignal)
        : null;
    if (source.kind === 'finite' && item === null) return;

    this.publish(this.progress.state, this.progress.message, {
      workersActive: this.progress.workersActive + 1
    });

    let lease: AcquiredProxyLease | undefined;
    let thread: ThreadRuntime | undefined;
    let committed = false;
    try {
      if (config.proxy.mode === 'proxykey') {
        lease = await this.deps.proxies.acquire(acquisitionSignal);
      }
      if (source.kind === 'continuous') {
        item = await source.next(workerId, acquisitionSignal);
      }
      if (!item) return;
      // A provider block aborts acquisition only and lets this acquired item
      // continue; an explicit whole-run Stop must release it before account use.
      this.runAbort?.signal.throwIfAborted();
      if (source.kind === 'continuous' && firstIteration) {
        initialWave?.arrive();
      }

      thread = this.createThreadRecord(item, config, slotProxy, lease);
      this.increment('accountsAccepted');
      const iterationSignal = this.iterationAbort.get(thread.accountId)?.signal;
      if (!iterationSignal) throw new Error('Iteration cancellation owner was lost.');
      await this.launchThread(thread, config);
      iterationSignal.throwIfAborted();
      if (item.purchasedEmailId) {
        source.commit(item, thread.accountId);
        committed = true;
      }
      const outcome = await this.runThreadWorkload(thread, config, iterationSignal);
      this.recordOutcome(thread, outcome);
    } catch (error: unknown) {
      if (thread) {
        this.recordOutcome(
          thread,
          this.runAbort?.signal.aborted === true ||
              this.iterationAbort.get(thread.accountId)?.signal.aborted === true
            ? { kind: 'stopped', status: 'stopped', step: 'Đã dừng theo yêu cầu' }
            : { kind: 'failed', status: 'error', step: 'Lỗi khi khởi chạy hoặc xử lý' }
        );
      } else if (!acquisitionSignal.aborted) {
        this.acceptTerminalError(error);
      }
    } finally {
      await this.cleanupIteration(
        source,
        item,
        committed,
        thread,
        lease
      );
      this.publish(this.progress.state, this.progress.message, {
        workersActive: Math.max(0, this.progress.workersActive - 1)
      });
    }

    if (firstIteration) {
      firstIteration = false;
      try {
        await initialWave?.wait(acquisitionSignal);
      } catch {
        if (acquisitionSignal.aborted) return;
        throw new Error('Initial acquisition barrier failed.');
      }
    }
  }
}
~~~

`createThreadRecord` creates the account row with `processing` and stores the
iteration abort controller before any fallible browser operation.
`launchThread` launches exactly one owned profile and returns only after
Playwright attach is usable. Neither method consumes the mailbox; the caller
commits only after `launchThread` succeeds and the iteration signal is checked
again. This split ensures a browser launch failure still has an accepted account
row that can end as `error`, while Stop during launch releases rather than
consumes an unused paid mailbox.

In `providerStack.ts`, perform the composition cutover atomically:

~~~ts
const workSources = createAutomationWorkSourceFactory(emailPurchaseService);
const automationRunService = new AutomationRunService({
  workSources,
  emailOtp: emailPurchaseService,
  proxies: proxySource,
  browser: new DispatchingBrowserRuntime(browserRuntimes),
  accounts: accountService,
  logBus,
  launcher: launcherFactory,
  capcut: options.userDataDir
    ? new CapcutEngineService({ userDataDir: options.userDataDir })
    : undefined,
  taskProgress: {
    record: (accountId, rows) =>
      repositories.accountTaskRepo.upsertMany(accountId, rows)
  }
});
~~~

Add the `createAutomationWorkSourceFactory` import. Update
`providerStack.test.ts` to assert both dependencies are wired.

Update every direct `new AutomationRunService(...)` constructor in
`capcutSignupPath.test.ts` and `proxyQueueIntegration.test.ts` to provide a
finite/continuous `AutomationWorkSourceFactory` fake and a separate `emailOtp`
fake. Preserve each test's existing signup, proxy ordering, and account-progress
assertions; only replace the obsolete bulk-purchase setup.

After all constructor call sites use the new dependencies, delete
`IEmailSourceApi` from `AutomationRunService.ts` and delete the transitional
`EmailPurchaseResult`, `purchase`, `markConsumed`, and `release` members from
`EmailPurchaseService.ts`. Delete assertions whose only contract is a bulk count
or partial-success array. Convert provider normalization, OTP, and reuse cases to
open one session, call `acquireOne`, then explicitly `commit` or `release` the
returned reservation. The resulting service suite covers only
`openAcquisitionSession`, `readOtp`, provider configuration, reservation
commit/release, and one-item provider normalization. Run this audit; it must
return no matches:

~~~powershell
rg -n "IEmailSourceApi|EmailPurchaseResult|this\.deps\.emails|emailPurchaseService\.purchase\(" src
~~~

- [ ] **Step 6: Enforce the initial wave without silent reduction**

Before constructing or preparing the work source, reject
`config.module !== 'credit'` and any browser for which
`isBrowserImplemented(config.browser)` is false. Map both to a sanitized
preparation-time `blocked / PROVIDER_CONFIG_ERROR`; this preserves the existing
clear unsupported-feature message and guarantees no billable source is touched.

Then, before `source.prepare` can be accepted:

~~~ts
if (config.proxy.mode === 'proxykey') {
  this.deps.proxies.configure?.({ keys: config.proxy.keys, region: config.proxy.region });
  const slots = await this.deps.proxies.availableSlots?.();
  if (slots !== null && slots !== undefined && slots < config.threadCount) {
    throw new AutomationTerminalError(
      'blocked',
      {
        code: 'PROXY_CAPACITY_UNAVAILABLE',
        provider: 'kiotproxy',
        details: { requestedWorkers: config.threadCount, availableSlots: slots }
      },
      'Không đủ proxy key cho toàn bộ số luồng đã cấu hình.'
    );
  }
}
~~~

For direct proxy entries, keep current strict parsing and, when at least one
entry is supplied, require the list to supply exactly `threadCount` slots. An
empty direct list continues to mean no proxy. A short manual email list may
naturally reduce `workerTarget` after this validation.

- [ ] **Step 7: Publish distinct completion, stop, block, and failure**

`runPrepared` launches exactly `readiness.workerTarget` workers, passes a shared
`InitialWaveBarrier` for continuous sources, and awaits all of them with
`Promise.allSettled` so one rejected worker cannot skip sibling teardown. After
settlement, feed any unexpected rejection through `acceptTerminalError`. Finish
with:

~~~ts
if (this.terminalIntent?.code === 'USER_STOP' || this.terminalIntent?.code === 'APP_SHUTDOWN') {
  this.publish('stopped', 'Phiên chạy đã dừng.', { terminalReason: this.terminalIntent });
} else if (this.terminalIntent?.code === 'INTERNAL_ERROR') {
  this.publish('failed', this.progress.message, { terminalReason: this.terminalIntent });
} else if (this.terminalIntent) {
  this.publish('blocked', this.progress.message, { terminalReason: this.terminalIntent });
} else if (source.kind === 'finite') {
  this.publish('completed', 'Đã xử lý hết danh sách email thủ công.', {
    terminalReason: { code: 'MANUAL_EXHAUSTED' }
  });
} else {
  this.publish('failed', 'Nguồn liên tục kết thúc ngoài dự kiến.', {
    terminalReason: { code: 'INTERNAL_ERROR' }
  });
}
~~~

Map provider errors as follows:

- `AUTH_ERROR` -> `blocked / PROVIDER_AUTH_REQUIRED`.
- `CONFIG_ERROR` -> `blocked / PROVIDER_CONFIG_ERROR`.
- `INSUFFICIENT_FUNDS` -> `blocked / INSUFFICIENT_FUNDS`.
- exhausted transient retry -> `blocked / PROVIDER_RETRY_EXHAUSTED`.
- unknown invariant -> `failed / INTERNAL_ERROR`.

A preparation-time terminal error is published, active run state is cleared, and `start()` rethrows it so IPC returns an error envelope instead of a `runId`.

Implement `acceptTerminalError` so the first terminal reason wins. For
`blocked`, set `terminalIntent` and abort only `acquisitionAbort`; do not abort
the iteration controllers. For `failed / INTERNAL_ERROR`, abort acquisition and
all iteration controllers because continuing account work after an internal
invariant failure is unsafe.

- [ ] **Step 8: Implement global and per-thread cancellation semantics**

Change:

~~~ts
async stop(code: 'USER_STOP' | 'APP_SHUTDOWN' = 'USER_STOP'): Promise<void>
~~~

It sets `terminalIntent`, publishes `stopping`, aborts `runAbort`, aborts every
controller in `iterationAbort`, aborts `acquisitionAbort`, closes every owned
active profile to interrupt Playwright, awaits `activeRun`, and performs
idempotent final release.

`stopThread(accountId)` aborts only that account's iteration controller and closes only that account's profile. The owning worker records `stopped`, releases its resources, then loops for the next item when the global run signal is still active.

Change `runThreadWorkload` and `holdForThread` to accept the iteration signal.
The connectivity hold must be interruptible even when the injected test sleep is
still pending:

~~~ts
private async holdForThread(
  durationMs: number,
  signal: AbortSignal
): Promise<void> {
  if (durationMs <= 0) {
    signal.throwIfAborted();
    return;
  }
  signal.throwIfAborted();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([this.sleep(durationMs), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
~~~

Use the same signal for OTP polling/backoff and any service-owned retry wait.
Do not use the global signal inside `stopThread`; otherwise one row stop would
cancel every worker.

Add `signal: AbortSignal` to `CapcutTaskRunner.runAccount` and pass
`iterationSignal` in the call from `runThreadWorkload`:

~~~ts
const result = await runner.runAccount({
  page: thread.page,
  context: thread.context,
  email: thread.email,
  password,
  accountId: thread.accountId,
  isNewAccount: thread.purchasedEmailId !== undefined,
  signal: iterationSignal,
  getOtp: this.buildOtpReader(thread, iterationSignal),
  maxRounds: Math.max(1, Math.min(1 + config.retryCount, 4)),
  pace: {
    stepMinMs: config.stepDelayMinMs,
    stepMaxMs: config.stepDelayMaxMs,
    typeMinMs: config.typeDelayMinMs,
    typeMaxMs: config.typeDelayMaxMs
  },
  skipWithoutTrial: config.skipWithoutTrial,
  log: (status, step, message) =>
    this.log(status, thread.email, step, message, thread.accountId)
});
~~~

Change `buildOtpReader(thread, signal)` so it calls `signal.throwIfAborted()`
before every provider read and replaces its 5-second sleep with the same
abort-aware wait helper used by `holdForThread`. Update every CapCut runner fake
in focused tests to accept the new required input field, and add
`signal: new AbortController().signal` to direct `CapcutEngineService.runAccount`
test inputs in Task 7.

Make profile teardown idempotent by clearing ownership before awaiting the
external stop call. Both `stopThread`, global `stop`, and worker `finally` must
use this helper:

~~~ts
private async closeOwnedProfile(thread: ThreadRuntime): Promise<boolean> {
  const profileId = thread.profileId;
  if (!profileId) return false;
  thread.profileId = undefined;
  this.activeThreads.delete(thread.accountId);
  try {
    if (thread.launcher) await thread.launcher.stop(profileId);
    else await this.deps.browser.stopProfile(profileId);
    return true;
  } catch {
    this.log(
      'WARNING',
      thread.email,
      'Browser',
      'Không dừng được browser profile trong lúc thu hồi tài nguyên.',
      thread.accountId
    );
    return false;
  }
}
~~~

Delete each account's controller from `iterationAbort` in the owning worker's
`finally`. Never let cleanup record a second outcome or release another worker's
profile, proxy, or mailbox.

Wrap browser stop, proxy release, and mailbox release independently so one
cleanup failure does not skip the remaining owners. Increment `cleanupFailures`
once per failed cleanup operation and log only a static sanitized resource name.
When publishing any terminal reason, merge
`details: { ...(reason.details ?? {}), cleanupFailures }` if the count is greater
than zero. A cleanup failure never changes an already-recorded account outcome
or increments `accountsFailed`.

Use this cleanup structure from the worker `finally`; `shutdownThread` must no
longer release the proxy or persist an account status:

~~~ts
private noteCleanupFailure(
  thread: ThreadRuntime | undefined,
  resource: 'browser-profile' | 'proxy-lease' | 'mailbox-reservation'
): void {
  this.cleanupFailures += 1;
  this.log(
    'WARNING',
    thread?.email ?? 'system',
    'Cleanup',
    'Không thu hồi được tài nguyên: ' + resource + '.',
    thread?.accountId
  );
}

private async cleanupIteration(
  source: AutomationWorkSource,
  item: AutomationWorkItem | null,
  committed: boolean,
  thread: ThreadRuntime | undefined,
  lease: AcquiredProxyLease | undefined
): Promise<void> {
  if (item && !committed) {
    try {
      source.release(item);
    } catch {
      this.noteCleanupFailure(thread, 'mailbox-reservation');
    }
  }

  if (thread) {
    const hadProfile = thread.profileId !== undefined;
    const stopped = await this.closeOwnedProfile(thread);
    if (hadProfile && !stopped) {
      this.noteCleanupFailure(thread, 'browser-profile');
    }
    this.iterationAbort.delete(thread.accountId);
  }

  if (lease) {
    try {
      await this.deps.proxies.release(lease);
    } catch {
      this.noteCleanupFailure(thread, 'proxy-lease');
    }
  }
}
~~~

The worker `finally` calls this helper once, then decrements `workersActive`.
Global finalization may call `releaseAll()` as an idempotent safety net, wrapped
in the same static diagnostic policy; it must not record another account outcome.

- [ ] **Step 9: Run worker, proxy, and task-progress tests**

Run:

~~~powershell
npx vitest run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/EmailPurchaseService.test.ts src/main/services/__tests__/ProxyLeaseManager.test.ts src/main/services/__tests__/LazyProxyLeaseSource.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/capcutSignupPath.test.ts src/main/services/__tests__/proxyQueueIntegration.test.ts src/main/runtime/__tests__/providerStack.test.ts
npm run typecheck
~~~

Expected: all focused tests PASS; no continuous-run test resolves before a terminal condition.

- [ ] **Step 10: Commit when commit authorization exists**

~~~powershell
git add src/main/services/AutomationRunService.ts src/main/services/EmailPurchaseService.ts src/main/services/ProxyLeaseManager.ts src/main/services/LazyProxyLeaseSource.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/EmailPurchaseService.test.ts src/main/services/__tests__/ProxyLeaseManager.test.ts src/main/services/__tests__/LazyProxyLeaseSource.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/capcutSignupPath.test.ts src/main/services/__tests__/proxyQueueIntegration.test.ts src/main/runtime/providerStack.ts src/main/runtime/__tests__/providerStack.test.ts
git commit -m "feat: run continuous cancellable worker slots"
~~~

---

### Task 6: Coordinate Typed IPC, Preload, Dashboard State, Counters, And Copy

**Files:**

- Modify: `src/shared/schemas/automation.schema.ts`
- Modify: `src/shared/schemas/__tests__/automation.schema.test.ts`
- Modify: `src/shared/contracts/api.ts`
- Modify: `src/shared/contracts/__tests__/contracts.test.ts`
- Modify: `src/main/ipc/automationIpc.ts`
- Modify: `src/main/ipc/ipcResult.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/__tests__/AutomationRunService.test.ts`
- Modify: `src/main/services/__tests__/automationTaskProgress.test.ts`
- Modify: `src/main/services/__tests__/proxyQueueIntegration.test.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/preload/__tests__/preload.test.ts`
- Modify: `src/main/ipc/__tests__/runtimeIpc.test.ts`
- Modify: `src/renderer/components/ui/Badge.tsx`
- Modify: `src/renderer/pages/Dashboard/dashboardController.ts`
- Modify: `src/renderer/pages/Dashboard/DashboardPage.tsx`
- Modify: `src/renderer/pages/Dashboard/DashboardActionBar.tsx`
- Modify: `src/renderer/pages/Dashboard/AutomationConfigGrid.tsx`
- Modify: `src/renderer/pages/Dashboard/columns.tsx`
- Modify: `src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts`
- Create: `src/renderer/pages/Dashboard/__tests__/dashboardRendering.test.tsx`

**Interfaces:**

- Consumes: Task 1 `AutomationRunProgressDTO` and account `stopped`.
- Preserves: existing `run.start/stop/stopThread/threads/progress/onProgress` method names.
- Produces: Dashboard rendering for all run terminal states and separate concurrency/outcome counters.

- [ ] **Step 1: Make every bridge/controller fixture use the new progress DTO**

Use this canonical idle fixture in preload, IPC, controller, and page tests:

~~~ts
const IDLE: AutomationRunProgressDTO = {
  runId: 'none',
  state: 'idle',
  workerTarget: 0,
  workersActive: 0,
  accountsAccepted: 0,
  accountsCompleted: 0,
  accountsFailed: 0,
  accountsStopped: 0,
  message: 'Chưa chạy'
};
~~~

Add controller tests:

~~~ts
it.each(['completed', 'stopped', 'blocked', 'failed'] as const)(
  'treats %s as terminal',
  (state) => {
    bridge.pushProgress({ ...IDLE, state, message: state });
    expect(controller.isRunning()).toBe(false);
  }
);

it('surfaces a blocked reason and keeps safe capacity details', () => {
  bridge.pushProgress({
    ...IDLE,
    state: 'blocked',
    message: 'Số dư Gmail94 không đủ cho 3 luồng.',
    terminalReason: {
      code: 'INSUFFICIENT_FUNDS',
      provider: 'gmail94',
      details: {
        requestedWorkers: 3,
        reusableCount: 1,
        balance: 1000,
        unitPrice: 1000,
        affordablePurchaseCount: 1
      }
    }
  });

  expect(controller.getState().error).toContain('Số dư Gmail94');
  expect(controller.getState().progress.terminalReason?.details?.balance).toBe(1000);
});
~~~

Create `dashboardRendering.test.tsx` to lock the stopped badge and the six
counter props without adding a browser test dependency:

~~~tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Badge } from '../../../components/ui/Badge';
import { DashboardActionBar } from '../DashboardActionBar';
import { accountStatusBadgeVariant } from '../columns';

describe('Dashboard continuous-run rendering', () => {
  it('maps a stopped account to the neutral stopped badge', () => {
    expect(accountStatusBadgeVariant('stopped')).toBe('stopped');
    const html = renderToStaticMarkup(<Badge variant="stopped" />);
    expect(html).toContain('Đã dừng');
  });

  it('renders concurrency separately from every cumulative outcome counter', () => {
    const html = renderToStaticMarkup(
      <DashboardActionBar
        workerTarget={3}
        workersActive={2}
        accountsAccepted={7}
        accountsCompleted={4}
        accountsFailed={2}
        accountsStopped={1}
      />
    );

    expect(html).toContain('2/3 luồng đang hoạt động');
    expect(html).toContain('7 đã nhận');
    expect(html).toContain('4 xong');
    expect(html).toContain('2 lỗi');
    expect(html).toContain('1 dừng');
  });

  it.each([
    ['completed', 'Hoàn tất'],
    ['stopped', 'Đã dừng'],
    ['blocked', 'Bị chặn'],
    ['failed', 'Thất bại']
  ] as const)('renders terminal state %s distinctly', (runState, label) => {
    const html = renderToStaticMarkup(
      <DashboardActionBar
        runState={runState}
        runMessage={'message-' + runState}
      />
    );

    expect(html).toContain(label);
    expect(html).toContain('message-' + runState);
  });

  it('renders only approved safe Gmail94 capacity details', () => {
    const html = renderToStaticMarkup(
      <DashboardActionBar
        runState="blocked"
        runMessage="Số dư Gmail94 không đủ."
        terminalReason={{
          code: 'INSUFFICIENT_FUNDS',
          provider: 'gmail94',
          details: {
            requestedWorkers: 3,
            reusableCount: 1,
            balance: 1000,
            unitPrice: 1000,
            affordablePurchaseCount: 1,
            checkedAt: '2026-09-05T00:00:00.000Z'
          }
        }}
      />
    );

    expect(html).toContain('Yêu cầu 3 luồng');
    expect(html).toContain('tái sử dụng 1');
    expect(html).toContain('số dư 1000');
    expect(html).toContain('giá 1000');
    expect(html).toContain('mua được 1');
    expect(html).toContain('2026-09-05T00:00:00.000Z');
  });
});
~~~

Export this narrow mapping helper from `columns.tsx` and use it in the status
cell:

~~~ts
import { Badge, type BadgeVariant } from '@renderer/components/ui/Badge';

export function accountStatusBadgeVariant(
  status: AccountListItemDTO['status']
): BadgeVariant {
  return STATUS_TO_BADGE[status] ?? 'info';
}
~~~

- [ ] **Step 2: Run focused IPC/preload/renderer tests and verify RED**

Run:

~~~powershell
npx vitest run src/main/ipc/__tests__/runtimeIpc.test.ts src/preload/__tests__/preload.test.ts src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts
~~~

Expected: FAIL on old progress properties and missing terminal rendering.

- [ ] **Step 3: Keep IPC narrow and update only typed payloads**

First complete the public DTO cutover from Task 1. Replace the transitional
progress shape with:

~~~ts
export const AutomationRunProgressSchema = z.object({
  runId: z.string().min(1),
  state: AutomationRunStateEnum,
  ...AutomationRunCountersSchema.shape,
  message: z.string(),
  terminalReason: AutomationTerminalReasonSchema.optional()
}).strict();
export type AutomationRunProgressDTO = z.infer<typeof AutomationRunProgressSchema>;
~~~

In `AutomationRunService`, delete `RuntimeAutomationRunProgress`, restore
`AutomationRunSummary` as `AutomationRunProgressDTO & { startedProfiles:
string[] }`, type `progress` and `getProgress()` directly as
`AutomationRunProgressDTO`, and remove the four alias assignments from
`publish`. Replace every remaining test/UI fixture and assertion with the six
canonical fields. This command must return no matches before continuing:

~~~powershell
rg -n "threadTotal|threadsStarted|threadsStopped|threadsFailed" src
~~~

No new generic channel is needed. `IpcContractRegistry.run.progress.response` remains `AutomationRunProgressSchema`; `ElectronBridge` remains typed with `AutomationRunProgressDTO`. Update imports/fixtures and ensure `registerAutomationIpc` returns `AutomationTerminalError` through the existing `toErrorEnvelope` path.

Import `AutomationTerminalError` in `runtimeIpc.test.ts` and add this complete
preparation-time blocked-start case:

~~~ts
it('returns safe typed details when run preparation is blocked', async () => {
  registerAutomationIpc(
    registrar,
    runService({
      start: async () => {
        throw new AutomationTerminalError(
          'blocked',
          {
            code: 'INSUFFICIENT_FUNDS',
            provider: 'gmail94',
            details: {
              requestedWorkers: 3,
              reusableCount: 1,
              balance: 1000,
              unitPrice: 1000,
              affordablePurchaseCount: 1
            }
          },
          'Số dư Gmail94 không đủ cho toàn bộ số luồng ban đầu.'
        );
      }
    }) as never,
    emailService() as never
  );

  const envelope = await registrar.invoke(IPC_CHANNELS.RUN_START, {
    ...validConfig,
    threadCount: 3
  });

  expect(envelope).toEqual({
    success: false,
    error: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'Số dư Gmail94 không đủ cho toàn bộ số luồng ban đầu.',
      details: {
        provider: 'gmail94',
        requestedWorkers: 3,
        reusableCount: 1,
        balance: 1000,
        unitPrice: 1000,
        affordablePurchaseCount: 1
      }
    }
  });
});
~~~

Update `toErrorEnvelope` with an explicit branch:

~~~ts
if (err instanceof AutomationTerminalError) {
  const details = {
    ...(err.reason.provider ? { provider: err.reason.provider } : {}),
    ...(err.reason.details ?? {})
  };
  return {
    success: false,
    error: {
      code: err.reason.code,
      message: err.message,
      ...(Object.keys(details).length > 0 ? { details } : {})
    }
  };
}
~~~

Keep the existing `ProviderError` branch after it. Never copy stack, raw
response, or secrets.

- [ ] **Step 4: Render active and terminal states honestly**

Keep:

~~~ts
const ACTIVE_STATES = new Set<AutomationRunProgressDTO['state']>([
  'preparing',
  'running',
  'stopping'
]);
~~~

In the progress listener, surface both `blocked` and `failed`:

~~~ts
const terminalError =
  progress.state === 'blocked' || progress.state === 'failed'
    ? progress.message
    : this.state.error;
this.setState({ progress, error: terminalError });
~~~

Add `stopped` to the account filter and status badge mappings. Add a `stopped` Badge variant using the existing neutral surface colors and a square/stop icon; do not redesign the grid.

Add `'stopped'` to `BadgeVariant`. Use this exact Badge entry (add `Square` to
the existing `lucide-react` import):

~~~tsx
stopped: {
  text: 'Đã dừng',
  bg: 'bg-surface-variant/40',
  border: 'border-outline/40',
  textColor: 'text-on-surface-variant',
  icon: <Square className="w-3 h-3" />
},
~~~

Type `STATUS_TO_BADGE` as `Record<AccountListItemDTO['status'], BadgeVariant>`
and add `stopped: 'stopped'`.

In `DashboardActionBar.tsx`, import `AutomationRunState` and
`AutomationTerminalReasonDTO`. Add these exact helpers:

~~~ts
const RUN_STATE_LABEL: Record<AutomationRunState, string> = {
  idle: 'Chưa chạy',
  preparing: 'Đang chuẩn bị',
  running: 'Đang chạy',
  stopping: 'Đang dừng',
  completed: 'Hoàn tất',
  stopped: 'Đã dừng',
  blocked: 'Bị chặn',
  failed: 'Thất bại'
};

export function formatCapacityDetails(
  reason: AutomationTerminalReasonDTO | undefined
): string | null {
  if (reason?.code !== 'INSUFFICIENT_FUNDS' || !reason.details) return null;
  const details = reason.details;
  const values = [
    ['requestedWorkers', 'Yêu cầu ', ' luồng'],
    ['reusableCount', 'tái sử dụng ', ''],
    ['balance', 'số dư ', ''],
    ['unitPrice', 'giá ', ''],
    ['affordablePurchaseCount', 'mua được ', ''],
    ['checkedAt', 'kiểm tra lúc ', '']
  ] as const;
  const parts = values.flatMap(([key, prefix, suffix]) =>
    details[key] === undefined
      ? []
      : [prefix + String(details[key]) + suffix]
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}
~~~

Extend the props with `runState?: AutomationRunState`, `runMessage?: string`,
and `terminalReason?: AutomationTerminalReasonDTO`. Render the state label and
message in the existing summary area, followed by the capacity string when it
is non-null. Pass all three values directly from `state.progress` in
`DashboardPage.tsx`. Do not stringify arbitrary terminal details; the allowlist
above is the only renderer for capacity metadata.

- [ ] **Step 5: Show concurrency separately from cumulative outcomes**

Extend `DashboardActionBarProps`:

~~~ts
workerTarget?: number;
workersActive?: number;
accountsAccepted?: number;
accountsCompleted?: number;
accountsFailed?: number;
accountsStopped?: number;
~~~

Render compact labels with existing typography:

~~~tsx
<span>{workersActive}/{workerTarget} luồng đang hoạt động</span>
<span>{accountsAccepted} đã nhận</span>
<span className="text-success">{accountsCompleted} xong</span>
<span className="text-error">{accountsFailed} lỗi</span>
<span className="text-on-surface-variant">{accountsStopped} dừng</span>
~~~

Pass the six values directly from `state.progress`. Do not infer any value from open browser rows.

- [ ] **Step 6: Replace misleading email-source copy**

Use these exact strings:

~~~tsx
// custom
'Duy trì tối đa ' + config.threadCount +
  ' luồng; mỗi luồng tự sinh địa chỉ mới khi sẵn sàng.'

// API
'Duy trì tối đa ' + config.threadCount +
  ' luồng; chỉ lấy 1 email khi một luồng đã có proxy và sẵn sàng.'

// manual
'Xử lý mọi dòng hợp lệ, tối đa ' + config.threadCount + ' dòng cùng lúc.'
~~~

Keep the existing domain, masked key, and sender-filter displays. Do not expose capacity balance in the config panel; it belongs to run progress/error details after safe preflight.

- [ ] **Step 7: Run coordinated contract/UI tests**

Run:

~~~powershell
npx vitest run src/shared/schemas/__tests__/automation.schema.test.ts src/shared/contracts/__tests__/contracts.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/proxyQueueIntegration.test.ts src/main/ipc/__tests__/runtimeIpc.test.ts src/preload/__tests__/preload.test.ts src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/renderer/pages/Dashboard/__tests__/dashboardRendering.test.tsx
npm run typecheck
~~~

Expected: all focused tests PASS; preload still exposes no unrestricted `ipcRenderer`.

- [ ] **Step 8: Commit when commit authorization exists**

~~~powershell
git add src/shared/schemas/automation.schema.ts src/shared/schemas/__tests__/automation.schema.test.ts src/shared/contracts/api.ts src/main/ipc/automationIpc.ts src/main/ipc/ipcResult.ts src/main/services/AutomationRunService.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/proxyQueueIntegration.test.ts src/preload/preload.ts src/preload/__tests__/preload.test.ts src/main/ipc/__tests__/runtimeIpc.test.ts src/renderer/components/ui/Badge.tsx src/renderer/pages/Dashboard/dashboardController.ts src/renderer/pages/Dashboard/DashboardPage.tsx src/renderer/pages/Dashboard/DashboardActionBar.tsx src/renderer/pages/Dashboard/AutomationConfigGrid.tsx src/renderer/pages/Dashboard/columns.tsx src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/renderer/pages/Dashboard/__tests__/dashboardRendering.test.tsx
git commit -m "feat: show honest continuous run progress"
~~~

---

### Task 7: Unify CapCut Proof And Snapshot Reconciliation Under One Deadline

**Files:**

- Modify: `src/main/services/capcut/types.ts`
- Modify: `src/main/services/capcut/missionRunner.ts`
- Modify: `src/main/services/capcut/runTasks.ts`
- Modify: `src/main/services/capcut/missions/simple.ts`
- Modify: `src/main/services/capcut/__tests__/missionRunner.test.ts`
- Modify: `src/main/services/capcut/__tests__/simple.test.ts`
- Modify: `src/main/services/capcut/__tests__/taskApi.test.ts`
- Create: `src/main/services/capcut/__tests__/runTasks.test.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/__tests__/CapcutEngineService.test.ts`

**Interfaces:**

- Produces: `MissionEvidence`, `MissionGroupResult`, and
  `reconcileMissionEvidence(group: MissionGroup, env: CapcutMissionEnv, store: TaskStore, need: Set<string>): Promise<MissionGroupResult>`.
- Changes: `runGroup(group: MissionGroup, env: CapcutMissionEnv, store: TaskStore, need: Set<string>): Promise<MissionGroupResult>`.
- Changes: `selectGroups(snapshot, groups, proofBacked?)`.
- Preserves: success requires matching `do_action.errNo === 0` plus refreshed `task_status === 4`.
- Produces: per-run proof memory consumed by Tasks 8-9.

- [ ] **Step 1: Add red fake-timer tests for one deadline and no replay**

Update the test imports before adding the cases:

~~~ts
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileMissionEvidence,
  selectGroups
} from '../missionRunner';
import { parseTaskList, TaskStore } from '../taskApi';
import type {
  CapcutMissionEnv,
  MissionGroup
} from '../types';
~~~

Keep the existing `SNAP` and `install` fixtures. Add a minimal environment that
is valid for the pure reconciler without constructing a browser:

~~~ts
const PWA_DONE_JSON = fs.readFileSync(
  'tools/fixtures/task-list-done.json',
  'utf8'
);
const ENV = {
  page: {} as CapcutMissionEnv['page'],
  context: {} as CapcutMissionEnv['context'],
  sampleImage: 'C:/tmp/sample.png',
  log: () => {},
  signal: new AbortController().signal
} satisfies CapcutMissionEnv;

afterEach(() => {
  vi.useRealTimers();
});

it('consumes a PWA proof captured during act without a second 45 second wait', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const group: MissionGroup = {
    name: 'PWA',
    keys: ['capcut_web_pwa_install'],
    proofTimeoutMs: 12_000,
    act: async () => {
      store.pushAction({
        actionKey: 'capcut_web_pwa_install',
        opId: 'op-1',
        errNo: 0,
        errTips: '',
        at: Date.now()
      });
    }
  };

  const resultPromise = reconcileMissionEvidence(
    group,
    ENV,
    store,
    new Set(group.keys)
  );
  store.pushTaskList(PWA_DONE_JSON, Date.now() + 1);
  const result = await resultPromise;

  expect(result.evidence.get('capcut_web_pwa_install')).toMatchObject({
    state: 'verified',
    snapshotStatus: 4,
    proof: { opId: 'op-1', errNo: 0 }
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('shares one 12 second budget when the confirming snapshot never arrives', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const group: MissionGroup = {
    name: 'PWA',
    keys: ['capcut_web_pwa_install'],
    proofTimeoutMs: 12_000,
    act: async () => {}
  };
  const startedAt = Date.now();
  const resultPromise = reconcileMissionEvidence(
    group,
    ENV,
    store,
    new Set(group.keys)
  );
  store.pushAction({
    actionKey: 'capcut_web_pwa_install',
    opId: 'op-2',
    errNo: 0,
    errTips: '',
    at: Date.now()
  });

  await vi.advanceTimersByTimeAsync(12_000);
  const result = await resultPromise;

  expect(result.evidence.get('capcut_web_pwa_install')).toMatchObject({
    state: 'proved-awaiting-snapshot',
    proof: { opId: 'op-2', errNo: 0 }
  });
  expect(Date.now() - startedAt).toBe(12_000);
  expect(vi.getTimerCount()).toBe(0);
});

it('excludes a proof-backed task from later group selection despite a stale snapshot', () => {
  const proofBacked = new Set(['capcut_web_pwa_install']);
  expect(selectGroups(SNAP, [install], proofBacked)).toEqual([]);
});
~~~

In `taskApi.test.ts`, add `vi` to the Vitest import and add cancellation tests
that fail immediately under the old timer-only store:

~~~ts
it('cancels an action wait without spending its timeout', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const controller = new AbortController();
  let rejection = '';
  void store.waitForAction('k-stop', 60_000, 0, controller.signal)
    .catch((error: unknown) => { rejection = (error as Error).message; });

  controller.abort(new Error('stop requested'));
  await Promise.resolve();

  expect(rejection).toBe('stop requested');
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it('cancels a snapshot wait without spending its timeout', async () => {
  vi.useFakeTimers();
  const store = new TaskStore();
  const controller = new AbortController();
  let rejection = '';
  void store.waitForSnapshot(0, 60_000, controller.signal)
    .catch((error: unknown) => { rejection = (error as Error).message; });

  controller.abort(new Error('stop requested'));
  await Promise.resolve();

  expect(rejection).toBe('stop requested');
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
~~~

Export a narrow test seam from `runTasks.ts` so orchestration tests can inject
only the group under test while production still uses `GROUPS`:

~~~ts
export interface RunTasksInput {
  page: Page;
  context: BrowserContext;
  sampleImage: string;
  log: (msg: string) => void;
  signal: AbortSignal;
  maxRounds?: number;
  pace?: CapcutPace;
  groups?: MissionGroup[];
}

const groups = input.groups ?? GROUPS;
~~~

Replace each orchestration use of `GROUPS` with the local `groups`. Create
`runTasks.test.ts` with an initial snapshot injected through the public
`attachTaskMonitor` boundary and a mocked group result that contains successful
proof but no refreshed snapshot:

~~~ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';

import type { CapcutMissionEnv, MissionGroup } from '../types';

vi.mock('../diag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diag')>();
  return { ...actual, attachNetDiag: vi.fn() };
});

vi.mock('../taskApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../taskApi')>();
  const fs = await import('node:fs');
  const initialJson = fs.readFileSync(
    'tools/fixtures/task-list-initial.json',
    'utf8'
  );
  return {
    ...actual,
    attachTaskMonitor: (
      _context: BrowserContext,
      store: InstanceType<typeof actual.TaskStore>
    ) => {
      store.pushTaskList(initialJson, 100);
    }
  };
});

vi.mock('../missionRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../missionRunner')>();
  return {
    ...actual,
    claimIfPending: vi.fn(async () => false),
    closeTaskPopover: vi.fn(async () => true),
    findTaskEntry: vi.fn(async () => null),
    withTaskPopover: vi.fn(async (_page: Page, fn: () => Promise<unknown>) => fn()),
    runGroup: vi.fn(async (
      group: MissionGroup,
      env: CapcutMissionEnv,
      _store: unknown,
      need: Set<string>
    ) => {
      await group.act(env, need);
      return {
        evidence: new Map([...need].map((key) => [
          key,
          {
            key,
            state: 'proved-awaiting-snapshot' as const,
            proof: {
              actionKey: key,
              opId: key + '_op',
              errNo: 0,
              errTips: '',
              at: 101
            }
          }
        ])),
        snapshot: null,
        actionSettledAt: 101
      };
    })
  };
});

const { runAllTasks } = await import('../runTasks');
const {
  FINAL_SNAPSHOT_WAIT_MS,
  INTER_ROUND_WAIT_MS
} = await import('../runTasks');

afterEach(() => {
  vi.useRealTimers();
});

it('keeps the approved inter-round and final snapshot caps', () => {
  expect(INTER_ROUND_WAIT_MS).toBe(8_000);
  expect(FINAL_SNAPSHOT_WAIT_MS).toBe(10_000);
});

it('runs a proof-backed PWA action once even when later snapshots stay stale', async () => {
  vi.useFakeTimers();
  const pwaAct = vi.fn(async (_env: CapcutMissionEnv, _need: Set<string>) => {});
  const group: MissionGroup = {
    name: 'PWA',
    keys: ['capcut_web_pwa_install'],
    proofTimeoutMs: 12_000,
    act: pwaAct
  };
  const page = {
    goto: vi.fn(async () => null),
    reload: vi.fn(async () => null),
    waitForTimeout: vi.fn(async () => {}),
    isClosed: vi.fn(() => false)
  } as unknown as Page;
  const context = {} as BrowserContext;

  const run = runAllTasks({
    page,
    context,
    sampleImage: 'C:/tmp/sample.png',
    log: () => {},
    signal: new AbortController().signal,
    maxRounds: 2,
    groups: [group]
  });
  await vi.runAllTimersAsync();
  const result = await run;

  expect(pwaAct).toHaveBeenCalledTimes(1);
  expect(result.outcomes.find(
    (row) => row.key === 'capcut_web_pwa_install'
  )?.proof?.errNo).toBe(0);
});
~~~

This test does not weaken the separate `TaskStore`/`reconcileMissionEvidence`
tests: it checks only the `runAllTasks` proof-memory wiring. Unit tests must not
wait in real time.

- [ ] **Step 2: Run the focused CapCut tests and verify RED**

Run:

~~~powershell
npx vitest run src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/capcut/__tests__/simple.test.ts src/main/services/capcut/__tests__/taskApi.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/__tests__/CapcutEngineService.test.ts
~~~

Expected: FAIL because `runGroup` returns only proof/error values, `runAllTasks` starts an independent 45-second snapshot wait, and `selectGroups` has no proof memory.

- [ ] **Step 3: Define evidence states without letting missions claim completion**

Add to `missionRunner.ts`:

~~~ts
export interface MissionEvidence {
  key: string;
  proof?: ActionProof;
  snapshotStatus?: number;
  state: 'verified' | 'proved-awaiting-snapshot' | 'failed';
  error?: Error;
}

export interface MissionGroupResult {
  evidence: Map<string, MissionEvidence>;
  snapshot: TaskSnapshot | null;
  actionSettledAt: number;
}
~~~

Add the iteration signal to the engine contract in `types.ts`:

~~~ts
export interface CapcutMissionEnv {
  page: Page;
  context: BrowserContext;
  sampleImage: string;
  log: (msg: string) => void;
  signal: AbortSignal;
  pace?: CapcutPace;
}
~~~

`CapcutEngineService.runAccount` receives the Task 5 signal and passes it to
`runAllTasks`; `bootstrap` copies it into `CapcutMissionEnv`. Update every
test fixture that directly creates either input. In the existing
`CapcutEngineService.test.ts` helper, the base object becomes:

~~~ts
return {
  page: listeningPage().page,
  context: {} as unknown as BrowserContext,
  email: 'mail1@gmail.com',
  password: 'Str0ngPass',
  accountId: 'acc-1',
  isNewAccount: false,
  signal: new AbortController().signal,
  log: () => {},
  ...overrides
} as Parameters<InstanceType<typeof CapcutEngineService>['runAccount']>[0];
~~~

Extend `TaskStore` with cancellable waits. Replace both wait methods with the
same ownership pattern shown here; the snapshot method uses `snapWaiters` and
the message it already has:

~~~ts
waitForAction(
  actionKey: string,
  timeoutMs: number,
  sinceMs: number,
  signal?: AbortSignal
): Promise<ActionProof> {
  signal?.throwIfAborted();
  const already = this.actions.find(
    (action) => action.actionKey === actionKey && action.at >= sinceMs
  );
  if (already) return Promise.resolve(already);

  return new Promise<ActionProof>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    let waiter: ActionWaiter;
    const cleanup = (): void => {
      this.actionWaiters.delete(waiter);
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error('Aborted'));
    };
    waiter = {
      actionKey,
      sinceMs,
      resolve: (proof) => {
        cleanup();
        resolve(proof);
      }
    };
    this.actionWaiters.add(waiter);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        'không thấy do_action "' + actionKey + '" sau ' + timeoutMs + 'ms'
      ));
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

waitForSnapshot(
  afterMs: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<TaskSnapshot> {
  signal?.throwIfAborted();
  if (this.snap && this.snap.at > afterMs) return Promise.resolve(this.snap);

  return new Promise<TaskSnapshot>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    let waiter: SnapWaiter;
    const cleanup = (): void => {
      this.snapWaiters.delete(waiter);
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error('Aborted'));
    };
    waiter = {
      afterMs,
      resolve: (snapshot) => {
        cleanup();
        resolve(snapshot);
      }
    };
    this.snapWaiters.add(waiter);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        'không nhận được task_list mới sau ' + timeoutMs + 'ms'
      ));
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
~~~

Extend selection:

~~~ts
export function selectGroups(
  snap: TaskSnapshot,
  groups: MissionGroup[],
  proofBacked: ReadonlySet<string> = new Set()
): Array<{ group: MissionGroup; need: Set<string> }> {
  const out: Array<{ group: MissionGroup; need: Set<string> }> = [];
  for (const group of groups) {
    const need = new Set(
      group.keys.filter((key) => {
        const task = snap.byKey.get(key);
        return task !== undefined && task.status !== 4 && !proofBacked.has(key);
      })
    );
    if (need.size > 0) out.push({ group, need });
  }
  return out;
}
~~~

- [ ] **Step 4: Make the pure reconciler spend one remaining-time budget**

Implement `reconcileMissionEvidence` with this control flow:

~~~ts
const actionStartedAt = Date.now();
let actError: Error | null = null;
try {
  await group.act(env, need);
} catch (error: unknown) {
  env.signal.throwIfAborted();
  actError = error instanceof Error ? error : new Error(String(error));
}

const actionSettledAt = Date.now();
const budgetMs = actError ? Math.min(3000, group.proofTimeoutMs) : group.proofTimeoutMs;
const deadlineAt = actionSettledAt + budgetMs;
const remaining = (): number => Math.max(0, deadlineAt - Date.now());

const proofEntries = await Promise.all([...need].map(async (key) => {
  try {
    const proof = await store.waitForAction(
      key,
      remaining(),
      actionStartedAt,
      env.signal
    );
    return [key, proof] as const;
  } catch (error: unknown) {
    env.signal.throwIfAborted();
    return [key, error instanceof Error ? error : new Error(String(error))] as const;
  }
}));

const snapshot = remaining() > 0
  ? await store.waitForSnapshot(
      actionSettledAt,
      remaining(),
      env.signal
    ).catch(() => {
      env.signal.throwIfAborted();
      return null;
    })
  : null;

const evidence = new Map<string, MissionEvidence>();
for (const [key, value] of proofEntries) {
  if (value instanceof Error) {
    evidence.set(key, { key, state: 'failed', error: actError ?? value });
    continue;
  }
  if (value.errNo !== 0) {
    evidence.set(key, {
      key,
      proof: value,
      state: 'failed',
      error: new Error(('do_action err_no=' + value.errNo + ' ' + value.errTips).trim())
    });
    continue;
  }

  const snapshotStatus = snapshot?.byKey.get(key)?.status;
  evidence.set(key, {
    key,
    proof: value,
    snapshotStatus,
    state: snapshotStatus === 4 ? 'verified' : 'proved-awaiting-snapshot'
  });
}

return { evidence, snapshot, actionSettledAt };
~~~

The total post-action time cannot exceed `budgetMs` because snapshot waiting receives only `remaining()`. Do not start a fresh timeout after proof.

Keep `runGroup` as the only public success gate:

~~~ts
export async function runGroup(
  group: MissionGroup,
  env: CapcutMissionEnv,
  store: TaskStore,
  need: Set<string>
): Promise<MissionGroupResult> {
  await ensurePageUsable(env.page, env.log);
  await assertNoPopover(env.page, env.log);
  return reconcileMissionEvidence(group, env, store, need);
}
~~~

- [ ] **Step 5: Retain proof memory and remove duplicate waits**

In `runAllTasks`:

~~~ts
const proofBacked = new Set<string>();
~~~

Select with `selectGroups(snap, groups, proofBacked)`. For every group:

~~~ts
const result = await runGroup(group, env, store, need);
if (result.snapshot) snap = result.snapshot;

for (const [key, evidence] of result.evidence) {
  const outcome = outcomes.get(key);
  if (!outcome) continue;
  outcome.attempts += 1;

  if (evidence.proof?.errNo === 0) {
    proofBacked.add(key);
    outcome.proof = evidence.proof;
  }
  if (evidence.state === 'verified') {
    outcome.done = true;
    outcome.error = undefined;
  } else if (evidence.state === 'proved-awaiting-snapshot') {
    outcome.done = false;
    outcome.error = 'Đã có do_action nhưng chưa nhận được task_status=4 mới.';
  } else {
    outcome.done = false;
    outcome.error = evidence.error?.message ?? 'Không xác minh được nhiệm vụ.';
  }
}
~~~

Delete the per-group `waitForSnapshot(mark, 45000)`. A fresh snapshot that reports an incomplete status keeps `done = false`, but `proofBacked` still prevents another UI action in the same run.

- [ ] **Step 6: Cap inter-round and final waits**

Export and use exact constants:

~~~ts
export const INTER_ROUND_WAIT_MS = 8_000;
export const FINAL_SNAPSHOT_WAIT_MS = 10_000;
~~~

Replace the blind 18-22 second sleep and 45-second snapshot wait with:

~~~ts
if (attempt < rounds && selectGroups(snap, groups, proofBacked).length > 0) {
  log('Còn nhiệm vụ chưa xác minh — chờ tối đa 8s cho task_list mới');
  await paceGap('trước lượt quét sau');
  snap = await store.waitForSnapshot(
    snap.at,
    INTER_ROUND_WAIT_MS,
    input.signal
  ).catch(() => {
    input.signal.throwIfAborted();
    return snap;
  });
}
~~~

Replace the final 25-second wait with:

~~~ts
const final = await store.waitForSnapshot(
  snap.at,
  FINAL_SNAPSHOT_WAIT_MS,
  input.signal
).catch(() => {
  input.signal.throwIfAborted();
  stale = true;
  log('Không đọc lại được task_list ở bước chốt — dùng snapshot gần nhất');
  return store.snapshot() ?? snap;
});
~~~

Preserve the existing stale-snapshot fallback in `toTaskProgressRows`.

Pass `input.signal` to every `waitForSnapshot` in `bootstrap` and
`claimPending`. Every fallback `.catch()` must call `signal.throwIfAborted()`
before returning an old snapshot or `null`; cancellation is not a stale-data
condition.

Change `claimIfPending` to accept `signal?: AbortSignal` and pass it to its
snapshot wait:

~~~ts
export async function claimIfPending(
  page: Page,
  task: CapcutTask,
  store: TaskStore,
  log: LogFn = NO_LOG,
  signal?: AbortSignal
): Promise<boolean> {
  if (task.status !== 2) return false;

  const mark = Date.now();
  await withTaskPopover(
    page,
    async () => {
      signal?.throwIfAborted();
      const row = await findTaskRow(page, task.title, task.reward, log);
      await row.locator('button').first().click({ timeout: 8000 }).catch(() => {});
    },
    log
  );

  const snap = await store.waitForSnapshot(mark, 30_000, signal)
    .catch(() => {
      signal?.throwIfAborted();
      return null;
    });
  const after = snap?.byKey.get(task.taskKey)?.status;
  const granted = store.seenGrants().some(
    (grant) => grant.at >= mark && grant.errNo === 0
  );
  return after === 4 || granted;
}
~~~

Both `claimPending` call sites pass `input.signal`. Their error handlers must
rethrow `input.signal.reason` when aborted instead of converting Stop into a
normal `false` claim result.

Make the configurable orchestration gap cancellable without removing
mission-owned human waits:

~~~ts
async function waitForDelay(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
~~~

Use `waitForDelay(gap, input.signal)` only in `paceGap`. Keep the measured
`page.waitForTimeout(rand(...))` calls inside missions unchanged; closing the
owned page interrupts those Playwright waits on Stop.

- [ ] **Step 7: Apply the approved mission budgets**

Set only:

~~~ts
pwaInstallGroup.proofTimeoutMs = 12_000;
notificationsGroup.proofTimeoutMs = 20_000;
designStudioGroup.proofTimeoutMs = 90_000;
videoStudioGroup.proofTimeoutMs = 240_000;
~~~

Keep PWA's 2.5-3.5 second propagation wait and every measured human/UI wait inside mission code.

Add this budget lock in `simple.test.ts` (import the design/video groups from
their modules):

~~~ts
it('uses the approved evidence budgets for all mission groups', () => {
  expect(pwaInstallGroup.proofTimeoutMs).toBe(12_000);
  expect(notificationsGroup.proofTimeoutMs).toBe(20_000);
  expect(designStudioGroup.proofTimeoutMs).toBe(90_000);
  expect(videoStudioGroup.proofTimeoutMs).toBe(240_000);
});
~~~

- [ ] **Step 8: Run the focused proof/performance suite**

Run:

~~~powershell
npx vitest run src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/capcut/__tests__/simple.test.ts src/main/services/capcut/__tests__/taskApi.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/__tests__/CapcutEngineService.test.ts
npm run typecheck
~~~

Expected: all tests PASS; fake elapsed time for a missing PWA snapshot is 12 seconds, not 90 seconds or more.

- [ ] **Step 9: Commit when commit authorization exists**

~~~powershell
git add src/main/services/capcut/types.ts src/main/services/capcut/missionRunner.ts src/main/services/capcut/runTasks.ts src/main/services/capcut/missions/simple.ts src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/capcut/__tests__/simple.test.ts src/main/services/capcut/__tests__/taskApi.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/CapcutEngineService.ts src/main/services/__tests__/CapcutEngineService.test.ts
git commit -m "perf: bound capcut task reconciliation"
~~~

---

### Task 8: Add Monotonic Stage Timing To The Full Account Pipeline

**Files:**

- Create: `src/main/services/stageTiming.ts`
- Create: `src/main/services/__tests__/stageTiming.test.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/capcut/missionRunner.ts`
- Modify: `src/main/services/__tests__/AutomationRunService.test.ts`
- Modify: `src/main/services/__tests__/CapcutEngineService.test.ts`
- Modify: `src/main/services/capcut/__tests__/missionRunner.test.ts`
- Create: `scripts/live-capcut-options.mjs`
- Create: `scripts/__tests__/live-capcut-options.test.mjs`
- Modify: `scripts/live-capcut-run.mjs`

**Interfaces:**

- Produces: `canonicalStageName(stage)` and
  `measureStage(stage, operation, log, now?)`.
- Consumes: existing injected log functions only; no new log DTO or renderer secret surface.
- Produces: sanitized messages in the exact shape
  `stage=canonical-token elapsedMs=123 outcome=success` (or `outcome=error`).
- Produces: a non-billable-by-default live harness that stops continuous input
  after a requested number of terminal accounts.

- [ ] **Step 1: Write red deterministic timing tests**

Create:

~~~ts
it('logs monotonic elapsed time on success', async () => {
  const ticks = [100, 137];
  const messages: string[] = [];
  const value = await measureStage(
    'browser-launch',
    async () => 'ok',
    (message) => messages.push(message),
    () => ticks.shift() as number
  );

  expect(value).toBe('ok');
  expect(messages).toEqual([
    'stage=browser-launch elapsedMs=37 outcome=success'
  ]);
});

it('logs elapsed time and rethrows on failure without copying the error', async () => {
  const messages: string[] = [];
  await expect(measureStage(
    'email-acquisition',
    async () => {
      throw new Error('token=secret');
    },
    (message) => messages.push(message),
    (() => {
      const ticks = [10, 25];
      return () => ticks.shift() as number;
    })()
  )).rejects.toThrow('token=secret');

  expect(messages).toEqual([
    'stage=email-acquisition elapsedMs=15 outcome=error'
  ]);
  expect(messages[0]).not.toContain('secret');
});

it('normalizes display names into one parseable stage token', async () => {
  const ticks = [50, 51];
  const messages: string[] = [];

  await measureStage(
    'mission-action:Cài CapCut Web Desktop',
    async () => undefined,
    (message) => messages.push(message),
    () => ticks.shift() as number
  );

  expect(messages).toEqual([
    'stage=mission-action:cai-capcut-web-desktop elapsedMs=1 outcome=success'
  ]);
});
~~~

In `AutomationRunService.test.ts`, reuse the Task 5 harness and add exact success
and failure assertions:

~~~ts
it('logs every orchestration stage with an integer elapsed time', async () => {
  const harness = createManualHarness({
    threadCount: 1,
    entries: ['one@example.com']
  });

  await harness.service.start(harness.config);
  await harness.service.waitForCompletion();
  harness.logBus.flush();

  const timing = harness.sink.rows
    .map((row) => (row as { message: string }).message)
    .filter((message) => message.startsWith('stage='));
  for (const stage of [
    'source-preflight',
    'email-acquisition',
    'browser-launch',
    'cleanup',
    'account-total'
  ]) {
    expect(timing.some((message) => message.startsWith('stage=' + stage + ' ')))
      .toBe(true);
  }
  expect(timing.every((message) =>
    /^stage=[a-z0-9:_-]+ elapsedMs=\d+ outcome=(success|error)$/.test(message)
  )).toBe(true);
});

it('logs a failed browser stage without copying the launcher exception', async () => {
  const harness = createManualHarness({
    threadCount: 1,
    entries: ['one@example.com']
  });
  harness.browser.failAtCall = 1;

  await harness.service.start(harness.config);
  await harness.service.waitForCompletion();
  harness.logBus.flush();

  const browserTiming = harness.sink.rows
    .map((row) => (row as { message: string }).message)
    .find((message) => message.startsWith('stage=browser-launch '));
  expect(browserTiming).toMatch(
    /^stage=browser-launch elapsedMs=\d+ outcome=error$/
  );
  expect(browserTiming).not.toContain('launcher refused');
});
~~~

In `CapcutEngineService.test.ts`, capture the third log argument and add:

~~~ts
it('logs authentication and trial-check stage timings', async () => {
  const messages: string[] = [];
  const engine = new CapcutEngineService({ userDataDir: 'C:/tmp/userData' });

  await engine.runAccount(runInput({
    log: (_status: string, _step: string, message: string) => {
      messages.push(message);
    }
  }));

  expect(messages).toEqual(expect.arrayContaining([
    expect.stringMatching(
      /^stage=authentication-otp elapsedMs=\d+ outcome=success$/
    ),
    expect.stringMatching(
      /^stage=trial-check elapsedMs=\d+ outcome=success$/
    )
  ]));
});
~~~

In `missionRunner.test.ts`, reuse `PWA_DONE_JSON`, `ENV`, and `TaskStore` from
Task 7:

~~~ts
it('logs mission action and reconciliation as separate stages', async () => {
  const messages: string[] = [];
  const store = new TaskStore();
  const group: MissionGroup = {
    name: 'PWA',
    keys: ['capcut_web_pwa_install'],
    proofTimeoutMs: 12_000,
    act: async () => {
      store.pushAction({
        actionKey: 'capcut_web_pwa_install',
        opId: 'op-timing',
        errNo: 0,
        errTips: '',
        at: Date.now()
      });
      store.pushTaskList(PWA_DONE_JSON, Date.now() + 1);
    }
  };

  await reconcileMissionEvidence(
    group,
    { ...ENV, log: (message) => messages.push(message) },
    store,
    new Set(group.keys)
  );

  expect(messages).toEqual(expect.arrayContaining([
    expect.stringMatching(
      /^stage=mission-action:pwa elapsedMs=\d+ outcome=success$/
    ),
    expect.stringMatching(
      /^stage=mission-reconciliation:pwa elapsedMs=\d+ outcome=success$/
    )
  ]));
});
~~~

Create the live-harness safety tests:

~~~js
import { describe, expect, it } from 'vitest';
import {
  assertBillableEmailAllowed,
  isTerminalRunState,
  terminalAccountCount
} from '../live-capcut-options.mjs';

describe('live CapCut harness safety', () => {
  it('allows custom-domain verification without a billable flag', () => {
    expect(() => assertBillableEmailAllowed({ mode: 'custom' }, {})).not.toThrow();
  });

  it('blocks Gmail94 purchase unless its dedicated flag is present', () => {
    expect(() => assertBillableEmailAllowed(
      { mode: 'api', provider: 'gmail94' },
      {}
    )).toThrow('VERIFY_GMAIL94_BUY=1');
    expect(() => assertBillableEmailAllowed(
      { mode: 'api', provider: 'gmail94' },
      { VERIFY_GMAIL94_BUY: '1' }
    )).not.toThrow();
  });

  it('counts account outcomes and recognizes every terminal run state', () => {
    expect(terminalAccountCount({
      accountsCompleted: 4,
      accountsFailed: 2,
      accountsStopped: 1
    })).toBe(7);
    expect(['completed', 'stopped', 'blocked', 'failed'].every(isTerminalRunState))
      .toBe(true);
    expect(isTerminalRunState('running')).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run timing tests and confirm RED**

Run:

~~~powershell
npx vitest run src/main/services/__tests__/stageTiming.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts scripts/__tests__/live-capcut-options.test.mjs
~~~

Expected: FAIL because the timing helper and stage messages do not exist.

- [ ] **Step 3: Implement the small monotonic timing helper**

Create:

~~~ts
import { performance } from 'node:perf_hooks';

export type MonotonicNow = () => number;

export function canonicalStageName(stage: string): string {
  const ascii = stage
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const token = ascii
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || 'unknown';
}

export async function measureStage<T>(
  stage: string,
  operation: () => Promise<T>,
  log: (message: string) => void,
  now: MonotonicNow = () => performance.now()
): Promise<T> {
  const startedAt = now();
  const safeStage = canonicalStageName(stage);
  let outcome: 'success' | 'error' = 'success';
  try {
    return await operation();
  } catch (error: unknown) {
    outcome = 'error';
    throw error;
  } finally {
    const elapsedMs = Math.max(0, Math.round(now() - startedAt));
    log('stage=' + safeStage + ' elapsedMs=' + elapsedMs + ' outcome=' + outcome);
  }
}
~~~

Create `scripts/live-capcut-options.mjs`:

~~~js
export function assertBillableEmailAllowed(source, env) {
  if (source.mode !== 'api') return;
  const flag = source.provider === 'gmail94'
    ? 'VERIFY_GMAIL94_BUY'
    : 'VERIFY_DONGVANFB_BUY';
  if (env[flag] !== '1') {
    throw new Error(
      'Nguồn ' + source.provider + ' có trả phí; chỉ được chạy khi đã có phê duyệt và ' +
      flag + '=1.'
    );
  }
}

export function terminalAccountCount(progress) {
  return Number(progress?.accountsCompleted ?? 0) +
    Number(progress?.accountsFailed ?? 0) +
    Number(progress?.accountsStopped ?? 0);
}

export function isTerminalRunState(state) {
  return state === 'completed' || state === 'stopped' ||
    state === 'blocked' || state === 'failed';
}
~~~

- [ ] **Step 4: Instrument orchestration boundaries, not every internal wait**

In `AutomationRunService` wrap:

- source preflight;
- each proxy acquisition;
- every `source.next(...)` call as email acquisition, for both finite manual
  items and continuous reservation/purchase items;
- each browser launch/CDP attach;
- each iteration cleanup;
- full account duration.

Use:

~~~ts
await measureStage(
  'proxy-acquisition',
  () => this.deps.proxies.acquire(acquisitionSignal),
  (message) => this.log('INFO', item?.email ?? 'system', 'Timing', message, thread?.accountId)
);
~~~

Use equivalent wrappers with fixed stage names `source-preflight`, `email-acquisition`, `browser-launch`, `cleanup`, and `account-total`.

The `account-total` wrapper starts immediately before `createThreadRecord` and
ends only after the accepted account's browser, proxy, and uncommitted mailbox
cleanup has settled. Put the existing accepted-account `try/finally` inside that
wrapper, and keep `cleanup` as a nested measured stage in its `finally`. Email
and proxy acquisition remain separate preceding stages, so one slow provider is
not hidden inside the account total. Do not emit `account-total` for an
acquisition failure that never created/accepted an account.

Because Task 5 deliberately catches individual cleanup failures so the remaining
owners are still released, make the timing outcome explicit without rethrowing
into account outcome handling:

~~~ts
const timingLog = (message: string): void => {
  this.log(
    'INFO',
    thread?.email ?? item?.email ?? 'system',
    'Timing',
    message,
    thread?.accountId
  );
};
const cleanupFailuresBefore = this.cleanupFailures;
await measureStage(
  'cleanup',
  async () => {
    await this.cleanupIteration(source, item, committed, thread, lease);
    if (this.cleanupFailures > cleanupFailuresBefore) {
      throw new Error('sanitized cleanup failure');
    }
  },
  timingLog
).catch(() => undefined);
~~~

`measureStage` never logs the sentinel text, so the stage correctly says
`outcome=error` while the already-recorded workload outcome remains unchanged.

In `CapcutEngineService` wrap authentication/OTP and trial check as
`authentication-otp` and `trial-check`. In the Task 7
`reconcileMissionEvidence` implementation, replace the raw action call with:

~~~ts
const actionStartedAt = Date.now();
let actError: Error | null = null;
try {
  await measureStage(
    'mission-action:' + group.name,
    () => group.act(env, need),
    env.log
  );
} catch (error: unknown) {
  env.signal.throwIfAborted();
  actError = error instanceof Error ? error : new Error(String(error));
}
const actionSettledAt = Date.now();
~~~

Move the Task 7 block beginning with `const budgetMs` and ending with the
`MissionGroupResult` return into this measured closure; do not change its
deadline calculations or evidence rules:

~~~ts
return measureStage(
  'mission-reconciliation:' + group.name,
  async () => {
    const budgetMs = actError
      ? Math.min(3000, group.proofTimeoutMs)
      : group.proofTimeoutMs;
    const deadlineAt = actionSettledAt + budgetMs;
    const remaining = (): number => Math.max(0, deadlineAt - Date.now());

    const proofEntries = await Promise.all([...need].map(async (key) => {
      try {
        const proof = await store.waitForAction(
          key,
          remaining(),
          actionStartedAt,
          env.signal
        );
        return [key, proof] as const;
      } catch (error: unknown) {
        env.signal.throwIfAborted();
        return [
          key,
          error instanceof Error ? error : new Error(String(error))
        ] as const;
      }
    }));

    const snapshot = remaining() > 0
      ? await store.waitForSnapshot(
          actionSettledAt,
          remaining(),
          env.signal
        ).catch(() => {
          env.signal.throwIfAborted();
          return null;
        })
      : null;

    const evidence = new Map<string, MissionEvidence>();
    for (const [key, value] of proofEntries) {
      if (value instanceof Error) {
        evidence.set(key, {
          key,
          state: 'failed',
          error: actError ?? value
        });
        continue;
      }
      if (value.errNo !== 0) {
        evidence.set(key, {
          key,
          proof: value,
          state: 'failed',
          error: new Error(
            ('do_action err_no=' + value.errNo + ' ' + value.errTips).trim()
          )
        });
        continue;
      }
      const snapshotStatus = snapshot?.byKey.get(key)?.status;
      evidence.set(key, {
        key,
        proof: value,
        snapshotStatus,
        state: snapshotStatus === 4
          ? 'verified'
          : 'proved-awaiting-snapshot'
      });
    }

    return { evidence, snapshot, actionSettledAt };
  },
  env.log
);
~~~

`canonicalStageName` converts the display names to stable tokens, so runtime
messages contain no whitespace after `stage=`. The timing log must not include
email passwords, API keys, proxy credentials, order payloads, or exception
messages.

In `runTasks.bootstrap`, preserve canonical timing lines instead of adding the
existing mission indentation prefix:

~~~ts
log: (message: string) =>
  log(message.startsWith('stage=') ? message : '      · ' + message),
~~~

This ensures every emitted timing message itself starts with `stage=` in
`LogBus`, while ordinary mission diagnostics keep their current indentation.

Update `scripts/live-capcut-run.mjs` to import the three helpers, call
`assertBillableEmailAllowed(emailSource, process.env)` before spawning Electron,
and add `--stop-after=N` with default `1`. Add
`skipWithoutTrial: false` to `RUN_CONFIG`. Replace the old progress log with:

~~~js
console.log(
  `[PROGRESS] ${p.state} — ${p.message} ` +
  `(active ${p.workersActive}/${p.workerTarget}, accepted ${p.accountsAccepted}, ` +
  `done ${p.accountsCompleted}, failed ${p.accountsFailed}, stopped ${p.accountsStopped})`
);
~~~

In the polling loop, request the typed IPC Stop once the target is reached, and
recognize every terminal state:

~~~js
let stopRequested = false;
while (Date.now() < deadline) {
  const progress = await page
    .evaluate(async () => (await window.electronAPI.run.progress())?.data ?? null)
    .catch(() => null);
  const state = progress?.state ?? 'unknown';
  if (state !== last) {
    console.log(`[LIVE] state = ${state}`);
    last = state;
  }
  if (
    !stopRequested &&
    terminalAccountCount(progress) >= STOP_AFTER &&
    !isTerminalRunState(state)
  ) {
    stopRequested = true;
    console.log(`[LIVE] đạt ${STOP_AFTER} account terminal — gửi Stop.`);
    await page.evaluate(async () => window.electronAPI.run.stop());
  }
  if (isTerminalRunState(state)) break;
  await sleep(500);
}

if (!isTerminalRunState(last)) {
  await page.evaluate(async () => window.electronAPI.run.stop()).catch(() => {});
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const progress = await page
      .evaluate(async () => (await window.electronAPI.run.progress())?.data ?? null)
      .catch(() => null);
    if (isTerminalRunState(progress?.state)) {
      last = progress.state;
      break;
    }
    await sleep(500);
  }
}
~~~

Parse `STOP_AFTER` before `RUN_CONFIG`:

~~~js
const STOP_AFTER = (() => {
  const flag = process.argv.slice(2)
    .find((arg) => arg.startsWith('--stop-after='));
  const value = flag ? Number(flag.slice('--stop-after='.length)) : 1;
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new Error('--stop-after phải là số nguyên 1..200');
  }
  return value;
})();
~~~

An invalid value must throw before Electron starts. Update the script header to
state that API sources require the dedicated opt-in flag and separate human
approval.

- [ ] **Step 5: Run timing and affected service tests**

Run:

~~~powershell
npx vitest run src/main/services/__tests__/stageTiming.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts scripts/__tests__/live-capcut-options.test.mjs
npm run lint
node --check scripts/live-capcut-options.mjs
node --check scripts/live-capcut-run.mjs
~~~

Expected: all tests PASS and ESLint reports no `console.*` addition under `src/main/services/capcut/`.

- [ ] **Step 6: Commit when commit authorization exists**

~~~powershell
git add src/main/services/stageTiming.ts src/main/services/__tests__/stageTiming.test.ts src/main/services/AutomationRunService.ts src/main/services/CapcutEngineService.ts src/main/services/capcut/missionRunner.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts scripts/live-capcut-options.mjs scripts/__tests__/live-capcut-options.test.mjs scripts/live-capcut-run.mjs
git commit -m "feat: log automation stage timings"
~~~

---

### Task 9: Recover The Primary CapCut Page With A One-Replacement Budget

**Files:**

- Create: `src/main/services/capcut/pageRecovery.ts`
- Create: `src/main/services/capcut/__tests__/pageRecovery.test.ts`
- Modify: `src/main/services/capcut/types.ts`
- Modify: `src/main/services/capcut/runTasks.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/__tests__/CapcutEngineService.test.ts`
- Modify: `src/main/services/capcut/__tests__/missionRunner.test.ts`
- Modify: `src/main/services/capcut/__tests__/runTasks.test.ts`

**Interfaces:**

- Produces: `PrimaryPageResolver.resolve(stage): Promise<Page>`.
- Changes: `RunTasksInput.resolvePage?: (stage: string) => Promise<Page>`.
- Preserves: one browser context and one account run; no full-account restart.
- Consumes: Task 7 proof memory so recovered rounds never replay proof-backed tasks.

- [ ] **Step 1: Write red resolver tests for reuse, one replacement, and terminal failure**

Use lightweight page/context fakes cast to Playwright interfaces:

~~~ts
import type { BrowserContext, Page } from 'playwright-core';
import { PrimaryPageResolver } from '../pageRecovery';
import { URLS } from '../urls';

type TestPage = Page & {
  closed: boolean;
  gotoCalls: string[];
  observedEvents: string[];
  emitTest(event: 'close' | 'crash'): void;
};

type TestContext = BrowserContext & {
  newPageCalls: number;
};

function fakePage(initialUrl: string, initiallyClosed: boolean): TestPage {
  let currentUrl = initialUrl;
  const listeners = new Map<string, Array<() => void>>();
  const page = {
    closed: initiallyClosed,
    gotoCalls: [] as string[],
    observedEvents: [] as string[],
    isClosed: () => page.closed,
    url: () => currentUrl,
    on: (event: string, listener: () => void) => {
      page.observedEvents.push(event);
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return page;
    },
    emitTest: (event: 'close' | 'crash') => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    goto: async (url: string) => {
      currentUrl = url;
      page.gotoCalls.push(url);
      return null;
    }
  };
  return page as unknown as TestPage;
}

function fakeContext(initialPages: TestPage[]): TestContext {
  const pages = [...initialPages];
  const context = {
    newPageCalls: 0,
    pages: () => [...pages],
    newPage: async () => {
      context.newPageCalls += 1;
      const page = fakePage('about:blank', false);
      pages.push(page);
      return page;
    }
  };
  return context as unknown as TestContext;
}

it('reuses the newest open capcut page before creating one', async () => {
  const closedMain = fakePage('https://www.capcut.com/my-edit', true);
  const otherSite = fakePage('https://example.com', false);
  const capcut = fakePage('https://www.capcut.com/ai-design', false);
  const context = fakeContext([closedMain, otherSite, capcut]);
  const resolver = new PrimaryPageResolver(context, closedMain, () => {});

  await expect(resolver.resolve('trial')).resolves.toBe(capcut);
  expect(context.newPageCalls).toBe(0);
});

it('creates and navigates at most one replacement page', async () => {
  const initial = fakePage('https://www.capcut.com/my-edit', true);
  const context = fakeContext([initial]);
  const resolver = new PrimaryPageResolver(context, initial, () => {});

  const replacement = await resolver.resolve('mission:PWA') as TestPage;
  expect(context.newPageCalls).toBe(1);
  expect(replacement.gotoCalls).toEqual([URLS.main]);

  replacement.closed = true;
  await expect(resolver.resolve('mission:Design Studio')).rejects.toThrow(
    'Tab CapCut chính đã đóng lần thứ hai'
  );
  expect(context.newPageCalls).toBe(1);
});

it('treats a crashed current page as unusable even before isClosed changes', async () => {
  const crashed = fakePage('https://www.capcut.com/my-edit', false);
  const context = fakeContext([crashed]);
  const resolver = new PrimaryPageResolver(context, crashed, () => {});

  crashed.emitTest('crash');
  const replacement = await resolver.resolve('trial') as TestPage;

  expect(replacement).not.toBe(crashed);
  expect(context.newPageCalls).toBe(1);
  expect(replacement.gotoCalls).toEqual([URLS.main]);
});
~~~

Extend the `runTasks.test.ts` mock from Task 7 with this orchestration
regression. It proves the fixed page reference is replaced at the next safe
mission boundary while proof memory keeps PWA out of later selection:

~~~ts
it('recovers at the next mission boundary without replaying a proven PWA action', async () => {
  vi.useFakeTimers();
  let firstClosed = false;
  const firstPage = {
    goto: vi.fn(async () => null),
    reload: vi.fn(async () => null),
    waitForTimeout: vi.fn(async () => {}),
    isClosed: vi.fn(() => firstClosed)
  } as unknown as Page;
  const replacementPage = {
    goto: vi.fn(async () => null),
    reload: vi.fn(async () => null),
    waitForTimeout: vi.fn(async () => {}),
    isClosed: vi.fn(() => false)
  } as unknown as Page;
  const pwaAct = vi.fn(async () => { firstClosed = true; });
  const designAct = vi.fn(async () => {});
  const resolvePage = vi.fn(async (stage: string) =>
    stage === 'mission:Design Studio' ? replacementPage : firstPage
  );
  const groups: MissionGroup[] = [
    {
      name: 'PWA',
      keys: ['capcut_web_pwa_install'],
      proofTimeoutMs: 12_000,
      act: pwaAct
    },
    {
      name: 'Design Studio',
      keys: ['capcut_web_design_studio_ai_chat'],
      proofTimeoutMs: 90_000,
      act: designAct
    }
  ];

  const run = runAllTasks({
    page: firstPage,
    context: {} as BrowserContext,
    sampleImage: 'C:/tmp/sample.png',
    log: () => {},
    signal: new AbortController().signal,
    maxRounds: 2,
    groups,
    resolvePage
  });
  await vi.runAllTimersAsync();
  await run;

  expect(resolvePage).toHaveBeenCalledWith('bootstrap');
  expect(resolvePage).toHaveBeenCalledWith('mission:PWA');
  expect(resolvePage).toHaveBeenCalledWith('mission:Design Studio');
  expect(pwaAct).toHaveBeenCalledTimes(1);
  expect(designAct).toHaveBeenCalledTimes(1);
});
~~~

- [ ] **Step 2: Run recovery tests and verify RED**

Run:

~~~powershell
npx vitest run src/main/services/capcut/__tests__/pageRecovery.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/__tests__/CapcutEngineService.test.ts
~~~

Expected: FAIL because close/crash handlers only log, no resolver exists, and
`runAllTasks` still retains the original page reference.

- [ ] **Step 3: Implement the resolver with exact ownership rules**

Create:

~~~ts
import type { BrowserContext, Page } from 'playwright-core';
import { URLS } from './urls';

export class PrimaryPageResolver {
  private current: Page;
  private replacementsCreated = 0;
  private readonly watched = new WeakSet<Page>();
  private readonly unusable = new WeakSet<Page>();

  constructor(
    private readonly context: BrowserContext,
    initialPage: Page,
    private readonly log: (message: string) => void
  ) {
    this.current = initialPage;
    this.watch(initialPage);
  }

  private watch(page: Page): void {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    page.on('close', () => {
      this.unusable.add(page);
      this.log('Tab CapCut chính vừa đóng.');
    });
    page.on('crash', () => {
      this.unusable.add(page);
      this.log('Tab CapCut chính vừa crash.');
    });
  }

  private isUsableCapcutPage(page: Page): boolean {
    if (page.isClosed() || this.unusable.has(page)) return false;
    try {
      return new URL(page.url()).origin === 'https://www.capcut.com';
    } catch {
      return false;
    }
  }

  async resolve(stage: string): Promise<Page> {
    if (!this.current.isClosed() && !this.unusable.has(this.current)) {
      return this.current;
    }

    const existing = this.context.pages()
      .filter((page) => this.isUsableCapcutPage(page))
      .at(-1);
    if (existing) {
      this.current = existing;
      this.watch(existing);
      this.log('Khôi phục tab CapCut từ page đang mở tại stage=' + stage + '.');
      return existing;
    }

    if (this.replacementsCreated >= 1) {
      throw new Error('Tab CapCut chính đã đóng lần thứ hai; hết ngân sách phục hồi.');
    }

    const replacement = await this.context.newPage();
    this.replacementsCreated += 1;
    this.current = replacement;
    this.watch(replacement);
    try {
      await replacement.goto(URLS.main, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });
    } catch {
      this.unusable.add(replacement);
      throw new Error('Không điều hướng được tab CapCut thay thế.');
    }
    this.log('Đã tạo một tab CapCut thay thế tại stage=' + stage + '.');
    return replacement;
  }
}
~~~

- [ ] **Step 4: Resolve at safe boundaries only**

In `CapcutEngineService.runAccount`:

~~~ts
const resolver = new PrimaryPageResolver(
  context,
  input.page,
  (message) => log('WARNING', 'Browser', message)
);
let page = await resolver.resolve('authentication');
~~~

Delete the old direct `page.on('close')` and `page.on('crash')` block from
`CapcutEngineService`; `PrimaryPageResolver.watch` is now the single owner of
those listeners and emits the recovery-aware diagnostics.

Resolve again immediately before trial:

~~~ts
page = await resolver.resolve('trial');
~~~

Pass:

~~~ts
resolvePage: (stage) => resolver.resolve(stage)
~~~

to `runAllTasks`. In `bootstrap` resolve before navigation. Before each mission group:

~~~ts
if (input.resolvePage) {
  env.page = await input.resolvePage('mission:' + group.name);
}
~~~

Use `env.page` after `bootstrap` for `claimPending`, closed-page checks, and
mission calls; do not retain a destructured `const page = input.page`. At
bootstrap entry use:

~~~ts
const page = input.resolvePage
  ? await input.resolvePage('bootstrap')
  : input.page;
~~~

Then check `env.page.isClosed()` only after the mission-boundary resolve. This is
what lets a closed original page be replaced instead of triggering the old early
return.

If a page closes during `group.act`, let that group fail normally. Recovery occurs only at the next safe boundary, and Task 7's `proofBacked` set excludes any action already proven.

- [ ] **Step 5: Run recovery and proof-memory tests**

Run:

~~~powershell
npx vitest run src/main/services/capcut/__tests__/pageRecovery.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/__tests__/CapcutEngineService.test.ts
npm run typecheck
~~~

Expected: all tests PASS; the second replacement request ends the account as an error through Task 5 outcome handling.

- [ ] **Step 6: Commit when commit authorization exists**

~~~powershell
git add src/main/services/capcut/pageRecovery.ts src/main/services/capcut/__tests__/pageRecovery.test.ts src/main/services/capcut/types.ts src/main/services/capcut/runTasks.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/CapcutEngineService.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts
git commit -m "fix: recover one closed capcut main tab"
~~~

---

### Task 10: Stop Automation Before Logs/SQLite And Enforce A Single Electron Instance

**Files:**

- Create: `src/main/singleInstance.ts`
- Create: `src/main/__tests__/singleInstance.test.ts`
- Create: `src/main/startupRecovery.ts`
- Create: `src/main/__tests__/startupRecovery.test.ts`
- Modify: `src/main/lifecycle.ts`
- Modify: `src/main/__tests__/lifecycle.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

- Changes: `ShutdownDependencies.automation.stop('APP_SHUTDOWN')`.
- Produces: separate `automationTimeoutMs` and `logFlushTimeoutMs` bounds.
- Produces: `acquireSingleInstance(app, getWindow): boolean`.
- Produces: `startPrimaryInstance(app, getWindow, scheduleInitialization)` so
  the no-initialization branch is directly testable.
- Consumes: Task 2 `clearStaleReservations()` and Task 5 shutdown reason.

- [ ] **Step 1: Write red lifecycle-order and single-instance tests**

Replace the old three-step ordering assertion with:

~~~ts
it('stops automation before log flush, database close, and quit', async () => {
  const order: string[] = [];
  const manager = createShutdownManager({
    automation: {
      stop: async (code) => {
        expect(code).toBe('APP_SHUTDOWN');
        order.push('stop_automation');
      }
    },
    logBus: {
      flush: async () => {
        order.push('flush_logs');
      }
    },
    db: {
      open: true,
      close: () => {
        order.push('close_db');
      }
    },
    app: {
      quit: () => {
        order.push('quit');
      }
    }
  });

  await manager.handleBeforeQuit(new FakeEvent());
  expect(order).toEqual(['stop_automation', 'flush_logs', 'close_db', 'quit']);
});
~~~

Create single-instance tests:

~~~ts
import {
  acquireSingleInstance,
  startPrimaryInstance,
  type FocusableWindow,
  type SingleInstanceApp
} from '../singleInstance';

class FakeSingleInstanceApp implements SingleInstanceApp {
  public quitCalls = 0;
  public requestCalls = 0;
  public listeners: Array<() => void> = [];

  constructor(private readonly lockGranted: boolean) {}

  requestSingleInstanceLock(): boolean {
    this.requestCalls += 1;
    return this.lockGranted;
  }

  on(_event: 'second-instance', listener: () => void): void {
    this.listeners.push(listener);
  }

  quit(): void {
    this.quitCalls += 1;
  }

  emitSecondInstance(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeFocusableWindow implements FocusableWindow {
  public destroyed = false;
  public minimized = false;
  public restoreCalls = 0;
  public showCalls = 0;
  public focusCalls = 0;

  isDestroyed(): boolean { return this.destroyed; }
  isMinimized(): boolean { return this.minimized; }
  restore(): void { this.restoreCalls += 1; this.minimized = false; }
  show(): void { this.showCalls += 1; }
  focus(): void { this.focusCalls += 1; }
}

it('quits a second instance before runtime initialization can be scheduled', () => {
  const app = new FakeSingleInstanceApp(false);
  let scheduleCalls = 0;
  const acquired = startPrimaryInstance(
    app,
    () => null,
    () => { scheduleCalls += 1; }
  );

  expect(acquired).toBe(false);
  expect(app.requestCalls).toBe(1);
  expect(app.quitCalls).toBe(1);
  expect(app.listeners).toHaveLength(0);
  expect(scheduleCalls).toBe(0);
});

it('schedules primary initialization only after the lock is granted', () => {
  const app = new FakeSingleInstanceApp(true);
  let requestCallsSeenByInitializer = 0;

  expect(startPrimaryInstance(
    app,
    () => null,
    () => { requestCallsSeenByInitializer = app.requestCalls; }
  )).toBe(true);

  expect(requestCallsSeenByInitializer).toBe(1);
  expect(app.quitCalls).toBe(0);
});

it('focuses and restores the existing window on second-instance', () => {
  const app = new FakeSingleInstanceApp(true);
  const window = new FakeFocusableWindow();
  window.minimized = true;
  expect(acquireSingleInstance(app, () => window)).toBe(true);

  app.emitSecondInstance();

  expect(window.restoreCalls).toBe(1);
  expect(window.showCalls).toBe(1);
  expect(window.focusCalls).toBe(1);
});
~~~

Add these two lifecycle timeout regressions beside the existing re-entry test:

~~~ts
it('reports an automation timeout separately and still flushes, closes, and quits', async () => {
  const order: string[] = [];
  const logger = new FakeLogger();
  const db = new FakeDatabase();
  const app = new FakeApp();
  const manager = createShutdownManager({
    automation: { stop: async () => new Promise<void>(() => {}) },
    logBus: { flush: async () => { order.push('flush_logs'); } },
    db,
    app,
    logger,
    automationTimeoutMs: 100,
    logFlushTimeoutMs: 200
  });

  const shutdown = manager.handleBeforeQuit(new FakeEvent());
  await vi.advanceTimersByTimeAsync(100);
  await shutdown;

  expect(logger.logs).toEqual([{
    code: 'ERR_SHUTDOWN_AUTOMATION_TIMEOUT',
    message: 'Automation stop timed out during shutdown.'
  }]);
  expect(order).toEqual(['flush_logs']);
  expect(db.closeCalls).toBe(1);
  expect(app.quitCalls).toBe(1);
});

it('reports a log timeout separately after automation has stopped', async () => {
  const order: string[] = [];
  const logger = new FakeLogger();
  const db = new FakeDatabase();
  const app = new FakeApp();
  const manager = createShutdownManager({
    automation: { stop: async () => { order.push('stop_automation'); } },
    logBus: { flush: async () => new Promise<void>(() => {}) },
    db,
    app,
    logger,
    automationTimeoutMs: 100,
    logFlushTimeoutMs: 200
  });

  const shutdown = manager.handleBeforeQuit(new FakeEvent());
  await vi.advanceTimersByTimeAsync(200);
  await shutdown;

  expect(order).toEqual(['stop_automation']);
  expect(logger.logs).toEqual([{
    code: 'ERR_SHUTDOWN_LOG_TIMEOUT',
    message: 'LogBus flush timed out during shutdown.'
  }]);
  expect(db.closeCalls).toBe(1);
  expect(app.quitCalls).toBe(1);
});
~~~

Update the existing rejected-flush and hanging-flush cases to pass
`logFlushTimeoutMs` instead of the removed `timeoutMs`. Keep their static-message
redaction assertions unchanged.

Create `startupRecovery.test.ts`:

~~~ts
import { describe, expect, it, vi } from 'vitest';
import { recoverStaleEmailReservations } from '../startupRecovery';

describe('startup reservation recovery', () => {
  it('clears stale reservations and reports only the released count', () => {
    const clearStaleReservations = vi.fn(() => 2);
    const messages: string[] = [];

    expect(recoverStaleEmailReservations(
      { clearStaleReservations },
      (message) => messages.push(message)
    )).toBe(2);

    expect(clearStaleReservations).toHaveBeenCalledTimes(1);
    expect(messages).toEqual([
      '[MAIN_RECOVERY] Released 2 stale email reservations.'
    ]);
    expect(messages.join(' ')).not.toContain('@');
    expect(messages.join(' ')).not.toContain('reservation-');
  });
});
~~~

- [ ] **Step 2: Run lifecycle tests and confirm RED**

Run:

~~~powershell
npx vitest run src/main/__tests__/lifecycle.test.ts src/main/__tests__/singleInstance.test.ts src/main/__tests__/startupRecovery.test.ts
~~~

Expected: FAIL because automation is not a shutdown dependency, the lock helper is absent, and stale reservations are not recovered at startup.

- [ ] **Step 3: Add separate bounded shutdown phases**

Extend diagnostics:

~~~ts
export type ShutdownDiagnosticCode =
  | 'ERR_SHUTDOWN_AUTOMATION_TIMEOUT'
  | 'ERR_SHUTDOWN_AUTOMATION_STOP'
  | 'ERR_SHUTDOWN_LOG_TIMEOUT'
  | 'ERR_SHUTDOWN_FLUSH'
  | 'ERR_SHUTDOWN_DB_CLOSE';
~~~

Add:

~~~ts
export interface StoppableAutomation {
  stop(code: 'APP_SHUTDOWN'): Promise<void>;
}

export interface ShutdownDependencies {
  automation?: StoppableAutomation;
  db: CloseableDatabase;
  logBus?: FlushableLogBus;
  app: QuitApplication;
  logger?: SafeDiagnosticLogger;
  automationTimeoutMs?: number;
  logFlushTimeoutMs?: number;
}
~~~

Add this private helper above `createShutdownManager`; it races one phase against
its own timer, clears the timer, and logs only static sanitized text:

~~~ts
async function runBounded(
  operation: () => Promise<void>,
  timeoutMs: number,
  logger: SafeDiagnosticLogger | undefined,
  timeoutCode: ShutdownDiagnosticCode,
  timeoutMessage: string,
  failureCode: ShutdownDiagnosticCode,
  failureMessage: string
): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([
      operation().then(() => 'done' as const),
      timeout
    ]);
    if (result === 'timeout') logger?.error(timeoutCode, timeoutMessage);
  } catch {
    logger?.error(failureCode, failureMessage);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
~~~

`handleBeforeQuit` must execute:

~~~ts
await runBounded(
  () => deps.automation?.stop('APP_SHUTDOWN') ?? Promise.resolve(),
  deps.automationTimeoutMs ?? 15_000,
  deps.logger,
  'ERR_SHUTDOWN_AUTOMATION_TIMEOUT',
  'Automation stop timed out during shutdown.',
  'ERR_SHUTDOWN_AUTOMATION_STOP',
  'Automation stop failed during shutdown.'
);

await runBounded(
  () => deps.logBus?.flush() ?? Promise.resolve(),
  deps.logFlushTimeoutMs ?? 2_000,
  deps.logger,
  'ERR_SHUTDOWN_LOG_TIMEOUT',
  'LogBus flush timed out during shutdown.',
  'ERR_SHUTDOWN_FLUSH',
  'LogBus flush failed during shutdown.'
);
~~~

Only after those phases, close SQLite and call `app.quit()`. Preserve the existing re-entry guard and static sanitized diagnostics.

- [ ] **Step 4: Implement the testable single-instance helper**

Create `singleInstance.ts`:

~~~ts
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): void;
  quit(): void;
}

export interface FocusableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function acquireSingleInstance(
  app: SingleInstanceApp,
  getWindow: () => FocusableWindow | null
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return true;
}

export function startPrimaryInstance(
  app: SingleInstanceApp,
  getWindow: () => FocusableWindow | null,
  scheduleInitialization: () => void
): boolean {
  if (!acquireSingleInstance(app, getWindow)) return false;
  scheduleInitialization();
  return true;
}
~~~

- [ ] **Step 5: Gate all runtime initialization behind the lock**

In `main.ts`, call the testable gate before `app.whenReady()`:

~~~ts
startPrimaryInstance(app, () => mainWindow, () => {
  void app.whenReady().then(async () => {
    await initializePrimaryInstance();
  });
});
~~~

Move the current `whenReady` body into `initializePrimaryInstance` without changing its initialization order. The false branch must not call `createDatabaseConnection`, `runMigrations`, `createProviderStack`, register IPC, or create a window.

- [ ] **Step 6: Recover stale reservations only after the primary lock and migrations**

Create `startupRecovery.ts`:

~~~ts
export interface StaleEmailReservationRepository {
  clearStaleReservations(): number;
}

export function recoverStaleEmailReservations(
  repository: StaleEmailReservationRepository,
  report: (message: string) => void
): number {
  const released = repository.clearStaleReservations();
  if (released > 0) {
    report(
      '[MAIN_RECOVERY] Released ' + released + ' stale email reservations.'
    );
  }
  return released;
}
~~~

Only inside the lock-protected `initializePrimaryInstance`, immediately after
`runMigrations(dbInstance)` and
`createProviderStackRepositories(dbInstance)`, call:

~~~ts
recoverStaleEmailReservations(
  stackRepositories.purchasedEmailRepo,
  (message) => process.stderr.write(message + '\n')
);
~~~

This log contains a count only. It must not contain email addresses or reservation IDs.

- [ ] **Step 7: Wire automation-first shutdown while keeping LogBus open until workers settle**

Pass:

~~~ts
automation: {
  stop: (code) => providerStack.automationRunService.stop(code)
},
logBus: {
  flush: async () => {
    providerStack.logBus.dispose();
  }
}
~~~

to `createShutdownManager`. Remove `providerStack.logBus.dispose()` from the earlier subscription cleanup callback; that callback should only unsubscribe renderer listeners. Cleanup IPC may happen before shutdown, but logs and SQLite remain alive until automation stop settles.

- [ ] **Step 8: Run lifecycle and startup tests**

Run:

~~~powershell
npx vitest run src/main/__tests__/lifecycle.test.ts src/main/__tests__/singleInstance.test.ts src/main/__tests__/startupRecovery.test.ts
npm run typecheck
~~~

Expected: all focused tests PASS; repeated `before-quit` still stops/closes/quits exactly once.

- [ ] **Step 9: Commit when commit authorization exists**

~~~powershell
git add src/main/singleInstance.ts src/main/__tests__/singleInstance.test.ts src/main/startupRecovery.ts src/main/__tests__/startupRecovery.test.ts src/main/lifecycle.ts src/main/__tests__/lifecycle.test.ts src/main/main.ts
git commit -m "fix: stop automation before electron shutdown"
~~~

---

### Task 11: Repair The Existing Selector Gate From Fixture Evidence

**Files:**

- Modify: `tools/verify-selectors.ts`
- Inspect, and modify only if evidence requires it: `tools/fixtures/dom-ai-design-loading.html`
- Reference: `docs/AUTOMATION-ENGINE.md`

**Interfaces:**

- Produces: a green `npm run selectors` gate for the measured reason.
- Preserves: selector resolution and inert-containment checks; does not claim external-CSS geometry from an offline fixture.

- [ ] **Step 1: Reproduce the one known selector failure**

Run:

~~~powershell
npm run selectors
~~~

Expected baseline: 86 assertions pass and `#graphic-editor-render có kích thước thật để click` fails with fixture height approximately 65 instead of greater than 300.

- [ ] **Step 2: Confirm why the offline fixture cannot prove wrapper height**

Inspect:

~~~powershell
rg -n "graphic-editor-render|stylesheet|height:" tools/fixtures/dom-ai-design-loading.html
~~~

Confirm all three facts before editing:

1. `#graphic-editor-render` exists exactly once.
2. Its production layout height depends on CapCut stylesheets that are not loaded by the local fixture.
3. The fixture's inline canvas heights still intentionally prove the loading state, while the wrapper's computed height does not prove clickability.

If any fact is false, stop this task and record the contradictory fixture evidence instead of changing the threshold.

- [ ] **Step 3: Replace only the invalid external-CSS geometry assertion**

Keep the existing zero-height canvas assertions. Replace lines that read `areaH > 300` with:

~~~ts
const editorCount = await n('#graphic-editor-render');
check(
  '#graphic-editor-render selector resolves exactly once',
  editorCount === 1,
  editorCount
);

const editorIsInert = await page.evaluate(() => {
  const editor = document.querySelector('#graphic-editor-render');
  return editor?.closest('[inert]') !== null;
});
check(
  '#graphic-editor-render is not inside an inert ancestor',
  editorIsInert === false,
  editorIsInert
);
~~~

Do not lower 300 to another arbitrary height. Do not change production selectors in this task.

- [ ] **Step 4: Re-run the selector gate**

Run:

~~~powershell
npm run selectors
~~~

Expected: every assertion passes; the loading-state canvas checks remain green.

- [ ] **Step 5: Commit when commit authorization exists**

~~~powershell
git add tools/verify-selectors.ts
git commit -m "test: align selector fixture with offline evidence"
~~~

Add `tools/fixtures/dom-ai-design-loading.html` only if Step 2 proved the captured fixture itself was incomplete and the file was changed with real captured evidence.

---

### Task 12: Run Full Verification, Update Source-Of-Truth Documentation, And Report Residual Risk

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/AUTOMATION-ENGINE.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-09-05-continuous-automation-performance-design.md`
- Create: `docs/superpowers/reports/2026-09-05-continuous-automation-performance-verification.md`

**Interfaces:**

- Consumes: every preceding task and all 16 spec acceptance criteria.
- Produces: fresh command evidence, measured stage timings, and explicit unverified live-provider status.

- [ ] **Step 1: Rebuild better-sqlite3 for the current Node ABI**

Run:

~~~powershell
npm run rebuild:node
~~~

Expected: exit code 0. If it fails, capture the exact Node version, module ABI, and rebuild error; do not describe all tests as failing.

- [ ] **Step 2: Run static and focused verification**

Run each command separately and read its complete result:

~~~powershell
npm run typecheck
npm run lint
npm run build
npm run selectors
npx vitest run src/shared/schemas/__tests__/automation.schema.test.ts
npx vitest run src/shared/schemas/__tests__/schemas.test.ts
npx vitest run src/shared/contracts/__tests__/contracts.test.ts
npx vitest run src/main/database/__tests__/migrator.test.ts
npx vitest run src/main/repositories/__tests__/purchasedEmailRepository.test.ts
npx vitest run src/main/providers/__tests__/Gmail94Provider.test.ts
npx vitest run src/main/services/__tests__/EmailPurchaseService.test.ts
npx vitest run src/main/services/__tests__/AutomationWorkSource.test.ts
npx vitest run src/renderer/pages/Dashboard/__tests__/automationConfig.test.ts
npx vitest run src/main/services/__tests__/AutomationRunService.test.ts
npx vitest run src/main/services/__tests__/ProxyLeaseManager.test.ts
npx vitest run src/main/services/__tests__/LazyProxyLeaseSource.test.ts
npx vitest run src/main/services/__tests__/automationTaskProgress.test.ts
npx vitest run src/main/services/__tests__/capcutSignupPath.test.ts
npx vitest run src/main/services/__tests__/proxyQueueIntegration.test.ts
npx vitest run src/main/services/__tests__/stageTiming.test.ts
npx vitest run src/main/services/capcut/__tests__/missionRunner.test.ts
npx vitest run src/main/services/capcut/__tests__/simple.test.ts
npx vitest run src/main/services/capcut/__tests__/taskApi.test.ts
npx vitest run src/main/services/capcut/__tests__/runTasks.test.ts
npx vitest run src/main/services/capcut/__tests__/pageRecovery.test.ts
npx vitest run src/main/services/__tests__/CapcutEngineService.test.ts
npx vitest run src/main/runtime/__tests__/providerStack.test.ts
npx vitest run src/main/ipc/__tests__/runtimeIpc.test.ts
npx vitest run src/preload/__tests__/preload.test.ts
npx vitest run src/main/__tests__/lifecycle.test.ts
npx vitest run src/main/__tests__/singleInstance.test.ts
npx vitest run src/main/__tests__/startupRecovery.test.ts
npx vitest run src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts
npx vitest run src/renderer/pages/Dashboard/__tests__/dashboardRendering.test.tsx
npx vitest run scripts/__tests__/live-capcut-options.test.mjs
node --check scripts/live-capcut-options.mjs
node --check scripts/live-capcut-run.mjs
~~~

Expected: every command exits 0 before moving to the full suites.

- [ ] **Step 3: Run the full Node suite**

Run:

~~~powershell
npm run test:node
~~~

Expected: the complete Node/Vitest suite passes while `better-sqlite3` is built
for the current Node ABI. Keep this ABI for the read-only provider check in Step
4.

- [ ] **Step 4: Perform safe read-only Gmail94 verification when credentials exist**

Run exactly this filtered live-provider command:

~~~powershell
npx vitest run --config vitest.live.config.ts src/main/providers/__live__/providers.live.test.ts -t "reads the profile and the service catalogue"
~~~

The command is safe and read-only even when `GMAIL94_API_KEY` exists because the
billable test has a different title and remains behind
`VERIFY_GMAIL94_BUY=1`. Confirm:

- profile balance parses as a finite non-negative number;
- the `capcut` service exists with a finite positive price;
- logs contain no token;
- no `createOtpOrder` request occurs.

Do not set `VERIFY_GMAIL94_BUY` and do not invoke a billable order in this task. Report exactly:

> Implemented but not verified against a billable Gmail94 order.

unless the user separately authorizes that purchase in a later request.

- [ ] **Step 5: Collect real performance evidence from a non-billable/manual or custom-domain run**

First run the Electron suite; it builds the app and leaves `better-sqlite3`
rebuilt for Electron:

~~~powershell
npm run test:electron
~~~

Only after that command passes, start Multilogin, ensure the saved
KiotProxy/custom-domain configuration is usable, then run exactly:

~~~powershell
node scripts/live-capcut-run.mjs --email=custom --threads=1 --stop-after=1 --minutes=45
~~~

This path must not set either billable provider flag. If the required local
launcher, proxy, or custom-domain configuration is unavailable, mark the live
performance row `BLOCKED` with the exact sanitized error instead of substituting
a paid Gmail94 run. Inspect canonical logs for:

- `stage=source-preflight`;
- `stage=proxy-acquisition`;
- `stage=email-acquisition`;
- `stage=browser-launch`;
- `stage=authentication-otp`;
- `stage=trial-check`;
- each `stage=mission-action:*`;
- each `stage=mission-reconciliation:*`;
- `stage=cleanup`;
- `stage=account-total`.

For the PWA stage, demonstrate that reconciliation adds no sequential second 45-second wait. Record the actual elapsed values; do not claim a fixed end-to-end speed when vendor/browser/OTP work dominates.

- [ ] **Step 6: Reconcile every acceptance criterion in a verification report**

Create `docs/superpowers/reports/2026-09-05-continuous-automation-performance-verification.md` with:

1. the git commit or working-tree revision tested;
2. one row for each acceptance criterion 1-16 from the spec;
3. the exact test/command/log evidence for each row;
4. PASS, FAIL, BLOCKED, or NOT VERIFIED status;
5. the billable Gmail94 sentence from Step 4;
6. any environment-only ABI or Electron harness issue with exact output.

Do not mark the overall implementation complete while any required criterion is FAIL.

- [ ] **Step 7: Update project documentation to runtime truth**

In `docs/AUTOMATION-ENGINE.md` add the approved evidence budgets, proof-memory rule, and one-tab replacement policy.

In `CHANGELOG.md` add these behavior changes:

- API/custom workers refill until Stop or a typed terminal condition.
- Manual mode processes all valid entries with `threadCount` as concurrency.
- Gmail94 preflight and atomic JIT reservations prevent duplicate/spurious purchases.
- Run/account outcomes remain honest through cleanup.
- PWA/notification reconciliation no longer stacks independent 45-second waits.
- Shutdown stops automation before logs and SQLite.

In `AGENTS.md` change the sentence that says the active change is not implemented to state that the runtime implementation is the source of truth only after the verification report is green.

Change the spec status to `Implemented and verified` only if all required local gates pass. Otherwise use `Implementation in progress` and link the exact failing report row.

- [ ] **Step 8: Inspect the final diff for secrets, unrelated changes, and bundle regressions**

Run:

~~~powershell
rg -n -i "api[_-]?key|token=|password=|refresh[_-]?token" src docs tools scripts --glob "!tools/fixtures/*.html"
rg -n "console\." src/main/services/capcut
rg -n "threadTotal|threadsStarted|threadsStopped|threadsFailed" src
git diff --check
git status --short
git diff --stat
~~~

Review every secret-scan match. Known schema/property names and unmistakable
test sentinels such as `GM-KEY` or `token=secret` are acceptable; real plaintext
credentials, captured authorization values, mailbox passwords, and provider
payloads are not. The legacy-counter scan must return no matches. Verify
`vite.config.ts` still externalizes `playwright-core` and `better-sqlite3`.

- [ ] **Step 9: Commit documentation only when commit authorization exists**

~~~powershell
git add AGENTS.md docs/AUTOMATION-ENGINE.md CHANGELOG.md docs/superpowers/specs/2026-09-05-continuous-automation-performance-design.md docs/superpowers/reports/2026-09-05-continuous-automation-performance-verification.md
git commit -m "docs: record continuous automation verification"
~~~

Without commit authorization, leave all changes uncommitted and report the exact working-tree paths.
