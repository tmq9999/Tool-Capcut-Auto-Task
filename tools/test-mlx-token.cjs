const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
require('tsx/cjs');
const { DatabaseSync } = require('node:sqlite');
const { CredentialRepository } = require('../src/main/repositories/CredentialRepository.ts');
const { CredentialVault } = require('../src/main/security/CredentialVault.ts');
const { MultiloginProvider } = require('../src/main/providers/MultiloginProvider.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { MultiloginAuthService } = require('../src/main/services/MultiloginAuthService.ts');

app.name = 'automanager-desktop';
const userDataPath = path.join(process.env.APPDATA, 'automanager-desktop');
app.setPath('userData', userDataPath);

app.whenReady().then(async () => {
  const outFile = path.join(__dirname, 'mlx-test-out.json');
  try {
    const dbPath = path.join(userDataPath, 'automanager.db');
    const db = new DatabaseSync(dbPath);
    const credRepo = new CredentialRepository(db);
    const vault = new CredentialVault(safeStorage);
    const http = new FetchHttpClient();
    const provider = new MultiloginProvider(http);
    const authService = new MultiloginAuthService(credRepo, vault, provider);

    const token = await authService.getAccessToken();
    const tokenPreview = token.slice(0, 10) + '...' + token.slice(-10);

    // Test reading quick profile statuses from launcher
    const statuses = await provider.getQuickProfileStatuses(token, 10000);

    fs.writeFileSync(outFile, JSON.stringify({
      ok: true,
      tokenObtained: true,
      tokenPreview,
      activeProfilesCount: statuses.length,
      statuses
    }, null, 2));
  } catch (e) {
    fs.writeFileSync(outFile, JSON.stringify({ ok: false, error: e.message, stack: e.stack }, null, 2));
  } finally {
    app.quit();
  }
});
