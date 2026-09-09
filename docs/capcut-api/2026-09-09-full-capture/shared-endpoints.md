# Shared/bootstrap/configuration and residual traffic

Root analysis covers **1,510 focused exchanges in 130 method/host/path groups**: other493, telemetry1012, static5 by the original heuristic shard label. Those labels are routing labels, not API semantics: `get_collection_templates` was routed to telemetry because of the substring `collect`; the final catalog correctly classifies it as an editor-resource catalog. Every group's IDs, HTTP statuses, query/form names, observed request/response headers, cookies and recursively traversed body shapes are in `endpoint-catalog.json`. All 533 outside-focus records also retain their original metadata/offsets.

## 1. Stateful shared endpoints

Unless the host is explicit, these paths are on `edit-api-sg.capcut.com`. A response shape is observed, not a validated minimum contract. Source values are intentionally absent.

| Method / path | IDs / count | Input shape / purpose | Response / dependencies |
|---|---|---|---|
| POST `/cc/v1/workspace/get_all_everphoto_user` | 276,1649,2170,2678,2985 | Empty body; account-space mapping | `ret`, `data.ever_photo_uids[]`; space ID is not workspace ID. |
| POST `/cc/v1/workspace/mget_workspace_info` | 277,1650,2168,2679,2986 | `{workspace_ids:[]}` | `data.workspace_infos[]`; first ID source is #237 `data.space_info.workspace_id`, not later #278. |
| POST `/cc/v1/workspace/get_user_workspaces` | 278,1648,2723,3027 | `{cursor,count,need_convert_workspace}` | Workspace IDs/roles/space hosts/permissions; `has_more`, `next_cursor`; keep account scoped. |
| POST `/cc/v1/workspace/get_member` | 430,475,1702,1703 | `{count,cursor,workspace_id}` | `member_list[]`, `has_more`, `next_cursor`. |
| POST `/cc/v1/workspace/check_create_workspace` | 432,1704,3160 | Empty body; quota/capability read | `has_create`, limits, `can_create_space`, `create_type`; not an actual create mutation. |
| POST `/cc/v1/workspace/web/get_brand_list` | 2197,2224 | Workspace/version/resource types, need-dependency/sub-item/VIP-tag options | `resource_info_list[]`, count/cursor/has-more maps; catalog, not task proof. |
| POST `/cc/v1/workspace/sync_file_open_time` | 2440 | `{workspace_id,file_id,file_type}` | Success envelope; file-open metadata update, not canvas-save proof. |
| POST `/lv/v1/persona/get_questionnaire` | 289 | Empty body | `question_list[]`, `question_count`; onboarding data. |
| POST `/lv/v1/persona/submit_questionnaire` | 1273 | `{question_list}`; serialized answer field | `user_role`, `user_role_v3`; onboarding mutation, not one of the 12 LuckyCat actions. |
| POST `/lv/v1/user/web/user_permissions` | 431,1743,2250,2695,3026 | `{}` | `permission_map`; do not treat page availability as permission. |
| POST `/lv/v1/user/web/authorized_user_info` | 2802,2994 | `{platform}`; third-platform binding read | **HTTP200, `ret="1904"`, `errmsg="get authorized user info failed from third platform"`**. Third-platform error, not proof that CapCut login failed. |
| POST `/lv/v1/third_party_clouds/user_info` | 339,379,1695,1716 | `{platform}` | Third-party account fields; private values omitted. Not equivalent to passport account info. |
| POST `/lv/v1/user/web/share_user_info` | 376,378,1687,1689 | `{platforms:[]}` | `tt_user_info`, `youtube_user_info`, `facebook_user_info`. |
| POST `/lv/v1/cc4b/get_tt4b_accounts` | 372,1686 | `{}` | `accounts:[]` in inspected replies; business-account binding, not signup. |
| POST `/lv/v1/user/web/check_bind_email_popup` | 1045,1827 | Empty body | Binding-popup status/private account fields; not email code verification. |
| POST `/lv/v1/user/check_age_gate` | 375,1688 | `{}` | `is_show`, `limit_status`; compliance branch. |
| POST `/lv/v1/notice/get_unread_count` | 341,1372,1485,1672 | `{notice_type:[]}` | Unread totals; not OS notification permission. |
| GET `/lv/v1/web/homepage/get_guide_show` | 318,1709 | No body | Guide-type list. |
| POST `/lv/v1/web/homepage/record_guide_show` | 462,1826 | `{guide_type}` | Guide acknowledgement. |
| POST `/lv/v1/start_page/get_tool_list` | 395,1691 | Empty body | `tool_types[]`. |
| POST `/lv/v1/start_page/get_imc_resource` | 412,1697 | `{filter_ands}` | `latest_open_time`, new-feature/start-operation lists. |
| POST `/lv/v1/start_page/report_imc_open` | 446 | `{}` | UI/onboarding event acknowledgement. |
| POST `/lv/v1/ad_maker/user/get_enable_list` | 1015,1819 | Empty body | Feature enable/status lists. |
| POST `feed-api-sg.capcut.com/lv/v1/platform/get_customer_service_portal` | 423,1713 | Entry/source/theme/name/language | Private portal URL; customer support, not a mission. |

