# ToolCapCut — Spec đóng các lỗi tồn đọng sau full-file audit

## Baseline và phạm vi

Nguồn lỗi: [Full-file audit](../reports/2026-09-10-full-file-audit.md), [coverage theo file/hàm](../reports/2026-09-10-full-file-audit-coverage.md).

Baseline triển khai là HEAD dd8a16e4dbfc1c2d51a7265fbdc05f861a9ab768 **cộng working tree Antigravity hiện tại**. Đối chiếu 436 source/script/test hashes lúc lập kế hoạch: không khác snapshot audit. Không reset về clean HEAD. Số 2.085 tests/163 files PASS là baseline, không phải kết quả các fix dưới đây.

Bộ thực thi hiện hành: Spec này, [Plan](../plans/2026-09-10-tool-bugfix-plan.md), [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md). Viết lại trực tiếp bộ cũ để không có hai hướng dẫn mâu thuẫn. Report audit giữ nguyên là bằng chứng lịch sử.

## Global Constraints

- Giữ do_action → task_list → claim → đối soát, trial gate, endpoints, op_id, thứ tự, pacing và normal restock.
- API key/password/proxy trên Dashboard phải hiện plaintext để xem/copy; không masking, reveal toggle, auto-hide hoặc redesign vault/storage.
- Không product_mission/media gate, chuyển transport, tăng retry nghiệp vụ, reset DB hoặc sửa checksum migration để làm test xanh.
- Giữ patches đã đạt: paid mailbox F01, per-row password F02, OTP owner, proxy pre-rotation Stop/retained route, Logs normalize/upsert và Dashboard snapshot coalescing.
- Code mới phải có behavioral RED rồi GREEN. Mock phải phản ánh return type/thời gian/lifecycle thật; không nhận missing-module/ABI lỗi là RED.
- Chỉ thêm API nội bộ/typed IPC tối thiểu khi task cần; không generic raw IPC, framework state/resource mới hoặc dependency mới.
- Test fixture/DEMO, không live account/purchase/activate trial/commit/push/deploy ngoài quyền được giao.
- Không kết luận người dùng chạy executable nào. Đóng gói/cài lại không thay thế fix source.

## Mapping đủ 30 findings

| Task | Findings | Kết quả cần có |
|---|---|---|
| T01 | A01,A05 | Pacing abortable không tự timeout; Stop bao post-submit/fallback waits |
| T02 | A03 | Checkbox ổn định, readback đúng trước Submit |
| T03 | A02 | DOB random hợp lệ, option/readback đúng, không hard-code |
| T04 | A04,M02 | Survey read uncertainty không cleared; fatal trial là failed |
| T05 | M05 | Terminal persistence failure không completed hoặc mất counters |
| T06 | M01,M07 | Credential/diagnostic chỉ ghi lên đúng blob snapshot |
| T07 | B03,C02 | Single-flight Start; reset chỉ log trước attempt sau preflight thành công |
| T08 | B01,B02 | Dashboard save/load đúng revision/lifecycle |
| T09 | B04,B05 | Settings hydrate không xóa edit; boot prefs theo commit thật |
| T10 | M03,M04 | Proxy route không trùng; password không bị cắt |
| T11 | M06 | Log retry throttle/bounded batches, không silent loss |
| T12 | B06,B10 | Clear replay giữ provenance; WARNING mapping đúng |
| T13 | B07,B08 | Dialog xử lý reject/identity, không busy hoặc receipt cũ |
| T14 | B09 | Nguồn email drawer/filter nhất quán, legacy giữ nguyên |
| T15 | C03 | Account delete transactional task cleanup, giữ financial records |
| T16 | C01 | Quit lặp vẫn chặn đến khi shutdown xong |
| T17 | D01,D02,D03 | Legacy monitor/draft/ack type đúng; không tác động default flow |
| T18 | D04,D05 | Diagnostic OTP dùng API hiện có, failure exit nonzero |
| T19 | Các test gaps phần E audit | Sửa assertion/fixture/oracle không đi đúng nhánh |

T17/T18 là lane bảo trì legacy/diagnostic sau core; vẫn thuộc backlog, không tự bật/run những scripts đó. Không cần xác minh live để fix type/exit contract.

## Quyết định cần chốt — không biến thành hard-code mới

