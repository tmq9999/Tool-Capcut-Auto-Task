# Design Specification: Diagnostic One-Email Onboarding Probe (Option C) with Hybrid Fallback (Option B)

## 1. Mục tiêu
Thiết kế và triển khai quy trình chẩn đoán 1 email thật từ Gmail94 để giải quyết triệt để lỗi `ret=1014` ("system busy") trên các endpoint sản phẩm của CapCut (`/lv/v1/user/web/user_info` và `/cc/v1/workspace/get_user_workspaces`), đồng thời kiểm chứng khả năng nhận diện workspace và lấy Pro Trial thật.

## 2. Bối cảnh & Bằng chứng kỹ thuật
- **Nguyên nhân gốc rễ của `ret=1014`**: Trong capture gốc `Capture/Capture_Full_Capcut_Flow`, sau khi đăng ký thành công (#230), client gửi liên tiếp:
  - #233, #234: `auth_broadcast`
  - #235: `POST /lv/v1/sc/age_gate/set_birthday_by_uid` với JSON `{"birthday":"YYYY-MM-DD"}`
  - #237: `POST /lv/v1/user/web/user_info` với JSON `{"sem_info":{...}}`
  Trong lần chạy live trước đó, kịch bản test đã nhảy cóc từ Passport sang `user_info` mà không gọi `#235`, dẫn đến tài khoản chưa hoàn tất onboarding trên hệ thống sản phẩm.
- **Rủi ro chữ ký (Signatures)**: Các endpoint `/lv/v1/` và `/cc/v1/` trong capture có mang các header chữ ký `sign`, `sign-ver`, `device-time`. Cần xác định thực nghiệm xem API có chặn nếu không có chữ ký hay không.

## 3. Thiết kế luồng xử lý (Option C & Option B)

### Phase 1: Option C - Pure HTTP Onboarding Probe
1. **Khởi tạo môi trường & mạng**:
   - Thuê 1 lease KiotProxy, kiểm tra egress IP.
   - Mua 1 mailbox Gmail94 (giới hạn tối đa 1.000 VNĐ).
   - Khởi tạo `CycleTLS` context với HTTP/1.1 và User-Agent nhất quán.
2. **Thực thi chuỗi request đối chiếu capture**:
   - Khởi tạo web session: `GET /` và `GET /login-embed` để lấy `_tea_web_id` và `passport_csrf_token`.
   - Age gate pre-check: Gọi `#211` (`get_age_gate_config`) và `#220` (`check_age_without_uid`).
   - Gửi mã xác minh: `POST /passport/web/email/send_code/`.
   - Đọc OTP từ mailbox và thực hiện: `POST /passport/web/email/register_verify_login/`.
   - Broadcast auth: `POST /passport/web/auth_broadcast/` tới cả `login-row` và `login-us`.
   - **Onboarding tuổi thật**: Gửi `#235` `POST /lv/v1/sc/age_gate/set_birthday_by_uid` với ngày sinh hợp lệ (ví dụ: `1999-02-17`).
   - Xác thực danh tính: `GET /passport/web/account/info/`.
   - Đọc thông tin sản phẩm: Gọi `#237` `POST /lv/v1/user/web/user_info` và `POST /cc/v1/workspace/get_user_workspaces`.
   - Đọc VIP trial catalog: `POST /commerce/v1/subscription/batch_get` với key `cc_price_list_vip`.
3. **Cổng quyết định (Decision Gate)**:
   - **TH1**: `user_info` và `workspace` trả về `ret=0` -> Hoàn thành mục tiêu HTTP thuần. Tiếp tục tích hợp vào `httpOnlyRunner.ts`.
   - **TH2**: Trả về `ret=1014` hoặc lỗi chữ ký -> Kích hoạt Phase 2 (Option B).

### Phase 2: Option B - Hybrid Browser-Assisted Onboarding Fallback
- Nếu Phase 1 không thể vượt qua bảo vệ anti-bot của CapCut bằng HTTP thuần:
  - Khởi chạy một session Playwright Chromium (stealth profile) với proxy Kiot hiện tại.
  - Nạp cookies session từ Phase 1 vào browser.
  - Cho browser mở trang chủ CapCut (`https://www.capcut.com/my-edit`) để các script chính thống của CapCut tự kích hoạt khởi tạo workspace.
  - Thu thập CookieJar hoàn chỉnh và `workspace_id`.
  - Handoff lại cho CycleTLS để thực hiện các tác vụ automation và claim điểm.

## 4. An toàn dữ liệu & Bí mật
- Toàn bộ secret (email, OTP, session cookies) phải được bảo vệ bằng Windows DPAPI (`mailbox-vault.cjs`).
- KiotProxy lease bắt buộc phải được giải phóng qua khối `finally` kèm đối soát Database.
- Tuyệt đối không commit dữ liệu nhạy cảm lên git.
