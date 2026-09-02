# AGENTS.md — Capcut AutoManager Engineering Rules

## 1. Project Identity

Project name: AutoManager

Target application stack:

- Electron
- React 19
- TypeScript
- Vite
- Tailwind CSS
- SQLite via better-sqlite3
- Windows desktop is the primary target

The application is a commercial desktop automation management tool.

Dark mode is the default UI theme.

The existing AutoManager Dashboard exported from Stitch is the MASTER visual reference.

---

# 2. Mandatory Agent Behavior

These rules are mandatory for every task in this repository.

Before changing code:

1. Read this AGENTS.md.
2. Inspect the relevant existing implementation.
3. Identify the smallest correct change.
4. Do not invent requirements.
5. Do not redesign architecture without explicit approval.
6. Do not silently introduce new dependencies.
7. Do not implement unrelated features.

If a requested change conflicts with this document:

STOP.

Explain the conflict before making changes.

Never silently bypass these rules.

---

# 3. Evidence-First Development

Do not guess how existing code works.

Before modifying a subsystem:

- inspect its files
- inspect related types/contracts
- inspect call sites
- inspect tests where available

For external services:

- read existing provider implementation first
- consult official API documentation when needed
- verify assumptions with real responses
- do not invent undocumented API fields

When testing real services:

- log only safe diagnostic information
- never print secrets

Prefer evidence over assumptions.

---

# 4. Scope Control

Do NOT add features unless explicitly requested.

Examples of features that must NOT be invented:

- System Health
- Cluster Status
- Active Nodes
- Resource dashboards
- Network dashboards
- Analytics dashboards
- New sidebar pages
- New monitoring systems
- New account workflows
- New provider capabilities
- New automation flows

Do not reinterpret a task into a larger redesign.

Implement exactly what is requested.

---

# 5. UI Source of Truth

The Dashboard visual design is the MASTER reference.

All screens must share the same:

- AppShell
- Sidebar
- AppHeader
- StatusBar
- typography
- spacing
- colors
- control heights
- button styles
- input styles
- DataGrid style
- borders
- radius system

There must be exactly ONE reusable application shell.

Pages:

- Dashboard
- Accounts
- Settings
- Logs

Pages must never implement independent sidebars or global shells.

Dashboard-specific actions must not become global actions.

Use page-specific action slots.

Example:

AppHeader
  + title
  + subtitle
  + actions

Dashboard actions:
- Start
- Stop

Accounts actions:
- Add
- Edit
- Delete
- Export

Settings actions:
- Reset
- Save

Logs actions:
- Pause
- Clear

---

# 6. Renderer Security Boundary

The Electron renderer must remain isolated.

Required BrowserWindow security:

- nodeIntegration: false
- contextIsolation: true

The React renderer must NOT:

- import better-sqlite3
- access fs directly
- access Node.js APIs directly
- access Electron main internals directly
- access secrets directly
- call external service SDKs requiring credentials directly

Renderer communication must go through:

Renderer
    ↓
Preload
    ↓
Typed IPC Contract
    ↓
Main Process

Never expose unrestricted ipcRenderer through preload.

Expose narrowly scoped typed methods only.

---

# 7. Backend Layering

Backend code must follow this dependency direction:

IPC
 ↓
Application Services
 ↓
Repositories / Provider Interfaces
 ↓
Infrastructure

Allowed architecture:

src/
  main/
    database/
    repositories/
    services/
    providers/
    security/
    ipc/

  preload/

  shared/
    types/
    contracts/

  renderer/

Dependencies must flow inward.

Avoid circular dependencies.

---

# 8. SQLite Is the Persistent Storage

Persistent application data must use SQLite.

Use:

better-sqlite3

Database location must be derived from Electron:

app.getPath("userData")

Example concept:

path.join(app.getPath("userData"), "automanager.db")

Never hard-code:

C:\Users\...
%APPDATA%\...

Do not use JSON files as the primary database.

Do not use LowDB, NeDB, localStorage, or temporary JSON files for application persistence.

---

# 9. SQLite Initialization

Database initialization must enable:

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

All schema changes must use migrations.

Do NOT rely indefinitely on:

CREATE TABLE IF NOT EXISTS

as a schema upgrade mechanism.

---

# 10. Database Migrations

Maintain versioned migrations.

Example:

src/main/database/migrations/

001_initial.sql
002_add_account_provider.sql
003_add_automation_step.sql

Maintain a migration tracking table:

schema_migrations

Fields:

- version
- applied_at

Existing user databases must be upgradeable.

Never solve schema changes by deleting the database.

Never automatically destroy user data.

---

# 11. Repository Rule

External services must NEVER execute raw SQL directly.

Incorrect:

Gmail94Service -> db.prepare(...)

Incorrect:

MultiloginService -> db.prepare(...)

Correct:

Gmail94Service
     ↓
CredentialRepository

Correct:

AccountService
     ↓
AccountRepository

Database access must be isolated behind repositories.

Expected repositories:

- SettingsRepository
- AccountRepository
- CredentialRepository
- LogRepository

Add additional repositories only when justified.

---

# 12. Settings Persistence

All application settings must persist in SQLite.

Examples:

- theme
- language
- browser selection
- browser configuration
- email provider configuration
- export configuration
- log retention configuration

Settings should be validated using TypeScript schemas/types before being persisted.

Do not blindly store arbitrary unvalidated JSON.

---

# 13. Credentials and Secret Storage

Sensitive credentials must NEVER be stored as plaintext.

Sensitive examples:

- API Keys
- API Tokens
- Multilogin password
- Email passwords
- refresh_token
- TOTP / 2FA secrets
- session tokens
- account secrets

Use Electron safeStorage where supported.

Encryption/decryption belongs in:

CredentialVault / security layer

Concept:

Plain Secret
    ↓
safeStorage.encryptString()
    ↓
SQLite encrypted value

Reading:

SQLite encrypted value
    ↓
safeStorage.decryptString()
    ↓
Main Process Service

Secrets must remain in Main Process whenever possible.

Do NOT return decrypted secrets to React unless the feature explicitly requires it.

Do NOT log secrets.

Do NOT include secrets in error messages.

Do NOT include secrets in screenshots or debugging output.

---

# 14. service_credentials Data

Credentials should conceptually contain:

- service_name
- encrypted_credentials
- metadata
- last_tested_at
- last_test_result
- updated_at

Service status is cached diagnostic state only.

Never assume:

last status = Connected

means the service is currently connected.

Balance should also be timestamped if cached.

Example:

- last_balance
- balance_fetched_at

---

# 15. Accounts Data Model

Account storage should support the existing UI and future automation.

Conceptual fields:

- id
- email
- email_provider
- email_password_encrypted
- password_capcut_encrypted
- email_data_encrypted
- credit
- subscription
- status
- automation_step
- proxy
- browser_provider
- browser_profile_id
- notes
- created_at
- updated_at

Do not combine runtime status and current automation step.

Example:

status:
running

automation_step:
Waiting for OTP

The UI may display:

Running
Waiting for OTP...

---

# 16. Runtime Logging Contract

The canonical runtime log shape is:

RuntimeLog {
  id
  accountId?
  email
  step
  status
  message
  createdAt
}

Supported status values:

- INFO
- SUCCESS
- WARNING
- WAITING
- ERROR
- DEBUG

Logical human-readable format:

Time - Email - Step - Status - Message

Example:

03:32:31 - worker@example.com - Proxy - ERROR - Proxy connection timeout

Dashboard Live Logs and Logs Page must consume the same underlying log model.

Do not create incompatible log formats.

---

# 17. Logging Performance

Do not synchronously INSERT every high-frequency log entry individually if it can block the Electron Main Process.

Preferred flow:

Workers
 ↓
LogBus
 ↓
In-memory queue
 ↓
Batch
 ↓
SQLite transaction

Batch logs periodically or by batch size.

Use transactions for grouped inserts.

Keep the implementation simple initially.

Move DB/log work to a Worker Thread or Utility Process only when measurement proves it is necessary.

Do not prematurely over-engineer.

---

# 18. Log Retention

runtime_logs must not grow forever.

Support a retention policy.

Default recommendation:

30 days

Possible configuration:

- 7 days
- 30 days
- 90 days
- Never automatically delete

Cleanup should be safe and non-blocking.

Never delete logs outside configured retention rules.

---

# 19. Database Indexes

Indexes must support real UI queries.

Accounts should be efficiently searchable/filterable by relevant fields such as:

- email
- status
- created_at
- email_provider
- browser_provider

Logs should support:

- created_at
- email
- status
- account_id where useful

Do not add indexes blindly.

Indexes must correspond to actual query patterns.

---

# 20. DataGrid Architecture

Use one generic reusable DataGrid implementation.

Recommended headless engine:

@tanstack/react-table

Do not introduce AG Grid unless explicitly approved.

Page-specific tables should provide:

- data
- column definitions
- filtering configuration
- selection configuration

They must not duplicate the complete DataGrid implementation.

---

# 21. Account Export Rules

Supported formats:

- XLSX
- CSV
- TXT

Default export fields and order:

1. Email
2. Password CapCut
3. Email Data
4. Credit
5. Subscription
6. Create At

Supported export scopes:

- All accounts
- Checked accounts
- Filtered accounts

TXT uses pipe-separated fields.

Conceptual example:

Email|Password CapCut|Email Data|Credit|Subscription|Create At

CSV and XLSX use independent columns.

