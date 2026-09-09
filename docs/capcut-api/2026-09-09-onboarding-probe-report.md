# Báo Cáo Thử Nghiệm Onboarding & Đăng Ký Thật (2026-09-09)

## 1. Mục Tiêu & Quyết Định Chiến Lược

Dựa trên chỉ đạo:
- **Chuyển đổi hoàn toàn sang `api-v3`**: Loại bỏ mặc định `xcli` và chuyển toàn bộ hệ thống (default settings, Zod schemas, UI Settings panel, runtime factory) sang Multilogin `api-v3`.
- **Thử nghiệm Option C & B với 1 email thật**: Tận dụng hộp thư đã mua trên Gmail94 (`pheakdychea439278@gmail.com`, Order `6aa11af4c0e47`), không mua thêm mailbox mới.
- **Thu thập dữ liệu thực tế**: Bắt trọn vẹn 291 HTTP responses từ luồng đăng ký CapCut thật để đối soát với tài liệu reverse-engineering trong `Capture/` và `docs/capcut-api/`.

---

## 2. Kết Quả Triển Khai & Bản Chất Lỗi `ret: 1014` ("System Busy")

### 2.1 Tại Sao Option C (Pure HTTP Signup) Thất Bại?
- Khi gửi request đăng ký hoặc xác minh email trực tiếp qua HTTP client không có trình duyệt (dù dùng TLS fingerprint giả lập):
  - CapCut Passport yêu cầu dynamic security tokens được sinh bởi JavaScript engine: `verifyFp`, `msToken`, `s_v_web_id`, `X-Bogus`, `X-Gnarly`.
  - Nếu thiếu các token hoặc fingerprint không trùng khớp với execution context, ByteDance Web WAF trả về `ret: 1014` ("system busy").
  - Do đó, việc đăng ký tài khoản mới bằng Pure HTTP độc lập mà không qua browser là **không khả thi** trong môi trường bảo mật hiện tại của CapCut.

### 2.2 Tại Sao Option B (Hybrid Onboarding via Multilogin `api-v3`) Thành Công 100%?
- **Khởi chạy profile**: Sử dụng Multilogin `api-v3` (`/api/v3/profile/quick` với Mimic browser + automation Playwright) gắn KiotProxy lease (`42.113.82.64:28227`).
- **Tự động hóa Headed/Browser**:
  1. Mở trang `/signup?lang=en`.
  2. Điền email `pheakdychea439278@gmail.com`, submit password, đồng ý điều khoản.
  3. **Vượt rào Birthday (Age-Gate)**: Tự động phát hiện modal "When's your birthday?" và điền Year: 1998, Month, Day. Gọi thành công `/lv/v1/sc/age_gate/check_age_without_uid` (`ret: 0`).
  4. **Lấy & Điền OTP**: Polling Gmail94 Order `6aa11af4c0e47` trong 1.7 giây, nhận OTP `650392`, điền vào form CapCut.
  5. **Hoàn tất Onboarding**: Trình duyệt điều hướng thành công vào `/my-edit?lang=en&enter_from=signup&start_tab=video`.
- **Dữ liệu thu được**:
  - `user_id_str`: `7683455633131357192`
  - `screen_name`: `user7362776678800`
  - Default `workspace_id`: `7683455690274390023` (5GB storage, role 'owner', region 'VN', idc 'sg1')
  - Thu hoạch 52 authenticated cookies (bao gồm `sessionid`, `sessionid_ss`, `uid_tt`, `passport_csrf_token`, `s_v_web_id`).
  - Tài khoản được lưu an toàn vào SQLite `accounts` với trạng thái `active` và mật khẩu mã hóa DPAPI (`ef2dc665-b313-4382-a66c-cf5607aa31e4`).

---

## 3. Xác Minh CycleTLS Độc Lập Sau Onboarding

Sau khi tài khoản đã được kích hoạt thành công qua Multilogin, chúng tôi đã trích xuất 52 cookies đã mã hóa và thực hiện các request HTTP độc lập qua `CycleTLS` thông qua proxy KiotProxy (`118.70.18.161:18798`):

