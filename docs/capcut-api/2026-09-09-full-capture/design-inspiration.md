# Full CapCut capture: Inspiration + Design flow map

Offline-only analysis of `Capture/Capture_Full_Capcut_Flow` using the indexed records under `.superpowers/sdd/2026-09-09-full-capture-map/indexed`. The source manifest reports 3,315 items (526,282,871 bytes; SHA-256 recorded in the machine artifact), 2,782 focused CapCut items, and 344 `focus-design` records. Every one of the 344 focus-design IDs is classified below; 50 are primary API/storage calls and 294 are media/page/runtime fetches. An additional 18 cross-family storage calls are included because a first-party response or upload-sign flow makes them dependencies of the design sequence. The redacted machine artifact contains per-call schemas, safe enums, header names, status values, body sizes, and hashed opaque references:

- [design-inspiration.machine.json](./design-inspiration.machine.json)

No raw token, cookie value, signature, authorization value, prompt text, object key, URL query value, or static asset body is emitted. Hashes are correlation-only, not credentials; plain hash labels are not a guarantee against guessing low-entropy values.

## High-level sequence

```text
open /ai-design
  -> inspiration/collection/list (empty cursor, count=1; SUCCESS; no resources, has_more=false)
  -> thread/inspiration/check (query carries aid/device_platform/region/web_id; SUCCESS; enable=false)
  -> canvas/save (empty canvas; response canvas_id)
  -> thread/create (resource_id = canvas_id; response thread_id)
  -> thread/run/start (text contents, mode=1) -- SSE: run_start -> text block start/deltas/end -> run_end
  -> thread/detail (thread state)
  -> canvas/save (revision, still empty document)

optional image attachment path
  -> file/chat_upload_sign (biz=thread or file; temporary upload credentials/config)
  -> GET /ttuploader_proxy?Action=ApplyImageUpload (or equivalent ImageX dependency)
  -> external TOS upload POST (opaque bytes; code=2000)
  -> POST /ttuploader_proxy?Action=CommitImageUpload (SessionKey; UriStatus=2000)
  -> thread/image_meta (resource_type=3, format=3; response image metadata)
  -> canvas/save (material/resource binding)
  -> thread/create (second thread)
  -> canvas/save
  -> thread/run/start (text + image; mode=2, image_type=9) -- SSE with heartbeats and JSON artifact
  -> repeated canvas/save revisions

canvas cover path (observed three times)
  -> canvas/upload_sign (biz_id=cover)
  -> ImageX ApplyImageUpload (GET /?Action=ApplyImageUpload)
  -> external TOS canvas-cover upload POST (opaque bytes; code=2000)
  -> ImageX CommitImageUpload (SessionKey; UriStatus=2000; ImageUri/SourceUri)
  -> canvas/cover/update (cover_uri; response origin/preview URLs)
```

The external upload hosts (`tos-my216-share.vodupload.com`, `tos-my16-up.byteoversea.com`, `tos-my319-share.tiktokcdn.com`, `tos-my16-share.vodupload.com`) are listed only as dependencies because the preceding CapCut/ImageX response supplied the upload address/auth material in the capture. Their paths and opaque object references are redacted. The capture does not prove any signature algorithm or that every observed header is required; it only records header names observed on successful calls.

## Inspiration and gating

| Call IDs | Method + path | Observed request shape | Observed response / outcome |
| --- | --- | --- | --- |
| 2169 | `POST /lv/v2/intelligence/inspiration/collection/list` | JSON `{count:number, cursor:string}`; cursor empty in this call | HTTP 200; `ret="0"`, `errmsg="SUCCESS"`; `data.resources=null`, `data.has_more=false`, `data.next_cursor` empty. This is a successful empty collection, not an asset proof. |
| 2266 | `POST /lv/v2/intelligence/thread/inspiration/check` | No body; query names `aid`, `device_platform`, `region`, `web_id` | HTTP 200; `ret="0"`, `errmsg="SUCCESS"`, `enable=false`. The observed gate is disabled. |
| 1958, 2257 | `POST /lv/v1/asset/query` | JSON includes `asset_types[]`, `count=50`, `offset=0`, `order=1`, `order_by="directory_create"`, `is_cross_folder=false`, `workspace_id`, `parent_id` | HTTP 200; `ret="0"`, `errmsg="SUCCESS"`; assets empty, total 0, has_more false in both. |
| 348, 1680 | `POST /lv/v1/asset_auto_sync/get_task` | Empty body | HTTP 200; `ret="0"`, lowercase `errmsg="success"`; `data.task_meta=null`. |
| 398, 1700 | `POST /lv/v1/asset_auto_sync/get_instance` | JSON `{only_running:false}` | HTTP 200; `ret="0"`, lowercase `errmsg="success"`; `data.task_not_set=true`, `instances=null`. |

