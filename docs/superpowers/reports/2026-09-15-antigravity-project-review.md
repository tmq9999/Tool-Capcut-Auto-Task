# Review Antigravity và lỗi còn tồn đọng — 15/09/2026

## Kết luận

Còn **15 nhóm lỗi code/contract và 1 nhóm thiếu kiểm chứng**. Không phải toàn bộ lỗi là regression của bản paste: phần lớn là nhánh cũ chưa được phủ bởi test. Không có bằng chứng để quy tất cả lỗi chạy thật về một nguyên nhân duy nhất.

**Bản paste mới đã sửa đúng phần cốt lõi:** source riêng, password từng dòng giữ nguyên, existing-only auth, không OTP/mua mailbox, reuse local account và tính capacity sau finite queue. Không làm lại M01–M06 từ đầu.

Bàn giao hiện hành: [Spec](../specs/2026-09-10-tool-bugfix-spec.md), [Plan G01–G12](../plans/2026-09-10-tool-bugfix-plan.md), [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md). Lượt này chỉ review, kiểm chứng và viết tài liệu; không sửa application source.

## Baseline và độ phủ thực tế

- HEAD **3bb6b72**, version3.0.3, cộng dirty implementation Antigravity. Không dùng tag/commit message thay cho kiểm tra source.
- Inventory457file JS/TS trong src/scripts/tools; **21file thay đổi/mới** so với snapshot454file của [audit paste](2026-09-14-manual-capcut-paste-review.md). Hash delta và inventory nằm trong [coverage](2026-09-15-antigravity-review-coverage.md).
- Đọc toàn bộ changed implementation và tests liên quan; trace production wiring, chạy full suite, kiểm tra sâu auth/trial/DOB, task checkpoint, worker/stop, proxy preflight, Dashboard/Accounts/Logs/Settings/IPC/repositories.
- Unchanged domains được đối chiếu với [full-file audit trước](2026-09-10-full-file-audit-coverage.md) và kiểm tra hồi quy. Đây **không phải tuyên bố vừa chạy mọi branch của457file**. Legacy HTTP-only/scripts và provider thật không được E2E live trong lượt này; không chạy Go bridge tests/build installer, inventory457 chỉ tính JS/TS.
- Không đọc DB/credential của người dùng trong lượt này, không có log phiên thật mới để đối chiếu thời điểm. Những kết quả dưới đây là source/probe offline, không phải lời khẳng định về nguyên nhân một account thật.

## Phần Antigravity đã sửa đúng

| Hạng mục cũ | Kết quả hiện tại |
|---|---|
| MP01 sai source/auth | UI manual → pasted-existing; runtime existing-only, isNewAccount=false, getOtp absent |
| MP02 cắt/ghi nhầm password | First-pipe parser giữ toàn bộ phần sau dấu phân cách; không đưa thành emailPassword |
| MP03 validation | Main schema và UI có validation; còn F04/F05 ở nhánh biên |
| MP04 duplicate | Same normalized email+same exact password dedup; conflicting passwords chặn batch trước resource |
| MP05 global password chặn paste | Manual gửi per-account, global custom/random không chi phối |
| MP06 capacity | prepare pasted source trước direct/proxykey capacity; 10threads/2rows dùng2slots |
| MP07 identity | Lookup readonly; một row thì reuse, không row thì tạo tracking local; không tự đổi secret row cũ |
| MP08 tests | Có6 runtime-seam tests và panel mounted; actual Dashboard Start + repository/auth coverage chưa đủ, F16 |

**Probe độc lập dùng actual factory + runtime + AccountService + SQLite memory, chạy cùng service hai lượt:**

~~~json
{"capacity":[2,2],"failed":[2,2],"rows":2,"sameIds":true,"exact":true,"knownSecretUnchanged":true,"newSecretExact":true,"auths":["existing-only","existing-only","existing-only","existing-only"],"otps":0,"purchases":0,"sourceCreates":2,"prepares":2}
~~~

Runner trong probe cố ý trả lỗi credential DEMO để kiểm reuse ngay cả khi login thất bại; không giả đây là login CapCut thật. Password có khoảng trắng và dấu pipe được giữ nguyên. Real DB service đã được kiểm tra ngoài stub tests.