## 2. WWW auth/compliance and HTML bootstrap

Host `www.capcut.com`:

| Endpoint | IDs | Observed shape and role |
|---|---|---|
| POST `/lv/v1/sc/age_gate/get_age_gate_config` | 211 | `{}` -> `data.age_threshold`; apply real account-age policy, not invented values. |
| POST `/lv/v1/sc/age_gate/check_age_without_uid` | 220 | `{birthday}` -> `passed`, `lock_duration_hours`, threshold. |
| POST `/lv/v1/sc/age_gate/set_birthday_by_uid` | 235 | `{birthday}` + account context -> success/base response. |
| POST `/lv/v1/sc/age_gate/check_u13_and_trigger_age_assurance` | 952,1823,2177,2753,3001 | `{}` -> `is_u13`, ban-experiment flag, `user_status`, `show_age_verification_popup`; no popup/ban bypass inferred. |
| POST `/lv/v1/sc/compliance_popup/fetch_all` | 698,1817,2171 | `{user_id}` -> `compliance_popups`; UID source must match session. |
| POST `/lv/v1/user/web/user_info` | 237 | `{sem_info:{is_sem,medium,register_source,register_second_source}}` -> account/location/ever_photo/space/subscription data. |
| GET `/`, `/login-embed`, `/my-edit`, `/ai-design`, `/ai-creator/studio`, `/ai-creator/start` | 2,81,250,1642,2114,2666,2976 | HTML is also a state carrier, not merely static UI. All 142 application/json script blocks in these 7 replies were structurally decoded. Embedded JSON strings decoded for source matching. |

`bootstrap-state.machine.json` records those script schemas without values. First Evercloud sync #983 header `x-everphoto-global-session-token` exactly matches #250's script `__GTW_USER_INFO__.__userInfoStringify[JSON].data.ever_photo.token`; `x-everphoto-uid` matches the current space identity. Equal length does not mean equal token: #237's earlier token is different.

## 3. Push and browser-only effects

- `POST www.capcut.com/cloudpush/app_notice_status/`, #1527/#1890/#2725/#3021. Form fields `aid`, `sender_id`, `platform`, `notice`, `system_notify_status`. HTTP200/message reply; Set-Cookie `x_logid`. Later calls additionally carry `uifid,timestamp` query fields and security signature headers. This reports notification status, not a remote API for granting OS permission.
- `POST www.capcut.com/cloudpush/update_sender_token/`, #1889/#2716/#3012. Form fields `aid`, `sender_id`, `platform`, `token`; token is private. HTTP200/message reply; Set-Cookie `x_logid`.
- Firebase installation and FCM registration are outside focus but included in `creator-tasks.machine.json.notifications`; their HTTP requests prove registration traffic, not PWA install.
- `GET www.capcut.com/manifest.json`, #8/#270/#1643: manifest scope/start_url/display/icons. Fetching a manifest does not install a PWA.

Task credit occurs separately, in the order preserved in `creator-tasks.md`; no permission/install endpoint is invented here.

### Firebase/FCM token provenance independently verified

