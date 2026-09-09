# Headed UI continuation — implementation and offline verification

**Date:** 2026-09-08, Asia/Bangkok.
**Base:** `c5de54974633c666efb021214aa51c8747c5fb47` plus preserved Antigravity working changes.
**Scope:** User-authorized in-place implementation on `master`, with disjoint sub-agent ownership. No commit, push, real CapCut account run, health profile, provider operation or mailbox purchase.

## Implemented

- Required UI facade/signal propagation across focus, auth typing, overlays, popovers, Claim and missions. Bounded focus and typed timeouts remain fatal; no input cleanup on a quarantined session.
- Exact receipt rows/freshness, Claim settlement watermark, separate skipped UI accounting, awaited checkpoint before one same-account session recycle. HTTP-only keeps its explicit completion path.
- Run-scoped foreground/editor capacity one; quarantined lane ownership retained until exact stop; session IDs remain unique when a worker processes another account. Failed stops cannot automatically retry.
- Separate same-run unsettled-proof persistence in additive migration **007**, keeping receipt membership/status exact. Migration006 remains unchanged; migration, rollback and cascade tests cover the addition.
- Explicit purchase budget for both Gmail94/DongVan, atomic accounting at dispatch, immutable counters/events, no ambiguous retry or refund. Dashboard exposes a separate new-purchase budget with safe default zero (reuse-only).
- Production runtime evidence wiring, strict anonymous lifecycle/resource/task/purchase schemas, exclusive per-run JSONL, one terminal writer and redacted labels/errors.
- Dedicated no-account health IPC, exact artifact identity, userData-before-storage and child ownership handshake. Health/live execution remains separately authorized.
- Injectable fail-closed rollout controller and exact-run validator; child-only flags, unique debug port, bounded deadline/Stop/teardown, confirmed process exit. All documented command forms match the parser.
- Selector fixtures are served from memory behind deny-by-default routing and CSP preventing captured scripts/external resources.

## Verification record

| Gate | Observed result |
|---|---|
| Initial full Vitest baseline | 1,281 passed / 10 failed; all failures were missing billable budget implementation. |
| Final full suite at 09:48 after the two integration fixes | **135 files / 1,498 tests passed**; source hashes unchanged across verification. |
| Rebuilt-Node gate at 09:40 before the final two source fixes | 135 files / 1,496 tests passed; native ABI remains Node after the final full suite. |
| Deterministic service schedules | **2,400 seeded runs**: 400 success, 800 global/per-thread cancellation, 1,200 recovery-failure; counts 1/3/5/10 with 100 seeds per scenario/count. Success cases require completed=count and failed/stopped=0. |
| TypeScript and ESLint at 09:48 | Both exit0 on final integrated source; no lint warnings. |
| Final build at 09:49 | Exit0 after the integration fixes; renderer/main/preload artifacts rebuilt. |
| Build and Electron harness at 09:39 | Exit0; native SQLite, safeStorage sentinel and preload isolation pass with hidden local data-URL window/fake IPC. |
| Selector fixtures | **89 passed / 0 failed** at 09:41. |
| Synthetic actual Chrome fixture isolation | Script did not execute; loopback server received **0 requests**. |
| Native ABI after Electron | Node ABI137 restored; in-memory SQLite `SELECT 1` succeeds. |
| CLI docs | 11 documented invocation forms parsed offline; no external calls. |

These are offline results, not a new live 12/12 result. The last known pre-implementation live evidence remains 0/3 complete, all at 6/12. No fresh 3/5/10-worker live acceptance is claimed.

## Final review status

Task-scoped reviews covered UI, receipts, provider budget, controller/validator and service integration. Their fixes included regression tests before code changes. The final integration review identified two additional edge cases: persistent recorder failure must not erase account counters, and valid no-action resume may have a session watermark before profile publication. Both were fixed with RED/GREEN regressions. The final scoped reviewer confirmed both **ADDRESSED**, found no new blocking breakage, and independently ran 49/49 focused tests at09:51.

**Offline implementation and verification are complete.** All399 source/config/script/tool hashes stayed unchanged across the final full tests, typecheck/lint/build and review. This is not permission or proof for a live 12/12 run.

