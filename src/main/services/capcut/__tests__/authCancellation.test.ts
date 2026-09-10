import { describe, it, expect, vi } from 'vitest';
import type { Page, BrowserContext, Locator } from 'playwright-core';
import { loginCapcut } from '../login';
import { signupCapcut } from '../signup';
import { checkProTrial } from '../trial';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

function createMockLocator(): Locator {
  let currentVal = '';
  let checkedState = false;
  const loc: Record<string, unknown> = {
    first: () => loc as unknown as Locator,
    last: () => loc as unknown as Locator,
    nth: () => loc as unknown as Locator,
    count: vi.fn().mockResolvedValue(0),
    isVisible: vi.fn().mockResolvedValue(false),
    isChecked: vi.fn().mockImplementation(async () => checkedState),
    waitFor: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockImplementation(async () => {
      checkedState = true;
    }),
    fill: vi.fn().mockImplementation(async (v: string) => { currentVal = v; }),
    clear: vi.fn().mockImplementation(async () => { currentVal = ''; }),
    pressSequentially: vi.fn().mockImplementation(async (v: string) => { currentVal = v; }),
    inputValue: vi.fn().mockImplementation(async () => currentVal),
    textContent: vi.fn().mockResolvedValue(''),
    page: () => ({} as Page),
    locator: () => loc as unknown as Locator,
    getByText: () => loc as unknown as Locator,
    getByRole: () => loc as unknown as Locator
  };
  return loc as unknown as Locator;
}

