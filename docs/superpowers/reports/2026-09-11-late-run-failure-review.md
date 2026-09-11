# Review lỗi tăng ở các lượt cuối — 11/09/2026

## Kết luận từ lần chạy thật, không suy đoán executable

**Hiện tượng có thật:** lần chạy00:42–00:48 ngày11/09 (UTC+7) nhận10account; 6hoàn tất nhiệm vụ, 1bỏ qua theo trial gate, 3account cuối error.

**Chưa có bằng chứng lỗi do tài nguyên tích lũy.** Hai account cuối hoàn thành cả9do_action với err_no0 rồi bị chặn tại task_list; account thứ8 kết thúc auth trên trang marketing công khai. Dữ liệu hiện tại không đủ xác định vì sao upstream trả task_list bị loại hoặc vì sao auth rời workspace. Không được biến nghi vấn thành kết luận “proxy leak”, “captcha”, “key hết hạn” hay “chạy bản cũ”.

**Lỗi source đã xác nhận cần sửa ngay:** nhánh overlay mới vừa nuốt typed timeout vừa làm typecheck/lint thất bại; task_list làm mất lý do validation thất bại; overlay nhận nhầm modal Got it là survey; còn race Start/Settings/log khi đổi trang, DOB global option và stale summary ở run sau.

Bàn giao thực thi hiện hành được viết lại tại [Spec](../specs/2026-09-10-tool-bugfix-spec.md), [Plan R01–R10](../plans/2026-09-10-tool-bugfix-plan.md), [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md). Không áp lại toàn bộAG01–AG15 cũ.

## 1. Baseline

HEAD vẫn `7ba6d231e2a876bfa0b51376fb57dc750d5b5e88`, **cộng dirty Antigravity source**. Inventory449JS/TSsource/script/testfiles;37file khác snapshot review trước. Commit hash một mình không đại diện source đang review. User changes giữ nguyên.

Lượt này chỉ read-only source/runtime inspection, synthetic probes, focused tests và documentation. SQLite mở với `node:sqlite DatabaseSync(...,{readOnly:true})`; chỉ query log/status/counts, không đọc credential BLOB hoặc sửa tài khoản. Không gọi provider, live mutation, purchase/trial, không resetDB, không rebuild bundle/native addon khi app có thể đang chạy.

## 2. Timeline từ runtime_logs + accounts

Account alias dưới đây được hash, không dùng email/profile/token thật. Giờ địa phương UTC+7.

| Thứ tự nhận | Alias | Bắt đầu | Auth(ms) | 9do_action err0 | Kết quả |
|---|---|---|---:|---:|---|
| 1 | aa76d2 | 00:42:30 | 58976 | 0 | Bỏ qua theo trial, không phải bug |
| 2 | 5337f6 | 00:42:33 | 56365 | 9 | Đủ12/12 |
| 3 | a189ed | 00:42:37 | 56106 | 9 | Đủ12/12 |
| 4 | 034748 | 00:43:56 | 56982 | 9 | Đủ12/12 |
| 5 | d251db | 00:44:14 | 53923 | 9 | Đủ12/12 |
| 6 | a16c34 | 00:44:16 | 63303 | 9 | Đủ12/12 |
| 7 | ab55c5 | 00:45:35 | 55975 | 9 | Đủ12/12 |
| 8 | 347770 | 00:45:49 | **140973** | 0 | Auth chưa vào workspace; trang cuối marketing |
| 9 | 48bbb9 | 00:46:00 | 50349 | 9 | task_list invalid; error00:47:30 |
| 10 | b31c45 | 00:47:12 | 56726 | 9 | task_list invalid; error00:48:56 |

Tổng647log:588INFO/45SUCCESS/11WARNING/3ERROR. Không thấy auth tăng dần đều: account9 nhanh hơn các account trước. Browser launch khoảng3.8–5.3s; cleanup khoảng0.8–1.9s. Cả48proxy lease rows có released_at (unreleased0); đây là DB ownership, không phải đo OS process/remote browser tuyệt đối.

**Hai lỗi task_list:**

