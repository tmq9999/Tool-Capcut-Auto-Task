# Continuous Automation And Performance Design

**Date:** 2026-09-05  
**Status:** Implemented and verified (see `docs/superpowers/reports/2026-09-05-continuous-automation-performance-verification.md`)  
**Target:** AutoManager v2.4.1, Windows/Electron  
**Primary executor:** Gemini 3.8 in Antigravity Code  
**Implementation plan:** `docs/superpowers/plans/2026-09-05-continuous-automation-performance.md`  
**Execution runbook:** `docs/antigravity/2026-09-05-continuous-automation-performance-gemini-3.8.md`  

## 1. Purpose

This design fixes the automation run model that currently treats `threadCount`
as both concurrency and total work, buys all API mailboxes before useful browser
work begins, accepts partial purchases silently, and spends repeated 45-second
timeouts reconciling fast CapCut tasks.

The result must:

- keep API/custom workers running with new emails until Stop or a typed terminal
  condition;
- process every valid manual entry with `threadCount` as the concurrency ceiling;
- acquire paid email just in time after non-billable capacity is available;
- distinguish completed, stopped, blocked, and failed runs;
- preserve account errors through teardown;
- remove redundant PWA/task waits without weakening CapCut proof or human-behavior
  safeguards;
- close active automation safely when Electron exits.

## 2. Verified Baseline

The following are observed properties of the current code, not hypotheses.

### 2.1 Finite queue caused by overloaded `threadCount`

- `AutomationRunService.buildThreadPlans()` purchases `config.threadCount`
  mailboxes at once.
- The result is sliced to `config.threadCount`.
- `runPrepared()` drains that fixed array and terminates.
- Therefore one configured worker processes one account and the run stops instead
  of asking for another email.

Evidence:

- `src/main/services/AutomationRunService.ts`
- `src/main/services/__tests__/AutomationRunService.test.ts`

### 2.2 Partial Gmail acquisition is accepted silently

- `EmailPurchaseService.purchaseGmail94()` catches each order failure and returns
  any successful subset.
- `AutomationRunService` continues when at least one mailbox was returned.
- The current regression test explicitly accepts requested `3` becoming a run of
  `1`.

This makes a provider error look like a lower thread setting and hides the real
reason from the operator.

### 2.3 Paid email is acquired too early

All requested Gmail94 orders are issued sequentially before any worker acquires a
proxy or starts Multilogin. A slow/failing later order delays all useful work, and
a browser/proxy validation failure can occur only after money has been spent.

There is no run-start capacity check combining:

- unconsumed, unreserved paid mailboxes already in SQLite whose Gmail94 service
  is `capcut`;
- current Gmail94 balance;
- current price of the `capcut` service;
- configured initial concurrency.

### 2.4 Workload errors are overwritten during shutdown

`runThreadWorkload()` writes `status: "error"`, but `shutdownThread()` later writes
`status: "done"` unconditionally. Workload failures also do not increment
`threadsFailed`. The final account row and counters can therefore contradict the
runtime log.

### 2.5 Fast PWA work is followed by slow duplicate waits

The PWA action itself waits about 2.5-3.5 seconds after dispatching the install
signals. Then:

1. `runGroup()` may wait 45 seconds for `do_action` proof.
2. `runAllTasks()` independently waits another 45 seconds for a new snapshot.
3. A retry round may add an 18-22 second blind sleep and another 45-second
   snapshot wait.
4. `retryCount: 3` maps to as many as four rounds.

A matching proof can already exist while an older `snap` still selects the same
group for another round.

Evidence:

- `src/main/services/capcut/missions/simple.ts`
- `src/main/services/capcut/missionRunner.ts`
- `src/main/services/capcut/runTasks.ts`

### 2.6 Lifecycle gaps

- Main-tab `close` and `crash` handlers only log; they do not recover a usable
  CapCut page.
- Electron shutdown disposes subscriptions/logging and closes SQLite without first
  stopping the active automation run.
- The application does not hold an Electron single-instance lock before opening
  the database and runtime stack.

### 2.7 Current verification debt

At audit time:

- build, typecheck, lint, and focused automation/CapCut tests passed;
- the selector suite had 86 passing assertions and one failure: the
  `#graphic-editor-render` fixture measured height `65`, while the assertion
  required `> 300`;
