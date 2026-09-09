# Fresh three-account headed tests: functional and concurrency evidence

## Diagnostic baseline, 2026-09-09 01:00: 2/3 complete, no source changes

The user authorized exactly one additional headed three-profile run with at most three new email purchases, to collect evidence and revise the plan **before any further repair**. That run has ended; there was no rerun.

- Run: `4574d904-81bf-48d1-aa46-89684849d556`.
- Wrapper: **01:00:18.255–01:07:45.346 +07:00**, **7m27.091s**. Run-start to terminal: 444.034s.
- Exact evidence validator: **FAIL — `INVALID_TERMINAL_COUNTERS`**. Wrapper/child exit 4.
- Accounts accepted 3; completed **2**, failed **1**, stopped/skipped 0. Terminal `completed / MAIL_LIMIT_REACHED` means the batch ended, not that every account succeeded.
- Purchases attempted/confirmed/ambiguous: **3/3/0**; three new mailboxes consumed and linked one-to-one. Signup and OTP succeeded for all three accounts.
- **3 profile starts, 3 exact confirmed stops**; no replacement profiles, quarantine, late-settlement, persistence failure, or cleanup failure. Final workers/profiles/proxies/mail reservations all 0.
- 403 source/config/script/tool/build fingerprints unchanged; original account/mail row fingerprints unchanged. Node SQLite ABI137 restored and `SELECT 1` passed. No owned test runner or Electron process remains.

| Alias | Result | Same-run persisted proof rows | Editor queue wait |
| --- | --- | ---: | ---: |
| account-1 / worker-1 | Fresh/final 12/12, 670 credits | 9 | 60.711s |
| account-2 / worker-2 | Failed before first task snapshot | 0 | Did not enter editor |
| account-3 / worker-3 | Fresh/final 12/12, 670 credits | 9 | 131.427s |

Each successful account has 12 unique status-4 rows; nine carry same-run `op_id` proof. Do not invent an individual action proof for the other three rows. All accounts have zero unsettled proofs. Raw identifiers remain private.

### Exact observed failure

Account-2 authenticated successfully in 59.549s and passed trial inspection in 17.770s. Bootstrap started at **18:01:46.553Z**, spent 17.381s probing the task popover, then logged **reload recovery at 18:02:06.609Z**. It still received no usable snapshot and failed at **18:02:16.997Z**, after 30.407s. Its 12 bootstrap input tickets waited a combined 203ms, maximum 198ms; no timeout quarantine occurred.

This disproves the earlier assumption that making reload reachable would resolve the missing-task-list failure. It also rules out a long foreground queue wait as this incident's immediate trigger. The exact `007_no_task_list` dump contains the CapCut workspace and task-entry structure, zero task rows, and no login/network-error shell. Whether the task request was absent, rejected, unreadable, malformed, or empty is **not established** by this run.

### Other observations, not all functional defects

- Six warnings (two per account) said onboarding remained. Dumps `001`–`006_khao_sat_onboarding_khong_tat` show **What's New**, not the role survey. Diagnostic classification is inaccurate; it is not demonstrated as the bootstrap failure's cause.
- One launcher warning: requested native size 1296×767, observed 1296×728, emulated layout 1440×900. The log has no account attribution; no causal failure is proven.
- Four unique-title task-row fallbacks and two same-tab Inspiration fallbacks occurred on the successful accounts. Those guarded alternatives worked; do not patch them merely because their text contains “not found”.
- Three page-close warnings align with owned profile teardown, not a demonstrated crash.
- No canvas-zero-height error or prompt mouse timeout recurred in this run. Both exercised prompt entries used the verified-focus path with no prompt mouse trajectory. Absence in two exercised accounts is not proof that either historical fault is impossible.
- The two editor workflows still ran **one at a time**. Their combined editor occupancy was 305.316s. A shorter failed batch is not a speed improvement over the earlier successful three-account batch, because one account exited before its missions.
- Two machine-wide samples observed CPU 81%/17% and available RAM 16.51/16.90GiB. They are sparse samples, not a sustained-load profile or proof of sufficient ten/twenty-profile capacity.

### Evidence limits and confirmed capture risk

