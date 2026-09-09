# Remaining HTTP, bootstrap and diagnostic reread

## Coverage

Root primary ownership is every row outside the auth/trial and task/design/creator allocations: **1,927 exchanges**, 244 method/host/path groups. All request/response bodies were reread from the raw indexed file twice and their hashes compared. Body totals: **16,479,518 request bytes**, **131,116,937 response bytes**.

All 244 groups and their individual IDs are listed in [remaining-groups.md](remaining-groups.md). Detailed schema traversal exists per ID in the ignored `machine/all-requests.jsonl`; per-ID disposition is `remaining-reviewed.jsonl`. This covers every root-assigned row, including third-party traffic rather than only the original CapCut-domain subset.

Depths are explicit: 1,619 endpoint/schema reviews, 210 preflight protocol reviews, 32 HTML/JS cross-cutting rows, 59 binary-format/hash-only rows, and seven opaque SDK resource/configuration rows. These counts do not claim that every scalar in every catalog or every binary has been semantically interpreted. The binary files and proprietary event meanings are not skipped in inventory, but unresolved meaning is not presented as complete source review.

## Concrete missing flow and code defects

### Product onboarding is not the same as Passport registration

The source contains a separate sequence:

| Capture ID | Endpoint | Observed result |
|---:|---|---|
| 211 | `/lv/v1/sc/age_gate/get_age_gate_config` | `ret=0`, age policy returned |
| 220 | `/lv/v1/sc/age_gate/check_age_without_uid` | `ret=0`, `passed=true`, no lock duration |
| 230 | Passport `register_verify_login` | Authentication succeeds; separately reviewed by auth worker |
| 235 | `/lv/v1/sc/age_gate/set_birthday_by_uid` | `ret=0`, `base_resp.StatusCode=0` |
| 237 | `/lv/v1/user/web/user_info` | `ret=0`, `has_birthday=true`, workspace/location/Everphoto fields present |
| 278 | `/cc/v1/workspace/get_user_workspaces` | `ret=0`, one workspace |

The live scratch harness jumps from Passport registration/account-info to user-info/workspace. The three age-gate requests are absent; a birthday field in the Passport form is not evidence that the separate product-side persistence call occurred. This is a concrete parity gap. It is not permission to invent a birthday and not proof that this omission alone caused `1014` or offer selection.

In the live trace, `user-info` and `workspace` both returned `ret=1014` with no data. The harness did not fail the overall run at either application error; it proceeded to trial and task-list reads and ended with process exit 0. That exit code means the diagnostic script finished, **not** that the account passed product readiness. The `registered` flag is set before those calls and is never a full workflow verdict.

### Runtime and trial logic remain split

`src/main/services/CapcutEngineService.ts:273` still invokes `checkProTrial()` from `capcut/trial.ts`. The old gate returns `canTrial:true` on read error; `isEligible()` accepts any `error`, and the engine substitutes seven days when `days=0`.

A fresh offline invocation of the production `isEligible()` with a synthetic failed read returned true. The engine expression would display seven days. This is a reproducible false-positive reporting path, independent of whether the latest live test account has a trial offer.

Production search finds no caller of the new `readTrialOffers()` or `createPassportRequestContext()` outside their definitions/tests; the ignored live harness uses them, but the main Electron flow does not. The same applies to a concrete, registered nine-leaf `HttpOnlyRunner` operation set. A working primitive and a successful scratch request are not production integration.

### Structured request differences are recorded, not guessed

`live-capture-comparison.json` compares the sealed latest live requests with matching original raw endpoints without exposing values:

- `login-embed` lacks captured `col`, `lang`, `login4`, `scene`, `sdk_login_preset` query fields.
- Passport region/context transitions differ; send/register headers use a different region-source value at those points.
- Live `user_info` omits the captured `msToken` query as well as the unresolved signing fields. Its `store-country-code-src` differs from that exact captured call.
- Task-resource/task-list explicit header records omit captured `appvr`, `pf`, and `lan`, in addition to unresolved signing metadata.
- Teams pricing is omitted because the live workspace calls failed; inventing a captured workspace would be wrong.
- Live trial products are actual `capcut_pro`/`cc_ultra` products in VND. The six false trial flags are **not** a mistaken read of a USD cloud-storage product list. Separately, the first object pasted by the user was indeed the cloud-storage surface, not a VIP nested response; the earlier assistant characterization of that object as VIP was wrong.

The saved live headers are pre-transport intent, not a packet capture. `user-agent` can be supplied by CycleTLS configuration; Cookie is applied by the jar. Their absence in an explicit header record is not proof of wire omission. Cookie-name comparisons use a reconstructed jar, with the same limitation. Signature-field differences remain unsupported boundaries, not instructions to bypass platform restrictions.

## Diagnostic traffic and parser limitations

Every root request body was examined for JSON and JSON-in-string telemetry. The pass found **5,015 client telemetry envelopes**, **51 resource-error reports**, **one JS-error report**, and **228 client-reported HTTP-error/custom-error records**. The event-kind histogram, including 495 `batch` containers, is recorded in `remaining-summary.json` and each event in `telemetry-events.jsonl`. Those reports can be duplicated or sampled and are not 228 extra server HTTP exchanges.

The one explicit JS error at #1531 is an `AbortError` concerning a missing active Service Worker. Notification reward acknowledgement/snapshot comes later at #1561/#1564, while Firebase/FCM registration is later still. This supports separate notification-state, browser permission/subscription, and reward facts; it does not support treating a telemetry acknowledgement as task success.

The census initially labeled 16 `update.googleapis.com` responses invalid JSON. Fresh body inspection confirmed all 16 have the standard `)]}'` anti-XSSI prefix and valid JSON after that prefix. The supplemental ledger records them as `xssi-prefixed-json-decoded`. They are browser component-update traffic, not CapCut application errors. No production parser was changed.

Nine Frontier requests return HTTP101 upgrade handshakes. The HTTP export does not provide their subsequent WebSocket frames; handshake success cannot establish message/notification success.

The 67 `get_resources_by_category_id` and 30 `mget_item` responses are effect/catalog reads; their internal effect status `102` is not an HTTP error or reward status. The linked-platform `authorized_user_info` reads #2802/#2994 return application `1904`, a different endpoint/outcome from the latest product-user `1014`.

## Supplementary dependencies

The initial family classifier assigns some mission dependencies to `other`, so the task worker was explicitly given these rows too without double-counting primary coverage:

- Notifications: CapCut notice state, Firebase Installations, FCM registrations, sender-token updates.
- Inspiration: job creation #1988 and all 48 empty `common_task/list` responses. Actual terminal results come from `effect/genai/task/query`, not that empty list.
- Canvas: ImageX Apply/Commit and later metadata/save dependencies. Byte upload alone is not canvas persistence.
- Page-resource manifests: individually read by the JavaScript worker to locate referenced bundles absent from captured response bodies.

No live call, provider action, purchase, credential replay, captured JavaScript/external SDK execution or production code change occurred in this audit. Current production helpers were executed locally for the synthetic trial/SSE/parent reproductions; those are not new live outcomes. Findings are evidence for the next scoped correction, not a declaration that the account or full flow has been repaired.
