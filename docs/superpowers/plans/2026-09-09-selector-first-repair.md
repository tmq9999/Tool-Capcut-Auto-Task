# Selector-first repair: kế hoạch sửa có kiểm chứng

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Thực hiện từng task theo checkbox, RED → GREEN → review. Không triển khai toàn bộ cùng lúc.

**Goal:** Khôi phục luồng tài khoản mới → đăng ký/OTP → đủ 12 nhiệm vụ với các session độc lập, bỏ quỹ đạo chuột tự viết cho control DOM và không che lỗi bằng fallback mù.

**Architecture:** Sửa implementation của helper click hiện có; giữ interface, scheduler riêng từng session, nhịp gõ và cơ chế proof/receipt. Canvas readiness và lỗi không có task_list là hai nhánh khác, chỉ sửa khi xác định được điều kiện lỗi. Không thêm engine/strategy registry, lớp tự động hóa mới, database migration hoặc HTTP mission rewrite.

**Tech Stack:** Electron/Windows, TypeScript, Playwright Core 1.62.1, Vitest, Multilogin launcher hiện có.

**Spec:** Yêu cầu của người dùng trong hội thoại; các ràng buộc ở mục 1 bên dưới. Bằng chứng live: run `42b78934-7597-494c-8e36-5dbaaab163f3`. Kế hoạch này là bước sửa tiếp theo của [plan độc lập session](2026-09-09-independent-headed-workers.md), không phải triển khai lại scheduler.

**Status:** Task 1 đã triển khai và review độc lập. Sau đó đã chạy probe3 và một live3 theo duyệt riêng; [kết quả live đã đính chính](../reports/2026-09-09-selector-live-response.md) chưa đạt nghiệm thu (reward12/12 không chứng minh export hoàn tất). Task 2–5 chưa được triển khai theo kế hoạch này. Yêu cầu mới về kiểm từng step và capture network được cụ thể hoá trong [plan stepwise/network](2026-09-09-stepwise-evidence-network-plan.md); dùng plan đó để duyệt thứ tự sửa tiếp, giữ nội dung cũ làm lịch sử. Mọi live/provider/purchase mới cần phê duyệt riêng.

## 1. Bằng chứng và giới hạn kết luận

Lượt live **baseline trước Task 1** kéo dài **8 phút 0,688 giây** tính theo wrapper: mua 3 email, hoàn tất 1/3, thất bại 2/3; 5 profile mở/đóng xác nhận đầy đủ, tài nguyên cuối lượt bằng 0. Code không đổi trong lượt chạy (406 fingerprints khớp). Cả functional gate và independent gate đều FAIL `UNSAFE_EVENT`.

| Vấn đề | Đã chứng minh | Chưa được chứng minh |
| --- | --- | --- |
| Click Send canvas | Hai session của account-2 kẹt `canvas-send:mouse-move`; đã định vị điểm lỗi trong helper tự vẽ quỹ đạo | Vì sao Chromium/Multilogin không trả lệnh; locator.click hoặc DOM click có sửa được không |
| Canvas readiness | Account-3 có zero-height, sau đó `wait-not-inert` timeout; cuối cùng session phục hồi đạt 12/12 | Nguyên nhân renderer/layout; không được đổ hết cho chuột hoặc concurrency |
| Task list | Account-1 đăng ký xong nhưng không có snapshot; observer ghi 0 request khớp host/path; các account khác có HTTP200/valid12/errNo0 | Không có bất kỳ request mạng nào, token sai, endpoint đổi, hoặc tài khoản không đủ điều kiện |
| Độc lập | Source đã cấp scheduler riêng; một session lỗi không làm peer ngừng làm việc | 3/3 độc lập đã nghiệm thu: một account không vào editor và run có quarantine nên chưa đạt gate |

`humanClickUnlocked` **trước Task 1** làm selector → scroll → bounding box → **23–32 lệnh mouse.move** → down/up. Đây là input của trình duyệt qua protocol, không phải chuột vật lý Windows. Comment “bắt buộc quỹ đạo để tránh 8001003” là nhận định lịch sử, không phải đối chứng chứng minh cho mọi control và mọi phiên bản.

`locator.click()` cũng tạo pointer input trong trình duyệt, nhưng có actionability, native timeout/signal và không cần loop quỹ đạo của ứng dụng. Nó là **ứng viên thay thế cần test**, không phải lời hứa hết lỗi. `HTMLElement.click()`/`dispatchEvent` không tương đương chuỗi pointer/focus, nên không chọn làm fallback chung.

