# HTTP Contract Inventory

This directory contains offline, redacted request-shape tooling. It is not a credential store and does not replay requests.

## Normalize A Capture

```powershell
node tools/http-contracts/normalize-capture.mjs input.ndjson > normalized.json
```

The normalizer preserves method, safe path, status, JSON shape, task keys and correlation field names while redacting credentials, emails, IDs, OTP/code values, unknown paths and malformed bodies. It joins v2 `request` + `response` and v3 `request-start` + `response`/`response-body` + `request-terminal` only within the same capture, identity, target and redirect hop. Orphans and missing safe URL/method facts remain `incomplete`/`unmapped`; a response body is never used as a request body. A record without a URL is marked `proof-only` and cannot be promoted to an HTTP contract.

Normalized transactions include `schemaVersion`, `captureId`, `identity`, `targetId`, `hop`, request/response bodies and states, terminal outcome, `metadataComplete`, `bodyComplete`, `completeness`, `role`, and `dependency`. `captured` requires valid request/response metadata and available request/response payloads; omission, timeout, unreadable, or malformed body states are known gaps and remain `incomplete`/`unmapped`. `do_action` is classified only as `reward-acknowledgement`; it is not an upload, generation, or export-operation contract. `captureClosure` is `unknown` unless a matching authoritative `.summary.json` with the same validated identity (`closed`, `closed-with-errors`, or `close-timeout`) is supplied alongside the records. The transform is read-only and performs no network or registry work.

## Promotion States

- `unmapped`: operation has not been linked to a capture.
- `captured`: method/path/body/response were observed.
- `fixture-verified`: redacted fixture and schema tests pass.
- `live-verified`: a separately approved live run proves the same server-side effect.
- `browser-required`: request depends on browser-only state not yet reproduced.

Do not add signed values, cookies, mailbox data, or raw payloads to the repository. `do_action` fixtures prove task acknowledgement only; they do not describe generation, upload, canvas, or export operations.
