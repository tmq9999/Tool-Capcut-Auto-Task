# CycleTLS-only Native Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. No commits/staging in this dirty user worktree; checkpoint with baseline diffs and review files instead.

**Goal:** Replace Playwright/undici in HTTP-only entrypoints with a tested per-account CycleTLS transport and zero browser fallback.

**Architecture:** Browser-neutral native context owns CycleTLS and tough-cookie state; session factory injects that context into the existing HTTP adapter. Shared DTO types are browser-independent. Real local protocol tests verify wire behavior; an import graph gate prevents regression to browser dependencies.

**Tech Stack:** Strict TypeScript, CycleTLS Go v1.0.30 launcher, ws 8.21.3 IPC, tough-cookie 6.0.2, Vitest 4.1.6, Node24/Windows x64, existing Electron/Vite packaging.

**Spec:** `docs/superpowers/specs/2026-09-09-cycletls-native-transport-design.md`

## Global Constraints

- HTTP-only entrypoints must not load/use Playwright, Chromium, CDP, Page.evaluate, browser launchers or undici; no fallback.
- Preserve legacy UI engine separately; preserve unrelated dirty work. No reset, deletion, commits, staging, push or publishing.
- Each account owns jar/proxy/native lifetime; aborting or disposing one must not affect another.
- No secrets in logs/tests, no live account creation, email purchase, payment, trial activation, or capture credential replay.
- Reject invalid targets/headers before native initialization or request; preserve exact wire bytes and response Set-Cookie scope/order.
- No automatic retry of ambiguous mutations. TLS transport replacement is not signature generation or full-task success.
- Test first, report RED/GREEN commands, review each task, and never silently accept a partial stream as product completion.

### Task 1: Native context and CycleTLS driver

**Files:** Create `src/main/services/capcut/http/nativeHttpContext.ts`, `cycleTlsContext.ts`, `cycleTlsRuntime.ts`; tests `__tests__/cycleTlsContext.test.ts`, `__tests__/cycleTlsNative.test.ts`; any test utilities remain under `__tests__`. Root owns package.json/lock installation.

**Interface to produce:** `createCycleTlsContext(options, dependencies?) -> Promise<NativeHttpContext>`; options include account-scoped proxy, optional initialCookie/header origin pair, timeout and explicit TLS options. `NativeHttpContext` exposes `transport:'cycletls'`, `fetch(url,options)`, `get(url,options)`, `stream(url,options)`, `dispose()`. Buffered response exposes `status()`, `ok()`, `headers()`, `headersArray()`, `body()`, `text()`, `json()`, `dispose()`. Stream exposes status/ok/headers/body AsyncIterable/dispose. Do not add browser APIs or unsafe `any` transport seams.

- [ ] Write failing tests naming the bug: repeated Set-Cookie lost; stale initial cookie masks rotation; cross-domain/other-account cookie leak; retry duplicate mutation; stream cookie refresh rejected; pre-header abort strands request; closed session accepts request; bad path/headers/proxy causes spawn; oversized response parsed; malformed JSON falsely accepted.
- [ ] Verify RED on the named test before implementation. Use literal synthetic credentials only; fake the native driver boundary when necessary, not cookie or policy logic.
- [ ] Implement smallest neutral context. Header arrays are case-insensitive and preserve every Set-Cookie. tough-cookie receives the actual response URL before caller can start the next step. No following redirects automatically. Scope initial cookie to its supplied origin. Native status408/502 with absent metadata is transport failure, not proven server rejection. Reject body types that cannot be transmitted exactly; do not corrupt binary UTF8 silently.
- [ ] Create dedicated unique-port CycleTLS Go driver with owned ws IPC, bounded READY/startup, hidden process and discarded diagnostics. Use pinned Go module v1.0.30 directly through safe launcher; npm2.0.5 is a development reference only. Abort may quarantine that account instance, with all pending operations settled and no late-cookie application. Do not globally monkeypatch process/network modules or use default shared port9119.
- [ ] Real localhost test emits multi-cookie response then echo, chunked stream with cookie at headers and delayed end, timeout and binary payload. Assert data/isolated effects and cleanup, not merely mock call presence. Both account clients can overlap; one aborted client does not delay/kill the other.
- [ ] Run focused tests, typecheck/lint for these modules. Record known upstream limitations and exact test results in task report.

### Task 2: Replace session/transport and enforce no-browser integration

**Files:** Modify `accountSession.ts`, `httpSessionFactory.ts`, `httpOnlyTransport.ts`, `httpTypes.ts`, `CapcutHttpClient.ts` only for neutral context typing in legacy shared constructor, and related HTTP tests. Move shared task DTOs from `../taskApi.ts` into `http/taskTypes.ts` and re-export for UI compatibility if needed. Modify `scripts/live-http-only.cjs`, its tests, `vite.config.ts`, `electron-builder.yml`; add `__tests__/httpOnlyBoundary.test.ts` and `scripts/__tests__/cycletls-live-options.test.mjs` as needed. Root may own packaging/CLI after coordination; no duplicate edits.

**Consumes:** Task1 neutral context API; no APIRequestContext anywhere in the native factory/session/transport graph.

- [ ] RED: factory called with a fake Playwright-shaped context must reject; test real native session cookies and loopback requests. Import graph from live-http-only + httpOnlyAccount must reject forbidden imports transitively (including type leaks into browser-specific modules). A type-only shared DTO export may be extracted, not bypassed with an ignore list.
- [ ] Replace Playwright `request.newContext` with `createCycleTlsContext`, validate identity/proxy/expiry first, wire all JSON/form/text/stream requests to it, remove undici fetchStream runtime branch. Preserve origin/header/path/expiry guards, cancellation and unknown mutation outcomes.
- [ ] Use native stream mode and accept valid Set-Cookie. Add regression for its rotation visible to the next read; no `CAPCUT_HTTP_COOKIE_REFRESH_UNSUPPORTED` failure on valid stream cookie.
- [ ] Update account-context consumers to neutral interface; legacy browser adapter cannot be selected by the HTTP-only factory or used on error. Keep unsupported missions explicitly blocked instead of adding fake operations.
- [ ] Package the safe CycleTLS Go binary with `extraResources` at `resources/cycletls-bridge/index.exe`; source/CLI uses `build/cycletls-bridge/index.exe`. These are the two canonical locations, not `app.asar.unpacked`. Externalize runtime `ws`; do not package/import npm CycleTLS JS or stock wildcard binary. Note GPL3 and corresponding-source distribution requirements; no release upload.
- [ ] Add/run explicit public 3-GET CycleTLS probe with redacted evidence, fresh jar, no mailbox/account. Old APIRequestContext preflight is historical evidence, not new execution. Existing ledger CLI must load only CycleTLS path.
- [ ] Verify all focused HTTP tests + relevant scripts, full typecheck/lint/build, real local native integration and graph gate. Record residual full auth/task limitations without claiming Full Flow.

## Self-review / handoff

The design was approved in chat by the user's explicit implementation instruction. This plan implements transport replacement only, preserving service authority over worker/cancellation/purchase. Task2 depends on Task1's exact interface and reviewed behavior. Work proceeds in this checkout using a baseline snapshot because current HTTP code is uncommitted; git worktree from HEAD would omit it. Request-scoped commits are not safe in the heavily staged worktree, so deliver reviewed uncommitted changes.