### Ràng buộc bắt buộc

- Giữ dirty worktree, snapshot trước sửa, không reset/stash/rollback toàn project, không stage/commit nếu chưa được yêu cầu.
- Luồng 1 đang chờ không chặn luồng 2–20; không khôi phục global input/editor lock, phase barrier hoặc round-robin nhiệm vụ.
- Giữ `AutomationRunService` sở hữu worker, Stop, account/proxy/mailbox, và cleanup. Engine không tự mua mail/mở profile.
- Giữ human-pace jitter có nghĩa: delay bấm 70–150ms, pre/post pause, nhịp gõ tối thiểu 45–130ms/ký tự và delay người dùng. **Thay quỹ đạo không đồng nghĩa bỏ nhịp gõ.**
- Giữ hit-target/visible/non-inert/enabled guards và scoped locator. Không `force:true`, JS click hoặc Enter để vượt qua control bị che/disabled.
- Native timeout, outer timeout hoặc Stop không được dẫn đến click lần hai, JS fallback, reload hay cleanup input trên session chưa xác nhận an toàn. Quarantine/đóng đúng profile như hiện tại.
- Task thành công cần `do_action` phù hợp cộng snapshot mới; final phải 12 key duy nhất status4. Không bắt buộc giả tạo 12 action receipt khi thực tế có task cha/pre-completed; cũng không suy diễn proof thiếu.
- Không tăng deadline để test xanh. Không đồng thời đổi click, typing, auth, mission order và scheduler.
- Không dùng account đã làm dở để thay thế nghiệm thu signup mới → full12. Không mua thêm mail chỉ để lặp lại lỗi đã biết.

## 2. Giữ, bỏ và chưa động tới

| Thành phần | Quyết định |
| --- | --- |
| Scheduler riêng/session, exact Stop, receipts, purchase caps | Giữ nguyên |
| Helper `humanClick`/`humanClickUnlocked` | Giữ API, rút implementation về một native locator.click |
| Quỹ đạo ngẫu nhiên, manual bbox target jitter, raw down/up cho nút DOM | Bỏ khỏi helper sau RED/GREEN và đối chứng |
| Canvas opener bằng locator focus + Tab | Giữ đợt đầu; có hậu điều kiện mở panel, không fallback chuột/Enter |
| `humanType`, auth typing và readback | Giữ đợt đầu; không đổi thành bulk fill hoặc fixed-delay typing |
| `#graphic-editor-render`, React Flow node | Vẫn dùng locator; kiểm chứng tác dụng chọn trước khi khẳng định generic click phù hợp |
| Drawing/drag đặc thù | Không có nhiệm vụ hiện tại yêu cầu; không viết helper tương lai |
| Full HTTP capture cũ | Không bật; collision account-scoped `wx` chưa sửa, không cần cho click repair |
| JavaScript DOM click | Chỉ là thử nghiệm riêng nếu một control được chứng minh cần; không route tự động/fallback |

## 3. Task 1 — click mặc định theo locator, giảm code thay vì thêm lớp

**Files:** `src/main/services/capcut/human.ts`; tests `src/main/services/capcut/__tests__/boundedInteractions.test.ts`, `pace.test.ts`, `canvasFlowTimeout.test.ts`.

**Interface:** `humanClick(page, locator, options)` và `humanType(...)` giữ nguyên. Sửa trong `humanClickUnlocked`; không thêm flag chọn kiểu click hay bảng route theo tên stage. Mọi caller dùng chung implementation sau kiểm chứng.

- [x] Viết RED test trên helper thật: đưa một Locator có click spy, còn bbox/mouse move/down/up ném nếu được gọi. Fake external Page, không mock helper:

```ts
it('clicks its locator once without a handmade pointer path', async () => {
  vi.useFakeTimers();
  const signal = new AbortController().signal;
  const forbidden = vi.fn(async () => { throw new Error('CUSTOM_POINTER_USED'); });
  const click = vi.fn(async () => {});
  const page = { mouse: { move: forbidden, down: forbidden, up: forbidden } } as unknown as Page;
  const locator = { click, boundingBox: forbidden, scrollIntoViewIfNeeded: forbidden } as unknown as Locator;
  const result = humanClick(page, locator, {
    signal, stage: 'canvas-send', ui: createDirectUiInteraction(signal, 'target')
  }).catch(error => error);
  await vi.runAllTimersAsync();
  expect(await result).toBeUndefined();
  expect(click).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledWith(expect.objectContaining({ timeout: 8000, signal }));
  expect(forbidden).not.toHaveBeenCalled();
});
```

