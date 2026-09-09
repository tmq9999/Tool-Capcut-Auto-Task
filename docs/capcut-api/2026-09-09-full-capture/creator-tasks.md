# Creator / video and task-reward map

## Scope and evidence rules

This report is an offline reading of all 387 records in `focus-creator.jsonl` and all 102 records in `focus-task.jsonl` from capture SHA-256 `e5e97fb2aa376d98417d2ebeb9041889c17639e95a24aba1ea4b7d122b52e1d9`. The raw Burp XML was accessed only through the indexed `offset` / `length` metadata and `capture-lib.cjs::readItem`. No request was replayed.

Paths below retain the constant raw `i18n` segment from the original URL but omit all query values. Opaque identifiers, account data, tokens, signed URLs, prompts, message text, cookie values, and header values are not reproduced. A repeated value is represented only by an opaque SHA-256 prefix in the machine map. HTTP 200 plus an application code of zero is reported as an observed response, not proof that every observed header is required or that the operation is safe to synthesize.

## High-confidence findings

- Every one of the 12 LuckyCat task keys appears in every one of the 34 `task_list` snapshots. Nine leaf tasks have a captured `do_action`; registration was already complete, and the design/video “creation” tasks are parents that completed after their three children. There is no extra parent `do_action` in the capture.
- Every `do_action` returned HTTP 200 and `err_no: 0`, then a fresh `task_list` showed that same leaf at observed status `4`. Each request carried a distinct opaque `op_id`. The capture does not establish how `op_id` is generated.
- Notification authorization was rewarded first and PWA installation second. These two LuckyCat calls prove reward acknowledgements only. They do not prove native browser permission or installation operations. Firebase installation, FCM registration, and CapCut cloud-push token calls occur later and belong to browser/push plumbing, not the PWA-install reward call itself.
- The AI Creator flow is a long-lived SSE conversation plus draft and asset APIs. It creates a draft, sends a normal message, sends a second message with `option.credits_confirm`, receives streamed tool activity, queries an image asset, and observes draft versions advance. There is no separate “confirm” endpoint.
- `capcut_web_video_studio_export` reaches status `4` after a successful `do_action`, but the capture contains no native export/download endpoint, attachment response, or file body for that action. Reward completion is proven; export-file production is unknown.
- The separate inspiration video-generation chain (`common_task/new`, mapped by the common-task report) is not LuckyCat. Its `do_action` reward occurs before the generated task eventually reaches `succeed`; the final query contains opaque video, cover, and download URL fields. Product success and reward success are therefore distinct facts.

## Exact 12-key task model

Observed status values are described only within this capture: `1` is the initial state, `2` is a transient parent state, and `4` is the final credited/completed state.

| Task key | Relation | Reward | Evidence |
|---|---:|---:|---|
| `capcut_web_newbie_register` | independent/base | 160 | Already status 4 in record 402; no `do_action` in this capture. |
| `capcut_web_pwa_install` | independent leaf | 70 | `do_action` 1611 -> snapshot 1614 status 4. Browser install itself is unobserved. |
| `capcut_web_push_authorize` | independent leaf | 70 | `do_action` 1561 -> snapshot 1564 status 4. Browser permission itself is unobserved. |
| `capcut_web_design_studio_picture_creation` | parent of task IDs 100009–100011 | 30 | Status 1 -> 2 in 2588 -> 4 in 2593 after all children; no parent action. |
| `capcut_web_design_studio_ai_chat` | child | 40 | `do_action` 2424 -> snapshot 2431 status 4. |
| `capcut_web_design_studio_upload_img` | child | 40 | `do_action` 2511 -> snapshot 2517 status 4. |
| `capcut_web_design_studio_canvas_edit` | child | 50 | `do_action` 2585 -> snapshot 2588 status 4. |
| `capcut_web_inspiration_generate_done` | independent leaf | 40 | `do_action` 1987 -> snapshot 1993 status 4. Artifact job was still processing and later succeeded at 2065. |
| `capcut_web_video_studio_creation` | parent of task IDs 100013–100015 | 30 | Status 1 -> 2 in 2958 -> 4 in 2961 after all children; no parent action. |
| `capcut_web_video_studio_send_msg` | child | 40 | `send_msg` 2874; `do_action` 2875 -> snapshot 2877 status 4. |
| `capcut_web_video_studio_generate_done` | child | 40 | streamed generation completion; `do_action` 2927 -> snapshot 2929 status 4. |
| `capcut_web_video_studio_export` | child | 60 | asset lookup 2955; `do_action` 2957 -> snapshot 2958 status 4. No export file response observed. |

