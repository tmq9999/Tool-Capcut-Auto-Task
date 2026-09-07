/**
 * =============================================================================
 * HAI NHIỆM VỤ ĐƠN GIẢN — PWA install + bật thông báo
 * =============================================================================
 * Hai nhiệm vụ này ở bản cũ ĐÃ chạy đúng. Ở đây chỉ bọc lại thành MissionGroup
 * để đi qua cổng chứng minh `do_action`, và để popover luôn được đóng lại sau
 * khi dùng (bản cũ mở rồi bỏ đó, popover che canvas làm hỏng Design Studio).
 *
 * Lượt làm tay cho thấy đúng trình tự này: bấm "Go" trong popover trước, rồi
 * hành động kỹ thuật, rồi `do_action` bắn ra sau 1–2 giây.
 * =============================================================================
 */

import type { Page } from 'playwright-core';

import { mustSee } from '../diag';
import { clickIfVisible, foregroundPage, rand } from '../human';
import { findTaskRow, withTaskPopover, type MissionGroup } from '../missionRunner';
import type { CapcutMissionEnv } from '../types';
import { URLS } from '../urls';
import { abortable, abortableDelay } from '../cancellation';

/** Bấm nút "Go" của đúng dòng nhiệm vụ rồi đóng popover lại. */
/**
 * Như `clickGo` nhưng trên MỘT TRANG CHỈ ĐỊNH — nhiệm vụ bật thông báo làm việc
 * trên tab mới của riêng nó, không phải `env.page`.
 */
/**
 * Nhãn nút của dòng nhiệm vụ quyết định phải làm gì.
 *
 * `Claim` KHÔNG phải trạng thái để bỏ qua: nó nghĩa là CapCut đã ghi nhận hành
 * động (do_action bắn từ trước) và đang chờ nhận thưởng. Bản cũ chỉ bấm khi nhãn
 * là `Go`, nên `capcut_web_push_authorize` đứng mãi ở đó rồi timeout 45 giây —
 * đo 04/09/2026, xem `__tests__/simple.test.ts`.
 */
export function decideRowAction(buttonText: string): 'go' | 'claim' | 'skip' {
  const text = buttonText.trim();
  if (/^go$/i.test(text)) return 'go';
  if (/^claim$/i.test(text)) return 'claim';
  return 'skip';
}

async function clickGoOnPage(
  page: Page,
  env: CapcutMissionEnv,
  taskKey: string,
  title: string,
  afterClick?: () => Promise<void>
): Promise<void> {
  // `env.log` PHẢI truyền vào: chẩn đoán của `withTaskPopover` (bấm lối vào nào,
  // sau mỗi lần bấm popover có mấy dòng) mặc định là no-op. Lượt chạy thật
  // 2026-09-03 02:5x mất đúng những dòng đó nên không biết mắt xích nào đứt khi
  // `pwa_install` báo "tìm dòng ... ra 0 kết quả".
  await withTaskPopover(page, async () => {
    env.signal.throwIfAborted();
    const row = await findTaskRow(page, taskKey, title, env.log);
    const btn = row.locator('button').first();
    const text = (await btn.innerText().catch(() => '')).trim();

    switch (decideRowAction(text)) {
      case 'go':
        await foregroundPage(page, { signal: env.signal, stage: 'simple:click-go', ui: env.ui }, () =>
          abortable(btn.click({ timeout: 8000 }), env.signal)
        );
        await abortableDelay(rand(1800, 2600), env.signal);
        env.log(`Đã bấm Go ở dòng "${title}"`);
        break;
      case 'claim':
        // Nút đã là Claim ⇒ do_action bắn từ trước, chờ nó lần nữa là chờ vô ích.
        // Bấm Claim chỉ là THAO TÁC UI; kết luận xong vẫn do snapshot của CapCut.
        await foregroundPage(page, { signal: env.signal, stage: 'simple:click-claim', ui: env.ui }, () =>
          abortable(btn.click({ timeout: 8000 }), env.signal)
        );
        await abortableDelay(rand(1800, 2600), env.signal);
        env.log(`Đã bấm Claim ở dòng "${title}" (CapCut đã ghi nhận hành động từ trước)`);
        break;
      default:
        env.log(`Nút của "${title}" đang là "${text || 'N/A'}", không bấm gì`);
        return;
    }
    env.signal.throwIfAborted();
    await afterClick?.();
  }, env.log, { signal: env.signal, ui: env.ui });
}