- the full Node Vitest run was blocked for 193 tests by a local
  `better-sqlite3` ABI mismatch (`NODE_MODULE_VERSION 133` installed vs `137`
  required by the current Node process), not by 193 test assertions.

These facts are baseline evidence only. Implementation must run fresh verification.

## 3. Goals

### G1. Continuous sources

For `emailSource.mode === "api"` and `emailSource.mode === "custom"`, maintain up
to `threadCount` worker loops. When an account reaches a terminal outcome and its
resources are released, that worker requests another work item automatically.

### G2. Finite manual source

For `emailSource.mode === "manual"`, process every valid pasted entry exactly once
per run. `threadCount` is only the maximum simultaneous worker count.

### G3. Just-in-time paid acquisition

Acquire one email for one worker only after that worker has obtained its required
proxy capacity. Reuse and reserve already-paid mailboxes before issuing a new
order.

### G4. Honest state

Run state, terminal reason, counters, account status, and logs must agree. Resource
cleanup cannot rewrite the workload outcome.

### G5. Bounded task reconciliation

Use a single post-action evidence deadline for `do_action` plus task snapshot
reconciliation. A proof-backed task is not performed twice in the same run merely
because a snapshot arrived late.

### G6. Measurable performance

Emit per-stage elapsed times so real runs can show where time is spent. Acceptance
is based on stage timing, not subjective UI speed.

## 4. Non-Goals

This change does not:

- add support for `trial` or `team` automation modules;
- add GoLogin, GPM, Camoufox, or Patchright runtime implementations;
- bypass CapCut `do_action`/`task_status` proof;
- remove `human.ts`, pointer trajectories, type delay floors, or measured mission
  jitter;
- redesign the Dashboard shell or DataGrid;
- replace SQLite, `better-sqlite3`, Playwright, or the provider abstraction;
- perform an unapproved live mailbox purchase during testing;
- promise a fixed end-to-end duration for vendor, browser, OTP, or generation
  operations outside the application's control.

## 5. Core Model

### 5.1 `threadCount` definition

Keep the persisted field name for backward compatibility. Its only meaning after
this change is:

> Maximum number of worker iterations that may be active at the same time.

It is not:

- a Gmail purchase count;
- a total-account limit;
- a manual-list slice length;
- a proxy queue length.

For a manual list shorter than `threadCount`, start only the number of workers for
which work exists and report that fact. This is natural source exhaustion, not a
provider failure.

Manual parsing validates every non-empty line. Invalid lines are reported with
their one-based line numbers instead of being silently discarded. Duplicate valid
lines remain separate work items because the operator supplied them separately.

For proxy-key mode, initial validation requires at least `threadCount` usable keys
in the run's configured key set. Blocking before email purchase is preferable to
silently running fewer workers than requested. Direct proxy mode retains its
current exact-count validation when entries are supplied.

### 5.2 Work source abstraction

`AutomationRunService` consumes a run-scoped source with this conceptual contract:

```ts
type WorkSourceKind = 'finite' | 'continuous';

interface AutomationWorkItem {
  email: string;
  emailProvider: string;
  emailPassword?: string;
  purchasedEmailId?: string;
  reservationId?: string;
}

interface AutomationWorkSource {
  readonly kind: WorkSourceKind;
  prepare(initialConcurrency: number, signal: AbortSignal): Promise<SourceReadiness>;
  next(workerId: string, signal: AbortSignal): Promise<AutomationWorkItem | null>;
  commit(item: AutomationWorkItem, accountId: string): void;
  release(item: AutomationWorkItem): void;
}
```

`null` from a finite source means completed exhaustion. A continuous source does
not return `null`; it either yields work, waits/retries, or throws a typed terminal
condition.

Source construction remains in the main-process service layer. Provider-specific
response shapes do not cross into `AutomationRunService`.

### 5.3 Worker loop

Each worker owns one iteration at a time:

```text
check cancellation
  -> finite manual: dequeue one free entry; exit if exhausted
  -> acquire/assign proxy capacity
  -> continuous API/custom: acquire one work item just in time
  -> create processing account row
  -> launch one browser profile
  -> commit mailbox to that account immediately before CapCut can use it
  -> authenticate/register and run CapCut tasks
  -> record one terminal account outcome
  -> close that profile and release that proxy
  -> request the next work item
```

