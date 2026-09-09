# Independent Headed Workers: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run 1/3/5/10 accounts independently from fresh signup through all 12 missions, without one account's input, editor, generation wait, or recoverable failure blocking the others.

**Architecture:** Reuse the existing scheduler, with one instance per browser session instead of one shared instance per run. Keep account ownership, purchase budgets, proxy leases, evidence, and cancellation in `AutomationRunService`. Dispatch input to the session's own Playwright page without repeatedly activating the desktop window.

**Tech Stack:** Windows, Electron, TypeScript, Playwright Core 1.62.1, Vitest, existing Multilogin launchers and SQLite repositories. No new runtime dependency, worker process framework, HTTP mission engine, or dashboard feature.

**Spec:** The proposed design and acceptance contract in this document. Evidence: fresh runs `537ae104-5347-43f2-9e94-40d68daf77b6` and `4574d904-81bf-48d1-aa46-89684849d556`, recorded in [the live report](../reports/2026-09-08-fresh-three-headed-result.md).

**Status:** User approved implementation on 2026-09-09. Scheduler/input/lifecycle, independent evidence gate, offline stress tests, and passive task diagnostics are implemented and reviewed; see [implementation verification](../reports/2026-09-09-independent-workers-implementation.md). Subsequent authorized fresh3 live run `42b78934-7597-494c-8e36-5dbaaab163f3` failed with1/3 complete, remaining task-list/canvas errors and three quarantine events. Do not treat offline success as live acceptance. Follow the proposed [selector-first repair plan](2026-09-09-selector-first-repair.md) for the next scoped repair; keep this document's independent-session requirements. Full100-round vendor validation, resource profiling and larger fresh stages remain unexecuted. This document grants no additional purchase or vendor-run authority.

## 0. Binding correction: independent workers, not a shared mission queue

The user explicitly rejects the current model in which multiple browser profiles are open but Design/Video work takes turns. **Do not describe this as independent parallel execution.** `async`/`Promise` are implementation mechanisms; the defect is a cross-account dependency introduced by shared admission locks, not asynchronous programming itself.

Non-negotiable runtime contract:

1. After worker A acquires its own account/profile/proxy, no step in A's auth, OTP wait, missions, upload, generation, render, proof wait, ordinary retry, or normal teardown may await completion/release of worker B's mission or input lease.
2. If worker 1 is held in a generation wait, workers 2–20 must progress and may finish before worker 1 is released. Their next eligible account must not wait for a batch-wide phase barrier when continuous work and budget are available.
3. Per-session queues may serialize that session's own conflicting actions only. Global editor/input queues, round-robin mission scheduling across accounts, and “finish Design for everyone, then start Video” barriers are forbidden.
4. A terminal `Promise.allSettled` may await workers for the **final batch report**. It must not gate per-account progress publication, resource cleanup, or the next account in a running worker. Synchronized barriers are test instrumentation only, never runtime scheduling.
5. Share only genuinely shared accounting and resources: bounded purchase/reservation operations, proxy ownership, short DB transactions, and Stop All/resource-integrity safety. Do not hold an accounting lock across another account's mission. CPU scheduling, RAM, network bandwidth, and provider capacity still limit throughput; they do not justify disguising serialization as independence.
6. An ordinary failed/slow account affects its own outcome. Explicit Stop All or an unconfirmed global resource/integrity failure remains an emergency stop, not a turn-taking mechanism.

The concurrency defect is already demonstrated; **do not buy more emails or repeat serial paid baselines merely to prove it again**. The unresolved task-list fault is a separate investigation track, not a pretext to add a speculative mission workaround or postpone deterministic independence testing. Only offline 20-worker stress is added here; real twenty-profile capacity and any new purchases remain unapproved/unverified.

## 1. Measured bottleneck and 10-worker estimate

The run completed all three new accounts, but it did not demonstrate independent mission execution:

- `AutomationRunService.runPrepared` constructs one scheduler with `editorLaneLimit: 1`.
- Every session uses that same scheduler. Foreground/input capacity is also one.
- `missionRunner.reconcileMissionEvidence` holds the editor lease around the entire `group.act`, including Design/Video navigation, upload, generation, render polling, and export.
- The previous deterministic tests explicitly require global editor/foreground peaks of one. They test safe serialization, not independent workers.

The measured run lasted **677.917 seconds** from run-start to terminal; the wrapper interval was **680.334 seconds**, reported as 11m20s. Editor occupancy was **544.551 seconds**, approximately **80.3%** of run wall time.

| Account/worker | Editor work, excluding editor queue wait | Editor queue wait |
| --- | ---: | ---: |
| account-3 / worker-1 | 156.810s | 149.961s |
| account-1 / worker-3 | 163.789s | 237.210s |
| account-2 / worker-2 | 223.952s, including failed layout and retry | 308.617s |

The failed Design action has no `ui-finished` event. Its **87.631s** occupancy is established by its start, the error log, and the next editor admission; summing only finished events would undercount the bottleneck.

Planning model for the current implementation:

```text
Tcurrent(N) = 133.366 seconds + N × E
Ehealthy = (156.810 + 163.789) / 2 = 160.2995 seconds/account
Eobserved-mix = 544.551 / 3 = 181.517 seconds/account
```

The residual includes startup/auth/simple tasks, an inter-round idle gap, and terminal cleanup. Holding it constant is an assumption, not a promise about ten browsers.

| Workers | Current design | Proposed independent design: provisional planning range |
| ---: | --- | --- |
| 1 | No measured fresh solo baseline; model about 4.9–5.3m | Measure first; preserve single-account behavior |
| 3 | **11m20s measured wrapper time** | About 5–7m, unverified |
| 5 | About 16–18m modeled | About 6–8m, unverified |
| 10 | **About 29–33m modeled**, potentially longer under load | **About 6–10m**, conditional on browser/provider/hardware capacity |
| 20 | About 56–63m by the same serial-work projection; no live measurement | No supported runtime estimate; hardware/vendor capacity must be measured first |

These are planning ranges, not confidence intervals or live results. The user's approximate four-minute solo time is not a measured baseline for this build. Healthy trace paths after subtracting editor queue wait are about 4.6–4.9m; the account needing layout recovery is about 6.1m, before ten-browser contention.

**A partial fix is insufficient:** recorded foreground holds total 152.826s for three accounts. Keeping one shared input lane gives ten comparable accounts at least `10 × 50.942s = 509.420s`, or **8m29s**, merely to service those input holds. This is a workload-derived floor, not an unconditional future runtime law.

Machine snapshot: i5-12400F, 12 logical processors, 31.8GiB RAM; approximately 22.7GiB free at inspection. There is no measured ten-profile CPU/RAM/GPU load. Removing software queues does not remove hardware, proxy, or server limits.

### Additional unchanged-code baseline: what it establishes

Run `4574d904-81bf-48d1-aa46-89684849d556` used exactly three additional new emails/profiles and **no source changes** (403 fingerprints matched). It ended in 7m27.091s wrapper time with **2/3 complete and 1 bootstrap failure**; all three signups/OTP succeeded and all three profile stops confirmed. This is a failed baseline, not faster successful throughput.

| Finding | Evidence | Plan consequence |
| --- | --- | --- |
| Shared editor still serializes work | Successful accounts waited 60.711s and 131.427s; editor holds did not overlap | Keep session-local scheduler/input target design as the core change; require Section 0 tests |
| Missing task list persists after actual reload | Account-2 reload at 18:02:06.609Z, bootstrap failure at 18:02:16.997Z; maximum foreground ticket wait 198ms | Do not claim reload budgeting or removal of editor lock fixes it; require request/response-level evidence before selecting a fix |
| Warning classification is misleading | Six onboarding warnings point to What's New dialogs | Record as diagnostic debt, not proven signup/mission breakage |
| Existing HTTP recorder can break recovery | Account-scoped filename + exclusive `wx` + same-account retry => collision | Do not enable current recorder on paid recovery; test session-scoped diagnostics first |
| Failure timing is incomplete | 139 UI starts, 137 UI finishes; ordinary errors have no final duration | Keep Task 4's rejection-duration requirement |