| Endpoint | Method | Domain | Kết Quả HTTP | Payload / Data Thu Nhận |
| :--- | :--- | :--- | :--- | :--- |
| `/passport/web/account/info/` | `GET` | `www.capcut.com` | **200 OK** | `user_id_str: "7683455633131357192"`, `screen_name: "user7362776678800"`, `message: "success"` |
| `/luckycat/i18n/capcut/task/v1/task_list` | `POST` | `edit-api-sg.capcut.com` | **200 OK** | `err_no: 0`, trả về đầy đủ **12 nhiệm vụ** (`100005` đến `100016`) |
| `/cc/v1/workspace/get_user_workspaces` | `POST` | `edit-api-sg.capcut.com` | **200 OK** *(Trong Browser)*<br>*(HTTP cần sign headers)* | Trong phiên browser: trả về `ret: 0`, 2 workspace infos.<br>Trong pure HTTP: cần các header chữ ký (`sign`, `did`, `device-time`). |

---

## 4. Danh Mục Endpoint Thực Tế Quan Trọng Đã Bắt Được (291 Payloads)

1. **Authentication & Identity**:
   - `POST https://www.capcut.com/passport/web/user/check_email_registered`: Kiểm tra email đã đăng ký chưa.
   - `POST https://www.capcut.com/passport/web/email/send_code/`: Gửi mã OTP.
   - `POST https://www.capcut.com/passport/web/email/register_verify_login/`: Xác thực OTP và đăng nhập/đăng ký.
   - `GET https://www.capcut.com/passport/web/account/info/`: Lấy thông tin user (ID, avatar, screen name).
2. **Age Gate & Compliance**:
   - `GET https://www.capcut.com/lv/v1/sc/age_gate/get_age_gate_config`: Lấy cấu hình yêu cầu tuổi.
   - `POST https://www.capcut.com/lv/v1/sc/age_gate/check_age_without_uid`: Kiểm tra ngày sinh trước khi có UID.
   - `POST https://www.capcut.com/lv/v1/sc/age_gate/set_birthday_by_uid`: Gắn ngày sinh vào UID sau khi đăng ký.
   - `POST https://www.capcut.com/lv/v1/sc/compliance_popup/submit_consent`: Gửi đồng ý điều khoản cookie / privacy.
3. **Workspace & Subscription**:
   - `POST https://edit-api-sg.capcut.com/cc/v1/workspace/get_user_workspaces`: Danh sách workspace của user.
   - `POST https://edit-api-sg.capcut.com/cc/v1/workspace/mget_workspace_info`: Chi tiết thông tin workspace.
   - `POST https://commerce-api-sg.capcut.com/commerce/v1/subscription/user_info`: Thông tin gói thuê bao của user.
   - `POST https://commerce-api-sg.capcut.com/commerce/v1/subscription/workspace/space_list`: Danh sách dung lượng workspace.
4. **Tasks & Rewards**:
   - `POST https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list`: Danh sách toàn bộ nhiệm vụ tân thủ và nhiệm vụ creator.

---

## 5. Kết Luận & Hướng Đi Tiếp Theo

1. **Kiến Trúc Onboarding Chuẩn**:
   - Khởi tạo tài khoản bắt buộc phải đi qua Multilogin `api-v3` + browser interaction (Option B) để vượt qua lớp kiểm tra bot và tuổi (age-gate).
2. **Khai Thác Sau Onboarding**:
   - Sau khi cookie phiên được lưu trữ, các tác vụ đọc nhiệm vụ (`task_list`), kiểm tra trạng thái tài khoản (`account/info`) hoàn toàn có thể chạy nhanh qua `CycleTLS` hoặc trong phiên browser của `AutomationRunService`.
3. **Sẵn Sàng Chạy Tự Động**:
   - Toàn bộ codebase hiện đã sạch sẽ, chuẩn `api-v3`, không còn phụ thuộc vào `xcli`.
   - SQLite và DPAPI bảo mật mật khẩu và cookie phiên hoạt động ổn định.
