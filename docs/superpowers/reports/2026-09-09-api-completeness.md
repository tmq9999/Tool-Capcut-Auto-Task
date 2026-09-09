# API completeness checkpoint — 2026-09-09

Implemented and checked an immutable Passport metadata builder and a read-only trial-offer API/parser for the CycleTLS path. This is an offline implementation checkpoint, **not** a completed native-HTTP full-12-task flow or a fix for live offer eligibility.

Trial checking here means reading pricing/eligibility. No trial activation, checkout, payment, new registration, mailbox purchase, proxy rotation, or credentialed external request was performed in this checkpoint. Reading trial eligibility alone is not evidence of trial abuse. Lack of an offer is not proof that an account is flagged.

## Implemented contracts

### Passport request context

[`createPassportRequestContext`](../../../src/main/services/capcut/http/passportContext.ts) builds fresh frozen header/query records from explicit per-account inputs:

- Capture application/sdk metadata: `aid=348188`, `account_sdk_source=web`, `sdk_version=2.1.10-tiktok`, language `en`.
- One supplied profile controls user-agent, browser version/language/platform, timezone and screen dimensions. `browser_version` is derived from that same Mozilla user-agent; `webid` and `did` share the supplied web ID.
- CSRF, region and current-session `msToken` are passed explicitly; token bytes survive query encoding, including `+`, `/`, and `=`. No raw Cookie header is constructed by this builder.
- Required metadata, control characters and screen/region values are validated. Caller changes after construction cannot change the context.
- This is metadata assembly, not device-trust attestation or an implementation of `X-Bogus`, `X-Gnarly`, or the CapCut SDK.

The earlier ignored helper was also corrected to match the user-supplied `verifyFp`/random-token source format: timestamp handling, alphabet, fixed positions and variant behavior now have deterministic tests. Source conformity does **not** establish accepted CapCut SDK output. The restricted live harness no longer uses a random `msToken` replacement; it requires its recorded current-session server-token source and retains its existing execution fences.

### Read-only offers

[`readTrialOffers`](../../../src/main/services/capcut/http/trialApi.ts) sends one read-effect `POST` to `https://commerce-api-sg.capcut.com/commerce/v1/subscription/batch_get` through the injected HTTP client. It builds VIP/Ultra entries and includes Teams only when a current workspace is supplied. It adds no retry, activation or checkout operation. The CycleTLS session/transport remains responsible for the account-specific proxy and CookieJar.

Caller headers/query are copied and frozen synchronously before dispatch. The caller's original objects remain mutable. This prevents an in-flight request from accidentally using later mutations of a reused account-context object. The returned result is frozen as well.

[`parseTrialOffers`](../../../src/main/services/capcut/http/trialOffers.ts):

- Parses the captured JSON string in outer `response`, even when outer `data` is null; also accepts the supported structured `data` array.
- Matches exact VIP/Ultra/Teams keys, rejects duplicates/unrecognized schemas, and emits canonical VIP → Ultra → Teams order. Original provider order is retained in the original evidence, not represented by this sorted projection.
- Keeps available offers distinct from nested application errors. Missing VIP is `unknown` at the API wrapper, not a negative result. Missing scenes are not fabricated by the generic parser.
- Exposes per-scene and aggregate `eligible | ineligible | unknown`. `hasEligibleSevenDayFree` is positive proof only; `false` does not replace the tri-state.
- Seven-day-free proof requires explicit `can_trial:true`, at least seven days with unit `DAY`, and zero trial price. A nonempty list of explicit false values is an ineligible response; empty/incomplete/error evidence remains unknown.
- Deep-freezes results and exposes only offer facts and bounded error codes, not upstream messages, identifiers, products, cookies or tokens.

The new modules are used by the existing restricted scratch harness. The main Electron auth/full-task workflow has **not** been replaced or certified by this checkpoint. Its existing production entrypoint still requires supplied session material and mission operations.

## Rechecked real saved responses

The offline verifier read original capture item 3163 by indexed offset and decrypted the two historical local response records in memory. No external requests were replayed and no credentials were emitted.

| Evidence | VIP | Ultra | Aggregate |
|---|---|---|---|
| Original capture #3163 | Eligible; 2 of 4 offers satisfy seven-day-free proof | Ineligible; 2 explicit false | Eligible |
| Historical direct run | Ineligible; 4 explicit false | Unknown; nested `ret=34010101` | Unknown |
| Historical Kiot run | Ineligible; 4 explicit false | Ineligible; 2 explicit false | Ineligible for that response |

The Kiot response originally returned Ultra before VIP; the verifier separately checks that raw order and the parser's keyed/canonical result. Reading the first entry as VIP would misinterpret this response.

These observations establish response interpretation, not the cause of the difference. They do not prove a permanent account state, account flagging, causation by omitted parameters, or that adding signatures would change eligibility. Current-trial state and eligibility for an offered trial remain separate concepts.

Ignored local evidence: `.superpowers/sdd/2026-09-09-api-completeness/trial-fixture-verification.json`, verifier script, per-task RED/GREEN reports and review package. The raw capture and encrypted credentials remain private.

## Verification

| Check | Result |
|---|---|
| `npx --no-install vitest run src/main/services/capcut/http/__tests__` | 36 files, 289 tests passed; includes native CycleTLS localhost tests |
| Focused CLI/options/bridge tests | 3 files, 13 tests passed |
| Source-helper `node --test` | 6 tests passed |
| Offline original/direct/Kiot fixture verifier | PASS; zero external calls; credentials not emitted |
| `npm run lint` | Passed with zero warnings |
| Syntax checks for adjusted scratch harness/verifier | Passed |
| HTTP-only dependency boundary | New Passport/trial entrypoints included; no transitive browser/fallback dependencies in the inspected graph |
| Independent scoped review, fix round 1 | Four findings addressed; no new Important/Critical issue |
| `npm run typecheck` | Fails on two pre-existing errors outside this change, below |

Unresolved baseline compiler errors:

1. `src/main/services/__tests__/AutomationRunService.test.ts:654`: mock verification receipt lacks `complete`.
2. `src/main/services/AutomationWorkSource.ts:12`: redundant named `type` inside `import type`.

These unrelated dirty files were preserved. No successful project build is claimed. Local/mock tests also do not prove live throughput or 10–20-account scalability.

## Remaining gates

1. Bind the new request context and trial reader into the complete per-account HTTP state machine, with immutable account identity, one Kiot lease and one CookieJar per account. Do not reuse the released historical proxy lease or captured credentials.
2. Preserve explicit unsupported/missing-context outcomes at SDK-signature boundaries. The two supplied TikTok references were statically audited, not executed or integrated; matching field names is not CapCut compatibility. See the [reference audit](../../capcut-api/2026-09-09-full-capture/reference-compatibility.md).
3. Validate each task's own request/response and product artifact against the capture map before adding its mission operation. A reward acknowledgement does not prove generation/export artifact success.
4. Once those contracts are supported, run a separately bounded authorized live step test with redacted request/response evidence and no automatic purchase or mutation retry. Only then extend to independent 3-account execution and measured higher concurrency.

Superpowers' TDD/review process directly led to the explicit unknown-state contract and removal of caller-owned request aliases. Documentation and validation skills kept the report scoped to measured behavior. All changes remain uncommitted; existing staged/unrelated work and evidence were retained.