**DOB range:** random intent đã xác nhận; khoảng tuổi/năm chưa được người dùng chọn và repo chưa có policy. T03-A generator/fixture/readback test có thể chuẩn bị độc lập. T03-B nối default production chỉ sau khi được xác nhận earliest/latest hoặc minAge/maxAge. Không tự chọn 18–35, không cố định1998, không cài missing-range runtime blocker vào signup đang hoạt động rồi tuyên bố fixed. Chưa chốt range thì ghi T03-B WAITING-DOB-POLICY; tiếp tục các task khác, không khóa toàn kế hoạch.

**Log outage retention:** chọn giữ toàn pending đã nhận, không silent drop. T11 bound mỗi batch và retry frequency; không tuyên bố RAM bounded trong outage vô hạn. Giới hạn cứng cần spool/drop policy mới và phải hỏi riêng; không thêm cơ chế đó trong đợt bugfix này.

**Profile recovery:** giữ no-auto-retry/late-failure semantics hiện tại; không thêm explicit recovery flow ngoài report.

## Acceptance contracts

### T01–T04: auth/input/trial

- A01: actual login/signup với browser-channel overhead vẫn qua pacing; dùng abortableDelay cùng duration, không outer deadline=delay. Random trial delay giữ một sample.
- A05: deferred boundary đã entered tại post-submit waitForURL, fallback goto, DOB/OTP input và overlay read; Stop trả original reason trước khi resolver về, late result không action tiếp. Optional navigation lỗi thường giữ fallback policy; không biến mọi deadline thành flow khác.
- A03: hai unchecked boxes → cả hai checked; checked/hidden không bị click sai; click không đổi state → không Submit/success log.
- A02: uniform valid calendar dates trong range explicit; leap-year/invalid-range/RNG tests; chọn value trong dropdown đang mở, no positional/global fallback; một intended DOB xuyên retry và readback trước Continue.
- A04: initial/post-Skip read reject/timeout → unknown hoặc đúng typed failure, zero Upgrade; abort không bị catch thành absent.
- M02: engine shape skipped+fatal+verification:null → failed/error; intentional ineligible skip không fatal vẫn skipped, không đổi trial gate.

### T05: terminal outcome

- Account update success===true mới đánh intended outcome persisted.
- Throw hoặc {success:false}: in-memory failed đúng một lần, accountsFailed tăng1; không completed/skipped/stopped increment cho failed write; outcomePersisted=false.
- Giữ lỗi gốc main-only, trả reason hiện có INTERNAL_ERROR + safe details.failure=ACCOUNT_TERMINAL_PERSISTENCE_FAILED.
- Acquisition dừng, cleanup vẫn chạy. Failure này ưu tiên trong final verdict kể cả trước đó Stop/limit đã có; không generic rewrite mọi terminal precedence.
- DB có thể còn processing khi DB hỏng; không hứa persist failed-row thành công trong outage, không replay workload để sửa status.
- Hai workers/concurrent terminal/cleanup errors không nhân đôi counter; accepted=completed+failed+stopped+skipped khi workload đã settle, skipped đọc internal/evidence vì DTO chưa expose.

### T06: credential CAS

- CAS trên encrypted BLOB value, không updated_at độ phân giải giây; không upsert row đã delete.
- Auth flight share chỉ cùng snapshot/generation; old finally không clear flight mới.
- Session write giữ current metadata; diagnostic metadata write giữ credential blob.
- CAS miss/config replaced/deleted → old provider token không được return như token hiện hành, không fallback sign-in bằng credentials lỗi thời.
- Draft probe không persist; Multilogin self-rotation có thể làm diagnostic cache bỏ qua vì blob đổi, phải ghi cache-not-updated đúng, không claim monotonic version.
- Invalidate pending auth tăng generation; byte-identical ABA qua external delete/reinsert không được gọi là revision-guarantee tuyệt đối.

### T07: Start/log reset

