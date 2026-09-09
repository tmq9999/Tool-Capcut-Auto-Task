# CapCut HTTP-First Automation Specification

Status: Approved for implementation by the user in conversation. New paid live operations still require separate explicit approval.

Date: 2026-09-06

Related implementation plan: [HTTP automation rewrite](../plans/2026-09-06-http-capcut-automation-rewrite.md).

## 1. Objective And Acceptance Boundary

Replace UI-driven CapCut operations with authenticated HTTP operations that perform the same real work: session establishment, chat, asset upload, generation submission, job observation, editing and export. Remove mouse/canvas dependencies from each operation only after its network contract and live behavior have been verified.

The target is end-to-end HTTP execution, not merely replaying a reward acknowledgement. Whether all stages can execute without a browser remains a discovery result. Each stage must report its actual implementation, including browser/session dependencies; a hybrid run must never be labelled pure HTTP.

This specification defines behavior and gates, not undocumented CapCut endpoint payloads. Endpoint implementations require the evidence register described in Section 4. Missing wire contracts block that operation's HTTP promotion, not unrelated investigation.

### Outcomes

- Real server-side effects and task outcomes match the corresponding UI workflow.
- Three workers use isolated account sessions, proxy routes and job identifiers.
- Mailbox and generation spending stay within explicit run authorizations.
- Stop is bounded, partial progress survives errors, and uncertain requests are not repeated.
- Performance is measured per stage and transport, without claiming that a passing unit test proves faster live execution.

### Non-goals

- No unconditional removal of the existing UI engine before its replacement passes parity tests.
- No global interaction lock or arbitrary delay presented as a proven renderer fix.
- No changes to unrelated Dashboard history/log clearing or other product modules in this change.
- No fabricated task completion, cross-account session replay, or bypass of access controls, challenges or service eligibility.
- No hardcoded regional task totals, rewards or assumed free-generation allowance.

## 2. Current Evidence And Uncertainties

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| `tools/fixtures/task-list-initial.json`, `task-list-done.json` | Existing task-list response examples and task relationships | Complete request headers, authentication requirements or current regional availability |
| `tools/fixtures/do-actions.ndjson` | Examples consumed by `parseDoAction` | Generation/upload/export wire contracts or sufficiency of an acknowledgement alone |
| `src/main/services/capcut/taskApi.ts` | Current parser and passive monitor behavior | That every signed endpoint needs the same headers or can be called from Node |
| Conversation live reports | Successful single-worker headed/headless runs; multi-worker mouse command timeouts | GPU overload, exact failed mouse substep, or a host-wide pointer conflict |
| Existing UI missions | Operation order and known UI preconditions | That those UI elements are the only way to perform the operation |

The repository root `.capture` directory was absent during this spec's inspection. Historical references to `.capture/2026-09-01-21-50-27/` are pointers to locate, not inspected evidence. `tools/fixtures/` currently supplies response/DOM examples, not a complete end-to-end HTTP contract.

The existing lock is constructed in `runTasks.ts` for each account environment. Its presence does not prove cross-worker serialization. The HTTP path must not inherit that dependency or use previous lock claims as evidence.

## 3. Transport Strategy

The proposed strategy is incremental HTTP-first promotion. Two alternatives are rejected as defaults: rewriting every endpoint at once would require inventing missing contracts; retaining all UI actions would not address renderer-dependent execution.

Separate configuration policy from the selected execution mechanism:

| Policy | Behavior |
| --- | --- |
| `ui` | Existing UI actions; ordinary passive evidence collection |
| `shadow` | UI is the sole writer; HTTP adapter prepares and validates a redacted request locally and compares recorded results. No duplicate mutation. Explicitly allowlisted read-only reconciliation may run. |
| `http` | Strict direct HTTP. All required stages, including session setup, must be direct-capable; fail preflight before purchasing if not. No hidden fallback. |
| `auto` | Prefer verified direct HTTP; use a verified browser-request bridge or UI only where explicitly allowed before dispatch. Log every selection. |

