# Kế hoạch kiểm chứng từng step, truy nguyên lỗi và lập hồ sơ HTTP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans khi được duyệt triển khai. Mỗi delta: RED → sửa tối thiểu → GREEN → review → nghiệm thu đúng step. Không chạy hết flow để thay thế kiểm tra từng step.

**Goal:** Mỗi bước đăng ký/đăng nhập và 12 nhiệm vụ phải có bằng chứng riêng về thao tác, kết quả thực tế và task thưởng; lỗi phải được khoanh vùng trước sửa; các tài khoản vẫn chạy độc lập. Thu hồ sơ network đủ để chẩn đoán và chuẩn bị chuyển HTTP sau khi UI đa luồng đạt nghiệm thu.

**Architecture:** Giữ `AutomationRunService` sở hữu worker/mail/proxy/profile/Stop; giữ scheduler từng session và engine dùng session được inject. Bổ sung kiểm tra ngay tại các hàm hiện có, checkpoint theo step và recorder thụ động theo session; không thêm workflow engine, global phase barrier hay song song hai bộ UI/HTTP mutation.

**Tech Stack:** Electron/Windows, TypeScript, Playwright Core 1.62.1, Vitest, SQLite; recorder/fixture/validator hiện có được tái sử dụng.

**Spec:** Hai yêu cầu mới nhất của người dùng: kiểm tra từng step, lý do pass/fail, hướng khắc phục và ảnh hưởng tới step/luồng khác; thu request/API/HTTP/network quanh nhiệm vụ để chuẩn bị thuần HTTP **sau** khi đa luồng ổn định. Bằng chứng đầu vào: [báo cáo live đã đính chính](../reports/2026-09-09-selector-live-response.md).

**Status:** Đề xuất để duyệt. Lượt này chỉ lập kế hoạch; không sửa source, không chạy thêm live, không mua mail. Plan này thay thứ tự thực hiện phần còn lại của `2026-09-09-selector-first-repair.md`; không xoá các bản sửa/bằng chứng đã có. Những task cũ chưa làm không tự được đánh dấu hoàn thành.

**Bản thi công:** [Kế hoạch triển khai theo 17 task](2026-09-09-stepwise-implementation.md) chia các yêu cầu dưới đây thành file ownership, RED/GREEN, wiring và cổng nghiệm thu. Tài liệu hiện tại giữ vai trò spec/bằng chứng; không tạo thêm một flow hay danh sách công việc cạnh tranh.

**Thứ tự đọc:** §2 giữ bằng chứng đã có; §3–4 định nghĩa kiểm từng bước; §5 capture; §6 lỗi/khắc phục; §7 ảnh hưởng đa luồng; §8 task triển khai; §9 tiền/thời gian; §10 lộ trình HTTP. **Thứ tự thực hiện:** A0 khảo sát contract → A1/B1 theo ownership → B1p → A2+A2b → A3 từng cluster → A4 → từng gate live được duyệt. Nếu A0 cần dữ liệu live để chốt nghĩa, chỉ phép đo L2 nhánh hẹp sau các điều kiện capture/fence, không qualification toàn flow.

## 1. Ràng buộc và phạm vi

- R1 — Chỉ bước có đủ hậu điều kiện mới được ghi PASS; hàm return, click resolve, HTTP200 và task_status 4 là các tín hiệu khác nhau.
- R2 — Kiểm tra **trước khi đi bước kế tiếp**, không đợi hết `MissionGroup.act()` mới kiểm chứng tất cả.
- R3 — Gate thuộc tài khoản/session đó. A chờ response hoặc bị dừng không chặn B/C; tuyệt đối không `Promise.all` làm barrier cuối mỗi step giữa các worker.
- R4 — FAIL/UNKNOWN chặn bước phụ thuộc của tài khoản đó. Giữ kết quả đã chứng minh; không biến 7 bước đã pass thành fail vì bước8 lỗi, không xoá lịch sử lỗi nếu lần sau hồi phục.
- R5 — Timeout sau khi đã gửi mutation = kết quả chưa rõ, không đồng nghĩa chưa thực hiện. Không click/send/upload/generate/export hay mua mail lần hai để thử vận may.
- R6 — Mọi bản sửa cần lỗi tái hiện/test RED, đường sửa cụ thể, phạm vi ảnh hưởng, test step trước/sau và test peer. Chưa chứng minh nguyên nhân thì ghi phép đo phân biệt các giả thuyết, không viết fix giả định.
- R7 — Không reset/stash/rollback project; snapshot đúng file trước sửa, giữ dirty worktree/index. Không commit/push/delete evidence nếu chưa được yêu cầu.
- R8 — Giữ pacing, target/visible/enabled/non-inert guards, Stop và proof rules. Không tăng timeout để làm xanh; không force/Enter/JS fallback che control lỗi. Các chỗ cũ còn vi phạm phải được test riêng, không sửa hàng loạt.
- R9 — Không mua/test10–20 ngay. Mỗi lượt live có duyệt riêng về tài khoản, step, chi phí, trần retry/thời gian và cleanup. Không dùng account cũ hoàn thành task để giả nghiệm thu signup mới.
- R10 — Thu network chỉ của profile/session được tạo cho test và provider calls của workflow này; không bắt traffic toàn máy, không MITM/cài CA/tắt TLS, không replay packet hoặc signed credentials.
- R11 — Mục tiêu tương lai là API thực hiện nghiệp vụ tương đương; không coi gọi `do_action` nhận thưởng là đã upload/generate/export. Browser-required phải được giữ đúng tên nếu chưa có cách thay thế được kiểm chứng.

## 2. Những gì đã biết — không làm lại mù, không tuyên bố quá bằng chứng

Run mới nhất `fd05b724-383d-4e0e-a94d-2bdb50e1b162`: 3 mail mới; wrapper278.295s; cả hai cổng nghiệm thu3 đều FAIL. Có2 receipt server12/12, **không có bằng chứng2 luồng không lỗi/export hoàn chỉnh**.

| Hạng mục | Đã chứng minh | Còn thiếu / không được suy ra |
| --- | --- | --- |
| Mail/profile/cleanup |3 mua xác nhận,3 profile start/stop xác nhận, tài nguyên cuối0,407 fingerprint không đổi|Không chứng minh mọi UI step thành công|
| Đăng ký/OTP |Runtime cả3 báo authentication-otp qua;2 tài khoản có snapshot đăng ký status4|Account1 không có snapshot thưởng; auth/trial chỉ HTTP200 và log chưa đủ kết luận nguyên nhân bootstrap|
| Bootstrap account 1 |Recorder còn hoạt động;0 request thưởng `/task/v1/task_list`;4 request khác `lv/v2/task/get_task_list` HTTP200 với list rỗng|Chưa rõ route/entry/overlay/eligibility/session nào gây thiếu request; không thay parser sang list khác|
| Account2/3 nhiệm vụ |9 action proof err_no0 mỗi account và snapshot mới xác nhận12 key status4|Không chứng minh PWA cài thật, ảnh đã apply, download hoàn tất hoặc không có toast lỗi|
| Export account 3/worker 1 |Click, reward HTTP200/err_no0 lúc02:55:26.213; asset query và object GET HTTP200|Không có log download; người dùng thấy export lỗi. Binary/client/toast outcome không được lưu, chưa biết lỗi ở render/encode/save hay download|
| Export account 2/worker3 |Reward err_no0 lúc02:55:30.367; có download event lúc02:55:32.565|`suggestedFilename()` không chứng minh file tải xong|
| Notification |Mỗi account có lần err_no0 sau đó thêm8001001|Không tự coi request thừa là vô hại; phải tìm thao tác nào phát lại và tác dụng|
| Selector-first |54 test tập trung,3 profile Multilogin local probe, live2 account không ghi DOM timeout|Chưa có đối chứng đủ để nói sửa helper đã loại mọi lỗi hoặc đạt10/20 luồng|
| Capture |5300 response,68 task_list,20 do_action,3 file đóng,0 dropped/I/O error|1725 body omitted; thiếu SSE/WS, artifact body và lỗi client; không gọi là toàn bộ dữ liệu cần thiết|

### 12 task: giữ kết quả thưởng đã chứng minh, tách khỏi step thực tế

Tiền tố của mọi key dưới đây là `capcut_web_`. Thời điểm là **snapshot đầu tiên status4**, ngày09/09 (+07); không phải thời điểm file/hình ảnh hoàn tất. Account1 chưa có task snapshot nên các task sau bootstrap là NOT_RUN/BLOCKED, không gán lỗi cho từng mission.

| Task key (suffix) | Liên hệ thao tác | Account2 | Account3 | Bằng chứng thưởng |
| --- | --- | --- | --- | --- |
|newbie_register|Đăng ký|02:51:51.872|02:51:51.702|Snapshot đăng ký; không tạo do_action giả|
|pwa_install|PWA|02:52:36.057|02:52:40.393|Action err0 → snapshot 4|
|push_authorize|Thông báo|02:52:50.181|02:52:54.501|Action err0 → snapshot 4; còn request8001001|
|inspiration_generate_done|Inspiration|02:53:13.422|02:53:17.010|Action err0 → snapshot 4|
|design_studio_ai_chat|Chat Design|02:53:33.849|02:53:38.292|Action err0 → snapshot 4|
|design_studio_upload_img|Upload canvas|02:53:36.609|02:53:41.130|Action err0 → snapshot 4|
|design_studio_canvas_edit|Gửi canvas edit|02:53:57.242|02:54:00.703|Action err0 → snapshot 4; kết quả ảnh riêng|
|design_studio_picture_creation|Task cha Design|02:53:57.535|02:54:01.076|Server-derived; không thêm một thao tác/generate|
|video_studio_send_msg|Gửi Video Studio|02:54:22.694|02:54:26.315|Action err0 → snapshot 4|
|video_studio_generate_done|Generate Video Studio|02:55:26.275|02:55:21.756|Action err0 → snapshot 4; asset/node cần đối chiếu|
|video_studio_export|Export|02:55:30.548|02:55:26.330|Action err0 → snapshot 4; KHÔNG phải artifact pass|
|video_studio_creation|Task cha Video|02:55:30.808|02:55:26.452|Server-derived; không thêm action|

Đây là9 action trực tiếp + đăng ký +2 task cha. Không ép đủ12 do_action. Thành công ở một lần quan sát là bằng chứng cho lần đó, không tự chứng minh điều kiện nào là nguyên nhân cần/đủ; việc đó cần test thay đổi một điều kiện.

## 3. Quy trình kiểm từng step

Mỗi tài khoản có chuỗi riêng:

```text
kiểm điều kiện vào → chụp/ghi BEFORE + gắn listener
→ một thao tác → response/client outcome → proof task (nếu có)
→ snapshot mới (nếu có) → ghi verdict + AFTER → step tiếp theo
                     ↘ FAIL/UNKNOWN: chặn bước phụ thuộc, thu hiện trường an toàn

Worker A: A1 → A2(chờ) → A3
Worker B: B1 → B2 → B3 → B4         không chờ A2
```

### 3.1 Bốn trục kết quả, không gộp bằng một chữ success

1. **Action:** đã gửi đúng thao tác vào đúng page/target chưa? `dispatched` không phải pass nghiệp vụ.
2. **Business/client:** đúng message/job/asset/panel/file đã đạt hậu điều kiện chưa? Download-started khác download-completed.
3. **Reward:** đúng action_key, err_no0 và snapshot mới status4; đăng ký/parent có rule snapshot riêng.
4. **Evidence/coverage:** quan sát đủ để kết luận chưa? Thiếu critical response/toast/download outcome = UNKNOWN, không PASS.

Verdict step: PASS / FAIL / UNKNOWN / BLOCKED / NOT_RUN. SKIP chỉ khi đã chứng minh pre-completed hoặc nhánh không áp dụng; phải ghi lý do, không tính như bước vừa được thực thi. `RECOVERED` là chú thích của attempt sau, không xoá failure trước.

Step nhập chữ không đòi task receipt. Step gửi chỉ cần client/server nhận đúng message; step generate kế tiếp mới xác minh kết quả generate. Task thưởng có thể hoàn tất sớm hơn nghiệp vụ: ghi ngay reward pass nhưng không cho nó làm business pass.

### 3.2 Phiếu bắt buộc cho từng step/attempt

