# Thiết kế chuyển CapCut sang HTTP-only — chờ duyệt

Đây là **đề xuất kiến trúc dựa trên capture**, không phải kế hoạch triển khai đã được duyệt và không phải SDK đã chạy được. Theo Superpowers brainstorming, thay engine là thay đổi kiến trúc; cần duyệt ranh giới/điểm chưa biết trước khi lập plan TDD từng thay đổi. Mọi code UI/HTTP đang dang dở của project được giữ nguyên.

## Mục tiêu và flow không được đổi

Đăng ký hoặc đăng nhập -> đọc trạng thái trial -> enable notifications -> Install CapCut Web -> Try Inspiration -> nhóm Design -> nhóm Creator -> kiểm chứng cuối. Mỗi tài khoản thực hiện flow riêng; một tài khoản chờ job của chính nó, không chờ task của tài khoản khác.

Capture chỉ chứng minh nhánh **đăng ký mới**. Các lần đọc trạng thái cho thấy trial chưa active, nhưng subresponse được mã hóa JSON trong `batch_get` #3163 có hai offer đủ điều kiện trial 7 ngày với giá trial bằng 0. Đây là eligibility, không phải activation; không được tự kích hoạt/mua để làm cho bước check trial “xanh”. HTTP-only cho permission/PWA thật và export file vẫn chưa được capture chứng minh.

Telemetry #1531 có lỗi thật: PushManager subscription thiếu Service Worker đang hoạt động; về sau FCM/cloudpush thành công. Đây là dependency của web-push, không phải bằng chứng lỗi export. Chuyển sang native HTTP phải làm rõ cách giữ đúng chức năng này, không thay bằng gọi API nhận thưởng.

## Ba hướng và lựa chọn đề nghị

| Hướng | Đánh đổi |
|---|---|
| Chép/replay nguyên request | Không dùng: cookie/signature/ID cũ, không tái tạo state, có thể lặp mutation/tốn tiền; không chứng minh độc lập. |
| HTTP trong browser session | Có thể giữ state hợp lệ làm baseline so sánh, nhưng vẫn cần browser và không đạt HTTP-only. Không được đổi tên thành native HTTP. |
| Adapter native theo hợp đồng đã kiểm chứng | Đề nghị: xây từng endpoint và state của mỗi tài khoản; endpoint chưa có nguồn dynamic field hoặc product proof thì chặn rõ, chưa thay runtime cũ. |

## Ranh giới module dự kiến

Tận dụng các module hiện có dưới `src/main/services/capcut/http/`; phải audit code hiện có trước khi quyết định sửa file cụ thể, không tạo hệ thống thứ hai song song một cách mặc định.

| Thành phần | Trách nhiệm | Không được làm |
|---|---|---|
| Account session / transport | CookieJar, redirect, proxy, timeout, AbortSignal, response headers/body | Global jar; forward CapCut cookie/Authorization sang upload host tùy ý |
| Client-state provider | Nguồn CSRF, web ID, HTML bootstrap, dynamic signature đã kiểm chứng | Tự đoán thuật toán, dùng token capture, vượt challenge |
| Auth + workspace + entitlement | State machine đăng ký/login đúng nhánh; tách trạng thái trial hiện tại khỏi eligibility theo offer; đọc workspace hiện tại | Coi HTTP 200 hoặc offer eligible là trial active; init_trade tự động |
| LuckyCat ledger | `/luckycat/i18n/capcut/task/v1/task_list` + `do_action`, đối chiếu đúng action/account/attempt | Dùng `common_task/list`; fake parent action hoặc fake product effect |
| Try Inspiration | `/lv/v1/common_task/new` -> `/lv/v1/effect/genai/task/query`, kiểm terminal `succeed` và media | Coi queueing, progress100, hoặc reward sớm là sinh video xong |
| Design | Canvas revisions, thread/SSE, upload apply/bytes/commit/meta, liên kết resource | Coi một SSE frame hay upload HTTP200 là xong toàn bộ task |
| Creator | Draft/project/conversation/round, SSE `poll_by_event_id`, hai dạng `send_msg`, asset | Giả định `send_msg` trả event_id; gọi asset lookup là export |
| Evidence + persistence | Lưu riêng outcome kỹ thuật, product và reward; request refs; trạng thái unknown | Timeout mutation thì lặp lại vô điều kiện |
| AutomationRunService | Vẫn sở hữu worker, cancellation, counters, cleanup | Engine tự tạo worker hoặc barrier giữa các tài khoản |

