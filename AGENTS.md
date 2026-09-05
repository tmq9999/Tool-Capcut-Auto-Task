# AGENTS.md - AutoManager v2.4.1 Engineering Contract

This file is the always-loaded operating contract for agents working in this
repository. Keep it concise and current. Put detailed design history in the
linked documents instead of growing this file indefinitely.

Existing source comments written before 2026-09-05 still cite the former
numeric contract. Interpret those citations through this compatibility map;
new comments should cite a section name or source-of-truth file instead of a
number:

| Legacy citation | Current authority |
| --- | --- |
| §3 Evidence-first development | Source Of Truth; Testing And Verification |
| §7 Backend layering | Architecture Boundaries |
| §8-§12 SQLite, migrations, repositories, settings | Persistence And Secrets; `docs/ARCHITECTURE.md` |
| §13 Credentials and secrets | Persistence And Secrets |
| §15 Accounts data | State And Outcome Semantics |
| §16-§17 Runtime logging | Performance And Waiting; CapCut Engine Evidence Rules |
| §18 Log retention | `docs/ARCHITECTURE.md` and current retention tests |
| §19 Database indexes | Persistence And Secrets and query-plan tests |
| §21 Account export | Current export schemas/services/tests and `docs/ARCHITECTURE.md` |
| §27 Error handling | Persistence And Secrets; Testing And Verification |
| §30 CapCut automation boundary | CapCut Engine Evidence Rules |

## 1. Mandatory Workflow

Every task must start with the installed Superpowers plugin.

1. Invoke `superpowers:using-superpowers` before analysis, questions, commands,
   edits, reviews, or planning.
2. Invoke every applicable Superpowers workflow and read its current `SKILL.md`.
3. Use `superpowers:brainstorming` before behavior or architecture changes.
4. Use `superpowers:systematic-debugging` for bugs, failures, hangs, or unexpected
   performance.
5. Use `superpowers:writing-plans` for approved multi-step work.
6. Use `superpowers:test-driven-development` while implementing behavior.
7. Use `superpowers:verification-before-completion` before any completion claim.
8. Use `superpowers:finishing-a-development-branch` only when the branch is
   genuinely ready to finish.

For Antigravity, a Superpowers todo/checklist means a task artifact created with
`write_to_file` using `IsArtifact: true` and `ArtifactType: "task"`. Update that
artifact after every completed step. `manage_task` controls background processes;
it is not a checklist.

Use Context7 for current library, framework, SDK, API, or CLI documentation:

1. Resolve the library ID.
2. Query the official documentation for one concept per query.
3. Base library-specific answers and changes on the fetched documentation.

Context7 is not required for repository business logic, local refactoring, or
reviewing code that is fully defined in this repository.

Before editing:

- Read this file and the source-of-truth document for the subsystem.
- Inspect implementation, contracts, call sites, and relevant tests.
- Check `git status --short`; preserve user changes and unrelated work.
- State assumptions that materially affect behavior.
- Prefer the smallest correct change; avoid unrelated redesign or dependencies.

## 2. Project State

AutoManager is a commercial Windows-first Electron desktop automation manager.

Current stack:

- Electron 35
- React 19
- TypeScript 5.8 in strict mode
- Vite 6
- Tailwind CSS 3
- SQLite through `better-sqlite3`
- Playwright through `playwright-core`

Current implemented scope:

- CapCut Free Credits automation (`module: "credit"`)
- Multilogin browser runtime only
- Gmail94, DongVanFB, and owned custom-domain email sources
- KiotProxy key leases or direct proxies
- SQLite-backed settings, accounts, runtime logs, purchased emails, proxy leases,
  and per-account CapCut task progress

The CapCut engine is integrated under `src/main/services/capcut/`; it is not a
future placeholder. `trial` and `team` modules and GoLogin, GPM, Camoufox, and
Patchright runtimes remain unsupported and must fail clearly before a billable
email purchase.

The active reliability/performance change is specified in:

- `docs/superpowers/specs/2026-09-05-continuous-automation-performance-design.md`
- `docs/superpowers/plans/2026-09-05-continuous-automation-performance.md`
- `docs/antigravity/2026-09-05-continuous-automation-performance-gemini-3.8.md`

This change is implemented and verified (see `docs/superpowers/reports/2026-09-05-continuous-automation-performance-verification.md`). The runtime implementation under `src/main/services/`, `src/main/services/capcut/`, and `src/renderer/` is the active source of truth.

## 3. Source Of Truth

Use these pointers by branch:

- Persistence, IPC, security, and composition: `docs/ARCHITECTURE.md`, then verify
  current wiring in `src/main/runtime/providerStack.ts`.
- CapCut selectors, measured browser behavior, proof rules, and risk-control
  evidence: `docs/AUTOMATION-ENGINE.md`.
- Continuous workers, just-in-time email acquisition, run states, and performance
  targets: the active spec linked above and its implementation plan when present.
- Commands, dependency versions, and package entry points: `package.json` and the
  relevant config file, not copied prose.

Some older comments and documents still describe the pre-integration browser-hold
phase. When prose conflicts with executable code and tests, inspect the behavior,
record the discrepancy, and update the stale documentation within task scope.

## 4. Architecture Boundaries

Renderer access must remain:

```text
React renderer
  -> typed preload API
  -> typed IPC contract
  -> main-process application service
  -> repository or provider interface
  -> SQLite or external service
```

BrowserWindow security remains:

- `nodeIntegration: false`
- `contextIsolation: true`

The renderer must not import Node APIs, Electron main internals,
`better-sqlite3`, credential-bearing SDKs, or decrypted secrets. Preload exposes
narrow typed methods, never unrestricted `ipcRenderer`, SQL, or filesystem access.

Main-process dependencies flow inward:

```text
IPC -> application services -> repositories/provider interfaces -> infrastructure
```

Providers normalize vendor responses. They do not own React state, SQLite queries,
navigation, or automation orchestration. Services depend on interfaces and receive
dependencies explicitly.

## 5. Persistence And Secrets

Persistent application state belongs in SQLite at a path derived from
`app.getPath("userData")`. Do not hard-code a user path or use JSON/localStorage as
the primary database.

Database initialization must keep:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Schema changes use ordered migrations in `src/main/database/migrations/` and the
`schema_migrations` table. Upgrade existing databases; never solve a migration by
deleting user data.

Raw SQL stays in repositories. External providers and application services must
not issue SQL directly.

Secrets are encrypted by `CredentialVault`/Electron `safeStorage` before SQLite.
Keep API keys, passwords, OAuth tokens, refresh tokens, TOTP seeds, mailbox raw
payloads, and session tokens in the main process. Return only masked or boolean
secret state to the renderer. Redact secrets from logs, errors, tests, screenshots,
and fixtures.

## 6. Automation Ownership

`AutomationRunService` owns run lifecycle, worker concurrency, cancellation,
resource ordering, counters, and account outcome coordination.

The CapCut engine owns only work inside an already-open Playwright session. It
receives `{ page, context, sampleImage, log, signal }` plus account inputs and
returns evidence-backed results. It does not acquire email, proxy, browser,
SQLite, or application-global state.

`threadCount` is retained for settings compatibility and means worker concurrency
only. It must not also cap the total number of API/custom-domain accounts processed.

Target workload semantics for the active spec:

- Manual email input is finite and completes when its valid entries are exhausted.
- API and custom-domain sources keep workers filled until Stop or a typed terminal
  condition.
- A worker acquires non-billable proxy capacity before a billable mailbox.
- A worker acquires/reserves one mailbox just in time, not an entire batch at run
  start.
- A released worker slot requests the next email automatically.
- Stop prevents new acquisition, cancels waits, closes owned profiles, releases
  owned leases/reservations, and waits for teardown.

Never silently reduce the requested initial concurrency. Either start the complete
initial wave or report a precise typed reason why it cannot start.

## 7. Email And Billable Operations

Billable provider operations require stronger controls than connectivity reads.

