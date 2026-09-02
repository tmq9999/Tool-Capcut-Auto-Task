/**
 * =============================================================================
 * CHẠY THẬT MỘT LUỒNG QUA CHÍNH APP — không click tay
 * =============================================================================
 * Mục đích: nghiệm thu Pha 4b của `docs/MERGE-PLAN.md` bằng đúng đường mà người
 * dùng đi: renderer → preload → IPC `run:start` → AutomationRunService → engine.
 *
 * Cách làm: mở app đã build, gắn CDP vào cửa sổ của nó, rồi gọi
 * `window.electronAPI.run.start(...)` với threadCount = 1. Không dựng lại
 * provider stack, không gọi service trực tiếp — nếu bất kỳ mắt xích IPC nào sai
 * thì bài này phải fail.
 *
 * CHẠY:  node scripts/live-capcut-run.mjs
 * Yêu cầu: `npm run build` xong, Multilogin đang bật, credentials đã lưu trong app.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const PORT = 9333;
const ELECTRON = path.resolve('node_modules/electron/dist/electron.exe');
const RUN_CONFIG = {
  threadCount: 1,
  browser: 'multilogin',
  headless: false,
  retryCount: 3,
  stepDelayMinMs: 500,
  stepDelayMaxMs: 2000,
  typeDelayMinMs: 50,
  typeDelayMaxMs: 150,
  module: 'credit',
  // Domain catch-all của chính chủ: địa chỉ được SINH RA, không phải mua.
  emailSource: { mode: 'custom' },
  proxy: { mode: 'proxykey', keys: [] },
  password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
  testDurationMs: 10_000
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  for (let i = 0; i < 40; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 3000 });
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`Không gắn được CDP vào app ở cổng ${PORT} sau 40 giây`);
}

async function main() {
  console.log('[LIVE] mở app:', ELECTRON);
  const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env }
  });
  child.on('exit', (code) => console.log(`[LIVE] app thoát, code=${code}`));

  const browser = await attach();
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  const page = pages.find((p) => !p.url().startsWith('devtools://')) ?? pages[0];
  if (!page) throw new Error('Không thấy cửa sổ nào của app');
  console.log('[LIVE] đã gắn vào cửa sổ:', page.url());

  await page.waitForFunction(() => Boolean(window.electronAPI?.run?.start), null, { timeout: 60_000 });

  // Log của engine đi qua LogBus → IPC push. Bơm ra stdout để xem trực tiếp.
  await page.exposeFunction('__liveLog', (entry) => {
    const { status, step, email, message } = entry ?? {};
    console.log(`[${status}] ${step} | ${email} | ${message}`);
  });
  await page.exposeFunction('__liveProgress', (p) => {
    console.log(`[PROGRESS] ${p.state} — ${p.message} (start ${p.threadsStarted}, stop ${p.threadsStopped}, fail ${p.threadsFailed})`);
  });
  await page.evaluate(() => {
    window.electronAPI.logs.onEntry((e) => window.__liveLog(e));
    window.electronAPI.run.onProgress((p) => window.__liveProgress(p));
  });

  console.log('[LIVE] gọi run.start với threadCount=1...');
  const started = await page.evaluate(async (config) => {
    const res = await window.electronAPI.run.start(config);
    return res;
  }, RUN_CONFIG);
  console.log('[LIVE] run.start trả về:', JSON.stringify(started));
  if (!started?.success) {
    console.error('[LIVE] IPC từ chối config — dừng ở đây, không có gì được chạy.');
    child.kill();
    process.exitCode = 1;
    return;
  }

  // Chờ tới khi phiên dừng. Engine chạy đủ 12 nhiệm vụ nên để hạn rộng.
  const deadline = Date.now() + 30 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const progress = await page
      .evaluate(async () => (await window.electronAPI.run.progress())?.data ?? null)
      .catch(() => null);
    const state = progress?.state ?? 'unknown';
    if (state !== last) {
      console.log(`[LIVE] state = ${state}`);
      last = state;
    }
    if (state === 'stopped' || state === 'failed') break;
    await sleep(5_000);
  }

  console.log('[LIVE] xong — đóng app.');
  await browser.close().catch(() => {});
  child.kill();
}

main().catch(async (err) => {
  console.error('[LIVE] LỖI:', err?.message ?? err);
  process.exitCode = 1;
});
