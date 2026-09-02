# Kế hoạch gộp engine automation vào UI

Mục tiêu: engine trong `Automation_Capcut` chạy **bên trong main process** của
Electron, do `AutomationRunService` điều phối, UI không đổi hợp đồng IPC.

Nguyên tắc dẫn đường: **giữ nửa nào đã được nghiệm thu bằng API/DOM thật**. Cả
hai nửa đều có phần đã chứng minh, nên chỗ trùng nhau phải chọn dứt khoát chứ
không viết lại.

## 1. Chỗ cắm

`AutomationRunService` hiện đã làm đủ vòng đời một luồng, chỉ thiếu phần giữa:

```
mua/parse email → tạo account → xin proxy → mở quick profile (automation=playwright)
→ đọc debug port → ⟦ 10 GIÂY GIỮ BROWSER ⟧ → tắt profile → nhả lease
                     ↑
                     └── thay bằng: engine.runAllTasks(page, context)
```

Nghĩa là điểm gộp là **một hàm**, không phải một kiến trúc mới. Mọi thứ quanh nó
(proxy lease, worker pool, stop theo luồng, log, progress) đã có và đã chạy thật.

## 2. Bảng quyết định từng module

| Engine (`Automation_Capcut`) | Bên UI đã có | Quyết định |
|---|---|---|
| `session.ts` — mở profile qua `xcli`, `connectOverCDP`, gắn proxy | `MultiloginProvider` (API v3, đã live test) + `browserRuntime` + `ProxyLeaseManager` | **Bỏ engine**, dùng của UI. Engine chỉ nhận `page` + `context` từ ngoài |
| `prefs.ts` — bơm `credentials_enable_service=false` vào `Preferences` trước khi Chrome mở | chưa có | **Port sang** `browserRuntime`; cần đường dẫn profile dir từ Multilogin |
| `accounts.ts` + `accounts.txt` + `#DONE` | bảng `accounts` + `AccountRepository` | **Bỏ file phẳng**, dùng SQLite |
| `ledger.ts` + `.state/accounts.json` | bảng `accounts` (tiến độ) | **Port** thành cột/bảng tiến độ nhiệm vụ; giữ nguyên khái niệm `opId` chống ghi trùng |
| `trial.ts` — cổng ưu đãi Pro 7 ngày, fail-open | chưa có | **Port nguyên** thành bước trong pipeline; thêm toggle trong Settings |
| `task-api.ts` — `TaskStore`, `attachTaskMonitor` | chưa có | **Port nguyên**, đây là nguồn sự thật của mọi kết luận |
| `mission-runner.ts` — `MissionGroup`, `runGroup`, popover, Claim | chưa có | **Port nguyên** |
| `missions.ts` + `missions/*.ts` | chưa có | **Port nguyên** |
| `tasks.ts` — `bootstrap`, `runAllTasks`, `claimPending`, `printReport` | chưa có | **Port**, đổi `console.log` → `LogBus`, đổi `printReport` → progress DTO |
| `diag.ts` — `mustSee`, `assertHittable`, `dump` | chưa có | **Port nguyên**; `dump()` phải ghi vào `app.getPath('userData')/debug`, **không** vào cwd |
| `human.ts` — chuột/phím kiểu người thật | chưa có | **Port nguyên**, không được "tối ưu" (Shark Risk Control) |
| `image.ts` — `ensureSampleImage` | chưa có | **Port**, ảnh mẫu thành asset đóng gói trong app |
| `mail-otp.ts` | `Gmail94Provider`, `DongVanFBProvider`, `EmailPurchaseService` | **Bỏ engine**, dùng của UI |
| `login.ts` / `signup.ts` / `auth.ts` | chưa có | **Port nguyên** (UI chưa có luồng đăng ký CapCut) |
| `run-batch.ts`, `run-*.ts` (entry point CLI) | `AutomationRunService.start()` | **Bỏ**, UI là orchestrator |
| `capture.ts`, `tools/*` | chưa có | **Giữ ở repo engine** làm bộ công cụ chẩn đoán, không đóng gói vào app |
| `tools/verify-selectors.ts` + `tools/fixtures/` | chưa có | **Port sang** `ToolCapCut` như một script `npm run selectors` riêng — đây là lưới an toàn duy nhất kiểm UI CapCut mà không đốt account |

