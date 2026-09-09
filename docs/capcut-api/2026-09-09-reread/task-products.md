# Task, Design, and Creator Raw-Capture Reread

Date: 2026-09-09  
Scope: every indexed row whose primary family is `task`, `design`, or `creator`, across all hosts. This was an offline reread of the raw Burp item bytes. Prior reports were comparison targets, not reread evidence.

## Coverage and method

- Primary allocation: **911/911 unique rows** — task 102, design 422, creator 387.
- Extracted body bytes read and SHA-256 hashed: **324,765 request bytes** and **342,113,891 response bytes**. These totals match the locator index exactly; no allocated ID, duplicate ID, or byte-count mismatch was found.
- Top-level parse results: 462 JSON/JSON, 6 empty/JSON, 2 empty/text, 3 JSON/SSE, 362 empty/binary, 4 binary/JSON, and 72 empty/empty preflights. There were no top-level parse failures. Nested JSON strings were recursively decoded with a depth-12 safety cap; the ledger now exposes `requestNestedLimit` and `responseNestedLimit`, and **zero rows hit that cap**. Nine template-list rows contained 15 JSON-looking strings that were not valid JSON, retained as strings and explicitly counted in the ledger.
- Review depth: **471 deep** structured exchanges and **440 mechanical-only** exchanges. Here, `deep` means endpoint/body-level semantic analysis: the complete structured body was traversed and its role/schema/timeline was reviewed. It does **not** claim function-by-function semantic review of every nested source string, embedded template program, or imported source. Mechanical-only comprises 366 exchanges with a binary body, 72 CORS preflights, and the PWA HTML/worker-source rows delegated to the cross-cutting JavaScript review. A body hash proves byte coverage, not image/audio/video meaning.
- Machine evidence: `.superpowers/sdd/2026-09-09-capture-reread/task-product-rows.jsonl`. Each row has exactly `{id,requestBytesRead,responseBytesRead,requestSha256,responseSha256,parseState,analysisDepth,role,findings}`.
- Supplementary dependency reads outside primary ownership: notification registration #1527/#1849/#1884/#1889/#2716/#3012, Inspiration job creation #1988 and all 48 `common_task/list` rows, and ImageX apply/commit #2472/#2478/#2547/#2551/#2654/#2658. These are not included in the 911 primary count or ledger; root owns their primary ledger.

## The reward ledger is not the product ledger

The capture has 12 LuckyCat task rows: one signup row, two browser-state rows, an Inspiration leaf, and two three-child mission groups. All nine captured `do_action` calls returned HTTP 200 with `err_no=0`, but that acknowledges the reward action only. A later `task_list` snapshot is the authority for credited status, while the product APIs provide separate evidence about submissions, saves, generated resources, and downloads.

Observed reward transitions:

| Leaf | `do_action` | First confirming snapshot | Product fact at that moment |
|---|---:|---:|---|
| Notifications | #1561 | #1564 | CapCut notice-state update #1527 preceded it; Firebase/FCM registration occurred later (#1849/#1884/#1889), so the capture does not prove that FCM registration was required for credit. |
| PWA install | #1611 | #1614 | No HTTP exchange proves an installed PWA. The capture proves only reward acknowledgement plus credited snapshot. |
| Inspiration | #1987 | #1993 | Reward was credited before generation job creation #1988 had reached terminal state; generation first appeared processing at #2003 and succeeded only at #2065. |
| Design chat | #2424 | #2431 | Reward was credited before thread creation #2433 and before the text-only run #2438 reached `run_end`. |
| Design upload | #2511 | #2517 | Reward was credited before binary upload #2521, upload commit #2525, image metadata #2530, and material-bearing canvas save #2534. |
| Canvas edit | #2585 | #2588 | The immediately preceding SSE #2584 had a successful image artifact and `run_end`; later saves and cover updates continued through #2661. |
| Creator send | #2875 | #2877 | `send_msg` #2874 was accepted, but its empty success envelope contained neither an event ID nor generated media. |
| Creator generation | #2927 | #2929 | The long Creator stream #2746 had already emitted a successful generated image; #2928 resolved asset metadata at approximately the same time. |
| Creator export | #2957 | #2958 | Asset query #2955 returned image metadata and a signed location. No subsequent captured GET proves that file bytes were downloaded/exported. |

