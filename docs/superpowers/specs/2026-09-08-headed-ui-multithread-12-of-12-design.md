# Headed UI Multithread 12/12 Design

**Date:** 2026-09-08

**Status:** Approved for implementation planning
**Scope:** Restore the existing CapCut headed UI automation path to verified 12/12 behavior at three workers, then prove it at five and ten workers without cross-profile input corruption or unbounded mailbox purchases.

## 1. Current result: not restored

The latest headed three-worker run is not a 12/12 success:

- exactly three workers used three email/account/profile/proxy allocations;
- all three accounts authenticated successfully;
- all three stopped at `6/12`, `420/670` credits;
- all three reported `DOM_READ_TIMEOUT: canvas-area:mouse-move`;
- `0/3` accounts completed and all three profiles were cleaned up.

The earlier two-worker baseline reached `12/12` for both accounts, although one account required a retry. The sensitive, git-ignored evidence is retained at:

- `.superpowers/sdd/2026-09-06-headless-three-worker-hardening/evidence/headed-2-worker-baseline-2026-09-07.log`
- `.superpowers/sdd/2026-09-06-headless-three-worker-hardening/evidence/headed-3-worker-postfix-2026-09-08.log`

Those files may be inspected locally but must never be copied into commits, tickets, telemetry, or this document because they can contain account, proxy, and profile identifiers.

## 2. Diagnosis and confidence level

### 2.1 Proven immediate regression

`humanClick()` previously followed a timed-out `page.mouse.move()` with a normal locator click. That allowed the mission-level retry to recover in some runs, but it was unsafe: a deadline abandons the wait; it does not cancel the underlying CDP command. The fallback could therefore issue a second input while the first command was still alive.

The fallback was correctly removed from `src/main/services/capcut/human.ts`. After that change, the typed `DomReadTimeoutError` reaches `missionRunner`, then `runTasks.ts` returns a fatal result immediately. The account therefore has no fresh browser session in which to retry the remaining tasks and stops at 6/12.

Restoring the same-page fallback is rejected. It would hide the symptom by racing two commands on a browser session already known to be unsafe.

### 2.2 Proven concurrency design defect

`runTasks.bootstrap()` currently creates `new InteractionLock()` for each account. It cannot coordinate separate worker profiles. In addition, only `designStudio.editOnCanvas()` uses that lock. Authentication, launch-time focus/window sizing, task popovers, Design chat/upload, all Video Studio actions, overlays, and many raw clicks/key presses remain outside it.

The system therefore has no run-scoped invariant preventing two headed profiles from issuing focus, pointer, keyboard, or native-window commands at the same time.

### 2.3 Proven recovery/evidence defects

- `runTasks.ts` checks `result.fatalError` before merging `result.evidence` into `TaskOutcome`. Proof emitted earlier in the fatal group can be lost.
- `CapcutEngineService.toTaskProgressRows()` infers `status=4` from “not in `missing`” because `TaskSnapshotSummary` omits exact statuses. Today outcomes are normally seeded from the same snapshot, so this does not arbitrarily complete an unrelated key; however, it loses non-4 status detail and cannot represent a genuinely omitted key safely. Exact snapshot rows must replace that inference.
- the UI runner checkpoints task rows only after `runAccount()` returns; it has no group-level checkpoint before a session recycle;
- `needsFinalSnapshotRefresh()` skips the final refresh when the current snapshot appears complete, so a complete but pre-run/stale receipt can be displayed as current;
- `TaskProgressDialog.tsx` hard-codes `/12` and has no verified/stale state;
- `ThreadRuntime.profileStopPromise` is cached across the whole thread. Reusing that thread for a replacement profile could cause final cleanup to reuse the old resolved promise and leave the replacement profile running.

### 2.4 Not yet proven

