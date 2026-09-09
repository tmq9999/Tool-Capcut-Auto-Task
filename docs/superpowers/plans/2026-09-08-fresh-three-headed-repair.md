# Fresh Three-Worker Headed Reliability Repair Plan

> **Superseded by user correction:** do not execute this plan wholesale. The user rejected added architecture/diagnostic layers and old-account resume as acceptance. The approved narrow repair changed only bootstrap recovery/error handling and opt-in verified-caret canvas typing; see the latest note in the linked report. Tasks 3/4 and Task 5's resume acceptance were not executed. Final acceptance must start three **new** accounts and finish all 12 tasks each; do not spend beyond a newly approved purchase cap.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair confirmed unsafe error boundaries, test a narrow canvas-input mitigation, identify the missing-task-response cause, and revalidate the same three purchased accounts without additional purchases.

**Architecture:** Preserve `AutomationRunService` ownership of workers, budgets, cancellation, recovery, and cleanup. Keep the real UI mission engine and strict proof/snapshot receipts. Change only demonstrated error boundaries; gate the canvas mitigation and bootstrap behavioral changes on observations rather than extending timeouts or replacing the scheduler.

**Tech Stack:** Windows Electron, TypeScript, Playwright Core 1.62.1, Vitest 4.1.6, SQLite.

**Spec:** User request for headed three-worker testing with three new emails; [the exact live report](../reports/2026-09-08-fresh-three-headed-result.md) supplies observed failures and acceptance requirements.

**Approval status:** Proposed, not implemented. Superpowers brainstorming classifies this as changes to existing bounded flows. The user explicitly requested a written repair plan, so this document supplements the in-chat design. Obtain approval before source/test edits or another live invocation.

## Global Constraints

- Preserve the dirty worktree and Git index. No reset, stash, staging, commit, branch integration, or unrelated refactor.
- Use strict TypeScript, two-space indentation, single quotes, and semicolons.
- Run typecheck and lint before committing. Keep raw SQL in repositories.
- Add regression tests before behavior fixes.
- CapCut missions must prove success through `do_action` evidence plus a fresh task snapshot; do not mark tasks complete from UI state alone.
- Preserve human-pace jitter, hit-target guards, cancellation, and evidence-based proof rules when changing missions.
- This request's purchase budget is already exhausted: attempted=3, confirmed=3, ambiguous=0. All further work is offline or same-account resume with purchase budget **0**.
- Do not use the unrelated previously throttled account, buy replacement email, change identity/proxy to evade rate limits, or advance to 5/10 workers.
- Do not increase bootstrap, browser-input, login, or outer-run timeouts as a substitute for diagnosis.
- Do not weaken the independent validator or recategorize the failed live artifact as successful.
- Context7 was unavailable in this session. Before introducing new library-specific calls, fetch current Playwright documentation through Context7 when available; otherwise verify the installed declarations and behavior explicitly.

## Completed evidence work

- [x] Run exactly one isolated fresh-account invocation with all caps equal to 3.
- [x] Confirm 3 purchases, 1 completed account, 2 failed accounts, 4/4 stopped profiles, zero final resources.
- [x] Run independent exact-artifact validation: `UNSAFE_EVENT`, failed gate.
- [x] Restore Node SQLite ABI; verify original account/mail row fingerprints unchanged.
- [x] Fresh full suite 1,524 tests, typecheck, lint, and pre-live build passed.
- [x] Independently reproduce cleanup shutdown-code mismatch with real classes.

## Implementation sequence and ownership

Tasks 1 and 4 are independent confirmed defects and may be implemented/reviewed concurrently. Task 2 owns only the canvas-specific helper and its tests. Task 3 owns monitoring diagnostics and does not change task acceptance. Root owns integration, native ABI changes, and every live invocation. Never run a native rebuild while another agent is using SQLite.

### Task 1: Preserve fatal bootstrap errors before fallback navigation

**Files:**

- Modify: `src/main/services/capcut/runTasks.ts`, bootstrap's `withTaskPopover` catch.
- Test: `src/main/services/capcut/__tests__/bootstrap.test.ts`.

**Interfaces:** Keep `runAllTasks(input: RunTasksInput): Promise<RunTasksResult>` unchanged. Propagate the original `DOM_READ_TIMEOUT` instance/code and cancellation reason; no post-timeout reload, dump, retry, or mission input.

- [ ] Add this regression to the existing bootstrap test fixture, importing `DomReadTimeoutError` from `../cancellation`:

```ts
it('does not reload a quarantined session after a popover timeout', async () => {
  vi.useFakeTimers();
  const timeout = new DomReadTimeoutError('popover:entry-click:focus');
  const page = {
    goto: vi.fn(async () => {}),
    reload: vi.fn(async () => {})
  } as unknown as Page;
  vi.mocked(withTaskPopover).mockRejectedValueOnce(timeout);
  const result = runAllTasks(env(page)).catch(error => error);
  await vi.runAllTimersAsync();
  expect(await result).toBe(timeout);
  expect(page.goto).toHaveBeenCalledTimes(1);
  expect(page.reload).not.toHaveBeenCalled();
});
```

- [ ] Run `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/bootstrap.test.ts`. Observe the expected RED: current code swallows the fatal error and attempts fallback/reports a generic bootstrap failure.
- [ ] Change only that catch boundary, using the existing `isDomReadTimeout` import:

```ts
}).catch((error: unknown) => {
  input.signal.throwIfAborted();
  if (isDomReadTimeout(error)) throw error;
});
```

- [ ] Add the same rejection case for a code-shaped error from another realm. Preserve the existing ordinary missing-response fallback and deadline tests.
- [ ] Run bootstrap, popover lifecycle, quarantine ownership, and `CapcutEngineService` tests. Require no additional navigation/input after the fatal rejection. Review this as an error-boundary repair, not a claim to solve the observed no-response incident.

### Task 2: Test a canvas-only verified-focus typing path

**Files:**

- Modify: `src/main/services/capcut/missions/designStudio.ts`.
- Create: `src/main/services/capcut/__tests__/canvasPromptTyping.test.ts`.
- Modify: `src/main/services/capcut/__tests__/canvasFlowTimeout.test.ts` only for the new real call boundary.

**Interfaces:** Proposed export:

```ts
export function typeCanvasPrompt(
  page: Page,
  text: string,
  env: Pick<CapcutMissionEnv, 'signal' | 'ui' | 'log' | 'pace'>
): Promise<void>;
```

The existing generic `humanType`, `humanClick`, signup, login, video typing, and canvas Send behavior stay unchanged. The helper must not clear the uploaded-image attachment, synthesize DOM input events, insert text through JavaScript, or invoke an HTTP mutation.

- [ ] First verify the focus assumption with an offline minimal contenteditable fixture and a bounded read-only observation in the next authorized healthy live canvas session. Record only `expanded`, `editorCount`, `contentEditable`, `inert`, and `focused` booleans/counts; no DOM text, credentials, screenshots, or cookies. A successful Tab call alone does not prove the editor has focus.
- [ ] Gate: adopt no-pointer typing only when the exact unique expanded editor is focused. If the observation fails, keep the candidate unaccepted and revisit the design; do not silently replace this with arbitrary focus or click fallback.
- [ ] Write RED cases exercising the new helper and the real `RunUiInteractionScheduler`. A success fixture uses a unique `.tiptap.ProseMirror[contenteditable="true"]`, records keyboard text and foreground ownership, and throws if any mouse method is called. Verify the emitted text equals a literal `hello`, all per-character delays respect the configured floor, and all input stays inside one lease.
- [ ] Implement the exact target predicate inside `foregroundPage`, before typing, with a bounded read:

```ts
const selector = `${CANVAS_EXPANDED} .tiptap.ProseMirror[contenteditable="true"]`;
const editor = page.locator(selector);
const focused = await boundedDomRead(() => editor.evaluateAll(elements => {
  if (elements.length !== 1) return false;
  const element = elements[0] as HTMLElement;
  if (!element.isContentEditable || element.closest('[inert], [aria-hidden="true"]')) return false;
  const active = document.activeElement;
  return active === element || (active !== null && element.contains(active));
}), 'canvas-prompt:focused-editor', 1000, env.signal);
if (!focused) throw new StepError('Canvas prompt editor is not uniquely focused.');
```

- [ ] Within the same lease, use the existing `perCharDelayRange`, `rand`, `abortableDelay`, and `boundedDomRead` primitives for keyboard input. Import `perCharDelayRange` from `../human`. Preserve 150–350ms pre-typing pause, 45–130ms minimum per-character range (slower configured values still apply), 8% 200–500ms think pauses, and 250–600ms post-pause:

```ts
const { minMs, maxMs } = perCharDelayRange(env.pace && {
  minMs: env.pace.typeMinMs,
  maxMs: env.pace.typeMaxMs
});
await abortableDelay(rand(150, 350), env.signal);
for (const character of text) {
  const delay = rand(minMs, maxMs);
  await boundedDomRead(
    () => page.keyboard.type(character, { delay }),
    'canvas-prompt:type', delay + 5000, env.signal
  );
  if (Math.random() < 0.08) await abortableDelay(rand(200, 500), env.signal);
}
await abortableDelay(rand(250, 600), env.signal);
```

- [ ] Keep the existing scoped non-inert check, prompt readback, Send enabled/hit-target checks, and proof reconciliation. Replace only the canvas prompt `fillEditor(...)` invocation with `typeCanvasPrompt(...)`; do not change Send or area selection speculatively.
- [ ] Test false/ambiguous focus, inert editor, Stop before/during typing, and a pending keyboard promise. On timeout require zero subsequent keys/pointer calls and retain scheduler quarantine until exact profile-stop confirmation. A queued second worker must not start early.
- [ ] Run the new tests plus `canvasFlowTimeout`, `canvasPromptActivation`, `canvasPromptReady`, `boundedInteractions`, `pace`, and receipt integration. A local browser fixture must exercise actual focus/typing/readback with all external network blocked.
- [ ] Live acceptance is still required. If the next failure moves to area selection or Send, report it as a new observed boundary; do not call this a complete CDP-stall fix or chain unverified pointer replacements.

### Task 3: Distinguish missing, failed, unreadable, and rejected task responses

**Files:**

- Modify: `src/main/services/capcut/taskApi.ts`.
- Modify: `src/main/services/CapcutEngineService.ts` for early diagnostic attachment and disposal only.
- Create: `src/main/services/capcut/__tests__/taskListDiagnostics.test.ts`.
- Modify: `src/main/services/__tests__/CapcutEngineService.test.ts` for observer lifetime.

**Interfaces:** Add a read-only, per-context diagnostic observer without changing `TaskStore`, `attachTaskMonitor`, receipt schemas, or final task acceptance:

```ts
export type TaskListObservation =
  | { kind: 'request' }
  | { kind: 'request-failed' }
  | { kind: 'response'; status: number }
  | { kind: 'body'; readable: boolean; valid: boolean };

export function attachTaskListDiagnostics(
  context: BrowserContext,
  signal: AbortSignal,
  observe: (event: TaskListObservation) => void
): () => void;
```

- [ ] Use controlled EventEmitter-based page/context doubles, as the external network is the only mocked boundary. Emit matching task requests, successful valid response, non-JSON response, unreadable body, and a response with secret query/body values. Assert literal categorical observations and that serialization contains none of the secret values.
- [ ] Write a pending-body test: emit response with a never-settling `text()` promise, abort/dispose, then settle it. Require no late callback, no unhandled rejection, and all request/response/page listeners detached. The observer must never block auth, missions, cancellation, or profile cleanup.
- [ ] Filter URLs internally using `TASK_LIST_PATH`; never publish the URL. Publish only the discriminated fields above. For body parsing use existing `parseTaskList(body) !== null` inside a guarded callback. A diagnostic read timeout does not authorize extra browser input or change task status.
- [ ] Attach before `ensureInApp` in the engine and dispose in its existing `finally`. Emit fixed structured runtime messages, for example:

```ts
log('INFO', 'Task diagnostics', JSON.stringify({ event: 'task-list', ...observation }));
```

- [ ] Test successful auth, auth rejection, cancellation, and engine failure all dispose the observer, including pages added after attachment.
- [ ] In the next authorized same-account run, compare pre-auth, post-auth, and bootstrap observations. If a valid response exists only before the task monitor attaches, reproduce that exact engine ordering in a new failing integration test before proposing a shared early `TaskStore`. If responses are rejected/unreadable or requests never occur, investigate that observed branch instead.
- [ ] Do not solve the evidence gap by accepting pre-auth snapshots as final, replaying intercepted requests, expanding bootstrap duration, assuming a proxy failure, or claiming no `requestfailed` means connectivity is healthy.

### Task 4: Preserve the cleanup-failure shutdown code

**Files:**

- Modify: `src/main/services/AutomationRunService.ts`, `handleStopFailure` only.
- Modify: `src/main/services/__tests__/AutomationRunService.test.ts`, existing failed-stop test.

**Interfaces:** Keep scheduler's documented structural `{ code, message? }` input. `AutomationTerminalError` stays unchanged for worker cancellation and run terminal state.

