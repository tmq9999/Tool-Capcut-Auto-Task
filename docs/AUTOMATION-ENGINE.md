# Engine automation CapCut (`Automation_Capcut`)

Engine chạy nhiệm vụ "Free credits" của CapCut Web bằng Playwright nối vào
Multilogin qua CDP. Đây là phần sẽ được cắm vào `AutomationRunService` của UI —
xem [`MERGE-PLAN.md`](MERGE-PLAN.md).

## 1. Nhiệm vụ và phần thưởng

Account đầy đủ có **12 nhiệm vụ / 2060 credits**. Có biến thể **10 nhiệm vụ /
1380 credits**: không có `capcut_web_pwa_install` lẫn `capcut_web_push_authorize`,
thay bằng `capcut_web_daily_checkin`. Engine **phải bỏ qua** key không có trong
snapshot, không được coi là "chưa xong".

| `task_key` | Tên hiển thị | +credits | Quan hệ |
|---|---|---|---|
| `capcut_web_newbie_register` | Sign up for CapCut Web | 520 | — |
| `capcut_web_pwa_install` | Install CapCut Web Desktop | 210 | — |
| `capcut_web_push_authorize` | Enable browser notifications | 210 | — |
| `capcut_web_daily_checkin` | Daily sign-in | 260 | chỉ ở biến thể 10 nhiệm vụ |
| `capcut_web_design_studio_picture_creation` | Create images in Design Studio | 80 | **cha** của 3 dòng dưới |
| `capcut_web_design_studio_ai_chat` | Chat with AI agent | 110 | con |
| `capcut_web_design_studio_upload_img` | Upload an image | 110 | con |
| `capcut_web_design_studio_canvas_edit` | Edit on canvas | 160 | con |
| `capcut_web_inspiration_generate_done` | Try an Inspiration template | 130 | — |
| `capcut_web_video_studio_creation` | Create in Video Studio | 80 | **cha** của 3 dòng dưới |
| `capcut_web_video_studio_send_msg` | Chat with AI agent | 130 | con |
| `capcut_web_video_studio_generate_done` | Complete a generation | 130 | con |
| `capcut_web_video_studio_export` | Make an export | 190 | con |

Task **cha** không có hành động riêng: nó tự lên `status=2` rồi `4` khi các con
xong. Nếu nó kẹt ở `2` thì phải bấm Claim trong popover.

## 2. Bản đồ module

| File | Trách nhiệm |
|---|---|
| `session.ts` | Mở Multilogin quick profile qua `xcli`, đọc debug port, `connectOverCDP`, gắn proxy; `parseCommonArgs` cho mọi entry point |
| `prefs.ts` | Bơm `credentials_enable_service=false` vào file `Preferences` **trước khi** Chrome mở (dialog "Save password" là UI ngoài DOM, không click được) |
| `profiles.ts` / `run-cleanup.ts` | Sổ theo dõi profile đã mở + `npm run cleanup` tắt sạch |
| `auth.ts` / `login.ts` / `signup.ts` | Quyết định đăng ký hay đăng nhập, rồi thực hiện |
| `mail-otp.ts` | Đọc OTP từ provider mail |
| `trial.ts` | Cổng ưu đãi Pro 7 ngày, đọc từ **DOM** chứ không tin API |
| `task-api.ts` | `TaskStore` + `attachTaskMonitor`: nghe network, parse `task_list`, thu `do_action` |
| `mission-runner.ts` | Hợp đồng `MissionGroup`, `runGroup` (cổng chứng minh), popover, Claim |
| `missions.ts` | Bước dùng chung: `fillEditor`, `clickSend`, `stepInspirationTemplate`, `stepChatWithAgent`, `URLS` |
| `missions/simple.ts` | PWA install + bật thông báo |
| `missions/design-studio.ts` | 4 nhiệm vụ Design Studio |
| `missions/video-studio.ts` | 3 nhiệm vụ Video Studio |
| `tasks.ts` | `bootstrap`, `runAllTasks`, `claimPending`, `printReport`, `readCredits` |
| `ledger.ts` | Tiến độ từng account vào `.state/accounts.json` |
| `accounts.ts` | Đọc/ghi `accounts.txt`, đánh `#DONE`, `saveCredentialsToEnv` |
| `run-batch.ts` | Chạy hàng loạt: proxy pre-flight, cổng trial, ledger |
| `diag.ts` | `mustSee`, `assertNotInert`, `waitNotInert`, **`assertHittable`**, `dump`, `attachNetDiag` |
| `human.ts` | Chuột/bàn phím kiểu người thật, `isDisabled`, `waitEnabled`, `dismissOverlays` |
| `capture.ts` | Ghi `.capture/<timestamp>/`: `clicks.log`, `network.ndjson`, `dom/`, `transitions.log` |

