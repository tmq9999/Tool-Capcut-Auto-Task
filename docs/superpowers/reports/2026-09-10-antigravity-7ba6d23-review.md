# Review Antigravity — 7ba6d23, ngày 10/09/2026

## Kết luận

**Còn 15 nhóm lỗi xác nhận: 2 P1 và 13 P2.** Commit đã sửa được nhiều lỗi của vòng trước, nhưng chưa thể đóng toàn bộ T01–T19. Full suite xanh không phủ các race/lifecycle/failure-path dưới đây.

Phạm vi lượt này: review source, chạy kiểm chứng offline và viết tài liệu; **không sửa application source**. Không kết luận về executable người dùng đang chạy. Giữ nguyên flow do_action, trial gate, endpoints/op_id/order/pacing/restock và hiển thị plaintext API key/password/proxy trên Dashboard.

Baseline: `7ba6d231e2a876bfa0b51376fb57dc750d5b5e88`, working tree sạch trước review. So với inventory của [full-file audit](2026-09-10-full-file-audit-coverage.md): 436 → 447 source/script/test files, **73 file thay đổi hoặc mới**, không file bị xóa. Không dùng riêng git diff dd8a16e..7ba6d23 thay thế so hash, vì audit trước bao gồm dirty source.

Bộ bàn giao hiện hành, đã viết lại trực tiếp:

- [Spec](../specs/2026-09-10-tool-bugfix-spec.md)
- [Plan F01–F14](../plans/2026-09-10-tool-bugfix-plan.md)
- [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md)

## Findings và thứ tự ưu tiên

Line references dưới đây khóa theo HEAD 7ba6d23; tìm bằng tên hàm nếu source đổi. “Probe” là chạy actual module/method với dependencies DEMO trong memory, không phải live CapCut.

### AG01 — P1: lỗi lưu terminal vẫn có thể kết thúc completed hoặc không dừng peers

**File/hàm:** `src/main/services/AutomationRunService.ts`: `recordOutcome` 1006–1044, `commitOutcome` 988, `acceptTerminalError` 1051, `runPrepared` finalization 2426–2462, `stop` 2945.

**Nguyên nhân:** Nhánh DB throw/false gọi commitOutcome → increment → progress observer trước khi đặt terminalPersistenceFailure. Observer throw ngắt bookkeeping; thread.outcome đã khóa nên worker không ghi lại failure. Ngoài ra acceptTerminalError trả ngay khi đã có terminalIntent, kể cả provider-block vốn chưa abort accepted peers. Failure sau ghi đè cause đầu; cleanup branch ghi đè persistence reason.

**Tái hiện đã chạy:**

~~~json
{"flagPresent":false,"state":"completed","failed":1,"persisted":false}
{"priorIntent":"INSUFFICIENT_FUNDS","peerAborted":false,"state":"blocked"}
{"firstCause":"db-1","retainedCause":"db-2"}
{"persistenceAndCleanupReason":"RESOURCE_CLEANUP_FAILED"}
~~~

Thông báo public còn nội suy raw cause.message tại 1040; lỗi phải giữ cause ở main và dùng message cố định như contract trước. Điều này không liên quan việc hiển thị credential plaintext theo chủ ý người dùng.

**Fix nhỏ:** khóa first persistence failure trước mọi callback, isolate observers, promotion riêng cho failure này abort acquisition/accepted peers bất kể prior intent. Counter một lần; giữ first cause; merge cleanup details vào persistence reason ở cả completion/Stop. Không replay account hoặc retry workload. **Task F01.**

### AG02 — P1: Start không single-flight, chạy config khác lúc bấm hoặc tiếp tục sau save thất bại

**File/hàm:** `src/renderer/pages/Dashboard/dashboardController.ts::start` 471; `DashboardActionBar.tsx` nút Start.

**Nguyên nhân:** không có pendingStart trước await; chỉ chụp revision, còn toRunConfig đọc current state sau flush. flush không trả kết quả commit có nghĩa. ActionBar chỉ disable theo isStopping. Rejected IPC cũng thiếu finally giải phóng submitting. Fallback thiếu clearedThrough còn gọi logs.clear sau khi workers đã bắt đầu.

**Probe actual controller:**

- Double Start khi autosave off → **2 run.start**.
- Bấm Start tại threadCount=11; sửa 12 trong lúc save11 pending → run nhận **12**.
- Save failed → vẫn **1 run.start**, error bị xóa.
- Fallback deletion là code-path compatibility; main hiện có cutoff nên không gọi đây là lỗi mọi Start.

