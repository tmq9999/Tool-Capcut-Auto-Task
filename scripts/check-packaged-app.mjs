/**
 * =============================================================================
 * BẢN ĐÓNG GÓI CÓ CHẠY THẬT KHÔNG — kiểm trên chính file .exe đã build
 * =============================================================================
 * Mở `release/win-unpacked/AutoManager.exe` (không phải `electron .`), gắn CDP,
 * rồi kiểm đúng những thứ mà đóng gói hay làm vỡ:
 *
 *   - `better-sqlite3` native addon: trong asar là chết ⇒ đọc DB phải chạy được
 *   - `safeStorage`: credential vault dựa vào nó
 *   - preload bridge: renderer bị cô lập nên mọi thứ đi qua đây
 *   - logs.list + accounts.list: hai đường đọc DB thật
 *
 * CHẠY: node scripts/check-packaged-app.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const PORT = 9336;
const EXE = path.resolve('release/win-unpacked/AutoManager.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    fail += 1;
    console.log(`  ❌ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 200)}`}`);
  }
}

async function attach() {
  for (let i = 0; i < 45; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 3000 });
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`Không gắn được CDP vào bản đóng gói ở cổng ${PORT}`);
}

async function main() {
  if (!fs.existsSync(EXE)) throw new Error(`Chưa có ${EXE} — chạy \`npm run dist:dir\` trước`);
  console.log('[PKG] mở:', EXE);

  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env }
  });

  const browser = await attach();
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'));
  if (!page) throw new Error('Không thấy cửa sổ nào của bản đóng gói');

  console.log('\n=== bản đóng gói: preload + IPC + SQLite ===');
  await page.waitForFunction(() => Boolean(window.electronAPI?.settings?.get), null, { timeout: 60_000 });
  check('preload bridge sống trong bản đóng gói', true);

  const r = await page.evaluate(async () => {
    const api = window.electronAPI;
    const settings = await api.settings.get();
    const logs = await api.logs.list({ page: 1, pageSize: 500 });
    const accounts = await api.accounts.list({});
    return {
      settings: settings?.success === true,
      logs: logs?.success === true ? logs.data.total : { err: logs?.error },
      accounts: accounts?.success === true ? accounts.data.total : { err: accounts?.error }
    };
  });
  check('settings.get qua IPC', r.settings === true, r.settings);
  check('logs.list đọc được SQLite (better-sqlite3 ngoài asar)', typeof r.logs === 'number' && r.logs > 0, r.logs);
  check('accounts.list đọc được SQLite', typeof r.accounts === 'number' && r.accounts > 0, r.accounts);

  const isolated = await page.evaluate(() => ({
    noRequire: typeof window.require === 'undefined',
    noProcess: typeof window.process === 'undefined'
  }));
  check('renderer vẫn bị cô lập (không có require)', isolated.noRequire === true, isolated);
  check('renderer không thấy process', isolated.noProcess === true, isolated);

  for (const [tab, hash] of [['Accounts', '#/accounts'], ['Logs', '#/logs'], ['Settings', '#/settings']]) {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await sleep(2500);
    const s = await page.evaluate(() => ({
      rows: document.querySelectorAll('tbody tr').length,
      loi: (document.body.innerText.match(/Không tải được[^\n]*|Yêu cầu không hợp lệ[^\n]*|ERR_[A-Z_]+/g) ?? []).slice(0, 2)
    }));
    check(`tab ${tab} không lỗi trong bản đóng gói`, s.loi.length === 0, s.loi);
  }

  console.log(`\n${fail === 0 ? '✅ BẢN ĐÓNG GÓI CHẠY ĐÚNG' : `❌ BẢN ĐÓNG GÓI CÒN ${fail} LỖI`}`);
  await browser.close().catch(() => {});
  child.kill();
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('LỖI:', err?.message ?? err);
  process.exitCode = 1;
});
