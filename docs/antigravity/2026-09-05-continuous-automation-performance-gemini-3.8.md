# Gemini 3.8 / Antigravity Execution Runbook

Use this document as the entry point for implementing:

- `docs/superpowers/specs/2026-09-05-continuous-automation-performance-design.md`
- `docs/superpowers/plans/2026-09-05-continuous-automation-performance.md`

The work is sequential unless this runbook explicitly identifies an independent
branch. Runtime behavior is not complete merely because the documentation exists.

## 1. Start The Session

Before reading source code or running a command:

1. Invoke `superpowers:using-superpowers`.
2. Invoke `superpowers:executing-plans` for inline execution, or
   `superpowers:subagent-driven-development` if the user explicitly authorizes
   isolated subagents.
3. Invoke `superpowers:test-driven-development` for every implementation task.
4. Read `AGENTS.md` completely.
5. Read the approved spec completely.
6. Read the implementation plan header, global constraints, file map, and the
   single task currently being executed.
7. Run `git status --short` and preserve every pre-existing user change.

Do not use Context7 for repository business logic. Use it only if a task requires
current Electron, React, Vite, Vitest, SQLite, Playwright, or other external API
documentation.

## 2. Create The Antigravity Task Artifact

At the beginning of the multi-step implementation, call `write_to_file` with:

~~~json
{
  "IsArtifact": true,
  "ArtifactMetadata": {
    "ArtifactType": "task"
  }
}
~~~

The artifact body must start as:

~~~markdown
# Continuous Automation And Performance

- [ ] Task 1 - Shared run/error/counter/account contracts
- [ ] Task 2 - Migration 005 and atomic email reservations
- [ ] Task 3 - Gmail94 preflight and JIT acquisition
- [ ] Task 4 - Finite/continuous work sources
- [ ] Task 5 - Continuous cancellable worker lifecycle
- [ ] Task 6 - IPC/preload/Dashboard integration
- [ ] Task 7 - Unified CapCut proof/snapshot deadline
- [ ] Task 8 - Stage timing instrumentation and safe live harness
- [ ] Task 9 - One-replacement CapCut page recovery
- [ ] Task 10 - Automation-first shutdown and single-instance lock
- [ ] Task 11 - Evidence-based selector gate repair
- [ ] Task 12 - Full verification and documentation

## Current Task

Task 1 - Shared run/error/counter/account contracts

## Verification Ledger

- No live billable Gmail94 order has been authorized.
~~~

After every RED, GREEN, refactor, focused verification, and completed plan task,
update this artifact with `replace_file_content` or
`multi_replace_file_content`. It is the source of truth for remaining work.

`manage_task` is for background processes. Never use it as a checklist.

## 3. Execute One Plan Task At A Time

For each task:

1. Put that task name in `Current Task`.
2. Read that complete task from the plan.
3. Inspect every listed production file, test, call site, and contract before
   editing.
4. Add the exact failing regression from the plan.
5. Run the task's RED command and confirm failure is caused by the missing or
   broken behavior, not by syntax, an unrelated test, or the native ABI.
6. Mark RED evidence in the artifact.
7. Implement the smallest code described by the task.
8. Run the task's GREEN command.
9. Refactor only while the focused tests remain green.
10. Run the task's final focused verification and `git diff --check`.
11. Inspect the diff for unrelated edits and secret exposure.
12. Mark the task complete only when its own acceptance behavior is evidenced.
13. Commit only if the user explicitly authorized commits for this execution
    session.

If the plan and current source disagree, inspect the current executable behavior
and tests, then update the task artifact with the discrepancy. Do not silently
invent a third contract.

## 4. Required Dependency Order

Execute Tasks 1-5 in order. They establish the contracts, persistence ownership,
email session, work source, and worker lifecycle used by all later work.

Tasks 1-6 contain two deliberate compile-safe cutovers:

- Task 1 adds canonical counters while retaining legacy progress aliases;
  Task 5 derives both sets from one runtime value; Task 6 removes every legacy
  field and makes the canonical DTO final. Do not stop or ship between Tasks 5
  and 6.
- Task 4 exports the work-source factory but does not wire it into the old run
  service. Task 5 atomically switches composition to `workSources` for
  acquisition and a separate `emailOtp` dependency for OTP reads, then deletes
  the obsolete bulk-purchase surface.
- Task 2 defines
  `reserveOldestAvailable(provider, reservationId, requiredService?)` and
  `countAvailable(provider, requiredService?)`. Task 3 must pass `capcut` as the
  required service for every Gmail94 reuse/count operation; rows with a null,
  `facebook`, or other legacy service value are incompatible and must never be
  counted or reserved for this workflow.

The implementation plan's `Acceptance-Criterion Coverage` table is the routing
index for the final 16-row verification report.

After Task 5:

- Task 6 may proceed independently from Task 7 because it changes typed
  IPC/preload/Dashboard files while Task 7 changes the CapCut evidence loop.
- Task 8 starts only after Tasks 5 and 7 are green.
- Task 9 starts only after Task 7 is green.
- Task 10 starts only after Tasks 2 and 5 are green.
- Task 11 is independent of runtime code but must preserve its own RED/evidence
  sequence.
- Task 12 starts only after Tasks 1-11 are green.

Default to sequential execution. Use `invoke_subagent` only after explicit user
authorization and only for one of these bounded branches:

- `TypeName: "research"` to inspect the selector fixture and assertion without
  editing;
- `TypeName: "self"` for Task 6 while the parent handles Task 7, provided each
  agent has an isolated worktree and no file overlap;
- `TypeName: "research"` to reconcile final acceptance criteria against already
  produced test output.

Never dispatch Tasks 1-5 in parallel. Never let two agents edit
`AutomationRunService.ts`, `EmailPurchaseService.ts`,
`CapcutEngineService.ts`, or `providerStack.ts` concurrently.

## 5. Billable Gmail94 Guard

Safe without additional approval:

- unit tests with fakes/fixtures;
- Gmail94 profile read;
- Gmail94 service-list read;
- local capacity calculation;
- SQLite reservation tests.

Blocked until a separate, explicit user approval:

- `createOtpOrder` against the real Gmail94 service;
- any mailbox purchase/order;
- any test that consumes balance.

The same rule applies to DongVanFB purchases with
`VERIFY_DONGVANFB_BUY=1`. An environment flag is a technical interlock, not a
substitute for explicit user approval.

Even after approval, require:

~~~powershell
$env:VERIFY_GMAIL94_BUY = '1'
~~~

and use the constant `capcut` service. Record the amount, expected maximum cost,
and approval in the task artifact before the call. Absence of billable live
verification must be reported exactly as:

> Implemented but not verified against a billable Gmail94 order.

## 6. Native ABI Discipline

Before Node/Vitest verification:

~~~powershell
npm run rebuild:node
~~~

Before the Electron harness:

~~~powershell
npm run test:electron
~~~

The Electron command rebuilds `better-sqlite3` for Electron. If returning to
Vitest afterward, run `npm run rebuild:node` again. Treat an ABI mismatch as an
environment blocker with exact module versions, not as hundreds of assertion
failures.

## 7. Stop Conditions

Pause implementation and report evidence when:

- the worktree changes unexpectedly while a task is in progress;
- a requested action would purchase a mailbox without separate approval;
- the Gmail94 insufficient-funds response differs from the captured sanitized
  fixture;
- a migration would require deleting or recreating user data;
- a selector change lacks a failing captured DOM state;
- a proposed performance shortcut removes human jitter, hit-target, inert,
  render, enabled, `do_action`, or `task_status` safeguards;
- a second Electron instance would reach SQLite/provider initialization;
- a task cannot reach GREEN because of an unrelated environment failure.

Do not mark the task artifact blocked for ordinary RED tests or unfinished work.

## 8. Final Verification

After Tasks 1-11, invoke `superpowers:verification-before-completion` and execute
Task 12 exactly. The minimum evidence set is:

~~~powershell
npm run rebuild:node
npm run typecheck
npm run lint
npm run build
npm run selectors
npm run test:node
npm run test:electron
node --check scripts/live-capcut-options.mjs
node --check scripts/live-capcut-run.mjs
git diff --check
git status --short
~~~

Also run every focused command listed in Task 12 and inspect the complete output.
Create the verification report with one status row for each of the 16 acceptance
criteria.

For non-billable stage measurements, use the bounded custom-domain harness after
the build is green:

~~~powershell
node scripts/live-capcut-run.mjs --email=custom --threads=1 --stop-after=1 --minutes=45
~~~

Do not replace a blocked custom-domain/local-launcher measurement with a paid API
source. Record the exact blocker instead.

Completion requires:

- API/custom workers demonstrably refill;
- manual work demonstrably exhausts as `completed`;
- no silent initial-concurrency reduction;
- no duplicate reservation, incompatible legacy Gmail94 service reuse, or
  premature paid order;
- manual textarea blank-line positions survive through
  `automationConfig.test.ts`, so validation reports original line numbers;
- workload errors survive cleanup;
- run terminal states and counters agree;
- PWA proof/snapshot bookkeeping has one 12-second budget;
- proof-backed tasks do not replay;
- stage timing is present and sanitized;
- one-page recovery budget is enforced;
- automation stops before LogBus/SQLite;
- the selector gate is green for the measured reason;
- all required local verification is green or precisely reported as an
  environment-only blocker;
- no billable operation occurred without approval.

Only then update the task artifact so all tasks are checked and report the exact
files, commands, outcomes, and unresolved risks to the user.
