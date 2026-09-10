# ToolCapCut — audit theo file, chức năng và hàm

## Phạm vi, revision và cách đọc report

Ngày audit: 10/09/2026. Source: HEAD `dd8a16e4dbfc1c2d51a7265fbdc05f861a9ab768` **cộng working tree Antigravity chưa commit**, bao gồm F01–F05/S01–S07. Không reset về clean HEAD; không coi bug của bản trước là còn tồn tại nếu patch hiện tại đã sửa.

[Bảng coverage từng file/hàm](2026-09-10-full-file-audit-coverage.md) ghi path, hash source, symbol và mức kiểm chứng. Đã đọc production source, không chỉ diff: 219 file TS/TSX, 49 script/tool JS/TS; có 1.319 khai báo callable có tên và 1.251 callback/anonymous callable trong source. Type/schema-only files được đọc nhưng không giả định có runtime function. Go bridge/config/CSS được ghi riêng.

“Đã đọc toàn file” không đồng nghĩa “mọi nhánh đã chạy”. Report phân biệt:
- **Probe**: chạy actual module/class/function với fake dependency, deferred response hoặc SQLite :memory:.
- **Source**: trace từ entrypoint qua caller/callee và xác định điều kiện lỗi; chưa có GUI/live repro.
- **Legacy/diagnostic**: chỉ ảnh hưởng nhánh hoặc script được nêu, không được gán cho default do_action.

Không sửa application source trong audit. Không mua email, chạy tài khoản thật, kích hoạt trial hay thay flow. Chỉ tạo report/coverage. Không có bằng chứng người dùng chạy executable nào; không quy nguyên nhân cho “chạy bản cũ”.

## Kết quả chính

**25 findings cần xử lý trong các chức năng chính**: 3 P1, 21 P2 và 1 P3. Thêm 5 findings ở legacy/diagnostic được tách riêng. P1 = nên sửa trước chạy tiếp workflow bị ảnh hưởng; P2 = lỗi chức năng đáng sửa; P3 = lỗi hiển thị nhỏ.

| ID | Mức | Chức năng/hàm | Lỗi |
|---|---|---|---|
| A01 | P1 | loginCapcut / signupCapcut | Deadline bằng đúng thời gian sleep, auth khỏe vẫn timeout |
| A02 | P2 | handleBirthdayIfPresent | DOB cố định, options theo vị trí, thiếu readback |
| A03 | P2 | acceptTermsIfAny | Dynamic locator bỏ sót checkbox thứ hai |
| A04 | P2 | clearTrialSurvey | Đọc survey lỗi lại coi là đã đóng |
| A05 | P2 | login/signup/onboarding waits | Stop sau Submit vẫn chưa được bao hết |
| M01 | P1 | MultiloginAuthService.persistSession | Auth cũ ghi đè cấu hình người dùng vừa thay |
| M02 | P2 | classifyUiResult | Trial fatal/unknown thành skipped + done |
| M03 | P2 | parseDirectProxyList / DirectProxyPool | Trùng normalized route vẫn cấp cho hai worker |
| M04 | P2 | parseDirectProxy | Password có dấu : bị cắt |
| M05 | P1 | recordOutcome / workerLoop | Terminal DB write lỗi nhưng run completed, mất outcome counters |
| M06 | P2 | LogBus.emit / flush | DB lỗi làm retry toàn queue trên mỗi emit |
| M07 | P2 | ServiceConnectionManager.testConnection | Kết quả key cũ gắn vào key mới |
| B01 | P2 | Dashboard.saveConfig | “Đã lưu” cho revision chưa save thành công |
| B02 | P2 | Dashboard.load | Response cũ ghi đè edit/lifecycle mới |
| B03 | P2 | Dashboard.start / ActionBar | Double Start dispatch hai lần |
| B04 | P2 | Settings.load | Load reply xóa draft mới nhập |
| B05 | P2 | SettingsPage.handleSaveSettings | Save fail vẫn áp boot preferences |
| B06 | P2 | Logs.dispose / clear / load | Replay làm mất provenance của preclear live log |
| B07 | P2 | ExportDialog.handleExport | Rejected IPC làm busy bị kẹt |
| B08 | P2 | TaskProgressDialog load effect | Dữ liệu A có thể ở dưới email B khi read reject |
| B09 | P2 | Accounts drawers / filter | Provider values không nhất quán |
| B10 | P3 | Logs status cell | WARNING không khớp WARN |
| C01 | P2 | handleBeforeQuit | Quit lần hai vượt cleanup đang chờ |
| C02 | P2 | RUN_START IPC | Start reject vẫn xóa logs |
| C03 | P2 | AccountRepository.deleteAccounts | Tasks/receipts/pending rows không được dọn |