The group parents have no captured `do_action`. After the last design child, the parent moved status 1 → 2 in #2588 and 2 → 4 in #2593. The Creator parent did the same in #2958 and #2961. Both parent rows lacked a `task_progress.complete_time` even at status 4. Parent completion is therefore an asynchronous server reconciliation fact, not a synthesized parent mutation and not something that should be inferred from a missing timestamp.

## Product timelines

### Notifications and PWA

Notification traffic spans separate systems. CapCut accepted a notice-state update at #1527. Much later, Firebase Installations #1849 issued installation authentication material, FCM #1884 registered a web push endpoint/key set, and CapCut accepted the sender token at #1889; equivalent sender-token updates recur at #2716 and #3012. The task reward was already credited at #1564. This ordering prevents a claim that the Firebase/FCM sequence was the causal proof for this reward. It also means replaying `do_action` alone would manufacture a reward request without proving browser permission or a viable push subscription.

For PWA, #1611/#1614 prove reward acknowledgement and snapshot credit, but no captured product API proves installation. A browser install prompt/outcome is outside this HTTP corpus. Current `HttpMissionStrategy.capabilities` correctly leaves both `notifications` and `pwa` false (`httpMissionStrategy.ts:40-49`).

### Inspiration

The discovery endpoints did not provide the chosen job: collection-list #2169 returned no resources and the feature check #2266 returned disabled for that check. The real submission is cross-family row #1988, `common_task/new`, which returned one queued job with an estimated duration. `effect/genai/task/query` was empty at #1989, processing with zero progress from #2003, reached 100 while still processing at #2056, and became `succeed` at #2065. All 48 captured `common_task/list` responses were empty, so they are not the terminal job lookup in this flow.

The reward `do_action` #1987 occurs immediately before job creation #1988, and snapshot #1993 is already status 4. Thus the task label “generate done” does not describe the captured reward trigger: the reward was credited on or around submission, roughly a minute before terminal product generation. `submitInspirationHttp()` similarly calls a queued/processing result “accepted” (`inspiration.ts:131-134`); that is a valid submission receipt but must never be reported as generated output. It also pins one captured template identifier (`inspiration.ts:72-73`) and does not poll the returned job to terminal state.

### Design Studio

Three distinct layers appear:

1. **Chat:** an initial empty canvas save #2423 is followed by reward acknowledgement #2424/#2431, thread creation #2433, then SSE #2438 with `run_start`, text deltas, and matching `run_end`. It contains no generated artifact. Thread detail #2452 and save #2454 follow. A successful chat run is therefore text-stream completion, not image creation.
2. **Upload:** temporary upload credentials #2507 lead to raw upload #2521, commit #2525, image metadata #2530, and save #2534 containing the material and image node. The reward was already credited at #2517. The upload transport and commit identify a stored image, while the later canvas save proves association with the canvas.
3. **Canvas edit/generation:** thread #2578 and save #2579 precede SSE #2584. That stream contains `run_start`, heartbeats, a successful 2048×2048 image artifact referencing the uploaded prompt image, and matching `run_end`. After reward acknowledgement #2585, the leaf is status 4 and parent is status 2 at #2588; the parent reaches 4 at #2593. Multiple saves then add/persist the generated material through #2642, followed by cover upload/apply/commit/update ending at #2661.