The default diagnostics cannot distinguish a missing request, HTTP/business rejection, unreadable body, malformed/empty payload, or pre-monitor response. No console/pageerror trace was captured. Therefore **no particular task-list root cause has been selected**. Two sparse CPU/RAM samples do not establish resource causality. The past canvas-zero-height error did not recur on the two accounts reaching canvas; it remains an observed historical risk, not a confirmed new regression.

Before any future diagnostic live run, validate a narrow, passive task-list observer offline: attach before auth, correlate request/response timing, record status plus categorical body-read/parse result, and dispose on Stop/terminal. It must not mutate/replay requests, accept old snapshots as final, leak payloads, collide on same-account session recovery, or delay cleanup. Prefer adding categories at the existing monitor boundary to a new general capture subsystem. This is a proposed evidence prerequisite, not permission to edit or run now. An external error stays unresolved when evidence is missing; do not increase timeouts or change signup/mission behavior on a guess.

## 2. Proposed design and constraints

```text
AutomationRunService: ownership, cancellation, budget, evidence, registry
  worker-1 -> profile/session-1 -> own input FIFO + own editor FIFO -> 12 tasks
  worker-2 -> profile/session-2 -> own input FIFO + own editor FIFO -> 12 tasks
  ...
  worker-N -> profile/session-N -> own input FIFO + own editor FIFO -> 12 tasks

Shared briefly: email purchase/reservation accounting, proxy ownership, DB transactions.
Never shared as a queue: OTP wait, page input, editor actions, upload/render/generation wait.
```

Each worker still performs its own dependent steps sequentially. Different workers can execute those steps concurrently. Retaining `ui.editor()` around a whole mission is acceptable **only because its scheduler belongs to that session**; no mission rewrite is needed to release other accounts.

Global constraints:

- Preserve the dirty working tree and existing uncommitted changes. No bulk rollback, reset, stash, staging, or commit during planning; implementation must save a scoped pre-edit baseline.
- Preserve the signup/login → all 12 task workflow, UI transport, human-pace jitter, hit-target guards, verified typing, cancellation, and fresh proof-backed receipts.
- No unbounded waits and no reduction of typing delays to obtain speed numbers.
- No raw DOM `click()`/synthetic input event injection, direct task mutation API, fabricated task status, cookie copying between accounts, or identity rotation to evade limits.
- Do not mistake `document.activeElement` for the native desktop foreground window. Keep page-local locator focus and caret checks; remove native activation from independent sessions.
- Every browser profile/context/page, credential/OTP callback, task store, receipt, and cancellation signal stays attached to its owning account/session.
- Recoverable timeout/Stop of one account must not block peers. Keep that failed session poisoned until exact stop is confirmed; only then create its replacement, at most the existing one recycle.
- Explicit Stop All, an unconfirmed resource cleanup, ambiguous purchase accounting, or evidence/persistence integrity failure may still fail the whole run. Independence is not permission to ignore resource safety.
- All existing purchase limits remain atomic and shared. Neither independent execution nor this plan authorizes additional purchases.
- No global editor semaphore and no global multi-second input semaphore may remain in the target path. If native foreground proves mandatory for Multilogin, fail the compatibility gate and revisit the design; do not quietly claim independence with a shared lock restored.
- Keep the account engine inside the injected Playwright session; do not add one Node/Electron controller per worker unless later measurements prove a controller bottleneck.

Alternatives considered:

| Alternative | Decision |
| --- | --- |
| Set editor capacity to 10, keep shared foreground | Reject: still serialized input and cross-account quarantine coupling. |
| One scheduler per session, page-target input | **Recommended:** reuses existing implementation and changes ownership scope. |
| Separate controller processes/VMs | Defer: browser profiles already isolate browser processes; extra IPC, secret handling, and DB coordination are not justified yet. |

