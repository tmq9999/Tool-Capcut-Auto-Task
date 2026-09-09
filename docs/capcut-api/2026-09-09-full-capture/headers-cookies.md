# Header and CookieJar analysis

## Capture-wide facts

- 64 distinct request header names and 42 cookie names were observed across the 2,782 focused exchanges.
- `headers-cookies.machine.json` preserves item IDs, safe value references, Set-Cookie attributes and equality candidates.
- No header is marked `necessityProven`. A successful browser request only establishes an observed superset.
- Header names such as `sign`, `device-time`, `x-secsdk-web-signature`, `x-secsdk-web-expire`, `authorization`, `x-amz-date`, `x-amz-content-sha256`, `sec-websocket-key` and `x-everphoto-global-session-token` are dynamic or stateful. Never copy a captured value to another profile.

## Cookie inventory highlights

| Cookie | First observed Set-Cookie | Scope seen | First sent | Interpretation |
|---|---:|---|---:|---|
| `ttwid` | 2 | `.capcut.com`, `/`, Secure, HttpOnly | 25 | Browser identity; rotated on page bootstrap. |
| `_tea_web_id` | 2 | host/path `/`, expiry | 25 | Web analytics identity; also observed as `did`/`web_id` source candidate. |
| `uifid` | 81 | `.capcut.com`, `/`, Secure, SameSite=None | 102 | First-party browser identity. |
| `x_logid` | 8 | host/path `/`, Max-Age 120 | 81 | 17 sent occurrences have no earlier indexed equality candidate; cause unknown (do not assume expiry or rotation explains them). |
| `msToken` | 113 | literal Domain `capcutapi.com` or `capcut.com`, `/`, Secure, SameSite=None | 128 | 285 Set-Cookie events/values. Some sent values cannot be traced to a scope-valid earlier setter; see below. |
| `passport_csrf_token` / `_default` | 191 | literal Domain `capcut.com`, `/`, Secure, Max-Age; `_default` lacks SameSite in observed variant | 196 | Passport state. The email branch header matched prior cookie value in the capture. |
| `store-idc` | 196 | Domain `capcut.com`, HttpOnly, expiry/deletion updates | 233 | Passport routing state; apply deletion (`Max-Age=0`) exactly. |
| `reg-store-region` | 191 | Domain `capcut.com`, HttpOnly, `Max-Age=0` events | never sent in indexed request cookies | Deletion/region housekeeping, not positive auth proof. |
| `odin_tt`, `sid_guard`, `uid_tt`, `uid_tt_ss`, `sid_tt`, `sessionid`, `sessionid_ss`, `tt_session_tlb_tag`, `sid_ucp_v1`, `ssid_ucp_v1` | 230 | first literal Domain `capcut.com`, mostly HttpOnly and finite Max-Age; later `odin_tt` also has `.capcut.com` | 233 | Authenticated passport cookie set; account-bound and opaque. |
| `store-country-*`, `cc-target-idc`, `store-country-sign` | 230 | literal Domain `capcut.com`, HttpOnly, 1 year/updated Max-Age | 233 | Region routing. Preserve server value; do not hard-code from the capture. |
| `faceu-commerce-user-info` | 280 | `capcut.com/commerce/v1/subscription/user_info`, SameSite variant | 363 | Commerce-scoped state; must not be sent to unrelated first-party paths. |
| Analytics cookies (`fpk*`, `_ga*`, `_clck`, `_clsk`, `_uetsid`, `_uetvid`, `_ut`, `g_state`, etc.) | no Set-Cookie in this capture | browser-domain sends only | 25/81 onward | Do not use as authentication proof; a native client may omit them after controlled testing. |

The exact attribute variants and all IDs are in the machine catalog. Values are intentionally not printed. Leading dots in a Domain attribute have equivalent domain-cookie matching semantics, but the table distinguishes their literal observed spelling from host-only cookies (no Domain).

### Important source gap: 175 cross-domain `msToken` candidates

The initial name/value-only correlation found **175 sent `msToken` occurrences** whose earlier equal-valued Set-Cookie candidates belong to `capcutapi.com`, while the request is to `www.capcut.com` (first #211/#220/#235/#237). Those candidates are **not scope-valid cookie setters** for these requests. `headers-cookies.machine.json.cookies[].domainPathAudit` retains the mismatch rather than inventing cookie copying. Client JS, embedded state or an unobserved/late-arriving source may explain the value; no such mechanism is proved yet. A correct native CookieJar must not transfer the cookie across these domains to imitate the capture. Expiry/deletion handling and response arrival order also require separate validation.

## Per-account CookieJar contract

```text
CookieJar(accountId, proxyId)
  - RFC cookie matching by domain, host-only flag, path, Secure and expiry
  - Set-Cookie applied in response order, including deletion and replacement
  - no global jar; no copied browser profile
  - request audit stores cookie name + opaque ref + validated source ID,
    or an explicit unknown source (never promote an unscoped equality match)
  - redirect responses are committed before the next hop
```

Use a lock only inside one account jar while applying a response. Do not lock the whole runner: independent accounts must not wait on one another. A shared rate-limit/backoff controller may bound network pressure, but it must not share cookies or task IDs.

## Header provenance classes

1. **Protocol constants observed**: `appid=348188`, `sign-ver=1`, content types, `store-country-code-src` values and some locale/platform fields. Treat these as defaults, not guaranteed requirements.
2. **Response-derived exact matches**: `x-tt-passport-csrf-token` matched the prior passport CSRF Set-Cookie on email checks; `uid`, `x-everphoto-uid`, workspace/space IDs, `x-amz-security-token`, and similar values have prior response candidates. The machine catalog records candidate source items and pointers; causality/necessity are separate questions. HTML #250 script `__GTW_USER_INFO__` -> parse `__userInfoStringify` -> `data.ever_photo.token` exactly supplies #983 `x-everphoto-global-session-token` (different from #237's token). See `bootstrap-state.machine.json`.
3. **Cookie-derived**: `did`/`web_id` matches `_tea_web_id` in observed calls; `uifid` and CSRF headers match their cookies in selected calls.
4. **Generation unproven**: `sign`, `device-time`, `x-secsdk-web-signature`, `x-secsdk-web-expire`, `x-amz-date`, WebSocket key and SDK report fields. Timestamp equality with a server field can be coincidental. AWS-style Apply/Commit Authorization construction remains unproven; TOS byte-upload Authorization instead exactly matches the Apply reply's Auth. Four content-hash headers were independently verified equal to SHA-256 of outgoing body bytes (#2478/#2525/#2551/#2658); the full authorization construction is not thereby verified.

## Controlled verification required before runtime adoption

- Fresh account, one endpoint at a time, no payment or billable mutation.
- Start from a new jar and test a documented ablation matrix: browser-only headers, cookies, dynamic SDK headers, then request body fields. Record HTTP status, structured `ret/errno`, response Set-Cookie and whether the account state changed.
- Repeat with two accounts and two proxies to detect account/proxy coupling. A field is “required” only when its removal causes a reproducible, endpoint-specific failure while all other inputs remain equal.
- Never perform this ablation on email/password/OTP or commerce mutations without explicit authorization and a dedicated disposable account.