## 3. Kiến trúc sau khi gộp

```
src/main/
├─ services/
│  ├─ AutomationRunService.ts      (đã có) — worker pool, stop theo luồng
│  └─ capcut/                      ← MỚI: engine
│     ├─ TaskStore.ts              ← task-api.ts
│     ├─ missionRunner.ts          ← mission-runner.ts
│     ├─ missions/{simple,designStudio,videoStudio}.ts
│     ├─ steps/{login,signup,trial,inspiration,chat}.ts
│     ├─ diag.ts                   ← dump() ghi vào userData
│     └─ human.ts
├─ providers/MultiloginProvider.ts (đã có) — nguồn duy nhất mở/tắt profile
└─ repositories/                   (đã có) + tiến độ nhiệm vụ
```

Ranh giới bắt buộc giữ:

- Engine **không** được tự mở/tắt profile, không tự xin proxy, không tự đọc SQLite.
  Nó nhận `{ page, context, account, log }` và trả về kết quả từng nhiệm vụ.
- Engine **không** dùng `console.log`. Mọi dòng đi qua `log()` được inject, để
  `LogBus` biến thành canonical log có `accountId` (AGENTS.md §16).
- Kết luận thành công vẫn **chỉ** do cổng chứng minh `do_action` đưa ra. Không
  thêm đường nào cho phép UI tự đánh dấu xong.

## 4. Các pha, kèm cổng nghiệm thu

**Pha 0 — dọn điều kiện**
- `playwright-core` chuyển từ `devDependencies` sang `dependencies` (engine chạy
  trong app đã đóng gói).
- Đối chiếu `tsconfig`: engine import kèm đuôi `.js` (ESM). Xác nhận
  `moduleResolution` của `ToolCapCut` chấp nhận, hoặc bỏ đuôi khi port.
- Cổng: `npm run typecheck` sạch sau khi copy nguyên trạng 2 file không phụ thuộc
  gì (`human.ts`, `diag.ts`).

**Pha 1 — nền chẩn đoán**
- Port `human.ts`, `diag.ts`; `dump()` ghi vào `userData/debug`, giữ tối đa N dump.
- Port `tools/verify-selectors.ts` + toàn bộ `tools/fixtures/`.
- Cổng: `npm run selectors` **51/51** trong repo `ToolCapCut`.

**Pha 2 — đọc trạng thái nhiệm vụ**
- Port `task-api.ts` (`TaskStore`, `attachTaskMonitor`, `parseTaskList`).
- Port test thuần: `task-api.test.ts`, `mission-runner.test.ts`, `ledger.test.ts`,
  `trial.test.ts`, `diag.test.ts` — chuyển từ `node:test` sang vitest.
- Cổng: 5 file test này pass trong `npm run test:node`.

**Pha 3 — runner + nhiệm vụ**
- Port `mission-runner.ts`, `missions.ts`, `missions/*`, `login/signup/auth`,
  `trial.ts`, `image.ts`.
- Thay `console.log` bằng `log()` inject; thay `ensureSampleImage` bằng asset.
- Cổng: `npm run typecheck` + `npm run lint` sạch; chưa cần chạy thật.

**Pha 4 — cắm vào vòng đời luồng**
- `AutomationRunService`: thay đoạn giữ 10 giây bằng `runAllTasks`.
- Bơm `prefs` trước khi Chrome mở (port `prefs.ts` vào `browserRuntime`).
- Map kết quả → progress DTO (`run:on-progress`) + `runtime_logs`.
- Cổng: chạy thật **1 account**, CapCut ghi nhận ≥ số nhiệm vụ mà lượt engine CLI
  đạt được trên cùng account.

**Pha 5 — tiến độ và bỏ qua thông minh**
- Port khái niệm ledger vào SQLite: nhiệm vụ nào đã có `do_action` (kèm `opId`
  theo ngày) thì không làm lại; account đủ 12 nhiệm vụ thì đánh dấu xong.
- Cổng trial thành tuỳ chọn trong Settings (bỏ qua account không có ưu đãi).
- Cổng: chạy 4 account, không có nhiệm vụ nào bị làm lại vô ích, không account
  nào bị bỏ qua oan.

