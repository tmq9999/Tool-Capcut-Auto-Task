/**
 * =============================================================================
 * MISSIONS — HÀNH ĐỘNG CỤ THỂ CHO TỪNG NHIỆM VỤ
 * =============================================================================
 * File này là bản DỊCH TRỰC TIẾP của `Tutorial_Task.md` (hướng dẫn làm tay của
 * người dùng) thành code. Mỗi hàm tương ứng một mục trong tài liệu đó.
 *
 * NGUYÊN TẮC CHỌN SELECTOR:
 *   CapCut build lại CSS module mỗi lần deploy → class có hash đuôi
 *   (VD `button-cmQyUp`, `taskRow-qBqCmZ`) SẼ ĐỔI và làm script chết.
 *   Vì vậy ưu tiên theo thứ tự:
 *     1. aria-label            (VD: aria-label="Send message")
 *     2. id / data-*           (VD: #studio-chat, data-placeholder="...")
 *     3. text người dùng thấy  (VD: :has-text("Tab to design"))
 *     4. class KHÔNG hash      (VD: .tiptap.ProseMirror, .lv-select)
 *     5. class có hash         → CHỈ dùng dạng [class*="prefix"] (bỏ hash)
 *
 * BẢN ĐỒ NHIỆM VỤ → HÀM:
 *   Try an Inspiration template +130 ─┐
 *   Chat with AI agent          +110 ─┼─→ runDesignStudioFlow()
 *   Upload an image             +110 ─┤   (1 luồng liên tục làm xong 4 task)
 *   Edit on canvas              +160 ─┘
 *
 *   Chat with AI agent          +130 ─┐
 *   Complete a generation       +130 ─┼─→ runVideoStudioFlow()
 *   Make an export              +190 ─┘
 * =============================================================================
 */

import type { Locator, Page } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

import { dump, getDumpDir, mustSee, StepError } from './diag';

import {
  clickIfVisible,
  dismissOverlays,
  foregroundPage,
  humanClick,
  humanType,
  type PerCharDelay,
  type HumanInteractionOptions,
  pick,
  rand,
  sleep,
  waitEnabled,
} from './human';
import { createDirectUiInteraction } from './uiInteractionScheduler';

import type { CapcutMissionEnv } from './types';
import { URLS } from './urls';

// `URLS` nằm ở `urls.ts` để `missionRunner` không phải kéo theo cả bộ nhiệm vụ.
// Re-export ở đây để các file nhiệm vụ vẫn lấy được từ một chỗ duy nhất.
export { URLS };

// -----------------------------------------------------------------------------
// HẰNG SỐ TỪ TÀI LIỆU HƯỚNG DẪN
// -----------------------------------------------------------------------------

/**
 * Các template Inspiration RẺ NHẤT (40 credits/ảnh) — lấy đúng danh sách
 * người dùng đã kiểm chứng trong Tutorial_Task.md.
 * Mở bằng dạng `my-edit?inspirationKey=<id>` để modal prompt hiện ngay.
 */
export const INSPIRATION_KEYS = [
  '7611886117142531329', // Template đã xác nhận cho nhiệm vụ Inspiration
  '7601075239333776648',
  '7601066420239191304',
  '7601064346852019463',
  '7601062040957947144',
  '7601051729613901064',
  '7601056760882826503',
  '7601059069188656392',
  '7601058799239187730',
  '7601055478076001544',
] as const;

/** Text điền vào ô `input-slot` của prompt template Inspiration */
const SLOT_TEXTS = ['Change background', 'Change text', 'Replace subject'] as const;

/** Prompt chat với AI agent — nội dung gì cũng được theo tài liệu */
const CHAT_PROMPTS = ['hello', 'xin chào', 'hi there', 'chào bạn'] as const;

// -----------------------------------------------------------------------------
// SELECTOR DÙNG CHUNG (KHÔNG PHỤ THUỘC HASH)
// -----------------------------------------------------------------------------

export const S = {
  /** Nút gửi prompt — mọi panel của CapCut đều dùng aria-label này */
  send: '[aria-label="Send message"]',
  minimize: 'button:has-text("Minimize"), button:has-text("Thu nhỏ"), [aria-label="Minimize"]',
  /** Ô text nhỏ trong prompt template của Inspiration */
  inputSlot: '[data-placeholder="your preferred text"]',
  /** Panel chat AI agent bên phải Design Studio */
  chatPanel: '#ai-design-chat-panel-container',
  /** Ô nhập của chat AI agent (có anchor onboarding riêng) */
  chatInputAnchor: '[data-onboarding-anchor="onboarding-agent-message-input"]',
  /** Editor tiptap dùng chung */
  tiptap: '.tiptap.ProseMirror',
} as const;

