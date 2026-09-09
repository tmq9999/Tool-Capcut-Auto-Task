# Auth/trial raw-capture reread

## Scope and evidence standard

This is an offline primary review of every row in the 3,315-row locator whose `family` is `auth` or `trial`, across every host. The allocation is **477 rows**: 152 auth and 325 trial. Each row was freshly loaded from `Capture/Capture_Full_Capcut_Flow` through `capture-lib.cjs` `readItem(meta)`; request/response headers and bodies were inspected, bodies were hashed, and JSON-string fields were recursively decoded where applicable. No live request, provider call, purchase, browser, captured-cookie replay, SDK execution, signature generation, or production-code edit was made.

The safe machine ledger is `.superpowers/sdd/2026-09-09-capture-reread/auth-trial/auth-trial-rows.jsonl`. It has one unique entry for every allocated ID and no extra ID. Each entry records body byte counts and SHA-256 values, parse state, an explicit review-depth label, endpoint role, header/cookie-name provenance, safe schema paths, and HTTP/application outcome. Structural traversal visits every array member and every object child, including recursively decoded JSON strings; repeated array elements are merged under `[]` paths with every observed array length retained. There is no depth or array-length sampling, and all 477 request/response `truncatedPaths` arrays are empty. It contains no cookie values, credentials, email addresses, OTPs, account/order/workspace identifiers, signed URLs, or opaque token values.

Coverage is deliberately separated:

- 364 rows: semantic endpoint/body review with complete structural traversal; this does not claim that every scalar's proprietary business meaning is known.
- 80 rows: protocol-only semantic review of CORS preflights.
- 16 rows: raw telemetry envelopes and full structure reviewed, inner proprietary event meaning explicitly unresolved.
- 17 rows: payment-provider/Google Pay support flow and full HTTP structure reviewed, provider-internal script semantics explicitly unresolved and cross-cutting JS review left to the JS owner.

All 477 request and response HTTP payloads reported `bodyState=raw`; none required gzip/Brotli recovery in this allocation. Auth bodies total 90,280 request bytes and 407,646 response bytes. Trial bodies total 29,707 request bytes and 20,431,518 response bytes. These byte/hash facts are not presented as substitutes for the semantic statuses above.

## Observed sequence and result boundaries

### Registration and session establishment

The core auth sequence is consistent and successful in the captured account:

1. #81 loads `GET /login-embed`. The request carries five login-bootstrap query fields: `col`, `lang`, `login4`, `scene`, and `sdk_login_preset`.
2. #191 and #193 call `/passport/web/region/` on the row and US login hosts. Both return HTTP 200 and `message=success`. Response headers/cookies establish or rotate region, CSRF, and transient token context.
3. #196 and #209 call `check_email_registered`; both return HTTP 200, `message=success`, `is_registered=0`, and `need_verify_email` state. This proves the new-registration branch in this capture only.
4. #224 calls `send_code`; HTTP and application results are successful and an email ticket is present. The ticket is not shown and must not be reused.
5. #230 calls `register_verify_login`; HTTP 200, `message=success`, user identity is present, and account status is 1. It establishes authenticated session cookies. Its `biz_param` is a JSON-encoded empty object; the send-code ticket is not copied into `biz_param`.
6. #233 and #234 broadcast auth state to both login hosts; both return application success.
7. #244 plus 117 later `/passport/web/account/info/` reads return the same response-body hash, HTTP 200, `message=success`, and a present account identity. This is identity/session evidence, not workspace, entitlement, trial, payment, or task evidence.

Observed cookie provenance is chronological rather than a claim of a minimal contract: initial web/login cookies precede the region requests; region responses set/rotate Passport CSRF and transient token cookies; #230 sets the authenticated session family; those jar values are then sent to account and commerce hosts according to scope. Auth calls also observed `appid`, `did`, browser metadata, region headers, and the Passport CSRF header. Commerce calls observed cookies plus `appid`, `appvr`, `device-time`, `did`, `web_id`, `tdid`, `sign`, and `sign-ver`. One capture cannot establish which subset is mandatory, and this review does not derive or reproduce signatures.

### Subscription, workspace, offer, and payment facts

The commerce envelope commonly contains both decoded `data` and a duplicate JSON-string `response`. The inner response must be parsed; checking only outer `data` is insufficient for #3163, where outer `data` is null.

