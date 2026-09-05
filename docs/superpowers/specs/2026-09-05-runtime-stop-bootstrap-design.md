# Runtime Stop, Bootstrap, and Mission Timing Design

## Problem

The current CapCut run can spend two or more minutes inside task bootstrap before
the first mission action. The PWA mission can report an action stage of more than
three minutes because popover cleanup and reload waits are included in the action
stage. A Stop request cannot reliably interrupt a profile while xcli is waiting for
CDP, and failed `profile-stop` commands are swallowed so the UI can report a clean
cleanup while a Multilogin window remains alive.

The evidence comes from the real runtime log window in the user-data database on
2026-09-05: task bootstrap waited from 02:17:05 to 02:19:06, PWA action stages
were 221–225 seconds, CDP attach kept retrying after Stop, and several
`profile-stop` commands failed.

## Goals

1. Stop must interrupt acquisition, CDP attach, page waits, mission waits, and
   browser teardown deterministically.
2. Every opened profile must be registered for ownership before CDP attach so a
   concurrent Stop can close it.
3. A failed profile stop must remain visible as a typed cleanup failure; it must
   never be reported as successful cleanup.
4. Bootstrap and popover opening must use one bounded deadline rather than a
   per-selector timeout multiplied by retry count.
5. PWA and notification actions must execute immediately after opening the task
   row; post-action proof and snapshot waits must not include popover teardown.
6. A blocking overlay must stop the current mission instead of returning `false`
   and allowing subsequent clicks to continue.
7. Runtime logs must expose stage timestamps that make every remaining wait
   attributable to a concrete boundary.

## Non-goals

- Removing measured human jitter or CapCut anti-risk safeguards.
- Replacing CapCut selectors without captured evidence and a red selector test.
- Calling a billable email purchase in tests or live verification without explicit
  approval and the dedicated opt-in flag.
- Adding a vendor-wide Multilogin stop-all operation.

## Design

### Ownership and cancellation

`BrowserLauncher.launch` accepts an `AbortSignal`. The launcher registers the
profile id immediately after the start command returns. CDP polling and sleeps
race the signal. `AutomationRunService` keeps a run-scoped map of pending and
attached profiles; `stop()` aborts first, then stops every owned profile and waits
for worker settlement. Ownership is removed only after the stop attempt settles.

Launcher stop returns/throws a typed error when the vendor command fails. The
service records a cleanup diagnostic while preserving the workload outcome.

### Bootstrap and popover deadlines

Task bootstrap starts from the task route when available. It uses a single
deadline for initial snapshot and popover activation. Candidate selectors are
tried without multiplying the deadline. Reload is a safe-boundary fallback, not a
`finally` action after a mission row click.

`withTaskPopover` has separate open/action/close boundaries. Closing is best effort
and cancellation-aware; it cannot add a 60-second reload to the mission action.
`ensurePageUsable` throws a sanitized `StepError` when a known or unknown blocking
overlay remains.

### UI state

The Dashboard disables duplicate Stop submissions while `stopping`, refreshes
threads/accounts after terminal teardown, and renders the actual terminal reason.
If a Stop button is present under another label, it calls the same run-owned Stop
IPC endpoint.

## Acceptance criteria

- Stop during CDP attach completes within the configured bounded teardown window,
  leaves no owned profile, and prevents the next email acquisition.
- A failed vendor stop produces a cleanup failure in the run summary and a
  visible warning; it does not disappear as `cleanup outcome=success`.
- Bootstrap has no sequence of 2×8-second selector retries followed by another
  reload timeout for one mission.
- PWA action-stage timing excludes popover teardown and is bounded by measured UI
  waits plus the unified 12-second proof/reconciliation deadline.
- A blocking overlay aborts the mission before any covered click.
- Focused regression tests fail before each production fix and pass afterward.
- Live verification records real IPC progress, LogBus timestamps, and actual
  Multilogin profile state for each slice.
