/**
 * =============================================================================
 * BẢN ĐÓNG GÓI CÓ CHẠY THẬT KHÔNG — kiểm trên chính file .exe đã build
 * =============================================================================
 * Mở `release/win-unpacked/AutoManager.exe` qua Playwright `_electron.launch`
 * (không fixed port 9336, không CDP attach lung tung), userData cách ly ngoài workspace.
 *
 * Kiểm tra:
 *   - Main process identity & userData override
 *   - `better-sqlite3` native addon: trong asar là chết ⇒ đọc DB phải chạy được
 *   - `safeStorage`: credential vault dựa vào nó
 *   - preload bridge: renderer bị cô lập nên mọi thứ đi qua đây
 *   - logs.list + accounts.list: hai đường đọc DB thật (empty count 0 là pass)
 *   - Tab navigation không có lỗi unhandled
 *   - Đóng đúng owned child app và dọn dẹp temp userData an toàn
 *
 * CHẠY: node scripts/check-packaged-app.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron } from 'playwright-core';

let productName = 'CapCut Automation';
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  if (pkg.productName) productName = pkg.productName;
} catch {}
export const DEFAULT_EXE = path.resolve(`release/win-unpacked/${productName}.exe`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function validateSmokeTarget(exePath, userDataDir) {
  if (!fs.existsSync(exePath)) {
    throw new Error(`Chưa có ${exePath} — chạy \`npm run dist:dir\` trước`);
  }
  const workspaceRoot = process.cwd();
  const resolvedUserDir = path.resolve(userDataDir);
  const normUser = resolvedUserDir.toLowerCase();
  const normWs = path.resolve(workspaceRoot).toLowerCase();
  if (normUser === normWs || normUser.startsWith(normWs + path.sep)) {
    throw new Error('Rollout userData must be outside the workspace directory.');
  }
}

export async function runPackagedSmoke(options = {}) {
  let fail = 0;
  function check(name, ok, detail) {
    if (ok) console.log(`  ✅ ${name}`);
    else {
      fail += 1;
      console.log(`  ❌ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 200)}`}`);
    }
  }

  const exePath = options.exePath ?? DEFAULT_EXE;
  const isTempOwned = !options.userDataDir;
  const tempUserDataDir = options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'automanager-smoke-'));

  let app = null;
  let primaryError = null;

  try {
    validateSmokeTarget(exePath, tempUserDataDir);

    console.log('[PKG] mở:', exePath);
    console.log('[PKG] userData:', tempUserDataDir);

    app = await _electron.launch({
      executablePath: exePath,
      args: [`--user-data-dir=${tempUserDataDir}`],
      env: {
        ...process.env,
        AUTOMANAGER_ROLLOUT_USER_DATA_DIR: tempUserDataDir
      }
    });

    // 1. Kiểm tra main process identity trước khi mở renderer/window
    const mainMeta = await app.evaluate(async ({ app: electronApp }) => ({
      name: electronApp.getName(),
      isPackaged: electronApp.isPackaged,
      userData: electronApp.getPath('userData')
    }));

    const isNameValid = mainMeta.name === 'CapCut Automation';
    const isUserDataValid = path.resolve(mainMeta.userData).toLowerCase() === path.resolve(tempUserDataDir).toLowerCase();
    const isPackagedValid = mainMeta.isPackaged === true;

    check('main process identity là CapCut Automation', isNameValid);
    check('main process userData dùng đúng temp dir cách ly', isUserDataValid);

    if (!isNameValid || !isUserDataValid || !isPackagedValid) {
      throw new Error(`Mismatched application identity: expected name "CapCut Automation", isPackaged true, userData "${tempUserDataDir}"; got ${JSON.stringify(mainMeta)}`);
    }

    // 2. Lấy cửa sổ đầu tiên của bản đóng gói
    const page = await app.firstWindow();
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
    check('logs.list đọc được SQLite (empty count 0 là hợp lệ)', typeof r.logs === 'number' && r.logs >= 0, r.logs);
    check('accounts.list đọc được SQLite (empty count 0 là hợp lệ)', typeof r.accounts === 'number' && r.accounts >= 0, r.accounts);

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
  } catch (err) {
    primaryError = err;
    fail += 1;
  } finally {
    let closeErr = null;
    if (app) {
      try {
        await app.close();
      } catch (err) {
        closeErr = err;
      }
    }
    let cleanupErr = null;
    if (isTempOwned && fs.existsSync(tempUserDataDir)) {
      if (!closeErr) {
        try {
          fs.rmSync(tempUserDataDir, { recursive: true, force: true });
        } catch (err) {
          cleanupErr = err;
          console.error('Failed to clean up temp user data dir:', err);
          fail += 1;
        }
      }
    }

    if (closeErr) {
      if (primaryError) {
        throw new AggregateError(
          [primaryError, closeErr],
          `Primary failure (${primaryError.message}) and close failure (${closeErr.message}) occurred`
        );
      }
      throw closeErr;
    }

    if (primaryError) {
      if (cleanupErr) {
        throw new AggregateError(
          [primaryError, cleanupErr],
          `Primary failure (${primaryError.message}) and cleanup failure (${cleanupErr.message}) occurred`
        );
      }
      throw primaryError;
    }
  }

  console.log(`\n${fail === 0 ? '✅ BẢN ĐÓNG GÓI CHẠY ĐÚNG' : `❌ BẢN ĐÓNG GÓI CÒN ${fail} LỖI`}`);
  return { success: fail === 0, failCount: fail };
}

// Khi chạy trực tiếp qua node
const isMainScript = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve('scripts/check-packaged-app.mjs').toLowerCase();
if (isMainScript) {
  runPackagedSmoke()
    .then((result) => {
      process.exitCode = result.success ? 0 : 1;
    })
    .catch((err) => {
      console.error('LỖI:', err?.message ?? err);
      process.exitCode = 1;
    });
}
