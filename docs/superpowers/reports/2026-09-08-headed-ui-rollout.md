# Headed UI live rollout — three existing accounts

> Follow-up: the receipt watermark regression and redundant ready-canvas selection have a [targeted repair report](2026-09-08-live-fault-targeted-fix.md). No live rerun has been performed since; the failed result below is unchanged.

Date: 2026-09-08. Mode: explicitly requested existing-account resume, headed, three workers. No mailbox purchase or account signup authorized.

## Baseline and scope

The three most recent stored accounts match the failed run: all have12 recorded tasks,6 complete,420 credits and DOM timeout. The test uses an isolated local copy of the database and encrypted local state; the original database is not the write target. Account/email/profile/proxy identifiers remain local and are not included here.

User requested live testing3 accounts directly. This invocation is limited to resume3; no separate10-profile health or fresh-account stage is authorized or attempted. Production attach/renderer health checks still run inside each account's session.

Offline implementation previously passed1498 tests, typecheck/lint/build and local Electron/selector gates. Fresh bounded preflight suites:112/112 passed. Final live acceptance requires the exact run artifact and3 independent fresh12/12 receipts, clean teardown and zero purchases.

## Result

**FAILED — 0/3 accepted completions.** One invocation only; no rerun or paid stage.

- Exact run ID: `542855a0-b937-486f-9f01-76473f7b02c3`.
- Started: 2026-09-08 15:43:48 +07:00; runner exit:15:49:25 +07:00 (about5m37s).
- Harness exit4; independent exact-artifact validator rejects with `UNSAFE_EVENT`.
- Mode resume; accepted3, completed0, failed3, stopped0, skipped0.

| Run-local account | Final observed status | Credits | Accepted as complete? |
|---|---|---|---|
| account-1 | 6/12; DOM timeout in initial and replacement session | 420 | No |
| account-2 | 6/12; DOM timeout in initial and replacement session | 420 | No |
| account-3 | 12/12 observed; final receipt freshness failed | 670 | No |

The terminal run state is `completed` with code `MANUAL_EXHAUSTED`, meaning the finite work list was drained. It is **not** successful task completion: the same terminal explicitly records completed0/failed3 and the harness exits4.

## Failures and causal evidence

1. **Four serialized mouse-move timeouts.** Both account-1 and account-2 reached `DOM_READ_TIMEOUT: canvas-area:mouse-move` in their initial session and once more in their replacement. Foreground/editor capacity remained1. This proves the scheduler does not eliminate the observed mouse-command stall; it does not prove the exact vendor/renderer cause. Current log labels do not identify which randomized trajectory segment stalled.
2. **A complete server snapshot rejected as stale at final reconciliation.** account-3 observed12 status-4 tasks at08:48:50.263Z. The required-after watermark was08:48:54.423Z,4160ms later; no qualifying newer snapshot arrived during the final wait. Its final checkpoint therefore records fresh=false/final=false. Source sets this group watermark after `group.act` returns, which includes UI waits/cleanup; distinguishing true mutation settlement from cleanup and triggering an explicit fresh final read needs a regression-backed follow-up. Do not weaken evidence requirements or retroactively call this run green.

## Resource, purchase and isolation reconciliation

- Started5 sessions: initial3 plus exactly2 replacement sessions (one per poisoned account).
- Confirmed stops5/5; each exact session stopped once; cleanupFailures0.
- Peaks: workers3, profiles3, proxy routes3, mailbox reservations0.
- Final resources: workers0, profiles0, proxies0, mailbox reservations0.
- Mail acquisitions0; attempted/confirmed/ambiguous purchases all0. No account signup/create: account row count remained57.
- Owned Electron processes exited; no AutoManager/Electron process remained after the harness.
- Original selected database rows are byte-for-byte unchanged by hash; results exist in the isolated copy only. Encrypted credentials/private IDs/logs remain outside tracked reports.
- Native SQLite returned to Node ABI137; rebuild exited0. npm emitted the existing advisory about five installed script packages; user npm config was not edited.

## Next action, not executed

- Add redacted per-mouse-segment dispatch/settlement diagnostics and renderer responsiveness evidence to isolate the `canvas-area` hang without retrying another input on the timed-out session.
- Correct final-receipt acquisition/watermark handling with a reproduction of the12/12-but-4160ms-earlier snapshot. Preserve proof checks and never infer success from UI alone.
- Rerun only after a separately authorized fix/test step. Do not advance to5/10 workers or purchase more mailboxes from this failure.
