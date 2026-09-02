# Kiến trúc — nửa UI + backend (`ToolCapCut`)

Tài liệu này mô tả **mã đang có**, không mô tả dự định. Luật bắt buộc nằm ở
[`AGENTS.md`](../AGENTS.md); ở đây là bản đồ để người mới đọc code không bị lạc.

## 1. Luật layer

```
renderer (React)                  chỉ gọi window.electronAPI, không biết SQLite là gì
   │  window.electronAPI.*
preload (contextBridge)           11 kênh invoke + 3 kênh push, KHÔNG expose ipcRenderer
   │  ipcRenderer.invoke(channel)
ipc handler (src/main/ipc)        validate payload bằng zod TRƯỚC khi vào service
   │
service (src/main/services)       nơi duy nhất chứa quy tắc nghiệp vụ
   │
repository (src/main/repositories) nơi duy nhất viết SQL
   │
SQLite (better-sqlite3, WAL)
```

Provider (`src/main/providers`) là nhánh riêng: chỉ service được gọi provider,
repository thì không. Secret không bao giờ đi ngược lên renderer — renderer nhận
cờ boolean và chuỗi đã mask.

## 2. Renderer

| Trang | Controller thuần TS | Ghi chú |
|---|---|---|
| `pages/Dashboard` | `dashboardController.ts`, `automationConfig.ts` | grid cấu hình luồng, live logs cắm đáy, nút Dừng từng dòng |
| `pages/Accounts` | `accountsController.ts` | drawer thêm/sửa, dialog xoá, dialog export |
| `pages/Logs` | `logsController.ts` | đọc `runtime_logs` qua IPC, filter bar |
| `pages/Settings` | `settingsController.ts` | 5 panel: General, Browser, EmailProvider, ProxyProvider, Export |

Mỗi controller là hàm/thuần đối tượng, **test được không cần DOM** — đó là lý do
view (`.tsx`) chỉ render và không giữ logic. `components/ui` (15 file) là design
system nội bộ; `layouts` gồm shell + `StatusBar`.

## 3. Preload — bề mặt duy nhất renderer thấy

```ts
window.electronAPI = {
  ping, settings: { get, save }, credentials: { test },
  accounts: { list, create, update, remove },
  logs:     { list, clear, onEntry },
  run:      { start, stop, stopThread, threads, progress, onProgress },
  email:    { providers, readOtp },
  services: { onStatusChanged },
};
```

## 4. Hợp đồng IPC (`src/shared/contracts/ipc-channels.ts`)

| Nhóm | Kênh invoke | Kênh push |
|---|---|---|
| app | `app:ping` | — |
| settings | `settings:get`, `settings:save` | — |
| credentials | `credentials:test` | `services:on-status-changed` |
| accounts | `accounts:list`, `accounts:create`, `accounts:update`, `accounts:delete` | — |
| logs | `logs:list`, `logs:clear` | `logs:on-entry` |
| run | `run:start`, `run:stop`, `run:stop-thread`, `run:threads`, `run:progress` | `run:on-progress` |
| email | `email:providers`, `email:read-otp` | — |

`FUTURE_IPC_CHANNELS` giữ chỗ `accounts:export`. Handler nằm ở
`src/main/ipc/{settingsIpc,accountsIpc,logsIpc,automationIpc}.ts`, gom lại trong
`registerIpc.ts`; mọi trả về đi qua `ipcResult.ts` để lỗi được normalize thành mã
chuẩn thay vì rò stack trace.

## 5. Main process

| Thư mục | Nội dung |
|---|---|
| `database/` | `connection.ts` (bật và **verify** `journal_mode = WAL`), `migrator.ts` (bảng `schema_migrations`), `transaction.ts`, `migrations/001_initial_schema` → `003_proxy_lease_ip_reuse` |
| `repositories/` | `Account`, `Credential`, `Log`, `ProxyLease`, `PurchasedEmail`, `Settings` — nơi duy nhất có SQL |
| `services/` | `AutomationRunService`, `ProxyLeaseManager`, `LazyProxyLeaseSource`, `EmailPurchaseService`, `MultiloginAuthService`, `AccountService`, `SettingsService`, `LogBus`, `ProviderRegistry`, `ServiceConnectionManager`, `SecretReader`, `browserRuntime`, `mailUsername`, `passwordGenerator` |
| `providers/` | `MultiloginProvider`, `KiotProxyProvider`, `Gmail94Provider`, `DongVanFBProvider`, `CustomDomainMailProvider`, `HttpClient`, `ProviderError`, `connectivity.ts` |
| `security/` | `CredentialVault.ts` — mã hoá bằng Electron `safeStorage` |
| `runtime/` | `providerStack.ts` — composition root gắn provider vào service |
| `lifecycle.ts` | Guard tắt máy sạch (đóng DB, dừng profile) |

## 6. Bảng SQLite