```yaml
identity: run / accountAlias / workerAlias / sessionAlias / pageAlias / stepId / attempt
source: buildHash + inputFixtureHash + selectorRevision
before: prerequisite-result + sanitized-screenshot + scoped-DOM-state
action: target + actionSequence + dispatchedAt + settledAt + signal-state
network: requestIds + initiator-links + response-status + business-code + body-state
after: observed-client-postcondition + sanitized-screenshot + artifact-reference
reward: taskKey + proofAt + snapshotAt + taskStatus   # not-required for typing etc.
verdict: PASS / FAIL / UNKNOWN / BLOCKED / NOT_RUN
reason: expected vs actual + evidence-file/record references
cause: confirmed / hypothesis / measurement-needed
impact: dependentSteps + affectedTaskKeys + currentSession + peerScope
next: exact diagnostic-or-fix + covering-tests + retry-authority
timing: ownQueueMs / activeMs / remoteWaitMs / captureMs / humanPauseMs
```

Không dùng nội dung secret làm ID. Screenshot/DOM/network cùng immutable session và step. `pageAlias` mới khi popup; không suy alias từ thứ tự file hay receipt cuối. Ghi ánh xạ ngay khi tạo session và trong capture-start.

### 3.3 Gate chẩn đoán và cách tránh chạy full flow

- Chọn `stopAfterStep` và các prerequisite đã được duyệt **trước** lượt test. Chạy đúng các hàm production của nhánh đó; không viết bản automation khác cho test.
- Mặc định chẩn đoán1 attempt/step,1 round; không tự replacement session/generate lại. Các retry hiện có trong helper/mission cũng phải được audit và đếm, không chỉ đặt maxRounds1 ở ngoài.
- Ở step khỏe: kiểm/ghi verdict ngay, rồi mới chuyển step thuộc phạm vi đã duyệt. Step lỗi: không chạy các bước sau của account đó; peer tiếp tục các step của chính nó đã được duyệt.
- Muốn xem bằng mắt: các kiểm tra tự động vẫn diễn ra ở từng microstep. Gate chờ người kiểm tra chỉ dùng tại boundary đã release cả foreground/editor; hiện group giữ editor lease suốt `act()`, nên bản đầu dùng **stop-after-step và unwind**, không chèn pause giữa group. Nếu cần tiếp tục in-place sau từng microstep, phải duyệt task tách lease ởA2 trước. Không sửa source lúc session đang chờ; gate an toàn tối đa30s, quá hạn đóng đúng profile. Khôi phục prerequisite phải đọc trạng thái mới, không giả DOM/asset còn sống.
- Nếu timeout command/quarantine: không chụp DOM bằng thêm lệnh trên session chưa an toàn; dùng ảnh last-known trước action, response đã thu, status crash/close; cleanup do owner xử lý. Không “lấy thêm ảnh” thành nguồn hang thứ hai.
- Ghi phần đã pass trước lỗi và hiện trường trước cleanup. Không đóng page khi export/download đang pending trừ Stop hoặc deadline; phải ghi `cancelled-by-cleanup` nếu cleanup cắt nó.
- Account test đã tạo có thể dùng lại **chỉ để chẩn đoán đúng step và chỉ khi được duyệt**. Reward đã xong không thể làm lại một cách hợp lệ để chứng minh signup/first-time action; test fresh riêng khi thực sự cần.

## 4. Ma trận step — điều kiện, kiểm chứng, lỗi và bước bị chặn

R = reward proof+fresh snapshot như mục3. C = client/business postcondition. Mọi hàng có BEFORE/AFTER và request chain; guard/typing không tự tạo request nghiệp vụ. Task cha kiểm riêng từ server, không thao tác.

### 4.1 Tài nguyên, đăng ký/đăng nhập và bootstrap

| Step | Thao tác / điều kiện vào | PASS phải có | FAIL/UNKNOWN phân biệt / việc kiểm tiếp | Phạm vi bị chặn |
| --- | --- | --- | --- | --- |
|S00 preflight|Build/ABI, credentials configured, runner không chạy, disk/capture limits, approval|Đúng build; DB test cô lập; caps; no-active-owned-resource; recorder fixture pass|ABI/config/disk/thiếu duyệt: không gọi provider; sửa cấu hình trước|Toàn lượt chưa được start; không mua mail|
|S01 mailbox|Một acquisition trong cap đã duyệt|Một mailbox reservation duy nhất cho account; provider xác nhận; mapping OTP riêng|Request timeout sau mua = ambiguous; kiểm order/reconciliation bằng khả năng provider có thật, không mua lại|Account đó; cap chung vẫn bị giữ cho khoản ambiguous|
|S02 proxy/profile|Có mailbox/credential đúng; lease đúng|Lease độc quyền; ID profile từ callback; CDP/page đúng; renderer responsive; ghi recorder trước auth navigation|Proxy/DNS/launch/CDP/viewport tách loại; chỉ stop đúng ID; không stop-all|Account; cleanup không xác nhận có thể kích hoạt run safety stop hiện có|
|S03 auth email|Trang email đúng, input duy nhất, sạch overlay|Fill readback bằng giá trị được inject (log chỉ match boolean); Continue một lần; heading nhánh signup/login tương ứng và response check-email cùng request|Selector/typing sai vs server reject vs timeout; ghi nhánh trước khi nhập password|Password/OTP và toàn mission của account|
|S04 password/signup/login|Nhánh S03 đã xác nhận; existing-only không signup|Readback field; submit một lần; response nghiệp vụ theo contract và chuyển form hợp lệ|Wrong password, account-exists, auth challenge, response opaque: không gọi lại auth vô hạn|Các step auth còn lại; không đổi identity để né reject|
|S05 birthday nếu có|Đúng form mới sinh|Year/month/day readback; Continue; form chuyển đúng|Click dropdown resolve nhưng giá trị chưa đổi: fail field này; không bỏ qua vì UI biến mất|OTP/workspace; nhánh không có form ghi SKIP có chứng cứ|
|S06 OTP|Yêu cầu xác minh của đúng mailbox|OTP đọc sau watermark yêu cầu, account binding đúng; submit; server verification accepted; UI hết challenge|Mã cũ/sai/timeout/đọc nhầm mailbox tách loại; không log mã/payload; resend cần policy+duyệt, không tự mua mail|Workspace/trial/task; không kéo OTP account khác|
|S07 workspace/auth|Sau auth accepted|Workspace marker đúng và server auth identity nhất quán (opaque ref); không còn onboarding block|URL `/my-edit` đơn lẻ không đủ; đối chiếu server rejection, overlay, page redirect|Trial/bootstrap; auth chưa rõ thì UNKNOWN|
|S08 trial/readiness|Session auth đã xác nhận|Điều kiện trial cần cho workflow được đọc rõ; đóng overlay có hậu kiểm|Eligibility business reject khác modal chưa đóng; không mua gói/subscription để test|Nhánh cần trial/credits; vẫn ghi auth pass|
|S09 reward bootstrap|Listener đã attached; route/task entry thuộc page này|Expected reward task_list request, HTTP/business/schema hợp lệ,12 key duy nhất; row entry/popup đúng|0 request vs HTTP reject vs empty/body missing/parsefail riêng. `lv/v2/task/get_task_list` không thay endpoint thưởng|PWA/notifications/Design/Video của account; auth không bị viết lại thành fail|

S09 tách navigation → task-entry lookup → click → popover visible → reward request → body parse thành các checkpoint con. Không gọi reload trong chẩn đoán trước khi lưu lỗi của nhánh đầu; reload có sẵn là attempt phục hồi được ghi riêng và chỉ thực hiện nếu đã duyệt.

### 4.2 PWA, thông báo, Inspiration và Design Studio

| Step | Điều kiện / hành động đúng | PASS và điều không được suy ra | Lỗi cần phân biệt / ảnh hưởng |
| --- | --- | --- | --- |
|S10 PWA|Đúng task row và trạng thái Go/Claim/pre-completed|R cho pwa; C ghi riêng prompt có/không và kết quả install thực sự nếu quan sát được|Code đang phát `appinstalled` tổng hợp: không gọi là cài app thật. Chặn bước kế nếu contract C của nhánh chưa được chốt; không sửa mọi event mù|
|S11 notification|Permission/context riêng → new tab → Go/Allow/row theo nhánh đã đo|C permission/grant + subscription state (hoặc contract chỉ rõ không yêu cầu); R notification; từng mutation một checkpoint|Permission granted≠push subscribed. Sau R0 không tiếp tục click để lấy8001001; cần map request thừa về đúng action. Đóng tab có hậu kiểm; không đóng peer|
|S12 Inspiration mở/fill|Đúng template → chip nếu có → slot/editor đúng|Giá trị prompt readback và workspace chuẩn bị; ảnh BEFORE/AFTER|Chip/slot absent không tự nghĩa đã đủ; classify expected optional vs missing. Shared clickSend ảnh hưởng chat nữa|
|S13 Inspiration send|S12 pass, Send enabled/hittable|Một send → app accepted/message ID → đúng workspace/tab; R inspiration|Không có workspace/ack thì UNKNOWN/FAIL, không “tiếp tục trên tab hiện tại” vô điều kiện. Không đợi generate nếu contract task chỉ cần accepted; kết quả generate ghi step riêng nếu cần|
|S14 Design chat|Trang `/ai-design` đúng, không dùng workspace Inspiration; panel/editor đúng|Typed readback → send enabled/hittable → request/message ack; R chat|Editor trống có thể do rerender/nhầm panel: cần message correlation. Disabled→Enter fallback bị cấm; chặn upload cho diagnostic account này|
|S15 canvas upload|File mẫu có hash, toolbar Canvas tools đúng|Listener filechooser trước click → setFiles đúng → upload response/asset đúng → ảnh mount trên canvas; R upload|Chooser/setFiles return≠upload xong. Upload lỗi chặn select/edit; không reupload khi response chưa rõ; ảnh hưởng Design parent|
|S16 layout/selection|S15 asset tồn tại; pricing/chat không che|Canvas có geometry; đúng ảnh được chọn; opener đúng target ready. Nếu đã chọn đúng thì không click lại area|Height0 responsive khác evaluate hang. Center `#graphic-editor-render` không đủ chứng minh chọn ảnh. Lỗi chỉ chặn canvas branch|
|S17 mở prompt|S16 opener visible/hittable|Focus opener → Tab → đúng panel expanded, không inert/aria-hidden ở cả ancestor|Timeout không fallback; duplicate panel/ancestor inert phải fail trước typing|
|S18 nhập canvas|S17 pass, editor/focus/caret đúng|Input expected exact normalized text readback, không chỉ `includes`; ghi boolean/length, không raw secret|Wrong field/duplicate/stale text: không bấm Send. Giữ pacing và preserveFocus đã kiểm chứng|
|S19 canvas send/ack|S18 pass; Send scoped/visible/enabled/hittable|Một send → ack scoped cùng panel và request/message ID; R canvas edit|Global Stop-generating của chat không phải ack canvas. Response thưởng0≠ảnh đã chỉnh; thiếu ack không chỉ log rồi return|
|S20 canvas result/parent|S19 accepted; job/asset liên quan được quan sát|C job terminal không lỗi + target update nếu flow yêu cầu apply kết quả; parent Design status4 sau children theo quan hệ server|Không bấm Apply/generate thêm nếu contract không yêu cầu. Chưa biết result terminal thì capture bổ sung, không suy pass từ reward|

### 4.3 Video Studio, export và kết thúc

