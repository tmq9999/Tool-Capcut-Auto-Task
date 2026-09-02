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

    const areaH = await page.evaluate(
      () => Math.round(document.querySelector('#graphic-editor-render')!.getBoundingClientRect().height)
    );
    check('#graphic-editor-render có kích thước thật để click', areaH > 300, areaH);

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
    check('lúc đó KHÔNG có node ảnh mới nào', (await n('.react-flow__node[data-id]')) === 0, await n('.react-flow__node[data-id]'));

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
