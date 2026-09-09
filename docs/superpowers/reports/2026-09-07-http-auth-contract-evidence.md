# HTTP Authentication Contract Evidence

Status: captured reference only; HTTP-only authentication is NOT live-verified.
Plan: `docs/superpowers/plans/2026-09-07-http-only-headless-rewrite.md`, Tasks 2 and 3.

## Inspected Sources

Read existing encrypted captures in the app-private `captures-private` directory.
No network requests, mailbox purchases, browser windows or CDP sessions were
created for this inspection. Electron was used only as the existing safeStorage
decryption runtime; SQLite was not loaded and its native module was not rebuilt.

| Capture basename | Records | Auth requests |
| --- | ---: | ---: |
| `639e3ad5-f94e-434e-a4d3-06bb9a4035eb.enc` | 5055 | 23 |
| `2cdb486f-6d16-4e8e-8ffc-209953d299d2.enc` | 7944 | 75 |
| `8eb3def2-8fc2-4284-8c3f-7f2c11ecb317.enc` | 6879 | 74 |

Inspection: `scripts/inspect-private-capture.cjs <capture> --auth-schema`, launched
with Electron through Node child_process.spawnSync, windowsHide=true, with
ELECTRON_RUN_AS_NODE omitted. All three inspections exited 0 and returned parsed
schema output. Empty stdout from a filter is not evidence of decryption failure.

## Observed Signup Sequence

All first occurrences listed below returned HTTP 200 and `message=success` in
each capture. These are reference UI-run responses, not new HTTP-only successes.

| Method and path | Observed host(s) | Form body fields |
| --- | --- | --- |
| POST `/passport/web/region/` | login-row.www.capcut.com, login.us.capcut.com | type, hashed_id |
| POST `/passport/web/user/check_email_registered` | login-row.www.capcut.com | mix_mode, email, fixed_mix_mode |
| POST `/passport/web/email/send_code/` | login-row.www.capcut.com | mix_mode, email, password, type, fixed_mix_mode |
| POST `/passport/web/email/register_verify_login/` | login-row.www.capcut.com | mix_mode, email, code, password, type, birthday, force_user_region, biz_param, fixed_mix_mode |
| POST `/passport/web/auth_broadcast/` | login-row.www.capcut.com, login.us.capcut.com | hashed_id, type, sec_uid, screen_name, pre_path, final_domain, is_retry |
| GET `/passport/web/account/info/` | www.capcut.com | none |

POST encoding is `application/x-www-form-urlencoded`. Do not send these forms
through a JSON-only request builder. The list describes observed hosts, not a
globally valid hardcoded routing rule.

Common query names: aid, account_sdk_source, sdk_version, language, verifyFp,
timezone_name, webid, browser_language, browser_name, browser_platform,
browser_version, cookie_enabled, screen_height, screen_width.
The OTP send and register requests additionally contained msToken, X-Bogus and
X-Gnarly. Later account-info reads also had signature-related query/header fields.
Presence alone does not establish which fields the server requires.

Response dependencies observed: region discovery returns domain/country_code;
OTP send returns email_ticket; register returns user identity/session fields;
account-info returns authenticated identity. The producer-consumer relationships
and refresh rules still require validation before implementation.

## Remaining Work (Do Not Mark Promoted)

- Establish legitimate HTTP-only production of session material and any required
  fresh signatures. Do not reuse captured signatures for different bodies/accounts.
- Validate form field encoding and origins of mixed/hashed identity values.
- Verify current account routing, cookie domain/path scope, CSRF, expiry and
  refresh without browser bootstrap.
- Implement authentication and verify the authenticated account using HTTP.
- Connect real mission operations, receipts, proofs and persistence to the runner.

The previous SQLite ABI issue affects Node database access, not this analyzer.
No live auth request or new account was created by the inspection. No plan task
is complete merely because these endpoint schemas are now known.
