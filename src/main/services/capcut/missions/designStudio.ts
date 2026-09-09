/**
 * =============================================================================
 * DESIGN STUDIO — 4 NHIỆM VỤ TRONG MỘT PHIÊN
 * =============================================================================
 * Recipe lấy đúng từ `clicks.log` phút 06:25→07:04 của lượt làm tay 12/12.
 *
 * Bốn điểm khác bản cũ, mỗi điểm sửa một lỗi đã đo được:
 *
 *   1. Chỉ click canvas để CHỌN ảnh khi prompt chưa sẵn sàng. Panel neo vào vật thể đang chọn;
 *      không chọn gì thì nó nằm ở @0,0 và bị các element khác che.
 *   2. CHỜ vùng expanded thoát `inert`. Bản cũ gõ thẳng vào editor inert nên
 *      chữ không vào đâu cả, rồi vẫn in "Đã nhập prompt".
 *   3. Mọi locator scope trong `[aria-label="Canvas prompt panel"]`. Bản cũ dùng
 *      `.first()` trên selector gộp nên bấm sang nút Send của KHUNG CHAT —
 *      đó là lý do nhiệm vụ chat được tính hai lần mà canvas không lần nào.
 *   4. KHÔNG chờ 35 giây và KHÔNG tìm "Apply generated design": `do_action` bắn
 *      1 giây sau khi bấm Send. Nhiệm vụ tính khi GỬI, không phải khi có kết quả.
 *   5. ẨN khung chat "Design with AI" trước khi thao tác canvas, và kiểm
 *      hit-target trước mỗi click. Khung chat rộng 440px phủ đúng nút Send của
 *      canvas trong cửa sổ 929px; `page.mouse` không báo lỗi khi click vào
 *      element bị che nên 22/22 lượt ngày 2026-09-02 in "Đã bấm Send canvas"
 *      rồi chờ `do_action` 90 giây vô ích. Chi tiết ở `hideChatPanel`.
 * =============================================================================
 */

import type { Locator, Page } from 'playwright-core';

import { assertHittable, assertNotInert, dump, mustSee, StepError, waitNotInert } from '../diag';
import { foregroundPage, humanClick, pick, rand, waitEnabled } from '../human';
import type { MissionGroup } from '../missionRunner';
import { closeBlockingPricingModal, ensurePageUsable } from '../overlays';
import { fillEditor, stepChatWithAgent, stepInspirationTemplate } from '../steps';
import type { CapcutMissionEnv } from '../types';
import { URLS } from '../urls';
import { abortableDelay, boundedDomRead, DomReadTimeoutError } from '../cancellation';

const CANVAS_PANEL = '[aria-label="Canvas prompt panel"]';
const CANVAS_EXPANDED = `${CANVAS_PANEL} [class*="expandedWrapper"]`;

const CANVAS_PROMPTS = [
  'change background color to soft blue',
  'make the background brighter',
  'add a short title text on top',
] as const;

/** Upload ảnh bằng nút trên THANH CÔNG CỤ CANVAS, không phải nút "+" của khung chat. */
async function uploadToCanvas(dp: Page, env: CapcutMissionEnv): Promise<void> {
  env.captureStage?.('design:upload');
  // 30s: thanh Canvas tools render muon sau khi mo trang. Luot 06:05 that bai
  // ca 4 nhiem vu Design Studio chi vi mustSee mac dinh 15s la chua du.
  const btn = await mustSee(
    dp,
    dp.locator('[aria-label="Canvas tools"] [aria-label="Upload image"]'),
    'nút Upload image trên thanh Canvas tools',
    30000
  );
  const [chooser] = await Promise.all([
    dp.waitForEvent('filechooser', { timeout: 15000 }),
    humanClick(dp, btn, { signal: env.signal, stage: 'design:upload-click', ui: env.ui, log: env.log }),
  ]);
  await chooser.setFiles(env.sampleImage);
  env.log('Đã upload ảnh lên canvas');
  await dp.waitForTimeout(rand(8000, 11000));
}