## 3. Implementation tasks

### Task 1: Prove and implement independent session scheduling

**Files:** `src/main/services/AutomationRunService.ts`; tests `src/main/services/__tests__/AutomationRunService.test.ts`, `healthRun.test.ts`, `rolloutRunIntegration.test.ts`; fixture `src/main/services/__tests__/fixtures/deterministicRunHarness.ts`.

**Contract:** One `RunUiInteractionScheduler` instance per unique session alias, created before launching that profile. The registry exists for ownership/Stop/diagnostics, never admission. The existing `BrowserSessionRuntime.scheduler` remains the exact owner.

- [ ] Write a service-level RED regression using the existing injected launcher/runner doubles. Hold worker A's editor promise; assert worker B's editor callback starts before A is released. Also assert two facades on the same session do not overlap. A test that manually creates two unrelated schedulers is insufficient to prove production wiring.
- [ ] Add the stronger 20-worker starvation regression: hold only `worker-1-session-1` in a controlled generation promise; observe the other 19 complete their own fixture workflows before releasing it. Use test-only completion callbacks at the injected fake runner boundary. A companion continuous-work case must let a finished peer accept its next item while worker 1 remains held. Release the held promise in `finally` so RED tests cannot strand the suite.
- [ ] Extend `DeterministicRunOptions` in the existing deterministic fixture with `onEditorStarted?: (sessionAlias: string) => Promise<void>`. Call it **inside** the real `input.ui.editor` callback so tests can hold ownership without mocking the scheduler. Add this test with `runDeterministicSimulation` and Vitest imports from the existing test file:

```ts
it('admits all ten editors before any held editor is released', async () => {
  const entered = new Set<string>();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const run = runDeterministicSimulation({
    count: 10,
    onEditorStarted: async alias => {
      entered.add(alias);
      await hold;
    }
  });
  try {
    await vi.waitFor(() => expect(entered.size).toBe(10));
  } finally {
    release();
    await run;
  }
});
```

Current production wiring can admit only one held editor, producing the intended RED. Keep the hook in test utilities only.
- [ ] Change the run field to `private readonly uiSchedulers = new Map<string, RunUiInteractionScheduler>();`. Remove shared scheduler construction in `runPrepared`.
- [ ] Construct a new instance in `launchThreadSession` when `!config.headless && (config.missionTransport ?? 'ui') !== 'http-only'`. Bind `forSession({ sessionAlias: alias, signal })` exactly once, set `session.scheduler`, and retain current telemetry mapping. Headless/HTTP-only keep their direct facade.

```ts
const scheduler = !config.headless && (config.missionTransport ?? 'ui') !== 'http-only'
  ? new RunUiInteractionScheduler({
      editorLaneLimit: 1,
      onEvent: event => {
        if (event.type !== 'profile-stopped') {
          this.recordEvidence(mapUiSchedulerEventToEvidence(thread.runId, event));
        }
      }
    })
  : undefined;
if (scheduler) this.uiSchedulers.set(alias, scheduler);
```

- [ ] Move health scheduler creation inside its per-profile worker callback. Reuse its existing shared launcher client, which already tracks profiles by ID; do not create duplicate launcher infrastructure.
- [ ] Replace internal terminal `scheduler` with `schedulers: Array<{ sessionAlias: string; snapshot: UiSchedulerSnapshot }>` and update all three known consumers: service tests, deterministic fixture, rollout integration tests. Sample unresolved/active owners before final cleanup.
- [ ] Retire confirmed-stopped, settled scheduler entries during worker cleanup; do not retain every historical scheduler until the end of an unlimited continuous run. Also retire a definitively settled launch that created **no profile/resource**: mark that session closed so its facade rejects new input, verify zero active/queued tickets, then remove its registry entry. Do not emit a fictitious profile-stop event for a profile that never existed. Keep unresolved/late-start and unconfirmed owners registered. Let already-owned cancellation/settlement finish before removing a record. Historical events preserve completed aliases. Test 100 sequential successful items and 100 definitively failed/no-resource launches at threadCount=3 to prove registry size does not grow; a pending launch that later publishes a profile must still be retained, adopted, and exactly stopped.
- [ ] Run service/health/rollout tests. The new overlap test must go RED→GREEN; the same-session exclusion test must remain green. Do not yet launch real accounts.