## Findings và cách sửa tối thiểu

### F01 — P1: auth ghép trạng thái khác document và chỉ đọc phần tử đầu tiên

**Source:** [authState.ts](../../../src/main/services/capcut/authState.ts), readAuthFinalState29–132, selectors53/75/96; callers login/ensureInApp/signup.

URL chỉ được đọc trước ba await. Navigation trong một await vẫn cho kết luận workspace từ URL/DOM cũ. Probe actual function: đang /my-edit → đổi sang external origin trong marker read → hasAuthenticatedWorkspace=true. Ngoài ra hidden first password input che visible auth input phía sau; probe workspace visible, auth matches[hidden,visible] vẫn authenticated=true. Ngược lại hidden workspace marker trước marker thật có thể làm login bị coi thất bại.

**G02:** đọc các facts trong cùng document, fence navigation/document identity; kiểm visible matches đúng owner, không global first. Giữ positive auth-form precedence và unreadable/abort. Không thêm signup fallback hay retry. Không chỉ reread URL vì same-URL document replacement vẫn xảy ra.

### F02 — P1/P2: đọc trial không dừng theo Stop và có thể lấy thẻ Pro ẩn

**Source:** [trial.ts](../../../src/main/services/capcut/trial.ts), READ_TRIAL74, openUpgradeModal157–235, checkProTrial299–323.

- Raw page.evaluate không deadline/AbortSignal; probe abort sau khi evaluate đã entered vẫn pending, late response trả eligible khi signal đã aborted. Đây là nhánh có thể giữ worker lâu hơn các bước bounded khác.
- READ_TRIAL querySelector first Procard toàn document; hidden stale7days đứng trước visible current3days → đọc7. Locator mở modal chỉ kiểm một subscriptionProduct khác, không chứng minh card đã đọc thuộc modal đó.

**G03:** bounded read, rethrow interruption, kiểm signal trước return; scope unique visible Procard vào active pricing wrapper. Giữ nguyên rule days>=7 và skipWithoutTrial; không thêm price/CTA eligibility gate, không activate trial, không đổi sang API. Raw presence/count reads cùng đường phải bounded, không catch timeout thành absence.

### F03 — P2: dropdown DOB “duy nhất” chưa chứng minh thuộc control vừa mở

**Source:** [signup.ts](../../../src/main/services/capcut/signup.ts), selectBirthdayDropdownOption348–369.

Không aria-controls thì nhận sole global visible listbox làm owner. Probe helper thật click vào June thuộc panel unrelated. Readback cuối có thể bắt mismatch nhưng thao tác sai đã xảy ra trước đó.

**G04:** owner phải liên hệ control bằng aria-controls/exact ID, labelled-by hoặc panel newly-opened được xác minh với birthday control. Nếu không đủ evidence: OWNER_MISSING/AMBIGUOUS, không click option/Continue. Giữ semantic selection, readback, lazy random và propagation đã sửa đúng.

Production vẫn dùng range1990–2004 tại handleBirthdayIfPresent; ngày không còn hardcoded một giá trị. Khoảng năm do người dùng chưa chốt: **WAITING-DOB-POLICY**, không tự bịa range mới và không chặn các fix owner khác.

### F04 — P3/P2 boundary: parser báo “trống” sai dòng và normalization không đồng nhất

**Source:** [pasted-capcut.schema.ts](../../../src/shared/schemas/pasted-capcut.schema.ts),30/64/159–160.

~~~json
{"input":"\\n\\nbad-row","issues":[{"line":1,"code":"EMPTY_INPUT"},{"line":3,"code":"MISSING_SEPARATOR"}]}
~~~

UI vì thế báo dòng1 invalid dù lỗi thật ở dòng3. normalize([]) bị ghép thêm EMPTY_INPUT khi nonblank lines đều thiếu separator. Structured entry email có spaces bị normalizer reject, trong khi schema trims và chấp nhận. Exported PastedCapcutSourceSchema cũng chưa có conflict refinement như variant trong AutomationRunConfigSchema.