The four binary uploads (#2475/#2521/#2550/#2657) were each read and hashed in full. Their captured lengths match the later commit metadata (4,786; 144,865; 20,684; 38,508 bytes), whose declared formats are PNG/JPEG. The Burp body representation does not preserve trustworthy original magic bytes for all four, so this is byte/transport and declared-metadata evidence only—not a semantic image inspection.

Current discrepancies:

- `submitDesignChat()` accepts any HTTP-successful stream without parsing `run_start`, matching `run_end`, stream errors, or thread correlation (`designStudio.ts:28-36`). `HttpMissionStrategy.designChat()` then marks that receipt accepted. The captured good case has a matching end; current code would also accept a truncated or error-bearing HTTP 200 stream.
- `inspectDesignReceipt()` computes `ended` but its `accepted` flag does not require it (`designReceipt.ts:10-33`). The captured browser path checks `accepted` yet returns even when `ended` is false (`capturedDesignChat.ts:66-72`). Canvas code is stricter and requires end plus artifact (`designCanvas.ts:49-51`). Chat should require its own terminal text-run receipt while not incorrectly requiring an image artifact.
- The production ImageX primitive only posts bytes to an already supplied upload address (`imagexUpload.ts`). The observed dependency chain also needs apply, raw upload, commit, image metadata, and canvas save. Apply/commit handling currently lives in scratch harness code rather than a registered `HttpMissionOperation`.

### Creator / Video Studio

The first Creator-page phase is mostly catalog preload. There are 288 TTS POSTs using one text payload across 44 speakers, followed by 288 audio GETs. All POSTs returned successful audio-resource metadata; 282 declare MP3 and six omit the nested audio format. This bulk preview traffic is not linked to either Creator mission reward.

The mission flow is:

- Project creation #2828 returns a draft reference. Early version read #2840 is empty; #2882 and later reads contain a version. This proves project/draft creation, not generation.
- Initial message #2874 returns only a success envelope. Reward acknowledgement #2875 and snapshot #2877 credit “send.”
- One long SSE poll #2746 begins with an empty event cursor and spans later activity. It has 48 events: 31 heartbeats, a commercial confirmation card requiring 65 credits with 500 remaining, the confirmation round, a progress tool item, a `generate_image` media item reaching `succeed` at 2560×1440, and round completion. Confirmation message #2905 also returns only an empty success envelope.
- Asset query #2928 resolves the generated image and precedes/overlaps the “generation done” reward #2927/#2929.
- Second asset query #2955 includes export-scene/draft context and returns another image location; export reward #2957/#2958 follows. There is no captured binary GET after either query. Therefore the capture proves a generated image resource and queryable export metadata, but **not an exported file download**, and it does not prove a generated/exported video.

Current `runCreatorHttpFlow()` correctly separates message acceptance, the commercial-card budget, confirmation, and successful generated-image SSE (`creatorFlow.ts:112-179`). Two gaps remain:

- It opens a fresh poll with an empty event cursor separately for each awaited milestone (`creatorFlow.ts:67-109`, calls at 140 and 162). The capture proves one continuously open stream with an empty cursor; it does not prove that reconnecting from an empty cursor reliably replays the earlier event set.
- `exportCreatorAsset()` and `capturedCreatorExport` download and validate an image, which is stronger file evidence than the capture itself. The latter correctly labels `taskRewardVerified:false` (`capturedCreatorExport.ts:69`). `acknowledgeExport()` then requires a generated/downloaded receipt, `do_action`, and a post-action snapshot (`acknowledgeExport.ts:25-91`), but this workflow is not registered in the production HTTP-only runner.

## Runner and latest live-harness comparison

`HttpOnlyRunner` enforces a useful leaf rule: an operation must return one successful action proof per needed key, then a newer snapshot must show status 4 (`httpOnlyRunner.ts:66-85`; `taskEvidence.ts:19-64`). The capture supports that distinction, but exposes two runner defects:

1. Server-managed parents and already-complete bootstrap tasks have no new proof of their own. `covered()` correctly treats a parent as covered by its children (`httpOnlyRunner.ts:48-60`), but `HttpTaskEvidenceReducer` can only mark status 4 verified when that exact key has a successful proof. Root independently replayed raw final snapshot #3113 through the production parser/reducer with the nine captured action receipts and synthetic ordered timestamps: the snapshot had 12 status-4 rows, while the reducer produced 9 verified and 3 pending (the two parents plus signup). This was an **offline reproduction**, not a fresh live account outcome.
2. Parent settlement is delayed by one snapshot in both groups. The runner performs one immediate snapshot after an operation and can return while a parent is still status 2; it has no bounded final reconciliation loop for asynchronous parent status.

Integration is also incomplete. `HttpMissionStrategy` directly exposes only `designChat`; its own comment says Creator remains CLI-driven (`httpMissionStrategy.ts:25-39`). Searching current production wiring finds no concrete registered `HttpMissionOperation` set for the nine mission leaves. The HTTP implementations and scratch harnesses exist, but the production runner is not an end-to-end mission engine.

The latest one-account scratch result is explicitly read-only: it reports 12 task rows and `rewardMutations: 0`, with no browser fallback. Its plan says the task-list read is a baseline and makes no completion claim. Consequently it validates current-session task-list access only; it provides no live evidence for `do_action`, notification/PWA behavior, Inspiration submission, Design/Creator operations, artifact download, or parent settlement.

Root also independently passed a synthetic `run_start`-only truncated Design stream to the current `inspectDesignReceipt()` and observed `started=true`, `ended=false`, `accepted=true`. That is an offline behavior reproduction of the validation gap, not evidence from a new CapCut request.

## Impact and safe next diagnostics

- **High — false product success:** an HTTP 200 / `err_no=0` or status-4 task row can precede the actual product operation. Preserve separate states for request accepted, job terminal, artifact referenced, artifact downloaded/saved, reward action accepted, and reward snapshot credited.
- **High — incomplete production integration:** current implementations are not a registered nine-leaf `HttpOnlyRunner` plan. Capability flags overstate Creator/canvas readiness relative to engine wiring.
- **High — parent proof model mismatch:** mark known server-managed parents complete from a fresh authoritative snapshot after their child set, without inventing parent `do_action`; add bounded re-polling for status 2.
- **Medium — Design chat terminal validation:** parse the complete SSE and require correlated `run_start`/`run_end`, no scoped errors, and stream completion. Do not require an image for the text-chat leaf.
- **Medium — Inspiration naming/evidence:** treat queued submission as submission accepted, poll the returned job separately for generated output, and avoid reporting the reward key’s “generate done” wording as terminal product truth.
- **Medium — Creator polling contract:** record whether an empty-cursor reconnect replays events before relying on two separate polls; this requires a separately authorized, bounded diagnostic. Do not infer it from this capture.
- **Medium — upload chain:** unit/fixture-test apply → upload → commit → metadata → canvas save as an account-local dependency chain. A successful raw upload alone is insufficient.

No live calls, captured-session replay, purchases, proxy changes, trial activation, SDK execution, signer work, or anti-abuse bypass were performed in this reread.

## Explicit unknowns

- The capture does not reveal the browser-side PWA installation event or establish a pure-HTTP equivalent.
- It does not establish which subset of notice permission, CapCut notice-state update, Firebase installation, FCM registration, or sender-token update is required for notification credit.
- It does not establish the `op_id` generator or signed query algorithm. Those values remain opaque and account/day/session-bound.
- It does not prove that Inspiration’s captured template or benefit contract generalizes to another account, region, day, or catalog revision.
- It does not prove that the captured binary representations equal the original media bytes, nor does it semantically validate their visual/audio content.
- It does not contain a downloaded Creator export file or a generated/exported video; signed asset metadata is not file proof.
- It does not prove Creator empty-cursor replay semantics, universal polling deadlines, or universal parent-settlement timing.