**Fix nhỏ:** một owned Start promise trước await; clone config ở click; validate và persist đúng snapshot khi autosave bật; abort Start khi save required thất bại; always release latch. Không gọi renderer logs.clear, kể cả reply cũ thiếu cutoff. Main exact-ID reset ticket đang đúng, giữ nguyên. **Task F03, sau F02.**

### AG03 — P2: autosave báo đã lưu bản chưa lưu, retry ngoài ý muốn và thiếu reject cleanup

**File/hàm:** `dashboardController.ts::scheduleSave` 190–253, `flushPendingSave`, `saveConfig`.

**Nguyên nhân:** mỗi edit gắn thêm .then recursive; success cũ luôn bật configSavedAt; rejected IPC không catch; flush dùng Promise<void> nên mất trạng thái failure/superseded.

**Probe:** save11 pending → edit12 → ack11: current12, lastSavedRevision1/revision2 nhưng badge=true; save12 failure: badge vẫn true và có **request thứ3** ngoài lần retry do user yêu cầu.

**Fix nhỏ:** một active save, một coalesced background-next, tối đa một pinned Start target; kết quả theo snapshot. Marker chỉ bật khi current revision đã commit. Failure/rejection settle waiters, saving=false khi owned queue hết; không tự retry failed snapshot. Giữ typed saveAutomation đã có, không ghi toàn stale settings. **Task F02.**

### AG04 — P2: Dashboard load cũ ghi đè edit/progress mới, không fence lifecycle

**File/hàm:** `dashboardController.ts::load` 381–418, `attach`/`dispose`.

**Nguyên nhân:** các continuation settings/logs/providers/progress không có load epoch, lifecycle generation hoặc edit/push revision. Snapshot pair accounts/threads đã có coalescing không bảo vệ các read này.

**Probe mới:** settings.get pending → user đổi threadCount17 → reply defaults → **threadCount10**. Source còn cho stale idle progress thay live progress và old load publish sau dispose/re-attach.

**Fix nhỏ:** generation + load token cho từng continuation; per-field touched revision cho config hydration; progress push epoch; catch/finally chỉ cập nhật owner hiện hành. Không xóa draft plaintext. Log reset fence phối hợp F05. **Task F04.**

### AG05 — P2: reset log vẫn cho SQL response/Clear cũ làm sống lại log đã xóa

**File/hàm:** `src/renderer/pages/Logs/logsController.ts::applyLogReset` 321, `loadHistory`, `finishClear`; Dashboard `applyLogReset`, `load`, `onEntry`.

**Nguyên nhân:** Logs reset prune buffers nhưng không invalidate loadToken/reset epoch; previousRows của Clear cũ vẫn restore sau reset mới. Dashboard chỉ filter array hiện tại, không giữ watermark để chặn old pushes/SQL. SQL persisted rows không có streamSequence nên không thể lọc chúng chỉ bằng cutoff.

**Probe:**

~~~json
{"sequence":"load → reset5 → old SQL(no sequence)","visible":["old-db-no-seq"],"listCalls":1}
{"sequence":"Clear pending → reset10 → old Clear fail","visible":["old"],"error":"disk"}
{"sequence":"Dashboard reset5 → old push4 → old SQL","visible":["old-db"]}
~~~

**Fix nhỏ:** monotonic reset epoch/watermark, invalidate pending history; reload history sau reset khi cần, giữ pushes >cutoff; Clear snapshot chỉ restore nếu reset epoch không đổi. Idempotent event+reply không xóa post-reset SQL rows mới; old Clear error không thuộc reset mới. Giữ no-loss Clear replay và normalized/upsert performance patches. **Task F05.**

### AG06 — P2: Settings bị kẹt loading sau StrictMode effect replay

**File/hàm:** `src/renderer/pages/Settings/settingsController.ts::load` 173, response guard 185, `dispose` 406; `SettingsPage.tsx` effect 52; `src/renderer/main.tsx` StrictMode.

**Nguyên nhân:** dispose=true vĩnh viễn, load/subscribe không reactivate. React setup→cleanup→setup dùng lại controller nhưng bỏ mọi reply mới; dispose còn xóa drafts/touched flags.

**Probe actual controller:** load → edit DEMO credential → dispose → load: **loading=true, draft trở về keep**. StrictMode là trigger trực tiếp ở development; không khẳng định mọi production mount đều lỗi.

**Fix nhỏ:** replayable lifecycle session; invalidate old reads nhưng preserve draft; reactivate khi load/attach của session mới. Không tắt StrictMode để giấu bug. **Task F06.**

### AG07 — P2: sửa một field sớm trong Settings làm mất settings persisted khác

**File/hàm:** `settingsController.ts::load` 214, `updateSettings` 247.

