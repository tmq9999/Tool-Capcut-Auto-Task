// Scoped headed diagnosis on an existing account; no mailbox purchase or generation.
const { app, safeStorage } = require('electron');
const path = require('node:path');
const Database = require('better-sqlite3');
require('tsx/cjs');
const { CredentialRepository } = require('../src/main/repositories/CredentialRepository.ts');
const { AccountRepository } = require('../src/main/repositories/AccountRepository.ts');
const { ProxyLeaseRepository } = require('../src/main/repositories/ProxyLeaseRepository.ts');
const { CredentialVault } = require('../src/main/security/CredentialVault.ts');
const { SecretReader } = require('../src/main/services/SecretReader.ts');
const { MultiloginAuthService } = require('../src/main/services/MultiloginAuthService.ts');
const { MultiloginProvider } = require('../src/main/providers/MultiloginProvider.ts');
const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { ProxyLeaseManager } = require('../src/main/services/ProxyLeaseManager.ts');
const { ApiV3Launcher } = require('../src/main/services/capcut/launcher/ApiV3Launcher.ts');
const { ensureInApp } = require('../src/main/services/capcut/auth.ts');
const { ensurePageUsable } = require('../src/main/services/capcut/overlays.ts');
const { hideChatPanel } = require('../src/main/services/capcut/missions/designStudio.ts');
const { humanClick } = require('../src/main/services/capcut/human.ts');
const { ensureSampleImage } = require('../src/main/services/capcut/image.ts');
app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

app.whenReady().then(async () => {
  const db = new Database(path.join(app.getPath('userData'), 'automanager.db'), { fileMustExist: true });
  const vault = new CredentialVault(safeStorage);
  const credentials = new CredentialRepository(db);
  const report = data => console.log(JSON.stringify(data));
  const log = message => report({ stage: 'ui', message });
  const account = new AccountRepository(db).getAccountById(process.argv[2]);
  let profile;
  let lease;
  const signal = AbortSignal.timeout(180000);
  const api = new MultiloginProvider(new FetchHttpClient());
  const launcher = new ApiV3Launcher(new MultiloginAuthService(credentials, vault, api), api, { log });
  const manager = new ProxyLeaseManager(new KiotProxyProvider(new FetchHttpClient()), new ProxyLeaseRepository(db),
    { apiToken: new SecretReader(credentials, vault).readSimpleKey('kiotproxy') });
  try {
    if (!account?.passwordCapcutEncrypted) throw Error('ACCOUNT_NOT_AVAILABLE');
    lease = await manager.acquire(signal);
    profile = await launcher.launch({ headless: false, signal, proxy: { scheme: lease.protocol, host: lease.host, port: String(lease.port), username: lease.username, password: lease.password } });
    const { page, context } = profile;
    context.on('page', next => { report({ stage: 'new-page' }); next.on('domcontentloaded', () => report({ stage: 'new-page-loaded', path: new URL(next.url()).pathname })); });
    await ensureInApp(page, context, { email: account.email, password: vault.decrypt(account.passwordCapcutEncrypted), source: 'db' }, { log });
    await page.goto('https://www.capcut.com/ai-design', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.bringToFront();
    await ensurePageUsable(page, log);
    const upload = page.locator('[aria-label="Canvas tools"] [aria-label="Upload image"]').first();
    await upload.waitFor({ state: 'visible', timeout: 30000 });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), humanClick(page, upload)]);
    await chooser.setFiles(ensureSampleImage(path.join(app.getPath('userData'), 'assets')));
    await page.waitForTimeout(9000);
    await hideChatPanel(page, { page, context, signal, log });
    const rect = await page.locator('#graphic-editor-render').boundingBox();
    if (!rect) throw Error('CANVAS_NOT_READY');
    const started = Date.now();
    let settled = false;
    const movement = page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2).then(() => { settled = true; });
    let timer;
    await Promise.race([movement, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
    clearTimeout(timer);
    report({ stage: 'before-activation', settled, elapsedMs: Date.now() - started, pages: context.pages().map(p => new URL(p.url()).pathname) });
    await page.bringToFront();
    const after = Date.now();
    try {
      await Promise.race([movement, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('MOUSE_STILL_PENDING')), 5000); })]);
      report({ stage: 'after-activation', settled, elapsedMs: Date.now() - after });
    } finally { clearTimeout(timer); }
  } finally {
    if (profile) await launcher.stop(profile.profileId);
    if (lease) await manager.release(lease);
    db.close();
  }
}).then(() => app.exit(0), error => { console.error('HEADED_CANVAS_PROBE_FAILED:' + String(error.message).split('\n')[0].slice(0,160)); app.exit(1); });
