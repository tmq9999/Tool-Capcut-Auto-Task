# CycleTLS runtime IPC fix round 1

Scope: `cycleTlsRuntime.ts` and `cycleTlsRuntime.test.ts` only. The runtime files are untracked in the current dirty worktree; root saved the pre-round baseline as `task1-runtime.patch` for scoped review.

## Root causes

- Request abort registration preceded insertion into `pending`, so a synchronous abort callback could not find/cancel the operation and the request frame was still sent.
- Child-exit ownership was created only after READY and socket connection, leaving an exit window in which no persistent lifecycle state existed.
- Startup cleanup discarded the boolean result from bounded child stop and released the reserved port without confirmed exit.
- Socket close/error released the port immediately after sending kill rather than after confirmed child exit.

## Changes

- Register a pending request before installing its abort listener, recheck `signal.aborted` after listener installation, and return without sending a request frame when canceled.
- Start one child-exit promise immediately after spawn, retain explicit exit state, and reuse that lifecycle signal for startup, steady-state failure, and disposal.
- Terminate any created socket on startup failure. If bounded child stop cannot confirm exit, return `CYCLETLS_CLEANUP_UNCONFIRMED` and retain the port reservation.
- Release the port only from the confirmed child-exit lifecycle (or before a child was ever spawned).
- Add deterministic fake child/socket tests for all four lifecycle races.

## TDD evidence

RED:

`npx vitest run src/main/services/capcut/http/__tests__/cycleTlsRuntime.test.ts`

- 4 new tests failed for the intended reasons:
  - abort race timed out rather than rejecting as aborted;
  - startup returned `CYCLETLS_SOCKET_FAILED` rather than cleanup-unconfirmed;
  - socket close allowed premature port reuse;
  - immediate post-connect child exit returned a usable driver.

GREEN:

`npx vitest run src/main/services/capcut/http/__tests__/cycleTlsRuntime.test.ts`

- 1 file passed, 15/15 tests passed.

`npx vitest run src/main/services/capcut/http/__tests__/cycleTlsContext.test.ts src/main/services/capcut/http/__tests__/cycleTlsNative.test.ts src/main/services/capcut/http/__tests__/cycleTlsProtocol.test.ts src/main/services/capcut/http/__tests__/cycleTlsRuntime.test.ts`

- 4 files passed, 60/60 tests passed.

`npx eslint src/main/services/capcut/http/cycleTlsRuntime.ts src/main/services/capcut/http/__tests__/cycleTlsRuntime.test.ts --max-warnings 0`

- Exit 0, no diagnostics.

`npm run typecheck`

- The two new fake-socket annotation errors were corrected.
- The final run still exits 1 solely on unrelated existing worktree errors:
  - `AutomationRunService.test.ts:654`: fixture lacks `verification.complete`.
  - `AutomationWorkSource.ts:12`: redundant named `type` modifier inside `import type`.

No browser, live account, production credential, commit, staging, or unrelated source changes were used.
