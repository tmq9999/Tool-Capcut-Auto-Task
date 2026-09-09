/**
 * =============================================================================
 * DIAG — FAIL LOUD
 * =============================================================================
 * Bản cũ có 114 chỗ `.catch(() => false)`. Kết quả: proxy chết, selector đổi và
 * trang chưa load xong đều in ra cùng một câu "không thấy element", nên log
 * không bao giờ nói thật chuyện gì đã xảy ra.
 *
 * File này cung cấp ba thứ:
 *   - `mustSee`      điều kiện tiên quyết: không thấy thì NÉM, kèm ảnh + DOM
 *   - `assertNotInert` / `waitNotInert`  chặn click vào vùng inert
 *   - `attachNetDiag`  lỗi mạng hiện đúng tên nó
 * =============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright-core';
import { abortableDelay, boundedDomRead, DomReadTimeoutError, withinDeadline } from './cancellation';
import { SessionEvidenceBudget } from './evidenceBudget';

export type NetErrorKind = 'proxy' | 'dns' | 'timeout' | 'other';

/** Phân loại lỗi mạng của Chromium để nó không đội lốt lỗi selector. */
export function classifyNetError(errorText: string): NetErrorKind {
  if (/PROXY|TUNNEL/i.test(errorText)) return 'proxy';
  if (/NAME_NOT_RESOLVED|DNS/i.test(errorText)) return 'dns';
  if (/TIMED_OUT|TIMEOUT/i.test(errorText)) return 'timeout';
  return 'other';
}

/** Lỗi của một bước, mang theo tên dump để tra lại hiện trường. */
export class StepError extends Error {
  constructor(
    message: string,
    readonly dumpName: string | null = null
  ) {
    super(message);
    this.name = 'StepError';
  }
}

export interface NetIssue {
  kind: NetErrorKind;
  errorText: string;
  url: string;
  at: number;
}

let dumpSeq = 0;
let dumpRoot: string | null = null;

/**
 * Nơi ghi hiện trường.
 *
 * Engine CLI ghi thẳng vào `.debug/` của cwd. App đóng gói thì KHÔNG ghi được
 * vào cwd, nên main process phải gọi
 * `setDumpDir(path.join(app.getPath('userData'), 'debug'))` một lần lúc khởi
 * động. Để trống thì rơi về `.debug/` — nhờ vậy `npm run selectors` và test
 * thuần vẫn chạy được ngoài Electron.
 */
export function setDumpDir(dir: string): void {
  dumpRoot = dir;
}

export function getDumpDir(): string {
  return dumpRoot ?? path.resolve('.debug');
}

export interface StepScreenshotOptions {
  runId: string;
  sessionId: string;
  stepId: string;
  phase: 'before' | 'after';
  budget: SessionEvidenceBudget;
  responsiveSafe: boolean;
}

export interface StepScreenshotResult extends StepScreenshotOptions { filePath: string; bytes: number; }

