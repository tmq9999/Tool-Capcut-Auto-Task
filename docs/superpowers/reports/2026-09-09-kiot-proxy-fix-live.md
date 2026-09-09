# KiotProxy mandatory transport — fix and fresh live result

## Scope

User explicitly required KiotProxy before every CapCut request, held constant through registration and trial inspection, with no direct or browser fallback. The previous direct-created account is not used as the new registration sample. This run purchased exactly **one additional** Gmail94 CapCut mailbox, maximum **1,000 VND**, after a verified Kiot route was acquired. Old capture/user credentials were not replayed.

## Code fix

- `cycleTlsContext.ts`: rejects CapCut-domain requests without a proxy before lazy native driver startup. Covers `capcut.com`, all its subdomains, `capcutapi.com`, all its subdomains, case differences and trailing DNS dots.
- `cycleTlsRuntime.ts`: repeats the guard before sending any native IPC request frame. Validates and snapshots/freeze-clones proxy/TLS settings, so the caller cannot change route after construction. No proxy-error retry or fallback to direct was introduced.
- Proxy URL validation rejects embedded credentials, non-root path, query, fragment and control characters. Bare SOCKS root forms and slash forms remain accepted.
- `live-http-only.cjs --bootstrap` now requires a strict `--proxy-file` whose provider is `kiotproxy`; missing/malformed routing fails before context initialization. CLI output contains provider only, not proxy address/credentials.
- Provider API reads and localhost fixtures may remain direct; every request to CapCut in the live run used the same proxied CycleTLS context. The transport enforces a proxy; the live harness independently verifies that its selected route is issued by Kiot.

## Live route proof

Lease alias: `f36d4481-35e9-454a-b593-0c6ef15f56f1`.

Before acquisition, local DB had zero active leases; configured Kiot catalog returned ten active keys. One route was obtained and recorded for this run. Before any CapCut request or mailbox purchase, a request to an IP echo service through that route matched the IP returned by Kiot. Route and egress were checked again before registration, before trial and after all CapCut requests: **4/4 matched the same lease/IP**. No IP/key/credential value is included here.

The route was released after the run: Kiot returned explicit success, then only the matching DB lease row was marked released. Other leases were not touched. This proves this run's route checks, not an atomic cross-process lease lock; the prior source audit found shared-manager lease ownership races that need a separate fix before concurrent production use.

## Fresh account result

Elapsed from first proxy proof to final context cleanup: about **36 seconds** (02:22:28–02:23:04 UTC on 2026-09-09). **11 CapCut requests**, one mailbox purchase, one OTP send, one registration attempt.

| Step | HTTP/application outcome |
|---|---|
| WWW bootstrap + login-embed | Both HTTP200 over Kiot; new web ID/cookies |
| Email availability | HTTP200, `message=success`, new-email branch |
| Send code | HTTP200, `message=success` |
| OTP | Received on poll3; value not printed |
| Register verify login | HTTP200, `message=success`, auth cookies |
| Account info | HTTP200, `message=success`; identity matches registration |
| User info | HTTP200, `ret="1014"` |
| Get user workspaces | HTTP200, `ret="1014"`; no live workspace ID |
| Trial offer batch | Outer HTTP200/`ret="0"`; nested `ultra` and `vip` both `ret="0"`; Ultra2 + VIP4 offers all `can_trial=false` |
| Campaign resource | HTTP200, `err_no=0` |
| Task ledger | HTTP200, `err_no=0`, **12 rows**; no reward mutations |

No trial activation, checkout/payment, or task `do_action` was sent. Account inputs/session responses are DPAPI-encrypted in the ignored local directory `.superpowers/sdd/2026-09-09-kiot-proxy-fix/`.

## Trial mismatch is not resolved

Adding a verified Kiot route fixed the direct-routing mistake. It **did not make the returned offer catalog contain a seven-day trial in this run**. Do not claim either that proxy is irrelevant or that this account can never receive an offer.

This run used the capture's Windows/Chrome152 User-Agent string and matching `browser_version`, timezone, browser language/platform, screen fields and cookie-enabled metadata. It used freshly returned server web ID/CSRF/cookies, and a current `msToken` query on commerce. It still did **not** supply a generated `verifyFp`, `X-Bogus`, `X-Gnarly`, or `sign`; the audit ledger explicitly marks every request as not baseline-equivalent. These omissions are known contract gaps, not proved causes of trial selection. New account, network route and metadata also differ from the old sample, so this is not a controlled one-variable causality experiment.

The old capture's #3163 still proves two seven-day zero-price offers on that old account. Its payload must be decoded from JSON-string `response`; the new live response was decoded the same way. The application errors `ret1014` remain a concrete blocker to workspace-dependent missions.

Independent raw-DPAPI verification found response entries reordered: index0 is Ultra, index1 is VIP. Match entries by `key`, not index. Recursive inspection of all JSON strings (`response`, six `display_content`, six `pms_trade`, one extra) found no hidden trial_info/7-day/free-trial offer; the six flags are actually false in this response. Sealed run `identity` is a local UUID, not the account user ID; authenticated identity proof compares the register and account-info response IDs privately.

## Verification

- Initial RED: direct requests reached the native driver; mutable routes and malformed proxy strings accepted.
- Follow-up RED: trailing-dot host bypass and bare SOCKS path rejection reproduced; fixed and independently re-reviewed.
- Final root command: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/main/services/capcut/http/__tests__ scripts/__tests__/live-http-only.test.mjs scripts/__tests__/cycletls-live-options.test.mjs` → **35 files / 264 tests PASS**.
- `npm run lint` → PASS.
- `npm run typecheck` → only the same two pre-existing errors: `AutomationRunService.test.ts:654` missing verification.complete and `AutomationWorkSource.ts:12` redundant type modifier. Full build not claimed clean.
- Direct public CLI invocation now exits1 with `HTTP_ONLY_PROXY_FILE_REQUIRED`; direct low-level CapCut GET rejects `CYCLETLS_CAPCUT_PROXY_REQUIRED` without loading a browser.
- Runtime dependency check found no Playwright/undici/Chromium modules loaded. No bridge process remained after the completed test.
- Reviewed changes remain uncommitted; unrelated work and previous direct-run evidence are preserved, labeled separately.

## Follow-up boundaries

1. Continue diagnostics only with a valid Kiot route; a released lease cannot be reused as proof of IP continuity without checking its current route and egress.
2. Correct the application metadata/signing contract and compare product/plan variants, without replaying another account's tokens or forging a success response.
3. Do not buy more mailboxes merely to search for an eligible offer. Do not equate received reward with notification/PWA/export product success.
4. The shared `ProxyLeaseManager` checks must be hardened against cross-process key-ownership races before claiming safe 10–20 account operation; this single-run snapshot is not that proof.
