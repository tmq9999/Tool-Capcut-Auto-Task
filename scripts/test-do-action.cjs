const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
require('tsx/cjs');

const vaultPath = path.join(__dirname, '../.superpowers/sdd/2026-09-09-native-signup-live/mailbox-vault.cjs');
const { unprotect } = require(vaultPath);
const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { createCycleTlsContext } = require('../src/main/services/capcut/http/cycleTlsContext.ts');

async function probe() {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const kiotApiToken = process.env.KIOTPROXY_API_TOKEN;
  const appDataDb = path.join(process.env.APPDATA, 'automanager-desktop', 'automanager.db');
  const db = new DatabaseSync(appDataDb);
  const sessionFile = path.join(__dirname, '../.superpowers/sdd/2026-09-09-onboarding-probe-b1/probe-session.dpapi');
  const raw = unprotect(fs.readFileSync(sessionFile, 'utf8'));
  const session = typeof raw === 'string' ? JSON.parse(raw) : raw;

  let leaseId = null;
  let cycleContext = null;
  try {
    const fetchHttp = new FetchHttpClient();
    const kiotProvider = new KiotProxyProvider(fetchHttp);
    const allKeys = await kiotProvider.listKeys(kiotApiToken);
    const activeInDb = db.prepare('SELECT key_hash FROM proxy_leases WHERE released_at IS NULL').all();
    const availableKeys = allKeys.filter(k => 
      !activeInDb.some(a => a.key_hash === crypto.createHash('sha256').update(k.keyValue).digest('hex'))
    );
    let rawLease = null;
    let chosenKey = null;
    for (const k of availableKeys) {
      try { rawLease = await kiotProvider.getNewProxy(k.keyValue, { protocol: 'http' }); chosenKey = k; break; } catch {}
    }
    if (!rawLease) {
      for (const k of availableKeys) {
        try { rawLease = await kiotProvider.getCurrentProxy(k.keyValue, 'http'); chosenKey = k; break; } catch {}
      }
    }
    if (!rawLease || !chosenKey) throw new Error('NO_PROXY_AVAILABLE');

    leaseId = crypto.randomUUID();
    db.prepare("INSERT INTO proxy_leases (id, key_hash, ip, host, port, protocol, acquired_at) VALUES (?,?,?,?,?,?,datetime('now'))")
      .run(leaseId, crypto.createHash('sha256').update(chosenKey.keyValue).digest('hex'), rawLease.ip, rawLease.host, rawLease.port, rawLease.protocol);

    const grouped = {};
    for (const c of session.cookies) {
      if (!c.domain.includes('capcut.com')) continue;
      const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      const url = `https://${host}/`;
      if (!grouped[url]) grouped[url] = [];
      grouped[url].push(`${c.name}=${c.value}; Path=${c.path || '/'}; Domain=${c.domain}`);
    }
    const initialResponseCookies = Object.entries(grouped).map(([url, setCookieHeaders]) => ({ url, setCookieHeaders }));

    cycleContext = await createCycleTlsContext({
      proxy: { server: `http://${rawLease.host}:${rawLease.port}` },
      initialResponseCookies,
      timeoutMs: 20000,
      tls: { forceHTTP1: true }
    });

    const userId = '7683455633131357192';
    const today = new Date().toISOString().slice(0, 10);
    const actionKey = 'capcut_web_push_authorize';
    const opId = `${actionKey}_${userId}_${today}`;

    console.log('Testing do_action for:', actionKey, 'opId:', opId);
    const res = await cycleContext.fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action?aid=348188&device_platform=web', {
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json'
      },
      data: JSON.stringify({ action_key: actionKey, op_id: opId })
    });
    const text = await res.text();
    await res.dispose();
    console.log('HTTP status:', res.status());
    console.log('Response text:', text);

    // Check task_list to see if status changed
    const listRes = await cycleContext.fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', {
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json'
      },
      data: JSON.stringify({ scene: 'capcut_web_task' })
    });
    const listJson = await listRes.json();
    const tasks = listJson.data?.task_list || [];
    console.log('=== CURRENT TASK STATUSES ===');
    for (const t of tasks) {
      console.log(`- ${t.task_key} (${t.task_view?.title}): status=${t.task_status} button=${t.task_view?.button_text} reward=+${t.task_reward_view?.reward_amount}`);
    }

  } finally {
    if (cycleContext) await cycleContext.dispose();
    if (leaseId) db.prepare("UPDATE proxy_leases SET released_at = datetime('now') WHERE id = ?").run(leaseId);
    console.log('Lease cleaned up.');
  }
}
probe().catch(console.error);