All final states are independently present in records 2961, 2965, and 3113. The parent records have no `complete_time`; that absence is preserved and must not be filled from child times.

## Task and reward timeline

Times are capture-local (GMT+07:00).

| Time | Records | Observation |
|---|---|---|
| 05:36:08 | 402 | Baseline: registration status 4; all other eleven keys status 1. |
| 05:43:51–52 | 1561, 1564 | Push reward action succeeds; fresh snapshot changes only `push_authorize` to 4. |
| 05:44:44 | 1611, 1614 | PWA reward action succeeds; fresh snapshot changes only `pwa_install` to 4. |
| 05:45:37–38 | 1987, 1993 | Inspiration reward reaches 4 before the separate generated-video task finishes. |
| 05:46:35 | 2065 | Separate generation task reaches `succeed`, progress 100, with opaque video/cover/download URL fields. |
| 05:47:36–37 | 2424, 2431 | Design chat child reaches 4. |
| 05:48:09 | 2511, 2517 | Design upload child reaches 4. |
| 05:48:47–48 | 2585, 2588, 2593 | Canvas child reaches 4; design parent passes through 2 and then 4 without another action. |
| 05:50:12 | 2874, 2875, 2877 | Creator message accepted; send-message reward reaches 4. |
| 05:50:28 | 2905 | Second `send_msg` carries `credits_confirm`; same conversation/project, new round/message ID. |
| 05:51:34 | 2927–2930 | Generate reward reaches 4; first asset query returns one image result with `err_code: 0`. |
| 05:51:42–43 | 2955, 2957–2961 | Second image asset lookup succeeds; export reward reaches 4; video parent passes through 2 and then 4. |
| 05:51:44 | 2962 | Draft version advances again after reward completion. This is draft evidence, not a downloaded export. |

`task_list` was polled 34 times. Duplicate adjacent snapshots are retained in the coverage file rather than discarded. The two generic `/lv/v2/task/get_task_list` responses contained zero items, and the two `/lv/v1/task/web_user/pop` responses had null activity/reward fields; neither substitutes for the LuckyCat 12-key ledger.

## Creator / AI video chain

1. `POST /storyboard/v1/studio_draft/create_project` (2828) accepts `title`, serialized `draft_content`, and `draft_type`; it returns opaque `draft_id`, initial `version`, and `sandbox_id`.
2. `POST /storyboard/v1/studio_draft/fetch_latest_version` is called six times (2840, 2842, 2882, 2911, 2918, 2962). Record 2840 queries a different opaque draft and returns no version. The other five query the created draft. Its version hash is stable through 2882, changes by 2911, and changes again at 2962.
3. `POST /storyboard_agent/v1/ai_lab/send_msg` (2874) carries locally/unproven message and round UUIDs, a conversation UUID, the created project ID, content, and model/entry options. The HTTP response is only a success envelope (`ret: 0`); it does not return an event ID or artifact.
4. `POST /storyboard_agent/v1/ai_lab/send_msg` (2905) is the confirmation operation because its option contains `credits_confirm`. It reuses the same conversation and project identifiers, uses a new message/round identifier, and again returns only a success envelope.
5. `POST /storyboard_agent/v1/ai_lab/poll_by_event_id` (2746) is a long-lived `text/event-stream` response. The request has an empty `event_id` and an opaque session ID whose source is not present in an earlier assigned response. Although its index ID precedes the message calls, streamed event `create_time` values and echoed identifiers place those messages inside this open stream.
6. The SSE has 48 events: 29 heartbeats, eight message events, three delta events, two `round_done` events, two cover updates, and the remaining message/tool events. It echoes the first user round, emits a synchronous `commercial_estimation` tool call, later emits an asynchronous `generate_image` tool call with an opaque task ID, then a `media_list` tool result and final round completion. This proves streamed server state, not a client-side video render or an export file.
7. `POST /storyboard_agent/v1/ai_lab/batch_query_assets` (2928) queries one opaque resource and returns one image record (`err_code: 0`) with dimensions/format and opaque URL variants. Record 2955 reuses that resource and the created draft ID and returns another one-image record (`err_code: 0`) with a new opaque resource. This equality is observed dataflow; URL values remain hidden.
8. `POST /lv/v1/editor/plane_draft/get_content_map` (2237) sends 30 content hashes plus an ID map and receives 30 serialized content entries. The map appears client/draft-derived; there is no preceding assigned response that proves its source.