### Task 2: Make poison and cancellation local, with explicit global safety stops

**Files:** `src/main/services/capcut/uiInteractionScheduler.ts`, `src/main/services/AutomationRunService.ts`; tests `capcut/__tests__/uiInteractionScheduler.test.ts`, `uiQuarantineOwnership.test.ts`, `services/__tests__/AutomationRunService.test.ts`.

**Contract:** A timed-out or actively aborted session cannot execute queued/future work in **either** lane. Another session's scheduler can continue. A new session cannot inherit old queues, page handles, or proof ownership.

- [ ] Add RED cases: foreground timeout followed by queued editor input, and editor timeout followed by queued foreground input. Neither callback may run. Also prove a different scheduler continues before the first profile's stop confirmation.
- [ ] Add one per-alias poison record in the existing scheduler, checked by `enqueue` and queue admission. Drain queued tickets for that alias with the original error, never by invoking callbacks. On DOM timeout/active abort, mark poison for both lanes. Keep active ownership accounting until `confirmProfileStopped` for that exact alias; a late promise cannot clear another owner's state.
- [ ] Preserve local FIFO and existing no-fallback-after-timeout tests. Do not make both lanes one non-reentrant mutex: editor actions call foreground inside them.
- [ ] In service integration tests require the ordering below, using deferred promises rather than sleeps:

```text
peer-B input starts BEFORE failed-A profile stop completes
A replacement starts AFTER failed-A exact profile stop confirms
second failure of A terminates A, while B can still finish
unconfirmed stop of A => registry-wide shutdown + Stop All / failed run
```

- [ ] Make `handleStopFailure` fan out to every registered scheduler and iteration controller for unconfirmed cleanup. Pass the documented structural reason `{ code: 'RESOURCE_CLEANUP_FAILED', message }`, not an error whose code is buried in `reason.code`. Preserve the failed run terminal and no automatic cleanup retry.
- [ ] Stop All/APP_SHUTDOWN cancels all sessions and acquisitions. Stop Thread only cancels its owning iteration. Normal successful cleanup must not emit `scheduler-shutdown` as if it were a failure.
- [ ] Verify late-started profiles are still adopted and stopped, late checkpoints are ignored by session identity, and all resources remain bounded by requested concurrency, including one-at-a-time recovery per account.

### Task 3: Remove native window activation from the independent path

**Files:** `src/main/services/capcut/types.ts`, `uiInteractionScheduler.ts`, `human.ts`, `launcher/BrowserLauncher.ts`, `src/main/services/AutomationRunService.ts`; tests `boundedInteractions.test.ts`, `canvasPromptActivation.test.ts`, `rendererHealth.test.ts`, `launcher/__tests__/launcherLifecycle.test.ts`.

**Contract:** Keep the existing facade and helper names. Add internal optional `focusMode?: 'native' | 'target'` to `AccountUiInteraction` and `UiSessionIdentity`; omission means legacy native for existing direct/test callers. Independent headed production/health sessions explicitly use `target`. This is not a dashboard option or silent runtime fallback.

- [ ] RED: pass a target-mode facade to `foregroundPage`; make `page.bringToFront` throw if called, and assert the intended operation runs. Native-mode behavior must retain its current bounded focus test. Test independent target pages typing distinct literal values concurrently without cross-delivery.
- [ ] Return the identity's focus mode from `forSession`. Pass `focusMode: 'target'` at the two production session creation sites. In `foregroundPage`, keep the same session lease and cancellation checks, but guard activation:

```ts
if (ui.focusMode !== 'target') {
  await boundedDomRead(() => page.bringToFront(), stage + ':focus', 5000, signal);
}
```