- Latch trước await đầu tiên; snapshot config ở Start; double click →1run.start, không renderer logs.clear.
- Validation/active-owner/preflight failure giữ lịch sử cũ và log lỗi/preflight. Không clear sau khi workers đã chạy.
- Capture ticket trước preflight bằng exact persisted IDs + queued IDs + streamSequence; không rowid/time cutoff. Commit sau all-preflight-success/before workers chỉ delete old IDs; chi phí một lần/run O(số old IDs), không copy payload.
- Explicit Clear/retention trong lúc preflight không làm UUID ID cũ tái dùng cho log mới; ticket chỉ xóa exact old IDs, không range-delete. Ticket single-use theo run owner; không dùng ticket sau restore DB ngoài workflow.
- Main log reset và queue cùng owner; named LOGS_RESET event và start reply additive clearedThrough. Cả Dashboard/Logs giữ sequence>cutoff, invalidates old history request và reload history mới khi cần; không logs=[] vô điều kiện khi reply/event.
- Nếu commit reset lỗi: không start workers, giữ lỗi rõ. Không có deletion/fake reset success trên failed request.

### T08–T09: edit/save/load

- Dashboard autosave11→edit12→success11→fail12: current12, saved marker null, saving false khi queue của nó settle.
- Queue có một active save, một coalesced background-next và tối đa một pinned Start barrier. Start pinned snapshot không bị later edits đổi; waiter không chờ stream edits hết mãi. Snapshot bị supersede chưa persist không được trả success=true.
- Dashboard chỉ save automation vào settings đọc mới trong main transaction; không ghi whole stale storedSettings đè Settings page.
- All load continuations có epoch/generation; edited fields/drafts sau request không bị hydrate đè. Live progress mới không bị stale idle reply ghi đè.
- Settings save boolean true nghĩa persisted thật; follow-up refresh reject chỉ warning, không false commit status.
- Boot preferences dùng committed general snapshot/revision, không current draft và không apply khi save false.
- Plaintext input/value giữ nguyên; không xử lý race bằng xóa draft.

### T10–T12: route/logs

- T10 reject duplicate identical normalized route trước capacity; unique routes/FIFO giữ nguyên. Same host khác auth không tự đồng nhất exit IP.
- Password host:port:user:a:b phải giữ a:b; no silent truncation.
- T11 max50 rows/batch mặc định; failed threshold flush không lặp trên từng emit trước next scheduled time. Queue giữ FIFO/no duplication qua recovery.
- T11 flush/dispose failure được báo; không log “flushed” khi pending còn, không recursively log qua chính bus bị lỗi.
- T12 preclear unconfirmed push → Clear → dispose/attach → reject → empty SQL: row và error còn. Success cutoff loại old, giữ new; perf normalized/upsert không quay lại full rebuild.
- Canonical WARNING render warning label/style, không cast che WARN/WARNING lệch.

### T13–T16: dialogs/provider/delete/quit

- Export reject: busy/latch được giải phóng, error đúng session; close/reopen không cho export thứ2 khi export1 còn owned hoặc show result session cũ.
- Task A→B: không frame nào hiển thị receipt A dưới B; reject B → error, no stale data; canceled guard ở success/error/finally.
- New manual account provider=manual; bot canonical values tồn tại trong options. Legacy Outlook/Gmail edit notes giữ value cũ, không silent rewrite/migration.
- Account deletion dọn tasks/receipt-items/receipt/unsettled trong cùng transaction; failure rollback toàn bộ. Active-account guard giữ, purchased row/consumed_at và mutation approvals/bindings/intents nguyên vẹn.
- Quit1 pending→Quit2: cả hai preventDefault, stop/close chỉ1; final internal app.quit sau finish đi qua.

### T17–T19: legacy/test truth

- HTTP non2xx không thành authoritative legacy proof/snapshot dù body0.
- captureNextSignedRequest trả materialized draft từ Request; trigger reject không unhandled pending error.
- sendTaskAction chỉ explicit numeric0; không Number coercion.
- Diagnostic OTP readOtp(token,orderId,service) với DEMO, no missing getOrderStatus.
- Body/cleanup failure không exit0; không chạy live script main để test.
- Repair false-green: real Request fake; sleep-aware fake timers; duplicate valid schema payload; in-flight abort đúng spy; independent resource identity sets; no null-toBeDefined hay unflushed log assertions.

## Definition of done

Mỗi finding có ID→task→test→command/evidence; exact scope trong Plan. Test count baseline không phải tiêu chuẩn đủ. Full suite/typecheck/lint/build/selectors/harness trên cùng source cuối; ghi GUI/proxy/vendor tests chưa chạy. Không tự build installer/deploy hoặc suy executable user. T03-B chờ range phải còn open rõ, không báo toàn bộ30fixed nếu chưa hoàn tất.
