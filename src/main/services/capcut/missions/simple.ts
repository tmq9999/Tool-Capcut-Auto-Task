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

import { mustSee } from '../diag';
import { clickIfVisible, rand } from '../human';
import { findTaskRow, withTaskPopover, type MissionGroup } from '../missionRunner';
import type { CapcutMissionEnv } from '../types';
import { URLS } from '../urls';

/** Bấm nút "Go" của đúng dòng nhiệm vụ rồi đóng popover lại. */
async function clickGo(env: CapcutMissionEnv, title: string, reward: number): Promise<void> {
  await withTaskPopover(env.page, async () => {
    const row = await findTaskRow(env.page, title, reward);
    const btn = row.locator('button').first();
    const text = (await btn.innerText().catch(() => '')).trim();
    // Nút có thể đã là Done/Tomorrow nếu nhiệm vụ vừa xong ở lần thử trước.
    if (/^go$/i.test(text)) {
      await btn.click({ timeout: 8000 }).catch(() => {});
      await env.page.waitForTimeout(rand(1800, 2600));
    } else {
      env.log(`Nút của "${title}" đang là "${text || 'N/A'}", không bấm Go`);
    }
  });
}

export const notificationsGroup: MissionGroup = {
  name: 'Bật thông báo trình duyệt',
  keys: ['capcut_web_push_authorize'],
  proofTimeoutMs: 45000,
  async act(env: CapcutMissionEnv): Promise<void> {
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
      await page.goto(URLS.main, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(rand(6000, 8000));

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
            if (s) return { sw: 'ok', regs: regs.length, sub: s.endpoint.slice(0, 60) };
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
      if (await clickIfVisible(page, allow, 3000)) {
        env.log('Đã bấm Allow ở thanh "Allow notifications from CapCut?"');
        await page.waitForTimeout(rand(2000, 3000));
      }

      await withTaskPopover(page, async () => {
        const line = await mustSee(
          page,
          page.locator('[class*="taskLine"]').filter({ hasText: 'Enable browser notifications' }),
          'dong nhiem vu Enable browser notifications'
        );
        // force: element hiển thị nhưng Playwright coi là chưa actionable
        await line.click({ timeout: 8000, force: true });
        env.log('Đã click dòng nhiệm vụ thông báo');
      });

      // do_action bắn ~1 giây sau; chờ rồi mới đóng tab để không huỷ request.
      await page.waitForTimeout(rand(8000, 10000));
    } finally {
      await page.close().catch(() => {});
      await env.page.bringToFront().catch(() => {});
    }
  },
};

export const pwaInstallGroup: MissionGroup = {
  name: 'Cài CapCut Web Desktop',
  keys: ['capcut_web_pwa_install'],
  proofTimeoutMs: 45000,
  async act(env: CapcutMissionEnv): Promise<void> {
    await clickGo(env, 'Install CapCut Web Desktop', 210);

    // Dialog cài PWA của Chrome không click được qua CDP; cách đáng tin cậy là
    // gọi `deferredPrompt` mà CapCut đã lưu rồi phát sự kiện `appinstalled`.
    await env.page.evaluate(() => {
      const dp = (window as unknown as { deferredPrompt?: { prompt?: () => void } }).deferredPrompt;
      if (dp && typeof dp.prompt === 'function') {
        try {
          dp.prompt();
        } catch {
          // prompt đã dùng rồi -> bỏ qua, sự kiện dưới vẫn được phát.
        }
      }
      window.dispatchEvent(new Event('appinstalled'));
      document.dispatchEvent(new Event('appinstalled'));
    });
    env.log('Đã gọi deferredPrompt + phát sự kiện appinstalled');
    await env.page.waitForTimeout(rand(2500, 3500));
  },
};
