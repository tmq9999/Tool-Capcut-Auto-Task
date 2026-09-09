# Captured JavaScript reread

## Scope and evidence

This was an offline static reread of `Capture/Capture_Full_Capcut_Flow`. The raw reader reopened captured bodies from their indexed byte offsets; no script was executed, downloaded, deobfuscated, or used to generate request signatures. Output URLs contain origins and paths only. No query strings, cookies, tokens, emails, identifiers, or signed values are reproduced here.

Machine evidence:

- [JavaScript ledger](../../../.superpowers/sdd/2026-09-09-capture-reread/javascript-ledger.json)
- [Missing referenced scripts](../../../.superpowers/sdd/2026-09-09-capture-reread/missing-scripts.json)
- Analyzer: `.superpowers/sdd/2026-09-09-capture-reread/audit-javascript.cjs`

The fresh pass read all 3,315 indexed responses to classify response bodies and detect HTML by metadata/content type/code sniff. It found the expected 26 response-body candidates (1,859,032 bytes; 26 distinct SHA-256 hashes), including all IDs supplied in the allocation. It also found 40 HTML-like responses, of which 17 carry Burp's HTML MIME label, and inventoried 192 nonempty inline `<script>` blocks across 14 response IDs. Each ledger row states raw ID, full body hash, byte size, body state, detection reason, syntax status, analysis depth, dependencies, status, and remaining unknowns.

Raw byte read/hash, syntax parsing, static interface inventory, source review, and full reverse engineering are deliberately separate claims. TypeScript's non-executing parser accepted 23 response bodies as JavaScript. Exactly **five** large/minified response bodies—not 11—received a sequential 32 KiB bounded static function-group/dataflow review: raw 48, 49, 2754, 3210, and 3225. Their 55 byte ranges are individually hashed in the ledger, but minified runtime internals still are not claimed as understood function-by-function. The other 18 valid response bodies received an actual complete-source static pass (17 small third-party bodies plus CapCut raw 3000). Three metadata candidates are not JavaScript.

Of the inline blocks, 49 are JavaScript and 143 are declared data blocks. All 143 data blocks (`142 application/json`, `1 application/ld+json`) were parsed successfully with `JSON.parse` without executing them; each ledger row records top-level structure, element ID when present, and sanitized script-reference count. All 49 executable inline instances now have source-level coverage: 43 complete-source static reviews and six sequential bounded static reviews spanning 40 contiguous 32 KiB-or-smaller ranges. Exact SHA-256 deduplication reduces the 49 instances to 40 unique bodies, while every instance remains mapped in the ledger. The two executable CapCut blocks in raw 2114 received complete-source review.

## Response-body ledger summary