The exact vendor/browser reason that `page.mouse.move()` hangs under the three-profile load is not yet proven. Plausible causes include renderer saturation, focus/window contention, or a CDP/Multilogin fault. The run-scoped coordinator below is a fail-safe containment boundary; telemetry and staged tests must determine whether it also removes the observed trigger. The implementation and release report must not call the vendor-level cause proven without new evidence.

## 3. Goals

1. A headed UI worker may report complete only from a fresh CapCut `task_list` receipt containing exactly the server-observed task set with every task at `task_status=4`.
2. Three workers must finish `3/3 × 12/12` before testing five; five must finish `5/5 × 12/12` before testing ten.
3. A timed-out browser command must cause session quarantine and profile teardown. No further input may run on that session.
4. A recoverable mission fault gets at most one fresh profile for the same account, password, mailbox, and proxy lease. It must not purchase another mailbox or create another account row.
5. Every profile has session-scoped ownership and exactly one automated stop attempt. A replacement profile cannot start until the old stop resolves successfully.
6. Headed workers remain concurrent for acquisition, proxy setup, authentication waits, OTP polling, network/render waits, proof monitoring, and cleanup. Only focus/input and stateful editor capacity are bounded.
7. Stop and cancellation must drain queued scheduler tickets without deadlock or late actions.
8. All rollout evidence is structured and redacted. No email, proxy endpoint, credential, OTP, raw profile ID, CDP URL, DOM dump, request body, header, or screenshot is allowed.
9. No live or billable stage starts without a separate explicit authorization for that exact mailbox count.

## 4. Non-goals

- Do not restore the locator-click fallback after an input timeout.
- Do not redesign the HTTP-only mission transport.
- Do not increase Design/Video editor concurrency during the correctness rollout.
- Do not match mission groups by display names to decide scheduling policy.
- Do not replay a Playwright promise, `Page`, `BrowserContext`, `TaskStore`, monitor, resolver, or waiter from a quarantined session.
- Do not reset, clean, stash, or overwrite the existing dirty worktree.
- Do not treat a historical 12/12 account as proof that a fresh full workflow succeeds.

## 5. Considered approaches

### A. Restore the same-page fallback

This is the smallest diff and previously let a retry proceed. It is rejected because the timed-out command may still execute. Issuing another click can duplicate a mutation, corrupt pointer order, and make concurrency failures nondeterministic.

### B. Add only a global lock

A run-scoped lock would stop simultaneous inputs, but a single hung command would either release too early or block the entire run forever. Without session quarantine, teardown, and fresh-session resume it cannot safely recover the current 6/12 failure. This is insufficient.

### C. Run-scoped UI coordinator plus session recycle plus exact evidence

This is selected. It serializes the unsafe shared surface, quarantines uncertain sessions, preserves partial proof, stops the exact old profile, creates a fresh session for the same account, and resumes only tasks that a new server snapshot says are incomplete.

## 6. Selected architecture

### 6.1 Run-scoped UI coordinator

Create one `RunUiInteractionScheduler` in `AutomationRunService.runPrepared()` for a headed UI run. Normalize the optional transport first with `const missionTransport = config.missionTransport ?? 'ui'`; create the scheduler when `missionTransport !== 'http-only' && !config.headless`. It is not created in `runAllTasks()` and is not used by `missionTransport: 'http-only'`.

The scheduler exposes a session-bound facade:

```ts
export type UiLane = 'foreground' | 'editor';

export interface AccountUiInteraction {
  foreground<T>(label: string, operation: () => Promise<T>): Promise<T>;
  editor<T>(label: string, operation: () => Promise<T>): Promise<T>;
}

export interface UiSessionIdentity {
  sessionAlias: string;
  signal: AbortSignal;
}

export interface UiSchedulerSnapshot {
  foregroundOwner?: string;
  foregroundWaiting: number;
  editorActive: number;
  editorWaiting: number;
  quarantinedSessionAliases: string[];
}

export class RunUiInteractionScheduler {
  constructor(options: {
    editorLaneLimit: number;
    onEvent?: (event: UiSchedulerEvent) => void;
  });

  forSession(identity: UiSessionIdentity): AccountUiInteraction;
  confirmProfileStopped(sessionAlias: string): void;
  shutdown(reason: Error): void;
  snapshot(): UiSchedulerSnapshot;
}
```

