# Spec các lỗi còn lại — ToolCapCut

## Mục tiêu và baseline

Hoàn tất 9 vấn đề còn lại của lần review gần nhất; không triển khai lại những bản sửa đã đạt. Tool giữ flow do_action và hiển thị rõ API key/password/proxy trên Dashboard.

Mốc lúc lập tài liệu: HEAD ebf8b0a5dd0522f862d187f897b4d288e41316bc, worktree sạch. Review trước đó chạy 2.002 tests/162 files, typecheck/lint/build, 89 selectors và Electron harness PASS. Đây là bằng chứng baseline, không phải kết quả test cho các patch dưới đây.

## Global Constraints

- Giữ browser do_action → task_list → claim → đối soát; giữ endpoints, op_id, thứ tự, pacing và retry nghiệp vụ hiện tại.
- Dashboard phải hiển thị/copy được API key, password và proxy; không mask/reveal, auto-hide, xóa cấu hình hoặc redesign storage.
- Không thêm product_mission, media-artifact gate hay blanket refusal.
- Chỉ sửa lỗi có bằng chứng, theo test RED/GREEN; không refactor hoặc mở rộng chức năng không liên quan.
- Giữ changes người dùng và schema đã triển khai; không sửa checksum migrations cũ.
- Tests dùng fixture. Live/purchase/activate trial/commit/push/deploy chỉ khi có quyền riêng.

## Danh mục

| ID | Mức | Vấn đề |
|---|---|---|
| R01 | P1 | Callback confirmed lỗi trước persistence làm mất paid mailbox |
| R02 | P2 | Fresh OAuth CAS false vẫn giao mailbox |
| R03 | P2 | Settlement lỗi sau insert làm kẹt reservation |
| R04 | P2 | Restock retry dùng trùng intent trong fenced composition |
| R05 | P2 | Thrown timeout/browser failure làm mất accepted pending proofs |
| R06 | P2 | Pending upsert ghi proof cũ đè proof mới |
| R07 | P2 | Clear Logs đụng load/failure làm sai cutoff hoặc mất live rows |
| R08 | P2 / yêu cầu sử dụng | Dashboard còn che giá trị; Save failure làm mất key draft |
| R09 | P2 | Smoke trả success trước khi biết temp cleanup thất bại |

## R01–R03: paid response phải sống qua mọi lỗi sau mua

Nguồn: src/main/services/EmailPurchaseService.ts. confirmPurchase tại nhánh Gmail/DongVan vẫn gọi observer trước insert; settlePurchase sau insert nằm ngoài cleanup boundary; fresh OAuth chỉ xử lý khi updateReservedOauth trả true.

Bằng chứng review:
- Observer confirmed ném: buys1, confirmed1, savedMailboxes0.
- Fresh OAuth mất reservation: CAS false nhưng acquisition resolve với mailbox chưa hasOauth.
- bindMailbox/settleIntent lỗi: row đã insert nhưng reservation held, WorkSource chưa nhận để release.

Yêu cầu chung:
1. Sau response hợp lệ, tăng confirmed count đồng bộ.
2. Persist paid payload bằng storage hiện tại trước callback observer có thể ném.
3. Từ khi row tồn tại: settlement, observer, OAuth, CAS, abort check, delivery nằm trong cùng try/catch sở hữu reservation.
4. Failure release đúng reservation chưa giao, giữ row/binding/intent. Không xóa paid row, refund hoặc mua lại.
5. Observer lỗi làm session không tiếp tục acquisition; không che nguyên nhân lỗi bằng kết quả success.
6. Fresh CAS false phải throw ownership failure như nhánh reuse đã làm. Nếu row thuộc owner khác thì không release owner đó.

AC:
- Observer/settlement/binding/OAuth/abort/CAS failure đều không mất paid payload.
- Counter confirmed vẫn phản ánh purchase thực ngay cả khi persistence lỗi; persistence không rõ không được auto-repurchase.
- Observer/settlement failure không gọi tiếp OAuth hoặc giao mailbox.
- Fresh và reusable áp cùng CAS invariant.
- Nguyên trạng happy path mua→OAuth→giao mailbox và credentials display; không đổi storage mechanism.

