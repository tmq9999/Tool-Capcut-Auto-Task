# Antigravity Runbook — Remaining Bugs G01–G12

**Ngày:**15/09/2026. **Baseline:** HEAD3bb6b72 + dirty pasted-existing implementation.
**Đọc trước:** [Report](../reports/2026-09-15-antigravity-project-review.md), [Spec](../specs/2026-09-10-tool-bugfix-spec.md), [Plan](2026-09-10-tool-bugfix-plan.md), [Coverage](../reports/2026-09-15-antigravity-review-coverage.md).

## Lệnh giao Antigravity

> Đọc AGENTS.md và Superpowers using-superpowers → systematic-debugging → test-driven-development/executing-plans; triển khai plan G01–G12 từng task. Giữ những fix paste đã đạt, không làm lại feature từ đầu. Mỗi bug cần regression RED đúng symptom, minimal fix, GREEN và review code. Không đổi do_action/transport/trial gate/restock hoặc cách hiển thị plaintext Dashboard. Không live purchase/signup/trial, reset dữ liệu, auto-release retained resources, commit/push/deploy khi chưa có quyền. Kết thúc bằng bảng task→file→test→exit→giới hạn, không chỉ ghi “all tests passed”.

## 0. Preflight an toàn

- [ ] Đọc spec và cả giới hạn exposure trong report. F05/F09 có direct/deferred-contract cases, không đánh đồng default Dashboard hỏng toàn bộ.
- [ ] Ghi status/hash trước sửa. Dirty files của Antigravity/user không reset/checkout, không restore “bản cũ”.
- [ ] Một owner cho AutomationRunService; G01→G05→G07→G08 serialize cùngfile. Auth/DOB cùng owner tránh collision. G12 owns UIharness. Một owner native addon.
- [ ] Kiểm process nếu cần rebuild; không kill tool của người dùng. Nếu app đang chạy, yêu cầu đóng bình thường trước khi thay native module.

~~~powershell
Set-Location -LiteralPath 'D:\GeminiWorkspaceNew\ToolCapCut'
git status --short
git rev-parse HEAD
git diff --stat
git diff --check
node -p "JSON.stringify({node:process.version,abi:process.versions.modules})"
~~~

Baseline đã chạy lượt review:2377tests/175files PASS, typecheck/lint/build PASS, selectors95PASS, panelharness7PASS, isolatedElectronPASS35.7.5/ABI133. Đây là điểm so sánh, không thay REDtest mới.

## 1. Chia đợt triển khai

| Đợt | Task | Exit gate |
|---|---|---|
| A: chặn lỗi auth/đọc UI | G02,G03,G04 | Same-document/visibleowner/Stop đúng, no foreignclick/no trialactivation |
| B: Start/paste/proxy | G01,G05 | Main admission invalidsideeffects0, repeat preflight fresh config, pasted2run reuse |
| C: logging/proof/cleanup | G06,G07,G08 | No observerthrow escape, durablewrite drain, failedvsstopped đúng, frozenstopcause |
| D: UI mutation/race | G09,G10,G11 | Stale replies không sửa currentstate, exactsecret, retryfeedback đúng |
| E: tích hợp | G12 | Actual pages + DB/auth/tail oracle + fullgates |

Đợt A/B/C/D độc lập theo file ownership; không phải yêu cầu release từng đợt. Không tách thêm frameworks/subprojects cho sửa nhỏ.

Mỗi task:

1. Viết regression với input/event ordering tái hiện report.
2. Chạy focusedfile; ghi assertion fail, không tính compileerror/missingmock là RED.
3. Sửa minimal boundary trong plan.
4. Chạy focusedfile + compatible neighbors, typecheck/lint.
5. Reviewer đọc diff, đối chiếu AC; sửa inline nếu thiếu.
6. Sau task cuối mới fullgates; không sửa expectation để che regression.

## 2. Matrix nghiệm thu bắt buộc

