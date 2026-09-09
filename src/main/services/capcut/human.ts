/**
 * =============================================================================
 * HÀNH VI "NGƯỜI THẬT" — DÙNG CHUNG CHO MỌI SCRIPT
 * =============================================================================
 * Control DOM dùng native locator-first click với actionability, timeout và
 * signal huỷ của trình duyệt; không tự vẽ quỹ đạo pointer cho DOM controls.
 * Vẫn giữ delay bấm, khoảng dừng và nhịp gõ theo pace người dùng đã đo.
 *
 * Toàn bộ tương tác trong dự án PHẢI đi qua các hàm ở file này.
 * =============================================================================
 */

import type { Locator, Page } from 'playwright-core';
import { abortableDelay, boundedDomRead, DomReadTimeoutError, isDomReadTimeout } from './cancellation';
import type { AccountUiInteraction } from './types';

export interface HumanInteractionOptions {
  signal: AbortSignal;
  stage: string;
  ui: AccountUiInteraction;
  log?: (message: string) => void;
  preserveFocus?: boolean;
}

export function foregroundPage<T>(
  page: Page,
  options: Pick<HumanInteractionOptions, 'signal' | 'stage' | 'ui'>,
  operation: () => Promise<T>
): Promise<T> {
  if (!options?.ui) throw new Error('UI_INTERACTION_REQUIRED');
  const { signal, stage, ui } = options;
  signal.throwIfAborted();
  return ui.foreground(stage, async () => {
    signal.throwIfAborted();
    if (ui.focusMode !== 'target') {
      await boundedDomRead(() => page.bringToFront(), stage + ':focus', 5000, signal);
    }
    signal.throwIfAborted();
    return operation();
  });
}

function command<T>(run: () => Promise<T>, phase: string, ms: number, options: HumanInteractionOptions): Promise<T> {
  options.signal.throwIfAborted();
  const stage = options.stage;
  if (phase !== 'mouse-move' && phase !== 'type') options.log?.('Browser command: ' + stage + ':' + phase);
  return boundedDomRead(run, stage + ':' + phase, ms, options.signal);
}

function pause(ms: number, options: HumanInteractionOptions): Promise<void> {
  return abortableDelay(ms, options.signal);
}

function rethrowInterrupted(error: unknown, options: HumanInteractionOptions): void {
  options.signal.throwIfAborted();
  if (isDomReadTimeout(error)) throw error;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** Lấy 1 phần tử ngẫu nhiên trong danh sách (dùng cho prompt / link mẫu) */
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function humanClickUnlocked(
  page: Page,
  locator: Locator,
  options: HumanInteractionOptions
): Promise<void> {
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

async function humanTypeUnlocked(
  page: Page,
  locator: Locator,
  text: string,
  perChar: PerCharDelay | undefined,
  options: HumanInteractionOptions
): Promise<void> {
  const { minMs, maxMs } = perCharDelayRange(perChar);
  const alreadyFocused = options.preserveFocus && await command(() => locator.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    return (element as HTMLElement).isContentEditable &&
      !element.closest('[inert], [aria-hidden="true"]') &&
      element.ownerDocument.activeElement === element &&
      Boolean(selection?.rangeCount && selection.isCollapsed &&
        element.contains(selection.anchorNode) && element.contains(selection.focusNode));
  }), 'focused-editor', 1000, options);
  if (!alreadyFocused) await humanClickUnlocked(page, locator, options);
  await pause(rand(150, 350), options);
  options.log?.('Browser command: ' + options.stage + ':type');
  for (const ch of text) {
    const delay = rand(minMs, maxMs);
    await command(() => page.keyboard.type(ch, { delay }), 'type', delay + 5000, options);
    // Thỉnh thoảng "suy nghĩ" một nhịp như người thật
    if (Math.random() < 0.08) await pause(rand(200, 500), options);
  }
  await pause(rand(250, 600), options);
}

/** Click locator có actionability, delay bấm và khoảng dừng trước/sau. */
export function humanClick(
  page: Page,
  locator: Locator,
  options: HumanInteractionOptions
): Promise<void> {
  return foregroundPage(page, options, () =>
    humanClickUnlocked(page, locator, options)
  );
}

/** Gõ chữ theo nhịp người thật vào editor (tiptap / contenteditable / input) */
export function humanType(
  page: Page,
  locator: Locator,
  text: string,
  perChar: PerCharDelay | undefined,
  options: HumanInteractionOptions
): Promise<void> {
  return foregroundPage(page, options, () =>
    humanTypeUnlocked(page, locator, text, perChar, options)
  );
}

/**
 * Kiểm tra element có đang bị vô hiệu hoá.
 * CapCut thể hiện trạng thái disabled bằng 3 cách khác nhau tuỳ component:
 *   - class chứa `disabled-<hash>`  (VD: `button-cmQyUp solid-x1 disabled-Hh2vSs`)
 *   - `aria-disabled="true"`
 *   - thuộc tính `disabled` của <button>
 */
export async function isDisabled(locator: Locator, signal?: AbortSignal, timeoutMs = 1000): Promise<boolean> {
  const read = () => locator
    .evaluate((el: Element) => {
      const cls = el.getAttribute('class') ?? '';
      if (/disabled/i.test(cls)) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if ((el as HTMLButtonElement).disabled === true) return true;
      return false;
    });
  return (signal ? boundedDomRead(read, 'enabled-check', timeoutMs, signal) : read())
    .catch(error => {
      signal?.throwIfAborted();
      if (isDomReadTimeout(error)) throw error;
      return false;
    });
}

/** Chờ tới khi element hết disabled. Trả về false nếu quá thời gian vẫn disabled. */
export async function waitEnabled(locator: Locator, timeoutMs = 15000, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isDisabled(locator, signal, Math.min(1000, deadline - Date.now())))) return true;
    const delay = Math.max(0, Math.min(500, deadline - Date.now()));
    if (signal) await abortableDelay(delay, signal);
    else await sleep(delay);
  }
  return false;
}

/** Click nếu element xuất hiện; trả về true nếu đã click. Không ném lỗi. */
export async function clickIfVisible(
  page: Page,
  locator: Locator,
  timeout = 2500,
  options: HumanInteractionOptions
): Promise<boolean> {
  options.signal.throwIfAborted();
  const visible = await locator
    .first()
    .isVisible({ timeout })
    .catch((error: unknown) => {
      rethrowInterrupted(error, options);
      return false;
    });
  if (!visible) return false;
  return humanClick(page, locator.first(), options)
    .then(() => true)
    .catch((error: unknown) => {
      rethrowInterrupted(error, options);
      return false;
    });
}

/**
 * Đóng các popup hướng dẫn / onboarding hay chen ngang (Got it, Skip, Next...).
 * Trả về số popup đã đóng.
 */
export async function dismissOverlays(
  page: Page,
  options: HumanInteractionOptions
): Promise<number> {
  const { signal } = options;
  signal.throwIfAborted();
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
    signal.throwIfAborted();
    const loc = page.locator(sel).first();
    const visible = await loc.isVisible({ timeout: 600 }).catch((error: unknown) => {
      rethrowInterrupted(error, options);
      return false;
    });
    if (visible) {
      const clicked = await foregroundPage(page, options, () => loc.click({ timeout: 2500 }))
        .then(() => true)
        .catch((error: unknown) => {
          rethrowInterrupted(error, options);
          return false;
        });
      if (!clicked) continue;
      closed++;
      await pause(rand(400, 800), options);
    }
  }
  return closed;
}