## R04: fenced restock có identity và accounting đúng

Nguồn: recordPurchaseIntent tạo cùng operationKey mỗi vòng; OUT_OF_STOCK rollback local attempted nhưng không settle durable UNKNOWN, lần kế record trùng.

Bằng chứng: provider calls1, local attempted0, durable consumedUnits1, duplicate intent error.

Scope: chỉ sửa diagnostic/fenced composition có mutationContext; normal restock không có fence giữ polling/delay/accounting hiện tại.

Policy:
- Mỗi dispatch fenced tiêu một approval unit hiện có, không hoàn unit ngầm.
- Chỉ phản hồi stock được nhận diện rõ là no-effect mới settle exact intent thành no-effect-confirmed.
- Retry được cấp attempt ID mới, cùng owner/run/authority/budget owner; còn approval mới dispatch.
- Existing OUT_OF_STOCK code hiện bao gồm generic HTTP400/429/status:false, nên riêng code đó không đủ bằng chứng để settle no-effect. Phải phân biệt stock có chứng cứ với outcome chưa rõ; malformed/network/generic-error không được unlock retry.
- Local budget có thể giữ semantics hiện tại (stock xác minh rollback attempted); durable approval vẫn là giới hạn độc lập và monotonic.
- Một approval unit + stock xác minh → dừng trước dispatch2; hai unit + stock→success →2intent riêng và consumed2.
- Nếu chưa có fixture raw upstream đủ xác minh stock, phần classification đó ghi chưa xác minh; không tự đoán vendor codes để đóng bug.

AC: distinct operation keys, no-effect/effect đúng owner, không duplicate; UNKNOWN không retry; stop trong wait vẫn giữ ledger; thiếu approval không gọi provider; normal restock regression giữ nguyên.

## R05: lỗi await phải mang proofs đã accepted

Nguồn: httpTasks.ts chỉ return pending khi list response invalid; withinDeadline/boundedDomRead có thể throw trước return. Engine chỉ chuyển null snapshot thành TaskEvidenceError.

Bằng chứng:9accepted actions→list treo hoặc claim-count treo→raw deadline error không proofs.

Yêu cầu: tại nơi proofMemory còn tồn tại, wrap các fallible task/browser awaits sau lúc map khởi tạo. Non-abort error mang accepted proofs qua TaskEvidenceError hiện có. Không wrap checkpoint persistence error thành lỗi task khác; không thêm retry/session recycle/request. Stop giữ original abort reason và stopped semantics.

AC: list/claim-count deadline, page failure, hydration read error sau acceptance đều tới pending-only owner sink; failed account, completed0, normal checkpoint0; chỉ proofs đã accepted được giữ; current timed-out mutation không được bịa accepted. Chạy lại happy trace và Stop-after-acceptance.

## R06: chỉ ghi pending evidence mới hơn

Nguồn: AccountTaskRepository.recordUnsettledProofs ON CONFLICT không so proved_at.

Bằng chứng: new-op@2000 rồi old-op@1000 →DB giữ old-op.

Yêu cầu: upsert update chỉ khi excluded.proved_at mới hơn giá trị hiện có; equal giữ existing (idempotent/first wins). Dữ liệu ghi hiện tại dùng ISO từ Date.toISOString, không đổi encoding hay thêm migration. Không delete pending keys khác/receipt/status.

AC: newer→older/equal giữ newer; newer thực thay được; batch validation rollback; receipt/task rows không được sinh; account/run khác không lẫn.

## R07: Clear là operation độc lập với load

Nguồn: logsController.clear dùng chung loadToken; load mới làm clear reply bị bỏ. Failure phục hồi previousLogs làm mất pushes đang nhận.

Bằng chứng: clear→load→clear reply bị bỏ, old log quay lại; clear failure chỉ còn previous rows, mất live-during-clear.