**Nguyên nhân:** một boolean touchedSettings ngăn hydrate toàn settings khi bất kỳ field nào thay đổi. Defaults của field chưa chỉnh thành dữ liệu được full-save sau đó.

**Probe:** server threadCount17; user chỉ đổi sessionRestore lúc get pending → threadCount hiện10; payload save gửi **10**.

**Fix nhỏ:** touched revisions theo leaf/path, hydrate untouched fields; credentials drafts độc lập từng service. Không thay bằng all-or-nothing guard khác. **Task F06.**

### AG08 — P2: Settings save/refresh cũ vượt lifecycle và có thể apply boot prefs của session cũ

**File/hàm:** `settingsController.ts::save` 285, refresh 370–389; `SettingsPage.tsx` save callback 90.

**Nguyên nhân:** save/refresh không capture generation; page continuation không mounted/session guard. Refresh failures còn bị nuốt không warning.

**Probe:** save pending → dispose → listener của session mới → old ack/refreshthreads22: **publish1, isSaved=true, threads22**. Page callback sau navigation vẫn có thể ghi boot preference cũ.

**Fix nhỏ:** commit boolean phải trung thực, nhưng state publication/refresh và boot prefs phải thuộc session gốc còn active. Apply committed general snapshot, không current draft. Save committed + refresh fail → true kèm warning. **Task F06.**

### AG09 — P2: DOB mới random helper nhưng chưa chọn/kiểm chứng đúng DOB trong form

**File/hàm:** `src/main/services/capcut/birthday.ts::generateBirthday` 57–69; `signup.ts::handleBirthdayIfPresent` 302–388; signup entry 469.

**Nguyên nhân:** production tự chọn range1990–2004 dù spec trước chưa có policy được user xác nhận. Form vẫn dùng global positional nth(monthIndex/dayIndex), fallback option đầu và không đọc selected year/month/day trước Continue. Generator còn nhận fractional/NaN/infinite range và RNG ngoài [0,1); sampling month rồi day không uniform trên calendar dates.

**Probe:** helper form hoàn tất Continue1 dù fixture **không cung cấp bất kỳ inputValue/textContent readback nào**. RNG1 cho year2005/month13/day32; fractional year/NaN accepted. RNG invalid là lỗi injectable contract, không nói Math.random bình thường trả1.

**Fix nhỏ:** explicit valid-calendar range, uniform day-offset, sample một intended DOB mỗi signup attempt, scope đúng dropdown/option value, readback đủ ba trường trước Continue, không first-option fallback. **Task F07-A.** Khoảng production chưa được chốt: **F07-B WAITING-DOB-POLICY**. Không tự bịa range mới hoặc chặn toàn signup đang chạy để tuyên bố đã fix; các task khác tiếp tục.

### AG10 — P2: Stop vẫn chờ raw auth waits/reads tới browser timeout

**File/hàm:** `login.ts` 75,110,211,238,255; `signup.ts` 100,135,298,509,553 và DOB/overlay reads.

**Nguyên nhân:** pacing và post-submit navigation đã sửa, nhưng input.waitFor/trigger/button wait, heading.textContent còn raw await không gắn abort/deadline phù hợp.

**Probe:** abort khi fillVerified đã entered input.waitFor → chưa settle sau25ms; chỉ trả khi giải phóng browser wait. Default browser timeout có thể kéo Stop20–25s.

**Fix nhỏ:** wrap bounded reads/waits với signal và host deadline phù hợp; giữ optional navigation fallback, jitter/pacing duration. Waiter cancel không đồng nghĩa remote action đã bị hủy; chặn mọi next action sau late resolver. **Task F08.**

### AG11 — P2: không đọc được checkbox lại coi là unchecked và toggle ngược

**File/hàm:** `signup.ts::acceptTermsIfAny` 244–249.

**Nguyên nhân:** initial isChecked.catch(()=>false). Checkbox vốn checked nhưng read throw/typed timeout → click uncheck → SIGNUP_TERMS_NOT_ACCEPTED.

**Probe:** actual helper, initialchecked=true/readthrows/toggle semantics → checked=false; submit blocked sau khi tự làm sai state.

**Fix nhỏ:** unknown read phải propagate đúng error, không click; checked/hidden không toggle. Giữ stable all-checkbox locator đã sửa original membership bug. **Task F09.**

### AG12 — P2: lỗi đọc task dialog kích hoạt vòng IPC retry qua parent rerender

**File/hàm:** `AccountsPage.tsx` 356 inline loadTasks; `accountsController.ts::loadTasks` 356–362; `TaskProgressDialog.tsx` effect 112–116.

