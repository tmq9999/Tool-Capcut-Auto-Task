// Complete and Claim all CapCut tasks for renilakatos3730@gmail.com
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
require('tsx/cjs');

app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

const { ApiV3Launcher } = require('../src/main/services/capcut/launcher/ApiV3Launcher.ts');
const { MultiloginProvider } = require('../src/main/providers/MultiloginProvider.ts');
const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { loginCapcut, isLoggedIn } = require('../src/main/services/capcut/login.ts');
const { createDirectUiInteraction } = require('../src/main/services/capcut/uiInteractionScheduler.ts');
const { performDiagnosticCleanup } = require('./legacy-diagnostic-helpers.cjs');

const TARGET_EMAIL = 'renilakatos3730@gmail.com';
const TARGET_PASSWORD = 'Capcut_0a3ac7de!2026';

const LEAF_TASKS = [
  'capcut_web_pwa_install',
  'capcut_web_push_authorize',
  'capcut_web_inspiration_generate_done',
  'capcut_web_design_studio_ai_chat',
  'capcut_web_design_studio_upload_img',
  'capcut_web_design_studio_canvas_edit',
  'capcut_web_video_studio_send_msg',
  'capcut_web_video_studio_generate_done',
  'capcut_web_video_studio_export'
];

app.whenReady().then(async () => {
  let db = null;
  let leaseId = null;
  let profile = null;
  let launcher = null;

  try {
    if (fs.existsSync('.env')) process.loadEnvFile('.env');
    const kiotApiToken = process.env.KIOTPROXY_API_TOKEN;
    if (!kiotApiToken) throw new Error('KIOTPROXY_API_TOKEN_MISSING');

    const appDataDb = path.join(app.getPath('userData'), 'automanager.db');
    db = new DatabaseSync(appDataDb);
    const fetchHttp = new FetchHttpClient();

    console.log(`\n============================================================`);
    console.log(`🎯 EXECUTING TASKS & AUTO-CLAIM FOR: ${TARGET_EMAIL}`);
    console.log(`============================================================\n`);

    console.log('=== STEP 1: LEASING KIOTPROXY ===');
    const kiotProvider = new KiotProxyProvider(fetchHttp);
    const allKeys = await kiotProvider.listKeys(kiotApiToken);
    const activeInDb = db.prepare('SELECT key_hash FROM proxy_leases WHERE released_at IS NULL').all();
    const availableKeys = allKeys.filter(k =>
      !activeInDb.some(a => a.key_hash === crypto.createHash('sha256').update(k.keyValue).digest('hex')) &&
      (!k.expiredAt || Date.parse(k.expiredAt) > Date.now())
    );
    if (availableKeys.length === 0) throw new Error('NO_AVAILABLE_KIOT_KEY');

    let rawLease = null;
    let chosenKey = null;
    for (const k of availableKeys) {
      try {
        rawLease = await kiotProvider.getCurrentProxy(k.keyValue, 'http');
        chosenKey = k;
        break;
      } catch {}
    }
    if (!rawLease) {
      for (const k of availableKeys) {
        try {
          rawLease = await kiotProvider.getNewProxy(k.keyValue, { protocol: 'http' });
          chosenKey = k;
          break;
        } catch {}
      }
    }
    if (!rawLease || !chosenKey) throw new Error('FAILED_TO_ACQUIRE_KIOT_PROXY');

    leaseId = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(chosenKey.keyValue).digest('hex');
    db.prepare("INSERT INTO proxy_leases (id, key_hash, ip, host, port, protocol, account_id, acquired_at) VALUES (?,?,?,?,?,?,NULL,datetime('now'))")
      .run(leaseId, keyHash, rawLease.ip, rawLease.host, rawLease.port, rawLease.protocol);
    console.log(`Acquired proxy: ${rawLease.ip}:${rawLease.port}`);

    console.log('\n=== STEP 2: LAUNCHING MULTILOGIN API-V3 ===');
    const credRow = db.prepare("SELECT encrypted_credentials FROM service_credentials WHERE service_name = 'multilogin'").get();
    if (!credRow) throw new Error('MULTILOGIN_CREDENTIALS_NOT_FOUND');
    const decryptedCreds = JSON.parse(safeStorage.decryptString(Buffer.from(credRow.encrypted_credentials)));
    const mlxApi = new MultiloginProvider(fetchHttp);
    const signinResult = await mlxApi.signIn(decryptedCreds.email, decryptedCreds.password);
    const tokenSource = { getAccessToken: async () => signinResult.token };

    launcher = new ApiV3Launcher(tokenSource, mlxApi, {
      http: fetchHttp,
      ports: { isPortFree: async () => true, pickFreePort: async () => 35123 },
      log: msg => console.log(`[Launcher] ${msg}`)
    });

    const signal = AbortSignal.timeout(400_000);
    const ui = createDirectUiInteraction(signal, 'native');

    profile = await launcher.launch({
      headless: false,
      signal,
      ui,
      proxy: {
        scheme: rawLease.protocol,
        host: rawLease.host,
        port: String(rawLease.port),
        username: rawLease.username || undefined,
        password: rawLease.password || undefined
      }
    });

    const { page, context } = profile;
    console.log(`Multilogin profile launched: ${profile.profileId}`);

    console.log('\n=== STEP 3: LOGGING IN CAPCUT WEB ===');
    await loginCapcut(page, context, { email: TARGET_EMAIL, password: TARGET_PASSWORD }, msg => console.log(`[Login] ${msg}`), {
      ui,
      signal
    });
    console.log('Login confirmed successfully!');

    console.log('\n=== STEP 4: EXTRACTING REAL NUMERIC USER ID ===');
    await page.waitForTimeout(3000);
    const userInfoResult = await page.evaluate(async () => {
      const debug = {};
      try {
        const r1 = await fetch('/passport/web/account/info/');
        const d1 = await r1.json();
        debug.passport = d1;
        if (d1.data?.user_id_str) return { userId: d1.data.user_id_str, source: 'passport_user_id_str', debug };
        if (d1.data?.user_id) return { userId: String(d1.data.user_id), source: 'passport_user_id', debug };
      } catch (e) {
        debug.passport_error = e.message;
      }

      try {
        const r2 = await fetch('/lv/v1/user/web/user_info');
        const d2 = await r2.json();
        debug.user_info = d2;
        if (d2.data?.user_info?.user_id) return { userId: String(d2.data.user_info.user_id), source: 'lv_user_info_user_id', debug };
        if (d2.data?.user_id) return { userId: String(d2.data.user_id), source: 'lv_user_id', debug };
        if (d2.data?.uid) return { userId: String(d2.data.uid), source: 'lv_uid', debug };
      } catch (e) {
        debug.user_info_error = e.message;
      }

      return { userId: null, source: 'none', debug };
    });

    console.log('User info resolution result:', JSON.stringify({ userId: userInfoResult.userId, source: userInfoResult.source }));
    if (!userInfoResult.userId) {
      console.log('Detailed debug from page:', JSON.stringify(userInfoResult.debug, null, 2));
      throw new Error('FAILED_TO_RESOLVE_NUMERIC_USER_ID');
    }

    const numericUserId = userInfoResult.userId;
    console.log(`>>> CONFIRMED NUMERIC USER ID: ${numericUserId} <<<`);

    console.log('\n=== STEP 5: FIRING DO_ACTION FOR ALL 9 LEAF TASKS ===');
    const today = new Date().toISOString().slice(0, 10);
    for (const actionKey of LEAF_TASKS) {
      const opId = `${actionKey}_${numericUserId}_${today}`;
      console.log(`Executing do_action: ${actionKey} (op_id: ${opId})...`);
      const res = await page.evaluate(async ({ actionKey, opId }) => {
        try {
          const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action?aid=348188&device_platform=web', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action_key: actionKey, op_id: opId })
          });
          return await r.json();
        } catch (e) {
          return { error: e.message };
        }
      }, { actionKey, opId });
      console.log(`-> ${actionKey}: status = ${res.err_no ?? 'err'} msg = ${res.err_msg ?? res.error}`);
      await page.waitForTimeout(1000 + Math.floor(Math.random() * 500));
    }

    console.log('\n=== STEP 6: CHECKING TASK LIST BEFORE CLAIMING ===');
    const initialTaskList = await page.evaluate(async () => {
      try {
        const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scene: 'capcut_web_task' })
        });
        return await r.json();
      } catch (e) {
        return { error: e.message };
      }
    });

    const preTasks = initialTaskList.data?.task_list || [];
    console.log(`Returned ${preTasks.length} tasks:`);
    for (const t of preTasks) {
      console.log(`- ${t.task_key.padEnd(45)} | Status: ${t.task_status} | Button: ${(t.task_view?.button_text || '').padEnd(6)} | Reward: +${t.task_reward_view?.reward_amount}`);
    }

    console.log('\n=== STEP 7: ATTEMPTING IN-PAGE API CLAIM FIRST ===');
    const claimableTasks = preTasks.filter(t => t.task_status === 2);
    console.log(`Found ${claimableTasks.length} claimable task(s) via API.`);
    let apiClaimSuccess = 0;
    for (const t of claimableTasks) {
      const grantRes = await page.evaluate(async (taskKey) => {
        try {
          const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/grant_reward', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ task_key: taskKey, scene: 'capcut_web_task' })
          });
          return await r.json();
        } catch (e) {
          return { error: e.message };
        }
      }, t.task_key);
      console.log(`[API Grant] ${t.task_key}: err_no = ${grantRes.err_no} msg = ${grantRes.err_msg}`);
      if (grantRes.err_no === 0) apiClaimSuccess++;
      await page.waitForTimeout(500);
    }
    console.log(`API claims completed: ${apiClaimSuccess}/${claimableTasks.length}`);

    console.log('\n=== STEP 8: NAVIGATING TO MY-EDIT & PERFORMING UI CLAIM CLICKS ===');
    await page.goto('https://www.capcut.com/my-edit?section=inspiration_feeds&enter_source=web_task_earn_credit', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(4000);

    // Dismiss any modal or onboarding survey
    const skipSelectors = [
      'button:has-text("Skip")',
      'button:has-text("Got it")',
      'button:has-text("Later")',
      '[class*="skip"]',
      '.semi-modal-close'
    ];
    for (const sel of skipSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        console.log(`Dismissing modal with: ${sel}`);
        await btn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    // Ensure task popover is open
    const openPopover = async () => {
      const rows = await page.locator('[class*="taskRow"], [class*="TaskRow"]').count().catch(() => 0);
      if (rows > 0) return true;
      const entries = [
        'button:has-text("Free credits")',
        '[class*="entry-"]:has-text("Free credits")',
        '[data-id="TitleBarTaskList"]',
        '#TitleBarTaskList',
        '[class*="Lv_Task-wrapper"]'
      ];
      for (const sel of entries) {
        const entry = page.locator(sel).first();
        if (await entry.isVisible().catch(() => false)) {
          console.log(`Opening popover via: ${sel}`);
          await entry.click().catch(() => {});
          await page.waitForTimeout(1500);
          const count = await page.locator('[class*="taskRow"], [class*="TaskRow"]').count().catch(() => 0);
          if (count > 0) return true;
        }
      }
      return false;
    };

    // Loop clicking all Claim buttons in UI
    console.log('Scanning and clicking Claim buttons in UI...');
    let totalUiClaimed = 0;
    for (let round = 1; round <= 15; round++) {
      const isOpen = await openPopover();
      if (!isOpen) {
        console.log(`Round ${round}: Could not open task popover.`);
        await page.waitForTimeout(1000);
        continue;
      }
      const claimButtons = page.locator('button:has-text("Claim")');
      const count = await claimButtons.count().catch(() => 0);
      if (count === 0) {
        console.log(`Round ${round}: 0 Claim buttons found.`);
        await page.waitForTimeout(1500);
        const retryCount = await page.locator('button:has-text("Claim")').count().catch(() => 0);
        if (retryCount === 0) break;
      }
      console.log(`Round ${round}: Found ${count} Claim button(s). Clicking each...`);
      for (let i = 0; i < count; i++) {
        const btn = page.locator('button:has-text("Claim")').first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 5000, force: true }).catch(e => console.log('Click error:', e.message));
          totalUiClaimed++;
          await page.waitForTimeout(1200 + Math.floor(Math.random() * 600));
        }
      }
      await page.waitForTimeout(1500);
    }
    console.log(`Total UI Claim clicks: ${totalUiClaimed}`);

    console.log('\n=== STEP 9: FINAL VERIFICATION & RECONCILIATION ===');
    const finalTaskList = await page.evaluate(async () => {
      try {
        const r = await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scene: 'capcut_web_task' })
        });
        return await r.json();
      } catch (e) {
        return { error: e.message };
      }
    });

    const tasks = finalTaskList.data?.task_list || [];
    console.log('=== FINAL TASK STATUSES ===');
    let totalDone = 0;
    let totalCredits = 0;
    for (const t of tasks) {
      const isDone = t.task_status === 4;
      if (isDone) {
        totalDone++;
        totalCredits += (t.task_reward_view?.reward_amount || 0);
      }
      console.log(`- ${t.task_key.padEnd(45)} | Status: ${t.task_status} | Button: ${(t.task_view?.button_text || '').padEnd(6)} | Reward: +${t.task_reward_view?.reward_amount}`);
    }

    console.log(`\nTasks Done: ${totalDone}/${tasks.length}`);
    console.log(`Total Credits Claimed: ${totalCredits}`);

    // Update DB
    db.prepare("UPDATE accounts SET credit = ?, status = 'active', automation_step = 'completed', updated_at = datetime('now') WHERE email = ?")
      .run(totalCredits, TARGET_EMAIL);
    console.log(`Database updated for ${TARGET_EMAIL}: credit = ${totalCredits}`);

    console.log('\n============================================================');
    console.log('RESULT SUMMARY:');
    console.log(`Email:          ${TARGET_EMAIL}`);
    console.log(`User ID:        ${numericUserId}`);
    console.log(`Done Tasks:     ${totalDone}/${tasks.length}`);
    console.log(`Total Credits:  ${totalCredits}`);
    console.log('============================================================\n');

  } catch (error) {
    if (!process.exitCode) process.exitCode = 1;
    console.error('Fatal Error:', error);
  } finally {
    await performDiagnosticCleanup({ launcher, profile, db, leaseId, proc: process });
  }
});