- Reuse paid, unconsumed mailboxes before buying another one, but only when the
  provider-specific service is compatible (`capcut` for Gmail94).
- Reserve reusable mailboxes atomically so two workers or app instances cannot
  select the same row.
- Preflight Gmail94 with current balance plus the current `capcut` service price.
- Report balance, unit price, reusable count, and affordable count with a timestamp;
  never expose the API token or raw vendor payload.
- Serialize or otherwise coordinate purchases so concurrent workers cannot spend
  from the same stale balance observation.
- Retry only transient network/rate-limit failures with bounded backoff.
- Treat authentication, invalid service, and genuine insufficient balance as typed
  terminal conditions, not generic "API Gmail" failures.
- Partial purchase success must not silently turn `threadCount: N` into a smaller
  initial run.

Real tests may perform profile/balance/service-list reads when credentials exist.
No live email purchase, order, or other charge is allowed without the user's
explicit approval and a dedicated opt-in environment flag.

## 8. State And Outcome Semantics

Run state and account state describe different things.

Run states for the active spec:

- `idle`: no run has started
- `preparing`: validating and establishing initial capacity
- `running`: workers may acquire and process work
- `stopping`: cancellation and teardown are in progress
- `completed`: a finite manual source was naturally exhausted
- `stopped`: the user or application shutdown requested a stop
- `blocked`: an expected external condition requires operator action
- `failed`: an unexpected fatal application/run failure

Every terminal run reports a typed reason and sanitized message. UI active-state
checks, IPC schemas, tests, and progress rendering must be updated together.

Account status must preserve the workload outcome:

- Successful/verified work ends `done`.
- Workload, signup, OTP, or launch failure ends `error` and increments failure
  counters exactly once.
- User-stopped work uses an explicit stopped outcome in `automationStep` without
  overwriting an earlier `done` or `error` result.
- Resource shutdown never rewrites a workload error to `status: "done"`.

Counters have one definition for the whole run: worker target, active worker,
accepted account, completed account, failed account, and stopped account must not
be derived from one another implicitly.

## 9. Performance And Waiting

Optimize measured waits, not human-behavior safeguards.

- Record elapsed time for email acquisition, proxy acquisition, browser launch,
  authentication/OTP, each mission group, proof reconciliation, and shutdown.
- Use one bounded deadline for mission proof and the refreshed task snapshot. Do
  not spend one full timeout proving an action and another full timeout waiting for
  the same state.
- Once matching `do_action` evidence succeeds during a run, retain it and never
  rerun that task merely because a later snapshot is stale.
- PWA install and notification tasks use the tighter deadline defined in the active
  spec; Design Studio and Video Studio retain their evidence-based generation
  budgets unless new measurements justify a change.
- Cancellation must interrupt queue, retry, provider-backoff, OTP, and task waits
  where the underlying API allows it.
- Avoid blind sleeps in orchestration. Keep measured UI waits and human jitter in
  the engine.

Performance claims require timestamped measurements from the affected stage. A
faster build or passing unit test does not prove a faster real automation run.

## 10. CapCut Engine Evidence Rules

These rules were paid for by real browser runs and are hard constraints.

### Infrastructure stays external

Code under `src/main/services/capcut/` must not launch or stop browser profiles,
acquire proxies, read SQLite, read `.env`, or write to the current working
directory. Browser lifecycle belongs to `BrowserLauncher`/`IBrowserRuntimeApi`;
proxy lifecycle belongs to `ProxyLeaseManager`.

### Logs are injected

No `console.*` is allowed in the CapCut engine. Route every line through injected
`log()` so `LogBus` can attach `accountId` and the canonical runtime shape.

### Success is proven

A mission only performs UI actions. Only `runGroup` may conclude success, after a
matching `do_action` with `err_no === 0` and a re-read of CapCut `task_status`.
Neither UI state nor a mission function may mark a task complete by assumption.

### Guards remain

Preserve `assertHittable`, `assertNotInert`, `waitNotInert`, `waitNodeRendered`,
and every `waitEnabled` return check. `page.mouse` does not verify the hit target;
an unguarded click can report success while a covering element receives it.

