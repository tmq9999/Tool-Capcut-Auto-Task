# Upload And Canvas Attachment: Live Evidence

## Scope

Existing-account investigation, not fresh-account 12/12 acceptance. No mailbox was purchased in this continuation. One upload-only UI discovery captured the missing object-storage protocol; the subsequent upload and attachment were executed entirely by HTTP, without browser launch or DOM calls.

## Observed Contract And Corrections

- ImageX uses standard AWS4-HMAC-SHA256, with the temporary credentials returned by `chat_upload_sign`. Recomputing both captured Apply/Commit signatures matched exactly with canonical path `/ttuploader_proxy`; `/` did not match.
- The byte upload path is `/upload/v1/<StoreUri>`. Earlier code omitted `/upload/v1/`, and its HTTP 200 gateway envelope was NOT an upload receipt.
- Byte-upload success requires HTTP success, `code=2000`, and returned CRC32 matching the transmitted file. Commit uses a different response: matching `Uri` with `UriStatus=2000`.
- Upload hosts vary in the authenticated Apply response. Only the expected provider domains are allowed; credentials for the CapCut API are not copied to object storage.

## Successful HTTP Sequence

The final run log records:

1. New upload token: `ret=0`.
2. `ApplyImageUpload`: HTTP 200, fresh address and SessionKey.
3. Object POST: 155332 PNG bytes, CRC32 `0a23c437`; HTTP 200, `code=2000`, checksum matched.
4. `CommitImageUpload`: HTTP 200, `UriStatus=2000`, image dimensions 1024x1024; committed MD5 matched local bytes.
5. `thread/image_meta`: HTTP 200, `ret=0`, fresh numeric image ID with type 9.
6. Empty canvas creation through `canvas/save`: HTTP 200, `ret=0`, fresh canvas ID.
7. Attachment through `canvas/save`: HTTP 200, `ret=0`; new canvas/node/image references bound to the just-uploaded asset.
8. Proxy lease released. No task acknowledgement was dispatched for this experiment, since this account had already completed upload.

Raw request/response and attachment references are encrypted in an app-owned `captures-private/*.upload-http.enc` journal, outside Git. The redacted run report is `8eb3def2-8fc2-4284-8c3f-7f2c11ecb317.enc.existing-http.json` in that directory. Do not publish signed URLs or credentials.

## Remaining Goal Work

- Build the same inputs from the new account's session, not old account-owned capture values.
- Capture the actual Inspiration submission; the old capture includes its acknowledgement but not the generation request. Treat that as missing operation evidence.
- Integrate and run the full sequence on one fresh account with all task proof/status reconciliation and a single account/proxy lifecycle. Existing 12/12 snapshots remain mixed historical UI/HTTP evidence.

## Fresh Account Attempt

- A newly purchased account produced a fresh authenticated capture and a direct HTTP `task_list` response with 12 account-specific tasks. The run was stopped before creative missions, so no UI result was labelled as HTTP.
- Reusing that capture for workspace reads failed because the signed workspace request was stale/rejected; the proxy lease was released. A fresh session-bound workspace contract is required before creative dispatch.

## Fresh HTTP Creator Run

- The same account then ran Creator entirely through HTTP: project creation, message, cost estimate, confirmation, SSE generation, asset query, PNG download and three task acknowledgements. The server returned `ret=0`/`err_no=0` for each operation and the final snapshot reported 12/12, 670 credits.
- This is not the full-goal acceptance record because the account already had bootstrap/UI-completed tasks before the HTTP Creator sequence. The report intentionally labels `fullHttpRun=false`.

## Current Fresh-Session Findings

- The fresh account's direct `task_list` remains readable and reports 12 tasks, with only the bootstrap tasks complete at the beginning of the run.
- Upload token, ImageX Apply, binary POST, Commit and metadata/canvas attachment have been executed against fresh account state. The binary receipt was `code=2000` with matching CRC32; metadata eventually changed from `1014 system busy` to `ret=0` when the request used the session's verified header shape.
- A native-session workspace probe did not return within 20 seconds, so no further creative mutation was sent. This is a live session/readiness failure, not evidence that the endpoint or payload is invalid.
