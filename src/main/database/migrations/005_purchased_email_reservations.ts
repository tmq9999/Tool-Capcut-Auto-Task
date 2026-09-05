/**
 * Migration 005: Purchased Email Reservations
 *
 * Adds reservation tracking columns and an availability index to purchased_emails.
 *
 * - reserved_by: Identifier of the worker or process holding the reservation (e.g. 'run-1:worker-1')
 * - reserved_at: UTC timestamp when the reservation was granted
 *
 * The compound index idx_purchased_emails_available accelerates FIFO candidate
 * lookups for unconsumed, unreserved emails by (provider, service).
 */
export const migration005 = `
ALTER TABLE purchased_emails ADD COLUMN reserved_by TEXT;
ALTER TABLE purchased_emails ADD COLUMN reserved_at TEXT;

CREATE INDEX idx_purchased_emails_available
  ON purchased_emails(
    provider,
    service,
    consumed_at,
    reserved_by,
    purchased_at,
    id
  );
`;
