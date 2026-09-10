# Runbook Antigravity — hoàn tất các lỗi còn lại

## 1. Đọc và giữ đúng phạm vi

- [Spec](../specs/2026-09-10-tool-bugfix-spec.md)
- [Plan](2026-09-10-tool-bugfix-plan.md)
- AGENTS.md và Superpowers using-superpowers.

Chỉ ba tài liệu này là bộ bàn giao hiện tại. Dùng systematic-debugging, TDD và verification-before-completion khi triển khai. Không thêm report đính chính nhiều tầng.

Flow cố định: browser → user ID →9do_action →task_list →claim →đối soát.
API key/password/proxy cần hiện text rõ để xem/copy/sửa. Không product_mission/media gate, blanket refusal, mask/reveal, auto-hide, auto-clear hoặc credential-storage redesign.

## 2. Baseline và quyền

Mốc lúc viết: ebf8b0a5dd0522f862d187f897b4d288e41316bc. Lần review đã có2.002tests/162files, typecheck/lint/build,89selectors,Electron harness PASS; phải chạy lại sau patch.

~~~powershell
git status --short
git rev-parse HEAD
git diff --stat
~~~

Ghi hashes file task. Nếu source khác spec thì đọc diff và tái hiện lại, không patch theo số dòng cũ. Giữ hunks của người dùng; không reset/stash/checkout để ép về baseline. Khi cần worktree, mang đúng source snapshot được giao chứ không bỏ dirty changes.

Lượt viết tài liệu không triển khai source. Khi được giao thực thi, sửa theo plan; live calls, mua mail, trial activation, commit/push/merge/deploy là quyền riêng. Tests chỉ fixture. Không dùng API key/password thật làm test payload hoặc gửi chúng sang dịch vụ ngoài.

## 3. Hàng đợi

| Thứ tự | Plan | ID | Kết quả |
|---|---|---|---|
| 1 | T1 | R01, R02, R03 | Paid row bền trước observer; CAS/settlement fail không giao/leak reservation |
| 2 | T2 | R04 | Fenced stock retry đúng proof/attempt/approval; normal restock không đổi |
| 3A | T3 | R05 | Thrown await mang accepted proofs, không thêm replay |
| 3B | T4 | R06 | SQL upsert chỉ thay bằng proof mới hơn |
| 4A | T5 | R07 | Clear độc lập load, cutoff không mất, live rows không rơi |
| 4B | T6 | R08 | Dashboard có actual value; Save fail còn input |
| 5 | T7 | R09 | Smoke verdict gồm cleanup, không báo success sớm |
| Cuối | Gate | Tất cả | Test/review/không đổi happy path |

T1/T2 cùng EmailPurchaseService phải tuần tự. T3/T4 khác files có thể song song. T5/T6 khác controller có thể song song; shared contract file phải một owner. Một task là một patch review được, không gom tất cả thành một diff không truy vết.

## 4. Chu trình từng task

1. Xác nhận bug còn bằng fixture trên source hiện tại.
2. Thêm test Rxx và chạy RED. ABI mismatch hoặc missing tool không tính RED logic.
3. Sửa nhỏ đúng boundary; không rewrite flow để test pass.
4. Run GREEN focused + tests lân cận.
5. Reviewer kiểm spec AC, source diff và request/resource trace.
6. Commit scoped chỉ khi được phép; rồi task kế tiếp.

Mẫu checkpoint:

~~~text
ID / task:
HEAD + changed files:
Repro / root cause:
RED command + assertion:
GREEN command + result:
Happy path unchanged:
API key/password visible as requested:
Reviewer / issues remaining:
Next gate:
~~~

## 5. Gate nghiệp vụ quan trọng

### R01–R03

Có paid response thì count đúng và persist trước callback có thể lỗi. Settlement/observer/OAuth/CAS/abort/delivery phải cùng cleanup boundary. Observer lỗi dừng session nhưng row còn. Không delete mailbox, reset binding, refund hoặc tự mua lại. CAS false không thể trả reservation usable.

Kiểm cả Gmail và DongVan. Test chỉ reuse thành công không đủ chứng minh fresh-purchase error path.

### R04

Fenced diagnostic mode có approval units riêng với local purchase stats. Chỉ stock có chứng cứ no-effect được settle; retry mới có identity mới và còn unit. Không đánh đồng mọi HTTP400/429/status:false với stock.

Nếu chưa có raw provider fixture xác thực stock marker, ghi upstream-classification gate chưa verified. Unit với ConfirmedOutOfStockError chỉ chứng minh coordinator logic, không chứng minh provider production nhận đúng shape. Không đoán vendor codes và không chạy billable call để lấy fixture khi chưa có quyền. Normal restock behavior vẫn giữ nguyên.