| Bảng | Giữ gì |
|---|---|
| `app_settings` | Cấu hình **không bí mật** (JSON thường): số luồng, browser, mode, delay, module, độ dài mật khẩu… |
| `service_credentials` | Secret provider, đã mã hoá qua `CredentialVault` |
| `accounts` | Account CapCut: email, mật khẩu (mã hoá), trạng thái, tiến độ |
| `runtime_logs` | Log canonical, ghi theo lô trong transaction để không chặn main process |
| `purchased_emails` | Mailbox đã mua (Gmail94 `order_id`, DongVanFB `Email|Pass|RefreshToken|ClientId`) |
| `proxy_leases` | Lease proxy đang giữ, phục vụ luật "hai profile không cùng IP" |

Ba ô có secret trên Dashboard (danh sách email, danh sách proxy, mật khẩu tự đặt)
**cố ý không lưu** vào `app_settings` vì đó là JSON thường — muốn lưu thì phải đi
qua vault (AGENTS.md §13).

## 7. Vòng đời một luồng chạy (hiện tại)

`AutomationRunService.start(config)` → worker pool đúng bằng số proxy key khả
dụng → mỗi luồng đi hết vòng đời rồi nhả key cho luồng trong hàng đợi:

```
mua/parse email → tạo account (mật khẩu mã hoá) → xin proxy (ProxyLeaseManager)
→ mở Multilogin quick profile với automation='playwright' → đọc debug port
→ [CHỖ SẼ CẮM ENGINE AUTOMATION] → tắt đúng profile đó → nhả đúng lease đó
```

API: `start`, `stop`, `stopThread(accountId)`, `getRunningThreads`,
`getProgress`, `subscribe(listener)`, `waitUntilRunning`, `waitForCompletion`.
Hiện tại phần trong ngoặc vuông chỉ **giữ browser 10 giây** để chứng minh CDP
attach được — đó chính là chỗ engine `Automation_Capcut` sẽ thay vào.

## 8. Luật proxy KiotProxy

Mỗi luồng chiếm một key và **luôn xin IP mới**; IP mới được đối chiếu với IP hiện
tại của key qua `/get-current`: trùng nghĩa là key chưa xoay → đổi key khác. Hết
key rảnh thì luồng chờ (`LazyProxyLeaseSource`). Hai profile không bao giờ giữ
cùng một IP; IP đã nhả thì dùng lại được — không có blacklist vĩnh viễn.

## 9. Kiểm chứng

| Lệnh | Phạm vi |
|---|---|
| `npm run typecheck` | `tsc --noEmit` cho main + preload + shared + renderer |
| `npm run lint` | eslint, `--max-warnings 0` |
| `npm run test:node` | vitest: repository, vault, service, provider (mock HTTP) |
| `npm run test:electron` | harness trong Electron thật: ABI `better-sqlite3`, `safeStorage`, renderer isolation, preload bridge |
| `npm run verify:providers` | gọi **API thật**, cấu hình qua `.env`; thao tác tốn tiền sau cờ riêng |

## 10. Cấu hình Dashboard áp dụng tới đâu

Bảng này được kiểm bằng cách đếm chỗ dùng thật trong `AutomationRunService` /
`CapcutEngineService`, không phải đọc tên field mà đoán.

| Field | Áp dụng | Đi tới đâu |
|---|---|---|
| `threadCount` | ✅ | số luồng + worker pool; bị chặn trên bởi số proxy key khả dụng |
| `browser` | ✅ | chọn runtime; `multilogin` đi qua `BrowserLauncher` |
| `headless` | ✅ | `launcher.launch()` / `startProfile()` |
| `proxy.mode` + `keys` | ✅ | `proxies.configure()` + `acquire()` |
| `emailSource` | ✅ | `buildThreadPlans` (manual / api / custom) |
| `password` | ✅ | `generateCapcutPassword` → mật khẩu CapCut của account mới |
| `retryCount` | ✅ | `maxRounds = clamp(1 + retryCount, 1, 4)` của `runAllTasks` |
| `stepDelayMin/MaxMs` | ✅ | nghỉ **thêm** sau mỗi nhóm nhiệm vụ và giữa hai lượt quét |
| `typeDelayMin/MaxMs` | ✅ | nhịp gõ mỗi ký tự, **sàn 45–130ms** (xem dưới) |
| `module` | ✅ | chỉ `credit` chạy; `trial`/`team` bị từ chối và báo rõ |
| `testDurationMs` | ⚠️ | chỉ dùng ở nhánh **không có** engine (giữ browser rồi tắt) |

**Vì sao delay có sàn:** CapCut chạy Shark Risk Control (ByteDance) chấm điểm quỹ
đạo chuột và độ trễ phím; bản cũ click teleport bị trả `err_no 8001003` khi nhận
thưởng. Nên hai ô delay của Dashboard **chỉ làm chậm thêm**:
`minMs = max(45, cấu hình)`, `maxMs = max(minMs, 130, cấu hình)`. Đặt 0 vẫn ra
≥ 45ms. Các `waitForTimeout(rand(...))` bên trong từng mission là thời gian chờ
UI đã đo — không phải nhịp người dùng — nên không bị hai ô này chạm tới.

**Chưa phủ:** phần gõ ở `login.ts`/`signup.ts` dùng `pressSequentially(..., { delay: 110 })`
cố định (nằm trong dải 45–130 đã đo nên không vi phạm sàn), chưa nối vào `pace`.



