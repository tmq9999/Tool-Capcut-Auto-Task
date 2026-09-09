# Headless Mission Optimization Implementation Plan

> **For agentic workers:** Execute task-by-task with Superpowers TDD and verification.

**Goal:** Make CapCut mission flows work in verified headless API-v3 sessions, skip unnecessary generation waits for Inspiration and Design Studio, preserve AI Creator waits, and resolve task rewards dynamically per account.

**Architecture:** Keep browser launch behavior unchanged except for tests proving API-v3 headless propagation. Refactor mission actions to use English-first, locale-tolerant selectors and return after action proof; retain long waits only in Video/AI Creator missions. Identify tasks by `task_key`, with reward read from each account's `task_list`.

**Tech Stack:** TypeScript, Playwright Core, Vitest, Electron, Multilogin API-v3.

## Tasks

### Task 1: Dynamic task identity and locale selectors
- Test `task_key` matching succeeds when rewards differ and English selectors work with Vietnamese fallback.
- Remove reward literals from mission dispatch and update `findTaskRow`/callers to use task identity from the snapshot.

### Task 2: Optimize Inspiration and Design Studio sequencing
- Test Inspiration and canvas-edit actions do not wait for generation, while AI Creator retains generation/export waits.
- Add the new Inspiration key, minimize action, English-first selectors, and fail-loud evidence checks.
- Make chat completion mean successful send, upload completion mean accepted file, and canvas completion mean successful prompt send/proof.

### Task 3: Headless verification and full gates
- Add/adjust launcher and mission tests proving `api-v3` receives `isHeadless: true` and mission actions remain DOM/CDP based.
- Run focused Vitest, typecheck, lint, build, and selector verification; report any environment-only blockers.