Scheduling rules:

- `foreground` has capacity one and strict FIFO admission. A complete gesture—focus, mouse path, down/up, or click plus all typing—is one lease. Individual mouse movements are not separate tickets.
- `editor` limits stateful Design/Video mission execution. Its correctness-rollout limit is one at worker counts 1, 3, 5, and 10. Raising this limit is a later performance change requiring separate evidence.
- queued cancellation removes the ticket and never invokes its operation;
- an active operation is raced against the session signal; abort rejects the caller promptly, attaches a terminal handler that absorbs and records the late operation settlement, quarantines the session, and deliberately retains foreground ownership;
- `DomReadTimeoutError` after a foreground operation starts follows the same quarantine path because the underlying CDP/Playwright promise may still settle;
- only `confirmProfileStopped(sessionAlias)` after a successful profile stop releases that quarantine;
- a failed or uncertain stop never releases it. `shutdown(reason)` atomically rejects and drains queued tickets and rejects new acquisitions. `AutomationRunService`, which owns the abort controllers, then aborts all thread signals, attempts to stop every other owned session while preserving uncertain ownership for reporting, and makes the run terminal with `RESOURCE_CLEANUP_FAILED`;
- ordinary errors that do not imply an in-flight browser command release normally;
- navigation, task-list monitoring, proof reconciliation, generation polling, provider calls, OTP polling, and passive waits do not hold the foreground lane;
- every gesture reacquires foreground focus and calls `bringToFront()` within the same lease before input. A central `foregroundPage(page, label, operation)` primitive owns this rule; `humanClick()` and `humanType()` delegate to it rather than relying on callers to focus correctly.

### 6.2 Compile-time and static coverage boundary

`CapcutMissionEnv.ui` becomes required for UI missions. `HumanInteractionOptions` carries it. `humanClick()` and `humanType()` use private unlocked implementations so `humanType()` can hold one foreground lease while clicking and typing without recursively acquiring the same lane.

Every production direct input path must migrate: launch-time focus/window sizing; trial; auth/login/signup; overlays; task popovers; simple missions; Design Studio; Video Studio; and shared step helpers. A source-inventory regression test rejects new raw `.click()`, keyboard, mouse, hover, `bringToFront()`, or native window calls outside explicitly reviewed adapter sites.

The non-production HTTP discovery script path in `capcut/http/discoverCanvasRequest.ts` is excluded because the app run service does not call it.

### 6.3 Session-scoped browser ownership

Replace the flat browser fields on `ThreadRuntime` with an explicit session object:

```ts
interface BrowserSessionRuntime {
  alias: string;
  launchPromise?: Promise<void>;
  stopRequested: boolean;
  profileId?: string;
  port?: number | null;
  page?: CapcutPage;
  context?: CapcutContext;
  launcher?: BrowserLauncher;
  ui: AccountUiInteraction;
  scheduler?: RunUiInteractionScheduler;
  stopPromise?: Promise<boolean>;
  stopFailed?: boolean;
}

interface ThreadRuntime {
  runId: string;
  accountId: string;
  email: string;
  capcutPassword: string;
  purchasedEmailId?: string;
  lease?: AcquiredProxyLease;
  directProxy?: BrowserProxySettings;
  session?: BrowserSessionRuntime;
  sessionRecycleCount: number;
  // existing outcome/completion fields remain
}
```

`launchSession()` creates and installs the session object before invoking a launcher, stores the launch promise, and lets `onProfileStarted()` publish early ownership. A Stop request sets `stopRequested` even if `profileId` is not yet available. If the launcher later publishes or returns a profile ID, the same session immediately starts its one deferred stop and never exposes that page for mission work. Launch rejection without an owned profile settles the deferred stop path without inventing a stop call.

