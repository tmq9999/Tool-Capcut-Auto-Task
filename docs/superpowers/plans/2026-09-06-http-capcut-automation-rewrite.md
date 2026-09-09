# HTTP CapCut Automation Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` task-by-task.

**Goal:** Replace fragile CapCut UI automation with evidence-backed HTTP orchestration wherever the observed web client already performs the same operation, while retaining Playwright only as a verified fallback for actions that require browser state.

**Architecture:** Split the engine into four layers: authenticated CapCut HTTP transport, task/action API clients, mission adapters, and proof reconciliation. Each adapter consumes a captured request contract and returns a typed job/proof result; it never invents tokens, signatures, IDs, or payload fields. The existing `TaskStore` remains the source of task evidence, and UI fallback is selected per mission only when the HTTP contract cannot be proven.

**Tech Stack:** TypeScript, `fetch`, Playwright Core, Vitest, Electron, captured `network.ndjson`, CapCut task APIs, Multilogin API-v3.

**Spec:** [CapCut HTTP-First Automation Specification](../specs/2026-09-06-capcut-http-first-design.md), approved for implementation in conversation. This approval does not authorize new paid runs. Execute inline in the existing working directory as requested; preserve the uncommitted baseline.

## Global Constraints

- Do not send a new live request until the exact method, URL path, body, required headers, auth material, and response shape are captured and fixture-tested.
- `do_action` is a task acknowledgement/proof endpoint, not a substitute for generation, upload, editing, or export requests.
- Never log cookies, tokens, `msToken`, `X-Bogus`, `X-Gnarly`, mailbox secrets, raw prompts containing secrets, or raw vendor payloads.
- Never retry a billable mailbox order after an ambiguous transport failure without an observed idempotency contract.
- Newly executed leaf tasks require a real operation receipt, matching action proof and a fresh task snapshot. Bootstrap-complete and server-managed parent tasks use authoritative snapshot state.
- Direct HTTP and browser-mediated requests must be distinguished. Strict HTTP blocks before acquisition if session setup or any required operation is not direct-capable.
- Keep `ui` as the existing default. Shadow has a single writer (UI) and never dispatches a duplicate HTTP mutation. Auto fallback is forbidden after an accepted/ambiguous submission.
- Account transports must isolate cookies, proxy routes and job IDs; Node fetch does not inherit browser settings. No browser-only auth signing behavior is assumed reproducible.
- Preserve human-paced UI fallback and current cleanup semantics until the HTTP adapter passes live shadow verification.
- `mailLimit=3` remains the hard cap for the three-worker live test.

---

### Task 1: Build the capture and request-contract inventory

**Files:**
- Create: `docs/superpowers/specs/2026-09-06-capcut-http-request-contracts.md`
- Create: `tools/http-contracts/README.md`
- Create: `tools/http-contracts/normalize-capture.mjs`
- Test: `scripts/__tests__/normalize-capture.test.mjs` (included by existing Vitest config)
- Inspect only: `.capture/*/network.ndjson`, `.capture/*/clicks.log`, `.capture/*/transitions.log`, `.debug/*`

**Interfaces:**
- Normalizer input: HAR 1.2 or NDJSON request/response pairs, including the existing response-only proof fixture format.
- Normalizer output: structural, non-replayable records with capture-local opaque references. Unknown values/field names are redacted, absent request metadata stays absent, and unsupported binary/stream bodies are explicitly omitted. No fixture is auto-promoted to a verified contract.

- [ ] Inventory request sequences for login/signup/OTP, task list, Inspiration send, Design Studio chat, upload, canvas prompt, AI Creator prompt, generation status, export, and `do_action`.
- [ ] Record the request immediately before and after every user action; distinguish UI acknowledgement from backend job creation.
- [ ] Redact secrets deterministically and write fixtures with stable placeholders.
- [ ] Add tests proving normalization removes cookies/tokens/raw mailbox data while preserving method/path/body shape/status.
- [ ] Stop if a mission has no complete request/response contract; mark it UI-fallback instead of guessing.
- [ ] Cover signup/login/OTP/eligibility, PWA/notification prerequisites and acknowledgement/claim discovery, not just creative missions.