- [x] Chạy `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/boundedInteractions.test.ts`; phải thấy RED vì code hiện tại đi vào bbox/custom mouse.
- [x] Dùng đúng helper có sẵn `pause`, `command`, `rand`; import `DomReadTimeoutError` hiện có để giữ lỗi fatal tương thích. Implementation mục tiêu:

```ts
async function humanClickUnlocked(page: Page, locator: Locator, options: HumanInteractionOptions): Promise<void> {
  void page;
  await pause(rand(180, 420), options);
  try {
    await command(() => locator.click({
      timeout: 8000, delay: rand(70, 150), signal: options.signal
    }), 'locator-click', 9000, options);
  } catch (error: unknown) {
    options.signal.throwIfAborted();
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new DomReadTimeoutError(options.stage + ':locator-click');
    }
    throw error;
  }
  await pause(rand(250, 500), options);
}
```

Giữ signature để không lan refactor. Native TimeoutError được xử lý bảo thủ bằng mã fatal hiện có; đây không phải kết luận DOM read bị treo. Log phải chỉ rõ `locator-click`, không đổi timeout thành “không thấy selector”. Native8s trước outer9s; không `timeout:0`. Không thay `command` chung cho typing.

- [x] Bổ sung test: Stop trước click; Stop trong native click nhận đúng signal; native timeout và outer pending timeout đều chỉ một lần dispatch; late resolve không gửi input nữa; peer session vẫn tiến; delay vẫn trong khoảng; ordinary strict-locator error không bị nuốt.
- [x] Chuyển test cũ “phải có >20 mouse moves” sang hành vi click một lần. Không xoá test quarantine/cancellation. Test gõ cũ vẫn giữ per-character delay và caret/readback.
- [x] Cập nhật comment trong `human.ts`/`diag.ts` nói rõ locator-first, bỏ khẳng định không có đối chứng rằng mọi control bắt buộc dùng quỹ đạo. Giữ lại guard, không xoá lịch sử proof để làm đẹp báo cáo.
- [x] Chạy focused tests rồi review task này riêng. Nếu tổng code helper không nhỏ đi đáng kể hoặc xuất hiện strategy framework, dừng mở rộng.


### Kết quả Task 1 — 2026-09-09

- Đã thay quỹ đạo thủ công bằng một native locator click; giữ pre/post pause, click delay, Stop, typing/focus, guards và scheduler riêng/session. Chỉ sửa production `human.ts` và comment `diag.ts`, cùng 3 file test. Review độc lập và re-review comment: không còn finding mở.
- RED được quan sát trước patch; GREEN focused: **54/54**. Xác minh root: full Vitest **140 file / 1.630 test PASS**, typecheck PASS, lint PASS, selector fixtures **89/89**, build PASS.
- Không che lỗi kiểm tra: lượt full suite chạy cùng build/selector gặp `rolloutBootstrapOrder.test.ts` timeout 5s (1 fail/1.629 pass). Test riêng 2/2 rồi full suite chạy lại độc lập 1.630/1.630, không tăng timeout hay sửa test bootstrap. Chưa kết luận nguyên nhân timeout chỉ từ việc rerun qua.
- Cảnh báo ngoài delta: HTTP test `CapcutHttpClient.test.ts:20` có assertion Promise chưa await; build cảnh báo renderer chunk >500kB. Chưa sửa các file này trong Task 1.
- Các regression ownership/proof/20-worker-held-peer nằm trong full suite đã chạy; source tương ứng không đổi. Đây là bằng chứng offline, **không** thay thế live3 12/12 hay đảm bảo Multilogin hết treo. Electron native harness chưa chạy ở checkpoint Task 1.
- Bước kế tiếp: Task 2, kiểm chứng caller và gỡ nhánh Enter/catch nuốt lỗi; không mua email ở bước đó.

## 4. Task 2 — kiểm chứng các caller và loại fallback che lỗi

