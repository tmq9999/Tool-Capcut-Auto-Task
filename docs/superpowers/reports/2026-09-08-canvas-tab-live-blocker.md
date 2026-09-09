# Canvas Tab continuation: live acceptance still blocked

Status at 2026-09-08 17:33 +07:00: **NOT COMPLETE. 2/3 existing accounts are verified at 12/12; the remaining account is still 6/12.**

This is a continuation of the same three-account headed UI test, not a fresh-account workflow pass. No 10-worker claim. The last accepted server receipts for account-2 and account-3 are documented in `2026-09-08-headed-ui-retest.md`; they were not replayed in this continuation.

## Evidence-backed candidate change

The original opener mouse trajectory and an experimental native locator click both timed out during live engine execution. The native-click experiment was removed. `human.ts` is byte-equivalent to the saved pre-experiment snapshot; the other human-click paths were not changed by this continuation.

The earlier clean-profile keyboard probe observed the visible "Tab to design" shortcut opening the exact canvas prompt control:

- 2026-09-08T10:12:26.312Z: Tab activation returned `aria-expanded=true` after 3721 ms.
- The expanded wrapper then passed the non-inert check.
- Enter had not activated the control. No Enter or mouse retry was added.

`openCanvasPrompt` now holds one foreground lease across pre-pause, exact locator focus, Tab keydown/up with human delay, and post-pause. Both native and outer deadlines are bounded, cancellation is preserved, and timeouts quarantine the session instead of sending fallback input. Existing hit-target, non-inert, prompt-readback, and task proof checks remain.

**This isolated probe is not proof that the complete engine now reaches 12/12.** The current production candidate could not reach its canvas step in the new live attempts because authentication was blocked first.

## Live attempts after the change

All attempts used only account-1, existing-account login, headed Multilogin, an isolated copied database, and purchase budget zero. The harness's child exit 0 is not an acceptance signal; its account summary must be inspected.

| Approximate local interval (+07:00) | Observed outcome |
| --- | --- |
| 17:19:59–17:21:31 | Login failed before any task checkpoint; 0 complete, 1 failed. Owned profile stopped. |
| 17:24–17:25:54 | `/passport/web/email/login/` returned HTTP 200 with business error 7; login never entered the app. Owned profile stopped. |
| 17:27:19–17:27:32 | Browser launch failed before `profile-ready`; no account task executed. |
| 17:29:04 | Read-only launcher preflight reachable, zero running profiles. |
| 17:30–17:30:29 | Auth response confirmed error 7 with the exact message below. Diagnostic stopped immediately; owned profile stop confirmed. |

The decisive response at **2026-09-08T10:30:28.097Z**:

```json
{
  "path": "/passport/web/email/login/",
  "status": 200,
  "code": 7,
  "detail": "error | Maximum number of attempts reached. Try again later."
}
```

This is a server-side login attempt limit, not evidence of an invalid password or a new canvas regression. No further login attempts were issued after this message was identified. The server's reset time is unknown; no cooldown duration was verified. The latest diagnostic summary has `stopped=1`, not a completed account. No credentials, mailbox payloads, or tokens are included here.

## Verification and safeguards

- Fresh final full suite: **138 files, 1524 tests passed**, `npx --userconfig=NUL vitest run`, exit 0 at 17:31:21.
- `npm --userconfig=NUL run typecheck`: exit 0.
- `npm --userconfig=NUL run lint`: exit 0.
- `npm --userconfig=NUL run build`: exit 0 before live; existing Vite bundle-size warning remains.
- Initial parallel full-suite execution had one 5-second bootstrap-test timeout while lint/typecheck also ran. Two subsequent standalone full suites passed without editing or widening that test's timeout.
- Opener-specific tests cover no pointer path, native/outer focus timeout, native key timeout, Stop during pause, Stop immediately after focus, and pending-key quarantine blocking another worker until profile-stop confirmation. The original four tests were RED before implementation; three additional lifecycle tests characterize the implemented safety behavior.
- Independent read-only review found no blocking issue in the narrow opener delta.
- Native SQLite restored to Node ABI 137; an in-memory `SELECT 1` succeeded.
- Read-only selected original-account hash and ordered membership checks match the pre-retest baseline. This proves the three original selected rows are unchanged, not a bytewise hash of the entire production database.
- Isolated stored task rows remain account-1=6/12, account-2=12/12, account-3=12/12; unreleased proxy leases=0.
- No owned pointer-diagnosis Node/Electron process remained after cleanup. Latest launched profile stop was confirmed at 10:30:28.728Z.
- No mailbox purchase, new signup, git staging, commit, reset, stash, or unrelated rollback was performed.

## Resume prerequisites and acceptance