| Raw ID(s) | Hash prefix / bytes | Classification and review depth | Static role and remaining limitation |
|---|---:|---|---|
| 48 | `7169b39974ac` / 273,193 | JavaScript; bounded static source review (9 chunks) | Google Identity Services: public API registration, OAuth popup/iframe messaging, One Tap/button prompting, revoke, and FedCM credential/fallback orchestration. Not CapCut Passport signing source; minified internals remain. |
| 49 | `4f451fed88df` / 598,799 | JavaScript; bounded static source review (19 chunks) | Google tag runtime: embedded tag configuration, `dataLayer` routing, consent/linker/cookie state, DOM events, and beacon/fetch/image/iframe/service-worker dispatch. |
| 54 | `757e4f3baf6f` / 994 | JavaScript; complete-source static review | Clarity queue/metadata setup, page-load pixel, duplicate guard, and external loader insertion. |
| 61 | `10c7041249fc` / 6,560 | JavaScript; complete-source static review | Google Ads helper sends two user-list conversion URLs through fetch/beacon/image/iframe fallbacks. |
| 120 | `2def4afb1f8e` / 6,464 | JavaScript; complete-source static review | Same byte-identical 3,875-byte Ads helper; separately captured dispatch payload. |
| 124 | `5453afed4df5` / 857 | JavaScript; complete-source static review | Clarity queue/metadata setup, duplicate guard, and loader insertion. |
| 212 | `cfd4139d3d02` / 288 | Non-JavaScript; classification-only | Protobuf error body mislabeled as script by Burp; syntax diagnostics confirm it is not a usable source file. |
| 357 | `1ed403567a63` / 6,652 | JavaScript; complete-source static review | Same Ads helper and transport flow; separately captured dispatch payload. |
| 391 | `013c38e3adf9` / 857 | JavaScript; complete-source static review | Same Clarity loader flow; distinct captured configuration/hash. |
| 1640 | `da4918322e46` / 968 | Non-JavaScript; classification-only | Google search-suggestion data served as `text/javascript`, not a standalone valid program. |
| 1641 | `71bef45069e3` / 967 | Non-JavaScript; classification-only | Second distinct search-suggestion data response. |
| 1796 | `81189f2018a2` / 6,626 | JavaScript; complete-source static review | Same Ads helper and transport flow; separately captured dispatch payload. |
| 1806 | `1e444484ad61` / 857 | JavaScript; complete-source static review | Same Clarity loader flow; distinct captured configuration/hash. |
| 2182 | `a078299567be` / 6,746 | JavaScript; complete-source static review | Same Ads helper and transport flow; separately captured dispatch payload. |
| 2187 | `50bf36c5d5d4` / 857 | JavaScript; complete-source static review | Same Clarity loader flow; distinct captured configuration/hash. |
| 2754 | `57a40422d35d` / 598,799 | JavaScript; bounded static source review (19 chunks) | Same Google tag function groups/dataflow as raw 49. It differs by five bytes in two embedded-data runs, so it remains separately hashed and chunked. |
| 2760 | `9d63e33dbf19` / 857 | JavaScript; complete-source static review | Same Clarity loader flow; distinct captured configuration/hash. |
| 2774 | `78554d2b274c` / 6,954 | JavaScript; complete-source static review | Same Ads helper and transport flow; separately captured dispatch payload. |
| **3000** | `fabb955b27b6` / 2,208 | **JavaScript; manual interface and flow** | The only captured CapCut JavaScript response. On `load`, it assembles supplied WASM/thread/filesystem/handler state, imports `data.urlOrBlob` when provided or otherwise `./vesdk-lvapi-opt.js`, then calls the imported module's default export with that environment. `run`, `cancel`, and `checkMailbox` drive pthread lifecycle; `setimmediate`-targeted messages are ignored; registered handlers bridge through `postMessage`; exceptions become crash reports. This is VE media infrastructure, not Passport, trial, task, or signing business logic. |
| 3006 | `23278ff83a70` / 7,036 | JavaScript; complete-source static review | Same Ads helper and transport flow; separately captured dispatch payload. |
| 3019 | `288cda7b036a` / 857 | JavaScript; complete-source static review | Same Clarity loader flow; distinct captured configuration/hash. |
| 3210 | `f2af44e0ca20` / 154,447 | JavaScript; bounded static source review (5 chunks) | Google payframe base runtime: compiled runtime/polyfills, safe DOM/URL/events/scheduling, protobuf/message and service bootstrap, cookie/config, and generic XHR. |
| 3225 | `2cb0881fc10f` / 98,094 | JavaScript; bounded static source review (3 chunks) | Google logging/batching/retry, browser state helpers, a deliberately opaque Google auth-header boundary, and `PaymentRequest` capability probing. No signer reverse engineering was performed. |
| 3231 | `d0741a00133e` / 8,880 | JavaScript; complete-source static review | URI/query handling, identity-cookie/IDV polling with backoff, response events, cookie capability test, and timezone-cookie setup. |
| 3232 | `d49a426f5dd9` / 42,358 | JavaScript; complete-source static review | Generic request queue/interceptors, XSRF injection, fetch/XHR streaming parser, retry/error mapping, and browser/network metrics reporting. |
| 3245 | `92270ee35288` / 26,857 | JavaScript; complete-source static review | Sampled telemetry plus navigation/resource/memory/paint and FCP/CLS/INP/LCP/TTFB attribution and flush lifecycle. |

Every response candidate is individually represented in the machine ledger. The table summarizes its status without claiming full semantic comprehension of minified third-party bundles.

## Inline script coverage

Inline script containers and counts are:

- CapCut pages: raw 2 (12 data blocks), 81 (21 data blocks), 250 and 1642 (25 data blocks each), 2114 (20 data blocks + 2 small executable blocks), and 2666/2976 (20 data blocks each).
- Google Identity button documents: raw 103–106, each with one approximately 129 KB bounded-review executable bundle and one 613-byte complete-source initializer.
- Pipo cashier agreement: raw 3184, eight executable blocks, including two modules; these are third-party checkout UI and do not prove CapCut activation behavior.
- Google Pay: raw 3204 has 15 complete-source executable blocks; raw 3229 has 14 complete-source blocks and two large bounded-review bundles. These are third-party payframe/pay UI.

The two executable blocks in CapCut raw 2114 are now source-reviewed, not merely syntax-parsed:

- `raw-2114-inline-19` uses optional chaining to call `window.__aiDesignMiniCanvas.validateGatewayUser` with the fixed `validated_after_gateway_user` marker.
- `raw-2114-inline-22` assigns `window._SSR_DATA` to a small server-rendered request context for `/ai-design`, including credit-task routing keys.

