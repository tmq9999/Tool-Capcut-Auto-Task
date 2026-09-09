# Headless Three-Worker Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` task-by-task.

**Goal:** Make three-worker headless runs safe to execute live: never exceed the requested mailbox cap, preserve task evidence, fail fast on renderer/CDP failure, and produce enough diagnostics to distinguish account task absence from browser resource failure.

**Architecture:** Treat acquisition, browser health, mission execution, and persistence as separate gates. A run with `mailLimit=N` reserves exactly N acquisition slots before any provider call; each worker owns one profile and one reservation. API-v3 performs a bounded renderer health probe before the account is accepted for missions. Renderer timeout is a typed account failure with complete cleanup, not a retry loop.

**Tech Stack:** TypeScript 5.8, Zod, Electron, Playwright Core 1.62, Vitest, SQLite/better-sqlite3, Multilogin API-v3, Gmail94.

**Spec:** `docs/superpowers/specs/2026-09-05-continuous-automation-performance-design.md` plus the live findings from the 2026-09-06 three-worker headless run.

## Global Constraints

- `mailLimit = 0` preserves unlimited API/custom-source behavior; positive values cap total acquisitions and purchases.
- A positive `mailLimit` never purchases or reserves more than that number, including retries, concurrent calls, or worker refills.
- Headless uses `api-v3`; `xcli + headless` is blocked before source preflight or any billable operation.
- A profile is not accepted for mission work until bounded CDP/renderer health checks pass.
- `DOM_READ_TIMEOUT` and renderer crash/transport errors end only the affected account, release its profile/proxy/reservation, and never replay the same UI action blindly.
- Every successful task row must be confirmed by CapCut `task_status=4`; `do_action` proof is retained as evidence but does not override a fresh missing snapshot.
- No live purchase is allowed without `VERIFY_GMAIL94_BUY=1`; no live run occurs until all local gates pass.

---

### Task 1: Stabilize and verify mail-limit semantics

**Files:**
- Modify: `src/main/services/AutomationWorkSource.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/shared/schemas/automation.schema.ts`
- Modify: `src/shared/schemas/settings.schema.ts`
- Modify: `src/renderer/pages/Dashboard/automationConfig.ts`
- Modify: `src/renderer/pages/Dashboard/AutomationConfigGrid.tsx`
- Test: `src/main/services/__tests__/AutomationWorkSource.test.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`

**Interfaces:**
- `AutomationRunConfigDTO.mailLimit?: number` where absent/zero means unlimited.
- `AutomationWorkSource.prepare()` receives `min(threadCount, mailLimit)` for positive limits.
- `ContinuousEmailWorkSource.next()` reserves a slot synchronously before awaiting the provider.

- [ ] Add a failing concurrency test that calls `next()` six times concurrently with `mailLimit: 3` and expects three items, three provider acquisition calls, and no fourth call.
- [ ] Add a failing test that a failed acquisition still consumes its reserved limit slot and does not trigger a replacement purchase.
- [ ] Add a failing service test that three accepted workers end with `MAIL_LIMIT_REACHED`, `workersActive=0`, and no refill worker.
- [ ] Add a failing Dashboard round-trip test for `mailLimit: 3` and backward-compatible missing/zero values.
- [ ] Implement slot reservation, worker target clamping, and terminal reason with minimal changes.
- [ ] Run focused work-source/service/renderer tests and verify the provider fake sees exactly three acquisitions.

### Task 2: Make Gmail94 purchase attempts idempotent and auditable

**Files:**
- Modify: `src/main/services/EmailPurchaseService.ts`
- Modify: `src/main/providers/Gmail94Provider.ts`
- Modify: `src/main/repositories/PurchasedEmailRepository.ts`
- Create/modify: `src/main/database/migrations/006_purchase_attempts.ts`
- Test: `src/main/services/__tests__/EmailPurchaseService.test.ts`
- Test: `src/main/providers/__tests__/Gmail94Provider.test.ts`
- Test: `src/main/repositories/__tests__/purchasedEmailRepository.test.ts`

**Interfaces:**
- Add a run/worker purchase-attempt record with provider, service, reservation id, attempt number, request time, safe HTTP status, and terminal classification.
- Never retry an order after a response-ambiguous transport failure unless the provider exposes a safe idempotency key or the operator explicitly permits it.

- [ ] Add a failing test for a transport failure after provider acceptance: no second order is sent automatically and the run ends with a typed purchase-ambiguous block.
- [ ] Add a failing test that transient pre-request failures still use bounded retry without exceeding `mailLimit`.
- [ ] Add a failing test that all persisted attempt diagnostics exclude API keys, order payloads, and mailbox secrets.
- [ ] Implement migration/repository writes inside the existing purchase critical section.
- [ ] Update terminal code/schema/UI copy for purchase ambiguity and retry exhaustion.
- [ ] Run migration, repository, provider, and service tests against a temporary SQLite database.

### Task 3: Add API-v3 headless renderer health probe