// -----------------------------------------------------------------------------
// TIỆN ÍCH
// -----------------------------------------------------------------------------

// `MissionEnv` của engine chính là `CapcutMissionEnv` trong `types.ts` — hợp
// đồng duy nhất giữa engine và app, nên không khai lại ở đây.

/** Ghi ảnh chụp màn hình để soi lỗi khi flow chệch hướng */
export async function snap(page: Page, name: string): Promise<string | null> {
  try {
    // `getDumpDir()` để app đóng gói ghi được vào `userData`; mặc định vẫn là
    // `.debug/` của cwd như engine CLI.
    const dir = getDumpDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}_${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return null;
  }
}

/**
 * Nạp file vào ô upload. Thử 2 đường:
 *   1. Bắt sự kiện `filechooser` khi click nút (đúng hành vi người dùng)
 *   2. `setInputFiles` trực tiếp vào <input type=file> (dự phòng khi nút bị che)
 */
export async function uploadImage(
  page: Page,
  button: Locator | null,
  filePath: string,
  log: (m: string) => void,
  options?: HumanInteractionOptions
): Promise<boolean> {
  if (button && (await button.isVisible({ timeout: 3000 }).catch(() => false))) {
    try {
      const humanOptions = options ?? {
        signal: new AbortController().signal,
        stage: 'upload-image',
        ui: createDirectUiInteraction(new AbortController().signal),
        log
      };
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }),
        humanClick(page, button, humanOptions),
      ]);
      await chooser.setFiles(filePath);
      log('Đã upload ảnh qua hộp thoại chọn file');
      return true;
    } catch {
      log('Không bắt được filechooser → chuyển sang setInputFiles');
    }
  }

  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count();
  for (let i = n - 1; i >= 0; i--) {
    try {
      await inputs.nth(i).setInputFiles(filePath, { timeout: 5000 });
      log(`Đã nạp ảnh vào input[type=file] #${i}`);
      return true;
    } catch {
      /* thử input kế tiếp */
    }
  }
  log('❌ Không tìm được ô upload nào nhận file');
  return false;
}

/**
 * Điền text vào editor tiptap rồi trả về locator của editor đó.
 * `editorRoot` là locator tới thẻ <p data-placeholder="..."> hoặc chính .tiptap
 *
 * `perChar` là nhịp gõ người dùng đặt ở Dashboard; `humanType` tự kẹp nó lên
 * trên sàn `45–130ms` nên không truyền cũng giữ đúng nhịp đã đo.
 */
export async function fillEditor(
  page: Page,
  editor: Locator,
  text: string,
  perChar?: PerCharDelay,
  options?: HumanInteractionOptions
): Promise<void> {
  // The bounded click inside humanType already scrolls; avoid an unbounded pre-read.
  if (!options) await editor.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  await humanType(page, editor, text, perChar, options);
}

/** Bấm nút gửi trong 1 vùng cụ thể; tự chờ hết disabled. */
export async function clickSend(
  page: Page,
  scope: Locator | Page,
  log: (m: string) => void,
  timeoutMs = 20000,
  options?: HumanInteractionOptions
): Promise<boolean> {
  const send = ('locator' in scope ? scope.locator(S.send) : page.locator(S.send)).last();

  /**
   * Hai nhánh dưới đây từng làm vỡ cả nhóm Design Studio mà KHÔNG để lại hiện
   * trường (lượt 2026-09-03 05:0x: "Nút Send vẫn disabled", lượt 05:1x: "Không
   * thấy nút Send message" — cả hai chỉ có một dòng log rồi đi tiếp). Giờ ghi
   * dump để lần sau biết trang đang ở trạng thái nào.
   */
  if (!(await send.isVisible({ timeout: 8000 }).catch(() => false))) {
    const shot = await dump(page, 'send_message_missing');
    log(`❌ Không thấy nút Send message — dump: ${shot ?? 'không ghi được'}`);
    return false;
  }

  const humanOptions: HumanInteractionOptions = options ?? {
    signal: new AbortController().signal,
    stage: 'click-send',
    ui: createDirectUiInteraction(new AbortController().signal),
    log
  };

  if (!(await waitEnabled(send, timeoutMs, humanOptions.signal))) {
    const shot = await dump(page, 'send_message_disabled');
    log(`⚠️  Nút Send vẫn disabled sau khi chờ → thử Enter — dump: ${shot ?? 'không ghi được'}`);
    await foregroundPage(page, humanOptions, () =>
      page.keyboard.press('Enter')
    );
    return true;
  }

  await humanClick(page, send, humanOptions);
  log('Đã bấm Send message');
  return true;
}