### Task 2: Add authenticated CapCut HTTP transport

**Files:**
- Create: `src/main/services/capcut/http/CapcutHttpClient.ts`
- Create: `src/main/services/capcut/http/capcutAuth.ts`
- Create: `src/main/services/capcut/http/types.ts`
- Test: `src/main/services/capcut/__tests__/capcutHttpClient.test.ts`

**Interfaces:**
- `CapcutHttpClient.request<T>(request, signal): Promise<CapcutHttpResponse<T>>`.
- Auth context is injected by an account-owned session provider; direct session setup is promoted separately from browser bootstrap. No token scraping from disk or `.env`.
- Request metadata includes safe stage name, elapsed time, HTTP status, and correlation id.

- [ ] Add failing tests for successful JSON, non-JSON error, cancellation, timeout, and secret-redacted diagnostics.
- [ ] Implement bounded fetch with AbortSignal and normalized error codes.
- [ ] Implement request headers/query construction only from captured contract definitions.
- [ ] Add an opt-in recording mode that stores redacted request metadata, never raw credentials.

### Task 3: Implement task-list and proof client

**Files:**
- Create: `src/main/services/capcut/http/CapcutTaskApi.ts`
- Modify: `src/main/services/capcut/taskApi.ts`
- Test: `src/main/services/capcut/__tests__/capcutTaskApi.test.ts`

- [ ] Reuse the existing `parseTaskList`/`parseDoAction` parsers with HTTP response fixtures.
- [ ] Implement `getTaskList()` only with a verified request contract; preserve valid empty list separately from missing/malformed response. Begin with passive `do_action` ingestion. Any necessary direct acknowledgement after a real action needs its own reviewed contract as defined by spec Section 6.
- [ ] Add correlation checks: action key, op id, user/account id, timestamp, and task status transition.
- [ ] Add tests for locale-independent titles, per-account rewards, duplicate action events, stale snapshots, and missing task keys.

### Task 4: Reverse-engineer and implement Inspiration/Design Studio adapters

**Files:**
- Create: `src/main/services/capcut/http/missions/inspirationAdapter.ts`
- Create: `src/main/services/capcut/http/missions/designStudioAdapter.ts`
- Create: `src/main/services/capcut/http/jobPolling.ts`
- Test: `src/main/services/capcut/http/missions/__tests__/inspirationAdapter.test.ts`
- Test: `src/main/services/capcut/http/missions/__tests__/designStudioAdapter.test.ts`

- [ ] Implement Inspiration only after fixture proves the request that submits the prompt/template; return job id and proof correlation.
- [ ] Implement AI chat request without waiting for textual response when the task contract proves send acknowledgement is sufficient.
- [ ] Implement image upload with the observed upload endpoint/multipart shape and verify asset id.
- [ ] Implement canvas-edit request with observed asset id, prompt, and job/status polling; do not wait for generated pixels if task proof is send-based.
- [ ] Add failure tests for expired auth, missing asset id, request validation errors, job timeout, and stale task status.
- [ ] Keep the current UI adapter behind a feature flag until HTTP shadow mode matches all captured outcomes.

### Task 5: Reverse-engineer and implement AI Creator adapters

**Files:**
- Create: `src/main/services/capcut/http/missions/aiCreatorAdapter.ts`
- Modify: `src/main/services/capcut/missions/videoStudio.ts` only for adapter boundary/fallback.
- Test: `src/main/services/capcut/http/missions/__tests__/aiCreatorAdapter.test.ts`

