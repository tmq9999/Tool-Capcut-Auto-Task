# Kế hoạch sửa sau audit toàn dự án — 04/09/2026

Nguồn: 4 lượt audit song song (hợp đồng IPC · wiring Settings/Dashboard · trạng thái
provider · món nợ tồn). Mọi mục đều có `file:line`; mục nào kiểm ra **không phải
lỗi** đã bị loại khỏi đây để không ai đi sửa nhầm.

Thứ tự dưới đây không phải theo mức nghiêm trọng mà theo **thứ tự thi công**: sửa
lỗi gốc trước thì các lỗi sau tự lộ ra và rẻ hơn nhiều.

---

## Pha 0 — lỗi gốc làm cả lớp lỗi này vô hình

Làm trước tiên. Nhỏ, và nó là lý do lỗi tab Logs sống được lâu như vậy.

**0.1 `VALIDATION_ERROR` phải mang theo field nào sai.**
Mọi handler viết `if (!parsed.success) return VALIDATION_ERROR` rồi **vứt
`parsed.error`** (`ipcResult.ts:4-7`; `logsIpc.ts:17`, `accountsIpc.ts:17,30,43,56`,
`automationIpc.ts:26,51,97`, `settingsIpc.ts:44`). `NormalizedIpcErrorSchema` đã có
sẵn ô `details` (`ipc-envelope.schema.ts:6`) không ai dùng.
→ Đưa `issues[].path` + `message` vào `details`. Main biết chính xác field nào sai,
không được phép ném đi.
*Nghiệm thu:* gọi `logs.list({pageSize: 999})` qua app thật, thông báo phải nêu
`pageSize` và giới hạn.

**0.2 Hằng dùng chung cho mọi giới hạn trang.**
`accountsController.ts:83` đặt `pageSize = 500`, đúng bằng `account.schema.ts:56`
`.max(500)` — hai con số phải khớp, khai ở hai file. Đây đúng hình dạng lỗi Logs
trước khi vỡ.
→ Export `ACCOUNT_PAGE_SIZE_MAX` giống `LOG_PAGE_SIZE_MAX` (`log.schema.ts:29`) và
dùng chung. Test đối chiếu request thật với contract thật đã có sẵn khuôn ở
`logsController.test.ts:157-172`.

---

## Pha 1 — UI mời người dùng làm việc chắc chắn hỏng

**1.1 Khoá 4 browser không tồn tại.** GoLogin/GPM/Camoufox/Patchright không có một
file implementation nào (`find` ra 0 kết quả); `providerStack.ts:140-143` trả
`UnsupportedBrowserRuntime`. Dropdown **không khoá gì** (`AutomationConfigGrid.tsx:36-42`).
Nặng hơn: `start()` **mua email trước** (`AutomationRunService.ts:983` → `:398`) rồi
`launchThread` mới fail (`:517`) — chọn GoLogin + nguồn API là gọi API mua N hộp thư
rồi mới báo lỗi. Và run kết thúc bằng `stopped`, không phải `failed` (`:948`).
→ Khoá option + nhãn "(chưa hỗ trợ)", đúng khuôn `module` trial/team đã làm đúng
(`AutomationConfigGrid.tsx:286-311`). Thêm chốt ở main **trước** khi mua email.
→ Sửa 2 comment sai: `AutomationRunService.ts:187,499` ghi `PROVIDER_NOT_IMPLEMENTED`,
thực tế `browserRuntime.ts:123` ném `CONFIG_ERROR`.

**1.2 Proxy trực tiếp: nhận đủ định dạng, và không bao giờ bỏ dòng im lặng.**
`parseDirectProxy` (`AutomationRunService.ts:262-272`) chỉ `split(':')` và ghim
`type: 'http'`. `socks5://ip:port` → `port = NaN` → trả `null` → `buildThreadPlans`
`flatMap` **loại dòng đó không log gì** (`:373-378`), rồi gán proxy theo index
(`:441-444`). Dán 5 dòng mà 2 dòng sai → 3 luồng có proxy, **2 luồng chạy bằng IP
thật của máy, không một dòng cảnh báo**. Với công việc này đó là hậu quả nặng nhất
trong cả bản audit.
→ Đọc scheme `http|https|socks4|socks5`, mặc định `http` khi không có; `type` lấy
từ scheme thật. Dòng không parse được thì **từ chối cả lượt chạy** kèm số dòng, chứ
không chạy tiếp với ít proxy hơn. Sửa placeholder (`:262`) cho đúng định dạng mới.

