# Headed UI 12/12 Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the existing headed UI implementation by fixing audit-proven scheduler/recovery gaps and finishing purchase/evidence/harness safety, then requalify the offline gate before requesting any live rollout.

**Architecture:** Preserve the existing run-scoped scheduler, session-scoped browser ownership and exact receipt storage. Close direct-facade escape paths; retain quarantined ownership until one confirmed stop; wire real production evidence and dispatch budgets; validate one immutable run artifact. Worker count may be 10 but foreground/editor capacity remains one; no throughput claim is implied.

**Tech Stack:** Electron, TypeScript, Playwright Core, Vitest, SQLite, React, Zod; use installed dependencies, no upgrades.

**Spec:** `docs/superpowers/specs/2026-09-08-headed-ui-multithread-12-of-12-design.md`

**Baseline implementation plan:** `docs/superpowers/plans/2026-09-08-headed-ui-multithread-12-of-12.md`

**Audit evidence:** `docs/superpowers/reports/2026-09-08-antigravity-implementation-audit.md`

## Global Constraints

- This is a continuation, not a rewrite. Baseline HEAD is `c5de54974633c666efb021214aa51c8747c5fb47` plus the preserved dirty worktree.
- Do not reset/checkout/clean/stash the workspace, use `git add .`, discard Antigravity changes, or commit without user authorization.
- The current request authorizes audit/tests/planning; this document is not a claim that the following production work has run. Before an implementation takeover, establish a single writer for each file and confirm Antigravity is not editing the same scope.
- No live account, health profile, CapCut/Multilogin/browser session, proxy/mailbox provider or purchase is authorized by this plan. Original Task 15 remains a separate gate.
- Do not execute the current `live-capcut-run.mjs`, including its apparent dry-run flag, until Task 6's fake process-boundary tests prove safety.
- Preserve human-pace jitter, hit-target guards, cancellation, one replacement session per account, same account/password/mailbox/proxy, existing-only replacement login and no replay of same-run unsettled proof.
- Foreground capacity = 1; editor capacity = 1 at 1/3/5/10 workers. A timeout does not cancel the underlying browser or provider promise.
- Completion requires a fresh, final, exact server receipt; rollout additionally requires 12 distinct status-4 keys. HTTP-only remains on its existing result path.
- Evidence is redacted; no real credentials/account IDs/profile IDs/proxy endpoints/CDP URLs/raw logs/captures in tests or this report.
- Use TDD per production change. Do not delete/skip the existing 10 RED tests or weaken contracts to make old mocks pass.
- Tasks below end at offline readiness. No automatic launch, purchase, stage advance, push or release follows a green suite.

## Multi-agent ownership and dependencies

| Worker | Independent first assignment | Exclusive source ownership |
|---|---|---|
| UI agent | Task 1, then engine portion of Task 2 | `capcut/human.ts`, `overlays.ts`, `missionRunner.ts`, `runTasks.ts`, `types.ts`, UI helper callers, `CapcutEngineService.ts` and their tests. |
| Budget agent | Task 4 provider implementation and tests | `EmailPurchaseService.ts`, `EmailPurchaseService.test.ts`; send required config/events to coordinator, do not edit shared files. |
| Rollout agent | Task 6 pure parser/controller/validator and fake tests | `scripts/live-capcut-options.mjs`, `scripts/live-capcut-run.mjs`, `scripts/verify-rollout-evidence.mjs`, corresponding script tests. No live invocations. |
| Coordinator | Shared contracts, service integration, Tasks 3/5 and verification | `AutomationRunService.ts`, `AutomationWorkSource.ts`, `providerStack.ts`, shared schemas/contracts, preload/IPC, integration tests; no concurrent writer to these files. |

First freeze the interfaces below. Then run independent assignments concurrently. Integrate UI result changes before service/recovery tests; integrate Task 4 accounting before terminal telemetry; integrate telemetry and health IPC before connecting Task 6 to production. Task 7 requires all earlier tasks. A reviewer is read-only; do not dispatch multiple implementation agents into the same checkout file.

## Shared interfaces to preserve or tighten

Existing `AccountUiInteraction`, `CapcutUiAccountResult`, `CapcutVerificationReceipt`, `UnsettledTaskProof`, `RunTelemetry`, and `UiSchedulerSnapshot` stay owned by their current modules.

