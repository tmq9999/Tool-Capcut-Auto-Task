# Headed UI Multithread 12/12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the CapCut headed UI path so three, then five, then ten concurrent workers each finish with an independently verified fresh 12/12 server receipt, while recovering one poisoned browser session without buying another mailbox or damaging other workers.

**Architecture:** Create one run-scoped FIFO UI scheduler with a single foreground lane and a single stateful-editor lane, then bind every headed browser session to it. Preserve exact proof/status checkpoints, quarantine any session with a possibly in-flight timed-out input, stop that exact profile, and allow one fresh-profile resume for the same account and proxy. Release readiness is decided by structured redacted evidence and a manual 1→3→5→10 gate; no live stage advances or purchases automatically.

**Tech Stack:** Electron, strict TypeScript, Playwright Core over Multilogin CDP, Vitest, Zod, better-sqlite3, React.

**Spec:** `docs/superpowers/specs/2026-09-08-headed-ui-multithread-12-of-12-design.md`

## Global Constraints

- Preserve the dirty worktree. Never run `git reset`, `git checkout --`, `git clean`, a broad stash, or `git add .`.
- Do not restore the same-page locator-click fallback after a timed-out mouse/CDP command.
- Do not run a browser, Electron harness, provider call, live CapCut action, or mailbox purchase until the offline tasks and gates explicitly permit it.
- Live Gmail94/DongVanFB use requires a new user approval for the exact mailbox count, an equal `maxBillablePurchases` dispatch budget, and the existing provider-specific opt-in environment flag scoped to that one process.
- Recovery budget is exactly one replacement profile per account; mission `maxRounds` remains a separate budget.
- The stateful editor lane limit remains one at worker counts 1, 3, 5, and 10 for this correctness release.
- HTTP-only behavior remains unchanged.
- A product account is complete only when a final task-list receipt is fresh and all server-observed statuses are 4. The rollout additionally requires exactly 12 distinct task keys.
- No raw email, account/profile ID, proxy endpoint, credential, OTP, CDP URL/port, cookie/token, request body/header, DOM, or screenshot may enter rollout evidence.
- Each task ends with a focused verification and an independent review checkpoint. Commit only if the user authorizes it, and stage only the named paths.

## File and responsibility map

### New files

- `src/main/services/capcut/uiInteractionScheduler.ts` — run-scoped FIFO foreground/editor scheduling and quarantine.
- `src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts` — deterministic scheduler contract.
- `src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts` — inventory guard against unscheduled direct input.
- `src/main/database/migrations/006_account_task_receipts.ts` — durable latest verification receipt per account.
- `src/main/services/capcut/runTelemetry.ts` — schema-validated, redacted JSONL run evidence.
- `src/main/services/capcut/__tests__/runTelemetry.test.ts` — forbidden-data and lifecycle telemetry tests.
- `scripts/__tests__/live-capcut-run.test.mjs` — harness process-boundary safety tests with fakes.
- `scripts/verify-rollout-evidence.mjs` — offline validator for a completed JSONL evidence artifact.
- `src/main/rolloutUserData.ts` — validates and applies an explicit rollout userData override before Electron initializes persistent services.
- `src/main/__tests__/rolloutUserData.test.ts` — bootstrap ordering and path-boundary tests.
- `src/main/services/__tests__/EmailPurchaseService.test.ts` — atomic provider-dispatch purchase-budget coverage for both billable providers.
- `docs/superpowers/reports/2026-09-08-headed-ui-rollout.md` — results template populated only by authorized runs.

### Primary modified files

- `src/main/services/capcut/runTasks.ts`, `missionRunner.ts`, `taskApi.ts`, `types.ts` — exact task status, checkpoint ordering, group scheduling metadata.
- `src/main/services/CapcutEngineService.ts` — scheduler/auth/fault threading and exact result conversion.
- `src/main/services/AutomationRunService.ts` — run scheduler owner, browser-session owner, one-session recovery loop, cleanup semantics.
- `src/main/services/capcut/human.ts` and all UI mission/auth/overlay/launcher helpers — atomic foreground gestures.
- `src/main/repositories/AccountTaskRepository.ts`, `src/main/services/AccountTaskService.ts`, shared task schema, and task progress dialog — durable fresh/stale presentation.
- `src/main/services/AutomationWorkSource.ts` and provider wiring — explicit existing-account work items that cannot acquire mail.
- `scripts/live-capcut-options.mjs`, `scripts/live-capcut-run.mjs` — explicit headed/cap/approval/health/dry-run controls.

---

### Task 1: Lock the regression characterization and protect the cutover

**Files:**
- Modify: `src/main/services/capcut/__tests__/runTasks.test.ts`
- Verify existing: `src/main/services/capcut/__tests__/boundedInteractions.test.ts`
- Update locally, never stage: `.superpowers/sdd/2026-09-06-headless-three-worker-hardening/progress.md`

**Interfaces:**
- Consumes: current `runAllTasks()`, `MissionGroupResult`, `TaskOutcome`, and `DomReadTimeoutError` behavior.
- Produces: a failing regression that proves fatal-group evidence is currently lost; a green guard that a mouse timeout never starts fallback input.

- [ ] **Step 1: Record a read-only baseline without exposing evidence contents**

Run:

```powershell
git status --short
git diff --stat
rg -n "DOM_READ_TIMEOUT|fatalError|result\.evidence|InteractionLock" src/main/services/capcut src/main/services/AutomationRunService.ts
```

Expected: the worktree is dirty; `runTasks.ts` tests `fatalError` before iterating `result.evidence`; `runTasks.bootstrap()` constructs an account-local lock. Do not alter or discard any existing diff.

- [ ] **Step 2: Add the fatal-proof RED test**

Add a test whose injected group throws `new DomReadTimeoutError('canvas-area:mouse-move')` after its fake `TaskStore` receives an `errNo: 0` proof. Have reconciliation return a stale/non-4 snapshot. The assertion must be precise:

```ts
expect(result.fatalError).toBeInstanceOf(DomReadTimeoutError);
expect(result.outcomes.find((item) => item.key === key)?.proof).toMatchObject({
  actionKey: key,
  errNo: 0,
  opId: 'proof-before-timeout'
});
expect(result.outcomes.find((item) => item.key === key)?.done).toBe(false);
```

- [ ] **Step 3: Run the RED test and preserve its failure message**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/runTasks.test.ts -t "preserves proof emitted before a fatal group timeout"
```

Expected: FAIL because the current early fatal return skips the evidence merge and `proof` is undefined.

- [ ] **Step 4: Verify the no-fallback safety guard remains green**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/boundedInteractions.test.ts
```

Expected: PASS, including the assertion that no `locator.click()`/mouse down/up follows a timed-out `mouse.move()` on the same page.

- [ ] **Step 5: Update the local progress ledger with only redacted facts**

Append the test name, expected RED result, and the current `3 authenticated / 0 completed / 3 at 6/12` aggregate. Do not write email, proxy, profile, port, or credential values.

- [ ] **Step 6: Independent review checkpoint**

Reviewer must confirm the new test observes a real proof emitted before the fatal boundary and does not make the unsafe fallback acceptable.

- [ ] **Step 7: Optional path-scoped commit after user authorization**

```powershell
git add src/main/services/capcut/__tests__/runTasks.test.ts
git commit -m "test: characterize headed timeout proof loss"
```

Expected: only the test path is staged. The `.superpowers/sdd/**` ledger is intentionally git-ignored and must remain local-only; never force-add it.

---

### Task 2: Make exact status and checkpoint ordering the sole in-memory authority

**Files:**
- Modify: `src/main/services/capcut/runTasks.ts`
- Modify: `src/main/services/capcut/missionRunner.ts`
- Modify: `src/main/services/capcut/types.ts`
- Modify: `src/main/services/capcut/cancellation.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/shared/schemas/automation.schema.ts`
- Test: `src/main/services/capcut/__tests__/runTasks.test.ts`
- Test: `src/main/services/capcut/__tests__/missionRunner.test.ts`
- Test: `src/main/services/__tests__/automationTaskProgress.test.ts`
- Test: `src/main/services/__tests__/CapcutEngineService.test.ts`
- Test: `src/shared/schemas/__tests__/automation.schema.test.ts`

**Interfaces:**
- Consumes: `TaskSnapshot.at`, `TaskSnapshot.byKey`, `ActionProof.at`, and `MissionGroupResult.actionSettledAt`.
- Produces: exact `TaskSnapshotSummary.tasks`, `TaskCheckpoint`, `CapcutVerificationReceipt`, `CapcutUiAccountResult`, `UnsettledTaskProof`, `CapcutFatalCode`, awaited `RunTasksInput.onCheckpoint`, and terminal codes needed by Tasks 3–8.

- [ ] **Step 1: Write RED tests for exact status, freshness, and merge-before-fatal**

Add these named cases:

| Test name | Fixture/action | Required assertion |
|---|---|---|
| `preserves proof emitted before a fatal group timeout` | Seed key A at status 1, emit `errNo=0/opId=proof-before-timeout`, then return `DomReadTimeoutError`. | A retains the proof, remains non-done, and is returned in `unsettledProofs`. |
| `never maps an absent snapshot key to task status 4` | Outcomes contain A while the exact snapshot contains only B at status 1. | Conversion emits B with status 1 and emits no row for A. |
| `preserves exact non-complete server statuses` | Snapshot rows contain A=1, B=2, C=4. | Persisted rows retain 1, 2, and 4 exactly. |
| `requires a task-list receipt observed after the latest action settles` | Latest action settles at 200; provide snapshots at 199 and 201. | 199 is rejected; 201 is fresh/final and becomes authority. |
| `emits a non-final checkpoint before returning a fatal result` | Capture ordered calls around a fatal group. | Evidence merge precedes awaited checkpoint; checkpoint precedes fatal return. |
| `emits a fresh final checkpoint only after the qualifying receipt` | Hold `waitForSnapshot`, then resolve a receipt newer than `requiredAfter`. | No final callback occurs while held; exactly one fresh/final callback follows resolution. |
| `keeps the shared HTTP-only result contract unchanged` | Compile/run the existing HTTP-only fake without UI verification fields. | HTTP result remains assignable to `CapcutAccountResult` and its behavior is unchanged. |

For the absent-key mapping test, assert A is absent and B retains its exact non-complete status:

```ts
expect(toTaskProgressRows(outcomes, summary)).toEqual([
  expect.objectContaining({ key: 'task-b', status: 1 })
]);
expect(toTaskProgressRows(outcomes, summary).some((row) => row.key === 'task-a')).toBe(false);
```

- [ ] **Step 2: Run the focused RED set**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/shared/schemas/__tests__/automation.schema.test.ts
```

Expected: FAIL on missing exact snapshot rows, missing awaited checkpoint callback, missing UI-specific verification result, unsettled proof handling, and early fatal return.

- [ ] **Step 3: Introduce the exact contracts**

Use these shapes consistently; do not introduce alternate field names in later tasks:

```ts
export type CapcutFatalCode = 'DOM_READ_TIMEOUT';

export interface SnapshotTaskSummary {
  key: string;
  title: string;
  reward: number;
  status: number;
}

export interface TaskSnapshotSummary {
  observedAt: number;
  requiredAfter: number;
  tasks: SnapshotTaskSummary[];
  total: number;
  done: number;
  credits: number;
  creditsTotal: number;
  missing: string[];
  fresh: boolean;
  final: boolean;
}

export interface TaskCheckpoint {
  outcomes: TaskOutcome[];
  snapshot: TaskSnapshotSummary;
}

export interface CapcutVerificationReceipt {
  runId: string;
  sessionAlias: string;
  observedAt: string;
  requiredAfter: string;
  fresh: boolean;
  final: boolean;
  serverTotal: number;
  serverDone: number;
  complete: boolean;
}

export interface UnsettledTaskProof {
  key: string;
  proof: ActionProof & { errNo: 0 };
}

export interface CapcutUiAccountResult extends CapcutAccountResult {
  authenticated: boolean;
  verification: CapcutVerificationReceipt | null;
  fatalCode?: CapcutFatalCode;
  unsettledProofs: UnsettledTaskProof[];
}
```

Extend `RunTasksInput` with `runId`, `sessionAlias`, `sessionStartedAt`, and:

```ts
unsettledProofs: readonly UnsettledTaskProof[];
onCheckpoint: (checkpoint: TaskCheckpoint) => Promise<void>;
```

Keep `CapcutAccountResult` unchanged so `HttpOnlyAccountRunner` remains source-compatible. Change only `CapcutTaskRunner.runAccount()` to return `Promise<CapcutUiAccountResult>` and add both required fields below:

```ts
unsettledProofs: readonly UnsettledTaskProof[];
onTaskCheckpoint: (checkpoint: {
  rows: CapcutAccountResult['tasks'];
  receipt: CapcutVerificationReceipt;
}) => Promise<void>;
```

All UI return paths populate `authenticated` and `unsettledProofs`. Discovery-only and trial-skip paths return `verification: null`; no generic UI completion branch may accept a null receipt.

- [ ] **Step 4: Add typed fault classification without message matching**

In `cancellation.ts` add:

```ts
export function isDomReadTimeout(error: unknown): error is DomReadTimeoutError {
  return error instanceof DomReadTimeoutError ||
    (error instanceof Error && (error as { code?: unknown }).code === 'DOM_READ_TIMEOUT');
}
```

Use this guard at the engine boundary to set `fatalCode: 'DOM_READ_TIMEOUT'`. Keep the sanitized `fatalError` string for logs only.

In the shared terminal schema, add `TASK_CHECKPOINT_PERSISTENCE_FAILED` and `RESOURCE_CLEANUP_FAILED` to `AutomationTerminalCodeEnum`, with schema tests proving both parse and an unknown code still rejects. Construct failures with the existing `AutomationTerminalError`; do not invent a parallel error class. Task 3 uses the persistence code, and Tasks 4–8 use the cleanup code.

- [ ] **Step 5: Extract one evidence merge and call it before fatal branching**

In `runTasks.ts`, create one function used for both normal and fatal groups:

```ts
export function mergeGroupEvidence(
  outcomes: Map<string, TaskOutcome>,
  proofBacked: Set<string>,
  evidence: ReadonlyMap<string, MissionEvidence>,
  log: (message: string) => void
): void;
```

The group order must be:

```ts
const result = await runGroup(group, env, store, need);
if (result.snapshot) snap = result.snapshot;
mergeGroupEvidence(outcomes, proofBacked, result.evidence, log);
await emitCheckpoint(false, result.actionSettledAt);
if (result.fatalError) return fatalResult;
```

No UI action may run between detecting the fatal result and returning it.

Build `unsettledProofs` only from current-run outcomes whose proof has `errNo === 0` and whose matching exact snapshot task is absent or has status other than 4. Do not load historical database proof into this array.

- [ ] **Step 6: Summarize the exact server task rows**

Build the stable array from `snapshot.byKey`:

```ts
tasks: [...snapshot.byKey.values()].map((task) => ({
  key: task.taskKey,
  title: task.title,
  reward: task.reward,
  status: task.status
}))
```

`toTaskProgressRows()` must iterate `snapshot.tasks` and enrich each row by looking up the matching outcome/proof by key. It emits no synthetic row for an outcome absent from the snapshot. Copy status 1, 2, or 4 exactly and preserve `opId`/`provedAt` independently from status.

- [ ] **Step 7: Require a final receipt newer than the latest settled action**

Track:

```ts
let requiredAfter = input.sessionStartedAt;
requiredAfter = Math.max(requiredAfter, result.actionSettledAt);
```

At the end, accept the current snapshot only when `snap.at > requiredAfter`. Otherwise wait for `store.waitForSnapshot(requiredAfter, FINAL_SNAPSHOT_WAIT_MS, signal)`. A timeout returns a receipt with `fresh: false`, `final: false`, and `complete: false`; it never reuses an older complete snapshot as final. On a fatal path, do not trigger new UI—emit a non-final checkpoint from the latest known snapshot and return.

- [ ] **Step 8: Thread checkpoints through the engine and service**

`CapcutEngineService.runAccount()` passes `runId`, `sessionAlias`, `sessionStartedAt`, `unsettledProofs`, and `onCheckpoint` to `runAllTasks()`. Convert each checkpoint with `toTaskProgressRows()` and await an account-bound callback supplied by `AutomationRunService`. The callback cannot choose a different account ID.

To keep Task 2 independently compilable before Task 3 changes persistence, use this explicit temporary adapter at the service boundary:

```ts
onTaskCheckpoint: async ({ rows }) => {
  this.recordTaskProgress(thread, rows);
}
```

Task 3 replaces that adapter with the awaited transactional receipt sink before recovery is introduced. Update every direct `runAllTasks()`/runner test fixture to pass `unsettledProofs: []` and an async no-op checkpoint unless the test inspects it.

- [ ] **Step 9: Make completion use the receipt**

Normalize transport and split the completion path explicitly. Retain the existing HTTP-only completion rule; only a `CapcutUiAccountResult` uses:

```ts
const full = result.verification !== null &&
  result.verification.complete &&
  result.verification.fresh &&
  result.verification.final;