| Step | Điều kiện / hành động | PASS phải có | FAIL/UNKNOWN / ảnh hưởng |
| --- | --- | --- | --- |
|S21 open/mode|Đúng studio/page/credits, overlay clear|Mode readback thật là Image; đúng editor; node IDs BEFORE|Label click chưa đổi mode: không gõ/send; template node cũ không là generation mới|
|S22 type/send|Editor đúng; prompt được readback; Send enabled|Một submit; client ack và request/message/job binding; R send_msg|Hiện waitEnabled return bị bỏ: test fail trước patch. Không resend khi accept chưa rõ|
|S23 confirm/generate|Job từ S22; phân biệt card credits với upsell|Confirm đúng card nếu cần; job terminal + NEW node đúng asset; node ready, không skeleton; R generate_done|Node xuất hiện≠job complete; HTTP200≠business OK. Upsell không bấm Continue mua gói; generate lỗi chặn export|
|S24 select/export-control|S23 asset ready hoặc prerequisite asset đã chứng minh|Đúng node selected → toolbar đúng node → một Export duy nhất/enabled/hittable|`ensureNodeToolbar` không nuốt fatal; tooltip fallback phải bounded/cancellable, không force. Sai target ảnh hưởng export, không xoá proof send/gen|
|S25 export request|S24 pass; listener download/client error/network đã có|Một click → đúng asset-query/export job; response business hợp lệ; menu nếu cần đúng định dạng. R export ghi RIÊNG|Click thành công/assetHTTP200 không làm S26 pass. Captured ret/error_code chưa giải mã thì UNKNOWN, không gán0|
|S26 export hoàn tất|S25 cùng asset/session|Download started **và** hoàn tất không failure, file tồn tại/bytes/hash/MIME hợp lệ trong thư mục account riêng; hoặc đường export không download có contract tương đương được xác minh rõ|Không có event, save/encode/toasterror, cancelled, truncated file đều có outcome riêng. Không fallback request tải file để làm mất dấu lỗi UI; không đóng profile sớm|
|S27 reward final|Các leaf/parent được đối chiếu|12 key duy nhất status4, receipt mới đúng account/session/run; task cha có rule snapshot,9 action leaf phù hợp|Giữ reward12/12 ngay cả S26 fail nhưng end-to-end không PASS; không trộn hai counter|
|S28 finalize/cleanup|S26 đã terminal hoặc budget/Stop|Persist step verdicts + coverage + receipt → detach listener → đóng đúng profile → release proxy/mail → tài nguyên0|Recorder/DB lỗi khác export lỗi; stop unconfirmed không xoá session ownership hoặc báo0 giả|

Thứ tự nhiệm vụ giữ PWA → notifications → Inspiration → Design chat/upload/canvas → Video send/generate/export. Parent không chèn mutation. Các step result bổ sung là quan sát/verify, không tạo thêm việc billable.

## 5. Hồ sơ network: thu gì và gắn vào step như thế nào

### 5.1 Phạm vi “tất cả request quanh nhiệm vụ”

- Attach từ lúc nhận browser context **trước navigation auth**, theo mọi tab/popup/frame/worker/service worker thuộc profile test; detach sau postcondition cuối và thu pending theo deadline. Không để mỗi mission tự bật recorder muộn.
- Giữ metadata của mọi request quan sát được trong phạm vi đó, kể cả static, preflight OPTIONS, redirects, retry, telemetry, failed/cancelled, cache/service-worker. Phân loại sau capture; không lọc trước rồi kết luận “không có request”.
- Provider Gmail94/OTP/proxy/Multilogin nằm ngoài browser: thu riêng qua HttpClient boundary của cùng workflow, chỉ method/route template/timing/status/business category/order-ref và binding; không thu nội dung inbox/mãOTP/password ra log.
- Với target không attach được, request trước attach, service-worker không quan sát được hoặc transport không hỗ trợ: ghi `coverage-gap` rõ. Không hứa toàn bộ byte TCP/IP/DNS/TLS vì browser observer không quan sát được mọi tầng đó.

### 5.2 Record tối thiểu

| Loại | Trường giữ lại |
| --- | --- |
|Identity|run/account/worker/session/page/target; captureId; requestId scoped theo target; sequence; UTC + monotonic time; source hash|
|Request|method; origin/path template; query tên/type và safe value/opaque ref; resource type; headers thực sự gửi nếu extra-info khả dụng; post body format/shape/size; initiator; redirect hop|
|Response|status/headers arrival ghi NGAY; timing; protocol/cache/SW flags nếu nguồn có; business code path-specific; body state/size/hash; không chờ body để mới ghi HTTP status|
|Terminal|loadingFinished/requestfailed/cancelled; failed sau đã có headers vẫn phải ghi; error category + safe browser code; pending tại cleanup đánh dấu incomplete|
|SSE/WS|connection/channel + direction/frame/event sequence/timestamp; chunk/frame count/size; payload có redaction hoặc encrypted; last event/close/error; reconnect mapping|
|Binary/upload|Multipart tên/type/size/hash/part-order; bytes nhạy cảm không đưa repo. File mẫu test và artifact cần nghiệm thu lưu riêng; magic/MIME/bytes/hash để kiểm file, không chỉ status200|
|Client|pageerror/console error/message code, UI toast/dialog trước-sau, navigation/crash/close, selection/readback/job/node và download lifecycle|

Network extra-info có thể tới trước request hoặc sau redirect. Correlate bằng `(captureId,targetId,requestId,redirectHop)` và buffer giới hạn; không drop header chỉ vì record gốc chưa đến. Nếu field không có, lưu `unavailable` chứ không đoán.

### 5.3 Cửa sổ/correlation

- `step-begin` trước prerequisite/navigation; `action-dispatched` trước side effect; `client-result`, `reward-proof`, `snapshot-observed`, `step-end` là record riêng.
- Request giữ `originStep` lúc bắt đầu. Response muộn vẫn theo request cũ, không gán nhầm vào step đang active.
- Window xem xét gồm2s trước action và ít nhất3s sau terminal business; đây là cửa sổ phân tích từ recorder luôn bật, **không sleep thêm cho mọi step**. Job/stream/asset ID giữ quan hệ xuyên nhiều step lâu hơn window.
- Request gần thời gian chỉ là `temporal-candidate`, chưa phải nguyên nhân. `confirmed-related` cần initiator/action ID/job ID/asset ref hoặc đối chứng một biến. Background không bị gán làm bằng chứng nhiệm vụ.
- Không chờ global `networkidle`. Step-end dựa hậu điều kiện nghiệp vụ + request liên quan đã settle; background còn sống được thống kê. Missing critical body/frame → UNKNOWN, không kéo cả group chạy tiếp.

### 5.4 Dữ liệu đọc được và dữ liệu bảo mật

- Report/fixture: token/cookie/password/OTP/signature/email/ID cá nhân phải mask; giá trị động dùng opaque ref ổn định **trong cùng account/session** để vẫn thấy dependency; không trộn ref giữa hai tài khoản.
- `err_no`, `ret`, `status_code`, `error_code`, task_status phải giữ numeric hoặc numeric-string **chỉ tại đường JSON đã xác minh là mã nghiệp vụ**. Không bỏ toàn bộ chữ `code` khỏi bộ lọc vì auth `code` có thể là OTP/authorization code.
- Lưu nguyên tên/type/nguồn field để chuẩn bị API, không giữ giá trị credential vào manifest replay. Bản redacted không thể dùng như một request đầy đủ; phải ghi rõ missing secret/session fields.
- Nếu cần payload nguyên bản để giải nghĩa field opaque, chỉ bật tầng mã hoá local qua OS vault sau duyệt riêng; path theo run/account/session/capture, trần file/queue, access audit, không log plaintext, không copy raw vào repo/chat. Không bật `CAPCUT_CAPTURE_PRIVATE` cũ nguyên trạng: còn path account-scoped và coverage/queue gaps.
- BEFORE/AFTER screenshot của panel thao tác được che email/password/OTP/URL ký; ảnh lỗi toast có thể chứa prompt/usertext nên phải sanitize hoặc để encrypted riêng. Không sửa ảnh để thay đổi kết quả; bản dùng báo cáo chỉ mask bí mật. Nếu không thể mask an toàn: lưu metadata và nêu thiếu ảnh, không lộ secret.
- Không tự xoá evidence từ lượt cũ. Dọn retention phải chỉ đúng thư mục owned-run, báo cho người dùng trước; không gọi prune50 toàn cục làm mất ảnh peer khi test nhiều step.

### 5.5 Độ phủ và chi phí recorder

- Mỗi step/session có `seenRequests`, `headersRecorded`, `finished`, `failed`, `pending`, `bodyStored`, `bodyOmittedByReason`, `unmatchedExtraInfo`, `targetAttachFailures`, `streamFramesSeen/Stored`, `dropped`, `ioErrors`.
- Headers/status là record riêng trước body-read; `requestfailed` sau response cũng được ghi. Sau close đối chiếu accounting, không dùng responses+incomplete để tự coi bytes đủ.
- Critical chain cần100% request/response header có liên kết và đầy đủ field/outcome quyết định pass/fail. Body static bị bỏ có lý do không phá critical proof; critical body bị bỏ thì step UNKNOWN, không tự mua lượt khác.
- Giới hạn đề xuất để kiểm OFFLINE trước:2 body reads chưa settle/session;4MiB queued serialized events/session;2MiB/body thông thường;8MiB/stream/step;128MiB/file,256MiB/session bao gồm ảnh/artifact; tối đa2 target CDP body buffers đồng thời/session, target khác vẫn thu metadata. Đây là budgets chẩn đoán, không tăng mission deadlines.
- Slot của body-read timeout phải giữ cho tới promise gốc settle; không nhả slot chỉ vì outer timeout rồi tạo thêm read vô hạn. Không xếp hàng tất cả body đã quá deadline; ghi omitted và bỏ read đó. CDP/browser buffer ngoài JS vẫn phải đo RSS; byte cap sau `response.body()` không đủ để cam kết hard memory cap.
- Với body không Content-Length/chunked: thu có giới hạn bằng khả năng transport đã test; không mặc định empty. Không có cơ chế đọc bounded đáng tin thì ghi unavailable/omitted và chuyển phép đo riêng trước live.
- Queue/backpressure lỗi → giữ metadata/terminal trên kênh chẩn đoán, báo coverage không đạt; không để recorder giữ foreground lease. Dừng bắt đầu mutation mới của account đó tại gate kế tiếp. An toàn tài nguyên và cleanup vẫn ưu tiên.
- Ước lượng disk tối đa trước duyệt:256MiB ×3=768MiB; ×10=2.5GiB; ×20=5GiB, chưa kể browser profiles. Cần free disk ít nhất2× tổng cap + dung lượng profile đo được; RAM không suy ra từ cap disk.3/10/20 phải đo peakRSS/event-loop-lag/captureOverhead riêng.

## 6. Vì sao lỗi, đo gì tiếp, sửa gì và ảnh hưởng gì

`Confirmed` dưới đây nói về lỗi đã thấy trong code/bằng chứng, **không** tự khẳng định là nguyên nhân mọi lỗi live. Các branch hypothesis chỉ được chọn sau phép đo phân biệt.