### R05–R06

Accepted proofs sống qua non-abort errors bằng TaskEvidenceError đang có. Wrapper không chạm checkpoint persistence error và không bịa proof cho request timed-out. Stop vẫn stopped; không thêm continue/recycle/request.

R06 giữ newer record trên older/equal timestamp, không thêm schema. Migration009 đã được triển khai, không sửa checksum hoặc làm thêm migration để chữa upsert một dòng.

### R07

Test sequence: clear đang chờ → filter/load mới → backend cutoff → postclear unflushed push → late preclear push. Cutoff phải áp dù list token đã đổi. Failure giữ previous+new rows, không auto retry delete. Repeated Clear chỉ1IPC.

Không thêm framework; tận dụng streamSequence/clearedThrough đã có. Buffers bounded, source-of-truth history không phải mọi row từng có trên UI.

### R08

Fixture KEY-DEMO/PASS-DEMO/proxy-demo phải đọc/copy được trên Dashboard sau save/load. Chỉ presence flags/dấu sao là chưa đạt. Sửa mapping/DTO nhỏ qua service/main hiện có; không renderer SQLite, không storage migration.

Save failure không xóa draft và new edits trong lúc chờ không bị refresh đè. Success có thể đặt operation keep nhưng Dashboard vẫn lấy value thực từ backend. Không dùng lý do bảo mật để che giá trị người dùng yêu cầu.

### R09

Kết luận smoke sau app close/temp cleanup. Fake cleanup error phải failure, không result object cũ success. Giữ primary error và cleanup error; không kill process khác. Count0 hợp lệ. Không chạy old fixed-port scanner.

## 6. Kiểm chứng tuần tự

Một owner điều phối native ABI; Node tests và Electron harness không rebuild cùng lúc.

~~~powershell
node --version
node -e "const D=require('better-sqlite3');const d=new D(':memory:');console.log(process.versions.modules);d.close();"
~~~

Node/Electron ABI khác nhau. Dùng project rebuild sau khi có quyền; không đổi npm global policy. Sau cùng khôi phục ABI runtime đã thống nhất như lúc bắt đầu.

Sau focused tests:

~~~powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=4
npm run typecheck
npm run lint
npm run build
npm run selectors
git diff --check
~~~

Không full build/test song song nếu máy tải cao. Không skip để báo xanh, không tăng heap/timeout nhằm che loop. Test count chỉ là phạm vi, không thay AC.

Sau đúng ABI/quyền launch:

~~~powershell
npm run test:electron
~~~

Dashboard và Logs cần fixture UI/component thật khi kiểm copy/value và interaction races. Không chỉ test helper. Fixtures dùng userData tạm và không provider thật.

Package smoke sau T7 GREEN và có quyền build/launch:

~~~powershell
npm run dist:dir
node scripts/check-packaged-app.mjs
~~~

Đúng owned executable/profile, không cần account thật, no network purchase. Nếu fuse/tool không hỗ trợ launch thì báo verification blocked, không làm yếu app để test pass.

## 7. Khi dừng

- Source được chỉnh cùng lúc: rebaseline, không overwrite.
- Cần thêm flow/transport tự động hoặc đổi scope: hỏi chủ dự án.
- UNKNOWN/billable outcome chưa rõ: giữ evidence, không tự mua thay.
- R04 thiếu fixture/no-effect contract: không claim production retry fixed.
- Permission chưa có cho live/purchase/deploy: dừng ở offline.
- Cleanup không chắc: giữ owner/temp và báo lỗi, không xóa rộng.

## 8. Bàn giao cuối

Báo cáo R01–R09 fixed/open/already-fixed/unverified, exact commands/exit, AC matrix và reviewer. Ghi rõ R08 actual values, do_action trace không đổi, ABI cuối. Không tạo thêm nghĩa vụ mask/mã hóa hoặc product mission.

Các bản sửa cũ đã đạt không cần làm lại; chỉ thêm regression khi patch mới tác động đến chúng.

Prompt giao Antigravity:

~~~text
Đọc AGENTS.md và docs/superpowers/plans/2026-09-10-tool-bugfix-runbook.md,
rồi spec/plan liên kết. Triển khai T1–T7 để sửa R01–R09 của review gần nhất.
Giữ flow do_action, endpoints/op_id/order/pacing và normal restock.
API key/password/proxy phải hiển thị rõ trên Dashboard để xem/copy/sửa;
không masking, auto-hide/clear hoặc redesign credential storage.
TDD từng task, giữ paid data/owner/pending proof, review scoped diff và chạy đủ gates.
Chưa có quyền thì không live/purchase/commit/push/deploy. Báo bằng chứng, không chỉ test count.
~~~