```ts
// capcut/human.ts: merge into the existing type, do not add another facade.
export interface HumanInteractionOptions {
  signal: AbortSignal;
  stage: string;
  ui: AccountUiInteraction;
  log?: (message: string) => void;
}

// capcut/types.ts: used by Claim helper and runTasks.
export interface TaskClaimResult {
  claimed: boolean;
  actionSettledAt: number | null;
}

// EmailPurchaseService.ts: shared with source/runtime via type imports.
export interface BillablePurchaseStats {
  budget: number;
  attempted: number;
  confirmed: number;
  ambiguous: number;
}
export interface BillablePurchaseEvent {
  provider: 'gmail94' | 'dongvanfb';
  outcome: 'attempted' | 'confirmed' | 'ambiguous';
  stats: BillablePurchaseStats;
}
```

`PurchaseOptions` retains current service/accountType/quality and gains explicit `maxBillablePurchases: number` plus optional `onPurchaseEvent(event: BillablePurchaseEvent): void`. `EmailAcquisitionSession` gains `purchaseStats(): BillablePurchaseStats`. Pass zero explicitly for custom-domain call sites; validate missing/invalid budget before any billable provider preflight. Shared automation config requires a non-negative integer budget for new billable API sources; existing/manual/health paths cannot purchase.

`CapcutTaskRunner.runAccount`, engine input, `RunTasksInput` and UI helper inputs require the session `ui` and existing abort signal. Tests/headless entry points explicitly construct `createDirectUiInteraction(signal)`; production helpers never create a fallback implicitly.

### Task 1: Seal every production foreground path

**Files:**
- Modify: `src/main/services/capcut/human.ts`, `overlays.ts`, `missionRunner.ts`, `runTasks.ts`, `types.ts`
- Modify: `src/main/services/CapcutEngineService.ts`, `src/main/services/capcut/missions/designStudio.ts`
- Modify as required by compile errors: UI auth/trial/steps/missions/launcher call sites listed in original Task 6; do not modify HTTP-only missions.
- Test: `src/main/services/capcut/__tests__/boundedInteractions.test.ts`, `uiInteractionCoverage.test.ts`, `claimReconciliation.test.ts`, `runTasks.test.ts`

**Interfaces:** Consumes the existing session facade; produces required UI input contracts and typed timeout propagation for Claim, overlays and focus. No new scheduler instance is created here.

- [ ] **Step 1: Preserve the exact observed bypass as a RED regression.**

Use this contract in `boundedInteractions.test.ts` (merge its imports from `human`, `uiInteractionScheduler`, Vitest and Playwright types). The test is deliberately a runtime-boundary test with an invalid call; do not remove it when types become strict.

```ts
it('rejects an omitted facade before any focus or input', async () => {
  const signal = new AbortController().signal;
  const focus = vi.fn(async () => {});
  const input = vi.fn(async () => {});
  const page = { bringToFront: focus } as unknown as Page;
  await expect(Promise.resolve().then(() => foregroundPage(
    page,
    { signal, stage: 'audit:missing-ui' } as HumanInteractionOptions,
    input
  ))).rejects.toThrow('UI_INTERACTION_REQUIRED');
  expect(focus).not.toHaveBeenCalled();
  expect(input).not.toHaveBeenCalled();
});
```

Run `npx vitest run src/main/services/capcut/__tests__/boundedInteractions.test.ts -t 'omitted facade'`. Expected baseline RED: resolves and both spies are called. Also add the two-session test: hold A's foreground with a deferred promise; queue B using its explicit facade; before releasing A both B spies are zero; after release both are one.

- [ ] **Step 2: Remove implicit fallback and bound focus inside the lease.**

```ts
// foregroundPage body; keep the existing exported function/module.
if (!options?.ui) throw new Error('UI_INTERACTION_REQUIRED');
const { signal, stage, ui } = options;
signal.throwIfAborted();
return ui.foreground(stage, async () => {
  signal.throwIfAborted();
  await boundedDomRead(() => page.bringToFront(), stage + ':focus', 5000, signal);
  signal.throwIfAborted();
  return operation();
});
```

Pass `env.ui/env.signal` into every `ensurePageUsable`, Claim and popover invocation. Remove `ui?` and silent direct fallback in engine/task/helper contracts. Direct facades are selected only at explicit headless/test entry points. Keep humanClick/humanType unlocked internals inside one lease; do not recursively acquire foreground.

- [ ] **Step 3: Keep timeout fatal across helper cleanup.**

Replace blanket click/overlay catches with typed handling: call `signal.throwIfAborted()`, rethrow `isDomReadTimeout(error)`, and retain existing ordinary-error fallback only when no command remains uncertain. In `claimPending`, return the same fatal task result/checkpoint path as a fatal mission group; do not just throw away proof or keep selecting missions. Never issue popover-close/input after a typed timeout.