## 3. Cổng chứng minh — luật trung tâm

```ts
interface MissionGroup {
  name: string;
  keys: string[];            // các task_key nhóm này hoàn thành
  proofTimeoutMs: number;    // simple 45s · design 90s · video 240s
  act(env: MissionEnv, need: Set<string>): Promise<void>;   // CHỈ thao tác UI
}
```

`act()` **không có đường nào tự khai thành công**. Kết luận chỉ do `runGroup`
đưa ra, dựa trên `do_action` đúng `action_key` với `err_no === 0`, rồi soi lại
`task_status` trong snapshot của CapCut. Bản cũ làm ngược lại — mỗi bước tự in
`✅` rồi đi tìm nút Claim không tồn tại — nên báo 7/10 trong khi CapCut ghi 6/10.

Hai chi tiết dễ làm sai:

- `act()` ném lỗi **không** có nghĩa cả nhóm thất bại. Một nhóm làm nhiều nhiệm
  vụ; vỡ ở bước cuối thì các bước trước vẫn đã xong thật. Khi `act()` ném,
  `runGroup` hạ thời gian chờ xuống 3s để **thu bằng chứng đã tới**, không chờ
  tiếp vô ích.
- Key không có trong snapshot ⇒ account không có nhiệm vụ đó ⇒ bỏ qua
  (`selectGroups`). Trước đây engine đứng chờ `do_action` 45s × 2 nhóm × 2 lượt
  cho nhiệm vụ không tồn tại.

## 4. Trình tự đã đo được của từng nhóm

**Design Studio** (`missions/design-studio.ts`)

1. `stepInspirationTemplate` — mở `share-inspiration/<id>` (40 credits/ảnh), điền
   text vào ô trống của prompt mẫu, Send. CapCut mở **tab mới** để generate →
   ăn luôn `inspiration_generate_done`.
2. `stepChatWithAgent` — chat bất kỳ với AI agent (`ai_chat`).
3. Về `/ai-design` **sạch**, `uploadToCanvas` bằng nút trên thanh
   `[aria-label="Canvas tools"]` (`upload_img`).
4. `editOnCanvas` (`canvas_edit`): **ẩn khung chat** → chờ canvas layout xong →
   click vùng `#graphic-editor-render` → mở `[aria-label="Open canvas prompt"]`
   (nhãn "Tab to design") → chờ `expandedWrapper` hết `inert` → gõ prompt → đọc
   lại DOM xác nhận chữ đã vào → `waitEnabled` → `assertHittable` → Send.
   Tín hiệu thành công: nút đổi `[aria-label="Stop generating"]`, nhãn panel đổi
   `Thinking`, `do_action` bắn ~1 giây sau khi **gửi** (không phải khi có kết quả).

**Video Studio** (`missions/video-studio.ts`)

1. Dẹp onboarding `Got it`.
2. `selectImageMode` — **bắt buộc**: chế độ mặc định `Auto` là short-drama, ở đó
   `.inputEditor-*` chỉ là `div` thường, cả trang không có `contenteditable` nào.
   Chỉ chế độ **Image** mới mount editor thật (`[data-placeholder="Enter ideas to
   generate an image"]`).
3. `generateImage` — gõ prompt con vật, Send, xử lý card chen ngang
   (`confirmCredits`), chờ **node mới** theo `data-id`.
4. `waitNodeRendered` — chờ ảnh vẽ xong (hết `progressText`/`UploadingSkeleton`).
5. `findExportButton` — soi **tooltip** từng nút trên `.react-flow__node-toolbar`,
   chỉ `/export/i` mới đúng; rồi `assertHittable` → click.