- [ ] Replace the existing mock scheduler in the failed-profile-stop test with a real `RunUiInteractionScheduler({ onEvent })`. Keep `StubBrowserRuntime.stopProfile` throwing. Assert actual shutdown output, not the passed error's nested shape:

```ts
const schedulerEvents: UiSchedulerEvent[] = [];
session1!.scheduler = new RunUiInteractionScheduler({
  onEvent: event => schedulerEvents.push(event)
});
await (service as unknown as ServiceOwnershipAccessor).stopSession(thread1!, session1!);
expect(schedulerEvents).toContainEqual(expect.objectContaining({
  type: 'shutdown',
  code: 'RESOURCE_CLEANUP_FAILED'
}));
expect((await service.waitForCompletion()).state).toBe('failed');
```

Import `UiSchedulerEvent` from the existing capcut types module. Existing setup for this test already supplies `service`, `thread1`, and `session1`.

- [ ] Run the focused service test and observe RED (`RUN_ABORTED`). The same mismatch was already reproduced without edits using the real classes.
- [ ] Pass the scheduler's supported structural reason in both branches:

```ts
const shutdownReason = { code: 'RESOURCE_CLEANUP_FAILED' as const, message };
if (session.scheduler) {
  session.scheduler.shutdown(shutdownReason);
} else if (this.uiScheduler) {
  this.uiScheduler.shutdown(shutdownReason);
}
```

- [ ] Keep `terminalError` for controller aborts and `acceptTerminalError`. Verify correct code in real recorded evidence and preserve the failed-stop no-retry/ownership tests. Do not claim this fixes the observed live run: cleanup succeeded in that run.

### Task 5: Review, verify, and run the zero-purchase acceptance gate

**Files:** Update the live report with distinct new evidence; retain the failed artifact untouched. Private account-ID files remain outside version control.

- [ ] Review each diff against a saved pre-edit copy of the current worktree, not bare HEAD. Use Superpowers requesting-code-review; root verifies all review claims and RED/GREEN results.
- [ ] Run these commands on final integrated source:

```powershell
npx --userconfig=NUL vitest run
npm --userconfig=NUL run typecheck
npm --userconfig=NUL run lint
npm --userconfig=NUL run build
```

- [ ] After approval, prepare a new isolated SQLite backup of this run's three purchased accounts. Use exactly those three IDs, purchase flags absent, and verify no competing owned run. Do not mutate the original user database or overwrite the failed run's evidence.
- [ ] Before launch, rebuild the native module for Electron. Use the official runner with an exclusively reserved process/result record:

```powershell
npm --userconfig=NUL run rebuild:electron
node --import tsx scripts/live-capcut-run.mjs --mode=resume --stage=3 --threads=3 --headed --minutes=45 --account-ids-file=$approvedAccountIdsFile --user-data-dir=$isolatedUserDataDir
```

`$approvedAccountIdsFile` must be the validated private JSON document `{ accountIds: [id1, id2, id3] }` with three unique stored IDs. `$isolatedUserDataDir` must be the resolved new backup outside the repository. Resolve both from the checked private manifest before execution; never guess paths or insert identifiers into tracked docs. Resume parser/config sets purchase budget zero and strips purchase flags.

- [ ] Stop on explicit server authentication denial/rate limit. Do not repeatedly retry or infer bad passwords from the previous generic recovery failure; no throttle code was captured in this fresh run.
- [ ] Accept only exact-run independent validation with 3 completed terminals, 3 fresh/final exact 12/12 task receipts, zero failed/stopped/skipped accounts, zero purchases, zero unsafe events, zero cleanup failures, confirmed stops, and zero final resources. An account already at 12/12 should authenticate and refresh, not replay completed missions.
- [ ] Restore Node SQLite ABI, confirm in-memory `SELECT 1`, reconcile source fingerprints with the same serializer, verify child processes exited, and record evidence as **resume verification of three purchased accounts**, not a second fresh-account pass.

## Design alternatives considered

1. **Recommended:** narrow focused-canvas typing, confirmed error-boundary fixes, and categorical bootstrap diagnostics. Limits changes and provides a measurable next decision.
2. Modify the global mouse trajectory or serialize every account end-to-end. Rejected for now: exact browser stall cause is unknown, all other UI paths would change, and it would not diagnose the missing task response.
3. Increase timeouts, buy replacement emails, or reduce the proof gate. Rejected: these mask failure, consume more budget, or produce unsupported success claims.

## Exit status

Plan ready for approval. No implementation task above has been executed. Current live result remains **1/3 completed**; reliable three-worker completion is not yet demonstrated.
