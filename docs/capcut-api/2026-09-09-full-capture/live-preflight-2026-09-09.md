# Live native-HTTP preflight — 2026-09-09

This run was intentionally bounded before any account mutation. It verifies the public bootstrap endpoints and the live cookie/header shape only; it is not a full signup or 12-task run.

**Historical pre-CycleTLS run.** The user subsequently required CycleTLS exclusively and rejected all browser-assisted auth/fallback. APIRequestContext used by this historical probe is no longer the HTTP-only session transport. Current implementation and verification are recorded in `docs/superpowers/reports/2026-09-09-cycletls-native-transport.md`.

## Run identity

- Run ID: `150860a3-074e-4012-bc6d-c00032d74c86`
- Mechanism: native HTTP (`playwright-core` `APIRequestContext`), no browser
- Proxy: direct public pre-auth preflight only; no account/proxy lease
- Mailbox purchase: 0
- Business mutations: 0
- Trial activation/payment: 0
- Evidence: local ignored artifact under `.superpowers/sdd/2026-09-09-one-http-live/150860a3-074e-4012-bc6d-c00032d74c86/`

## Observed live responses

| Step | Result | Comparison to capture | Notes |
|---|---|---|---|
| `GET https://capcut.com/` | HTTP 301, 85 ms | Match to capture item #1 | Location is `https://www.capcut.com/`; no cookies. |
| `GET https://www.capcut.com/` | HTTP 200, 307 ms, 230,368 bytes | Status/role match; body hash differs from capture | Live set `ttwid` and `_tea_web_id`; JSON script blocks present. |
| `GET https://www.capcut.com/login-embed` | HTTP 200, 351 ms, 60,074 bytes | Status/role match; body hash differs | Live set `capcut_locale`, `ttwid`, `_tea_web_id`, `x_logid`; **did not set `uifid`**, which was set in capture item #81. |

The live request supplied only `Accept: text/html,application/xhtml+xml`; no secret, account header, OTP or signature was logged. Cookie values were not printed. The live context was disposed after the third response.

## Mismatch classification

1. `uifid` missing on live `/login-embed` is a real observed mismatch, but not yet a root cause. Possible variables include current server/deployment behavior, consent/device state, request header superset, IP/region and capture age. It must not be “fixed” by inventing or copying the old cookie.
2. Body hashes differ because this is a current live deployment versus a Sep 9 capture. Hash difference is evidence of drift, not a failure by itself.
3. Public bootstrap does not validate authenticated auth, commerce, trial offer parsing, LuckyCat actions, Design, Creator or export.

## Why the full flow stopped

- The current environment has `VERIFY_GMAIL94_BUY` configured but disabled (`0`); buying a new mailbox is billable and remains fenced by project policy.
- Native signup requires a fresh mailbox OTP and client-generated passport/anti-abuse fields. Existing `httpSignup.ts` deliberately requires the caller to supply `AuthRequestContext` and `prepareRegistration`; it does not generate `sign`, `X-Bogus`, `X-Gnarly`, SDK state or OTP.
- The current `HttpOnlyRunner` rejects operations whose contracts are not `fixture-verified` or `live-verified`; there is no approved full 12-task operation registry for a fresh account.

Therefore the run stopped at `stoppedBefore=signup` with `fullFlowExecuted=false`, without guessing, replaying capture credentials or running UI as a substitute for HTTP-only validation.

## Per-step readiness, not live results

The following are source/capture mismatches found by read-only review, **not failures observed from a new live account**:

| Step | Evidence / current limitation | Required change before full native acceptance |
|---|---|---|
| Production entry | `main.ts:141` builds the provider stack without an HTTP-only runner; `AutomationRunService.ts:2439` explicitly rejects it before mailbox purchase. | Supply a real tested account runner; do not bypass the guard. |
| Signup/login | `authHttp.ts:11`, `httpSignup.ts:9` require pre-prepared dynamic context/registration fields. | Fresh legitimate client-state/encoding/OTP provider; existing-user login is a separate uncaptured branch. |
| Trial check | Earlier map omitted JSON-encoded `response` in #3163. | Use corrected offer parsing; never equate current inactive subscription with no offer. |
| Notification/PWA | `httpMissionStrategy.ts:39` marks both unsupported. | Prove the actual requested effect through the accepted native flow. Reward-only mutation is not a replacement; browser-assisted fallback is rejected by the user. |
| Try Inspiration | `inspiration.ts:95` returns accepted for queued/processing job. | Follow `/lv/v1/effect/genai/task/query` to terminal result/artifact on the same account. |
| Design | `designStudio.ts:21` returns thread/HTTP stream body, not complete product/reward proof. | Parse terminal SSE, resource/save linkage and separate LuckyCat reconciliation. |
| Creator/export | `creatorExport.ts:18` validates an image asset download. | Do not certify a video export from image bytes; capture actual product export behavior. |
| Streaming cookies | `httpOnlyTransport.ts:147` rejects responses containing Set-Cookie; captured Design run/start rotates msToken. | Implement validated per-account streaming-cookie updates before native SSE acceptance. |

The named `scripts/live-http-only.cjs` only reads the ledger from supplied session material; its name does not make it a full-flow signup/mission command. Running existing `live-fresh-*` scripts would use captured request templates and/or a browser signing/session dependency, not prove native HTTP-only.

Offline checks freshly run by the controller: six auth/runner/CLI files, 37 tests passed; three transport/runner files, 34 tests passed (overlapping sets, not 71 unique tests). Separate reviewer runs reported 20 HTTP suites/153 tests and eight script suites/171 tests; their broader runtime-integration attempts ran out of the Node 4 GB heap. No claim of full-suite/runtime correctness is made.

## Next gated execution

1. Approve one disposable mailbox source and explicitly enable its billable-provider flag; otherwise provide a pre-created account/session with consent.
2. Implement and verify the missing native-auth/full-flow harness with CycleTLS. Browser-assisted auth/session/fallback is prohibited by the user's clarified requirement. Do not reuse the private Sep 9 capture.
3. Run only read-only auth/account/workspace/offer checks first. Parse nested commerce `batch_get.response` before deciding eligibility: in the original capture, offers `[0]` and `[1]` had `can_trial=true`, 7 days, price 0; user-level current-subscription flags remained false because trial was not activated.
4. For each mutation, use `prepare -> one action -> fresh product proof -> LuckyCat snapshot`; reconcile timeouts before retry. Stop before payment or trial activation unless separately approved.
5. Record endpoint/status/body-shape mismatches per step, then decide whether to implement the full HTTP-only registry. No 10–20 worker scale test before one fresh account completes with independent state.
