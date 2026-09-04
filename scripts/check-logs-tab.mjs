/**
 * =============================================================================
 * TAB LOGS CÓ ĐỌC ĐƯỢC NHẬT KÝ RUNTIME KHÔNG — kiểm qua chính app
 * =============================================================================
 * Mở app đã build, gắn CDP, rồi:
 *   1. gọi `window.electronAPI.logs.list(...)` — chứng minh preload + IPC + repo
 *   2. điều hướng tới #/logs và đếm dòng render thật — chứng minh trang
 *
 * Lỗi đo được 04/09/2026: trang gửi `pageSize = 1000` trong khi contract chặn ở
 * 500, nên IPC trả VALIDATION_ERROR và trang hiện 0 dòng dù DB có 1573 dòng.
 *
 * CHẠY: node scripts/check-logs-tab.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const PORT = 9334;
const ELECTRON = path.resolve('node_modules/electron/dist/electron.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  for (let i = 0; i < 40; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 3000 });
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`Không gắn được CDP vào app ở cổng ${PORT}`);
}

async function main() {
  const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env }
  });

  const browser = await attach();
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'));
  if (!page) throw new Error('Không thấy cửa sổ nào của app');

  await page.waitForFunction(() => Boolean(window.electronAPI?.logs?.list), null, { timeout: 60_000 });

  const viaIpc = await page.evaluate(async () => {
    const res = await window.electronAPI.logs.list({ page: 1, pageSize: 500 });
    return res?.success
      ? { ok: true, items: res.data.items.length, total: res.data.total, dau: res.data.items[0] ?? null }
      : { ok: false, err: res?.error };
  });
  console.log('[IPC] logs.list  :', JSON.stringify(viaIpc).slice(0, 240));

  // Trang Logs tự gọi `load()` khi mount — đây là đường người dùng thật đi.
  await page.evaluate(() => { window.location.hash = '#/logs'; });
  await sleep(3500);

  const onScreen = await page.evaluate(() => {
    const text = document.body.innerText;
    const rows = document.querySelectorAll('tbody tr').length;
    return { rows, coLoi: text.includes('Không tải được nhật ký runtime') };
  });
  console.log('[UI ] trang #/logs:', JSON.stringify(onScreen));

  const pass = viaIpc.ok && viaIpc.items > 0 && onScreen.rows > 0 && !onScreen.coLoi;
  console.log(pass ? '\n✅ TAB LOGS ĐỌC ĐƯỢC NHẬT KÝ RUNTIME' : '\n❌ TAB LOGS VẪN CHƯA ĐỌC ĐƯỢC');

  await browser.close().catch(() => {});
  child.kill();
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error('LỖI:', err?.message ?? err);
  process.exitCode = 1;
});
