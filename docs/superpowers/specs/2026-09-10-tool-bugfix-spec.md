# Spec sửa bug ToolCapCut cho Antigravity

## Phạm vi đã chốt

Giữ nguyên flow do_action của tool. Chỉ sửa các lỗi được nêu dưới đây; không thiết kế lại sản phẩm.

API key, password và proxy credentials hiển thị rõ trên Dashboard để người dùng xem/copy/sửa là yêu cầu của tool cá nhân này. Plain text ở đây không phải bug. Không có task che dấu, thêm nút reveal, tự xóa cấu hình, đổi thành session-only, thêm vault hoặc migration mã hóa. Cơ chế lưu hiện có được giữ nguyên; không tháo các xử lý lưu trữ khác chỉ để làm lại toàn hệ thống.

Bộ tài liệu gồm đúng spec này, plan và runbook cùng tên. Nội dung dựa trên lần review gần nhất: HEAD 5007596f80198c9466d50e49b7e64b43a43b31bf cộng 45 file đang thay đổi. Lần review đã chạy 1.972 tests/160 files với 4 workers, typecheck/lint/build, 89 selector checks và Electron harness; các kết quả đó là baseline, không chứng nhận code sau sửa.

## Global Constraints

- Giữ do_action → task_list → claim → đối soát, danh sách action, endpoint, op_id, thứ tự, transport và pacing hiện tại.
- API key/password/proxy trên Dashboard phải đọc/copy được; không mask, auto-hide hoặc đổi storage trong đợt bugfix.
- Không thêm product_mission, media-artifact gate, blanket refusal hay flow thay thế.
- Sửa đúng nguyên nhân bằng patch nhỏ và test hồi quy; happy path hiện tại vẫn hoạt động.
- Giữ thay đổi của người dùng; SQL ở repository, renderer không tự mở Node/SQLite.
- Tests dùng dữ liệu giả. Không chạy live, mua mailbox, activate trial, commit/push/deploy khi chưa có quyền riêng.

## Tiêu chí sử dụng D00 — dữ liệu cá nhân hiển thị rõ

Giữ nguyên field API key/password/proxy và cách nhập, lưu, xem, copy trên Dashboard. Không đổi value thành dấu sao, chuỗi rỗng hoặc masked DTO. Nếu một field trong phạm vi Dashboard hiện chỉ nhận cờ hasPassword, bổ sung giá trị thực qua service/preload hẹp hiện có; không tạo hệ thống quản lý secret mới.

Nghiệm thu bằng fixture có KEY-DEMO, PASS-DEMO và proxy-demo: sau nhập/lưu/load, Dashboard hiển thị và copy đúng giá trị. Không cần gửi dữ liệu đó ra log/test report; tests chỉ dùng fixture. Không mở rộng yêu cầu này thành viết lại mọi trang hoặc migration credential database.

## Danh sách bug cần đóng

| ID | Mức | Vấn đề |
|---|---|---|
| B01 | P1 | DongVan malformed success không có order_code vẫn bị retry mua vượt budget |
| B02 | P1 | Account hết active trước khi Stop/cleanup hoàn tất, delete được quá sớm |
| B03 | P2 | Release lease cũ tác động vào key của lease kế tiếp |
| B04 | P2 | Đổi proxy key/region làm mất manager vẫn đang giữ lease |
| B05 | P2 | Lookup/decrypt/config lỗi làm kẹt mailbox reservation; CAS false vẫn cấp mailbox |
| B06 | P2 | Mailbox đã bind account A được cấp như account mới B và bị xung đột |
| B07 | P2 | Engine làm mất accepted pending proofs khi task_list không hợp lệ |
| B08 | P2 | Runner và engine không thống nhất freshness ở timestamp bằng nhau |
| B09 | P2 | Stop không cắt được DOM read phụ trợ bị treo |
| B10 | P2 | Missing/non-array task_list bị đổi thành snapshot rỗng hợp lệ |
| B11 | P2 | Current action lỗi nhưng outcome nhận proof cũ như proof của lần này |
| B12 | P2 | Pagination race/clamp và export counts còn sai |
| B13 | P2 | History reply khôi phục log sau Clear hoặc làm mất live log trong lúc load |
| B14 | P2 | Save Settings ghi đè chỉnh sửa mới phát sinh khi đang save |
| B15 | P2 | Packaged smoke sai executable, không dừng trước IPC khi identity sai, bỏ qua cleanup failure |
| B16 | P2 | Script live lưu credentials bằng cột SQL không tồn tại |

Không đưa plaintext API key/password vào danh sách bug.

## B01 — mua mailbox không lặp do response không rõ

Nguồn: src/main/providers/DongVanFBProvider.ts:253-264 và src/main/services/EmailPurchaseService.ts:695-701.

Repro đã có: HTTP200 {status:true,data:{list_data:[]}} không order_code; budget1 nhưng fake transport được gọi3 lần, attempted0/ambiguous0.