The actual mechanism is one of `direct-http`, `browser-http`, or `ui`. `browser-http` means request execution in an account-owned browser session, without DOM clicking for that operation. It remains a browser dependency and retains browser failure/cleanup risk. Native Node `fetch` does not automatically inherit browser cookies, session signing behavior or its proxy route.

Initially, saved configurations continue to use `ui`. Shadow and auto are explicit rollout choices; no automatic migration changes the behavior of an existing deployment.

An HTTP-capable operation does not imply an HTTP-capable full run. Report the transport used for authentication and each mission separately.

## 4. Capture And Contract Registry

### 4.1 Capture procedure

1. Locate existing authorized captures and record their provenance before assuming they are usable.
2. Where absent, capture one known-good operation in a user-authorized account, with a marker immediately before the action and after server acceptance/completion.
3. Record method, origin/path, query schema, headers schema, body encoding, response schema, status, timestamps, initiator when available, and request/job correlation.
4. Capture redirects, upload initiation/finalization, object-storage transfers, polling, server-sent events or WebSocket messages when the operation uses them. Do not assume everything is JSON request/response.
5. Establish causal dependencies: for example, upload response asset ID used in generation request. Temporal proximity alone does not prove causality.
6. Compare success and a safe failure case. Never induce a paid failure just to collect a fixture.
7. Normalize and review before promoting any fixture into version control.

Capturing through an existing UI operation is permitted during discovery. Replaying an operation is a separate mutation and requires its own execution gate. A capture is not a reusable authenticated request template.

### 4.2 Required contract fields

Each versioned contract entry must contain:

- Internal operation name and contract revision; applicable module and account capability.
- Capture source, capture time, web build/browser version if known, and locale/region observations.
- Observed origins, methods, path patterns, encoding and request/response schemas.
- Every request field's origin: static observed constant, user input, session-derived field, or dependency output. Examples are not universal defaults.
- Required session context and expiry/refresh behavior; signature dependency is recorded without exposing its value.
- Real side effect, cost/allowance source, acceptance evidence, terminal evidence, and correlation fields.
- Poll/stream protocol, deadline, documented retry/idempotency support and ambiguity reconciliation route.
- Supported mechanisms, fallback conditions, redacted fixture paths and verification results.
- State: `unmapped`, `captured`, `fixture-verified`, `live-verified`, `disabled`, or `browser-required`.

Registry entries without complete schemas cannot be `fixture-verified`; live execution cannot silently fill unknown fields. Unsupported contracts return `CONTRACT_UNAVAILABLE` before dispatch.

### 4.3 Secret handling

Raw capture is disabled by default. When explicitly requested, store it under an app-owned private directory, outside the repository, with restrictive access and a bounded retention policy. Secrets persisted at rest use the existing vault mechanism or the capture is memory-only.

Public fixtures use synthetic values and deterministic placeholders scoped to one capture. Redact headers, cookies, query values, nested JSON, form fields, signed URLs, storage credentials, emails, OTPs and binary metadata. Unknown fields are dropped or require manual review, not trusted because their names look harmless. Preserve reference relationships with placeholders, not reusable credentials or hashes of low-entropy secrets.

Normalizers must never print a failing raw record. Committed fixtures and reports receive a secret scan; `.gitignore` alone is not a confidentiality guarantee.

## 5. Ownership And Architecture

```text
Dashboard -> preload/IPC -> AutomationRunService
  -> work source / proxy lease / mailbox budget
  -> account-owned session provider
  -> CapcutEngineService -> operation strategy
       -> verified HTTP adapter -> scoped request transport
       -> browser-request adapter, if explicitly supported
       -> existing UI mission, if explicitly allowed
  <- operation receipt + task evidence + snapshot
  -> task progress service -> repositories -> SQLite
```

`AutomationRunService` continues to own run lifecycle, counters, mailbox/proxy acquisition and resource teardown. A session provider owns direct cookie storage or a browser profile, not the mission adapter. Mission code receives opaque account-scoped transport and inputs; it does not open SQLite, read `.env`, buy mail or stop unrelated profiles.

### Account session rules

