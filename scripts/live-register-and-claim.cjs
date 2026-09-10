// End-to-end New Account Registration & Task Claiming via Multilogin api-v3
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
require('tsx/cjs');

app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

const workspaceRoot = path.resolve(__dirname, '..');
const { ApiV3Launcher } = require('../src/main/services/capcut/launcher/ApiV3Launcher.ts');
const { MultiloginProvider } = require('../src/main/providers/MultiloginProvider.ts');
const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { Gmail94Provider } = require('../src/main/providers/Gmail94Provider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { signupCapcut } = require('../src/main/services/capcut/signup.ts');
const { createDirectUiInteraction } = require('../src/main/services/capcut/uiInteractionScheduler.ts');
const { performDiagnosticCleanup } = require('./legacy-diagnostic-helpers.cjs');

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
    const gmailApiKey = process.env.GMAIL94_API_KEY;
    const kiotApiToken = process.env.KIOTPROXY_API_TOKEN;
    if (!gmailApiKey) throw new Error('GMAIL94_API_KEY_MISSING');
    if (!kiotApiToken) throw new Error('KIOTPROXY_API_TOKEN_MISSING');

    const appDataDb = path.join(app.getPath('userData'), 'automanager.db');
    db = new DatabaseSync(appDataDb);
    const fetchHttp = new FetchHttpClient();

    console.log('=== STEP 1: RENTING MAILBOX FROM GMAIL94 ===');
    const gmailProvider = new Gmail94Provider(fetchHttp);
    const order = await gmailProvider.createOtpOrder(gmailApiKey, 'capcut');
    console.log(`Rented mailbox: ${order.email} (Order ID: ${order.orderId})`);

    console.log('=== STEP 2: LEASING KIOTPROXY ===');
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
        rawLease = await kiotProvider.getNewProxy(k.keyValue, { protocol: 'http' });
        chosenKey = k;
        break;
      } catch {}
    }
    if (!rawLease) {
      for (const k of availableKeys) {
        try {
          rawLease = await kiotProvider.getCurrentProxy(k.keyValue, 'http');
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

    console.log('=== STEP 3: LAUNCHING MULTILOGIN API-V3 ===');
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

    console.log('=== STEP 4: SIGNING UP ACCOUNT ===');
    const password = 'Capcut_' + crypto.randomBytes(4).toString('hex') + '!2026';
    const email = order.email;
    const orderId = order.orderId;

    const getOtp = async (targetEmail) => {
      console.log(`Polling OTP for ${targetEmail}...`);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        try {
          const res = await fetch(`https://gmail94.com/api/otp/read?token=${encodeURIComponent(gmailApiKey)}&order_id=${encodeURIComponent(orderId)}&service=capcut`);
          const json = await res.json();
          if (json.otp) {
            console.log(`OTP Received: ${String(json.otp).slice(0, 2)}****`);
            return String(json.otp);
          }
        } catch (e) {
          console.log(`OTP poll error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      throw new Error('OTP_TIMEOUT_AFTER_120S');
    };

    const signupResult = await signupCapcut(page, context, { email, password }, {
      log: msg => console.log(`[Signup] ${msg}`),
      getOtp,
      ui,
      signal
    });
    console.log('Signup completed successfully!', signupResult);

    // Save to accounts table in DB
    const accountId = crypto.randomUUID();
    const encPass = safeStorage.encryptString(password);
    db.prepare(`
      INSERT INTO accounts (
        id, email, email_provider, password_capcut_encrypted,
        credit, subscription, status, automation_step, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      accountId,
      email,
      'gmail94',
      encPass,
      0,
      'free',
      'active',
      'registered',
      'Created via Live Register & Claim workflow'
    );
    console.log(`Account ${email} saved to database (ID: ${accountId})`);

    console.log('=== STEP 5: EXTRACTING REAL NUMERIC USER ID & FIRING DO_ACTION ===');
    await page.waitForTimeout(3000);
    const userInfoResult = await page.evaluate(async () => {
      try {
        const r1 = await fetch('/passport/web/account/info/');
        const d1 = await r1.json();
        if (d1.data?.user_id_str) return d1.data.user_id_str;
        if (d1.data?.user_id) return String(d1.data.user_id);
      } catch {}
      try {
        const r2 = await fetch('/lv/v1/user/web/user_info');
        const d2 = await r2.json();
        if (d2.data?.user_info?.user_id) return String(d2.data.user_info.user_id);
        if (d2.data?.user_id) return String(d2.data.user_id);
      } catch {}
      return null;
    });

    const numericUserId = userInfoResult;
    console.log(`Resolved Numeric User ID: ${numericUserId || 'unknown'}`);
    if (!numericUserId) throw new Error('FAILED_TO_RESOLVE_NUMERIC_USER_ID');

    const today = new Date().toISOString().slice(0, 10);
    for (const actionKey of LEAF_TASKS) {
      const opId = `${actionKey}_${numericUserId}_${today}`;
      console.log(`Executing do_action for: ${actionKey}...`);
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
      console.log(`-> ${actionKey}:`, JSON.stringify(res));
      await page.waitForTimeout(1000 + Math.floor(Math.random() * 500));
    }

    console.log('=== STEP 6: NAVIGATING TO TASK ROUTE & CLAIMING REWARDS ===');
    await page.goto('https://www.capcut.com/my-edit?section=inspiration_feeds&enter_source=web_task_earn_credit', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(4000);

    // Dismiss any modal/dialog if present
    const skipBtn = page.locator('button:has-text("Skip"), button:has-text("Got it"), [class*="skip"]').first();
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Try clicking task entry to open popover if needed
    const taskEntry = page.locator('[data-id="TitleBarTaskList"], [class*="Lv_Task-wrapper"], button.entry-').first();
    if (await taskEntry.isVisible().catch(() => false)) {
      console.log('Clicking task entry button to ensure popover is open...');
      await taskEntry.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Loop to claim all pending tasks
    console.log('Scanning for Claim buttons...');
    let totalClaimed = 0;
    for (let round = 0; round < 10; round++) {
      const claimButtons = page.locator('button').filter({ hasText: /^Claim$/i });
      const count = await claimButtons.count().catch(() => 0);
      if (count === 0) {
        console.log(`Round ${round + 1}: No more Claim buttons found.`);
        break;
      }
      console.log(`Round ${round + 1}: Found ${count} Claim button(s). Clicking...`);
      for (let i = 0; i < count; i++) {
        const btn = claimButtons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 5000 }).catch(e => console.log('Click error:', e.message));
          totalClaimed++;
          await page.waitForTimeout(1500);
        }
      }
      await page.waitForTimeout(2000);
    }
    console.log(`Total Claim clicks performed: ${totalClaimed}`);

    console.log('=== STEP 7: VERIFYING FINAL TASK LIST & CREDITS ===');
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
    let totalEarned = 0;
    for (const t of tasks) {
      console.log(`- ${t.task_key.padEnd(45)} | Status: ${t.task_status} | Button: ${(t.task_view?.button_text || '').padEnd(6)} | Reward: +${t.task_reward_view?.reward_amount}`);
      if (t.task_status === 4) totalEarned += (t.task_reward_view?.reward_amount || 0);
    }
    console.log(`Total Credits Earned (Status 4): ${totalEarned}`);

    // Update DB
    db.prepare("UPDATE accounts SET credit = ?, status = 'active', automation_step = 'completed', updated_at = datetime('now') WHERE id = ?").run(totalEarned, accountId);

    console.log('\n========================================');
    console.log('ACCOUNT REGISTRATION & TASK SUMMARY:');
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log(`User ID:  ${numericUserId}`);
    console.log(`Credits:  ${totalEarned}`);
    console.log('========================================\n');

  } catch (error) {
    if (!process.exitCode) process.exitCode = 1;
    console.error('Fatal Error:', error);
  } finally {
    await performDiagnosticCleanup({ launcher, profile, db, leaseId, proc: process });
  }
});
