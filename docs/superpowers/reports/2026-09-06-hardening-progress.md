# Headless hardening execution ledger

Plan: `docs/superpowers/plans/2026-09-06-headless-three-worker-hardening.md`

Execution: inline, explicitly requested; preserve the current uncommitted baseline. No commits, remote changes, or paid live runs authorized by this execution step.

## Rulings

- Health success on a neutral page is not proof of CapCut canvas health or GPU capacity. Keep three-worker root cause unconfirmed.
- Existing transport does not prove that a failed purchase was never dispatched. Fail closed on ambiguous orders; do not invent vendor idempotency or a safe automatic retry.
- Keep actual mailbox acquisition after proxy capacity. Startup health probe runs before mission work, not before all purchasing; health-only mode has no mailbox acquisition at all.
- Fatal browser failures must preserve observed snapshots/proofs without continuing UI or awarding unconfirmed credits.
- Startup stagger is an experiment, applied once, with fake-time integration tests. Do not claim it fixes renderer hangs.
- Live progression requires separate approval for paid 1/2/3-account tests and requires all applicable local gates green.

## Tasks

- [ ] 1: Verify existing mailbox cap, failed acquisition, and restart semantics.
- [ ] 4: First-wave-only stagger; cancellation and refill timing tests.
- [ ] 2: Durable purchase attempt ledger, no ambiguous retries.
- [ ] 3: Headless neutral-page health probe and ownership-safe teardown.
- [ ] 5: Incremental/partial result persistence on failure and Stop.
- [ ] 6: Safe health-only harness, explicit limits, exit codes, artifacts, live readiness.

## Initial verification

Database tests cannot run with Electron ABI 133 under current Node ABI 137; rebuild required. Previous pre-live run recorded one stagger integration test timeout. Neither is an acceptance pass.
