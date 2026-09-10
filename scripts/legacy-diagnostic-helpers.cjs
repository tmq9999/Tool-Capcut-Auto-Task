'use strict';

/**
 * Polls Gmail94 OTP safely without logging credentials or codes.
 * Returns the received OTP code or null if timed out.
 */
async function pollGmailOtp(gmailProvider, apiKey, orderId, service = 'capcut', options = {}) {
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 45000;
  const sleep = options.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    await sleep(intervalMs);
    const code = await gmailProvider.readOtp(apiKey, orderId, service);
    if (code) {
      return code;
    }
  }
  return null;
}

/**
 * Guaranteed cleanup for diagnostic scripts.
 * Stops browser profile, releases proxy lease, sets exitCode to nonzero on any error,
 * and calls proc.exit with true exit code.
 */
async function performDiagnosticCleanup({ launcher, profile, db, leaseId, proc = process }) {
  if (profile && launcher) {
    try {
      console.log('Stopping browser profile...');
      await launcher.stop(profile.profileId);
    } catch (err) {
      console.error('Failed to stop profile:', err);
      if (!proc.exitCode) proc.exitCode = 1;
    }
  }
  if (leaseId && db) {
    try {
      db.prepare("UPDATE proxy_leases SET released_at = datetime('now') WHERE id = ?").run(leaseId);
      console.log('Proxy lease released cleanly.');
    } catch (err) {
      console.error('Failed to release proxy lease:', err);
      if (!proc.exitCode) proc.exitCode = 1;
    }
  }
  proc.exit(proc.exitCode ?? 0);
}

module.exports = {
  pollGmailOtp,
  performDiagnosticCleanup,
};
