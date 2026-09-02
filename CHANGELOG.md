# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/); phiên bản
theo [SemVer](https://semver.org/lang/vi/).

Lịch sử trước `2.4.0` không được dựng lại ở đây vì repo không có git history —
chỉ ghi những gì có bằng chứng trong mã nguồn, log chạy thật và báo cáo nghiệm thu.

---

## [Unreleased] — engine automation CapCut

Phần này thuộc `Automation_Capcut` (repo riêng, có git history 31+ commit) và sẽ
theo code vào bản gộp. Tất cả nguyên nhân gốc dưới đây **đo được trên browser
thật**, không suy luận từ đọc code.

### Fixed

- **`capcut_web_design_studio_canvas_edit` trượt 22/22 lượt.** Panel chat
  "Design with AI" (rộng 440px, ghim mép phải) phủ đúng nút Send của Canvas
  prompt panel trong cửa sổ Multilogin (đo được 929px). `humanClick` bắn toạ độ
  thô qua `page.mouse` — Playwright không kiểm element nào nằm trên — nên click
  rơi vào khung chat và log vẫn in "Đã bấm Send canvas".
  Đo tại chỗ: nút Send ở `(611,718)` nhưng `document.elementFromPoint(627,734)`
  trả `root-slqgv1 skillPanel-4DcNp3`; bấm "Hide chat" thì cùng điểm đó trả về
  svg trong nút Send, click lại → `do_action err_no=0` sau ~1 giây.
  → Ẩn khung chat trước khi thao tác canvas + `assertHittable` chặn click mù.
  **Nghiệm thu: 8/8 lượt.**

- **Video Studio mất 3 nhiệm vụ vì bấm nhầm `Continue`.** CapCut chen card
  `Use advanced features with Pro` (Skip / Continue) giữa "gửi prompt" và
  "generate". `Continue` ở card đó **mở bảng giá**, không generate; bảng giá phủ
  trang nên lượt thử sau không mở được dropdown chế độ tạo, rồi không có node để
  export — cả ba nhãn lỗi `no_new_node`, `missing_option_Image`,
  `no_node_to_export` là một chuỗi từ một cú click sai.
  → Bấm `Skip`, tự đóng `subscriptionModal` nếu nó đã mở.

- **Account chỉ còn thiếu `export` thì bế tắc vĩnh viễn.**
  `/ai-creator/studio?enter_from=credit_task` mở **draft trắng**, ảnh của lượt
  trước không nằm trên canvas; code cũ ném `no_node_to_export` nên không bao giờ
  có gì để export. → Tách `generateImage()` làm đường dự phòng, chỉ chạy khi
  canvas thật sự trống.

- **Click export không sinh `do_action`.** Node xuất hiện ngay lúc CapCut *bắt
  đầu* tạo (`Creating 93%`); lúc đó nút toolbar là `lv-btn-disabled` +
  `pointer-events: none` nên hit-test rơi xuống wrapper `toolbar-image-icon-*`.
  Tương quan qua 14 lượt của 2 lần chạy độc lập: `nút thứ 3/5` → `err_no=0`
  6/6 lượt; `nút thứ 2/4` → **không bao giờ** có `do_action` 8/8 lượt.
  → `waitNodeRendered()` chờ node hết `progressText`/skeleton trước khi chạm
  toolbar, và tôn trọng giá trị trả về của `waitEnabled` (trước đây bị bỏ).

- **`push_authorize` và `task_list` cùng một nguyên nhân: bấm vào vỏ rỗng.**
  Trên `/my-edit`, `[data-id="TitleBarFreeCredits"]` chỉ bọc một `<span>` **rỗng**;
  lối vào thật là `[data-id="TitleBarTaskList"]` → `.Lv_Task-wrapper` 40×40. Chữ
  "Free credits" xuất hiện **0 lần** trên trang đó, và `locator(a, b).first()`
  lấy theo **thứ tự DOM** nên luôn bốc trúng cái vỏ. Hệ quả: popover không mọc →
  bước bật thông báo báo "không thấy dòng nhiệm vụ", còn `bootstrap` báo "không
  bắt được task_list" — hai địa chỉ sai cho cùng một lỗi.
  → `TASK_ENTRY_SELECTORS` có thứ tự ưu tiên + `findTaskEntry()` chỉ nhận lối vào
  **có kích thước thật** (`boundingBox` lọc vỏ 0×0).

- **Task cha `design_studio_picture_creation` (+80) kẹt ở `status=2`.**
  `claimIfPending` chạy trên `/ai-design`, nơi `TitleBarTaskList` không tồn tại,
  nên popover không thể mở để bấm Claim. → `withTaskPopover` tự chuyển sang
  `/my-edit` khi trang hiện tại không có lối vào nào.

### Added

- `assertHittable(page, locator, what)` trong `src/diag.ts`: hỏi trang bằng
  `document.elementFromPoint` xem điểm giữa element có trả về đúng nó không, bị
  che thì **ném** kèm tên thủ phạm + dump. Biến cả một lớp lỗi "click thành công
  mà không tới đích" từ im lặng 90–240 giây thành lỗi tức thì có địa chỉ.
- Fail-loud cho luồng canvas: đọc lại DOM xác nhận prompt đã vào ô, ném nếu nút
  Send còn disabled sau 10s, dump khi không thấy `Stop generating`.
- Chẩn đoán lối vào nhiệm vụ: log element sẽ bấm và số dòng popover sau từng lần
  bấm; log `Push subscription` (service worker + endpoint) cho nhiệm vụ thông báo.
- `tools/fixtures/dom-studio-pro-upsell.html` + 10 assertion mới trong
  `npm run selectors` (41 → **51**), gồm test occlusion cho `assertHittable` và
  khoá lại bẫy `Continue`/`Skip` của card upsell.

### Changed

- Bước bật thông báo bấm luôn nút `Allow` ở thanh alert
  "Allow notifications from CapCut?" — đúng hành động nhiệm vụ, không cần popover.
- `bootstrap` leo thang thêm một bậc: `/ai-design` → popover → reload →
  **`/my-edit`** trước khi bỏ cuộc.

### Kết quả chạy thật (02/09/2026)

11 account hoàn tất trong ~1 giờ 20 phút, ≈ **20.620 credits**; `accounts.txt`
từ 7 lên 18 dòng `#DONE`. Lượt batch 21 account trước fix chỉ đánh dấu được 3
account, mà 2 trong đó là account **đã xong sẵn** (mọi nhiệm vụ "0 lần thử").

### Chưa sửa

- `yuzhpxhu31823`: `locator.waitFor: Timeout 25000ms` trong luồng đăng nhập —
  lỗi rời rạc, chưa có nguyên nhân gốc.
- **Popover nhiệm vụ vẫn không mọc trên một số account** dù lối vào đã chọn đúng
  `div[data-id=TitleBarTaskList]`: bấm 2 lần × 2 lượt, `taskRow` vẫn 0
  (`vhgmmkws02852`, 02/09/2026). Đã loại trừ được giả thuyết proxy chặn push:
  `Push subscription` trả endpoint FCM thật. Hai nhánh còn lại — handler nằm ở
  element con, hoặc dòng popover dùng class khác — chưa phân giải.
- `jksqtiqa24961`, `yrqfvwwk67499`: `Không bắt được task_list` kể cả sau bậc leo
  thang `/my-edit`; log báo "không có lối vào nhiệm vụ nào có kích thước thật"
  ⇒ header của hai account này còn một biến thể nữa chưa đo.
- Chọn browser GoLogin / GPM Login / Camoufox / Patchright vẫn báo
  `PROVIDER_NOT_IMPLEMENTED` (đúng theo thứ tự ưu tiên đã đặt).

---

## [2.4.0] — 2026-09-01 — bỏ mock, móc API thật

Nguồn: [`docs/report/verification-report.html`](docs/report/verification-report.html).

### Added

- 4 provider API thật: Multilogin (JWT + refresh + quick profile), KiotProxy
  (xin IP mới, đối chiếu `/get-current`), Gmail94 (OTP), DongVanFB (OAuth2 →
  fallback Graph); thêm `CustomDomainMailProvider`.
- 8 service ở main process: `AutomationRunService`, `ProxyLeaseManager`,
  `LazyProxyLeaseSource`, `EmailPurchaseService`, `MultiloginAuthService`,
  `LogBus`, `AccountService`, `SettingsService`, cùng `ProviderRegistry` và
  `ServiceConnectionManager`.
- 11 kênh IPC invoke + 3 kênh push, preload bridge gõ kiểu chặt, không expose
  `ipcRenderer` thô.
- Dừng theo từng luồng: `run:stop-thread`, `run:threads`, nút Dừng mỗi dòng;
  `stopAllQuickProfiles` bị xoá hẳn và có test chặn nó quay lại.
- Panel Proxy Provider API trong Settings (trước đây KiotProxy không có ô nhập);
  nút "Kiểm tra API" gọi API thật rồi cache trạng thái + số dư.
- `.env.example` + `npm run verify:providers`; thao tác tốn tiền nằm sau cờ riêng.
- 3 migration SQLite: `app_settings`, `service_credentials`, `accounts`,
  `runtime_logs`, `purchased_emails`, `proxy_leases`.

### Fixed (8 lỗi chỉ lộ ra khi gọi API thật)

1. Multilogin không trả `port` ở response `/profile/quick` → `port` thành
   nullable, đọc sau từ `/profile/quick/statuses`.
2. Launcher chỉ publish cổng CDP khi start kèm `automation` type → luôn start với
   `automation: 'playwright'`.
3. KiotProxy trả key ở field `value` (không phải `key`), `expirationAt` là epoch
   ms → sửa parser, loại key `deleted`/không `ACTIVE`.
4. DongVanFB trả `list_data` **lồng trong** `data` → mua thành công mà app throw
   và mất mailbox đã trả tiền.
5. Refresh token Multilogin bị rotate mỗi lần signin, trả HTTP 400 (không phải
   401) → map sai thành `CONFIG_ERROR` nên nhánh fallback signin không chạy.
6. Grid tài khoản trống khi đang chạy vì controller chỉ tải lại lúc
   `stopped`/`failed` → nút Dừng từng luồng không bấm được.
7. Deadlock khi số luồng > số proxy key: cả 30 luồng xin proxy trong một
   `Promise.all`, key chỉ nhả ở teardown → chuyển sang worker pool đúng bằng số
   key khả dụng.
8. Thiếu API dừng theo luồng.