`stopSession(thread, exactSession)` captures the immutable session object and caches only that session's stop promise. Waiting for a pre-ID launch lifecycle and waiting for provider stop are both bounded; expiry is an uncertain cleanup failure, keeps the session addressable for reporting, and cannot trigger a second automated stop. Late launch/stop settlement is absorbed without ownership or telemetry mutation. It removes `thread.session` only after stop succeeds and only if it is still the same object. The thread itself remains in `activeThreads` across the recovery gap so a per-thread Stop can abort before the replacement starts; only final iteration cleanup removes the thread.

Global Stop, per-thread Stop, launch rejection, recovery, and final cleanup all call the same session-scoped stop function. They cannot double-stop a profile or mistake an old stop result for a new profile.

### 6.4 Account-scoped recovery

The initial mission session retains the existing signup-first behavior for a newly purchased address. A recoverable task fault can only occur after authentication in the current UI engine, so the replacement session uses `authAttempt: 'existing-only'`:

```ts
export type CapcutAuthAttempt = 'initial' | 'existing-only';
export type CapcutFatalCode = 'DOM_READ_TIMEOUT';
```

`existing-only` means:

- login is allowed;
- signup fallback is disabled;
- the signup OTP callback is not passed;
- failure to log in ends recovery and does not create or purchase anything.

The recovery budget is exactly one recycle per account and is independent of mission `maxRounds`. The sequence is:

```text
mission group returns fatal error plus any captured evidence
  -> merge proof from the fatal group
  -> engine awaits the sole durable checkpoint of exact task rows, unsettled proofs, and a non-final receipt
  -> engine returns partial result + fatalCode only after checkpoint commit
  -> stop the exact old profile
  -> wait for successful stop confirmation
  -> release scheduler quarantine
  -> check cancellation
  -> launch a fresh profile with the same proxy lease/direct proxy
  -> authenticate existing-only
  -> create a fresh resolver, TaskStore, listeners, and snapshot
  -> pass same-run unsettled proofs into the replacement session
  -> passively reconcile unsettled proof keys against fresh task-list receipts
  -> run only non-4 keys that have no unsettled proof
  -> require a fresh final receipt
```

This loop stays inside `runThreadWorkload()`. It must not call `source.next()`, `source.commit()`, `accounts.create()`, `proxies.acquire()`, `proxies.release()`, or any email purchase operation.

Checkpoint persistence is a recovery gate, not a best-effort display update. The awaited engine checkpoint callback is its sole owner: it returns successfully only after the SQLite transaction commits and otherwise throws a typed persistence error. `runUiSessionAttempt()` catches that typed rejection, stops the unsafe old profile, prohibits replacement, and fails closed; the workload never writes the returned result a second time.

An unsettled proof is a same-run successful `do_action` result whose fresh server status is not yet 4. The replacement may only poll fresh task-list receipts for such a key. If it does not become 4 within the bounded reconciliation deadline, leave it partial and fail verification; never issue that mutation again. Historical proof from another run does not suppress a new action.

If old-profile stop fails, recovery ends immediately and no replacement profile starts. The service creates the existing typed `AutomationTerminalError` with sanitized reason code `RESOURCE_CLEANUP_FAILED`, passes it to `scheduler.shutdown()`, aborts its owned thread controllers, attempts all other session cleanup, and reports uncertain ownership. If the replacement session hits a second `DOM_READ_TIMEOUT`, it is stopped and the account fails; no third session is created.

### 6.5 Exact snapshot and proof contract

`TaskSnapshotSummary` must carry the exact task rows returned by the server rather than only `missing`:

```ts
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
```

Rules:

- `toTaskProgressRows()` iterates `snapshot.tasks`, copies each exact server status, and enriches proof by matching `TaskOutcome.key`; it never creates a row or status from absence;
- `runTasks` merges group evidence before checking `fatalError`;
- after each group reconciliation, it emits a checkpoint through an injected callback;
- before recycle it emits a non-final checkpoint, preserving `opId`/`provedAt` but never awarding completion without status 4;
- the final receipt must be observed after `max(sessionStartedAt, latestActionSettledAt)`;
- if no qualifying task-list receipt arrives, `fresh=false`, `final=false`, and the account cannot complete;
- generic product UI displays the server-observed total dynamically; the release harness separately requires exactly 12 distinct task keys;
- aggregate/bonus tasks may have no direct `do_action`; their status-4 proof is the final post-action server receipt plus the child relationship from the task list;
- tasks already at status 4 in a fresh bootstrap receipt are `preexisting`, not replayed, and never presented as a new action proof.

Keep the shared `CapcutAccountResult` contract unchanged for HTTP-only and common results. The UI runner returns the following extension:

```ts
export interface CapcutUiAccountResult extends CapcutAccountResult {
  fatalCode?: CapcutFatalCode;
  authenticated: boolean;
  verification: CapcutVerificationReceipt | null;
  unsettledProofs: UnsettledTaskProof[];
}

export interface UnsettledTaskProof {
  key: string;
  proof: ActionProof & { errNo: 0 };
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
```

`CapcutTaskRunner.runAccount()` and `RunTasksInput` both accept `unsettledProofs: readonly UnsettledTaskProof[]`; the initial session receives an empty array and a replacement receives the prior UI result's array before fresh bootstrap/group selection. Discovery-only and trial-skip UI early returns use `verification: null`; a generic UI completion is impossible unless verification is non-null, fresh, final, and complete. `CapcutTaskRunner` returns `CapcutUiAccountResult`; the HTTP runner remains on `CapcutAccountResult`. The service uses an explicit transport branch: UI requires the receipt predicate, while HTTP-only retains its existing completion semantics. Control flow uses `fatalCode`, never error-message matching. Human-readable `fatalError` remains for sanitized logging only.

### 6.6 Durable checkpoint receipt

Add migration `006_account_task_receipts.ts` with one latest receipt per account and its exact receipt-scoped task set:

```sql
CREATE TABLE IF NOT EXISTS account_task_receipts (
  account_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_alias TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  required_after TEXT NOT NULL,
  server_total INTEGER NOT NULL,
  server_done INTEGER NOT NULL,
  is_fresh INTEGER NOT NULL,
  is_final INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_task_receipt_items (
  account_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  status INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (account_id, task_key),
  FOREIGN KEY (account_id) REFERENCES account_task_receipts(account_id) ON DELETE CASCADE
);
```

`AccountTaskRepository.recordCheckpoint()` writes historical/enriched task rows, replaces the receipt-item set (including snapshot order), and writes the receipt in one SQLite transaction. Existing `op_id` and `proved_at` preservation through `COALESCE` remains unchanged. `account_tasks` may accumulate historical proof; verification and receipt-backed UI rows use only the exact receipt items joined to their metadata in ordinal order. Existing rows have no receipt and therefore display as unverified until a new run writes one.

`TaskProgressDialog` shows one of:

- `Verified x/y` only when the stored receipt is fresh, final, internally consistent, and every returned task is status 4;
- `Partial x/y` for a fresh non-final checkpoint;
- `Unverified/stale` when the receipt is missing, stale, or inconsistent.

It does not hard-code 12.

### 6.7 Redacted telemetry

Create a run-scoped JSONL recorder under Electron `userData/rollout-evidence/{runId}.jsonl`. The harness returns the exact `runId` and artifact basename for that invocation. Validation requires the exact run ID returned by that invocation and rejects any mismatch among requested stage, artifact contents, run-start event, and terminal event. An atomic redacted `last-run.json` containing only the last artifact basename and run ID may exist for operator convenience, but it is never acceptance authority. Each line is schema-validated before writing. Allowed data includes:

- schema version, run ID, worker ordinal, headed/UI mode;
- run-local anonymous account and session aliases;
- stage, queue wait, lane hold duration, action start/end/timeout;
- quarantine and successful profile-stop confirmation;
- task keys, status numbers, proof result code, and receipt timestamps;
- resource counts, terminal counters, and cleanup success/failure count.
- billable provider purchase attempted, confirmed, and ambiguous counters.

Forbidden data includes emails, passwords, OTPs, mailbox order IDs, proxy hosts/ports/usernames/passwords, raw account/profile IDs, CDP ports/URLs, cookies/tokens, headers/bodies, DOM, and screenshots. Tests seed all forbidden values and assert none occur in the serialized output.

### 6.8 Safe live harness

The current harness defaults to billable Gmail94 and hard-wires `mailLimit=threads`. Replace this with explicit validation:

- reject unknown options;
- headed release runs require `--headed`; reject `--headless`;
- API email runs require `--mail-limit=N`, `--approved-mailboxes=N`, `--stop-after=N`, `--threads=N`, and exact equality of all four values;
- API email runs additionally require `--max-billable-purchases=N` equal to the exact separately approved count;
- `maxBillablePurchases` is passed into `EmailPurchaseService.openAcquisitionSession()`. The run atomically consumes one unit immediately before each Gmail94 or DongVan purchase dispatch; reused inventory consumes none; an ambiguous result consumes its unit and cannot be retried;
- provider opt-in environment flags remain mandatory in addition to numeric approval and must be process-scoped to the single authorized command;
- `--dry-run --rollout-stage=N` validates options and exits before Electron, providers, proxy acquisition, or mailbox acquisition;
- `--health-only --headed --threads=N` rejects all email/mailbox options, launches and tears down exactly N profiles, performs bounded headed viewport/CDP/mouse health checks, and proves zero mailbox acquisitions. Its result and artifact carry the exact run ID/artifact basename; health acceptance requires `attempted=healthy=stopped=N`, zero account terminal counters, and zero account/mail/proxy activity rather than pretending N accounts completed;
- the harness exits nonzero for a nonterminal run, stale/incomplete receipt, task total other than 12, any non-4 final status, over-cap resource use, UI/session fault, or cleanup failure;
- the harness obtains Electron's actual `app.getPath('userData')`, or accepts a strict explicit `--user-data-dir` outside the repository. For the explicit case it passes a child-process-only `AUTOMANAGER_ROLLOUT_USER_DATA_DIR`; Electron validates it and calls `app.setPath('userData', value)` before database/provider initialization. Producer and validator use that same resolved directory. Console output contains only `runId` and artifact basename, never a full local path;
- it never advances from one rollout stage to another automatically.

### 6.9 Existing-account resume path

Before buying another mailbox, add an explicit run source that accepts account IDs selected in main process, decrypts the saved CapCut password there, and yields an `existing` work item. It must not expose secrets to renderer or command output.

An existing work item:

- reuses the existing `accountId` and account row;
- never calls email acquisition, `accounts.create()`, or source commit;
- always authenticates `existing-only`;
- uses the run's configured proxy route;
- obtains a fresh task list and runs only incomplete server statuses.

This path is used first on the three already-purchased accounts that stopped at 6/12. It validates recovery without purchasing three replacements. A fresh-account rollout is still required before the final release claim because an already-partial account does not exercise all 12 actions from a clean baseline.

## 7. Failure policy

| Condition | Required behavior |
|---|---|
| Queued scheduler ticket is aborted | Remove it; operation never starts. |
| Active foreground operation is aborted | Quarantine session; stop profile before admitting another foreground operation. |
| `DOM_READ_TIMEOUT` in mission | Reconcile network proof only; checkpoint; stop; recycle once. |
| Proof exists but no post-action status 4 | Persist proof with incomplete status; do not claim done. |
| Recovery checkpoint transaction fails | Stop unsafe old profile; do not launch replacement; fail closed. |
| Proof exists but remains non-4 after bounded passive reconciliation | Do not replay `do_action`; persist partial state and fail verification. |
| Old profile stop fails | No replacement; retain uncertain ownership; shut down scheduler; abort the run; attempt cleanup of all other sessions; publish `RESOURCE_CLEANUP_FAILED`. |
| Replacement login fails | No signup/OTP fallback; stop replacement; fail account. |
| Second recoverable timeout | Stop replacement; fail account; no third session. |
| Final receipt stale/missing | Account fails verification even if an older snapshot says 12/12. |
| Any cleanup failure | Overall rollout stage fails; never publish a green release report. |
| User Stop | Abort acquisitions and queued tickets, stop each owned session once, release each proxy/mail reservation once. |