**Files:** `src/main/services/capcut/steps.ts`, `missions/designStudio.ts`, `missions/videoStudio.ts`; tests `simpleActions.test.ts`, `canvasFlowTimeout.test.ts`, `canvasPromptActivation.test.ts`, `chatAcknowledgement.test.ts`, `uiInteractionCoverage.test.ts`; fixtures hiện có trong `tools/fixtures`.

**Thứ tự kiểm tra và hậu điều kiện:**

| Target | Locator hiện có | Bắt buộc xác nhận |
| --- | --- | --- |
| Canvas Send | expanded Canvas prompt panel / Send message | prompt readback đúng, nút enabled/hittable, UI ack và proof đúng canvas task |
| Canvas Upload | Canvas tools / Upload image | đúng filechooser/input, ảnh vào đúng canvas |
| Editor area | `#graphic-editor-render` | chọn được ảnh và opener đúng xuất hiện; không mặc định tâm container là đúng ảnh |
| Inspiration chip/Send/Minimize | scoped chip/panel/minimize locator | đúng panel, không click sang chat, đúng proof/task |
| Video mode/Send | `#studio-chat` + option label Image | mode thật là Image, editor đúng, sinh node mới |
| Video node/export | `.react-flow__node[data-id]`, toolbar export testid | đúng node được chọn, toolbar sẵn sàng, export đúng task |

- [ ] Chạy real flow helper qua fixture/synthetic state, không chỉ test “selector tồn tại”. Với canvas-ready đã chọn sẵn: không reselect area. Với area chưa chọn: click phải dẫn tới opener, không kéo lê/drawing.
- [ ] Viết RED cho `steps.clickSend`: nút vẫn disabled phải trả `false` hoặc lỗi rõ, **không** `keyboard.press('Enter')` và `return true` như hiện tại. Sửa đúng nhánh đó; proof timeout không được là cách duy nhất phát hiện giả-success.
- [ ] Viết RED cho `videoStudio.ensureNodeToolbar` khi click ném `DomReadTimeoutError`: không retry node, không đọc toolbar/làm input tiếp. Sửa catch đang nuốt tất cả; tương tự hover trong `findExportButton` phải truyền Stop/fatal. Chỉ chỉnh các catch trực tiếp nằm trên đường đã đổi click, không bulk rewrite mọi catch trong repo.
- [ ] Nhánh tooltip `findExportButton` hiện gọi raw `hover({ force: true })` không deadline riêng. Đổi đúng lệnh hover trong lease hiện có thành `boundedDomRead(() => btn.hover({ timeout: 8000, signal: env.signal }), 'creator:export-hover', 9000, env.signal)`, bỏ `force`. Normalize native `TimeoutError` thành `DomReadTimeoutError('creator:export-hover')` như click trước khi xử lý catch. RED riêng cho native timeout, outer pending timeout và Stop: không đọc tooltip, không hover nút kế tiếp, không input tiếp sau late settlement. Stop hiện đã được scheduler xử lý; không phá hành vi đó.

```ts
catch (error: unknown) {
  env.signal.throwIfAborted();
  if (isDomReadTimeout(error)) throw error;
  // Chỉ giữ nhánh lỗi thường đã có và đã được test; không fallback input mới.
}
```

- [ ] Không đổi auth/signup đang dùng locator/native typing. Không đổi `missionRunner` proof rules, task ordering, provider budgets hoặc per-session scheduling.
- [ ] Nếu control đặc thù không làm được bằng native locator click, ghi lại đúng control/precondition/error; **không** tự thêm JS→keyboard→pointer fallback chain. Có thể đề xuất thử riêng DOM click cho control đó sau khi có bằng chứng và người dùng duyệt; success phải qua same proof gate.

## 5. Task 3 — phân loại readiness đúng, không tăng timeout để giấu lỗi

**Files:** `src/main/services/capcut/diag.ts`, `missions/designStudio.ts`; tests `boundedEvaluation.test.ts`, `canvasFlowTimeout.test.ts`, `canvasPromptReady.test.ts`.

- [ ] Giữ phân biệt: renderer trả lời nhưng canvas height=0 hoặc panel inert là **not-ready**; evaluate không settle trong deadline là **transport/DOM command timeout**. Không biến timeout thành `false` rồi polling tiếp.
- [ ] Đối chiếu `waitNotInert` với `assertNotInert`: hiện hàm chờ chỉ xét thuộc tính của node, trong khi guard xét ancestors. Viết RED fixture child không inert nhưng ancestor inert/aria-hidden; không cho gõ. Sửa predicate trong hàm có sẵn:

```ts
const nodes = document.querySelectorAll(sel);
return nodes.length === 1 && !nodes[0].closest('[inert], [aria-hidden="true"]');
```

- [ ] Giữ 40s canvas-ready, 15s panel-ready và các command deadline trong đợt này. Ở lỗi responsive zero-height, lưu geometry tối thiểu (canvas count/width/height, wrapper rect, visibility) trong dump/diagnostic hiện có; không áp CSS ép chiều cao hoặc dispatch resize giả nếu chưa đo nguyên nhân.
- [ ] Test zero-height→ready; inert ancestor→ready; duplicate panel; late evaluate sau Stop; timeout cấm fallback. Native click thành công nhưng panel chưa mở phải vẫn thất bại đúng loại.
- [ ] Chưa lựa chọn bản sửa nguyên nhân renderer. Nếu zero-height tái hiện sau selector-first, đó là một investigation riêng có snapshot trước/sau, không suy luận “chuột gây mọi lỗi”.

## 6. Task 4 — tìm nguyên nhân task_list theo nhánh bằng chứng

**Files cần đọc/test:** `taskApi.ts`, `runTasks.ts`, `login.ts`, `signup.ts`, `overlays.ts`, `CapcutEngineService.ts`; tests `taskListDiagnostics.test.ts`, `bootstrap.test.ts`, `overlayGuard.test.ts`. Chỉ sửa file tương ứng sau khi nhánh lỗi được chứng minh.

- [ ] Dùng observer `CAPCUT_DIAG_TASK_LIST` hiện có; xác nhận nó được cài trước auth và chưa chạm cap trước khi kết luận “0 request”. Thêm dấu lifecycle/count allowlisted nếu cần: observer attached/disposed, matchedRequests, omitted count; không thêm general capture engine.
- [ ] Kiểm tra auth readiness riêng: `isLoggedIn` hiện có nhánh dựa vào URL app. Không gọi URL đó là bằng chứng server xác thực; đối chiếu trạng thái hiển thị và response auth được phép quan sát trong lần chẩn đoán sau, không ghi password/token/raw body.
- [ ] Khi không phát hiện task request, thu trạng thái task entry/overlay/route trước click và sau click bằng đọc bounded: count, visible, enabled, hit target, app route category, page close/crash. Xem host/path allowlist có bỏ sót traffic hợp lệ không; không tự mở rộng tới mọi host/raw URL.
- [ ] Quyết định bản sửa theo bằng chứng, không chọn sẵn:

| Bằng chứng mới | Hướng sửa được phép đề xuất |
| --- | --- |
| Observer bỏ sót route đã xác nhận | Chỉnh filter hẹp, regression có route thật đã redacted |
| Click bị overlay/selector sai | Chỉnh đúng overlay/locator, fixture chứng minh trước/sau |
| Response HTTP/business từ chối | Phân loại lỗi/điều kiện provider; không retry auth liên tục hay đổi identity để né |
| Body nhận đủ nhưng parse sai | Sửa parser với fixture tối thiểu, không giả task còn thiếu |
| Renderer chết/không phát request sau action | Dừng ở bằng chứng đó; điều tra renderer/route, không tăng bootstrap và click spam |

- [ ] Chỉ sau khi có một nhánh cụ thể mới viết regression RED và patch nhỏ. Không cài sớm TaskStore rồi dùng snapshot pre-auth làm final để né bootstrap. Không đánh dấu task_list bug fixed chỉ vì một batch may mắn qua.

## 7. Task 5 — nghiệm thu đúng thứ tự, không tiêu thêm mail để đoán

**Dùng lại:** `scripts/verify-independent-profiles.mjs`, `tools/offlineFixture.ts`, official runner/options/verifier và test đang có. Không tạo thêm bộ harness trùng chức năng.