If mailbox acquisition fails after a proxy lease was acquired, release the lease.
If browser launch fails before CapCut uses the mailbox, release the mailbox
reservation so the paid order can be reused.

The mailbox remains reserved, not consumed, while the browser launches. Commit it
only after launch succeeds and immediately before the engine can enter signup/auth.

Manual work is dequeued before proxy acquisition so exhausted workers do not obtain
and rotate a proxy unnecessarily. API/custom email materialization remains after
proxy acquisition; this is the ordering that protects billable operations.

The loop never owns another worker's profile, proxy lease, mailbox reservation, or
account outcome.

## 6. Gmail94 Capacity And Acquisition

### 6.1 Safe preflight

Extend the Gmail94 service slice used by `EmailPurchaseService` with the existing
safe reads:

```ts
getProfile(token: string): Promise<Gmail94Profile>;
listServices(): Promise<Gmail94Service[]>;
```

The preflight result is provider-neutral and contains no secret:

```ts
interface EmailCapacitySnapshot {
  provider: 'gmail94';
  service: 'capcut';
  balance: number;
  unitPrice: number;
  reusableCount: number;
  affordablePurchaseCount: number;
  totalAvailableCount: number;
  checkedAt: string;
}
```

`getProfile()` and `listServices()` may execute in parallel because both are
non-billable reads. Preflight fails clearly if:

- balance is absent or invalid;
- the `capcut` service is absent;
- price is absent, non-finite, or not greater than zero;
- authentication/configuration is invalid.

For Gmail94, rows bought under another service slug (for example legacy
`facebook` rows) are not reusable for this run and are not included in
`reusableCount`; `readOtp` must honor the order's service, so counting them would
overstate usable capacity.

`totalAvailableCount = reusableCount + floor(balance / unitPrice)`.

Before starting a continuous Gmail94 run, require
`totalAvailableCount >= threadCount`. If not, make no new purchase and terminate as
`blocked` with safe details: requested workers, reusable count, balance, unit price,
and affordable purchase count.

Preflight is a guard, not a balance reservation. Each actual purchase still handles
the vendor response honestly.

### 6.2 Atomic mailbox reservation

Migration `005` adds nullable reservation metadata to `purchased_emails`:

```text
reserved_by TEXT
reserved_at TEXT
```

Repository operations are transactional and conditional:

- reserve the oldest row where provider matches, `consumed_at IS NULL`,
  `reserved_by IS NULL`, and any required provider service matches (`capcut` for
  Gmail94);
- return exactly the row whose update succeeded;
- release only when the caller's reservation ID matches;
- consume only when the caller's reservation ID matches;
- count only unreserved, unconsumed, service-compatible reusable rows for
  preflight.

Migration `005_purchased_email_reservations` also adds an availability index whose
leading columns match the real Gmail94 query: provider, service, consumed state,
reservation state, then purchase time. Do not add unrelated indexes.

On application startup, before any run can start, clear `reserved_by` and
`reserved_at` for every row where `consumed_at IS NULL` and `reserved_by IS NOT
NULL`. At this point every such reservation belongs to a previous process. The
Electron single-instance lock makes that recovery safe: no other live AutoManager
process may own those rows.

Do not use an in-memory-only reservation; SQLite is the cross-worker and
crash-recovery source of truth.

### 6.3 Serialized purchase coordinator

Only the small purchase critical section is serialized per provider:

1. Enter the provider acquisition queue.
2. Recheck for a reusable unreserved mailbox.
3. If none exists, issue one vendor order.
4. Insert the purchased row already reserved to this worker/run.
5. Leave the queue.

Browser work, OTP polling, task execution, and proxy work continue concurrently.
This creates a pipeline: worker 1 may launch its browser while worker 2 buys its
mailbox, without concurrent balance races at Gmail94.

The coordinator keeps a run-local affordable-purchase budget from the initial
preflight and decrements it after each successful new order. When that budget
reaches zero, refresh the safe balance before deciding the run is blocked; this
allows an operator top-up to be recognized. If Gmail94 unexpectedly reports
insufficient funds earlier, refresh profile balance once and use that fresh value
plus the cached CapCut service price in the terminal details.

### 6.4 Retry policy

Provider purchase retry policy is explicit:

- retry `NETWORK_ERROR` and `RATE_LIMITED` only;
- at most three total attempts;
- wait 500 ms before attempt 2 and 1,500 ms before attempt 3;
- make waits cancellation-aware;
- never retry `AUTH_ERROR`, `CONFIG_ERROR`, or `INSUFFICIENT_FUNDS`;
- preserve one sanitized final error with attempt count and provider name.

Add `INSUFFICIENT_FUNDS` to the normalized provider error code schema. Classify it
only from a response fixture/shape observed from Gmail94; do not invent vendor
fields or log raw payloads.

When genuine insufficient balance occurs after a run has processed accounts, stop
accepting new work, let already-running account workloads finish, release their
resources, and end the run as `blocked`. Do not call it `completed` and do not
rewrite it to `stopped`.

## 7. Run State And Counters

### 7.1 State enum

The run state schema becomes:

```ts
type AutomationRunState =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'stopped'
  | 'blocked'
  | 'failed';
```

Terminal meaning:

- `completed`: finite manual work was naturally exhausted.
- `stopped`: explicit user Stop or application shutdown.
- `blocked`: an expected external condition requires operator action, such as
  insufficient funds, invalid provider authentication, or unavailable required
  proxy capacity.
- `failed`: an unexpected internal invariant or fatal run error.

### 7.2 Typed terminal reason

Progress includes an optional sanitized reason:

```ts
type AutomationTerminalCode =
  | 'MANUAL_EXHAUSTED'
  | 'USER_STOP'
  | 'APP_SHUTDOWN'
  | 'INSUFFICIENT_FUNDS'
  | 'PROVIDER_AUTH_REQUIRED'
  | 'PROVIDER_CONFIG_ERROR'
  | 'PROVIDER_RETRY_EXHAUSTED'
  | 'PROXY_CAPACITY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

interface AutomationTerminalReason {
  code: AutomationTerminalCode;
  provider?: string;
  details?: Record<string, string | number | boolean>;
}
```

Details may include safe counts, balance, price, and timestamps. They may not
include tokens, passwords, raw responses, proxy keys, mailbox secrets, or OAuth
material.

### 7.3 Progress counters

Replace ambiguous browser-close-derived progress with explicit counters:

```ts
interface AutomationRunCounters {
  workerTarget: number;
  workersActive: number;
  accountsAccepted: number;
  accountsCompleted: number;
  accountsFailed: number;
  accountsStopped: number;
}
```

Counter rules:

- increment `accountsAccepted` once when a worker commits to an item/account;
- increment exactly one of completed, failed, or stopped for each accepted account;
- `workersActive` is a gauge, not a cumulative browser count;
- a workload exception increments `accountsFailed` even when browser cleanup later
  succeeds;
- provider acquisition failure before accepting an account changes run state/reason
  but does not create a phantom failed account;
- counters never decrement and never infer account success from profile closure.

The renderer, IPC contracts, preload tests, and controller active-state set update
in the same change. Compatibility aliases may be kept internally for one release,
but the public DTO must have one unambiguous meaning.

`workersActive` counts worker iterations from the start of proxy acquisition until
that iteration finishes resource cleanup. For continuous sources,
`waitForCompletion()` remains pending while workers can accept more work and
resolves only after completed, stopped, blocked, or failed termination.

Preparation failures happen before the run is accepted. `start()` publishes the
terminal progress/reason, clears active run state, and returns the matching typed
IPC error envelope instead of returning a successful `runId`. A terminal condition
encountered after acceptance is delivered through progress events and
`waitForCompletion()`.

## 8. Account Outcome And Cleanup

Add `stopped` to `AccountStatusEnum`. No SQL migration is needed for the status
column because it is unconstrained text; schema, UI badges/filters, and tests must
still update together.

Each thread records a terminal outcome once:

```ts
type ThreadOutcome =
  | { kind: 'completed'; status: 'done'; step: string }
  | { kind: 'failed'; status: 'error'; step: string }
  | { kind: 'stopped'; status: 'stopped'; step: string };
```

`shutdownThread()` only releases resources. It may clear `browserProfileId` and
write cleanup diagnostics, but it does not choose or overwrite `status` or the
workload's terminal `automationStep`.

If cleanup itself fails:

- retain the workload outcome;
- log a cleanup warning/error with elapsed time;
- include cleanup failure in the run's terminal diagnostics;
- do not count the account as workload-failed a second time.

