// Live Test 1 Email using CapcutEngineService + HTTP Tasks Engine + 7-day Pro Trial Check
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
const { Gmail94Provider } = require('../src/main/providers/Gmail94Provider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { CapcutEngineService } = require('../src/main/services/CapcutEngineService.ts');
const { createDirectUiInteraction } = require('../src/main/services/capcut/uiInteractionScheduler.ts');
const { generateCapcutPassword } = require('../src/main/services/passwordGenerator.ts');

app.whenReady().then(async () => {
  let db = null;
  let leaseId = null;
  let profile = null;
  let launcher = null;

  const isHeadless = process.argv.includes('--headless') || process.env.HEADLESS === '1';

  try {
    if (fs.existsSync('.env')) process.loadEnvFile('.env');
    const gmailApiKey = process.env.GMAIL94_API_KEY;
    const kiotApiToken = process.env.KIOTPROXY_API_TOKEN;
    if (!gmailApiKey) throw new Error('GMAIL94_API_KEY_MISSING');
    if (!kiotApiToken) throw new Error('KIOTPROXY_API_TOKEN_MISSING');

    console.log('\n============================================================');
    console.log('🚀 LIVE TEST CAPCUT PIPELINE (1 EMAIL)');
    console.log(`🖥️  CHẾ ĐỘ TRÌNH DUYỆT: ${isHeadless ? 'HEADLESS (Ẩn ngầm)' : 'HEADED (Hiển thị)'}`);
    console.log('============================================================\n');

    const appDataDb = path.join(app.getPath('userData'), 'automanager.db');
    db = new DatabaseSync(appDataDb);
    const fetchHttp = new FetchHttpClient();

    // 1. Thuê hộp thư Gmail94
    console.log('📧 [1/5] Đang thuê hộp thư mới từ Gmail94...');
    const gmailProvider = new Gmail94Provider(fetchHttp);
    const order = await gmailProvider.createOtpOrder(gmailApiKey, 'capcut');
    console.log(`   ✅ Đã thuê email: ${order.email} (Order ID: ${order.orderId})`);

    // 2. Thuê KiotProxy
    console.log('\n🌐 [2/5] Đang xin proxy sạch từ KiotProxy...');
    const kiotProvider = new KiotProxyProvider(fetchHttp);
    const allKeys = await kiotProvider.listKeys(kiotApiToken);
    const activeInDb = db.prepare('SELECT key_hash FROM proxy_leases WHERE released_at IS NULL').all();
    const availableKeys = allKeys.filter((k) =>
      !activeInDb.some((a) => a.key_hash === crypto.createHash('sha256').update(k.keyValue).digest('hex')) &&
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
    if (!rawLease) throw new Error('COULD_NOT_ACQUIRE_KIOT_PROXY');

    console.log(`   ✅ Đã lấy proxy: ${rawLease.ip}:${rawLease.port}`);

    leaseId = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(chosenKey.keyValue).digest('hex');
    db.prepare("INSERT INTO proxy_leases (id, key_hash, ip, host, port, protocol, account_id, acquired_at) VALUES (?,?,?,?,?,?,NULL,datetime('now'))")
      .run(leaseId, keyHash, rawLease.ip, rawLease.host, rawLease.port, rawLease.protocol);

    // 3. Khởi chạy Profile Multilogin (Headed hoặc Headless)
    console.log(`\n💻 [3/5] Khởi chạy Multilogin profile (Headless: ${isHeadless})...`);
    let mlxEmail = process.env.MULTILOGIN_EMAIL;
    let mlxPassword = process.env.MULTILOGIN_PASSWORD;
    let mlxAutoToken = process.env.MULTILOGIN_AUTOMATION_TOKEN;

    const { CredentialRepository } = require('../src/main/repositories/CredentialRepository.ts');
    const { insertMultiloginIfMissing } = require('./liveCredentials.cjs');
    const credRepo = new CredentialRepository(db);

    if (!mlxEmail || !mlxPassword) {
      const cred = credRepo.getCredential('multilogin');
      if (cred) {
        const decryptedCreds = JSON.parse(safeStorage.decryptString(Buffer.from(cred.encryptedCredentials)));
        mlxEmail = decryptedCreds.email;
        mlxPassword = decryptedCreds.password;
      }
    } else {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          const enc = safeStorage.encryptString(JSON.stringify({ email: mlxEmail, password: mlxPassword }));
          const inserted = insertMultiloginIfMissing(credRepo, Buffer.from(enc));
          if (inserted) {
            console.log('   ✅ Đã lưu cấu hình Multilogin vào service_credentials.');
          }
        }
      } catch (err) {
        console.warn('   ⚠️ Không thể lưu credentials vào SQLite:', err.message);
      }
    }

    const mlxApi = new MultiloginProvider(fetchHttp);
    let tokenSource;
    if (mlxEmail && mlxPassword) {
      console.log(`   🔑 Đang đăng nhập Multilogin: ${mlxEmail}...`);
      const signinResult = await mlxApi.signIn(mlxEmail, mlxPassword);
      tokenSource = { getAccessToken: async () => signinResult.token };
      console.log('   ✅ Đăng nhập Multilogin thành công!');
    } else if (mlxAutoToken) {
      console.log('   🔑 Dùng MULTILOGIN_AUTOMATION_TOKEN...');
      tokenSource = { getAccessToken: async () => mlxAutoToken };
    } else {
      throw new Error('MULTILOGIN_CREDENTIALS_NOT_FOUND');
    }

    launcher = new ApiV3Launcher(tokenSource, mlxApi, {
      portTimeoutMs: 60_000,
      log: (msg) => console.log(`   [Launcher] ${msg}`)
    });

    const signal = AbortSignal.timeout(600_000);
    const ui = createDirectUiInteraction(signal, 'native');

    profile = await launcher.launch({
      headless: isHeadless,
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
    console.log(`   ✅ Trình duyệt đã sẵn sàng (Profile ID: ${profile.profileId})`);

    // 4. Khởi chạy CapcutEngineService chạy luồng chuẩn
    console.log('\n⚡ [4/5] Khởi động CapcutEngineService (Đăng ký -> Check Trial -> 12 HTTP Tasks)...');
    const email = order.email;
    const password = generateCapcutPassword({ mode: 'random', length: 14, uppercase: true, numbers: true, special: true });
    const accountId = crypto.randomUUID();

    const getOtp = async () => {
      console.log('   ⏳ Đang chờ mã OTP xác minh từ Gmail94...');
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const otp = await gmailProvider.readOtp(gmailApiKey, order.orderId, 'capcut');
        if (otp) {
          console.log(`   📩 Đã nhận mã OTP: ${otp}`);
          return otp;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error('OTP_TIMEOUT');
    };

    const engine = new CapcutEngineService({
      userDataDir: path.join(app.getPath('userData')),
      skipWithoutTrial: false,
      getOtp
    });

    const abortController = new AbortController();
    const sessionAlias = 'test-session-1';

    const accountResult = await engine.runAccount({
      page: profile.page,
      context: profile.context,
      email,
      password,
      accountId,
      isNewAccount: true,
      getOtp,
      skipWithoutTrial: false,
      signal: abortController.signal,
      ui: createDirectUiInteraction(abortController.signal),
      sessionAlias,
      sessionStartedAt: Date.now(),
      log: (status, step, msg) => {
        const icon = status === 'SUCCESS' ? '✅' : status === 'WARNING' ? '⚠️' : status === 'ERROR' ? '❌' : 'ℹ️';
        console.log(`   ${icon} [${step}] ${msg}`);
      }
    });

    console.log('\n============================================================');
    console.log('📊 KẾT QUẢ THỰC THI CAPCUT ENGINE:');
    console.log(`   • Trạng thái đăng nhập: ${accountResult.authenticated ? 'THÀNH CÔNG' : 'THẤT BẠI'}`);
    console.log(`   • Gói ưu đãi: ${accountResult.subscription}`);
    console.log(`   • Hoàn thành nhiệm vụ: ${accountResult.done}/${accountResult.total} tasks`);
    console.log(`   • Tổng credits nhận được: ${accountResult.credits}/${accountResult.creditsTotal}`);
    console.log(`   • Biên lai xác minh (Receipt): ${accountResult.verification?.complete ? 'HỢP LỆ (100% COMPLETE)' : 'CHƯA XONG'}`);
    console.log('============================================================\n');

    // 5. Lưu vào Database
    console.log('💾 [5/5] Cập nhật thông tin vào SQLite Database...');
    const encPass = safeStorage.encryptString(password);
    db.prepare(`
      INSERT INTO accounts (
        id, email, email_provider, password_capcut_encrypted,
        credit, subscription, status, automation_step, notes, created_at, updated_at
      ) VALUES (?, ?, 'gmail94', ?, ?, ?, 'active', 'ready', ?, datetime('now'), datetime('now'))
    `).run(
      accountId,
      email,
      encPass,
      accountResult.credits,
      accountResult.subscription,
      `Engine HTTP Tasks: ${accountResult.done}/${accountResult.total} tasks, ${accountResult.credits} credits`
    );

    for (const t of accountResult.tasks) {
      db.prepare(`
        INSERT INTO account_tasks (
          account_id, task_key, title, reward, status, op_id, proved_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(account_id, task_key) DO UPDATE SET
          title = excluded.title,
          reward = excluded.reward,
          status = excluded.status,
          op_id = COALESCE(excluded.op_id, account_tasks.op_id),
          proved_at = COALESCE(excluded.proved_at, account_tasks.proved_at),
          updated_at = excluded.updated_at
      `).run(
        accountId,
        t.key,
        t.title,
        t.reward,
        t.status,
        t.opId || null,
        t.provedAt || null
      );
    }
    console.log(`   ✅ Đã lưu tài khoản ${email} và ${accountResult.tasks.length} bản ghi nhiệm vụ vào CSDL!`);

  } catch (err) {
    console.error('\n❌ LỖI TRONG QUÁ TRÌNH CHẠY TEST:', err);
  } finally {
    console.log('\n🧹 ĐANG DỌN DẸP TÀI NGUYÊN...');
    if (launcher && profile?.profileId) {
      try {
        console.log(`   → Đóng profile Multilogin: ${profile.profileId}...`);
        await launcher.stop(profile.profileId);
        console.log('   ✅ Profile đã đóng an toàn.');
      } catch (e) {
        console.error('   ⚠️ Lỗi đóng profile:', e.message);
      }
    }
    if (db && leaseId) {
      try {
        db.prepare('UPDATE proxy_leases SET released_at = datetime(\'now\') WHERE id = ?').run(leaseId);
        console.log('   ✅ Đã giải phóng proxy lease khỏi database.');
      } catch (e) {
        console.error('   ⚠️ Lỗi giải phóng lease:', e.message);
      }
    }
    if (db) db.close();
    console.log('\n🏁 HOÀN TẤT!');
    app.quit();
  }
});
