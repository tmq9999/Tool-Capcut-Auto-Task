/**
 * =============================================================================
 * VIDEO STUDIO — 3 NHIỆM VỤ
 * =============================================================================
 * Lỗi `studio_editor_missing` đêm 2026-09-01 KHÔNG phải vì selector ô chat sai.
 * Nguyên nhân thật: chế độ mặc định `Auto` là **short-drama**, và ở chế độ đó
 * `.inputEditor-*` chỉ là `div` thường — cả trang không có element
 * `contenteditable` nào, `.skeletonBody` là trạng thái landing bình thường chứ
 * không phải lỗi tải.
 *
 * Chỉ khi chọn chế độ **Image** thì editor thật mới mount, và placeholder đổi
 * thành "Enter ideas to generate an image".
 *
 * Bản cũ lọc option bằng `/^Image$/i` trên `.lv-select-option`, nhưng text đầy
 * đủ của `<li>` dài hơn chữ "Image" nên khớp trượt → nó bấm Escape → chế độ vẫn
 * short-drama → không bao giờ có editor.
 *
 * Trình tự đo được (lượt làm tay, phút 07:41→08:51):
 *   Got it → triggerLabel "Auto" → optionLabel "Image" → gõ prompt → Send
 *   → Continue → Confirm → (37s) generate → chọn node → nút export trong
 *   `.react-flow__node-toolbar`
 *
 * BỔ SUNG 2026-09-02: giữa "Send" và "generate" CapCut có thể chen card
 * **"Use advanced features with Pro"** (Skip / Continue). Ở card đó "Continue"
 * MỞ BẢNG GIÁ chứ không generate — xem `confirmCredits`.
 * =============================================================================
 */

import type { Locator, Page } from 'playwright-core';

import { assertHittable, dump, mustSee, StepError } from '../diag';
import { clickIfVisible, foregroundPage, humanClick, isDisabled, pick, rand, waitEnabled } from '../human';
import type { MissionGroup } from '../missionRunner';
import { closeBlockingPricingModal } from '../overlays';
import { fillEditor } from '../steps';
import type { CapcutMissionEnv } from '../types';
import { URLS } from '../urls';

const STUDIO = '#studio-chat';
const IMAGE_PLACEHOLDER = '[data-placeholder="Enter ideas to generate an image"]';

const ANIMAL_PROMPTS = [
  'tạo ảnh 1 con heo màu hồng',
  'tạo ảnh 1 con mèo màu xám',
  'tạo ảnh 1 con chó màu đen',
] as const;