## Environment notes

- Plain `npm run test:node` encountered npm11.17 `EALLOWSCRIPTS` from the machine's existing user configuration (`allow-scripts=9router`). Verification used `npm --userconfig=NUL run test:node` only for that process; no global/user `.npmrc` was changed.
- npm emitted an advisory for five installed packages with scripts not covered by allowScripts. No new dependency was installed. Build emitted the existing renderer chunk-size warning (about535kB, threshold500kB); compilation completed.
- The Git index was externally staged at08:28 while HEAD remained unchanged. Our agents did not stage, unstage, commit, reset or discard that index. Reviews compare against preserved pre-edit filesystem copies.

## Decisions recorded during implementation

1. Work in the existing checkout after explicit permission; retain baseline copies. Cost: changes require in-place review, not an isolated branch merge.
2. Parallelize only disjoint UI/provider/script work and reserve shared service/contracts for one owner. Cost: integration is serialized where ownership overlaps.
3. Keep this work uncommitted and retain local review artifacts. Cost: scratch remains until separately approved cleanup.
4. Treat the implementation approval as superseding the plan's earlier audit-only wording; preserve all live/purchase restrictions. Cost: offline code changes only.
5. If an attempted-event observer fails before dispatch, spend nothing and poison the acquisition session; never refund a dispatched attempt. Cost: that run fails closed.
6. Exclude only `.superpowers/sdd/**` scratch from ESLint so saved old source does not pollute checks. Cost: scratch copies are not linted; application/tests remain included.
7. Require a unique child port and nonce handshake. Cost: old/mismatched app sessions are rejected instead of being controlled.
8. Add migration007 for omitted-key same-run proofs rather than invent task status rows. Cost: one additive database migration, verified with existing receipt data preserved.

## Handoff boundary

After the final offline review/gates pass, stop before live rollout. Each live invocation requires separate permission: health3 → health10 → resume the existing3 accounts → fresh1 → fresh3 → fresh5 → fresh10. A failure blocks later stages. No mailbox approval is implied by implementation or green tests.

**No live CapCut run or mailbox purchase was performed.**

## Changed-file inventory

Compared with the preserved pre-implementation working files, not bare HEAD or the externally changed index. No baseline file was deleted. Documentation-only updates are the runbook, original command examples, audit/result reports and local SDD ledger.

<details>
<summary>Modified existing source/config/test files (75)</summary>