**Trace:** IPC rejection → controller.setState(error) → useSyncExternalStore rerender AccountsPage → inline function mới → effect dependency đổi → reset error/loading và gọi IPC nữa. Lỗi persistent tạo loop. Component fixture hiện có stable useCallback nên không đi qua loop này.

**Fix nhỏ:** stable callback tại **AccountsPage thật** theo controller identity; giữ error sau failure, chỉ retry khi user/chuyển account. Test mounted actual page+controller subscription, không chỉ standalone dialog. **Task F10.**

### AG13 — P2: LogBus runtime outage vẫn im lặng

**File/hàm:** `src/main/services/LogBus.ts::flush` 174–194; production wiring `runtime/providerStack.ts`.

**Nguyên nhân:** catch chỉ đặt retryNotBefore, không có out-of-band notification. Live stream tiếp tục trong khi SQLite durable writes không hoạt động; user chỉ biết khi shutdown/dispose fail.

**Bằng chứng:** toàn flush/wiring không có report hook; retry/recovery tests hiện tại chỉ kiểm attempts/queue. Batching/throttle đã sửa đúng, không nhầm việc giữ toàn pending trong outage là bug mới.

**Fix nhỏ:** một notification cố định mỗi outage và một recovery (first successful write), outside chính LogBus.emit; guard reporter throw; wire production. Giữ FIFO/batch50/no-drop; RAM không được hứa bounded khi outage vô hạn. **Task F11.**

### AG14 — P2, diagnostic-only: onboarding probe không khởi động được

**File:** `scripts/live-onboarding-probe.cjs` 14.

**Nguyên nhân:** dùng workspaceRoot nhưng declaration đã bị xóa. OTP API đã sửa nhưng script fail trước approval guard/main.

**Probe inert imports, actual script trong VM:** `ReferenceError: workspaceRoot is not defined`.

**Fix nhỏ:** khôi phục local root bằng path.resolve(__dirname, '..'); VM test actual top-level với imports inert, thiếu approval phải nhận PROBE_APPROVAL_REQUIRED trước effects. Không chạy script live. **Task F12.**

### AG15 — P2, legacy-only: HTTP200 task-list error envelope vẫn thành proof thành công

**File/hàm:** `src/main/services/capcut/taskApi.ts::parseTaskList` 37; monitor response handler khoảng754.

**Nguyên nhân:** HTTP status đã validate nhưng task-list parser bỏ err_no. Error envelope chứa plausible status4 rows vẫn cập nhật authoritative TaskStore.

**Probe actual TaskStore/EventEmitter:** valid causal action + fresh HTTP200 snapshot err_no8001003/status4 → **verdict=pass, reasonCode=REWARD_VERIFIED**.

**Fix nhỏ:** validate explicit success envelope trước authoritative snapshot update; reject error/malformed envelope, không xóa trạng thái healthy trước đó. Giữ causal action + fresh snapshot; chỉ sửa legacy taskApi, không default httpTasks. **Task F13.**

## Vì sao 2.170 tests chưa chứng minh đóng backlog

Những mục này là **test gaps**, không cộng thêm vào 15 source findings:

| File/anchor | Khoảng trống cần đóng ở F14 hoặc task sở hữu |
|---|---|
| signupTerms.test.ts:117,167 | Static membership thay dynamic locator; happy-path catch-all che lỗi trước submit |
| authCancellation.test.ts:131 | Abort sau10ms đang nằm trong pacing4000ms, chưa entered marker |
| trial.test.ts:85,370 | Timer helper trả uninitialized khi chưa settled; “during survey” thực chất pre-abort; thiếu post-Skip outer read |
| birthday.test.ts:59 | “memoized” chỉ gọi generator một lần, không attempt/UI/retry |
| AutomationRunService.test.ts:4478,4537,4547,4628,4750 | null.toBeDefined; durable log chưa flush; preset routeReleased thay cleanup race |
| fixtures/deterministicRunHarness.ts:184,189,223,245,302,522 | Counter clamp về0 và dùng service snapshot làm resource oracle, che duplicate release |
| scripts/__tests__/live-capcut-options.test.mjs:17,55,88,112,299,331 | Duplicate parser; spy không gắn real call; sentinel không được đưa vào code-under-test |
| scripts/bugfix-ui/fixture.tsx | Không mount SettingsPage/AccountsPage/provider drawers; export bỏ _req, không assert payload |
| Runtime reset / credential CAS / account delete tests | Thiếu preflight-reset integration, pending invalidate/finally ownership, financial retention/two-account/full task-table rollback |

Không cần rewrite controller/framework để sửa các gaps. Mỗi test mới cần RED đúng nhánh nghiệp vụ trước fix; test cho source đã đúng cần assertion chứng minh đã vào nhánh.