- Account9: action cuối accepted00:47:21.950; list log00:47:23.876: valid=false,err_no=0,msg=success; hydrate rồi error00:47:30.519.
- Account10: action cuối accepted00:48:49.140; list log00:48:50.825 tương tự; error00:48:56.598.
- Mỗi account còn **9unsettled proofs được lưu**, receipt0. Không mất proof; không đánh dấu done từ ack đơn lẻ hoặc xóa/replay mutations để né lỗi.

**Account8:**

- OTP nhận sau1s, code được điền;00:46:25 log “Đã gửi mã xác minh”.
- Auth kết thúc00:48:14.762 với generic “Có thể mã sai, bị captcha, hoặc email bị chặn”.
- `debug/019_dang_ky_chua_hoan_tat.png/html` là homepage “AI-Powered Photo & Video Editor for Everyone”, không OTP/DOB/captcha input. Không chứng minh mã sai/captcha. FinalURL transition/HTTP/auth status/tab selection chưa được ghi nên root cause upstream còn mở.

## 3. Finding ưu tiên — source đã xác nhận

### LR01 — P1/build blocker: overlay nuốt typed timeout và còn raw wait không hủy được

`src/main/services/capcut/overlays.ts:83,117,143`; raw DOB/onboarding reads ở signup.ts332–333/502/520.

Dirty catch143 chỉ gọi signal.throwIfAborted, bỏ error. Typecheck/lint cùngfail unusederror; quan trọng hơn, **DomReadTimeoutError bị nuốt và thực hiện Skip tiếp**.

Actual-function probe: typed timeout →2Skip clicks,3reads, functiontrue. Pending mask.count → Stop20ms vẫn unsettled. Các inputwait login/signup từng báo trước đã được sửa, không yêu cầu làm lại.

Probe kiểm thêm: innerbrowser condition4000ms trả TimeoutError sau4030ms do channeloverhead; nếu chỉ đổi outercatch thành rethrow thì host4000ms thắng và tạo DOM_READ_TIMEOUT giả (~4010ms), dù ordinarywait sắpsettle. Vì vậy R01 phải tách conditiontimeout4000ms và hostwatchdog6000ms, convert chỉ settledbrowserTimeoutError thànhfalse bên trongread, propagate typedtimeout/abort/errorkhác. Không rename _error hay rethrow-only để buildxanh; không tăngmaxSteps/pacing.

### LR02 — P1/diagnosis blocker: task_list lỗi bị xóa mất lý do nên hai account cuối không thể được sửa đúng nguyên nhân

`httpTasks.ts::validateTaskRows:68`, `fetchTaskList:301–382`, hai returnfatal tại464/585; `CapcutEngineService.ts:384–390`.

Parser bỏ cả tập với nhiều nguyên nhân nhưng chỉ trả validfalse; httpStatus không được ghi log; bodyshape/rowindex không được giữ; final retryresponse không có diagnostic; engine thay fatalError bằng generic TaskEvidenceError.

Probe actual executeHttpTasks với9ackshealthy:

~~~json
{"case":"missing-array","actions":9,"fatal":"TASK_LIST_RESPONSE_INVALID","unsettled":9,"returnedErrorKeys":[],"diagnosticLogs":[]}
{"case":"invalid-task-id","actions":9,"fatal":"TASK_LIST_RESPONSE_INVALID","unsettled":9,"returnedErrorKeys":[],"diagnosticLogs":[]}
~~~

Hai nguyên nhân khác nhau cho một output vô nghĩa giống runtime. **Chặn invalid snapshot là đúng**, lỗi là mất classification/evidence. Không nới schema để biến malformed thành success. R02 thêm bounded safe category/status/shape/row-field vào mỗi existing list attempt và preserve tới engine. Sau đó chỉ patch dạng upstream được xác nhận; chưa có rejected payload thì không invent fieldcoercion/newendpoint/retry.

### LR03 — P2: modal tính năng bị gọi nhầm survey, tạo warning/dump lặp ở cả account thành công

`overlays.ts::isSurveyBlocking:83` đếm mọi visiblemask rồi tìm globalSkip tại116. `signup.ts::dismissOnboarding` gọi helper lặp.

HTML017/018 có My projects,1visiblemask,`.operation-features-modal`, nút **Got it**, **không Skip**. HTML001 từ00:43 đã tương tự. 9account đã vào workspace đều có2warning này; không phải chỉ các lượt cuối.