Export field configuration is persisted in Settings.

Do not change export ordering implicitly.

---

# 22. External Provider Architecture

External integrations must use provider abstractions.

Browser providers:

BrowserProvider
├── GpmLoginProvider
├── GoLoginProvider
├── MultiloginProvider
├── CamoufoxProvider
└── PatchrightProvider

Email providers:

EmailProvider
├── Gmail94Provider
└── DongVanFBProvider

Proxy providers:

ProxyProvider
├── DirectProxyProvider
└── KiotProxyProvider

Automation code should depend on interfaces, not vendor-specific implementations.

Do not leak vendor-specific API structures across the application.

---

# 23. Provider Responsibilities

Providers are responsible for vendor API communication.

Providers are NOT responsible for:

- React UI state
- direct SQLite queries
- navigation
- rendering
- unrelated automation orchestration

Provider responses should be normalized into shared domain types.

---

# 24. Service Implementation Order

Do not immediately implement every external service.

Backend implementation order:

PHASE A — Persistence Foundation

1. SQLite database
2. Migrations
3. Repository layer
4. CredentialVault
5. Typed IPC contracts

PHASE B — Local Application Data

6. Settings persistence
7. Accounts persistence
8. Runtime Logs persistence

At this point the UI should stop using mock persistence.

PHASE C — External Integrations

Implement and verify providers one at a time:

1. Gmail94
2. Multilogin
3. KiotProxy
4. DongVanFB
5. GPM Login
6. GoLogin

Camoufox and Patchright module management can be implemented when browser execution work begins.

Do not implement multiple provider integrations simultaneously unless explicitly requested.

---

# 25. Real API Testing Rules

Each provider integration must be independently verified before being considered complete.

A provider is not complete because:

- TypeScript compiles
- mocks pass
- API code looks correct

It must be tested against the real service where credentials/environment are available.

When testing:

1. Test authentication / connectivity.
2. Test one safe read operation.
3. Validate response shape.
4. Handle expected failures.
5. Persist only required state.
6. Verify secrets are not logged.

Do not perform billable/order/purchase operations merely to test connectivity unless explicitly requested.

For paid operations, separate connectivity tests from transactional operations.

---

# 26. IPC Contracts

All Renderer ↔ Main communication must have typed contracts.

Prefer APIs such as:

settings.get()
settings.update()

accounts.list()
accounts.create()
accounts.update()
accounts.delete()

logs.list()
logs.clear()

services.testConnection()

Avoid generic APIs such as:

invoke("execute-anything", ...)

Do not expose raw SQL over IPC.

Do not expose arbitrary filesystem access over IPC.

---

# 27. Error Handling

Do not swallow errors.

Do not write:

catch {}

or return undefined for every failure.

Use normalized application errors.

User-facing messages should be concise.

Detailed diagnostic information belongs in runtime logs.

Secrets must be redacted.

---

# 28. TypeScript Standards

Use TypeScript strictly.

Avoid:

any

unless there is a documented reason.

Prefer:

unknown

at external boundaries, then validate/narrow.

Provider/API response data must not be blindly trusted.

Use explicit domain types.

Keep naming consistent.

---

# 29. No Hidden Global State

Avoid mutable global singleton state unless the service lifecycle genuinely requires it.

Prefer explicit dependencies.

Database instance may be application-scoped.

Repositories/services should receive their dependencies explicitly where practical.

---

# 30. No Premature Core Automation

Do NOT build the automation core until explicitly requested.

Do not implement:

- registration workflows
- payment workflows
- OTP workflows
- browser automation flows
- Playwright automation flows

merely because related settings exist.

Backend infrastructure and provider adapters are separate from automation workflow implementation.

---

# 31. Browser Automation Boundary

When browser automation work eventually begins:

Automation Core
    ↓
BrowserProvider abstraction
    ↓
Provider implementation

Do not hard-code Multilogin, GPM, GoLogin, Camoufox, or Patchright throughout workflow logic.

The automation workflow must remain provider-agnostic whenever possible.

---

# 32. Testing Requirements

Every implementation phase requires verification.

Minimum checks where applicable:

- TypeScript typecheck
- npm run build
- npm run lint
- relevant unit tests
- Electron launch
- manual UI verification

Database work must additionally verify:

- clean DB initialization
- migration from previous schema version
- read/write persistence after restart
- WAL initialization
- repository queries
- error paths

IPC work must verify:

- valid request
- invalid request
- renderer cannot access Node APIs directly

---

# 33. Verification Before Completion

Never claim:

"done"
"fixed"
"working"
"complete"

without verification evidence.

Before reporting completion:

1. Run relevant checks.
2. Inspect command output.
3. Fix failures.
4. Re-run verification.
5. Report exactly what was verified.

If a real external API could not be tested, explicitly state:

"Implemented but not verified against the real service."

Never pretend mock success proves a real integration works.

---

# 34. Preserve Existing Working Code

Do not rewrite working subsystems unnecessarily.

Prefer incremental changes.

Do not replace libraries merely because another library is personally preferred.

Do not mass-format unrelated files.

Do not rename large directory trees without need.

Do not delete Stitch references unless explicitly requested.

Reference screenshots/design exports should remain available for visual comparison.

---

# 35. Git Discipline

Changes should be logically scoped.

Before major implementation work:

- inspect git status
- avoid overwriting unrelated user changes

Never discard user modifications without explicit permission.

Do not run destructive git commands without explicit approval.

Never use:

git reset --hard
git clean -fd

unless explicitly authorized.

---

# 36. Dependency Discipline

Before installing a package:

1. Confirm it is actually required.
2. Prefer mature maintained packages.
3. Avoid adding multiple packages solving the same problem.
4. Explain major native dependencies.

Native Electron dependencies such as better-sqlite3 must account for Electron ABI/rebuild requirements.

Do not add dependencies unrelated to the requested task.

---

# 37. Security Rules

Never:

- hard-code secrets
- commit secrets
- print API keys
- print passwords
- print refresh tokens
- expose safeStorage decrypted values to debugging logs
- expose unrestricted Node APIs to Renderer
- disable Electron security protections for convenience

Use least privilege.

---

# 38. Current Architectural Source of Truth

Current persistence architecture:

Renderer
   ↓
Typed Preload API
   ↓
IPC Handler
   ↓
Application Service
   ↓
Repository / Provider
   ↓
SQLite / External Service

Credentials:

Renderer enters secret
   ↓
IPC
   ↓
Main Process
   ↓
CredentialVault
   ↓
safeStorage encryption
   ↓
CredentialRepository
   ↓
SQLite

Secrets are decrypted only inside Main Process when required.

---

# 39. Current Development Boundary

Current target is:

- real Electron shell
- real local SQLite persistence
- real settings persistence
- real accounts persistence
- real logs persistence
- secure credential storage
- provider adapters implemented incrementally

Current target is NOT yet:

- full automation workflow
- registration engine
- payment engine
- browser orchestration engine

Do not cross this boundary unless explicitly requested.

---

# 40. Decision Rule

When several implementations are possible:

Prefer the option that is:

1. simplest while correct
2. testable
3. typed
4. maintainable
5. secure
6. compatible with Electron
7. compatible with future automation workers

Do not optimize for cleverness.

Optimize for predictable behavior and maintainability.

# 30. CapCut Automation Engine Boundary

The engine in `src/main/services/capcut/` was ported from a standalone Playwright
project that completed 13 real accounts on 2026-09-02. Its comments record
measured browser evidence, not opinions. Treat the following as hard rules.

**The engine never owns infrastructure.**
It receives `{ page, context, sampleImage, log }` and returns results. It must not
launch or stop a browser profile, acquire a proxy, read SQLite, read `.env`, or
write to the current working directory. Profile lifecycle belongs to
`BrowserLauncher` / `IBrowserRuntimeApi`; proxies to `ProxyLeaseManager`.

**No `console.log` inside the engine.**
Every line goes through an injected `log()` so `LogBus` can attach `accountId`
(§16). `eslint` and review must reject new `console.*` calls under
`src/main/services/capcut/`.

**Success is proven, never assumed.**
A mission group only performs UI actions. The only place allowed to conclude that
a task is done is `runGroup`, which requires a `do_action` request with the
matching `action_key` and `err_no === 0`, then re-reads CapCut's own
`task_status`. Never add a path that lets the UI or a mission mark a task done.

**Do not remove the guards.**
`assertHittable`, `assertNotInert`, `waitNotInert`, `waitNodeRendered`, and the
`waitEnabled` return checks each exist because a specific silent failure was
measured. `page.mouse` does not verify hit targets, so an unguarded click on a
covered element succeeds while doing nothing — that single class of bug cost 22
consecutive task failures.

**Do not "optimize" human behaviour.**
`human.ts` and every `waitForTimeout(rand(...))` exist because CapCut runs Shark
Risk Control, which scores pointer trajectory and keystroke timing. Removing the
jitter reintroduces `err_no 8001003` on reward claims.

**Selectors change under you.**
Before editing any selector, add a fixture of the DOM state that broke it under
`tools/fixtures/` and an assertion in `npm run selectors` (currently 51). CSS is
not loaded in those fixtures, so they verify selector resolution and `inert`
containment only — never visibility or occlusion.

**Dependencies that must stay external.**
`playwright-core` and `better-sqlite3` are excluded from the main bundle in
`vite.config.ts`. Bundling `playwright-core` breaks the build on its optional
native `kerberos` import.