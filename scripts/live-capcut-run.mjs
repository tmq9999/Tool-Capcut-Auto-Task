/**
 * =============================================================================
 * CHẠY THẬT MỘT LUỒNG QUA CHÍNH APP — không click tay
 * =============================================================================
 * Mục đích: nghiệm thu bằng đúng đường mà người dùng đi:
 * renderer → preload → IPC `run:start` → AutomationRunService → engine.
 *
 * CHẠY:  node scripts/live-capcut-run.mjs [--email=...] [--minutes=45] [--threads=1] [--stop-after=1]
 *
 *   --email=custom       (mặc định) sinh địa chỉ trên domain catch-all — MIỄN PHÍ
 *   --email=api:gmail94  thuê hộp thư thật từ gmail94 — CÓ TRẢ PHÍ (yêu cầu
 *                        phê duyệt riêng và VERIFY_GMAIL94_BUY=1)
 *   --email=api:dongvanfb thuê hộp thư thật từ DongVanFB — CÓ TRẢ PHÍ (yêu cầu
 *                        phê duyệt riêng và VERIFY_DONGVANFB_BUY=1)
 *   --threads=N          số luồng song song (1..20).
 *   --stop-after=N       dừng sau N account terminal (mặc định 1, tối đa 200).
 *
 * Yêu cầu: `npm run build` xong, Multilogin đang bật, credentials đã lưu trong app.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import {
  assertBillableEmailAllowed,
  isTerminalRunState,
  terminalAccountCount
} from './live-capcut-options.mjs';

const PORT = 9333;
const ELECTRON = path.resolve('node_modules/electron/dist/electron.exe');

/**
 * Nguồn email của lượt chạy. `api` KHÔNG gửi `service`: slug OTP do main process
 * ghim (`CAPCUT_OTP_SERVICE`), nên harness này không thể vô tình thuê sai dịch vụ.
 */
function parseEmailSource(argv) {
  const flag = argv.find((arg) => arg.startsWith('--email='));
  const raw = flag ? flag.slice('--email='.length) : 'api:gmail94';

  if (raw === 'custom') {
    throw new Error(
      'Nguồn email custom domain hiện đã bị khóa. Vui lòng dùng: api:gmail94 | api:dongvanfb'
    );
  }

  const api = /^api:(gmail94|dongvanfb)$/.exec(raw);
  if (api) return { mode: 'api', provider: api[1] };

  throw new Error(
    `--email="${raw}" không hợp lệ. Dùng: api:gmail94 | api:dongvanfb`
  );
}

const emailSource = parseEmailSource(process.argv.slice(2));

/** Hạn chờ của harness, phút. Xem chú thích ở `deadline`. */
const LIMIT_MINUTES = (() => {
  const flag = process.argv.slice(2).find((arg) => arg.startsWith('--minutes='));
  const value = flag ? Number(flag.slice('--minutes='.length)) : 45;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--minutes="${flag}" không hợp lệ: phải là số phút > 0`);
  }
  return value;
})();

/** Số luồng song song. */
const THREADS = (() => {
  const flag = process.argv.slice(2).find((arg) => arg.startsWith('--threads='));
  const value = flag ? Number(flag.slice('--threads='.length)) : 1;
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(`--threads="${flag}" không hợp lệ: phải là số nguyên 1..20`);
  }
  return value;
})();

const STOP_AFTER = (() => {
  const flag = process.argv.slice(2)
    .find((arg) => arg.startsWith('--stop-after='));
  const value = flag ? Number(flag.slice('--stop-after='.length)) : 1;
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new Error('--stop-after phải là số nguyên 1..200');
  }
  return value;
})();

const RUN_CONFIG = {
  threadCount: THREADS,
  browser: 'multilogin',
  headless: false,
  retryCount: 3,
  stepDelayMinMs: 500,
  stepDelayMaxMs: 2000,
  typeDelayMinMs: 50,
  typeDelayMaxMs: 150,
  module: 'credit',
  emailSource,
  proxy: { mode: 'proxykey', keys: [] },
  password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
  testDurationMs: 10_000,
  skipWithoutTrial: false
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
  assertBillableEmailAllowed(emailSource, process.env);

  console.log(
    '[LIVE] nguồn email:',
    JSON.stringify(emailSource),
    '| stop-after:',
    STOP_AFTER,
    '| hạn harness:',
    LIMIT_MINUTES,
    'phút'
  );
  if (emailSource.mode === 'api') {
    console.log('[LIVE] ⚠️  Chế độ API sẽ THUÊ hộp thư thật — thao tác có trả phí.');
  }
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
    console.log(
      `[PROGRESS] ${p.state} — ${p.message} ` +
      `(active ${p.workersActive}/${p.workerTarget}, accepted ${p.accountsAccepted}, ` +
      `done ${p.accountsCompleted}, failed ${p.accountsFailed}, stopped ${p.accountsStopped})`
    );
  });
  await page.evaluate(() => {
    window.electronAPI.logs.onEntry((e) => window.__liveLog(e));
    window.electronAPI.run.onProgress((p) => window.__liveProgress(p));
  });

  console.log(`[LIVE] gọi run.start với threadCount=${THREADS}...`);
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

  const deadline = Date.now() + LIMIT_MINUTES * 60_000;
  let last = '';
  let stopRequested = false;
  while (Date.now() < deadline) {
    const progress = await page
      .evaluate(async () => (await window.electronAPI.run.progress())?.data ?? null)
      .catch(() => null);
    const state = progress?.state ?? 'unknown';
    if (state !== last) {
      console.log(`[LIVE] state = ${state}`);
      last = state;
    }
    if (
      !stopRequested &&
      terminalAccountCount(progress) >= STOP_AFTER &&
      !isTerminalRunState(state)
    ) {
      stopRequested = true;
      console.log(`[LIVE] đạt ${STOP_AFTER} account terminal — gửi Stop.`);
      await page.evaluate(async () => window.electronAPI.run.stop());
    }
    if (isTerminalRunState(state)) break;
    await sleep(500);
  }

  if (!isTerminalRunState(last)) {
    await page.evaluate(async () => window.electronAPI.run.stop()).catch(() => {});
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const progress = await page
        .evaluate(async () => (await window.electronAPI.run.progress())?.data ?? null)
        .catch(() => null);
      if (isTerminalRunState(progress?.state)) {
        last = progress.state;
        break;
      }
      await sleep(500);
    }
  }

  console.log('[LIVE] xong — đóng app.');
  await browser.close().catch(() => {});
  child.kill();
}

main().catch(async (err) => {
  console.error('[LIVE] LỖI:', err?.message ?? err);
  process.exitCode = 1;
});
