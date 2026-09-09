# Antigravity implementation audit — headed UI 12/12

> Historical audit baseline. The approved continuation has since been implemented; see [the offline implementation result](2026-09-08-headed-ui-continuation-result.md). The failures below remain as the pre-fix evidence, not the current offline test result.

**Ngày kiểm tra:** 2026-09-08, Asia/Bangkok.
**Checkout:** `master`, HEAD `c5de54974633c666efb021214aa51c8747c5fb47`, cộng toàn bộ thay đổi chưa commit tại thời điểm kiểm tra.
**Phạm vi:** đọc code, 3 reviewer độc lập, test/fake offline và lập kế hoạch tiếp tục. Không triển khai production trong lượt audit này.

## Kết luận

Antigravity đã có các commit tương ứng Tasks 6–11 và phần triển khai Tasks 1–5 trong checkout, nhưng **không thể coi Tasks 1–11 đều hoàn thành**. Các ranh giới scheduler, Claim, cleanup và telemetry còn thiếu hoặc sai. Task 12 đang ở trạng thái RED; Task 13 mới có parser và helper userData, chưa có controller/validator/health IPC hoàn chỉnh. Task 14 chưa qua.

Kết quả live cuối cùng đã biết trong bộ tài liệu bàn giao vẫn là **0/3 hoàn thành, cả ba 6/12**, lỗi `DOM_READ_TIMEOUT: canvas-area:mouse-move`. Audit này không chạy live và không xác nhận lại trạng thái tài khoản trên server. Nguyên nhân vendor/browser khiến mouse treo vẫn chưa được chứng minh; lỗi bỏ qua scheduler dưới đây là lỗi code được tái hiện riêng, không phải bằng chứng duy nhất cho nguyên nhân vendor.

Kế hoạch tiếp tục: [Headed UI continuation](../plans/2026-09-08-headed-ui-continuation-after-audit.md).

## Tiến độ theo bằng chứng

| Task gốc | Trạng thái audit | Bằng chứng / việc còn lại |
|---|---|---|
| 1 | Có triển khai | Regression bảo toàn proof trước fatal và no-fallback tồn tại; suite liên quan pass. |
| 2 | Một phần | Có exact snapshots/checkpoint; còn suy status từ `missing`, default freshness, completion fallback và Claim chưa cập nhật freshness watermark. |
| 3 | Có triển khai trong dirty worktree | Migration 006, transaction receipt/item set và UI stale/partial có code/test; không đồng nghĩa đã commit hay nghiệm thu live. |
| 4 | Một phần | FIFO/quarantine có; snapshot xoá foreground owner khi session còn quarantined. |
| 5 | Một phần | Session ownership có; Stop lại xoá cached promise sau stop failure và có thể gửi stop lần hai. |
| 6 | Một phần, chặn release | UI facade còn optional; overlay và Claim có đường chạy ngoài scheduler. |
| 7 | Có luồng chính, thiếu kiểm chứng kết hợp | Existing-only auth và health launch path có; thiếu test xuyên suốt health timeout → quarantine → service stop. |
| 8 | Một phần | Recycle một lần, giữ account/proxy đã có; Claim timeout và stop retry còn thoát khỏi contract recovery. |
| 9 | Một phần, chưa dùng được để nghiệm thu | Recorder/schema có nhưng production không truyền runtime userData; metadata/counter còn hard-code, thiếu lifecycle/resource events. |
| 10 | Một phần | Có 100-seed tests nhưng kiểm tra queue cuối bị vô hiệu do scheduler đã null; thiếu đo overlap và nhiều fault chưa nối. |
| 11 | Có triển khai | Finite existing-account source, credential lookup và existing-only; không gọi mua mail/create account/commit mới trong nhánh resume. |
| 12 | RED / chưa triển khai đầy đủ | 10 test fail; thiếu budget/stats/dispatch accounting và wiring. |
| 13 | Một phần | Parser/helper pass; entry point thật vẫn legacy, validator và fake controller test chưa tồn tại, health IPC chưa có. |
| 14 | Chưa qua | Full tests, typecheck và lint đều fail; các gate khác chưa nghiệm thu. |
| 15 | Chưa được chạy trong audit | Cần quyền riêng sau offline gate. Không có bằng chứng 3/5/10 luồng đạt 12/12 mới. |