| ID / endpoint | Request and header names | Response / next use |
|---|---|---|
| #1849 POST `firebaseinstallations.googleapis.com/v1/projects/{firebase-project}/installations` | `{fid,authVersion,appId,sdkVersion}`; `x-goog-api-key`, JSON Content-Type and browser headers | `{name,fid,refreshToken,authToken:{token,expiresIn}}`; the `authToken.token` exactly matches #1884 header `x-goog-firebase-installations-auth`. |
| #1884 POST `fcmregistrations.googleapis.com/v1/projects/{firebase-project}/registrations` | `{web:{endpoint,auth,p256dh,applicationPubKey}}`; `x-goog-api-key`, `x-goog-firebase-installations-auth` | `{name,token,web:{endpoint,p256dh,auth,applicationPubKey}}`; response `token` exactly matches #1889 cloudpush form `token`. |
| #1889 POST `www.capcut.com/cloudpush/update_sender_token/` | FCM response token plus `aid,sender_id,platform` | HTTP200/message; only `x_logid` Set-Cookie. |

These two external POSTs returned HTTP200 and no Set-Cookie; their OPTIONS #1844/#1880 returned HTTP200 (do not assume every preflight is 204). Browser PushSubscription material (`endpoint/auth/p256dh`) appears in the FCM request; HTTP capture does not show its browser-local creation or prove a native client may fabricate it. `fid`, project/app/API-key values are kept private; no refresh or push token is printed.

## 4. Generation, realtime and upload

`common_task/list` has 48 empty snapshots and interval30; it is not LuckyCat. `common_task/new` #1988 belongs to Try Inspiration; actual terminal job polling is `/lv/v1/effect/genai/task/query`, ending in #2065 `succeed`. See `api-map.md` §7 for exact differentiation.

`GET sg-gcp.evercloud.capcut.com/sf/{space-or-shard}/v5/GetUpdates`: 35 responses plus 6 OPTIONS. Query names `aid`, `space_id`, `material`, `including_personal`; headers `x-everphoto-global-session-token`, `x-everphoto-uid`, `expect-real-status` plus observed application/browser metadata. Responses have `code`, `message`, `data.space_data`, `data.user_data`, `pagination.next/has_more`. Route's opaque segment cannot be hard-coded from this account. Sync token source is the HTML bootstrap; cookie/session/profile ownership must not change mid-stream.

`GET frontier-sg.capcut.com/ws/v2`: 9 upgrade handshakes, HTTP101, no frames in this XML. Headers include WebSocket key/version/protocol. Do not implement a guessed frame protocol or claim a normal HTTP client replaces WebSocket activity.

ImageX Apply/Commit requests, TOS uploads and canvas-cover state are cross-routed records but fully mapped in `design-inspiration.md`. Four outgoing `x-amz-content-sha256` checks match body SHA-256; that proves only the digest component, not full request-signature generation.

## 5. Editor catalogs and supporting static resources

The catalog retains all calls and full field-path unions for:

- Artist resource category reads (67 POST), panel information (16), multi-get item (30), search words (4), favorites (4), homepage effects (6), action list (1).
- Recent editor templates (1), recent effects (3), plane collection templates (1), brand resources (2).
- WWW resource manifests `editor-page-resource.json`, `editor-wasm-resource.json`, `magic-tools/*page-resource.json`, `ai-creator/page-resource.json`.
- WASM for Evercloud, graphic effects, streaming MD5 and AI Creator. Bodies are byte-counted/hashed, not decompiled. No browser-local rendering/export behavior is proved by downloading WASM.

These resource reads often return empty lists or large catalogs. Do not repeat all page-initialization requests for every task unless a dependency is demonstrated. Equally, do not assume they are safe to remove solely from endpoint naming; controlled tests must prove that a specific adapter no longer consumes them.

## 6. Security/configuration/telemetry

