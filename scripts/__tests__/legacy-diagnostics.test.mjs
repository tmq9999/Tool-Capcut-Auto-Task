import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pollGmailOtp, performDiagnosticCleanup } = require('../legacy-diagnostic-helpers.cjs');

describe('legacy diagnostic helpers', () => {
  describe('pollGmailOtp (D04)', () => {
    it('polls readOtp until code arrives and returns it without logging', async () => {
      const readOtp = vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('987654');
      const gmailProvider = { readOtp };
      const sleep = vi.fn().mockResolvedValue(undefined);
      let simulatedTime = 0;
      const now = vi.fn(() => {
        simulatedTime += 1000;
        return simulatedTime;
      });

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const consoleLogSpy = vi.spyOn(console, 'log').mockReturnValue(undefined);

      try {
        const code = await pollGmailOtp(gmailProvider, 'test-api-key', 'order-123', 'capcut', {
          intervalMs: 3000,
          timeoutMs: 45000,
          sleep,
          now
        });

        expect(code).toBe('987654');
        expect(readOtp).toHaveBeenCalledTimes(3);
        expect(readOtp).toHaveBeenNthCalledWith(1, 'test-api-key', 'order-123', 'capcut');
        expect(readOtp).toHaveBeenNthCalledWith(2, 'test-api-key', 'order-123', 'capcut');
        expect(readOtp).toHaveBeenNthCalledWith(3, 'test-api-key', 'order-123', 'capcut');
        expect(sleep).toHaveBeenCalledWith(3000);

        // Crucial security requirement: OTP must never be logged
        for (const call of stdoutSpy.mock.calls) {
          expect(String(call[0])).not.toContain('987654');
        }
        for (const call of consoleLogSpy.mock.calls) {
          expect(call.map(String).join(' ')).not.toContain('987654');
        }
      } finally {
        stdoutSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });

    it('returns null when polling exceeds timeout deadline', async () => {
      const readOtp = vi.fn().mockResolvedValue(null);
      const gmailProvider = { readOtp };
      const sleep = vi.fn().mockResolvedValue(undefined);
      let currentTime = 1000;
      const now = vi.fn(() => {
        currentTime += 20000;
        return currentTime;
      });

      const code = await pollGmailOtp(gmailProvider, 'key', 'ord', 'capcut', {
        intervalMs: 3000,
        timeoutMs: 45000,
        sleep,
        now
      });

      expect(code).toBeNull();
    });
  });

  describe('performDiagnosticCleanup (D05)', () => {
    it('healthy flow calls launcher stop, db release once and exits 0', async () => {
      const launcher = { stop: vi.fn().mockResolvedValue(undefined) };
      const run = vi.fn();
      const db = { prepare: vi.fn().mockReturnValue({ run }) };
      const exit = vi.fn();
      const fakeProc = { exitCode: undefined, exit };

      await performDiagnosticCleanup({
        launcher,
        profile: { profileId: 'prof-1' },
        db,
        leaseId: 'lease-1',
        proc: fakeProc
      });

      expect(launcher.stop).toHaveBeenCalledTimes(1);
      expect(launcher.stop).toHaveBeenCalledWith('prof-1');
      expect(db.prepare).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith('lease-1');
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    });

    it('preserves prior nonzero exitCode from body failure and still runs cleanup', async () => {
      const launcher = { stop: vi.fn().mockResolvedValue(undefined) };
      const run = vi.fn();
      const db = { prepare: vi.fn().mockReturnValue({ run }) };
      const exit = vi.fn();
      const fakeProc = { exitCode: 1, exit };

      await performDiagnosticCleanup({
        launcher,
        profile: { profileId: 'prof-2' },
        db,
        leaseId: 'lease-2',
        proc: fakeProc
      });

      expect(launcher.stop).toHaveBeenCalledWith('prof-2');
      expect(run).toHaveBeenCalledWith('lease-2');
      expect(fakeProc.exitCode).toBe(1);
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('sets exitCode to 1 when launcher stop fails and continues db cleanup', async () => {
      const launcher = { stop: vi.fn().mockRejectedValue(new Error('LAUNCHER_CRASH')) };
      const run = vi.fn();
      const db = { prepare: vi.fn().mockReturnValue({ run }) };
      const exit = vi.fn();
      const fakeProc = { exitCode: undefined, exit };

      await performDiagnosticCleanup({
        launcher,
        profile: { profileId: 'prof-3' },
        db,
        leaseId: 'lease-3',
        proc: fakeProc
      });

      expect(launcher.stop).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(fakeProc.exitCode).toBe(1);
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('sets exitCode to 1 when db release fails and exits nonzero', async () => {
      const launcher = { stop: vi.fn().mockResolvedValue(undefined) };
      const db = {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn().mockImplementation(() => {
            throw new Error('SQLITE_BUSY');
          })
        })
      };
      const exit = vi.fn();
      const fakeProc = { exitCode: undefined, exit };

      await performDiagnosticCleanup({
        launcher,
        profile: { profileId: 'prof-4' },
        db,
        leaseId: 'lease-4',
        proc: fakeProc
      });

      expect(launcher.stop).toHaveBeenCalledTimes(1);
      expect(fakeProc.exitCode).toBe(1);
      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