| ID / step | Bằng chứng và mức chắc chắn | Phép đo/test phân biệt nguyên nhân | Sửa được phép sau chứng minh | Tác động và cổng hồi quy |
| --- | --- | --- | --- | --- |
|F01 — S25/26 báo export xong quá sớm|Confirmed: chỉ dùng download event/suggestedFilename; account 3 không event vẫn reward12|Fixture export reward 0 + download error/no event phải không business-pass; fixture event rồi failure/truncated/cancelled. Capture toast, encode/download lifecycle trước cleanup|Tách reward/business; chờ terminal download/artifact, đổi log started/completed. **Không** đổi server task_status từ4 thành1 để che sự khác nhau|Video export+final báo cáo+cleanup; regression send/gen không mất proof; file accountA không bị B dùng/ghi đè|
|F02 — S26 lỗi client người dùng thấy|Observed: UI export lỗi; asset-query và objectHTTP200 không đủ chỉ nguồn|S25 request→asset response→client toast/pageerror→download-start→failure/completed; so account 3 với account 2 cùng build, field khác nào, không đổi nhiều biến|Nếu toast business reject: phân loại đúng và không click lại. Nếu save/cancel/path: sửa lifecycle/path ownership. Nếu encode/render: sửa chỗ đã đo hoặc báo vendor defect. Chưa đủ evidence thì thiếu đúng tín hiệu nào được ghi, dừng mutation|Không đụng auth/scheduler. Export fail không xoá task trước; cleanup không cancel tải đang chạy trước deadline|
|F03 — S09 reward request không phát|Confirmed:0 reward request; alternate task endpoint trả empty; capture vẫn chạy|Chụp task-entry/overlay/route before; record exact click target+visible/hit; server auth/eligibility response codes safe; popup before/after; request coverage. Fixture wrong route/filter/delayed request/rejected/empty/malformed|Overlay/selector nếu được chứng minh; filter nếu request thật bị miss; parser nếu body đủ nhưng parse sai; server eligibility thì báo đúng điều kiện. Không tăng30s hoặc dùng alternate empty list|Bootstrap tất cả accounts, PWA/notifications task entry; auth logic giữ nguyên nếu không phải nguồn lỗi|
|F04 — S14/19 false Send success|Confirmed: clickSend disabled→Enter→true; canvas ack global Stop-generating|RED: disabled không input; wrong panel có Stop không ack; typed wrong/stale không send; ack missing không return success|Bỏ Enter fallback, return/throw loại rõ; scope ack đúng panel/message. Timeout có thể đã dispatch thì không send lần2|Inspiration+chat+canvas; test cả3 caller cùng helper, readback/guards/pacing|
|F05 — S16/17 readiness không nhất quán|Confirmed: waitNotInert chỉ node trong khi guard xét ancestor; lịch sử zero-height/hang|Nested inert/ariahidden/duplicate/zeroheight→ready; responsivefalse khác promise never settles; chọn sai canvas object|Sửa predicate cùng guard; chỉ sửa layout sau khi snapshot geometry chỉ nguyên nhân. Không forceCSS hoặc bấm center mặc định|Canvas focus/typing/send; người dùng vẫn giữ lịch sử timeout; native command fatal không bị biến false|
|F06 — S22/24 nuốt lỗi / bỏ kết quả|Confirmed: Video Send bỏ boolean waitEnabled; ensureNodeToolbar catch-all; hover force/raw timeout|RED: disabled→no send, native/outertimeout/Stop→no next read/hover/click; ordinary notfound có branch rõ|Kiểm enabled, propagate Stop/fatal; hover timeout8s/signal + outer9s, native timeout normalized; không force|GenerateImage dùng ở send/gen và export-prerequisite: không tạo ảnh thêm khi đã có asset đúng|
|F07 — S11 request notification thừa|Observed:0 rồi8001001 mỗi account|Gắn ID từng Allow/Go/row event với do_action; kiểm snapshot sau action đầu trước action tiếp; ghi sender/request initiator|Skip action còn lại chỉ khi đã có proof+fresh status đúng và C đạt; không bỏ permission/subscription check|PWA/popover/shared row; chứng minh không bỏ nhầm first-time notification|
|F08 — Capture/normalizer sai contract|Confirmed: v2 event request có URL object, response riêng; normalizer không join nhưng object truthy có thể gáncaptured; codes bị che quá rộng|RED nối theo capture/request/hop; orphan→incomplete; URLunknown→unmapped; same ID hai capture không lẫn; OTP request không leak nhưng response code giữ đúng|Sửa normalizer v2/v3 pairing, schema-aware redactor; registry không promote nếu chỉ có URLtruthy/fixture|Mọi phân tích/futureHTTP; không đổi source network request; secret-scan fixtures|
|F09 — Capture tạo chậm/hang|Confirmed code risk: timeout wrapper nhả logical slot trong khi body gốc vẫn pending; synchronous private encryption; no honest final close summary|Fake never-resolving reads,burst,disk error,backpressure,lateclose; recorderON/OFF local3/10/20|Permit giữ raw promise, bounded queue, metadata priority, exact omission categories, truthful close summary. Không sửa task timeout để bù overhead|Chung mainprocess/disk nên có thể ảnh hưởng peers; không serial mission để recorder theo kịp|
|F10 — mutation outcome unknown có thể bị lặp|Confirmed model gap: UnsettledTaskProof chỉ chứa proof err0; lost-response không có proof nên retry có thể gọi lại|RED crash/Stop/networkloss sau dispatch trướcproof; khôi phục account không repeatclick/buy/generate|Diagnostic fail-closed/no auto-retry; trước enable recovery phải có durable intent/unknown fence riêng, không ngụy tạo ActionProof|Runner/repo/recovery toàn bộ9leaf; scope rộng nên task riêng với migration/rollback/data tests nếu cần|

### 6.1 Quy tắc lựa chọn fix

Mỗi lỗi có phiếu ngắn: **expected → actual → request/client evidence → source path → giả thuyết → phép thử loại trừ → delta → regression → phạm vi retest**. Nếu hai giả thuyết còn phù hợp thì chưa được sửa production theo một giả thuyết. Một lượt đo chỉ trả lời một câu hỏi; không đồng thời đổi click/typing/auth/scheduler/capture.

Nếu lỗi không tái hiện: giữ phiếu và capture bất thường, đánh dấu `not-reproduced`, không `fixed`. Nếu thiếu dữ liệu: sửa đúng điểm thu dữ liệu rồi kiểm recorder bằng fixture trước, không mua batch để thử recorder. Nếu nguyên nhân nằm vendor: ghi request/response/client contract chứng minh, phân loại fail rõ; không bypass restriction hay spam request.

## 7. Ảnh hưởng giữa step và giữa luồng

### 7.1 Chính sách lỗi

| Tình huống | Account đang lỗi | Các step đã pass | Worker khác |
| --- | --- | --- | --- |
|Prerequisite fail trước mutation|Không dispatch; BLOCKED các bước sau; exact cleanup|Giữ nguyên bằng chứng|Tiếp tục độc lập|
|Client/business fail đã rõ|Fail step; không giả rewardfail nếu server đã ghi nhận; dừng dependency|Giữ; đánh dấu lần thử lỗi|Tiếp tục|
|Có thể đã mutation, chưa rõ outcome|Lưu UNKNOWN/intention; chỉ reconciliation đọc; không UI/HTTP replay|Giữ proof cũ, không ghi proof giả|Tiếp tục nếu tài nguyên còn xác định|
|DOM/native command không settle|Quarantine đúng session, ownerstop; không thêm input/DOMread/fallback|Giữ trước timeout|Không đợi quarantine của A; có scheduler riêng|
|Stop một thread|Abort gate/read/action theo signal; một terminal stopped; exact stop một lần|Giữ partial|B/C không bị abort theo|
|Stop toàn run|Abort tất cả, cleanup bounded|Giữ partial từng account|Dừng theo yêu cầu|
|Optional capture thiếu body/full queue|CoverageUNKNOWN của account; trong diagnostic không mutation tiếp tới khi policy cho phép|Không đổi task proof thành pass từ capture|Không shutdown peers chỉ vì logging thiếu|
|Không lưu được durable proof/intent hoặc rollout authority|Không mutation/recycle tiếp|Không báo persisted success giả|Giữ cơ chế fail-closed toàn run hiện có; khác optionalcapture|
|Profile stop không xác nhận / ownership thất lạc|Giữ session addressable, không replacement|Giữ partial|Giữ safety stop toàn run hiện có để tránh profile không quản được|

Không nói “mọi lỗi chỉ ảnh hưởng một luồng”: shared disk/CPU/RAM/provider quota hoặc mất tính đúng đắn persistence có thể ảnh hưởng cả run. Những ngoại lệ trên phải hiện mã lỗi và reason; không dùng chúng để khôi phục global lock cho nhiệm vụ thường.

### 7.2 Test fault injection bắt buộc tại3/10/20 worker OFFLINE

Không cần20 email/profile billable để kiểm scheduler. Dùng `runDeterministicSimulation` hiện có, deferred promises và fake clock;20 không phải rolloutStage mới (schema hiện chỉ1/3/5/10).

- C01: giữ worker 1 ở gate sau release;2/9/19 peers phải terminal **trước khi release gate 1**; peer không có queue phụ thuộc worker 1; worker 1 không giữ foreground.
- C02: precondition fail worker 1; mutation count1=0, một failed, N−1completed; không scheduler-shutdown.
- C03: mutation đã dispatch rồi mất response; intent ghi trước; tổng mutation count=1 kể cả restart/recovery; proof/snapshot đến muộn được lưu đúng account. Không snapshot thì UNKNOWN, không replay.
- C04: một browser command never settles; abort/fatal exact alias; peers hoàn tất; không late callback đổi status của replacement.
- C05: Stop ở trước gate, đang read, sau click, trong download; một terminal/account và một exact stop/profile; không input muộn.
- C06: profile-stop never settles/reject; không tạo replacement; global safety terminal đúng; uncertain count không về0 giả.
- C07: proof/intent persistence reject; no nextmutation, typed failure và cleanup; optionalcapture error không bị đánh đồng case này.
- C08: body read stuck + burst/capacity/diskerror; metadata/request ownership vẫn đúng, queue không vô hạn; peer không chờ flush A; counter đúng, Stop settle.
- C09: B nhận requestId/jobId trùng chữ với A; không dùng proof/asset/file của A để pass B. Late response từ session cũ không pass step mới.
- C10: step trước fail/unknown hoặc critical capture missing; step sau không dispatch; step trước pass được giữ khi step cuối fail.

### 7.3 Đo thời gian có tính toán

`T_account = setup + Σ(active + remote_wait + own_queue + capture_overhead) + cleanup`. Tách humanPause ra để không so bản debug đang dừng từng step với throughput production.

Ở N account độc lập, `T_batch` gần makespan `max(finish_i)-min(start_i)`, không phải tổng thời gian từng account; CPU/RAM/disk/provider có thể làm remote_wait và active tăng. Không hứa4phút ×20 vẫn4phút khi chưa đo.

Ghi từng step p50/p95/max trên **số mẫu thực tế** kèm n; với1–3 mẫu không kết luận độ ổn định. Tách wait cause: ownserial, provider, browser, diagnostic pause, capturequeue; `peer-barrier-wait` phải0 bằng cấu trúc và fault test, không chỉ nhìn nhiều cửa sổ đang mở.

Quyết định sizing: không đổi `threadCount` người dùng âm thầm. Nếu free RAM/disk/target capacity không đủ budget, từ chối preflight countđó và báo con số; không giả20 luồng bằng chạy3 rồi xếp hàng17 mà gọi độc lập20.

## 8. Triển khai theo cổng nhỏ — chưa được chạy ngay

### Quyết định về phạm vi

| Phương án | Chi phí / rủi ro | Quyết định |
| --- | --- | --- |
|Chỉ thêm log quanh full flow|Ít code nhưng vẫn bỏ lỡ client outcome và microstep fail|Không đủ yêu cầu|
|Thêm checkpoint/guard trực tiếp + mở rộng recorder hiện có|Delta nhỏ theo từng module, giữ flow và có test độc lập|Chọn; review từng task|
|Viết workflow/capture engine và HTTP runner mới cùng lúc|Đổi quá nhiều interface; khó quy lỗi; tốn test/mua|Không chọn|

Hai workstream tách gate: **A** kiểm chứng/sửa UI độc lập; **B** thu/chuẩn hoá contract để chuẩn bị. B chỉ quan sát trong giai đoạnA, không gửi mutation HTTP. Tái sử dụng một nguồn evidence, không nhân thêm nhiều bản harness/report không ai kiểm.

### Task A0 — chốt nghĩa thành công trước qualification

Đây là discovery đầu ra bắt buộc, không phải cho implementer tự chọn định nghĩa làm test xanh. Tái sử dụng capture/DOM cũ trước, chỉ đo live đúng step nếu dữ liệu thiếu và có duyệt.

| Quyết định cần chốt | Dữ liệu tối thiểu | Kết quả phải ghi trước L3/L4 |
| --- | --- | --- |
|PWA — task thưởng hay cài app thật?|Prompt/install capability + C state + request chain; code hiện phát `appinstalled` tổng hợp phải được nêu riêng|`accepted` với đúng business contract người dùng chấp thuận; hoặc `browser-required` với testinstall có thật; hoặc `unsupported` chặn qualification toànworkflow. Không coi event tổng hợp là cài thật|
|Inspiration — submit accepted hay generate complete?|Flow UI/label nhiệm vụ, submission/stream/jobterminal và ảnh result; phân biệt request accepted với generatedasset|Chốt S13 kết thúc khi nào và cần step quan sát kết quả nào; nếu thu hẹp từ generate sang accepted cần người dùng duyệt. Chưa chốt → qualification BLOCKED|
|Canvas — gửi edit hay kết quả đã áp dụng?|Đúng canvas/message/job/asset update, UI hướng dẫn/applybutton nếu thực tế có|Chốt S19 accepted và S20 terminal/apply requirement; không thêm Apply giả cũng không bỏ lỗi kết quả. Chưa đủ chain → UNKNOWN và measurement card cụ thể|
|Export — download hay loại output khác?|UI branch/menu/client output thực tế và artifact verified|Download là default cho flow hiện tại. Branch khác chỉ accepted khi có contract/result tương đương được duyệt; missing download không tự chuyển qua branch khác|