The neighboring WebSocket handshakes (`GET /ws/v2`, HTTP 101) contain no captured frames and are not enough to infer additional operations.

## Supporting endpoint groups

The remaining Creator calls are configuration/catalog reads: user permissions (2), model lists (8), skill lists (10), admin permission checks (12), collections (3), collection templates (18), lead version (1), idea prompts (1), and UID audit (2). Every POST returned HTTP 200 and application `ret: 0`; their OPTIONS preflights returned 204.

The 288 `/storyboard/v1/tts/multi_platform` POSTs are all accounted for: every call returned HTTP 200, `ret: 0`, and one TTS material. There are 279 `sami`-platform requests and nine `11labs`-platform requests; all have one text, URL requested, rate 1, volume 100, and `is_clone: false`. Text, speaker, material IDs, and media URLs are not reproduced. Four OPTIONS preflights returned 204.

Task-support endpoints also returned successful envelopes: campaign resource (3 POST), diversion main page (2), task resource (6), web-user pop (2), generic task list (2), LuckyCat task list (34), generation task query (20), and `do_action` (9), plus their OPTIONS calls. Task resource and `do_action` responses set `msToken`; no Creator endpoint response set a cookie.

## Notification and PWA boundary

The observed order is important:

- 05:43:15 record 1527: CapCut `app_notice_status` read/update occurs before the reward actions.
- 05:43:51 record 1561: LuckyCat push reward acknowledgement.
- 05:44:44 record 1611: LuckyCat PWA-install reward acknowledgement.
- 05:45:05–09 records 1844/1849, 1880/1884, 1889/1890: Firebase installation, FCM registration, CapCut sender-token update, and notice-status update.
- 05:49:37 and 05:52:14–15 records 2716/2725 and 3012/3021: later sender-token and notice-status refreshes.

The Firebase and FCM payloads contain credentials/tokens and are described only by field names. CapCut cloud-push uses form fields `aid`, `sender_id`, `platform`, and either `token` or notice/status fields; responses are HTTP 200 with a message and set only `x_logid`. These records show actual push-registration HTTP traffic after the rewards, but do not establish that LuckyCat performed browser permission or PWA installation.

## Observed headers and provenance limits

Creator/task JSON POSTs commonly include `appid`, `device-time`, `store-country-code`, `store-country-code-src`, `sign-ver`, `appvr`, `content-type`, `accept`, `sign`, `pf`, `did`, Origin/Referer, Fetch Metadata, Client Hints, locale (`lan` or `loc` on some calls), and ordinary transport headers. Distribution endpoints additionally show `app_id` and `app-sdk-version`. LuckyCat requests may use signed query-name slots (`msToken`, `X-Bogus`, `X-Gnarly`) whose values are withheld. Some later cloud-push requests show `x-secsdk-sign-config` and `x-secsdk-web-signature`.

Observed provenance is mixed: `did`/web ID and session cookies trace to earlier browser state; the draft ID is a direct prior response value; the asset resource is reused from an earlier asset response; task-query IDs come from the separate generation response; conversation/message/round/session UUIDs and every `op_id` have no prior response source in the assigned records and are therefore local-generation-or-earlier-state, unproven. A single capture cannot prove cryptographic construction, header necessity, or safe replay order.

## Coverage artifacts

- `creator-tasks.machine.json` contains safe task transitions, chains, endpoint contracts, hashes, evidence classifications, and the complete `coverage.creator` / `coverage.task` reviewed-ID arrays. Counts reconcile to 387 + 102 = 489, including preflights and static repeats.
