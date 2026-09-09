# Capture integrity and analysis verification

Fresh checks run after the offline reports were generated:

| Check | Result |
|---|---|
| Independent raw-byte size/hash | 526,282,871 bytes; SHA-256 matches `e5e97fb2aa376d98417d2ebeb9041889c17639e95a24aba1ea4b7d122b52e1d9` |
| Independent tag count | 3,315 `<item>` and 3,315 `</item>` markers |
| Streaming parser pass | 3,315 indexed items; 0 item parse errors |
| Focus partition | 2,782 focus-domain items; 533 outside-focus items |
| Auth/trial matrix | 439 unique IDs; 53 endpoint groups; no missing/unexpected IDs |
| Design matrix | 344/344 design IDs classified; 68 relevant API/storage calls; 41 endpoint variants |
| Creator/task matrix | 489 unique IDs; 387 Creator + 102 task; 34 + 16 endpoint groups; 12 task keys |
| Redaction checks | No raw credential, OTP, cookie value, authorization, signed URL or payment URL emitted by the generated artifacts |
| Cookie-scope audit | 175 name/value-only `msToken` candidates fail domain/path matching; expiry/deletion/response-arrival order is not proven |
| Synthetic parser fixture | CDATA containing `<item>`, XML metadata and `base64="true"` body all parsed correctly |
| Live/replay/provider mutation | Not run |

The tag-count check is intentionally independent of the streaming item parser. The synthetic fixture is only a parser capability check; it is not evidence about CapCut server behavior. The redaction statement covers the named generated JSON/Markdown artifacts after the final regeneration in this run; it does not grant permission to publish the raw capture or ignored indexed shards.

## Recheck commands (offline)

Run from the repository root:

```powershell
node .superpowers/sdd/2026-09-09-full-capture-map/verify-parser.cjs
node .superpowers/sdd/2026-09-09-full-capture-map/verify-deliverable.cjs
```

The deliverable verifier asserts the immutable source hash/size, all IDs/offset order, 500 groups/316 focused groups, 439 auth/trial + 344 design + 489 creator/task records, 64 headers/42 cookies, 175 explicitly invalid domain/path candidates, seven decoded HTML pages, 35 HTML-to-Evercloud-token matches, four exact upload-body hashes and 1,012 telemetry request records. It parses all eight JSON outputs and scans all 19 report/data files with 95 credential-pattern checks. A separate reviewer compared **2,979 sensitive raw values in memory** against the generated files and found **0 literal hits**. Pattern/literal scans are checks, not a guarantee that any future edited artifact is safe to publish.

Current verification result: `PASS`. No project application test suite or live flow was run for this documentation-only analysis; this result does not certify the existing runtime or any earlier unfinished UI changes.