- [ ] Apply the same policy to `configureHeadedWindowUnlocked` using `options.ui?.focusMode`. Preserve window size/readback and CDP ownership; no always-on-top, minimization, occlusion flags, global OS input, or JavaScript spoofing of visibility/focus properties.
- [ ] Keep locator `.focus()` for the canvas opener, per-character keyboard events, hit-target tests, and the verified collapsed-caret fast path. The input target is the exact page/element in that session, not whichever desktop window happens to be foreground.
- [ ] Run interaction/launcher/auth/canvas regressions. Verify initial pages and pages created later in the same context use the same session facade. No success claim may rely on fake Page objects alone.

### Task 4: Measure concurrency honestly, including failed actions

**Files:** `src/main/services/capcut/types.ts`, `uiInteractionScheduler.ts`, `src/shared/schemas/automation-evidence.schema.ts`, `scripts/verify-rollout-evidence.mjs`, `scripts/live-capcut-options.mjs`, `scripts/live-capcut-run.mjs`; their existing schema/telemetry/options/runner/validator tests.

**Contract:** Preserve existing functional/evidence validation unchanged. Add a separate opt-in `--require-independent` acceptance gate and metrics, so a legacy serial 3/3 run cannot be presented as proof of independence.

- [ ] RED: an otherwise valid fresh 3/3 artifact with sequential editor intervals passes functional validation but fails `--require-independent`. A fixture with overlapping **distinct** session intervals passes; overlapping input in the same session fails.
- [ ] Add optional run-start `uiScope: 'run-native' | 'session-target'`; old artifacts remain valid for their original functional gate. The independent gate requires `session-target`; production must set it from actual scheduler/facade policy, not the CLI assertion.
- [ ] Add optional `outcome: 'resolved' | 'rejected'` to `ui-finished` and its internal event. Emit rejected completion only for ordinary errors whose lane ownership is released. A timeout/active abort is not a normal finish: quarantine and exact stop remain its terminal ownership evidence. Do not emit duplicate finishes from late settlements.
- [ ] Implement `summarizeUiConcurrency(events)` in the existing verifier. Key active intervals by `(sessionAlias, lane)`; validate start/end ordering, accumulate wait/hold durations, and compute global peaks from intervals. Do not sum nested foreground and editor holds as if they were disjoint wall time. Reject incomplete interval evidence for the independent acceptance gate instead of silently undercounting failures.
- [ ] Return `wallMs`, `peakEditorSessions`, `peakInputSessions`, per-session `editorWaitMs`/`inputWaitMs`, and input wait median/p95. Require original 12/12, no unsafe event, clean lifecycle, and purchase accounting first. For live N>=3 require overlapping editor work on at least three distinct sessions; a synchronized fixture in Task 5 proves capacity for all N.
- [ ] Suggested live queue acceptance: per-session cumulative editor wait <=2s and input wait p95 <=2s. Exceeding these is a diagnostic failure, not permission to lengthen timeouts or exclude the slow account. CPU/event-loop stalls must be measured separately.
- [ ] Tests cover valid old artifacts, tagged serial artifacts, duplicate/missing starts/ends, ordinary rejection duration, timeout/late-settlement rejection, missing policy marker, and same-session overlap. Keep CLI exit codes and exact-run artifact identity behavior unchanged.

### Task 5: Prove concurrency without purchasing accounts

**Files:** existing deterministic fixture and service tests; new `src/main/services/capcut/__tests__/independentSessions.test.ts`; new opt-in `scripts/verify-independent-profiles.mjs` and `scripts/__tests__/verify-independent-profiles.test.mjs`. Reuse `tools/offlineFixture.ts` and the existing launcher/runtime injection; do not duplicate purchase or account logic.