```

Do not access `verification` from the HTTP-only branch. Do not require total 12 in generic product code; the rollout validator enforces 12 because CapCut may expose different task sets to other accounts.

- [ ] **Step 10: Run focused GREEN verification**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/shared/schemas/__tests__/automation.schema.test.ts
```

Expected: PASS; fatal proof survives, absent keys never become done, and stale complete snapshots cannot complete an account.

- [ ] **Step 11: Independent review checkpoint**

Reviewer traces one proof and one stale snapshot from `TaskStore` through `runTasks`, engine conversion, service checkpoint, and outcome. Reject if any layer infers done from absence or from `outcome.done` alone.

- [ ] **Step 12: Optional path-scoped commit after user authorization**

```powershell
git add src/main/services/capcut/runTasks.ts src/main/services/capcut/missionRunner.ts src/main/services/capcut/types.ts src/main/services/capcut/cancellation.ts src/main/services/CapcutEngineService.ts src/main/services/AutomationRunService.ts src/shared/schemas/automation.schema.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/shared/schemas/__tests__/automation.schema.test.ts
git commit -m "fix: preserve exact task evidence across UI faults"
```

---

### Task 3: Persist verification receipts and stop the UI from showing stale 12/12

**Files:**
- Create: `src/main/database/migrations/006_account_task_receipts.ts`
- Modify: `src/main/database/migrations/index.ts`
- Modify: `src/main/repositories/AccountTaskRepository.ts`
- Modify: `src/main/runtime/providerStack.ts`
- Modify: `src/main/services/AccountTaskService.ts`
- Modify: `src/shared/schemas/account-task.schema.ts`
- Modify: `src/renderer/pages/Accounts/TaskProgressDialog.tsx`
- Test: `src/main/database/__tests__/migrator.test.ts`
- Test: `src/main/repositories/__tests__/accountTaskRepository.test.ts`
- Test: `src/main/services/__tests__/AccountTaskService.test.ts`
- Create or modify: `src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx`

**Interfaces:**
- Consumes: `TaskCheckpoint` and `CapcutVerificationReceipt` from Task 2.
- Produces: `AccountTaskCheckpointInput`, `AccountTaskReceiptRecord`, `AccountTaskReceiptItemRecord`, throwing `AccountTaskRepository.recordCheckpoint()`, and response-level `verification` state based only on the exact receipt item set.

- [ ] **Step 1: Write migration/repository/service/UI RED tests**

Implement the cases below exactly:

| Test name | Fixture/action | Required assertion |
|---|---|---|
| `migration 006 adds one latest task receipt and exact item table without losing task rows` | Apply migrations 1–5, insert one task row, then apply migration 6. | The task row is unchanged; receipt and receipt-item tables exist with the documented primary keys. |
| `records task rows and their exact receipt set in one transaction` | Call `recordCheckpoint('acc-1', ...)` with A=4 and B=1 plus a fresh non-final receipt. | Historical rows, one matching receipt, and receipt items exactly `{A:4,B:1}` are readable. |
| `transactionally replaces the prior receipt item set` | Record `{A:4,B:1}`, then a newer receipt containing only `{A:4,C:2}`. | Receipt items are exactly A and C; historical `account_tasks` may still retain B but verification ignores it. |
| `keeps prior opId and provedAt when a later snapshot has no new proof` | Record a proved row, then record the same key with no proof fields. | The second server status is stored while the first `opId` and `provedAt` remain. |
| `rolls back rows receipt and receipt items when any write fails` | Make the second row violate `title NOT NULL` in a checkpoint that also contains a receipt. | No task row, receipt, or receipt item from that checkpoint exists after the thrown error. |
| `throws checkpoint persistence failures to the caller` | Inject the repository failure through the production sink. | The awaited sink rejects with the typed persistence error; it is never silently converted to success. |
| `returns unverified for legacy task rows with no receipt` | Insert twelve status-4 rows through legacy `upsertMany()` only. | Service state is `missing`, never `verified`. |
| `ignores historical rows outside the latest receipt` | Keep twelve old status-4 rows but record a latest receipt containing six status-4 and six status-1 items. | State is partial 6/12, never verified. |
| `returns only the latest receipt task set to the dialog` | Keep historical B, then replace receipt set with A and C. | Response/display items are exactly A and C in snapshot order; B is absent. |
| `shows the server total instead of a hard-coded twelve` | Render a fresh partial receipt with `serverDone=6`, `serverTotal=10`. | Dialog renders `6/10` and contains no `/12`. |
| `never labels a stale complete receipt as verified` | Render twelve status-4 rows with `isFresh=false`. | Dialog renders the stale/unverified label and no verified label. |

- [ ] **Step 2: Run the RED set**

Run:

```powershell
npx vitest run src/main/database/__tests__/migrator.test.ts src/main/repositories/__tests__/accountTaskRepository.test.ts src/main/services/__tests__/AccountTaskService.test.ts src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx
```

Expected: FAIL because migration 006, receipt APIs, response fields, and dynamic UI text do not exist.

- [ ] **Step 3: Add migration 006 and register version 6**

Use exactly both tables from the design spec. Add the registry item:

```ts
{
  version: 6,
  name: '006_account_task_receipts',
  sql: migration006
}
```

Do not modify migration 004 or 005; their checksums may already be installed in user databases.

- [ ] **Step 4: Implement the repository checkpoint transaction**

Add:

```ts
export interface AccountTaskCheckpointInput {
  rows: readonly AccountTaskProgressInput[];
  receipt: Omit<AccountTaskReceiptRecord, 'accountId' | 'updatedAt'>;
}

export interface AccountTaskReceiptRecord {
  accountId: string;
  runId: string;
  sessionAlias: string;
  observedAt: string;
  requiredAfter: string;
  serverTotal: number;
  serverDone: number;
  isFresh: boolean;
  isFinal: boolean;
  updatedAt: string;
}

export interface AccountTaskReceiptItemRecord {
  accountId: string;
  taskKey: string;
  status: number;
  ordinal: number;
}

recordCheckpoint(accountId: string, checkpoint: AccountTaskCheckpointInput): void;
getLatestReceipt(accountId: string): {
  receipt: AccountTaskReceiptRecord;
  items: AccountTaskReceiptItemRecord[];
} | null;
```

Reuse the existing row upsert SQL inside one `better-sqlite3` transaction and retain `COALESCE(excluded.op_id, account_tasks.op_id)` plus the equivalent `proved_at` expression. Within that transaction: upsert historical task rows, upsert the account receipt, delete prior receipt items for that account, then insert exactly one item per current snapshot task. Validate `serverTotal === receiptItems.length` before starting the transaction; duplicate task keys throw.

- [ ] **Step 5: Upgrade the task-progress sink atomically**

Change the service collaborator to:

```ts
export interface ICapcutTaskProgressSink {
  record(accountId: string, checkpoint: {
    rows: CapcutAccountResult['tasks'];
    receipt: CapcutVerificationReceipt;
  }): Promise<void>;
}
```

In `providerStack.ts`, bind it to `AccountTaskRepository.recordCheckpoint()` and resolve only after its transaction commits. Catch repository details and throw only:

```ts
throw new AutomationTerminalError(
  'failed',
  { code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED' },
  'Không lưu được checkpoint nhiệm vụ.'
);
```

Never include the SQLite message or account identifier and never swallow the error. Non-recovery UI refreshes may have a separate explicitly named best-effort notifier, but the checkpoint used by the engine/recovery state machine is always durable and awaited.

- [ ] **Step 6: Add response verification state**

Extend the shared response with:

```ts
verification: z.object({
  state: z.enum(['verified', 'partial', 'stale', 'missing']),
  runId: z.string().nullable(),
  observedAt: z.string().nullable(),
  serverTotal: z.number().int().min(0),
  serverDone: z.number().int().min(0)
}).strict()
```

`AccountTaskService` returns `verified` only when the latest receipt is fresh and final, `serverTotal === receiptItems.length`, `serverDone === receiptItems.filter(status === 4).length`, keys are unique, and every receipt item status is 4. When a receipt exists, response `items` are built only from its exact keys/statuses, joined to `account_tasks` for title/reward/proof; a missing joined task row makes the receipt stale. Preserve snapshot insertion order with an `ordinal` integer on `account_task_receipt_items` and return by ordinal. Historical rows outside the receipt are neither verification input nor dialog items. A legacy account with no receipt may still return its historical rows for inspection but its state is `missing`. Any inconsistency is `stale`, not verified.

- [ ] **Step 7: Replace `/12` in the dialog**

Delete `CAPCUT_TASK_TOTAL`. Render `serverDone/serverTotal` when a receipt exists and a translated badge for the four verification states. A legacy/missing receipt shows `Chưa xác minh` even if task rows happen to contain twelve status-4 records.

- [ ] **Step 8: Run focused GREEN verification**

Run:

```powershell
npx vitest run src/main/database/__tests__/migrator.test.ts src/main/repositories/__tests__/accountTaskRepository.test.ts src/main/services/__tests__/AccountTaskService.test.ts src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx src/main/services/__tests__/automationTaskProgress.test.ts
```

Expected: PASS with exact-set replacement, atomic rollback, thrown persistence failures, legacy stale handling, and dynamic totals.

- [ ] **Step 9: Independent review checkpoint**

Reviewer must inspect the migration registry order, prove no old migration checksum changed, and verify that a complete legacy row set cannot render as verified without a receipt.

- [ ] **Step 10: Optional path-scoped commit after user authorization**

```powershell
git add src/main/database/migrations/006_account_task_receipts.ts src/main/database/migrations/index.ts src/main/repositories/AccountTaskRepository.ts src/main/runtime/providerStack.ts src/main/services/AccountTaskService.ts src/shared/schemas/account-task.schema.ts src/renderer/pages/Accounts/TaskProgressDialog.tsx src/main/database/__tests__/migrator.test.ts src/main/repositories/__tests__/accountTaskRepository.test.ts src/main/services/__tests__/AccountTaskService.test.ts src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx
git commit -m "fix: persist fresh CapCut task receipts"
```

---

### Task 4: Build the run-scoped FIFO UI scheduler in isolation

**Files:**
- Create: `src/main/services/capcut/uiInteractionScheduler.ts`
- Create: `src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts`
- Modify: `src/main/services/capcut/types.ts`

**Interfaces:**
- Consumes: `AbortSignal`, `isDomReadTimeout()`.
- Produces: `RunUiInteractionScheduler`, `AccountUiInteraction`, `UiSchedulerEvent`, and session quarantine semantics used by Tasks 5–9.

- [ ] **Step 1: Write all scheduler RED tests before implementation**

Use deferred promises, fake timers only for time measurements, and no browser. Implement this matrix:

| Test name | Controlled sequence | Required assertion |
|---|---|---|
| `admits foreground tickets in strict FIFO order` | A holds; enqueue B then C; resolve A, B, C. | Start order is A, B, C and peak foreground activity is one. |
| `removes an aborted queued ticket without invoking it` | A holds; enqueue B and C; abort B; release A. | B rejects, its callback count is zero, and C starts next. |
| `enforces the configured editor capacity and FIFO admission` | Run the same A/B/C sequence with limits one and two. | Peak active is one/two respectively; start admission retains queue order. |
| `keeps foreground quarantined after DOM_READ_TIMEOUT` | A throws `DomReadTimeoutError`; B is queued. | A rejects and B remains pending until exact cleanup confirmation. |
| `releases quarantine only for the exact stopped session alias` | A quarantines; confirm C, then confirm A. | Confirmation for C changes nothing; confirmation for A starts B. |
| `does not release quarantine when profile stop is never confirmed` | A quarantines; advance all fake timers. | B never starts and scheduler snapshot still names A's alias. |
| `quarantines an active operation aborted after it starts` | Start A, abort A's signal, enqueue B. | A rejects and B waits for A cleanup confirmation. |
| `rejects the caller promptly and absorbs a late active settlement` | Start A with a deferred operation, abort A, observe its caller, then resolve the operation. | Caller rejects before resolution; late resolution causes no unhandled rejection, state mutation, release, or new event except one sanitized `late-settled`. |
| `treats abort concurrent with operation resolution as unsafe` | Resolve A and abort its signal in the same controlled turn, then queue B. | A does not release foreground normally; B waits for exact profile-stop confirmation. |
| `does not quarantine an operation aborted while still queued` | A holds; enqueue then abort B; enqueue C. | B callback never starts; after A releases, C runs without cleanup confirmation for B. |
| `releases normally after an ordinary non-session error` | A throws a normal `Error`; B is queued. | B starts immediately after A rejects and quarantine list is empty. |
| `does not starve a foreground waiter behind later tickets` | Hold A, enqueue B, then enqueue 100 later tickets. | B is the first admitted after A and every later ticket eventually settles. |
| `shutdown drains both queues and rejects future acquisitions` | Hold A, queue B foreground and C editor, then call `shutdown(resourceError)`. | B and C reject with the same sanitized terminal code, callbacks never run, future tickets reject, and snapshots report zero queued work. |
| `shutdown is idempotent while an unsafe operation settles late` | Quarantine A, call shutdown twice, then reject A's old operation. | One shutdown event exists, no unhandled rejection occurs, and no ticket is admitted. |
| `direct interaction checks cancellation and does not schedule` | Create a direct facade, run both lanes once, then abort and try both again. | First callbacks run immediately; aborted callbacks never run and reject with the signal reason. |

- [ ] **Step 2: Run the scheduler RED test**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts
```

Expected: FAIL because the scheduler module does not exist.

- [ ] **Step 3: Define the public scheduler contract exactly once**

Use the interfaces in the design spec. Define events as a discriminated union containing only aliases and timings:

```ts
export type UiSchedulerEvent =
  | { type: 'queued'; lane: UiLane; sessionAlias: string; label: string; at: number }
  | { type: 'started'; lane: UiLane; sessionAlias: string; label: string; waitMs: number; at: number }
  | { type: 'finished'; lane: UiLane; sessionAlias: string; label: string; holdMs: number; at: number }
  | { type: 'quarantined'; sessionAlias: string; label: string; code: 'DOM_READ_TIMEOUT' | 'ACTIVE_ABORT'; at: number }
  | { type: 'profile-stopped'; sessionAlias: string; at: number }
  | { type: 'late-settled'; sessionAlias: string; label: string; outcome: 'resolved' | 'rejected'; at: number }
  | { type: 'shutdown'; code: 'RESOURCE_CLEANUP_FAILED' | 'RUN_ABORTED'; at: number };