1. Wait for the server-side login limit to clear. Do not hammer login or alter identity/proxy to evade it. There is no evidence-based reset time to promise.
2. Resume only the remaining original account through the real engine. A successful opener probe or passing unit tests cannot substitute for its successful `do_action` evidence plus a newer valid task snapshot.
3. Once it has a fresh/final 12/12 receipt, create a NEW isolated SQLite backup for final three-account revalidation. Helpers under `.superpowers/sdd/2026-09-08-final-three-revalidation/` were prepared and syntax-checked, but not launched. Their preparation refuses to proceed unless all three stored task sets contain exactly 12 unique status-4 rows.
4. Run the official headed `resume`, stage 3, threads 3 harness against all three original IDs. The two already-complete accounts must still authenticate/read a fresh snapshot, but must not repeat their completed missions.
5. Accept only the exact run artifact's independent validator passing with 3 completed account terminals, 3 fresh/final 12/12 receipts, zero failed/stopped/skipped accounts, zero purchases/unsafe events/cleanup failures, and all resources released. Do not call this a fresh-account full workflow or a 10-worker pass.

Current blocker is external authentication throttling. The canvas candidate and the required final three-worker live gate remain **unverified**, and the task remains **unfinished**.

## Explicit goal continuation at 19:46 +07:00

The user explicitly requested a persistent goal; it was created as **active**, with the same three existing accounts and the exact acceptance gate above. It must not be completed on unit tests alone.

- Fresh opener/receipt preflight: 4 files, 31 tests passed.
- After more than two hours without this task issuing login requests, a single headed resume attempt still returned HTTP200/business code7 at **2026-09-08T12:50:48.197Z**, with the same maximum-attempts message. No Retry-After header was observed by the diagnostic.
- The diagnostic stopped immediately; profile stop confirmed at12:50:49.099Z. Summary: completed0, failed0, stopped1. No new task checkpoint or task mutation occurred.
- Native SQLite returned to Node ABI after the run. The selected original account hash still matched. No owned pointer-diagnosis process remained at19:58.
- A thread-attached heartbeat was created and verified active: `ti-p-t-c-capcut-3-t-i-kho-n-12-12`. It checks every four hours, refuses login until at least four hours since the most recent attempt (longer if the server later supplies Retry-After), stops immediately on another denial, and continues the exact-account workflow when available. This is conservative retry spacing, **not** a claimed CapCut reset time. The computer and desktop app must stay running for local work.
- Do not attempt another login before **2026-09-08T16:50:48.197Z** (23:50:48 +07:00) based on the latest known attempt; recalculate this lower bound if a later attempt is recorded.
- The goal remains unfinished. Disable the heartbeat only after real completion or an explicit user instruction; do not archive the task or mark the goal complete while the receipt/three-worker gate is missing.

A read-only audit also found that the final revalidation wrapper could start a child before exclusively reserving its process record. The helper is being corrected and regression-tested before it can be used; no final three-account launch has occurred.

At20:10, the wrapper's five subprocess regression tests passed after the initial three expected failures; independent review was still pending. The official runner/options/evidence suites also passed102/102 using Vitest. These are offline safety gates, not a successful live account or a completed goal.

At20:26 the final wrapper repair passed9/9 controlled subprocess tests and independent re-review resolved both outstanding findings. It reserves bookkeeping before spawn, never finalizes at `exit` before stdout drains, and preserves pending ownership on post-spawn errors until child/streams close. Partial reservation cleanup removes only the current attempt's files, preserving old evidence.

Ruling: do not kill the intermediary Node runner if a post-spawn PID write fails; doing so cannot prove its Electron descendant/profile cleanup. Retain ownership and force a failed result after close instead. The tradeoff is waiting for the official runner's bounded cleanup rather than reporting a premature terminal state. The live12/12 and three-worker gates are still outstanding; goal and scheduled continuation remain active.

## External blocker audit at21:25 +07:00

Three consecutive goal turns have encountered the same authentication throttle. The latest real login response is still12:50:48.197Z/code7, and the next conservative retry gate16:50:48.197Z has not arrived. No further login was issued. The goal must now be recorded **blocked**, not complete; the existing four-hour scheduled continuation remains active to recheck when eligible. This status records an external dependency, not success or removal of any requirement.

A proposed login-error classifier was investigated during the wait and withdrawn in full because its response-reading/cancellation path lacked sufficient safety and integration evidence. Only that agent's experimental changes were reversed; the prior dirty worktree and verified canvas/receipt changes remain. Fresh checks after withdrawal:138files1524tests passed, typecheck/lint passed, original selected-account hash/membership unchanged. The authoritative result remains account-1=6/12 and account-2/3=12/12; final three-worker acceptance has not run.