// =============================================================================
// LUỒNG 1 — DESIGN STUDIO (4 nhiệm vụ trong 1 lần chạy)
// =============================================================================

/**
 * BƯỚC 1-4 của tài liệu: mở template Inspiration, điền text vào ô trống của
 * prompt mẫu rồi bấm gửi. CapCut mở TAB MỚI để generate → trả về tab đó.
 *
 * Nhiệm vụ hoàn thành ở bước này: **Try an Inspiration template +130**
 */
export async function stepInspirationTemplate(env: CapcutMissionEnv): Promise<Page | null> {
  env.captureStage?.('inspiration:submit');
  const { page, context, log } = env;
  const key = INSPIRATION_KEYS[0];

  const humanOptions: HumanInteractionOptions = {
    signal: env.signal,
    stage: 'inspiration:setup',
    ui: env.ui,
    log: env.log,
  };

  log(`Mở template Inspiration: ${key}`);
  await page.goto(URLS.inspirationKey(key), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(rand(5000, 7000));
  await dismissOverlays(page, humanOptions);

  // 1. Nếu có chip ý tưởng "Change text" -> click
  const changeTextChip = page
    .locator('.sugChip-KeFdza, [class*="sugChip"]')
    .filter({ hasText: /change text/i })
    .first();
  if (await changeTextChip.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(page, changeTextChip, { ...humanOptions, stage: 'inspiration:chip' });
    log('Đã chọn ý tưởng "Change text"');
    await page.waitForTimeout(1500);
  }

  // 2. Điền text vào ô trống của prompt mẫu: "Replace the text in [Image 1] with "___""
  const slot = page.locator(S.inputSlot).first();
  if (await slot.isVisible({ timeout: 10000 }).catch(() => false)) {
    await fillEditor(
      page,
      slot,
      pick(SLOT_TEXTS),
      env.pace && { minMs: env.pace.typeMinMs, maxMs: env.pace.typeMaxMs },
      { ...humanOptions, stage: 'inspiration:slot' }
    );
    log('Đã điền text vào ô trống của prompt mẫu');
  }
  await page.waitForTimeout(rand(800, 1500));

  // Bấm gửi → CapCut mở tab mới chạy generate
  const before = context.pages().length;
  const sent = await clickSend(page, page, log, 25000, { ...humanOptions, stage: 'inspiration:send' });
  if (!sent) {
    await dump(page, 'inspiration_send_fail');
    return null;
  }

  // Chờ tab mới rất ngắn để bắt workspace, nhưng không chờ ảnh generate.
  let studio: Page | null = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const pages = context.pages();
    if (pages.length > before) {
      studio = pages[pages.length - 1];
      break;
    }
    if (page.url().includes('ai-design') || page.url().includes('design-studio')) {
      studio = page;
      break;
    }
    await sleep(1000);
  }

  const workspace = studio ?? page;
  if (studio) {
    const studioOptions: HumanInteractionOptions = {
      signal: env.signal,
      stage: 'inspiration:studio-foreground',
      ui: env.ui,
      log: env.log,
    };
    await foregroundPage(studio, studioOptions, () => studio.bringToFront());
    await studio.waitForLoadState('domcontentloaded').catch(() => {});
    await studio.waitForTimeout(rand(1000, 2000));
    await dismissOverlays(studio, studioOptions);
    log(`Đã chuyển sang workspace generate: ${studio.url().slice(0, 80)}`);
  } else {
    log('Không thấy tab workspace mới sau khi gửi; tiếp tục trên tab hiện tại');
  }
  const minimize = workspace.locator(S.minimize).last();
  if (await minimize.isVisible({ timeout: 5000 }).catch(() => false)) {
    await humanClick(workspace, minimize, {
      signal: env.signal,
      stage: 'inspiration:minimize',
      ui: env.ui,
      log: env.log,
    });
    log('Đã thu nhỏ workspace Inspiration; không chờ generate');
  }
  return studio;
}

