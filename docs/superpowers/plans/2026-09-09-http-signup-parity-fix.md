# HTTP signup parity and one-account verification plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the HTTP-only registration/session path with the captured account-onboarding sequence and prevent false success when product readiness or trial reads fail, then verify one authorized account without mutation beyond registration.

**Architecture:** Keep CycleTLS as the transport and one account-specific proxy/CookieJar per run. Extend typed HTTP boundaries for response-derived auth context and product onboarding; keep trial offer parsing read-only and keyed. Production results distinguish registration identity, onboarding/workspace readiness, offer eligibility, and task proof.

**Tech Stack:** TypeScript, CycleTLS native transport, tough-cookie, Vitest.

**Spec:** `docs/capcut-api/2026-09-09-reread/README.md`, `docs/capcut-api/2026-09-09-reread/auth-trial.md`, `docs/capcut-api/2026-09-09-reread/remaining-http.md`.

## Global Constraints

- CycleTLS only for HTTP-only paths; no Playwright/Chromium/CDP/browser fallback.
- Keep KiotProxy/account/session/CookieJar isolated; no captured credential/token/signature replay across accounts.
- Trial checking is read-only; never claim/activate/checkout/pay.
- Registration mutations are single-attempt and require caller-supplied current OTP/session context; no automatic resend/retry.
- Do not invent birthdays, signatures, `X-Bogus`, `X-Gnarly`, `sign`, `device-time`, or account/workspace IDs. Unsupported context fails closed with a typed result.
- Preserve unrelated dirty work; no reset/stash/stage/commit/push.
- Use TDD: failing regression test first, then minimal implementation and focused verification.

## Tasks

### Task 1 — HTTP signup context and onboarding parity

Files: `src/main/services/capcut/http/httpSignup.ts`, a focused onboarding/context module and tests under the same HTTP directory. Add typed operations for captured region/auth-broadcast and age-gate calls only where legitimate caller data is supplied. Propagate response-derived context through the sequence rather than discarding response headers/data. Keep signup identity verification strict. Do not implement signing formulas or invent a birthday.

Acceptance: tests prove captured order/body shapes, response context is passed to the next step, invalid/missing legitimate onboarding input fails before mutation, and no retry/resend occurs. Existing signup tests remain green.

Review correction, round 1: Passport form context and product JSON context must be separate typed records. Product query can be empty; do not require/copy Passport aid/webid/query onto every JSON endpoint. Auth broadcasts are prepared after the registration response and bound to its sec_user_id/screen_name. Product user_info and workspace results have explicit ready/blocked states; HTTP200 ret1014 never yields ready. Tests use real createHttpOnlyTransport around an inert NativeContext and verify MIME, query, cancellation, context/account identity binding and zero-request preflight failure. No signature generation is added.

### Task 2 — Production readiness/trial result boundary

Files: current production trial/readiness boundary and focused tests. Remove fail-open eligibility on read error; represent `unknown` explicitly and do not substitute seven days. Ensure an application `ret=1014` user/workspace response cannot produce an overall successful account readiness result. Do not activate trial or run tasks.

Acceptance: regression tests fail on the old fallback and pass after the fix; keyed batch parser behavior for the user-provided VIP response remains eligible; missing/error response remains unknown.

### Task 3 — Integration verification

Run focused HTTP tests, full lint, typecheck (record only known baseline errors), and offline capture/live fixture checks. Review each task diff. Only after all local gates pass, use one fresh authorized mailbox and one fresh KiotProxy lease; record every step and release the lease. No full 12-task mutation run.

Execution gate: missing native current-session signing/provider context or legitimate birthday data blocks the live run before mailbox purchase/proxy acquisition. The old scratch harness bypasses authHttp assertions and must not be used as evidence of the corrected production sequence. Local synthetic transport fixtures do not satisfy this live gate.

## Evidence output

Write implementation and live verification findings to `docs/superpowers/reports/2026-09-09-http-signup-parity-fix.md`. Include exact commands/results, request IDs/paths (not secrets), mismatches, and remaining unknowns. Do not claim full-flow completion unless every required product proof exists.

## Continuation — per-request context wiring

The current user approves implementing the missing caller/provider wiring into the existing onboarding sequence. The change is confined to `httpSignup.ts`, `signupOnboarding.ts`, their focused test and the recorded-response verifier. This is an interface integration, not a concrete CapCut SDK implementation and not a new live runner.

- [x] Require account ID and an opaque context provider on `signupHttpWithOnboarding`; preserve legacy `signupHttp` and lower primitives.
- [x] Describe all 13 request capabilities with exact origin, method, path and encoding; check declared support before request dispatch.
- [x] Pass a frozen descriptor, serialized body, query and response-derived session snapshot to the provider before each request; validate returned context per operation.
- [x] Verify awaited provider calls cannot change the originally prepared body/account/provider binding; strict support/error boundaries and body snapshot regression.
- [x] Re-review and run real transport/inert-driver tests plus recorded-response fixture with a clearly synthetic provider; report separately from live.

No concrete native signing provider or legitimate live onboarding configuration exists in the inspected paths. Adding this interface does not change that fact. Do not count supported() or placeholder fixture strings as valid request signatures, and do not buy another mailbox to rediscover the same missing implementation.