**G01:** EMPTY_INPUT chỉ cho thật sự không có nonblank input; trim email trước validate/return, giữ password exact. Dùng cùng source validation để không drift. Duplicate/conflict vẫn atomic; không thêm row cap.

### F05 — P2 direct-service boundary: bỏ qua cross-source restrictions của pasted-existing

**Source:** [AutomationRunService.ts](../../../src/main/services/AutomationRunService.ts), start2842, prepareRun2989/3095; [automation.schema.ts](../../../src/shared/schemas/automation.schema.ts), superRefine.

IPC safeParse đúng. Nhưng direct service caller chỉ được check entries, không check password policy/HTTP-only/rollout/budget. Actual-method probe gửi pasted-existing + HTTP-only + budget1 đã vào HTTP-only preflight. Không phải lỗi default Dashboard mapper.

**G01:** validate copied config ở admission cho pasted-existing hoặc per-account trước side effects; invalid trả promise rejection/normal error. Validate structuredline và toàn batch trước mailLimit. Không đổi legacy manual/API/existing behavior hoặc mở thêm transport.

### F06 — P2: sửa proxy token/thêm key rồi Start lại vẫn dùng cache của preflight thất bại

**Source:** [LazyProxyLeaseSource.ts](../../../src/main/services/LazyProxyLeaseSource.ts), configure50, ensureManager61, availableSlots84; [ProxyLeaseManager.ts](../../../src/main/services/ProxyLeaseManager.ts), loadKeys95; runtime3166–3180.

Actual start hai lần, schema-valid configs:
- Token OLD lỗi auth; sửa NEW, giữ keys/region → built=[OLD], requests=[OLD,OLD], cả hai AUTH_ERROR.
- Inventory provider1→2keys sau capacity failure → listCalls=1, cả hai PROXY_CAPACITY_UNAVAILABLE.

Failed preflight không đi runPrepared releaseAll; same configure returns early, manager giữ token/cachedKeys.

**G05:** explicit idle preflight-cache invalidation ở boundary lần Start mới, chỉ khi no owned leases/no acquisition/cleanup idle; preserve manager khi active/failed cleanup. Không gọi releaseAll bừa để đổi token, không auto-release retained routes.

### F07 — P2: listener log ném lỗi làm gián đoạn caller và bỏ qua delivery/flush

**Source:** [LogBus.ts](../../../src/main/services/LogBus.ts), emit125; runtime log948 gọi trực tiếp.

Probe maxBatchSize1, listener đầu throw, listener sau count:

~~~json
{"emitThrows":true,"laterListenerCalls":0,"sinkWrites":0,"pending":1}
~~~

Queue không bị mất ngay, timer/dispose có thể flush; nhưng exception thoát lên automation và người nghe sau không nhận event.

**G06:** isolate từng observer; continue delivery và threshold flush; không ghi lỗi observer qua chính emit gây recursion. Giữ persistence outage notice, retry cadence và no-drop queue.

### F08 — P2: lỗi ghi proof thật bị ghi nhận thành stopped khi cleanup abort đã có

**Source:** runtime runThreadWorkload2314 và workerLoop2527.

Probe cleanup safety abort đã set; TaskEvidenceError mang ackproof; fallback recordUnsettled reject → account outcome stopped, trong khi proofPersistenceFailure=TASK_CHECKPOINT_PERSISTENCE_FAILED.

Run tổng vẫn có thể failed đúng; sai nằm ở account status/counter/reason. Không được mô tả thành “toàn run báo success”.

**G07:** independent failed persistence terminal ưu tiên trước suy luận stopped từ signal. Peer chỉ bị cleanup ngắt vẫn stopped. Test cả outer catches; giữ ordinary direct checkpoint handler đã đúng.

### F09 — P2 contract: checkpoint/proof writer chưa có cùng ownership/drain boundary

**Source:** runtime persistAcceptedProofs1895–1916, runUiSessionAttempt1974–1999.

Bốn probe actual method:
1. Memo-hit proof resolve dù iteration owner đã bị thay.
2. Promise.all reject khi một proof write lỗi còn sibling chưa settle.
3. Callback checkpoint đã đóng vẫn ghi khi old session retained, owner removed; chỉ check thread.session chưa đủ.
4. Settled rows có opId/provedAt được ghi checkpoint nhưng không memoized; fallback cùng version có thể insert lại pending proof.