| Case | Kích hoạt | Expected |
|---|---|---|
| R01 | Hidden first auth input + visible authpanel + workspace | Not authenticated; no signup fallback/newmission |
| R02 | External/same-URL navigation during authread | Oldfacts rejected, no listener/handle leak |
| R03 | Stop after trial evaluate entered / evaluate never settles | Originalabort / typeddeadline, no lateeligible |
| R04 | HiddenPro7 before currentPro3 | Reads3 from activeowner, rule days>=7 unchanged |
| R05 | DOB absentaria-controls + unrelatedJune panel | Foreignclick0, Continue0, OWNER_MISSING |
| R06 | Nonblank malformed line3 | Only MISSING_SEPARATOR line3, no EMPTY_INPUT |
| R07 | Direct pasted + forbiddenpolicy | Reject before any source/provider/account/reset mutation |
| R08 | AUTHpreflightfail→save tokenNEW→sameStart | Newmanager tokenNEW, no restart app requirement |
| R09 | Capacity1→add providerkey→Start2threads | Fresh listKeys, capacity2 |
| R10 | Log subscriberthrow first | Otherlistener receives, emit returns, flush attempted |
| R11 | TaskEvidenceError fallbackwritefail + cleanupabort | Owningaccountfailed, purepeersstopped |
| R12 | Latecheckpoint after invocation/owner retirement | No DB write or memo mutation |
| R13 | BatchAwritefail/Bpending | AwaitB settle before owner retirement; primarycause retained |
| R14 | Settledcheckpoint→sameversionfallback | No pending reinsertion; newversion still recorded |
| R15 | Stoplocked then latereject | Cause/phase/remoteConfirmed/counters/resources unchanged |
| R16 | Logs readnew then oldreply, seq12SQLnoseq→reset10 | New data/sequence survive; no resurrection after detachedClear |
| R17 | OldClear10 success after reset20/newreaderror | New rows/error/loading preserved |
| R18 | Accounts Add/Edit password edge spaces/pipes | Exact bytes saved in create/replace; keep semantics intact |
| R19 | Accounts create/update/delete IPC reject | Errorvisible, input/selection retained, no unhandled/duplicate mutation |
| R20 | Commit succeeds, listreloadfails | Commit remains true + refreshwarning; no mutationretry |
| R21 | Settings testA→edit/testB→Bfail→lateAok | B result current, Aignored; no save |
| R22 | Real Dashboard validpaste→Start & doubleclick | Exact peraccount payload, one dispatch |
| R23 | Startsavepending→edit | Originalclicked snapshot used; newedit retained |
| R24 | Same runtime+SQLite paste two consecutive runs | SameIDs, no duplicaterows, knownsecret unchanged, purchase/OTP/signup0 |
| R25 | Bad RecoveryLoginError + healthy peer | Onefailed/onecompleted, no signup/OTP |
| R26 | V08 wave2 faults with actualHTTP+SQLite |13proofs,3completed/1failed/2stopped, exactretainedresources,noafterabortdispatch |

Matrix cases correspond to plan tasks, not new business rules. Structured fixtures must use ownervalidity, not helpers that hand back the expected owner automatically.

## 3. Node native addon / focused tests

Không chạy npm test một cách mù: script có rebuild giữa2runtimes. Rebuild và restore có owner rõ. Khi safe appclosed:

~~~powershell
npm run rebuild:node
~~~

Nếu EALLOWSCRIPTS do inherited npm_config_allow_scripts, chỉ bỏ key đó trong **child environment**, không đổi npm policy global:

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const testEnv={...process.env};for(const k of Object.keys(testEnv))if(k.toLowerCase()==='npm_config_allow_scripts')delete testEnv[k];const r=spawnSync(process.execPath,['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','rebuild','better-sqlite3'],{env:testEnv,stdio:'inherit'});process.exit(r.status??1);"
~~~

Focused paths giữ đúng case repo:

~~~powershell
node node_modules/vitest/vitest.mjs run src/shared/schemas/__tests__/pasted-capcut.schema.test.ts src/shared/schemas/__tests__/automation.schema.test.ts src/main/services/__tests__/pastedCapcutIntegration.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/authState.test.ts src/main/services/capcut/__tests__/auth.test.ts src/main/services/capcut/__tests__/authCancellation.test.ts src/main/services/capcut/__tests__/signupBirthday.test.ts src/main/services/capcut/__tests__/trial.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/main/services/__tests__/LazyProxyLeaseSource.test.ts src/main/services/__tests__/ProxyLeaseManager.test.ts src/main/services/__tests__/LogBus.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/AutomationRunService.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/renderer/pages/Logs/__tests__/logsController.test.ts src/renderer/pages/Accounts/__tests__/accountsController.test.ts src/renderer/pages/Settings/__tests__/settingsController.test.ts --maxWorkers=4
~~~

Chạy từng command, kiểm exit ngay. Không tiếp tục rồi lấy exitcode lệnh cuối che lỗi lệnh trước. Nếu sandbox cấm process/network, xin approval đúng tool, không đổi tests cho qua.

## 4. Full verification cuối

~~~powershell
npm run typecheck
npm run lint
node node_modules/vitest/vitest.mjs run --maxWorkers=4
npm run build
npm run selectors
git diff --check
~~~

Mỗi command phải exit0. Newregressions nằm trong fullsuite, không chỉ probe ngoàirepo. Warningbundle569.98kB là baseline buildwarning, không tự thêm performance refactor nếu chưa profiling.

Restore Electron **dù test thất bại** trước khi bàn giao workspace cho người dùng:

~~~powershell
npx --no-install electron-rebuild -f -w better-sqlite3
~~~