Add tests for (a) Claim uses the exact supplied facade, (b) timed-out Claim/focus causes no subsequent input, (c) current session is quarantined until service stop, (d) overlay helpers cannot fall back to a new uncancellable signal. A never-settling focus with fake timers must reject at the 5000 ms boundary with typed DOM timeout and never call input.

- [ ] **Step 4: Strengthen coverage and verify.**

Extend the AST coverage guard to reject missing UI arguments in helper calls and creation of a direct facade in production helper bodies; retain its raw-input checks. Missing inventory files must fail, not return an empty violation array. Use explicit entry-point exceptions, not blanket exemptions by filename.

Run `npx vitest run src/main/services/capcut/__tests__/boundedInteractions.test.ts src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts src/main/services/capcut/__tests__/claimReconciliation.test.ts src/main/services/capcut/__tests__/runTasks.test.ts`. Require zero failures and independent review of all helper call sites.

### Task 2: Enforce exact UI receipts and Claim freshness

**Files:**
- Modify: `src/main/services/capcut/runTasks.ts`, `missionRunner.ts`, `types.ts`, `src/main/services/CapcutEngineService.ts`
- Coordinator-only modify: `src/main/services/AutomationRunService.ts`
- Test: `src/main/services/capcut/__tests__/runTasks.test.ts`, `claimReconciliation.test.ts`, `src/main/services/__tests__/CapcutEngineService.test.ts`, `automationTaskProgress.test.ts`, `AutomationRunService.test.ts`

**Interfaces:** Consumes required UI facade and `TaskClaimResult`; produces non-inferred receipts, awaited checkpoints and strict UI-vs-HTTP result classification.

- [ ] **Step 1: Add RED cases with exact timestamps and results.**

| Case | Fixture | Required assertion |
|---|---|---|
| Claim freshness | Claim input settles at 200; provide complete snapshots at 199 and 201. | 199 cannot be final; qualifying wait uses watermark >=200; 201 may become final. |
| Missing UI verification | UI fake returns legacy `missing=[]` with absent verification. | Account is not completed; no legacy task sink call. |
| Null/stale UI receipt | Return null, or fresh=false, or final=false individually. | All remain incomplete. |
| HTTP compatibility | Existing HTTP-only fixture with valid legacy result. | Same previous completion semantics; no new UI requirement. |
| Exact rows | Snapshot includes status 1/2/4; outcomes contain additional old key. | Rows copy exact statuses; old key is not invented in receipt items. |
| Same-run proof | Real runTasks gets unsettled proof; subsequent snapshots stay 1 then become 4. | No mutation for that key; wait/checkpoint/result carry original proof; timeout stays partial. |

Existing tests may keep mocked network monitors/DOM, but the no-replay test must run real `runAllTasks` and group selection. A fake engine that simply returns no actions when given proof does not prove this behavior.

- [ ] **Step 2: Implement Claim settlement data and remove legacy inference.**

`claimIfPending` returns `Promise<TaskClaimResult>` instead of boolean; record `actionSettledAt` when its UI mutation sequence settles, before passive receipt reconciliation. `claimPending` aggregates `latestActionSettledAt`, and the caller updates `requiredAfter` before checkpoint/final receipt selection. No action means timestamp null. On timeout, checkpoint known exact rows/proof as non-final and use fatal recovery; do not classify it as a successful claim.

```ts
// runTasks after Claim result: claim is the aggregated TaskClaimResult.
if (claim.actionSettledAt !== null) {
  requiredAfter = Math.max(requiredAfter, claim.actionSettledAt);
}
// Only a receipt observed strictly after requiredAfter qualifies.
```

`toTaskProgressRows()` must iterate required `snapshot.tasks`; remove its legacy inference branch. Engine copies mandatory observedAt/requiredAfter/fresh/final, with no `?? true`, synthetic current timestamp, or absent-field completion fallback. Update old fake fixtures to supply actual metadata.

Coordinator splits classification solely on `config.missionTransport ?? 'ui'`. UI needs non-null/fresh/final/complete receipt and positive exact row total; absent runner/page/password in a credit UI run must not count as a verified task completion. For skipped UI results add an internal `ThreadOutcome` variant `{ kind: 'skipped'; status: 'done'; step: string }`, preserve the user-facing skip step, increment a run-local skipped counter exactly once and not `accountsCompleted`, and emit that actual counter in terminal evidence. No new persisted AccountStatus is needed. Preserve the explicit HTTP-only branch and its existing skip/completion behavior.

- [ ] **Step 3: Verify persistence/recovery is still single-owner.**