**G07:** guard invocation/session/iteration; check owner cả memo hit; drain tất cả owned writes trước retire; memo successful durable versions từ rows và unsettled. Never mark memo before DB success; không convert sink failure thành success.

Giới hạn: default executeHttpTasks await onAcceptedProof nên phần lớn settled versions đã memoized; production sink SQLite đồng bộ. Các sibling/memo/settled repro là lỗ contract và alternate/deferred runner, không có bằng chứng mặc định luôn mất proof. Late checkpoint cần regression retained-session nhưng chưa tái hiện live callback.

### F10 — P2: stop timeout đã khóa vẫn bị late rejection sửa nguyên nhân

**Source:** runtime startProfileStop1194/1274, handleStopFailure1323.

Probe timeout khóa cdp-teardown/deadline/remoteConfirmed=true; late ProfileStopError đổi thành stop-request/provider-error/remoteConfirmed=false và thay stopCause. Counters/retained ownership chưa bị giải phóng bởi probe này.

**G08:** catch vẫn observe late rejection nhưng không mutate frozen diagnostic/cause/phase hoặc emit replacement outcome sau lock. Giữ no retry và conservative retain.

### F11 — P2: Dashboard history mất thứ tự và provenance

**Source:** [dashboardController.ts](../../../src/renderer/pages/Dashboard/dashboardController.ts), refreshLogs753–800/onEntry628.

- Hai reads cùng epoch: old response resolve cuối có thể ghi đè newer same-ID.
- History-first dedup thay live seq12 bằng SQL same-ID không sequence; reset10 xóa nhầm event12.
- Toàn displayed buffer được merge như pending; Dashboard detached khi Clear, lần load SQL[] có thể giữ row đã bị xóa.

**G09:** request token, history authoritative + live/unconfirmed provenance riêng; same-ID không làm mất higher sequence; reset/re-attach fenced log-only refresh. Giữ log order/cap và save/start singleflight; không gọi logs.clear sau Start.

### F12 — P2: old Clear success xóa error/loading của log refresh mới

**Source:** [logsController.ts](../../../src/renderer/pages/Logs/logsController.ts), finishClear423–443.

Clear pending→reset20→fresh history fail→old Clear success10: error mới bị đổi null bởi stale success branch. Old failure branch đã sửa, không làm lại.

**G09:** settle old operation và monotonic cutoff bookkeeping nhưng không publish rows/error/loading cho epoch mới. Nếu old reply có cutoff mới hơn current phải áp dụng như reset thật, không drop các buffer không liên quan.

### F13 — P2: Add/Edit Account vẫn sửa password người dùng nhập

**Source:** [accountsController.ts](../../../src/renderer/pages/Accounts/accountsController.ts), secretOp151, optionalSecret159.

Actual create/update input password "  A|B  " → IPC passwordCapcut / passwordCapcutOp.value "A|B". Paste runtime đã giữ exact bytes nhưng thao tác sửa row trong Accounts làm hỏng lại credential đó.

**G10:** dùng trim chỉ xét empty/placeholder; replacement gửi exact value. Giữ keep/clear contract; không masking mới, không đổi vault. Tests phải kiểm passwordCapcutOp chứ không kiểm nhầm passwordCapcut trong update.

### F14 — P2: Accounts mutation IPC reject không hiện lỗi; delete mất selection trước kết quả

**Source:** accountsController301/328/341; [AccountsPage.tsx](../../../src/renderer/pages/Accounts/AccountsPage.tsx),196; Add/Edit handleSubmit chỉ finally.

Probe accounts.create reject → controller promise rejects, error=null. Update/remove tương tự. Delete fire-and-forgets, xóa selection/đóng dialog ngay cả khi request fail.

**G10:** normalize rejection thành false+visible error, mutation busy/session guard, chỉ close/reset sau commit success; keep input/selection để retry. Commit success nhưng list refresh failed phải được diễn đạt “đã lưu/xóa, chưa tải lại”, không tự retry mutation. Dashboard removeAccounts/stopThread có cùng uncaught boundary: phủ trong task này.

