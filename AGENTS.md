# Repository Guidelines

## Project Structure

AutoManager is a Windows-first Electron app.

- `src/main/`: Electron services, IPC handlers, providers, SQLite repositories, and CapCut automation.
- `src/main/services/capcut/`: Playwright missions, task proof reconciliation, selectors, and browser launchers.
- `src/preload/`: typed, narrow renderer bridge.
- `src/renderer/`: React pages, dashboard state, and UI components.
- `src/shared/`: Zod schemas, contracts, and shared settings/types.
- `tools/`: selector verification and captured DOM fixtures.
- `docs/`: architecture, automation evidence, release notes, and implementation plans.
- `scripts/`: Electron harnesses and development utilities.

Keep renderer code isolated from Node, SQLite, and secrets.

## Build, Test, and Development Commands

- `npm run dev` - start the Vite development server.
- `npm run typecheck` - run strict TypeScript checks.
- `npm run lint` - run ESLint with zero warnings allowed.
- `npm run build` - compile TypeScript and build the Electron/Vite bundle.
- `npm run selectors` - validate selector fixtures and evidence gates.
- `npx vitest run <file>` - run focused tests.
- `npm run test:node` - rebuild `better-sqlite3` for Node and run Vitest.
- `npm run test:electron` - build, rebuild the Electron native module, and run the harness.
- `npm run dist` - produce Windows installer artifacts.

## Coding Style and Naming

Use strict TypeScript, two-space indentation, single quotes, and semicolons. Use `PascalCase` for components/classes, `camelCase` for functions/variables, and descriptive `*.test.ts` names. Run typecheck and lint before committing. Keep raw SQL in repositories.

## Testing Guidelines

Use Vitest. Add regression tests before behavior fixes. CapCut missions must prove success through `do_action` evidence plus a fresh task snapshot; do not mark tasks complete from UI state alone. Use fixtures for selector changes and no real credentials.

## Commit and Pull Requests

Use short imperative Conventional Commit-style messages, such as `fix: preserve stopped account outcome`. Keep commits focused. Pull requests should describe behavior changes, tests, migration/release impact, and include UI screenshots when relevant.

## Security and Live Operations

Never commit `.env`, tokens, mailbox payloads, proxy credentials, or screenshots containing secrets. Billable Gmail94 purchases require explicit approval and the dedicated opt-in environment flag. Safe provider reads may run only when credentials are configured. Redact secrets from logs and fixtures.

## Automation Boundaries

`AutomationRunService` owns workers, cancellation, counters, and resource cleanup. The CapCut engine only operates inside an injected Playwright session. Preserve human-pace jitter, hit-target guards, cancellation, and evidence-based proof rules when changing missions.