Retained: 468 runtime log rows, 465 rollout events, 7 DOM/screenshot pairs, wrapper records, isolated DB receipts/proofs, and source fingerprints. Full log inventory was reviewed; the short progress observer was not treated as exhaustive evidence.

`CAPCUT_CAPTURE_HTTP` stayed off: `CapcutEngineService` uses one account-scoped capture filename, but its recorder opens with `wx`; re-entering the same account after session recovery would throw `EEXIST` before the engine's protected body. Source and the recorder's existing collision test establish this risk. It did **not** cause this baseline failure because capture was disabled. Do not enable it unchanged on a paid diagnostic retry.

Default monitoring cannot distinguish task-list HTTP status/business rejection/body-read/parse failures and has no console/pageerror capture. The artifact has 139 UI starts but only 137 finishes because ordinary errors lack a closing duration event. Task proof details must be reconciled with DB/logs, not inferred from task-checkpoint status alone. These are explicit observability gaps; this is **not an exhaustive root-cause capture**.

The user's correction is binding: functional 3/3 success does not satisfy independent parallel execution. The [revised plan](../plans/2026-09-09-independent-headed-workers.md) must prohibit cross-account mission waits and separately investigate missing task responses. No production repair was performed during this baseline or its audit.

## New authorized fresh run, 2026-09-09: 3/3 accepted

**PASS for this fresh three-worker run**, after the user explicitly approved three additional new mailboxes. No existing account was resumed.

- Exact run: `537ae104-5347-43f2-9e94-40d68daf77b6`; mode `new`, headed, stage/workers/purchase cap all 3.
- Actual live interval: **00:11:08–00:22:28 +07:00**, about **11m20s**.
- Purchased **3**, confirmed **3**, ambiguous **0**. All three completed fresh signup with OTP; no login fallback.
- Terminal: accepted **3**, completed **3**, failed/stopped/skipped **0**, cleanup failures **0**.
- Official runner and wrapper both exited **0**; independent exact-run validator: **PASS**. Separate read-only review also reconciled all 549 artifact events against SQLite with no purchase, ownership, receipt, or cleanup discrepancy.
- Each account is stored as `done`, with exactly **12 unique task rows at status 4** and **670 credits**. All final receipts are fresh, final, and newer than their required proof watermark.

| Run-local alias | Worker | Final tasks | Snapshot later than proof watermark |
| --- | --- | --- | --- |
| account-1 | worker-3 | 12/12 | 543ms |
| account-2 | worker-2 | 12/12 | 328ms |
| account-3 | worker-1 | 12/12 | 700ms |

Three profiles were started and all **3/3 stops confirmed**. No replacement session or quarantine was needed. Peaks were 3 workers/profiles/proxies/mail reservations; all final resource counts are **0**. No owned Electron/AutoManager/runner process remains.

All three canvas prompt entries passed the focus/caret check and typed without another prompt mouse trajectory. One account initially hit a **canvas-zero-height layout error**; the existing next mission round revisited Design Studio in the same session and completed the missing canvas task. Therefore this is a successful recovered run, **not a claim of zero transient errors or permanent reliability**. Bootstrap reload recovery was not needed in this run.

An earlier invocation at 00:08 failed before application startup because SQLite was still built for Node ABI137 instead of Electron ABI133. It created **0 accounts, 0 mailboxes, 0 runtime logs, and no run artifact**. After rebuilding for Electron, the paid invocation above ran within the unchanged three-mailbox cap. Those failed-start records were preserved, not overwritten.

Account/mail fingerprints in the original database match the preparation baseline; the three new results remain in isolated test userData, referenced by `.superpowers/sdd/2026-09-09-new-three-headed/private-context.json`. Original and test databases have zero unreleased proxy leases. Node ABI137 was restored after live execution and in-memory SQLite `SELECT 1` passed. No additional production source edits, purchases, commits, or index mutations were made during this retest.

The historical failed run below remains unchanged; it is not being relabeled as successful.