**Pha 6 — song song thật**
- Chạy `threadCount` luồng, mỗi luồng một `TaskStore` riêng (đang là instance
  theo `context`, cần kiểm lại khi nhiều context cùng sống).
- Cổng: 5 luồng / 2 proxy key — không luồng nào treo, số lease đồng thời không
  vượt số key, mọi lease được nhả (đã có 12 test cho phần lease).

## 5. Rủi ro và cách chặn

| Rủi ro | Vì sao thật | Cách chặn |
|---|---|---|
| `dump()` ghi vào cwd → app đóng gói không ghi được | engine hiện `path.resolve('.debug')` | đổi sang `app.getPath('userData')`, có giới hạn số dump |
| Nhiều luồng cùng nghe network, `TaskStore` lẫn dữ liệu | mỗi luồng một CapCut account | một `TaskStore` gắn với **một** `BrowserContext`, không dùng singleton |
| `console.log` mất khi vào Electron | engine in ra stdout | log inject bắt buộc, lint chặn `console.log` trong `services/capcut/` |
| Selector CapCut đổi | đã đổi 3 lần trong 2 ngày | `npm run selectors` là cổng CI; mỗi lần vỡ phải thêm fixture của **trạng thái làm vỡ** |
| Tối ưu hoá "cho nhanh" phá `human.ts` | Shark Risk Control chấm điểm quỹ đạo chuột | ghi rõ trong AGENTS.md, giữ nguyên `humanClick`/`humanType` |
| Bỏ `assertHittable` vì "chậm" | nó là thứ duy nhất bắt được lớp lỗi click-không-tới-đích | giữ ở mọi nút quyết định: Send canvas, export, opener |
| Engine tự tắt profile | script chẩn đoán cũ từng gọi `stop_all?type=quick` và tắt sạch profile của người khác | `stopAllQuickProfiles` đã bị xoá; có test chặn nó quay lại |

## 6. Việc cần anh quyết

1. **Mở profile bằng đường nào**: `MultiloginProvider` (API v3, UI đã live test)
   hay `xcli` (engine đang dùng)? Kế hoạch trên chọn API v3 — nếu anh muốn giữ
   `xcli` thì phải port thêm phần đọc profile dir để bơm `prefs`.
2. **Đăng ký account mới**: engine có `signup.ts` đầy đủ, UI hiện chỉ có luồng
   đăng nhập + mua email. Gộp luôn đăng ký vào Dashboard, hay để pha sau?
3. **Cổng trial**: bỏ qua account không có ưu đãi Pro 7 ngày (như engine đang
   làm) hay vẫn chạy hết? Hiện là fail-open, và đã có account bị bỏ qua thật.
4. **Nhiệm vụ nào bật/tắt được từ UI**: hiện engine luôn chạy đủ 4 nhóm. Có cần
   checkbox từng nhóm trong Settings không?
5. **Ba ô secret trên Dashboard** (danh sách email, danh sách proxy, mật khẩu tự
   đặt) hiện cố ý không lưu. Muốn lưu thì phải đi qua vault — làm ở pha nào?

## 7. Checklist gộp

- [x] Pha 0: `playwright-core` sang `dependencies` (nâng 1.56.1 → **1.62.1**, bản
      engine đã chạy thật), thêm `tsx` 4.23.13, `tsconfig` include `tools/**`,
      typecheck sạch
- [x] Pha 1: `human.ts` + `diag.ts` + 13 fixture, **`npm run selectors` 51/51**
      trong `ToolCapCut`
- [x] Pha 4a: `launcher/{BrowserLauncher,XcliLauncher,ApiV3Launcher,index}.ts` +
      `prefs.ts`; `app_settings.browser.multilogin.launcher` (`xcli` | `api-v3`,
      mặc định `xcli`) đã vào schema + defaults; 533 test cũ vẫn xanh
- [x] Pha 2: `TaskStore` + test chuyển sang vitest
- [x] Pha 3: runner + missions + login/signup/trial (23 file, ~4.500 dòng)
- [x] Pha 4b: cắm vào `AutomationRunService` — `runPrepared` gọi
      `runThreadWorkload`, Multilogin đi qua `BrowserLauncher`, engine chạy khi có
      `userDataDir`; `npm run build` + `npm run test:electron` xanh