function createMockPage(overrides: Partial<Page> = {}): Page {
  const defaultLocator = createMockLocator();
  const page = {
    url: vi.fn().mockReturnValue('https://www.capcut.com/login'),
    goto: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(defaultLocator),
    getByText: vi.fn().mockReturnValue(defaultLocator),
    getByRole: vi.fn().mockReturnValue(defaultLocator),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-img')),
    content: vi.fn().mockResolvedValue('<html></html>'),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as Page;
  defaultLocator.page = () => page;
  return page;
}

describe('S05: Auth & Navigation Cancellation (loginCapcut, signupCapcut, checkProTrial)', () => {
  it('S05-C: loginCapcut goto deferred -> Stop -> waiter settles with abort reason; late resolve does not continue', async () => {
    let resolveGoto!: (val: unknown) => void;
    const gotoPromise = new Promise((r) => { resolveGoto = r; });
    const page = createMockPage({
      goto: vi.fn().mockImplementation(() => gotoPromise)
    });

    const controller = new AbortController();
    const stopError = new Error('STOP-LOGIN');
    const ui = createDirectUiInteraction(controller.signal);

    const creds = { email: 'test@example.com', password: 'Password123!' };
    const loginPromise = loginCapcut(page, {} as BrowserContext, creds, () => {}, { ui, signal: controller.signal });

    // Abort while goto is in-flight
    controller.abort(stopError);

    // Waiter settles with abort error immediately
    await expect(loginPromise).rejects.toThrow('STOP-LOGIN');

    // Late resolve of goto
    resolveGoto(null);
    await new Promise((r) => setTimeout(r, 10));

    // Zero next actions: waitForTimeout was never called
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it('S05-C: signupCapcut goto deferred -> Stop -> waiter settles with abort reason; late resolve does not continue', async () => {
    let resolveGoto!: (val: unknown) => void;
    const gotoPromise = new Promise((r) => { resolveGoto = r; });
    const page = createMockPage({
      url: vi.fn().mockReturnValue('https://www.capcut.com/signup'),
      goto: vi.fn().mockImplementation(() => gotoPromise)
    });

    const controller = new AbortController();
    const stopError = new Error('STOP-SIGNUP');
    const ui = createDirectUiInteraction(controller.signal);

    const creds = { email: 'new@example.com', password: 'Password123!' };
    const signupPromise = signupCapcut(page, {} as BrowserContext, creds, { ui, signal: controller.signal, log: () => {} });

    // Abort while goto is in-flight
    controller.abort(stopError);

    await expect(signupPromise).rejects.toThrow('STOP-SIGNUP');

    resolveGoto(null);
    await new Promise((r) => setTimeout(r, 10));

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it('S05-C: checkProTrial goto deferred -> Stop -> settles with abort reason; late resolve does not continue', async () => {
    let resolveGoto!: (val: unknown) => void;
    const gotoPromise = new Promise((r) => { resolveGoto = r; });
    const page = createMockPage({
      goto: vi.fn().mockImplementation(() => gotoPromise)
    });

    const controller = new AbortController();
    const stopError = new Error('STOP-TRIAL');
    const ui = createDirectUiInteraction(controller.signal);

    const trialPromise = checkProTrial(page, {} as BrowserContext, () => {}, ui, controller.signal);

    controller.abort(stopError);

    await expect(trialPromise).rejects.toThrow('STOP-TRIAL');

    resolveGoto(null);
    await new Promise((r) => setTimeout(r, 10));

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it('S05-D: marker read deferred returning true late does not report already logged in if aborted', async () => {
    let resolveMarker!: (val: boolean) => void;
    const markerPromise = new Promise<boolean>((r) => { resolveMarker = r; });

    const markerLoc = createMockLocator();
    markerLoc.isVisible = vi.fn().mockImplementation(() => markerPromise);

    const page = createMockPage({
      url: vi.fn().mockReturnValue('https://www.capcut.com/dashboard'),
      goto: vi.fn().mockResolvedValue(null),
      locator: vi.fn().mockReturnValue(markerLoc)
    });

    const controller = new AbortController();
    const stopError = new Error('STOP-MARKER');
    const ui = createDirectUiInteraction(controller.signal);

    const creds = { email: 'marker@example.com', password: 'Password123!' };
    const loginPromise = loginCapcut(page, {} as BrowserContext, creds, () => {}, { ui, signal: controller.signal });

    // Let goto finish and wait for marker read to be in-flight
    await new Promise((r) => setTimeout(r, 10));

    // Abort while marker is running
    controller.abort(stopError);

    await expect(loginPromise).rejects.toThrow('STOP-MARKER');

    // Late resolve of marker returning true
    resolveMarker(true);
    await new Promise((r) => setTimeout(r, 10));
  });

  it('S05-E: signupCapcut rethrows abort when getOtp is aborted instead of masking as invalid OTP', async () => {
    const defaultLoc = createMockLocator();
    defaultLoc.isVisible = vi.fn().mockResolvedValue(true);
    defaultLoc.count = vi.fn().mockResolvedValue(1);

    const heading = createMockLocator();
    heading.isVisible = vi.fn().mockResolvedValue(true);
    heading.textContent = vi.fn().mockImplementation(async () => 'Create an account');

    const page = createMockPage({
      url: vi.fn().mockReturnValue('https://www.capcut.com/signup'),
      locator: vi.fn().mockReturnValue(defaultLoc),
      getByRole: vi.fn().mockImplementation((role: string, _opts?: unknown) => {
        if (role === 'heading') return heading;
        return defaultLoc;
      }),
      getByText: vi.fn().mockReturnValue(defaultLoc)
    });
    defaultLoc.page = () => page;
    heading.page = () => page;

    const controller = new AbortController();
    const stopError = new Error('STOP-OTP');
    const ui = createDirectUiInteraction(controller.signal);

    const getOtp = vi.fn().mockImplementation(async () => {
      controller.abort(stopError);
      throw stopError;
    });

    const creds = { email: 'otp-abort@example.com', password: 'Password123!' };
    vi.useFakeTimers();
    try {
      const signupPromise = signupCapcut(page, {} as BrowserContext, creds, {
        ui,
        signal: controller.signal,
        log: () => {},
        getOtp
      });
      const assertion = expect(signupPromise).rejects.toThrow('STOP-OTP');
      await vi.advanceTimersByTimeAsync(20000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['login', 'signup'] as const)(
    'T01 %s keeps pacing despite browser-channel overhead',
    async kind => {
      vi.useFakeTimers();
      try {
        const page = createMockPage({
          url: vi.fn(() => 'https://www.capcut.com/my-edit'),
          waitForTimeout: vi.fn((ms: number) =>
            new Promise<void>(resolve => setTimeout(resolve, ms + 30)))
        });
        const signal = new AbortController().signal;
        const ui = createDirectUiInteraction(signal);
        const creds = { email: 'fixture@example.test', password: 'Fixture1!' };
        const running = kind === 'login'
          ? loginCapcut(page, {} as BrowserContext, creds, vi.fn(), { ui, signal })
          : signupCapcut(page, {} as BrowserContext, creds, { log: vi.fn(), ui, signal });
        const settled = running.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
        await vi.advanceTimersByTimeAsync(4100);
        expect(await settled).toMatchObject({ ok: true });
        expect(page.waitForTimeout).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    }
  );
});

