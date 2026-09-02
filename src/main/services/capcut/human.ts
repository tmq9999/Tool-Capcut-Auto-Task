/**
 * =============================================================================
 * HÀNH VI "NGƯỜI THẬT" — DÙNG CHUNG CHO MỌI SCRIPT
 * =============================================================================
 * CapCut chạy Shark Risk Control (ByteDance): nó chấm điểm quỹ đạo chuột, độ
 * trễ giữa các phím và thời gian dừng trước khi click. Click bằng
 * `locator.click()` thuần (teleport chuột, 0ms delay) rất dễ bị chặn khi
 * grant_reward → trả về err_no 8001003.
 *
 * Toàn bộ tương tác trong dự án PHẢI đi qua các hàm ở file này.
 * =============================================================================
 */

import type { Locator, Page } from 'playwright-core';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** Lấy 1 phần tử ngẫu nhiên trong danh sách (dùng cho prompt / link mẫu) */
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * Di chuyển chuột theo đường cong ease-in-out có nhiễu nhỏ (mô phỏng rung tay).
 * Điểm bắt đầu ngẫu nhiên để mỗi lần chạy có quỹ đạo khác nhau.
 */
export async function humanMouseMove(page: Page, tx: number, ty: number): Promise<void> {
  const sx = rand(80, 400);
  const sy = rand(80, 400);
  const steps = 22 + Math.floor(rand(0, 10));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = sx + (tx - sx) * ease + Math.sin(t * Math.PI) * rand(-4, 4);
    const y = sy + (ty - sy) * ease + Math.cos(t * Math.PI) * rand(-3, 3);
    await page.mouse.move(x, y);
    await sleep(rand(8, 20));
  }
  await page.mouse.move(tx, ty);
}

/** Click kiểu người thật: cuộn tới → hover → dừng → mousedown → dừng → mouseup */
export async function humanClick(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox().catch(() => null);

  // Không lấy được toạ độ (element ẩn/0 kích thước) → dùng click thường
  if (!box || box.width === 0 || box.height === 0) {
    await locator.click({ timeout: 8000 });
    return;
  }

  const tx = box.x + box.width / 2 + rand(-3, 3);
  const ty = box.y + box.height / 2 + rand(-2, 2);

  await humanMouseMove(page, tx, ty);
  await sleep(rand(180, 420));
  await page.mouse.down();
  await sleep(rand(70, 150));
  await page.mouse.up();
  await sleep(rand(250, 500));
}

/**
 * SÀN nhịp gõ — `45–130ms` mỗi ký tự.
 *
 * Đây là khoảng ĐÃ ĐO trên lượt 13 account thành công, không phải tham số tuỳ ý:
 * Shark Risk Control chấm điểm chính độ trễ giữa các phím, và bản gõ nhanh hơn
 * bị trả `err_no 8001003` khi claim thưởng (docs/AUTOMATION-ENGINE.md §5). Nên
 * ô cấu hình của người dùng chỉ được làm CHẬM hơn khoảng này, không bao giờ
 * nhanh hơn.
 */
const TYPE_FLOOR_MIN_MS = 45;
const TYPE_FLOOR_MAX_MS = 130;

/** Nhịp gõ mỗi ký tự mà người gọi muốn (ms). */
export interface PerCharDelay {
  minMs: number;
  maxMs: number;
}

/**
 * Kẹp nhịp gõ của người dùng lên trên SÀN đã đo.
 *
 * `max` lấy `Math.max(min, ...)` để một cấu hình ngược (max < min) vẫn không
 * bao giờ gõ nhanh hơn `min`. Không truyền gì thì ra đúng `45–130ms` như trước,
 * nên hành vi cũ không đổi.
 */
export function perCharDelayRange(perChar?: PerCharDelay): PerCharDelay {
  const minMs = Math.max(TYPE_FLOOR_MIN_MS, perChar?.minMs ?? 0);
  const maxMs = Math.max(minMs, TYPE_FLOOR_MAX_MS, perChar?.maxMs ?? 0);
  return { minMs, maxMs };
}

/** Gõ chữ theo nhịp người thật vào editor (tiptap / contenteditable / input) */
export async function humanType(
  page: Page,
  locator: Locator,
  text: string,
  perChar?: PerCharDelay
): Promise<void> {
  const { minMs, maxMs } = perCharDelayRange(perChar);
  await humanClick(page, locator);
  await sleep(rand(150, 350));
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: rand(minMs, maxMs) });
    // Thỉnh thoảng "suy nghĩ" một nhịp như người thật
    if (Math.random() < 0.08) await sleep(rand(200, 500));
  }
  await sleep(rand(250, 600));
}

/**
 * Kiểm tra element có đang bị vô hiệu hoá.
 * CapCut thể hiện trạng thái disabled bằng 3 cách khác nhau tuỳ component:
 *   - class chứa `disabled-<hash>`  (VD: `button-cmQyUp solid-x1 disabled-Hh2vSs`)
 *   - `aria-disabled="true"`
 *   - thuộc tính `disabled` của <button>
 */
export async function isDisabled(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((el: Element) => {
      const cls = el.getAttribute('class') ?? '';
      if (/disabled/i.test(cls)) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if ((el as HTMLButtonElement).disabled === true) return true;
      return false;
    })
    .catch(() => false);
}

/** Chờ tới khi element hết disabled. Trả về false nếu quá thời gian vẫn disabled. */
export async function waitEnabled(locator: Locator, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isDisabled(locator))) return true;
    await sleep(500);
  }
  return false;
}

/** Click nếu element xuất hiện; trả về true nếu đã click. Không ném lỗi. */
export async function clickIfVisible(page: Page, locator: Locator, timeout = 2500): Promise<boolean> {
  const visible = await locator
    .first()
    .isVisible({ timeout })
    .catch(() => false);
  if (!visible) return false;
  await humanClick(page, locator.first()).catch(() => {});
  return true;
}

/**
 * Đóng các popup hướng dẫn / onboarding hay chen ngang (Got it, Skip, Next...).
 * Trả về số popup đã đóng.
 */
export async function dismissOverlays(page: Page): Promise<number> {
  const candidates = [
    'button:has-text("Got it")',
    'div[role="button"]:text-is("Got it")',
    'button:has-text("Skip")',
    'button:has-text("Maybe later")',
    'button:has-text("Not now")',
    '[class*="cta-"]:has-text("Got it")',
    'button[aria-label="Close"]',
    '[class*="closeIcon"]',
  ];

  let closed = 0;
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 600 }).catch(() => false)) {
      await loc.click({ timeout: 2500 }).catch(() => {});
      closed++;
      await sleep(rand(400, 800));
    }
  }
  return closed;
}