Git gần nhất: `c5de549` Task 11 lúc 04:36, `ffa477a` stress lúc 04:27, `8061d34` telemetry lúc 04:14, `26235e7` recovery lúc 04:06. File source mới nhất quan sát được là `src/main/main.ts`, sửa lúc 06:13:07 +07:00. Đây là mốc file/commit, không phải xác nhận Antigravity còn đang chạy hay bị treo.

## Test đã chạy

| Kiểm tra | Kết quả |
|---|---|
| `npx vitest run` lúc 07:41:14 +07:00 | Exit 1; **119 files pass / 1 fail; 1.281 tests pass / 10 fail**, tổng 1.291. |
| `npx tsc --noEmit` | Exit 1; **28 lỗi**, tất cả tại `EmailPurchaseService.test.ts`. |
| `npx eslint . --max-warnings 0` | **6 errors, 0 warnings**, tất cả explicit `any` tại cùng test file. |
| Nhóm scheduler/coverage/telemetry/bounded input/cancellation/mission/claim | **56/56 pass**, 7 files. |
| Nhóm service/recovery/repository/migration/purchase/work source | **231 pass / 10 fail**, 7 files. |
| Nhóm parser/userData/contracts/schema/task dialog | **51/51 pass**, 5 files. |
| Probe gọi `foregroundPage` thật với page giả, không browser | Worker A còn giữ lane nhưng B vẫn focus=1/input=1 khi thiếu facade. **Tái hiện lỗi**. |
| Probe schema với sentinel email giả trong label | Schema chấp nhận label. Chưa bảo đảm redaction ở string field được phép. |

Các lần focused và full suite có test trùng nhau; không cộng các số trên thành tổng test mới. Tất cả provider/account/page trong tests là fake hoặc SQLite tạm. Node native module hiện tại load được; không chạy rebuild để đổi ABI của môi trường dùng chung.

10 lỗi Task 12: budget không được kiểm tra; `purchaseStats()` không tồn tại; budget=2 nhưng Gmail94 fake dispatch thành công 5 lần và DongVan 3 lần; thiếu attempted/confirmed events; ambiguous DongVan trả lỗi thường thay vì `PURCHASE_OUTCOME_UNKNOWN`; thiếu các counter/redaction assertion tương ứng. Typecheck còn có ba fixture DongVan thiếu `refreshToken/clientId/raw` và hai callback implicit-any.

## Phát hiện cần xử lý

### F1 — P0: thao tác có thể bỏ qua scheduler hoặc tiếp tục sau timeout

- `human.ts:22,33`: `ui?` và fallback `createDirectUiInteraction`.
- `missionRunner.ts:337,438,448`, `missions/designStudio.ts:253,269,282`: gọi `ensurePageUsable` thiếu facade/signal.
- `runTasks.ts:382`: Claim không truyền `ui`; `missionRunner.ts:486` tạo direct facade; `:492-494` nuốt lỗi click.
- `uiInteractionCoverage.test.ts` chỉ nhìn callback được bọc, không kiểm tra helper nhận đúng facade. Vì vậy test xanh nhưng vẫn có đường bypass.

Probe offline thực tế cho kết quả `aStillOwnsLane=true, bFocus=1, bInput=1`. Cần bắt buộc facade ở production, truyền xuyên suốt helper, giữ typed timeout và đưa Claim fatal về checkpoint/stop/recycle. `foregroundPage` cũng phải giới hạn thời gian focus, không chờ `bringToFront()` vô hạn.

### F2 — P1: stop không giữ đúng một lần và stress chưa đo invariant thật

- `AutomationRunService.ts:1852-1854,2120-2122`: xoá stop promises sau thất bại. Nếu provider stop cũ chỉ timeout ở phía caller, lần stop mới có thể chạy trong khi promise cũ chưa settle.
- `uiInteractionScheduler.ts:356-358`: xoá foreground owner/activity dù quarantine chưa được xác nhận stop.
- `deterministicRunHarness.ts:361-368`: đọc scheduler sau completion, trong khi service đã gán null tại `AutomationRunService.ts:1789`; optional chaining và default zero che việc không hề có snapshot terminal. Interface hiện có cả nested và flat fields; vấn đề được chứng minh là thời điểm lấy snapshot/default zero, không phải field nested không tồn tại.

Cần retain ownership, không tự retry stop không chắc chắn, snapshot terminal trước dispose và theo dõi event/lane peaks thực sự. Các fault được khai báo nhưng chưa dùng phải có test chứng minh từng fault đã được kích hoạt.

