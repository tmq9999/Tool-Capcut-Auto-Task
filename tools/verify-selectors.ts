/**
 * KIỂM SELECTOR TRÊN DOM THẬT, OFFLINE.
 *
 * Đây là cách duy nhất test được code UI mà không đốt account: dùng chính DOM
 * dump của lượt làm tay thành công (`.capture/2026-09-01-21-50-27/dom/`).
 *
 * Ba fixture, ba thời điểm khác nhau — thứ tự này quan trọng:
 *   dom-ai-design.html       dump 020 @06:40 — TRƯỚC khi gửi canvas prompt
 *   dom-ai-design-sent.html  dump 021 @07:04 — SAU khi gửi (nút đổi thành Stop generating)
 *   dom-video-studio.html    dump 026 @08:52 — Video Studio ở chế độ Image, đang export
 *
 * GIỚI HẠN: dump là DOM đã serialize, CSS ngoài không tải nên KHÔNG kiểm được
 * visibility. Test này kiểm đúng hai thứ đã thực sự gây lỗi: selector phân giải
 * ra bao nhiêu element, và element có nằm trong vùng `inert` hay không.
 *
 * Chạy: npm run selectors
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';

import { assertHittable } from '../src/main/services/capcut/diag';
import { findTaskRow, findTaskEntries } from '../src/main/services/capcut/missionRunner';
import { skipOnboardingSurvey, closeBlockingPricingModal, ensurePageUsable } from '../src/main/services/capcut/overlays';
import { findExportButton, ensureNodeToolbar } from '../src/main/services/capcut/missions/videoStudio';
import type { CapcutMissionEnv } from '../src/main/services/capcut/types';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CANVAS_PANEL = '[aria-label="Canvas prompt panel"]';
const CANVAS_EXPANDED = `${CANVAS_PANEL} [class*="expandedWrapper"]`;
const EXPORT_BTN = '.react-flow__node-toolbar [class*="toolbar-download"] button';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, got?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${got === undefined ? '' : ` — thực tế: ${JSON.stringify(got)}`}`);
  }
}

async function open(browser: { newPage(): Promise<Page> }, file: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const html = fs.readFileSync(path.resolve(file), 'utf8');
  const server = http.createServer((_q, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  return {
    page,
    close: async () => {
      await page.close();
      server.close();
    },
  };
}

const counter = (page: Page) => (sel: string): Promise<number> =>
  page.evaluate((q: string) => document.querySelectorAll(q).length, sel);

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // ------------------------------------------ /ai-design TRƯỚC khi gửi prompt
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-ai-design.html');
    const n = counter(page);
    console.log('\n=== /ai-design @06:40 — trước khi gửi canvas prompt ===');

    // Real captured DOM; absent header variants must not cost a timeout each.
    page.setDefaultTimeout(200);
    const probeAt = performance.now();
    await findTaskEntries(page);
    const probeMs = Math.round(performance.now() - probeAt);
    check('header discovery skips absent variants without implicit per-selector waits', probeMs < 400, probeMs);
    page.setDefaultTimeout(30_000);

    check('panel canvas prompt là duy nhất', (await n(CANVAS_PANEL)) === 1, await n(CANVAS_PANEL));
    check('nút mở panel là duy nhất', (await n(`${CANVAS_PANEL} [aria-label="Open canvas prompt"]`)) === 1);
    check(
      'ô prompt canvas là duy nhất khi đã scope',
      (await n(`${CANVAS_PANEL} [data-placeholder="Describe your design ideas"]`)) === 1,
      await n(`${CANVAS_PANEL} [data-placeholder="Describe your design ideas"]`)
    );
    check(
      'nút Send của canvas là duy nhất khi đã scope',
      (await n(`${CANVAS_EXPANDED} [aria-label="Send message"]`)) === 1,
      await n(`${CANVAS_EXPANDED} [aria-label="Send message"]`)
    );
    check(
      'nút Upload trên thanh Canvas tools là duy nhất',
      (await n('[aria-label="Canvas tools"] [aria-label="Upload image"]')) === 1
    );

    // Đây là cái bẫy đã làm hỏng "Edit on canvas" 10 lần đêm 2026-09-01
    const loose = await n('[aria-label="Send message"]');
    check('KHÔNG scope thì [aria-label="Send message"] mơ hồ (2 element)', loose === 2, loose);
    const firstIsChat = await page.evaluate(() => {
      const all = document.querySelectorAll('[aria-label="Send message"]');
      const chat = document.getElementById('ai-design-chat-panel-container');
      return !!chat && !!all[0] && chat.contains(all[0]);
    });
    check('.first() sẽ chọn nút của khung CHAT, không phải canvas', firstIsChat === true, firstIsChat);

    const sendSel = `${CANVAS_EXPANDED} [aria-label="Send message"]`;
    const inertNow = await page.evaluate(
      (q: string) => !!document.querySelector(q)?.closest('[inert]'),
      sendSel
    );
    check('nút Send canvas bị inert khi panel còn thu gọn', inertNow === true, inertNow);

    await page.evaluate((q: string) => document.querySelector(q)?.removeAttribute('inert'), CANVAS_EXPANDED);
    const inertAfter = await page.evaluate(
      (q: string) => !!document.querySelector(q)?.closest('[inert]'),
      sendSel
    );
    check('bỏ inert thì nút Send canvas dùng được', inertAfter === false, inertAfter);

    // Khung chat là thứ phủ lên nút Send canvas trên máy thật (929px) — phải có
    // đường tắt của chính CapCut để ẩn nó đi.
    check(
      'có đúng 1 nút "Hide chat" để dẹp khung chat',
      (await n('[aria-label="Hide chat"]')) === 1,
      await n('[aria-label="Hide chat"]')
    );
    const hideInsideChat = await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Hide chat"]');
      const chat = document.getElementById('ai-design-chat-panel-container');
      return !!btn && !!chat && chat.contains(btn);
    });
    check('nút "Hide chat" nằm trong khung chat (ẩn đúng panel)', hideInsideChat === true, hideInsideChat);

    await close();
  }

  // -------------------------------------------- /ai-design SAU khi gửi prompt
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-ai-design-sent.html');
    const n = counter(page);
    console.log('\n=== /ai-design @07:04 — sau khi gửi canvas prompt ===');

    check('nút Send của canvas đã biến mất', (await n(`${CANVAS_EXPANDED} [aria-label="Send message"]`)) === 0);
    check(
      'thay bằng [aria-label="Stop generating"] — tín hiệu phụ đã gửi thành công',
      (await n('[aria-label="Stop generating"]')) === 1,
      await n('[aria-label="Stop generating"]')
    );
    check('khung chat vẫn giữ nút Send riêng của nó', (await n('#ai-design-chat-panel-container [aria-label="Send message"]')) === 1);

    await close();
  }

  // ----------------------------------------------------------- Video Studio
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-video-studio.html');
    const n = counter(page);
    console.log('\n=== Video Studio @08:52 — chế độ Image, đang export ===');

    check(
      'ô nhập chế độ Image tồn tại',
      (await n('[data-placeholder="Enter ideas to generate an image"]')) >= 1,
      await n('[data-placeholder="Enter ideas to generate an image"]')
    );
    check(
      'ô nhập short-drama KHÔNG còn (đã đổi chế độ)',
      (await n('[data-placeholder="Enter ideas, scenes, or screenplay for your short drama or film"]')) === 0
    );
    check('ô chọn chế độ tạo tồn tại', (await n('#studio-chat [class*="triggerLabel"]')) >= 1);
    check('node toolbar của react-flow tồn tại', (await n('.react-flow__node-toolbar')) >= 1);
    check('node react-flow có data-id để nhận node MỚI', (await n('.react-flow__node[data-id]')) >= 1);
    check('nút export là duy nhất', (await n(EXPORT_BTN)) === 1, await n(EXPORT_BTN));

    // Nút export bị disabled trong lúc đang export -> phải chờ enabled trước khi bấm
    const disabled = await page.evaluate(
      (q: string) => (document.querySelector(q) as HTMLButtonElement | null)?.disabled ?? null,
      EXPORT_BTN
    );
    check('nút export bị disabled khi đang export (phải chờ enabled)', disabled === true, disabled);

    // toolbar-download-icon LÀ nút export, nhưng chỉ có trong node toolbar
    const atPageLevel = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('.toolbar-download-icon')).filter(
          (e) => !e.closest('.react-flow__node-toolbar')
        ).length
    );
    check('không có .toolbar-download-icon nào ngoài node toolbar', atPageLevel === 0, atPageLevel);

    await close();
  }

  // -------------------------- Video Studio TRƯỚC khi bấm export
  // Đây là trạng thái đã làm vỡ lượt 04:02: bao bọc nút export đổi tên từ
  // `toolbar-download-icon` thành `toolbar-download-menu-trigger`.
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-video-studio-preexport.html');
    const n = counter(page);
    console.log('\n=== Video Studio — TRƯỚC khi bấm export ===');

    check('node ảnh đã được chọn', (await n('.react-flow__node.selected')) >= 1);
    check('node toolbar hiện ra', (await n('.react-flow__node-toolbar')) >= 1);
    check(
      'selector cũ (.toolbar-download-icon button) KHÔNG khớp ở trạng thái này',
      (await n('.react-flow__node-toolbar .toolbar-download-icon button')) === 0
    );
    check('selector mới khớp đúng 1 nút export', (await n(EXPORT_BTN)) === 1, await n(EXPORT_BTN));
    const enabled = await page.evaluate(
      (q: string) => (document.querySelector(q) as HTMLButtonElement | null)?.disabled === false,
      EXPORT_BTN
    );
    check('nút export đang enabled (bấm được ngay)', enabled === true, enabled);

    await close();
  }

  // ------------------- /ai-design lúc editor CHƯA layout xong
  // Trạng thái đã làm vỡ lượt 04:36: 3 thẻ canvas đầu có chiều cao 0.
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-ai-design-loading.html');
    const n = counter(page);
    console.log('\n=== /ai-design — editor chưa layout xong ===');

    check('có nhiều thẻ canvas trên trang', (await n('canvas')) >= 4, await n('canvas'));
    const firstH = await page.evaluate(
      () => Math.round(document.querySelector('canvas')!.getBoundingClientRect().height)
    );
    check('canvas ĐẦU TIÊN có chiều cao 0 -> locator("canvas").first() vô dụng', firstH === 0, firstH);

    const tall = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('#__editor_container_id__ canvas')).filter(
          (c) => c.getBoundingClientRect().height > 100
        ).length
    );
    check('chưa có canvas nào cao > 100 -> waitCanvasReady phải chờ tiếp', tall === 0, tall);

    const editorCount = await n('#graphic-editor-render');
    check(
      '#graphic-editor-render selector resolves exactly once',
      editorCount === 1,
      editorCount
    );

    const editorIsInert = await page.evaluate(() => {
      const editor = document.querySelector('#graphic-editor-render');
      return editor?.closest('[inert]') !== null;
    });
    check(
      '#graphic-editor-render is not inside an inert ancestor',
      editorIsInert === false,
      editorIsInert
    );

    await close();
  }

  // ---------------------- modal Upgrade: ưu đãi dùng thử Pro
  // Đây là thứ API nói SAI: cả 11 trường trial đều false, trong khi modal của
  // chính account đó hiện "Pro 222,000₫ → 0₫ for 7 days".
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-upgrade-trial.html');
    const n = counter(page);
    console.log('\n=== modal Upgrade — trial Pro 7 ngày ===');

    check('thẻ gói Pro tồn tại (class KHÔNG hash)', (await n('[class*="subscriptionProductSection-pro"]')) >= 1);
    check('có 3 gói Free / Pro / Ultra', (await n('[class*="subscriptionProductSection"]')) >= 3);

    const proText = await page.evaluate(
      () =>
        (document.querySelector('[class*="subscriptionProductSection-pro"]') as HTMLElement | null)?.innerText ??
        ''
    );
    check('thẻ Pro chứa mẫu "for N days"', /for\s+\d+\s+days?/i.test(proText), proText.slice(0, 60));

    const days = /for\s+(\d+)\s+days?/i.exec(proText)?.[1];
    check('đọc ra đúng 7 ngày', days === '7', days);
    check('thẻ Pro có giá ưu đãi 0₫', /0₫/.test(proText), proText.slice(0, 80));
    check('thẻ Pro có giá gốc 222,000₫', /222[,.]000₫/.test(proText));

    const startBtn = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('button, [role="button"]')).filter((b) =>
          /start free trial/i.test((b as HTMLElement).innerText || '')
        ).length
    );
    check('có nút "Start free trial"', startBtn >= 1, startBtn);

    await close();
  }

  // ------------- header account CŨ: lối vào Upgrade khác account mới
  // Trạng thái làm vỡ cổng trial lượt 2026-09-02 08:0x.
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-titlebar-upgrade.html');
    const n = counter(page);
    console.log('\n=== header account CŨ — lối vào Upgrade ===');

    check('KHÔNG có span.upgrade-text (selector cũ vô dụng)', (await n('span.upgrade-text')) === 0);
    check('KHÔNG có button.credit-section', (await n('button.credit-section')) === 0);
    check('KHÔNG có [class*=UpgradeVip]', (await n('[class*="UpgradeVip"]')) === 0);
    check(
      'CÓ [data-id="TitleBarUpgradeVip"] — data-id không hash',
      (await n('[data-id="TitleBarUpgradeVip"]')) === 1,
      await n('[data-id="TitleBarUpgradeVip"]')
    );
    check('có onboarding "Got it" cần dẹp trước', (await n('button.lv-btn-primary')) >= 1);

    await close();
  }

  // ------------- Video Studio: card upsell Pro chen vào giữa send và generate
  // Trạng thái đã ăn 3 nhiệm vụ Video Studio của 4 account ngày 2026-09-02.
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-studio-pro-upsell.html');
    const n = counter(page);
    console.log('\n=== Video Studio @17:10 — card "Use advanced features with Pro" ===');

    const card = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="strongContent"]')).filter((e) =>
        (e.textContent ?? '').includes('Use advanced features with Pro')
      );
      const btns = cards[0] ? Array.from(cards[0].querySelectorAll('button')) : [];
      return {
        cards: cards.length,
        labels: btns.map((b) => (b.textContent ?? '').trim()),
      };
    });
    check('card upsell là duy nhất', card.cards === 1, card.cards);
    check('card có đúng 2 nút Skip + Continue', card.labels.join('|') === 'Skip|Continue', card.labels);

    // Chính là cái bẫy: selector cũ của confirmCredits bốc trúng nút này.
    const trap = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#studio-chat button.lv-btn')).filter(
        (b) => (b.textContent ?? '').trim() === 'Continue'
      ).length
    );
    check('selector cũ (#studio-chat button.lv-btn "Continue") khớp nút của card upsell', trap === 1, trap);
    check(
      'hậu quả đã ghi lại: bảng giá "Choose your plan" có trong DOM',
      (await n('[class*="subscriptionModal"]')) >= 1,
      await n('[class*="subscriptionModal"]')
    );
    await close();
  }

  // ------------------- khảo sát onboarding: bấm Skip mà KHÔNG kiểm đã tắt chưa
  /**
   * Trạng thái đo được lúc 2026-09-04 05:44, NGAY SAU khi `signupCapcut` in
   * "✅ ĐĂNG KÝ THÀNH CÔNG" và "→ Đã bấm Skip khảo sát":
   * modal "Which of the following roles best describes you?" (3 bước, `1 / 3`)
   * vẫn còn `.lv-modal-mask` `display: block` + wrapper `z-index: 1101`.
   *
   * Hậu quả trong cùng lượt: Design Studio trượt CẢ 4 nhiệm vụ với "Không thấy
   * panel chat AI agent", popover nhiệm vụ mở ra 0 dòng. `isInsideApp` chỉ đọc
   * URL nên vẫn trả true — signup báo thành công với modal đang phủ trang.
   */
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-role-survey-modal.html');
    const n = counter(page);
    console.log('\n=== khảo sát onboarding @05:44 — Skip đã bấm mà modal vẫn còn ===');

    check('mask modal đang display:block (modal thật sự phủ trang)',
      (await n('.lv-modal-mask[style*="display: block"]')) === 1,
      await n('.lv-modal-mask[style*="display: block"]'));
    check('wrapper modal cũng display:block',
      (await n('.lv-modal-wrapper[style*="display: block"]')) === 1);
    check('nút thoát .skip-mrkR37 phân giải đúng 1',
      (await n('.skip-mrkR37')) === 1, await n('.skip-mrkR37'));

    /**
     * Loại giả thuyết `locator(a, b).first()` bốc trúng vỏ khác — cái bẫy đã ăn
     * `TitleBarFreeCredits`. Ở đây OR-list ra đúng MỘT element, và nó đúng là
     * `.skip-mrkR37`, nên selector không phải nguyên nhân.
     */
    const orList = await page
      .locator('.skip-mrkR37, button:has-text("Skip"), div[role="button"]:text-is("Skip"), button:has-text("Not now")')
      .evaluateAll((els) => els.map((el) => el.tagName + '.' + String(el.className)));
    check('OR-list Skip ra đúng 1 element và đó là .skip-mrkR37',
      orList.length === 1 && orList[0] === 'DIV.skip-mrkR37', orList);

    check('khảo sát có 3 bước nên một lần Skip có thể chưa đủ',
      (await page.evaluate(() => document.body.innerText.includes('1 / 3'))) === true);
    check('trong trạng thái này KHÔNG có panel chat AI agent để Design Studio thao tác',
      (await n('[class*="skillPanel"]')) === 0, await n('[class*="skillPanel"]'));

    /**
     * Bài test thật: fixture là DOM tĩnh nên bấm Skip KHÔNG thể xoá mask. Hàm dọn
     * khảo sát vì vậy phải báo THẤT BẠI — bản cũ trả void và in "Đã bấm Skip
     * khảo sát" vô điều kiện, tức là không có cách nào phân biệt được.
     */
    const said: string[] = [];
    const gone = await skipOnboardingSurvey(page, (m) => said.push(m));
    check('mask không tắt thì hàm trả false (không nói dối)', gone === false, gone);
    check('log nói rõ khảo sát VẪN CÒN',
      said.some((m) => /vẫn còn/i.test(m)), said);
    check('log KHÔNG khẳng định đã bỏ được khảo sát',
      !said.some((m) => /đã bỏ khảo sát/i.test(m)), said);

    await close();
  }

  // ------------------- popover nhiệm vụ: reward của API lệch reward của chính UI
  /**
   * Đo được lúc 2026-09-04 05:48 (không có modal khảo sát trong dump này, nên
   * đây là lỗi ĐỘC LẬP): `task_list` của CapCut trả `reward_amount = 210` cho
   * `pwa_install` và `push_authorize`, còn popover của chính CapCut in `+70`.
   * `findTaskRow` khớp cả title VÀ reward nên ra 0 dòng và ném lỗi.
   *
   * Bộ lọc reward KHÔNG được bỏ: hai dòng "Chat with AI agent" chỉ khác nhau ở
   * reward. Nên lùi về title-only, và CHỈ nhận khi title ra đúng một dòng.
   */
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-task-popover-reward.html');
    const n = counter(page);
    console.log('\n=== popover nhiệm vụ @05:48 — reward API 210 vs UI +70 ===');

    check('không có modal khảo sát trong dump này (lỗi độc lập)',
      (await n('.skip-mrkR37')) === 0);
    check('popover có 10 dòng nhiệm vụ', (await n('[class*="taskRow"]')) === 10,
      await n('[class*="taskRow"]'));
    check('dòng Install hiển thị +70, không phải +210',
      (await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll('[class*="taskRow"]')).find((e) =>
          (e.textContent ?? '').includes('Install CapCut Web Desktop')
        );
        return (row?.textContent ?? '').includes('+70');
      })) === true);

    const byBoth = await page
      .locator('[class*="taskRow"]')
      .filter({ hasText: 'Install CapCut Web Desktop' })
      .filter({ hasText: '+210' })
      .count();
    check('lọc title + +210 ra 0 dòng (đúng lỗi đã gặp)', byBoth === 0, byBoth);

    const found = await findTaskRow(page, 'Install CapCut Web Desktop', 210)
      .then(() => 'ok')
      .catch((e: unknown) => (e as Error).message);
    check('findTaskRow vẫn tìm được dòng khi reward lệch', found === 'ok', found);

    // Bảo đảm cũ phải còn: title trùng 2 dòng thì KHÔNG được bốc bừa.
    const ambiguous = await findTaskRow(page, 'Chat with AI agent', 12345)
      .then(() => 'KHÔNG ném — bảo đảm chống nhầm đã mất')
      .catch(() => 'ném');
    check('title trùng 2 dòng + reward không khớp thì vẫn NÉM', ambiguous === 'ném', ambiguous);

    await close();
  }

  // ------------------- node toolbar: nút Export nhận bằng tooltip nên không ra
  /**
   * Đo được lúc 2026-09-04 05:55: node toolbar có ĐÚNG 5 nút — tức là trạng thái
   * "khoẻ" theo tương quan đã đo (`nút thứ 3/5` → `do_action err_no=0` 6/6 lượt)
   * — nhưng `findExportButton` vẫn ném "Không nhận ra nút Export trong 5 nút
   * (đã soi tooltip từng nút)": không nút nào cho tooltip khớp `/export/i`.
   *
   * DOM có sẵn một mỏ neo KHÔNG hash và không cần hover:
   *   <button data-testid="studio-node-export-trigger" ...>
   *
   * Cẩn thận: trong cùng trang còn `data-testid="global-export-trigger"` — export
   * cấp TRANG, không phải của node. Nên phải khoá đúng `studio-node-export-trigger`.
   */
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-node-toolbar-export.html');
    const n = counter(page);
    console.log('\n=== node toolbar @05:55 — Export không nhận ra bằng tooltip ===');

    check('node toolbar có đúng 5 nút (trạng thái ảnh đã vẽ xong)',
      (await n('.react-flow__node-toolbar button')) === 5,
      await n('.react-flow__node-toolbar button'));
    check('có đúng 1 [data-testid="studio-node-export-trigger"] trong cả trang',
      (await n('[data-testid="studio-node-export-trigger"]')) === 1,
      await n('[data-testid="studio-node-export-trigger"]'));
    check('nút đó nằm TRONG node toolbar',
      (await n('.react-flow__node-toolbar [data-testid="studio-node-export-trigger"]')) === 1);
    check('KHÔNG được nhầm với global-export-trigger (export cấp trang)',
      (await n('.react-flow__node-toolbar [data-testid="global-export-trigger"]')) === 0);

    const said: string[] = [];
    const env = { page, log: (m: string) => said.push(m) } as unknown as CapcutMissionEnv;
    const btn = await findExportButton(page, env)
      .then((locator) => locator.evaluate((el) => el.getAttribute('data-testid')))
      .catch((e: unknown) => 'NÉM: ' + (e as Error).message);
    check('findExportButton tìm ra nút Export mà không cần tooltip',
      btn === 'studio-node-export-trigger', btn);

    /**
     * Toolbar của React Flow chỉ mọc cho node ĐANG được chọn. Lượt batch
     * 04/09/2026 (`francisczeno459`) báo "trong 0 nút của node toolbar" ngay sau
     * khi `Complete a generation` đã có `do_action err_no=0` — tức ảnh có rồi mà
     * toolbar không render. `ensureNodeToolbar` phải nhận ra trạng thái sẵn sàng
     * mà KHÔNG chọn lại node vô ích.
     */
    const quiet: string[] = [];
    const count = await ensureNodeToolbar(
      page,
      'ec97a52f-079a-436f-b733-035bebbcf18c',
      { page, log: (m: string) => quiet.push(m) } as unknown as CapcutMissionEnv
    ).catch((e: unknown) => 'NÉM: ' + (e as Error).message);
    check('toolbar đã có nút thì trả về số nút, không chọn lại node', count === 5, count);
    check('và không in dòng chọn lại nào', quiet.length === 0, quiet);

    await close();
  }

  // ---------------- node toolbar RỖNG: phải chọn lại node rồi mới chịu bỏ cuộc
  {
    const page = await browser.newPage();
    await page.setContent(
      '<div class="react-flow__node" data-id="n1" ' +
        'style="position:fixed;left:50px;top:50px;width:80px;height:80px"></div>' +
        '<div class="react-flow__node-toolbar"></div>'
    );
    console.log('\n=== node toolbar rỗng — chọn lại node trước khi bỏ cuộc ===');

    const said: string[] = [];
    const env = { page, log: (m: string) => said.push(m) } as unknown as CapcutMissionEnv;
    const err = await ensureNodeToolbar(page, 'n1', env, 2)
      .then(() => '')
      .catch((e: unknown) => (e as Error).message);

    check('toolbar rỗng thì NÉM, không trả về 0 nút', err.length > 0, err.slice(0, 80));
    check('lỗi nói rõ là toolbar không mọc nút, không phải "không nhận ra Export"',
      /toolbar không mọc nút nào/.test(err), err.slice(0, 90));
    check('đã thử chọn lại node đúng số lần', said.filter((m) => /chọn lại node/.test(m)).length === 2, said);

    await page.close();
  }

  // ------------------- bảng giá Pro phủ trang lúc Design Studio bấm Send canvas
  /**
   * Đo được lúc 2026-09-04 06:29: `capcut_web_design_studio_canvas_edit` báo
   * `canvas_send_no_effect` — và DOM lúc đó có `subscriptionModal-wrapper`
   * `display: block` cùng `lv-modal-mask` `display: block`. Send không thể tới
   * đích. Năng lực đóng bảng giá đã có từ 02/09 nhưng chỉ nằm trong
   * `missions/videoStudio.ts`, nên luồng Design Studio không gọi nó ở đâu cả.
   */
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-canvas-pricing-modal.html');
    const n = counter(page);
    console.log('\n=== Design Studio @06:29 — bảng giá Pro phủ trang lúc bấm Send ===');

    check('có subscriptionModal-wrapper đang display:block',
      (await n('[class*="subscriptionModal"][style*="display: block"]')) === 1,
      await n('[class*="subscriptionModal"][style*="display: block"]'));
    check('có mask modal trong DOM (React của trang có thể đã dọn khi fixture boot lại)',
      (await n('.lv-modal-mask')) >= 1, await n('.lv-modal-mask'));
    check('KHÔNG phải modal khảo sát (lỗi khác, cùng lớp)',
      (await n('.skip-mrkR37')) === 0);
    check('lúc đó chưa có "Stop generating" ⇒ generate chưa bao giờ bắt đầu',
      (await page.evaluate(() => document.body.innerText.includes('Stop generating'))) === false);

    const said: string[] = [];
    const closed = await closeBlockingPricingModal(page, (m) => said.push(m));
    check('DOM tĩnh không đóng được thì hàm trả false (không nói dối)', closed === false, closed);
    check('log nói rõ bảng giá VẪN mở', said.some((m) => /VẪN mở/.test(m)), said);

    await close();
  }

  // ------------------- modal "trang lỗi" của CapCut che nút Send message
  /**
   * Đo được lúc 2026-09-04 06:40: `capcut_web_design_studio_ai_chat` báo
   * "Không thấy nút Send message" — nhưng `aria-label="Send message"` CÓ trong
   * DOM. Thứ chặn nó là modal do chính CapCut bung ra:
   *
   *   页面异常 — 页面异常，请刷新页面重试   ("trang lỗi, hãy refresh rồi thử lại")
   *   [ Refresh ]
   *
   * Lần thứ BA trong ngày một mask `display: block` làm engine chỉ sai địa chỉ,
   * nên `ensurePageUsable` là chỗ duy nhất biết mọi thứ phủ trang, và modal lạ
   * thì nó ghi lại tiêu đề + dump chứ không đoán.
   */
  {
    const { page, close } = await open(browser, 'tools/fixtures/dom-page-error-modal.html');
    const n = counter(page);
    console.log('\n=== Design Studio @06:40 — modal "trang lỗi" che nút Send message ===');

    check('nút Send message CÓ trong DOM (báo "không thấy" là sai địa chỉ)',
      (await n('[aria-label="Send message"]')) === 1,
      await n('[aria-label="Send message"]'));
    // `>= 1`, không phải `=== 1`: fixture này khi được serve lại thì React của
    // trang tự boot và số mask dựng ra thay đổi giữa các lần chạy (đo được 1 và
    // 2). Điều cần khoá là CÓ mask phủ trang, không phải có mấy cái.
    check('có mask modal đang display:block',
      (await n('.lv-modal-mask[style*="display: block"]')) >= 1,
      await n('.lv-modal-mask[style*="display: block"]'));
    check('KHÔNG phải khảo sát, KHÔNG phải bảng giá (modal thứ ba)',
      (await n('.skip-mrkR37')) === 0 && (await n('[class*="subscriptionModal"]')) === 0);
    check('modal mang thông điệp trang lỗi của CapCut',
      (await page.evaluate(() => document.body.innerText.includes('页面异常'))) === true);

    const said: string[] = [];
    const blocked = await ensurePageUsable(page, (m) => said.push(m)).then(() => false, () => true);
    check('modal không dẹp được phải chặn caller, không tiếp tục thao tác', blocked);
    check('log nêu được thủ phạm thay vì im lặng',
      said.some((m) => /trang lỗi|chưa nhận diện/i.test(m)), said);

    await close();
  }

  // ---------------- assertHittable: element "visible" nhưng bị panel khác phủ
  /**
   * Occlusion không tái hiện được trên fixture (dump không có CSS ngoài), nên
   * dựng lại ĐÚNG hình học đã đo trên máy thật lúc 2026-09-02 17:40: nút Send
   * 32×32 của canvas nằm dưới panel "Design with AI".
   *
   * Đây là bài test bảo vệ đúng lớp lỗi đã ăn 22/22 lượt canvas_edit: click vào
   * element bị che KHÔNG hề báo lỗi khi dùng `page.mouse`.
   */
  {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="send" role="button" aria-label="Send message" ' +
        'style="position:fixed;left:100px;top:100px;width:32px;height:32px"></div>' +
        '<div id="cover" aria-label="Design with AI panel" ' +
        'style="position:fixed;left:0;top:0;width:400px;height:400px"></div>'
    );
    console.log('\n=== assertHittable — nút bị panel khác phủ ===');

    const errs: string[] = [];
    await assertHittable(page, page.locator('#send'), 'nut Send canvas').catch((e: unknown) => {
      errs.push((e as Error).message);
    });
    check('nút bị phủ thì assertHittable NÉM (không click mù)', errs.length === 1, errs.length);
    check(
      'lỗi nói rõ ai đang che',
      /Design with AI panel/.test(errs[0] ?? ''),
      (errs[0] ?? '').slice(0, 100)
    );

    await page.evaluate(() => document.getElementById('cover')?.remove());
    const clear = await assertHittable(page, page.locator('#send'), 'nut Send canvas')
      .then(() => true)
      .catch(() => false);
    check('bỏ panel phủ thì assertHittable cho qua', clear === true);

    await page.close();
  }

  await browser.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('LỖI:', (e as Error).message);
  process.exit(1);
});