## 5. Bảng bất biến đã đo được

Đây là phần đắt nhất của dự án: mỗi dòng là một lượt chạy thật đã trả giá. Ai
sửa engine phải đọc hết bảng này trước.

| Bất biến | Bằng chứng | Hệ quả nếu vi phạm |
|---|---|---|
| `page.mouse` **không** kiểm element nào nằm trên | nút Send canvas `(611,718)`, `elementFromPoint` trả `skillPanel-4DcNp3` của khung chat | click "thành công" mà không tới đích, im lặng 90–240s |
| Khung chat "Design with AI" rộng 440px phủ canvas prompt panel khi cửa sổ ~929px | 22/22 lượt `canvas_edit` trượt; ẩn chat → `err_no=0` ngay | mất 160 + 80 credits/account |
| Node toolbar `3/5` nút = ảnh đã xong; `2/4` = còn đang tạo | 14 lượt, 2 lần chạy độc lập: `3/5` → 6/6 thành công, `2/4` → 0/8 | click export không sinh `do_action` |
| Nút disabled của CapCut = class chứa `disabled-*` **hoặc** `aria-disabled` **hoặc** `disabled` | `human.isDisabled` | `waitEnabled` sai ⇒ click nút chết |
| Element trong vùng `inert`/`aria-hidden` nhận click ở ancestor | `assertNotInert` | gõ prompt vào editor inert, chữ không vào đâu cả |
| `[data-id="TitleBarFreeCredits"]` trên `/my-edit` chỉ bọc `<span>` **rỗng**; lối vào thật là `[data-id="TitleBarTaskList"]` | dump `004_no_task_list.html`: chữ "Free credits" xuất hiện 0 lần | popover không mọc ⇒ `push_authorize` và `task_list` cùng chết |
| `/ai-design` có biến thể header **không có lối vào nhiệm vụ nào** (chỉ `credit-balance`) | dump `001_no_task_list.html` | reload bao nhiêu lần cũng vô ích, phải sang `/my-edit` |
| Card `Use advanced features with Pro`: `Continue` = mở bảng giá, `Skip` = generate | dump `014_no_new_node.html` có `subscriptionModal-title` | mất cả 3 nhiệm vụ Video Studio |
| `/ai-creator/studio?enter_from=credit_task` mở **draft trắng** | `cfyhduzf51878`, `ehzqrntq03637` bế tắc 3 lượt | account chỉ thiếu `export` không bao giờ xong |
| Popover nhiệm vụ ghim ở `enter_from=signup`: Escape/click ngoài/bấm lại **đều không đóng**, chỉ reload mới đóng | profile `1627342b` | popover che giữa canvas ⇒ 10 lỗi `canvas_panel_missing` |
| `/ai-design` có 5 thẻ `canvas`, 3 thẻ đầu cao 0 | `waitCanvasReady` | `locator('canvas').first()` vô dụng |
| Multilogin chỉ publish cổng CDP khi start kèm `automation` type | không automation → `port: null` sau 60s | Playwright không attach được |
| Multilogin rotate refresh token mỗi lần signin, trả **HTTP 400** | 3/3 luồng fail sau vài giờ | map thành `CONFIG_ERROR` ⇒ nhánh fallback signin không chạy |
| CapCut chạy Shark Risk Control: chấm điểm quỹ đạo chuột và độ trễ phím | `grant_reward` trả `err_no 8001003` khi click teleport | bị chặn nhận thưởng |
| Hai dòng "Chat with AI agent" chỉ khác nhau ở reward (+110 vs +130) | `findTaskRow` lọc cả title **và** reward | claim sai dòng, báo thành công sai |

## 6. Kiểm UI mà không đốt account

`npm run selectors` (`tools/verify-selectors.ts`) dựng Chrome thật, serve DOM dump
của những lượt đã chạy trong `tools/fixtures/`, rồi assert lại từng selector —
hiện **51 assertion**. Giới hạn phải biết: dump không tải CSS ngoài nên **không**
kiểm được visibility hay occlusion; hai thứ kiểm được là "selector phân giải ra
bao nhiêu element" và "element có nằm trong vùng `inert` hay không". Occlusion
được test riêng bằng một trang `setContent` dựng lại đúng hình học đã đo.

