/**
 * Pure helper for live scripts to interact with service credentials
 * without running app startup or network calls.
 */
function insertMultiloginIfMissing(repo, payload) {
  const existing = repo.getCredential('multilogin');
  if (existing) return false;
  repo.saveCredential('multilogin', payload);
  return true;
}

module.exports = { insertMultiloginIfMissing };
