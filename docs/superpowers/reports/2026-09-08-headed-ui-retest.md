# Three-account headed retest after targeted live fixes

User authorized one live retest of the same three existing accounts. No new accounts or mailbox purchases. Isolated copy of the original data; original database is not a write target.

The preceding run observed one account at12/12 and two at6/12. Server-side progress remains between runs; this is a resume verification, not a fresh-account full-workflow claim. Current build contains the proof-watermark correction and conditional ready-canvas selection guard. Fresh preflight100/100 tests pass.

## Result

**2/3 accounts verified complete; the overall3-account gate FAILED.** One invocation only.

- Run ID: `0ddb5b87-24a6-4f72-8b7c-56669ca1294a`.
- Start16:31:37 +07:00; exit16:40:19 +07:00 (about8m41s).
- Runner exit4; independent exact-run validator rejects `UNSAFE_EVENT`.
- Terminal accepted3/completed2/failed1/stopped0/skipped0. `MANUAL_EXHAUSTED` means the list finished, not that3/3 succeeded.

| Run-local account | Final result | Credits | New progress in this retest |
|---|---|---|---|
| account-1 | 6/12, incomplete | 420 | No new successful proof; initial and replacement both timed out at `canvas-opener:mouse-move`. |
| account-2 | **12/12, fresh+final** | 670 | Four successful proofs recorded during this run; advanced from6/12. |
| account-3 | **12/12, fresh+final** | 670 | Already reached12/12 in preceding live run; fresh bootstrap revalidated it, zero new proof. |

## What the retest proves

- The ready-canvas guard executed (`prompt already ready; preserving selection`) and avoided the redundant canvas-area selection for both incomplete accounts.
- account-2 successfully proceeded through canvas and Video Studio to a final receipt. Its requiredAfter was09:40:10.024Z, snapshot09:40:10.829Z:805ms later and valid.
- account-3's existing12/12 was accepted with fresh bootstrap rather than rejected by the previous cleanup watermark.
- The underlying input stall persists: account-1 hit `canvas-opener:mouse-move` twice despite skipping canvas-area selection and recycling once. No claim that mouse/CDP hangs are fixed, or that10-worker live execution is safe.

## Cleanup and side effects

- Started4 profiles:3 initial +1 replacement; **4/4 confirmed stopped exactly once**.
- Peak workers/profiles/proxies each3; mailbox reservations0.
- Final workers/profiles/proxies/reservations all0; cleanupFailures0.
- Mail acquisitions0 and purchase attempted/confirmed/ambiguous all0. Account count stayed57; no new signup/account row.
- The original selected database rows were verified unchanged by hash; result writes exist only in isolated copied userData.
- No AutoManager/Electron process remained after the owned runner exited.
- Native SQLite restored to Node ABI137; rebuild exit0. No production source edit, git staging or commit occurred during this retest.

## Remaining blocker

Reproduce/diagnose the required opener's mouse trajectory/CDP stall. Do not increase worker count, repeat live runs or purchase more mailboxes automatically. The current claim is **2 verified existing accounts out of3**, not3/3 or a fresh-account full workflow pass.
