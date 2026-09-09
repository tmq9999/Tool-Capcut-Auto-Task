# Signing and dynamic-field audit

This is a read-only comparison of the capture with the existing project helpers. No captured signature was replayed and no source/runtime file was edited.

## What the project actually contains

- `src/main/services/capcut/http/signedRequest.ts` is a browser-request capture/shape validator. It has no cryptographic or `device-time` generation formula.
- `scripts/imagex-contract.cjs` contains AWS SigV4 via `aws4.sign` for ImageX/object-storage calls. Its own boundary distinguishes that from CapCut web anti-abuse signing.

## Capture inventory

| Field/scheme | Observed count | Safe conclusion |
|---|---:|---|
| Application `sign` header | 810 (806 POST, 4 GET) | Every observed value had length 32. No algorithm or key source is present in the project helper. |
| `device-time` | 812 | 810 overlap the `sign` calls; equality with an earlier server `systime` is not a generation proof. |
| `sign-ver` | 812 | Observed value is `1` in the indexed focused records. It selects a server/client version, not the formula. |
| `X-Bogus` query name | 147 | Value and construction remain opaque. |
| `X-Gnarly` query name | 147 | Value and construction remain opaque. |
| SecSDK-named fields | 59 | Client/security SDK state; no formula proved. |
| AWS `Authorization` | 8 | Focused ImageX/WWW upload-proxy Apply/Commit calls; separate from response-issued TOS byte-upload Auth. Fresh credentials are needed; the helper is not CapCut web signing. |

The scan covered all 2,782 focused records in memory. No value, key, token or signature is emitted. Native HTTP must fail closed when a supported dynamic provider is unavailable; copying a 32-character `sign` or `device-time` from this capture is not an implementation.
