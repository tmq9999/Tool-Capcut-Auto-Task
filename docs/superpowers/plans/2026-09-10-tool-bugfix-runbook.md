# Runbook Antigravity — sửa bug ToolCapCut

## 1. Yêu cầu cố định

Tool cá nhân. API key/password/proxy cần hiển thị rõ trên Dashboard để xem, copy, sửa. Đây không phải bug; không thêm mask/reveal, không tự ẩn/xóa cấu hình và không làm lại hệ thống credential storage.

Giữ flow:
browser session → user ID →9do_action →task_list →claim →đối soát.
Không product_mission, không media-artifact gate, không blanket refusal.

Đọc:

- [Spec](../specs/2026-09-10-tool-bugfix-spec.md)
- [Plan](2026-09-10-tool-bugfix-plan.md)
- AGENTS.md, rồi dùng Superpowers using-superpowers / systematic-debugging / test-driven-development / verification-before-completion.

Chỉ có ba tài liệu trong bộ bàn giao này. Các task tập trung sửa bug được review, không thêm project phụ.

## 2. Baseline

Review gần nhất: HEAD5007596 +45files dirty; test 1.972/1.972 với4workers, typecheck/lint/build,89selectors,Electron harness PASS. Đó là số đo trước patch mới, không dùng làm nghiệm thu sau triển khai.

~~~powershell
git status --short
git rev-parse HEAD
git diff --stat
~~~

Ghi HEAD và hashes các file sẽ sửa. Giữ toàn bộ edits có sẵn; không reset/stash/checkout để làm sạch. Worktree chỉ ở HEAD sẽ thiếu dirty patch Antigravity: cần chuyển đúng baseline được owner giao trước khi làm. Không stage git add toàn repo.

Source đổi đồng thời → đọc lại diff/rebaseline, không patch theo số dòng cũ. Findings không còn tái hiện thì ghi already-fixed + test và đi tiếp.

## 3. Thứ tự và phân công

| Wave | Task | Lỗi | Files có thể tranh chấp |
|---|---|---|---|
| 0 | T0 | D00 hiển thị rõ | Dashboard/shared DTO nếu còn masked |
| 1 | T1 | B01 mua lặp | DongVanProvider/EmailPurchaseService tests |
| 2 | T2/T3 | B02/B03/B04 ownership | AutomationRunService, ProxyLeaseManager, LazyProxyLeaseSource |
| 3 | T4 | B05/B06 mailbox recovery | EmailPurchaseService và ledger read types |
| 4 | T5/T6 | B08/B09/B10/B11 | httpTasks.ts, chạy tuần tự cùng một owner |
| 5 | T7 | B07 không mất pending proof | engine/run service/progress repo/migration |
| 6 | T8/T9/T10 | B12/B13/B14 UI data races | Accounts, Logs, Settings controllers |
| 7 | T11 | B15/B16 tooling | packaged smoke/live script SQL |
| Cuối | gate | Toàn bộ | integration reviewer |

T2 và T7 cùng AutomationRunService không sửa đồng thời. T1/T4 không sửa EmailPurchaseService chồng nhau. Có thể chạy runtime và UI song song khi file tách biệt. Mỗi bug một commit khi được phép, không gom sửa ngoài phạm vi.

## 4. Mỗi task làm đúng một vòng

1. Đọc phần spec tương ứng, xác nhận repro trên baseline hiện tại.
2. Viết test hồi quy có tên Bxx; chạy để thấy RED đúng lỗi.
3. Sửa tối thiểu như plan, giữ happy behavior.
4. Chạy GREEN focused + tests lân cận; typecheck khi đổi type/IPC.
5. Reviewer kiểm code và AC, không chỉ lời báo “test pass”.
6. Ghi checkpoint; commit scoped nếu execution request cho phép.

Mẫu checkpoint:

~~~text
ID:
Files/hunks:
Baseline:
Repro actual / expected:
Root cause:
RED command + assertion:
GREEN command + counts:
Happy flow / Dashboard plaintext still correct:
Review:
Remaining:
~~~

Không thêm gate “phải mã hóa/hide credential” hay “phải tạo product mission” vào checkpoint.

## 5. Điểm phải kiểm kỹ

### Mua mail

Malformed success không có order_code vẫn phải ambiguous, không mua lặp. Explicit stock được polling đúng cấu hình. Không xóa/reset UNKNOWN hay refund approval để làm test xanh.

Mailbox đã bind account A: báo đúng account A trước tạo B. Không tự resume/signup lại; không đổi immutable binding hoặc mua mailbox khác. Lookup/decrypt/API config/OAuth/CAS fail trả reservation, row đã mua còn.

### Proxy/account owner

Test deferred release, stale release sau successor, manager configure đang giữ lease, stop khi proxy cleanup pending. Kết thúc browser chưa đồng nghĩa account hết owned; token tới completion. Không tự Stop khi Delete.