/** Capture a screenshot only at an explicitly safe, responsive step boundary. */
export async function captureStepScreenshot(page: Page, options: StepScreenshotOptions): Promise<StepScreenshotResult | null> {
  if (!options.responsiveSafe || page.isClosed?.()) return null;
  const alias = (value: string, fallback: string) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value) ? value : fallback;
  const runId = alias(options.runId, 'run');
  const sessionId = alias(options.sessionId, 'session');
  const stepId = alias(options.stepId, 'step');
  try {
    const image = await withinDeadline(page.screenshot({ timeout: 1500 }), 1500);
    const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image as Uint8Array);
    const reservation = options.budget.reserve('screenshot', buffer.byteLength);
    if (!reservation) return null;
    const dir = path.join(getDumpDir(), runId, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${stepId}-${options.phase}-${randomScreenshotId()}.png`);
    fs.writeFileSync(filePath, buffer, { flag: 'wx', mode: 0o600 });
    reservation.commit(buffer.byteLength);
    return { ...options, runId, sessionId, stepId, filePath, bytes: buffer.byteLength };
  } catch {
    return null;
  }
}

function randomScreenshotId(): string {
  dumpSeq++;
  return String(dumpSeq).padStart(3, '0');
}

/**
 * Số dump tối đa giữ lại trong thư mục hiện trường.
 *
 * `docs/MERGE-PLAN.md` yêu cầu ở Pha 1 và trong bảng rủi ro, nhưng chưa bao giờ
 * được làm: mỗi lỗi thêm một cặp `.png` + `.html` và không ai xoá. Thư mục này
 * nằm trong `userData` của người dùng nên phải có trần.
 */
export const MAX_DUMPS = 50;

/**
 * Giữ lại `keep` dump mới nhất, xoá phần cũ hơn.
 *
 * Đếm theo DUMP (cặp `.png` + `.html` cùng tên), không theo file — nếu đếm theo
 * file thì trần thực tế chỉ còn một nửa. Tên dump có tiền tố số tăng dần
 * (`NNN_label`) nên sắp theo tên là sắp theo thời gian.
 *
 * KHÔNG ném ra ngoài: dump là để điều tra sự cố, nó không được tự gây sự cố.
 * File đang bị Explorer/antivirus giữ là chuyện thường trên Windows.
 */
export function pruneDumps(dir: string, keep: number = MAX_DUMPS): void {
  try {
    const names = [...new Set(
      fs.readdirSync(dir)
        .filter((file) => /\.(png|html)$/i.test(file))
        .map((file) => file.replace(/\.(png|html)$/i, ''))
    )].sort();

    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      for (const ext of ['.png', '.html']) {
        try {
          fs.unlinkSync(path.join(dir, name + ext));
        } catch {
          // Một file không xoá được không được phép chặn phần còn lại.
        }
      }
    }
  } catch {
    // Thư mục chưa tồn tại hoặc không đọc được — không có gì để dọn.
  }
}

/** Ảnh + DOM đầy đủ vào thư mục dump; trả về tên file (không đuôi) hoặc null. */
export async function dump(page: Page, label: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const dir = getDumpDir();
    fs.mkdirSync(dir, { recursive: true });
    const safe = label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
    const name = `${String(++dumpSeq).padStart(3, '0')}_${safe}`;
    // Ảnh có thể chụp thất bại nếu tab đang điều hướng — DOM vẫn đáng giá.
    // Do not give an abandoned screenshot a path: a late response must not write.
    const png = await withinDeadline(page.screenshot({ timeout: 1500 }), 1500, signal).catch(() => null);
    signal?.throwIfAborted();
    if (png) fs.writeFileSync(path.join(dir, `${name}.png`), png);
    const html = await withinDeadline(page.content(), 1500, signal).catch(() => null);
    signal?.throwIfAborted();
    if (html) fs.writeFileSync(path.join(dir, `${name}.html`), html);
    // Dọn SAU khi ghi xong: dump vừa tạo phải nằm trong số được giữ lại.
    pruneDumps(dir);
    return png || html ? name : null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

/**
 * Điều kiện tiên quyết. Không thấy thì NÉM kèm dump, không trả về false.
 * Dùng cho mọi element mà thiếu nó thì bước sau vô nghĩa.
 */
export async function mustSee(
  page: Page,
  locator: Locator,
  what: string,
  timeoutMs = 15000,
  signal?: AbortSignal
): Promise<Locator> {
  signal?.throwIfAborted();
  const first = locator.first();
  const ok = await boundedDomRead(() => first.waitFor({ state: 'visible', timeout: timeoutMs }), 'visible:' + what, timeoutMs, signal)
    .then(() => true)
    .catch((error: unknown) => {
      signal?.throwIfAborted();
      if (error instanceof DomReadTimeoutError) throw error;
      return false;
    });
  if (!ok) {
    throw new StepError(`Không thấy ${what}`, await dump(page, `missing_${what}`, signal));
  }
  return first;
}

/**
 * Element nằm trong vùng `inert` thì click KHÔNG tới đích — Chrome giao event
 * cho ancestor không inert. `tools/verify-recorder.ts` đã chứng minh điều này
 * trên fixture, và nó chính là lý do "Edit on canvas" hỏng 10 lần.
 */
export async function assertNotInert(locator: Locator, what: string, signal?: AbortSignal): Promise<void> {
  const blocked = await boundedDomRead(
    () => locator.first().evaluate((el: Element) => !!el.closest('[inert]') || !!el.closest('[aria-hidden="true"]')),
    'inert-check', 1000, signal
  ).catch((error: unknown) => {
    signal?.throwIfAborted();
    if (error instanceof DomReadTimeoutError) throw error;
    return false;
  });
  if (blocked) {
    throw new StepError(`${what} đang trong vùng inert/aria-hidden — click sẽ không tới đích`);
  }
}

/**
 * `visible` KHÔNG có nghĩa là click tới được.
 *
 * `humanClick` dùng locator click với actionability của trình duyệt; helper
 * không còn tự bắn quỹ đạo qua `page.mouse`. Raw mouse không kiểm element nào
 * đang nằm trên, vì vậy element bị che vẫn "visible" và click mù không ném lỗi.
 *
 * Đó là nguyên nhân 22/22 lượt `capcut_web_design_studio_canvas_edit` thất bại
 * ngày 2026-09-02. Đo trực tiếp trên account rvfyafux88495 (port 60345, cửa sổ
 * rộng 929px): nút Send của Canvas prompt panel ở (611,718) nhưng
 * `document.elementFromPoint` tại chính điểm đó trả về `skillPanel-4DcNp3` —
 * chân của panel "Design with AI" rộng 440px. Log vẫn in "Đã bấm Send canvas"
 * rồi chờ `do_action` 90 giây vô ích.
 *
 * Hàm này hỏi chính trang chứ không suy đoán: điểm giữa element trả về đúng nó
 * (hoặc con nó) hay không. Không kiểm được cũng NÉM — thà dừng còn hơn click mù.
 */
export async function assertHittable(page: Page, locator: Locator, what: string, signal?: AbortSignal): Promise<void> {
  const hit = await boundedDomRead(() => locator
    .first()
    .evaluate((el: Element): { ok: boolean; blocker: string } => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { ok: false, blocker: 'chính nó có kích thước 0' };
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (top && (top === el || el.contains(top))) return { ok: true, blocker: '' };
      if (!top) return { ok: false, blocker: 'không có element nào ở điểm giữa (ngoài viewport?)' };
      // Tên đọc được trong log: aria-label của tổ tiên gần nhất, không thì class.
      const labelled = top.closest('[aria-label]');
      const label = labelled?.getAttribute('aria-label');
      const cls = (top.getAttribute('class') ?? '').split(' ')[0];
      return { ok: false, blocker: label ?? `${top.tagName.toLowerCase()}.${cls}` };
    }), 'hit-test:' + what, 1000, signal)
    .catch((e: unknown) => {
      signal?.throwIfAborted();
      if (e instanceof DomReadTimeoutError) throw e;
      return { ok: false, blocker: `không kiểm được (${(e as Error).message})` };
    });

  if (!hit.ok) {
    throw new StepError(
      `${what} bị "${hit.blocker}" che — page.mouse sẽ click vào element đó, không tới đích`,
      await dump(page, `blocked_${what}`)
    );
  }
}

/** Chờ tới khi một vùng thoát khỏi inert, tức là panel đã mở ra thật. */
export async function waitNotInert(page: Page, selector: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await boundedDomRead(() => page
      .evaluate((sel: string) => {
        const el = document.querySelector(sel);
        return !!el && !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true';
      }, selector), 'wait-not-inert', Math.min(1000, deadline - Date.now()), signal);
    if (open) return;
    await abortableDelay(Math.max(0, Math.min(300, deadline - Date.now())), signal ?? new AbortController().signal);
  }
  throw new StepError(
    `Vùng ${selector} không thoát khỏi inert sau ${timeoutMs}ms`,
    await dump(page, 'still_inert', signal)
  );
}

/**
 * Ghi lại lỗi mạng của MỌI page, kể cả page mở sau.
 * Nhờ vậy `ERR_PROXY_CONNECTION_FAILED` hiện ra đúng tên nó.
 */
export function attachNetDiag(context: BrowserContext, onIssue: (msg: string) => void): NetIssue[] {
  const issues: NetIssue[] = [];

  const hook = (page: Page): void => {
    page.on('requestfailed', (req) => {
      const errorText = req.failure()?.errorText ?? 'unknown';
      const kind = classifyNetError(errorText);
      // 'other' phần lớn là ERR_ABORTED do app tự huỷ request — không đáng báo.
      if (kind === 'other') return;
      const issue: NetIssue = { kind, errorText, url: req.url().slice(0, 200), at: Date.now() };
      issues.push(issue);
      onIssue(`MẠNG LỖI (${kind}): ${errorText} — ${issue.url.slice(0, 80)}`);
    });
  };

  context.pages().forEach(hook);
  context.on('page', hook);
  return issues;
}