Output: bảng contract version cho4 quyết định trên, classification `accepted / browser-required / unsupported`, evidenceRefs, steptrục nào mandatory/not-required và lý do. `browser-required` không cấm UIqualification nếu UI capability đã test; `unsupported` cấm full qualification. **Không hạ business scope hoặc đổi định nghĩa task vì server đã thưởng.**

#### A0 decision records — version 1 (2026-09-09)

```yaml
id: A0-PWA-v1
operation: capcut_web_pwa_install
classification: browser-required
approval: unresolved
evidenceRefs:
  - docs/superpowers/reports/2026-09-09-selector-live-response.md:32
  - src/main/services/capcut/missions/simple.ts:223-235
axes: { business: mandatory, reward: mandatory, coverage: mandatory }
decision: Synthetic appinstalled dispatch plus reward evidence does not prove a real application install; the user has not approved reward-only semantics, so fullQualification is BLOCKED.
nextMeasure: Before L3/L4, obtain user approval of the business contract; if real install is required, a separately approved browser measurement must capture install capability/prompt, browser install state, genuine appinstalled outcome, reward proof, and coverage on the same attempt.
authorization: baseline-and-offline-implementation-only; no-live
```

```yaml
id: A0-INSPIRATION-v1
operation: capcut_web_inspiration_generate_done
classification: browser-required
approval: unresolved
evidenceRefs:
  - docs/superpowers/reports/2026-09-09-selector-live-response.md:32
  - src/main/services/capcut/steps.ts:276-325
axes: { business: mandatory, reward: mandatory, coverage: mandatory }
decision: Current flow proves submission/workspace observation and explicitly does not wait for generation; reward evidence does not decide whether success is accepted submission or a generated result. No business-scope narrowing is approved, so fullQualification is BLOCKED.
nextMeasure: Before L3/L4, obtain the user's accepted-vs-generated contract; unless accepted-only is explicitly approved, a separately approved browser measurement must correlate the submitted prompt to the terminal job and resulting asset/image, with reward and complete coverage on the same attempt.
authorization: baseline-and-offline-implementation-only; no-live
```

```yaml
id: A0-CANVAS-v1
operation: capcut_web_design_studio_canvas_edit
classification: browser-required
approval: unresolved
evidenceRefs:
  - docs/superpowers/reports/2026-09-09-selector-live-response.md:32
  - src/main/services/capcut/missions/designStudio.ts:254-295
axes: { business: mandatory, reward: mandatory, coverage: mandatory }
decision: Current flow observes Send acknowledgement/Thinking but not a terminal generated asset or its application to the canvas; reward evidence cannot replace that missing business outcome. No sent-only narrowing or fabricated Apply step is approved, so fullQualification is BLOCKED.
nextMeasure: Before L3/L4, obtain the user's sent-vs-applied contract; unless sent-only is explicitly approved, a separately approved browser measurement must correlate message/job/terminal asset and the canvas update or real Apply interaction, with reward and complete coverage on the same attempt.
authorization: baseline-and-offline-implementation-only; no-live
```

```yaml
id: A0-EXPORT-v1
operation: capcut_web_video_studio_export
classification: accepted
approval: accepted
evidenceRefs:
  - docs/superpowers/reports/2026-09-09-selector-live-response.md:7-24
  - src/main/services/capcut/missions/videoStudio.ts:455-479
axes: { business: mandatory, reward: mandatory, coverage: mandatory }
decision: Per the user's decision, the default business outcome is a completed valid file; no alternative output branch is presumed. The latest run proves reward for two accounts, only a download event for one, no download event for the other, and no completed artifact; the actual client failure root cause remains unresolved, so those attempts are not business/coverage PASS.
nextMeasure: In a separately approved targeted L2 only, capture client/toast state plus download started/completed/failure, file path isolation, size/type/content validity, and render/encode/save chain without a second export click while outcome is unknown; distinguish the failure layer before proposing a fix.
authorization: baseline-and-offline-implementation-only; no-live
```

These records authorize the A1/B1 baseline and offline implementation work only. They do not authorize provider access, account/profile use, paid acquisition, or any live request. Unresolved PWA/Inspiration/Canvas approval blocks full qualification; targeted diagnostics still require the separate gate approval below.

L2 vẫn được chẩn đoán export khi PWA chưa chốt: dùng approved prerequisites thực sự cần (auth/credits/asset), ghi PWA NOT_RUN/NOT_APPLICABLE đối với thí nghiệm đó, không ghi PASS và không tính thí nghiệm là full qualification. Đây là phép thử một nhánh, không bỏ gate trong full flow.

### Task A1 — định nghĩa verdict và quan sát từng step

**Files đọc/sửa khi được duyệt:** `src/main/services/capcut/types.ts`, `src/main/services/CapcutEngineService.ts`, `src/main/services/capcut/runTasks.ts`, `src/main/services/capcut/missionRunner.ts`, `src/main/services/capcut/taskApi.ts`, `src/main/services/stageTiming.ts`; một module nhỏ mới `src/main/services/capcut/stepEvidence.ts` chỉ model/validation/report, không sở hữu scheduler. Test mới `src/main/services/capcut/__tests__/stepEvidence.test.ts`; reuse `src/main/services/__tests__/CapcutEngineService.test.ts`, `src/main/services/capcut/__tests__/runTasks.test.ts`, `src/main/services/capcut/__tests__/runTasksReceiptIntegration.test.ts`, `src/main/services/capcut/__tests__/taskApi.test.ts`.

**Interface dự kiến trong `stepEvidence.ts`:**

```ts
export type StepVerdict = 'pass' | 'fail' | 'unknown' | 'blocked' | 'not-run';
export type EvidenceState = 'pass' | 'fail' | 'unknown' | 'not-required';
export interface StepResult {
  stepId: string; attemptId: string;
  verdict: StepVerdict;
  action: 'not-dispatched' | 'dispatched' | 'settled';
  business: EvidenceState; reward: EvidenceState; coverage: EvidenceState;
  reasonCode: string; evidenceRefs: string[];
}
export type StepObserver = (result: StepResult) => void;
```

Identity/run/session/alias do owner bind ngoài result, không lấy từ free string của mission. ID/step/reason allowlist và Zod schema khi persist; chưa thêm renderer controls. Observer là sync notification không mutation/wait. Gate assertion đặt tại caller và throw lỗi typed nếu không đạt, không ủy thác correctness cho callback log có thể fail.

Trong kiểu dữ liệu này, nhánh được bỏ qua dùng `not-run` với reason `ALREADY_VERIFIED` hoặc `NOT_APPLICABLE` và evidenceRefs tới prerequisite/receipt; chữ SKIP trong báo cáo chỉ là cách hiển thị, không được tăng counter step-executed/pass. `not-required` của một trục phải do step contract cố định quyết định, không do caller tuỳ ý gán để vượt gate.

Để thực sự kiểm reward **giữa các leaf trong group**, không chỉ thêm logs: `runTasks`/`missionRunner` inject một verifier closure giữ chính `TaskStore` của session vào env, gọi sau leaf action đã settle và trước leaf action tiếp. Contract đề xuất:

```ts
export interface RewardStepResult {
  verdict: 'pass' | 'fail' | 'unknown';
  proofAt?: number; snapshotAt?: number; status?: number;
  reasonCode: string; evidenceRefs: string[];
}
export interface RewardAttempt {
  sessionAlias: string;
  stepAttemptId: string;
  taskKey: string;
  actionDispatchedAt: number;
}
export type VerifyRewardStep = (
  attempt: RewardAttempt, deadlineAt: number
) => Promise<RewardStepResult>;
```

Closure vẫn dùng chính `TaskStore` nhưng **phải bổ sung request-origin/attempt correlation vào authoritative monitor trước**. Hiện `waitForAction(key,sinceMs)` chỉ lọc response timestamp sau đọc body; response cũ đến muộn cùng session/key có thể qua. `taskApi.ts` phải giữ sidecar `(session,page,target,requestId,requestStartedAt,originStepAttemptId,actionKey,responseHeadersAt,bodyObservedAt)` gắn tại request-start, không từ mutable stage lúc response. Do_action cũ không được gán cho attempt mới chỉ vì đến muộn.

`TaskStore.beginAttempt(attempt: RewardAttempt): void` được gọi trước dispatch trong cùng account task; `attachTaskMonitor` nghe request-start để chụp immutable attempt vào sidecar rồi mới nhận response. `TaskStore.endAttempt(stepAttemptId: string): void` đóng cửa nhận request mới cho attempt, không xoá mapping của request đang bay. Hai method này chỉ phục vụ provenance của TaskStore hiện có, không phải scheduler/replay API. Microstep không tạo reward action vẫn có `stepId/attemptId` capture; chỉ leaf business action mở reward attempt. Tests phải chứng minh begin/end không tạo network và response sau end vẫn được gán attempt gốc, không gán attempt mới.

Gate chấp nhận proof khi origin thuộc đúng attempt/session và causal relation đủ mạnh (initiator/action/message/job mapping đã chốt; chỉ gần thời gian thì `temporal-candidate`, không authoritative). Snapshot chứng minh sau action phải có request-origin sau proof response đã chấp nhận hoặc quan hệ causal server được kiểm chứng; response của task_list request khởi phát trước mutation không làm snapshot fresh dù body nhận muộn. Nếu không có freshrequest phù hợp, chờ/passive refresh an toàn trong budget hoặc UNKNOWN; không đổi timestamp để làm mới.

Giữ nghĩa `ActionProof`/receipt reward; thêm provenance sidecar theo account/session và persist phần cần để recovery kiểm lại, không có TaskStore thứ2 từ recorder. Parent chỉ kiểm sau children. Finalreconciliation vẫn đối chiếu cùng rule correlation mới, không còn đường legacy bỏ qua gate trong diagnostic. RED bắt buộc: earlier attempt cùng session/key reply muộn; task_list request trước action reply sau mutation; wrong page/peer; duplicate request ID xuyên2context; proof đúng nhưng body critical missing. Tất cả không được pass leaf mới; proof đúng+snapshot request mới thì pass.

Budget proof wait không nhân lên mỗi leaf: giữ quỹ chờ tối đa hiện có của group (PWA12s, notifications20s, Design90s, Video240s), trừ thời gian thực đã dùng chờproof; dùng absolute deadline cho mỗi wait, không reset toàn quỹ khi retry/gate. Generate/layout có deadline riêng đã có, không lấy proof wait để che generationhang. Human pause không được dùng để làm freshness giả.

- [ ] Viết test RED: reward pass + business unknown không verdictpass; HTTP200 + business fail không pass; failure stepB không xoá passA; missingevidenceref/alias mismatch fail-closed; expectedStopAfter không `completed12`.
- [ ] Chạy `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/stepEvidence.test.ts`, chứng kiến đúng mismatch.
- [ ] Triển khai validator/report tối thiểu và wiring `onStep?: StepObserver` qua service→auth/runTasks/env; không thay `ActionProof`/receipt nghĩa cũ. Ví dụ điều kiện verdict:

```ts
const required = [result.business, result.reward, result.coverage];
const canPass = required.every(value => value === 'pass' || value === 'not-required');
if (result.verdict === 'pass' && (!canPass || result.evidenceRefs.length === 0)) {
  throw new Error('STEP_EVIDENCE_CONTRADICTION');
}
```

- [ ] Xác minh report có2counter khác nhau: server taskverified và businessstepsverified; account end-to-end chỉ pass khi các step bắt buộc đều pass, không inferred từ12.
- [ ] Review source delta; chưa bật live. Không stage/commit nếu chưa được yêu cầu.

### Task B1 — recorder metadata/correlation và normalizer, kiểm chứng OFFLINE

**Files:** `httpCapture.ts`, `captureRedaction.ts`, `CapcutEngineService.ts`; `http/privateCapture.ts` chỉ khi cần capability CDP được chọn; `tools/http-contracts/normalize-capture.mjs`; tests `httpCaptureRecorder.test.ts`, `CapcutCaptureSession.test.ts`, `scripts/__tests__/normalize-capture.test.mjs`, `http/__tests__/privateCapture.test.ts`.

