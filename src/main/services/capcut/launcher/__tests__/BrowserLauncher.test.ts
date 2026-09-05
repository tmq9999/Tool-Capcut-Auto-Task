import { describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';

import { connectOverCdpWithRetry } from '../BrowserLauncher';

describe('connectOverCdpWithRetry cancellation', () => {
  it('aborts the retry loop before starting another CDP attempt', async () => {
    const controller = new AbortController();
    const reason = new Error('stop requested');
    let sleeps = 0;

    const operation = connectOverCdpWithRetry(1, {
      attempts: 3,
      intervalMs: 1000,
      signal: controller.signal,
      sleep: async () => {
        sleeps += 1;
        controller.abort(reason);
      }
    });

    await expect(operation).rejects.toThrow('stop requested');
    expect(sleeps).toBe(1);
  });

  it('disconnects a late CDP result after Stop without leaking the abort listener', async () => {
    const controller = new AbortController();
    let connected: (browser: Browser) => void = () => {};
    const close = vi.fn(async () => {});
    vi.spyOn(chromium, 'connectOverCDP').mockImplementation(() => new Promise((resolve) => { connected = resolve; }));
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const launch = connectOverCdpWithRetry(45678, { signal: controller.signal });
    const rejected = expect(launch).rejects.toThrow('stop requested');
    controller.abort(new Error('stop requested'));
    await rejected;
    connected({ close } as unknown as Browser);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
