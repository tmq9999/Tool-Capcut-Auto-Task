/**
 * =============================================================================
 * BẢN ĐÃ CÀI CÓ CHẠY KHÔNG — kiểm trên file trong thư mục cài, không phải release/
 * =============================================================================
 * Khác `check-packaged-app.mjs` ở chỗ: nó chạy đúng file mà người dùng bấm vào
 * sau khi cài (`%LOCALAPPDATA%\Programs\AutoManager\AutoManager.exe`). Cài xong
 * mà không mở được là lỗi hay gặp nhất của bản đóng gói.
 *
 * CHẠY: node scripts/check-installed-app.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const PORT = 9337;
const EXE = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'AutoManager', 'AutoManager.exe');
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
  throw new Error(`Không gắn được CDP vào bản đã cài ở cổng ${PORT}`);
}

async function main() {
  if (!fs.existsSync(EXE)) throw new Error(`Chưa cài: không thấy ${EXE}`);
  console.log('[CÀI] mở:', EXE);

  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env }
  });

  const browser = await attach();
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'));
  if (!page) throw new Error('Không thấy cửa sổ nào của bản đã cài');

  console.log('\n=== bản đã cài ===');
  await page.waitForFunction(() => Boolean(window.electronAPI?.settings?.get), null, { timeout: 60_000 });
  check('app mở được và preload bridge sống', true);

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
  check('settings.get', r.settings === true, r.settings);
  check('logs.list đọc SQLite', typeof r.logs === 'number' && r.logs > 0, r.logs);
  check('accounts.list đọc SQLite', typeof r.accounts === 'number' && r.accounts > 0, r.accounts);

  for (const [tab, hash] of [['Dashboard', '#/dashboard'], ['Accounts', '#/accounts'], ['Logs', '#/logs'], ['Settings', '#/settings']]) {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await sleep(2500);
    const s = await page.evaluate(() => ({
      loi: (document.body.innerText.match(/Không tải được[^\n]*|Yêu cầu không hợp lệ[^\n]*|ERR_[A-Z_]+/g) ?? []).slice(0, 2)
    }));
    check(`tab ${tab}`, s.loi.length === 0, s.loi);
  }

  console.log(`\n${fail === 0 ? '✅ BẢN ĐÃ CÀI CHẠY ĐÚNG' : `❌ BẢN ĐÃ CÀI CÒN ${fail} LỖI`}`);
  await browser.close().catch(() => {});
  child.kill();
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('LỖI:', err?.message ?? err);
  process.exitCode = 1;
});