**1.3 Chặn sớm xung đột `xcli` + proxy user/pass.** Placeholder mời
`IP:PORT:USER:PASS` (`AutomationConfigGrid.tsx:262`), mặc định launcher là `xcli`
(`settings.schema.ts:104`), mà `xcli` từ chối đúng loại đó (`XcliLauncher.ts:139-146`).
Cấu hình mặc định + gợi ý của UI = 100% chết ở bước mở browser, **sau khi đã thuê
email**.
→ Kiểm trong `toRunConfig` (`automationConfig.ts:82-95`, hiện chỉ kiểm email/mật
khẩu) và chặn tại chỗ bấm BẮT ĐẦU, kèm câu chỉ đúng cách sửa (đổi sang `api-v3`).

**1.4 Headless bị nuốt.** `XcliLauncher.ts:157-162` chỉ log cảnh báo rồi bỏ qua —
bật Headless với cấu hình mặc định vẫn bung N cửa sổ Chrome.
→ Hoặc UI nói rõ "chỉ có tác dụng với launcher api-v3", hoặc từ chối tổ hợp đó như
1.3. Không được im lặng.

**1.5 `browser.provider` ở Settings không điều khiển gì.** Không nơi nào trong
`src/main` đọc nó; browser thật lấy từ `automation.browser` của Dashboard. Mặc định
hai ô còn **lệch nhau**: Settings `gpm` (`default-settings.ts:12`) vs Dashboard
`multilogin` (`:24`).
→ Bỏ ô đó khỏi Settings (Dashboard mới là nơi chọn), hoặc nối thật. Bỏ thì rẻ và
đúng hơn: một thứ, một chỗ chọn.

---

## Pha 2 — số liệu hiển thị sai mà trông như đúng

**2.1 Lọc Accounts/Logs chỉ chạy trên trang đầu.** SQL server-side đã viết xong
(`AccountRepository.ts:236-248`, `LogRepository.ts:55-62`) và contract đã có
`query`/`status`/`emailProvider`/`level`/`email`, nhưng renderer **không gửi**
(`accountsController.ts:106`, `logsController.ts:91-94`) và lọc phía client. Có 1573
dòng log, lỗi ở dòng 800, chọn ERROR → "Không có bản ghi phù hợp".
→ Đẩy filter xuống server. Đây là đường rẻ nhất vì backend đã sẵn sàng.

**2.2 Phân trang Accounts là trang trí.** `DataGrid.tsx:52` không có
`getPaginationRowModel`, `AccountsPage.tsx:267` truyền nguyên `filteredAccounts`.
Bấm ‹ › chỉ đổi nhãn; **dòng 501 trở đi không có cách nào xem**.

**2.3 Dashboard cắt 200 dòng nhưng hiện tổng thật.** `dashboardController.ts:92,232`
vs `DashboardPage.tsx:192` — người dùng thấy "N tài khoản" mà lưới chỉ có 200.

**2.4 Cột Password trang Accounts luôn trống.** Main có gửi `hasPasswordCapcut`
(`AccountRepository.ts:262-263`), renderer vứt (`accountsController.ts:40-54`), grid
vẫn đọc `accessorKey: 'password'` (`columns.tsx:55-56`). Dashboard làm **đúng**
(`Dashboard/columns.tsx:65,75`) — copy cách đó.

**2.5 Filter Provider không bao giờ khớp.** Select có `Gmail/Outlook/Yahoo/Proton`
(`AccountsToolbar.tsx:68-80`) so `===` với giá trị automation ghi ra:
`gmail94`/`dongvanfb`/`customdomain`/`manual` (`AutomationRunService.ts:415-419`).

**2.6 Xoá trắng ô số làm hỏng autosave.** `Input` không có `min`/`max` và không kẹp
(`Input.tsx:26-40`); `Number('') === 0` → `threadCount: 0` vi phạm `.min(1)`
(`settings.schema.ts:74`) → autosave trả lỗi tiếng Anh giữa UI tiếng Việt
(`DashboardPage.tsx:184-189`). Đường `run.start` **không** dính vì `toRunConfig` tự
validate trước — dùng chính cách đó cho `saveConfig`.

**2.7 Log không bao giờ được dọn.** `cleanupOldLogs` (`LogRepository.ts:86`) **chưa
từng được gọi** ngoài test, và `logs.retention` (`settings.schema.ts:52`) không có
panel nào trong Settings. Vi phạm AGENTS §18; `runtime_logs` phình vô hạn (đang 1573
dòng sau một ngày).

---

## Pha 3 — chức năng thiếu hẳn (CẦN ANH QUYẾT trước khi làm)