R04: classify theo chính wrapper/owned controls; survey helper chỉ xác nhận survey cleared, không đại diện allpage. Dismiss modalfeature bằng exact owned Gotit tại existing onboarding path, verify đúng wrapperclosed; không broadclick mọi close/pricingbutton. Không thêm UI/product gate vào do_action.

### LR04 — P2: DOB vẫn global-first matching option, fixture che mất owner scope

`signup.ts:363–366,395–398`; `signupBirthday.test.ts:80`.

Đổi nth thành filter(...).first chưa scope active dropdown. Hiddenmatchingoption trước visiblematchingoption → OPTION_MISSING. Probe: hiddenJuly + activeJuly → monthoptionmissing, visibleclicked0. Fake options tự chọn state.open dù production hỏi global nên test xanh.

R05: active-dropdown ownership + uniquematch + existingreadback; fixtureglobal trả toàn active/inactiveoptions. Production1990–2004 còn chưa được user chốt; giữ policyopen, không làm nó thành nguyên nhân3lỗithật khi không có evidenceDOBfailure.

### LR05 — P2: Start ownership mất qua dispose/attach

`dashboardController.ts:670–679,820`.

savepending→Start1→dispose/attach→Start2→saveack → **2run.start IPC**. Oldfinally còn isSubmitting=false khi Start2pending. Main admission chặn concurrentruns, nên đây là double dispatch/UIownership, **không bằng chứng2run cùng thực thi**.

R06: giữ pendingStart xuyên replay, release theo promiseidentity; guard publication bằng generation, settle ownedpromise. Same-lifecycle Start/pinnedsnapshot patches đã cải thiện.

### LR06 — P2: Dashboard xóa cả fresh SQL history sau reset và làm mất live push khi load

`dashboardController.ts:579–585,727`.

reset5→freshSQLnosequence→load →[]; liveseq6 tới trong pendingload→SQL[] →[].
Repository không persist streamSequence; epoch mới chỉ phân biệt responseold, không được đòi sequence ở freshSQL.

R06: accept freshSQL trong currentepoch, merge bufferedcurrentpushes/dedup/cap; resettriggerfencedreload. Không gọi rendererdelete.

### LR07 — P2: Clear reply xóa history vừa reload sau event

`Logs/logsController.ts::finishClear:439`.

Clearpending→onReset5→freshSQLnew-db hiện →Clearsuccessreply5 →[]. Event đã ápreset nhưng replyvẫn publishclearSurvivors thay canonicalrows.

R06: same/oldercutoffreply settle operation, không replace authoritativefreshhistory; giữ oldClearfailure/newreset protection đã sửa.

### LR08 — P2: Settings Save kẹt mãi sau replay trong lúc save

`Settings/settingsController.ts::save:339,453`, load219/dispose477.

savepending→dispose→load→saveack/refresh →loadingfalse, **isSavingtrue**, nextsavefalse.
Generation fence ngăn staleoverwrite đúng nhưng bỏ qua giải phóng busyowner.

R07: operation latch settle độc lập UIgeneration, clearbusy chỉ đúng owner; giữ draft/leafmerge/bootepoch đã sửa. Không bỏ generationguard để xử lý.

### LR09 — P2: run2 preflight thất bại nhưng waitForCompletion trả summaryrun1

`AutomationRunService.start:2617–2663`, `waitForCompletion:2938–2943`.

Actualsame-service: run1completed→run2source.preparethrow; currentprogressrun2failed/blocked nhưng waitForCompletionrun1completed. lastSummary không reset/update trên nhánhfailedpreflight.
R08: chỉ reset sau admissionaccepted, chụp summarycurrentfailedattempt trước throw; không clearowner của runđangchạy khi concurrentStartrejected. Đây là repeated-run consumerbug, không nguyên nhân3lỗitrongcùngrun. Rendererproduction dùnggetProgress.

### LR10 — P2: account-total timing ghi success cho account error

`AutomationRunService.ts:2253–2368`, `stageTiming.ts::measureStage`.

Cả3failedaccount thật đều `stage=account-total ... outcome=success`. MeasureStage đo promise.resolve, trongkhi worker đã catch và ghi failedoutcome. CounterDB đúng, label không phân biệt operation/account.