## Trạng thái 30 findings vòng trước

“Đã sửa lỗi gốc” chỉ là phạm vi finding gốc; không có nghĩa tất cả variants đã được live-test.

| ID cũ | Đánh giá tại7ba6d23 | Bàn giao còn lại |
|---|---|---|
| A01 | Đã sửa abortable pacing đúng duration | Giữ, F14 timer/assertion guards |
| A02 | Chưa hoàn tất DOB UI/range/readback | AG09/F07 |
| A03 | Sửa dynamic-membership gốc; còn uncertainty toggle | AG11/F09 |
| A04 | Source survey uncertainty đã sửa | F14 post-Skip/in-flight coverage |
| A05 | Sửa pacing/post-submit navigation, raw waits còn | AG10/F08 |
| M01 | Credential BLOB CAS/keyed-flight/finally guard đã có | Giữ; F14 lifecycle variants |
| M02 | Fatal trước intentional skipped đã đúng | Giữ |
| M03 | Reject normalized duplicate routes trước capacity | Giữ |
| M04 | Password colon suffix được giữ | Giữ |
| M05 | Chưa đóng observer/priorintent/cleanuppriority | AG01/F01 |
| M06 | Batch/retry throttle đúng, thiếu outage report | AG13/F11 |
| M07 | Diagnostic snapshot/CAS đã có | Giữ |
| B01 | Save revision marker/queue còn sai | AG03/F02 |
| B02 | Load lifecycle/early-edit chưa sửa | AG04/F04 |
| B03 | Main reset cải thiện; renderer Start chưa đạt | AG02/F03 |
| B04 | Guard all-settings gây mất untouched fields; replay mới lỗi | AG06,AG07/F06 |
| B05 | Save boolean committed cải thiện; stale lifecycle chưa fence | AG08/F06 |
| B06 | Dispose giữ unconfirmed pushes đã sửa | AG05 là reset-race variant cần F05 |
| B07 | Export rejection latch/finally đã sửa | Giữ, mounted five-sequence PASS |
| B08 | Receipt account identity đã sửa | AG12/F10 parent-error loop |
| B09 | Canonical/manual + unknown legacy options đã sửa | Giữ, thêm mounted assertions F14 |
| B10 | WARNING mapping đã sửa | Giữ |
| C01 | Repeated before-quit preventDefault đã sửa | Giữ |
| C02 | Main exact-ID reset ticket+wiring probe đúng | Renderer reset fence AG05/F05; integration F14 |
| C03 | Same-DB task cleanup transaction đã có | Giữ; F14 full rollback/finance assertions |
| D01 | HTTP non2xx bị chặn; envelope variant còn | AG15/F13 |
| D02 | Materialized signed Request + rejection observer đã sửa | Giữ |
| D03 | Explicit finite numeric0 đã sửa | Giữ |
| D04 | OTP API đúng, top-level startup mới hỏng | AG14/F12 |
| D05 | Body/cleanup failures exit nonzero đã sửa | Giữ, không live-run |

## Kiểm chứng của lượt review này

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| npm run typecheck | PASS, exit0 | Không chứng minh timing |
| npm run lint | PASS, exit0 | Không chứng minh flow |
| node node_modules/vitest/vitest.mjs run --maxWorkers=4 | **2170 tests /168 files PASS**, exit0 | Các gaps trên vẫn còn |
| npm run build | PASS, exit0 | Warning renderer chunk557.43kB >500kB; không kết luận đây là nguyên nhân giật |
| npm run selectors | **89 pass,0 fail**, exit0 | Fixture selectors, không live CapCut |
| node scripts/check-bugfix-ui.mjs, bounded hidden child | **5 mounted sequences PASS**, exit0 | Export/standalone Task only, không Settings/actual Accounts parent |
| electron-rebuild + isolated run-electron-harness.cjs | PASS, exit0 | Native SQLite/preload/isolation/typed IPC, không automation live |
| Synthetic actual-module probes | Repro ghi từng finding | Không thay thế vendor/live UI evidence |
| Kiểm tra tài liệu cuối | 14 local links, 29 code-block syntax checks, mapping15findings/14tasks; git diff --check PASS | Kiểm tra cú pháp không phải tests đã được triển khai |

Đối chiếu lại SHA-256 của447source/script/testfiles cuối lượt: **0 file thay đổi** so với snapshot bắt đầu review. Working tree chỉ có4documentationfiles của bộ bàn giao; các kết quả test/build/harness ở trên ứng với cùng source.