**Files:**
- Modify: `src/main/services/capcut/launcher/ApiV3Launcher.ts`
- Modify: `src/main/services/capcut/launcher/BrowserLauncher.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Create: `src/main/services/capcut/rendererHealth.ts`
- Test: `src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts`
- Test: `src/main/services/capcut/__tests__/rendererHealth.test.ts`

**Interfaces:**
- `checkRendererHealth(page, { signal, timeoutMs, headless, log }): Promise<RendererHealth>`.
- Health checks: bounded `Runtime.evaluate` equivalent, viewport/devicePixelRatio read, one bounded `getBoundingClientRect`, and one bounded mouse move on a neutral page point.
- Health failure returns a sanitized reason with `stage`, `elapsedMs`, and profile id; it never leaks CDP URLs or tokens.

- [ ] Add failing tests for responsive health, hung evaluation, hung mouse move, aborted probe, and invalid viewport.
- [ ] Add a failing launcher test that a failed probe stops the exact profile before returning an error.
- [ ] Implement the probe immediately after CDP attach and before publishing “Session sẵn sàng”.
- [ ] Log health timings per profile and mark the account failed before mission acquisition if the probe fails.
- [ ] Run launcher/runtime tests with fake pages; do not require a live provider call.

### Task 4: Separate headless startup scheduling from per-account work

**Files:**
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/main/services/__tests__/AutomationRunService.test.ts`
- Modify: `scripts/live-capcut-run.mjs`

**Interfaces:**
- Stagger only the first profile launch per worker; subsequent worker refills do not incur the startup delay.
- Default headless stagger is 4 seconds per worker index and is cancellation-aware.
- Harness prints `mailLimit`, launcher, headless mode, and worker startup timestamps.

- [ ] Fix the existing failing test caused by applying the stagger on every worker iteration.
- [ ] Add a test proving worker 2/3 delay only before their first launch and zero delay on refills.
- [ ] Add a test proving Stop cancels a worker during stagger without acquiring another proxy/mailbox.
- [ ] Implement a per-worker `firstLaunchPending` flag rather than a loop-global delay.
- [ ] Run the full AutomationRunService suite and inspect timing output.

### Task 5: Preserve partial task progress on renderer failure

**Files:**
- Modify: `src/main/services/capcut/missionRunner.ts`
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/repositories/AccountTaskRepository.ts`
- Test: `src/main/services/capcut/__tests__/missionRunner.test.ts`
- Test: `src/main/services/__tests__/automationTaskProgress.test.ts`

**Interfaces:**
- A group result may contain verified outcomes before a later renderer failure.
- `DOM_READ_TIMEOUT:<stage>` remains attached to the account error while already-verified task rows are persisted in the same transaction.
- A stale/missing snapshot never changes an unconfirmed task to status 4.

- [ ] Add a failing group test where PWA proof is verified, canvas renderer times out, and PWA progress remains persisted.
- [ ] Add a failing test that stale proof retains `opId/provedAt` but status remains open until a fresh task snapshot confirms it.
- [ ] Implement partial-result propagation instead of throwing away the group result on renderer failure.
- [ ] Verify account outcome remains `error` after profile cleanup and failure counter increments exactly once.

### Task 6: Diagnostics and live-run gates

**Files:**
- Modify: `scripts/live-capcut-run.mjs`
- Modify: `scripts/live-capcut-options.mjs`
- Test: `scripts/__tests__/live-capcut-options.test.mjs`
- Create: `docs/superpowers/reports/2026-09-06-headless-three-worker-live.md`

- [ ] Add `--health-only` mode that launches no mailbox and runs only API-v3 profile/CDP/renderer health checks.
- [ ] Add explicit `--mail-limit=N` validation and assert the IPC config echoes the same limit.
- [ ] Fail the harness if `accountsAccepted > mailLimit` or if any purchase/acquisition log exceeds the limit.
- [ ] Record per-worker profile id, proxy, mail redacted id, health result, task bootstrap result, mission timings, terminal reason, and cleanup result.
- [ ] Run no-billable gates: typecheck, lint, build, selectors, focused tests, Electron harness, and `--health-only` with safe credentials only.
- [ ] Only after all gates pass, run live in this order: `--health-only`, one headless worker, two headless workers, then three workers with `--mail-limit=3`.
- [ ] Stop immediately on the first new renderer failure and preserve the report; do not buy a fourth mailbox.

## Live Readiness Criteria

Live 3-worker testing is allowed only when:

1. All local gates pass with zero failures.
2. Health-only API-v3 probe passes for three profiles without task/mail purchase.
3. One-worker headless completes one account with 12/12 or the account’s actual task total.
4. Two-worker headless completes without `DOM_READ_TIMEOUT` and without over-limit acquisition.
5. The three-worker command uses `mailLimit=3`, and logs prove exactly three acquisitions.
6. Every profile and proxy is cleaned up, regardless of account outcome.
