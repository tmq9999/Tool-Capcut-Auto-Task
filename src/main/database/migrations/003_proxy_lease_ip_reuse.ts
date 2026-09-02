/**
 * The absolute "never reuse an IP" rule was replaced by a narrower one: an IP may
 * be reused later, it just may not be held by two profiles at the same time.
 * Rotation itself is verified against the key's current IP (/get-current), so no
 * permanent IP blacklist is kept.
 */
export const migration003 = `
DROP INDEX IF EXISTS idx_proxy_leases_ip;
CREATE INDEX IF NOT EXISTS idx_proxy_leases_ip_lookup ON proxy_leases(ip);
`;