### F3 — P1: exact receipt boundary vẫn có đường suy diễn

- `CapcutEngineService.ts:62-88`: fallback suy status từ danh sách missing; `:320-321,345-346`: default metadata freshness/finality.
- `AutomationRunService.ts:1226-1239`: UI result thiếu verification vẫn được xử lý theo completion legacy.
- Claim không đưa thời điểm mutation settle vào `requiredAfter`; snapshot trước watermark cần thiết có thể được coi final.

CapcutEngine chuẩn hiện tại thường truyền đủ metadata, nên một số fallback chỉ lộ khi adapter/result cũ hoặc sai. Tuy vậy chúng vi phạm contract fail-closed và phải được khoá bằng compile-time + regression, không dùng để giữ fake cũ chạy xanh. HTTP-only giữ nhánh completion riêng.

### F4 — P0 trước mọi mua mail: budget mới chỉ nằm trong test

`EmailPurchaseService.ts:45-50,88-92` chưa có contract stats/budget; hai provider dispatch chưa đếm atomic. `AutomationWorkSource.ts:176-183` chưa truyền budget; shared schema/terminal enum cũng thiếu. Không chạy paid stage cho tới khi budget=2/5 callers có đúng 2 dispatch ở cả hai provider và ambiguity không thể tự retry.

### F5 — P1: production evidence chưa hoạt động và chưa đáng tin để nghiệm thu

- `providerStack.ts:211-226` không truyền runtime `userDataDir/createTelemetry`; `AutomationRunService.ts:1873-1877` vì vậy tạo recorder null trong wiring production.
- `AutomationRunService.ts:1685-1695` hard-code `new`, headed, stage 1, dùng mailLimit làm purchase budget; `:1808-1824` hard-code purchase/skipped counters bằng zero.
- Chưa phát đầy đủ resource/profile-start lifecycle. Lỗi recorder đang bị bỏ qua.
- `runTelemetry.ts:40-67` cho `record()` nhận terminal trước `close()`; schema label/key tự do chưa đủ chặn thông tin nhạy cảm.

Cần test đi qua production factory bằng collaborators fake; kiểm tra artifact thực tế trong thư mục tạm, không chỉ unit-test recorder.

### F6 — P0 trước mọi harness run: parser mới chưa được dùng bởi runner

`scripts/live-capcut-run.mjs` vẫn default paid Gmail94, chạy eager `main()`, forward raw email/log và không dùng `parseLiveCapcutOptions`. Thiếu `scripts/verify-rollout-evidence.mjs`, `scripts/__tests__/live-capcut-run.test.mjs` và health IPC. **Không được thử script với `--dry-run` để kiểm tra**: flag hiện chưa được runner xử lý như một chế độ an toàn.

Helper userData đã đặt trước DB initialization, nhưng runner chưa truyền env child-only và chưa chứng minh producer/validator cùng directory. CLI trong Task 15 cũ cũng chưa khớp parser về mode/account-file flags; phải có test parse từng command được tài liệu hoá trước khi cho phép live.

## Gate chưa chạy / không được coi pass

- `npm run selectors`: source mở Chrome và serve captured HTML; chưa chứng minh chặn mọi external request/script. Chưa chạy.
- `npm run build`: chưa chạy; bước TypeScript hiện đã fail.
- `npm run test:electron`: source harness dùng SQLite tạm/fake IPC/hidden data-URL window, nhưng fake process-boundary gate bắt buộc của Task 13 chưa có; chưa chạy.
- `npm run test:node` theo chuỗi rebuild: chưa chạy. Đã chạy full Vitest bằng native Node binary hiện có và ghi đúng kết quả fail.
- Live/health/resume/provider/purchase: không chạy.

## Handoff

Không quay lại từ đầu hoặc reset checkout. Giữ migration/receipt/recovery đang có, chỉ bổ sung các regression thiếu và sửa lỗi được chứng minh. Agent được chia file ownership tại continuation plan; `AutomationRunService.ts`, factory và shared contracts chỉ có một người tích hợp tại một thời điểm.

Audit này chỉ tạo báo cáo này và continuation plan. Không sửa production source, không commit/reset/stash, không can thiệp tiến trình của người dùng. **No live CapCut run or mailbox purchase was performed.**
