# HTTP-Only Headless CapCut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-free HTTP worker that performs and verifies all available CapCut tasks, including 12/12 live proof on one fresh account.

**Architecture:** Replace mission execution with account-scoped HTTP adapters. A worker owns its proxy, cookies, headers, jobs and operation journal; no `Page`, Chromium, Playwright, CDP, DOM, mouse or keyboard is created. Unknown contracts fail closed before mutation.

**Tech Stack:** Strict TypeScript, Playwright `APIRequestContext` only (or equivalent HTTP transport), Zod, Vitest, Electron main-process services, SQLite repositories.

**Spec:** `docs/superpowers/specs/2026-09-06-capcut-http-first-design.md` (corrected by this plan's HTTP-only boundary)

## Global Constraints

- `http-only` must not launch or attach to any browser process.
- No bridge, route interception, DOM action, synthetic event, or UI fallback.
- Rewards, task totals and task keys come from each account's live `task_list`.
- Never replay an uncertain mutation; reconcile read-only or stop.
- Preserve account, proxy, cookie, mailbox and job isolation.
- Paid mail/generation requires the existing explicit opt-in flags.

### Task 1: Freeze the HTTP-only Boundary

**Files:** Modify `src/main/services/capcut/types.ts`, `CapcutEngineService.ts`, `src/shared/schemas/automation.schema.ts`; test `src/main/services/capcut/http/__tests__/httpOnlyPolicy.test.ts`.

- [ ] Add `missionTransport: 'ui' | 'http-only'` and reject HTTP-only runs when a browser launcher, `Page`, or UI mission is requested.
- [ ] Remove `MutationBridge` from the HTTP-only path; retain it only as explicitly disabled legacy diagnostic code.
- [ ] Add a preflight assertion that no Electron browser/profile launch occurs before any mailbox purchase.
- [ ] Test rejection and zero side effects for invalid HTTP-only configuration.

### Task 2: Implement Account-Scoped HTTP Session

**Files:** Create `src/main/services/capcut/http/accountSession.ts`, `src/main/services/capcut/http/httpTransport.ts`; modify `CapcutHttpClient.ts`; tests under `src/main/services/capcut/http/__tests__/`.

- [ ] Define `AccountHttpSession` containing proxy route, cookie jar, locale, device identifiers, dynamic headers and expiry.
- [ ] Implement allowlisted origin/path requests with bounded body streaming and monotonic deadlines.
- [ ] Implement session bootstrap using captured, documented HTTP contracts only; return `CONTRACT_UNAVAILABLE` instead of opening a browser.
- [ ] Test two sessions cannot share cookies, proxy, authorization headers, asset IDs or job IDs.

### Task 3: Contract Registry and Request Signing

**Files:** Create `src/main/services/capcut/http/contractRegistry.ts`, `signing.ts`; modify `tools/http-contracts/*`; tests in `scripts/__tests__` and HTTP tests.

- [ ] Normalize captured contracts into schemas containing provenance, dependencies, response validation and supported transport.
- [ ] Implement only the observed signing/session mechanism; do not invent or replay stale signatures.
- [ ] Reject missing, expired or account-mismatched dynamic fields before dispatch.
- [ ] Add fixtures for every endpoint used by the live flow and secret-redaction tests.

### Task 4: Task Discovery and Proof Reducer

**Files:** Create `src/main/services/capcut/http/taskClient.ts`, `taskEvidence.ts`; modify `taskApi.ts` and persistence mapping.

- [ ] Implement live `task_list` reads, preserving status `1`, `2`, and `4`, parent/child relations, task period and dynamic reward.
- [ ] Implement proof correlation for `do_action` without treating acknowledgement alone as completion.
- [ ] Persist pending, verified and unknown states with freshness and operation IDs.
- [ ] Test stale snapshots, duplicate proofs, zero-task accounts and regional reward differences.

### Task 5: HTTP Inspiration Adapter

**Files:** Create `src/main/services/capcut/http/missions/inspiration.ts`; modify `urls.ts` only for data constants; tests for allowance and job reconciliation.

- [ ] Discover the current Inspiration contract for the configured account and template key `7611886117142531329`.
- [ ] Check free allowance and require `credits_amount=0`; block if unavailable or ambiguous.
- [ ] Submit and poll the server job through HTTP, then correlate `do_action` and a fresh task snapshot.
- [ ] Never implement a UI minimize or fixed sleep.

### Task 6: HTTP Design Studio Adapters

**Files:** Create `designChat.ts`, `imageUpload.ts`, `canvasEdit.ts` under `src/main/services/capcut/http/missions/`; tests with contract fixtures.

- [ ] Implement workspace/resource resolution and thread creation directly over HTTP.
- [ ] Implement chat acknowledgement without DOM text entry or send click.
- [ ] Implement sign, byte upload, commit, image metadata and canvas attachment with the same account session.
- [ ] Submit canvas edit over HTTP, inspect artifact readiness, then record proof/snapshot.

### Task 7: HTTP AI Creator and Export

**Files:** Create `aiCreator.ts`, `jobPolling.ts`, `export.ts`; modify existing creator helpers to remove browser assumptions.

- [ ] Implement draft creation, prompt submission, cost/allowance validation and confirmation through HTTP.
- [ ] Poll the observed SSE/JSON job contract using HTTP response streaming, `Retry-After`, deadlines and no duplicate mutation.
- [ ] Query the ready asset, download bounded output bytes, verify content and export server-side.
- [ ] Correlate send, generate and export proofs with a fresh `task_list`.

### Task 8: Replace Engine Mission Dispatch

**Files:** Modify `src/main/services/CapcutEngineService.ts`, `runTasks.ts`, `AutomationRunService.ts`; create `httpOnlyRunner.ts`.

- [ ] Route `missionTransport='http-only'` exclusively to the HTTP runner.
- [ ] Keep mailbox/proxy acquisition and cleanup in `AutomationRunService`; pass only validated session handles into the runner.
- [ ] Sequence dependencies per account while allowing independent account workers to run concurrently.
- [ ] Persist each operation before dispatch and retain progress on Stop, fatal error or unknown outcome.

### Task 9: Limits, Cancellation and Observability

**Files:** Modify `AutomationRunService.ts`, schemas, repositories and `scripts/live-capcut-run.mjs`.

- [ ] Enforce `mailLimit` before acquisition and prevent replacement purchases after the cap.
- [ ] Add `--mission-transport=http-only`, `--mail-limit`, `--health-only` and nonzero exits for incomplete/unknown results.
- [ ] Clear runtime logs at run start and emit sanitized operation receipts with account/run IDs, endpoint paths, timing and proof state.
- [ ] Test cancellation, races, cleanup, limit overshoot and process restart with in-flight intents.

HTTP-only verification entrypoint: `node scripts/live-http-only.cjs --session=<private-session.json>`.
The session file is an operator-provided private artifact and is never generated
from UI/browser state by this harness.

### Task 10: Verification and Live Acceptance

**Files:** Modify/add `docs/superpowers/reports/2026-09-07-http-only-live.md`, live harness scripts and tests.

- [ ] Run fixture redaction tests, typecheck, lint, build and focused/full Vitest suites.
- [ ] Run HTTP-only health probe with no browser process and no mailbox purchase.
- [ ] Run one fresh paid live account only after explicit opt-in; capture a journal beginning before the first task mutation.
- [ ] Accept only when the same account shows HTTP receipts, successful proofs and a fresh server snapshot with all 12 available tasks at status `4`; otherwise keep the goal open.
