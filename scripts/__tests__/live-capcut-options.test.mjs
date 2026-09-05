import { describe, expect, it } from 'vitest';
import {
  assertBillableEmailAllowed,
  isTerminalRunState,
  terminalAccountCount
} from '../live-capcut-options.mjs';

describe('live CapCut harness safety', () => {
  it('allows custom-domain verification without a billable flag', () => {
    expect(() => assertBillableEmailAllowed({ mode: 'custom' }, {})).not.toThrow();
  });

  it('blocks Gmail94 purchase unless its dedicated flag is present', () => {
    expect(() => assertBillableEmailAllowed(
      { mode: 'api', provider: 'gmail94' },
      {}
    )).toThrow('VERIFY_GMAIL94_BUY=1');
    expect(() => assertBillableEmailAllowed(
      { mode: 'api', provider: 'gmail94' },
      { VERIFY_GMAIL94_BUY: '1' }
    )).not.toThrow();
  });

  it('counts account outcomes and recognizes every terminal run state', () => {
    expect(terminalAccountCount({
      accountsCompleted: 4,
      accountsFailed: 2,
      accountsStopped: 1
    })).toBe(7);
    expect(['completed', 'stopped', 'blocked', 'failed'].every(isTerminalRunState))
      .toBe(true);
    expect(isTerminalRunState('running')).toBe(false);
  });
});
