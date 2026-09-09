# Independent workers: implementation and verification

Status: scoped implementation and offline verification completed, but subsequent live acceptance **FAILED**. See the live result below; the earlier offline checks do not establish production reliability.

## Subsequent live result: 1/3, not accepted

User authorized one fresh headed3 run with three new emails after implementation. Exact run `42b78934-7597-494c-8e36-5dbaaab163f3`; wrapper 2026-09-09 **01:59:03.647–02:07:04.335 +07:00**, 8m0.688s. Source stayed unchanged (406 fingerprints).

- Purchases attempted/confirmed/ambiguous: **3/3/0**. Accepted3/completed1/failed2/stopped0/skipped0; wrapper/child exit4.
- Both functional and `--require-independent` exact artifact validation: **FAIL `UNSAFE_EVENT`**.
- account-1/worker-1 failed bootstrap: zero matching allowlisted task-list request observed by the pre-auth diagnostic. This is not proof of total network absence or auth/server root cause.
- account-2/worker-3 ended6/12 after `canvas-send:mouse-move` timeout in both initial and replacement session. Its task diagnostics recorded23 HTTP200/valid12/errNo0 cycles.
- account-3/worker-2 reached12/12 after responsive zero-height failure, a later `wait-not-inert` timeout, then recovery. Its task diagnostics recorded41 HTTP200/valid12/errNo0 cycles.
- **5/5 profile stops confirmed** (3 initial+2 recovery); no cleanup failures, no leases or worker/profile/proxy/mail reservations left active. Original account/mail data fingerprints unchanged; Node ABI137 restored afterward.
- 570 events,171 UI starts166 finishes,3 timeout quarantine events. Unsafe/unclosed intervals cannot be turned into an official passing concurrency summary. Two editor sessions did overlap, but the required three-session acceptance was not achieved because one account failed before editor work.

This run demonstrates remaining interaction/readiness failures despite session independence. It does not prove that the scheduler change caused them, nor that selector/JS click will fix them. No source patch or paid rerun occurred during the audit. The next proposed repair is [selector-first-repair](../plans/2026-09-09-selector-first-repair.md), pending approval.

## Implemented scope

- One scheduler per headed session; a run registry tracks cleanup only. Normal peer work no longer waits for another account's editor/input lease.
- Headed sessions use page-target input rather than repeatedly activating the native window; legacy direct callers retain their prior focus behavior.
- Alias-wide poison across both local lanes, exact-stop accounting, new scheduler for recovery, bounded registry retirement, Stop Thread isolation, and explicit global resource-safety shutdown.
- Opt-in `--require-independent` rejects legacy serial-success evidence; it verifies actual session interval overlap, local FIFO, resource lifecycle, and queue timings in addition to the existing functional proof/receipt gate.
- Opt-in `CAPCUT_DIAG_TASK_LIST=1` observes categorical task request/status/body outcomes before auth, including real prefixed routes, without adding snapshots/proofs or changing mission behavior. It does not fix the still-unresolved missing-task-list cause.
- A no-account probe function accepts an injected launcher and requires explicit opt-in. No account acquisition or provider credential CLI was introduced.

No task order, reward rule, mailbox purchase budget, renderer UI, preload API, database schema, or mission transport rewrite was made. Existing generic HTTP capture's account-filename collision remains outside this repair; keep it disabled for recovery diagnostics and use the narrow observer instead.

## Verification

- Baseline: 138 files / 1,538 tests passed.
- Final integrated suite: **140 files / 1,631 tests passed**, exit 0 at 01:51 local 2026-09-09.
- Service regressions prove 20 workers: holding worker 1 permits the other 19 to finish; a continuous peer accepts another item without waiting for worker 1.
- Barrier tests at 1/3/5/10/20 prove concurrent admission with per-session input/editor maximum one, and 100 successful/failed-no-resource sessions do not leak registry entries.
- Distinct local Chrome processes, 3 then 10, each with two generated fixture tabs and three rounds: all click/type/upload checks completed, peak concurrent input 3/10, zero external requests, all profiles stopped. These are local Chrome checks, not Multilogin compatibility or 100-round acceptance.
- Typecheck/lint/build passed; build retained the existing >500kB renderer-chunk warning.
- Selector fixtures: 89 pass / 0 fail.
- Hidden local Electron harness exit 0; SQLite rebuilt back to Node ABI137 afterward.
- The historical fresh 3/3 serial artifact still passes its original functional gate and fails the new independent gate with `INDEPENDENT_UI_SCOPE_REQUIRED`.

## Review-driven corrections

Separate reviewers covered scheduler/input, service lifecycle, CLI/evidence, and the root-authored observer. Corrections were regression-tested before changes: exact-stop late-owner counters, health timeout global abort/shutdown, valid local FIFO interpretation, rejection of impossible health+mission-independence flags, underlying diagnostic read-slot retention, and prefixed task routes.

Final integration review identified two probe-harness issues (error-message redaction and late commands after Stop). Both were reproduced RED, fixed, and independently re-reviewed as addressed; focused harness/fixture tests passed **17/17**. The same default fixture helper now has optional cancellation checks around route setup/navigation, with legacy callers unchanged.

## Decisions and remaining limits

- Work stayed in the existing dirty checkout with scoped pre-edit copies; no commit/index mutation. This preserves user work but means review compares filesystem baselines, not bare HEAD.
- Sub-agents had disjoint file ownership with root integration review; shared contracts were declared before edits.
- The authorized fresh3 vendor run above failed; additional vendor profiles, paid emails, and fresh-account performance remain separately authorized gates. No 10-profile CapCut success, 20-profile capacity, or 6–10-minute performance claim is made.
- Task-list diagnostics are opt-in and capped in count/raw concurrency; advertised length is a prefilter, not an unconditional allocation cap against a lying/compressed body. Unknown-length bodies are omitted; timeout does not free a raw-read slot until it settles. No raw body/URL/token is logged.
- Missing `task_list` after signup/reload remains unproven at request/response level; no speculative auth/mission fix was applied.
- No temporary baseline, paid-account evidence, or user file was deleted.
- SDD's workspace/report helpers were adapted to PowerShell and the preserved filesystem baseline; no auto-commit or baseline cleanup was performed. Optional fixture cancellation was the only extra shared-helper change admitted by review, to prevent navigation after Stop.

Plan: [independent-headed-workers](../plans/2026-09-09-independent-headed-workers.md).
