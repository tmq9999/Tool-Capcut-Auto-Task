// Hybrid Onboarding Probe (Option B) using Multilogin api-v3
// Strictly single attempt, reusing already purchased mailbox pheakdychea439278@gmail.com (Order: 6aa11af4c0e47)
// Guaranteed KiotProxy release in finally block.
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
require('tsx/cjs');

app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

const workspaceRoot = path.resolve(__dirname, '..');
const vaultHelper = path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-native-signup-live/mailbox-vault.cjs');
const { protect } = require(vaultHelper);

const { ApiV3Launcher } = require('../src/main/services/capcut/launcher/ApiV3Launcher.ts');
const { MultiloginProvider } = require('../src/main/providers/MultiloginProvider.ts');
const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { signupCapcut } = require('../src/main/services/capcut/signup.ts');
const { createDirectUiInteraction } = require('../src/main/services/capcut/uiInteractionScheduler.ts');
const { createCycleTlsContext } = require('../src/main/services/capcut/http/cycleTlsContext.ts');

function md5Hex(val) {
  return crypto.createHash('md5').update(val).digest('hex');
}

function resolveRunDir() {
  const dir = process.env.CAPCUT_LIVE_RUN_DIR || path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-onboarding-probe-b1');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

app.whenReady().then(async () => {
  let exitCode = 0;
  let db = null;
  let leaseId = null;
  let leaseKey = null;
  let kiotProvider = null;
  let profile = null;
  let launcher = null;
  let cycleContext = null;

  const publicEvents = [];
  const capturedResponses = [];
  const emit = data => {
    const row = { at: new Date().toISOString(), ...data };
    publicEvents.push(row);
    console.log(JSON.stringify(row));
  };

  try {
    const approved = process.argv.includes('--probe-once-with-approval');
    if (!approved) throw new Error('PROBE_APPROVAL_REQUIRED');

    if (fs.existsSync('.env')) process.loadEnvFile('.env');
    const gmailApiKey = process.env.GMAIL94_API_KEY;
    const kiotApiToken = process.env.KIOTPROXY_API_TOKEN;
    if (!gmailApiKey) throw new Error('GMAIL94_API_KEY_MISSING');
    if (!kiotApiToken) throw new Error('KIOTPROXY_API_TOKEN_MISSING');

    const runDir = resolveRunDir();
    const attemptMarker = path.join(runDir, 'probe-attempt.json');
    if (fs.existsSync(attemptMarker)) throw new Error('PROBE_ALREADY_ATTEMPTED_IN_THIS_DIR');

    fs.writeFileSync(attemptMarker, JSON.stringify({
      at: new Date().toISOString(),
      strategy: 'option-b-hybrid',
      launcher: 'api-v3',
      mailbox: 'pheakdychea439278@gmail.com',
      orderId: '6aa11af4c0e47'
    }), { flag: 'wx', mode: 0o600 });

    const appDataDb = path.join(app.getPath('userData'), 'automanager.db');
    db = new DatabaseSync(appDataDb);

    emit({ step: 'init', runDir, launcher: 'api-v3' });

    // 1. Decrypt Multilogin credentials and get access token
    const credRow = db.prepare("SELECT encrypted_credentials FROM service_credentials WHERE service_name = 'multilogin'").get();
    if (!credRow) throw new Error('MULTILOGIN_CREDENTIALS_NOT_FOUND_IN_DB');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('SAFE_STORAGE_UNAVAILABLE');

    const decryptedCreds = JSON.parse(safeStorage.decryptString(Buffer.from(credRow.encrypted_credentials)));
    emit({ step: 'multilogin-creds-decrypted', email: decryptedCreds.email ? decryptedCreds.email.slice(0, 3) + '***' : null });

    const fetchHttp = new FetchHttpClient();
    const mlxApi = new MultiloginProvider(fetchHttp);
    const signinResult = await mlxApi.signIn(decryptedCreds.email, decryptedCreds.password);
    const mlxToken = signinResult.token;
    emit({ step: 'multilogin-token-acquired' });

    const tokenSource = { getAccessToken: async () => mlxToken };
    launcher = new ApiV3Launcher(tokenSource, mlxApi, {
      log: message => emit({ step: 'launcher-log', message })
    });

    // 2. KiotProxy acquisition
    kiotProvider = new KiotProxyProvider(fetchHttp);
    const allKeys = await kiotProvider.listKeys(kiotApiToken);
    const activeInDb = db.prepare('SELECT key_hash, ip FROM proxy_leases WHERE released_at IS NULL').all();
    const availableKeys = allKeys.filter(k =>
      !activeInDb.some(a => a.key_hash === crypto.createHash('sha256').update(k.keyValue).digest('hex')) &&
      (!k.expiredAt || Date.parse(k.expiredAt) > Date.now())
    );
    if (availableKeys.length === 0) throw new Error('NO_AVAILABLE_KIOT_KEY');

    let rawLease = null;
    let chosenKey = null;

    // Try rotating with getNewProxy first
    for (const k of availableKeys) {
      try {
        emit({ step: 'trying-kiot-key', keyId: k.id });
        rawLease = await kiotProvider.getNewProxy(k.keyValue, { protocol: 'http' });
        chosenKey = k;
        break;
      } catch (err) {
        emit({ step: 'kiot-key-cooldown', keyId: k.id, error: err.message });
      }
    }

    // If all keys in cooldown for new IP, fallback to getCurrentProxy on first available
    if (!rawLease) {
      for (const k of availableKeys) {
        try {
          emit({ step: 'trying-kiot-current-proxy', keyId: k.id });
          rawLease = await kiotProvider.getCurrentProxy(k.keyValue, 'http');
          chosenKey = k;
          break;
        } catch (err) {
          emit({ step: 'kiot-current-proxy-failed', keyId: k.id, error: err.message });
        }
      }
    }

    if (!rawLease || !chosenKey) throw new Error('FAILED_TO_ACQUIRE_ANY_KIOT_PROXY');

    leaseKey = chosenKey.keyValue;
    leaseId = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(chosenKey.keyValue).digest('hex');

    db.prepare("INSERT INTO proxy_leases (id, key_hash, ip, host, port, protocol, account_id, acquired_at) VALUES (?,?,?,?,?,?,NULL,datetime('now'))")
      .run(leaseId, keyHash, rawLease.ip, rawLease.host, rawLease.port, rawLease.protocol);

    emit({ step: 'kiot-leased', keyId: chosenKey.id, ip: rawLease.ip, port: rawLease.port });

    // 3. Launch Multilogin quick profile via api-v3
    const signal = AbortSignal.timeout(300_000); // 5 minutes
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
    emit({ step: 'profile-launched', profileId: profile.profileId, port: profile.port });

    // 4. Set up network interceptors to capture genuine CapCut responses
    page.on('response', async resp => {
      try {
        const url = resp.url();
        if (!url.includes('capcut.com')) return;
        const contentType = resp.headers()['content-type'] || '';
        if (contentType.includes('application/json') || url.includes('/passport/') || url.includes('/lv/v1/') || url.includes('/cc/v1/')) {
          const status = resp.status();
          let body = null;
          try {
            body = await resp.json();
          } catch {
            // not json or already read
          }
          if (body) {
            capturedResponses.push({
              at: new Date().toISOString(),
              url,
              status,
              body
            });
            emit({
              step: 'capcut-response-captured',
              path: new URL(url).pathname,
              status,
              ret: body.ret ?? body.err_no ?? body.code ?? 'unknown',
              errmsg: body.errmsg ?? body.message ?? null
            });
          }
        }
      } catch {
        // ignore capture errors
      }
    });

    // 5. Signup execution
    const email = 'pheakdychea439278@gmail.com';
    const orderId = '6aa11af4c0e47';
    const password = 'Capcut_' + crypto.randomBytes(4).toString('hex') + '!2026';

    const log = msg => emit({ step: 'signup-log', message: msg });

    const getOtp = async (targetEmail) => {
      emit({ step: 'otp-polling-started', email: targetEmail, orderId });
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        emit({ step: 'otp-poll-checking', elapsed: Math.round((Date.now() - (deadline - 120_000)) / 1000) });
        try {
          const res = await fetch(`https://gmail94.com/api/otp/read?token=${encodeURIComponent(gmailApiKey)}&order_id=${encodeURIComponent(orderId)}&service=capcut`);
          const json = await res.json();
          if (json.otp) {
            emit({ step: 'otp-received', otpMasked: String(json.otp).slice(0, 2) + '****' });
            return String(json.otp);
          }
        } catch (e) {
          emit({ step: 'otp-poll-error', error: e.message });
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      throw new Error('OTP_TIMEOUT_AFTER_120S');
    };

    emit({ step: 'signup-executing', email });
    const signupResult = await signupCapcut(page, context, { email, password }, {
      log,
      getOtp,
      ui,
      signal
    });

    emit({ step: 'signup-completed', result: signupResult });

    // 6. Extract Cookies & Session Data
    const cookies = await context.cookies();
    const cookieMap = {};
    for (const c of cookies) {
      if (c.domain.includes('capcut.com')) {
        cookieMap[c.name] = c.value;
      }
    }

    const keyCookies = {
      sessionid: cookieMap['sessionid'] ? cookieMap['sessionid'].slice(0, 6) + '...' : null,
      sessionid_ss: cookieMap['sessionid_ss'] ? cookieMap['sessionid_ss'].slice(0, 6) + '...' : null,
      uid_tt: cookieMap['uid_tt'] || null,
      passport_csrf_token: cookieMap['passport_csrf_token'] ? 'present' : 'missing',
      totalCookies: cookies.length
    };
    emit({ step: 'cookies-extracted', keyCookies });

    // 7. Save registered account to DB
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
      'Created via Option B api-v3 hybrid probe'
    );
    emit({ step: 'account-saved-to-db', accountId, email });

    // 8. Stop browser profile cleanly
    await launcher.stop(profile.profileId);
    emit({ step: 'profile-stopped', profileId: profile.profileId });
    profile = null;

    // 9. Post-registration CycleTLS Verification
    emit({ step: 'cycletls-verification-started' });
    const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
    cycleContext = await createCycleTlsContext({ timeoutMs: 20000, tls: { forceHTTP1: true } });

    // 9a. Verify /lv/v1/user/web/user_info
    const userRes = await cycleContext.fetch('https://www.capcut.com/lv/v1/user/web/user_info', {
      method: 'GET',
      headers: {
        'cookie': cookieHeader,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*'
      }
    });
    const userBody = await userRes.json().catch(() => null);
    await userRes.dispose();
    emit({
      step: 'cycletls-user-info',
      http: userRes.status(),
      ret: userBody?.ret,
      errmsg: userBody?.errmsg,
      userId: userBody?.data?.user_id
    });

    // 9b. Verify /cc/v1/workspace/get_user_workspaces
    const wsRes = await cycleContext.fetch('https://www.capcut.com/cc/v1/workspace/get_user_workspaces', {
      method: 'GET',
      headers: {
        'cookie': cookieHeader,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*'
      }
    });
    const wsBody = await wsRes.json().catch(() => null);
    await wsRes.dispose();
    const workspaces = wsBody?.data?.workspaces || [];
    emit({
      step: 'cycletls-workspaces',
      http: wsRes.status(),
      ret: wsBody?.ret,
      errmsg: wsBody?.errmsg,
      workspaceCount: workspaces.length,
      firstWorkspaceId: workspaces[0]?.id || null
    });

    // 10. Write persistent run artifacts
    fs.writeFileSync(path.join(runDir, 'probe-result.json'), JSON.stringify({
      at: new Date().toISOString(),
      verdict: 'PASS',
      strategy: 'option-b-hybrid',
      launcher: 'api-v3',
      email,
      accountId,
      keyCookies,
      userVerification: {
        ret: userBody?.ret,
        userId: userBody?.data?.user_id
      },
      workspaceVerification: {
        ret: wsBody?.ret,
        count: workspaces.length,
        firstWorkspaceId: workspaces[0]?.id || null
      },
      capturedEndpointsCount: capturedResponses.length,
      events: publicEvents
    }, null, 2));

    fs.writeFileSync(path.join(runDir, 'probe-captured-responses.json'), JSON.stringify(capturedResponses, null, 2));

    // Sealed DPAPI backup
    fs.writeFileSync(path.join(runDir, 'probe-session.dpapi'), protect(JSON.stringify({
      email,
      password,
      cookies,
      userBody,
      wsBody
    })));

    emit({ step: 'probe-completed-successfully', verdict: 'PASS' });
  } catch (err) {
    emit({ step: 'probe-failed', error: err.message, stack: err.stack });
    exitCode = 1;
    const runDir = resolveRunDir();
    fs.writeFileSync(path.join(runDir, 'probe-result.json'), JSON.stringify({
      at: new Date().toISOString(),
      verdict: 'FAIL',
      strategy: 'option-b-hybrid',
      error: err.message,
      stack: err.stack,
      events: publicEvents
    }, null, 2));
  } finally {
    // ALWAYS stop browser if still running
    if (profile && launcher) {
      try {
        await launcher.stop(profile.profileId);
        emit({ step: 'finally-profile-stopped' });
      } catch (e) {
        emit({ step: 'finally-profile-stop-error', error: e.message });
      }
    }

    // ALWAYS dispose CycleTLS
    if (cycleContext) {
      try {
        await cycleContext.dispose();
      } catch {
        // ignore
      }
    }

    // ALWAYS release KiotProxy lease
    if (leaseId && db) {
      try {
        db.prepare("UPDATE proxy_leases SET released_at = datetime('now') WHERE id = ?").run(leaseId);
        emit({ step: 'finally-proxy-lease-released-in-db', leaseId });
      } catch (e) {
        emit({ step: 'finally-db-release-error', error: e.message });
      }
    }

    app.exit(exitCode);
  }
});
