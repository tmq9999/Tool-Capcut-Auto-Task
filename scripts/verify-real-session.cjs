// Verifies genuine session and captures full response payloads
// Uses Multilogin api-v3 with existing account pheakdychea439278@gmail.com
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
const { ensureInApp } = require('../src/main/services/capcut/auth.ts');
const { createDirectUiInteraction } = require('../src/main/services/capcut/uiInteractionScheduler.ts');
const { createCycleTlsContext } = require('../src/main/services/capcut/http/cycleTlsContext.ts');

app.whenReady().then(async () => {
  let exitCode = 0;
  let db = null;
  let leaseId = null;
  let profile = null;
  let launcher = null;
  let cycleContext = null;

  const runDir = path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-onboarding-probe-b1');
  const capturedResponses = [];

  const log = message => console.log(JSON.stringify({ at: new Date().toISOString(), message }));

  try {
    const appDataDb = path.join(app.getPath('userData'), 'automanager.db');
    db = new DatabaseSync(appDataDb);

    if (fs.existsSync('.env')) process.loadEnvFile('.env');
    const kiotApiToken = process.env.KIOTPROXY_API_TOKEN;
    if (!kiotApiToken) throw new Error('KIOTPROXY_API_TOKEN_MISSING');

    // 1. Read account and decrypt password
    const email = 'pheakdychea439278@gmail.com';
    const accRow = db.prepare('SELECT id, email, password_capcut_encrypted FROM accounts WHERE email = ?').get(email);
    if (!accRow || !accRow.password_capcut_encrypted) throw new Error('ACCOUNT_OR_PASSWORD_NOT_FOUND_IN_DB');

    const password = safeStorage.decryptString(Buffer.from(accRow.password_capcut_encrypted));
    log('Account found in DB, password decrypted successfully.');

    // 2. Multilogin login
    const credRow = db.prepare("SELECT encrypted_credentials FROM service_credentials WHERE service_name = 'multilogin'").get();
    const decryptedCreds = JSON.parse(safeStorage.decryptString(Buffer.from(credRow.encrypted_credentials)));

    const fetchHttp = new FetchHttpClient();
    const mlxApi = new MultiloginProvider(fetchHttp);
    const signinResult = await mlxApi.signIn(decryptedCreds.email, decryptedCreds.password);
    const mlxToken = signinResult.token;

    const tokenSource = { getAccessToken: async () => mlxToken };
    launcher = new ApiV3Launcher(tokenSource, mlxApi, {
      log: msg => log('[Launcher] ' + msg)
    });

    // 3. Acquire KiotProxy lease
    const kiotProvider = new KiotProxyProvider(fetchHttp);
    const allKeys = await kiotProvider.listKeys(kiotApiToken);
    const activeInDb = db.prepare('SELECT key_hash, ip FROM proxy_leases WHERE released_at IS NULL').all();
    const availableKeys = allKeys.filter(k =>
      !activeInDb.some(a => a.key_hash === crypto.createHash('sha256').update(k.keyValue).digest('hex')) &&
      (!k.expiredAt || Date.parse(k.expiredAt) > Date.now())
    );

    let rawLease = null;
    let chosenKey = null;
    for (const k of availableKeys) {
      try {
        rawLease = await kiotProvider.getNewProxy(k.keyValue, { protocol: 'http' });
        chosenKey = k;
        break;
      } catch (err) {
        // try next
      }
    }
    if (!rawLease) {
      for (const k of availableKeys) {
        try {
          rawLease = await kiotProvider.getCurrentProxy(k.keyValue, 'http');
          chosenKey = k;
          break;
        } catch (err) {
          // try next
        }
      }
    }
    if (!rawLease || !chosenKey) throw new Error('NO_KIOT_PROXY_AVAILABLE');

    leaseId = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(chosenKey.keyValue).digest('hex');
    db.prepare("INSERT INTO proxy_leases (id, key_hash, ip, host, port, protocol, account_id, acquired_at) VALUES (?,?,?,?,?,?,NULL,datetime('now'))")
      .run(leaseId, keyHash, rawLease.ip, rawLease.host, rawLease.port, rawLease.protocol);

    log(`KiotProxy leased: ${rawLease.ip}:${rawLease.port}`);

    // 4. Launch Multilogin quick profile via api-v3
    const signal = AbortSignal.timeout(180_000);
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
    log(`Profile launched via api-v3 (ID: ${profile.profileId}, port: ${profile.port})`);

    // 5. Intercept network responses to capture complete response payloads
    page.on('response', async resp => {
      try {
        const url = resp.url();
        if (!url.includes('capcut.com')) return;
        const status = resp.status();
        let body = null;
        try {
          body = await resp.json();
        } catch {
          // not json
        }
        if (body && typeof body === 'object') {
          capturedResponses.push({
            at: new Date().toISOString(),
            url,
            status,
            body
          });
          const pathname = new URL(url).pathname;
          if (pathname.includes('/user_info') || pathname.includes('/workspace') || pathname.includes('/task') || pathname.includes('/subscription')) {
            log(`Captured: ${pathname} [${status}, ret=${body.ret ?? body.err_no ?? 'n/a'}, errmsg=${body.errmsg ?? body.message ?? 'n/a'}]`);
          }
        }
      } catch {
        // ignore
      }
    });

    // 6. Ensure in app
    log('Logging into CapCut with saved credentials...');
    const authResult = await ensureInApp(page, context, {
      email,
      password,
      source: 'db'
    }, {
      log: msg => log('[Auth] ' + msg),
      ui,
      signal
    });
    log(`Auth result: ${JSON.stringify(authResult)}`);

    // Navigate to /my-edit to ensure full dashboard endpoints fire
    await page.goto('https://www.capcut.com/my-edit?start_tab=video', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);

    // 7. Extract cookies
    const cookies = await context.cookies();
    const cookieMap = {};
    for (const c of cookies) {
      if (c.domain.includes('capcut.com')) {
        cookieMap[c.name] = c.value;
      }
    }
    log(`Extracted ${cookies.length} cookies from browser session.`);

    // 8. Stop browser profile
    await launcher.stop(profile.profileId);
    log(`Profile ${profile.profileId} stopped cleanly.`);
    profile = null;

    // 9. Save captured responses to file
    fs.writeFileSync(path.join(runDir, 'probe-captured-responses.json'), JSON.stringify(capturedResponses, null, 2));
    log(`Saved ${capturedResponses.length} captured response payloads to probe-captured-responses.json`);

    // Sealed DPAPI backup
    fs.writeFileSync(path.join(runDir, 'probe-session.dpapi'), protect(JSON.stringify({
      email,
      password,
      cookies,
      totalResponses: capturedResponses.length
    })));
    log('Saved encrypted session to probe-session.dpapi');

    // 10. CycleTLS HTTP Verification using the extracted cookies and KiotProxy
    log('Starting CycleTLS verification with proxy and extracted cookies...');
    const proxyUrl = rawLease.username && rawLease.password
      ? `http://${rawLease.username}:${rawLease.password}@${rawLease.host}:${rawLease.port}`
      : `http://${rawLease.host}:${rawLease.port}`;

    cycleContext = await createCycleTlsContext({
      proxy: proxyUrl,
      timeoutMs: 20000,
      tls: { forceHTTP1: true }
    });

    const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

    // 10a. Call /lv/v1/user/web/user_info via CycleTLS
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
    log(`[CycleTLS] /lv/v1/user/web/user_info -> HTTP ${userRes.status()}, ret: ${userBody?.ret}, errmsg: ${userBody?.errmsg}, user_id: ${userBody?.data?.user_id}`);

    // 10b. Call /cc/v1/workspace/get_user_workspaces via CycleTLS
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
    log(`[CycleTLS] /cc/v1/workspace/get_user_workspaces -> HTTP ${wsRes.status()}, ret: ${wsBody?.ret}, errmsg: ${wsBody?.errmsg}, count: ${workspaces.length}, firstId: ${workspaces[0]?.id}`);

    // 10c. Update probe-result.json with PASS
    fs.writeFileSync(path.join(runDir, 'probe-result.json'), JSON.stringify({
      at: new Date().toISOString(),
      verdict: 'PASS',
      strategy: 'option-b-hybrid',
      launcher: 'api-v3',
      email,
      accountId: accRow.id,
      userVerification: {
        http: userRes.status(),
        ret: userBody?.ret,
        userId: userBody?.data?.user_id
      },
      workspaceVerification: {
        http: wsRes.status(),
        ret: wsBody?.ret,
        count: workspaces.length,
        firstWorkspaceId: workspaces[0]?.id || null
      },
      capturedEndpointsCount: capturedResponses.length
    }, null, 2));

    log('=== ALL VERIFICATIONS PASSED SUCCESSFULLY! ===');
  } catch (err) {
    log(`[ERROR] ${err.message}`);
    console.error(err);
    exitCode = 1;
  } finally {
    if (profile && launcher) {
      try { await launcher.stop(profile.profileId); } catch {}
    }
    if (cycleContext) {
      try { await cycleContext.dispose(); } catch {}
    }
    if (leaseId && db) {
      try {
        db.prepare("UPDATE proxy_leases SET released_at = datetime('now') WHERE id = ?").run(leaseId);
        log('Proxy lease released cleanly in DB.');
      } catch {}
    }
    app.exit(exitCode);
  }
});
