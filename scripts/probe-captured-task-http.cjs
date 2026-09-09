// Read-only diagnostic: no browser, signup, mailbox purchase or mission mutation.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
require('tsx/cjs');
const { request } = require('playwright-core');
const Database = require('better-sqlite3');
const { CapcutHttpClient } = require('../src/main/services/capcut/http/CapcutHttpClient.ts');
const { observedTaskRequest } = require('../src/main/services/capcut/http/observedTaskRequest.ts');
app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

let exitCode = 1;
app.whenReady().then(async () => {
  const file = process.argv[2];
  if (!file || path.extname(file) !== '.enc') throw new Error('CAPTURE_REQUIRED');
  const accountId = path.basename(file, '.enc');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))));
  const contract = observedTaskRequest(rows);
  const db = new Database(path.join(app.getPath('userData'), 'automanager.db'), { readonly: true, fileMustExist: true });
  let route;
  try {
    const account = db.prepare('SELECT proxy FROM accounts WHERE id = ?').get(accountId);
    if (!account?.proxy) throw new Error('ACCOUNT_PROXY_NOT_RECORDED');
    route = db.prepare("SELECT protocol, host, port FROM proxy_leases WHERE host || ':' || port = ? ORDER BY acquired_at DESC LIMIT 1").get(account.proxy);
    if (!route) throw new Error('ACCOUNT_PROXY_NOT_RECORDED');
  } finally { db.close(); }
  const context = await request.newContext({ proxy: { server: `${route.protocol}://${route.host}:${route.port}` }, maxRedirects: 0, timeout: 60000 });
  const started = Date.now();
  try {
    const client = CapcutHttpClient.fromRequestContext(context, contract.origin);
    const response = await client.requestJson({ ...contract.request, signal: AbortSignal.timeout(60000) });
    const list = response.data?.data?.task_list;
    const valid = response.ok && response.data?.err_no === 0 && Array.isArray(list);
    const report = { mechanism: 'direct-http', operation: 'task-list', proxy: 'recorded-account-proxy', browserLaunched: false,
      status: response.status, errNo: response.data?.err_no, validSnapshot: valid,
      total: valid ? list.length : null, done: valid ? list.filter(t => t.task_status === 4).length : null,
      elapsedMs: Date.now() - started, at: new Date().toISOString() };
    fs.writeFileSync(file + '.http-probe.json', JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n'); exitCode = valid ? 0 : 1;
  } finally { await context.dispose(); }
}).catch(error => {
  const code = /^CAPCUT_HTTP_[A-Z_]+$|^ACCOUNT_PROXY_NOT_RECORDED$|^CAPTURE_REQUIRED$/.test(error?.message ?? '') ? error.message : 'HTTP_PROBE_FAILED';
  fs.writeFileSync(path.join(path.dirname(process.argv[2] ?? '.'), 'last-http-probe-error.json'), JSON.stringify({ code, detail: String(error?.stack ?? error) }));
  process.stdout.write(JSON.stringify({ error: code, mechanism: 'direct-http' }) + '\n');
}).finally(() => app.exit(exitCode));