**3.1 Xuất account: 0/3 định dạng.** `ExportDialog.handleExport` = `onClose()`
(`ExportDialog.tsx:55-58`). Không có thư viện xlsx trong `package.json`, không có
hàm ghi file nào. Kênh `accounts:export` đã đặt chỗ (`ipc-channels.ts:36-38`) nhưng
chưa có handler.
**Chặn kỹ thuật:** phải làm ở **main**, không thể ở renderer — `AccountListItemDTO`
(`account.schema.ts:61-78`) chỉ mang `hasPasswordCapcut`/`hasEmailData` là *boolean*,
không mang giá trị, nên renderer không có gì để ghi vào cột "Password CapCut" và
"Email Data" của §21. Cần giải mã bằng `CredentialVault` + `dialog.showSaveDialog`.
**Cần quyết:** implement (thêm 1 dependency xlsx) hay khoá nút lại kèm ghi chú?
*Phụ:* preview XLSX dùng dấu `|` (`ExportSettingsPanel.tsx:58`) trong khi §21 nói chỉ
TXT mới dùng `|`.

**3.2 Bốn browser chưa có.** Implement 4 provider là việc **lớn** (mỗi cái một API +
một launcher, mà kể cả có provider thì `AutomationRunService.ts:502` chỉ gọi launcher
cho `multilogin` nên vẫn không chạy nhiệm vụ được).
**Cần quyết:** implement hay khoá UI (Pha 1.1)?

**3.3 Tiến độ 12 nhiệm vụ không hiện ở đâu.** `account_tasks` chỉ ghi, không ai đọc:
`AccountTaskRepository.listByAccount` (`:128`) không có consumer ngoài test, không
kênh IPC, UI không thấy. Dữ liệu quý nhất của tool đang nằm im trong DB.