async function openStudio(env: CapcutMissionEnv): Promise<Page> {
  const existing = env.context.pages().find((p) => p.url().includes('ai-creator/studio'));
  const sp = existing ?? (await env.context.newPage());
  if (!sp.url().includes('ai-creator/studio')) {
    await sp.goto(URLS.videoStudio, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await foregroundPage(sp, { signal: env.signal, stage: 'creator:studio-focus', ui: env.ui }, async () => {
    await sp.bringToFront();
  });
  await sp.waitForTimeout(rand(7000, 10000));
  return sp;
}

/** CỔNG BẮT BUỘC: không qua bước này thì không có ô nhập nào tồn tại. */
async function selectImageMode(sp: Page, env: CapcutMissionEnv): Promise<void> {
  const trigger = await mustSee(sp, sp.locator(`${STUDIO} [class*="triggerLabel"]`), 'o chon che do tao');
  await humanClick(sp, trigger, { signal: env.signal, stage: 'creator:mode-trigger', ui: env.ui, log: env.log });
  await sp.waitForTimeout(rand(900, 1500));

  // Lọc trên chính optionLabel — element có text ĐÚNG BẰNG "Image".
  const option = sp.locator('li.lv-select-option [class*="optionLabel"]').filter({ hasText: /^Image$/ });
  const found = await mustSee(sp, option, 'option Image trong dropdown che do tao', 8000);
  await humanClick(sp, found, { signal: env.signal, stage: 'creator:mode-select-image', ui: env.ui, log: env.log });
  await sp.waitForTimeout(rand(1200, 2000));
  env.log('Đã chọn chế độ tạo: Image');
}

async function waitImageEditor(sp: Page): Promise<void> {
  const ok = await sp
    .locator(IMAGE_PLACEHOLDER)
    .first()
    .waitFor({ state: 'attached', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    throw new StepError(
      'Video Studio vẫn ở chế độ short-drama — không có ô nhập ảnh. Chế độ Image chưa được chọn.',
      await dump(sp, 'studio_mode_not_image')
    );
  }
}

/** Card upsell của CapCut: "Continue" ở đây KHÔNG phải xác nhận credits. */
const PRO_UPSELL = 'Use advanced features with Pro';

/**
 * Bảng giá "Choose your plan" phủ kín trang. Nó chỉ mở khi có ai bấm Continue
 * trên card upsell Pro — chính bản cũ làm thế. Mở rồi thì mọi bước sau vô nghĩa:
 * lượt 2026-09-02 16:45 chờ node mới 200 giây trong khi bảng giá đang che, rồi
 * lượt thử 2 không mở được dropdown chế độ tạo (`missing_option_Image...`).
 *
 * Thân hàm đã chuyển sang `capcut/overlays.ts` để luồng Design Studio dùng chung
 * — 04/09/2026 nó thiếu đúng bước này và báo `canvas_send_no_effect`.
 */
async function closeSubscriptionModal(sp: Page, env: CapcutMissionEnv): Promise<void> {
  await closeBlockingPricingModal(sp, env.log, env.ui, env.signal);
}

/**
 * Hai card KHÁC NHAU chen vào giữa "gửi prompt" và "có ảnh", đừng trộn làm một:
 *
 *   1. Card tiêu credits — "Continue" rồi "Confirm". Bấm là generate.
 *   2. Card upsell Pro — "Use advanced features with Pro" với "Skip" và
 *      "Continue". Ở card này "Continue" MỞ BẢNG GIÁ, không generate gì.
 *
 * Bản cũ chỉ tìm chữ "Continue" trong `#studio-chat` nên bốc trúng card upsell.
 * Đo được trong `.debug/014_no_new_node.html` (2026-09-02 17:10): sau 200 giây
 * chờ, card upsell vẫn nguyên và DOM đã có `subscriptionModal-title` = "Choose
 * your plan". Đó là toàn bộ lý do 3 nhiệm vụ Video Studio trượt trên
 * hypxfwhw60369, lmrhrfpy17976, lnfxsjyh73835, evxigvuh70767.
 *
 * Hàm được gọi lặp trong vòng chờ node mới, nên xử lý MỘT card mỗi lượt là đủ.
 */
async function confirmCredits(sp: Page, env: CapcutMissionEnv): Promise<void> {
  env.captureStage?.('creator:confirm');
  const proCard = sp.locator('[class*="strongContent"]').filter({ hasText: PRO_UPSELL }).first();
  if (await proCard.isVisible({ timeout: 500 }).catch(() => false)) {
    const skip = proCard.locator('button').filter({ hasText: /^Skip$/ });
    if (await clickIfVisible(sp, skip, 3000, { signal: env.signal, stage: 'creator:pro-skip', ui: env.ui })) {
      env.log(`Đã bấm Skip ở card "${PRO_UPSELL}" (Continue ở card này chỉ mở bảng giá)`);
      await sp.waitForTimeout(rand(1200, 2000));
      return;
    }
  }

  await closeSubscriptionModal(sp, env);

  // Tới đây card upsell chắc chắn không hiện (đã return ở trên), nên tìm chữ
  // "Continue" trong `#studio-chat` là an toàn trở lại.
  for (const label of ['Continue', 'Confirm']) {
    const btn = sp.locator(`${STUDIO} button.lv-btn`).filter({ hasText: new RegExp(`^${label}$`) });
    if (await clickIfVisible(sp, btn, 6000, { signal: env.signal, stage: 'creator:confirm-' + label.toLowerCase(), ui: env.ui })) {
      env.log(`Đã bấm ${label} trong card tiêu credits`);
      await sp.waitForTimeout(rand(1500, 2500));
    }
  }
}

/**
 * Tìm nút Export trên node toolbar bằng TOOLTIP, không bằng class.
 *
 * Đo được trên node ảnh thật (2026-09-02 04:45): node toolbar có 6 nút, và HAI
 * nút cùng có `toolbar-download-menu-trigger-Ut9BTW` trong chuỗi ancestor:
 *   [3] "Save to library"  ← `.first()` bốc trúng cái này, mở panel lưu thư viện
 *   [4] "Export"           ← cái thật sự cần
 * Đây đúng là lớp lỗi đã làm hỏng "Edit on canvas": selector mơ hồ + `.first()`.
 *
 * Nút thứ [3] chỉ xuất hiện khi guide "Save once, reuse anytime" đang bật, nên
 * lượt 04:20 không gặp — selector theo class ăn may lần đó.
 *
 * Tooltip thì không phụ thuộc hash: History / Duplicate / Save to library /
 * Export. Chỉ "Export" khớp `/export/i`.
 *
 * SỐ NÚT LÀ TÍN HIỆU TRẠNG THÁI — đo trên 14 lượt của 2 lần chạy độc lập
 * (batch 15:23 và lượt nghiệm thu 17:56 ngày 2026-09-02), tương quan tuyệt đối:
 *
 *   "nút thứ 3/5"  → do_action err_no=0        6/6 lượt
 *   "nút thứ 2/4"  → KHÔNG bao giờ có do_action 8/8 lượt
 *
 * Trạng thái 4 nút là lúc ảnh CHƯA vẽ xong: nút khớp tooltip khi đó là
 * `lv-btn-disabled` + `pointer-events: none`, click rơi vào wrapper
 * `toolbar-image-icon-*`. Vì vậy `waitNodeRendered` phải chạy TRƯỚC hàm này.
 */
async function nodeIds(sp: Page): Promise<string[]> {
  return sp
    .evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__node'))
        .map((n) => n.getAttribute('data-id') ?? '')
        .filter(Boolean)
    )
    .catch(() => [] as string[]);
}

/**
 * Bảo đảm node toolbar ĐÃ mọc nút, chọn lại node nếu chưa.
 *
 * Toolbar của React Flow chỉ render cho node ĐANG được chọn. Lượt batch
 * 04/09/2026 (`francisczeno459`) báo `Không nhận ra nút Export trong 0 nút của
 * node toolbar` NGAY SAU khi `Complete a generation` đã có `do_action err_no=0`
 * — ảnh có rồi mà toolbar trống, nên node đã mất selection. Nghi phạm gần nhất:
 * cú `clickIfVisible("Got it")` dẹp guide ngay trước đó click ra ngoài node.
 *
 * Không đoán tiếp: chọn lại node rồi ĐỌC LẠI, và chỉ bỏ cuộc sau `attempts` lần.
 * Lỗi ném ra nói "toolbar không mọc nút nào" chứ không phải "không nhận ra
 * Export" — hai nguyên nhân khác nhau cần hai cách sửa khác nhau.
 *
 * @returns số nút trên toolbar khi đã sẵn sàng.
 */
export async function ensureNodeToolbar(
  sp: Page,
  nodeId: string,
  env: CapcutMissionEnv,
  attempts = 3
): Promise<number> {
  const toolbar = sp.locator('.react-flow__node-toolbar button');

  for (let i = 1; i <= attempts; i += 1) {
    const n = await toolbar.count().catch(() => 0);
    if (n > 0) return n;

    env.log(`Node toolbar chưa có nút — chọn lại node (lần ${i}/${attempts})`);
    await humanClick(sp, sp.locator(`.react-flow__node[data-id="${nodeId}"]`).first(), { signal: env.signal, stage: 'creator:select-node', ui: env.ui, log: env.log }).catch(() => {});
    await sp.waitForTimeout(rand(1200, 2000));
  }

  const last = await toolbar.count().catch(() => 0);
  if (last > 0) return last;

  throw new StepError(
    `Node toolbar không mọc nút nào sau ${attempts} lần chọn lại node ${nodeId}`,
    await dump(sp, 'node_toolbar_empty')
  );
}

export async function findExportButton(sp: Page, env: CapcutMissionEnv): Promise<Locator> {
  /**
   * Mỏ neo ĐẦU TIÊN: `data-testid` của chính CapCut, không hash và không cần
   * hover. Đo 04/09/2026 05:55 — node toolbar 5 nút, tooltip không nút nào khớp
   * `/export/i` nên đường dưới ném, mà DOM lại có sẵn
   * `data-testid="studio-node-export-trigger"` (fixture
   * `tools/fixtures/dom-node-toolbar-export.html`).
   *
   * Bắt buộc giới hạn trong `.react-flow__node-toolbar`: cùng trang còn
   * `data-testid="global-export-trigger"` là export cấp TRANG, bấm vào đó là
   * sai đích y như cái bẫy `Save to library` ở dưới.
   */
  const byTestId = sp.locator(
    '.react-flow__node-toolbar [data-testid="studio-node-export-trigger"]'
  );
  if ((await byTestId.count().catch(() => 0)) === 1) {
    env.log('Nút Export nhận bằng data-testid=studio-node-export-trigger');
    return byTestId.first();
  }

  const btns = sp.locator('.react-flow__node-toolbar button');
  const n = await btns.count().catch(() => 0);

  for (let i = 0; i < n; i++) {
    const btn = btns.nth(i);
    await foregroundPage(sp, { signal: env.signal, stage: 'creator:export-hover', ui: env.ui }, () =>
      btn.hover({ force: true })
    ).catch(() => {});
    await sp.waitForTimeout(600);
    const tip = await sp
      .evaluate(() =>
        Array.from(document.querySelectorAll('[class*="tooltip-content"], .lv-tooltip-content'))
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => (e as HTMLElement).innerText.trim())
          .join(' ')
      )
      .catch(() => '');
    if (/export/i.test(tip)) {
      env.log(`Nút Export là nút thứ ${i}/${n} trên node toolbar`);
      return btn;
    }
  }

  throw new StepError(
    `Không nhận ra nút Export trong ${n} nút của node toolbar ` +
      '(không có data-testid=studio-node-export-trigger, và đã soi tooltip từng nút)',
    await dump(sp, 'export_btn_unidentified')
  );
}

/**
 * Gửi prompt tạo ảnh và trả về `data-id` của NODE MỚI.
 *
 * Tách riêng vì có HAI đường cần nó: lượt còn thiếu send_msg/generate_done, và
 * lượt chỉ còn thiếu export nhưng canvas trống (xem `act`).
 */
async function generateImage(sp: Page, env: CapcutMissionEnv): Promise<string> {
  env.captureStage?.('creator:generate');
  await selectImageMode(sp, env);
  await waitImageEditor(sp);

  const before = await nodeIds(sp);

  const editor = await mustSee(sp, sp.locator(IMAGE_PLACEHOLDER), 'o nhap anh cua Video Studio');
  await fillEditor(
    sp,
    editor,
    pick(ANIMAL_PROMPTS),
    env.pace && { minMs: env.pace.typeMinMs, maxMs: env.pace.typeMaxMs },
    { signal: env.signal, stage: 'creator:fill-editor', ui: env.ui, log: env.log }
  );
  await sp.waitForTimeout(rand(900, 1600));

  const send = await mustSee(sp, sp.locator(`${STUDIO} [class*="sendButton"]`), 'nut gui cua Video Studio');
  await waitEnabled(send, 15000);
  await humanClick(sp, send, { signal: env.signal, stage: 'creator:send-prompt', ui: env.ui, log: env.log });
  env.log('Đã gửi prompt tạo ảnh');

  await confirmCredits(sp, env);

  // Chờ NODE MỚI. Bằng chứng hoàn thành vẫn là do_action; đây chỉ để có node
  // mà click, và để không bốc trúng asset có sẵn của template.
  const deadline = Date.now() + 200000;
  let target = '';
  while (Date.now() < deadline && !target) {
    await sp.waitForTimeout(3000);
    await confirmCredits(sp, env);
    target = (await nodeIds(sp)).find((id) => !before.includes(id)) ?? '';
  }
  if (!target) {
    // Ghi lại CHÍNH XÁC ai đang chặn: hai thủ phạm đã đo được là card upsell
    // Pro và bảng giá "Choose your plan".
    const stuck = await sp
      .evaluate(() => ({
        upsell: Array.from(document.querySelectorAll('[class*="strongContent"]')).some((e) =>
          (e.textContent ?? '').includes('Use advanced features with Pro')
        ),
        pricing: !!document.querySelector('[class*="subscriptionModal"]'),
      }))
      .catch(() => ({ upsell: false, pricing: false }));
    throw new StepError(
      'Không thấy node ảnh mới sau khi gửi prompt' +
        (stuck.upsell ? ' — card upsell Pro vẫn đang chặn' : '') +
        (stuck.pricing ? ' — bảng giá Pro đang mở' : ''),
      await dump(sp, 'no_new_node')
    );
  }
  env.log(`Node ảnh mới: ${target}`);
  return target;
}

/**
 * Chờ ảnh của node VẼ XONG trước khi chạm vào node toolbar.
 *
 * Node xuất hiện ngay lúc CapCut bắt đầu tạo: card mới chỉ có
 * `cardUploadingSkeleton-*` và `progressText-*` ("Creating 93%"). Ở trạng thái
 * đó mọi nút icon trên toolbar là `lv-btn-disabled` kèm `pointer-events: none`,
 * nên hit-test rơi xuống wrapper `toolbar-image-icon-*` (`cursor: not-allowed`)
 * và click KHÔNG tới nút nào.
 *
 * Đo được trên ehzqrntq03637 lúc 2026-09-02 18:08: `assertHittable` báo đúng
 * `span.toolbar-image-icon-O5Mqb1` đang che, và dump cho thấy card ghi
 * "Creating 93%". Bản cũ chỉ chờ `waitEnabled(..., 60000)` rồi BỎ kết quả trả
 * về, nên click mù và chờ `do_action` 240 giây vô ích.
 */
async function waitNodeRendered(sp: Page, nodeId: string, timeoutMs = 240000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const state = await sp
      .evaluate((id: string) => {
        const node = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        if (!node) return { busy: true, progress: '(không thấy node)' };
        const busyEl = node.querySelector('[class*="progressText"], [class*="UploadingSkeleton"]');
        return { busy: !!busyEl, progress: (busyEl?.textContent ?? '').trim() };
      }, nodeId)
      .catch(() => ({ busy: true, progress: '(không đọc được)' }));
    if (!state.busy) return;
    last = state.progress;
    await sp.waitForTimeout(2000);
  }
  throw new StepError(
    `Ảnh của node ${nodeId} chưa vẽ xong sau ${Math.round(timeoutMs / 1000)}s (${last})`,
    await dump(sp, 'node_still_rendering')
  );
}