- The five commerce workspace-subscription calls #279, #1653, #2167, #2681, and #2989 send both `aid` and a response-derived `workspace_id`. Each returns outer `ret="0"`/`errmsg="success"`, no ordinary `space_list` entry, and one joint-activity space. This is not the edit-workspace discovery endpoint and must not be treated as proof that no usable edit workspace exists.
- Thirty-five `/subscription/user_info` calls return outer application success and describe current subscription state. Current-state fields such as `is_free_trial=false` and `can_free_trial=false` are not a global catalog-eligibility verdict.
- Direct price-list calls #316, #1673, and #2223 are `scene="workspace"`, have no `workspace_id` in the body, and each returns six offers whose `can_trial` values are all false. This is the workspace/cloud-storage pricing surface. It is **not** the VIP response and cannot answer whether a CapCut Pro offer is eligible.
- Batch #3163 is a different operation: `/subscription/batch_get` with keyed subrequests for VIP, Ultra, and Teams. Decoding the JSON-string `response` gives VIP first in this historical capture: four CapCut Pro offers, two with `can_trial=true`, seven-day `DAY` trial information, and zero trial price. Ultra has two non-trial offers; Teams has eight non-trial offers. The key—not array position—defines the scene.
- The safe live/capture comparison at `.superpowers/sdd/2026-09-09-capture-reread/live-capture-comparison.json` shows the later live response returned Ultra before VIP and omitted Teams because no current workspace ID was available. Its product families are `cc_ultra` and `capcut_pro`, both in VND; it is not a cloud-storage response. Reading its first array element as VIP was an earlier interpretation mistake. The current keyed parser avoids that mistake.
- #3161 `get_subscribe_info` returns no active subscription, while #3163 proves captured per-offer eligibility. These statements coexist: offer eligibility, current subscription state, and trial activation are different facts.
- #3180 initializes a trade and returns checkout handoff context. Ten polls (#3183, #3202, #3266, #3272, #3279, #3287, #3288, #3290, #3297, #3300) all return `order_status=PROCESSING`. No terminal settlement, subscription activation, reward receipt, or task success exists in the capture.
- Credit, benefit, metadata, resource-position, and deduction-check endpoints all read or preview state. HTTP/application success for those calls is not a grant, debit, activation, or task reward. `batch_check_withhold_deduct` is a check only.

## Concrete implementation and reporting discrepancies

### 1. The active product still uses a DOM-only, fail-open trial gate

`src/main/services/capcut/trial.ts:7-18` states that the API is not a source of truth and that trial must be read from the DOM. That statement conflates current-user flags and direct workspace pricing with the keyed VIP offer catalog. Capture #3163 is direct API evidence of VIP offer eligibility, including explicit trial period/unit/price. The same file's `checkProTrial` at lines 179-240 navigates a page and reads DOM, and `isEligible` at lines 238-240 returns eligible on any read error. `src/main/services/CapcutEngineService.ts:273-289` still invokes this headed gate.

There is a newer, safer API parser (`src/main/services/capcut/http/trialApi.ts:17-54` and `trialOffers.ts:148-196`) that uses the keyed batch, distinguishes unknown/error/ineligible, and does not confuse array order. However, repository search finds `readTrialOffers` only in its own module and tests, with no production consumer. Therefore the parser exists but is not integrated into the application path; prior reports describing it as “implemented” should not imply that current account runs use it.

### 2. Auth orchestration omits captured bootstrap and broadcast transitions

`src/main/services/capcut/http/httpSignup.ts:20-39` sequences email check, send code, registration, and account info only. It has no `/passport/web/region/` step corresponding to #191/#193 and no `/passport/web/auth_broadcast/` step corresponding to #233/#234. The current live trace still achieved registration and identity without those exact calls, so this is a baseline-parity gap, not proof of the live `1014` cause or proof that either call is mandatory.

The live bootstrap also omitted all five query fields observed at #81. The safe comparison records the omission. Again, a successful auth run means absence is not by itself a demonstrated failure cause.

### 3. Response-derived request context has no complete built-in propagation path

The raw sequence rotates CSRF/transient-token context in response headers/cookies before signed Passport and commerce calls. `createPassportRequestContext` (`passportContext.ts:30-75`) can accept supplied CSRF, region, and `msToken`, but it is a pure builder and is not production-wired. `signupHttp` stores the #224-like response only long enough to test success, then calls `prepareRegistration(signal)` without passing response headers or response data (`httpSignup.ts:28-34`). A caller can compensate through external state and the native jar handles cookies, but the orchestrator does not itself prove that the next query/header context came from the immediately preceding response.