```

`UiSessionIdentity` contains only `sessionAlias` and `signal`; account ID is neither required nor accepted. Do not include email, account ID, profile ID, proxy, or port in events.

- [ ] **Step 4: Implement cancellable FIFO queues**

Implement a small private queue for each lane. A ticket has `started=false` until admission. Abort before admission removes/rejects it. After admission, race `operationPromise` against an abort promise; abort rejects the caller promptly and marks foreground unsafe. Attach resolve/reject handlers to `operationPromise` before racing so late settlement is absorbed and can emit only the sanitized `late-settled` event. Editor tickets always release their capacity in `finally`; the foreground ticket intentionally does not release after an unsafe fault.

The key foreground branch must be equivalent to:

```ts
try {
  ticket.started = true;
  const operationPromise = Promise.resolve().then(operation);
  observeLateSettlement(operationPromise, ticket);
  const value = await Promise.race([operationPromise, rejectOnAbort(signal)]);
  if (signal.aborted) throw signal.reason ?? new Error('Aborted');
  return value;
} catch (error) {
  if (isDomReadTimeout(error) || (ticket.started && signal.aborted)) {
    quarantine(sessionAlias, isDomReadTimeout(error) ? 'DOM_READ_TIMEOUT' : 'ACTIVE_ABORT');
    releaseNormally = false;
  }
  throw error;
} finally {
  if (releaseNormally) releaseForeground();
}
```

`confirmProfileStopped(alias)` releases only if that exact alias owns the quarantine. Calls for another alias are no-ops and are covered by tests.

`shutdown(reason)` stores one sanitized terminal error, rejects and removes every queued ticket in both lanes, prevents new admission, and is idempotent. It does not own thread abort controllers and does not pretend to cancel an already-running browser promise. `AutomationRunService` must abort its controllers and stop every captured session after invoking scheduler shutdown.

Export the headless/non-scheduled facade from the same module:

```ts
export function createDirectUiInteraction(signal: AbortSignal): AccountUiInteraction {
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    return operation();
  };
  return {
    foreground: (_label, operation) => run(operation),
    editor: (_label, operation) => run(operation)
  };
}
```

This helper is for headless UI and explicit unit-test injection only. It never appears in a headed production session.

- [ ] **Step 5: Run scheduler GREEN verification**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts
```

Expected: PASS with no pending promises or fake timers after each test.

- [ ] **Step 6: Independent review checkpoint**

Reviewer must model these races explicitly: queued abort, active abort, timeout then late operation resolution/rejection, wrong-session stop confirmation, shutdown with both queues populated, and confirmation arriving before another waiter queues. Reject any implementation that releases a timed-out foreground lease in an unconditional `finally`, leaves a rejected promise unobserved, or can admit work after shutdown.

- [ ] **Step 7: Optional path-scoped commit after user authorization**

```powershell
git add src/main/services/capcut/uiInteractionScheduler.ts src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts src/main/services/capcut/types.ts
git commit -m "feat: add run-scoped headed UI scheduler"
```

---

### Task 5: Refactor browser ownership from thread scope to session scope

**Files:**
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/capcut/launcher/BrowserLauncher.ts`
- Modify: `src/main/services/capcut/launcher/ApiV3Launcher.ts`
- Modify: `src/main/services/capcut/launcher/XcliLauncher.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`
- Test: `src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts`
- Test: `src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts`

**Interfaces:**
- Consumes: `RunUiInteractionScheduler.forSession()`, `confirmProfileStopped()`, and `shutdown()` from Task 4.
- Produces: `BrowserSessionRuntime`, `launchSession()`, and `stopSession(thread, exactSession)`; existing one-session behavior remains unchanged until Task 8.

- [ ] **Step 1: Write session-ownership RED tests**

Add these cases around the existing fake launcher:

| Test name | Controlled sequence | Required assertion |
|---|---|---|
| `stops the exact session once when Stop races final cleanup` | Global Stop and iteration cleanup both call stop while one stop promise is pending. | The exact profile has one stop call and both callers receive the same result. |
| `does not reuse the old stop promise for a replacement session` | Stop profile A successfully, install profile B, then perform final cleanup. | Stop calls are exactly `profile-a`, `profile-b` in that order. |
| `retains ownership when profile id is published before attach rejects` | Launcher calls `onProfileStarted('profile-a')`, then rejects attachment. | Cleanup still stops `profile-a` once and active ownership settles to zero. |
| `removes a session only after its profile stop succeeds` | Hold the fake stop promise unresolved. | `thread.session` remains the exact session until resolution, then clears. |
| `keeps a failed-stop session addressable and does not confirm scheduler cleanup` | Reject the stop promise. | Session remains visible as uncertain ownership for reporting, cleanup failure increments, no second automated stop dispatch occurs, and scheduler confirmation count is zero. |
| `defers Stop requested before profile id and stops the late profile exactly once` | Hold launcher before `onProfileStarted`, request Stop, then publish profile A. | `stopRequested` is retained; A is stopped immediately once; page never reaches mission code. |
| `settles pre-id Stop when launch fails without creating a profile` | Request Stop, then reject launch before any profile callback. | Stop settles successfully with zero provider stop calls and ownership clears only after launch is settled. |
| `fails closed when pre-id launch never settles after Stop` | Request Stop while launch and profile publication both remain pending beyond the lifecycle deadline. | Scheduler shuts down, waiters drain, terminal code is `RESOURCE_CLEANUP_FAILED`, and the session remains reported as uncertain. |
| `fails closed when the exact profile stop never settles` | Publish profile A, request Stop, and hold provider stop beyond its deadline. | One provider stop call occurs, no quarantine confirmation is sent, and the run terminates with uncertain ownership. |
| `turns failed profile stop into run-terminal scheduler shutdown` | Queue work for another session, then reject A's stop. | Scheduler drains/rejects queued work, all thread signals abort, other session cleanup is attempted, and terminal code is `RESOURCE_CLEANUP_FAILED`. |

The replacement-session characterization may call a test-only helper or exercise two sequential `launchSession()` calls. Assert `stopCalls` is exactly `['profile-a', 'profile-b']`, not only `['profile-a']`.

- [ ] **Step 2: Run the RED lifecycle tests**

Run:

```powershell
npx vitest run src/main/services/__tests__/AutomationRunService.test.ts -t "session|replacement|published before attach"
```

Expected: FAIL because `profileStopPromise`, page, context, port, and launcher are currently cached on `ThreadRuntime`.

- [ ] **Step 3: Introduce `BrowserSessionRuntime` and stable thread fields**

Use this internal shape:

```ts
interface BrowserSessionRuntime {
  alias: string;
  startedAt: number;
  launchPromise?: Promise<void>;
  stopRequested: boolean;
  profileId?: string;
  port?: number | null;
  page?: CapcutPage;
  context?: CapcutContext;
  launcher?: BrowserLauncher;
  ui: AccountUiInteraction;
  scheduler?: RunUiInteractionScheduler;
  profileStopPromise?: Promise<boolean>;
  stopPromise?: Promise<boolean>;
  stopFailed?: boolean;
}

interface ThreadRuntime {
  runId: string;
  workerAlias: string;
  accountId: string;
  email: string;
  capcutPassword: string;
  purchasedEmailId?: string;
  lease?: AcquiredProxyLease;
  directProxy?: BrowserProxySettings;
  session?: BrowserSessionRuntime;
  sessionSequence: number;
  sessionRecycleCount: number;
  outcomeStep?: string;
  outcome?: ThreadOutcome;
  completionPromise?: Promise<void>;
  notifyDone?: () => void;
}
```

Delete the flat `profileId`, `port`, `page`, `context`, `launcher`, `profileStopPromise`, and `profileStopFailed` fields after all call sites compile against `thread.session`.

- [ ] **Step 4: Create one scheduler per headed UI run**

In `runPrepared()`, normalize the optional transport. Omit the optional event callback until Task 9 wires telemetry; do not call a nonexistent `this.recordUiEvent()` here:

```ts
const missionTransport = config.missionTransport ?? 'ui';
const uiScheduler = missionTransport !== 'http-only' && !config.headless
  ? new RunUiInteractionScheduler({ editorLaneLimit: 1 })
  : null;
