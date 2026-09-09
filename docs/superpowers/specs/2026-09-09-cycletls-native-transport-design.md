# CycleTLS-only HTTP transport design

Approved direction: user explicitly requested CycleTLS implementation, removing Playwright/Chromium/CDP/browser fallback from the HTTP-only flow. The immediately preceding chat defined CycleTLS transport, per-account jar/proxy/state, and fail-closed unsupported operations; this request authorizes implementing that design without another approval loop.

## Scope

Replace the existing HTTP-only session and transport, not the legacy UI mission engine. The HTTP-only entrypoints must not load or use Playwright, Chromium, CDP, Page.evaluate, browser launchers, or undici. Existing UI code remains separate and is not a fallback. No account purchase, signup, trial activation, payment, reward mutation or captured-token replay in transport verification. No claim that replacing TLS implements unknown CapCut signatures or all 12 missions.

## Architecture

1. A browser-neutral `NativeHttpContext` owns one account's CycleTLS client lifetime, proxy configuration and tough-cookie jar. It provides buffered fetch/get and a streaming response, using exact outgoing bytes and repeated response headers. A literal `transport: 'cycletls'` marker prevents injecting an APIRequestContext into the HTTP-only boundary.
2. `createHttpOnlySession` validates identity/proxy/expiry before native initialization. It obtains a dedicated CycleTLS instance on a unique local port, never the library's shared default port. Each account may progress or abort independently. No browser state or global cookie header is used to initialize a jar.
3. `createHttpOnlyTransport` keeps current origin/path/header allowlists and error classification. It serializes JSON/form exactly once, invokes native context for every mode, applies response cookies including on streaming/redirect responses, and never automatically retries a dispatched mutation.
4. Headers supplied by the account remain origin-bound. Explicit cookies, if retained for compatibility, are imported once as origin/path-scoped state and removed from reusable defaults so rotated server values cannot be overwritten on the next call. Cookies for capcut.com cannot leak to capcutapi.com or media/upload hosts. Reject invalid CR/LF, credential-bearing targets and host/proxy-authorization overrides.
5. All operations have bounded timeout/cancellation. Once dispatch may have happened, aborted/timed-out writes return unknown. On an uncancellable pre-header request, quarantine/close only that account's instance; never kill another account's request. Idempotent close clears streams, timers and jar state.
6. Pin CycleTLS Go `v1.0.30` (commit `28f3d8b9a21470c35269fa24f3907626270ab1dc`, npm2.0.5 gitHead), `ws@8.21.3`, `tough-cookie@6.0.2`; keep `cycletls@2.0.5` as a build/development reference, not a runtime JS import. A minimal Go launcher binds only127.0.0.1 and rejects browser Origin/non-upgrade traffic. An owned Node `ws` IPC driver uses opaque request IDs, propagates error frames, cancels requests and awaits child exit; it does not use the flawed npm wrapper. Resolve only the locally built/packaged safe bridge, no stock-binary fallback. Hidden Windows child; GPL-3.0 distribution requirements documented; no publishing.

Vendor-source/live-local findings refine the original plan: stock bridge bound `::`; JS stream converted errors to EOF; stdout could print URL-bearing IDs. Go `BodyBytes` supports exact base64 byte payloads; local echo proved invalidUTF8/NUL roundtrip, so raw upload bytes use that field, not FormData string conversion. Child stdout is consumed only for exact READY after bind, then discarded. Pin `ws@8.21.3` for IPC, not upstream HTTP.

## Response contracts

Use neutral interfaces rather than pretending CycleTLS is Playwright. Preserve current consumer-facing status/ok/json/text/body/dispose behavior where used, but omit browser lifecycle, navigation, routing and storage APIs. Raw transport retains repeated Set-Cookie values; the mission DTO may also expose flattened non-cookie headers. A real stream must deliver a first chunk before the server ends and close cleanly on abort. Upstream library stream EOF is not proof of product completion; consumers still need run_end/terminal job evidence.

## Verification

- TDD: fresh failing tests for context wiring/no-browser dependency, per-account/domain/path cookie isolation and rotations (including Set-Cookie on SSE), request bytes, redirect no-follow, invalid input before spawn, cancellation/limits/dispose, no replay.
- Real local HTTP server + real CycleTLS binary test to verify the adapter, not only fake responses. Real proxy fixture where feasible; no production credentials.
- Dependency graph test of HTTP-only entrypoints must reject forbidden runtime and type dependencies leading into browser modules. Shared DTO types must be moved/re-exported without runtime UI import.
- CLI retains current read-only ledger operation and adds an explicit public bootstrap mode if useful. Report mechanism CycleTLS, do not label a 3-GET probe Full Flow. It cannot launch a browser on failure.
- Typecheck, lint, focused HTTP suites, relevant compatibility suites and build. Baseline test failures are reported distinctly; user work preserved.

## Non-goals / safeguards

No arbitrary signature generation, anti-abuse bypass or TLS fingerprint claim from the Burp HTTP export (it does not capture the original ClientHello). No deletion of old captures, databases, profiles or the user's uncommitted code. Full account runner remains blocked until legitimate auth and actual task contracts are available. The new transport is an implementation foundation, not fabricated 12/12 proof.