| Endpoint family | Captured role | HTTP-only implication |
|---|---|---|
| `mssdk-sg.capcutapi.com/web/resource` (6 GET), `/web/report` (14 POST) | SDK resource/config and encoded report, rotating `msToken` / `x-ms-token` | No token/signature algorithm proved; cannot replace with stale capture values. |
| `vmweb-normal-sg.capcutapi.com/service/2/abtest_config/` (13 POST) | Device/app/experiment configuration | Per-profile flags may affect available routes; no global shared mutable profile flags. |
| `starling-normal-sg.capcutapi.com/check_and_get_text/{bundle}/normal/{WebClient,H5}` (7 GET) | Locale/string catalogs | Does not complete tasks. |
| `vcs-sg.capcutapi.com/vc/setting` (6 POST) | Security/captcha client settings | Settings success is not challenge solved. |
| `edit-api-sg.capcut.com/service/settings/v3/` (2 GET) | Editor/VE feature flags | Response version-specific; do not guess engine behavior. |
| `mcs-normal-sg.capcutapi.com/list` (405 POST), `/v1/list` (16 POST) | Analytics events | Diagnostic only. |
| `mcs-normal-sg.capcutapi.com/v1/user/webid` (#2468) | `{app_id,url,user_agent,referer,user_unique_id}` -> `{e:0,ssid,web_id}` | Upload analytics context; not interchangeable with initial passport/device web ID. |
| `mon-sg.capcutapi.com/monitor_browser/collect/batch/` (471 POST), `/security/` (16 POST) | HTTP/resource/performance/security telemetry | Usually 204; not business mutation proof. |
| `mon-sg.capcutapi.com/monitor_web/settings/browser-settings` (26 GET) | Monitoring settings; `errno=200` response dialect | Do not use a universal “nonzero code = failed” parser across services. |
| `feed-api-sg.capcutapi.com/survey/api/feelgood/v1/token`, `/event` | Survey bootstrap/event; two POSTs each | Private survey token, not CapCut authentication. |

Raw bodies of all **1,012 focus-telemetry requests** were re-read for event classification: 5,052 top-level event/batch entries, including 3,150 HTTP, 703 resource, 34 resource-error and one JS-error entry. 227 HTTP telemetry events have status0/4xx/custom-error flags; these are sampled/duplicated reports, **not 227 additional authoritative failed API responses**. See `telemetry.machine.json`; raw messages/stacks stay private.

Independent deep review of these flags found: **141 HTTP200 + 53 HTTP204 + 33 status0**. All 194 custom-error-flagged rows have HTTP200/204: 188 have blank custom ret/message, four uploads explicitly report code2000/success, and two contain the already identified ret1904 linked-user error. Thus the flag alone is not a reliable failure classifier. The 33 status0 rows are analytics/ad traffic only (Google Analytics17, Google12, DoubleClick4). Resource failures: 31 img/3 script, all Bing/Clarity tracking resources or two local blob images. They are not a captured export-download failure.

Independent actual response inventory has **zero HTTP4xx/5xx in focused domains**. It still contains application failure #2802/#2994 `ret=1904`. Twenty actual outside-domain HTTP400 responses belong to Google autofill/password leak checks, not CapCut mission endpoints. Successful task/account envelopes do not erase these distinctions.

### Confirmed error and remediation boundary

| Evidence | Actual finding | Impact / scoped next step |
|---|---|---|
| Telemetry #1531, `js_error`, `AbortError`, `onunhandledrejection` | PushManager subscription failed because no active Service Worker existed. The telemetry upload itself returned204; failure is in its event payload. | Directly affects that web-push registration attempt. For browser behavior, require an active worker before subscribing and keep failed state distinct from reward. It does **not** prove PWA installation failed, nor an HTTP-only replacement for the worker. Later Firebase/FCM #1849/#1884 and cloudpush #1889 succeed; preserve both observations. |
| Actual API #2802/#2994 | Linked-platform user lookup `ret1904`, despite HTTP200 | Mark binding read failure, not CapCut auth failure; do not crash other workers or overwrite valid passport identity. No evidence links it to export. |
| Inspiration product #1988/#2056/#2065 vs reward #1987/#1993 | Reward is credited before terminal job success; progress100 occurs before `succeed` | Product adapter must wait on its own job terminal status and artifact, not reward/progress alone. No inter-account barrier needed. |
| Export reward #2957/#2958 | Credited; no matching exported-file evidence | Do not report file production as verified. A new narrowly scoped export capture with file/download/error events is needed before choosing an export fix. |

Generation/render/upload success diagnostics are present; preload rows with a top-level failure label also have successful substatuses and failureCount0, so they cannot be called confirmed preload failures. No reviewed telemetry item establishes export/download failure. This capture cannot identify the root cause of the project's earlier “2/3 export” run because it is a different run with different evidence.

## 7. Coverage meaning and remaining gaps

Every item is indexed; every focused JSON/form/SSE body is structurally traversed, domain workflows reviewed, and key value dependencies compared in memory. This is not a claim that every byte of every static executable, media object or encoded SDK blob has been semantically reverse-engineered. Full raw request/response bytes remain in the original capture; redacted per-exchange bodies remain in the local indexed shards. One account and request-order timestamps cannot establish 3-account independence, native TLS behavior, header necessity, response-arrival order or safe retry semantics.