The safe live comparison gives concrete mismatches rather than a causal story: capture send/register requests include `X-Bogus` and `X-Gnarly` query names while the live explicit records do not; auth capture uses `store-country-code-src=uid` where the live record uses `cdn`; the captured post-registration user-info request reverses that source (`cdn` versus live `uid`) and also has `msToken`, signing headers, and other browser request metadata absent from the live explicit record. These are unclosed contract differences. This review does not implement signing or suggest fabricating context.

### 4. Product onboarding between registration and workspace use is absent from the HTTP workflow

The whole-capture reread outside this worker's family ownership found #211 age configuration, #220 successful `check_age_without_uid`, #235 successful `set_birthday_by_uid`, and #237 successful user-info with birthday state and workspace context. The current scratch/live HTTP path skipped all three age/onboarding calls and received HTTP 200 with application `ret=1014` on user-info/workspace reads. That sequence is a concrete omitted prerequisite candidate and should be tracked as product onboarding, not as trial activation. It does **not** prove causation and is not permission to invent or falsify a birthday; any future implementation would need legitimate user-provided/account-derived data and a separately reviewed contract.

### 5. Earlier focus-only coverage is not the new all-domain allocation

`docs/capcut-api/2026-09-09-full-capture/auth-trial.md:3-5` records 439 rows from the earlier normalized focus subsets. The authoritative 3,315-row index assigns 477 rows to auth/trial across all domains. The wider reread adds 38 rows: #2999 and payment/checkout/Google Pay/telemetry support traffic across #3184-#3308. This is a scope difference, not evidence that 38 core CapCut auth endpoints were previously missed. The older focus count must not be presented as an all-domain count.

The newly included tail does not add payment success: it is checkout bootstrap/config/risk/support traffic, redirects/manifests/scripts, and two additional telemetry posts. Provider-internal JS behavior remains cross-cutting JS scope; it was not mislabeled as manual script review here.

### 6. HTTP 200, application success, catalog eligibility, and terminal success must remain separate

The reread found 80 successful preflights, 338 rows with explicit outer application success, ten trade polls with successful envelopes but `PROCESSING` order state, and a smaller support/static tail without an explicit application result. This corrects any logic or prose that equates `response.ok` with business completion. In particular:

- Passport `message=success` proves the named auth operation, not workspace readiness.
- Commerce `ret=0` proves the named read/init operation, not offer eligibility unless the keyed offer body says so.
- VIP `can_trial=true` plus trial metadata proves captured offer eligibility, not activation.
- `init_trade ret=0` proves handoff initialization, not settlement.
- Task completion still requires its own mutation evidence plus a fresh task snapshot; none of these auth/trial rows substitutes for it.

## Current live comparison, without causal overreach

The safe offline comparison between the historical capture and the sealed live scratch evidence confirms:

- Auth email check/send/register/account-info succeeded in both traces.
- Historical #237 user-info and edit-workspace responses succeeded, while the new live equivalents returned application `1014` despite HTTP 200.
- Historical #3163 had two eligible VIP offers; the live keyed VIP/Ultra catalog had no eligible offer. This is a measured account/session outcome difference, not proof of account flagging or of any single omitted header causing it.
- The live trial request lacked Teams because the preceding workspace read produced no current workspace ID. That omission is a consequence of unresolved workspace context, not evidence that Teams should be fabricated.
- The live explicit request records omit signing/query fields and other browser metadata present in the capture. The records are pre-transport intent rather than a second packet capture, so cookie-name deltas and header deltas are comparison clues, not exhaustive wire truth.

## Limits and safe next diagnostics

- This is one historical browser capture plus an offline comparison to one sealed live trace. It cannot establish minimum required headers/cookies, signature algorithms, anti-abuse behavior, account permanence, offer-selection causality, or eventual checkout completion.
- Telemetry event internals, third-party payment scripts, and Google Pay internals remain explicitly unresolved here. Their bytes are hashed/mapped, and JS semantic ownership is separate.
- No captured token, signature, cookie, credential, mailbox payload, identity, workspace/order ID, or signed checkout URL was replayed or disclosed.
- The next safe engineering step is a production state-machine design that explicitly represents bootstrap, response-derived context, onboarding readiness, authenticated identity, edit workspace, current subscription, keyed VIP offer eligibility, trade state, and task proof as separate typed states. It should consume legitimate current-session outputs and fail closed on unresolved application results. This reread does not authorize live execution or signature/evasion work.
