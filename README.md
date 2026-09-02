# CapCut AutoManager

Hai nửa của cùng một sản phẩm, hiện còn nằm ở hai thư mục và đang được nhập lại thành một:

| Nửa | Thư mục | Vai trò | Ngôn ngữ / runtime |
|---|---|---|---|
| **UI + backend** | `D:\GeminiWorkspaceNew\ToolCapCut` | Electron desktop: Dashboard, Accounts, Logs, Settings; SQLite; vault mã hoá; IPC; 5 provider API thật | Electron 35 · React 19 · TypeScript 5.8 · better-sqlite3 |
| **Engine automation** | `D:\GeminiWorkspaceNew\Automation_Capcut` | Chạy nhiệm vụ CapCut Web thật: đăng ký/đăng nhập → cổng trial Pro → 12 nhiệm vụ → nhả profile | tsx · Playwright over CDP · Multilogin |

> Trạng thái: **engine đã chạy thật và có số liệu**, UI đã có backend thật.
> Việc còn lại là gộp engine vào tiến trình main của Electron — xem
> [`docs/MERGE-PLAN.md`](docs/MERGE-PLAN.md).

---

## Tài liệu

| File | Nội dung |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Kiến trúc UI + backend: layer, IPC, SQLite, provider, biên bảo mật |
| [`docs/AUTOMATION-ENGINE.md`](docs/AUTOMATION-ENGINE.md) | Kiến trúc engine automation, hợp đồng `MissionGroup`, cổng chứng minh `do_action`, **bảng bất biến đã đo được** |
| [`docs/MERGE-PLAN.md`](docs/MERGE-PLAN.md) | Kế hoạch gộp: bảng tương ứng module, các pha, cổng nghiệm thu, rủi ro |
| [`AGENTS.md`](AGENTS.md) | 29 luật kỹ thuật bắt buộc của dự án (layer, secret, migration, IPC, export…) |
| [`CHANGELOG.md`](CHANGELOG.md) | Lịch sử thay đổi |
| [`docs/report/verification-report.html`](docs/report/verification-report.html) | Báo cáo nghiệm thu tích hợp API thật (01/09/2026) |

---

## Chạy nửa UI (`ToolCapCut`)

```bash
npm install
npm run rebuild          # biên dịch lại better-sqlite3 cho ABI của Electron
npm run dev              # Vite + Electron dev
npm run typecheck        # tsc --noEmit
npm run lint             # eslint, --max-warnings 0
npm run test:node        # vitest (rebuild ABI Node trước)
npm run test:electron    # harness trong Electron thật
npm run verify:providers # gọi API THẬT, cần .env (xem .env.example)
```

Thao tác tốn tiền trong `verify:providers` nằm sau cờ riêng trong `.env`
(`VERIFY_DONGVANFB_BUY`, `VERIFY_KIOTPROXY_ROTATE`) — mặc định phải để `0`.

---

## Chạy nửa engine (`Automation_Capcut`)

```bash
cd ../Automation_Capcut
npm install
npm run login            # đăng nhập 1 account (đọc .env)
npm run tasks -- --reuse # làm nhiệm vụ trên profile vừa mở
npm run status           # chỉ đọc trạng thái nhiệm vụ, không thao tác
npm run batch            # chạy hàng loạt theo accounts.txt
npm run batch -- --limit=2
npm run cleanup          # tắt mọi quick profile Multilogin còn sót
npm run typecheck && npm test && npm run selectors
```

`npm run selectors` là cách kiểm UI **không đốt account**: nó dựng Chrome thật
rồi nạp DOM dump của những lượt đã chạy (`tools/fixtures/*.html`) và assert lại
từng selector — hiện **51 assertion**.

---

## Bố cục thư mục

```
ToolCapCut/
├─ src/main/         database (3 migration) · repositories · services · providers · ipc · security
├─ src/preload/      contextBridge: 11 kênh invoke + 3 kênh push, không expose ipcRenderer thô
├─ src/renderer/     Dashboard · Accounts · Logs · Settings (mỗi trang 1 controller thuần TS)
├─ src/shared/       contracts (ipc-channels) · schemas (zod) · types · settings
└─ docs/             ARCHITECTURE · AUTOMATION-ENGINE · MERGE-PLAN · report/

Automation_Capcut/
├─ src/              session · login/signup · trial · tasks · mission-runner · task-api
│  └─ missions/      simple.ts · design-studio.ts · video-studio.ts
├─ tools/            verify-selectors.ts · fixtures/ (DOM thật) · smoke · actions
├─ test/             5 file test thuần (node:test)
└─ .capture/ .debug/ ghi lại hiện trường: DOM + ảnh + network của từng lượt
```

---

## Trạng thái kiểm chứng

| Hạng mục | Số liệu | Nguồn |
|---|---|---|
| UI + backend: unit/integration | 451 test / 39 file, 0 fail | báo cáo 01/09/2026 |
| UI + backend: provider thật | 8/8 live check (4 provider + CDP) | báo cáo 01/09/2026 |
| Engine: test thuần | 35/35 pass | chạy lại 02/09/2026 |
| Engine: selector trên DOM thật | 51/51 assertion | chạy lại 02/09/2026 |
| Engine: account hoàn tất thật | 11 account trong ~1h20 (≈20.620 credits) | log batch 02/09/2026 |

Chi tiết từng nguyên nhân gốc đã sửa: [`CHANGELOG.md`](CHANGELOG.md) và bảng bất
biến trong [`docs/AUTOMATION-ENGINE.md`](docs/AUTOMATION-ENGINE.md).
