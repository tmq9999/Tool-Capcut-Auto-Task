// Diagnostic one-email onboarding probe harness (Option C).
// Strictly single attempt, max 1 mailbox (1,000 VND), 1 KiotProxy lease with guaranteed release.
require('tsx/cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createCycleTlsContext } = require('../src/main/services/capcut/http/cycleTlsContext.ts');
const { Gmail94Provider } = require('../src/main/providers/Gmail94Provider.ts');
const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { parseTrialOffers } = require('../src/main/services/capcut/http/trialOffers.ts');

const vaultHelper = path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-native-signup-live/mailbox-vault.cjs');
const { protect, unprotect } = require(vaultHelper);
const { pollGmailOtp } = require('./legacy-diagnostic-helpers.cjs');

function resolveRunDir() {
  const dir = process.env.CAPCUT_LIVE_RUN_DIR || path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-onboarding-probe-r3');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const encodeMix = value => Buffer.from(value, 'utf8').map(b => b ^ 5).toString('hex');

async function main() {
  const approved = process.argv.includes('--probe-once-with-approval');
  if (!approved) throw new Error('PROBE_APPROVAL_REQUIRED');

  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  if (process.env.VERIFY_GMAIL94_BUY !== '1') throw new Error('VERIFY_GMAIL94_BUY_FLAG_REQUIRED');
  if (!process.env.GMAIL94_API_KEY) throw new Error('GMAIL94_API_KEY_MISSING');
  if (!process.env.KIOTPROXY_API_TOKEN) throw new Error('KIOTPROXY_API_TOKEN_MISSING');

  const runDir = resolveRunDir();
  const attemptMarker = path.join(runDir, 'probe-attempt.json');
  if (fs.existsSync(attemptMarker)) throw new Error('PROBE_ALREADY_ATTEMPTED_IN_THIS_DIR');

  fs.writeFileSync(attemptMarker, JSON.stringify({ at: new Date().toISOString(), state: 'started', maxMail: 1, maxCost: 1000 }), { flag: 'wx', mode: 0o600 });

  const publicEvents = [];
  const privateRows = [];
  const emit = data => {
    const row = { at: new Date().toISOString(), ...data };
    publicEvents.push(row);
    process.stdout.write(JSON.stringify(row) + '\n');
  };

  const appDataDb = path.join(process.env.APPDATA, 'automanager-desktop', 'automanager.db');
  const db = new DatabaseSync(appDataDb);

  let nativeGeneral = null;
  let nativeProxied = null;
  let leaseInfo = null;
  let orderInfo = null;

  try {
    emit({ step: 'preflight-check', runDir });

    // 1. KiotProxy check & acquire
    nativeGeneral = await createCycleTlsContext({ timeoutMs: 20000, tls: { forceHTTP1: true } });
    const kiotHttp = new KiotProxyProvider({
      async send(input) {
        const u = new URL(input.url);
        if (u.origin !== 'https://api.kiotproxy.com') throw new Error('KIOT_ORIGIN_INVALID');
        const r = await nativeGeneral.fetch(input.url, {
          method: input.method,
          headers: { 'content-type': 'application/json', ...(input.headers || {}) },
          data: input.json ? JSON.stringify(input.json) : undefined,
          timeout: 20000,
          maxBytes: 512 * 1024
        });
        try {
          return { status: r.status(), ok: r.ok(), body: await r.json(), rawText: '' };
        } finally {
          await r.dispose();
        }
      }
    });

    const allKeys = await kiotHttp.listKeys(process.env.KIOTPROXY_API_TOKEN);
    const activeInDb = db.prepare('SELECT key_hash, ip FROM proxy_leases WHERE released_at IS NULL').all();
    const availableKey = allKeys.find(k =>
      !activeInDb.some(a => a.key_hash === crypto.createHash('sha256').update(k.keyValue).digest('hex')) &&
      (!k.expiredAt || Date.parse(k.expiredAt) > Date.now())
    );
    if (!availableKey) throw new Error('NO_AVAILABLE_KIOT_KEY');

    emit({ step: 'kiot-key-found', totalKeys: allKeys.length, activeHeld: activeInDb.length });

    const leaseId = crypto.randomUUID();
    const rawLease = await kiotHttp.getNewProxy(availableKey.keyValue, { protocol: 'http' });
    if (!Number.isInteger(rawLease.port) || rawLease.port < 1 || rawLease.port > 65535) throw new Error('KIOT_PORT_INVALID');

    const keyHash = crypto.createHash('sha256').update(availableKey.keyValue).digest('hex');
    db.prepare("INSERT INTO proxy_leases (id, key_hash, ip, host, port, protocol, account_id, acquired_at) VALUES (?,?,?,?,?,?,NULL,datetime('now'))")
      .run(leaseId, keyHash, rawLease.ip, rawLease.host, rawLease.port, rawLease.protocol);

    leaseInfo = {
      leaseId,
      keyValue: availableKey.keyValue,
      ip: rawLease.ip,
      host: rawLease.host,
      port: rawLease.port,
      proxy: {
        server: `http://${rawLease.host}:${rawLease.port}`,
        ...(rawLease.username ? { username: rawLease.username } : {}),
        ...(rawLease.password ? { password: rawLease.password } : {})
      }
    };
    fs.writeFileSync(path.join(runDir, 'kiot-lease.dpapi'), protect(leaseInfo), { flag: 'wx', mode: 0o600 });

    // 2. Proxied TLS context & egress verification
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    nativeProxied = await createCycleTlsContext({
      proxy: leaseInfo.proxy,
      timeoutMs: 25000,
      tls: { forceHTTP1: true, userAgent }
    });

    const ipCheck = await nativeProxied.get('https://api.ipify.org?format=json', { timeout: 15000, maxBytes: 32768 });
    let egressIp = '';
    try {
      egressIp = (await ipCheck.json()).ip;
    } finally {
      await ipCheck.dispose();
    }
    const egressMatches = egressIp === leaseInfo.ip;
    emit({ step: 'proxy-egress-verified', egressMatches, expectedIp: leaseInfo.ip, egressIp });
    if (!egressMatches) throw new Error('KIOT_EGRESS_MISMATCH');

    // 3. Purchase 1 mailbox from Gmail94
    const gmailHttp = new FetchHttpClient();
    const gmailProvider = new Gmail94Provider(gmailHttp);
    const services = await gmailProvider.listServices();
    const capcutService = services.find(s => s.slug === 'capcut');
    if (!capcutService || capcutService.price > 1000) throw new Error('GMAIL94_SERVICE_PRICE_EXCEEDS_LIMIT');

    const profile = await gmailProvider.getProfile(process.env.GMAIL94_API_KEY);
    if (profile.balance < capcutService.price) throw new Error('GMAIL94_BALANCE_INSUFFICIENT');

    emit({ step: 'mail-purchase-intent', unitPrice: capcutService.price, balance: profile.balance });
    const order = await gmailProvider.createOtpOrder(process.env.GMAIL94_API_KEY, 'capcut');
    orderInfo = {
      orderId: order.orderId,
      email: order.email,
      password: `Capcut#${crypto.randomBytes(4).toString('hex')}9`,
      birthday: '1999-02-17'
    };
    fs.writeFileSync(path.join(runDir, 'mailbox.dpapi'), protect(orderInfo), { flag: 'wx', mode: 0o600 });
    emit({ step: 'mail-purchased', orderId: order.orderId, emailHash: crypto.createHash('sha256').update(order.email).digest('hex').slice(0, 10) });

    // 4. Execute CapCut Onboarding Sequence with Cookie/Header tracking
    let webid = '';
    let csrf = '';
    let registeredUserId = '';

    const absorbCookies = r => {
      for (const h of r.headersArray()) {
        if (h.name.toLowerCase() !== 'set-cookie') continue;
        const p = h.value.indexOf('=');
        if (p === -1) continue;
        const name = h.value.slice(0, p);
        const val = h.value.slice(p + 1).split(';')[0];
        if (name === '_tea_web_id') webid = val;
        if (name === 'passport_csrf_token') csrf = val;
      }
    };

    async function capcutCall(stepName, origin, reqPath, method, body, isForm = false, customHeaders = {}) {
      const isPassport = reqPath.includes('/passport/');
      const query = isPassport
        ? { aid: '348188', account_sdk_source: 'web', sdk_version: '2.1.10-tiktok', language: 'en', webid }
        : reqPath.includes('/sc/age_gate/set_birthday_by_uid')
          ? { region: 'VN' }
          : {};

      const headers = {
        accept: 'application/json',
        appid: '348188',
        did: webid,
        origin: 'https://www.capcut.com',
        referer: 'https://www.capcut.com/',
        'user-agent': userAgent,
        pf: '7',
        appvr: '5.8.0',
        ...(isPassport && csrf ? { 'x-tt-passport-csrf-token': csrf } : {}),
        ...customHeaders
      };

      if (body !== undefined) {
        headers['content-type'] = isForm ? 'application/x-www-form-urlencoded' : 'application/json';
      }

      const start = Date.now();
      const r = await nativeProxied.fetch(origin + reqPath, {
        method,
        params: query,
        headers,
        data: body === undefined ? undefined : isForm ? new URLSearchParams(body) : JSON.stringify(body),
        timeout: 20000,
        maxBytes: 4 * 1024 * 1024
      });

      try {
        absorbCookies(r);
        let data = null;
        try {
          data = await r.json();
        } catch {
          data = { rawText: 'NON_JSON_RESPONSE' };
        }

        privateRows.push({
          step: stepName,
          origin,
          reqPath,
          method,
          http: r.status(),
          response: data,
          headers: r.headersArray()
        });

        const summary = {
          step: stepName,
          http: r.status(),
          elapsedMs: Date.now() - start,
          ret: data?.ret !== undefined ? String(data.ret) : undefined,
          errmsg: data?.errmsg,
          message: data?.message,
          dataKeys: data?.data && typeof data.data === 'object' ? Object.keys(data.data) : []
        };
        emit(summary);
        return { status: r.status(), data };
      } finally {
        await r.dispose();
      }
    }

    // Step 4.1: Bootstrap / & /login-embed
    for (const u of ['https://www.capcut.com/', 'https://www.capcut.com/login-embed']) {
      const res = await nativeProxied.get(u, { timeout: 20000, maxBytes: 1024 * 1024 });
      try {
        absorbCookies(res);
        privateRows.push({ step: 'bootstrap', url: u, http: res.status(), headers: res.headersArray() });
        emit({ step: 'bootstrap', path: new URL(u).pathname, http: res.status() });
      } finally {
        await res.dispose();
      }
    }

    if (!webid) throw new Error('WEBID_NOT_OBTAINED');
    emit({ step: 'bootstrap-done', webidObtained: Boolean(webid), csrfObtained: Boolean(csrf) });

    // Step 4.2: Region
    await capcutCall('region-row', 'https://login-row.www.capcut.com', '/passport/web/region/', 'POST', {}, true);

    // Step 4.3: Check email
    const emailCheck = await capcutCall('check-email', 'https://login-row.www.capcut.com', '/passport/web/user/check_email_registered', 'POST', {
      mix_mode: '1',
      email: encodeMix(orderInfo.email),
      fixed_mix_mode: '1'
    }, true);
    if (emailCheck.data?.data?.is_registered !== 0) throw new Error('EMAIL_ALREADY_REGISTERED');

    // Step 4.4: Age gate pre-check (#211 & #220)
    await capcutCall('age-gate-config', 'https://www.capcut.com', '/lv/v1/sc/age_gate/get_age_gate_config', 'POST', {});
    await capcutCall('age-gate-check-without-uid', 'https://www.capcut.com', '/lv/v1/sc/age_gate/check_age_without_uid', 'POST', {
      birthday: orderInfo.birthday
    });

    // Step 4.5: Send Code (#224)
    const sendRes = await capcutCall('send-code', 'https://login-row.www.capcut.com', '/passport/web/email/send_code/', 'POST', {
      mix_mode: '1',
      email: encodeMix(orderInfo.email),
      type: '34',
      fixed_mix_mode: '1'
    }, true);
    if (sendRes.data?.message !== 'success') throw new Error('SEND_CODE_NOT_ACCEPTED');

    // Step 4.6: Poll OTP
    emit({ step: 'polling-otp-started' });
    const otpCode = await pollGmailOtp(gmailProvider, process.env.GMAIL94_API_KEY, orderInfo.orderId, 'capcut');
    if (!otpCode) throw new Error('OTP_TIMEOUT');
    emit({ step: 'otp-received', received: true });

    // Step 4.7: Register Verify Login (#230)
    const regRes = await capcutCall('register', 'https://login-row.www.capcut.com', '/passport/web/email/register_verify_login/', 'POST', {
      mix_mode: '1',
      email: encodeMix(orderInfo.email),
      code: encodeMix(otpCode),
      password: encodeMix(orderInfo.password),
      type: '34',
      birthday: orderInfo.birthday,
      force_user_region: 'vn',
      biz_param: '{}',
      fixed_mix_mode: '1'
    }, true);

    if (regRes.data?.message !== 'success' || !regRes.data?.data?.user_id_str) {
      throw new Error('REGISTRATION_NOT_ACCEPTED');
    }
    registeredUserId = regRes.data.data.user_id_str;
    emit({ step: 'registered-identity', registered: true, userIdMatches: Boolean(registeredUserId) });

    // Step 4.8: Broadcast Auth (#233 & #234)
    await capcutCall('broadcast-row', 'https://login-row.www.capcut.com', '/passport/web/auth_broadcast/', 'POST', {}, true);
    await capcutCall('broadcast-us', 'https://login.us.capcut.com', '/passport/web/auth_broadcast/', 'POST', {}, true);

    // Step 4.9: SET BIRTHDAY BY UID (#235) - The key missing onboarding request!
    const birthdayRes = await capcutCall('set-birthday-by-uid', 'https://www.capcut.com', '/lv/v1/sc/age_gate/set_birthday_by_uid', 'POST', {
      birthday: orderInfo.birthday
    }, false, { uid: registeredUserId });

    // Step 4.10: Account Info (#244)
    const accRes = await capcutCall('account-info', 'https://www.capcut.com', '/passport/web/account/info/', 'GET');

    // Step 4.11: Product User Info (#237)
    const userRes = await capcutCall('product-user-info', 'https://www.capcut.com', '/lv/v1/user/web/user_info', 'POST', {
      sem_info: {
        is_sem: false,
        medium: 'Direct',
        register_source: 'direct',
        register_second_source: 'enter_url'
      }
    }, false, { uid: registeredUserId });

    // Step 4.12: Workspace List
    const spaceRes = await capcutCall('get-workspaces', 'https://edit-api-sg.capcut.com', '/cc/v1/workspace/get_user_workspaces', 'POST', {
      cursor: '0',
      count: 100,
      need_convert_workspace: true
    }, false, { uid: registeredUserId });

    const workspaceId = userRes.data?.data?.space_info?.workspace_id || spaceRes.data?.data?.workspace_infos?.[0]?.workspace_id;

    // Step 4.13: Subscription Trial Offers Batch (#3163)
    const requestParamList = [
      { path: '/commerce/v1/subscription/cc_price_list', key: '/commerce/v1/subscription/cc_price_list_vip', body: { aid: 348188, region: 'VN', scene: 'vip' } },
      { path: '/commerce/v1/subscription/cc_price_list', key: '/commerce/v1/subscription/cc_price_list_ultra', body: { aid: 348188, region: 'VN', scene: 'ultra' } }
    ];
    if (workspaceId) {
      requestParamList.push({ path: '/commerce/v1/subscription/cc_price_list', key: '/commerce/v1/subscription/cc_price_list_teams', body: { aid: 348188, region: 'VN', scene: 'teams', workspace_id: workspaceId } });
    }

    const trialBatchRes = await capcutCall('trial-batch', 'https://commerce-api-sg.capcut.com', '/commerce/v1/subscription/batch_get', 'POST', {
      data_optimize: true,
      request_param_list: requestParamList
    }, false, { uid: registeredUserId });

    let trialOffersParsed = null;
    try {
      trialOffersParsed = parseTrialOffers(trialBatchRes.data);
    } catch (e) {
      trialOffersParsed = { parseError: e.message };
    }

    // Step 4.14: Task List Baseline Read
    const taskListRes = await capcutCall('task-list-baseline', 'https://edit-api-sg.capcut.com', '/luckycat/i18n/capcut/task/v1/task_list', 'POST', {
      scene: 'capcut_web_task'
    }, false, { uid: registeredUserId });

    // Outcome Verdict
    const retBirthday = birthdayRes.data?.ret !== undefined ? String(birthdayRes.data.ret) : 'missing';
    const retUserInfo = userRes.data?.ret !== undefined ? String(userRes.data.ret) : 'missing';
    const retWorkspace = spaceRes.data?.ret !== undefined ? String(spaceRes.data.ret) : 'missing';

    const optionCSuccess = retUserInfo === '0' && retWorkspace === '0' && Boolean(workspaceId);

    const finalVerdict = {
      optionCSuccess,
      retBirthday,
      retUserInfo,
      retWorkspace,
      workspaceId: workspaceId || null,
      trialOffersParsed,
      taskListCount: taskListRes.data?.data?.task_list?.length ?? 0
    };

    emit({ step: 'final-verdict', ...finalVerdict });

    fs.writeFileSync(path.join(runDir, 'probe-result.json'), JSON.stringify({
      at: new Date().toISOString(),
      verdict: finalVerdict,
      events: publicEvents
    }, null, 2));

    fs.writeFileSync(path.join(runDir, 'probe-session.dpapi'), protect(privateRows), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(attemptMarker, JSON.stringify({ at: new Date().toISOString(), state: 'completed', verdict: finalVerdict }));

  } catch (err) {
    emit({ step: 'probe-error', error: err.message, stack: err.stack });
    if (!process.exitCode) process.exitCode = 1;
  } finally {
    // 5. Guaranteed KiotProxy release
    if (leaseInfo && db) {
      emit({ step: 'releasing-kiot-lease', leaseId: leaseInfo.leaseId });
      try {
        if (nativeGeneral) {
          const r = await nativeGeneral.fetch('https://api.kiotproxy.com/api/public/proxies/out', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            data: JSON.stringify({ keyValue: leaseInfo.keyValue }),
            timeout: 15000,
            maxBytes: 32768
          });
          try {
            const body = await r.json();
            emit({ step: 'kiot-provider-released', success: body?.success === true });
          } finally {
            await r.dispose();
          }
        }
      } catch (relErr) {
        if (!process.exitCode) process.exitCode = 1;
        emit({ step: 'kiot-release-network-error', message: relErr.message });
      }

      try {
        db.prepare("UPDATE proxy_leases SET released_at=datetime('now') WHERE id=? AND released_at IS NULL").run(leaseInfo.leaseId);
        emit({ step: 'db-lease-released', leaseId: leaseInfo.leaseId });
      } catch (dbErr) {
        if (!process.exitCode) process.exitCode = 1;
        emit({ step: 'db-release-error', message: dbErr.message });
      }
    }

    if (nativeProxied) {
      try {
        await nativeProxied.dispose();
      } catch {
        if (!process.exitCode) process.exitCode = 1;
      }
    }
    if (nativeGeneral) {
      try {
        await nativeGeneral.dispose();
      } catch {
        if (!process.exitCode) process.exitCode = 1;
      }
    }
    try {
      db.close();
    } catch {
      if (!process.exitCode) process.exitCode = 1;
    }
    emit({ step: 'cleanup-complete' });
    process.exit(process.exitCode ?? 0);
  }
}

main().catch(e => {
  process.stderr.write(`FATAL: ${e.message}\n`);
  if (!process.exitCode) process.exitCode = 1;
  process.exit(process.exitCode ?? 1);
});
