# Runtime Stop, Bootstrap, and Mission Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stop reliable and remove the measured multi-minute waits before CapCut missions.

**Architecture:** Add abort-aware browser launcher ownership, then bound task bootstrap/popover work with one deadline and isolate cleanup from mission action. Keep the existing renderer → preload → IPC → service boundaries and preserve CapCut evidence/human-behavior rules.

**Tech Stack:** Electron 35, TypeScript 5.8 strict mode, Playwright Core 1.62, React 19, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-05-runtime-stop-bootstrap-design.md`

## Global Constraints

- Do not perform billable email purchases without explicit approval and `VERIFY_GMAIL94_BUY=1` or the provider-specific opt-in.
- Do not remove CapCut human jitter, `assertHittable`, `assertNotInert`, `waitEnabled`, or evidence-backed `do_action`/`task_status` checks.
- Do not add vendor stop-all; Stop operates only on profiles owned by the current run.
- Renderer remains isolated and accesses main only through the typed preload/IPC contract.
- Use `apply_patch` for edits and do not commit or push without explicit authorization.

---

### Task 1: Abort-aware launcher ownership

**Files:**
- Modify: `src/main/services/capcut/launcher/BrowserLauncher.ts`
- Modify: `src/main/services/capcut/launcher/XcliLauncher.ts`
- Modify: `src/main/services/capcut/launcher/ApiV3Launcher.ts`
- Modify: `src/main/services/AutomationRunService.ts`
- Test: `src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts`
- Test: `src/main/services/capcut/launcher/__tests__/XcliLauncher.test.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`

**Interfaces:**
- `BrowserLauncher.launch(opts: LaunchOptions & { signal?: AbortSignal }): Promise<LaunchedProfile>`.
- `connectOverCdpWithRetry(port, { signal })` aborts pending retries.
- Launcher exposes a typed stop failure that the service includes in cleanup diagnostics.

- [ ] Write a failing test for aborting CDP retry before the next retry sleep.
- [ ] Run the focused launcher test and confirm it fails because the current retry loop ignores signals.
- [ ] Write a failing test for Stop while profile id exists but CDP attach is pending.
- [ ] Run the focused service test and confirm the profile is not currently owned in the old implementation.
- [ ] Add the signal-aware delay and retry race, registering profile ownership immediately after start returns.
- [ ] Make xcli/API-v3 launch pass the signal through start/poll/attach and stop a pending profile on abort.
- [ ] Keep launcher ownership until `stop()` settles and surface stop failures to the service.
- [ ] Run launcher and service focused tests; verify the new tests pass.

### Task 2: Stop state and renderer feedback

**Files:**
- Modify: `src/main/services/AutomationRunService.ts`
- Modify: `src/renderer/pages/Dashboard/dashboardController.ts`
- Modify: `src/renderer/pages/Dashboard/DashboardPage.tsx`
- Test: `src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts`
- Test: `src/main/services/__tests__/AutomationRunService.test.ts`

**Interfaces:**
- `stop()` is idempotent and returns only after worker/resource teardown settles.
- Dashboard exposes a `stopping` state and does not submit duplicate Stop calls.

- [ ] Write a failing test for a second Stop call sharing the first teardown promise.
- [ ] Run the focused tests and confirm duplicate teardown is observable.
- [ ] Implement a run-scoped `stopPromise` and publish `stopping` before aborting waits.
- [ ] Refresh running threads/accounts after stop settles and preserve terminal reason.
- [ ] Run focused service and renderer tests; verify no duplicate stop request is sent.

### Task 3: Bounded task bootstrap

**Files:**
- Modify: `src/main/services/capcut/runTasks.ts`
- Modify: `src/main/services/capcut/missionRunner.ts`
- Test: `src/main/services/capcut/__tests__/runTasks.test.ts`
- Test: `src/main/services/capcut/__tests__/missionRunner.test.ts`

**Interfaces:**
- `bootstrap` and popover activation accept one explicit deadline and an `AbortSignal`.
- `withTaskPopover` separates open/action/close timing and never reloads in a mission `finally`.

- [ ] Write a failing timing test proving candidate retries cannot exceed one bootstrap deadline.
- [ ] Run it and capture the old multiplied wait behavior.
- [ ] Implement deadline-based candidate probing and task-route-first bootstrap.
- [ ] Remove reload from popover `finally`; keep cancellation-aware best-effort close at the boundary.
- [ ] Run focused runTasks/missionRunner tests and inspect timing logs.

### Task 4: Overlay and PWA/notification action correctness

**Files:**
- Modify: `src/main/services/capcut/overlays.ts`
- Modify: `src/main/services/capcut/missions/simple.ts`
- Modify: `src/main/services/capcut/missions/designStudio.ts`
- Test: `src/main/services/capcut/__tests__/simple.test.ts`
- Test: `src/main/services/capcut/__tests__/missionRunner.test.ts`
- Test: `src/main/services/capcut/__tests__/runTasks.test.ts`

- [ ] Write a failing test showing `ensurePageUsable(false)` currently allows a mission to continue.
- [ ] Run it and confirm covered-click behavior is possible in the old path.
- [ ] Make blocking overlays throw a sanitized `StepError` after evidence dump.
- [ ] Trigger PWA deferred prompt immediately after Go and keep proof reconciliation separate from close cleanup.
- [ ] Ensure notification action uses one page activation attempt and respects cancellation.
- [ ] Run focused mission tests and the selector gate.

### Task 5: Live verification per slice and final gates

**Files:**
- Modify only if live evidence requires it: `scripts/live-capcut-run.mjs`, `scripts/live-capcut-options.mjs`
- Create: `docs/superpowers/reports/2026-09-05-runtime-stop-bootstrap-verification.md`

- [ ] Run `npm run typecheck`, `npm run lint`, focused Vitest tests, and `npm run selectors`.
- [ ] Build and start the Electron app with a non-billable/manual or already-owned test input.
- [ ] Live verify Stop during preparing/CDP attach and record IPC state transitions plus actual Multilogin profile state.
- [ ] Live verify one PWA and one notification action, recording stage timestamps and proof/snapshot responses.
- [ ] Run `npm run build` and `npm run test:electron` after Node tests have completed.
- [ ] Write the verification report with passed, failed, skipped, blocked, and unverified checks.