**3.4 Điều khiển chết còn lại.** Nút Import/Export Dashboard không có `onClick`
(`DashboardPage.tsx:243-256`); Auto Scroll (`LogsFilterBar.tsx:73-81`); filter "Ngày
tạo" (`AccountsToolbar.tsx:55-66`, còn làm chip "Active Filters" hiện sai);
Browser/Profile bị rơi khi thêm/sửa account (`accountsController.ts:122-132,145-155`);
`passwordCapcut` không nhập được (mà là **cột #2 của bản xuất** §21); thiếu `WARNING`
trong bộ lọc level (`LogsFilterBar.tsx:44-50`); `SegmentedControl` không có prop
`disabled` nên 2 ô vẫn bấm được khi đang chạy; "Khôi phục mặc định" âm thầm xoá cả
`automation` + `customEmail` (`SettingsPage.tsx:62-64`).

**3.5 Settings lưu rồi bỏ.** `general.theme` (`index.html:2` hard-code `class="dark"`),
`general.language` (không có i18n), `general.sessionRestore`, `browser.gpm.port`,
`browser.gologin.autoPort`, `browser.camoufox.headless`, `browser.patchright.headless`,
`browser.multilogin.port`, credential GoLogin (lưu mã hoá, không service nào đọc).
**Cần quyết:** implement hay bỏ khỏi UI? Bỏ thì Settings ngắn lại và không hứa hão.

**3.6 Đường dây bị cắt giữa chừng.** `ProxyConfig.region` (`automation.schema.ts:48`)
— `ProxyLeaseManager.ts:136` đọc nhưng `AutomationRunService.ts:883` không chuyển;
`skipWithoutTrial` (`CapcutEngineService.ts:105`) — `providerStack.ts:174` không bao
giờ truyền nên luôn `false`.

---

## Pha 4 — món nợ engine

- **`bootstrap` leo thang yếu hơn `withTaskPopover`** (`runTasks.ts:153-232` chỉ 1 ứng
  viên + 1 click, ném lỗi là account chết) trong khi runner đã có bậc 6 selector ×
  2 vòng + `URLS.tasks` (`missionRunner.ts:324-383`). Dùng lại bậc đã có — **nhỏ**.
- **Login/signup không có dump**: `waitFor` 25s ném lỗi Playwright trần, hai file
  không import `diag` (`login.ts:145`, `signup.ts:77,93,337,368`) — **nhỏ**.
- **`dump()` không giới hạn số file** dù Pha 1 và bảng rủi ro đều yêu cầu
  (`diag.ts:69-84`) — **nhỏ**.
- **Chạy 5 luồng / 2 proxy key** — đường xếp hàng khi thiếu key mới chỉ có unit test.
- **`ensureNodeToolbar` chưa nghiệm thu chạy thật**; nguyên nhân "node mất selection"
  vẫn là *nghi*, chưa chứng minh (`videoStudio.ts:184,426`).
- **Tab chính chết giữa lượt**: đã có chẩn đoán `crash` vs `close` và lá chắn `stale`,
  **chưa có đường phục hồi**, nguyên nhân chưa chứng minh — **lớn**, để sau.
- **`npm run capture` trong `docs/AUTOMATION-ENGINE.md:199` không tồn tại**.

---

## Tài liệu cần sửa (audit chỉ ra đang nói sai)

1. `MERGE-PLAN:169` tick được — dòng `CapCut ghi nhận x/12` có thật, lượt 5/6/7 đã đạt.
2. `MERGE-PLAN:197` "chưa bao giờ attach Playwright" — sai, đã attach từ Pha 4b.
3. `MERGE-PLAN:210,212` (`ensureSampleImage`, `setDumpDir`) — đã xong.
4. `MERGE-PLAN:133,136` — đã quyết và đã làm, bỏ khỏi "Việc cần anh quyết".
5. `AGENTS.md:1128` ghi 51 assertion; thực tế **87**.
6. `CHANGELOG.md:223` — nửa "mất hộp thư" không còn đúng (đã có `release()` + tái dùng).
7. `CHANGELOG.md:54` nhắc `capcut/onboarding.ts`; tên thật là `capcut/overlays.ts`.
8. Chưa ghi vào CHANGELOG: fix trang Logs, lỗi khởi tạo DB/main mang nguyên nhân gốc,
   và toàn bộ phần đóng gói installer.

---

## Ba câu cần anh quyết trước khi tôi bắt tay

1. **Xuất account** — implement (thêm dependency xlsx, làm ở main) hay khoá nút?
   → **Anh trả lời 04/09/2026: "Implement chức năng quan trọng như vậy khóa cái gì."**
   Đã làm: `accounts:export` + `AccountExportService` (TXT/CSV/XLSX), dependency
   `write-excel-file@4.1.1`.
2. **Bốn browser** — implement (lớn) hay khoá UI kèm ghi chú?
   → **Anh trả lời: "Tạm thời chỉ sử dụng Multilogin."** Giữ nguyên phần khoá của
   Pha 1.1 (dropdown khoá + chốt ở main trước khi mua email).
3. **Settings lưu rồi bỏ** — implement hay bỏ khỏi UI?
   → **Anh trả lời: "Implement đầy đủ."** Đã nối thật: `general.theme` (áp class
   `dark` lên `<html>`), `general.sessionRestore` (mở lại trang cuối),
   `logs.retention` (thêm ô trong Settings). Hai mục KHÔNG nối được bằng cách nối
   dây, phải làm như một việc riêng — xem "Còn treo" dưới.

---

## Trạng thái thi công (cập nhật 04/09/2026)

- **Pha 0, 1, 2, 4:** xong ở phiên trước (676 test).
- **Pha 3:** xong 3.1 (xuất file), 3.3 (tiến độ 12 nhiệm vụ ra UI), 3.4 (mọi điều
  khiển chết trong danh sách), 3.5 (phần nối được), 3.6 (`ProxyConfig.region`).
  Hiện: **731 test pass, tsc sạch, lint sạch, selectors 87/87, `npm run build` chạy.**

### Còn treo — cần anh quyết vì mỗi việc là một dự án nhỏ, không phải nối dây

1. **Bảng màu sáng (theme Light).** `tailwind.config.ts` chỉ có MỘT bộ màu tối,
   viết bằng hex trực tiếp (~45 token, không có CSS variable, không nơi nào dùng
   biến thể `dark:`). Bỏ class `dark` bây giờ = chữ tối trên nền tối. Làm thật =
   đổi 45 token sang CSS variable + thiết kế bộ màu sáng + soi lại 4 trang. Tạm
   thời: ô `Light` bị khoá kèm ghi chú "chưa có bảng màu".
2. **Tiếng Anh (i18n).** Đếm được **191 chuỗi tiếng Việt** có dấu trong
   `src/renderer` (chưa tính chuỗi không dấu và nhãn tiếng Anh), rải khắp ~40 file.
   Làm thật = rút toàn bộ ra dictionary + dịch + soi lại từng trang. Tạm thời: ô
   `English` bị khoá kèm ghi chú "chưa dịch".
3. **Nhập account từ file (Import).** Chưa có kênh, chưa có parser. Nút Import trên
   Dashboard đang khoá kèm ghi chú. Lưu ý: dán danh sách vào ô "Nguồn email
   (Manual)" đã là một đường nhập có thật.
4. ~~**`skipWithoutTrial`**~~ — **xong 04/09/2026**: ô "Bỏ qua account không có
   trial Pro ≥ 7 ngày" ở panel Module, đi từ Dashboard → `AutomationRunConfig` →
   `runAccount`. Mặc định TẮT.
5. ~~**`ProxyConfig.region`**~~ — **xong 04/09/2026**: ô "Vùng" ở panel Proxy (chỉ
   hiện với Proxy Key), 4 lựa chọn `random`/`bac`/`trung`/`nam`. `random` không gửi
   khoá `region`; contract chỉ nhận 3 vùng thật.

### Gác lại theo yêu cầu (04/09/2026): 1 · 2 · 3 ở trên — implement sau.

