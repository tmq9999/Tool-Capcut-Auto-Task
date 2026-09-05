import { describe, expect, it, vi } from 'vitest';
import { recoverStaleEmailReservations } from '../startupRecovery';

describe('startup reservation recovery', () => {
  it('clears stale reservations and reports only the released count', () => {
    const clearStaleReservations = vi.fn(() => 2);
    const messages: string[] = [];

    expect(recoverStaleEmailReservations(
      { clearStaleReservations },
      (message) => messages.push(message)
    )).toBe(2);

    expect(clearStaleReservations).toHaveBeenCalledTimes(1);
    expect(messages).toEqual([
      '[MAIN_RECOVERY] Released 2 stale email reservations.'
    ]);
    expect(messages.join(' ')).not.toContain('@');
    expect(messages.join(' ')).not.toContain('reservation-');
  });
});