Run `npx vitest run src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/capcut/__tests__/claimReconciliation.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/repositories/__tests__/accountTaskRepository.test.ts src/main/services/__tests__/AccountTaskService.test.ts`.

Require checkpoint transaction completion before any replacement launch, no duplicate result-level persistence and unchanged exact receipt item storage. Keep original migration 006; do not replace it or rewrite historical rows outside its receipt transaction.

### Task 3: Make session teardown and stress assertions trustworthy

**Files:**
- Coordinator modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/capcut/uiInteractionScheduler.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`, `fixtures/deterministicRunHarness.ts`, `src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts`, launcher lifecycle tests

**Interfaces:** Consumes session-scoped cached promises and scheduler events; produces one-stop ownership, retained quarantine snapshot and deterministic measurements of real lane state. Scheduler owns queues; service owns abort controllers and teardown.

- [ ] **Step 1: Add RED tests that the current green suite misses.**

```ts
it('retains foreground owner while its session is quarantined', async () => {
  const scheduler = new RunUiInteractionScheduler({ editorLaneLimit: 1 });
  const sessionAlias = 'worker-1-session-1';
  const ui = scheduler.forSession({ sessionAlias, signal: new AbortController().signal });
  await expect(ui.foreground('audit:timeout', async () => {
    throw new DomReadTimeoutError('audit:timeout');
  })).rejects.toBeInstanceOf(DomReadTimeoutError);
  expect(scheduler.snapshot().foregroundOwner).toBe(sessionAlias);
  scheduler.confirmProfileStopped(sessionAlias);
  expect(scheduler.snapshot().foregroundOwner).toBeUndefined();
});
```

In service fake tests, leave first provider stop unresolved, advance the configured stop deadline, call both stopThread and global Stop again, then settle the old promise. Assert provider stop count remains exactly 1, no replacement launches, quarantine is not released, and terminal remains cleanup-failed. Include immediate rejection and Stop-before-profile-ID variants. Reject old tests that demand an automatic second stop after an uncertain outcome; record the intended contract correction.

- [ ] **Step 2: Retain exact session ownership until proven cleanup.**

Remove the failed-stop promise resets in stopThread/global Stop. Preserve the failed/uncertain session for reporting and disallow new run/replacement. A late stop settlement must not mutate terminal state or release quarantine after cleanup already failed. Replace the misleading 'press Stop to retry' text with fixed cleanup-failed guidance; external manual remediation is a separate operator action, not an automatic retry loop.

In the scheduler, unsafe catch retains logical foreground ownership/activity; successful exact `confirmProfileStopped(alias)` releases it once. Shutdown rejects queued/new tickets without declaring uncertain profiles stopped. On all settle paths detach abort listeners in finally and ignore closed-session late callbacks.

- [ ] **Step 3: Repair the deterministic harness before trusting 10-worker tests.**

Capture actual `UiSchedulerSnapshot` while scheduler still exists, before service disposal; a missing terminal snapshot fails the test. Use the exported type and canonical `foregroundWaiting`, `editorWaiting`, `editorActive`, `foregroundOwner`, `quarantinedSessionAliases` fields without optional-chaining/default-zero substitutes. The current nested snapshot aliases also exist, but do not rescue a null scheduler sampled after disposal.

Track ordered queued/started/finished/quarantined/profile-stop events and measured foreground/editor active peaks. A quarantined operation retains occupancy until confirmed stop. Assert FIFO start sequence for surviving tickets, no overlap, stop-confirm-before-next-admission, exactly one stop per started session and no late action after closure.

Wire every declared fault: launch rejection/late ID, attach/window/health mouse timeout, mission timeout, checkpoint failure, replacement launch/login failure, second mission timeout, old stop failure, stale/missing final receipt, queued/global/per-thread Stop. Each injected fault increments a reached counter; the test fails if its counter is zero. Use actual runTasks for proof/no-replay scenarios, with fake page/monitor/provider boundaries.

- [ ] **Step 4: Run and review the corrected stress matrix.**

For each worker count `[1, 3, 5, 10]`, run 100 deterministic seeds for the success schedule and applicable cancellation/recovery schedules. Assert non-vacuous event counts and lane peaks <=1; successful final resources/queues are zero, failed cleanup retains uncertain ownership and reports failure.

Run `npx vitest run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts`. Publish seed/fault and sanitized assertion on failure, not credentials.

### Task 4: Finish Task 12 at both irreversible provider boundaries

**Files:**
- Budget agent modify: `src/main/services/EmailPurchaseService.ts`, `src/main/services/__tests__/EmailPurchaseService.test.ts`
- Coordinator modify: `src/main/services/AutomationWorkSource.ts`, `AutomationRunService.ts`, `src/shared/schemas/automation.schema.ts`, relevant work-source/service/schema tests and new-account config caller fixtures

**Interfaces:** Consumes shared BillablePurchaseStats/Event above; produces an acquisition-session budget and immutable stats copies, forwarded to telemetry in Task 5. HTTP task execution semantics do not change; any source that buys mail must supply an explicit budget.

- [ ] **Step 1: Reproduce the existing 10 failures before production edits.**

Run `npx vitest run src/main/services/__tests__/EmailPurchaseService.test.ts`. Baseline is 34 pass/10 fail. Keep all 10 assertions. Replace explicit any with `ReservedEmail`, `BillablePurchaseEvent` and appropriate unknown-boundary casts; provide full `DongVanPurchasedMail` fixtures, for example:

```ts
const mail: DongVanPurchasedMail = {
  email: 'mail@example.invalid', password: 'fake-password',
  refreshToken: null, clientId: null, raw: 'fake-offline-row'
};
```

Use the existing fixture type's nullability, not a cast hiding missing fields. Add a test in the existing `createService/storeKey/gmail/purchasedRepo` test scope proving confirmation survives a database failure:

```ts
it('counts provider confirmation before persistence can fail', async () => {
  storeKey('gmail94', 'fake-key');
  const session = await createService().openAcquisitionSession(
    'gmail94', 1, { maxBillablePurchases: 1 }, new AbortController().signal
  );
  vi.spyOn(purchasedRepo, 'insertReserved').mockImplementationOnce(() => {
    throw new Error('fake-persistence-failure');
  });
  await expect(session.acquireOne('worker-1', new AbortController().signal)).rejects.toThrow();
  expect(gmail.createCalls).toHaveLength(1);
  expect(session.purchaseStats()).toEqual({ budget: 1, attempted: 1, confirmed: 1, ambiguous: 0 });
});
```

- [ ] **Step 2: Validate budget and account for each real dispatch exactly once.**

Before preflight, reject missing/non-integer/negative budget for Gmail94/DongVan. Under existing exclusive acquisition, try reusable inventory first; immediately before provider call, reject exhausted budget, increment attempted and emit attempted snapshot. No await may separate the atomic budget check/increment. On valid provider response increment confirmed before storage/OAuth enrichment; ambiguous network/timeout/rate-limit/malformed response increments ambiguous and throws sanitized `PURCHASE_OUTCOME_UNKNOWN`. Never refund an attempt or retry it. Preserve `confirmed + ambiguous <= attempted <= budget` after every transition.

Run-local counter remains independent of balance/threads/mailLimit. `purchaseStats()` and emitted events return copies so consumers cannot mutate the budget. Add `BILLABLE_PURCHASE_LIMIT_REACHED` to the terminal enum before use. Normal pre-dispatch cancellation/config failure consumes zero; a dispatched request cancelled by its caller retains its consumed attempt.

- [ ] **Step 3: Wire every source caller and verify.**

Coordinator passes config.maxBillablePurchases and onPurchaseEvent through `AutomationWorkSource.prepare()` to the one acquisition session; expose read-only stats through the prepared source for service terminal reporting. Existing/manual/health must not open a purchase session. Update UI/config producers and legacy fake fixtures explicitly; do not silently replace missing budget with threadCount/mailLimit.

Run `npx vitest run src/main/services/__tests__/EmailPurchaseService.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/shared/schemas/__tests__/automation.schema.test.ts`, then `npm run typecheck` and `npm run lint`. Require all tests/type/lint pass and review both dispatch sites.

### Task 5: Enable truthful, redacted production telemetry

**Files:**
- Coordinator modify: `src/main/runtime/providerStack.ts`, `src/main/services/AutomationRunService.ts`, `AutomationWorkSource.ts`, `src/shared/schemas/automation-evidence.schema.ts`
- Modify: `src/main/services/capcut/runTelemetry.ts`
- Test: `src/main/services/capcut/__tests__/runTelemetry.test.ts`, `src/main/services/__tests__/AutomationRunService.test.ts`
- Create: `src/main/runtime/__tests__/rolloutTelemetryWiring.test.ts`

**Interfaces:** Consumes real runtime userData and Task 4 stats/events; produces one immutable exact-run artifact with lifecycle/resource/receipt evidence. Extend the existing event union with `profile-start` carrying only run-local aliases, and terminal mode/stage fields matching run-start; define these once in the shared schema and derive types from it. Define `AutomationEvidenceNonTerminalEvent = Exclude<AutomationEvidenceEvent, { type: 'terminal' }>` in that schema module and use it for `RunTelemetry.record`; retain runtime validation as well as the type constraint. `close` remains the sole terminal writer.

- [ ] **Step 1: Add production-wiring and recorder RED tests.**

Split the production-wiring proof into two tests without inventing factory injection options. In `rolloutTelemetryWiring.test.ts`, module-mock the `AutomationRunService` and `CapcutEngineService` constructors before importing `providerStack`; construct the real factory with temporary SQLite repositories, a fake vault and fake HttpClient through its existing arguments. Capture the service constructor's second argument and assert its userDataDir exactly equals the supplied directory. No service start or provider method runs in this wiring-only test.

Then use the real `AutomationRunService` constructor with its existing injected fake source/browser/engine collaborators and that same runtime directory in a separate service integration test. Run a fake headed stage 3. Assert one artifact exists there, mode/stage are correct, three anonymous session starts have three stops, resource peaks are actually observed, terminal purchase counters equal fake source stats. Add resume and early-preparation-failure variants. Together these prove factory propagation and real service recording; do not describe either alone as a full real-factory mission run.

At recorder unit boundary, attempt to record (a) wrong run ID, (b) a terminal event via record(), (c) secret-like labels/keys, (d) unknown fields; assert rejection before file bytes change. Call close twice and record after close; exactly one terminal exists and later calls leave bytes unchanged. Seed sentinels into the actual event input, not just an unused constants array.

- [ ] **Step 2: Wire metadata from the actual run, not constants.**

Replace the existing construction in `providerStack.ts`, preserving any new collaborator added while integrating earlier tasks:

```ts
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
  httpOnlyRunner: options.httpOnlyRunner,
  taskProgress: createTaskProgressSink(repositories.accountTaskRepo)
}, { userDataDir: options.userDataDir });
```

Use an explicit validated run context containing mode, stage and budget before recording start. For automation, derive `new` or `resume` from the validated request before preparing its work source. The dedicated health path passes mode `health` explicitly and creates no work source. Stage comes from a validated optional `rolloutStage` config (1/3/5/10, null for non-rollout), never from a hard-coded 1. Instantiate this headed rollout recorder only for headed UI, keeping HTTP-only evidence/semantics separate. Emit profile-start on early ownership publication and resource snapshots at every acquisition/release transition. Terminal uses actual counters, normalized terminal reason, and the last measured cleanup/scheduler state; do not reset these before recording.

Require aliases on all profile/receipt events so a validator can match exact sessions. Record receipt only after durable checkpoint success. Do not deduplicate malformed receipt keys to hide invalid evidence. For strings use known labels/task-key allowlists or mapped safe codes; unknown untrusted values fail validation, never echo raw text.

- [ ] **Step 3: Fail closed if evidence cannot be completed.**

Rollout recorder/write/schema failure must make the run fail, clean up owned resources and return a fixed sanitized `INTERNAL_ERROR`; do not swallow exceptions and claim success. Recorder close is the sole terminal writer. Use exclusive artifact creation for a run ID to prevent accidental append to an old artifact. The convenience manifest is not acceptance authority; if atomic replacement is unavailable, omit it rather than fall back to an unverified partial copy.

Add tests for write failure, missing source counters, wrong mode/stage, repeated session close and late old-session callback. Run `npx vitest run src/main/runtime/__tests__/rolloutTelemetryWiring.test.ts src/main/services/capcut/__tests__/runTelemetry.test.ts src/main/services/__tests__/AutomationRunService.test.ts` and review actual temporary JSONL against strict schema.

### Task 6: Complete the fail-closed controller, health IPC and validator

**Files:**
- Rollout agent modify: `scripts/live-capcut-options.mjs`, `scripts/live-capcut-run.mjs`, `scripts/__tests__/live-capcut-options.test.mjs`
- Create: `scripts/verify-rollout-evidence.mjs`, `scripts/__tests__/live-capcut-run.test.mjs`, `scripts/__tests__/verify-rollout-evidence.test.mjs`
- Coordinator modify: `src/main/rolloutUserData.ts`, `src/main/main.ts`, `src/shared/schemas/automation.schema.ts`, `src/shared/contracts/ipc-channels.ts`, `api.ts`, `src/preload/preload.ts`, `src/main/ipc/automationIpc.ts`, `src/main/services/AutomationRunService.ts` and existing contract/preload/runtime IPC/userData tests
- Update after parser parity tests: original plan Task 15 commands and Antigravity runbook

**Interfaces:** Implements original Task 13 contracts exactly: exported `main(options, dependencies)`, fakeable process/IPC/evidence dependencies, RUN_HEALTH, `{exitCode, runId, artifactBasename}` and `ROLLOUT_RESULT=` with only `{runId, artifact}`. Validator accepts exact run ID, directory, expected count, stage and new/resume/health mode; no moving manifest alias.

**Schema runtime:** Keep the existing TypeScript shared schema as the only source of truth. Use installed `tsx` through `node --import tsx` for both controller and validator commands; use those same arguments in child-process tests. Validator imports `../src/shared/schemas/automation-evidence.schema.ts`; do not copy/reimplement its Zod definitions in JavaScript. In this audit, the installed loader successfully imported this exact schema and the real TypeScript UI helper in a no-browser probe.

- [ ] **Step 1: Remove eager execution before exercising any CLI.**

Place the existing script behind an ESM main guard, import the strict parser in the entry path, and inject process collaborators. Invalid parse must occur before dynamic import/creation of Electron/CDP/provider clients. Define `createProductionDependencies(options)` in this script as an async factory returning the collaborators listed in Step 2: adapt the current spawn/attach/IPC code, dynamically import Playwright only in this factory, and implement evidence/userData adapters from Steps 3–4. The factory must not itself launch a process or call a provider; those actions belong to the returned methods. Use this entry block (merge imports with the existing script):

```js
import { fileURLToPath } from 'node:url';
const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseLiveCapcutOptions(process.argv.slice(2), process.env);
    if (options.mode === 'dry-run') {
      process.stdout.write('ROLLOUT_DRY_RUN=' + JSON.stringify({ stage: options.stage }) + '\n');
      process.exitCode = 0;
    } else {
      const dependencies = await createProductionDependencies(options);
      process.exitCode = (await main(options, dependencies)).exitCode;
    }
  } catch (error) {
    process.stderr.write('ROLLOUT_ERROR\n');
    process.exitCode = resolveExitCode(error);
  }
}
```

The branch implementation must call `parseLiveCapcutOptions`, then for dry-run return exit 0/null IDs without dependency construction. For all other modes construct the injected production dependencies and call main. No default paid provider/mode is allowed. Validate minutes finite and >0. Raw logs, email, local paths and inherited child stdout never reach rollout stdout.

- [ ] **Step 2: Implement and run the complete fake boundary matrix.**

Use original Task 13 Step 5's named scenarios, plus parser import side-effect tests. All `spawnElectron`, `attachToApp`, `resolveAppUserData`, `runHealth`, `startRun`, `stopRun`, `readEvidenceByRunId`, `killChild`, `writeStdout` collaborators must be injected/spied. Invalid/dry-run require zero calls except one sanitized dry-run summary; a spy unrelated to the actual executed collaborator is not proof.

Add tests for accidental inherited provider flags, infinite/NaN/negative duration, timeout Stop-before-kill, attach failure cleanup, exact caps/config propagation, no auto-advance, and reading the run returned by this invocation while a convenience manifest points elsewhere. Provider opt-in/userData env is limited to the single child; parent env is unchanged. Unknown sensitive option values are never printed.

- [ ] **Step 3: Add health IPC and actual userData parity.**

Implement original Task 13 Step 4 request/response across shared schema/channel/API/preload/IPC/service. Health stage=threads allows only 3 or 10; reject concurrent health/automation. It starts/stops only its owned profiles, returns attempted/healthy/stopped/cleanupFailures and exact artifact identity, and never creates a work source/account/proxy lease/mail reservation/OTP callback.

Keep userData override before DB/provider/window initialization. Sanitize errors to codes without paths. Test actual bootstrap ordering and child producer/validator equality, not only configureRolloutUserData in isolation. No real process is launched by these tests.

- [ ] **Step 4: Implement fail-closed exact-run validation.**

Parse every JSONL line with the shared strict schema. Require one start/one terminal, matching run/mode/stage, observable resource peaks and final zero resources, exact start/stop alias sets, monotonic purchase events matching terminal counters, no quarantine/fault/cleanup failure and no extra/duplicate final result line.

Mode-specific rules: health has N healthy/stopped profiles and zero account/mail/proxy/purchase/task activity; resume has N verified receipts and zero purchases/mail acquisitions; new has N accepted/completed accounts, N mail acquisitions and bounded purchase attempts with ambiguous=0. Each account receipt is fresh/final with exactly 12 unique status-4 keys. Recovered sessions count separately for profile lifecycle, but an account counts once. Any missing event needed to prove a rule fails, never defaults to zero.

Exit codes: success 0, invalid options 2, runtime timeout 3, invalid/missing evidence 4. Reject run-ID path traversal and read only the requested artifact under the actual userData directory. Do not read credentials or sensitive historical evidence.

- [ ] **Step 5: Align CLI documentation and verify.**

Canonical command prefixes are `node --import tsx scripts/live-capcut-run.mjs` and `node --import tsx scripts/verify-rollout-evidence.mjs`. Canonical argument forms for parser tests are explicit `--mode=new-accounts|dry-run|resume|health-only`, `--stage=N`, `--headed`, required equal cap fields and `--account-ids-file` for resume. Preserve aliases only if individually tested; update every original Task 15/runbook command and subprocess test to these forms. Extract/parse every documented rollout command with fake env and synthetic local paths; parsing never authorizes execution.

Run `npx vitest run scripts/__tests__/live-capcut-options.test.mjs scripts/__tests__/live-capcut-run.test.mjs scripts/__tests__/verify-rollout-evidence.test.mjs src/main/__tests__/rolloutUserData.test.ts src/shared/contracts/__tests__/contracts.test.ts src/preload/__tests__/preload.test.ts src/main/ipc/__tests__/runtimeIpc.test.ts`. Only after the fake gate passes may the four safe dry-run invocations be tested without opt-in, with zero external actions.

### Task 7: Requalify offline and hand off the live decision

**Files:**
- Verify: all changed source/tests and original Task 14 gates
- Update: `docs/superpowers/reports/2026-09-08-antigravity-implementation-audit.md` with a new dated verification section; retain the original failure baseline

**Interfaces:** Consumes completed Tasks 1–6; produces a reproducible reviewed offline result, not a 12/12 success claim.

- [ ] **Step 1: Verify ownership and exact test identity.**

Capture HEAD, named dirty paths and hashes before/after commands. If Antigravity changes tested source during verification, label the result mixed-revision and rerun the affected groups on a stable snapshot. Do not stop or kill its process without permission.

- [ ] **Step 2: Run focused suites then full static/offline verification.**

Run each independently: `git diff --check`, `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`. Record exit code, test files, tests and any skipped assertions. Require the Task 4 RED suite to pass and the corrected scheduler stress matrix to produce non-vacuous measurements. Preserve HTTP-only tests.

- [ ] **Step 3: Prove browser-fixture/Electron gates safe before running.**

Before selectors, make fixture loading deny all non-loopback network requests and prevent captured remote scripts from executing; write a synthetic fixture regression proving zero external requests. `tools/verify-selectors.ts` and a focused safety test are the only additional scope needed for that gate. If this cannot be proved, mark selectors blocked, not passed. Before Electron, perform original Task 14's source review and require Task 6 fake process-boundary tests green.

Only then run original ABI-safe sequence: Node rebuild/focused checks as needed, `npm run selectors`, `npm run test:electron`, then `npm run test:node` to return native modules to Node ABI. Coordinate native rebuild with other agents; never run two rebuilds or tests on changing native binaries concurrently. Do not use live-provider config.

- [ ] **Step 4: Independent review and explicit stop.**

Use `superpowers:verification-before-completion` and `superpowers:requesting-code-review`; reviewers check actual diff and evidence, including the original acceptance criteria. Resolve correctness findings using RED/GREEN and rerun affected/full gates. Record exactly which task is implemented, tested and reviewed; these are separate statuses.

After every required offline gate passes, report only offline readiness. Stop before original Task 15 and request the user's authorization per invocation: health 3 → health 10 → existing-account resume 3 → fresh 1 → fresh 3 → fresh 5 → fresh 10. A failed stage blocks later stages. No mailbox approval is inferred from this continuation plan.

## Completion checklist

- [ ] The real helper bypass reproduction no longer permits B input while A holds foreground.
- [ ] Claim timeout preserves proof/checkpoint and triggers exactly one old-profile stop before at most one replacement.
- [ ] No UI completion path accepts absent/stale verification; Claim watermark is included.
- [ ] Corrected stress tests observe actual lanes, all declared faults and terminal resources.
- [ ] Both providers enforce atomic budgets, ambiguity and redacted counters end-to-end.
- [ ] Production factory writes complete truthful artifacts; schema/string/callback failures cannot silently claim a passing run.
- [ ] Actual controller uses parser, fake dry-run has zero side effects, health IPC exists, and exact-run validator rejects missing/invalid evidence.
- [ ] Required offline test/build/native/fixture gates and independent reviews are recorded green on a stable revision.
- [ ] No claim of live 12/12 or 10-worker success is made before separate authorized live evidence.
