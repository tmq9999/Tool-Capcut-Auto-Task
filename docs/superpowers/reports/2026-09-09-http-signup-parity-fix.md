# HTTP signup parity fix — implementation checkpoint

## Outcome and live status

Implemented an additive HTTP signup/onboarding sequence and corrected the legacy engine's false trial-success fallback. **The requested new one-email live registration has not been performed.** The latest continuation adds a required account-bound per-request context-provider interface; without a provider it now stops with `SIGNUP_CONTEXT_PROVIDER_REQUIRED`. No concrete native implementation that produces accepted fresh CapCut signatures is supplied by this change. Earlier `AUTH_SIGNATURE_CONTEXT_MISSING` results were local guards, not CapCut server errors. The old scratch harness that bypassed `authHttp` is not evidence for the new path.

No mailbox was purchased, no Kiot route was acquired or rotated, and no CapCut registration/claim/activation call was sent during this implementation checkpoint. A read-only mailbox-inventory check could not open the DB inside the sandbox; the permission review then timed out before execution. Availability of unused mailboxes is therefore not claimed.

## Changed behavior

### HTTP signup boundary

`httpSignup.ts` adds `signupHttpWithOnboarding`; `signupOnboarding.ts` provides typed region, broadcast, age-gate, product user-info and workspace operations. The existing `signupHttp` API is preserved for compatibility and does not become the new complete sequence automatically.

The new sequence covers region row/US → email check → age configuration/check → one send-code → caller OTP preparation → one register → response-derived broadcast row/US → product birthday persistence → matching account-info → product user-info/workspace readiness. It uses separate Passport form and product JSON request contexts and caller-owned live inputs; no token/signature/birthday generation was added.

Broadcast identity comes from the actual registration response, not a precomputed user ID. Encoded email/password and birthday stay bound to the original signup inputs. Response/context snapshots are isolated; cancellation stops subsequent callbacks/requests. Product application failures such as `ret=1014` produce an explicit blocked readiness state rather than a successful account-ready result.

Initial validation checks the caller's provider and declared capabilities before the first request. Each request receives its own prepared context immediately before dispatch; send/register signature-field guards remain at their actual operation, without requiring future signatures on unsigned region/bootstrap calls. Provider capability declarations and field-presence checks do not validate cryptographic signatures or predict platform eligibility.

### Legacy engine trial boundary

`capcut/trial.ts` adds explicit `eligible | ineligible | unknown` status. A failed read returns unknown, cannot-trial, and zero days. `isEligible` no longer treats an error as eligibility.

`CapcutEngineService.ts` blocks tasks on unknown trial status, returns an explicit unknown subscription/error and no verification receipt, and no longer substitutes seven days for zero. Existing operator policy for a successfully read ineligible result is retained. This fixes the old engine's false-positive reporting; it does not add a browser fallback to the HTTP-only flow.

## Review findings addressed before live

The first signup implementation passed permissive mocks but failed real `createHttpOnlyTransport` MIME validation: form headers had been forwarded to JSON age-gate requests. Root reproduced `CAPCUT_HTTP_ENCODING_MISMATCH` with zero native requests. The implementation now separates these contexts and tests with the real transport over an inert native driver.

Other review corrections cover early signed-context presence validation, post-registration broadcast binding, blocked product readiness, and cancellation around asynchronous boundaries. The final integration review approved literal origin routing and exact prepared query preservation within the scope of this checkpoint.

## Verification record

- Trial/engine/keyed parser focused tests: 62/62 passed; independent scoped review accepted the change.
- Signup round-2 corrected tests plus existing auth/context tests: 39/39 passed.
- Root final combined HTTP/trial/engine/CLI run after the origin/query corrections: 41 files, 357/357 passed.
- `npm run lint`: passed.
- `npm run typecheck`: two existing unrelated diagnostics only: `AutomationRunService.test.ts:654` missing `verification.complete`; `AutomationWorkSource.ts:12` redundant named type modifier.
- Root production preflight with synthetic non-secret inputs: `AUTH_SIGNATURE_CONTEXT_MISSING`, zero request dispatches, zero purchases and zero proxy acquisitions. This is an offline guard check, not a live account test.
- Final signup re-review: all round-2 findings addressed and no new breakage; exact 13-request origin mapping is asserted for row/US Passport, www product/account and edit workspace.
- Root recorded-response fixture: the corrected orchestration consumed 13 actual saved capture response bodies through an inert driver, verified account identity and one workspace, and returned ready for that historical fixture. Request values/context were synthetic; no captured credential/signature was transmitted externally. This verifies response-schema compatibility, not a fresh live registration. Evidence: `.superpowers/sdd/2026-09-09-http-signup-parity-fix/recorded-signup-verification.json`.

No build or full-flow success is claimed. Synthetic current-context values in tests are fixtures, never a usable live signing implementation.

## Remaining integration and live gate

The additive signup API requires a caller that supplies current, request-specific prepared context and legitimate onboarding data. It is not wired into the Electron automation runner or mailbox-purchasing pipeline in this checkpoint. In particular, the pure Passport metadata builder does not produce the required signatures. Browser/CDP fallbacks, captured-value replay, unsigned bypass and invented onboarding inputs were not added to make a live attempt appear possible.

### Per-request provider continuation

`SignupOnboardingInput` now requires `accountId` and `contextProvider`. This is an intentional source-level change for callers of the new onboarding API; the older `signupHttp` and HTTP primitives remain compatible. Consumers must implement `SignupRequestContextProvider` and declare exact operation/origin/method/path/encoding support, then return the current prepared request context.

The interface is wired into all 13 existing onboarding requests, not a second disconnected harness. The descriptor and copied query are frozen before `prepare()`. Session snapshots remain account-local. Scope excludes cryptographic generation, browser signing, module/service discovery, code evaluation and trial/checkout/reward actions. The interface itself cannot supply the missing implementation.

The second review correction also snapshots initial and callback-prepared bodies before awaiting the provider and reuses those snapshots for dispatch. Account/provider identity and provider methods are pinned for the run, `supports()` must return literal `true`, and provider exceptions produce bounded errors. Deferred-provider tests reproduce and prevent wire-body changes during preparation. Independent scoped re-review passed; final focused signup/auth tests are 37/37, and the updated historical-response verifier checks 13 prepared-body/dispatch matches with an explicitly synthetic provider.

Independent live-entrypoint inspection confirmed there is no concrete native provider in current production code/scripts, and the CLI still has only public bootstrap or existing-session ledger modes. No new live harness was added just to produce another missing-provider error.

This missing implementation is not merely a user configuration problem. The requested live objective remains incomplete. Do not present provider-interface tests as accepted live signature generation or a newly registered account.

Consequently the requested outcome is only partially delivered: local flow/validation fixes exist and are testable, but a new live signup cannot honestly be reported as run or fixed until a legitimate current signer/context source and onboarding input are supplied. The separately recorded historical account remains historical evidence, not this change's live result. No mailbox or Kiot lease was acquired in this continuation.

Work remains uncommitted in the existing dirty checkout. Prior staged changes, capture files and private evidence were preserved.

Superpowers TDD and independent review exposed and corrected MIME and origin errors before any live purchase. The local validation and documentation workflow keeps that verification distinct from the unperformed live test.
