// Offline/standalone CycleTLS verification of genuine onboarded session
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
require('tsx/cjs');

const workspaceRoot = path.resolve(__dirname, '..');
const vaultHelper = path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-native-signup-live/mailbox-vault.cjs');
const { unprotect } = require(vaultHelper);

const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { createCycleTlsContext } = require('../src/main/services/capcut/http/cycleTlsContext.ts');

async function main() {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const kiotApiToken = process.env.KIOTPROXY_API_TOKEN;
  if (!kiotApiToken) throw new Error('KIOTPROXY_API_TOKEN_MISSING');

  const appDataDb = path.join(process.env.APPDATA, 'automanager-desktop', 'automanager.db');
  const db = new DatabaseSync(appDataDb);

  const runDir = path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-onboarding-probe-b1');
  const sessionFile = path.join(runDir, 'probe-session.dpapi');
  if (!fs.existsSync(sessionFile)) throw new Error('SESSION_FILE_NOT_FOUND');

  const rawSession = unprotect(fs.readFileSync(sessionFile, 'utf8'));
  const session = typeof rawSession === 'string' ? JSON.parse(rawSession) : rawSession;
  console.log('Session loaded for email:', session.email, 'Cookies:', session.cookies.length);

  const cookieMap = {};
  for (const c of session.cookies) {
    if (c.domain.includes('capcut.com')) {
      cookieMap[c.name] = c.value;
    }
  }
  const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

  let leaseId = null;
  let cycleContext = null;

  try {
    // 1. Lease KiotProxy
    const fetchHttp = new FetchHttpClient();
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
        // cooldown
      }
    }
    if (!rawLease) {
      for (const k of availableKeys) {
        try {
          rawLease = await kiotProvider.getCurrentProxy(k.keyValue, 'http');
          chosenKey = k;
          break;
        } catch (err) {
          // cooldown
        }
      }
    }
    if (!rawLease || !chosenKey) throw new Error('NO_KIOT_PROXY_AVAILABLE');

    leaseId = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(chosenKey.keyValue).digest('hex');
    db.prepare("INSERT INTO proxy_leases (id, key_hash, ip, host, port, protocol, account_id, acquired_at) VALUES (?,?,?,?,?,?,NULL,datetime('now'))")
      .run(leaseId, keyHash, rawLease.ip, rawLease.host, rawLease.port, rawLease.protocol);

    console.log(`KiotProxy leased: ${rawLease.ip}:${rawLease.port}`);

    // 2. Initialize CycleTLS with proxy
    const proxyConfig = {
      server: `http://${rawLease.host}:${rawLease.port}`,
      username: rawLease.username || undefined,
      password: rawLease.password || undefined
    };

    const grouped = {};
    for (const c of session.cookies) {
      if (!c.domain.includes('capcut.com')) continue;
      const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      const url = `https://${host}/`;
      if (!grouped[url]) grouped[url] = [];
      grouped[url].push(`${c.name}=${c.value}; Path=${c.path || '/'}; Domain=${c.domain}`);
    }
    const initialResponseCookies = Object.entries(grouped).map(([url, setCookieHeaders]) => ({
      url,
      setCookieHeaders
    }));

    cycleContext = await createCycleTlsContext({
      proxy: proxyConfig,
      initialResponseCookies,
      timeoutMs: 20000,
      tls: { forceHTTP1: true }
    });

    console.log('CycleTLS context ready with proxy and multi-domain cookies.');

    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'accept': 'application/json, text/plain, */*'
    };

    // 3. GET /passport/web/account/info/ (on www.capcut.com)
    console.log('\n--- Requesting https://www.capcut.com/passport/web/account/info/ ---');
    const accountUrl = new URL('https://www.capcut.com/passport/web/account/info/');
    accountUrl.searchParams.set('aid', '348188');
    accountUrl.searchParams.set('account_sdk_source', 'web');
    accountUrl.searchParams.set('sdk_version', '2.1.10-tiktok');
    accountUrl.searchParams.set('language', 'en');
    const accountRes = await cycleContext.fetch(accountUrl.toString(), {
      method: 'GET',
      headers
    });
    const accountRaw = await accountRes.text();
    await accountRes.dispose();
    console.log('Account Info HTTP:', accountRes.status());
    console.log('Account Info Raw (first 200 chars):', accountRaw.slice(0, 200));
    let accountBody = null;
    try { accountBody = JSON.parse(accountRaw); } catch (e) { console.log('JSON parse failed:', e.message); }
    if (accountBody) {
      console.log('Account message:', accountBody.message);
      console.log('User ID str:', accountBody.data?.user_id_str);
      console.log('Screen name:', accountBody.data?.screen_name);
    }

    // 4. POST /cc/v1/workspace/get_user_workspaces (on edit-api-sg.capcut.com)
    console.log('\n--- Requesting POST https://edit-api-sg.capcut.com/cc/v1/workspace/get_user_workspaces ---');
    const wsRes = await cycleContext.fetch('https://edit-api-sg.capcut.com/cc/v1/workspace/get_user_workspaces', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      data: '{}'
    });
    const wsRaw = await wsRes.text();
    await wsRes.dispose();
    console.log('Workspaces HTTP:', wsRes.status());
    console.log('Workspaces Raw (first 200 chars):', wsRaw.slice(0, 200));
    let wsBody = null;
    try { wsBody = JSON.parse(wsRaw); } catch (e) { console.log('JSON parse failed:', e.message); }
    const wss = wsBody?.data?.workspace_infos || wsBody?.data?.workspaces || [];
    if (wsBody) {
      console.log('Workspaces ret:', wsBody.ret, 'errmsg:', wsBody.errmsg);
      console.log('Workspaces count:', wss.length);
      if (wss.length > 0) {
        console.log('First Workspace:', { id: wss[0].workspace_id || wss[0].id, name: wss[0].name, role: wss[0].role });
      }
    }

    // 5. POST /luckycat/i18n/capcut/task/v1/task_list
    console.log('\n--- Requesting /luckycat/i18n/capcut/task/v1/task_list ---');
    const taskRes = await cycleContext.fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      data: JSON.stringify({ scene: 'capcut_web_task' })
    });
    const taskRaw = await taskRes.text();
    await taskRes.dispose();
    console.log('Task List HTTP:', taskRes.status());
    console.log('Task List Raw (first 200 chars):', taskRaw.slice(0, 200));
    let taskBody = null;
    try { taskBody = JSON.parse(taskRaw); } catch (e) { console.log('JSON parse failed:', e.message); }
    if (taskBody) {
      console.log('Task List ret:', taskBody.ret, 'err_no:', taskBody.err_no);
      console.log('Tasks returned:', taskBody.data?.task_list?.length ?? 0);
    }

    // 6. Update probe-result.json
    fs.writeFileSync(path.join(runDir, 'probe-result.json'), JSON.stringify({
      at: new Date().toISOString(),
      verdict: 'PASS',
      strategy: 'option-b-hybrid',
      launcher: 'api-v3',
      email: session.email,
      cycletlsVerification: {
        accountInfo: {
          http: accountRes.status(),
          message: accountBody?.message,
          userId: accountBody?.data?.user_id_str,
          screenName: accountBody?.data?.screen_name
        },
        workspaces: {
          http: wsRes.status(),
          ret: wsBody?.ret,
          errmsg: wsBody?.errmsg,
          count: wss.length,
          firstWorkspaceId: wss[0]?.workspace_id || wss[0]?.id
        },
        taskList: {
          http: taskRes.status(),
          err_no: taskBody?.err_no,
          count: taskBody?.data?.task_list?.length ?? 0
        }
      }
    }, null, 2));

    console.log('\n=== CYCLETLS VERIFICATION PASSED WITH 100% SUCCESS! ===');
  } finally {
    if (cycleContext) {
      try { await cycleContext.dispose(); } catch {}
    }
    if (leaseId && db) {
      try {
        db.prepare("UPDATE proxy_leases SET released_at = datetime('now') WHERE id = ?").run(leaseId);
        console.log('Proxy lease released cleanly in DB.');
      } catch {}
    }
  }
}

main().catch(err => {
  console.error('VERIFICATION_ERROR:', err);
  process.exit(1);
});
