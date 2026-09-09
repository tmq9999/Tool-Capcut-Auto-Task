# HTTP-First CapCut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real direct HTTP execution for verified CapCut stages without regressing the existing UI automation fallback.

**Architecture:** Keep UI as the default and safety fallback. Add an account-scoped HTTP client that reuses only captured browser cookies/headers and sends validated requests; each stage reports `direct-http`, `browser-http`, or `ui`. No endpoint or payload is invented: a stage stays UI-only until its redacted fixture and live side-effect test pass.

**Tech Stack:** TypeScript, Playwright request context, Vitest, existing CapCut mission runner and evidence reconciliation.

**Spec:** `docs/superpowers/specs/2026-09-06-capcut-http-first-design.md`

## Global Constraints

- `ui` remains the default transport.
- `shadow` never duplicates a mutating UI action.
- `http` preflight blocks if a required stage lacks a verified contract.
- `auto` falls back only before dispatch or after a proven no-effect rejection.
- Every successful task still requires real operation evidence, `do_action`, and a fresh task snapshot.
- Never commit cookies, signed URLs, mailbox data, or raw request bodies.

### Task 1: Contract fixtures and HTTP primitives

**Files:** Create `src/main/services/capcut/http/CapcutHttpClient.ts`, `src/main/services/capcut/http/contracts.ts`, and redacted fixtures under `tools/http-contracts/fixtures/`; test with Vitest.

- [ ] Add failing tests for request allowlisting, credential redaction, cancellation, status validation, and ambiguous mutation outcomes.
- [ ] Implement account-scoped request context and typed responses.
- [ ] Add fixture schemas for `task_list`, `do_action`, canvas save/upload-sign, and creator endpoints only where captures contain complete shapes.
- [ ] Run focused tests.

### Task 2: Passive task API adapter

**Files:** Modify `src/main/services/capcut/taskApi.ts`, `src/main/services/capcut/runTasks.ts`; create `src/main/services/capcut/http/taskApi.ts`.

- [ ] Add `getTaskList()` and acknowledgement adapters behind `missionTransport`.
- [ ] Keep browser-observed proof reconciliation as the default until live equivalence passes.
- [ ] Add tests proving UI and HTTP paths share the same completion gate.

### Task 3: Stage adapters

**Files:** Create `src/main/services/capcut/http/designStudio.ts` and `src/main/services/capcut/http/videoStudio.ts`; modify mission dispatch only.

- [ ] Implement one stage at a time from verified fixtures.
- [ ] Keep generation/export polling server-side only when response contracts identify stable job IDs and terminal states.
- [ ] Never replace UI generation/upload/export with guessed endpoints.

### Task 4: Transport policy and rollout

**Files:** Modify shared automation schemas, `AutomationRunService`, renderer settings, and diagnostics.

- [ ] Add `missionTransport: ui | shadow | http | auto`, default `ui`.
- [ ] Report actual transport per stage and preflight failures without purchasing mail.
- [ ] Add one-worker shadow, then one-worker HTTP live verification before multi-worker rollout.

### Task 5: Verification and cleanup

- [ ] Run typecheck, lint, build, selectors, and full Vitest.
- [ ] Run a non-billable HTTP health check.
- [ ] Run one explicitly approved live HTTP account only after all required contracts are fixture-verified.
- [ ] Revert only accidental UI-only changes introduced by this correction; preserve prior user work.

