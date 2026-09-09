# CycleTLS live one-account checkpoint (2026-09-09)

This is a real single-account CycleTLS run. No Playwright/Chromium/CDP/browser fallback was used. One Gmail94 CapCut mailbox was purchased under the explicit one-unit cap; no second purchase or automatic resend occurred.

## Step results

| Step | Endpoint / method | Result | Interpretation |
|---|---|---|---|
| Bootstrap | `GET www.capcut.com/`, `GET www.capcut.com/login-embed` | HTTP 200 for both; fresh web ID/cookies | Native cookie bootstrap works. |
| Email branch | `POST login-row.www.capcut.com/passport/web/user/check_email_registered` | HTTP 200, success, `is_registered=0` | Fresh email accepted as new-registration branch. |
| OTP send | `POST login-row.www.capcut.com/passport/web/email/send_code/` | HTTP 200, success, ticket returned; `msToken` rotated | One OTP send only. |
| OTP read | Gmail94 order read | Six-digit OTP received on poll 1 | OTP remains DPAPI-encrypted. |
| Registration | `POST login-row.www.capcut.com/passport/web/email/register_verify_login/` | HTTP 200, success; auth/session cookies set | Account created once. |
| Identity | `GET www.capcut.com/passport/web/account/info/` | HTTP 200, success; ID matched registration response | Auth identity proof passed. |
| User context | `POST www.capcut.com/lv/v1/user/web/user_info` | HTTP 200, `ret=1014`, `system busy` | No workspace/space data from this endpoint. |
| Workspace fallback | `POST edit-api-sg.capcut.com/cc/v1/workspace/get_user_workspaces` | HTTP 200, `ret=1014`, `system busy` | No workspace ID sourced; old ID not reused. |
| Trial offer read | `POST commerce-api-sg.capcut.com/commerce/v1/subscription/batch_get` | HTTP 200, `ret=0`; nested response parsed; four offers `can_trial=false` | Mismatch with old account capture's two eligible seven-day offers. Current request omitted unproven anti-abuse fields, so root cause remains open. |
| Task resource | `POST edit-api-sg.capcut.com/luckycat/i18n/capcut/campaign/v1/capcut/web/resource` | HTTP 200, `err_no=0` | Resource read, not reward mutation. |
| Task baseline | `POST edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list` | HTTP 200, `err_no=0`, **12 rows** | Newbie row status2; other 11 status1. No `do_action`. |

## Transport mismatch found

With CycleTLS default HTTP/2, non-empty Passport POSTs timed out. The same request with only `forceHTTP1=true` returned in about 1.1 seconds. Pinned fhttp source shows the Chrome HTTP/2 flow-control window remains zero; body DATA waits forever. This is a transport-specific upstream issue, not a CapCut rejection. The native HTTP runner therefore pins HTTP/1.1 until the vendored fhttp revision is independently upgraded and verified.

## Why task actions stopped

The current native path still lacks a legitimate generator for CapCut `sign`, `X-Bogus`, `X-Gnarly` and some account-context fields. Notifications/PWA and Creator export are not safe to represent by reward-only calls. Sending `do_action` would create an irreversible side effect without product proof, so this run stopped after the read-only 12-row baseline.

Sensitive evidence is local DPAPI only under `.superpowers/sdd/2026-09-09-native-signup-live/`; this report contains no email, OTP, password, user ID, order ID, cookie, token or signed value. The mailbox purchase is recorded as one attempt and must not be retried automatically.