Fixture hiện có: `dom-ai-design.html` (trước khi gửi canvas prompt),
`dom-ai-design-sent.html` (sau khi gửi), `dom-ai-design-loading.html`,
`dom-video-studio.html`, `dom-video-studio-preexport.html`,
`dom-studio-pro-upsell.html`, `dom-upgrade-trial.html`,
`dom-upgrade-old-account.html`, `dom-titlebar-upgrade.html`,
`task-list-initial.json`, `task-list-done.json`.

## 7. Hiện trường khi lỗi

- `.debug/NNN_<label>.{html,png}` — DOM đầy đủ + ảnh, ghi bởi `dump()`. Mọi
  `StepError` đều mang theo tên dump để tra lại.
- `.capture/<timestamp>/` — lượt quan sát dài: `clicks.log` (thao tác kèm mốc
  thời gian), `network.ndjson`, `transitions.log` (mốc `task_status` đổi),
  `dom/` (DOM + ảnh tại từng mốc), `summary.md`.
- `.state/accounts.json` — ledger tiến độ; `.state/{port,profile}.txt` — phiên gần nhất.

Quy tắc đọc khi truy lỗi: `transitions.log` → `clicks.log` (thao tác ngay trước
mốc) → `network.ndjson` (request giữa hai mốc) → `dom/`.

## 8. Cổng trial Pro

`trial.ts` đọc **DOM** của modal nâng cấp, không tin 11 field API từng thử
(chúng không đáng tin cho việc này). Lối vào theo thứ tự:
`[data-id="TitleBarUpgradeVip"]` → `[data-id*="Upgrade"]` → chữ Upgrade trên
header → `[data-id="TitleBarFreeCredits"]` → `button.credit-section`.

Cổng **fail-open**: không đọc được trial thì **vẫn chạy** nhiệm vụ. Lý do đã đo:
khi selector cổng bị vỡ, nếu thiết kế fail-closed thì toàn bộ 21 account bị bỏ
qua âm thầm và báo cáo vẫn "đẹp". `MIN_TRIAL_DAYS = 7`.

## 9. Bất định còn lại

| Hiện tượng | Tần suất đo được | Trạng thái |
|---|---|---|
| `locator.waitFor: Timeout 25000ms` trong luồng đăng nhập | 1/14 rồi 1/7 account | chưa có nguyên nhân gốc |
| `Không bắt được task_list` | 2/14 → còn 2/7 | **sửa được một phần**: `findTaskEntry` cứu `qfvyjsly29972` (12/12), nhưng `jksqtiqa24961` và `yrqfvwwk67499` vẫn trượt — log nói "không có lối vào nhiệm vụ nào có kích thước thật", tức header của chúng khác nữa |
| `push_authorize` không ghi nhận | 2/14 → còn 1/7 | **chưa xong**: lối vào giờ chọn đúng `div[data-id=TitleBarTaskList]`, `Push subscription` có endpoint FCM thật (`sub: https://jmt17.google.com/fcm/send/…` ⇒ proxy KHÔNG chặn push), nút `Allow` đã bấm — nhưng bấm icon nhiệm vụ 2 lần popover vẫn 0 dòng |

Hai giả thuyết còn lại cho popover, chưa phân giải được:

1. Handler React nằm ở `#TitleBarTaskList` / `.Lv_Task-wrapper` bên trong, click
   vào **div bọc ngoài** `[data-id=…]` không kích hoạt (bubbling không chạy ngược).
2. Popover có mọc nhưng dòng dùng class khác `taskRow`/`taskLine`, nên
   `countTaskRows` đọc ra 0 dù nội dung đã ở đó.

Bước đo tiếp: dump DOM **ngay sau** cú click icon (hiện chỉ dump khi bước sau đã
thất bại), và thử click trực tiếp `.Lv_Task-wrapper` để tách giả thuyết 1 khỏi 2.


Khi thêm nhiệm vụ mới hoặc CapCut đổi UI: chạy `npm run capture` để ghi một lượt
làm tay, rồi trích DOM thành fixture và viết assertion **trước** khi sửa selector.
Đó là cách duy nhất trong dự án này để không sửa mù.



