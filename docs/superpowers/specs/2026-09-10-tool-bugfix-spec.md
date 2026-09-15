# Spec — Remaining bugs sau Antigravity, 15/09/2026

**Baseline:** HEAD3bb6b72 + dirty pasted-existing implementation;457JS/TSfiles,21changed/new. [Audit/evidence](../reports/2026-09-15-antigravity-project-review.md), [Coverage](../reports/2026-09-15-antigravity-review-coverage.md), [Plan](../plans/2026-09-10-tool-bugfix-plan.md), [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md).

**Mục tiêu:** Khép các lỗi còn tái hiện được sau đợt paste, không làm lại flow đã đúng. F01–F15 là code/contract findings; F16 là thiếu kiểm chứng. Các scenario contract-only được ghi rõ, không đồng nhất với incident live.

## Global Constraints

- Giữ do_action → task_list → claim/đối soát, endpoints, op_id, thứ tự, pacing, trial gate và normal restock.
- API key/password/proxy trên Dashboard vẫn plaintext/selectable; không masking, vault redesign hoặc reveal toggle mới.
- Pasted-existing dùng password từng dòng, existing-only auth; không signup/fallback, OTP, mua mailbox hoặc HTTP-only.
- Giữ UI/persisted manual và legacy runtime manual/API/custom/existing; không đổi ngầm contract hoặc mở feature đang khóa.
- Không auto-overwrite mật khẩu row đã có từ pasted login; Add/Edit explicit vẫn là nơi người dùng chủ động đổi.
- Chỉ fix đúng boundary và tests; không đổi framework, thêm dependency, refactor toàn controller/runtime hoặc thêm business retry.
- Không reset DB, xóa account/proof/lease, sửa migration checksum hay auto-release tài nguyên chưa xác nhận thu hồi.
- Fixtures dùng DEMO và DB/profile tạm; không live purchase/signup/trial, commit/push/deploy nếu chưa được cấp quyền riêng.

## Hợp đồng đã đạt — giữ làm regression

UI manual gửi emailSource.mode=pasted-existing, password.mode=per-account. PastedCapcutCredential gồm line:number, email:string, capcutPassword:string. Password là exact remainder sau first pipe; email trim, identity lowercase. Same credentials dedup trước mailLimit; conflicting same-email chặn toàn input kể cả dòng ngoài limit; không cap row200 (concurrency vẫn1..200).

PastedExistingWorkSource finite, prepare readonly một lần, workerTarget=min(threadCount,selectedCount). Preflight lookup selected emails no writes; multiple matches/active owner/missing lookup capability chặn. Worker rechecks sau proxy/cancel, sync bind local row→register owner. Zero row tạo local tracking; one row reuse; never remote signup. Password supplied transient cho known row, không sửa stored password. Mailbox reservation/acquisition counters chỉ cho kind=new. Trial/do_action tiếp tục như existing-account path.

## G01 — Paste boundary hoàn chỉnh (F04/F05)

- **G01.1:** Nonblank all-malformed text chỉ báo lỗi thực ở original lines, không EMPTY_INPUT giả. Blank/BOM-only mới EMPTY_INPUT line1.
- **G01.2:** Text và structured normalizer cùng trim email, validate, preserve first spelling và exact password. PastedCapcutSourceSchema và AutomationRunConfig source dùng chung conflict validation. Không throw raw TypeError với IPC malformed fields.
- **G01.3:** Service admission kiểm cả pasted-existing và per-account misuse, trước log reset/telemetry/source/provider/account mutation. Validate source-policy iff, unsupported transport/rollout/approvedMailboxes/stopAfter, budget0, line hợp lệ và input toàn batch.
- **G01.4:** Invalid request không làm hỏng owner/summary của run đang active. Valid pasted parse không sửa legacy runtime modes. Lỗi chỉ line/code, không whole credential row.

## G02 — Auth state nhất quán (F01)

- **G02.1:** Origin và marker facts lấy cùng document; chỉ auth nếu document identity/navigation epoch vẫn current. Navigation external hoặc same-URL replacement trong read không được dùng facts cũ.
- **G02.2:** Tìm visible workspace/auth/landing matches, không first-hidden wins. Auth-form phải thuộc auth UI, unrelated newsletter/settings email không tự phủ nhận workspace.
- **G02.3:** Visible auth-form/landing conflict không bị URLshortcut hoặc workspace marker override. Absent khác unreadable; preserve original AbortSignal reason và typed deadline.
- **G02.4:** Shared predicate dùng ở login/signup/ensureInApp; tests caller không cho nhiệm vụ bắt đầu khi auth invalid. Không thêm fallback/retry.

## G03 — Trial read có deadline và owner (F02)