- [ ] Add barrier-based **offline** deterministic tests for N in `[1, 3, 5, 10, 20]`, including two rounds per account and an artificial generation wait. All N editor callbacks must reach the test barrier before any are released. With N fixed 1s waits, virtual elapsed work must remain approximately 1s per stage rather than N seconds; derive expected values from literal fixture delays, not the implementation's own timing helper. Do not add this barrier to production. The one-held-worker test from Task 1 separately proves peers can finish without waiting for the slowest worker.
- [ ] Replace global `peaks.editor === 1` / `peaks.foreground === 1` acceptance assertions with **per-session** max=1 and barrier-proven global peak=N. Keep separate resource caps and run counters. Preserve lifecycle failure tests; invert only the cross-session-blocking expectation.
- [ ] Cover cancel-before-start, cancel-while-typing, pending key command, late response after stop, failed exact stop, same-account recovery, and persistence failure. One held/broken worker must not stop unrelated healthy workers unless the explicit global safety condition fires.
- [ ] Implement a reusable no-account interaction probe with this interface:

```ts
// Type contract for the opt-in test harness, not a new production service.
export declare function verifyIndependentProfiles(options: {
  threadCount: 3 | 10;
  launcher: BrowserLauncher;
  signal: AbortSignal;
}): Promise<{
  started: number;
  stopped: number;
  completed: number;
  peakConcurrentInputs: number;
  externalRequests: number;
}>;
```

Import the existing `BrowserLauncher` type from `src/main/services/capcut/launcher/BrowserLauncher.ts`. The wrapper validates `threadCount` is 3 or 10, requires `VERIFY_MULTILOGIN_INDEPENDENCE=1` plus live authorization, sets mailbox budget zero, and receives its launcher from the configured runtime. It must not import/create an account work source or an email purchase service. Test invalid/missing consent before launcher invocation and owned-profile cleanup on every rejection. Keep secrets inside the existing runtime/vault injection, never dump environment variables or put credentials into new CLI arguments.

- [ ] First run local Chrome fixtures, then (separately approved) **3 and 10 distinct real Multilogin browser profiles/processes**. Ten contexts inside one Chrome process do not satisfy the vendor gate. Each profile has two fixture tabs; install deny-by-default routes/CSP before content. Exercise input, local editor focus, upload/filechooser, popup/tab switching, polling, and resize/readback with no CapCut or mailbox request.
- [ ] Use distinct literal text per profile and count clicks in its own DOM. Run 100 concurrent rounds and one held-operation scenario. Require zero cross-profile text/clicks, zero explicit native activation in target mode, global concurrent input peak=N, local input peak=1, and exact N confirmed stops.
- [ ] Verify passive waiting does not block peers. Do not disable vendor safeguards or spoof page visibility to pass. If the vendor cannot deliver target-mode input independently, record the failing primitive and stop the rollout; investigate that specific limitation before choosing a different design.

### Task 6: Build, measure resources, and perform fresh-account acceptance

**Files:** use the official live runner/verifier and update the existing live report with separate run IDs. No production module is added solely for benchmarking; sample process-tree resource usage in the opt-in harness.

- [ ] Independent review checks scope, cross-lane poison, registry retirement, Stop All, input targeting, and exact receipts. Run these on final integrated source, not in parallel with native module rebuilds:

```powershell
npm --userconfig=NUL run rebuild:node
npx --userconfig=NUL vitest run
npm --userconfig=NUL run typecheck
npm --userconfig=NUL run lint
npm --userconfig=NUL run selectors
npm --userconfig=NUL run build
npm --userconfig=NUL run test:electron
```