export const notificationsGroup: MissionGroup = {
  id: 'notifications',
  name: 'Bật thông báo trình duyệt',
  workspace: 'none',
  keys: ['capcut_web_push_authorize'],
  proofTimeoutMs: 20_000,
  async act(env: CapcutMissionEnv): Promise<void> {
    env.signal.throwIfAborted();
    // Công thức này đo được bằng thí nghiệm sống 2026-09-02 04:25, sau khi hai
    // cách khác đều thất bại. Ba điều kiện phải đủ:
    //   1. quyền notifications được cấp (override CDP chỉ sống theo phiên kết nối)
    //   2. TRANG MỚI: CapCut chỉ đánh giá lại Notification.permission lúc khởi tạo
    //   3. click vào chính DÒNG nhiệm vụ, không phải nút "Go"
    await env.context
      .grantPermissions(['notifications'], { origin: 'https://www.capcut.com' })
      .catch((e: unknown) => env.log(`Không cấp được quyền notifications: ${(e as Error).message}`));

    const page = await env.context.newPage();
    try {
      env.signal.throwIfAborted();
      await abortable(page.goto(URLS.tasks, { waitUntil: 'domcontentloaded', timeout: 20_000 }), env.signal);
      await abortableDelay(rand(6000, 8000), env.signal);

      const perm = await page
        .evaluate(() => (typeof Notification !== 'undefined' ? Notification.permission : 'n/a'))
        .catch(() => 'n/a');
      env.log(`Notification.permission = ${perm}`);

      /**
       * "Push authorize" có thể không chỉ là quyền: CapCut còn phải SUBSCRIBE
       * push qua service worker. Nếu proxy chặn endpoint push thì quyền vẫn
       * `granted` mà nhiệm vụ không bao giờ được ghi nhận — và cách hỏng đó
       * không phân biệt được với "popover không mở".
       *
       * jksqtiqa24961 trượt nhiệm vụ này 3 lượt liền (2026-09-02) trong khi
       * pthxdszn65494 xong ngay, nên phải đo cả hai mặt trước khi sửa tiếp.
       */
      const push = await page
        .evaluate(async () => {
          if (!('serviceWorker' in navigator)) return { sw: 'không hỗ trợ', regs: 0, sub: null };
          const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
          for (const r of regs) {
            const s = await r.pushManager.getSubscription().catch(() => null);
            if (s) return { sw: 'ok', regs: regs.length, sub: true };
          }
          return { sw: 'ok', regs: regs.length, sub: null };
        })
        .catch((e: unknown) => ({ sw: `lỗi: ${(e as Error).message.slice(0, 60)}`, regs: 0, sub: null }));
      env.log(`Push subscription: ${JSON.stringify(push)}`);

      /**
       * CapCut còn một lối nữa cho ĐÚNG nhiệm vụ này: thanh alert đầu trang
       * "Allow notifications from CapCut?" kèm nút Allow — thấy trong
       * `.debug/004_no_task_list.html`:
       *
       *   <div class="lv-workspace-alert-bar"><div class="lvv-alert" …>
       *     <span class="notification-prompt__message"><strong>Allow
       *     notifications from CapCut?</strong>…</span>
       *     <button class="lv-btn lv-btn-primary … lvv-alert__body__action-button">
       *       <span …>Allow</span></button>
       *
       * Bấm nó chính là "Allow Notifications cho capcut.com" như tài liệu mô tả,
       * và không cần popover. Quyền đã được cấp qua CDP nên Chrome không hỏi lại.
       * Thanh này có thể đang thu gọn (`height: 0px`) — lúc đó bỏ qua.
       */
      const allow = page
        .locator('[class*="lvv-alert__body__action-button"]')
        .filter({ hasText: /^Allow$/ })
        .first();
      if (await clickIfVisible(page, allow, 3000, { signal: env.signal, stage: 'notifications:allow-alert', ui: env.ui })) {
        env.log('Đã bấm Allow ở thanh "Allow notifications from CapCut?"');
        await abortableDelay(rand(2000, 3000), env.signal);
      }

      /**
       * BẤM "Go" TRƯỚC, RỒI MỚI CLICK DÒNG — theo đúng lượt làm tay 12/12.
       *
       * Comment cũ ở đầu hàm nói "click vào chính DÒNG nhiệm vụ, không phải nút
       * Go". Đo lại trên `.capture/2026-09-01-21-50-27` (lượt làm tay đạt 12/12)
       * thì thứ tự thật là:
       *
       *   [03:04] mở popover                      (label "Free credits")
       *   [03:09] task-popover  action  "Go"      ← BẤM GO
       *   [03:21] mở popover lại
       *   [03:34] mở popover lại
       *   [03:36] task-popover  taskLine  "Enable browser notifications"
       *   [03:37] do_action capcut_web_push_authorize err_no=0   ✅
       *   [03:38] task-popover  action  "Claim"
       *
       * Nghĩa là "Go" là bước khởi động luồng cấp quyền của CapCut; chỉ click
       * dòng mà chưa từng bấm Go thì không có gì được ghi nhận — đúng hiện tượng
       * của app ở 4 lượt chạy thật (popover mở 10 dòng, dòng đã click, vẫn không
       * có do_action sau 45 giây).
       */
      await clickGoOnPage(page, env, 'capcut_web_push_authorize', 'Enable browser notifications');

      await withTaskPopover(page, async () => {
        env.signal.throwIfAborted();
        const line = await mustSee(
          page,
          page.locator('[class*="taskLine"]').filter({ hasText: 'Enable browser notifications' }),
          'dong nhiem vu Enable browser notifications'
        );
        // force: element hiển thị nhưng Playwright coi là chưa actionable
        await foregroundPage(page, { signal: env.signal, stage: 'notifications:click-line', ui: env.ui }, () =>
          abortable(line.click({ timeout: 8000, force: true }), env.signal)
        );
        env.log('Đã click dòng nhiệm vụ thông báo');
      }, env.log, { signal: env.signal, ui: env.ui });

      // do_action bắn ~1 giây sau; chờ rồi mới đóng tab để không huỷ request.
      await abortableDelay(rand(8000, 10000), env.signal);
    } finally {
      await page.close().catch(() => {});
      await foregroundPage(env.page, { signal: env.signal, stage: 'notifications:restore-focus', ui: env.ui }, async () => {
        await env.page.bringToFront().catch(() => {});
      }).catch(() => {});
    }
  },
};

export const pwaInstallGroup: MissionGroup = {
  id: 'pwa-install',
  name: 'Cài CapCut Web Desktop',
  workspace: 'none',
  keys: ['capcut_web_pwa_install'],
  proofTimeoutMs: 12_000,
  async act(env: CapcutMissionEnv): Promise<void> {
    env.signal.throwIfAborted();
      await clickGoOnPage(env.page, env, 'capcut_web_pwa_install', 'Install CapCut Web Desktop', async () => {
      env.signal.throwIfAborted();

      // Keep the measured PWA action in the same document as the Go click.
      await env.page.evaluate(() => {
        const dp = (window as unknown as { deferredPrompt?: { prompt?: () => void } }).deferredPrompt;
        if (dp && typeof dp.prompt === 'function') {
          try {
            dp.prompt();
          } catch {
            // The one-shot prompt may already have been used.
          }
        }
        window.dispatchEvent(new Event('appinstalled'));
        document.dispatchEvent(new Event('appinstalled'));
      });
      env.log('Đã gọi deferredPrompt + phát sự kiện appinstalled');
      await abortableDelay(rand(2500, 3500), env.signal);
    });
  },
};