/**
 * Chờ editor thật sự layout xong.
 *
 * `/ai-design` có 5 thẻ `canvas`, và 3 thẻ đầu (trong `#__editor_container_id__`)
 * có chiều cao 0 khi editor chưa dựng xong. `locator('canvas').first()` vì thế
 * trỏ vào element 0 chiều cao, Playwright coi là không visible và `mustSee` ném
 * lỗi "không thấy canvas" — đúng chuyện đã xảy ra lượt 2026-09-02 04:36.
 * Hai canvas còn lại còn tệ hơn: một là bánh xe màu, một là `#offscreenCanvas`.
 */
export async function waitCanvasReady(
  dp: Page,
  timeoutMs = 40000,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const ready = await boundedDomRead(
      () => dp.evaluate(() =>
        Array.from(document.querySelectorAll('#__editor_container_id__ canvas')).some(
          (c) => c.getBoundingClientRect().height > 100
        )
      ), 'canvas-ready', Math.min(1000, remaining), signal
    );
    if (ready) return;
    await abortableDelay(Math.max(0, Math.min(500, deadline - Date.now())), signal ?? new AbortController().signal);
  }
  throw new StepError(
    'Canvas của Design Studio chưa layout xong (mọi canvas đều cao 0)',
    await dump(dp, 'canvas_zero_height', signal)
  );
}

/**
 * ẨN KHUNG CHAT TRƯỚC KHI THAO TÁC CANVAS — đây là chỗ hỏng của 22/22 lượt.
 *
 * Panel "Design with AI" (`#ai-design-chat-panel-container`, rộng 440px, ghim
 * mép phải) do bước `stepChatWithAgent` mở ra và không bao giờ đóng lại. Canvas
 * prompt panel thì neo vào vật thể đang chọn, nên trong cửa sổ Multilogin (đo
 * được 929px) nó rơi đúng dưới khung chat.
 *
 * Bằng chứng đo trực tiếp trên account rvfyafux88495 lúc 2026-09-02 17:40:
 *   - nút Send canvas: rect (611,718) 32×32, class `solid-y1oAp_` (KHÔNG disabled)
 *   - ô prompt: "sam…ct.png ⏎ change background color to soft blue" (chữ VÀO rồi)
 *   - `elementFromPoint(627,734)` → `root-slqgv1 skillPanel-4DcNp3` ← khung chat
 *   - bấm "Hide chat" → cùng điểm đó trả về svg trong nút Send
 *   - click lại → panel đổi "Thinking", `Stop generating` hiện, `do_action`
 *     `err_no=0` về sau ~1 giây.
 *
 * Nói cách khác: prompt và nút Send đều đúng, chỉ có click là rơi vào khung chat.
 * "Hide chat" là nút của chính CapCut nên không phá layout của nó.
 */
export async function hideChatPanel(dp: Page, env: CapcutMissionEnv): Promise<void> {
  env.signal.throwIfAborted();
  const panel = dp.locator('#ai-design-chat-panel-container[aria-hidden="false"]').first();
  if (!await boundedDomRead(() => panel.isVisible(), 'canvas-chat-visible', 3000, env.signal)) return;
  const hide = panel.locator('[aria-label="Hide chat"]').first();
  await foregroundPage(dp, { signal: env.signal, stage: 'design:canvas-hide-chat', ui: env.ui }, () =>
    boundedDomRead(() => hide.click({ timeout: 6000 }), 'canvas-hide-chat', 6500, env.signal)
  );
  await boundedDomRead(() => dp.waitForFunction(() => {
    const element = document.querySelector('#ai-design-chat-panel-container');
    if (!element || element.getAttribute('aria-hidden') === 'true') return true;
    const bounds = element.getBoundingClientRect();
    return bounds.width === 0 || bounds.height === 0 || getComputedStyle(element).visibility === 'hidden';
  }, undefined, { timeout: 4000 }), 'canvas-chat-hidden', 4500, env.signal);
  env.log('Đã ẩn khung chat "Design with AI" (nó phủ đúng nút Send của canvas)');
}