## Contract trạng thái (đề xuất, chưa implement)

```typescript
type EvidenceStatus = 'verified' | 'failed' | 'unknown' | 'not-applicable';
type StepOutcome = {
  accountRef: string;
  attemptRef: string;
  step: string;
  transport: EvidenceStatus;
  product: EvidenceStatus;
  reward: EvidenceStatus;
  evidenceRefs: string[]; // local redacted refs, never credentials
};
```

`verified` cần predicate riêng từng bước. Reward dùng response `err_no=0` + LuckyCat snapshot mới; generation cần terminal output; export cần file/artifact validation; parent cần snapshot tổng hợp. Các state `unknown/unsupported` không được cộng vào completed. Những type này là ranh giới đề nghị, sẽ đối chiếu type hiện có trước khi lập plan.

## Thứ tự kiểm chứng trước khi thay engine

1. **Đóng contract offline:** đối chiếu map với code hiện có; tạo fixture khử bí mật, schema input/output và lỗi từng endpoint. Test parsing JSON/SSE/serialized canvas, response 200 nhưng application error, không nhầm code giữa dịch vụ.
2. **Session riêng:** test domain/host-only/path/expiry/deletion/redirect, trường hợp 175 cross-domain msToken candidate không hợp lệ; không “fix” bằng copy cookie khác domain. Thử 20 session giả với token trùng tên nhưng khác giá trị; session này không thấy state của session kia.
3. **Nguồn dynamic field:** chứng minh từng nguồn bằng fixture và controlled test. Timestamp/sign/op_id/session_id/encoded auth fields chưa có thuật toán thì `unsupported`, không placeholder trả dữ liệu cũ.
4. **Auth/read-only:** test registration branch đã capture; capture riêng nhánh existing login trước khi gọi là hỗ trợ login. Check trial phải parse JSON-encoded `batch_get.response`, phân biệt `inactive` từ user-state fields với `eligible` từ offer fields, và vẫn chặn activation/payment.
5. **Một task một lần:** sau khi được phép live, chạy prepare -> action -> product proof -> reward reconciliation cho task cụ thể, không full flow để đoán. Nếu mutation timeout, reconcile trước, không mua/generate/upload/export lặp.
6. **Nhóm nhiệm vụ:** Try Inspiration đi poll genai đúng task ID; Design giữ canvas/thread/material cùng account; Creator giữ session/round/draft, xử lý credits_confirm một lần. Notifications/PWA/export chưa đủ contract thì chưa bật.
7. **Đa luồng:** offline 3/10/20 worker fault injection; live ba account mới chỉ khi mọi step có hợp đồng và có phê duyệt chi phí. Worker nhanh phải bắt đầu bước tiếp khi dependency của chính nó sẵn sàng, dù worker khác đang timeout. Không barrier từng task.

## Thời gian và tác động giữa luồng

Không suy ra thời gian 10–20 account từ một capture trình duyệt. Mô hình độc lập lý tưởng: `batch ≈ max(account durations) + overhead`, không phải tổng durations; network/server quotas, CPU/hashing, connection pools và DB vẫn có thể gây tranh chấp. Đo `readyAt/startAt/endAt`, queue wait, server latency, retry và workerId. Rate-limit theo service là giới hạn tài nguyên có chủ đích, không phải chờ account khác hoàn thành business step. Backoff có jitter và cancellation, không vòng retry nóng.

## Acceptance / rollback

- Không thay default engine trước khi auth + 12 row semantics + actual product proof đã qua kiểm chứng.
- Feature flag chỉ bật adapter đã chứng minh; không fallback UI sau một mutation mơ hồ vì có thể thực hiện hai lần.
- Regression tests trước sửa; chạy test hẹp -> typecheck/lint -> suite liên quan; reviewer độc lập kiểm nguồn và ảnh hưởng giữa worker.
- Không migration dữ liệu, xóa code UI, mua email, gọi payment hay replay capture trong bước lập hợp đồng này.
- Plan triển khai chi tiết sẽ được viết sau khi duyệt thiết kế này; nó phải có đường dẫn thực tế, RED/GREEN và checkpoint từng task, không lấy roadmap này làm lệnh sửa toàn project.
