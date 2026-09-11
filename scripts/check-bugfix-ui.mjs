import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { _electron } from 'playwright-core';

async function run() {
  console.log('--- Starting Bugfix UI Test Harness ---');

  // 1. Start Vite dev server
  const rootDir = path.resolve('scripts/bugfix-ui');
  const server = await createServer({
    configFile: false,
    root: rootDir,
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': path.resolve('src/renderer'),
        '@shared': path.resolve('src/shared')
      }
    },
    server: {
      host: '127.0.0.1',
      port: 0
    }
  });

  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to obtain Vite server address');
  }
  const fixtureUrl = `http://127.0.0.1:${address.port}/index.html`;
  console.log(`Vite server listening at ${fixtureUrl}`);

  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bugfix-ui-'));
  const hostPath = path.resolve('scripts/bugfix-ui/host.cjs');

  const cleanEnv = { ...process.env, BUGFIX_FIXTURE_URL: fixtureUrl };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.VITE_DEV_SERVER_URL;

  let electronApp;
  const pageErrors = [];

  try {
    electronApp = await _electron.launch({
      args: [hostPath, `--user-data-dir=${tempUserData}`],
      env: cleanEnv
    });

    const page = await electronApp.firstWindow();
    page.on('pageerror', (err) => {
      console.error('[PageError]', err);
      pageErrors.push(err);
    });

    await page.waitForLoadState('networkidle');

    // Helper to click controls
    const clickControl = async (testId) => {
      await page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) throw new Error(`Element not found: ${id}`);
        el.click();
      }, testId);
    };

    const getCalls = async (testId) => {
      return await page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return parseInt(el?.textContent || '0', 10);
      }, testId);
    };

    console.log('✓ Mounted fixture loaded without page errors');

    // Sequence 1: Open export -> click "Xuất" -> reject actual deferred -> error visible, retry enabled
    console.log('Running Sequence 1: Export rejection & retry capability');
    await clickControl('open-export');
    await page.waitForSelector('text=Xuất dữ liệu tài khoản');

    // Click export button inside dialog
    const exportBtn = page.locator('button:has-text("Xuất ")');
    await exportBtn.click();
    await page.waitForSelector('text=Đang xuất...');

    // Check that export request was captured and has expected format and fields
    const exportReq = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="export-request-json"]');
      return el ? JSON.parse(el.textContent || 'null') : null;
    });
    if (!exportReq || exportReq.format !== 'TXT' || !Array.isArray(exportReq.fields) || !exportReq.fields.includes('email')) {
      throw new Error(`Export request was not properly captured with format and fields: ${JSON.stringify(exportReq)}`);
    }

    // Reject deferred
    await clickControl('reject-export');
    await page.waitForSelector('text=Export worker failed');
    // Verify retry is enabled (button text is back to "Xuất " and not disabled)
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Xuất '));
      return btn && !btn.hasAttribute('disabled');
    });
    console.log('✓ Sequence 1 passed: Export request captured and rejection handled with retry enabled');

    // Sequence 2: Export pending -> close -> reopen -> export-calls still 1; resolve old -> no old success path in new session
    console.log('Running Sequence 2: Latch and Session Isolation on Export');
    const initialCalls = await getCalls('export-calls');
    // Start export again
    const exportBtn2 = page.locator('button:has-text("Xuất ")');
    await exportBtn2.click();
    await page.waitForSelector('text=Đang xuất...');
    const inFlightCalls = await getCalls('export-calls');
    if (inFlightCalls !== initialCalls + 1) throw new Error('Expected 1 more export call');

    // Close dialog while export is pending
    await clickControl('close-export');
    // Wait for dialog to close
    await page.waitForSelector('text=Xuất dữ liệu tài khoản', { state: 'hidden' });

    // Reopen export dialog
    await clickControl('open-export');
    await page.waitForSelector('text=Xuất dữ liệu tài khoản');
    const afterReopenCalls = await getCalls('export-calls');
    if (afterReopenCalls !== inFlightCalls) throw new Error('Reopen should not trigger export');

    // Resolve the old export while new session is open
    await clickControl('resolve-export');
    // Wait brief moment for promise to settle
    await page.waitForTimeout(100);

    // Old success path should NOT be displayed in new session
    const hasOldPath = await page.evaluate(() => document.body.innerText.includes('C:/exports/accounts.txt'));
    if (hasOldPath) throw new Error('Old success path leaked into new session!');

    // Latch is cleared: button can be clicked again
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Xuất '));
      return btn && !btn.hasAttribute('disabled');
    });
    console.log('✓ Sequence 2 passed: Old success path not shown in new session and latch released');

    // Close export dialog
    await clickControl('close-export');
    await page.waitForSelector('text=Xuất dữ liệu tài khoản', { state: 'hidden' });

    // Sequence 3: Show Task A with receipt A, open B -> before reply no data A / verified badge; reject B -> error text, loading false, no data A
    console.log('Running Sequence 3: Task identity isolation and rejection handling');
    await clickControl('open-task-a');
    await page.waitForSelector('text=accountA@test.com');
    await clickControl('resolve-task-a');
    await page.waitForSelector('text=Task A1');
    await page.waitForSelector('text=Đã xác minh');
    console.log('✓ Task A loaded with verified badge');

    // Open B without closing A or opening B directly
    await clickControl('open-task-b');
    await page.waitForSelector('text=accountB@test.com');

    // Before reply of B, there should be NO Task A1 and NO "Đã xác minh"
    const hasDataAInB = await page.evaluate(() => document.body.innerText.includes('Task A1'));
    const hasBadgeInB = await page.evaluate(() => document.body.innerText.includes('Đã xác minh'));
    if (hasDataAInB || hasBadgeInB) throw new Error('Task A receipt leaked into Task B before reply!');

    // Reject B
    await clickControl('reject-task-b');
    await page.waitForSelector('text=Task DB unreachable for B');
    // Ensure loading is false
    const isLoadingB = await page.evaluate(() => document.body.innerText.includes('Đang đọc tiến độ...'));
    if (isLoadingB) throw new Error('Loading should be false after rejection');
    console.log('✓ Sequence 3 passed: Identity isolated and rejection handled');

    // Sequence 4: A request pending -> B request new -> resolve A late -> does not overwrite B
    console.log('Running Sequence 4: Out-of-order Task resolution isolation');
    await clickControl('open-task-a');
    await page.waitForSelector('text=accountA@test.com');
    // Immediately switch to B while A is pending
    await clickControl('open-task-b');
    await page.waitForSelector('text=accountB@test.com');

    // Resolve A late
    await clickControl('resolve-task-a');
    await page.waitForTimeout(100);

    const hasLateAInB = await page.evaluate(() => document.body.innerText.includes('Task A1'));
    if (hasLateAInB) throw new Error('Late Task A resolution overwrote Task B!');

    // Resolve B
    await clickControl('resolve-task-b');
    await page.waitForSelector('text=Task B1');
    console.log('✓ Sequence 4 passed: Out of order response correctly ignored');

    // Close task dialog
    await clickControl('close-task');
    await page.waitForSelector('text=Tiến độ nhiệm vụ CapCut', { state: 'hidden' });

    // Sequence 5: Cancel neutral export does not show error, success with actual request fields/scope
    console.log('Running Sequence 5: Canceled export is neutral');
    await clickControl('open-export');
    await page.waitForSelector('text=Xuất dữ liệu tài khoản');
    const exportBtn5 = page.locator('button:has-text("Xuất ")');
    await exportBtn5.click();
    await page.waitForSelector('text=Đang xuất...');
    await clickControl('cancel-export');
    await page.waitForTimeout(100);

    const hasErrorOrSuccess = await page.evaluate(() => {
      return document.querySelector('[role="status"]') !== null;
    });
    if (hasErrorOrSuccess) throw new Error('Canceled export should not display error or success status');
    // Close export dialog
    await clickControl('close-export');
    await page.waitForSelector('text=Xuất dữ liệu tài khoản', { state: 'hidden' });

    // Sequence 6: EditAccountDrawer displays legacy provider option and preserves it upon note edit
    console.log('Running Sequence 6: Edit legacy provider preservation');
    await clickControl('open-edit-legacy');
    await page.waitForSelector('text=Chỉnh sửa tài khoản');

    // Verify select contains "legacy-special-provider (legacy)"
    const hasLegacyOption = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('option')).some((opt) =>
        opt.textContent?.includes('legacy-special-provider (legacy)')
      );
    });
    if (!hasLegacyOption) throw new Error('Edit drawer did not display legacy provider option');

    // Update notes in input
    const notesInput = page.locator('div:has(> label:has-text("Ghi chú")) input');
    await notesInput.fill('updated note via test');

    // Click submit "Lưu thay đổi"
    const saveBtn = page.locator('button:has-text("Lưu thay đổi")');
    await saveBtn.click();
    await page.waitForSelector('text=Chỉnh sửa tài khoản', { state: 'hidden' });

    // Verify saved account JSON has legacy provider preserved
    const saved = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="saved-account-json"]');
      return el ? JSON.parse(el.textContent || 'null') : null;
    });
    if (!saved || saved.provider !== 'legacy-special-provider' || saved.notes !== 'updated note via test') {
      throw new Error(`Saved account did not preserve legacy provider: ${JSON.stringify(saved)}`);
    }
    console.log('✓ Sequence 6 passed: Legacy provider preserved on note edit');

    if (pageErrors.length > 0) {
      throw new Error(`Captured ${pageErrors.length} page errors during test!`);
    }

    console.log('All mounted bugfix-ui test sequences passed successfully!');
  } finally {
    const cleanupErrors = [];
    if (electronApp) {
      try {
        await electronApp.close();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await server.close();
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      const resolvedTemp = path.resolve(tempUserData);
      const tmpDir = path.resolve(os.tmpdir());
      if (path.isAbsolute(resolvedTemp) && resolvedTemp.startsWith(tmpDir) && resolvedTemp !== tmpDir) {
        fs.rmSync(resolvedTemp, { recursive: true, force: true });
      } else {
        throw new Error(`Invalid temp directory path for cleanup: ${resolvedTemp}`);
      }
    } catch (err) {
      cleanupErrors.push(err);
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`Harness cleanup encountered ${cleanupErrors.length} errors: ${cleanupErrors.map(e => (e instanceof Error ? e.message : String(e))).join('; ')}`);
    }
  }
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
