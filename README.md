# CapCut Automation v3.0.2 — CapCut Free Credits Automation Desktop Client

> Hệ thống tự động hóa Desktop chuyên nghiệp trên Windows: Tự động hóa đăng ký, đăng nhập tài khoản CapCut Web và cày trọn bộ 12 nhiệm vụ Free Credits (lên tới 2.060 credits/tài khoản) thông qua kiến trúc kép **CycleTLS Native Direct HTTP Execution** kết hợp Playwright Browser Session, kiểm tra ưu đãi dùng thử 7 ngày VIP, quản lý lease proxy xoay vòng KiotProxy và cấp phát email Just-In-Time (JIT) qua Gmail94/DongVanFB với **cơ chế đa luồng song song hoàn toàn cách ly** và **tự động polling chờ nạp lại kho mail khi hết hàng (chỉ dừng khi hết tiền)**.

[![Electron](https://img.shields.io/badge/Electron-35.0.0-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.1.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2_Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.4.3-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![CycleTLS](https://img.shields.io/badge/CycleTLS-Go_Native_Bridge-00ADD8?logo=go&logoColor=white)](https://github.com/Danny-Dasilva/CycleTLS)
[![Playwright](https://img.shields.io/badge/Playwright-Core_1.62.1-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)

## Tải bản phát hành live

Release v3.0.2 (Polling chờ nạp lại kho email & Đa luồng song song) đã sẵn sàng trên Windows:

- [Tải CapCut Automation-3.0.2-x64.exe](https://github.com/tmq9999/Tool-Capcut-Auto-Task/releases/download/v3.0.2-live/CapCut%20Automation-3.0.2-x64.exe)
- [Xem release notes và changelog chi tiết](CHANGELOG.md)

---

## Mục lục

- [1. Giới thiệu tổng quan](#1-giới-thiệu-tổng-quan)
- [2. Đặc tả kiến trúc kỹ thuật lõi](#2-đặc-tả-kiến-trúc-kỹ-thuật-lõi)
  - [2.1. Phân tầng kiến trúc (Architecture Layers)](#21-phân-tầng-kiến-trúc-architecture-layers)
  - [2.2. Động cơ HTTP Direct Tasks & CycleTLS Native Transport](#22-động-cơ-http-direct-tasks--cycletls-native-transport)
  - [2.3. Cơ sở dữ liệu SQLite & Hệ thống Migrations](#23-cơ-sở-dữ-liệu-sqlite--hệ-thống-migrations)
  - [2.4. Cơ chế Continuous Worker & Cấp phát Email Just-In-Time (JIT)](#24-cơ-chế-continuous-worker--cấp-phát-email-just-in-time-jit)
  - [2.5. Danh sách 12 nhiệm vụ Free Credits & Cổng chứng minh `do_action`](#25-danh-sách-12-nhiệm-vụ-free-credits--cổng-chứng-minh-do_action)
- [3. Đặc tả chức năng chi tiết các Tab & Settings trên UI](#3-đặc-tả-chức-năng-chi-tiết-các-tab--settings-trên-ui)
  - [3.1. Tab Dashboard (Bảng điều khiển & Vận hành)](#31-tab-dashboard-bảng-điều-khiển--vận-hành)
  - [3.2. Tab Accounts (Quản lý tài khoản & Dữ liệu)](#32-tab-accounts-quản-lý-tài-khoản--dữ-liệu)
  - [3.3. Tab Logs (Nhật ký vận hành chi tiết)](#33-tab-logs-nhật-ký-vận-hành-chi-tiết)
  - [3.4. Tab Settings (Cài đặt hệ thống & API Providers)](#34-tab-settings-cài-đặt-hệ-thống--api-providers)
- [4. Hướng dẫn cài đặt & Vận hành Tool](#4-hướng-dẫn-cài-đặt--vận-hành-tool)
  - [4.1. Yêu cầu môi trường & Thiết lập ban đầu](#41-yêu-cầu-môi-trường--thiết-lập-ban-đầu)
  - [4.2. Cài đặt Dependencies & Rebuild Native Module](#42-cài-đặt-dependencies--rebuild-native-module)
  - [4.3. Khởi chạy chế độ phát triển (Development)](#43-khởi-chạy-chế-độ-phát-triển-development)
  - [4.4. Đóng gói ứng dụng phát hành (Production Build)](#44-đóng-gói-ứng-dụng-phát-hành-production-build)
  - [4.5. Bộ lệnh kiểm thử & Xác thực chất lượng](#45-bộ-lệnh-kiểm-thử--xác-thực-chất-lượng)
- [5. Khắc phục sự cố thường gặp (Troubleshooting & FAQ)](#5-khắc-phục-sự-cố-thường-gặp-troubleshooting--faq)
- [6. Hợp đồng kỹ thuật & Bảo mật](#6-hợp-đồng-kỹ-thuật--bảo-mật)

---

## 1. Giới thiệu tổng quan

**CapCut Automation v3.0.2** là phiên bản tối ưu hóa cao cấp phát triển chuyên biệt cho môi trường Windows, phục vụ nhu cầu tự động hóa quy trình nuôi, tạo và làm nhiệm vụ nhận Free Credits cho tài khoản CapCut Web số lượng lớn với tốc độ cao, khả năng chạy đa luồng song song độc lập và đồng bộ giao diện thời gian thực.

### Điểm đột phá của phiên bản 3.0.2:
- **Tự động Polling chờ nạp lại kho Email (Smart Stock Polling):** Khi nhà cung cấp Gmail94 hoặc DongVanFB tạm thời hết mail (HTTP 400 / OUT_OF_STOCK), hệ thống tự động giữ luồng và polling chờ nạp lại kho theo chu kỳ tùy chọn (10s, 15s, 30s, 60s) thay vì dừng phiên chạy. Hệ thống chỉ dừng phiên (`blocked`) khi thực sự hết số dư (`INSUFFICIENT_FUNDS`) hoặc sai API key.
- **Đa luồng song song cách ly 100% (Isolated Multi-Threading):** Mỗi luồng chạy độc lập hoàn toàn với 1 Proxy riêng (KiotProxy hoặc Direct IP), 1 Profile Multilogin riêng, 1 Email riêng (JIT qua Gmail94/DongVanFB hoặc danh sách thủ công), 1 Mật khẩu riêng, bộ nhớ bằng chứng độc lập.
- **Vòng đời nạp mới liên tục (Continuous Worker Renew Cycle):** Luồng nào hoàn thành nhiệm vụ trước sẽ tự động thu hồi tài nguyên và nạp ngay tài khoản mới mà không cần chờ các luồng còn lại, chạy liên tục tới khi đạt giới hạn email đã đặt.
- **Đồng bộ Dashboard thời gian thực (Real-time UI Sync):** Khắc phục triệt để lỗi đóng băng hiển thị luồng cuối cùng; toàn bộ thông tin IP Proxy, Profile ID và bước làm nhiệm vụ được cập nhật tức thì.
- **Động cơ HTTP Direct Tasks & CycleTLS Native Transport:** Gọi trực tiếp các API endpoints của CapCut qua cầu nối CycleTLS (Go native) chạy loopback, hoàn tất 12 nhiệm vụ chỉ trong vài giây.
- **Tự động Claim Credits & Kiểm tra điều kiện Trial 7 ngày:** Tự động gửi lệnh nhận thưởng (`claim`) ngay sau khi hoàn thành nhiệm vụ và kiểm tra điều kiện dùng thử VIP 7 ngày (trial reader) trên trang nếu tài khoản đủ điều kiện.
- **Hỗ trợ đầy đủ Direct Proxy & Trích xuất lỗi chi tiết:** Hỗ trợ đầy đủ scheme `http://` và `socks5://` (có/không có user:pass), phân tích chi tiết thông điệp lỗi từ nhà cung cấp email.

---



## 2. Đặc tả kiến trúc kỹ thuật lõi

### 2.1. Phân tầng kiến trúc (Architecture Layers)

Hệ thống tuân thủ nghiêm ngặt mô hình luồng phụ thuộc hướng tâm (Inward Dependency Rule):

```text
┌────────────────────────────────────────────────────────┐
│                   React 19 Renderer                    │
│      (DashboardPage, AccountsPage, LogsPage, ...)      │
└───────────────────────────┬────────────────────────────┘
                            │ window.electronAPI (Typed Bridge)
┌───────────────────────────▼────────────────────────────┐
│                  Electron Preload API                  │
│       (contextIsolation: true, nodeIntegration: false) │
└───────────────────────────┬────────────────────────────┘
                            │ Typed IPC (ipcRenderer.invoke)
┌───────────────────────────▼────────────────────────────┐
│                    IPC Handlers Layer                  │
│             (Zod Schema Validation & Envelopes)        │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                  Application Services                  │
│  (AutomationRunService, EmailPurchase, CapcutEngine)   │
└──────┬────────────────────┬────────────────────┬───────┘
       │                    │                    │
┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼─────────────┐
│ Repositories│      │ CycleTLS    │      │ External Providers │
│ & SQLite    │      │ Go Bridge   │      │ (Multilogin,       │
│ (better-    │      │ (Loopback   │      │  KiotProxy,        │
│  sqlite3)   │      │  127.0.0.1) │      │  Gmail94, DongVan) │
└─────────────┘      └─────────────┘      └────────────────────┘
```

#### Nguyên tắc ranh giới an toàn:
1. **Renderer Isolation:** Renderer tuyệt đối không import Node.js APIs, Electron internals, `better-sqlite3` hay các SDK mang thông tin bảo mật.
2. **ContextBridge thu hẹp:** Preload chỉ mở các kênh invoke và push có kiểu chặt chẽ; không bao giờ phơi bày `ipcRenderer` thô ra biến toàn cục `window`.
3. **Mã hóa dữ liệu nhạy cảm:** Mọi thông tin nhạy cảm (API key, mật khẩu CapCut, access token, cookies) được mã hóa tại tầng `CredentialVault` bằng `Electron safeStorage` trước khi lưu trữ vào SQLite.

---

### 2.2. Động cơ HTTP Direct Tasks & CycleTLS Native Transport

Phiên bản 3.0.0 loại bỏ hoàn toàn các bước click giao diện phức tạp, chậm chạp và dễ gãy của Playwright trên Canvas/Studio, thay thế bằng **giao tiếp HTTP trực tiếp**:

- **CycleTLS Go Bridge:** Chạy tiến trình nền Go native độc quyền qua loopback `127.0.0.1`. Nhận yêu cầu từ Node process và thực hiện request ra ngoài với chữ ký TLS Fingerprint (JA3, HTTP/2, Akamai fingerprint) giả lập trình duyệt Chrome thật 100%, vượt qua hoàn toàn Cloudflare & ByteDance WAF.
- **Thực thi 12 nhiệm vụ qua API (`taskApi.ts`, `taskMutation.ts`):** Kích hoạt trực tiếp payload `do_action` cho từng loại nhiệm vụ (Newbie register, PWA, Notifications, Design Studio, Video Studio).
- **Tự động Claim Credits tức thì:** Ngay sau khi hoàn thành nhiệm vụ, hệ thống gửi lệnh claim và lưu biên lai (`proof`) vào CSDL.
- **Kiểm tra Trial VIP 7 ngày (`trial.ts`):** Đọc điều kiện ưu đãi dùng thử 7 ngày Pro/VIP qua DOM reader trên trang (không kích hoạt thanh toán).
- **Chế độ Headed / Headless:**
  - *Headed:* Sử dụng khi cần quan sát trực quan màn hình đăng nhập hoặc kiểm tra giao diện.
  - *Headless:* Chạy hoàn toàn ngầm, tiết kiệm 90% CPU/RAM, thích hợp vận hành số lượng luồng lớn.

---

### 2.3. Cơ sở dữ liệu SQLite & Hệ thống Migrations

Cơ sở dữ liệu SQLite được đặt tại đường dẫn cục bộ theo chuẩn hệ điều hành: `app.getPath("userData")/automanager.db`.

Khởi tạo kết nối luôn bắt buộc cấu hình PRAGMA tối ưu:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

#### 8 Migration phiên bản cơ sở dữ liệu:
- **`001_initial_schema`:** Khởi tạo bảng `schema_migrations`, `app_settings`, `service_credentials`, `accounts` và `runtime_logs`.
- **`002_provider_runtime`:** Thêm bảng `purchased_emails` và `proxy_leases`.
- **`003_proxy_lease_ip_reuse`:** Bổ sung chỉ mục và cột `released_at` trên `proxy_leases` để tối ưu tái sử dụng IP sạch.
- **`004_account_task_progress`:** Bổ sung bảng `account_tasks` lưu chi tiết trạng thái 12 nhiệm vụ CapCut của từng tài khoản.
- **`005_purchased_email_reservations`:** Khóa nguyên tử (Atomic JIT Reservation) trên `purchased_emails` chống tranh chấp giữa các luồng.
- **`006_account_task_receipts`:** Lưu biên lai và chữ ký xác thực nhiệm vụ đã claim thành công.
- **`007_account_unsettled_proofs`:** Bảng tạm đối soát bằng chứng mạng chưa quyết toán trước khi commit vào tài khoản.
- **`008_account_mutation_intents`:** Quản lý ý định thay đổi trạng thái tài khoản (mutation intent log) đảm bảo tính nhất quán dữ liệu khi xảy ra crash/ngắt quãng.

---

### 2.4. Cơ chế Continuous Worker & Cấp phát Email Just-In-Time (JIT)

Hệ thống hoạt động theo mô hình điều phối hàng đợi luồng công nhân độc lập:

```text
[Bắt đầu phiên chạy]
        │
        ▼
[Preflight kiểm tra số dư & giá dịch vụ CapCut] ──(Không đủ tiền)──► [Trạng thái: blocked (INSUFFICIENT_FUNDS)]
        │
        ▼ (Đủ điều kiện ban đầu)
[Khởi tạo Worker Pool theo threadCount]
        │
        ├──────────────────────────┐
        ▼                          ▼
 [Worker Slot 1]            [Worker Slot 2]  ...
        │                          │
        ▼                          ▼
1. Xin lease Proxy thành công (KiotProxy / Direct)
        │
        ▼
2. Cấp phát Email Just-In-Time:
   - Ưu tiên đặt chỗ nguyên tử hộp thư sẵn có (Migration 005)
   - Nếu kho trống: Đặt mua 1 hộp thư mới qua API Gmail94/DongVanFB
        │
        ▼
3. Khởi tạo phiên trình duyệt (Headed / Headless theo cấu hình)
        │
        ▼
4. Chạy Đăng ký & Kích hoạt CycleTLS Session
        │
        ▼
5. Thực thi HTTP Direct Tasks: 12 Nhiệm vụ + Tự động Claim Credits + Check Trial 7 ngày
        │
        ▼
6. Đóng session, nhả lease Proxy, lưu tài khoản vào SQLite
        │
        ▼
[Slot được giải phóng] ──► Tự động kéo tài khoản/email tiếp theo để chạy liên tục!
```

---

### 2.5. Danh sách 12 nhiệm vụ Free Credits & Cổng chứng minh `do_action`

Mã nguồn tại `src/main/services/capcut/` độc lập hoàn toàn với việc đọc SQLite hay mua proxy. Engine nhận vào ngữ cảnh trình duyệt `{ page, context, sampleImage, log, signal, pace }` và trả về kết quả định lượng.

#### Danh sách 12 nhiệm vụ Free Credits chuẩn CapCut Web:

| # | Task Key | Tên nhiệm vụ | Phần thưởng | Nhóm thực thi | Ghi chú quan hệ |
|---|---|---|:---:|---|---|
| 1 | `capcut_web_newbie_register` | Sign up for CapCut Web | **+520** | Auth | Đăng ký thành công tài khoản mới |
| 2 | `capcut_web_pwa_install` | Install CapCut Web Desktop | **+210** | Simple | Cài đặt ứng dụng web PWA |
| 3 | `capcut_web_push_authorize` | Enable browser notifications | **+210** | Simple | Bật thông báo đẩy trên trình duyệt |
| 4 | `capcut_web_design_studio_picture_creation` | Create images in Design Studio | **+80** | Design Studio | **Nhiệm vụ cha** (tự hoàn tất khi 3 con xong) |
| 5 | `capcut_web_design_studio_ai_chat` | Chat with AI agent | **+110** | Design Studio | Chat với AI trong Design Studio |
| 6 | `capcut_web_design_studio_upload_img` | Upload an image | **+110** | Design Studio | Tải ảnh mẫu lên Canvas |
| 7 | `capcut_web_design_studio_canvas_edit` | Edit on canvas | **+160** | Design Studio | Chỉnh sửa và gửi prompt trên Canvas |
| 8 | `capcut_web_inspiration_generate_done` | Try an Inspiration template | **+130** | Design Studio | Thử một mẫu cảm hứng AI |
| 9 | `capcut_web_video_studio_creation` | Create in Video Studio | **+80** | Video Studio | **Nhiệm vụ cha** (tự hoàn tất khi 3 con xong) |
| 10 | `capcut_web_video_studio_send_msg` | Chat with AI agent | **+130** | Video Studio | Gửi thông điệp cho AI trong Video Studio |
| 11 | `capcut_web_video_studio_generate_done` | Complete a generation | **+130** | Video Studio | Hoàn thành 1 lần sinh video/ảnh |
| 12 | `capcut_web_video_studio_export` | Make an export | **+190** | Video Studio | Xuất bản phẩm |
| **Tổng** | **12 Nhiệm vụ** | | **2.060 Credits** | | *(Biến thể 10 nhiệm vụ không có PWA/Push đạt 1.380 credits)* |

#### Cơ chế chứng minh qua Cổng `do_action`:
1. Hàm `act()` của nhóm nhiệm vụ chỉ thực hiện thao tác UI thuần túy.
2. Hàm điều phối `runGroup` chỉ xác nhận nhiệm vụ thành công khi bắt được gói tin mạng tương ứng `do_action` có `err_no === 0` và gọi lại API `task_status` của CapCut để đối chiếu.
3. **Bộ nhớ bằng chứng (Proof Memory):** Các nhiệm vụ đã đạt bằng chứng trong phiên sẽ được ghi nhớ; nếu trang bị tải lại hoặc phục hồi tab, engine sẽ không thực hiện lại những nhiệm vụ này.
4. **Phục hồi 1-Tab (Primary Page Resolver):** Nếu tab chính CapCut bị đóng hoặc gặp sự cố, hệ thống cho phép tạo lại tối đa 1 tab thay thế trong ngân sách phục hồi, giữ nguyên bộ nhớ bằng chứng trước đó.

---

### 2.5. Bảng bất biến kỹ thuật đã đo lường (Invariance Table)

Những quy tắc này được đúc kết từ hàng trăm lượt chạy thực tế trên môi trường CapCut Web và là các giới hạn kỹ thuật bắt buộc:

| Bất biến kỹ thuật | Bằng chứng thực tế | Rủi ro nếu vi phạm |
|---|---|---|
| `page.mouse.click` không kiểm tra phần tử che phủ bên trên | Nút Send canvas nằm tại tọa độ `(611, 718)` nhưng `elementFromPoint` trả về panel chat `skillPanel-4DcNp3` che phía trên | Thao tác click báo thành công nhưng không kích hoạt được hành động; treo chờ 90–240s |
| Khung chat "Design with AI" che khuất canvas prompt | Màn hình độ phân giải ~929px, khung chat rộng 440px che đè nút thiết kế | 100% lượt làm `canvas_edit` thất bại nếu không chủ động ẩn khung chat |
| Toolbar của Node ảnh: `3/5` nút = ảnh đã vẽ xong; `2/4` nút = đang vẽ | Đối chiếu qua 14 lượt chạy thực tế độc lập | Bấm nút Export khi node mới có 2 nút sẽ không sinh sự kiện `do_action` |
| Shark Risk Control đo lường quỹ đạo chuột & nhịp phím | `grant_reward` trả về `err_no 8001003` khi click dịch chuyển tức thời | Bị hệ thống rủi ro của CapCut từ chối trao thưởng credit |
| Nút `disabled` của CapCut sử dụng đa dạng class CSS | Chứa class `disabled-*` hoặc thuộc tính `aria-disabled="true"` | Dùng selector mặc định sẽ click vào nút đang bị khóa |
| Phần tử trong container `inert` nhận click từ phần tử cha | DOM `expandedWrapper` khi chưa sẵn sàng | Nhập prompt vào editor nhưng chữ không ăn vào DOM |
| Cổng CDP Multilogin chỉ mở khi khởi chạy kèm cờ `automation` | Khởi chạy profile thường qua API thì sau 60s cổng `port` vẫn là `null` | Playwright không thể attach vào trình duyệt |
| Popover nhiệm vụ ghim cứng tại tham số URL `enter_from=signup` | Không thể đóng popover bằng phím Escape hay click ra ngoài | Che khuất toàn bộ giao diện Canvas; bắt buộc reload về URL sạch |

---

## 3. Đặc tả chức năng chi tiết các Tab & Settings trên UI

Giao diện ứng dụng gồm 4 Tab nghiệp vụ chính, được bố trí đồng bộ theo hệ thống thiết kế Dark Mode cao cấp:

```text
[Sidebar Điều Hướng]
├── 1. Dashboard  (Bảng điều khiển trung tâm & Cấu hình kịch bản tự động)
├── 2. Accounts   (Quản lý danh sách tài khoản, tiến độ 12 NV & Xuất dữ liệu)
├── 3. Logs       (Nhật ký vận hành chi tiết, lọc SQL & Stage Timing)
└── 4. Settings   (Cài đặt thông số hệ thống, thời gian lưu log & API Keys)
```

---

### 3.1. Tab Dashboard (Bảng điều khiển & Vận hành)

Là màn hình trung tâm để thiết lập thông số, khởi chạy và theo dõi tiến trình chạy tự động theo thời gian thực.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ DASHBOARD - Quản lý và theo dõi tiến trình automation     [Dừng] [Bắt đầu]  │
├─────────────────────────────────────────────────────────────────────────────┤
│ ▼ CẤU HÌNH KỊCH BẢN TỰ ĐỘNG (Thu gọn / Mở rộng)                             │
│ ┌──────────────┬──────────────┬──────────────┬──────────────┬─────────────┐ │
│ │Cấu hình chung│Delay & Timing│Proxy Settings│    Module    │ Nguồn Email │...
│ └──────────────┴──────────────┴──────────────┴──────────────┴─────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│ 👤 10 Tài khoản  🌐 10 Proxies  🖥️ Browser: Multilogin | 2/10 luồng | Chạy  │
├─────────────────────────────────────────────────────────────────────────────┤
│ DANH SÁCH TÀI KHOẢN ĐANG XỬ LÝ (DataGrid)                                   │
│ Email               │ Proxy       │ Bước hiện tại │ Credits │ Thao tác     │
│ user1@gmail94.com   │ 103.x.x.x   │ video_studio  │ 1200    │ [Dừng luồng] │
├─────────────────────────────────────────────────────────────────────────────┤
│ ▲ NHẬT KÝ TRỰC TIẾP (Docked Live Logs)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### A. Cấu hình kịch bản tự động (Automation Config Grid - 6 Panels):
1. **Panel Cấu hình chung:**
   - **Luồng (`threadCount`):** Cho phép nhập từ `1` đến `200` (mặc định: `10`). Xác định số lượng worker chạy đồng thời.
   - **Browser:** Chọn trình duyệt tự động. Mặc định và chính thức hỗ trợ: **`Multilogin`**. Các tùy chọn khác (*GoLogin, GPM Login, Camoufox, Patchright*) hiển thị nhãn `(chưa hỗ trợ)` và bị khóa nhằm ngăn ngừa phát sinh lỗi mất tiền mua email.
   - **Mode:** Chuyển đổi giữa chế độ hiển thị cửa sổ (**`Headed`**) hoặc chạy ẩn (**`Headless`**).
   - **Thử lại (lần):** Số lần thử lại tối đa cho mỗi tài khoản khi gặp lỗi gián đoạn (từ `0` đến `10`, mặc định: `3`).
2. **Panel Delay & Timing:**
   - **Delay thao tác (ms):** Khoảng nghỉ giữa các hành động lớn của kịch bản, gồm 2 ô nhập Min và Max (mặc định: `500 - 2000 ms`).
   - **Delay gõ phím (ms):** Nhịp gõ từng ký tự của chuột và bàn phím (mặc định: `50 - 150 ms`). Hệ thống tự động áp sàn an toàn để bảo đảm vượt qua Shark Risk Control.
3. **Panel Proxy Settings:**
   - **Mode:** Lựa chọn `Direct IP` (dán danh sách IP:PORT hoặc IP:PORT:USER:PASS) hoặc `Proxy Key` (sử dụng API KiotProxy xoay IP).
   - **Vùng (Region):** Chỉ định khi chọn Proxy Key: *Ngẫu nhiên (`random`)*, *Miền Bắc (`bac`)*, *Miền Trung (`trung`)*, *Miền Nam (`nam`)*.
   - **Danh sách Proxy Key:** Khung nhập mỗi dòng một key. Để trống = sử dụng toàn bộ key có trong tài khoản KiotProxy.
4. **Panel Module:**
   - **Module nghiệp vụ:** Chọn **`Làm NV Credit`** (chính thức hỗ trợ chạy 12 nhiệm vụ kiếm 2.060 credits). Hai tùy chọn `Pay Trial 7D` và `Pay Team` hiển thị nhãn `(chưa hỗ trợ)` và bị khóa.
   - **Bỏ qua account không có trial Pro ≥ 7 ngày:** Hộp kiểm mặc định TẮT (fail-open) để tránh việc vô tình loại bỏ tài khoản đã tốn tiền mua hộp thư khi selector giao diện thay đổi.
5. **Panel Nguồn Email:**
   - **Chế độ:** *Manual* (dán danh sách email|pass), *API* (mua tự động qua Gmail94 hoặc DongVanFB), *Custom (Đã khóa)*.
   - Khi chọn API: Cho phép chọn nhà cung cấp *Gmail94* hoặc *DongVanFB*. Hệ thống hiển thị trạng thái API Key đã lưu (che mờ dạng `••••••••`) hoặc cảnh báo màu cam nếu chưa cấu hình trong Settings.
6. **Panel Mật khẩu CapCut:**
   - **Chế độ:** *Tự đặt (`custom`)* (dùng chung 1 mật khẩu cho toàn bộ tài khoản tạo mới) hoặc *Ngẫu nhiên (`random`)*.
   - **Độ dài mật khẩu:** Từ `6` đến `64` ký tự (mặc định: `12`).
   - **Quy tắc ký tự:** Các hộp kiểm bật/tắt: Chữ in hoa (`A-Z`), Chữ số (`0-9`), Ký tự đặc biệt (`!@#`).

#### B. Thanh trạng thái & Hành động (Dashboard Action Bar):
- **Chỉ số tổng hợp:** Hiển thị tổng số tài khoản đã nạp, số proxy khả dụng, tên trình duyệt đang kích hoạt.
- **Bộ đếm tiến độ luồng:** Hiển thị rõ ràng `workersActive / workerTarget`, số tài khoản đã nhận (`accountsAccepted`), hoàn tất (`accountsCompleted`), lỗi (`accountsFailed`), dừng giữa chừng (`accountsStopped`).
- **Trạng thái phiên chạy (Run State):** Phân biệt chính xác 8 trạng thái:
  - `idle`: Chưa chạy.
  - `preparing`: Đang tiền kiểm số dư, proxy và chuẩn bị tài nguyên.
  - `running`: Các luồng đang chạy và tự động nạp tiếp việc.
  - `stopping`: Đang hủy lệnh và đóng an toàn các trình duyệt.
  - `completed`: Hoàn thành toàn bộ danh sách nhập tay.
  - `stopped`: Người dùng chủ động dừng phiên.
  - `blocked`: Phiên bị chặn do điều kiện ngoại cảnh (ví dụ: `INSUFFICIENT_FUNDS` — kèm chi tiết số dư, giá dịch vụ, số lượng có thể mua).
  - `failed`: Lỗi nghiêm trọng ngoài dự kiến.
- **Các nút chức năng:**
  - `Lưu cấu hình`: Lưu các thiết lập trên Dashboard vào cơ sở dữ liệu.
  - `Bắt đầu` / `Dừng phiên`: Bật tắt toàn bộ tiến trình automation.

#### C. Bảng tài khoản đang chạy (DataGrid) & Live Logs:
- Bảng hiển thị danh sách tài khoản đang trong luồng xử lý: Email, Proxy gắn kèm, Trình duyệt Profile ID, Bước hiện tại (`signup`, `pwa_install`, `video_studio`, v.v.), Số credits đã gặt hái.
- **Dừng luồng đơn lẻ:** Mỗi hàng có nút dừng riêng, cho phép ngắt một tài khoản gặp sự cố mà không làm gián đoạn toàn bộ phiên chạy.
- **Docked Live Logs:** Khung nhật ký cắm đáy có thể thu gọn hoặc mở rộng, tự động cập nhật từng dòng log sinh ra từ các worker.

---

### 3.2. Tab Accounts (Quản lý tài khoản & Dữ liệu)

Cung cấp các công cụ chuyên sâu để tìm kiếm, xem tiến độ chi tiết, chỉnh sửa và xuất dữ liệu tài khoản CapCut đã tạo.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ ACCOUNTS - Quản lý danh sách tài khoản CapCut                [Xuất dữ liệu] │
├─────────────────────────────────────────────────────────────────────────────┤
│ 👥 Tổng: 1.250 | 🟢 Hoạt động: 850 | ⏳ Chờ: 120 | ✅ Xong: 250 | ❌ Lỗi: 30│
├─────────────────────────────────────────────────────────────────────────────┤
│ [Tìm email, note...] [Trạng thái: Tất cả ▼] [Ngày tạo ▼] [Provider ▼]       │
├─────────────────────────────────────────────────────────────────────────────┤
│ [ ] Email            │ Password CapCut │ Credit │ Trạng thái │ Hành động    │
│ [x] capcut01@mail.com│ P@ss•••• (Copy) │ 2060   │ Hoàn tất   │ [👁️ NV][✏️][🗑️]│
├─────────────────────────────────────────────────────────────────────────────┤
│ Trang 1 / 25  (50 dòng / trang)                     [Trang trước] [Trang sau]│
└─────────────────────────────────────────────────────────────────────────────┘
```

#### A. Thanh công cụ & Bộ lọc đẩy xuống SQL (Accounts Toolbar):
- **Tìm kiếm toàn văn:** Tìm nhanh theo Email, ID, Proxy hoặc Ghi chú.
- **Bộ lọc trạng thái:** Lọc theo trạng thái tài khoản: *Tất cả*, *Hoạt động (`active`)*, *Đang xử lý (`processing`)*, *Đang chờ (`waiting`)*, *Hoàn tất (`done`)*, *Lỗi (`error`)*, *Đã tắt (`disabled`)*.
- **Bộ lọc ngày tạo:** *Tất cả*, *Hôm nay*, *7 ngày qua*, *30 ngày qua*.
- **Bộ lọc Provider:** Khớp chính xác với nguồn tạo tài khoản: *Gmail94*, *DongVanFB*, *Domain riêng (`customdomain`)*, *Nhập tay (`manual`)*.
- **Bộ lọc Trình duyệt:** Lọc theo loại runtime sử dụng.

> [!NOTE]
> Toàn bộ thao tác lọc và tìm kiếm được đẩy trực tiếp xuống câu lệnh SQL của SQLite thông qua IPC, đảm bảo tìm kiếm chính xác trên hàng chục nghìn dòng dữ liệu thay vì chỉ lọc trên bộ đệm cục bộ.

#### B. Các tính năng quản lý tài khoản:
- **Thêm tài khoản (Add Account Drawer):** Form mở trượt từ cạnh phải, cho phép nhập Email, Password, Proxy, Ghi chú và gắn thẻ thủ công.
- **Chỉnh sửa tài khoản (Edit Account Drawer):** Chỉnh sửa thông tin tài khoản, cập nhật trạng thái hoặc mật khẩu mới.
- **Xóa tài khoản (Delete Account Dialog):** Hộp thoại xác nhận xóa một hoặc nhiều tài khoản đã chọn kèm dọn dẹp liên kết.
- **Xem tiến độ 12 nhiệm vụ (Task Progress Dialog):**
  - Nhấp vào biểu tượng con mắt tại cột Hành động để mở hộp thoại.
  - Hiển thị tiến độ thực tế nhận về từ CapCut: Tỷ lệ hoàn thành (ví dụ: `12/12`), tổng số credit đã nhận (ví dụ: `2.060`).
  - Danh sách chi tiết từng nhiệm vụ kèm huy hiệu: **`Hoàn tất`** (Xanh lá), **`Chờ nhận`** (Vàng cam), **`Chưa đạt`** (Xám).

#### C. Hộp thoại Xuất dữ liệu chuyên nghiệp (Export Dialog):
- **Phạm vi xuất (Scope):**
  - *Đã chọn (`checked`):* Chỉ xuất những dòng được tích chọn ở bảng.
  - *Đang lọc (`filtered`):* Xuất toàn bộ tài khoản khớp với bộ lọc tìm kiếm hiện tại (truy vấn toàn bộ DB, không giới hạn trong 1 trang).
  - *Tất cả (`all`):* Xuất toàn bộ cơ sở dữ liệu tài khoản.
- **Định dạng xuất (Format):**
  - **XLSX:** File Excel chuẩn, tự động căn chỉnh độ rộng cột và định dạng tiêu đề.
  - **CSV:** File văn bản phân tách bằng dấu phẩy, mã hóa UTF-8.
  - **TXT:** File text định dạng phân cách bằng ký tự đứng `|`.
- **Cột xuất dữ liệu:** Lựa chọn linh hoạt các trường: `email`, `passwordCapcut` (giải mã tại main process), `emailData`, `credit`, `subscription`, `createdAt`.

---

### 3.3. Tab Logs (Nhật ký vận hành chi tiết)

Nơi giám sát và kiểm tra toàn bộ luồng hoạt động ngầm của ứng dụng, phục vụ chẩn đoán sự cố chuyên sâu.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ LOGS - Nhật ký hệ thống và chẩn đoán sự cố       [Tạm dừng] [Xóa nhật ký]   │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Tìm nội dung log...] [Cấp độ: ALL ▼] [Email: Tất cả ▼]  ☑️ Tự động cuộn    │
├─────────────────────────────────────────────────────────────────────────────┤
│ Thời gian   │ Cấp độ │ Email            │ Bước           │ Nội dung thông điệp│
│ 16:30:15    │ INFO   │ user1@gmail.com  │ video_studio   │ stage=video-gen... │
│ 16:30:18    │ ERROR  │ user2@gmail.com  │ mail_otp       │ Chờ mã OTP quá hạn │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Bộ lọc cấp độ (Level Filter):** `ALL`, `INFO`, `WARN`, `ERROR`, `DEBUG` (truy vấn lọc tại SQLite).
- **Bộ lọc theo Email:** Tự động tổng hợp danh sách các email có trong log để lọc riêng luồng của một tài khoản cụ thể.
- **Tìm kiếm nhanh:** Tìm trực tiếp trong tin nhắn hoặc tên bước thao tác.
- **Auto Scroll:** Tự động cuộn lên đầu (vị trí dòng mới nhất) khi có sự kiện log mới phát sinh.
- **Tạm dừng / Tiếp tục:** Dừng cập nhật giao diện tạm thời để người dùng dễ dàng đọc log cũ mà không bị giật trang.
- **Định dạng Stage Timing chuẩn hóa:** Ghi nhận chính xác thời gian hoàn thành từng bước:
  `stage=video-studio elapsedMs=45210 outcome=success`.

---

### 3.4. Tab Settings (Cài đặt hệ thống & API Providers)

Quản lý toàn bộ thông số kỹ thuật, API key nhà cung cấp và tùy chọn sao lưu của AutoManager.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ CÀI ĐẶT HỆ THỐNG                                    [Khôi phục] [Lưu cài đặt]│
├──────────────────────────────────────┬──────────────────────────────────────┤
│ 🎛️ CÀI ĐẶT CHUNG                     │ 🌐 BROWSER & AUTOMATION RUNTIME      │
│ - Giao diện: [Dark Mode] (Light khóa)│ - Trình duyệt: Multilogin            │
│ - Ngôn ngữ: [Tiếng Việt] (En khóa)   │ - Cổng kết nối: [35000]              │
│ - Giữ nhật ký: [30 ngày]             │ - Phương thức: [xcli ▼]              │
│ - ☑️ Tự động lưu cấu hình            │ - Token / Tài khoản: [Kiểm tra]      │
│ - ☑️ Khôi phục phiên làm việc        │                                      │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ 🌐 PROXY PROVIDER API                │ ✉️ EMAIL PROVIDER API                 │
│ - KiotProxy Api-token: [••••••••]    │ - Gmail94 API Key: [••••••••]        │
│   [Xóa] [Kiểm tra kết nối]           │   [Xóa] [Kiểm tra kết nối]           │
│   Trạng thái: Đã kết nối (10 keys)   │ - DongVanFB API Key: [••••••••]      │
│                                      │ - Domain Mail (Custom): [Đã khóa]    │
├──────────────────────────────────────┴──────────────────────────────────────┤
│ 📥 XUẤT DỮ LIỆU (EXPORT SETTINGS)                                           │
│ - Định dạng mặc định: [XLSX ▼]  - Cột xuất: ☑️ Email ☑️ Pass ☑️ Credits...  │
│ - Khung xem trước (Live Preview): email │ passwordCapcut │ credit            │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Chi tiết từng Panel cài đặt:

1. **Panel Cài đặt chung (General Settings):**
   - **Giao diện (Theme):** Mặc định `Dark Mode`. Tùy chọn `Light` tạm thời bị khóa do hệ thống bảng màu được tối ưu hóa riêng cho môi trường làm việc ban đêm.
   - **Ngôn ngữ (Language):** Mặc định `Tiếng Việt`. Tùy chọn `English` tạm khóa chờ bản dịch hoàn chỉnh.
   - **Giữ nhật ký (Log retention):** Thiết lập thời gian tự động lưu log trong cơ sở dữ liệu: `7 ngày`, `30 ngày` (mặc định), `90 ngày`, hoặc `Không tự xoá`. Hệ thống tự động kích hoạt dọn dẹp các dòng log hết hạn mỗi khi khởi động ứng dụng (AGENTS.md §18).
   - **Tự động lưu cấu hình:** Switch bật/tắt tự động lưu các thay đổi trên UI vào SQLite.
   - **Khôi phục phiên làm việc:** Switch bật/tắt ghi nhớ trang đang làm việc trước khi tắt ứng dụng.
2. **Panel Browser & Automation Runtime:**
   - **Trình duyệt tự động:** Lựa chọn `Multilogin` (chính thức hỗ trợ).
   - **Cổng Multilogin (`port`):** Cổng kết nối REST API của Multilogin (mặc định: `35000`).
   - **Launcher:** Lựa chọn phương thức khởi chạy profile:
     - `xcli` (khuyến nghị): Gọi trực tiếp qua tiện ích dòng lệnh CLI của Multilogin, cho phép can thiệp file `Preferences` trước khi Chrome bật lên nhằm triệt tiêu hộp thoại "Save password" của trình duyệt.
     - `api-v3`: Gọi qua REST API `/api/v3/profile/quick`.
   - **Chế độ chứng thực:** Chọn đăng nhập bằng `Token` hoặc `Tài khoản / Mật khẩu`.
   - **Nút Kiểm tra kết nối:** Kiểm tra tình trạng kết nối tới ứng dụng Multilogin đang chạy trên máy.
3. **Panel Proxy Provider API:**
   - **KiotProxy Api-token:** Nhập mã API token lấy từ KiotProxy (chế độ write-only, ẩn mật khẩu).
   - **Nút Kiểm tra kết nối:** Gửi yêu cầu kiểm tra token, trả về trạng thái kết nối và số lượng proxy key hiện có trong tài khoản.
   - **Nút Xóa:** Đánh dấu xóa token đã lưu khi bấm nút Lưu cài đặt.
4. **Panel Email Provider API:**
   - **Gmail94 API Key:** Nhập API key của Gmail94 (hỗ trợ đọc số dư, giá dịch vụ slug `capcut` và nhận mã OTP).
   - **DongVanFB API Key:** Nhập API key của nhà cung cấp DongVanFB.
   - **Tên miền riêng (Custom Domain Mail):** Hiển thị trạng thái `Đã khóa` theo quyết định vận hành của phiên bản 2.4.1.
5. **Panel Xuất dữ liệu (Export Settings):**
   - **Định dạng mặc định:** Chọn định dạng mặc định khi mở Export Dialog: `XLSX`, `CSV`, hoặc `TXT`.
   - **Cột xuất mặc định:** Tích chọn các cột sẽ xuất mặc định.
   - **Khung xem trước trực quan (Live Preview):** Hiển thị mẫu dữ liệu xuất ra tương ứng theo đúng định dạng phân cách đã chọn (ví dụ: `│` cho XLSX, `,` cho CSV, `|` cho TXT).
6. **Thanh nút bấm hành động:**
   - **Khôi phục mặc định (Reset):** Phục hồi cài đặt gốc an toàn cho 4 panel trong Settings; **tuyệt đối không** xóa cấu hình Dashboard (số luồng, delay, danh sách email) của người dùng.
   - **Lưu cài đặt (Save):** Lưu toàn bộ thông số vào SQLite và áp dụng tức thì vào runtime mà không cần khởi động lại ứng dụng.

---

## 4. Hướng dẫn cài đặt & Vận hành Tool

### 4.1. Yêu cầu môi trường & Thiết lập ban đầu

- **Hệ điều hành:** Windows 10 hoặc Windows 11 (64-bit).
- **Node.js:** Phiên bản `v20.x` LTS hoặc `v22.x` (khuyến nghị `v22.13.0+`).
- **Phần mềm Multilogin:**
  - Cần cài đặt và đang mở ứng dụng Multilogin trên máy.
  - Đảm bảo ứng dụng Multilogin đã đăng nhập tài khoản và lắng nghe ở cổng mặc định `35000`.

---

### 4.2. Cài đặt Dependencies & Rebuild Native Module

Mở terminal PowerShell tại thư mục dự án và thực thi các lệnh sau:

```powershell
# 1. Cài đặt các thư viện npm
npm install

# 2. Biên dịch lại Native Module better-sqlite3 cho Electron 35 ABI
npm run rebuild
```

> [!IMPORTANT]
> Bước `npm run rebuild` là bắt buộc trên môi trường Electron. `better-sqlite3` là một thư viện C++ native, nếu không biên dịch lại cho đúng mã `NODE_MODULE_VERSION 133` của Electron 35, ứng dụng sẽ báo lỗi `ERR_DLOPEN_FAILED` khi khởi chạy.

---

### 4.3. Khởi chạy chế độ phát triển (Development)

Để mở ứng dụng AutoManager ở môi trường lập trình (kết hợp Vite Hot-Reload và Electron Dev):

```powershell
npm run dev
```

Cửa sổ ứng dụng AutoManager sẽ tự động xuất hiện. Mọi thay đổi ở mã nguồn giao diện sẽ được Hot-Reload tức thì.

---

### 4.4. Đóng gói ứng dụng phát hành (Production Build)

Để đóng gói ứng dụng thành bộ cài đặt hoàn chỉnh cho Windows (`.exe`):

```powershell
# Đóng gói tạo bộ cài Windows (NSIS Installer)
npm run dist

# Hoặc đóng gói thành thư mục thực thi không cần cài đặt (Unpacked Dir)
npm run dist:dir
```

File cài đặt hoặc thư mục phần mềm hoàn thiện sẽ nằm trong thư mục `dist/`.

---

### 4.5. Bộ lệnh kiểm thử & Xác thực chất lượng

Dự án cung cấp hệ thống kiểm thử toàn diện từ đơn vị đến kiểm thử trên môi trường thật:

```powershell
# 1. Kiểm tra tĩnh kiểu dữ liệu TypeScript toàn bộ dự án
npm run typecheck

# 2. Kiểm tra quy chuẩn mã nguồn bằng ESLint (không cho phép cảnh báo)
npm run lint

# 3. Kiểm thử selector trên DOM CapCut thật (88 assertions, KHÔNG tốn tài khoản)
npm run selectors

# 4. Kiểm thử toàn diện trong môi trường Electron thật (SQLite WAL, safeStorage, Preload)
npm run test:electron

# 5. Kiểm thử kết nối API nhà cung cấp thực tế (Cần file .env)
npm run verify:providers
```

> [!TIP]
> Lệnh `npm run selectors` sử dụng các bản dump DOM thực tế được lưu tại `tools/fixtures/` để assert lại 88 bộ chọn CSS/XPath mà không cần mở trình duyệt và không tiêu tốn tài khoản hay tiền mua mail.

---

## 5. Khắc phục sự cố thường gặp (Troubleshooting & FAQ)

### Q1: Gặp lỗi `The module better-sqlite3.node was compiled against a different Node.js version`?
- **Nguyên nhân:** Native module đang ở ABI của Node.js bên ngoài thay vì ABI của Electron.
- **Khắc phục:** Chạy lệnh `npm run rebuild` (hoặc `npm run rebuild:electron`) trong PowerShell rồi chạy lại `npm run dev`.

### Q2: Ứng dụng báo lỗi không thể kết nối tới Multilogin?
- **Nguyên nhân:** Ứng dụng Multilogin chưa bật, hoặc cổng API khác cổng `35000`.
- **Khắc phục:**
  1. Mở ứng dụng Multilogin và đăng nhập tài khoản.
  2. Vào Tab **Settings** -> Panel **Browser & Automation Runtime**, kiểm tra Port (mặc định: `35000`).
  3. Bấm nút **Kiểm tra kết nối** để xác nhận hiển thị trạng thái xanh (Connected).

### Q3: Phiên chạy dừng lại ở trạng thái `blocked` kèm thông báo `INSUFFICIENT_FUNDS`?
- **Nguyên nhân:** Tính năng kiểm tra số dư trước phiên (Preflight Check) phát hiện số dư tài khoản Gmail94/DongVanFB không đủ để khởi chạy số luồng yêu cầu.
- **Khắc phục:**
  1. Nạp thêm tiền vào tài khoản nhà cung cấp email hoặc giảm số luồng (`threadCount`) ở Dashboard.
  2. Chi tiết số dư hiện tại và giá dịch vụ được hiển thị trực tiếp ngay trên thanh trạng thái Dashboard.

### Q4: Proxy KiotProxy báo lỗi xoay IP hoặc hết key?
- **Nguyên nhân:** Toàn bộ key trong danh sách đều đang có IP bị trùng hoặc đang trong thời gian chờ giãn cách (cooldown).
- **Khắc phục:** Hệ thống áp dụng cơ chế `LazyProxyLeaseSource`, luồng sẽ tự động xếp hàng chờ đến khi có key xoay được IP sạch mới tiếp tục chạy. Đảm bảo số lượng key proxy lớn hơn hoặc bằng số luồng (`threadCount`) để đạt hiệu suất cao nhất.

### Q5: Tại sao tính năng Custom Domain Mail và các browser khác bị khóa?
- **Giải đáp:**
  - Tính năng **Custom Domain Mail** đã được tạm khóa theo yêu cầu kỹ thuật phiên bản 2.4.1 để dồn tài nguyên tối ưu cho Gmail94 và DongVanFB.
  - Các trình duyệt **GoLogin, GPM, Camoufox, Patchright** hiển thị nhãn `(chưa hỗ trợ)` để ngăn chặn người dùng chọn nhầm dẫn đến mất chi phí mua email khi chưa có engine hỗ trợ.

---

## 6. Hợp đồng kỹ thuật & Bảo mật

Mọi lập trình viên tham gia phát triển dự án bắt buộc phải tuân thủ:
- **Hợp đồng kỹ thuật cốt lõi:** Chi tiết tại [AGENTS.md](AGENTS.md).
- **Đặc tả kiến trúc chi tiết:** Xem tại [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Hợp đồng Engine & Selector:** Xem tại [docs/AUTOMATION-ENGINE.md](docs/AUTOMATION-ENGINE.md).
- **Báo cáo nghiệm thu v2.4.1:** Xem tại [docs/superpowers/reports/2026-09-05-continuous-automation-performance-verification.md](docs/superpowers/reports/2026-09-05-continuous-automation-performance-verification.md).

---
*Bản quyền © 2026 AutoManager Team. Mọi quyền được bảo lưu.*