- **G03.1:** Trial evaluate/presence/count paths bound bởi signal/deadline; abort sau entered read phải settle bằng chính reason, late reply không log/return eligible.
- **G03.2:** Card được đọc là unique visible Procard trong unique active pricing wrapper. Hidden stale card ngoài/đầu DOM không thắng current card; missing/ambiguous owner = unknown, không chọn arbitrary.
- **G03.3:** Giữ MIN_TRIAL_DAYS=7, canTrial/status rule và skipWithoutTrial hiện có. Price/CTA là thông tin đọc, không thêm business gate. Tuyệt đối không click Start free trial.
- **G03.4:** Dump/diagnostic không làm Stop treo; read failure không được trả eligible. Tests có actual READ_TRIAL chạy trên DOM fixture, không chỉ evaluate trả object dựng sẵn.

## G04 — DOB đúng owner (F03)

- **G04.1:** aria-controls exact target hoặc quan hệ ownership được chứng minh; unique global panel không đủ. Panel đã mở từ trước/unrelated phải không nhận option click.
- **G04.2:** Không owner/ambiguous = lỗi cụ thể trước chọn/Continue; Stop/timeout giữ identity.
- **G04.3:** Giữ lazy random một lần khi DOB hiện, semantic option match, leap-date validation và readback intended date trước Continue.
- **G04.4:** Production range1990–2004 chưa có lựa chọn thay thế được duyệt: WAITING-DOB-POLICY. Không hardcode range mới, không bỏ random; owner fix không phụ thuộc quyết định range.

## G05 — Proxy preflight cache theo attempt (F06)

- **G05.1:** Sau preflight AUTH/capacity fail, Start tiếp với cùng keys/region phải đọc token/inventory hiện tại.
- **G05.2:** Idle invalidation không gọi provider release, không xóa DB lease và không discard active/acquiring/releasing/failed-cleanup manager.
- **G05.3:** Trong cùng run, manager được reuse, rotation/cooldown/exclusivity giữ nguyên. Test settings token update và provider key inventory increase qua same service start hai lần.
- **G05.4:** Abort pending capacity read phải được observe; future attempt không reuse kết quả manager cũ; giữ existing terminal state/summary normalization.

## G06 — Log observer isolation (F07)

- **G06.1:** Một subscriber throw không làm emit throw, không chặn subscriber sau hoặc threshold flush.
- **G06.2:** Emit vẫn trả stamped entry; sink fail giữ queue, notice failure/recovery và retry cadence hiện có.
- **G06.3:** Reporter không gọi recursive emit; reset ticket/exact-ID deletion và stream sequence không đổi.

## G07 — Proof ownership, drain, outcome priority (F08/F09)

- **G07.1:** Accepted-proof và checkpoint callbacks cùng invocation/session/iteration owner guards. Closed/replaced owner không DB write hoặc mark memo; checkpoint retained session cũng bị chặn.
- **G07.2:** persistAcceptedProofs check owner trước memo lookup và trước dispatch. Memo-hit không chấp nhận stale owner; snapshot proof copy trước async.
- **G07.3:** All owned writes, gồm checkpoint đã entered nhưng chưa memoized, settle trước propagate batch failure/retire owner. Account-terminal persistence > proof persistence > ordinary error/cleanup abort; giữ primary cause/evidence, không abandon sibling hoặc swallow rejected promise.
- **G07.4:** Chỉ sau successful checkpoint, memo durable versions từ unsettled và rows có valid opId/provedAt. Settled proof không bị fallback cùng version dựng lại pending; proof mới hơn vẫn ghi. Không dùng task-key-only dedup.
- **G07.5:** Actual independent persistence failure = failed/error dù signal cleanup-aborted. Peer chỉ bị cleanup ngắt = stopped. Cả runThreadWorkload/workerLoop nhất quán; tổng run vẫn ưu tiên proof/account persistence theo policy hiện tại.
- **G07.6:** Real DB regression checkpoint→duplicate fallback→unsettled empty; terminal throw/false paths giữ original cause, no retry do_action. Không ép default flow phải media/product_mission.

## G08 — Freeze stop diagnostics (F10)

- **G08.1:** Khi stopOutcomeLocked, late success/rejection/phase callbacks không đổi cause/diagnostic/phase/remoteConfirmed hoặc counters.
- **G08.2:** Promise late rejection vẫn được observed. Stop không tự retry, không release proxy của profile chưa confirmed stop.
- **G08.3:** Unlocked ordinary stop failure vẫn ghi đúng diagnostic; remote-confirmed/local teardown failure giữ distinction đã có, không bị late error rewrite.

## G09 — Log history/read/reset ordering (F11/F12)