## 8. Rollout gates

Every gate uses a separate invocation and a separate explicit approval if billable. No command chains stages together.

1. **Offline deterministic gate:** focused unit/integration tests plus 100 seeded scheduler/service runs at worker counts 1, 3, 5, and 10. No browser or provider.
2. **Dry-run gate:** exact option/cap/purchase-budget validation for stages 1, 3, 5, and 10. Zero external operations.
3. **Headed health gate:** three, then ten profiles attach, resize, pass bounded DOM/CDP/mouse probes, and stop. Zero mailbox acquisition.
4. **Existing-account recovery gate:** resume the three failed 6/12 accounts; require 3/3 verified 12/12 and clean teardown. Zero mailbox purchase.
5. **Fresh one-account gate:** with approval for exactly one mailbox, require 1/1 fresh 12/12.
6. **Fresh three-account gate:** separate approval for exactly three; require 3/3 fresh 12/12.
7. **Fresh five-account gate:** separate approval for exactly five; require 5/5 fresh 12/12.
8. **Fresh ten-account gate:** separate approval for exactly ten; require 10/10 fresh 12/12.

Any fault, incomplete account, stale receipt, over-cap acquisition, or cleanup failure fails the stage. It does not auto-refill or advance.

## 9. Acceptance criteria

- `3/3`, then `5/5`, then `10/10` headed accounts independently have a final fresh task-list receipt with exactly 12 distinct keys and all 12 statuses equal to 4.
- No account in an accepted stage is partial, failed, stopped, skipped, or unverified.
- `accountsAccepted`, mailbox acquisitions, billable purchase attempts, confirmed purchases, live profiles, active workers, and proxy leases never exceed the exact stage cap. Ambiguous billable attempts consume the cap.
- An in-run session recycle creates no account row, mailbox purchase/reservation, or additional proxy lease and calls neither signup nor signup OTP. A separately invoked existing-account resume run may acquire its one initial configured proxy route per selected account, then reuses it across any recycle.
- Each session profile receives one automated stop call; all active profile/worker/queue counts settle to zero.
- No same-page input occurs after a timed-out CDP/Playwright command.
- A quarantined session does not release the next foreground ticket before successful stop confirmation.
- Stop/cancel cannot deadlock either scheduler lane.
- HTTP-only behavior and tests remain unchanged.
- Logs and evidence contain none of the forbidden secrets/identifiers.
- `npm run typecheck`, `npm run lint`, `npm run selectors`, `npm run build`, `npm run test:electron`, and `npm run test:node` pass with the repository's required native-module rebuild order.

## 10. Cutover safety

The worktree is already substantially dirty, including the exact services and tests in this design. Implementation must begin with a read-only status/diff inventory and must preserve every pre-existing change. No `git reset`, `git checkout --`, `git clean`, broad stash, or `git add .` is permitted.

The coordinator must not be enabled in a partially migrated state. Merge/cutover is allowed only when:

1. the direct-input inventory test is green;
2. all listed production input paths use the session facade;
3. session-scoped cleanup/recycle tests are green;
4. exact-status/fresh-receipt tests are green;
5. the full offline suite is green;
6. an independent code review has no unresolved correctness findings.

Commits, if the user authorizes them, must be path-scoped and task-sized. Live tests and mailbox purchases are explicitly outside implementation authorization and require separate permission.
