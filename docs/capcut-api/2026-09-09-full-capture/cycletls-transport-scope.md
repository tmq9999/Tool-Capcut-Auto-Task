# CycleTLS migration boundary

The user has explicitly rejected browser-assisted auth or fallback. The native path must use CycleTLS end-to-end for its HTTP transport; no Playwright request context, Chromium/CDP or browser signer can be substituted when a call fails.

## What this transport change implements

- Native account HTTP context with independent CookieJar, proxy, timeout/cancellation and response lifecycle.
- JSON, form, text and response streaming via CycleTLS, with repeated Set-Cookie applied to the correct account and URL.
- No default shared CycleTLS port; per-account runtime ownership. Independent worker progress remains separate from service rate limits.
- Browser dependency boundary checks and a no-account/no-purchase public bootstrap verification mode.

## Pinned vendor behavior and limits

`cycletls@2.0.5` is a JavaScript wrapper around CycleTLS Go. npm's `gitHead` resolves to CycleTLS Go module `v1.0.30`; exact commit `28f3d8b9a21470c35269fa24f3907626270ab1dc`.

The stock Windows binary was checked against a local HTTP server. It returned HTTP200 and repeated cookie arrays correctly, but its IPC listener bound to `::`. It is therefore not the selected production executable. A minimal local launcher invokes the same CycleTLS `WSEndpoint` on `127.0.0.1` and rejects browser-Origin/non-WebSocket requests; the stock vendor binary is not used as a fallback. The native process is hidden on Windows. This is a network bridge, not Chromium or CDP.

The installed JS FormData handler converts arbitrary bytes through UTF-8. Pinned CycleTLS Go instead supports `bodyBytes` (base64 serialized `[]byte`). The local bridge test proved byte sequence `00ff80410d0afe` round-trips exactly. The owned IPC driver uses `bodyBytes` for Buffer/Uint8Array, not the lossy JS FormData route or another HTTP transport. Application upload/signing/binding contracts still require separate proof.

The installed JS stream path can turn an upstream body-read error into normal EOF. The owned IPC driver handles Go `error` frames as errors and `end` separately, with bounded bytes/deadlines. Application SSE still needs terminal `run_end` or matching terminal event: transport EOF is not product proof. JSON parse/body limits and cookie headers remain account scoped.

The npm wrapper's `exit()` does not prove child termination. The new driver owns its Go child, waits for READY on the selected port before connecting, discards child output and awaits exit during disposal. Context cancellation/disposal must settle pending operations and owned streams; no global cleanup that kills another account. This is a custom IPC client for CycleTLS, not an alternative upstream HTTP stack.

## What remains outside transport acceptance

CycleTLS does not generate CapCut `sign`, `X-Bogus`, `X-Gnarly`, passport field encoding or OTP. These require verified legitimate HTTP-side implementations. The original Burp export does not contain TLS ClientHello evidence, so transport settings are not claimed to duplicate the captured browser fingerprint.

Native permission/PWA effects, full fresh-account runner wiring and video export still need task-specific contracts. Trial check must decode the nested offer response (#3163: two seven-day, zero-price offers), not reject accounts from current-subscription flags. There is no permission to activate trial, pay, buy email or replay captured credentials as part of this transport implementation.

## License / distribution

CycleTLS is GPL-3.0; tough-cookie is BSD-3-Clause. Keeping CycleTLS external and compiling a small launcher does not remove the license obligations. Review source/license distribution requirements before publishing an installer. This task does not publish, push or release any artifact.

References: installed `node_modules/cycletls/{README.md,LICENSE,dist/index.js,dist/index.d.ts}`, npm metadata for `cycletls@2.0.5`, and `tools/cycletls-bridge` source/tests.