- One immutable account/session identifier and proxy route per worker iteration.
- No shared cookie jar, authorization headers, SDK state or job map across accounts.
- Upload, API reads, job polling and downloads use the same configured account route unless a verified contract explicitly requires otherwise. Failure to configure the proxy fails closed; never silently use the machine IP.
- Host/origin allowlists restrict which credentials may be attached. Revalidate redirect targets and strip credentials on cross-origin transitions. Object-storage hosts receive only their scoped upload/download authorization.
- Serialize session refresh within an account; do not refresh or replay an uncertain mutation automatically. Refreshing authentication does not grant permission to resubmit a job.
- Use current supported documentation for dependency-specific transport/proxy behavior before implementation. Do not invent a signing algorithm or assume copied signed parameters remain valid.
- If a challenge or browser-only session step cannot be legitimately reproduced, mark it `browser-required`; strict HTTP blocks, auto may use the approved browser bootstrap.

## 6. End-To-End Operation Coverage

All rows require discovery. The names below are internal operations, not asserted endpoint names.

| Stage | Required behavior and completion evidence | Browser fallback boundary |
| --- | --- | --- |
| Email acquisition | Compatible mailbox reservation/purchase plus durable ownership; provider OTP read | Existing provider implementation stays outside CapCut transport |
| Signup/login/OTP | Capture session bootstrap, challenge/error branches, OTP submission and authenticated account verification | Browser bootstrap until independently verified direct session setup exists |
| Trial/eligibility | Read actual account eligibility and separate promotion display from paid subscription activation | Existing read-only UI check; never activate a paid trial during a health probe |
| Task discovery | Read account-specific task keys, hierarchy, rewards, status and availability | Popover only in permitted UI/auto mode |
| PWA/notifications | Preserve the actual task semantics, including installation/permission/push prerequisites when required | Browser platform operations remain required unless an equivalent supported operation is established |
| Inspiration | Load template `7611886117142531329`, resolve dependencies, verify free allowance, submit once and observe acceptance | UI may Minimize; HTTP has no minimize step |
| Design chat | Resolve/create the correct Design conversation; submit once, obtain server acknowledgement | No waiting for generated text/image just to establish successful submission |
| Design upload | Complete upload authorization, byte transfer, finalization and workspace attachment; obtain usable asset ID | Browser file chooser only if HTTP upload contract is unavailable |
| Canvas edit | Submit an edit for the uploaded asset in the correct Design workspace, verify acceptance and task status | Do not confuse the request with a generic chat send or discard asset/workspace linkage |
| AI Creator | Submit prompt, verify cost, confirm generation if required, track the returned job until exportable | Generation readiness is mandatory for export; do not replace it with a fixed sleep |
| Export | Export the correct ready node/asset; verify export job and output bytes/metadata | UI export only before dispatch or after a definitive no-effect response |
| Task acknowledgement/claim | Correlate real action receipt with successful `do_action` and task snapshot; process parent task status from server | Never infer parent completion from child counters alone |

For Inspiration, the observation of a free allowance on one account does not authorize paid generation on another. Missing, exhausted or unclear allowance blocks that submission unless the user separately approves its cost. `mailLimit` is not a generation-spending budget.

### Request acknowledgement versus task completion

`do_action` acknowledges a task-related action; it is distinct from upload, generation and export. Passive observation is the initial implementation. If capture demonstrates an explicit client acknowledgement is necessary after a real action, record that as a separate contract and require a reviewed acceptance gate before enabling it. Never use acknowledgement alone to substitute for the real operation.

`submission accepted`, `job complete`, `artifact exported`, and `task rewarded` are separate states. Design chat/upload/edit advance to the next eligible operation when their real prerequisite is acknowledged; they do not wait for generated pixels unnecessarily. Proof/snapshot reconciliation may remain pending in the same account while subsequent non-dependent operations execute. AI Creator must wait for generation readiness and export completion.

PWA permission and service-worker state are not assumed reproducible with arbitrary HTTP requests. Any remaining browser dependency must be visible in the capability report, not silently dropped to claim full coverage.

## 7. Operation State, Idempotency And Fallback