Neither block performs a fetch, mutation, signing operation, or trial activation. Their surrounding page references external application bundles that were not captured, so these two blocks cannot establish the implementation behind the gateway object or the design application.

The 143 declared data blocks are not disguised executable scripts: every one has a JSON MIME type and every body parsed as JSON. Their element IDs show that they are state reservoirs for gateway, region, login, user/workspace, AB-test, router/SSR, locale, loadable-chunk, and structured-data consumers. The audit extracted 106 raw script references from those parsed values but never evaluated a value as code. Absent external page bundles may read these elements by ID; the capture cannot prove how every consumer uses them. Values are not reproduced because some are account/session specific.

### Executable inline source findings

The follow-up read all 41 previously syntax/interface-only small instances (34 unique hashes; 38,114 bytes) and retains exact-hash duplicate mappings:

- Raw 103–106 initializers each call `gis.provider.button.bootstrap` with a document-specific opaque encoded configuration. The payloads were not decoded or reused.
- Raw 3184's eight Pipo helpers install analytics and Slardar queues, precollect runtime/resource failures, apply/persist a theme/query, select Vite modern/legacy loading, show/log a core-resource failure page, and guard `nomodule` compatibility. These are checkout bootstrap, compatibility, presentation, and observability helpers—not payment mutation logic.
- Raw 3204/3229 small Google helpers assign compiled WIZ/toggle/route configuration, install latency and above-fold-image measurement, route delegated browser events, manage async initialization-data queues, advance load/progress ticks, and harden/report mutations to `Object.prototype`. Captured configuration and compiled resource signatures are bootstrap metadata, not CapCut signer evidence.

The six large inline instances received bounded source review rather than remaining syntax-only:

- Raw 103–106 contain four GIS button bundles. Raw 104–106 are byte-identical; raw 103 is distinct. Across 16 hashed ranges, the identified groups are runtime/polyfills and prototype hardening, WIZ/localized configuration, safe DOM/TrustedTypes/ARIA rendering, OAuth authorization navigation, iframe/parent messaging, logging transports, and GIS button bootstrap. The compiled minified internals and encoded initializer payloads remain opaque.
- `raw-3229-inline-9` spans 10 hashed ranges. It contains compiled runtime/DI and safe-DOM support, logging/request transports, cross-window activities messaging, Google payments-integrator loading, environment/presentation selection, iframe/popup/redirect buyflow orchestration, partial/full payment-data callback bridging, selected-address state, and error reporting.
- `raw-3229-inline-11` spans 14 hashed ranges. It contains Google Payments API/interface definitions, identity/instrument/integrator orchestration, accessible UI widgets, popup/iframe/MessageChannel transport, logging/request infrastructure, capability checks, and feedback/error presentation.

The two Google Pay bundles expose third-party checkout behavior, but their authentication/payment token internals were not reverse-engineered and they do not establish CapCut trial activation behavior. “Bounded source review” here means every byte lies in a hashed sequential range and high-level function groups/dataflow were inspected; it is not a function-by-function semantic or runtime-branch-completeness claim.

## Referenced-source availability

The static extractor also read 18 identified CapCut page-resource/WASM manifest responses completely: raw 514/1809, 998/1893, 999/1894, 1220/1221/1223/1820/1829/1840/2705/3040/3132/3144, and 1247/1932. The repeated manifest bodies share hashes where expected, but every raw instance remains mapped. The manifests contribute 2,576 raw `.js/.mjs` reference entries before deduplication; the tiny editor-WASM manifests contain no JavaScript path.

The follow-up pass removed the raw-24 special case and structurally scanned all 546 captured `/monitor_browser/collect/` requests. It found 1,157 script resource records across the telemetry batches with both `encodedBodySize` and `transferSize` reported. The ledger records only the names of those size fields—never their raw numeric values. A further raw-24 `scriptSrc` error-context record has no size fields and is kept separately as context, not promoted to sized-resource evidence. Eighty-eight telemetry request IDs contribute one of these two evidence forms.

After combining manifests, `script src`, `modulepreload`, executable imports, parsed inline-JSON references, and telemetry, the ledger contains 2,731 distinct source/reference occurrences. Availability is evaluated in two separate modes:

- 14 references have an exact URL match to a captured response (one HTML `script src` occurrence plus 13 telemetry occurrences).
- Zero references lack an exact match while having only a same-origin/path captured candidate in this capture.
- 2,717 references have neither an exact URL match nor a same-origin/path candidate, spanning 741 distinct sanitized origin/path strings.