- [ ] Capture the real prompt submission, credit confirmation, generation job, node creation/status, export request, and download response.
- [ ] Implement generation polling with one bounded deadline and cancellation.
- [ ] Implement export only after node readiness; verify download/job success from response, not click completion.
- [ ] Add tests for existing-node export, blank draft, generation timeout, export timeout, duplicate action, and provider error.
- [ ] Preserve UI fallback for any request whose contract depends on browser-only signed state not yet reproducible.

### Task 6: Integrate HTTP-first mission strategy and partial persistence

**Files:**
- Modify: `src/main/services/CapcutEngineService.ts`
- Modify: `src/main/services/capcut/runTasks.ts`
- Modify: `src/main/services/capcut/missionRunner.ts`
- Modify: `src/main/services/capcut/types.ts`
- Test: `src/main/services/capcut/__tests__/httpMissionStrategy.test.ts`
- Test: `src/main/services/__tests__/automationTaskProgress.test.ts`

- [ ] Add `missionTransport: 'http' | 'ui' | 'shadow' | 'auto'`, keeping `ui` as default; report actual direct-http/browser-http/ui for each stage.
- [ ] Shadow executes UI as sole writer and prepares the proposed HTTP request offline. Never run both mutation paths. Compare live HTTP against a separately approved matched task/account, not a completed task.
- [ ] Before any mutation, persist intent and operation ID. Unknown outcome blocks retry/fallback; local UUID alone is not remote idempotency.
- [ ] Verify Inspiration free allowance per account before submit. Mailbox caps do not authorize generation charges.
- [ ] Persist verified partial task rows before propagating a fatal renderer/HTTP error.
- [ ] Ensure task status comes from fresh CapCut task snapshot; proof-only actions remain open when snapshot is missing.
- [ ] Add account outcome tests for HTTP timeout, UI fallback, renderer failure, and mixed group completion.

### Task 7: Add health-only and staged live harness gates

**Files:**
- Modify: `scripts/live-capcut-run.mjs`
- Modify: `scripts/live-capcut-options.mjs`
- Create: `scripts/live-capcut-health.mjs`
- Test: `scripts/__tests__/live-capcut-options.test.mjs`
- Create: `docs/superpowers/reports/2026-09-06-http-live-rollout.md`

- [ ] Add `--health-only` that launches API-v3 profiles with no mailbox acquisition, runs transport/renderer/request-contract checks, and stops each profile.
- [ ] Add `--mission-transport=http|shadow|ui|auto` and print selected and actual mechanisms in every run header.
- [ ] Enforce `--mail-limit=3` and abort if accepted/acquired/purchased count exceeds 3.
- [ ] Stage live rollout: health-only (no billing), one worker shadow, one worker HTTP-first, two workers, then three workers.
- [ ] Stop new acquisitions on infrastructure/unknown-purchase failures. Distinguish account-specific validated empty task lists from bootstrap transport failure. Preserve partial rows, nonzero failure exit codes and cleanup diagnostics.
- [ ] Health-only never calls run.start or submits mailbox/signup/generation operations; require profile-operation approval. Paid rollout stages need separate explicit budgets.
- [ ] For natural-limit tests, await MAIL_LIMIT_REACHED and cleanup instead of injecting Stop at the last account counter.
- [ ] Report per-account task count/reward from task list, mission transport, stage timings, profile cleanup, and unresolved fallbacks.

## Acceptance Gates Before Paid 3-Worker Live

1. Normalized fixtures cover every HTTP-first mission request and contain no secrets.
2. All focused/full local tests, typecheck, lint, build, selectors, Electron harness, and SQLite tests pass.
3. Health-only passes for three API-v3 profiles without purchasing mail.
4. One-worker shadow and HTTP-first runs agree on task proof/status for a real account.
5. Two-worker run completes without renderer timeout or duplicated job/order request.
6. Three-worker run uses exactly three acquired mailboxes and no fourth acquisition.
7. Every profile/proxy/reservation is cleaned up; partial task progress remains in DB on failure.
