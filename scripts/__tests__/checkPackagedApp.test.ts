import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { validateSmokeTarget, runPackagedSmoke } from '../check-packaged-app.mjs';

describe('Packaged smoke harness safety guards (QA-01)', () => {
  it('rejects a non-existent executable before launching and attempts zero renderer IPC', async () => {
    const fakeExe = path.join(os.tmpdir(), 'missing-automanager.exe');
    const safeUserData = path.join(os.tmpdir(), 'smoke-safe-user-data');

    expect(() => validateSmokeTarget(fakeExe, safeUserData)).toThrow(/Chưa có/);

    await expect(runPackagedSmoke({ exePath: fakeExe, userDataDir: safeUserData }))
      .rejects.toThrow(/Chưa có/);
  });

  it('rejects an unsafe userDataDir inside workspace root before launching', async () => {
    const tempExe = path.join(os.tmpdir(), 'temp-automanager.exe');
    fs.writeFileSync(tempExe, '');
    try {
      const unsafeUserData = path.join(process.cwd(), 'invalid-user-data');
      expect(() => validateSmokeTarget(tempExe, unsafeUserData)).toThrow(
        /Rollout userData must be outside the workspace directory/
      );

      await expect(runPackagedSmoke({ exePath: tempExe, userDataDir: unsafeUserData }))
        .rejects.toThrow(/Rollout userData must be outside the workspace directory/);
    } finally {
      try { fs.unlinkSync(tempExe); } catch { /* ignore */ }
    }
  });

  it('B15 DEFAULT_EXE points to CapCut Automation.exe based on package productName', async () => {
    const { DEFAULT_EXE } = await import('../check-packaged-app.mjs');
    expect(DEFAULT_EXE).toMatch(/CapCut Automation\.exe$/);
  });

  it('B15 refuses wrong application identity before renderer access', async () => {
    const { _electron } = await import('playwright-core');
    const exe = path.join(os.tmpdir(), 'smoke-identity-fixture.exe');
    fs.writeFileSync(exe, 'fixture');
    const firstWindow = vi.fn();
    const owned = {
      evaluate: vi.fn().mockResolvedValue({
        name: 'wrong',
        isPackaged: true,
        userData: path.join(os.tmpdir(), 'wrong-profile')
      }),
      firstWindow,
      close: vi.fn().mockResolvedValue(undefined)
    };
    const launch = vi.spyOn(_electron, 'launch').mockResolvedValue(owned as never);
    try {
      await expect(runPackagedSmoke({
        exePath: exe,
        userDataDir: path.join(os.tmpdir(), 'smoke-identity-profile')
      })).rejects.toThrow();
      expect(firstWindow).not.toHaveBeenCalled();
      expect(owned.close).toHaveBeenCalledTimes(1);
    } finally {
      launch.mockRestore();
      try { fs.unlinkSync(exe); } catch { /* ignore */ }
    }
  });

  it('B15 fails when app close fails during cleanup', async () => {
    const { _electron } = await import('playwright-core');
    const exe = path.join(os.tmpdir(), 'smoke-close-fixture.exe');
    fs.writeFileSync(exe, 'fixture');
    const owned = {
      evaluate: vi.fn().mockResolvedValue({
        name: 'CapCut Automation',
        isPackaged: true,
        userData: path.join(os.tmpdir(), 'smoke-close-profile')
      }),
      firstWindow: vi.fn().mockRejectedValue(new Error('window failed')),
      close: vi.fn().mockRejectedValue(new Error('close failed'))
    };
    const launch = vi.spyOn(_electron, 'launch').mockResolvedValue(owned as never);
    try {
      await expect(runPackagedSmoke({
        exePath: exe,
        userDataDir: path.join(os.tmpdir(), 'smoke-close-profile')
      })).rejects.toThrow(/close failed/);
    } finally {
      launch.mockRestore();
      try { fs.unlinkSync(exe); } catch { /* ignore */ }
    }
  });

  it('R09 temp cleanup failure cannot return success', async () => {
    const { _electron } = await import('playwright-core');
    const exe = path.join(os.tmpdir(), 'smoke-cleanup-fixture.exe');
    const dir = path.join(os.tmpdir(), 'smoke-cleanup-fixture-dir');
    fs.writeFileSync(exe, 'fixture');
    let evaluations = 0;
    const page = {
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
        if (arg !== undefined) return;
        evaluations++;
        if (evaluations === 1) return { settings: true, logs: 0, accounts: 0 };
        if (evaluations === 2) return { noRequire: true, noProcess: true };
        return { rows: 0, loi: [] };
      })
    };
    const app = {
      evaluate: vi.fn().mockResolvedValue({
        name: 'CapCut Automation',
        isPackaged: true,
        userData: dir
      }),
      firstWindow: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const launch = vi.spyOn(_electron, 'launch').mockResolvedValue(app as never);
    const make = vi.spyOn(fs, 'mkdtempSync').mockReturnValue(dir);
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const remove = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('fixture locked');
    });
    vi.useFakeTimers();
    try {
      const run = runPackagedSmoke({ exePath: exe });
      const result = run.then(
        (value) => value,
        (error) => error
      );
      await vi.runAllTimersAsync();
      const outcome = await result;
      expect(outcome instanceof Error || outcome.success === false).toBe(true);
    } finally {
      vi.useRealTimers();
      launch.mockRestore();
      make.mockRestore();
      exists.mockRestore();
      remove.mockRestore();
      try { fs.unlinkSync(exe); } catch { /* ignore */ }
    }
  });

  it('R09 returns success true and removes temp directory on clean run', async () => {
    const { _electron } = await import('playwright-core');
    const exe = path.join(os.tmpdir(), 'smoke-clean-fixture.exe');
    const dir = path.join(os.tmpdir(), 'smoke-clean-fixture-dir');
    fs.writeFileSync(exe, 'fixture');
    let evaluations = 0;
    const page = {
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
        if (arg !== undefined) return;
        evaluations++;
        if (evaluations === 1) return { settings: true, logs: 0, accounts: 0 };
        if (evaluations === 2) return { noRequire: true, noProcess: true };
        return { rows: 0, loi: [] };
      })
    };
    const app = {
      evaluate: vi.fn().mockResolvedValue({
        name: 'CapCut Automation',
        isPackaged: true,
        userData: dir
      }),
      firstWindow: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const launch = vi.spyOn(_electron, 'launch').mockResolvedValue(app as never);
    const make = vi.spyOn(fs, 'mkdtempSync').mockReturnValue(dir);
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const remove = vi.spyOn(fs, 'rmSync').mockReturnValue(undefined);
    vi.useFakeTimers();
    try {
      const run = runPackagedSmoke({ exePath: exe });
      await vi.runAllTimersAsync();
      const outcome = await run;
      expect(outcome).toEqual({ success: true, failCount: 0 });
      expect(remove).toHaveBeenCalledWith(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
      launch.mockRestore();
      make.mockRestore();
      exists.mockRestore();
      remove.mockRestore();
      try { fs.unlinkSync(exe); } catch { /* ignore */ }
    }
  });

  it('R09 preserves caller-supplied userDataDir on exit', async () => {
    const { _electron } = await import('playwright-core');
    const exe = path.join(os.tmpdir(), 'smoke-caller-fixture.exe');
    const callerDir = path.join(os.tmpdir(), 'smoke-caller-user-data');
    fs.writeFileSync(exe, 'fixture');
    let evaluations = 0;
    const page = {
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
        if (arg !== undefined) return;
        evaluations++;
        if (evaluations === 1) return { settings: true, logs: 0, accounts: 0 };
        if (evaluations === 2) return { noRequire: true, noProcess: true };
        return { rows: 0, loi: [] };
      })
    };
    const app = {
      evaluate: vi.fn().mockResolvedValue({
        name: 'CapCut Automation',
        isPackaged: true,
        userData: callerDir
      }),
      firstWindow: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const launch = vi.spyOn(_electron, 'launch').mockResolvedValue(app as never);
    const remove = vi.spyOn(fs, 'rmSync');
    vi.useFakeTimers();
    try {
      const run = runPackagedSmoke({ exePath: exe, userDataDir: callerDir });
      await vi.runAllTimersAsync();
      const outcome = await run;
      expect(outcome).toEqual({ success: true, failCount: 0 });
      expect(remove).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      launch.mockRestore();
      remove.mockRestore();
      try { fs.unlinkSync(exe); } catch { /* ignore */ }
    }
  });
});
