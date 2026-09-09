# Targeted repair after the three-account live failure

Date: 2026-09-08. Scope: three production files only; preserve existing checkout/index and do not run accounts/providers or purchase mailboxes.

## Repaired receipt regression

Live account-3 had the final successful video-export proof at08:48:49.584Z, a12/12 task snapshot at08:48:50.263Z, and group UI cleanup completion at08:48:54.423Z. The old group result incorrectly used cleanup completion as the mutation watermark, making the valid post-proof snapshot stale.

`missionRunner.ts` now returns the latest successful do_action proof timestamp as the mutation watermark, bounded below by group start. Group finish remains only the proof-wait timeout origin. `runTasks.ts` still takes the maximum with session/Claim watermarks and now prevents final completion when an attempted mutation lacks a successful proof. Stale pre-proof snapshots, failed/unproven attempts and fatal sessions remain non-final.

The RED regression runs the real runGroup→runAllTasks chain; it failed with the later cleanup watermark. It now accepts the exact live post-proof/pre-cleanup timeline while companion rejection cases remain green.

## Removed unnecessary canvas selection

`designStudio.ts` previously always clicked the graphic editor before locating the prompt opener. Captured DOM shows that the uploaded/selected image can already expose an actionable collapsed prompt. Re-selecting the editor in that state sends an unnecessary23–32 mouse-move sequence through the canvas.

A bounded DOM predicate now skips only that redundant selection when the unique collapsed opener is non-inert, visible through its ancestors, enabled (including CapCut disabled classes), on-screen and the actual hit target. Hidden/off-screen/expanded/occluded/disabled states retain the existing human-paced selection path with a hit-target check. A predicate timeout stays fatal; it never permits fallback input.

This removes a demonstrated unnecessary exposure to the failing command. **It does not establish or repair the underlying Multilogin/CDP stall when a canvas-selection movement is actually required.** No timeout was increased, no same-page retry after timeout restored, and no global input/scheduler/provider architecture changed.

## Verification

- Full Vitest:137 files, **1,517 tests passed**.
- Typecheck and lint: exit0, no lint warnings.
- Build: exit0; existing renderer chunk-size warning remains.
- Actual local headless Chrome:7 fixture-derived readiness states passed with network denied; no CapCut/account/provider accessed.
- Independent scoped review approved receipt logic; one disabled-class guard gap was reproduced RED and fixed GREEN. Re-review:14/14 predicate checks, no remaining scoped finding.

## Changed files this repair

Production:

- `src/main/services/capcut/missionRunner.ts`
- `src/main/services/capcut/runTasks.ts`
- `src/main/services/capcut/missions/designStudio.ts`

Tests:

- `src/main/services/capcut/__tests__/runTasksReceiptIntegration.test.ts` (new)
- `src/main/services/capcut/__tests__/canvasPromptReady.test.ts` (new)
- `src/main/services/capcut/__tests__/canvasFlowTimeout.test.ts`

No commit/index mutation, live rerun, mailbox purchase, database mutation or native ABI rebuild occurred in this repair. The previous live failure remains a failure; fresh live evidence is needed before claiming3/3×12/12 restored.
