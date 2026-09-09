# HTTP-only Resumed Implementation Checkpoint

Plan: `docs/superpowers/plans/2026-09-07-http-only-headless-rewrite.md`.
Status: partial implementation; fresh-account HTTP-only 12/12 remains unverified.
The renewed goal is active. No release, commit, push, mailbox purchase or browser
operation was performed in this resumed turn.

## Changes In This Turn

- `AutomationRunService` accepts an explicit per-account HTTP runner, calls its
  preflight before work-source preparation, then keeps ownership of mailbox and
  proxy acquisition, worker limits, account/task persistence and cancellation.
  HTTP accounts skip launcher/profile creation. No production HTTP runner is yet
  injected by the app composition root; absence still fails closed.
  Account-bound checkpoint callbacks now retain task evidence before fatal/Stop;
  profile-less HTTP threads appear in the running-thread DTO without fake IDs.
- `httpOnlyTransport` adds incremental streaming using the installed `undici`
  HTTP transport, now declared as a direct dependency. JSON/form requests still
  use an independent APIRequestContext. Streaming reads matching current jar
  cookies and uses the account proxy. Header scoping, abort, response size,
  dispatcher cleanup and read backoff received additional tests.
- `taskClient` parses HTTP task discovery without loading the browser monitor.
  Successful empty lists are distinct from malformed responses and API errors;
  duplicate identities and invalid reward/status fields are rejected. Parent
  relations and account-specific rewards remain server supplied.
- Inspiration submission now requires a preceding allowance HTTP response with
  one-to-one item identity, status 1, zero credits and only LimitFree consumption.
  The configured template must be exactly `7611886117142531329`. Generation
  acceptance is separate from task completion and malformed mutation
  responses are treated as outcome unknown. No generation job polling/proof has
  been wired to this adapter yet.
- Creator sequencing is now project -> send -> SSE cost card -> budget check ->
  confirmation -> SSE generated image. No generation polling precedes confirm.
  Cost fields reject null/blank/boolean coercion. Returned draft and conversation
  identifiers are propagated; no default paid confirmation is permitted.
- Canvas submission no longer invents source/mode or accepts arbitrary HTTP 200
  text. It requires matching start/end run evidence and a nonfailed artifact.
  Artifact download/proof integration is still a separate missing step.

## Verification And Limits

After review amendments, focused HTTP, AutomationRunService, shared schema and
HTTP-only harness tests: 32 files / 296 tests passed. Typecheck, lint and
production build exited 0 on the final code state.
The production build still reports its existing large-chunk warning.

These are local tests. Some cover actual loopback HTTP sockets; streaming native
branch coverage uses a mocked undici boundary. None proves live CapCut behavior
or a fresh-account 12/12 run. Independent scoped re-reviews found no remaining
Critical/Important issues in the amended boundaries, not in the full unfinished
project. Production runner absence remains an explicit unresolved requirement.

Public read-only connectivity probe: Node fetch GET `https://www.capcut.com/`,
10-second timeout, no credentials, no mutations. It failed immediately with
`EACCES` in the current network-restricted environment. No remote status or
cookies were obtained. Do not work around the sandbox or spend mail on an
unreachable/unprepared live flow.

## Remaining Work (Do Not Infer Completion)

1. HTTP-only signup/bootstrap and required fresh session/signature sources remain
   unimplemented. Captures show signature fields present; they do not establish
   necessity or independently generate valid signatures. No dummy signer was added.
2. Stream Set-Cookie updates are explicitly unsupported and fail closed; full
   cookie refresh plus session shutdown ownership across streams is not complete.
3. Registry provenance/signing validation, upload lifecycle, task-period/account
   proof binding, durable operation intents and restart reconciliation are not
   complete. Existing generated task proof tuples are not sufficient evidence.
4. Inspiration template-to-benefit binding is not independently verified. Creator
   generation now matches conversation and original message round, following
   `scripts/live-http-existing.cjs` export reconciliation; this source-code
   evidence still needs verification against new live responses. No cursor
   response semantics or task-period wire fields were invented.
5. Concrete full-flow HTTP operation registration and authenticated production
   runner composition are missing. PWA/notification browser-platform prerequisites
   have no proven browser-free equivalent; do not fake them with do_action alone.
6. Live fresh-account 12/12 receipts, proof and fresh task_list are absent. Previous
   mixed browser/UI snapshots do not count toward the renewed HTTP-only goal.

## Implementation Decisions

- Kept the existing worker/service owner rather than delegating a whole run to
  a callback; this follows plan Task 8 and preserves limits and Stop behavior.
- Used direct undici streaming because APIRequestContext buffers the body. This
  is the equivalent HTTP transport permitted by Task 2/7, not a browser fallback.
- Kept production preflight closed pending a real session bootstrap and concrete
  adapter registration. Tests passing do not permit the guard to be removed.