### Human behavior remains

Preserve `human.ts` and the measured `waitForTimeout(rand(...))` jitter. CapCut's
Shark Risk Control scores pointer trajectories and key timing; removing jitter has
produced `err_no 8001003` on reward claims.

### Selector changes start with evidence

Before changing a selector:

1. Add the failing DOM state to `tools/fixtures/`.
2. Add a failing assertion to `tools/verify-selectors.ts`.
3. Run `npm run selectors` and confirm the new assertion is red.
4. Make the smallest selector change.
5. Re-run the selector gate.

Fixtures do not load external CSS. They prove selector resolution and inert
containment, not visibility or occlusion. Test occlusion with explicit geometry.

### Native dependencies stay external

`playwright-core` and `better-sqlite3` remain excluded from the Vite main bundle.
Bundling `playwright-core` reaches its optional native `kerberos` import and breaks
the build. Account for the Node/Electron ABI when testing `better-sqlite3`.

## 11. Browser And Application Lifecycle

Each worker owns exactly one browser session and one proxy lease. The same owner
closes/releases them; teardown is idempotent and never stops another worker's
profile.

The main CapCut page closing or crashing is a recoverable runtime event only when
the recovery policy in the active spec still has budget. Recovery must select a
valid remaining page or create one controlled replacement; logging alone is not a
recovery strategy.

Application shutdown must stop the active automation run before disposing logs and
closing SQLite. Electron must hold the single-instance lock before creating the
main window so two processes cannot race the same database, mailbox reservations,
or Multilogin resources.

## 12. UI Contract

The Stitch-exported AutoManager Dashboard remains the visual reference. Reuse one
`AppShell`, sidebar, header, status bar, typography, spacing, controls, DataGrid,
border, and radius system across Dashboard, Accounts, Settings, and Logs.

Global shell actions are page-specific slots:

- Dashboard: Start, Stop
- Accounts: Add, Edit, Delete, Export
- Settings: Reset, Save
- Logs: Pause, Clear

Use the existing generic DataGrid based on `@tanstack/react-table`. Do not add a
second table framework or page-specific shell.

Dashboard progress must render all run terminal states and the typed reason. Do
not infer "success" from browser closure or from `threadsStopped ===
threadsStarted`.

## 13. Testing And Verification

Behavior changes follow red-green-refactor. A regression test must fail for the
original reason before the fix and pass afterward.

Minimum local gates where applicable:

```text
npm run typecheck
npm run lint
npm run build
npm run selectors
npx vitest run <focused test files>
```

Database work additionally verifies clean initialization, migration from version
4, reservation concurrency, restart persistence, WAL settings, and rollback/error
paths.

IPC work additionally verifies valid input, invalid input, envelope shape, preload
exposure, and renderer isolation.

Provider work additionally verifies sanitized errors, documented response shapes,
safe read-only live calls when credentials are available, and explicit reporting
when a real service was not tested.

Before reporting completion:

1. Run fresh relevant commands.
2. Read full output and exit codes.
3. Reconcile every spec acceptance criterion with evidence.
4. State failed, blocked, skipped, and unverified checks exactly.

Do not commit, amend, push, delete data, perform billable live calls, or run
destructive git commands without explicit authorization.

## 14. Antigravity / Gemini 3.8 Execution

For an implementation handoff in Antigravity:

1. Create a task artifact containing every plan task and verification gate.
2. Read this file, the approved spec, and only the assigned plan task before code.
3. Keep the artifact current after each red/green/refactor/verification step.
4. Use isolated subagents only where the approved plan identifies independent
   work; use `invoke_subagent` with `self` for implementation or `research` for
   read-only investigation.
5. Implement one reviewable task at a time with focused commits when authorized.
6. Never run a billable provider test without a separate explicit user approval.
7. End with fresh verification evidence and unresolved-risk reporting.

The exact implementation entry point is
`docs/antigravity/2026-09-05-continuous-automation-performance-gemini-3.8.md`.