/** A mounted panel may be offscreen/hidden until selection; existence is insufficient. */
export async function canvasPromptIsReady(dp: Page, signal: AbortSignal): Promise<boolean> {
  return boundedDomRead(() => dp.evaluate((selector) => {
    const panels = document.querySelectorAll(selector);
    if (panels.length !== 1) return false;
    const panel = panels[0];
    if (panel.getAttribute('aria-expanded') !== 'false') return false;
    const openers = panel.querySelectorAll('[aria-label="Open canvas prompt"]');
    if (openers.length !== 1) return false;
    const opener = openers[0];
    if (opener.closest('[inert], [aria-hidden="true"]') ||
      opener.getAttribute('aria-disabled') === 'true' || opener.hasAttribute('disabled') ||
      /disabled/i.test(opener.getAttribute('class') ?? '')) return false;
    for (let element: Element | null = opener; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    const rect = opener.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    if (rect.width <= 0 || rect.height <= 0 || x <= 0 || y <= 0 || x >= innerWidth || y >= innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return hit !== null && (hit === opener || opener.contains(hit));
  }, CANVAS_PANEL), 'canvas-prompt-ready', 1000, signal);
}

/** CapCut's visible "Tab to design" shortcut; never retry input after a timeout. */
export function openCanvasPrompt(
  page: Page,
  opener: Locator,
  options: Pick<CapcutMissionEnv, 'signal' | 'ui' | 'log'>
): Promise<void> {
  const { signal, ui, log } = options;
  return foregroundPage(page, { signal, ui, stage: 'canvas-opener' }, async () => {
    await abortableDelay(rand(180, 420), signal);
    let phase = 'canvas-opener:focus-control';
    try {
      log('Browser command: ' + phase);
      await boundedDomRead(() => opener.focus({ timeout: 4000, signal }), phase, 4500, signal);
      signal.throwIfAborted();
      phase = 'canvas-opener:tab';
      log('Browser command: ' + phase);
      await boundedDomRead(() => opener.press('Tab', { delay: rand(70, 150), timeout: 6000, signal }), phase, 6500, signal);
    } catch (error: unknown) {
      signal.throwIfAborted();
      if (error instanceof Error && error.name === 'TimeoutError') throw new DomReadTimeoutError(phase);
      throw error;
    }
    signal.throwIfAborted();
    await abortableDelay(rand(250, 500), signal);
  });
}

async function editOnCanvas(dp: Page, env: CapcutMissionEnv): Promise<void> {
  env.captureStage?.('design:canvas-edit');
  /**
   * Bảng giá "Choose your plan" phủ kín trang thì Send không tới đích và bước
   * này báo `canvas_send_no_effect` — đo 04/09/2026 06:29, dump có
   * `subscriptionModal-wrapper` `display: block`. Năng lực đóng bảng giá trước
   * đây chỉ nằm trong Video Studio nên luồng này không có gì dẹp nó.
   */
  await closeBlockingPricingModal(dp, env.log, env.ui, env.signal);
  await hideChatPanel(dp, env);
  env.log('Canvas readiness: starting bounded DOM probe');
  await waitCanvasReady(dp, 40000, env.signal);
  env.log('Canvas readiness: layout confirmed');
  const interaction = (stage: string) => ({ signal: env.signal, log: env.log, stage, ui: env.ui });
  // Upload can leave the image selected and its prompt already usable. Do not
  // send another pointer trajectory through the canvas in that state.
  if (await canvasPromptIsReady(dp, env.signal)) {
    env.log('Canvas selection: prompt already ready; preserving selection');
  } else {
    env.log('Canvas stage: area-visible');
    const area = await mustSee(dp, dp.locator('#graphic-editor-render'), 'vung editor Design Studio', 15000, env.signal);
    await assertHittable(dp, area, 'vung editor Design Studio', env.signal);
    await humanClick(dp, area, interaction('canvas-area'));
    await abortableDelay(rand(1200, 2000), env.signal);
  }

  env.log('Canvas stage: opener-visible');
  await hideChatPanel(dp, env);
  const opener = await mustSee(
    dp,
    dp.locator(`${CANVAS_PANEL} [aria-label="Open canvas prompt"]`),
    'nut mo canvas prompt', 30000, env.signal
  );
  await assertHittable(dp, opener, 'nut mo canvas prompt', env.signal);
  await openCanvasPrompt(dp, opener, env);
  await waitNotInert(dp, `${CANVAS_PANEL} [class*="expandedWrapper"]`, 15000, env.signal);
  env.log('Panel canvas prompt đã mở (hết inert)');

  env.log('Canvas stage: editor-visible');
  const editor = dp.locator(`${CANVAS_EXPANDED} .tiptap.ProseMirror[contenteditable="true"]`);
  await mustSee(
    dp,
    editor,
    'o prompt trong panel canvas', 15000, env.signal
  );
  await assertNotInert(editor, 'ô prompt canvas', env.signal);
  const prompt = pick(CANVAS_PROMPTS);
  await fillEditor(dp, editor, prompt, env.pace && { minMs: env.pace.typeMinMs, maxMs: env.pace.typeMaxMs }, {
    ...interaction('canvas-prompt'), preserveFocus: true
  });
  await abortableDelay(rand(1200, 2000), env.signal);

  // Đọc LẠI từ DOM: bản cũ gõ vào editor inert rồi vẫn in "đã nhập prompt".
  env.log('Canvas stage: prompt-readback');
  const typed = await boundedDomRead(() => dp
    .locator(`${CANVAS_EXPANDED} .tiptap.ProseMirror`)
    .first()
    .innerText(), 'canvas-prompt-readback', 5000, env.signal);
  if (!typed.replace(/\s+/g, ' ').includes(prompt)) {
    throw new StepError(
      `Prompt không vào được ô canvas — đọc lại được: "${typed.replace(/\s+/g, ' ').slice(0, 80)}"`,
      await dump(dp, 'canvas_prompt_not_typed', env.signal)
    );
  }

  env.log('Canvas stage: send-visible');
  const send = await mustSee(
    dp,
    dp.locator(`${CANVAS_EXPANDED} [aria-label="Send message"]`),
    'nut Send cua panel canvas', 15000, env.signal
  );
  await assertNotInert(send, 'nút Send canvas', env.signal);
  // Trả về của waitEnabled trước đây bị bỏ, nên nút disabled vẫn được click.
  env.log('Canvas stage: send-enabled');
  if (!(await waitEnabled(send, 10000, env.signal))) {
    throw new StepError(
      'Nút Send của canvas vẫn disabled sau 10s',
      await dump(dp, 'canvas_send_disabled', env.signal)
    );
  }
  // Chat can reopen while upload/chat responses finish, after the first close.
  // Close it again without clearing the canvas prompt, then recheck the hit target.
  await hideChatPanel(dp, env);
  await assertHittable(dp, send, 'nut Send canvas', env.signal);
  await humanClick(dp, send, interaction('canvas-send'));

  // Tín hiệu phụ đã kiểm trên DOM dump: sau khi gửi, chính nút đó đổi thành
  // "Stop generating" và nhãn panel đổi thành "Thinking".
  env.log('Canvas stage: send-ack');
  const stopped = await boundedDomRead(
    () => dp.locator('[aria-label="Stop generating"]').first().waitFor({ state: 'attached', timeout: 8000 }).then(() => true),
    'canvas-send-ack', 8000, env.signal
  )
    .then(() => true)
    .catch((error: unknown) => {
      env.signal.throwIfAborted();
      if (error instanceof DomReadTimeoutError) throw error;
      return false;
    });
  if (stopped) {
    env.log('Canvas đã nhận prompt (nút đổi thành Stop generating)');
    return;
  }
  // Không còn im lặng: hit-target đã được kiểm, nên đây là hiện tượng MỚI —
  // để lại hiện trường thay vì chờ do_action 90 giây rồi không biết gì.
  const shot = await dump(dp, 'canvas_send_no_effect', env.signal);
  env.log(`⚠️  Bấm Send canvas xong không thấy "Stop generating" sau 8s — dump: ${shot ?? 'không ghi được'}`);
}

export const designStudioGroup: MissionGroup = {
  id: 'design-studio',
  name: 'Design Studio (Inspiration + Chat + Upload + Canvas)',
  workspace: 'editor',
  keys: [
    'capcut_web_inspiration_generate_done',
    'capcut_web_design_studio_ai_chat',
    'capcut_web_design_studio_upload_img',
    'capcut_web_design_studio_canvas_edit',
  ],
  proofTimeoutMs: 90000,
  async act(env: CapcutMissionEnv, need: Set<string>): Promise<void> {
    /**
     * Dẹp bảng giá TRƯỚC khi làm gì: nó có thể còn mở từ nhóm nhiệm vụ trước
     * (Video Studio bấm card upsell Pro), và khi mask phủ trang thì mọi bước
     * dưới đây trượt im lặng rồi timeout 90 giây ở một chỗ khác.
     */
    await ensurePageUsable(env.page, env.log, env.ui, env.signal);

    // 1. Inspiration mở tab workspace riêng của nó.
    let inspirationTab: Page | null = null;
    if (need.has('capcut_web_inspiration_generate_done')) {
      inspirationTab = await stepInspirationTemplate(env);
    }

    /**
     * Tab MỚI của CapCut hay bung modal khảo sát onboarding — đo 04/09/2026 trên
     * `markusmkel7097`: tab do nhiệm vụ tự mở có `lv-modal-mask` `display: block`
     * kèm "best describes you", và cả 4 nhiệm vụ nhóm này báo "Không thấy panel
     * chat AI agent". `runGroup` chỉ dẹp được trên `env.page`, không với tới tab
     * này, nên phải dẹp ngay tại đây.
     */
    if (inspirationTab) {
      await ensurePageUsable(inspirationTab, env.log, env.ui, env.signal);
    }

    // 2. Chat phải chạy trên Design Studio thật. Tab Inspiration chỉ dùng để
    // gửi nhiệm vụ inspiration; sau khi thu nhỏ, nó không có chat panel.
    let workspaceReady = false;
    if (need.has('capcut_web_design_studio_ai_chat')) {
      const chatPage = env.page;
      await foregroundPage(chatPage, { signal: env.signal, stage: 'design:chat-focus', ui: env.ui }, async () => {});
      await chatPage.goto(URLS.aiDesign, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await chatPage.waitForTimeout(rand(6000, 9000));
      await ensurePageUsable(chatPage, env.log, env.ui, env.signal);
      await stepChatWithAgent(chatPage, env);
      env.captureStage?.('design:chat-accepted');
      workspaceReady = true;
    }

    if (!need.has('capcut_web_design_studio_upload_img') && !need.has('capcut_web_design_studio_canvas_edit')) {
      return;
    }

    /**
     * 3. Upload + Edit on canvas LUÔN làm trên trang `/ai-design` sạch, không
     *    làm trên tab workspace của Inspiration.
     *
     *    Đo được: `capcut_web_design_studio_canvas_edit` KHÔNG được ghi nhận khi
     *    gửi prompt trên tab workspace Inspiration — lượt 05:05 và 06:05 đều gửi
     *    thành công (nút đổi thành "Stop generating") mà không có `do_action`.
     *    Cùng account đó, khi chỉ thiếu canvas edit nên chạy trên `/ai-design`
     *    thường, `do_action` bắn ngay (lượt 05:48).
     */
    const dp = env.page;
    await foregroundPage(dp, { signal: env.signal, stage: 'design:canvas-focus', ui: env.ui }, async () => {});
    if (!workspaceReady) {
      await dp.goto(URLS.aiDesign, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await dp.waitForTimeout(rand(6000, 9000));
    }
    // Trang vừa load lại thì modal có thể mọc lại — dẹp trước khi upload.
    await ensurePageUsable(dp, env.log, env.ui, env.signal);

    // Edit on canvas cần có ảnh trên canvas -> upload cả khi chỉ thiếu canvas.
    await uploadToCanvas(dp, env);

    if (need.has('capcut_web_design_studio_canvas_edit')) {
      await editOnCanvas(dp, env);
    }

    // Đóng tab Inspiration cho khỏi rác các lượt sau.
    if (inspirationTab && inspirationTab !== env.page) {
      await inspirationTab.close().catch(() => {});
    }
  },
};