```text
prepared -> dispatching -> accepted -> processing -> succeeded
                       -> definitive-rejection
                       -> outcome-unknown -> read-only reconciliation
```

- Persist a local operation ID and intent before a potentially charged or state-changing dispatch. Keep session/account/stage/contract revision, state, timestamps and safe error codes. Store received job/asset references securely with appropriate scope.
- When the service offers a verified idempotency contract, reuse the same key for the same operation. A local UUID by itself does not make a remote request idempotent.
- A timeout, disconnect, malformed success response or process restart with an in-flight intent is `OUTCOME_UNKNOWN`. Do not automatically resubmit, switch to UI, or generate a fresh idempotency key.
- Reconcile using a documented/captured read-only lookup of that operation's job or task state. If no reliable lookup exists, block the operation and require operator review.
- Reads may retry transient failures with bounded backoff within the original deadline and server rate limits. Auth/configuration/validation failures are not transient retries.
- HTTP 4xx/5xx alone is insufficient to prove whether a mutation took effect; definitive rejection classification requires a validated provider response contract.
- Auto fallback is legal only before dispatch when capability is unavailable, or after proven no-effect rejection. It is forbidden after acceptance or ambiguous outcome.
- Shadow never submits the HTTP mutation in addition to UI. After a task has completed, a second run on the same completed task is not a valid equivalence test; use matched independent tasks/accounts with explicit cost approval.

## 8. Task Evidence And Persistence

Maintain a per-account evidence reducer shared by HTTP and UI paths. Each update contains task key, successful action proof if observed, snapshot status and timestamp, operation ID and evidence source. Ignore cross-account events, duplicate proofs and stale/regressing snapshots within the same task period.

- Newly performed leaf tasks require successful real-operation acknowledgement, the corresponding successful action proof, and a confirming task snapshot before being called verified.
- Tasks already complete at bootstrap and server-managed parent tasks may be complete from the authoritative snapshot without inventing a new leaf proof.
- Preserve status `2` (claimable) separately from `1` (open) and `4` (complete). Do not flatten it away in the new internal result.
- Persist on verified stage/checkpoint and before propagating a fatal error or Stop. A thrown exception must not discard earlier valid results.
- Proof without a confirming snapshot is retained as pending evidence; it does not add earned rewards or overwrite status as complete.
- Only snapshot `status=4` contributes to task-earned credit totals. Account wallet balance, generation charges and earned task credits are separate quantities.
- Include freshness, task period where provided, terminal failure and missing keys in the final report. Do not call a cached snapshot a newly fetched one.
- An empty successful, schema-valid task list is distinct from no response, auth failure or malformed data. Only the former supports `TASKS_UNAVAILABLE` for that account. It is not evidence that all workers must stop.

Run and account outcomes remain distinct: a limited batch may complete after processing its cap while one or more accounts failed. Always display both run termination reason and per-account counters.

## 9. Limits, Concurrency And Cancellation

`threadCount` is concurrent worker capacity. `mailLimit` is the maximum number of mailbox acquisition slots per run, including reused mailboxes. Missing/zero retains continuous behavior; a positive limit admits at most `min(threadCount, mailLimit)` initial workers.

- Reserve acquisition slots synchronously before awaiting provider work. Failure or release does not automatically replenish the slot in a capped run.
- Cap billable dispatches separately at the provider boundary. Retries must not turn three local slots into more than three purchase attempts. An unresolved purchase intent is not ignored on restart.
- Reuse compatible unconsumed mailboxes atomically. Report new purchases and reused mailboxes separately; three accounts is not always three new purchases.
- When the cap is reached, stop acquiring and let accepted workers finish/cleanup. Natural completion uses `MAIL_LIMIT_REACHED`, not a harness-generated Stop used to conceal overshoot.
- Preserve the existing serialized purchase critical section; do not hold a database transaction over network I/O.
- Use per-account mutation sequencing and bounded read concurrency. No host-wide lock for independent HTTP requests. A task-local dependency (asset before edit, job before export) is not a global serialization requirement.
- Global Stop cancels acquisition, reads, polling, streams and waits, forbids new mutations, persists available evidence and invokes owned-resource cleanup. Already dispatched remote work may continue; report that fact rather than asserting cancellation rolled it back.
- Never start a duplicate operation because an abandoned request later resolves. Late responses may reconcile the original operation but cannot trigger an unapproved next action.