- **G09.1:** Dashboard mỗi history request có token+generation+reset epoch; old same-epoch reply không ghi đè current response.
- **G09.2:** Stored history là authoritative read; chỉ merge genuinely live/unconfirmed pushes, không toàn display buffer. Same-ID merge giữ higher streamSequence qua nhiều lần read bằng metadata current IDs; không giữ stale rows để giữ metadata. Sort/cap sau merge.
- **G09.3:** Clear khi Dashboard detached rồi attach/load SQL[] không phục hồi row cũ. Push after cutoff tồn tại qua snapshot/reset.
- **G09.4:** Logs stale Clear success/failure settle own promise và drain surviving queued pushes, không xóa new history/error/loading hoặc restore old rows. Cutoff monotonic; nếu reply mang cutoff thực mới hơn, apply reset coherently + replacement read.
- **G09.5:** Save/Start snapshot singleflight và completion bookkeeping không bị đổi. Không full settings reload hoặc logs.clear để “sửa” race.

## G10 — Accounts credential và mutation feedback (F13/F14)

- **G10.1:** Add/Edit secret replacement giữ exact bytes; trim chỉ kiểm emptiness/sentinel. email normalization không áp lên password. Keep placeholder/empty semantics hiện tại, explicit clear qua operation hiện có.
- **G10.2:** create/update/remove IPC rejection hoặc failed envelope → false/visible error, input/selection còn, không unhandled rejection.
- **G10.3:** Delete singleflight pending và chỉ close/clear selection sau committed success. Reply session cũ không đóng dialog mới; no duplicate destructive dispatch.
- **G10.4:** Mutation committed nhưng refresh failure không giả mutation failed và không tự re-dispatch; visible warning nêu chưa tải lại.
- **G10.5:** Dashboard removeAccounts/stopThread cùng rejection/session boundary; failed Stop không hiện “đã dừng”. Existing Start/Stop global flow giữ nguyên.

## G11 — Settings test connection theo draft (F15)

- **G11.1:** Mỗi service có request token và draft revision; result chỉ publish nếu invocation, draft và effect generation current.
- **G11.2:** Edit/clear/reset draft invalidate result của service; late test không đánh dấu credential mới healthy/stale. Test serviceB không làm sai A.
- **G11.3:** Pending indicator/button theo service; test draft chưa lưu vẫn hoạt động. Không save hoặc thay đổi secret vì bấm Test.
- **G11.4:** Thực thi mounted SettingsPage A/B out-of-order, edit-only và unmount/reopen; pageerror/unhandled rejection=0. Save lifecycle patch đã đúng phải giữ.

## G12 — Bằng chứng triển khai và release gates (F16)

- **G12.1:** Actual DashboardPage/controller/DEMO bridge: paste valid→Start exact typed payload; invalid/conflict→startCalls0; custom-empty không chặn manual; duplicate count và line preserved; edit while save pending không đổi snapshot; double Start=1.
- **G12.2:** Real factory/runtime/AccountService/SQLite cùng instance≥2runs, distinct IDs, zero/one/multiple identity, active ownership, update false/throw, proxy capacity, cancellation before acceptance. Known secret byte-exact unchanged; new row exact, no mailbox password.
- **G12.3:** Runtime typed RecoveryLoginError failing one account while peer continues; engine→ensureInApp policy tests assert forceSignup=false/allowSignupFallback=false/getOtp absent; signup/OTP/purchase spies0. Fake returned result không thay thế tests này.
- **G12.4:** Tail fixture uses current runId/sessionAlias/timestamps; assert exact accepted/completed/failed/stopped, durable proofs13, retained profile/lease IDs, cleanupFailures và do_action attempt counts. Finally abort/settle before DB close; no live/global fetch cross-account leakage.
- **G12.5:** Full typecheck/lint/2377baseline tests/build/selectors/UI/Electron gates; newtests tăng count và RED đúng symptom. Không dùng số2377 làm target cứng để bỏ test.
- **G12.6:** Handoff ghi source hash, command/exit, scenario, native ABI, limits; không claim live fixed khi chỉ offline.

## Trình tự / Definition of Done

G01,G02,G03,G04,G05,G06,G09,G10,G11 là các sửa độc lập theo domain; G07/G08 cùng runtime owner, tránh edit song song một file. G12 gom cuối sau focused gates. Tất cả F01–F16 có task/test mapping.

Mỗi task đạt khi assertion hành vi fail trước fix và pass sau fix, compatible regressions giữ xanh, code diff tối thiểu, reviewer kiểm source thay vì chỉ đọc agent summary. Release không chỉ dựa fullsuite green; cần mounted Start và tail tests đúng boundary. Không tự chạy/live account để “chứng minh” khi chưa có quyền.
