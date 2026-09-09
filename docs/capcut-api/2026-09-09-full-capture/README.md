# CapCut HTTP-only capture map (2026-09-09)

This directory is an offline, evidence-backed map of `Capture/Capture_Full_Capcut_Flow`. It is a contract-discovery artifact, not a request replay and not a claim that the browser flow can already be replaced by native HTTP.

## Evidence boundary

| Property | Evidence |
|---|---|
| Source | `Capture/Capture_Full_Capcut_Flow` |
| Source size | 526,282,871 bytes |
| Source SHA-256 | `e5e97fb2aa376d98417d2ebeb9041889c17639e95a24aba1ea4b7d122b52e1d9` |
| Parsed items | 3,315; parser errors 0 |
| Focus domains | 2,782 items |
| Outside focus | 533 items; retained in the global index and followed when a first-party dependency is visible |
| Focus endpoint groups | 316 (500 groups across all domains) |
| Capture comments | 0 non-empty `<comment>` annotations; no user-marked Burp annotations were available |
| Request/response body bytes | 16,924,270 / 494,069,992 |
| HTTP replay/live calls | None in this analysis |
| Runtime/source changes | No production `src` changes for this capture map |

The raw capture stays private and is not copied into the reports. Redacted records retain original item IDs, offsets and lengths so an operator can inspect the raw item locally. The initial index uses ephemeral-key HMAC correlation refs; Design/Creator reports also use SHA-256-derived correlation refs in their own namespaces. They are labels, never credentials. Do not compare unlike namespaces or assume a hash hides every low-entropy value against guessing.

## Files

- [`api-map.md`](./api-map.md) — human-readable flow and endpoint contracts.
- [`auth-trial.md`](./auth-trial.md), [`design-inspiration.md`](./design-inspiration.md), [`creator-tasks.md`](./creator-tasks.md) — domain reports with response outcomes and task evidence.
- [`trial-offer-correction.json`](./trial-offer-correction.json) — safe field-path evidence correcting the distinction between inactive trial state and trial-offer eligibility.
- [`live-preflight-2026-09-09.md`](./live-preflight-2026-09-09.md) — separate live public-HTTP run (3 endpoints); explicitly stopped before signup, not full-flow verification.
- [`CycleTLS implementation report`](../../superpowers/reports/2026-09-09-cycletls-native-transport.md) — replaces APIRequestContext in the HTTP-only path; independently tested native context, cookie/stream/lifecycle, live CycleTLS bootstrap, and remaining full-flow limits.
- [`API completeness checkpoint`](../../superpowers/reports/2026-09-09-api-completeness.md) — immutable Passport context, read-only trial API/parser, original/live saved-response verification and remaining integration gates.
- [`One-email live retest after API fixes`](../../superpowers/reports/2026-09-09-live-one-email-after-api-fix.md) — fresh registration passed over Kiot, no trial offer returned, user/workspace `1014` remains; one mailbox only.
- [`reference-compatibility.md`](./reference-compatibility.md) — static compatibility/runtime/license review of the supplied TikTok signer repositories; no signer execution or proven CapCut compatibility.
- [`headers-cookies.md`](./headers-cookies.md) — cookie-jar rules, header provenance and limitations.
- [`shared-endpoints.md`](./shared-endpoints.md) — shared/age/workspace/bootstrap/configuration traffic, known application error and diagnostic coverage.
- [`migration-design.md`](./migration-design.md) — proposed independent-account architecture and verification gates, **not an approved executable implementation plan**.
- [`auth-trial-catalog.json`](./auth-trial-catalog.json) — 439 auth/trial records, 53 endpoint groups, safe shapes and dependencies.
- [`design-inspiration.machine.json`](./design-inspiration.machine.json) — 344 design records plus 18 upload/ImageX dependencies.
- `creator-tasks.machine.json` — Creator, notification and complete task timeline.
- `bootstrap-state.machine.json` — decoded JSON script schemas and HTML-to-header equality sources, workspace source checks, exact upload-body hash checks.
- `telemetry.machine.json` — diagnostic event inventory from all 1,012 focused telemetry requests; sampled reports are not authoritative business results.
- `endpoint-catalog.json` — all 500 method/host/path groups with status counts, safe body shapes, IDs and response hashes.
- `headers-cookies.machine.json` — 64 header names and 42 cookie names with first-seen/set/sent evidence.
- `request-ledger.jsonl` — one safe row for every original item in order; no raw secret value.
- `coverage.json` — integrity and analysis coverage summary.
- [`capture-integrity.md`](./capture-integrity.md) — fresh hash/tag/parser/redaction verification results.
- [`signing-audit.md`](./signing-audit.md) — proof that existing code has no CapCut web-sign formula; only separate upload SigV4 is available.