- [ ] Chạy thật 1 account qua app (soi `✓ Đã tắt dialog lưu mật khẩu` và
      `do_action err_no=0`)
- [ ] Pha 5: tiến độ vào SQLite, chạy thật 4 account
- [ ] Pha 6: 5 luồng / 2 key, không treo, lease nhả hết
- [x] `AGENTS.md` §30: ranh giới engine (không tự mở profile, không `console.log`,
      không bỏ `assertHittable`, không "tối ưu" `human.ts`, giữ 2 package ngoài bundle)
- [x] UI: ô chọn `launcher` trong `BrowserSettingsPanel` + mô tả trade-off từng đường
- [x] `getOtp` nối vào `EmailPurchaseService.readOtp` theo từng luồng (poll 5s/lần
      trong 90s rồi báo lỗi rõ), nên đường ĐĂNG KÝ đã có nguồn OTP thật
- [ ] `CHANGELOG.md`: gộp mục `[Unreleased]` của engine vào phiên bản phát hành

## 8. Nhật ký gộp — quyết định và việc còn treo

**Đã quyết** (02/09/2026): nhà chung là `ToolCapCut`; giữ **cả hai** đường mở
profile sau interface `BrowserLauncher`, chọn qua
`app_settings.browser.multilogin.launcher`, mặc định `xcli` vì đó là đường đã
chạy thật 13 account trong ngày và là đường bơm được `Preferences`.

**Còn treo, cần làm khi cắm Pha 4b:**

1. `AutomationRunService` vẫn dùng `IBrowserRuntimeApi.startProfile()` trả
   `{profileId, port}` và **chưa bao giờ attach Playwright** — nó chỉ giữ browser
   `testDurationMs` rồi tắt. Đã thêm `port` vào `ThreadRuntime` để bước nhiệm vụ
   nối được vào đúng browser. Quyết định đề xuất: giữ `deps.browser` cho vòng đời
   profile của các browser chưa hỗ trợ (GoLogin/GPM vẫn phải báo
   `PROVIDER_NOT_IMPLEMENTED`), và dùng `BrowserLauncher` cho Multilogin.
2. `browserRuntime.ts` (`MultiloginBrowserRuntime.startProfile`) **chưa bơm
   prefs**, nên đường đi không qua launcher vẫn còn dialog "Save password".
3. `xcli` + proxy có user/pass ⇒ `CONFIG_ERROR` **có chủ ý** (engine chưa từng đo
   cờ user/pass cho xcli). Mà `parseDirectProxy` của `AutomationRunService` sinh
   được proxy user/pass ⇒ UI phải khoá `xcli` ở chế độ đó hoặc hiện lỗi rõ.
4. `seedPreferences` trên đường `api-v3` **chưa đo tay**. Lượt chạy thật đầu tiên
   phải soi dòng log `✓ Đã tắt dialog lưu mật khẩu`.
5. `ensureSampleImage` không còn tự đoán cwd — người gọi phải truyền thư mục
   (dùng `app.getPath('userData')`).
6. `diag.dump()` cần `setDumpDir(path.join(app.getPath('userData'), 'debug'))`
   gọi một lần lúc khởi động main process.

**Đã va phải và đã sửa:**

7. **`npm run build` vỡ khi gộp engine**: Rollup bundle `playwright-core` vào
   `dist-electron/main.js` rồi chết ở `Rollup failed to resolve import "kerberos"`
   — `playwright-core/lib/utilsBundle.js` có dynamic import native tuỳ chọn. Sửa:
   thêm `playwright-core` vào filter `notBundle` trong `vite.config.ts`, cùng chỗ
   với `better-sqlite3`. Sau đó `main.js` = 351 kB và
   `npm run test:electron` báo `ALL RUNTIME CHECKS PASSED (100%)`.
8. **`better-sqlite3` lệch ABI** sau mỗi `npm install`: 59 test đỏ hàng loạt với
   `DatabaseConfigurationError` mà không phải lỗi code. `npm run rebuild:node`
   trước khi chạy vitest, `npm run rebuild:electron` trước khi chạy app.
9. Thêm field vào `settings.schema.ts` làm vỡ **8 fixture test** dựng object
   settings đầy đủ — phải cập nhật cả 8, đừng nới lỏng assertion.