- `eslint.config.js`
- `scripts/__tests__/live-capcut-options.test.mjs`
- `scripts/live-capcut-options.mjs`
- `scripts/live-capcut-run.mjs`
- `src/main/__tests__/rolloutUserData.test.ts`
- `src/main/database/__tests__/migrator.test.ts`
- `src/main/database/__tests__/transaction.test.ts`
- `src/main/database/migrations/index.ts`
- `src/main/ipc/__tests__/runtimeIpc.test.ts`
- `src/main/ipc/__tests__/settingsIpc.test.ts`
- `src/main/ipc/automationIpc.ts`
- `src/main/repositories/AccountTaskRepository.ts`
- `src/main/repositories/__tests__/accountTaskRepository.test.ts`
- `src/main/repositories/__tests__/repositories.test.ts`
- `src/main/rolloutUserData.ts`
- `src/main/runtime/providerStack.ts`
- `src/main/services/AutomationRunService.ts`
- `src/main/services/AutomationWorkSource.ts`
- `src/main/services/CapcutEngineService.ts`
- `src/main/services/EmailPurchaseService.ts`
- `src/main/services/__tests__/AutomationRunService.test.ts`
- `src/main/services/__tests__/AutomationWorkSource.test.ts`
- `src/main/services/__tests__/CapcutEngineService.test.ts`
- `src/main/services/__tests__/EmailPurchaseService.test.ts`
- `src/main/services/__tests__/SettingsService.test.ts`
- `src/main/services/__tests__/automationTaskProgress.test.ts`
- `src/main/services/__tests__/capcutSignupPath.test.ts`
- `src/main/services/__tests__/fixtures/deterministicRunHarness.ts`
- `src/main/services/__tests__/proxyQueueIntegration.test.ts`
- `src/main/services/capcut/__tests__/auth.test.ts`
- `src/main/services/capcut/__tests__/bootstrap.test.ts`
- `src/main/services/capcut/__tests__/boundedInteractions.test.ts`
- `src/main/services/capcut/__tests__/claimReconciliation.test.ts`
- `src/main/services/capcut/__tests__/overlayGuard.test.ts`
- `src/main/services/capcut/__tests__/popoverLifecycle.test.ts`
- `src/main/services/capcut/__tests__/rendererHealth.test.ts`
- `src/main/services/capcut/__tests__/runTasks.test.ts`
- `src/main/services/capcut/__tests__/runTelemetry.test.ts`
- `src/main/services/capcut/__tests__/simpleActions.test.ts`
- `src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts`
- `src/main/services/capcut/auth.ts`
- `src/main/services/capcut/http/discoverCanvasRequest.ts`
- `src/main/services/capcut/human.ts`
- `src/main/services/capcut/launcher/ApiV3Launcher.ts`
- `src/main/services/capcut/launcher/BrowserLauncher.ts`
- `src/main/services/capcut/launcher/XcliLauncher.ts`
- `src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts`
- `src/main/services/capcut/login.ts`
- `src/main/services/capcut/missionRunner.ts`
- `src/main/services/capcut/missions/designStudio.ts`
- `src/main/services/capcut/missions/simple.ts`
- `src/main/services/capcut/missions/videoStudio.ts`
- `src/main/services/capcut/overlays.ts`
- `src/main/services/capcut/rendererHealth.ts`
- `src/main/services/capcut/runTasks.ts`
- `src/main/services/capcut/runTelemetry.ts`
- `src/main/services/capcut/signup.ts`
- `src/main/services/capcut/steps.ts`
- `src/main/services/capcut/trial.ts`
- `src/main/services/capcut/types.ts`
- `src/main/services/capcut/uiInteractionScheduler.ts`
- `src/preload/__tests__/preload.test.ts`
- `src/preload/preload.ts`
- `src/renderer/pages/Dashboard/AutomationConfigGrid.tsx`
- `src/renderer/pages/Dashboard/__tests__/automationConfig.test.ts`
- `src/renderer/pages/Dashboard/automationConfig.ts`
- `src/shared/contracts/__tests__/contracts.test.ts`
- `src/shared/contracts/api.ts`
- `src/shared/contracts/ipc-channels.ts`
- `src/shared/schemas/__tests__/automation.schema.test.ts`
- `src/shared/schemas/automation-evidence.schema.ts`
- `src/shared/schemas/automation.schema.ts`
- `src/shared/schemas/settings.schema.ts`
- `src/shared/settings/default-settings.ts`
- `tools/verify-selectors.ts`

</details>

<details>
<summary>New source/test/tool files (18)</summary>

- `scripts/__tests__/live-capcut-run.test.mjs`
- `scripts/__tests__/offline-fixture.test.ts`
- `scripts/__tests__/verify-rollout-evidence.test.mjs`
- `scripts/verify-rollout-evidence.mjs`
- `src/main/__tests__/rolloutBootstrapOrder.test.ts`
- `src/main/database/migrations/007_account_unsettled_proofs.ts`
- `src/main/ipc/__tests__/rolloutIpc.test.ts`
- `src/main/runtime/__tests__/rolloutTelemetryWiring.test.ts`
- `src/main/services/__tests__/healthRun.test.ts`
- `src/main/services/__tests__/purchaseBudgetWiring.test.ts`
- `src/main/services/__tests__/rolloutRunIntegration.test.ts`
- `src/main/services/capcut/__tests__/runTelemetryBoundary.test.ts`
- `src/main/services/capcut/__tests__/uiQuarantineOwnership.test.ts`
- `src/main/services/capcut/__tests__/verifiedTyping.test.ts`
- `src/renderer/pages/Dashboard/__tests__/purchaseBudgetConfig.test.ts`
- `src/shared/schemas/__tests__/rollout.schema.test.ts`
- `src/shared/schemas/__tests__/rolloutEvidenceBoundary.test.ts`
- `tools/offlineFixture.ts`

</details>
