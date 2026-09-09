// Offline verifier for live-onboarding-probe.cjs run results
require('tsx/cjs');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const workspaceRoot = path.resolve(__dirname, '..');
const vaultHelper = path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-native-signup-live/mailbox-vault.cjs');
const { unprotect } = require(vaultHelper);

function main() {
  const runDir = process.env.CAPCUT_LIVE_RUN_DIR || path.join(workspaceRoot, '.superpowers/sdd/2026-09-09-onboarding-probe-r3');
  const resFile = path.join(runDir, 'probe-result.json');
  if (!fs.existsSync(resFile)) {
    console.error('PROBE_RESULT_NOT_FOUND at', resFile);
    process.exit(1);
  }

  const result = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  console.log('=== PROBE RESULT SUMMARY ===');
  console.log('Time:', result.at);
  console.log('Verdict:', JSON.stringify(result.verdict, null, 2));

  // Check DB lease release
  const dbPath = path.join(process.env.APPDATA, 'automanager-desktop', 'automanager.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const unreleased = db.prepare('SELECT id, ip, acquired_at FROM proxy_leases WHERE released_at IS NULL').all();
    console.log('Currently unreleased leases in DB:', unreleased.length);
    if (unreleased.length > 0) {
      console.warn('WARNING: Some leases are still unreleased in DB:', unreleased);
    } else {
      console.log('PASS: All leases released in DB.');
    }
  } finally {
    db.close();
  }

  // Check encrypted session rows count
  const sealedFile = path.join(runDir, 'probe-session.dpapi');
  if (fs.existsSync(sealedFile)) {
    try {
      const rows = unprotect(fs.readFileSync(sealedFile, 'utf8'));
      console.log(`Encrypted session rows captured: ${rows.length}`);
      const steps = rows.map(r => `${r.step} (HTTP ${r.http}, ret: ${r.response?.ret ?? r.response?.err_no ?? 'n/a'})`);
      console.log('Captured Step Details:\n  ' + steps.join('\n  '));
    } catch (e) {
      console.log('Could not decrypt session rows:', e.message);
    }
  }

  console.log('=== END SUMMARY ===');
}

main();