R08: riêng callbackaccounttotal dùng operationOutcome + accountOutcome + persisted; không ném errorgiả, tăngcounter hoặc retry chỉ để đổi log.

### LR11 — P2/legacy-only: malformed task row bị filter bỏ rồi chấp nhận phần còn lại

`taskApi.ts::parseTaskList:57`.

Envelopeerr0 với goodrow+null/badrow vẫn return snapshot. Prior nonzero-envelope rejection đã sửa đúng. R09 reject wholemalformedlist; không đổi default httpTasks. Không gắn lỗi này với incident hiện tại.

## 4. Những gì đã kiểm để tránh kết luận sai về “càng chạy càng lỗi”

Actualservice deterministic simulations (inmemory,3workers):10/100/500accounts đều completed, resourcesownedprofiles/routes/mail=0, runtimethreads/schedulers/owners/abortcontrollers=0. sessionSequences3keys; startedProfilesN là lịch sử, không bằng chứng leak10account.

Renderer10000pushes: Dashboard300rows, Logs1000rows/unconfirmed1000, pending0. Không có bằng chứng lưu mọilog vô hạn ở renderer.

1000progresspushes khi mỗi read đãsettle vẫn gây1001accountlistreads+2000publications. Đây là **pressure candidate**, chưa đo gây lỗi thật. Không tự throttle/refactor query trong incidentfix nếu không có latencymeasurement.

LogBus outage20k×1KiB giữ20000pending(~23.18MBserialized),1writeattempt theo throttle. Đây là tradeoff no-drop đã chọn, không lỗi mới cần “fix” bằng mấtlog. LatestDB647logs không thấy outageevidence. TelemetryappendFileSync có thểcostI/O nhưng không có in-memoryeventarray; không quy kếtcausal.

## 5. Trạng thái fix trước sau dirty Antigravity patches

| Phần trước | Current review |
|---|---|
| AG01 terminalpersistence | Các observer/priorintent/firstcause/cleanup variants đã probeđạt |
| AG02/03 same-lifecycle save/start | Có boundedqueue/pinnedsnapshot; replay vẫn LR05 |
| AG04 Dashboard config/progress hydrate | Đã thêm edit/load/pushepoch; logmerge LR06 |
| AG05 reset | Oldresponses fence cải thiện; LR06/LR07 mới |
| AG06/07 Settings | Reactivateload/leafmerge/preservedrafts đã có |
| AG08 Settings | Pagebootepoch/refreshwarning có; savebusy LR08 |
| AG09 DOB | Readback/semanticlabel/helpervalidation có; LR04/policycònopen |
| AG10 authwaits | Các input/heading/submit chính cải thiện; LR01rawoverlay/timeoutvariant |
| AG11 terms | Initialuncertainty toggle đã sửa |
| AG12 Accountsparentcallback | useCallback đã có, không yêu cầu fixlại |
| AG13 Lognotice | Hook và productionwiring đã có |
| AG14 legacy startup | workspaceRoot đã khôi phục |
| AG15 legacy envelope | Err_no nonzero/missing/string đã chặn; LR11malformedrowvariant |
| F14 testtruth | Timer/enteredmarker/termsdynamic đã cải thiện; birthdayglobalscope, termshappycatch, surveypreabort/mountedcoveragecònthiếu |

## 6. Verification của lượt này

| Check | Kết quả |
|---|---|
| npm run typecheck | **FAIL** TS6133 overlays.ts143 unusederror |
| npm run lint | **FAIL** cùngerror unusedargument |
| Focused Vitest11files | **420tests PASS**,4.05s; không phủ các repro mới |
| Actual-function/controller probes | LR01/02/04–09 có output mô tả trên |
| Read-only latest runtime |10accounts/647logs/18unsettledproofs/0unreleasedproxyleases |
| Full suite/build/GUI/vendorlive | Không chạy lượt này; typecheck hiệnfail, không tuyên bố buildPASS |
| NativeABI | better-sqlite3 vẫn ElectronABI133; chưa rebuild. NodeDBtest mismatch137 là environment, không sourcefinding |

Focusedcommand:

~~~powershell
node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/httpTasks.test.ts src/main/services/capcut/__tests__/authCancellation.test.ts src/main/services/capcut/__tests__/signupTerms.test.ts src/main/services/capcut/__tests__/signupBirthday.test.ts src/main/services/capcut/__tests__/trial.test.ts src/main/services/capcut/__tests__/taskApi.test.ts src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/renderer/pages/Settings/__tests__/settingsController.test.ts src/renderer/pages/Logs/__tests__/logsController.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/deterministicHarnessOracle.test.ts --maxWorkers=4
~~~

Đây không phải claimfix. Không chép rawprivateHTML/screenshot vào repo; chỉ lưu mô tả cấu trúc/aggregates. Lượt kiểm tra không xóa hoặc sửa credential/account/proof/source.

## 7. Điều kiện để đóng incident

1. R01compile/timeout phảiđạt.
2. R02 ghi được reason thật của rejectedtasklist trên **existing**reads; không mất9proofs. Có cause rồi mới chọn parserfix phù hợp; chưa có cause thì I01open.
3. R03 ghi finalauthpage/sessionclassification và bảo toàn evidence sauOTP; homepage không tự kết luậncaptcha/emailblocked. I02open đến khi có branchrepro/correctfix.
4. R04/R05/R06–R09 đóng bugs đãrepro, không làm lại patchesđúng.
5. R10 single-run+repeated-run+realpagefixture soak; nếu live cần purchase/trial thì xin quyền riêng, không tự chạy.

## 8. Các file thay đổi và kiểm tra bàn giao

Kiểm tra cuối: 449 source/script/test hashes không thay đổi so với snapshot review currentdirty. Lượt này chỉ thêm report và cập nhật3tài liệu bàn giao. 11local links tồn tại,14codeblocks kiểm cú pháp,52acceptancecriteria đều map vào10tasks; git diff --check PASS. Các snippet là kế hoạch chưa triển khai, không được tính là regressiontests đã thêm.

37file thay đổi/mới so với review trước:

| File | SHA-256 currentdirty |
|---|---|
| `scripts/__tests__/legacy-diagnostics.test.mjs` | `acb83b2b75fa87fc1ec355cb2b3d18995b73fd600b7c6c8b7ea7412bafc22b33` |
| `scripts/__tests__/live-capcut-options.test.mjs` | `d852b0cafcad8a48f30536e0380cdf47dcb05bcb9375f7b45811b5c32e4f72a4` |
| `scripts/bugfix-ui/fixture.tsx` | `3c1148aa55e22aea50e7621cab2d954c7fd37397c7abdad47360bb0f8c4427ae` |
| `scripts/check-bugfix-ui.mjs` | `8f40b71db114d6ddc5f0e4f74d0695ce05049c7e6e2c4229673c488ab6268e99` |
| `scripts/live-capcut-options.mjs` | `ffdf631a8d5cbb28fb073df8490e15cb342f1b2515bd92543cd229539fbbe722` |
| `scripts/live-onboarding-probe.cjs` | `c9c8105da0d698245d16d5b9080c484db759f72d5c30d31a106a8a4a8949491b` |
| `src/main/repositories/__tests__/repositories.test.ts` | `fe5895f2170d8172a5dc4326683d900028536038e5005a91db84ac8f14b1bbfa` |
| `src/main/runtime/providerStack.ts` | `93fb5a78b61baa7ed9d8a1d2e57e79a5567b5a8e0c3a19315c086ad60f3344a6` |
| `src/main/services/AutomationRunService.ts` | `abeaf3cb3b9fd33b0cd549244019aabfc338dfdfa9c46530255e22af1730fc97` |
| `src/main/services/LogBus.ts` | `7c805c5b8cf8ee3eb5c0b78a33eca2c50747acb893cdc85db223feecbc6dc7a2` |
| `src/main/services/__tests__/AutomationRunService.test.ts` | `4407d7f3167fb7494aeb848f211cc33b8ef83f46fd5ee41e56f380452595e73b` |
| `src/main/services/__tests__/LogBus.test.ts` | `cc97a8b35f6a337a332f4c6429b6c413720646e898c56469dc49ff34f1be879d` |
| `src/main/services/__tests__/MultiloginAuthService.test.ts` | `1f6f5546d8ed464c23d63117fc6e5a1f042d4b1a41c53b1b4ea66bb1888982dd` |
| `src/main/services/__tests__/deterministicHarnessOracle.test.ts` | `684be505d869b8130763e381a857bd0370d6982afee9d08fd716ef65ed2b0d3a` |
| `src/main/services/__tests__/fixtures/deterministicRunHarness.ts` | `9d3b1f64e6b5f51b7d8e4ff2582455664edcf8ed4351f17ab1d29881b3718236` |
| `src/main/services/capcut/__tests__/authCancellation.test.ts` | `17ccd6d3ce023edd716fc3b7676a02b6d5d10f19791110ab84f7772876431cb1` |
| `src/main/services/capcut/__tests__/birthday.test.ts` | `962fd6f1a846ec513dc1df99445989886307dc6cb1811a212101431bbabb9970` |
| `src/main/services/capcut/__tests__/claimReconciliation.test.ts` | `14c06badc80ac9f6c06990efe862eddcd22858773718433e1c2263152ace9f65` |
| `src/main/services/capcut/__tests__/signupBirthday.test.ts` | `5d15755a2211de0b97c0c9a015d7e5a02393c089d6e5394d39f0eb0cc59fc09a` |
| `src/main/services/capcut/__tests__/signupTerms.test.ts` | `ef9a399ffdd05b2cf3e99bed3aace869ca65c0f068862f8dc6eb5947313195d7` |
| `src/main/services/capcut/__tests__/taskApi.test.ts` | `3c79c9ba7521bc32b3fff14a58a479188316872bd0bf63b94f6be9f73b5dc594` |
| `src/main/services/capcut/__tests__/trial.test.ts` | `82347ac7bf17f652db7556ed41c2356ced1af109230f57e25599906370227b23` |
| `src/main/services/capcut/birthday.ts` | `f290b936eafc87cce498c2262747ec81bc3d2c73ec73869b4837a4625b959f74` |
| `src/main/services/capcut/login.ts` | `bc65b3f15a82784dfd5a2ec400f5f73f10efb739ba59dd6340d9617d436ae520` |
| `src/main/services/capcut/overlays.ts` | `8b2d60892a7a424aefca1516d89c4f07a35adff7205633c6452eacc05fdc2f5b` |
| `src/main/services/capcut/signup.ts` | `ebeceb9351e9868fa6c1ecd69245469a9db7db92d4b1625e21e6dbf00a4ea880` |
| `src/main/services/capcut/taskApi.ts` | `45710e9fb094125e9201ec0dc8d5aaa542c39035a75c59465254c1c7f94dbe38` |
| `src/renderer/pages/Accounts/AccountsPage.tsx` | `21c2ac73efbd82a37fb84713ac649a4a5419dcb6b884609758e61ad1f120d4c2` |
| `src/renderer/pages/Dashboard/DashboardActionBar.tsx` | `333e5ff4d5214cf3971c84f76e67e250411ea9925c59ebed9a57d83af5b97b21` |
| `src/renderer/pages/Dashboard/DashboardPage.tsx` | `e277383ff2d307642b76d7efba80954b6110dadd1423d1ffe82ac3d85b57fc73` |
| `src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts` | `cc692b78c2f949741ed4f8cd4ec6d94bb5d7af467cea681127dec3dc2479d02e` |
| `src/renderer/pages/Dashboard/dashboardController.ts` | `7105abe41bfba90e9cd00e2486ceca11859ab90898307134e046aafec8227c58` |
| `src/renderer/pages/Logs/__tests__/logsController.test.ts` | `eb87cfcfbf61fa94ff99a4ac730def1504bdc79055aaf8671092cf24afbd3f87` |
| `src/renderer/pages/Logs/logsController.ts` | `8a531f4ffa639ef6267f69206ec9fde1317a674ad2ba21cab51974218409927c` |
| `src/renderer/pages/Settings/SettingsPage.tsx` | `2f30468ce51c56f4cf2e8125f6e3544cb0cbbefa52ad23e54ae340816b544986` |
| `src/renderer/pages/Settings/__tests__/settingsController.test.ts` | `776cf79b68767765fb426087a281dcacd166ffd8a955050865a303f3faa1e9f5` |
| `src/renderer/pages/Settings/settingsController.ts` | `cdde66d8d4f07a27c4be5a57dee74f8b9d0c03d1e6e4b6f52737b0525e10c388` |