### HTTP task

Strict response container/freshness/current proof; server status4 hợp lệ không buộc current proof hoặc product mission. Không thêm request/pacing để làm timestamp đẹp. Invalid snapshot có pending proof phải lưu pending-only, không tạo fake receipt. DOM reads phụ trợ cũng phải bị Stop cắt chờ.

### UI

Page/filter request token; export All dùng global total, Filtered dùng filtered total. Clear invalidates preclear loads, giữ đúng live events theo cutoff nếu cần. Settings save revision không làm mất edits mới; API key/password đang nhập và hiển thị không được auto-wipe.

### Tooling

Packaged default là CapCut Automation.exe theo manifest. Identity mismatch trước IPC phải dừng; close/cleanup error không success. SQL live harness phải khớp schema, kiểm bằng DB fixture, không chạy script mua mail để test câu SQL.

## 6. Kiểm tra và môi trường

Một owner điều phối native ABI. Khi bắt đầu ghi nhận Node/Electron versions; đừng coi require package là native SQLite đã load:

~~~powershell
node --version
node -e "const D=require('better-sqlite3');const d=new D(':memory:');console.log(process.versions.modules);d.close();"
~~~

ABI mismatch là lỗi môi trường, không tính RED chức năng. Rebuild theo script được phép, không sửa npm global policy. Không chạy DB tests Node đồng thời với rebuild/harness Electron. Trả addon về runtime ban đầu/thống nhất sau cùng.

Sau các focused tests:

~~~powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=4
npm run typecheck
npm run lint
npm run build
npm run selectors
git diff --check
~~~

Dùng4workers để giữ tải hợp lý như lượt review; không tăng timeout/heap tùy tiện để giấu loop. Không skip mới. Nếu test mặc định vẫn timeout, ghi riêng và truy nguyên tải/import, không báo gate đó ổn định.

Sau đúng ABI và quyền launch:

~~~powershell
npm run test:electron
~~~

UI interaction cases như page change/filter/Clear/save pending phải dùng fixture dữ liệu giả trên component thực khi cần, không chỉ test helper. Dashboard assertion: KEY-DEMO/PASS-DEMO hiển thị/copy chính xác, không dấu sao hoặc tự xóa sau refresh.

Packaged smoke chạy sau khi T11 fake ownership tests đã GREEN và được phép build/launch:

~~~powershell
npm run dist:dir
node scripts/check-packaged-app.mjs
~~~

Không chạy default script nếu vẫn trỏ executable cũ hoặc identity lỗi vẫn đi vào IPC. Temp profile riêng, count0 hợp lệ, hidden process khi không cần người dùng thao tác.

## 7. Migration duy nhất trong kế hoạch này

B07 có thể cần migration9 cho pending proofs không phụ thuộc receipt, vì hiện FK bắt buộc có receipt. Không liên quan API key/password; không migration mã hóa/ẩn dữ liệu.

Migration phải giữ rows/PK, có test8→9, repeat migration, pending without receipt và cleanup explicit. Không sửa checksum migration007. Không fake receipt để né thay đổi schema cần thiết. Nếu baseline đã có migration9 khác, lấy version kế tiếp, không overwrite.

## 8. Phạm vi quyền

Lượt viết tài liệu không sửa source. Khi Antigravity được giao triển khai, làm source/test theo plan. Live calls, mua mailbox, activate trial, push/merge/release vẫn cần quyền riêng; yêu cầu hiển thị rõ credential không tự cấp quyền thực hiện các thao tác đó.

Tests dùng fixture để không tác động tài khoản thật. Không bắt người dùng nhập lại key chỉ vì policy tự thêm; giữ UX plain text họ đã chọn.

## 9. Bàn giao hoàn tất

Báo cáo B01–B16 fixed/open/already-fixed/unverified; kèm exact test commands, source diff, migration kết quả, Dashboard D00, và happy-path request trace.

Không báo “xong hết” từ test count cũ hoặc bỏ functionality. Không thêm file đính chính nhiều tầng; cập nhật đúng ba tài liệu này khi scope được chủ dự án thay đổi.

Prompt copy:

~~~text
Đọc AGENTS.md và docs/superpowers/plans/2026-09-10-tool-bugfix-runbook.md,
sau đó spec/plan liên kết. Sửa B01–B16 theo source hiện tại bằng TDD từng task.
Giữ flow do_action, endpoint/op_id/order/pacing, không product mission hay blanket refusal.
Tool cá nhân: API key/password/proxy hiển thị rõ trên Dashboard để xem/copy/sửa;
không thêm masking, auto-hide, auto-clear hoặc redesign storage.
Giữ dirty edits người dùng, kiểm ownership/pending proof/race thật, review scoped diff.
Chưa được phép thì không live/purchase/push/deploy. Báo RED/GREEN và giới hạn kiểm chứng.
~~~