Rồi hidden mounted harness (DEMOlocalhost, no providers):

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['scripts/check-bugfix-ui.mjs'],{windowsHide:true,timeout:55000,stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??1);"
~~~

G12 sẽ thêm scenarios; nếu timeout55s không đủ vì có nhiều legitimate localcases, tách deterministic harness cases, không nới vô hạn. Testtimeout phải cleanup ownedElectron/server. PASS 7sequences hiện tại chỉ panel+Export/Task/Edit; không đủ nghiệm thu Start.

Isolated builtpreload/SQLite Electron harness:

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const e={...process.env};delete e.ELECTRON_RUN_AS_NODE;delete e.NODE_OPTIONS;delete e.VITE_DEV_SERVER_URL;const p=require('node:path').resolve('.debug','verify-'+require('node:crypto').randomUUID());const r=spawnSync(require('electron'),['scripts/run-electron-harness.cjs','--user-data-dir='+p],{env:e,windowsHide:true,timeout:45000,stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??1);"
~~~

No userData thật. Verify35.7.5/ABI133 addon hoạt động với version cài trong lockfile, không pin khác để “fix”. Sau harness, nếu xóa profiletạm: resolve absolute exact generated path, xác nhận dưới .debug/temp intendeddir; không recursive delete .debug/root. Không broadkill mọi Electron.

## 5. Kiểm tra live — chỉ sau khi được cấp quyền riêng

Lượt bàn giao này **không có quyền live**. Không chạy scripts/live-*, mua mailbox, activate trial, hoặc login/push do_action thật để làm “smoke”.

Khi người dùng cấp account/quyền:

1. Ghi chính xác source/buildhash, transport, sốrows/concurrency; không suy binarycũ nếu chưa đo.
2. Dùng pastedexisting1account được duyệt rồi2account distinctpassword; no OTP/purchase/signup. Quan sát dùng đúng ID/password policy, không in secret vào evidence.
3. Kiểm existing trial gate/do_action ordering không đổi. Stop đúng lúc trial read và nearfinalclaim để kiểm cancellation, no blindreplay.
4. Chỉ mở batch tail lớn sau smallrun clean với resource oracle rõ; log runId/worker/session aliases/proofcounts/timing. Không tăngthreads để bù lỗi.
5. Nếu retainedprofile/lease: giữ quyền sở hữu, report exact IDs/phase. Không auto-release/proxyreuse khi stopunknown; xin thao tác operator cụ thể.

Không live-evidence thì trạng thái là “offline verified, live pending”, không “đã hết bug”.

## 6. Dừng/rollback khi gate fail

- RED test fail đúngbug: tiếp tục minimalfix. Compileerror/missinghelper: sửa fixture trước, không ghi “bugreproduced”.
- Regression ngoài scope: lưu failure/sourcehash, trace nguyên nhân; không checkout cảproject hoặc vô hiệu test.
- Proof/account persistence fail: account/run failurecause ưu tiên đúng, drain ownedwrites; không rerun do_action để bù DB.
- Cleanupdeadline: stop frozen cause; giữ profile/proxy; không tự bật lại Start bằng clearowner.
- UIharness fail: capture DEMO pageerror/sequence, sửa actual parent/controller/bridge path; không đổi sang renderToStaticMarkup để lấy PASS.
- Native mismatch: rebuild đúngruntime rồi verify. Không khuyên dùng bảnexe cũ khi chưa có evidence.
- Nếu cần rollback patch, chỉ reverse đúng hunks do executor vừa sửa sau review; preserve dirty baseline/data. Không git reset --hard, không database rollback tự động.
- DOB range chưa được duyệt: owner/random/readbackfix vẫn triển khai; chỉ ghi WAITING-DOB-POLICY cho thay đổi range.

## 7. Bàn giao kết quả

Antigravity trả cùng bộ docs hiện hành, cập nhật trực tiếp checklist/verification; không tạo chuỗi “đính chính”.

Báo cáo tối thiểu:

| Task | Source files | Regression / RED symptom | GREEN command + exit | Remaining limitation |
|---|---|---|---|---|
| G01–G12 | Liệt kê đúng files đã sửa cho từng task | Assertion và ordering cụ thể | Sốtests + duration/exit | Contract-only/livepending nếu có |

- Hash before/after và gitstatus; phân biệt dirtychanges có sẵn với hunks executor.
- Exact counts accepted/completed/failed/stopped/retained và proofversions của tailfixture, không chỉ “10accounts passed”.
- Actual Dashboard Start payload assertions và Settings/Accounts UI evidence với DEMO.
- Nativeaddon restored+Electron verification.
- Không claim scenario chưa chạy; không đánh dấu taskclosed nếu chỉ source tồn tại hoặc test stub che callchain.