## 10. Time Budgets And Diagnostics

Initial local watchdogs, not vendor performance guarantees:

| Operation | Maximum initial budget |
| --- | --- |
| JSON read/control request including body consumption | 30 seconds |
| Upload or artifact download | 120 seconds; bounded streaming with size limits |
| Design submission and its acceptance | 30 seconds |
| Generation and export readiness | Separate 240-second overall deadline per operation, shared by its polling requests/backoff |
| Final incomplete-task refresh | 10 seconds; skipped when a current confirming snapshot is already complete |
| Headless startup health sequence | 15 seconds overall, no mailbox/job submission |

Use a monotonic deadline through retries, streams, redirects and response parsing. A request timeout must cancel the supported transport; a local Promise race alone is not remote cancellation. Do not wrap a long sequence with a race and allow its continuation to submit more work after timeout.

Poll using the observed server contract and `Retry-After` where applicable; start with no faster than one request per second unless the contract establishes a different mechanism. Long server backoff exceeding remaining budget ends locally without resubmission. Avoid continuous GPU probes or extra browser actions in HTTP mode.

Logs and reports include run/worker identifiers, pseudonymous account reference, operation/contract revision, actual transport, sanitized origin/path, attempt, elapsed time, response classification, accepted job reference, proof/snapshot latency and cleanup state. Redact signed query strings and response bodies by default. Record timeout stages individually; do not label every input/transport timeout as a DOM failure.

Benchmark p50/p95 only with sufficient repeated samples and report the sample count. Match browser version, proxy region, task set, input/model and concurrency for comparisons. Initial target: remove artificial UI waits and mouse timeouts from promoted operations without increasing duplicate work or missing-task rate. No numeric speedup is promised until measured.

## 11. Rollout And Live Harness Contract

1. Offline contract inventory and redaction tests.
2. Read-only authenticated endpoint verification on an existing approved session; no mailbox purchase or generation.
3. Health-only probe for one then three isolated sessions. Health-only cannot call `run.start`, buy mail, register accounts or submit jobs. Browser profiles still have side effects and require authorized use.
4. One shadow run: UI writes, new parsers observe. Verify results without double submission.
5. One strict HTTP or explicitly hybrid auto run; label which was tested.
6. Two workers, then three workers, with a fresh explicit budget for each paid stage. Do not assume approval for three mail covers the cumulative one-plus-two-plus-three rollout.

Suggested harness contract for implementation: `--mission-transport`, `--threads`, `--mail-limit`, `--health-only`, and an app-owned report directory. Reject invalid combinations before launching or buying. Existing harness support must not be assumed from this spec.

The harness must pin the selected run ID, subscribe before Start, await its actual completion and teardown, and exit nonzero on incomplete tasks, fatal errors, overshoot, cleanup failures, or unknown outcomes. Infrastructure-wide failure stops new acquisitions; account-specific unavailable tasks are reported separately. Do not buy replacement accounts automatically.

Capture final counters and per-account evidence from service/DB, not stdout alone. Export a redacted JSON report and readable summary. Unexpected app exit is a failed test, not a successful process exit because the monitoring script caught the exception.

If natural limit completion is under test, do not send Stop on the last account counter before cleanup settles. A distinct Stop test is required. Rebuild/check Node SQLite ABI for Node suites, then Electron ABI for Electron harness/live startup; verify init before enabling purchases. Never delete the user's DB to repair an ABI/migration issue.

## 12. Implementation Units And Test Requirements