Yêu cầu: mọi success payload không parse được mailbox đều đi vào nhánh ambiguous hiện có, không phụ thuộc order_code. Explicit out-of-stock có bằng chứng vẫn được polling theo cấu hình hiện tại. Không đổi endpoint hoặc bỏ tính năng chờ restock.

AC: malformed success gọi1 lần, attempted1/ambiguous1, báo PURCHASE_OUTCOME_UNKNOWN; không tiếp tục mua thay thế. Payload hợp lệ vẫn mua/enrich bình thường. Test cả có/không order_code, missing data, malformed list và explicit stock→success.

## B02 — owner của account kéo dài đến hết iteration

Nguồn: AutomationRunService.ts:2386-2404; cleanupIteration xóa maps trước proxy release.

Repro: stopThread còn chờ completionPromise nhưng isAccountActive=false; AccountService.remove xóa account được.

Yêu cầu: giữ token ownership độc lập từ createThreadRecord đến notifyDone sau cleanup. isAccountActive kiểm token cộng các maps hiện có. Profile stop failure vẫn giữ ownership qua activeThreads. Không tự Stop khi người dùng chỉ Delete.

AC: deferred proxy cleanup chặn remove; completion success mới cho remove; failed-stop profile vẫn chặn; stop toàn run và HTTP-only injected runner giống nhau. Token cũ không được xóa token của iteration mới.

## B03/B04 — lease và manager không mất chủ

Nguồn hiện tại: ProxyLeaseManager.release:263-290 đã chờ remote release trước local cleanup nhưng chưa từ chối stale leaseId; LazyProxyLeaseSource.configure:37-52 vẫn có thể thay manager đang giữ lease. releaseAll đã có trạng thái pending/failed nhưng cần khóa ownership toàn diện.

Repro B03: acquireL1→releaseL1→acquireL2→releaseL1 lần nữa→acquireL3 tạo2 active leases cùng key.
Repro B04: acquire→configure khác→acquire dựng2 manager còn giữ lease.

Yêu cầu: release chỉ dùng owned lease lấy bằng leaseId; unknown/stale lease là no-op; concurrent duplicate join một release. Wrapper theo dõi owned leases và in-flight acquisition; chỉ đổi config sau khi owner cũ hết. Pending/failed cleanup giữ manager để cleanup tiếp, không tự dựng manager mới.

AC: stale release không gọi /out, key khác vẫn usable; local DB release fail giữ lease; cấu hình giống là no-op, đổi cấu hình khi có owner bị từ chối rõ; sau release success đổi được. ReleaseAll lúc acquire chưa settle không làm mất eventual lease.

## B05/B06 — mailbox recovery giữ đúng row/account

Nguồn: EmailPurchaseService.ts:603-654, 641/748; AutomationWorkSource.next luôn kind:new; runtime bind trước launch, commit sau launch.

B05: getOwnerByMailbox/getSecrets/decrypt/readApiKey xảy ra ngoài vùng release-on-error; key thiếu làm reservation held mãi. CAS false không được bỏ qua.
B06: owner đã bind account A, launch fail, mailbox available; lần sau tạo B rồi bind cùng owner bị IdentityBindingConflictError.

Yêu cầu tối thiểu:
- Mọi xử lý sau reserve nằm trong một cleanup boundary; lỗi trả reservation hiện tại về available, không mất row.
- CAS false phải báo ownership lỗi, không trả mailbox usable.
- Giữ UNKNOWN guard trước reuse/bind.
- Nếu binding đã có accountId, dừng trước trả work item và tạo B; báo account A để người dùng kiểm tra/chọn chế độ existing nếu phù hợp. Không tự resume/signup lại, không xóa/rebind ledger, không mua mailbox khác để né xung đột.

AC: lookup/config/OAuth/abort/CAS failure không kẹt reservation; untouched binding A; không tạo B/mua lần2; trường hợp owner chưa bind account vẫn reuse bình thường. Đây là xử lý lỗi recovery, không thêm flow tự động.

## B07 — pending evidence không mất khi snapshot lỗi

Nguồn: httpTasks.ts trả snapshot:null và pending proofs; CapcutEngineService.ts:384 ném Error thường, owner không còn proofs để lưu.

Yêu cầu: error có thể mang accepted proofs; AutomationRunService lưu pending-only ở đúng account/run rồi giữ kết quả failed như hiện tại. Không dựng fake receipt/status/credits, không thêm retry hoặc gọi lại action.

Database hiện gắn pending proof vào receipt; nếu lần đầu chưa có receipt, thêm đúng migration cần thiết để pending tồn tại độc lập. Chỉ thay quan hệ bảng evidence, giữ dữ liệu và PK; không liên quan credential storage.

AC: invalid list sau9accepted actions → pending vẫn đọc lại được, receipt/status không được bịa, accountsCompleted0. Pending persist failure đi qua lỗi persistence hiện có. Không ghi checkpoint thành công sau Stop; persistence đã bắt đầu không được tuyên bố rollback.

## B08/B10/B11 — metadata thống nhất