## A. Đăng ký, DOB, trial và cancellation

### A01 — P1: intentional delay bị deadline của chính nó cắt

- **Source/hàm:** [login.ts:186](../../../src/main/services/capcut/login.ts#L186), `loginCapcut`; [signup.ts:432](../../../src/main/services/capcut/signup.ts#L432), `signupCapcut`; biến thể [trial.ts:220](../../../src/main/services/capcut/trial.ts#L220) và :273.
- **Input/điều kiện:** browser đã navigation xong; code gọi `withinDeadline(page.waitForTimeout(4000), 4000, signal)`.
- **Nguyên nhân:** host bắt đầu deadline trong khi timer của browser phải đi qua channel; response quay lại có overhead. Cùng 4 giây không có dư địa để hoàn thành một delay 4 giây.
- **Probe:** actual exports, fake browser chỉ thêm 30ms overhead: cả login và signup ném `OperationDeadlineError` ở khoảng 4.015–4.016 giây; markerReads=0, signal chưa abort. Đây không phải mất kết nối vendor.
- **Tác động:** auth fail trước khi đọc trạng thái tiếp; trial random gần max8/9s cũng có rủi ro.
- **Fix hẹp:** `abortableDelay(duration, signal)` cho intentional pacing; giữ duration/random sample, không giảm pacing hay thêm retry.
- **Test cần:** sleep thực/deferred theo đúng duration + channel overhead; Stop trong delay; không dùng mock waitForTimeout resolve ngay để chứng nhận nhánh này.

### A02 — P2: ngày sinh hard-code và chọn sai option có thể không bị phát hiện

- **Source/hàm:** [signup.ts:254](../../../src/main/services/capcut/signup.ts#L254), `handleBirthdayIfPresent`.
- **Bằng chứng:** :277 `fill('1998')`; :290 chọn tháng bằng options global `.first()`; :307 ngày `.nth(14)`; :314 thiếu option thì fallback `.first()`; :329–333 Continue mà không đọc lại year/month/day.
- **Yêu cầu đã rõ từ người dùng:** DOB phải random, không dùng cùng DOB hard-code. Trong production chưa có generator/range cấu hình để reuse.
- **Tác động:** các signup dùng mẫu cố định; placeholder/hidden dropdown/virtualized options có thể làm ngày được chọn khác ngày chủ định. Không khẳng định vì vậy account bị vendor chặn; chưa có bằng chứng đó.
- **Fix hẹp:** chốt khoảng DOB hợp lệ, generate một date cho một signup attempt, giữ cùng date khi UI retry; tính ngày theo tháng/năm nhuận; scope dropdown đang mở và chọn theo value/text; readback trước Continue. Không tự chọn một option khác khi không thấy ngày cần.
- **Test cần:** injected deterministic RNG, boundaries/leap-February, hidden/reordered options, mismatch, no-birthday screen và Stop. HTTP caller-supplied birthday không phải generator của browser; không đổi transport hay thêm HTTP DOB endpoint.
- **Điểm cần chốt khi triển khai:** khoảng tuổi/năm chưa tồn tại trong repo. Không tự bịa nó trong patch, nhưng thiếu range không phải lý do giữ lại hard-code hoặc bỏ finding.

### A03 — P2: checkbox điều khoản thứ hai bị bỏ qua

- **Source/hàm:** [signup.ts:225](../../../src/main/services/capcut/signup.ts#L225), `acceptTermsIfAny`.
- **Điều kiện:** có từ hai `input[type=checkbox]:not(:checked)`.
- **Nguyên nhân:** chụp count ban đầu rồi tăng nth(i) trên locator sống; checkbox vừa check rời khỏi tập, nên chỉ số tiếp theo nhảy qua ô còn lại.
- **Probe:** actual private function được export chỉ trong bản transpile in-memory; hai ô → `[true,false]`, nhưng log “Đã xử lý 2 checkbox”.
- **Tác động:** Submit còn thiếu điều khoản, có thể không chuyển trạng thái.
- **Fix/test:** snapshot tập ổn định hoặc xử lý first remaining trong budget ban đầu; assert tất cả required boxes đã checked. Không chấp nhận log/count thay trạng thái thực.

### A04 — P2: hậu kiểm survey thất bại trở thành cleared=true

- **Source/hàm:** [trial.ts:119](../../../src/main/services/capcut/trial.ts#L119), `clearTrialSurvey`, đặc biệt :133.
- **Nguyên nhân:** đọc đầu và sau Skip đều `.catch(() => false)`; hậu kiểm bị đảo `!false`.
- **Probe:** survey ban đầu visible; hậu kiểm DOM throw; actual checkProTrial vẫn có Upgrade click và trả eligible từ fake pricing: surveyReads2/upgrades1.
- **Tác động:** tái tạo điều kiện bấm sau overlay chưa xác minh.
- **Fix:** giữ abort/deadline; ordinary read failure trả unknown/error rõ, không dùng “không đọc được” làm “không tồn tại”. Trial gate không thay.
- **Test thiếu:** post-Skip read reject/deadline; S01-E hiện pre-abort trước lời gọi nên chưa phủ tình huống này.

### A05 — P2: Stop mới chỉ sửa một phần các chờ auth

- **Source/hàm:** [login.ts:256](../../../src/main/services/capcut/login.ts#L256), `loginCapcut`; [signup.ts:541](../../../src/main/services/capcut/signup.ts#L541), `signupCapcut`; DOB/onboarding helpers.
- **Điều kiện:** Stop khi post-submit waitForURL60/90s, fallback goto60s hoặc raw waitForTimeout đang pending.
- **Bằng chứng:** các await này vẫn không signal-bound dù initial goto/marker đã sửa. Source trace cho thấy Stop phải đợi response/timeout hoặc external page cleanup trước gate tiếp.
- **Fix:** bound từng await có trách nhiệm; post-await signal check; intentional pacing dùng abortableDelay cùng duration. Không abandon newPage/profile creation.
- **Giới hạn:** không coi mọi delay cố ý là bug; lỗi là chúng không thoát theo Stop. OTP owner mới đã được probe tốt, không báo lại lỗi OTP cũ.

## M. Runtime, lưu dữ liệu, proxy và service

### M01 — P1: stale auth response ghi đè cấu hình Multilogin mới

- **Source/hàm:** [MultiloginAuthService.ts:94](../../../src/main/services/MultiloginAuthService.ts#L94), `persistSession`, callers `resolveToken`.
- **Luồng:** đọc blobA → sign-in/refresh await → người dùng replace/delete credential → responseA → saveCredential({...blobA,session}).
- **Probe:** storage đã đổi token NEW-DEMO, auth cũ resolve → mode quay lại credentials cũ, new token mất.
- **Tác động:** mất thay đổi người dùng, trả/lưu token gắn cấu hình cũ.
- **Fix:** CAS/revision hoặc so identity snapshot trước persist; update session chỉ cho credential đã dùng. Không redesign vault, không masking.
- **Test cần:** replace và delete giữa pending sign-in/refresh; old request completion không overwrite/new request không chia nhầm stale in-flight.

### M02 — P2: unknown trial fatal bị coi là bỏ qua hợp lệ

- **Source/hàm:** [AutomationRunService.ts:1739](../../../src/main/services/AutomationRunService.ts#L1739), `classifyUiResult`; [CapcutEngineService.ts:291](../../../src/main/services/CapcutEngineService.ts#L291).
- **Bằng chứng:** default engine unknown trial trả `skipped:true,fatalError,verification:null`. Classifier xử lý skipped trước fatalError(:1787).
- **Probe:** kết quả `{kind:'skipped',status:'done'}`.
- **Tác động:** account lỗi không tăng failed; UI done/bỏ qua dù trial lookup lỗi. Không nói nó tăng tasksCompleted.
- **Fix:** fatal trước intentional skip; kết quả no-trial đã xác định vẫn được skip theo cấu hình.
- **Test:** ghép engine shape vào runtime. Hai suite hiện chỉ test từng nửa/skipped và fatal riêng.

### M03 — P2: capacity proxy đếm dòng trùng như route riêng

- **Source/hàm:** [AutomationRunService.ts:901](../../../src/main/services/AutomationRunService.ts#L901), `parseDirectProxyList`; [DirectProxyPool.ts:22](../../../src/main/services/DirectProxyPool.ts#L22).
- **Probe:** hai dòng identical normalized endpoint → hai object, pool active2 và sameEndpoint=true.
- **Tác động:** hai workers dùng cùng route; capacity check không thực sự bảo đảm số proxy độc lập.
- **Fix:** reject hoặc dedup identical normalized scheme/host/port/auth trước capacity. Không kết luận khác credential trên cùng gateway luôn là cùng exit IP.
- **Test:** duplicate lines/normalized variants → không cấp đồng thời; unique routes vẫn giữ FIFO.

### M04 — P2: password proxy có dấu : bị mất phần đuôi

- **Source/hàm:** [AutomationRunService.ts:421](../../../src/main/services/AutomationRunService.ts#L421), `parseDirectProxy`.
- **Probe:** `192.0.2.1:8080:demo:a:b` trả password `a`, không phải `a:b`.
- **Fix:** parse phần địa chỉ/user trước, giữ nguyên phần password còn lại; nếu format không hỗ trợ phải reject rõ, không silently truncate. Tests cả user:pass@host và host:port:user:pass.

### M05 — P1: DB write terminal lỗi nhưng outcome đã khóa

- **Source/hàm:** [AutomationRunService.ts:959](../../../src/main/services/AutomationRunService.ts#L959), `recordOutcome` → `workerLoop` catch/finally.
- **Nguyên nhân:** gán thread.outcome trước accounts.update; update ném thì counter/evidence chưa chạy, catch thấy outcome có rồi nên không ghi failed; lỗi thường còn bị nuốt.
- **Probe full service:** DB fixture ném đúng status done; summary `completed, accepted=1, completed=0, failed=0, stopped=0`.
- **Tác động:** account không có terminal state đáng tin cậy, counters không khép kín nhưng run báo completed.
- **Fix:** xác nhận persistence trước khóa outcome; failure phải tới owner terminal/error counter phù hợp, giữ lỗi gốc. Không “chữa” bằng tăng count completed trước DB.
- **Test:** throw/false ở terminal persistence; counters và DB outcome nhất quán; không double terminal khi retry cleanup.

### M06 — P2: LogBus gây retry storm khi DB lỗi

- **Source/hàm:** [LogBus.ts:97](../../../src/main/services/LogBus.ts#L97), `emit/flush`.
- **Probe:** 1.000 emits vào failing sink → 951 flushes, 499.275 tổng item attempts, pending1.000.
- **Nguyên nhân:** queue giữ lại sau fail nhưng mỗi emit mới đã vượt batch threshold nên thử lại toàn queue.
- **Tác động:** work/memory tăng trong lúc DB/disk lỗi; chưa đo số giây block với DB thật, không gọi đây là FPS.
- **Fix:** retry theo lịch/backoff sau failure, bounded batch/pending policy có thông báo; không silently xóa tất cả log.
- **Test:** kéo dài sink failure + nhiều emits, recovery flush không mất/trùng row, dispose error không bị báo success giả.

### M07 — P2: diagnostic của key cũ ghi vào key mới

- **Source/hàm:** [ServiceConnectionManager.ts:134](../../../src/main/services/ServiceConnectionManager.ts#L134), `testConnection`.
- **Probe:** OLD key test pending → storage NEW key → OLD OK → NEW metadata status connected với result cũ.
- **Fix:** capture credential identity/revision trước test, chỉ update metadata nếu vẫn đúng snapshot. Draft test tiếp tục không persist.
- **Tách M01:** M07 sai metadata, M01 mất cả credential; hai owners/patch boundaries khác nhau.

## B. Renderer, controllers và UI

### B01 — P2: Dashboard báo đã lưu revision chưa được lưu

- **Source:** [dashboardController.ts:168](../../../src/renderer/pages/Dashboard/dashboardController.ts#L168), `updateConfig/saveConfig/flushPendingSave`.
- **Probe:** autosave11 pending → edit12 → save11 success → save12 fail. Sau save11: current12,isSaving=false,savedShown=true; sau fail12 vẫn savedShown=true.
- **Nguyên nhân:** sau await đọc lại current config thay snapshot đã gửi; pendingSave chỉ giữ promise cuối.
- **Fix:** snapshot/revision và serialize/coalesce saves; badge chỉ phản ánh revision commit. Rejection phải settle flags.
- **Test:** burst edits, old success/new failure, old failure/new success, flush trước Start.

### B02 — P2: Dashboard load cũ vượt lifecycle và đè edit

- **Source:** [dashboardController.ts:317](../../../src/renderer/pages/Dashboard/dashboardController.ts#L317), `load`.
- **Probe:** settings pending → thread17 → dispose/attach → old settings reply → thread10.
- **Nguyên nhân:** generation của snapshot pair không bảo vệ settings/logs/providers/progress awaits trong load.
- **Fix:** load epoch + edit revision, catch/finally; merge request live pushes cho logs; stale response không publish vào lifecycle mới.
- **Không mở scope:** không thay account/proxy business flow.

### B03 — P2: double Start từ nút dưới

- **Source:** [dashboardController.ts:400](../../../src/renderer/pages/Dashboard/dashboardController.ts#L400), `start`; [DashboardActionBar.tsx:157](../../../src/renderer/pages/Dashboard/DashboardActionBar.tsx#L157).
- **Probe:** hai start trước reply →2logs.clear+2run.start. ActionBar chỉ disabled isStopping, header isSubmitting không bảo vệ nó.
- **Fix:** latch trước await đầu, truyền submitting tới cả hai controls, catch/finally. Main guard không đủ vì C02 xóa log trước reject.
- **Không suy diễn:** chưa có bằng chứng hai run cùng thực thi; runService đang từ chối run thứ hai.

### B04 — P2: Settings load xóa draft mới

- **Source:** [settingsController.ts:157](../../../src/renderer/pages/Settings/settingsController.ts#L157), `load`.
- **Probe:** pending load → replace KEY-DEMO → reply → draft action keep.
- **Fix:** latest load/lifecycle + edit revision, chỉ hydrate field chưa bị sửa. Không auto-clear input khi load chưa thuộc current editing session.
- **Test:** initial load/edit, hai loads đảo reply, dispose/replay.

### B05 — P2: Save fail vẫn đổi boot preferences

- **Source:** [SettingsPage.tsx:90](../../../src/renderer/pages/Settings/SettingsPage.tsx#L90), `handleSaveSettings`.
- **Trace:** bỏ boolean controller.save; luôn ghi localStorage/apply current general settings sau await.
- **Trigger:** đổi sessionRestore, save thất bại; hoặc thêm edit mới trong save.
- **Fix:** apply đúng snapshot đã commit khi save thành công, không current draft. Không dùng light-theme control bị disabled làm repro UI.
- **Mức chứng cứ:** source/control flow; chưa browser event test.

### B06 — P2: replay trong failed Clear vẫn làm rơi log

- **Source:** [logsController.ts:313](../../../src/renderer/pages/Logs/logsController.ts#L313), `dispose/finishClear/loadHistory`.
- **Probe:** preclear unflushed seq1 → Clear → dispose/attach → waiting load → Clear failure → SQL[]; cuối logs=[],error=disk.
- **Nguyên nhân:** dispose xóa unconfirmedPushes dù vẫn giữ Clear barrier.
- **Fix:** giữ provenance thuộc in-flight Clear qua lifecycle, retire theo ack/cutoff/cap.
- **Không lặp finding cũ:** S02 tốc độ và S04 thường đã cải thiện; đây là tổ hợp replay còn thiếu test.

### B07 — P2: Export rejection khóa busy

- **Source:** [ExportDialog.tsx:89](../../../src/renderer/pages/Accounts/ExportDialog.tsx#L89), `handleExport`; [accountsController.ts:370](../../../src/renderer/pages/Accounts/accountsController.ts#L370).
- **Trace:** IPC reject truyền qua controller; dialog không catch/finally. isExporting=true còn mãi; close/reopen giữ cùng component.
- **Fix:** error/finally và request/session identity cho post-await state. Không hủy quyền sở hữu file export đã dispatch.
- **Test:** rejected IPC, cancel save dialog, close/reopen pending, done outcome.

### B08 — P2: Task dialog có thể gán receipt A dưới account B

- **Source:** [TaskProgressDialog.tsx:61](../../../src/renderer/pages/Accounts/TaskProgressDialog.tsx#L61), load effect; [accountsController.ts:355](../../../src/renderer/pages/Accounts/accountsController.ts#L355).
- **Trace:** không clear data đầu request, không catch rejection; finally chỉ tắt loading. Header email đã B, data/verification của A còn.
- **Fix:** reset data theo account identity; catch trong canceled guard, error rõ. SSR initialData test không chạy effect nên không phủ.
- **Mức chứng cứ:** source/control flow, chưa GUI E2E.

### B09 — P2: provider dropdown và filter không chung giá trị

- **Source:** [AddAccountDrawer.tsx:145](../../../src/renderer/pages/Accounts/AddAccountDrawer.tsx#L145), EditAccountDrawer tương tự; [AccountsToolbar.tsx:93](../../../src/renderer/pages/Accounts/AccountsToolbar.tsx#L93).
- **Trace:** drawer lưu Gmail/Outlook/Yahoo/Proton; toolbar lọc manual/gmail94/dongvanfb/customdomain. Schema string cho phép cả hai, không có normalize bridge.
- **Tác động:** account nhập tay không thấy dưới Nhập tay; edit bot account có controlled select value không nằm options.
- **Fix:** thống nhất khái niệm email source-provider; giữ legacy values để không đổi dữ liệu cũ khi chỉ edit field khác.

### B10 — P3: WARNING bị render theo mapping sai

- **Source:** [Logs/columns.tsx:49](../../../src/renderer/pages/Logs/columns.tsx#L49), [shared/types/log.ts:1](../../../src/shared/types/log.ts#L1).
- **Trace:** canonical WARNING, view/badge kiểm WARN; cast trong toViewLog che sai type.
- **Fix/test:** canonical enum cho badge, assert WARNING style/label. Không liên quan plaintext.

## C. IPC, lifecycle và DB cleanup

### C01 — P2: quit lần hai không bị chặn lúc shutdown pending

- **Source:** [lifecycle.ts:79](../../../src/main/lifecycle.ts#L79), `handleBeforeQuit`.
- **Probe:** first preventDefault1, second0, DB chưa close khi automation deferred.
- **Tác động:** second Electron quit có thể đi qua guard trước cleanup hoàn tất.
- **Fix:** trong isShuttingDown vẫn preventDefault; chỉ isShutdownFinished cho final app.quit qua. Không thay chính sách timeout shutdown trong finding này.
- **Test hiện sai:** lifecycle.test.ts:93–121 cố ý assert second preventDefault0. Phải sửa expectation theo event semantics, không chỉ idempotent close/quit counts.

### C02 — P2: Start bị từ chối vẫn xóa log

- **Source:** [automationIpc.ts:55](../../../src/main/ipc/automationIpc.ts#L55), RUN_START handler.
- **Probe:** request hợp lệ qua schema + runService.start reject → clearAllLogs1, successfalse.
- **Nguyên nhân:** clear trước start, không qua LogBus queue/cutoff.
- **Fix:** một owner clear ở accepted-run boundary; failed start không phá logs. Không chỉ khóa nút UI, vì IPC còn callers khác.

### C03 — P2: delete account không dọn task data

- **Source:** [AccountRepository.ts:366](../../../src/main/repositories/AccountRepository.ts#L366), `deleteAccounts`; `AccountService.remove`; `AccountTaskRepository.deleteByAccount` không có production caller.
- **Probe:** real SQLite :memory:, FKON, all migrations, checkpoint+pending rồi delete → accountGone=true,tasks1,receipt=true,pending1.
- **Fix:** coordinated transaction dọn task/receipt/pending rows đúng account cùng delete.
- **Ranh giới:** không tự xóa purchased mail/financial mutation ledger hoặc sửa migration checksum để chữa orphan.

## D. Legacy/diagnostic — không gán cho default run

| ID | Source/hàm | Bằng chứng/tác động | Fix hẹp |
|---|---|---|---|
| D01 | capcut/taskApi.ts:743, attachTaskMonitor | HTTP503/body err_no0 vẫn được push accepted proof; actual EventEmitter probe | Kiểm HTTP status và envelope trước authoritative proof; default httpTasks đã strict hơn |
| D02 | capcut/http/signedRequest.ts:30, captureNextSignedRequest | Trả raw Playwright Request cast thành draft; path undefined, method function; assertSignedRequest crash | Materialize draft từ matched Request; test fake trả đúng Request |
| D03 | capcut/http/taskMutation.ts:16, sendTaskAction | Number(err_no) nhận cả “0”/false; probe confirmed; chưa thấy default caller | Chỉ explicit numeric0 |
| D04 | scripts/live-onboarding-probe.cjs:287 | Gọi Gmail94Provider.getOrderStatus không tồn tại, script hỏng ở OTP polling sau bước mua | Sửa theo existing readOtp contract hoặc đánh dấu script không dùng; không chạy live để kiểm |
| D05 | live-register-and-claim.cjs:311 và live-complete-and-claim.cjs:366 | Catch lỗi rồi finally process.exit(0), failure exit xanh | Giữ nonzero failure exitCode qua cleanup |

Không yêu cầu tích hợp media-artifact/product mission của các nhánh này vào do_action. D02/D03 dormant không phải bằng chứng nguyên nhân lần chạy user.

## E. Test xanh nhưng thiếu hoặc không kiểm đúng nhánh

| Test | Vấn đề audit được | Bổ sung đúng |
|---|---|---|
| lifecycle.test.ts:93 | Assert second quit preventDefault0, encode C01 | Deferred shutdown + second event vẫn phải prevented |
| automation.schema.test.ts:255 | “duplicate task” có invalid enum keys và thiếu ownership aliases; fail trước duplicate refinement | Payload còn lại valid + duplicate valid task key; assert duplicate issue |
| signedRequest.test.ts:6 | waitForRequest fake trả Draft thay vì Request | Return actual-shape Request, assert returned DTO fields |
| authCancellation/trial/verifiedTyping fixtures | waitForTimeout resolves ngay | Real duration/deferred channel overhead cho A01; không false green bằng mock |
| trial.test.ts S01-E | pre-abort trước call, không abort giữa survey read | Deferred mid-read và post-Skip rejection |
| signup tests | Không DOB generation/readback/multi-checkbox | Valid calendar/range/option identity và dynamic locator |
| CapcutEngineService + automationTaskProgress | unknown skipped+fatal test riêng hai tầng | Engine result → actual runtime classifier |
| ProxyLeaseManager S06-C | Abort trước acquire, chưa bao giờ khóa busy key | Abort sau current-IP entered, sau đó acquire lại key |
| S03-A / S03-F Dashboard | Tên “poll tick” không tick; “removeAccounts” không gọi remove | Fake timer tick và actual remove callback |
| S07-E runtime | Preset routeReleased=true rồi gọi cleanup | Hai cleanup cạnh tranh trước flag; assert one lease release/counter |
| S05 OTP runtime tests:4518/4528/4609 | readerError khởi tạo null nhưng toBeDefined vẫn pass; đọc sink chưa flush dù LogBus batch1000 | Assert exact abort error và quan sát live subscription hoặc flush trước kiểm late SUCCESS |
| deterministicRunHarness.ts:522 | Final resource counts lấy từ chính service snapshot; local counters clamp Math.max(0,...) che duplicate release | Identity sets và independent observed counters đối chiếu service counts |
| live-capcut-options.test.mjs | Parser viết lại trong test; sideEffectSpy/secretContent không được nối tới code đang kiểm | Gọi production parser với real dependency spy và payload thực của test |
| TaskProgressDialog SSR tests | Chỉ initialData, effect không chạy | Switch account, reject, stale response |
| ExportDialog/SettingsPage | Thiếu interaction tests cho B05/B07 | Reject/save=false/commit revision |
| proxyQueueIntegration | Tên threads>keys nhưng workerCount=keyCount | Nếu policy cho phép, test đúng oversubscription; không suy tên là coverage |
| diag.test.ts | Fake screenshot đòi path trong khi production lấy Buffer | Correct Buffer fixture + assert screenshot bytes |
| imagexUpload.test.ts | Wrong CRC response + catch mọi error | Assert accepted receipt hoặc expected failure cụ thể |

Không sửa tests/source trong audit. Những gaps này giải thích vì sao full suite xanh không phủ các findings; không phủ nhận giá trị các tests đang kiểm đúng branch.

## F. Những sửa đổi đã giữ được, không báo lại là còn hỏng

- F01 paid INSERT/readback boundary/latch và F02 per-row password error: tests/probes cũ được kiểm trên current code, không còn nguyên bug cũ.
- OTP owner current code: Stop trả original reason, late code không SUCCESS. A05 chỉ nói các waits auth khác còn sót.
- Proxy pre-rotation signal checks và retained-session route guard đã hiện diện; không gọi toàn bộ S06/S07 là chưa sửa. Tests còn cần sát thực hơn.
- Logs current normalize/upsert giảm probe 1.000 pushes xuống khoảng34ms ở reviewer, so với khoảng1,1s bản full-sort trước; B06 là remaining combination.
- Dashboard snapshot pair coalescing/allSettled/current-next completion hiện có; B01/B02/B03 nằm ở save/load/start, không kết luận gate S03 hỏng.
- Plaintext Dashboard là yêu cầu, không phải finding bảo mật.
- Manual email duplicate không đưa thành bug nếu test/policy cho phép. Không giả định new random DOB range hoặc profile retry policy chưa được user chọn.

## G. Verification và giới hạn

- Full Vitest trên snapshot audit: **2.085 tests/163 files PASS**; đây không phải branch coverage100%.
- `npm run typecheck` và `npm run lint`: PASS, exit0.
- `npm run build`: PASS, exit0; còn warning bundle >500kB, không coi warning này là bằng chứng nguyên nhân UI lag.
- `npm run selectors`: 89 pass/0 fail, exit0.
- Electron harness ẩn với DB/IPC test cách ly: PASS, exit0. better-sqlite3 đã khôi phục Electron ABI133; không để lại Node ABI137 cho app.
- Đối chiếu lại 436 hash source/script/test inventory cuối audit: không file nào thay đổi; chỉ thêm report và coverage. Các working-tree patches của Antigravity được giữ nguyên.
- Pure probes: A01/A03/A04; M01–M07; B01/B02/B03/B04/B06; C01/C02; real SQLite C03.
- UI component findings B05/B07/B08/B09/B10 chủ yếu source/control-flow, chưa GUI reproduction.
- Không live provider/account, không auth mutation thật, không installer deploy. Không nói đã kiểm FPS/clipboard hoặc mọi remote contract.
- DOB random intent đã được user xác nhận; range còn phải chốt khi thực thi, không cần thay flow.
- Audit skills được dùng: Superpowers; audit-context-building cho giai đoạn đọc/trace, rồi systematic-debugging cho findings. Các reference files phụ của audit-context-building không có trong bản cài; dùng nội dung SKILL và checklist trực tiếp, không giả vờ đã đọc tài liệu thiếu.

## Thứ tự sửa đề xuất, không phải thay flow

1. A01 + A02/A03: lỗi ngay auth input/pacing.
2. A04 + M02: survey read và trial result classification.
3. M05 + M01: persistence/outcome và stale credential write.
4. B03 + C02, C01: Start/quit lifecycle.
5. B01/B02/B04/B05/B06: editing/load/provenance races.
6. M03/M04/M06/M07, C03 và dialogs.
7. D01–D05 chỉ nếu còn sử dụng nhánh/script đó.

Từng fix phải có RED đúng nguyên nhân và GREEN regression, không xóa flow/guard để xanh.