Skipped-without-trial remains an intentional completed account with a precise
step, not a failure and not a user stop.

## 9. Cancellation And Application Shutdown

Each run owns an `AbortController`. The signal is passed to work-source waits,
provider backoff, proxy waits where supported, OTP polling, and orchestration
delays.

User Stop:

1. Set the run terminal intent to `USER_STOP`.
2. Abort acquisition and retry waits.
3. Prevent every worker from requesting another item.
4. Close active owned profiles to interrupt Playwright work.
5. Release active proxy leases and uncommitted mailbox reservations.
6. Await worker settlement and publish `stopped`.

`stopThread(accountId)` stops the current account iteration only. It records that
account as stopped and releases its resources; while the overall run remains
running, the worker slot refills from the next source item. Global Stop is the only
operation that prevents all worker slots from refilling.

Application shutdown follows the same path with `APP_SHUTDOWN`, then flushes logs,
then closes SQLite, then quits Electron. The database must remain open until all
workers have stopped writing terminal account/task/log state.

`createShutdownManager()` receives the automation stopper and uses separate,
reported bounds for automation stop and log flush. Timeout does not permit silent
resource abandonment; it emits a sanitized shutdown diagnostic before forced app
exit.

Acquire `app.requestSingleInstanceLock()` before opening SQLite or creating the
provider stack. A second launch focuses/restores the existing main window and exits
without touching runtime resources.

## 10. CapCut Proof Reconciliation

### 10.1 One deadline, two required signals

Keep the hard success rule:

1. observe matching `do_action` with `err_no === 0`;
2. re-read CapCut's own `task_status`.

Replace the independent proof and snapshot waits with one reconciliation operation
using one remaining-time budget. Conceptually:

```ts
interface MissionEvidence {
  key: string;
  proof?: ActionProof;
  snapshotStatus?: number;
  state: 'verified' | 'proved-awaiting-snapshot' | 'failed';
  error?: Error;
}
```

The action start timestamp filters old proof. The post-action deadline starts when
`group.act()` settles; proof already captured during `act()` is consumed
immediately. Snapshot waiting uses only the remaining deadline, never a fresh
45-second budget.

`verified` requires proof success plus a fresh snapshot status of `4`. A proof with
no fresh confirming snapshot becomes `proved-awaiting-snapshot`: it is not reported
as completed, but it is excluded from further UI actions in the current run and is
reconciled by later snapshots/finalization.

A fresh snapshot that still says incomplete wins over internal optimism. The task
remains missing, but is still not blindly replayed in the same run after a successful
proof. The next run may retry it using persisted CapCut state.

### 10.2 Timing budgets

- PWA install post-action proof/reconciliation deadline: **12 seconds**.
- Notification post-action proof/reconciliation deadline: **20 seconds**.
- Design Studio: retain **90 seconds** unless new measured evidence supports a
  smaller value.
- Video Studio: retain **240 seconds** unless new measured evidence supports a
  smaller value.
- Inter-round event/snapshot wait: at most **8 seconds**, cancellation-aware; remove
  the blind 18-22 second sleep.
- Final fresh snapshot wait: at most **10 seconds**.

The PWA mission's existing 2.5-3.5 second propagation wait remains. The acceptance
target is that, after `act()` settles with a captured successful proof, bookkeeping
does not add more than the single 12-second deadline and never adds a second
45-second wait.

### 10.3 Per-run proof memory

Maintain a set/map of successful proofs for the account run. Group selection
excludes keys that are already status `4` or proof-backed during this run. A stale
snapshot cannot re-enable an already proof-backed UI action.

Persisted task progress remains derived from CapCut status, with the existing safe
fallback for a genuinely stale final snapshot. Do not weaken the rule by letting a
mission set `done` itself.

## 11. Main-Tab Recovery

Logging close/crash remains required but is not the whole behavior.

At safe boundaries (before auth/trial and before each mission group), resolve a
usable primary CapCut page:

1. Keep the current page if it is open.
2. Otherwise select the newest open `https://www.capcut.com` page in the same
   context.
3. Otherwise create one replacement page and navigate to the known main URL.
4. Allow at most one created replacement per account run.

If a page closes during a mission, that mission fails normally. The next round may
recover at the boundary and continue only unverified/unproved tasks. Do not restart
an entire account after proof may already have been emitted.