Nguồn: httpTasks.ts:287,519,536-548; một phần metadata đã được sửa nhưng equality freshness, malformed container và attribution proof còn sai; CapcutEngineService.ts:384 vẫn ném Error thường khi snapshot null nên mất pending proofs.

- B08: dùng cùng strict freshness. Equality giữ pending và final=false, không timestamp+1/Math.min.
- B10: array hợp lệ rỗng khác missing/null/string/object. Malformed container invalid, vẫn giữ hydrate budget hiện có.
- B11: tách currentAcceptedProofs khỏi merged carried memory. Outcome proof chỉ current accepted; carried vẫn giữ trong pending đúng key/run. Current action lỗi không được gắn proof cũ như vừa accepted.
- Nếu post-claim refresh lỗi, không ghép rows cũ với timestamp của response lỗi.

AC: fixed-clock equality, malformed containers, rejected current+carried old proof, valid parent/preexisting status4. Status4 hợp lệ vẫn là server-completed; không bắt mọi row có proof mới hay product mission.

## B09 — chặn chờ ở các DOM reads còn sót

Nguồn: httpTasks.ts:165,378,391,477,482.

Yêu cầu: boundedDomRead/abort cho các isVisible/count hiện hữu; không swallow interruption thành false rồi tiếp tục. Giữ vị trí clicks, request order, delay và scheduler.

AC: treo từng visibility/count rồi Stop → waiter reject hữu hạn, không request/checkpoint kế tiếp; late response không tác động. Host abort không chứng minh remote callback bị rollback.

## B12 — đúng trang, đúng filter, đúng export scope

Nguồn: accountsController.ts:214-230; AccountsPage.tsx:341-346.

Repro: reply trang3 về trước trang2 rồi trang2 về → UI page3 nhưng rows trang2. Export filtered lấy page length, all lấy filtered total.

Yêu cầu: request-local page/filter + token; stale reply bỏ; clamp trang sau delete; page state một nguồn. filteredTotal/globalTotal/page length tách biệt. Giữ scope All/Checked/Filtered và selection theo ID.

AC: trang2/3 out-of-order không lẫn; 1201IDs đủ; delete dòng cuối trang cuối về trang hợp lệ; filter0 vẫn All export; filtered browser export đúng IDs ngoài trang hiện tại.

## B13 — Clear/history/live không giẫm nhau

Nguồn: logsController.ts:152-163,181; main LogBus.clear đã có.

Yêu cầu: invalidate pre-clear loads ngay lúc Clear bắt đầu; history reply chỉ merge pushes nhận trong request đó, không dùng toàn state cũ. Clear success/fail/rejection đều settle loading; không auto retry delete; matching push không mất.

Do log push có thể đi trước batch DB, cần test riêng push sau server clear nhưng trước reply. Nếu phải thêm thứ tự, chỉ dùng một sequence nội bộ main + clearedThrough trong response Clear; không broker/event framework, không DB migration. Trường hợp này được định nghĩa trong plan, không đoán bằng timestamp.

AC: preclear list không hồi sinh, live-during-load còn, duplicate id một dòng, failed clear giữ dữ liệu, postclear unflushed push còn, filter mới thắng, pause giữ hành vi hiện tại.

## B14 — giữ edits mới trong lúc Save

Nguồn: settingsController.ts:319-337; inputs vẫn chỉnh khi save pending.

Repro: thay port và key mới trong lúc save, refresh cũ đè port và reset draft rồi isSaved=true.

Yêu cầu: tăng edit revision cho updateSettings/setDraft; save chụp revision. Refresh chỉ thay bản người dùng chưa chỉnh tiếp; edits mới còn và isSaved=false. Giữ field API key/password rõ để xem/copy, không wipe chúng như biện pháp bảo mật. Không đổi storage.

AC: deferred save + edit mới giữ đúng value/draft; save success không báo edits mới đã lưu; failure không mất edits; save tiếp gửi bản mới.

## B15/B16 — tools kiểm đúng và ghi đúng schema

B15: scripts/check-packaged-app.mjs:25 vẫn AutoManager.exe thay vì CapCut Automation.exe; identity check chỉ tăng fail rồi tiếp tục IPC; close lỗi vẫn success.

Yêu cầu: resolve productName hiện tại, own child/temp profile, strict identity trước firstWindow/IPC, timeout rõ, close/cleanup failure làm test fail và giữ temp nếu app chưa đóng. Không fixed-port scan, không kill process của người dùng. Count0 hợp lệ.

B16: scripts/live-test-capcut-engine.cjs:103/106 dùng id/created_at không có trong service_credentials. Sửa query theo schema/repository hiện có; không thêm cột hoặc redesign credentials. Kiểm offline bằng schema thật; không chạy script live để kiểm SQL.

## Hoàn thành

Từng B-ID có test RED/GREEN, patch nhỏ và reviewer. Chạy lại full suite trên cùng revision, typecheck/lint/build/selectors và harness phù hợp. Baseline test xanh không thay các cases mới. D00 hiển thị rõ phải giữ nguyên xuyên các patch.

[Plan](../plans/2026-09-10-tool-bugfix-plan.md) · [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md)