**Interface:** giữ `CaptureController.mark(stage)/stop()`; thêm stage envelope/observe API trong chính recorder nếu cần, không đổi mission sang recorder-specific transport. Body patch event nối tới header record bằng key chung; `stop()` trả coverage summary sau sink settle, không serialize summary trước rồi bỏ mất close error.

- [ ] RED fixtures: response trước extra-header, extra-header trước request, redirect cùng requestID, cùngID hai target/capture,304cache,OPTIONS,SWorigin,requestfailed sau headers,late body,body timeout chưa settle,writer error,close error,orphan.
- [ ] RED normalizer: hai eventv2 phải thành một cặp; URLobjectmissingmethod/incomplete không captured; response body không bị coi request body. Dữ liệu mẫu:

```json
[
  {"version":2,"captureId":"fixture-a","type":"request","requestId":"req-1","method":"POST","url":{"origin":"https://www.capcut.com","path":"/luckycat/i18n/capcut/task/v1/do_action","query":[]},"body":{"state":"json","value":{"action_key":"capcut_web_video_studio_export"}}},
  {"version":2,"captureId":"fixture-a","type":"response","requestId":"req-1","status":200,"body":{"state":"json","value":{"err_no":0,"data":{}}}}
]
```

Expected: một transaction có method/path/request+response đúng; `reward-only`, chưa contract nghiệp vụ export. Thiếu event1 → `incomplete/unmapped`, không tự captured.

- [ ] Sửa source đúng từng subdelta: schema/envelope+pairing → safe status codes → bounded sinks → metadata-all → target capabilities → stream/WS; mỗi subdelta có RED/GREEN riêng.
- [ ] Preserve metadata trước body; raw-promise permit; bounded encrypted sink; generation/download bytes riêng nếu cần. Test salt/ref accountA khácB, request OTP bị che, responseerror_code numeric giữ đúng allowlist, raw extra headers/toast không lộ.
- [ ] Test SSE buffered prefix+incremental không doublecount; WS handshake/frame error/close; unsupported target làm capability=false. Không cần implement WebTransport nếu không xuất hiện; cómetadataunsupported rõ.
- [ ] Chạy focusedcommands cho các file trên; test đọc-normalize-record round-trip với synthetic local server (không CapCut). Review coverage và byte budgets trước vendor probe.

### Task B1p — provider HTTP observer có ownership (không bắt traffic toàn máy)

Đây là phần bắt buộc để đáp ứng capture mail/OTP/proxy/Multilogin ở§5.1; không coi B1 browser đã bao phủ provider. Triển khai sau schema/redaction B1, trước L2 có provider calls mới.

**Files:** `src/main/providers/HttpClient.ts`, module nhỏ mới `src/main/providers/ObservedHttpClient.ts`; `src/main/runtime/providerStack.ts`, `src/main/services/AutomationRunService.ts`, `src/main/services/AutomationWorkSource.ts`, `src/main/services/EmailPurchaseService.ts`, `src/main/services/ProxyLeaseManager.ts`, `src/main/services/MultiloginAuthService.ts`. Tests mới `src/main/providers/__tests__/ObservedHttpClient.test.ts`; reuse `src/main/services/__tests__/EmailPurchaseService.test.ts`, `src/main/services/__tests__/AutomationWorkSource.test.ts`, `src/main/services/__tests__/AutomationRunService.test.ts`, provider fixtures và purchaseBudget tests hiện có.

**Interface:** wrapper implement `HttpClient.send(request: HttpRequest): Promise<HttpResponse>` không sửa request gửi. `withObservationScope<T>(identity, operation: () => Promise<T>): Promise<T>` bind immutable run/worker/acquisition/account/session/provider operation quanh service operation; dùng Node `AsyncLocalStorage` giới hạn trong observer để scope đi qua await mà không thêm global `currentAccount`. Không gắn identity vào HTTP header/query/body. Trước account/profileđược tạo thì field đó `unassigned`, dùng acquisitionAlias; khi biếtID chỉ emit bindinglocal, không lấy thứ tựcallback để đoán.

- [ ] RED:2 cuộc mua concurrent/OTP response ngược thứtự giữ đúngacquisition; scope absent ghi unscoped, không lấy context của peer; lỗiobserver không thay request/response hoặc provider retry.
- [ ] RED: headersreceived rồi body parse fail vẫn có metadata; timeout sau buy là ambiguous, ghi attemptref/cost trước call, không buyagain; raw inbox/OTP/password/querytoken không xuất JSONreport.
- [ ] Thêm metadatahook tại `FetchHttpClient` hoặc wrapperboundaries đủ sớm để ghi status trước `response.text()`; wrapper chỉ thấy final `HttpResponse` là chưa đủ. Không sửa timeout/auth/retry behavior ở task observability.
- [ ] Scope retry/poll gắn operationattempt+transportattempt riêng; cùng order/customer ref chỉopaque và đúngaccount. Shared tokenrefresh thực sự dùng chung ghi run/provider scope, không gán nhầm account; không serialize mua/OTP vì recorder.
- [ ] Chạy focusedprovider fake tests + purchasecap/ambiguous tests; review thêm một lần về secret leak/sideeffects. Trong capture, provider failures không tự trở thànhtask proof.

### Task A2 — step gate, không tự chạy vượt mục tiêu hoặc lặp mutation

**Files:** `AutomationRunService.ts`, `CapcutEngineService.ts`, `runTasks.ts`, `missionRunner.ts`, `types.ts`; `scripts/live-capcut-options.mjs`, `scripts/live-capcut-run.mjs` nếu expose scoped test; reuse tests `AutomationRunService.test.ts`, `live-capcut-options.test.mjs`, `live-capcut-run.test.mjs`, `uiInteractionScheduler.test.ts`, `uiQuarantineOwnership.test.ts`.

**Quyết định nhỏ nhất:** tự động assert trước/sau từng microstep trong các hàm hiện có; manual pause chỉ ở boundary đã release. `captureStage` chỉ mark sync, không lạm dụng nó làm pause. `group.act()` hiện giữ editorlease cả group: không chèn manualwait bên trong rồi nói đã release. Ban đầu stop-after-microstep dùng controlleddiagnostic exit, unwind group lease; nếu sau này cần resume in-place thì tách group thành các helper sequential có editorlease theo operation, task refactor riêng với lease tests. Không viết graph interpreter.

- [ ] RED stopAfterStep=S18: không Send, vẫn recordreadback; thiếu mandatory selected step evidence runner không exit0; failedS17→S18notrun; reward pass không bypass failedS26.
- [ ] RED no-replay: lostresponse sau click, recovery không gọi lại; no response không tự `not-dispatched`. Diagnosticdefault1 attempt/1 round/noautomaticreplacement; giữ rõ một action boundary đến callback sau settle.
- [ ] Expose target-step/mode chỉ qua hợp đồng đã validate, không chuỗi arbitraryJS; budget/mail cap mandatory nếu fresh. Flags chưa tồn tại cho tới khi task này thực hiện, không dùng lệnh giả ngay hôm nay.
- [ ] Manual review gate trước acquisition hoặc sau group return; nếu stopping tại microstep phải unwind lease, lưu checkpoints rồi cleanup; no late input. ChạyC01–C10 offline.
- [ ] A2b bên dưới là dependency bắt buộc **trước bất kỳ diagnostic mutation live nào**, kể cả khôngretry. Không coi tắt retry trong một process là an toàn sau restart. Trong khi A2b chưa xong chỉ được chạy offline/noaccount localfixture; không L2/L3 mới.

**Điểm dừng phạm vi A2:** bản đầu chỉ nghiệm thu `diagnostic-no-retry`, không tuyên bố recovery sản xuất. Khi có intent UNKNOWN, khởi động lại phải từ chối account/acquisition đó **kể cả tạo run/manifest khác**; tra storage bền theo identity, không chỉ flag in-memory. C03 gồm no-retry trong process, restart manifest cũ, restart manifest mới cùng account và proof cũ đến muộn. Không test đủ thì không được duyệt live.

### Task A2b — durable mutation fence trước diagnostic live/recovery (cổng bắt buộc)

Scope này rộng hơn click helper; không làm chung vớiA3. Write-ahead fence là điều kiện trước L2/L3 mutation, không phải tùy chọn để sau. Automatic replay vẫn OFF; recovery chỉ đọc/đốichiếu và có gate riêng trước production. Nếu người dùng không duyệt phần persistence, plan dừng ở offline/capturephân tích, không tự chạy thêm tài khoản có rủi ro lặp.

**Files:** dự kiến `src/main/database/migrations/008_account_mutation_intents.ts` + `src/main/database/migrations/index.ts` (hiện cuối007; kiểm trước khi dùng008, không ghiđè file mới của người dùng); repository mới `src/main/repositories/AccountMutationRepository.ts`; `src/main/services/AutomationRunService.ts`, `src/main/runtime/providerStack.ts`, `src/main/services/capcut/types.ts`, `src/main/services/capcut/missionRunner.ts`, `src/main/services/capcut/runTasks.ts`, service acquisition ở B1p. Tests mới `src/main/repositories/__tests__/accountMutationRepository.test.ts`, reuse `src/main/services/__tests__/AutomationRunService.test.ts`, `src/main/services/capcut/__tests__/runTasksReceiptIntegration.test.ts`, `src/main/database/__tests__/migrator.test.ts`.

**SQL contract, rawSQL chỉ trong repository/migration:**

```sql
CREATE TABLE IF NOT EXISTS account_mutation_intents (
  authority_ref TEXT NOT NULL,
  budget_owner_ref TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  account_id TEXT,
  run_id TEXT NOT NULL,
  session_alias TEXT,
  step_attempt_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  task_key TEXT,
  intent_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('outcome-unknown','effect-confirmed','no-effect-confirmed')),
  evidence_ref TEXT,
  PRIMARY KEY (owner_ref, run_id, step_attempt_id)
);
```

Chỉnh hợp đồng khi thi công: `session_alias` cho phép NULL trước khi mua mail tạo profile; không tạo session giả. `authority_ref` và `budget_owner_ref` bền theo phiếu duyệt/provider credential scope, không reset khi đổi run/acquisition alias. Chi tiết approval units/binding/reopen tests ở Task8 bản thi công; không được dùng schema rút gọn này để bỏ kiểm ngân sách hoặc UNKNOWN xuyên run.

`owner_ref` là acquisition ref trước khi cóaccount và account ref sau binding; durable binding phải cho tra các intent của owner/account xuyên run, không chỉ theo PK. Trước start account mới/existing kiểm UNKNOWN của cả account và acquisition. Không chứa password/OTP/rawpayload/fakeopid.

Settlement theo **operation**, không dùng một rewardrule cho tất cả:

- Mailpurchase: provider order confirmation + durable reserved mail binding; không dùng CapCut receipt. Timeoutambiguous giữ cap consumed và UNKNOWN; query/reconciliation provider nếu hỗ trợ, không mua bù.
- Signup/login: response/session identity theo authcontract của đúng mailbox; task thưởng đăng ký không tự xác nhận mọi bước auth.
- Upload/generate: operation receipt/job/asset đúng correlation. Taskreward0 không đủ settle nghiệp vụ upload/generate chưa rõ; vẫn chặn replay.
- Export: delivery/save terminal + artifact receipt; reward0 chỉ settle reward evidence, không settleexport intent nếu fileoutcomeunknown.
- Claim/task action thực sự chỉ nhằm reward: matched action response+fresh snapshot có origin đúng A1.

`no-effect-confirmed` cần chắc chắn chưa dispatch hoặc definitive rejection/no effect theo contract. status≠4/thiếu response/expiredtimeout không đủ. Khi thiếu receipt thì giữUNKNOWN và cấm mutation mới vào cùng operation/account; chỉ đọc reconcile trong scope được duyệt.

- [ ] RED transactionfail trước intent → UIaction0; crash sau intent trướcaction → restart không replay dù thực tế có thể chưa gửi (chấp nhận falseblock để không double-spend).
- [ ] RED crash sau dispatch/proof loss → intent UNKNOWN được nạp theo đúngaccount; action count1; fresh proof chỉ settle đúngintent có correlation, không lấy parent/status4 từ lần trước.
- [ ] Implement write-ahead trong owner thông qua callback injected trước action; commit intent trước mutation. Receipt/proof checkpoint hiện có không bị thay thế. Persist failure dùng fail-closedtyped error đãreview, không try/catch rồi gửi tiếp.
- [ ] Review schema migration/backward compatibility/recovery/Stop/deadlock; transaction ngắn không giữDBlock suốt network wait; chạyC03/C07/C09 và mọi repository tests.
- [ ] Chỉ sau GREEN+review mới bật recovery có fence; live nghiệm thu phải báo rõ recovery-mode và giữ lịch sửfailure. Không thêm automatic sideeffectreplay bằng lý do “intentđãcó”.