A second crash/close requiring another created replacement ends the account as
`error` with the exact sanitized reason.

## 12. Selector Gate

Resolve the existing `#graphic-editor-render` selector failure before treating the
suite as green.

Required investigation order:

1. Inspect the fixture viewport/geometry and the assertion that expects height
   greater than 300.
2. Compare with the DOM/screenshot evidence that originally justified the guard.
3. Decide whether the fixture is incomplete, the geometry setup is wrong, or the
   assertion is stale.
4. Fix the evidence or assertion for the measured reason; do not simply lower the
   threshold to make the test pass.

Any selector behavior change still starts with a red fixture assertion as required
by `AGENTS.md` and `docs/AUTOMATION-ENGINE.md`.

## 13. Observability And UI

### 13.1 Stage timing

Emit one canonical log at the end of each stage with `elapsedMs` embedded in the
message or structured safe metadata supported by the existing log contract:

- source preflight;
- proxy acquisition;
- email reservation/purchase;
- browser launch/CDP attach;
- authentication and OTP;
- trial check;
- each mission action;
- proof/snapshot reconciliation;
- browser/proxy/mailbox cleanup;
- full account duration.

Use a monotonic clock for elapsed duration (`performance.now()` or injected test
clock), while persisted event timestamps remain wall-clock ISO values.

Do not log keys, passwords, order payloads, refresh tokens, proxy credentials, or
raw provider responses.

### 13.2 Dashboard behavior

The Dashboard must:

- treat `preparing`, `running`, and `stopping` as active;
- render `completed`, `stopped`, `blocked`, and `failed` distinctly;
- display the typed terminal message and safe capacity details;
- show configured worker concurrency separately from cumulative account outcomes;
- keep Stop available while preparing/running/stopping as appropriate;
- not report success merely because all browser profiles closed.

Replace copy that currently says "buy/create `threadCount` emails when Start is
pressed". API/custom copy must explain that the app maintains up to
`threadCount` concurrent workers and obtains one email when a worker slot is
ready. Manual copy must explain that every valid line is processed with that
concurrency limit.

No visual redesign is required. Reuse current components and design tokens.

## 14. Compatibility And Migration

- Persisted automation settings keep the `threadCount` field and its numeric range.
- Existing saved configurations need no settings migration; only semantics change.
- Database migration `005` is additive and preserves every purchased email row.
- Startup reservation recovery operates only on `consumed_at IS NULL` rows.
- Existing `account_tasks` data and CapCut task proof rules remain intact.
- IPC schema changes are coordinated across shared contracts, main handlers,
  preload, renderer controller, and tests in one implementation task.
- `playwright-core` and `better-sqlite3` remain external in Vite configuration.

## 15. Test Strategy

Implementation follows TDD. Required regression coverage includes:

### Work-source and worker-loop tests

- API source with `threadCount: 1` starts a second account after the first finishes.
- API source never has more than `threadCount` active worker iterations.
- Stop after one account prevents purchase/acquisition of a subsequent mailbox.
- Manual source processes all entries when entries exceed `threadCount`.
- Manual source ends `completed` with `MANUAL_EXHAUSTED`.
- A source shorter than concurrency reports the smaller natural worker count.

### Gmail capacity/acquisition tests

- preflight combines reusable count, balance, CapCut price, and timestamp;
- legacy Gmail94 rows bought for a non-`capcut` service are excluded from
  reusable capacity and reservation;
- profile and service-list safe reads do not issue a purchase;
- insufficient initial capacity produces `blocked` before any order;
- two concurrent reservations never return the same purchased-email row;
- a browser launch failure releases the matching reservation;
- an acquired mailbox is committed once and cannot be re-reserved;
- transient failures use exactly the bounded retry schedule;
- authentication/configuration/insufficient-funds errors are not retried;
- partial initial acquisition is surfaced as a terminal reason, not a smaller run;
- no test output contains API keys or raw credential payloads.

### Outcome/state tests

- workload error remains account `error` after profile/proxy cleanup;
- workload error increments `accountsFailed` exactly once;
- successful work remains `done` after cleanup;
- user stop marks unfinished work `stopped` without changing prior terminal rows;
- finite completion, user stop, external block, and fatal failure publish distinct
  state/reason pairs;
- Dashboard active state and terminal rendering cover every enum member.

