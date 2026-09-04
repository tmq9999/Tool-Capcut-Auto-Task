/**
 * =============================================================================
 * QUÉT MỌI TAB VÀ MỌI IPC QUA CHÍNH APP — tìm lỗi còn lại
 * =============================================================================
 * Lỗi tab Logs (04/09/2026) thuộc một LỚP: renderer gửi request mà contract từ
 * chối, `safeParse` trả VALIDATION_ERROR, và trang chỉ hiện câu lỗi chung —
 * không ai biết vì sao. Script này đi tìm mọi chỗ khác cùng lớp đó:
 *
 *   1. gọi từng method IPC bằng đúng thứ UI gửi, in code lỗi nếu bị từ chối
 *   2. mở từng tab, đếm dòng render và soi câu lỗi trên màn hình
 *
 * CHẠY: node scripts/check-all-tabs.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const PORT = 9335;
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

let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 200)}`}`);
  }
}

async function main() {
  const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env }
  });

  const browser = await attach();
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'));
  if (!page) throw new Error('Không thấy cửa sổ nào của app');
  await page.waitForFunction(() => Boolean(window.electronAPI?.settings?.get), null, { timeout: 60_000 });

  console.log('\n=== IPC: gọi bằng đúng thứ UI gửi ===');
  const ipc = await page.evaluate(async () => {
    const api = window.electronAPI;
    const out = {};
    const run = async (name, fn) => {
      try {
        const r = await fn();
        out[name] = r?.success === false ? { ok: false, err: r.error } : { ok: true, shape: Object.keys(r?.data ?? {}) };
      } catch (e) {
        out[name] = { ok: false, err: String(e?.message ?? e) };
      }
    };
    await run('settings.get', () => api.settings.get());
    await run('accounts.list (rong)', () => api.accounts.list({}));
    // Tên field là `query`, KHÔNG phải `search` — schema `.strict()` nên gửi sai
    // tên là bị từ chối. Bản đầu của script này gửi `search` rồi tưởng app lỗi.
    await run('accounts.list (loc)', () => api.accounts.list({ query: 'gmail', status: 'done', page: 1, pageSize: 50 }));
    await run('logs.list', () => api.logs.list({ page: 1, pageSize: 500 }));
    await run('run.progress', () => api.run.progress());
    return out;
  });
  for (const [name, r] of Object.entries(ipc)) check(name, r.ok, r.err ?? r.shape);

  console.log('\n=== TAB: mở từng trang, đếm dòng và soi câu lỗi ===');
  for (const [tab, hash] of [['Dashboard', '#/dashboard'], ['Accounts', '#/accounts'], ['Logs', '#/logs'], ['Settings', '#/settings']]) {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await sleep(3000);
    const s = await page.evaluate(() => {
      const text = document.body.innerText;
      /**
       * Chỉ bắt câu lỗi THẬT. Bản đầu dùng `/Lỗi.../` nên khớp cả nhãn
       * "Lỗi:" của thanh tổng kết Accounts và option "Lỗi" trong dropdown —
       * suýt báo hai lỗi không tồn tại.
       */
      const loi = (text.match(/Không tải được[^\n]*|Yêu cầu không hợp lệ[^\n]*|ERR_[A-Z_]+/g) ?? []).slice(0, 3);
      return { rows: document.querySelectorAll('tbody tr').length, loi, chuLuong: text.trim().length };
    });
    check(`${tab}: không có câu lỗi trên màn hình`, s.loi.length === 0, s.loi);
    check(`${tab}: trang có nội dung`, s.chuLuong > 200, s.chuLuong);
    if (tab === 'Accounts' || tab === 'Logs') {
      check(`${tab}: có dòng dữ liệu`, s.rows > 0, s.rows);
    }
  }

  console.log(`\n${fail === 0 ? '✅ KHÔNG THẤY LỖI NÀO' : `❌ CÒN ${fail} CHỖ LỖI`}`);
  await browser.close().catch(() => {});
  child.kill();
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('LỖI:', err?.message ?? err);
  process.exitCode = 1;
});