- [ ] Before any real runner, verify its SQLite module executes in Electron (ABI133 for the currently installed Electron) and use a fresh isolated DB with zero accounts, emails, tasks, and leases. The previous first-attempt ABI failure must not be repeated. Restore Node ABI afterward for unit tests.
- [ ] Obtain separate explicit approval for fresh stages **1 → 3 → 5 → 10**. All five caps (`threads`, `mail-limit`, `approved-mailboxes`, `stop-after`, `max-billable-purchases`) must equal that stage. One pass through these stages costs at most **19 new mailboxes**; this is a budget disclosure, not authorization. Repeats need another explicit cap, and no failed acquisition may be replaced by buying beyond it.
- [ ] At stage 1 establish a fresh solo baseline with the same build, task set, delays, provider, and machine conditions. One sample is provisional; record all subsequent individual durations. If repeatability/median claims are required, approve repeated samples explicitly; do not present p95 batch runtime from three runs.
- [ ] Start each stage's workers normally, without serializing whole accounts or lowering actual concurrency behind the requested count. Compare run-start→terminal consistently; separately report preparation/build/ABI time.
- [ ] All N accounts must start fresh, register with their own OTP, execute required missions, and finish with exact fresh/final 12/12 receipts. Existing-account resume cannot substitute for this gate. All N profile stops must confirm; purchase count <=approved cap; final resources zero.
- [ ] Performance targets, not promises: `T3 <= 1.5×T1`, `T5 <= 2×T1`, and `T10 <= 2.5×T1` with an initial ten-worker objective of **<=10 minutes**. Also pass the independence gate from Task 4. If fresh T1 is 4m, the targets are <=6m/8m/10m. If T1 differs, publish the measured baseline rather than claiming a four-minute guarantee.
- [ ] Sample every 2s: machine CPU, working set/private bytes of the owned browser process trees, available RAM, renderer responsiveness, task timings, and proxy/provider waits; GPU counters if available. Do not collect process command lines, tokens, URLs, or cookies. Flag sustained CPU >90% for 30s or free RAM <4GiB as capacity pressure, not evidence to disable safety. Avoid double-counting shared memory.
- [ ] A 10-account functional pass with poor timing is **not** a performance pass. A faster run with missing proofs is **not** a functional pass. Stop stage escalation on either failure. The 20-worker serial-work projection and offline tests above do not authorize or certify a real 20-profile rollout.

## 4. Completion and rollback criteria

Completion requires: per-session ownership wired through production and health paths; no cross-session editor/input queue; correct local poison and global safety shutdown; no leaked scheduler registry in continuous mode; real independent Multilogin input gate; fresh 1/3/5/10 evidence with correctness and timing reported separately.

Rollback means revert **only this implementation's scoped delta** against its saved baseline if a gate fails, retaining receipts and purchased account data. Never reset the user's worktree, delete paid accounts, overwrite historical artifacts, or reopen old throttled accounts. Do not call a rollback to global serialization an independent-worker solution.

No database migration, renderer/preload redesign, provider purchase rewrite, or wholesale mission rewrite is planned. Context7 is unavailable in the current tool set; implementation must fetch current Playwright documentation when available and verify the installed declarations/vendor behavior. Static inspection already confirms page-target CDP input and focus emulation in the installed Playwright, but this does not replace Task 5's real Multilogin gate.

## 5. Self-review and handoff

- [x] Scope matches independent execution, not only three profiles open at once.
- [x] Ten-worker timings distinguish measurements, projections, capacity floors, and acceptance targets.
- [x] Local independence does not remove purchase/proxy/DB atomicity or global resource-safety stops.
- [x] Old serial-success artifacts cannot satisfy the new independent gate.
- [x] Continuous-mode registry growth, failure-duration undercount, active-caret typing, and background input are explicitly addressed.
- [x] Incorporated the unchanged-code 2/3 baseline without labeling its shorter failed duration an optimization; task-list root cause remains unselected.
- [x] Worker-1-held / peers-2–20-finish and continuous next-item independence are mandatory offline acceptance, not merely simultaneous profile startup.
- [x] User approved this design/implementation plan; task-scoped RED/GREEN and independent review completed for the runtime/offline changes.
- [x] Core Tasks 1–4 and deterministic 1/3/5/10/20 work implemented; local distinct-Chrome 3/10-process smoke checks passed with matching concurrent-input peaks.
- [ ] Full Task 5 real Multilogin 100-round gate and Task 6 live/resource/performance acceptance completed.
- [ ] Zero-mail profile gates and separately approved fresh rollout gates completed.

Recommended execution: implement the scheduler/lifecycle slice first, then target input and concurrency evidence, then the no-purchase profile gate. Do not start billable acceptance until those gates are green.