export const videoStudioGroup: MissionGroup = {
  id: 'video-studio',
  name: 'Video Studio (Chat + Generate + Export)',
  workspace: 'editor',
  keys: [
    'capcut_web_video_studio_send_msg',
    'capcut_web_video_studio_generate_done',
    'capcut_web_video_studio_export',
  ],
  // Đo được: send→generate 37s, generate→export 11s. 240s là dư dả.
  proofTimeoutMs: 240000,
  async act(env: CapcutMissionEnv, need: Set<string>): Promise<void> {
    env.captureStage?.('creator:open');
    const sp = await openStudio(env);

    // Onboarding của credit task che thanh công cụ; có thể không xuất hiện.
    await clickIfVisible(sp, sp.locator('button.lv-btn-primary').filter({ hasText: /^Got it$/ }), 5000, { signal: env.signal, stage: 'creator:got-it', ui: env.ui });

    // Chỉ generate khi THẬT SỰ còn thiếu. Lượt 2026-09-02 04:20 chạy lại cả luồng
    // dù chỉ thiếu export, tốn thêm một lần generate ảnh và để lại hai
    // do_action err_no=8001001 (CapCut từ chối vì đã xong hôm nay).
    const mustGenerate =
      need.has('capcut_web_video_studio_send_msg') || need.has('capcut_web_video_studio_generate_done');

    let target = '';

    if (mustGenerate) {
      target = await generateImage(sp, env);
    }

    if (!need.has('capcut_web_video_studio_export')) return;

    if (!target) {
      const ids = await nodeIds(sp);
      if (ids.length > 0) {
        target = ids[ids.length - 1];
        env.log(`Dùng node ảnh có sẵn: ${target}`);
      } else {
        /**
         * Canvas TRỐNG dù nhiệm vụ generate đã xong hôm qua/lượt trước.
         *
         * `/ai-creator/studio?enter_from=credit_task` mở một draft MỚI, ảnh của
         * lượt trước không nằm trên canvas này. Bản cũ ném luôn
         * `no_node_to_export`, nên account chỉ còn thiếu export thì KHÔNG BAO GIỜ
         * xong được — đo trên cfyhduzf51878 và ehzqrntq03637 (cả batch 15:23 lẫn
         * lượt nghiệm thu 17:56 đều dừng ở đúng chỗ này).
         *
         * Muốn export thì phải có ảnh. Tự tạo một ảnh mới, và chỉ khi thật sự
         * không có node nào — nên không tốn credits ở lượt đã có ảnh sẵn.
         * do_action của send_msg/generate_done lúc này sẽ bị CapCut trả
         * err_no=8001001 (đã xong hôm nay) — vô hại, runner không cần chúng.
         */
        env.log('Canvas trống (studio mở draft mới) → tạo một ảnh mới để có gì mà export');
        target = await generateImage(sp, env);
      }
    }

    // Toolbar chỉ dùng được khi ảnh đã vẽ xong — xem `waitNodeRendered`.
    await waitNodeRendered(sp, target);
    env.captureStage?.('creator:export');

    await humanClick(sp, sp.locator(`.react-flow__node[data-id="${target}"]`).first(), { signal: env.signal, stage: 'creator:select-export-node', ui: env.ui, log: env.log });
    await sp.waitForTimeout(rand(1500, 2500));

    // Dep guide "Save once, reuse anytime" — chinh no lam moc them nut
    // "Save to library" vao node toolbar va gay nhap nhang selector.
    await clickIfVisible(sp, sp.locator('button').filter({ hasText: /^Got it$/ }), 3000, { signal: env.signal, stage: 'creator:guide-got-it', ui: env.ui });

    // Dẹp guide xong có thể làm node mất selection ⇒ toolbar biến mất. Đọc lại
    // và chọn lại node nếu cần, thay vì để `findExportButton` báo "0 nút".
    await ensureNodeToolbar(sp, target, env);

    const exportBtn = await findExportButton(sp, env);
    // Nút bị disabled trong lúc CapCut còn đang xử lý ảnh -> phải chờ, và PHẢI
    // xem kết quả chờ. Bản cũ bỏ giá trị trả về nên vẫn click nút disabled.
    if ((await isDisabled(exportBtn)) && !(await waitEnabled(exportBtn, 90000))) {
      throw new StepError(
        'Nút export trên node toolbar vẫn disabled sau 90s',
        await dump(sp, 'export_btn_disabled')
      );
    }
    // `findExportButton` hover từng nút để đọc tooltip, và tooltip hiện SÁT nút.
    // Lượt 2026-09-02 17:5x in "Đã bấm export" rồi chờ do_action 240 giây vô
    // ích — đúng dấu hiệu click rơi vào element khác. Kiểm hit-target để lần sau
    // biết CHÍNH XÁC ai che, thay vì im lặng.
    await assertHittable(sp, exportBtn, 'nut export tren node toolbar');
    // Ghi nhận có file nào thật sự được tải hay không — bằng chứng rẻ nhất để
    // phân biệt "click không ăn" với "tải xong mà CapCut không ghi nhận".
    let downloaded = '';
    sp.once('download', (d) => {
      downloaded = d.suggestedFilename();
    });
    await humanClick(sp, exportBtn, { signal: env.signal, stage: 'creator:click-export', ui: env.ui, log: env.log });
    env.log('Đã bấm export trên node toolbar');

    // Nút này là menu trigger: có thể bung menu chọn định dạng. Lượt làm tay chỉ
    // cần 1 click là do_action bắn, nên bước chọn menu là tuỳ chọn.
    //
    // ĐO ĐƯỢC 2026-09-02 18:4x (ehzqrntq03637, lượt xong 10/10): `do_action`
    // err_no=0 về NGAY từ cú click, với `menus=0` và KHÔNG có event `download`
    // nào. Nên "không menu, không file" là đường thành công bình thường — đừng
    // coi nó là lỗi, và đừng ghi dump ở đây (mỗi dump ~600KB cho mỗi lượt xong).
    const menuItem = sp
      .locator('[class*="menu"] [class*="item"], .lv-dropdown-menu-item')
      .filter({ hasText: /png|jpg|jpeg|download|tải/i })
      .first();
    if (await clickIfVisible(sp, menuItem, 4000, { signal: env.signal, stage: 'creator:export-menu', ui: env.ui })) {
      env.log('Đã chọn định dạng trong menu download');
    }
    await sp.waitForTimeout(rand(2000, 3000));
    if (downloaded) env.log(`Đã tải file: ${downloaded}`);
    await sp.waitForTimeout(rand(2000, 3000));

    await foregroundPage(env.page, { signal: env.signal, stage: 'creator:restore-focus', ui: env.ui }, async () => {
      await env.page.bringToFront().catch(() => {});
    }).catch(() => {});
  },
};