- [ ] Local fixture RED/GREEN: button bị che/disabled/duplicate; input/contenteditable; canvas surface selection; filechooser; popup/tab; nested inert; Stop/late response; 20 worker giữ1 cho19xong. Fixture dựng tay chỉ kiểm code, không giả là CapCut server.
- [ ] Sau phê duyệt riêng, probe **3 Multilogin profile thật không tài khoản** bằng input targets local. So sánh helper cũ và candidate trên các profile/control tách biệt, không thử candidate trong session đã timeout. Kiểm tra single locator click có cùng hậu điều kiện, không hang/cross-input; log chỉ lộ alias/method/timing/outcome. Browser vendor gate này chưa được thay thế bởi kết quả Chrome thường.
- [ ] Nếu vendor control gate thất bại, **dừng trước mua mail**. Nếu qua, xin duyệt đúng một fresh3 batch: 3 email mới, 3 worker target-mode, không tài khoản cũ, không mua thay thế.
- [ ] Nghiệm thu fresh3 cần đồng thời: 3/3 signup/OTP, 3 final12/12 receipts, proof giữ nguyên; `--require-independent` PASS; không quarantine/fatal/cleanup failure; all resources0; source fingerprints không đổi trong live. Ghi transient errors kể cả sau đó hồi phục.
- [ ] Không so thời gian batch1/3 hoặc2/3 thất bại với batch3/3 để tuyên bố tăng tốc. Chỉ có 3/3 mới so throughput; chưa hứa4phút hoặc10luồng trong6–10phút.
- [ ] Chỉ sau fresh3 ổn mới xin duyệt test10, độc lập về cả correctness và thời gian. 20 worker hiện chỉ là offline stress; không thêm mua/profile count tự động.

Final offline commands trên source đã review:

```powershell
npm --userconfig=NUL run rebuild:node
npx --userconfig=NUL vitest run
npm --userconfig=NUL run typecheck
npm --userconfig=NUL run lint
npm --userconfig=NUL run selectors
npm --userconfig=NUL run build
npm --userconfig=NUL run test:electron
npm --userconfig=NUL run rebuild:node
```

Không chạy Node/Electron rebuild đồng thời với test SQLite; trước live verify ABI trong Electron. Mỗi native/browser test phải lưu outcome và xác nhận exact cleanup.

## 8. Cách triển khai và điểm dừng

- Agent A: Task1 helper+unit tests. Root ghép và reviewer độc lập kiểm trước Task2; không cho hai agent sửa `human.ts` cùng lúc.
- Agent B: chuẩn bị fixture/caller inventory Task2/3 và phân tích Task4 read-only song song; chỉ thực hiện patch khi ranh giới đã chốt.
- Agent C: review source diff so với bản sao trước sửa và kiểm chứng test, không viết thêm strategy/công cụ ngoài plan.
- Không gộp commit/diff độc lập của người dùng. Khi một thay đổi làm regression, đảo **chính delta đó** từ bản sao, không reset project; việc xoá dữ liệu/account hoặc commit phải được duyệt.
- Giữ báo cáo bằng chứng ngắn, không thêm hàng loạt docs. Plan này là nguồn sửa hiện hành; plan scheduler cũ giữ làm lịch sử/ràng buộc độc lập.

**Định nghĩa xong:** không chỉ test xanh. Click path đơn giản hơn, không custom curve cho control DOM; peer vẫn độc lập; lỗi task_list được xác định/sửa hoặc báo còn blocker; vendor probe và fresh3 đều có bằng chứng đạt. Nếu chưa có live approval hoặc chưa xác định root cause, bàn giao phần đã làm với giới hạn rõ ràng, không gọi project đã hết lỗi.

Context7 hiện không có công cụ gọi trong phiên này; cú pháp locator click/signal/delay/timeout đã đối chiếu declarations của Playwright 1.62.1 đang cài. Khi thực hiện, dùng Context7 nếu có; declarations hoặc fixture Chrome không thay thế cổng kiểm chứng Multilogin.

### Checklist trước khi bắt đầu code

- [x] Định vị điểm lỗi live và tách khỏi các giả thuyết chưa chứng minh.
- [x] Chọn phương án nhỏ nhất: native locator click trong helper hiện có, không blanket JS.
- [x] Giữ typing/Stop/proof/scheduler và chỉ đổi một loại hành vi mỗi đợt.
- [x] Có regression mẫu, file ownership, kiểm chứng local/vendor/fresh-account riêng.
- [x] Người dùng duyệt bắt đầu triển khai bước kế tiếp; Task 1 đã được thực hiện.
- [ ] Người dùng duyệt riêng mọi profile/vendor/purchase phát sinh.