### Task A3 — sửa và test đúng cluster, không bundled “fix mọi thứ”

**Thứ tự:** F01 reporting/export observation → F03bootstrap observation → F04/F05Design → F06Video → F07notification. Hai lỗi client/vendor chưa rõ vẫn cần phép đo, không được gắn nhãnfixed theo thứ tự này.

**Files và test cụ thể:**

| Cluster | Production được đụng | Regression bắt buộc |
| --- | --- | --- |
|Auth/S03–S08|`auth.ts`, `signup.ts`, `login.ts`, `trial.ts`, `overlays.ts` đúng branch cần sửa|`auth.test.ts`, `verifiedTyping.test.ts`, `trial.test.ts`, `overlayGuard.test.ts`, `capcutSignupPath.test.ts`: wrong branch/OTPbinding/selectedDOBreadback/authreject/URLonly|
|BootstrapS09|`runTasks.ts`, `taskApi.ts`, task entry trong `missionRunner.ts`|`bootstrap.test.ts`, `taskListDiagnostics.test.ts`, `taskApi.test.ts`: no-request vs wrong endpoint/HTTPerror/empty/parsefail/capmiss; missioncount0 khi bootstrapfail|
|PWA/notification|`missions/simple.ts` đúng branch|`simpleActions.test.ts`, `simple.test.ts`, `popoverLifecycle.test.ts`: syntheticinstall≠OSinstall; permission ≠ subscription; error8001001không tự bỏ qua; no-extraaction-afterproof|
|Inspiration/chat/upload|`steps.ts`, `missions/designStudio.ts`|`designWorkspace.test.ts`, `chatAcknowledgement.test.ts`, `simpleActions.test.ts`: wrong workspace/disabled/noack/uploadsignonly≠assetbound|
|CanvasS16–S20|`diag.ts`, `missions/designStudio.ts`|`canvasPromptReady.test.ts`, `canvasPromptActivation.test.ts`, `canvasFlowTimeout.test.ts`, `boundedEvaluation.test.ts`, `canvasChatVisibility.test.ts`: nestedinert/duplicate/wrongobject/exactreadback/scopedack/jobterminal|
|VideoS21–S26|`missions/videoStudio.ts`; thêm3 focused tests `videoSend.test.ts`, `videoGeneration.test.ts`, `videoExportOutcome.test.ts`|modewrong/no readback/disabled does not send; jobaccepted≠finished/new node wrong asset; reward 0+downloadfail/no event/cancel/truncated/wrong MIME; peer file isolation|
|Proof/report final|`missionRunner.ts`, `runTasks.ts`, service/result wiring theoA1|`missionRunner.test.ts`, `runTasksReceiptIntegration.test.ts`, `automationTaskProgress.test.ts`, `CapcutEngineService.test.ts`: preserve earlierpass/parent/precompleted9proofs; noreward→business pass≠end-to-end pass|

Tại mỗi cluster:

1. [ ] Viết một test chứng minh branch sai; chạy thất bại đúng lý do.
2. [ ] Chụp delta/baseline; sửa đúng branch, không đổi scheduler/helper chung nếu lỗi local.
3. [ ] Chạy test step → predecessor/successor → shared caller → peer/isolation; ghi kết quả và code path được test.
4. [ ] Reviewer độc lập kiểm spec+quality+blast radius. Chưa approved không ghép delta tiếp.
5. [ ] Bản sửa được ghi `offline-verified`; live-verified cần đúng step và evidence đầy đủ, không đổi nhãn vì buildpass.

**Ví dụ F01 phải chứng minh bằng hành vi**, không chỉ testchuỗi log: fake external download emit `download` rồi `failure='cancelled'`; chạy real export checker; expect business fail, reward pass được giữ, no nextsuccess, no second click, no same filename acrossaccounts. Case event đến sau return/cleanup phải caught hoặc reportedmissed, không làm attempt mới pass.

### Task A4 — nghiệm thu độc lập và review tổng delta

- [ ] Chạy toàn bộ localtests, typecheck, lint, selectorfixtures, build; nativeNode/Electron checks đúngABI và tuần tự với SQLite; không chạy heavybuild cùng live.
- [ ] Synthetic browserfixture3profiles (không tài khoản): step order+cross-input+popup+upload+downloadfailure+timeout+Stop+recorder coverage.
- [ ] Fault3/10/20 bằng deterministicharness: C01–C10, zeropeerbarrier, resource ownership; đối chiếu step terminal và capture accounting.
- [ ] Review toàn **delta của plan**, không nhận vơ/xoá dirtychanges khác; lưu listfile+test+knownlimits. Lỗi chưa xác định có investigationcard riêng; không gọi kế hoạch hoàn tất chỉ vì testsuite xanh.

## 9. Lịch test live và kiểm soát tiền/thời gian

**Ngay hiện tại:0 email/0 profile/0 live request mới được phê duyệt bởi tài liệu này.** Những lượt đã mua3mail được xem là đã dùng hết budget đó. Không suy từ câu “tiếp tục plan” thành duyệt mua tiếp.

| Gate | Mục đích / phạm vi | Budget đề xuất phải duyệt | Điều kiện được đi tiếp |
| --- | --- | --- | --- |
|L0 offline|A1/B1/B1p/A2/A2b, per-step fixtures, faults, normalizer/redaction|0 mail,0provider/profile billable|Không missing critical capture, rollback delta rõ, reviewer pass|
|L1 vendor noaccount|3 Multilogin profiles với localfixture; kiểm helper/recorder mới, download/file isolation|0 mail; đúng3profiles;3rounds; hard limit5phút + exact cleanup|3/3probe,0cross-input,criticalcoveragecomplete,resources0. Probe cũ chỉ baseline, không được reuse sau recorderchanges để gọi bản mới verified|
|L2 targeteddiagnosis|S09 bootstrap **hoặc** S25–26 export + prerequisite tối thiểu; mỗi lượt chỉ một câu hỏi; A2b đã đạt|Ưu tiên0mail với test account đã mua khi người dùng đồng ý; nếu cần fresh thì tối đa1newmail/lượt;1 attempt, hard limit10 phút|Before/action/response/client/after đủ để loại trừ giả thuyết; pass/fail đều có nguyên nhân hoặc measurement gap cụ thể. Không tự lặp nếu vẫn thiếu cùng tín hiệu|
|L3 stepwise1 fresh|A0 contracts đã chốt + S00→S28 trên 1 tài khoản mới, autoassert ngay mỗi step; dừng đầu tiên fail/unknown|Tối đa1mail mới;1 round, không replacement purchase; hard limit15 phút gồm phần chờ bình thường|Tất cả mandatory step business/reward/coverage pass; partial error không bị giấu; exact cleanup|
|L4 independent3 fresh|3 account tự đi step riêng, không barrier, không human pause khi đo throughput|Tối đa3mail mới/lượt; một lượt 15 phút ceiling; nguồn source frozen|3/3business+reward+coverage; validator independentPASS; no fatal/quarantine/cleanup failure; transient failure phải hiện và không được gọi clean|
|L5 confirm3|Một lượt xác nhận3fresh trên cùng build để giảm nguy cơ pass tình cờ|Duyệt riêng tối đa3mail; không tự sinh repeatloop|Hai lượtL4/L5 liên tiếp sạch cùng build; không phải cam kết0lỗi mọi trường hợp|
|L6 scale10|Chỉ sau L4/L5; đo resource/timing/coverage và nghĩa độc lập|Duyệt riêng tối đa10 mail,10profiles; budget ghi trước|10/10 proof+business, no-barrier tests và cleanup; nếu failsize/resource thì không lên20|
|L7 scale20|Hiện chỉ OFFLINE stress vì rollout schema không stage20|0 mail mặc định; live20 là quyết định schema/product+budget riêng|Không khai cólive20cho tới khi thiết kế/duyệt và kiểm đủ|

Các ceiling là giới hạn chi tiêu/chạy chẩn đoán, **không** lời hứa phải hoàn thành trong đó. Hết ceiling thì Stop/partial+cleanup, không tăng khi đang chạy. Testđăngkýfresh và loginexisting là hai case riêng; login không được thay bằng signupfallback để làm xanh.

### 9.1 Công thức chi phí và thời gian trước khi duyệt

Không tự điền giá nhà cung cấp khi chưa đọc quote hiện tại. Phiếu preflight phải ghi số tiền theo đơn vị hiển thị của provider và số tiền thực tế trong DB sau lượt:

```text
C_mail       = Σ(price_of_each_confirmed_or_ambiguous_mail)
C_proxy      = Σ(proxy_leases_or_requests_billed_by_provider)
C_profile    = Σ(profile_starts_if_vendor_bills_starts)
C_diagnostic = C_mail + C_proxy + C_profile + storage/runner_cost
C_max_gate   = N_mail_cap × quoted_mail_price + N_proxy_cap × quoted_proxy_price + fixed_vendor_fees
```

Mỗi lượt phải ghi `quotedAt`, currency, cap, attempted, confirmed, ambiguous, refunded/unknown; không ghi email/token/order raw. Khoản `ambiguous` tính là đã tiêu cho tới khi provider xác nhận ngược lại; không mua bù trong cùng lượt. Nếu không lấy được giá/hoá đơn an toàn, dừng preflight và báo `COST_UNKNOWN`, không phỏng đoán.

Thời gian được đo bằng monotonic timestamps, tách:

```text
T_worker = T_acquire + T_profile + T_auth + Σ(T_step_active + T_remote_wait + T_capture_queue) + T_cleanup
T_batch  = max(worker_end) − min(worker_start)
T_gate   = operator_dwell + T_worker   # chỉ dùng báo cáo chẩn đoán, không dùng throughput
```

Báo p50/p95/max theo từng step và n mẫu; n≤3 chỉ là quan sát, không phải SLA. `operator_dwell` không được đổ cho CapCut/network. Nếu `capture_queue` hoặc disk pressure làm tăng `T_worker`, ghi riêng overhead và dừng scale; không thêm delay đồng loạt giữa worker.

**Quy tắc chống tốn tiền:**

- Trước mỗi lượt ghi: câu hỏi cần trả lời, step target, prerequisites, expectedresponse/client, instrument đã test offline, source hash, mail/profilecap, retry cap, cleanup, tiêu chí dừng. Không có phiếu thì không start.
- Không replay step đã đủproof chỉ để chụp thêmảnh. Khi data cũ thiếu signal, bổ sung listener rồi chẩn đoán lại đúngstep có duyệt; không gọi full flow là targetedtest.
- Diagnostic có thể cần sample image/generation credits: liệt kê riêng, không gọi “0 mail” là “0chi phí”. Không xin trial/subscription trả phí ngoài scope.
- Khi lỗi xảy ra, peer đang có mutationin-flight được finish/reconcile/cleanup theo sở hữu; không hủy cả3 giữa mutation chỉ để giảm elapsed. Đồng thời không tự nhận thêm item/mail ngoài batch đã duyệt.
- **Ước lượng single-pass**, không phải tổng trần toàn project: một L2 fresh(1) + một L3(1) + một L4(3) + một L5(3) =8 email; L2 reuse được duyệt thì7 email. Sửa build/qualification lại hoặc nhiều L2 có thể tăng số mail. Công thức thật: `N_mail = N_L2_fresh + N_L3 + 3×N_L4 + 3×N_L5 + 10×N_L6`. Mỗi lượt phải được duyệt riêng; **overall authorized ceiling hiện tại=0 email mới**. Không tăng tổng authorized vì có plan; hết cap dừng chờ duyệt, không mua bù. L1 có thể dùng profile quota dù0 mail.
- Sau từng lượt xuất bảng1hàng/step/account, response evidence links, rootcausecard, biến đã đổi, peers impacted, test cost/duration. Nếu lặp cùng thất bại2lần mà không thêm data phân biệt, dừng thêm live và quay offline; không “lần3 biết đâu qua”.

