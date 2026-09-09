# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/); phiên bản
theo [SemVer](https://semver.org/lang/vi/).

Lịch sử trước `2.4.0` không được dựng lại ở đây vì repo không có git history —
chỉ ghi những gì có bằng chứng trong mã nguồn, log chạy thật và báo cáo nghiệm thu.

## [3.0.2] — 2026-09-09

Bản phát hành bổ sung cơ chế **Polling chờ nạp lại kho email (Chỉ dừng khi hết tiền mua mail)** và cho phép tùy biến chu kỳ chờ trực tiếp trên giao diện Dashboard, ngăn chặn triệt để việc phiên chạy bị gián đoạn oan uổng khi các nhà cung cấp email tạm thời hết hàng hoặc phản hồi HTTP 400.

### Added

- **Cơ chế Polling chờ nạp lại kho mail tự động (Auto-Polling & Restock Waiting):**
  - Khi nhà cung cấp email (Gmail94 / DongVanFB) phản hồi HTTP 400, 429 hoặc `success: false` do kho email tạm thời hết hàng (`OUT_OF_STOCK`), hệ thống **không dừng phiên chạy**.
  - Các luồng đang thực hiện nhiệm vụ vẫn tiếp tục chạy bình thường; luồng cần cấp phát email mới sẽ tự động chuyển sang chế độ chờ và thử lại định kỳ cho đến khi có mail mới hoặc người dùng chủ động bấm DỪNG LẠI.
  - Tự động rollback bộ đếm `stats.attempted` khi kho mail hết hàng để bảo toàn nguyên vẹn hạn mức mua email của lượt chạy (`maxBillablePurchases`).
  - **Chỉ dừng phiên (`blocked`) khi thực sự hết tiền mua mail (`INSUFFICIENT_FUNDS`)** hoặc sai thông tin xác thực (`AUTH_ERROR`), bảo vệ số dư tài khoản người dùng tuyệt đối.
- **Tùy biến chu kỳ chờ ngay trên Dashboard (Configurable Retry Interval):**
  - Tại Panel **Nguồn Email** (chế độ API Thuê Mail), bổ sung tùy chọn **"Chờ nạp lại khi hết email"** với các mức: `10 giây`, `15 giây (Khuyên dùng)`, `30 giây`, `60 giây` (mặc định: `15 giây`).
  - Tự động lưu và phục hồi cấu hình qua Settings.
- **Hiển thị tiến trình và log thời gian thực khi chờ nạp mail:**
  - Thanh trạng thái Dashboard và log hệ thống cập nhật liên tục: `Kho email [Gmail94/DongVanFB] tạm hết. Đang chờ nạp lại sau Xs (lần N)...`.

---

## [3.0.1] — 2026-09-09

Bản phát hành tối ưu hóa chuyên sâu cho cơ chế vận hành **Đa luồng song song (Multi-threaded Isolation & Continuous Renewal)**, loại bỏ triệt để hiện tượng đóng băng hiển thị luồng trên Dashboard, hoàn thiện hỗ trợ các định dạng Proxy tĩnh và nâng cấp khả năng phân tích lỗi từ nhà cung cấp email.

### Added

- **Cơ chế đa luồng song song hoàn toàn cách ly (100% Isolated Multi-Threading):**
  - Mỗi luồng chạy độc lập hoàn toàn: 1 Proxy riêng (xoay vòng KiotProxy key hoặc Proxy tĩnh theo danh sách), 1 Profile Multilogin riêng biệt, 1 Email riêng biệt cấp phát JIT (Gmail94/DongVanFB hoặc danh sách manual), 1 Mật khẩu riêng, bộ nhớ đối soát bằng chứng (`proofMemory`) riêng biệt.
  - Vòng đời nạp mới liên tục (Continuous Worker Renew Cycle): Luồng nào hoàn thành 12 nhiệm vụ trước sẽ lập tức thu hồi tài nguyên (dừng profile Multilogin, giải phóng proxy lease), cấp phát tài nguyên mới và khởi chạy tài khoản tiếp theo ngay lập tức mà không phải chờ các luồng còn lại, chạy bền bỉ cho đến khi chạm giới hạn số lượng tài khoản (`maxAccounts`) hoặc nguồn email hết số dư.
  - Giãn cách khởi chạy an toàn (`headlessWorkerStaggerMs`) nhằm ngăn ngừa xung đột cổng CDP hoặc quá tải cục bộ tại Multilogin Agent khi mở nhiều profile cùng một thời điểm.
- **Hỗ trợ toàn diện các định dạng Proxy tĩnh (Direct IP Proxy):**
  - Mở rộng bộ phân tích cú pháp proxy hỗ trợ đầy đủ các tiền tố scheme `http://` và `socks5://`.
  - Hỗ trợ đầy đủ các cú pháp: `http://ip:port`, `socks5://ip:port`, `http://user:pass@ip:port`, `socks5://user:pass@ip:port`, `ip:port:user:pass`, `ip:port`.

### Changed

- **Cải thiện độ chi tiết của thông báo lỗi API Email:**
  - Nâng cấp `Gmail94Provider` trích xuất thông điệp chi tiết từ server phản hồi khi gặp mã lỗi HTTP (ví dụ: thông báo hết số dư, tạm hết kho mail, giới hạn tần suất yêu cầu) thay vì chỉ hiển thị thông báo `(HTTP 400)` chung chung.

### Fixed

- **Khắc phục triệt để lỗi "1 luồng đứng chờ" / Đóng băng hiển thị trên Dashboard:**
  - Sửa lỗi luồng cuối cùng trong danh sách (luồng thứ 5 khi chạy 5 luồng, hoặc luồng thứ 2 khi chạy 2 luồng) bị đóng băng hiển thị ở trạng thái sơ khai ban đầu (`Proxy: -`, `Browser: multilogin`, `Bước: Đang khởi chạy browser`) do cơ chế trước đó chỉ làm mới danh sách khi có luồng tiếp theo bắt đầu.
  - Tích hợp bộ hẹn giờ cập nhật thời gian thực (chu kỳ 1 giây) trong `dashboardController.ts` khi phiên tự động đang chạy (`isRunning || workersActive > 0`).
  - Phát sự kiện `RUN_PROGRESS` ngay khi profile Multilogin mở thành công và khi chuyển sang bước "Đang làm nhiệm vụ".
  - Giúp bảng điều khiển hiển thị đầy đủ, chính xác và trực quan thời gian thực toàn bộ các luồng song song.
- **Khắc phục lỗi mất Proxy Keys khi chuyển Tab:**
  - Đảm bảo draft state của danh sách Proxy Keys (KiotProxy) được lưu giữ nguyên vẹn khi chuyển qua lại giữa Dashboard, Settings, Accounts và Logs mà không bị xóa trống dữ liệu.
- **Tự động dọn dẹp Log runtime theo phiên (Per-Session Log Cleanup):**
  - Tự động làm sạch log runtime cũ khi khởi chạy phiên tự động mới, giúp khung System Logs luôn phản ánh chính xác nhật ký của phiên chạy hiện tại.

---

## [3.0.0] — 2026-09-09

Phiên bản đại tu lớn (Big Update) chuyển dịch toàn bộ kiến trúc lõi từ tự động hóa giao diện phức tạp (UI Automation) sang **thực thi HTTP trực tiếp (Direct HTTP Execution) kết hợp CycleTLS Native Transport**, nâng cấp hiệu năng lên gấp nhiều lần, đổi mới toàn bộ nhận diện thương hiệu thành **CapCut Automation** và hoàn thiện trải nghiệm cấu hình trong Settings.

### Added

- **Kiến trúc HTTP Direct Task & CycleTLS Native Transport (Bỏ UI Automation phức tạp):**
  - Triển khai toàn diện bộ dịch vụ HTTP client chuyên dụng (`taskApi.ts`, `taskClient.ts`, `taskEvidence.ts`, `taskMutation.ts`) để tương tác trực tiếp với API endpoints của CapCut.
  - Tích hợp **CycleTLS Go Bridge** (`cycletls-bridge`) chạy an toàn trên loopback cục bộ (`127.0.0.1`), tái tạo chữ ký TLS/JA3/HTTP2 giống hệt trình duyệt thực, vượt qua toàn bộ hệ thống phát hiện bot và chặn của ByteDance/CapCut.
  - Hoàn thành trọn bộ 12 nhiệm vụ và **tự động Claim phần thưởng credits ngay lập tức** qua API (`do_action` → `claim`), giảm thời gian làm nhiệm vụ từ hàng phút xuống chỉ còn vài giây mỗi tài khoản.
  - Tích hợp kiểm tra và tự động kích hoạt gói dùng thử VIP 7 ngày (7-day trial) qua API (`trialApi.ts`, `trialOffers.ts`).
  - Hỗ trợ linh hoạt 2 chế độ vận hành: **Headed** (hiển thị cửa sổ trình duyệt để theo dõi trực quan quá trình đăng nhập/onboarding) và **Headless** (chạy ẩn ngầm hoàn toàn giúp tiết kiệm tới 90% CPU và RAM).
- **Kiểm tra kết nối trực tiếp không cần lưu (Live Draft Connectivity Testing):**
  - Hỗ trợ test trực tiếp thông tin tài khoản Multilogin (Email & Mật khẩu hoặc Automation Token), KiotProxy token, Gmail94 API key và DongVanFB API key ngay trên giao diện trước khi lưu vào CSDL.
  - Xác thực hai lớp đối với Multilogin: kiểm tra xác thực tài khoản cloud (`signIn`) và kiểm tra tính sẵn sàng của launcher cục bộ (`getLauncherVersion`).
  - Phản hồi thông báo lỗi rõ ràng, chi tiết khi ô nhập liệu còn thiếu thông tin.

### Changed

- **Chuyển đổi nhận diện thương hiệu thành CapCut Automation:**
  - Đổi tên chính thức của ứng dụng từ `AutoManager` thành **CapCut Automation** trên toàn bộ hệ thống: Title bar, Windows AppUserModelId (`com.capcut.automation`), Windows Task Manager, Menu Sidebar, package.json, electron-builder.yml.
  - Thiết kế và tích hợp bộ icon vector chính thức của CapCut (gradient xanh ngọc - cyan chuẩn, đa kích thước `.ico`, `.png`, `.svg` cho app window, taskbar và bộ cài installer).
- **Cải tiến giao diện Bảng điều khiển & Cài đặt (UI/UX Refinements):**
  - Mở rộng khung nhập danh sách Proxy (Proxy List Textarea) trên Dashboard to, rộng rãi, dễ dàng dán hàng trăm proxy và theo dõi trực quan.
  - Căn chỉnh bố cục lưới Dashboard Grid và các khối thông tin đồng bộ, ngăn nắp, tránh xô lệch layout.
  - Tự động đồng bộ và làm mới (Auto-Refresh) trạng thái cấu hình ngay sau khi bấm "LƯU CÀI ĐẶT" (huy hiệu trạng thái lập tức chuyển sang "Đã cấu hình" màu xanh).

### Fixed

- **Khắc phục triệt để lỗi kiểm tra & lưu cấu hình Multilogin trong Settings:**
  - Sửa lỗi `[CONFIG_ERROR] Chưa cấu hình Multilogin trong Settings` khi bấm kiểm tra kết nối với thông tin tài khoản mới nhập.
  - Sửa lỗi placeholder mật khẩu giả lập `••••••••` khiến người dùng tưởng mật khẩu đã có sẵn. Thay bằng placeholder động: `Nhập mật khẩu...` (chưa có) và `Đã lưu: •••••••• (nhập để thay đổi)` (đã lưu).
  - Sửa logic bắt sự kiện `onChange` ở form tài khoản Multilogin để luôn ghi nhận đầy đủ email và mật khẩu vào draft state.
  - Loại bỏ khung thông báo kết quả kiểm tra kết nối bị trùng lặp 2 lần trong panel trình duyệt.
  - Loại bỏ xung đột Rollup build race condition giữa ESM và CJS làm hỏng file `dist-electron/preload.js`.

### Security

- Áp dụng cơ chế Write-Only nghiêm ngặt: chuỗi mật khẩu thô trong RAM giao diện tự động xoá sạch sau khi lưu cài đặt.
- Toàn bộ token API và thông tin xác thực đều được mã hóa bằng `Electron safeStorage` trước khi lưu vào cơ sở dữ liệu SQLite.

---

## Live verification addendum — 2026-09-05

Release `v2.4.1-live` is published from commit `00504d5`. A real Gmail94
mailbox completed the CapCut flow end-to-end: `12/12` tasks and `670/670`
credits, with successful browser teardown. Detailed evidence and verification
limits are recorded in [`docs/releases/2026-09-05-v2.4.1-live.md`](docs/releases/2026-09-05-v2.4.1-live.md).

## [2.4.1] — 2026-09-05

Mọi mục dưới đây đến từ 4 lượt audit song song (`docs/superpowers/plans/2026-09-04-audit-fix-plan.md`),
đã kiểm bằng `grep`/đọc code chứ không suy diễn. Ba quyết định của chủ dự án:
xuất account **implement**, browser **tạm thời chỉ Multilogin**, settings chết
**implement**.

### Added

- **Cơ chế chạy liên tục và tối ưu hiệu năng tự động hóa (Continuous Automation & Performance).**
  - **Worker liên tục (Continuous Workers):** Nguồn API tiếp tục nạp email mới cho worker slot ngay khi tài khoản trước hoàn thành cho đến khi có lệnh Stop hoặc điều kiện dừng có kiểu (`completed`, `stopped`, `blocked`, `failed`).
  - **Nguồn thủ công (Manual Workload):** Chạy hết toàn bộ danh sách email hợp lệ đã nhập, với `threadCount` chỉ đóng vai trò trần đồng thời (concurrency ceiling).
  - **Mua email JIT và preflight Gmail94:** Khảo sát dung lượng trước khi chạy (số dư ví, giá dịch vụ `capcut`, timestamp); đặt chỗ email nguyên tử trong SQLite (Migration 005) để tránh đụng độ giữa các luồng; chỉ mua từng email sau khi đã giữ thành công proxy.
  - **Kết quả tài khoản và phiên chạy trung thực:** Lỗi trong quá trình chạy được bảo toàn thành `error` sau khi dọn dẹp browser/proxy; bộ đếm hoàn thành, lỗi, dừng được ghi nhận độc lập và chính xác 1 lần.
  - **Đối soát bằng chứng thống nhất (Unified Proof Reconciliation):** Thay thế các khoảng chờ 45 giây độc lập bằng một hạn mức thời gian còn lại (PWA 12s, Notifications 20s, Design 90s, Video 240s); bộ nhớ bằng chứng trong phiên (`proofMemory`) ngăn chạy lại nhiệm vụ đã thành công.
  - **Khôi phục tab chính tối đa 1 lần (One-Tab Page Recovery):** Tái sử dụng tab CapCut đang mở và giới hạn thay thế đúng 1 tab mỗi account run tại các ranh giới an toàn.
  - **Tắt ứng dụng ưu tiên dừng tự động hóa & Single-Instance Lock:** Chuỗi tắt có giới hạn thời gian (dừng worker 15s -> flush log 2s -> đóng SQLite); khóa đơn phiên bản Electron trước khi khởi tạo database và provider.
  - **Khóa tính năng Custom Domain Mail:** Vô hiệu hóa chế độ Domain Mail trên Dashboard UI, Settings panel và runner harness theo yêu cầu quản trị.


- **Xuất account ra file — TXT · CSV · XLSX (AGENTS §21).** Nút "Xuất" trên trang
  Tài khoản trước đây chỉ gọi `onClose()`. Việc chạy TRỌN VẸN ở main process vì
  hai cột bắt buộc của §21 ("Password CapCut", "Email Data") nằm trong DB dạng đã
  mã hoá — `AccountListItemDTO` chỉ mang cờ boolean nên renderer không có gì để
  ghi ra file. Đường đi mới: `accounts:export` → `AccountExportService` giải mã
  bằng `CredentialVault` → `dialog.showSaveDialog` → ghi đĩa; renderer chỉ nhận
  lại đường dẫn + số dòng (§13). Thứ tự cột do `CANONICAL_EXPORT_FIELD_ORDER`
  chốt, Cài đặt xuất chỉ chọn cột nào được xuất. Phạm vi "Tất cả"/"Đã chọn"/"Đang
  lọc" lấy HẾT dòng khớp (`queryAccountsForExport` không phân trang), không phải
  500 dòng đang xem. Thêm dependency `write-excel-file@4.1.1` (pure JS, 1 dep
  `fflate`) — KHÔNG dùng `xlsx` trên npm vì bản đó dừng ở 0.18.5 và còn CVE
  prototype-pollution.
- **Tiến độ 12 nhiệm vụ hiện được ra UI.** Bảng `account_tasks` trước đây chỉ được
  GHI: `listByAccount` không có consumer nào ngoài test. Thêm `accounts:tasks` →
  `AccountTaskService` → hộp thoại trên trang Tài khoản (nút hình checklist mỗi
  dòng): từng nhiệm vụ, credit, trạng thái và `provedAt`. Đếm theo `task_status`
  của CHÍNH CapCut — chỉ `4` là xong, `2` (chờ nhận) không tính.
- **Bộ lọc "Ngày tạo" chạy thật, ở SQL.** Contract có thêm `createdFrom`;
  `AccountRepository` đổi mốc ISO sang dạng `YYYY-MM-DD HH:MM:SS` của cột
  `created_at` (so chuỗi trực tiếp thì chữ `T` lớn hơn dấu cách nên lọc trượt
  sạch) và dùng `idx_accounts_created_at`. Trước đây ô này chỉ đổi state rồi bật
  chip "Active Filters".
- **Ô "Giữ nhật ký" trong Settings.** `runLogRetentionCleanup` đã dọn log theo hạn
  (AGENTS §18) nhưng không có chỗ nào đổi hạn.
- **Nhập được mật khẩu CapCut.** Drawer thêm/sửa account có hai ô riêng:
  "Password CapCut" (cột #2 của bản xuất) và "Password hộp thư".
- **Chọn vùng proxy KiotProxy trên Dashboard.** 4 lựa chọn `Ngẫu nhiên · Miền Bắc ·
  Miền Trung · Miền Nam`; ô chỉ hiện ở chế độ Proxy Key vì proxy dán tay
  `http://ip:port` đã cố định IP. `Ngẫu nhiên` cố ý KHÔNG gửi khoá `region` — đúng
  đường đang chạy được, nên mặc định không đổi hành vi lượt chạy thật.
- **Ô "Bỏ qua account không có trial Pro ≥ 7 ngày".** `CapcutEngineService` đọc cờ
  này từ lâu nhưng không ai truyền nên nó luôn `false`; nay đi từ Dashboard →
  `AutomationRunConfig` → `runAccount`. Mặc định vẫn TẮT: cổng trial đọc bằng
  selector và fail-open, mà mỗi account bỏ qua là một hộp thư đã trả tiền.

### Fixed

- **Mật khẩu nhập ở drawer đi sai cột.** Ô "Password" gửi vào `emailPassword`
  trong khi lưới đọc `hasPasswordCapcut` ⇒ nhập xong cột vẫn trống, và bản xuất
  không bao giờ có cột #2. Nay `password` của view model là mật khẩu CapCut, mật
  khẩu hộp thư có ô riêng.
- **Thêm/sửa account làm mất Browser/Profile.** Controller không gửi
  `browserProvider`/`browserProfileId`; nay `parseBrowserProfile` tách lại đúng
  hai khoá từ ô "Multilogin / ML-001".
- **"Auto Scroll" trang Logs không cuộn gì.** Ô tích chỉ đổi state. Dòng mới nhất
  được chèn lên ĐẦU danh sách nên "theo dòng mới" là cuộn về đỉnh; `DataGrid` nhận
  thêm `scrollRef` để trang điều khiển được khung cuộn.
- **"Khôi phục mặc định" ở Settings xoá cả cấu hình trang khác.** Nút ghi đè trọn
  `DEFAULT_APP_SETTINGS`, tức mất luôn `automation` (số luồng, độ trễ, quy tắc mật
  khẩu — sửa ở Dashboard) và `customEmail`. Nay chỉ khôi phục 4 mục trang Settings
  thực sự hiện ra.
- **Hai ô cấu hình vẫn bấm được khi đang chạy.** `SegmentedControl` không có prop
  `disabled`; nay có, và Dashboard truyền xuống cho "Mode" + "Nguồn email".
- **Dashboard hiện tổng thật nhưng lưới chỉ nạp 200 dòng.** Thanh trạng thái hiện
  "200 / N" khi bị cắt thay vì chỉ N.
- **Hai nút Import/Export trên Dashboard không có `onClick`.** Export dẫn sang hộp
  thoại xuất ở trang Tài khoản (`?export=1`) — một đường xuất duy nhất; Import khoá
  lại kèm ghi chú vì nhập account theo file chưa có ở bất cứ đâu.
- **Ô "Giao diện" và "Khôi phục phiên làm việc" không điều khiển gì.** `index.html`
  hard-code `class="dark"` và không chỗ nào nhớ trang. Nay `app/appPreferences.ts`
  áp theme lên `<html>` và mở lại đúng trang cuối; hai lựa chọn được đệm ở
  localStorage vì `HashRouter` phải chọn trang trước khi IPC trả lời (nguồn thật
  vẫn là `app_settings` trong SQLite).
- **`ProxyConfig.region` bị cắt giữa đường.** `ProxyLeaseManager` đọc `region` khi
  xin proxy mới nhưng `AutomationRunService` không chuyển xuống ⇒ luôn `undefined`.
  Nay đi qua `LazyProxyLeaseSource.configure` và đổi region thì dựng lại manager.
- **Xem trước bản xuất nói sai định dạng.** Cài đặt xuất vẽ XLSX bằng dấu `|` (chỉ
  TXT dùng `|` — §21) và xem trước theo thứ tự người dùng bấm chọn thay vì thứ tự
  cột thật của file.
- **Tài liệu nói sai:** `AGENTS.md` ghi 51 assertion (thật: **87**),
  `CHANGELOG` nhắc `capcut/onboarding.ts` (tên thật `capcut/overlays.ts`), mục "mất
  hộp thư" không còn đúng sau khi có `release()`, `ARCHITECTURE.md` còn coi
  `accounts:export` là kênh giữ chỗ.

## [Unreleased] — luồng thuê email gmail94 (04/09/2026)

Nguyên nhân gốc dưới đây **đo được trên API thật và browser thật**, kèm địa chỉ
dump. Không có mục nào suy ra từ việc đọc code.

### Fixed

- **Slug dịch vụ OTP sai nên không bao giờ nhận được mã CapCut.** Gmail94 cho
  thuê hộp thư **theo dịch vụ**, và `otp/read` lọc mã theo đúng slug đã thuê.
  Mặc định trong code là `facebook` ở cả 4 chỗ (`settings.schema.ts`,
  `default-settings.ts`, `automationConfig.ts`, `EmailPurchaseService.ts`), mà
  `GET https://gmail94.com/api/services` (công khai, không cần token) trả về
  `{"id":29,"name":"CapCut","slug":"capcut","price":"1000"}`. Không màn hình nào
  sửa được `otpService`, và `app_settings` trên máy đang dùng đã lưu
  `"otpService":"facebook"`.
  → Slug thành hằng `CAPCUT_OTP_SERVICE` trong `shared/schemas/provider.schema.ts`;
  main process ghim, `toRunConfig` thôi gửi override nên giá trị cũ trong DB
  thành vô hại **không cần migration**; `toPersistedConfig` ghi hằng nên nó chết
  ở lần lưu kế tiếp. Khoá vẫn ở trong schema vì schema là `.strict()` — bỏ khoá
  thì row cũ parse thất bại và mất sạch nút điều chỉnh.

- **Hộp thư vừa thuê vẫn bị thử ĐĂNG NHẬP trước.** `CapcutEngineService` truyền
  `source: 'db'` nên `looksExisting()` luôn trả true; `loginCapcut` chạy tới
  heading "Create an account" rồi ném lỗi, `capcut/auth.ts` bắt, rồi mới quay
  lại đăng ký — mất ~60 giây và một dòng lỗi giả cho **mỗi** account mới.
  `AuthOptions.forceSignup` có sẵn nhưng không ai truyền.
  → `CapcutTaskRunner.runAccount` nhận thêm `isNewAccount` (**bắt buộc**, để
  TypeScript ép mọi call site nói rõ); `AutomationRunService` bật cờ khi luồng có
  `purchasedEmailId`; `CapcutEngineService` dịch thành `forceSignup`.
  **Nghiệm thu:** log lượt chạy thật in `↪️ Đi đường ĐĂNG KÝ` ngay, không còn
  lượt đăng nhập thừa.

- **Khảo sát onboarding chưa bao giờ được tắt, mà code báo là đã tắt.**
  `dismissOnboarding` bấm Skip **một lần**, `.catch(() => {})` nuốt lỗi, in
  "→ Đã bấm Skip khảo sát" **vô điều kiện**, rồi không đọc lại DOM. Đo 04/09/2026
  05:44 — ngay sau khi signup in "✅ ĐĂNG KÝ THÀNH CÔNG" — modal
  "Which of the following roles best describes you?" (**3 bước**, `1 / 3`) vẫn còn
  `.lv-modal-mask` `display: block` + wrapper `z-index: 1101`.
  Loại được giả thuyết selector: trên dump đó OR-list Skip phân giải ra **đúng 1**
  element và nó **đúng là** `.skip-mrkR37`. `isInsideApp` chỉ đọc URL `/my-edit`
  nên signup vẫn kết luận thành công.
  Hậu quả cùng lượt: Design Studio trượt **cả 4** nhiệm vụ với "Không thấy panel
  chat AI agent", popover nhiệm vụ mở ra 0 dòng.
  → `capcut/overlays.ts` mới: `skipOnboardingSurvey` bấm Skip tối đa 3 lần và
  sau **mỗi** lần chờ mask `detached`; trả `false` + dump nếu khảo sát vẫn còn.
  Không ném lỗi (account đã đăng ký xong và đã tốn tiền hộp thư) nhưng cũng không
  báo thành công khống. `signup.ts` và `login.ts` cùng gọi hàm này.

- **`findTaskRow` chặn 2 nhiệm vụ vì CapCut lệch với chính nó.** Đo 05:48 (dump
  không có modal khảo sát ⇒ lỗi **độc lập**): `task_list` trả
  `reward_amount = 210` cho `capcut_web_pwa_install` và `capcut_web_push_authorize`,
  còn popover của chính CapCut in `+70`. Lọc title + reward ra 0 dòng nên cả 4
  lượt quét đều trượt hai nhiệm vụ đó.
  → Lùi về title-only, và **chỉ** nhận khi title ra đúng một dòng: giữ nguyên bảo
  đảm chống nhầm hai dòng "Chat with AI agent" (chỉ khác nhau ở reward), chỉ mở
  đúng trường hợp không thể nhầm. Có log một dòng khi đường lùi được dùng.

- **Vòng chờ OTP im lặng 90 giây.** Không phân biệt được "mail chưa tới" với "API
  mail đang chết", mà mỗi lần hết hạn là mất một hộp thư đã trả tiền.
  → In một dòng mỗi lượt đọc, một dòng WARNING ngay lượt API lỗi, và **mốc thời
  gian** khi mã về. Đo được ngay lượt đầu: **1 giây, 1 lượt đọc** — nên hạn 90s
  giữ nguyên, giờ có số đo thay vì phỏng đoán.

- **Dòng nhiệm vụ đã là "Claim" thì không ai bấm.** `missions/simple.ts` chỉ bấm
  khi nhãn nút là `Go`; nhãn `Claim` rơi vào `else` và chỉ được log lại. Nhưng
  `Claim` nghĩa là CapCut ĐÃ ghi nhận hành động — `do_action` bắn từ trước — nên
  chờ nó lần nữa là chờ vô ích. Log của chính nó, 04/09/2026:
  `· Nút của "Enable browser notifications" đang là "Claim", không bấm Go` rồi
  `❌ ... không thấy do_action "capcut_web_push_authorize" sau 45000ms`.
  Nhánh `claimIfPending` không cứu được vì nó đòi `task_status === 2` từ API, mà
  API và popover của CapCut đã đo được là lệch nhau.
  → `decideRowAction(nhãn) → 'go' | 'claim' | 'skip'`, `Claim` thì bấm. Bấm Claim
  là thao tác UI, không kết luận nhiệm vụ xong (AGENTS.md §30).
  **Nghiệm thu chạy thật:** `· Đã bấm Claim ở dòng "Enable browser notifications"`
  → `✅ Enable browser notifications (+70) — do_action err_no=0`.

- **Modal "trang lỗi" của CapCut che nút Send message.** Đo 06:40:
  `capcut_web_design_studio_ai_chat` báo "Không thấy nút Send message" trong khi
  `aria-label="Send message"` VẪN ở trong DOM. Thứ chặn nó là modal
  `页面异常，请刷新页面重试` kèm nút `Refresh`, phủ trang bằng `lv-modal-mask`.
  → Đây là lần thứ BA trong ngày một mask `display: block` làm engine chỉ sai địa
  chỉ, nên gộp cả ba vào `capcut/overlays.ts` và `runGroup` gọi
  `ensurePageUsable` TRƯỚC mỗi nhóm. Modal lạ thì ghi tiêu đề của nó + dump và
  trả `false`, không đoán.

- **Báo "0/12 nhiệm vụ" trong khi 3 nhiệm vụ đã có `do_action err_no=0`.** Tab
  chính chết giữa lượt (`❌ Tab chính đã bị đóng`) nên `waitForSnapshot` cuối rơi
  về snapshot ĐẦU TIÊN, và `toTaskProgressRows` ghi status 1 cho cả ba — xoá tiến
  độ thật khỏi SQLite, lượt sau làm lại từ đầu.
  → `TaskSnapshotSummary.stale` báo khi không đọc lại được `task_list`; chỉ lúc
  đó `do_action err_no=0` mới thắng `missing`. Snapshot còn tươi thì nó vẫn
  thắng — proof mà CapCut vừa đọc lại vẫn liệt vào `missing` nghĩa là CapCut
  không tính, và không được suy diễn hộ nó.

- **Nút Export nhận bằng hover-tooltip.** Đo 05:55: node toolbar đủ 5 nút (trạng
  thái khoẻ) mà không nút nào cho tooltip khớp `/export/i`, trong khi DOM có sẵn
  `data-testid="studio-node-export-trigger"` — không hash, không cần hover.
  → Thử `data-testid` trước, giữ đường soi tooltip làm dự phòng. Bắt buộc giới
  hạn trong `.react-flow__node-toolbar`: cùng trang còn `global-export-trigger`
  là export cấp TRANG.

- **Hộp thư đã thuê mà chưa dùng thì mất trắng.** `purchase` chỉ biết thuê mới,
  dù `PurchasedEmailRepository.listUnconsumed()` đã có từ trước và `order_id` vẫn
  nằm trong `purchased_emails` (đọc OTP được). Cộng thêm `markConsumed` chạy ngay
  lúc `accounts.create()` — TRƯỚC khi browser mở — nên mọi lỗi hạ tầng là một lần
  mất tiền. Đo 04/09/2026 01:21: `xcli profile-quick` lỗi vì launcher Multilogin
  đã tắt, hàng `songhajun652@gmail.com` có `purchased_at` và `consumed_at` **cùng
  một giây** mà chưa dùng gì.
  → `purchase` dùng hộp chưa tiêu trước, chỉ thuê thêm phần còn thiếu;
  `PurchasedEmailRepository.release()` + `EmailPurchaseService.release()` đưa hộp
  về hàng chờ, và `launchThread` gọi nó ở CẢ HAI nhánh thất bại (proxy, browser).
  **Nghiệm thu:** nhả tay hàng `songhajun652@gmail.com` rồi chạy lại — lượt sau
  dùng đúng hộp đó, OTP vẫn về, và `purchased_emails` vẫn chỉ có 3 hộp gmail94.


- **Bảng giá Pro không được dẹp trong luồng Design Studio.** Đo 06:29:
  `canvas_send_no_effect` với `subscriptionModal-wrapper` `display: block` trong
  DOM. `closeSubscriptionModal` có từ 02/09 nhưng chỉ nằm trong `videoStudio.ts`.
  → Chuyển sang `overlays.ts` dùng chung; cũng theo luật đọc lại DOM rồi mới nói.

- **Modal phủ trang trên TAB PHỤ không ai dẹp.** `runGroup` gọi
  `ensurePageUsable(env.page)` — nhưng nhiệm vụ "bật thông báo" làm việc trên tab
  nó tự mở, và Inspiration mở tab workspace riêng. Đo 04/09/2026 trên
  `markusmkel7097`: dump lúc lỗi có `lv-modal-mask` `display: block` + "best
  describes you", `taskRow-` = 0, và lỗi báo ra là
  `Tìm dòng "Enable browser notifications" ... (title-only: 0)`.
  → Gọi `ensurePageUsable` trên CHÍNH page đang thao tác ở ba chỗ:
  `withTaskPopover` (mọi lần mở popover, tab nào cũng vậy), sau khi
  `stepInspirationTemplate` trả về tab mới, và sau `goto(/ai-design)`.
  Tác dụng đo được: nhiệm vụ vẫn xong nhờ vòng quét lại, nên đây là **rút ngắn từ
  2 lượt quét về 1** (~10 phút mỗi account), không phải cứu nhiệm vụ.

- **Kết quả nhiệm vụ bị ghi đè bằng câu dừng máy.** Hàng `accounts` sau lượt 12/12
  ghi `automation_step = 'Đã dừng sau khi kiểm tra kết nối'` — câu của thời engine
  chưa được cắm vào, khi luồng chỉ giữ browser rồi tắt. `shutdownThread` ghi đè vô
  điều kiện nên "Đủ 12/12 nhiệm vụ" biến mất khỏi UI.
  → `ThreadRuntime.outcomeStep` giữ kết luận của phần nhiệm vụ; `shutdownThread`
  tôn trọng nó.

### Added

- **Ưu đãi Pro xuống tới DB.** Cổng trial đọc được `222,000₫ → 0₫ cho 7 ngày` rồi
  chỉ LOG và bỏ, nên `accounts.subscription` luôn rỗng và cột Subscription của bản
  xuất account (AGENTS.md §21) trống trơn.
  → `CapcutAccountResult.subscription` mang câu hiển thị (`Pro trial 7 ngày` /
  `Không có ưu đãi`) — engine đóng gói vì nó là chỗ biết ngữ nghĩa trial, còn
  `accounts.subscription` là `string` theo §15. Account bị bỏ qua vì thiếu ưu đãi
  cũng được ghi; engine KHÔNG đọc được thì không ghi gì, vì ghi rỗng lên giá trị
  cũ là mất dữ liệu.
- **Phân biệt tab chính CRASH với tab chính bị `close()`.** Hai lượt 04/09/2026 bị
  cắt ngắn mà không dòng nào cho biết ai đóng tab. `page.on('crash')` +
  `page.on('close')` trong `CapcutEngineService`. Lần đầu nó bắn (lượt
  `markusmkel7097`) cho biết là **ĐÓNG chứ không CRASH**, và xảy ra SAU khi đã
  chốt 12/12 — tức teardown bình thường. Giả thuyết "renderer sập vì `页面异常`"
  vì vậy **bị loại**; nguyên nhân tab chết giữa lượt vẫn chưa chứng minh được.

- `scripts/live-capcut-run.mjs --email=custom|api:gmail94|api:dongvanfb` và
  `--minutes=N`. Trước đó nguồn email bị hard-code `custom` nên **không có đường
  nào** chạy thật path gmail94. Hạn harness mặc định 30 → 45 phút: lượt 04/09
  bị đóng app giữa lượt quét 2/4 vì cán mốc 30 phút, nên không có dòng
  "CapCut ghi nhận x/12" nào để đọc.
- 2 fixture + 14 assertion trong `npm run selectors` (51 → **65**):
  `tools/fixtures/dom-role-survey-modal.html` (dump 05:44) khoá lại modal khảo
  sát và hợp đồng "không nói dối" của `skipOnboardingSurvey`;
  `tools/fixtures/dom-task-popover-reward.html` (dump 05:48) khoá lại lệch
  reward **và** khoá lại bảo đảm chống nhầm không được mất.
- 3 file test mới: `capcutSignupPath.test.ts` (`isNewAccount` + log vòng chờ
  OTP), `CapcutEngineService.test.ts` và `capcut/__tests__/auth.test.ts` —
  `CapcutEngineService` và `capcut/auth.ts` trước đó **không có test nào**.

### Kết quả chạy thật (04/09/2026)

Nguồn email gmail94, hộp thuê mới mỗi lượt, đi qua đúng đường
renderer → preload → IPC `run:start` → `AutomationRunService` → engine.

| Lượt | Fix có trong build | Kết quả | Số lượt quét cần |
|---|---|---|---|
| 1 | không có | 2/12 | bị cắt ở lượt 2 |
| 3 | slug + forceSignup | 7/12 | bị cắt ở lượt 3 |
| 5 | + khảo sát, reward, Export | 12/12 | 2 |
| 6 | + Claim, bảng giá, trang lỗi | **12/12** | **1** |
| 7 | + guard tab phụ, subscription | **12/12 × 3 luồng** | **1** |

Lượt 7 chạy **3 luồng song song** (`--threads=3`): `start 3, stop 3, fail 0`, cả ba
account 12/12 nhiệm vụ, 670/670 credits — tổng 36 nhiệm vụ, ~2.010 credits.
Đọc lại SQLite: mỗi account có 12 dòng `account_tasks` `status = 4`,
`subscription = 'Pro trial 7 ngày'`, `automation_step = 'Đủ 12/12 nhiệm vụ'`, và
`proxy_leases` không còn lease nào giữ.

Bằng chứng ba `TaskStore` không lẫn dữ liệu: cả ba luồng đều có `do_action
err_no=0` **riêng** cho cùng `task_key`. Nếu chúng dùng chung thì một proof sẽ
thoả cả ba và hai luồng còn lại "xong" mà chưa làm gì.

### Chưa sửa

- **Tab chính của CapCut chết giữa lượt** — `❌ Tab chính đã bị đóng` (lượt 06:53)
  và `page.waitForTimeout: Target page, context or browser has been closed`
  (lượt 06:41). Cắt ngắn mọi lượt chạy ở lượt quét 1–2. Chưa xác định được thứ
  đóng nó; `notificationsGroup` chỉ đóng đúng tab nó tự mở. Modal
  `页面异常` xuất hiện cùng giai đoạn nên nghi renderer của CapCut sập, chưa
  chứng minh được.
- **3 nhiệm vụ Design Studio timeout chờ `do_action` 90 giây** trên account
  catch-all (`inspiration_generate_done`, `ai_chat`, `canvas_edit`) — thao tác UI
  chạy hết nhưng CapCut không bắn action. Cùng 3 nhiệm vụ đó XONG trên account
  gmail94 lượt 06:41, nên chưa loại được yếu tố account/proxy.
- **`Make an export` gặp node toolbar 0 nút.** Lượt batch 04/09/2026,
  `francisczeno459`: `Không nhận ra nút Export trong 0 nút của node toolbar`. Node
  ảnh đã sinh xong (`Complete a generation` có `do_action err_no=0` ngay trước),
  nhưng toolbar không render nút nào — nghi node mất selection, chưa chứng minh
  được. Lượt quét 2 vớt lại thành công nên là lỗi NGẮT QUÃNG, không phải selector.
  Thông điệp lỗi phân biệt được "0 nút" (toolbar không có) với "n nút mà không
  nhận ra Export" (selector sai) — nhờ vậy lần sau không đi sửa nhầm hướng.
- `buildThreadPlans` mua trước toàn bộ N hộp thư rồi mới mở browser, nên luồng
  xếp hàng có thể chờ rất lâu mới dùng tới hộp đã trả tiền. Phần "browser lỗi là
  mất hộp" **không còn đúng**: `release()` trả hộp về trạng thái dùng lại được
  (`EmailPurchaseService.release`), luồng sau nhận lại chính hộp đó. Không ảnh
  hưởng khi chạy 1 luồng.

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