Yêu cầu:
- Single-flight Clear với lifecycle riêng; luôn áp cutoff của Clear đã commit, không bị list token vô hiệu.
- Khi Clear pending, nhớ filter mới nhất và buffer unpaused pushes; không gọi list có thể đọc preclear DB rồi ghi vào UI.
- Success bỏ sequence<=cutoff, giữ sequence>cutoff chưa flush; sau đó refresh nếu cần bằng latest filter, seed survivors. Late old push cũng bị bỏ.
- Failure/rejection không auto retry delete, giữ previous matching rows cộng intervening pushes, loading=false/error.
- Load request vẫn latest-wins, chỉ merge pushes từ request hiện tại; duplicate ID một row.
- Không thêm protocol: dùng streamSequence/clearedThrough đã có. Không sequence DB migration, event bus framework hoặc timer tùy tiện.
- Legacy response thiếu cutoff dùng authoritative reload; ghi rõ không thể chứng minh thứ tự unsequenced pushes.

AC: success/failure/rejection + concurrent load/filter/Clear; unflushed postclear push; out-of-order reply; paused/dispose; mọi buffer bounded và sorted bằng canonical createdAt/id. Nếu backend đã clear nhưng refresh lỗi, báo refresh failed chứ không yêu cầu user Clear lại.

## R08: hiển thị đúng value và không mất input

Đây không phải hạng mục bảo mật. API key/password/proxy plaintext là ý định người dùng.

Nguồn: Dashboard columns.tsx:72 còn hasPassword→dấu sao; AutomationConfigGrid.tsx:374 còn maskedHint; SettingsController.save reset drafts trước reply.

Yêu cầu:
- API key email provider và password CapCut account hiện trên Dashboard bằng actual value, selectable/copy được, không nút reveal.
- Dùng service/preload hẹp lấy giá trị từ storage hiện có; không renderer Node/SQL, không migration credential, không thêm mã hóa.
- Không thay đổi proxy list/custom password đang hiển thị text đúng.
- Save giữ draft khi đang chờ và khi thất bại; new edits không bị refresh ghi đè. Success có thể đổi operation thành keep nhưng Dashboard vẫn đọc value thực từ backend.
- Không đổi tất cả screens/storage chỉ để làm D00; scope chỉ các field Dashboard và lifecycle Save liên quan.

AC: KEY-DEMO/PASS-DEMO/proxy-demo sau save/load hiển thị+copy đúng; missing value rỗng rõ ràng, không marker; Save fail còn input; edit giữa save vẫn còn; không nâng cấp broad raw IPC. Fixture không dùng credentials thật.

## R09: kết quả smoke gồm cả cleanup

Nguồn: runPackagedSmoke return object trước finally, sau đó rmSync fail tăng biến fail nhưng object đã có success=true.

Yêu cầu: tổng hợp result sau tất cả cleanup. Original check failure giữ nguyên, cleanup failure cũng làm gate fail; app close chưa chắc thành công thì giữ temp. Identity gate/owned launch/executable đúng đã có giữ nguyên. Không thêm process scan hoặc force-kill.

AC: normal pass + rmSync throw →failure; close throw→failure/temp giữ; original error+cleanup error đều báo; validate/launch failure không để temp vô chủ; empty DB0 vẫn pass. Không chạy installer/live account để test cleanup, dùng fakes.

## Các bản sửa phải bảo toàn

Không làm lại B01 malformed success, B02 ownership, B03 stale release, B04 owned config, B06 bound account early failure, B08 equality, B09 initial Stop reads, B10 container, B11 attribution khi các repro đã pass. Giữ migration009 và pending-only path đang có; R05/R06 chỉ đóng nhánh còn sót, không migration mới.

## Nghiệm thu

Mỗi R-ID có AC→test→patch mapping, command/exit và reviewer. Full suite/typecheck/lint/build/selectors + Electron harness cùng revision. Plaintext Dashboard không được bị xem là bug. Live/purchase/deploy là quyền riêng.

[Plan](../plans/2026-09-10-tool-bugfix-plan.md) · [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md)