## 10. Chuẩn bị API/HTTP: hồ sơ contract ngay bây giờ, gửi HTTP sau gate UI

### 10.1 Danh mục chuỗi nghiệp vụ, không chỉ endpoint nhận thưởng

Các route dưới là **candidate đã thấy trong code/capture**, không là hợp đồng đã chứng minh độc lập. Method/field chính xác lấy từ capture đã nối cùngstep; không copy route từ comment rồi gọi thử.

| Nghiệp vụ | Chuỗi phải lưu | Điều kiện tương đương bắt buộc |
| --- | --- | --- |
|Auth/signup/login/OTP|Trangboot/check-email → signup/login → challenge/verification → session/authidentity; provider mailboxrequest độc lập|Session của đúng account/proxy; business auth accepted, fresh reward bootstrap; không dùng cookies củaaccount khác, không bypasschallenge|
|Trial/taskbootstrap|Eligibility/commerce → task entry → reward `/task/v1/task_list`|Đúng rewardcatalog; phân biệt `lv/v2/task/get_task_list`; không fabricate12 task|
|PWA/push|Browser permission/service-worker/subscription/install UI + apprequest chain + proof|Nếu cần native/browser state thì `browser-required`; gọi do_action không thay việc cài/subscription|
|Inspiration|Template/detail/fieldsubstitution → submit/generate request → workspace/job/asset|Input/result cùng task; exactcontract chưa đủ thìcaptured-only|
|Designchat|Workspace/thread → message submit → ack/stream → task proof|Message được chấp nhận đúng workspace; payload/state dependency không suy từ task proof|
|Upload|Sign (`/lv/v2/canvas/upload_sign` hoặc chat-sign đúng scope) → object/multipart upload → finish → bindassetcanvas|Bytes/hash/asset đúng; signURL200 chưaphảiuploadpass; không gửi cookieauth tới artifacthost khác|
|Canvasedit|Canvas/draft init/save (`/lv/v2/canvas/save`) → editrequest/stream/job → commit/updateasset → proof|Không lấy emptydraftsave hoặc chat thay canvasedit; đúng edit/result contract|
|Videosend/generate|Studio/project → `/storyboard_agent/v1/ai_lab/send_msg` → creditsconfirm → stream/poll → jobterminal/nodeasset|Accepted chưaready; đúng jobasset theo prompt; sideeffects/cost được duyệt|
|Videoexport|Readyasset → `/storyboard_agent/v1/ai_lab/batch_query_assets`/export operation → object/file delivery → save completion|Export/query0 chưafilepass; valid artifact đúnghash/type/size và task proof riêng|
|Reward/reconcile|`do_action` request↔response ↔fresh task_list;9 leaf+derivedparents|Chỉ chứng minh acknowledgement/reward, không tự làm nghiệp vụ|

### 10.2 Mẫu một contract review bắt buộc

```yaml
operation: video.export.asset-query
state: captured
mechanism: browser-ui-observed
provenance: runId / buildHash / sessionAlias / step-S25 / request-record / response-record
request:
  origin: edit-api-sg.capcut.com
  method: POST
  path: /storyboard_agent/v1/ai_lab/batch_query_assets
  fields:
    items.resource: dependency-from-verified-generated-asset
  headers: names-and-types-only; values-from-current-account-secret-source
response:
  transport: HTTP-200-observed
  business: exact-ret-and-item-error-schema-must-be-observed-before-promotion
  output: asset-resource-ref / artifact-url-ref / expiry-if-returned
dependencies: S23-ready-asset -> S25-query -> S26-file-outcome
semantics: asset-query-is-not-download-completion
retry: no-mutation-replay-while-outcome-unknown
proof: reward-ack-separate-from-file-evidence
limitations: opaque-ret-in-old-redacted-capture; client-export-error-unobserved
next_validation: schema-aware-capture-fixture-and-client-download-outcome
```

Mẫu này cố ý vẫn `captured`, không `live-verified`. Mỗi field bổ sung phải gán origin `static/user-input/session/dependency/generated`, phạm vi account/run, lifetime/expiry, optional/required, nguồn sinh và bằng chứng. Opaque ref không có giá trị dùng lại; expiry/cookie/signature chưa hiểu thì đánh dấu browser-required, không hardcode.

Contract bổ sung: locale/region/build provenance; request/response schema; HTTP và business errors; pagination/stream terminal nếu có; mutation/cost/idempotency; reconciliation endpoint; retry/backoff theo server (không vượt rate limit); stop/cancel semantics; dependent steps; negativefixture. Missing method/path/response/correlation → incomplete/unmapped, không được promote.

### 10.3 Các cổng chuyển đổi

1. **Inventory-only:** đọc các trace UI đã chạy và tạo paired redacted fixtures bằng normalizer B1; offline, không request mới. `captured` ≠ dùng được.
2. **Fixture-verified:** parser/request builder với dữ liệu giả đúngschema; missing field/wrong account/stale token/expired asset/error responses đều cótest. Registry hiện cho fixtureverifieddispatch là gap cần siết trước phaseHTTP.
3. **UI-verified:** L4/L5 sạch và tất cả step critical có business+reward+coverage. Chỉ lúc này mới đề xuất HTTP live; không dùng 2/3batchfailed làm cổng.
4. **Passive-shadow:** UI là solewriter; HTTPbuilder chỉ tính request cấu trúc và so với record, không send. Không chạy song song hai mutationcho cùng task/account.
5. **Browser-HTTP read-only:** một operation đọc có duyệt, session/proxy đúng; xác minh không sideeffect; vẫn ghi `browser-http`, chưa thuầnHTTP.
6. **Browser-HTTP mutation:** duyệt riêng đúngtask/account/credits; một mutation, realresult/artifact + reward + freshsnapshot; UI chỉ được dùng cho setup rõràng, không fallback sauambiguous.
7. **Native-HTTP:** thay từng operation bằng transport không Page/CDP; current-account cookie/token/signature hợp lệ được cấp qua flow đã được phép; không giảsignature/bypassrestriction. Auth vẫn cầnbrowser thì toàn workflow vẫn `hybrid/browser-required`.
8. **Pure-HTTP acceptance:** chỉ khi từ auth/OTP qua mọi nghiệp vụ và cleanup đều không cầnbrowser/UI/CDP,3 rồi10 độc lập cùng tiêu chuẩn outcome; có PWA/push không thay được thì báo rõ chưa đạtpure HTTP, không đổi nghĩa nhiệm vụ âm thầm.

Feature rollout theo operation với hard preflight: missing/unsupported contract failtrước mutation. Không “UI lỗi thì thửHTTP” khi có thể đã gửi. rollback về UI chỉ trên fresh state chưa dispatch/provenno effect và được duyệt; giữ unknown fence/receipts. Không reuse captured credential/querysignature sau expiry hoặc khác account/IP.

**Files chỉ xem/chuẩn bị trong phaseA:** `src/main/services/capcut/http/contractRegistry.ts`, `httpTypes.ts`, `httpMissionStrategy.ts`, `httpOnlyAccount.ts`, `httpOnlyRunner.ts`, `httpOnlyTransport.ts`, các fixture cũ. Không bật `CAPCUT_HTTP_TASK_LIST`, `CAPCUT_HTTP_DIRECT`, `CAPCUT_HTTP_ONLY`, discovery-only hay dormantstrategy để thử ngay. HTTP implementation sẽ có plan hẹp riêng dựa trên contractđã chốt, không rewrite toàn tool.

## 11. File ownership, thứ tự review và kiểm tra giao thoa

- Root giữ spec/mapping/evidence/budgets; không vừa chạy live vừa nhờagent sửa source.
- Agent thu/capture: B1 trong recorder/redactor/normalizer; agent mission: chỉ một clusterA3 mộtlần; reviewer: read-only delta+testlog. Nếu cùng cần `CapcutEngineService.ts` hoặc `types.ts`, xử lý tuần tự, không2agentghi cùngfile.
- Microstepgate, optionaldiagnostic recorder, durable proof và businessoutcome là4trách nhiệm khác; không gom tất cả vào một helper500dòng. Chỉ thêmmodule thực sự có ownership riêng; không sinh nhiều scriptprobe cho cùng việc.
- Before/after source hash + indexhash; restore chỉ delta do mình tạo nếu regression, không dùng gitreset/checkout diệnrộng. No publicartifact chứa credentials; source vault/account DB gốc read-only trong test.

### Scan giao thoa trước thực hiện

| Cặp | Interface/file chung | Quyết định |
| --- | --- | --- |
|A1↔A2|StepResult/VerifyRewardStep/env/runner|A1 định nghĩa trước; A2 tiêu thụ đúngsignatures; observer không điều khiển scheduling|
|A0↔L3/L4|Business contract mandatory/not-required|PWA/Inspiration/Canvas/Export chốt trước full qualification; targeted branch không gán pass cho bước không chạy|
|A2↔A2b|restart/no-replay/durable identity|A2b bắt buộc trước mutation live; UNKNOWN chặn across-run, không chỉ manifest cũ|
|B1↔B1p|Provider/browser correlation và privacy|B1p owner tags qua async scope, không currentAccount global; OTP/purchase failed có fixture|
|A1↔B1|attempt/session/request correlation|Một identity doownerbind; capture không làm TaskStore thứ2|
|A2↔A3|groupeditorlease/step stop/no-replay|Không chèn manualwait trong whole-group lease; guard trướcnextstep, unwindstop cótest|
|B1↔A3|listener trước action, proof vs request body|Mỗi cluster chọn critical fields trước live; missing field chỉUNKNOWN, không tự fixmission|
|A3↔A4|sharedhelpers/proof/finalresult|Test predecessor/successor và all callers; preserve rewardfact ngay cảbusiness fail|
|B1↔HTTPfuture|v2/v3 normalizer/contractRegistry|Pairedfixture vàstate gate trướcdispatch; không promote fixture-only|
|Mọi task↔live|source/build/ABI/resource ownership|Freeze sau review; không build/rebuild/edit giữa lượt; exact cleanup |

## 12. Tiêu chí bàn giao và checklist duyệt

Không dùng câu “tool hết lỗi” từ một lần chạy. Bàn giao phải nói rõ môi trường, số mẫu, step đã chứng minh/chưa chứng minh, lỗi đã sửa bằng gì và giới hạn còn lại.

Một step được đóng issue khi có: bằng chứng fail cũ → nguyên nhân đã phân biệt → delta → regression RED/GREEN → step trước/sau/peer PASS → live đúng step có duyệt nếu cần. Một tài khoản chạy sạch khi mọi trục business/reward/coverage bắt buộc đều PASS và cleanup xác nhận; batch sạch khi mọi tài khoản đạt, không giấu FAIL/UNKNOWN.

- [x] Đủ 12 task và 9 action leaf; parent/signup không có action giả.
- [x] Tách reward/client/artifact/coverage; sửa kết luận 2/3 quá rộng.
- [x] Có S00–S28, prerequisites/postconditions và bước bị chặn.
- [x] Mỗi lỗi có confirmed/hypothesis, phép đo, hướng sửa và test phạm vi ảnh hưởng.
- [x] Có traffic toàn scope, body policy/SSE/WS/target gaps, identity và capture completeness.
- [x] Có privacy và điều kiện raw encrypted; không đổi mạng/TLS/replay ngoài scope.
- [x] Có fault tests 3/10/20 offline, timing/capacity, không global barrier.
- [x] Có live budget/stop condition/không mua lại/lộ trình HTTP sau gate UI.
- [x] Có công thức chi phí theo quote thật và phân rã thời gian, không bịa giá/SLA.
- [ ] Người dùng duyệt phương án này trước khi bắt đầu triển khai; duyệt implementation không đồng nghĩa duyệt live/purchase.
- [x] Review độc lập và re-review: 5 finding Important + 2 Minor đã chỉnh trong plan; không còn blocker quan trọng ở các phần đã review. Việc acquisition-to-account binding bền qua restart phải có regression trước live, không chỉ ghi trong tài liệu.

Context7 không có công cụ trong phiên này; cú pháp mới liên quan Playwright/CDP phải được đối chiếu docs hiện hành khi triển khai (hoặc installedtypes + localcapabilityprobe nếu công cụ vẫn thiếu). Không lấy hỗ trợ CDP/WS/SW của Chrome thường làm bằng chứng Multilogin chắc chắn hỗ trợ.