Node suite dùng Node24.19.0/ABI137; cuối review đã **restore Electron35.7.5/ABI133**, isolated SQLite harness load thành công. UI harness dùng DEMO localhost và temporary profile, không tài khoản/purchase/trial thật. Harness đã dọn DB/profile tạm do chính nó tạo; isolated user-data thư mục .debug có thể còn để kiểm tra, không xóa dữ liệu app người dùng.

## Coverage delta và giới hạn

Đã đọc current changed implementation/test files theo ba lane: auth/legacy; runtime/persistence; renderer/bridge, cộng root trace Dashboard/Logs và review các findings. Hàm/caller/async ownership liên quan được kiểm; previous unchanged file audit được giữ bằng hash, **không gọi đây là chạy lại mọi branch của447files**. No-findings không đồng nghĩa bug-free.

- Nguồn độc lập/runtime providers, native bridges, settings/repositories/IPC/quit giữ findings cũ đã đạt.
- Build/generated artifacts không phải code review coverage.
- Không đọc credential payload/.env/userDB thật, không chạy live provider suites, không đo end-to-end mượt với CapCut thật hoặc production network.
- Không dùng component SSR/test xanh thay mounted effect coverage.
- Inventory delta dưới đây khóa nội dung đã review; nếu Antigravity sửa tiếp, đối chiếu hash và đọc lại diff trước áp plan.

### 73 file thay đổi/mới so với audit trước

