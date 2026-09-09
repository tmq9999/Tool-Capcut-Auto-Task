import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';

import { attachOverCdp, configureHeadedWindowUnlocked, connectOverCdpWithRetry } from '../BrowserLauncher';
import { createDirectUiInteraction } from '../../uiInteractionScheduler';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('headed viewport before authentication', () => {
  function attachment(options: {
    viewport?: { width: number; height: number };
    bounds?: { width: number; height: number; windowState: 'normal' | 'minimized' | 'maximized' | 'fullscreen' };
    screen?: { width: number; height: number };
    nativeLimit?: { width: number; height: number };
    invalidReadback?: boolean;
  } = {}) {
    let viewport = options.viewport ?? { width: 1034, height: 605 };
    const screen = options.screen ?? { width: 1366, height: 768 };
    let bounds = options.bounds ?? { width: 1050, height: 700, windowState: 'normal' as const };
    const nativeLimit = options.nativeLimit ?? { width: 1382, height: 776 };
    const horizontalFrame = bounds.width - viewport.width;
    const verticalFrame = bounds.height - viewport.height;
    const page = {
      bringToFront: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({
        ...viewport,
        screenWidth: screen.width,
        screenHeight: screen.height
      })),
      setViewportSize: vi.fn(async (size: { width: number; height: number }) => { viewport = size; }),
      waitForFunction: vi.fn(async () => {
        if (viewport.width < 1440 || viewport.height < 900) {
          throw new Error(`viewport stayed ${viewport.width}x${viewport.height}, expected 1440x900`);
        }
        return { dispose: vi.fn(async () => {}) };
      })
    };
    let windowReads = 0;
    const session = {
      send: vi.fn(async (method: string, params?: { bounds?: typeof bounds }) => {
        if (method === 'Browser.getWindowForTarget') {
          windowReads += 1;
          if (options.invalidReadback && windowReads > 1) {
            return { windowId: 7, bounds: { ...bounds, width: Number.NaN } };
          }
          return { windowId: 7, bounds };
        }
        if (method === 'Browser.setWindowBounds' && params?.bounds) {
          const next = params.bounds;
          bounds = {
            ...bounds,
            ...next,
            width: next.width ? Math.min(next.width, nativeLimit.width) : bounds.width,
            height: next.height ? Math.min(next.height, nativeLimit.height) : bounds.height
          };
          if (next.width && next.height) {
            viewport = {
              width: bounds.width - horizontalFrame,
              height: bounds.height - verticalFrame
            };
          }
        }
        return {};
      }),
      detach: vi.fn(async () => {})
    };
    const context = {
      pages: () => [page],
      newCDPSession: vi.fn(async () => session),
      grantPermissions: vi.fn(async () => {})
    };
    const browser = { contexts: () => [context], close: vi.fn(async () => {}) };
    vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(browser as unknown as Browser);
    return { page, session, context, browser };
  }

  it('uses a best-effort native resize and falls back to a layout viewport when the profile screen clamps it', async () => {
    const h = attachment();
    const log = vi.fn();
    const ui = createDirectUiInteraction(new AbortController().signal);
    await attachOverCdp(45678, { headless: false, log, ui });
    expect(h.session.send).toHaveBeenCalledWith('Browser.getWindowForTarget');
    expect(h.session.send).toHaveBeenCalledWith('Browser.setWindowBounds', {
      windowId: 7,
      bounds: { width: 1382, height: 863 }
    });
    expect(h.page.setViewportSize).toHaveBeenCalledWith({ width: 1440, height: 900 });
    expect(h.session.send.mock.invocationCallOrder.at(-1)).toBeLessThan(h.context.grantPermissions.mock.invocationCallOrder[0]);
    expect(h.page.waitForFunction).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('native 1382x776'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('layout viewport 1440x900'));
  });

  it('does not shrink a headed window that already fits the editor', async () => {
    const h = attachment({
      viewport: { width: 1600, height: 1000 },
      bounds: { width: 1616, height: 1100, windowState: 'normal' },
      screen: { width: 1920, height: 1080 }
    });
    const ui = createDirectUiInteraction(new AbortController().signal);
    await attachOverCdp(45678, { headless: false, ui });
    expect(h.session.send).not.toHaveBeenCalledWith('Browser.setWindowBounds', expect.anything());
    expect(h.page.setViewportSize).not.toHaveBeenCalled();
  });

  it('configures a target-mode headed page without native activation', async () => {
    const h = attachment({
      viewport: { width: 1600, height: 1000 },
      bounds: { width: 1616, height: 1100, windowState: 'normal' },
      screen: { width: 1920, height: 1080 }
    });
    const ui = createDirectUiInteraction(new AbortController().signal, 'target');
    await attachOverCdp(45678, { headless: false, ui });
    expect(h.page.bringToFront).not.toHaveBeenCalled();
    expect(h.session.send).toHaveBeenCalledWith('Browser.getWindowForTarget');
  });

  it('bounds native headed-window activation', async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const setup = configureHeadedWindowUnlocked(
      { bringToFront: () => new Promise<void>(() => {}) } as never,
      {} as never,
      { headless: false, signal, ui: createDirectUiInteraction(signal) }
    ).catch(error => error);

    await vi.advanceTimersByTimeAsync(5_001);

    await expect(setup).resolves.toMatchObject({ code: 'DOM_READ_TIMEOUT' });
  });

  it('leaves headless viewport behavior untouched', async () => {
    const h = attachment();
    await attachOverCdp(45678, { headless: true });
    expect(h.context.newCDPSession).not.toHaveBeenCalled();
  });

  it('normalizes a non-normal clipped window before applying explicit bounds', async () => {
    const h = attachment({ bounds: { width: 1050, height: 657, windowState: 'maximized' } });
    const ui = createDirectUiInteraction(new AbortController().signal);
    await attachOverCdp(45678, { headless: false, ui });
    expect(h.session.send).toHaveBeenNthCalledWith(2, 'Browser.setWindowBounds', {
      windowId: 7,
      bounds: { windowState: 'normal' }
    });
    expect(h.session.send).toHaveBeenNthCalledWith(3, 'Browser.setWindowBounds', {
      windowId: 7,
      bounds: { width: 1382, height: 820 }
    });
  });

  it('fails on an invalid native window readback instead of treating clamping as the error', async () => {
    const h = attachment({ invalidReadback: true });
    const ui = createDirectUiInteraction(new AbortController().signal);
    await expect(attachOverCdp(45678, { headless: false, ui })).rejects.toThrow('kích thước cửa sổ headed');
    expect(h.context.grantPermissions).not.toHaveBeenCalled();
    expect(h.browser.close).toHaveBeenCalledTimes(1);
  });

  it('does not proceed when Stop arrives during sizing', async () => {
    const h = attachment();
    const controller = new AbortController();
    const ui = createDirectUiInteraction(controller.signal);
    h.page.evaluate.mockImplementation(async () => {
      controller.abort(new Error('stop'));
      return { width: 1034, height: 557, screenWidth: 1366, screenHeight: 768 };
    });
    await expect(attachOverCdp(45678, { headless: false, signal: controller.signal, ui })).rejects.toThrow('stop');
    expect(h.session.send).not.toHaveBeenCalledWith('Browser.setWindowBounds', expect.anything());
    expect(h.context.grantPermissions).not.toHaveBeenCalled();
    expect(h.browser.close).toHaveBeenCalled();
  });

  it('tears down an owned profile when Browser.getWindowForTarget hangs', async () => {
    vi.useFakeTimers();
    const h = attachment();
    h.session.send.mockImplementation(async (method: string) => {
      if (method === 'Browser.getWindowForTarget') {
        return new Promise(() => {});
      }
      return {};
    });
    const ui = createDirectUiInteraction(new AbortController().signal);
    const attachPromise = attachOverCdp(45678, { headless: false, ui });
    const errorPromise = attachPromise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5001);
    const err = await errorPromise;
    expect(err).toBeDefined();
    expect(h.browser.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

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