## Where to inspect every request and response

Use the original ID in `request-ledger.jsonl` to locate `offset` and `length` in the immutable raw capture. The fully redacted, per-exchange JSON/form/SSE bodies and repeated headers are in `.superpowers/sdd/2026-09-09-full-capture-map/indexed/focus-{auth,trial,task,design,creator,other,telemetry,static}.jsonl`. The endpoint catalog stores shape unions and every ID, not a duplicate of those large body shards. Raw binary/static data remain in the capture and are hashed rather than recopied. These local shards are ignored workspace artifacts; do not mistake them for published fixtures.

The source has 0 Burp comments. The task-related endpoints were prioritized from their observed dataflow; an additional user list of highlighted requests can be overlaid later without changing the immutable index.

## Confirmed findings at a glance

- All 12 reward keys reach status4, with 9 explicit leaf actions; registration and two parent rows have distinct semantics.
- Try Inspiration receives reward before its video job succeeds; job terminal success is #2065, not `common_task/new` acceptance or a progress100 reply.
- Push subscription has a real missing-active-Service-Worker error in telemetry #1531, followed by later successful FCM/cloudpush registration exchanges.
- Linked-platform `authorized_user_info` fails with application `ret1904` at #2802/#2994 despite HTTP200.
- The account is not in an active trial, but `batch_get` #3163 exposes two eligible offers with `can_trial=true`, a 7-day period and zero trial price. The later checkout polls stay `PROCESSING`, so no activation or payment success is shown.
- Export reward is credited, but exported-file production is unproven. No reviewed telemetry establishes export failure/root cause.
- 175 cross-domain `msToken` equality candidates fail cookie scope validation; browser/client generation and web signing are not solved by copying capture values.

## Status vocabulary

Every endpoint is classified with one of these meanings:

- **Observed**: method, host, path, status, body shape and item IDs are present in the capture.
- **Response-derived**: a later value is exactly equal to an earlier response value in this capture. This proves equality only, not generation or necessity.
- **Cookie equality candidate**: the initial index matches cookie name/value only. The machine map separately audits domain/path; expiry and response-arrival order remain unproven. A same-valued cross-domain cookie is not a valid CookieJar source.
- **Client-generation unproven**: for example `sign`, `device-time`, `x-secsdk-web-signature`, AWS-style Apply/Commit authorization, and WebSocket keys. Some timestamp values equal earlier server fields; that can be coincidence. TOS byte-upload authorization is different: it is returned in the Apply response. The HTML bootstrap token has a concrete source in `bootstrap-state.machine.json`.
- **Proven**: reserved for a future controlled ablation or native-HTTP verification. No captured header is marked proven required by this artifact.

## Non-negotiable HTTP-only design rules

1. Create a separate account session and CookieJar per profile and proxy. Never share a mutable jar, passport cookie, `msToken`, signed upload authorization, workspace ID, thread ID or task token between workers.
2. Apply every `Set-Cookie` immediately with its exact domain, path, Secure, HttpOnly, SameSite, expiry and deletion semantics. Host-only cookies are not domain cookies; `capcut.com` and `capcutapi.com` are separate cookie domains.
3. Preserve redirect response cookie updates before following the next request. Keep repeated `Set-Cookie` fields; do not split a header on commas.
4. Store server IDs in a typed per-account state object. A value may be used by a later request only when its source item/endpoint and account session match.
5. Treat HTTP 200, `ret=0`, `message=success`, upload `UriStatus=2000`, a queued generation job, a reward acknowledgement and a UI state as different outcomes. A task requires task-specific product evidence plus correlated reward/ledger evidence. Generation additionally needs terminal success and artifact metadata; export needs a produced, validated file. Reward mutation plus snapshot is not sufficient for those effects.
6. Do not guess signatures from this capture. The proposed runtime needs a provider boundary for client-generated values, with unknown fields failing closed until legitimately supplied or proven by a controlled test. The supported mechanism may still require browser state; this map does not certify full native-HTTP feasibility.
7. Keep telemetry, CORS preflight, static assets, WASM and WebSocket handshakes out of the business-task success predicate. They may be dependencies or diagnostics.
