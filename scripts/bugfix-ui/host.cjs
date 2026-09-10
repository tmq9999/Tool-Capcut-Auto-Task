const { app, BrowserWindow, session } = require('electron');

app.whenReady().then(async () => {
  const target = new URL(process.env.BUGFIX_FIXTURE_URL);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') {
    throw new Error('FIXTURE_LOOPBACK_REQUIRED');
  }
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: url.origin !== target.origin && url.protocol !== 'data:' });
  });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  await win.loadURL(target.href);
}).catch(() => app.exit(1));

app.on('window-all-closed', () => app.quit());