### Performance/proof tests

- a PWA proof captured during `act()` is consumed without a 45-second wait;
- proof plus delayed snapshot shares one 12-second budget;
- no fresh snapshot leaves the task proof-backed and excluded from the next round;
- a stale snapshot does not cause the same action to run twice;
- inter-round wait is event-driven and capped at eight seconds;
- final snapshot wait is capped at ten seconds;
- existing proof, inert, hittable, enabled, and human-pace tests remain green.

Use fake timers/injected clocks for timing tests; do not make unit tests sleep in
real time.

### Lifecycle tests

- app shutdown awaits automation stop before log flush and DB close;
- shutdown remains idempotent under repeated `before-quit` events;
- second-instance startup does not initialize SQLite/providers;
- main-tab recovery reuses an existing CapCut page before creating one;
- only one replacement page is created per account;
- recovery does not replay proof-backed tasks.

### Verification commands

At minimum:

```powershell
npm run rebuild:node
npm run typecheck
npm run lint
npm run build
npm run selectors
npx vitest run src/main/repositories/__tests__/purchasedEmailRepository.test.ts
npx vitest run src/main/services/__tests__/EmailPurchaseService.test.ts
npx vitest run src/main/services/__tests__/AutomationRunService.test.ts
npx vitest run src/main/services/__tests__/automationTaskProgress.test.ts
npx vitest run src/main/services/capcut/__tests__/missionRunner.test.ts
npx vitest run src/main/services/capcut/__tests__/simple.test.ts
npx vitest run src/main/__tests__/lifecycle.test.ts
npx vitest run src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts
npm run test:node
npm run test:electron
```

After Node tests, `npm run test:electron` rebuilds `better-sqlite3` for Electron.
If development continues with Node Vitest afterward, run `npm run rebuild:node`
again.

Live verification:

- safe Gmail94 profile/service preflight may run with credentials;
- a real purchase requires explicit user approval plus
  `VERIFY_GMAIL94_BUY=1`;
- the live purchase test defaults to the constant `capcut` service, not
  `facebook`;
- if no approved live purchase occurs, report: "Implemented but not verified
  against a billable Gmail94 order."

## 16. Acceptance Criteria

The change is accepted only when all of the following are evidenced:

1. API/custom runs refill a freed worker with a new email and continue until Stop
   or a typed terminal condition.
2. Manual runs process the full valid list and finish as `completed`.
3. `threadCount` controls concurrency only in schemas, service behavior, UI copy,
   tests, and documentation.
4. Gmail94 preflight blocks an unaffordable initial wave before a purchase,
   excludes incompatible service rows, and reports exact safe counts.
5. Mailbox reservation is atomic and crash-recoverable through SQLite migration
   `005`.
6. Paid orders are issued one at a time just in time after proxy capacity is held.
7. A workload error remains `error` after teardown and is counted exactly once.
8. Completed, stopped, blocked, and failed runs are distinguishable through typed
   IPC and Dashboard state.
9. The PWA path has no sequential 45-second proof plus 45-second snapshot wait.
10. A successful proof cannot cause the same task action to rerun in the same
    account run because of a stale snapshot.
11. Stage elapsed times appear in sanitized runtime logs.
12. Main-tab recovery has a one-replacement budget and does not replay proven work.
13. Electron shutdown stops automation before logs/SQLite, and single-instance
    locking occurs before runtime initialization.
14. The selector suite is green for an evidence-based reason.
15. Typecheck, lint, build, focused tests, full Node tests, and Electron harness
    pass, or any environment-only blocker is reported with exact evidence.
16. No billable live operation occurs without explicit approval.

## 17. Implementation Order

The implementation plan must preserve this dependency order:

1. Shared error/state/counter contracts.
2. Migration `005` and atomic purchased-email reservation repository.
3. Gmail94 capacity preflight and one-item acquisition coordinator.
4. Finite/continuous work-source abstraction.
5. Continuous worker lifecycle, terminal outcomes, and cancellation.
6. IPC/preload/Dashboard state integration.
7. Unified CapCut proof/snapshot deadline and proof memory.
8. Stage timing instrumentation.
9. Main-tab recovery.
10. Application shutdown and single-instance lock.
11. Selector-gate repair and full verification.

Each step must leave a reviewable, testable state and must not perform a live
billable Gmail94 call by default.
