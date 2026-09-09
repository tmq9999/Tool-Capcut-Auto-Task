import { expect, it } from 'vitest';
import { SessionEvidenceBudget } from '../evidenceBudget';

const MiB = 1024 * 1024;

it('rejects aggregate evidence before write across sinks sharing one session budget', () => {
  const budget = new SessionEvidenceBudget();
  const network = budget.reserve('network', 240 * MiB);
  expect(network).not.toBeNull();
  network?.commit(240 * MiB);

  expect(budget.reserve('screenshot', 20 * MiB)).toBeNull();
  expect(budget.snapshot()).toEqual({
    limitBytes: 256 * MiB,
    actualBytes: 240 * MiB,
    reservedBytes: 0,
    rejectedBytes: 20 * MiB,
    rejectedReservations: 1
  });
});

it('returns unused reservations once and keeps budgets isolated by session', () => {
  const sessionA = new SessionEvidenceBudget({ maxBytes: 100 });
  const sessionB = new SessionEvidenceBudget({ maxBytes: 100 });
  const artifact = sessionA.reserve('artifact', 80);
  expect(artifact).not.toBeNull();
  artifact?.commit(50);

  expect(() => artifact?.release()).toThrow('EVIDENCE_RESERVATION_SETTLED');
  expect(() => artifact?.commit(1)).toThrow('EVIDENCE_RESERVATION_SETTLED');
  expect(sessionA.reserve('network', 50)).not.toBeNull();
  expect(sessionA.reserve('screenshot', 1)).toBeNull();
  expect(sessionB.reserve('screenshot', 100)).not.toBeNull();
  expect(sessionA.snapshot()).toMatchObject({ actualBytes: 50, reservedBytes: 50, rejectedBytes: 1 });
  expect(sessionB.snapshot()).toMatchObject({ actualBytes: 0, reservedBytes: 100, rejectedBytes: 0 });
});

it('does not commit beyond the reservation or corrupt counters after rejection', () => {
  const budget = new SessionEvidenceBudget({ maxBytes: 10 });
  const reservation = budget.reserve('network', 7);
  expect(reservation).not.toBeNull();
  expect(() => reservation?.commit(8)).toThrow('EVIDENCE_COMMIT_EXCEEDS_RESERVATION');
  expect(budget.snapshot()).toMatchObject({ actualBytes: 0, reservedBytes: 7 });
  reservation?.release();
  expect(budget.snapshot()).toMatchObject({ actualBytes: 0, reservedBytes: 0 });
  expect(budget.reserve('artifact', 10)).not.toBeNull();
});

it('rejects invalid byte counts synchronously', () => {
  const budget = new SessionEvidenceBudget({ maxBytes: 10 });
  for (const bytes of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => budget.reserve('network', bytes)).toThrow('EVIDENCE_INVALID_BYTES');
  }
  expect(() => new SessionEvidenceBudget({ maxBytes: 0 })).toThrow('EVIDENCE_INVALID_LIMIT');
});
