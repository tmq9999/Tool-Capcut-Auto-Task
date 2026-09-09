// One temporary headed Multilogin profile; no mailbox, signup or task actions.
const { app, safeStorage } = require('electron');
const path = require('node:path');
const Database = require('better-sqlite3');
const { chromium } = require('playwright-core');
require('tsx/cjs');
const { CredentialRepository } = require('../src/main/repositories/CredentialRepository.ts');
const { CredentialVault } = require('../src/main/security/CredentialVault.ts');
const { MultiloginAuthService } = require('../src/main/services/MultiloginAuthService.ts');
const { MultiloginProvider } = require('../src/main/providers/MultiloginProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

app.whenReady().then(async () => {
  const db = new Database(path.join(app.getPath('userData'), 'automanager.db'), { fileMustExist: true });
  let browser;
  let profile;
  let token;
  const api = new MultiloginProvider(new FetchHttpClient());
  try {
    token = await new MultiloginAuthService(new CredentialRepository(db), new CredentialVault(safeStorage), api).getAccessToken();
    profile = await api.startQuickProfile(token, { isHeadless: false, automation: 'playwright' });
    let port = profile.port;
    const deadline = Date.now() + 30000;
    while (!port && Date.now() < deadline) {
      port = (await api.getQuickProfileStatuses(token, 5000)).find(item => item.profileId === profile.profileId)?.port;
      if (!port) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!port) throw Error('NO_PROFILE_PORT');
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 5000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    const cdp = await context.newCDPSession(page);
    try {
      const measure = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, outerWidth, outerHeight,
        dpr: devicePixelRatio, screenWidth: screen.width, screenHeight: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight }));
      const initial = await cdp.send('Browser.getWindowForTarget');
      const before = await measure();
      const target = { width: Math.max(1456, initial.bounds.width, 1440 + initial.bounds.width - before.width),
        height: Math.max(1000, initial.bounds.height, 900 + initial.bounds.height - before.height) };
      console.log(JSON.stringify({ stage: 'before', initial, viewport: before, target }));
      await cdp.send('Browser.setWindowBounds', { windowId: initial.windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId: initial.windowId, bounds: target });
      await page.waitForFunction(() => innerWidth >= 1440 && innerHeight >= 900, null, { timeout: 5000 }).catch(() => {});
      console.log(JSON.stringify({ stage: 'after', window: await cdp.send('Browser.getWindowForTarget'), viewport: await measure() }));
      if (process.argv.includes('--mouse')) {
        await page.goto('about:blank');
        const delays = [];
        for (let index = 0; index < 25; index++) {
          const started = Date.now();
          await Promise.race([
            page.mouse.move(100 + index * 15, 100 + index * 10),
            new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('MOUSE_DEADLINE')), 10000); timer.unref(); })
          ]);
          delays.push(Date.now() - started);
        }
        console.log(JSON.stringify({ stage: 'blank-page-mouse', moves: delays.length, maxMs: Math.max(...delays), totalMs: delays.reduce((sum, value) => sum + value, 0) }));
      }
    } finally { await cdp.detach(); }
  } finally {
    if (profile && token) await api.stopProfile(token, profile.profileId, 10000);
    await browser?.close().catch(() => {});
    db.close();
  }
}).then(() => app.exit(0), error => { console.error('HEADED_WINDOW_PROBE_FAILED:' + String(error.message).split('\n')[0].slice(0,180)); app.exit(1); });