| Unit | Proposed source of truth / files | Required tests |
| --- | --- | --- |
| Contract normalization | `tools/http-contracts/normalize-capture.mjs`, request registry spec | nested redaction, binary exclusion, redirects, request-ID linkage, malformed input; tests in `scripts/__tests__` or explicitly included by Vitest |
| Account transport | `src/main/services/capcut/http/CapcutHttpClient.ts`, `capcutAuth.ts`, `types.ts` | two-account cookie/proxy isolation, credential allowlist, cancellation through body streaming, response validation, no unsafe retries |
| Task client/reducer | `src/main/services/capcut/http/CapcutTaskApi.ts`, `taskApi.ts` | empty versus missing list, dynamic rewards, duplicate names, task periods, stale snapshots, parent states |
| Design operations | `http/missions/inspirationAdapter.ts`, `designStudioAdapter.ts` | free allowance, chat acknowledgement, upload finalization, asset/workspace binding, ambiguous send prevents fallback |
| Creator operations | `http/missions/aiCreatorAdapter.ts`, `http/jobPolling.ts` | accepted job correlation, stream/poll timeout, real ready artifact, correct export, empty download rejection |
| Strategy/persistence | `CapcutEngineService.ts`, `runTasks.ts`, `missionRunner.ts`, `types.ts`, repositories | single writer in shadow, strict HTTP fail-before-purchase, partial progress on fatal/Stop, no replay after uncertain outcome |
| Live safety | `scripts/live-capcut-run.mjs`, `live-capcut-options.mjs`, proposed health harness | exact cap under races, failure exit codes, cleanup failure, monitoring disconnect, per-run isolation |

Keep transport schemas internal until stable. Renderer IPC exposes only validated policy/settings and sanitized progress, not arbitrary URL/header/body execution or credentials. Feature flags and shared schemas must update preload, renderer and tests together.

Persistence additions use the next unused migration number at implementation time. Never edit applied migrations. Verify upgrade of the actual prior schema, rollback, WAL/foreign keys, pending-intent restart behavior and task evidence preservation.

### Acceptance criteria

- AC-01: Every promoted operation has provenance, schema-checked fixtures, supported transport and an independently verified live receipt.
- AC-02: Strict HTTP completes its declared stages without browser launch, DOM access, mouse or UI fallback; mixed runs explicitly report browser usage.
- AC-03: Shadow produces exactly one real mutation per operation.
- AC-04: Three concurrent workers cannot cross-use session cookies, proxy route, asset IDs or jobs.
- AC-05: Three-mail cap causes no fourth acquisition or billable dispatch; ambiguous delivery does not auto-retry.
- AC-06: Free-only submission blocks when allowance is unavailable, insufficient or unknown.
- AC-07: Design stages advance after acknowledged prerequisites without waiting for generated pixels; Creator export waits for a ready artifact.
- AC-08: Task rewards/totals/statuses come from each account's server snapshot, including valid zero-task accounts and parent tasks.
- AC-09: A later fatal/Stop retains earlier task evidence without changing unknown tasks to done.
- AC-10: Body reads, polling and cleanup respect deadlines; no late response triggers another mutation.
- AC-11: Fixture scans, typecheck, lint, build, focused/full Node suites, applicable selector tests and Electron harness pass with exit codes recorded.
- AC-12: Approved live one/two/three-worker tests report results, actual transport, timestamps, costs/attempts and cleanup. One success is not a stability claim.

## 13. Relationship To The Existing Plan

This draft clarifies or corrects the earlier plan; the plan must be synchronized after spec approval:

- Add authentication/OTP/eligibility and PWA/notification discovery explicitly; do not describe a missions-only adapter as end-to-end HTTP.
- Add direct-versus-browser-request capability reporting and proxy/cookie isolation.
- Replace ambiguous shadow dual-execution wording with the single-writer rule.
- Replace blanket passive-only `do_action` wording with the evidence-gated acknowledgement contract in Section 6; no direct acknowledgement implementation is pre-approved.
- Do not change the existing default to shadow automatically; make rollout opt-in.
- Add explicit `auto` policy, safe fallback and durable uncertain-operation semantics.
- Add generation/allowance budgets distinct from mailbox limits and per-stage paid approval.
- Treat the missing historical capture archive as a discovery prerequisite and ensure capture-normalizer tests are actually included in the test runner.

Implementation approval does not itself authorize mailbox purchases, generation charges, profile mutations, remote commits or live benchmarks.