The zero in the middle category is a result, not a collapsed check. Every reference carries a SHA-256 fingerprint of its exact query-preserving URL plus its sanitized origin/path. This preserves exact-query matching without publishing queries and prevents a query mismatch from being mislabeled as complete body absence. `missing-scripts.json` separately labels `origin-path-candidate-only` and `origin-path-absent`; only the latter is described as path-absent.

Telemetry establishes that the client observed those resource names and size fields, but it does not establish why a body is absent. No cache explanation is assumed. Raw 113 (`mssdk-sg.capcutapi.com/web/resource`) remains an opaque SDK resource/configuration boundary with body hash and size; it was not deobfuscated and is not treated as captured signer source.

The load-bearing CapCut gap is raw 3000's fallback relative import:

`https://www.capcut.com/static-resource/ies/lvweb/ai_creator_oversea_online/static/assets/vesdk-lvapi-opt.js`

That fallback VE SDK module is not present in the captured response bodies. The source can alternatively import `data.urlOrBlob`, but this static artifact does not observe a runtime value for that branch and therefore cannot identify or claim availability of the alternative module. CapCut HTML and the page-resource manifests also reference many page chunks/preloads that are absent. Therefore, this capture does **not** contain the source needed for a complete review of CapCut's web application, signing SDK, Passport implementation, trial UI, task UI, or design/creator application bundles. No absent asset was downloaded as part of this audit.

## Findings and implementation implications

1. **The capture is not a complete JavaScript source archive.** It records 26 candidate response bodies, but the CapCut pages' externally referenced bundles are overwhelmingly absent. Existing HTTP behavior can be implemented from captured request/response contracts, but missing generation logic must remain explicitly unproven.
2. **The sole captured CapCut module is not a signing or trial module.** Raw 3000 exposes a worker message boundary around supplied WASM/thread state and a missing VE SDK import. It provides no evidence for Passport signatures, trial eligibility derivation, reward mutation, or checkout/activation.
3. **Checkout JavaScript is third-party and outside the approved product scope.** The Pipo and Google Pay bodies reveal browser/payframe dependencies only. They must not be treated as an activation implementation requirement for an application that only reads trial offers.
4. **No safe static source evidence closes the opaque signature boundary.** The captured CapCut HTTP records may show signature field names, but the required application/SDK bundles are absent. Do not infer algorithms from TikTok or third-party scripts, execute captured code, or add an unsigned/direct fallback.
5. **Inline state is evidence, not reusable source.** Data script blocks were inventoried and hashed but may embed per-session bootstrap values. Production code must obtain current account/session state through its established response/cookie boundaries, never copy captured values.

## Follow-up changes and plan deviations

The initial pass intentionally emphasized byte census and syntax inventory, but that left three review claims too coarse. This follow-up therefore deviated from the first pass in bounded, evidence-preserving ways:

1. The report's erroneous “11 large/minified bodies” statement was recalculated from the ledger and corrected to five.
2. Every valid response body at or below 50 KiB was reread as source and assigned function-group/dataflow findings. CapCut raw 2114's two executable inline blocks were likewise reread. This was required because AST acceptance alone does not establish semantics.
3. Large response bodies were divided into sequential 32 KiB ranges. All 55 ranges are hashed and statically marker/dataflow-reviewed; their remaining minified internals stay explicit rather than being upgraded to full semantic coverage. The same method now covers all six large executable inline instances in 40 ranges.
4. Telemetry discovery now scans every captured monitor batch structurally instead of hardcoding raw 24. Parsed inline JSON also contributes sanitized script references.
5. Reference reconciliation now retains exact query-preserving URL fingerprints and same-origin/path candidates as different availability modes. Queries themselves remain undisclosed.

The 18 resource-manifest response IDs remain the supplied manifest allocation and were fully parsed. This worker did not replace the root-owned independent HTTP census or the other reread allocations. No network access, code evaluation, runtime instrumentation, deobfuscation, credential use, source-signer reverse engineering, or production-code edit was introduced by the follow-up.

## Coverage limitation

This deliverable proves complete byte hashing and classification of the allocated candidate responses and all nonempty inline script elements detected in every HTML-sniffed response. Per response file, the ledger records one of: classification-only (three mislabeled bodies), complete-source static review (17 small third-party bodies), manual interface/flow review (CapCut raw 3000), or bounded static source review with complete chunk coverage (five large bodies). Inline rows separately record parsed JSON structure, complete-source static review (43 executable instances), or bounded static source review (six executable instances).

The bounded large-body/inline review identifies function groups and high-level dataflow but does not claim function-by-function comprehension, runtime branch coverage, encoded-payload decoding, payment/authentication-token interpretation, or deobfuscation. No executable captured inline block remains syntax-only. Absent referenced sources were not reviewed, and this report does not replace the separate per-request HTTP reread.