These are API acknowledgements and empty/disabled states. They should not be treated as proof that an Inspiration asset exists or that a generated visual was saved.

## Canvas identity, revisions, and material binding

`POST /lv/v2/canvas/save` succeeded nine times (IDs 2423, 2454, 2505, 2534, 2579, 2599, 2621, 2630, 2642), all HTTP 200 with response `{ret, errmsg, data.canvas_id, data.complete_at, log_id, svr_time}`. The first empty save returns a new opaque `canvas_id`; subsequent calls reuse it. Each observed request carries `workspace_id`, `canvas_id`, `canvas_detail` (a JSON string), `canvas_meta`, `materials`, `commit_id`, and an empty `old_package_key`. `canvas_meta` has `draft`, `uploadSource`, `createSource`, `canvas_type`; `uploadSource.commitId` equals top-level `commit_id` in all nine requests. These fields were observed, not ablated for necessity.

The decoded `canvas_detail` evolves as follows:

- First saves: `meta`, empty `projectMaterialMeta`, empty `materials`, `guideLine`, and no children.
- ID 2534: one `IMAGE` child; one project-material metadata entry; one material reference; outer `materials[]` has `resource_type=3`, a resource reference, data, and source metadata.
- IDs 2579–2621: same image material persists; a child session object appears on later revisions.
- IDs 2630 and 2642: two material entries, two image children/material references; the generated artifact has a session object with opaque `id`, `runId`, `resultId`, mode, source node IDs, model/model ID, and message ID. No raw values are included.

This is the strongest document-level evidence in the capture: a successful save response plus subsequent saves carrying the same canvas identity and material/resource references. It is still not a visual-render or user-visible asset proof.

## Thread/run and SSE terminal evidence

`POST /lv/v2/intelligence/thread/create` succeeded twice (2433, 2578). Body: `{is_local_resource:false,resource_id,source,workspace_id}`, source 1 then 2. It consumes `resource_id=canvas_id` and `workspace_id`, returning `data.thread_info.thread_id` and timestamps/count/name/source fields.

`POST /lv/v2/intelligence/thread/run/start` succeeded twice (2438, 2584), returning `Content-Type: text/event-stream` bodies:

Observed body keys: `contents`, `libra_params`, `local_run_id`, `mode`, `resource_id`, `selected_models`, `source`, `thread_id`, `workspace_id`; #2584 additionally has `session_start_tools`. Query names: `babi_param`, `msToken`, `X-Bogus`, `X-Gnarly`. Locally appearing identifiers and query signatures have no proven generation algorithm in this capture.

- 2438 text run: 8 frames — `run_start`, `message_block_start`, four `message_block_delta`, `message_block_end`, `run_end`; delta type `text`; request `mode=1`, `source=1`, one text content item.
- 2584 image run: 8 frames — `run_start`, three `heart_beat`, `message_block_start`, `message_block_delta`, `message_block_end`, `run_end`; delta type `json`; request `mode=2`, `source=2`, text + image content (`image_type=9`).

The second stream's assembled JSON delta has one artifact (`resource_type=9`, dimensions 2048×2048, content type numeric 1, one prompt-image entry) and status `{ret:"", errmsg:""}` in the stream payload. The artifact resource reference is then carried into canvas-save material/session metadata. This is terminal SSE evidence for the run stream, not proof that the final image was rendered in the browser.

`POST /lv/v2/intelligence/thread/detail` (2452), body `{resource_id,thread_id,workspace_id}`, returned HTTP 200 with the normal `ret/errmsg/data.thread_info` shape and was used as a thread-state read after the first run.

## Chat-image upload/edit pipeline

The sign endpoint was called three times (2315, 2345, 2507), all HTTP 200 and `ret="0"`, `errmsg="SUCCESS"`. Request body has `biz` values observed as `thread` and `file`; response data contains temporary upload configuration (`access_key_id`, `secret_access_key`, `session_token`, `service_id`, `space_name`, `domain`, `region`, current/expiry times). Values are intentionally omitted.

The thread-image upload then uses:

1. `GET www.capcut.com/ttuploader_proxy` (2509), query names `Action`, `Version`, `ServiceId`, `FileSize`, `s`, `device_platform`; response shape is ImageX `ApplyImageUpload` with upload address, session key, upload host, store URI/upload ID, and auth material.
2. External TOS upload `POST` (2521) with opaque binary body and observed `authorization`, `content-crc32`, `content-disposition`, `content-length`, `content-type`, and `x-storage-u`; response `{code:2000, data.crc32, message, apiversion}`.
3. `POST www.capcut.com/ttuploader_proxy` (2525), query `Action`, `Version`, `ServiceId`; JSON body includes a `SessionKey`; response shape is ImageX `CommitImageUpload` with plugin/result URIs and image metadata.
4. `POST /lv/v2/intelligence/thread/image_meta` (2530), JSON `{resource_id, resource_type=3, format=3}`; response has image resource ID/name/type, dimensions, caption/prompt fields, main/second URLs, transcodes, usage, and status.

The later canvas-save calls bind the returned resource reference. In the second AI run, the SSE JSON artifact (resource type 9) is separately bound through subsequent saves. The capture does not establish that every image field is required or that URL fetches succeeded after metadata response.

## Canvas cover upload pipeline

`POST /lv/v2/canvas/upload_sign` (2465) accepts `{biz_id:"cover"}` and returns temporary upload-sign data (`access_key_id`, expiry/current time, service ID, session token, secret). The observed sequence repeats three times:

- ImageX `GET /?Action=ApplyImageUpload` (2472, 2547, 2654), query names include `Action`, `Version`, `ServiceId`, `FileSize`, `s`, `device_platform`; response includes upload address/host, session key, store URI/upload ID, and auth.
- External TOS canvas-cover byte upload (2475, 2550, 2657), all HTTP 200 with body-level `code=2000`, `data.crc32`, `message`, and `apiversion`.
- ImageX `POST /?Action=CommitImageUpload` (2478, 2551, 2658), JSON `{SessionKey,...}`; response includes `PluginResult[]`, `Results[]`, `ImageUri`, `SourceUri`, dimensions, image format/content type, and `UriStatus=2000`.
- `POST /lv/v2/canvas/cover/update` (2481, 2553, 2661), JSON `{canvas_id, workspace_id, canvas_covers:[{cover_uri}]}`; response returns canvas-cover entries with the cover URI plus origin and 360/480/720/1080 preview URL fields.

The third cover update (2661) carries two cover URIs, showing multi-cover binding. The resulting origin/preview URL hosts are first-party-generated dependency URLs; no later media fetch is asserted here because the capture index contains no exact request-path match after redaction.

## Headers, cookies, and safe implementation guidance

The machine artifact records header names only. CapCut API calls consistently observed application/device metadata, `sign`/`sign-ver`, origin/referer, and browser headers; run/start additionally emitted `msToken` in the query and `msToken` as a newly set cookie. ImageX/TOS calls observed authorization and storage-signature-related header names. This is an observation inventory, not a required-header contract or proof of a signature algorithm.

The native client should preserve this ordering and dataflow, using values returned by earlier calls rather than inventing IDs: `canvas_id → resource_id/thread`, `thread_id → run/detail`, sign response → upload address/session/auth, upload commit URI → image_meta/canvas cover, SSE run terminal → later canvas save. Keep opaque values in memory only and redact them from logs.

## Reward/task distinction

Design calls and storage commits are separate from the CapCut reward task endpoints. Around this sequence, `do_action` calls (1987, 2424, 2511, 2585) all returned HTTP 200 with `{err_no:0, err_tips:"", data:{}}`; later task-list snapshots returned HTTP 200 with task status numeric 4. These are reward/task acknowledgements and status observations, not asset or visual proof. A native implementation must require the actual design API result, fresh canvas/thread evidence, and (where applicable) a fresh task snapshot; do not mark success from `do_action` alone.

The separate common-task video-generation path around ID 1988 is outside this Inspiration/Design report's primary sequence. It should remain mapped as a distinct task flow; do not conflate its queued generation outcome with the successful Inspiration gate or with this canvas/image-edit sequence.

## Coverage and limits

- Focus-design records: 344/344 classified; IDs span 315–3000.
- Primary API/storage calls included: 50 focus-design records; dependency calls included: 18 outside the design family.
- Relevant endpoint variants: 41 method/host/path combinations; all observed relevant HTTP responses were 200 except preflights (204), and external upload/commit bodies reported code/status 2000 where applicable.
- Unknowns intentionally retained: exact required-header set, signature construction, opaque JSON-string contents (`canvas_detail`, material `data`), prompt/private text, raw object paths, and any visual/browser rendering state.
- No network, replay, provider, live browser, source-code, or asset-body access was used.