/**
 * Nạp file vào <input type="file"> KHÔNG thuộc panel chat.
 * Trang /ai-design có ít nhất 2 ô upload: một của canvas (tính nhiệm vụ
 * "Upload an image") và một của chat panel (chỉ đính kèm vào hội thoại).
 */
export async function setFilesOutsideChat(
  dp: Page,
  filePath: string,
  log: (m: string) => void
): Promise<boolean> {
  const inputs = dp.locator('input[type="file"]');
  const n = await inputs.count().catch(() => 0);

  for (let i = 0; i < n; i++) {
    const inChat = await inputs
      .nth(i)
      .evaluate((el: Element, sel: string) => !!el.closest(sel), S.chatPanel)
      .catch(() => true);
    if (inChat) continue;

    try {
      await inputs.nth(i).setInputFiles(filePath, { timeout: 5000 });
      log(`Đã nạp ảnh vào input[type=file] #${i} (ngoài panel chat)`);
      return true;
    } catch {
      /* thử input kế tiếp */
    }
  }
  log('❌ Không có ô upload nào của canvas nhận file');
  return false;
}

/**
 * Mở panel canvas prompt ("Tab to design") và chờ nó mở THẬT.
 * Bắt buộc làm trước khi gõ prompt, vì lúc thu gọn editor + nút Send nằm trong
 * vùng `inert`/`aria-hidden` → Playwright coi là ẩn và sẽ gõ lạc sang chat.
 */
export async function stepChatWithAgent(dp: Page, env: CapcutMissionEnv): Promise<void> {
  env.captureStage?.('design:chat');
  const { log } = env;
  const humanOptions: HumanInteractionOptions = {
    signal: env.signal,
    stage: 'design:chat',
    ui: env.ui,
    log: env.log,
  };
  await foregroundPage(dp, humanOptions, () => dp.bringToFront());
  await dismissOverlays(dp, humanOptions);

  const panel = dp.locator(S.chatPanel).first();
  // Tuỳ chọn: panel có thể đang thu gọn vì nút "Hide chat" đã bấm -> mở lại.
  if (!(await panel.isVisible({ timeout: 6000 }).catch(() => false))) {
    log('Panel chat đang ẩn → thử mở lại');
    await clickIfVisible(
      dp,
      dp.locator('[aria-label="Show chat"], [aria-label="Open chat"]'),
      2500,
      { ...humanOptions, stage: 'design:chat:show' }
    );
    await dp.waitForTimeout(1500);
  }

  // Từ đây là điều kiện tiên quyết: không có thì bước sau vô nghĩa -> fail loud.
  const scope = await mustSee(dp, panel, 'panel chat AI agent', 8000);

  // Chỉ tìm editor TRONG panel chat (trang còn nhiều contenteditable khác).
  const editor = await mustSee(
    dp,
    scope.locator(`${S.chatInputAnchor} ${S.tiptap}, ${S.tiptap}`).last(),
    'o chat AI agent',
    10000
  );

  await fillEditor(
    dp,
    editor,
    pick(CHAT_PROMPTS),
    env.pace && { minMs: env.pace.typeMinMs, maxMs: env.pace.typeMaxMs },
    { ...humanOptions, stage: 'design:chat:fill' }
  );
  log('Đã nhập nội dung chat với AI agent');
  await dp.waitForTimeout(rand(700, 1300));

  const sent = await clickSend(dp, scope, log, 20000, { ...humanOptions, stage: 'design:chat:send' });
  if (!sent) throw new StepError('Không bấm được Send trong chat AI agent', await dump(dp, 'chat_send_failed'));

  // A click is not evidence: CapCut may leave the editor untouched when the
  // panel is still settling. Accept only a short, observable acknowledgement.
  const acknowledged = await dp
    .waitForFunction(
      (selector) => {
        const panel = document.querySelector(selector);
        if (!panel) return false;
        if (panel.querySelector('[aria-label="Stop generating"]')) return true;
        const editor = panel.querySelector('.tiptap.ProseMirror');
        return editor instanceof HTMLElement && !(editor.textContent ?? '').trim();
      },
      S.chatPanel,
      { timeout: 6000 }
    )
    .then(() => true)
    .catch(() => false);
  if (!acknowledged) {
    throw new StepError(
      'Chat AI agent chưa xác nhận đã gửi sau 6s',
      await dump(dp, 'chat_send_unacknowledged')
    );
  }
  log('Đã gửi chat AI agent; chuyển bước không chờ phản hồi');
}

/** Chọn phần việc nào của luồng Design Studio cần chạy */