### F15 — P2: kết quả test connection cũ áp vào credential mới

**Source:** [SettingsPage.tsx](../../../src/renderer/pages/Settings/SettingsPage.tsx), handleTestConnection97–217; provider panel test buttons không khóa request.

Execute actual handler bằng AST in-memory: test A pending→edit/test B→B_FAIL→late A_OK: visibleFinal=A_OK dù latest draft B.

**G11:** per-service request token + draft revision + effect generation; edit/clear/reset vô hiệu result cũ. Pending feedback/busy theo service; vẫn test draft chưa lưu, không ghi credential hoặc redesign key UI.

Một probe load→save→old-load của SettingsController bị loại khỏi normal-UI findings: current page khóa Save khi isLoading. Không dùng nó để tuyên bố thao tác Settings bình thường đang hỏng.

### F16 — P2 verification: tests xanh chưa chứng minh toàn feature hoặc tail failure

**Source:** [pastedCapcutIntegration.test.ts](../../../src/main/services/__tests__/pastedCapcutIntegration.test.ts),267/259/398; [fixture.tsx](../../../scripts/bugfix-ui/fixture.tsx),281; [UI harness](../../../scripts/check-bugfix-ui.mjs),250–287; [lateRunScenario.test.ts](../../../src/main/services/capcut/__tests__/lateRunScenario.test.ts), V08.

- Paste tests dùng fake accounts sink, no real SQLite; “login fail/no signup” fake result, không thực thi RecoveryLoginError/ensureInApp; known-secret assertion kiểm sai field; capacity fixture trả cùng acc-1 cho2emails.
- Mounted sequence7 chỉ mount AutomationConfigGrid với localstate; không DashboardPage/controller/Start/IPC/snapshot.
- V08 đã thực thi real runtime+HTTP+SQLite cho tail: không còn lỗi “tự push mọi result”. Nhưng healthy receipt sessionAlias=accountId, timestamps fixed trước actual session; finally mở2gates rồi đóng DB mà không abort/settle owned work; thiếu exact retained lease IDs/cleanup count.

**G12:** bổ sung actual mounted parent, same-service real account repository/reuse, typed auth failure, real engine policy test và strict tail resource oracle. Assertions phải thất bại khi cố tình bỏ fix tương ứng. Không dùng raw counts/test names làm chứng minh.

## Verification lượt này

| Gate | Kết quả | Giới hạn |
|---|---|---|
| npm run typecheck | PASS exit0 | Static |
| npm run lint | PASS exit0 | Static |
| Full Vitest --maxWorkers=4 | **2377tests /175files PASS**,31.40s | Existing suite; probes mới chưa là committed regressions |
| npm run build | PASS exit0 | Renderer warning569.98kB, chưa là bằng chứng gây chậm |
| npm run selectors | **95pass/0fail** | Offline fixtures |
| Hidden mounted UI harness | **7sequences PASS**,exit0 | Sequence7 chỉ panel, không actual Dashboard Start |
| Isolated Electron harness | PASS35.7.5, Node22.16.0 | SQLite temporary/preload/isolation |
| Actual same-service paste + SQLite memory | 2runs, exact/reuse/noOTP/noPurchase đúng | Fake CapCut runner, không live login |
| Native addon | Rebuilt Node cho fullsuite, đã restore ElectronABI133 và verify | Không để tool dùng sai ABI |
| git diff --check | PASS trước/sau docs | Source changes Antigravity được giữ nguyên |

Không có live signup, trial activation, billable purchase, sourcefix, commit/push/deploy. Những bước cần account thật nằm trong runbook và cần quyền riêng. Không đề nghị chạy executable cũ; không suy luận lỗi do binary.

Kiểm tra cuối:457source/script/test hashes không đổi so với đầu lượt;35local documentation links hợp lệ;27TS/JS recipe blocks parse được khi đặt method snippets trong class context.52acceptance criteria map đủ12tasks. Snippet là hướng dẫn chưa được triển khai/typecheck như application code, không cộng vào2377tests. Ba tài liệu handoff được viết lại trực tiếp; thêm report và coverage cho snapshot hiện tại, giữ audit lịch sử.