| File | SHA-256 |
|---|---|
| `scripts/__tests__/legacy-diagnostics.test.mjs` | `3f224aa6a0f214292770319a36aa73cb4ed9ffa153cfb607c151916a4e516211` |
| `scripts/bugfix-ui/fixture.tsx` | `b76a3e8355aed376866da3066fb590e72b203df76584233cdc16da3bc4407efd` |
| `scripts/bugfix-ui/host.cjs` | `6c75b64a5f7840ae64dbc7e7c6880821368a969caa25d86ca70a0a02afcc6739` |
| `scripts/check-bugfix-ui.mjs` | `23d23e7387af027df54531d452f3f880c07d867b868c27d2eab4455c5216f836` |
| `scripts/legacy-diagnostic-helpers.cjs` | `b4a14a91ede595840046369c1bea8905b37feac5c32010c06c1a38505450e8bc` |
| `scripts/live-complete-and-claim.cjs` | `9f9bd0c63b5fbda97fc1b27c924ce84dc846c61ced2ecd67eac245ed17a823ae` |
| `scripts/live-onboarding-probe.cjs` | `f31e3f60b35191c2a186835c27d089757ccd25756a57fa59982273beec872b2a` |
| `scripts/live-register-and-claim.cjs` | `ca0aa353c405ded2dc9e386f0832cb7f6c1f84be75d4b79f4cc19fe91cf7c803` |
| `src/main/__tests__/lifecycle.test.ts` | `79517541da75b0bb3e51fd09bc57f55bf47574277915a27344c0e9ac50898b02` |
| `src/main/ipc/__tests__/settingsIpc.test.ts` | `54a473f79c92830529e804aac8580f9f6137fb8242a0dca1dee3bf3792a4c17f` |
| `src/main/ipc/automationIpc.ts` | `981e21e3e3a8ed1e02bfa6df86914e08af5c05f5dbca8d3fc01c1da14392337e` |
| `src/main/ipc/settingsIpc.ts` | `9a9167d545ef1e566cc3476da3b999a2ad8e2c57c85ef77f1f60926965e2f316` |
| `src/main/lifecycle.ts` | `d9fcc97a3956b0d2ccb4bdab358d3851f9086c1372967b5b52f8304a9b9d2ef1` |
| `src/main/main.ts` | `9a66e88e96b0f6ad5b30c812eb355a36b737a0093884faae6bb5e7290d1a8013` |
| `src/main/repositories/AccountRepository.ts` | `286fa6637e5f2ee98590e52723da246e07a63359e0779cc9a97fac07419d5473` |
| `src/main/repositories/CredentialRepository.ts` | `4769128ad76e3be8c9fb41fa1fe2aaa8235c57739919ae34713bc96b424cd00a` |
| `src/main/repositories/LogRepository.ts` | `23aa86552558ee4a324a05e61ac09985c518c651f25b9ec19eddbec74e25f00f` |
| `src/main/repositories/SettingsRepository.ts` | `4011760ee055b7a837774b4a55d047f7ef2d7c719e308592c2af72f1c62415b1` |
| `src/main/repositories/__tests__/repositories.test.ts` | `ce81d1bfa5eb5f21f61d5f82c61a5899ad01bd5d8c366711edb5cc1df1b6d2c1` |
| `src/main/runtime/providerStack.ts` | `d96d9a88a2713663c186c9bdb4edf1fd69b652d4590bde9f06aa992a7342041d` |
| `src/main/services/AutomationRunService.ts` | `871f796fc2d29ca6f4b906326ff1b19d120628742c3841a4a9a7dc3e90166d7c` |
| `src/main/services/AutomationTerminalError.ts` | `71211bbf385b82341a0129527e11ca9566502e11fb1916b15bece9a3cd271301` |
| `src/main/services/DirectProxyPool.ts` | `2257a911230b1ecbf1c129d076ae6c35f4569552ab5257bb3f4952e56c681f3c` |
| `src/main/services/LogBus.ts` | `379919a35984ceb08e574ae66b78e6027a8d8b09153c09dd3723503dcc5f87ee` |
| `src/main/services/MultiloginAuthService.ts` | `e7673027c291a0a100811ef279285833c35d6615956980f402850b9018043091` |
| `src/main/services/ServiceConnectionManager.ts` | `4a3f3aa3b069af359f1fcba14581287b924780ba7fbaeeb3fcb15b0cfcea1ca9` |
| `src/main/services/SettingsService.ts` | `85ed709bc2c3d14c3f14a1c0c262a3a5c8ebe30686c66c06a99c90006a3841ac` |
| `src/main/services/__tests__/AutomationRunService.test.ts` | `9e8652cd4f3aff20ddd3beb91ae595ddd4040d2903190665dfcde358e6d7699f` |
| `src/main/services/__tests__/DirectProxyPool.test.ts` | `0ae7e90a81c46ee547af7a2fd9916a85b2c0345e8302aeaebb449bc270a49b21` |
| `src/main/services/__tests__/LogBus.test.ts` | `5a153ef3d89065228cab7fb8a37c20eaa3b23d63975a6241d59320d899ac32f9` |
| `src/main/services/__tests__/MultiloginAuthService.test.ts` | `8972e6893b8863b2e1783868e2c01d2f7b77b65773f039090fe2fe70e3ee4eff` |
| `src/main/services/__tests__/directProxy.test.ts` | `8cb2655babbeb135815e59ee52d2625418bfd6c28444094c6d7b3b95e5997c96` |
| `src/main/services/__tests__/providerConnectivity.test.ts` | `ef6dae93c49ff25dc66135b2f3d989064c0911e1a55f98785f99cd0e0db57759` |
| `src/main/services/capcut/__tests__/authCancellation.test.ts` | `470e286f38f008afd0410ea13831f3d06b1664b2f3ff2ec5c58cf00cb012b0e1` |
| `src/main/services/capcut/__tests__/birthday.test.ts` | `6617e943f07557e03d94273ec635c9661c09cd10a23fdba4281c5c9f17eda18c` |
| `src/main/services/capcut/__tests__/signupTerms.test.ts` | `acf8b74c428f995721daff1b71db3ffcc9f509075ef07ee0ed8dbc3c18bd97c9` |
| `src/main/services/capcut/__tests__/taskApi.test.ts` | `112641e63d4d21673aae110b3269b0681264716ac3ce1896ea4d9a4c5049fce1` |
| `src/main/services/capcut/__tests__/trial.test.ts` | `81263960e854698532e53c37cb522996218cb4b849badc03d608271a495e0cd2` |
| `src/main/services/capcut/__tests__/verifiedTyping.test.ts` | `d76ec93bc56f733decb146bb56446b36990f43c25e6d9b4db6fe53b3df30e93e` |
| `src/main/services/capcut/birthday.ts` | `3eba5173b80f4ae5479151cc1d1bceaea5cbe6e292d49df8f85920475ec91965` |
| `src/main/services/capcut/http/__tests__/signedRequest.test.ts` | `da36eeac85aa122eb40109fcb7d97dd71a06556cb06f6463e7a320b9a318e7d1` |
| `src/main/services/capcut/http/__tests__/taskMutation.test.ts` | `61d315a41abf97a7300f5a160d3cb41880758b79cea0f71cb68f3f1b9423df8c` |
| `src/main/services/capcut/http/signedRequest.ts` | `b5d92bf576e2ba4f47a925596e08c7f3becaf039eda06218ed6b0d12e6edf71c` |
| `src/main/services/capcut/http/taskMutation.ts` | `4b69c2d6011af6372ef0c332f9d2c0f5283e50623cd2008bdafca388141d5b15` |
| `src/main/services/capcut/login.ts` | `394fa1ccb1a4f987dda58c841d89f040e38ebb7b822f9546785099bdb2991c94` |
| `src/main/services/capcut/signup.ts` | `08f923df4c656e71a04034d63977d631425376e301e6b78f5b791e0b509c7907` |
| `src/main/services/capcut/taskApi.ts` | `159a074459f5647b18fc750d603a019e940c04d8d0db6a98cc6b7ee963878ea0` |
| `src/main/services/capcut/trial.ts` | `9a663948325d3d42fea260d8e8666d5a316a3b1d75a1098d74529562bbe7aa57` |
| `src/preload/preload.ts` | `6d6a8d0ec7fed419808c276b8aa14fc2c41eea06081b22f0229e568f0f69b005` |
| `src/renderer/pages/Accounts/AccountsToolbar.tsx` | `d29cf352d872e5866cac0d646fea45b900583449fa9e0453cc9e9d687e94ca3c` |
| `src/renderer/pages/Accounts/AddAccountDrawer.tsx` | `16c697629b6ee8db1f594e15cfb661e89e28744ea449d57ef74abb65172ba8ba` |
| `src/renderer/pages/Accounts/EditAccountDrawer.tsx` | `12b319de5d9769d0c60bdcb5db43eeb43421367f87e79286f2e8d26ee390c0ad` |
| `src/renderer/pages/Accounts/ExportDialog.tsx` | `edff9311266eb4855ceff7d78ec0ff2c777884791e2167db57c7ea0e2be055d0` |
| `src/renderer/pages/Accounts/TaskProgressDialog.tsx` | `645e881c2a68e892a99651624b04e79ba5c425a4e64c87864343f86159282ee1` |
| `src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx` | `65224fe74eddb628efefa80dc9f762e78df83190963bd56a16238914cb490298` |
| `src/renderer/pages/Accounts/__tests__/accountsController.test.ts` | `453a4c90ee62aecd6cc4bbca02b97f4f6007b92a23fa0c98db3f643377d0d2e3` |
| `src/renderer/pages/Accounts/__tests__/emailSourceOptions.test.tsx` | `e5b89d9cb050f6696f67bb8afa7b79f66c4fc6258f9c3074a6dc208e37a6cbfd` |
| `src/renderer/pages/Accounts/accountsController.ts` | `077eb5caf19713f0d29e6a41a7774b335ba4e882e13686834896361440fac108` |
| `src/renderer/pages/Accounts/emailSourceOptions.ts` | `e01155ca8553af85c7b83d819a12922565aad9a78ec1e0b66dfa9206cb3f1b91` |
| `src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts` | `9ef8ffa8a8fc99a73e7a9753bce703f65251afa3a3088a4bf77c4e372f1b24fa` |
| `src/renderer/pages/Dashboard/dashboardController.ts` | `2dc0ee13430523be6546cf582a455f0881c8e0afd4d6d1d8931b0b5f5e5d058d` |
| `src/renderer/pages/Logs/__tests__/logsController.test.ts` | `beea2863a1480cf931f36c55538d57ebb62cbbb8b6cd2fc5d09a5ced164081c6` |
| `src/renderer/pages/Logs/__tests__/logsRendering.test.tsx` | `9e3259ebe71379a0fbf08339944caa956c863de656b9bd16912dbf02434247da` |
| `src/renderer/pages/Logs/columns.tsx` | `b778848b33990fd26e78e149a63270e716a52841175e4a7ccb54b2664f0fec51` |
| `src/renderer/pages/Logs/logsController.ts` | `321d0fb8d73843ddfdcca82d013b2c457f6d76e698c12818be28f50005595116` |
| `src/renderer/pages/Settings/SettingsPage.tsx` | `0d8f177c0f404eca0fe7272ed24e67beebfa29c3f1d316a1abdad2e1d7d392e6` |
| `src/renderer/pages/Settings/__tests__/settingsController.test.ts` | `04e07c0d87847991b94ac371d4f3e0a32d3f16e3b28f466765120406527ab176` |
| `src/renderer/pages/Settings/settingsController.ts` | `d8620c217adb167dba9eb41738acee818eb19abe5972a7daad99c8dc6c4fe246` |
| `src/shared/contracts/__tests__/contracts.test.ts` | `00760f9f1e2fc5ed365276cffc4dbec346313aa61f1bc4b22621c2efcb663181` |
| `src/shared/contracts/api.ts` | `f160376c30363b470232f3ba93b3b38e17e1ae48d50e4de1e038b8b7cddc7664` |
| `src/shared/contracts/ipc-channels.ts` | `bb76539ae15ef7e2e403f3b897882dd011fbc947c55aa010c369f603cb5b894d` |
| `src/shared/schemas/log.schema.ts` | `f3bff41ea66c0da40b17f0c69c4eef3e421a4db5a6aa1f3b7177f210ef44ebf9` |
| `src/shared/types/log.ts` | `064036011c49a3ed6fff9d26d95373e18c830dade3dcd4d0c4cb52e75b3686f7` |