> Follow-up, 2026-09-09 00:00 +07:00: the user's correction supersedes the resume acceptance proposed below. Acceptance requires **three fresh accounts completing signup and all 12 tasks**, not already-progressed accounts. After approval to proceed with minimal repair, only `runTasks.ts`, `human.ts`, and `missions/designStudio.ts` were changed (26 added / 7 removed production lines), with regressions in three existing test files. Bootstrap now preserves fatal DOM timeouts and reserves recovery time inside the unchanged 30-second budget. Canvas reuses focus only when the exact non-inert editable has a collapsed caret inside it; other typing keeps its previous mouse path. TDD RED/GREEN, independent scoped review, 1,538 tests, typecheck/lint/build, 89 selector checks, and three isolated offline Chrome editor checks passed. No new purchase or live account run occurred after this repair. **Fresh 3/3 acceptance is still unverified.** A new paid test needs a new explicitly approved budget; the prior budget of three emails is exhausted.

Date: 2026-09-08, Asia/Bangkok. **Overall result: FAILED.**

The user authorized a headed run with three workers and three newly purchased emails, followed by diagnosis and an immediate repair plan. One paid invocation ran. No additional purchase, old throttled-account login, production-source edit, commit, or index change was performed by this task.

## Exact run

- Run ID: `18ff03ac-0045-46df-982e-cafccf536233`.
- Wrapper interval: 22:49:52.776–22:55:49.887 +07:00, about 5m57s.
- Official runner: `new-accounts`, `headed`, `stage=3`, `threads=3`, UI mission transport, 45-minute outer limit.
- `mailLimit`, `approvedMailboxes`, `stopAfter`, and `maxBillablePurchases` were all exactly **3**.
- Wrapper recorded child exit **4**. Independent validation of the exact run artifact rejected **`UNSAFE_EVENT`**.
- Terminal: accepted 3, completed 1, failed 2, stopped 0, skipped 0. The terminal state `completed` / `MAIL_LIMIT_REACHED` means the finite batch ended, not that all accounts succeeded.

| Run-local alias | Worker | Result | Failure / evidence |
| --- | --- | --- | --- |
| account-1 | worker-2 | **12/12, fresh and final**, 670 stored credits | Final checkpoint at 15:55:47.191Z; account terminal completed immediately afterward. |
| account-2 | worker-3 | **6/12, incomplete** | `canvas-prompt:mouse-move` timed out; the one permitted replacement session subsequently failed login. |
| account-3 | worker-1 | **No task snapshot acquired** | Bootstrap failed after about 30 seconds. This is not evidence that the server has zero tasks. |

Aliases are those in the run artifact, not database insertion order. Private account, email, profile, proxy, and credential values are intentionally omitted.

## Findings and confidence

### 1. Canvas opener succeeded; the subsequent mouse movement hung

For worker-3/session-1:

- 15:52:44.421Z: bounded focus of the opener.
- 15:52:44.484Z: Tab activation.
- 15:52:46.518Z: expanded prompt observed non-inert.
- 15:52:46.576Z: prompt scroll; 15:52:46.677Z: bounding box.
- 15:52:46.751Z: prompt mouse-trajectory dispatch.
- 15:52:51.762Z: `DOM_READ_TIMEOUT`; scheduler quarantined the session.
- 15:52:54.770Z: retained 6/12 checkpoint; 15:52:55.560Z: exact old profile stop confirmed.
- 15:54:33.497Z: replacement session failed login; stop confirmed at 15:54:34.331Z.

`designStudio.ts` calls `fillEditor`, which calls `humanType`, which always performs another randomized mouse trajectory before typing. The trajectory has 22–31 intermediate mouse moves plus its final point. The current log cannot identify which individual move failed.

The scheduler serialized the observed inputs; input overlap is not supported as the immediate cause of this timeout. A different initial session, worker-2/session-1, completed the same prompt path. **That successful path was not the failed account's recovery.**

The missing command settlement is observed. Its internal Multilogin/Chromium cause and the exact focused element after Tab remain unproven. A canvas-specific verified-focus typing path is a proposed mitigation, not an implemented or live-verified fix. Do not generalize it to all mouse actions or increase timeouts.

### 2. Bootstrap exhausted its budget without a usable task response

For worker-1/session-1:

- Signup/auth completed at 15:51:09.814Z; trial check completed at 15:51:27.458Z.
- Bootstrap started at 15:51:27.459Z, then probed task-entry controls from 15:51:30.115Z through 15:51:57.275Z.
- Failure was logged at 15:51:57.849Z, approximately 30.39 seconds after bootstrap started.
- Its foreground tickets started mostly within 0–4ms, with a maximum observed wait of 203ms. No quarantine event occurred for this worker.

This is not demonstrated queue starvation. The saved DOM is a CapCut projects page containing the task-entry wrappers, not a login failure page. Multiple onboarding-warning dumps also exist; they are private diagnostic evidence, not proof of a specific overlay root cause.

Task monitoring starts inside `runAllTasks` only after authentication and trial. Earlier responses cannot be observed by that monitor. Later missing requests, rejected responses, unreadable response bodies, and rejected task payloads are not distinguished in the available diagnostics. No recognized `requestfailed` diagnostic was recorded for the affected account, which does not prove network health.

**Root cause remains unresolved.** Capturing the monitor before auth is a candidate investigation, not sufficient justification to accept stale/pre-auth data as a final receipt.

### 3. Two independent code defects found during inspection

These defects were not the cause of a cleanup failure in this run; all four profiles stopped successfully.

1. `runTasks.ts` catches `withTaskPopover` failures and rethrows only cancellation. A `DOM_READ_TIMEOUT` can therefore be swallowed and, when budget remains, followed by reload on the quarantined session. Add a RED regression before correcting this error boundary.
2. `AutomationRunService.handleStopFailure` passes an `AutomationTerminalError` to scheduler shutdown. Its code is stored in `reason.code`, but the scheduler inspects top-level `code`. A direct, read-only reproduction with the real classes emitted `RUN_ABORTED` for an input whose reason was `RESOURCE_CLEANUP_FAILED`.

The proposed missing-purchase-event validator finding from one review was **withdrawn**: the schema already enforces purchase arithmetic for every parsed event. It is not a bug and requires no patch.

## Purchases, isolation, and cleanup

- Gmail94: **3 attempted, 3 confirmed, 0 ambiguous**. Exactly 3 mailbox rows exist in the isolated test database.
- Started profiles: 3 initial + 1 replacement. **4/4 exact profile stops confirmed**, once each.
- Peak workers/profiles/proxies/mail reservations: **3/3/3/3**.
- Final workers/profiles/proxies/mail reservations: **0/0/0/0**. Cleanup failures: **0**.
- No owned Electron/AutoManager/official runner process remained after completion.
- Test storage began with zero accounts/mailboxes/leases/tasks. Existing encrypted provider configuration was already prepared in separate temporary userData outside the repository; the wrapper reserves exclusive records to prevent repeated invocation.
- Original account and purchased-mail row fingerprints match the prepared baseline, checked using the same `better-sqlite3` serializer as preparation. A preliminary cross-driver `node:sqlite` fingerprint comparison was not comparable for BLOB serialization and is superseded by that matching same-driver check.
- Original and isolated databases each have zero unreleased proxy leases.
- Native SQLite restored to Node ABI137; in-memory `SELECT 1` succeeded.
- Private browser dumps, encrypted local configuration, purchased accounts, and runner records are retained locally. No secret-bearing artifact was copied into this report or committed.

## Fresh offline checks

| Check | Result |
| --- | --- |
| Focused preflight | 6 files, 116 tests passed |
| Full Vitest after live/Node ABI restoration | 138 files, **1,524 tests passed** |
| Typecheck | Exit 0 |
| ESLint | Exit 0, zero warnings |
| Production build before live | Exit 0; existing >500kB renderer-chunk warning |
| Exact live evidence gate | **FAIL: UNSAFE_EVENT** |

Passing offline checks do not override the failed live gate.

## Handoff

See [the repair plan](../plans/2026-09-08-fresh-three-headed-repair.md). Production code is unchanged by this task. Superpowers brainstorming requires approval of the proposed behavior before implementation; the user-requested plan is prepared now, not represented as an applied fix.

After approval, use TDD and independent review. Any follow-up acceptance must reuse these three purchased accounts with purchase budget zero. Stop on an explicit authentication throttle; do not retry old throttled accounts, rotate identity to bypass limits, buy replacement emails, or advance to 5/10 workers.