```

Pass the same instance to every `workerLoop()`. For headless UI, use a direct facade whose `foreground()` and `editor()` invoke the operation without cross-worker serialization. HTTP-only creates neither facade nor scheduler.

- [ ] **Step 5: Replace `launchThread()` with session installation before launch**

Create the alias without account/profile data:

```ts
const alias = `${thread.workerAlias}-session-${++thread.sessionSequence}`;
const session: BrowserSessionRuntime = {
  alias,
  startedAt: Date.now(),
  stopRequested: false,
  ui: uiScheduler
    ? uiScheduler.forSession({ sessionAlias: alias, signal })
    : createDirectUiInteraction(signal),
  scheduler: uiScheduler ?? undefined
};
thread.session = session;
```

Assign a void wrapper around the launcher invocation to `session.launchPromise`; the wrapper installs page/context/port only on the captured session and then resolves. The launcher contract guarantees that any created profile is published through `onProfileStarted(profileId)` before `launchPromise` settles. The callback writes to the captured `session`, never whatever session is currently on the thread. If `session.stopRequested` is already true, it immediately starts the session's cached `profileStopPromise`; the page/context is never published to mission code. A late launch result may fill only that same object and cannot resurrect a removed or replaced `thread.session`.

- [ ] **Step 6: Implement exact-session stop**

Use one cached promise per session:

```ts
private stopSession(thread: ThreadRuntime, session: BrowserSessionRuntime): Promise<boolean> {
  session.stopRequested = true;
  if (session.stopPromise) return session.stopPromise;
  session.stopPromise = this.stopSessionWhenOwnershipSettles(thread, session);
  return session.stopPromise;
}
```

Use exact constants `SESSION_LAUNCH_STOP_GRACE_MS = 30_000` and `PROFILE_STOP_TIMEOUT_MS = 60_000`; tests use injected clocks/deadlines rather than sleeping. `stopSessionWhenOwnershipSettles()` waits at most the launch-stop grace for the captured launch lifecycle/profile publication. If launch settles and no profile was ever published, it succeeds without a provider stop call. If a profile exists, it awaits the single `profileStopPromise`—possibly already started by `onProfileStarted`—for at most the profile-stop timeout. On success, call `session.scheduler?.confirmProfileStopped(session.alias)` and clear `thread.session` only when `thread.session === session`. Keep the thread in `activeThreads` across an intermediate recovery gap so `stopThread(accountId)` can still abort it before replacement launch. Remove it only from final `cleanupIteration()`.

An expired lifecycle/stop deadline is an uncertain cleanup failure, not permission to forget the session or issue another automated stop. Absorb any late launcher/stop settlement so it cannot mutate ownership or telemetry.

On failed or uncertain profile stop, retain the session and never confirm scheduler cleanup. Create `new AutomationTerminalError('failed', { code: 'RESOURCE_CLEANUP_FAILED', details: { cleanupFailures } }, sanitizedMessage)`, call `scheduler.shutdown(error)` to drain/reject tickets, then have `AutomationRunService` abort every owned thread controller, attempt best-effort cleanup of every other captured session, and force that terminal run state. The terminal publisher must not await a scheduler ticket that has just been quarantined.

- [ ] **Step 7: Update all readers and cleanup paths**

Change `getRunningThreads()`, `stopThread()`, global `stop()`, `cleanupIteration()`, account browser metadata, and logs to read `thread.session?.profileId`. `startedProfiles` may remain an audit list, but it must not be the ownership authority.

- [ ] **Step 8: Run lifecycle GREEN verification**

Run:

```powershell
npx vitest run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts
```

Expected: PASS; every captured profile has one stop owner, pre-ID Stop cannot orphan a late profile, stop failure terminates/drains the run, and old stop promises cannot affect a later session.

- [ ] **Step 9: Independent review checkpoint**

Reviewer traces four races: Stop during launch before profile ID, Stop after profile ID before attach, recovery stop versus global Stop, and late launch resolution. Reject if any cleanup reads mutable `thread.session.profileId` after capturing a different session.

- [ ] **Step 10: Optional path-scoped commit after user authorization**

```powershell
git add src/main/services/AutomationRunService.ts src/main/services/capcut/launcher/BrowserLauncher.ts src/main/services/capcut/launcher/ApiV3Launcher.ts src/main/services/capcut/launcher/XcliLauncher.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts
git commit -m "refactor: scope browser ownership to sessions"
```

---

### Task 6: Route every production focus and input path through the session facade

**Files:**
- Modify: `src/main/services/capcut/human.ts`
- Modify: `src/main/services/capcut/rendererHealth.ts`
- Modify: `src/main/services/capcut/auth.ts`
- Modify: `src/main/services/capcut/login.ts`
- Modify: `src/main/services/capcut/signup.ts`
- Modify: `src/main/services/capcut/trial.ts`
- Modify: `src/main/services/capcut/overlays.ts`
- Modify: `src/main/services/capcut/steps.ts`
- Modify: `src/main/services/capcut/missionRunner.ts`
- Modify: `src/main/services/capcut/missions/simple.ts`
- Modify: `src/main/services/capcut/missions/designStudio.ts`
- Modify: `src/main/services/capcut/missions/videoStudio.ts`
- Modify: `src/main/services/capcut/runTasks.ts`
- Modify: `src/main/services/capcut/types.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/capcut/launcher/BrowserLauncher.ts`
- Modify: `src/main/services/capcut/launcher/ApiV3Launcher.ts`
- Modify: `src/main/services/capcut/launcher/XcliLauncher.ts`
- Delete after migration: `src/main/services/capcut/interactionLock.ts`
- Delete after migration: `src/main/services/capcut/__tests__/interactionLock.test.ts`
- Create: `src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts`
- Modify focused tests under: `src/main/services/capcut/__tests__/`

**Interfaces:**
- Consumes: session-bound `AccountUiInteraction` from Tasks 4–5.
- Produces: required `CapcutMissionEnv.ui`, explicit `MissionGroup.workspace`, atomic `humanClick()`/`humanType()`, and complete production-path coverage.

- [ ] **Step 1: Add metadata and coverage RED tests**

Extend `MissionGroup` with stable metadata instead of display-name matching:

```ts
export interface MissionGroup {
  id: 'pwa-install' | 'notifications' | 'design-studio' | 'video-studio';
  name: string;
  workspace: 'none' | 'editor';
  keys: string[];
  proofTimeoutMs: number;
  act(env: CapcutMissionEnv, need: Set<string>): Promise<void>;
}
```

Create a coverage test that parses only the production files listed above with the installed TypeScript compiler API and inspects `CallExpression` nodes for direct input forms: `.click(`, `.press(`, `.type(`, `.fill(`, `.hover(`, `.mouse.`, `.keyboard.`, `.bringToFront(`, `Browser.setWindowBounds`, and `setViewportSize(`. Allow a direct operation only inside the explicitly reviewed low-level adapters `foregroundPage`, `humanClickUnlocked`, and `humanTypeUnlocked` in `human.ts`; inside `configureHeadedWindowUnlocked` in `BrowserLauncher.ts`; or when an ancestor arrow/function expression is the operation argument of `ui.foreground(...)`. The test resolves source symbols/function ancestry with the compiler API, prints file and line for every violation, and does not use regex-only ancestry checks.

Also add unit tests that assert the four built-in groups expose the correct IDs/workspace values and no code uses `group.name.includes(...)` to choose workspace behavior.

- [ ] **Step 2: Run coverage RED verification**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts
```

Expected: FAIL with violations in launchers, auth, login, signup, trial, overlays, mission runner, simple missions, Design, Video, and shared steps.

- [ ] **Step 3: Make complete human gestures atomic without recursive locking**

Extend options:

```ts
export interface HumanInteractionOptions {
  signal: AbortSignal;
  stage: string;
  ui: AccountUiInteraction;
  log?: (message: string) => void;
}
```

Split private unlocked implementations:

```ts
export function foregroundPage<T>(
  page: Page,
  options: Pick<HumanInteractionOptions, 'signal' | 'stage' | 'ui'>,
  operation: () => Promise<T>
): Promise<T> {
  return options.ui.foreground(options.stage, async () => {
    options.signal.throwIfAborted();
    await page.bringToFront();
    options.signal.throwIfAborted();
    return operation();
  });
}

async function humanClickUnlocked(
  page: Page,
  locator: Locator,
  options: HumanInteractionOptions
): Promise<void>;

async function humanTypeUnlocked(
  page: Page,
  locator: Locator,
  text: string,
  perChar: PerCharDelay | undefined,
  options: HumanInteractionOptions
): Promise<void>;

export function humanClick(
  page: Page,
  locator: Locator,
  options: HumanInteractionOptions
): Promise<void> {
  return foregroundPage(page, options, () =>
    humanClickUnlocked(page, locator, options)
  );
}

export function humanType(
  page: Page,
  locator: Locator,
  text: string,
  perChar: PerCharDelay | undefined,
  options: HumanInteractionOptions
): Promise<void> {
  return foregroundPage(page, options, () =>
    humanTypeUnlocked(page, locator, text, perChar, options)
  );
}
```

`humanTypeUnlocked()` calls `humanClickUnlocked()`, never exported `humanClick()`, so one gesture acquires one ticket. `foregroundPage()` is the single rule that reacquires focus inside every gesture lease; callers cannot focus before acquiring and then assume focus remains theirs. Preserve the current behavior that a `DomReadTimeoutError` propagates and starts no fallback input.

- [ ] **Step 4: Thread required UI options through shared helpers**

Make these signatures explicit and update all callers:

```ts
clickIfVisible(page, locator, timeout, options): Promise<boolean>;
dismissOverlays(page, options): Promise<number>;
skipOnboardingSurvey(page, log, ui, signal, maxSteps?): Promise<boolean>;
closeBlockingPricingModal(page, log, ui, signal): Promise<boolean>;
ensurePageUsable(page, log, ui, signal): Promise<boolean>;
checkProTrial(page, context, log, ui, signal): Promise<TrialInfo>;
withTaskPopover(page, fn, log, { signal, deadlineAt, ui }): Promise<T>;
```

Carry `env.ui` through `steps.ts`, `claimIfPending()`, overlay cleanup, file-chooser trigger clicks, and task-entry/Claim operations.

- [ ] **Step 5: Migrate launcher focus and native-window work**

Add `ui?: AccountUiInteraction` to `LaunchOptions`/`CdpAttachOptions`. Put the reviewed raw headed-window calls in `configureHeadedWindowUnlocked()`. For headed launches, wrap `page.bringToFront()`, viewport reads tied to window sizing, `Browser.getWindowForTarget`, `Browser.setWindowBounds`, `page.setViewportSize()`, and readback in one `ui.foreground('launcher:window-setup', () => configureHeadedWindowUnlocked(...))` transaction. CDP connection retry, provider status polling, and permission grants remain outside the lane.

`AutomationRunService.launchSession()` must pass the session facade to both API-v3 and xcli launch paths. A headed launch without a facade is a configuration error in production but tests may inject `createDirectUiInteraction()` explicitly.

- [ ] **Step 6: Migrate auth, trial, overlays, and task popovers**

Every focus/input sequence in `auth.ts`, `login.ts`, `signup.ts`, `trial.ts`, `overlays.ts`, and `missionRunner.ts` uses `foregroundPage()` or another reviewed foreground transaction that calls `bringToFront()` after admission and before its first input. OTP retrieval, navigation waits, DOM-only reads, task response listening, and proof reconciliation remain concurrent.

Keep one logical transaction around coupled actions such as `bringToFront + form click/type`, `open popover + click row`, or `Escape + verify modal closed`; do not acquire a ticket per keystroke.

- [ ] **Step 7: Migrate simple, Design, Video, and shared steps**

Set `workspace: 'editor'` on Design and Video; set `workspace: 'none'` on PWA/notifications. In `reconcileMissionEvidence()`, call `env.ui.editor('mission:' + group.id, act)` only for editor groups. Release the editor lane before proof reconciliation.

Within each mission, route every click/type/hover/focus through foreground. Passive render/generation waits and network evidence waits do not hold foreground. The editor lane may remain held for the stateful mission action at this correctness stage.

Cover these exact current anchors during review:

- `BrowserLauncher.ts` focus and window setup around current lines 213–313;
- `trial.ts` clicks around 108, 135, 172;
- `login.ts` inputs/clicks around 57, 72, 143, 180, 197;
- `signup.ts` inputs/clicks around 82, 96, 146, 177, 211–252, 277, 291, 342, 376, 401;
- `overlays.ts` direct input around 104, 152, 204;
- `missionRunner.ts` direct input around 177, 399, 413, 460;
- `simple.ts` direct input around 62, 69, 149, 184, 192, 216–217;
- `designStudio.ts` direct input around 59, 124, 151, 162, 174, 209, 273, 297;
- `videoStudio.ts` direct input around 54, 62, 68, 124, 137, 207, 245, 282, 292, 378, 423, 428, 454, 468, 475.

- [ ] **Step 8: Remove the account-local lock only after coverage is green**

Delete `hostInteraction?: InteractionLock`, the `new InteractionLock()` in `runTasks.bootstrap()`, the old module, and its test. Do this last so the branch never claims both locks provide safety.

- [ ] **Step 9: Run the full focused UI unit set**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/boundedInteractions.test.ts src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts src/main/services/capcut/__tests__/auth.test.ts src/main/services/capcut/__tests__/overlayGuard.test.ts src/main/services/capcut/__tests__/popoverLifecycle.test.ts src/main/services/capcut/__tests__/simple.test.ts src/main/services/capcut/__tests__/simpleActions.test.ts src/main/services/capcut/__tests__/designWorkspace.test.ts src/main/services/capcut/__tests__/canvasFlowTimeout.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts
```

Expected: PASS; the inventory reports zero unreviewed production direct inputs.

- [ ] **Step 10: Independent review checkpoint**

Reviewer compares the production inventory table against source, checks gesture atomicity, and proves that a mouse timeout exits directly to quarantine. A partial migration is a release blocker even if tests outside the missing path pass.

- [ ] **Step 11: Optional path-scoped commit after user authorization**

Stage only the files listed in this task, inspect `git diff --cached --stat`, then:

```powershell
git commit -m "fix: coordinate all headed UI input"
```

---

### Task 7: Add existing-only recovery authentication and headed health gates

**Files:**
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/capcut/auth.ts`
- Modify: `src/main/services/capcut/login.ts`
- Modify: `src/main/services/capcut/rendererHealth.ts`
- Modify: `src/main/services/capcut/launcher/BrowserLauncher.ts`
- Modify: `src/main/services/capcut/launcher/ApiV3Launcher.ts`
- Modify: `src/main/services/capcut/launcher/XcliLauncher.ts`
- Modify: `src/shared/schemas/automation.schema.ts`
- Test: `src/main/services/capcut/__tests__/auth.test.ts`
- Test: `src/main/services/__tests__/CapcutEngineService.test.ts`
- Test: `src/main/services/capcut/__tests__/rendererHealth.test.ts`
- Test: `src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts`
- Test: `src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts`

**Interfaces:**
- Consumes: session facade, `CapcutFatalCode`, and session ownership.
- Produces: `CapcutAuthAttempt = 'initial' | 'existing-only'`, `AuthOptions.allowSignupFallback`, and a bounded headed attach health result.

- [ ] **Step 1: Write existing-only auth RED tests**

Implement these auth/engine cases:

| Test name | Controlled sequence | Required assertion |
|---|---|---|
| `recovery login never calls signup when login does not enter the app` | Run `ensureInApp` with `allowSignupFallback=false`; make login return outside the app. | The call rejects with the typed recovery-login error and signup spy count is zero. |
| `recovery login never invokes the signup OTP callback` | Use the same recovery failure with a throwing OTP spy. | OTP and signup spy counts are both zero. |
| `initial newly-purchased account preserves signup-first behavior` | Run engine with `authAttempt='initial'`, `isNewAccount=true`. | Signup is called before login fallback and OTP remains available. |
| `engine returns authenticated true for a mission-level fatal result` | Authentication succeeds; fake `runAllTasks` returns a fatal task result. | Result has `authenticated: true` and preserves its partial receipt/tasks. |
| `engine exposes DOM_READ_TIMEOUT as a typed fatalCode` | Fake task result uses `new DomReadTimeoutError('canvas-area:mouse-move')`. | Engine result contains `fatalCode: 'DOM_READ_TIMEOUT'`; no string parsing spy is used. |
| `discovery and trial-skip UI returns are explicitly unverified` | Exercise each early return before task execution. | Both return `verification: null`, a defined `authenticated` value, and cannot satisfy the UI completion predicate. |

- [ ] **Step 2: Add exact auth contracts**

Add to the runner input:

```ts
authAttempt: 'initial' | 'existing-only';
```

Add to `AuthOptions`:

```ts
allowSignupFallback?: boolean; // default true for existing callers
```

Map recovery exactly:

```ts
forceSignup: input.authAttempt === 'initial' && input.isNewAccount,
allowSignupFallback: input.authAttempt !== 'existing-only',
getOtp: input.authAttempt === 'existing-only' ? undefined : getOtp
```

When existing-only login fails, throw a typed/sanitized recovery-login error. Do not call `signupCapcut()`.

- [ ] **Step 3: Write headed health RED tests**

Cover bounded DOM evaluation, valid logical viewport, neutral mouse movement, `Browser.getWindowForTarget`/resize readback, abort propagation, and sanitizer-safe errors:

| Test name | Controlled sequence | Required assertion |
|---|---|---|
| `runs the renderer health gate for headed API-v3 and xcli sessions` | Launch one fake headed session through each launcher. | Each invokes the shared health checker once after window setup and before returning the session. |
| `quarantines and tears down an owned headed profile when mouse move never settles` | Never resolve the neutral mouse promise. | Deadline yields `DOM_READ_TIMEOUT`, scheduler quarantines, and the published profile is stopped once. |
| `tears down an owned profile when Browser.getWindowForTarget hangs` | Never resolve the window query. | Launch rejects with a bounded sanitized error and profile stop runs once. |
| `does not allow a late health promise to mutate ownership or telemetry` | Time out, complete cleanup, snapshot telemetry bytes, then resolve the old promise. | Ownership remains empty and telemetry bytes/events do not change. |

- [ ] **Step 4: Run the RED auth/health set**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/auth.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/capcut/__tests__/rendererHealth.test.ts src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts
```

Expected: FAIL because recovery auth mode and headed health invocation are absent.

- [ ] **Step 5: Run bounded health after headed attach**

Reuse `rendererHealth.ts`; do not fork a second implementation. Invoke it after CDP attachment/window setup for headed API-v3 and xcli sessions. Its mouse operation runs inside the session foreground facade. A timeout propagates with the typed code, leaves the session quarantined, and lets session-scoped cleanup stop the profile.

Connection polling and provider API calls remain outside the lane. A health-only failure must not reach account signup or mailbox commit.

- [ ] **Step 6: Make cleanup failure a terminal failure, not a completed run detail**

Use the terminal codes introduced in Task 2. When `cleanupFailures > 0` or an unsafe session remains owned, final run state is `failed` with sanitized counts and `RESOURCE_CLEANUP_FAILED` takes precedence over ordinary workload/persistence failure codes. Do not publish `completed` merely because `MAIL_LIMIT_REACHED` was also true.

- [ ] **Step 7: Run auth/health GREEN verification**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/auth.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/capcut/__tests__/rendererHealth.test.ts src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts src/main/services/__tests__/AutomationRunService.test.ts
```

Expected: PASS; initial signup is unchanged, recovery cannot sign up, headed health is bounded, and cleanup failure cannot be green.

- [ ] **Step 8: Independent review checkpoint**

Reviewer confirms the current mission fatal occurs after authentication, so existing-only is valid for this fault. Reject if control flow matches an error string, forwards signup OTP during recovery, or releases quarantine before successful stop.

- [ ] **Step 9: Optional path-scoped commit after user authorization**

Stage only this task's paths, then:

```powershell
git commit -m "fix: gate headed sessions and recovery login"
```

---

### Task 8: Implement one fresh-session resume for the same account and proxy

**Files:**
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`
- Test: `src/main/services/__tests__/automationTaskProgress.test.ts`
- Test: `src/main/services/__tests__/CapcutEngineService.test.ts`

**Interfaces:**
- Consumes: typed `fatalCode`, exact awaited checkpoints, `launchSession()`, `stopSession()`, scheduler confirmation/shutdown, and existing-only auth.
- Produces: a maximum-two-session state machine inside one account workload plus passive reconciliation of same-run unsettled proofs.

- [ ] **Step 1: Write recovery state-machine RED tests**

Use a sequenced fake runner and fake launcher:

| Test name | Sequenced result/race | Required assertion |
|---|---|---|
| `awaits the engine-owned partial checkpoint before launching a replacement session` | Hold the engine checkpoint callback after the fatal group, then release it; attempt 2 returns complete. | Engine does not return and old stop/replacement launch do not start while held; checkpoint commit precedes old stop and replacement launch. |
| `does not launch replacement when the engine checkpoint rejects` | Persistence callback rejects inside attempt 1 after the fatal group. | `runUiSessionAttempt` classifies the typed rejection, unsafe old profile is stopped, no second launch occurs, and terminal state carries `TASK_CHECKPOINT_PERSISTENCE_FAILED`. |
| `reuses account password and proxy while creating no second account or mailbox` | Inspect both engine inputs and all acquisition spies. | Account ID/password/proxy are equal; account create, mailbox commit, and proxy acquire stay at their initial counts. |
| `runs the replacement with existing-only auth and a fresh page/context` | Launcher returns distinct page/context objects. | Attempt 2 uses only the second objects and `authAttempt='existing-only'`. |
| `stops old profile before replacement launch starts` | Hold old stop, observe launch spy, then resolve stop. | Replacement launch count is zero while held and becomes one afterward. |
| `does not launch a replacement when old profile stop fails` | Reject old stop while another session has a queued gesture. | Launch count remains one total, scheduler drains the waiter, all thread signals abort, other cleanup runs, and terminal code is `RESOURCE_CLEANUP_FAILED`. |
| `allows exactly one recycle then fails after a second DOM timeout` | Both attempts return the typed timeout. | Exactly two engine calls/two profiles occur and the account terminal outcome is failed. |
| `does not recycle an unclassified mission error` | Attempt 1 returns only a normal `fatalError`. | Exactly one engine call/profile occurs. |
| `does not launch replacement when Stop arrives after old stop` | Resolve old stop, abort iteration before the next microtask. | Replacement launch count remains zero and account is stopped. |
| `stops both old and replacement profiles exactly once on success` | Attempt 1 times out; attempt 2 returns fresh complete. | Stop calls are `profile-1`, `profile-2`, each exactly once, and all ownership counts are zero. |
| `passively settles a same-run proof without replaying its mutation` | Attempt 1 proves A but sees status 1; replacement snapshots report A=1 then A=4. | Replacement issues zero actions for A, waits for the fresh A=4 receipt, and completes from that receipt. |
| `fails partial when a same-run proof remains non-4` | Attempt 1 proves A but sees status 1; every bounded replacement receipt remains A=1. | Replacement issues zero actions for A, returns partial/unverified, and performs no third session. |
| `does not suppress an action from historical proof alone` | Persist old-run proof for A, but current attempt has no unsettled proof and fresh status is 1. | A remains eligible for one action in the current run. |

Assert ordered calls, not just counts:

```ts
expect(events).toEqual([
  'engine:session-1',
  'checkpoint:partial',
  'stop:profile-1',
  'launch:session-2',
  'engine:session-2',
  'reconcile:unsettled-proofs',
  'checkpoint:final',
  'stop:profile-2'
]);
```

- [ ] **Step 2: Run recovery RED verification**

Run:

```powershell
npx vitest run src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/AutomationRunService.test.ts -t "recycle|replacement|partial proof"
```

Expected: FAIL because the current workload invokes the engine once and owns one flat profile.

- [ ] **Step 3: Extract one engine-session attempt**

Create a private helper that reads only the current captured session:

```ts
private runUiSessionAttempt(
  thread: ThreadRuntime,
  session: BrowserSessionRuntime,
  config: AutomationRunConfigDTO,
  signal: AbortSignal,
  authAttempt: CapcutAuthAttempt,
  unsettledProofs: readonly UnsettledTaskProof[]
): Promise<CapcutUiAccountResult>;
```

Pass `session.page`, `session.context`, `session.ui`, `thread.runId`, `session.alias`, `session.startedAt`, and `unsettledProofs` through `CapcutTaskRunner.runAccount()` and `CapcutEngineService` into `RunTasksInput`. The checkpoint callback records only while `thread.session === session`; late callbacks from an old session are ignored and logged as sanitized late events. This awaited callback is the sole durable checkpoint owner—do not persist the returned result again.

- [ ] **Step 4: Add the bounded recovery loop**

Use an explicit constant:

```ts
const MAX_UI_SESSION_RECYCLES = 1;
```

Catch the engine-owned checkpoint failure around the attempt, then decide recovery only from a successfully returned result:

```ts
let result: CapcutUiAccountResult;
try {
  result = await runUiSessionAttempt(
    thread,
    session,
    config,
    signal,
    authAttempt,
    unsettledProofs
  );
} catch (error) {
  if (!(error instanceof AutomationTerminalError) ||
      error.reason.code !== 'TASK_CHECKPOINT_PERSISTENCE_FAILED') {
    throw error;
  }
  const stopped = await stopSession(thread, session);
  if (stopped) this.acceptTerminalError(error);
  // stopSession owns RESOURCE_CLEANUP_FAILED escalation when stopped is false.
  return {
    kind: 'failed',
    status: 'error',
    step: 'Không lưu được checkpoint nhiệm vụ'
  };
}
if (result.fatalCode !== 'DOM_READ_TIMEOUT') return classify(result);
if (thread.sessionRecycleCount >= MAX_UI_SESSION_RECYCLES) return failed;
thread.sessionRecycleCount += 1;
const stopped = await stopSession(thread, session);
if (!stopped) return resourceCleanupFailed;
signal.throwIfAborted();
const replacement = await launchSession(thread, config, signal, uiScheduler);
return nextAttempt(replacement, 'existing-only', result.unsettledProofs);
```

The awaited callback has already committed every returned result, including the fatal partial checkpoint; there is no result-level `recordTaskCheckpoint()` call. If checkpoint persistence fails, stopping the unsafe session remains mandatory even though recovery is prohibited. If that stop also fails, `RESOURCE_CLEANUP_FAILED` takes terminal precedence while telemetry records both sanitized failures. Do not nest or multiply the recycle budget with `maxRounds`. Do not catch the typed timeout and continue on the old session.

- [ ] **Step 5: Enforce resource non-acquisition by construction**

Keep the recovery loop entirely inside `runThreadWorkload()`, after the original item/account/proxy setup. It must not receive `source`, `workSources`, `emailPurchaseService`, or a proxy acquisition function. Tests spy on `source.next`, `source.commit`, `accounts.create`, `proxies.acquire`, and OTP; counts must remain one/one/one/one/initial-only for the account lifecycle, with zero calls during replacement.

- [ ] **Step 6: Ensure the replacement uses a completely fresh engine state**

Each call to `CapcutEngineService.runAccount()` constructs a new `PrimaryPageResolver`, `TaskStore`, monitor, capture controller, and task bootstrap from the replacement `Page`/`BrowserContext`. Do not pass outcomes, waiters, listeners, or Playwright promises across sessions. The only carried mission data is the immutable same-run `UnsettledTaskProof[]`.

After the fresh bootstrap snapshot, remove status-4 keys normally. Before `selectGroups()`, match every input unsettled proof to the bootstrap keys. For each carried unsettled key still non-4, perform bounded passive `task_list` reconciliation without opening a task, clicking, typing, uploading, claiming, or issuing `do_action`. If it becomes 4, merge the proof and continue. If the deadline expires while it remains non-4, emit a fresh non-final checkpoint and return partial; never call its mutating mission again. Other non-4 keys with no same-run unsettled proof remain eligible for normal group selection. A test spies on the runner input and `RunTasksInput` to prove the exact array reaches this pre-selection boundary.

- [ ] **Step 7: Run recovery GREEN verification**

Run:

```powershell
npx vitest run src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/capcut/__tests__/runTasks.test.ts
```

Expected: PASS for durable checkpoint order, same-account reuse, fresh objects, passive proof reconciliation/no replay, one recycle, stop failure shutdown, Stop race, and final cleanup.

- [ ] **Step 8: Independent review checkpoint**

Reviewer proves that the replacement cannot start until durable checkpoint commit and exact old-session stop success, and that global/per-thread Stop shares the same session stop promise. Reject if recovery can call acquisition code, replay a same-run unsettled mutation, or let a stale session callback overwrite the replacement checkpoint.

- [ ] **Step 9: Optional path-scoped commit after user authorization**

```powershell
git add src/main/services/AutomationRunService.ts src/main/services/CapcutEngineService.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/CapcutEngineService.test.ts
git commit -m "fix: recycle poisoned headed sessions once"
```

---

### Task 9: Add structured, redacted run evidence and late-event guards

**Files:**
- Create: `src/shared/schemas/automation-evidence.schema.ts`
- Create: `src/main/services/capcut/runTelemetry.ts`
- Create: `src/main/services/capcut/__tests__/runTelemetry.test.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/capcut/uiInteractionScheduler.ts`
- Modify: `src/shared/schemas/diagnostics.schema.ts`
- Test: `src/shared/schemas/__tests__/automation.schema.test.ts`

**Interfaces:**
- Consumes: scheduler events, task checkpoints, session aliases, run counters, and cleanup outcomes.
- Produces: `RunTelemetry`, a schema-validated JSONL artifact below Electron `userData`, and a sanitized summary consumed by the rollout validator.

- [ ] **Step 1: Write forbidden-data and lifecycle RED tests**

Seed the recorder with unmistakable sentinels for every forbidden category. Implement this matrix:

| Test name | Input/action | Required assertion |
|---|---|---|
| `serializes only run-local aliases and never raw identifiers or secrets` | Drive a full fake run whose internal objects contain every sentinel below. | JSONL contains aliases and aggregate values; none of the sentinels occur. |
| `records queue wait, lease hold, quarantine, and confirmed stop order` | Emit queued/start/quarantine/stop events with fixed clock values. | Parsed lines retain chronological order and exact numeric wait/hold durations. |
| `records exact task statuses and receipt times without request payloads` | Emit a checkpoint for two task keys/statuses and attach secret request data to an internal fake. | Only keys, statuses, proof result code, and receipt times serialize. |
| `rejects an event that contains an unknown field` | Cast an event containing `email` and call `record()`. | Strict Zod parsing throws before a file line is written. |
| `ignores late events after close and leaves the artifact byte-identical` | Close, read bytes, call a captured old callback, read bytes again. | Byte buffers are equal and terminal event count remains one. |
| `closes idempotently and emits one terminal summary` | Call `close()` concurrently twice with the same summary. | Both promises settle, one terminal line exists, and manifest points at that artifact. |
| `records billable attempts and ambiguous outcomes without provider identifiers` | Emit one attempted Gmail94 purchase and one ambiguous outcome whose internal error includes an order/email sentinel. | Artifact counters are attempted=1, confirmed=0, ambiguous=1 and contains neither sentinel. |

The serialized artifact must not contain any of these test strings:

```ts
const forbidden = [
  'secret@example.com', 'capcut-password', 'otp-123456',
  'profile-raw-id', '127.0.0.1:54321', 'proxy.example:9000',
  'proxy-user', 'proxy-pass', 'cookie-secret', 'authorization-secret'
];
```

- [ ] **Step 2: Run telemetry RED verification**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/runTelemetry.test.ts src/shared/schemas/__tests__/automation.schema.test.ts
```

Expected: FAIL because the evidence schema and recorder do not exist.

- [ ] **Step 3: Define a strict evidence union**

Create individual strict schemas and pass the named constants explicitly to `z.discriminatedUnion('type', schemas)`; the array must contain no catch-all record. Their shared base contains only:

```ts
{
  schemaVersion: z.literal(1),
  runId: z.string().uuid().or(z.string().regex(/^run-/)),
  at: z.string().datetime(),
  workerAlias: z.string().regex(/^worker-\d+$/).optional(),
  sessionAlias: z.string().regex(/^worker-\d+-session-\d+$/).optional()
}
```

The complete version-1 event payload union is:

```ts
export type AutomationEvidenceEvent =
  | EvidenceBase & { type: 'run-start'; mode: 'new' | 'resume' | 'health'; headed: true; stage: 1 | 3 | 5 | 10 | null; workerTarget: number; maxBillablePurchases: number }
  | EvidenceBase & { type: 'stage'; name: 'acquire' | 'launch' | 'auth' | 'mission' | 'checkpoint' | 'cleanup'; state: 'start' | 'end' }
  | EvidenceBase & { type: 'resource-snapshot'; activeWorkers: number; activeProfiles: number; activeProxies: number; activeMailReservations: number }
  | EvidenceBase & { type: 'purchase'; provider: 'gmail94' | 'dongvanfb'; outcome: 'attempted' | 'confirmed' | 'ambiguous'; attempted: number; confirmed: number; ambiguous: number; budget: number }
  | EvidenceBase & { type: 'health-summary'; attempted: number; healthy: number; stopped: number; cleanupFailures: number }
  | EvidenceBase & { type: 'ui-queued'; lane: UiLane; label: string }
  | EvidenceBase & { type: 'ui-started'; lane: UiLane; label: string; waitMs: number }
  | EvidenceBase & { type: 'ui-finished'; lane: UiLane; label: string; holdMs: number }
  | EvidenceBase & { type: 'ui-quarantined'; label: string; code: 'DOM_READ_TIMEOUT' | 'ACTIVE_ABORT' }
  | EvidenceBase & { type: 'ui-late-settled'; label: string; outcome: 'resolved' | 'rejected' }
  | EvidenceBase & { type: 'scheduler-shutdown'; code: 'RESOURCE_CLEANUP_FAILED' | 'RUN_ABORTED' }
  | EvidenceBase & { type: 'task-checkpoint'; fresh: boolean; final: boolean; observedAt: string; requiredAfter: string; serverTotal: number; serverDone: number; tasks: Array<{ key: string; status: number; errNo?: number }> }
  | EvidenceBase & { type: 'persistence-failure'; code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED' }
  | EvidenceBase & { type: 'profile-stop'; outcome: 'confirmed' | 'failed'; code?: 'RESOURCE_CLEANUP_FAILED' }
  | EvidenceBase & { type: 'terminal'; state: 'completed' | 'failed' | 'stopped' | 'blocked'; code: AutomationTerminalCode; accepted: number; completed: number; failed: number; stopped: number; skipped: number; cleanupFailures: number; purchaseAttempted: number; purchaseConfirmed: number; purchaseAmbiguous: number };

export type AutomationEvidenceTerminalEvent = Extract<
  AutomationEvidenceEvent,
  { type: 'terminal' }
>;
```

`EvidenceBase` is the TypeScript inference of the shared strict base. Each union member has its own `.strict()` schema. Task 2 adds `RESOURCE_CLEANUP_FAILED` and `TASK_CHECKPOINT_PERSISTENCE_FAILED` to `AutomationTerminalCodeEnum`; Task 12 adds `BILLABLE_PURCHASE_LIMIT_REACHED`. Enforce non-negative integers for counts/timings/statuses, unique task keys per checkpoint, monotonic purchase counters, and `confirmed + ambiguous <= attempted <= budget`. A health artifact has exactly one `health-summary`, terminal account counters all zero, and a zero purchase budget/counters.

- [ ] **Step 4: Implement a bounded JSONL writer below `userData`**

Expose:

```ts
export interface RunTelemetry {
  record(event: AutomationEvidenceEvent): void;
  close(summary: AutomationEvidenceTerminalEvent): Promise<void>;
  filePath(): string;
  artifactBasename(): string;
}

export function createRunTelemetry(options: {
  userDataDir: string;
  runId: string;
  now?: () => Date;
}): RunTelemetry;
```

Resolve the destination as `path.join(userDataDir, 'rollout-evidence', runId + '.jsonl')`, validate every event before serialization, serialize one line at a time, and set a closed flag before awaiting final flush. After the terminal line is flushed, atomically replace `path.join(userDataDir, 'rollout-evidence', 'last-run.json')` with `{ "runId": runId, "artifact": runId + '.jsonl' }`. Reject path traversal in `runId`. The manifest is operator convenience only; acceptance always uses the exact run ID returned by the harness. Do not write evidence into the repository.

- [ ] **Step 5: Wire aliases, not user data**

`AutomationRunService` maps each internal thread to `worker-N` and each session to `worker-N-session-M`. It passes only these aliases to scheduler/telemetry. Recreate the scheduler with `onEvent` set to a total mapper from every `UiSchedulerEvent` member to its exact evidence variant; use an exhaustive `never` check so a future event cannot be silently dropped. Engine checkpoint telemetry contains task keys, numeric statuses, proof `errNo`, and timestamps; it omits `opId` because that embeds a user identifier.

Existing application logs may still show account context to the local UI, but the live harness must stop forwarding raw log entries to stdout. The evidence artifact and rollout console are always sanitized.

- [ ] **Step 6: Block late event mutation**

Capture the session alias on every callback. Before recording, require both an open recorder and current session ownership where applicable. A timed-out command that resolves later cannot emit success, mutate task state, or change profile ownership.

- [ ] **Step 7: Run telemetry GREEN verification**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/runTelemetry.test.ts src/shared/schemas/__tests__/automation.schema.test.ts src/main/services/__tests__/AutomationRunService.test.ts
```

Expected: PASS; strict schema rejection and the byte-identical late-event assertion both hold.

- [ ] **Step 8: Independent review checkpoint**

Reviewer reads the actual serialized test artifact and searches it for all seeded forbidden strings. Reject if `opId`, email, raw account/profile ID, proxy/port, CDP URL, headers, bodies, DOM, or screenshots can enter any variant.

- [ ] **Step 9: Optional path-scoped commit after user authorization**

```powershell
git add src/shared/schemas/automation-evidence.schema.ts src/main/services/capcut/runTelemetry.ts src/main/services/capcut/__tests__/runTelemetry.test.ts src/main/services/AutomationRunService.ts src/main/services/CapcutEngineService.ts src/main/services/capcut/uiInteractionScheduler.ts src/shared/schemas/diagnostics.schema.ts src/shared/schemas/__tests__/automation.schema.test.ts
git commit -m "feat: record redacted headed run evidence"
```

---

### Task 10: Prove resource and scheduler invariants with deterministic 1/3/5/10-worker stress

**Files:**
- Create: `src/main/services/__tests__/fixtures/deterministicRunHarness.ts`
- Modify: `src/main/services/__tests__/AutomationRunService.test.ts`
- Modify: `src/main/services/__tests__/AutomationWorkSource.test.ts`
- Modify: `src/main/services/__tests__/automationTaskProgress.test.ts`
- Modify: `src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts`
- Modify: `src/main/services/capcut/__tests__/cancellation.test.ts`

**Interfaces:**
- Consumes: scheduler, session lifecycle, recovery, checkpoint, work source, and telemetry contracts from Tasks 2–9.
- Produces: seeded, browser-free stress proof at the exact target worker counts.

- [ ] **Step 1: Build a deterministic fake harness**

The fixture must expose counters and ordered events for mailbox reservations, accepted accounts, profiles, proxies, foreground/editor leases, task checkpoints, and cleanup. Use a small seeded PRNG such as xorshift32:

```ts
export function xorshift32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}
```

No fixture method may call Playwright, Electron, a provider, the network, or real time.

- [ ] **Step 2: Add the successful-order matrix as RED tests**

For each count in `[1, 3, 5, 10]`, add two parameterized cases:

| Test name | Runs | Required setup |
|---|---:|---|
| `keeps workers, profiles, proxies, reservations, and accepted accounts within cap %i` | One deliberately interleaved wave | Delay each boundary independently so all resource peaks are observable. |
| `settles 100 seeded completion orders without leaks at %i workers` | Seeds 1 through 100 | Feed xorshift values into every fake delay/completion choice and include the seed in assertion messages. |

For every seed assert:

```ts
expect(peaks.workers).toBeLessThanOrEqual(count);
expect(peaks.profiles).toBeLessThanOrEqual(count);
expect(peaks.proxies).toBeLessThanOrEqual(count);
expect(peaks.mailReservations).toBeLessThanOrEqual(count);
expect(counters.accepted).toBeLessThanOrEqual(count);
expect(counters.completed + counters.failed + counters.stopped).toBe(counters.accepted);
expect(final.activeThreads).toBe(0);
expect(final.schedulerForegroundWaiting).toBe(0);
expect(final.schedulerEditorWaiting).toBe(0);
```

- [ ] **Step 3: Add the injected-fault matrix**

Cover one fault at each boundary: mailbox acquisition, proxy acquisition, profile ID before late attach rejection, headed health mouse timeout, active mission mouse timeout, task checkpoint persistence, old-session stop, replacement launch, replacement login, final snapshot, proxy release, mailbox release, global Stop, and per-thread Stop.

Required cases and assertions:

| Test name | Injected fault/race | Required assertion |
|---|---|---|
| `never admits another foreground action before quarantined profile stop` | Mission mouse hangs while a second account waits. | Second callback starts only after the first profile-stop confirmation event. |
| `never starts replacement after an uncertain old-profile stop` | Old stop rejects or never resolves within its bounded cleanup policy. | No second launch event occurs and run is failed/resource-blocked. |
| `drains every scheduler waiter after an uncertain old-profile stop` | Queue foreground/editor work on other workers before old stop rejects. | All waiters reject, queue counts become zero, no later callback starts, and terminal code is `RESOURCE_CLEANUP_FAILED`. |
| `stops a profile published after a pre-id Stop` | Abort while launch is pending, then publish the profile ID. | That exact profile receives one stop; mission engine count remains zero. |
| `never recycles after a failed durable checkpoint` | Fatal attempt has partial proof but persistence rejects. | Old session is stopped, replacement launch count is zero, and proof mutation count remains one. |
| `never replays an unsettled same-run action` | Fatal attempt proves A at status 1; replacement snapshots keep A at 1. | No second action for A occurs and result is partial/failed verification. |
| `never acquires another mailbox during session recovery` | First session times out and second succeeds. | Mail acquisition/reservation counts stay one for that account. |
| `counts one terminal outcome per accepted account under Stop races` | Trigger global Stop, per-thread Stop, and workload completion in one seeded schedule. | Completed + failed + stopped equals accepted and no account appears in two buckets. |
| `fails the run when any cleanup remains uncertain` | Inject one profile or proxy release failure after otherwise complete tasks. | Final state is failed with `RESOURCE_CLEANUP_FAILED`, never completed. |

- [ ] **Step 4: Run the stress RED set**

Run:

```powershell
npx vitest run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts src/main/services/capcut/__tests__/cancellation.test.ts
```

Expected: any remaining ownership/counter race fails deterministically with its seed printed.

- [ ] **Step 5: Fix only invariant failures at their owning boundary**

For each failing seed, make one minimal production correction in the owning component, rerun that single seed, then rerun the full matrix. Do not loosen assertions, increase arbitrary sleeps, or recover unclassified errors.

- [ ] **Step 6: Run the stress GREEN set twice**

Run the command from Step 4 twice in separate invocations.

Expected: both invocations PASS with identical seed coverage, no pending timers/listeners, and no resource count above the cap.

- [ ] **Step 7: Independent review checkpoint**

Reviewer checks that the fakes preserve asynchronous ordering and do not make all operations synchronous. Inspect at least one late-resolution case and one Stop/recovery race. Reject a test that merely compares final counts without checking peaks and event order.

- [ ] **Step 8: Optional path-scoped commit after user authorization**

```powershell
git add src/main/services/__tests__/fixtures/deterministicRunHarness.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts src/main/services/capcut/__tests__/cancellation.test.ts
git commit -m "test: stress headed ownership through ten workers"
```

---

### Task 11: Add a non-purchasing existing-account resume source

**Files:**
- Modify: `src/shared/schemas/automation.schema.ts`
- Modify: `src/main/services/AutomationWorkSource.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/AccountService.ts`
- Modify: `src/main/runtime/providerStack.ts`
- Test: `src/shared/schemas/__tests__/automation.schema.test.ts`
- Test: `src/main/services/__tests__/AutomationWorkSource.test.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`
- Test: `src/main/services/__tests__/AccountService.test.ts`

**Interfaces:**
- Consumes: encrypted account records and the main-process credential vault; existing-account auth from Task 7.
- Produces: `emailSource.mode = 'existing'`, discriminated `AutomationWorkItem.kind`, and a finite source that cannot purchase mail or create account rows.

- [ ] **Step 1: Write no-purchase resume RED tests**

Implement the following cases:

| Test name | Input/action | Required assertion |
|---|---|---|
| `validates a non-empty unique list of existing account ids` | Parse empty, duplicate, 21-item, and valid three-ID configs. | Invalid inputs fail at `emailSource.accountIds`; valid unique three-ID input succeeds. |
| `loads CapCut credentials in main process without exposing them in DTO output` | Store an encrypted password, call internal credential reader, then call public list. | Internal result decrypts correctly; public DTO still exposes only `hasPasswordCapcut`. |
| `does not open an email acquisition session for existing mode` | Prepare the source with three resolvable IDs. | Email service spy count is zero and worker target is three. |
| `does not create or commit an account row for an existing work item` | Complete one existing-account workload. | Account update runs; account create and source commit counts are zero. |
| `uses existing-only auth from the first session` | Inspect the first runner input for existing mode. | `authAttempt` is `existing-only`, `isNewAccount` is false, and OTP callback is undefined. |
| `fails before browser launch when an account or saved password is missing` | Include one missing ID and one passwordless record in separate preparations. | Each preparation rejects; browser/profile/proxy/mail side-effect counts stay zero. |

- [ ] **Step 2: Run resume RED verification**

Run:

```powershell
npx vitest run src/shared/schemas/__tests__/automation.schema.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/AccountService.test.ts -t "existing|resume"
```

Expected: FAIL because existing mode and its credential reader do not exist.

- [ ] **Step 3: Extend the config and work-item discriminants**

Add this strict union member:

```ts
z.object({
  mode: z.literal('existing'),
  accountIds: z.array(z.string().min(1)).min(1).max(20)
}).strict()
```

Use work items:

```ts
export type AutomationWorkItem =
  | { kind: 'new'; sourceId: string; email: string; emailProvider: string; emailPassword?: string; purchasedEmailId?: string; reservationId?: string }
  | { kind: 'existing'; sourceId: string; accountId: string; email: string; emailProvider: string; capcutPassword: string };
```

Manual/API/custom sources produce `kind: 'new'` and preserve current behavior.

- [ ] **Step 4: Add a main-only credential reader**

`AccountService` exposes an internal method used only by provider wiring:

```ts
getAutomationCredential(accountId: string): {
  accountId: string;
  email: string;
  emailProvider: string;
  capcutPassword: string;
} | null;
```

It reads the repository record and decrypts `passwordCapcutEncrypted` with the existing vault. Do not add this method to IPC contracts or the preload bridge. Do not log the returned object.

- [ ] **Step 5: Implement finite `ExistingAccountWorkSource`**

Resolve all IDs during `prepare()`, reject duplicates/missing credentials before opening any browser, and cap worker target to the selected list. `next()` shifts from the in-memory queue; `commit()` and `release()` are no-ops. The class receives no `EmailPurchaseService` method, making purchase impossible by construction.

- [ ] **Step 6: Reuse the account row in `AutomationRunService`**

For `kind: 'existing'`, set stable thread fields from the item, call `accounts.update()` to mark processing, and never call `accounts.create()` or `generateCapcutPassword()`. First-session `authAttempt` is `existing-only`; signup OTP is undefined. Proxy acquisition remains one per selected account for the current run, and any in-run session recycle reuses that lease.

- [ ] **Step 7: Run resume GREEN verification**

Run:

```powershell
npx vitest run src/shared/schemas/__tests__/automation.schema.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/AccountService.test.ts
```

Expected: PASS; tests assert zero acquisition-session, account-create, source-commit, signup, and OTP calls for existing mode.

- [ ] **Step 8: Independent security/correctness review checkpoint**

Reviewer verifies decrypted passwords never cross IPC/preload, are absent from logs/telemetry, and cannot enter an error string. Confirm an existing work item can still be cancelled and its profile/proxy cleaned normally.

- [ ] **Step 9: Optional path-scoped commit after user authorization**

```powershell
git add src/shared/schemas/automation.schema.ts src/main/services/AutomationWorkSource.ts src/main/services/AutomationRunService.ts src/main/services/AccountService.ts src/main/runtime/providerStack.ts src/shared/schemas/__tests__/automation.schema.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/AccountService.test.ts
git commit -m "feat: resume existing CapCut accounts safely"
```

---

### Task 12: Enforce the billable provider budget at the dispatch boundary

**Files:**
- Modify: `src/main/services/EmailPurchaseService.ts`
- Modify: `src/main/services/AutomationWorkSource.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/shared/schemas/automation.schema.ts`
- Modify: `src/main/services/capcut/runTelemetry.ts`
- Test: `src/main/services/__tests__/EmailPurchaseService.test.ts`
- Test: `src/main/services/__tests__/AutomationWorkSource.test.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`
- Test: `src/main/services/capcut/__tests__/runTelemetry.test.ts`
- Test: `src/shared/schemas/__tests__/automation.schema.test.ts`

**Interfaces:**
- Consumes: one prepared acquisition session per run and the purchase evidence variants from Task 9.
- Produces: required `maxBillablePurchases`, atomic provider-dispatch accounting, and exact attempted/confirmed/ambiguous counters consumed by Task 13.

- [ ] **Step 1: Write provider-boundary RED tests**

Implement every case below with fake Gmail94/DongVan APIs and concurrent callers; no network is allowed:

| Test name | Fixture/action | Required assertion |
|---|---|---|
| `requires an explicit non-negative integer purchase budget for Gmail94 and DongVan` | Open billable sessions with missing, negative, fractional, and `NaN` budgets, then with zero and one. | Invalid values reject before provider preflight/purchase dispatch; zero is valid for reuse-only and one permits at most one dispatch. |
| `reused Gmail94 inventory consumes no billable budget` | Provide two reusable rows and `maxBillablePurchases=0`; acquire twice. | Both reservations succeed; attempted/confirmed/ambiguous and provider create calls remain zero. |
| `reused DongVan inventory consumes no billable budget` | Same setup for DongVan. | Same zero-purchase assertions hold. |
| `atomically caps concurrent Gmail94 dispatches` | Budget two; start five concurrent acquisitions with no reusable rows. | Exactly two `createOtpOrder` calls occur; three reject `BILLABLE_PURCHASE_LIMIT_REACHED`; peak/terminal counters are attempted=2 and confirmed≤2. |
| `atomically caps concurrent DongVan dispatches` | Budget two; start five concurrent acquisitions with no reusable rows. | Exactly two `buyMail` calls occur and the same cap/counter assertions hold. |
| `consumes budget immediately before provider dispatch` | Hold the first provider promise and inspect ordered events. | `purchase:attempted` occurs directly before provider call; no earlier validation or reusable lookup consumes budget. |
| `ambiguous Gmail94 outcome consumes one unit and cannot retry` | Budget one; first order times out or rate-limits after dispatch, then request another acquisition. | Provider called once total; counters are 1/0/1; second request is budget-blocked. |
| `ambiguous DongVan outcome consumes one unit and cannot retry` | Budget one; `buyMail` has an unknown transport outcome, then request another acquisition. | Provider called once total; counters are 1/0/1; no automatic retry occurs. |
| `confirmed purchase increments confirmed exactly once` | Provider succeeds but persistence/consumer cleanup later fails. | Attempted=1 and confirmed=1 remain stable; no second provider request is sent. |
| `purchase events contain no mailbox/order/provider credential values` | Provider fakes include sentinel email/order/token/error text. | Only provider enum, outcome, budget, and aggregate counters reach telemetry. |

- [ ] **Step 2: Run the budget RED set**

```powershell
npx vitest run src/main/services/__tests__/EmailPurchaseService.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/capcut/__tests__/runTelemetry.test.ts -t "billable|purchase budget|ambiguous"
```

Expected: FAIL because a distinct dispatch budget and purchase counters do not yet exist.

- [ ] **Step 3: Define the exact budget contract**

```ts
export interface BillablePurchaseStats {
  budget: number;
  attempted: number;
  confirmed: number;
  ambiguous: number;
}

export interface PurchaseOptions {
  service?: string;
  accountType?: number | string;
  quality?: number | string;
  maxBillablePurchases: number;
  onPurchaseEvent?: (event: {
    provider: 'gmail94' | 'dongvanfb';
    outcome: 'attempted' | 'confirmed' | 'ambiguous';
    stats: BillablePurchaseStats;
  }) => void;
}

export interface EmailAcquisitionSession {
  readonly capacity?: EmailCapacitySnapshot;
  acquireOne(workerId: string, signal: AbortSignal): Promise<ReservedEmail>;
  commit(reservation: ReservedEmail, accountId: string): void;
  release(reservation: ReservedEmail): void;
  purchaseStats(): BillablePurchaseStats;
}
```

For billable providers, validate an explicit non-negative integer budget before provider preflight. The shared automation config carries the same required integer for API Gmail94/DongVan new-account mode; the release harness additionally requires it to be positive and equal to the stage. Existing-account mode and health mode have no acquisition session. Custom-domain generation is not a billable provider dispatch and does not consume this counter.

Add `BILLABLE_PURCHASE_LIMIT_REACHED` to `AutomationTerminalCodeEnum` and cover it in the shared schema test before using the code in `beginBillableDispatch()`.

- [ ] **Step 4: Consume one unit atomically at the last safe boundary**

Keep the counter inside the run-local `EmailAcquisitionSession`. Under the existing provider acquisition serialization, first try `reserveOldestAvailable()`. Only when no reusable row exists, call a private `beginBillableDispatch(provider)` immediately before `gmail94.createOtpOrder(...)` or `dongvanfb.buyMail(...)`:

```ts
function beginBillableDispatch(provider: 'gmail94' | 'dongvanfb'): void {
  if (stats.attempted >= stats.budget) {
    throw new AutomationTerminalError(
      'blocked',
      { code: 'BILLABLE_PURCHASE_LIMIT_REACHED', provider },
      'Đã đạt giới hạn mua hộp thư được duyệt.'
    );
  }
  stats.attempted += 1;
  emit(provider, 'attempted', stats);
}
```

On a valid provider response, increment `confirmed` once before downstream persistence. On any timeout/network/rate-limit/malformed outcome where the provider may have accepted the request, increment `ambiguous` once, throw `PURCHASE_OUTCOME_UNKNOWN`, and do not retry. Pre-dispatch auth/config/insufficient-funds failures consume nothing. Maintain `confirmed + ambiguous <= attempted <= budget` after every transition.

- [ ] **Step 5: Thread the budget and redacted events from run preparation**

`AutomationWorkSource.prepare()` passes `config.maxBillablePurchases` into `openAcquisitionSession()`. Map `onPurchaseEvent` directly to Task 9's purchase evidence variant without mailbox/order/error payloads. At terminal publication, copy `purchaseStats()` into the terminal event. Reused inventory may make confirmed purchases lower than accepted accounts; therefore validators compare purchase attempts against the approved cap, not against mailbox acquisition count.

- [ ] **Step 6: Run the budget GREEN set**

```powershell
npx vitest run src/main/services/__tests__/EmailPurchaseService.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/capcut/__tests__/runTelemetry.test.ts src/shared/schemas/__tests__/automation.schema.test.ts
```

Expected: PASS for both providers, concurrent cap pressure, reusable inventory, ambiguity, terminal counters, and secret redaction.

- [ ] **Step 7: Independent billable-safety review checkpoint**

Reviewer traces both provider call sites and confirms the counter increments immediately before each irreversible request. Reject any implementation that derives the purchase limit only from threads/mail reservations, decrements on failure, retries an ambiguous request, or omits DongVan.

- [ ] **Step 8: Optional path-scoped commit after user authorization**

Stage only Task 12 files, inspect the staged diff, then:

```powershell
git commit -m "fix: cap billable mailbox dispatches"
```

---

### Task 13: Turn the live script into a fail-closed rollout controller

**Files:**
- Modify: `scripts/live-capcut-options.mjs`
- Modify: `scripts/live-capcut-run.mjs`
- Modify: `scripts/__tests__/live-capcut-options.test.mjs`
- Create: `scripts/__tests__/live-capcut-run.test.mjs`
- Create: `scripts/verify-rollout-evidence.mjs`
- Create: `src/main/rolloutUserData.ts`
- Modify: `src/main/main.ts`
- Modify: `src/shared/schemas/automation.schema.ts`
- Modify: `src/shared/contracts/ipc-channels.ts`
- Modify: `src/shared/contracts/api.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/main/ipc/automationIpc.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Test: `src/shared/contracts/__tests__/contracts.test.ts`
- Test: `src/preload/__tests__/preload.test.ts`
- Test: `src/main/ipc/__tests__/runtimeIpc.test.ts`
- Create: `src/main/__tests__/rolloutUserData.test.ts`

**Interfaces:**
- Consumes: strict run config, existing-account source, Task 12 purchase budget, telemetry artifact, and session health gate.
- Produces: `parseLiveCapcutOptions()`, explicit dry-run/health/new/resume modes, `run.health` IPC, exact run-ID/artifact handoff, and a nonzero evidence validator.

- [ ] **Step 1: Write option-parser RED tests**

Implement these exact parser cases:

| Test name | Input | Required assertion |
|---|---|---|
| `rejects an unknown option before side effects` | Valid stage-1 argv plus `--mystery=1`. | Throws option error; every injected side-effect counter is zero. |
| `requires explicit headed mode and rejects headless` | Omit `--headed`, then provide `--headless`. | Both reject before Electron startup. |
| `requires every new-account cap to equal rollout stage` | For each of threads/mailLimit/approvedMailboxes/stopAfter/maxBillablePurchases, omit it and then set it to stage+1. | Every variant rejects; a fully equal stage 1/3/5/10 tuple parses. |
| `requires the provider-specific opt-in only for a paid invocation` | Parse new Gmail94/DongVan commands with missing/false flags; then parse with the correct flag. | Paid commands reject until the matching flag is `1`; dry-run parses without it and still cannot execute. |
| `health-only rejects all account email approval and purchase options` | Add each forbidden option separately; also test stage/thread pairs 3/10, 3/3, 10/10, and 10/3. | Each forbidden/mismatched pair rejects; only headed stage=threads pairs 3/3 and 10/10 parse. |
| `resume rejects email and all billable options` | Add provider/mailLimit/approval/maxBillablePurchases to resume input. | Each rejects and account-ID file contents are never included in an error/stdout. |
| `rejects a relative or repository-contained user-data override` | Pass `--user-data-dir=.` and a path inside `process.cwd()`. | Both reject before file access; an absolute directory outside the repository parses. |
| `uses documented exit codes` | Drive option error, runtime timeout, evidence failure, and success with fakes. | Exit codes are respectively 2, 3, 4, and 0. |

- [ ] **Step 2: Define one parser result union**

```js
/** @typedef {1 | 3 | 5 | 10} RolloutStage */
/** @typedef {{ threads: number, mailLimit: number, approvedMailboxes: number, stopAfter: number, maxBillablePurchases: number }} EqualCaps */
/** @typedef {{ mode: 'dry-run', stage: RolloutStage, headed: true, provider: 'gmail94' | 'dongvanfb', minutes: number, caps: EqualCaps }} DryRunOptions */
/** @typedef {{ mode: 'health-only', stage: 3 | 10, headed: true, threads: number, minutes: number, userDataDir?: string }} HealthOptions */
/** @typedef {{ mode: 'new-accounts', stage: RolloutStage, headed: true, provider: 'gmail94' | 'dongvanfb', minutes: number, caps: EqualCaps, userDataDir?: string }} NewAccountOptions */
/** @typedef {{ mode: 'resume', stage: 3, headed: true, accountIdsFile: string, threads: 3, minutes: number, userDataDir?: string }} ResumeOptions */
/** @typedef {DryRunOptions | HealthOptions | NewAccountOptions | ResumeOptions} LiveCapcutOptions */

/**
 * Parses only the documented flags, validates the selected discriminant and
 * returns one frozen option object. Throws `LiveOptionError` before any I/O.
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {LiveCapcutOptions}
 */
export function parseLiveCapcutOptions(argv, env) {
  const parsed = parseKnownFlags(argv);
  return Object.freeze(validateSelectedMode(parsed, env));
}
```

For `new-accounts`, enforce:

```text
threads = rolloutStage = mailLimit = approvedMailboxes = stopAfter = maxBillablePurchases
headed = true
missionTransport = ui
```

Remove the current default to `api:gmail94`; omission of mode/email is an error.

- [ ] **Step 3: Refactor the script for process-boundary testing**

Export `main(options, dependencies)` and place top-level execution behind an ESM main-module guard. Inject `spawnElectron`, `attachToApp`, `resolveAppUserData`, `runHealth`, `startRun`, `stopRun`, `readEvidenceByRunId`, `killChild`, and `writeStdout` in tests. A parser or dry-run failure must occur before any injected side-effect function is called. `main()` returns `{ exitCode, runId, artifactBasename }`; dry-run returns both strings as `null`.

Obtain the producer directory from Electron's actual `app.getPath('userData')` through a narrow main-process response when no override is supplied. For an explicit `--user-data-dir`, validate that it is absolute and outside the repository, pass it only in the Electron child's environment as `AUTOMANAGER_ROLLOUT_USER_DATA_DIR`, and pass the same value to the validator.

Create `configureRolloutUserData(app, env, workspaceRoot)` in `src/main/rolloutUserData.ts`. At the top of `src/main/main.ts`, after acquiring `app` but before opening the database, migrations, provider stack, windows, or IPC services, call it. When the env key is present, it validates the resolved path again and calls `app.setPath('userData', resolved)`; otherwise it returns `app.getPath('userData')` unchanged. Unit tests assert call ordering and reject relative/repository-contained paths before initialization. The harness integration fake must prove producer and validator receive the identical resolved directory.

Stop forwarding raw `LogBus` entries or email fields to stdout. Print only aggregate counters and sanitized fault codes, then one final machine-readable line whose prefix is `ROLLOUT_RESULT=` and whose JSON has exactly `runId` plus `artifact = runId + '.jsonl'`. Never print a full path or local username. Tests parse that final line and reject missing, duplicate, extra-field, or mismatched result lines.

- [ ] **Step 4: Add a dedicated non-mail health IPC**

Add strict request/response schemas for:

```ts
runHealthCheck(input: {
  threadCount: number;
  rolloutStage: 3 | 10;
  headless: false;
}): Promise<{
  runId: string;
  artifactBasename: string;
  attempted: number;
  healthy: number;
  stopped: number;
  cleanupFailures: number;
}>;
```

Expose it as `IPC_CHANNELS.RUN_HEALTH` and `window.electronAPI.run.health`. Its schema requires `rolloutStage === threadCount` and permits only 3 or 10. The service creates a run-owned telemetry artifact with `mode='health'` and that exact stage, starts exactly `threadCount` ephemeral profiles, binds them to the run-scoped scheduler, performs the same attach/window/renderer health path as production, and stops every profile. It returns that artifact's exact `runId` and basename. It creates no work source, account row, proxy lease, mailbox reservation, OTP reader, or mission engine call. Reject concurrent health and automation runs.

- [ ] **Step 5: Add harness integration RED tests with fakes**

Implement this fake-collaborator matrix:

| Test name | Fake behavior | Required assertion |
|---|---|---|
| `health-only returns and validates its exact artifact without run.start` | Health returns attempted=healthy=stopped=N plus `run-health-a/run-health-a.jsonl`; fake evidence matches. | `runHealth` once, exact run ID reaches the reader/result line, `startRun`/provider/account/mail collaborators zero, exit 0. |
| `new-account mode sends every exact cap to run.start` | Stage 3 succeeds. | Config has threads/mailLimit/approved/stopAfter/maxBillablePurchases all 3 and transport `ui`. |
| `producer and validator resolve the same user-data directory` | App reports an absolute temp userData; fake writes one artifact there. | Reader receives that exact directory and exact run ID; stdout receives basename only. |
| `validates only the run id returned by this invocation` | Fake manifest points to run B while start returns run A. | Reader is called for A; B is ignored; mismatch inside A exits 4. |
| `fails evidence invariants with exit code four` | Separately inject stale receipt, total 11, duplicate key, status 1, cleanup failure, purchase over-cap, run/stage mismatch. | Every case exits 4 and kills Electron; no second stage starts. |
| `fails when resource peaks exceed the approved cap` | Report peak profiles=N+1. | Exit 4 even when all receipts show 12/12. |
| `does not advance to another rollout stage` | Stage 1 succeeds. | One `startRun` call with stage 1; no stage 3/5/10 call exists. |
| `terminates Electron and requests Stop when the deadline expires` | Run never becomes terminal. | `stopRun` then `killChild` each run once; exit 3; no evidence success claim. |
| `invalid and dry-run modes have zero side effects` | Enumerate every parser failure plus four valid dry-runs. | Electron/provider/proxy/mail/account/file-read counters all remain zero. |

- [ ] **Step 6: Implement the evidence validator**

`scripts/verify-rollout-evidence.mjs --run-id=RUN_ID --user-data-dir=ABSOLUTE_USER_DATA_DIR --expected=N --stage=N --mode=MODE` (where `MODE` is exactly `new`, `resume`, or `health`) opens only `rollout-evidence/RUN_ID.jsonl`, rejects path traversal, parses every JSONL line with the shared strict schema, and exits 4 unless the common invariants hold:

- one terminal event exists;
- artifact run ID, requested run ID, mode, stage, run-start event, and terminal event all agree;
- purchase event history is monotonic and terminal attempted/confirmed/ambiguous counters match it;
- peak workers/profiles/proxies/reservations are at most N;
- every started profile has one successful stop confirmation;
- no quarantine, unsafe fault, stale receipt, persistence failure, or cleanup failure exists.

Then branch by requested mode:

- `health`: exactly one health summary has `attempted=healthy=stopped=N` and `cleanupFailures=0`; accepted/completed/failed/stopped/skipped account counters, mailbox acquisitions, proxies, reservations, purchase budget/counters, task checkpoints, and account receipts are all zero;
- `resume`: accepted/completed account counts equal N and failed/stopped/skipped are zero; mailbox acquisitions and purchase budget/counters are zero; exactly N accounts have fresh final receipts, each with 12 unique status-4 tasks;
- `new`: accepted/completed account counts equal N and failed/stopped/skipped are zero; mailbox acquisitions equal N; attempted and confirmed purchases are at most the approved `maxBillablePurchases`, ambiguous is zero, and reused inventory may make confirmed less than N; exactly N accounts have fresh final receipts, each with 12 unique status-4 tasks.

The mutable `last-run.json` manifest may be used by an operator to locate a recent basename but is never read by the validator as acceptance authority. Print only aggregate values and task keys. Do not print artifact lines wholesale or the full user-data path.

- [ ] **Step 7: Run harness GREEN verification**

Run:

```powershell
npx vitest run scripts/__tests__/live-capcut-options.test.mjs scripts/__tests__/live-capcut-run.test.mjs src/main/__tests__/rolloutUserData.test.ts src/shared/contracts/__tests__/contracts.test.ts src/preload/__tests__/preload.test.ts src/main/ipc/__tests__/runtimeIpc.test.ts
```

Expected: PASS; fake side-effect counters remain zero for every invalid/dry-run path.

- [ ] **Step 8: Independent safety review checkpoint**

Reviewer attempts missing/mismatched caps including `maxBillablePurchases`, both billable providers, unknown options, headless mode, resume plus email, health plus email, a forged manifest, run/stage mismatches, and a repository-contained user-data path. Reject if any invalid combination reaches Electron/provider startup, if validation can switch to another run, or if the script can print a full path/raw log/email/profile/proxy field.

- [ ] **Step 9: Optional path-scoped commit after user authorization**

Stage only Task 13 files, inspect the staged diff, then:

```powershell
git commit -m "test: gate headed live rollout safely"
```

---

### Task 14: Run the complete offline verification and independent code review

**Files:**
- Verify: all implementation files changed by Tasks 1–13
- Update locally, never stage: `.superpowers/sdd/2026-09-06-headless-three-worker-hardening/progress.md`

**Interfaces:**
- Consumes: the complete implementation.
- Produces: one reproducible offline verification record; it does not authorize a live browser or mailbox purchase.

- [ ] **Step 1: Inspect scope and whitespace before tests**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Expected: only intended paths plus preserved pre-existing changes; `git diff --check` exits zero. Investigate overlap rather than reverting user changes.

- [ ] **Step 2: Rebuild the Node native module before focused Vitest**

Run:

```powershell
npm run rebuild:node
```

Expected: `better-sqlite3` is built for the current Node ABI and exits zero.

- [ ] **Step 3: Run the scheduler/lifecycle/recovery group**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts src/main/services/capcut/__tests__/boundedInteractions.test.ts src/main/services/capcut/__tests__/cancellation.test.ts src/main/services/capcut/__tests__/rendererHealth.test.ts src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/automationTaskProgress.test.ts
```

Expected: PASS, including all 100-seed matrices at 1, 3, 5, and 10 workers.

- [ ] **Step 4: Run the mission/evidence/auth group**

Run:

```powershell
npx vitest run src/main/services/capcut/__tests__/auth.test.ts src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/capcut/__tests__/claimReconciliation.test.ts src/main/services/capcut/__tests__/canvasFlowTimeout.test.ts src/main/services/capcut/__tests__/overlayGuard.test.ts src/main/services/capcut/__tests__/popoverLifecycle.test.ts src/main/services/capcut/__tests__/simple.test.ts src/main/services/capcut/__tests__/simpleActions.test.ts src/main/services/capcut/__tests__/designWorkspace.test.ts src/main/services/capcut/__tests__/runTelemetry.test.ts src/main/services/__tests__/CapcutEngineService.test.ts
```

Expected: PASS; no test permits stale/absent status to become done or a timed-out session to receive more input.

- [ ] **Step 5: Run persistence/UI/harness groups**

Run:

```powershell
npx vitest run src/main/database/__tests__/migrator.test.ts src/main/repositories/__tests__/accountTaskRepository.test.ts src/main/services/__tests__/AccountTaskService.test.ts src/main/services/__tests__/AccountService.test.ts src/main/services/__tests__/EmailPurchaseService.test.ts src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx scripts/__tests__/live-capcut-options.test.mjs scripts/__tests__/live-capcut-run.test.mjs src/main/__tests__/rolloutUserData.test.ts src/shared/contracts/__tests__/contracts.test.ts src/preload/__tests__/preload.test.ts src/main/ipc/__tests__/runtimeIpc.test.ts
```

Expected: PASS; dry-run/invalid options have zero side-effect calls and stale rows show unverified.

- [ ] **Step 6: Run repository-wide static/build checks**

Run each command separately:

```powershell
npm run typecheck
```

```powershell
npm run lint
```

```powershell
npm run selectors
```

```powershell
npm run build
```

Expected: every command exits zero; lint has zero warnings.

- [ ] **Step 7: Run Electron and final Node harnesses in ABI-safe order**

Before running Electron, inspect `package.json`'s `test:electron` target and every script/module it invokes. Confirm from source that the harness uses only fakes/local app startup and contains no CapCut/Multilogin/API-v3/xcli URL or launcher call, provider purchase/acquisition call, live-test glob, real proxy acquisition, or provider opt-in. Also run the Task 13 fake boundary tests and require their Electron/provider/proxy/mail/account side-effect counters to remain zero.

Only when that source review and fake gate pass, run:

```powershell
npm run test:electron
```

Expected: build, Electron native rebuild, and local harness pass without opening CapCut or calling providers. If the source proof is incomplete or the target can reach a live operation, do not run it; record `test:electron blocked by live-operation boundary`, keep the offline gate incomplete, and ask the user instead of treating it as passed.

Then run:

```powershell
npm run test:node
```

Expected: Node native rebuild and the complete Vitest suite pass. Record an ABI mismatch as a failure; do not call the suite green if tests were skipped by a binary-load error.

- [ ] **Step 8: Search source and generated test evidence for forbidden data**

Run only against the new schema/telemetry/harness tests and their temporary artifacts:

```powershell
rg -n "secret@example.com|capcut-password|otp-123456|profile-raw-id|proxy-pass|authorization-secret" src/main/services/capcut src/shared scripts
```

Expected: matches occur only as sentinel literals inside redaction tests, never production output templates or checked-in artifacts.

- [ ] **Step 9: Run Superpowers verification and request independent review**

Invoke `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`. The reviewer must compare the final diff against every acceptance criterion in the design spec, with special attention to session ownership, quarantine release, task freshness, purchase caps, and HTTP-only non-regression.

Expected: no unresolved correctness or security findings. Fix findings one at a time and rerun their focused tests plus the affected group.

- [ ] **Step 10: Record the offline result without a live-success claim**

Update the local progress ledger with command, exit code, test count, and commit/diff identity. The wording must say `offline gates passed` and must not say `12/12 restored`, because no authorized live task run has proved that yet.

- [ ] **Step 11: Keep the progress ledger local-only**

Run `git status --short` and confirm the `.superpowers/sdd/**` ledger is not staged or force-added. It is ignored because it may reference sensitive local evidence. If a tracked offline report is later requested, create a separately reviewed redacted file under `docs/superpowers/reports/`; do not repurpose the ignored ledger.

---

### Task 15: Execute the manually authorized rollout ladder and publish the evidence report

**Files:**
- Create/populate: `docs/superpowers/reports/2026-09-08-headed-ui-rollout.md`
- Read from the explicitly resolved Electron userData only: `rollout-evidence/{runId}.jsonl`
- Read locally, never commit: the strict account-ID file below that same userData directory

**Interfaces:**
- Consumes: the completed offline implementation, safe harness, evidence validator, and explicit user authorization per live stage.
- Produces: the only evidence allowed to support “3/3”, “5/5”, or “10/10 headed UI 12/12” claims.

- [ ] **Step 1: Create the redacted report structure before any live operation**

Use these sections: build identity; offline gate results; dry-run matrices; health results; existing-account recovery result; fresh stage 1/3/5/10 aggregate tables; scheduler queue/hold percentiles; session recycle counts; resource peaks; cleanup reconciliation; sanitized fault codes; final decision.

The report stores run IDs and worker/session aliases only. It must not contain account/email/profile/proxy/port/credential/OTP values or links to sensitive raw logs.

Resolve the actual userData directory once for this rollout. Do not assume an application folder name:

```powershell
$workspaceRoot = [IO.Path]::GetFullPath((Get-Location).Path)
$rolloutUserDataDir = [IO.Path]::GetFullPath((Read-Host 'Absolute Electron userData directory'))
if (-not [IO.Path]::IsPathFullyQualified($rolloutUserDataDir)) { throw 'userData must be absolute' }
if ($rolloutUserDataDir.StartsWith($workspaceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'userData must be outside the repository' }
$resumeAccountIdsFile = Join-Path $rolloutUserDataDir 'rollout\resume-account-ids.json'
```

The harness and validator must both receive `$rolloutUserDataDir`; neither prints it. Define this local parser once so every later gate consumes the exact harness run rather than a mutable manifest:

```powershell
function ConvertFrom-RolloutResult([string[]] $Lines) {
  $matches = @($Lines | Where-Object { $_ -like 'ROLLOUT_RESULT=*' })
  if ($matches.Count -ne 1) { throw 'Expected exactly one ROLLOUT_RESULT line' }
  $result = $matches[0].Substring('ROLLOUT_RESULT='.Length) | ConvertFrom-Json
  if ($result.runId -notmatch '^run-[A-Za-z0-9_-]+$') { throw 'Invalid runId' }
  if ($result.artifact -ne ($result.runId + '.jsonl')) { throw 'Artifact does not match runId' }
  return $result
}
```

- [ ] **Step 2: Validate all paid command shapes with dry-run**

These are non-side-effect commands after Task 13 is implemented:

```powershell
node --import tsx scripts/live-capcut-run.mjs --mode=dry-run --stage=1 --headed --threads=1 --mail-limit=1 --approved-mailboxes=1 --max-billable-purchases=1 --stop-after=1 --email=api:gmail94
```

```powershell
node --import tsx scripts/live-capcut-run.mjs --mode=dry-run --stage=3 --headed --threads=3 --mail-limit=3 --approved-mailboxes=3 --max-billable-purchases=3 --stop-after=3 --email=api:gmail94
```

```powershell
node --import tsx scripts/live-capcut-run.mjs --mode=dry-run --stage=5 --headed --threads=5 --mail-limit=5 --approved-mailboxes=5 --max-billable-purchases=5 --stop-after=5 --email=api:gmail94
```

```powershell
node --import tsx scripts/live-capcut-run.mjs --mode=dry-run --stage=10 --headed --threads=10 --mail-limit=10 --approved-mailboxes=10 --max-billable-purchases=10 --stop-after=10 --email=api:gmail94
```

Expected: every command prints only its validated aggregate configuration and exits before Electron/provider calls. Before these commands are treated as safe, Task 13's `invalid and dry-run modes have zero side effects` test must be green with all fake side-effect counts equal to zero.

- [ ] **Step 3: Pause for explicit authorization to run non-billable headed health checks**

After approval, run separately:

```powershell
$health3Lines = & node --import tsx scripts/live-capcut-run.mjs --mode=health-only --stage=3 --headed --threads=3 --minutes=15 "--user-data-dir=$rolloutUserDataDir"
if ($LASTEXITCODE -ne 0) { throw 'Three-profile health harness failed' }
$health3 = ConvertFrom-RolloutResult $health3Lines
& node --import tsx scripts/verify-rollout-evidence.mjs "--run-id=$($health3.runId)" "--user-data-dir=$rolloutUserDataDir" --expected=3 --stage=3 --mode=health
if ($LASTEXITCODE -ne 0) { throw 'Three-profile health evidence failed' }
```

Required: attempted=healthy=stopped=3, cleanupFailures=0, mailbox acquisitions=0, no quarantine.

Only after the three-profile health gate passes, and after another explicit go-ahead, run:

```powershell
$health10Lines = & node --import tsx scripts/live-capcut-run.mjs --mode=health-only --stage=10 --headed --threads=10 --minutes=30 "--user-data-dir=$rolloutUserDataDir"
if ($LASTEXITCODE -ne 0) { throw 'Ten-profile health harness failed' }
$health10 = ConvertFrom-RolloutResult $health10Lines
& node --import tsx scripts/verify-rollout-evidence.mjs "--run-id=$($health10.runId)" "--user-data-dir=$rolloutUserDataDir" --expected=10 --stage=10 --mode=health
if ($LASTEXITCODE -ne 0) { throw 'Ten-profile health evidence failed' }
```

Required: attempted=healthy=stopped=10 with the same zero-fault/zero-mail conditions.

- [ ] **Step 4: Prepare and authorize the zero-purchase existing-account recovery gate**

Place exactly the three real local account IDs from the failed 6/12 run at `$resumeAccountIdsFile`. The file must validate against this schema; do not put sample/fake IDs in the repository:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["accountIds"],
  "properties": {
    "accountIds": {
      "type": "array",
      "minItems": 3,
      "maxItems": 3,
      "uniqueItems": true,
      "items": { "type": "string", "minLength": 1 }
    }
  }
}
```

Never commit, print, or include the file contents in an error. The harness validates it before browser launch.

After explicit approval to launch the three existing accounts, run:

```powershell
$resumeLines = & node --import tsx scripts/live-capcut-run.mjs --mode=resume "--account-ids-file=$resumeAccountIdsFile" --stage=3 --headed --threads=3 --minutes=180 "--user-data-dir=$rolloutUserDataDir"
if ($LASTEXITCODE -ne 0) { throw 'Existing-account recovery harness failed' }
$resumeResult = ConvertFrom-RolloutResult $resumeLines
& node --import tsx scripts/verify-rollout-evidence.mjs "--run-id=$($resumeResult.runId)" "--user-data-dir=$rolloutUserDataDir" --expected=3 --stage=3 --mode=resume
if ($LASTEXITCODE -ne 0) { throw 'Existing-account recovery evidence failed' }
```

Required: zero mailbox acquisitions/account creates/signups; 3/3 final fresh receipts are exactly 12 status-4 tasks; every profile stops; all queues/resources return to zero. This proves safe resume but does not replace a fresh-account gate.

- [ ] **Step 5: Pause for approval of exactly one paid mailbox, then run stage 1**

Do not infer approval from any earlier message or stage. After approval, run the paid command inside a child PowerShell so the opt-in variable exists only for that one child process:

```powershell
$stage1Lines = & pwsh -NoProfile -Command {
  param($userDataDir)
  $env:VERIFY_GMAIL94_BUY = '1'
  & node --import tsx scripts/live-capcut-run.mjs --mode=new-accounts --stage=1 --headed --threads=1 --mail-limit=1 --approved-mailboxes=1 --max-billable-purchases=1 --stop-after=1 --minutes=90 --email=api:gmail94 "--user-data-dir=$userDataDir"
  exit $LASTEXITCODE
} -args $rolloutUserDataDir
if ($LASTEXITCODE -ne 0) { throw 'Stage 1 harness failed' }
$stage1 = ConvertFrom-RolloutResult $stage1Lines
& node --import tsx scripts/verify-rollout-evidence.mjs "--run-id=$($stage1.runId)" "--user-data-dir=$rolloutUserDataDir" --expected=1 --stage=1 --mode=new
if ($LASTEXITCODE -ne 0) { throw 'Stage 1 evidence failed' }
```

Required: exactly one acquisition/accepted/completed account, exactly 12 distinct status-4 tasks in a fresh final receipt, attempted/confirmed purchases at most one, ambiguous purchases zero, no fault/quarantine, and complete cleanup. The parent shell never receives the provider opt-in flag.

- [ ] **Step 6: Pause for a new approval of exactly three paid mailboxes, then run stage 3**

Only after stage 1 is green, use a new child process with the newly authorized cap:

```powershell
$stage3Lines = & pwsh -NoProfile -Command {
  param($userDataDir)
  $env:VERIFY_GMAIL94_BUY = '1'
  & node --import tsx scripts/live-capcut-run.mjs --mode=new-accounts --stage=3 --headed --threads=3 --mail-limit=3 --approved-mailboxes=3 --max-billable-purchases=3 --stop-after=3 --minutes=180 --email=api:gmail94 "--user-data-dir=$userDataDir"
  exit $LASTEXITCODE
} -args $rolloutUserDataDir
if ($LASTEXITCODE -ne 0) { throw 'Stage 3 harness failed' }
$stage3 = ConvertFrom-RolloutResult $stage3Lines
& node --import tsx scripts/verify-rollout-evidence.mjs "--run-id=$($stage3.runId)" "--user-data-dir=$rolloutUserDataDir" --expected=3 --stage=3 --mode=new
if ($LASTEXITCODE -ne 0) { throw 'Stage 3 evidence failed' }
```

Required: 3/3 independent fresh 12/12 receipts, attempted/confirmed purchases at most three, ambiguous zero, peak resources at most three, zero failed/stopped/skipped accounts, and zero unsafe fault/quarantine/cleanup failure. This is the first valid “headed UI restored at three workers” claim.

- [ ] **Step 7: Pause for a new approval of exactly five paid mailboxes, then run stage 5**

Only after stage 3 is green and a separate five-mailbox approval, run:

```powershell
$stage5Lines = & pwsh -NoProfile -Command {
  param($userDataDir)
  $env:VERIFY_GMAIL94_BUY = '1'
  & node --import tsx scripts/live-capcut-run.mjs --mode=new-accounts --stage=5 --headed --threads=5 --mail-limit=5 --approved-mailboxes=5 --max-billable-purchases=5 --stop-after=5 --minutes=300 --email=api:gmail94 "--user-data-dir=$userDataDir"
  exit $LASTEXITCODE
} -args $rolloutUserDataDir
if ($LASTEXITCODE -ne 0) { throw 'Stage 5 harness failed' }
$stage5 = ConvertFrom-RolloutResult $stage5Lines
& node --import tsx scripts/verify-rollout-evidence.mjs "--run-id=$($stage5.runId)" "--user-data-dir=$rolloutUserDataDir" --expected=5 --stage=5 --mode=new
if ($LASTEXITCODE -ne 0) { throw 'Stage 5 evidence failed' }
```

Required: 5/5 independent fresh 12/12 receipts, purchase counters within five with ambiguous zero, and all stage-3 invariants. Any one incomplete account fails the entire stage and blocks stage 10.

- [ ] **Step 8: Pause for a new approval of exactly ten paid mailboxes, then run stage 10**

Only after stage 5 is green and a separate ten-mailbox approval, run:

```powershell
$stage10Lines = & pwsh -NoProfile -Command {
  param($userDataDir)
  $env:VERIFY_GMAIL94_BUY = '1'
  & node --import tsx scripts/live-capcut-run.mjs --mode=new-accounts --stage=10 --headed --threads=10 --mail-limit=10 --approved-mailboxes=10 --max-billable-purchases=10 --stop-after=10 --minutes=600 --email=api:gmail94 "--user-data-dir=$userDataDir"
  exit $LASTEXITCODE
} -args $rolloutUserDataDir
if ($LASTEXITCODE -ne 0) { throw 'Stage 10 harness failed' }
$stage10 = ConvertFrom-RolloutResult $stage10Lines
& node --import tsx scripts/verify-rollout-evidence.mjs "--run-id=$($stage10.runId)" "--user-data-dir=$rolloutUserDataDir" --expected=10 --stage=10 --mode=new
if ($LASTEXITCODE -ne 0) { throw 'Stage 10 evidence failed' }
```

Required: 10/10 independent fresh 12/12 receipts; attempted/confirmed purchases at most ten and ambiguous zero; peak workers/profiles/proxies/reservations at most ten; every session stopped exactly once; no partial/fatal/stopped/skipped account; no starvation, stale receipt, quarantine, late action, or cleanup failure.

- [ ] **Step 9: Stop immediately on a failed gate**

On any nonzero harness/validator result, do not rerun paid accounts and do not advance. Preserve the redacted artifact, record the first failing invariant and seed/run alias, return to the owning offline task, add a deterministic RED test, implement one correction, and repeat the complete offline gate before requesting new live authorization.

- [ ] **Step 10: Verify the report and make only evidence-supported claims**

Invoke `superpowers:verification-before-completion`. Cross-check report aggregates against the validator output and ensure no forbidden values exist. Permitted final wording depends on the last green stage:

- stage 3 green: `3/3 headed UI workers verified 12/12`;
- stage 5 green: add `verified through five workers`;
- stage 10 green: add `10/10 headed UI workers verified 12/12`.

If a stage was not run or did not pass, say so explicitly. Never extrapolate ten-worker readiness from a three-worker result.

- [ ] **Step 11: Optional path-scoped report commit after user authorization**

```powershell
git add docs/superpowers/reports/2026-09-08-headed-ui-rollout.md
git commit -m "docs: report headed UI rollout evidence"
```

Do not stage raw JSONL evidence, local account-ID files, screenshots, or `.superpowers` live logs.

## Final definition of done

Implementation is not complete merely because unit tests pass. Offline implementation is complete only after Tasks 1–14 pass and receive independent review. The user-facing claim that multi-worker headed UI is restored is not allowed until the corresponding Task 15 live gate passes with fresh, redacted server evidence and cleanup reconciliation.
