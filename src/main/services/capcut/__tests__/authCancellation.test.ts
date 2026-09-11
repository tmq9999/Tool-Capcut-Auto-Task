import { describe, it, expect, vi } from 'vitest';
import type { Page, BrowserContext, Locator } from 'playwright-core';
import { DomReadTimeoutError } from '../cancellation';
import { loginCapcut } from '../login';
import { signupCapcut } from '../signup';
import { checkProTrial } from '../trial';
import { skipOnboardingSurvey } from '../overlays';
import { createDirectUiInteraction } from '../uiInteractionScheduler';
import * as diagModule from '../diag';

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
    getByRole: () => loc as unknown as Locator,
    filter: () => loc as unknown as Locator
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
    vi.useFakeTimers();
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
    let settled = false;
    let rejection: unknown;
    void loginCapcut(page, {} as BrowserContext, creds, () => {}, { ui, signal: controller.signal })
      .then(() => { settled = true; }, (err) => { settled = true; rejection = err; });

    await vi.advanceTimersByTimeAsync(4000);
    expect(markerLoc.isVisible).toHaveBeenCalled();

    // Abort while marker is running
    controller.abort(stopError);
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    expect(rejection).toBe(stopError);

    // Late resolve of marker returning true does not continue
    resolveMarker(true);
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });

  it('S05-E: signupCapcut rethrows abort when getOtp is aborted instead of masking as invalid OTP', async () => {
    const defaultLoc = createMockLocator();
    defaultLoc.isVisible = vi.fn().mockResolvedValue(true);
    defaultLoc.count = vi.fn().mockResolvedValue(1);

    const heading = createMockLocator();
    heading.isVisible = vi.fn().mockResolvedValue(true);
    heading.textContent = vi.fn().mockImplementation(async () => 'Create an account');

    const birthdayLoc = createMockLocator();
    birthdayLoc.isVisible = vi.fn().mockResolvedValue(false);

    const page = createMockPage({
      url: vi.fn().mockReturnValue('https://www.capcut.com/signup'),
      locator: vi.fn().mockImplementation((sel: string) => {
        if (typeof sel === 'string' && (sel.includes('birthday') || sel.includes('Year'))) {
          return birthdayLoc;
        }
        return defaultLoc;
      }),
      getByRole: vi.fn().mockImplementation((role: string, opts?: { name?: string | RegExp }) => {
        if (role === 'heading') {
          if (opts?.name && /birthday/i.test(opts.name.toString())) {
            return birthdayLoc;
          }
          return heading;
        }
        return defaultLoc;
      }),
      getByText: vi.fn().mockReturnValue(defaultLoc)
    });
    defaultLoc.page = () => page;
    heading.page = () => page;
    birthdayLoc.page = () => page;

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
        const workspaceLoc = createMockLocator();
        workspaceLoc.isVisible = vi.fn(async () => true);
        const page = createMockPage({
          url: vi.fn(() => 'https://www.capcut.com/my-edit'),
          locator: vi.fn((sel: string) => {
            if (sel.includes('Free credits')) return workspaceLoc;
            return createMockLocator();
          }),
          waitForTimeout: vi.fn((ms: number) =>
            new Promise<void>(resolve => setTimeout(resolve, ms + 30)))
        });
        workspaceLoc.page = () => page;
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

  it('N01 / PR01: fails when URL is /my-edit but auth-form is still visible, never logging ĐĂNG KÝ THÀNH CÔNG', async () => {
    vi.spyOn(diagModule, 'dump').mockResolvedValue(null);
    vi.useFakeTimers();
    try {
      let currentUrl = 'https://www.capcut.com/signup';
      const logs: string[] = [];
      const finalAuthFormVisible = vi.fn(async () => true);

      const emailInput = createMockLocator();
      emailInput.isVisible = vi.fn(async () => true);
      emailInput.inputValue = vi.fn(async () => 'new@example.com');

      const passwordInput = createMockLocator();
      passwordInput.isVisible = vi.fn(async () => true);
      passwordInput.count = vi.fn(async () => 1);
      passwordInput.inputValue = vi.fn(async () => 'Password123!');

      const submitButton = createMockLocator();
      submitButton.isVisible = vi.fn(async () => true);
      submitButton.click = vi.fn(async () => {
        currentUrl = 'https://www.capcut.com/my-edit';
      });

      const page = createMockPage({
        url: vi.fn(() => currentUrl),
        goto: vi.fn(async (target: string) => {
          currentUrl = target;
          return null;
        }),
        waitForURL: vi.fn(async () => undefined),
        getByRole: vi.fn((role: string) => {
          if (role === 'heading') {
            const heading = createMockLocator();
            heading.isVisible = vi.fn(async () => true);
            heading.textContent = vi.fn(async () => 'Create an account');
            return heading;
          }
          if (role === 'button') {
            return submitButton;
          }
          return createMockLocator();
        }),
        locator: vi.fn((selector: string) => {
          if (selector === 'input[type="email"]') return emailInput;
          if (selector === 'input[type="password"]') {
            if (currentUrl.includes('/my-edit')) {
              const authFormLoc = createMockLocator();
              authFormLoc.isVisible = finalAuthFormVisible;
              return authFormLoc;
            }
            return passwordInput;
          }
          if (selector.includes('.lv_sign_in_panel_wide') || selector.includes('input[type="password"]')) {
            const authFormLoc = createMockLocator();
            authFormLoc.isVisible = finalAuthFormVisible;
            return authFormLoc;
          }
          if (selector.includes('Free credits') || selector.includes('.credit-section')) {
            const workspaceMarker = createMockLocator();
            workspaceMarker.isVisible = vi.fn(async () => false);
            return workspaceMarker;
          }
          const defaultLoc = createMockLocator();
          defaultLoc.isVisible = vi.fn(async () => false);
          return defaultLoc;
        })
      });
      emailInput.page = () => page;
      passwordInput.page = () => page;
      submitButton.page = () => page;

      const controller = new AbortController();
      const ui = createDirectUiInteraction(controller.signal);
      const creds = { email: 'new@example.com', password: 'Password123!' };

      const running = signupCapcut(page, {} as BrowserContext, creds, {
        ui,
        signal: controller.signal,
        log: (msg: string) => logs.push(msg)
      });

      const settled = running.then(
        val => ({ ok: true, val }),
        err => ({ ok: false, err })
      );

      await vi.advanceTimersByTimeAsync(150000);
      const res = await settled;

      expect(res.ok).toBe(false);
      expect(finalAuthFormVisible).toHaveBeenCalled();
      expect(logs.some(m => m.includes('ĐĂNG KÝ THÀNH CÔNG'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an entered signup input wait before it resolves', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let observed: Promise<void> | undefined;
    try {
      const input = createMockLocator();
      input.isVisible = vi.fn(async () => true);
      input.waitFor = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
      const page = createMockPage({
        url: vi.fn(() => 'https://www.capcut.com/signup'),
        locator: vi.fn(() => input)
      });
      input.page = () => page;
      const abort = new AbortController();
      const reason = new Error('STOP-INPUT-WAIT');
      let settled = false;
      let rejection: unknown;
      observed = signupCapcut(page, {} as BrowserContext, {
        email: 'fixture@example.test', password: 'Fixture1!'
      }, {
        log: vi.fn(), ui: createDirectUiInteraction(abort.signal), signal: abort.signal
      }).then(
        () => { settled = true; },
        error => { settled = true; rejection = error; }
      );
      await vi.advanceTimersByTimeAsync(4000);
      expect(input.waitFor).toHaveBeenCalledOnce();
      abort.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(rejection).toBe(reason);
      expect(input.clear).not.toHaveBeenCalled();
    } finally {
      release?.();
      await observed;
      vi.useRealTimers();
    }
  });

  it('aborts an entered login input wait before it resolves', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let observed: Promise<void> | undefined;
    try {
      const emailInput = createMockLocator();
      emailInput.isVisible = vi.fn(async () => true);
      emailInput.waitFor = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));

      const continueEmail = createMockLocator();
      continueEmail.isVisible = vi.fn(async () => true);

      const page = createMockPage({
        url: vi.fn(() => 'https://www.capcut.com/login'),
        locator: vi.fn((sel: string) => {
          if (sel === 'input[type="email"]') return emailInput;
          return createMockLocator();
        }),
        getByText: vi.fn(() => continueEmail)
      });
      emailInput.page = () => page;
      continueEmail.page = () => page;

      const abort = new AbortController();
      const reason = new Error('STOP-LOGIN-INPUT-WAIT');
      let settled = false;
      let rejection: unknown;
      observed = loginCapcut(page, {} as BrowserContext, {
        email: 'fixture@example.test', password: 'Fixture1!'
      }, vi.fn(), {
        ui: createDirectUiInteraction(abort.signal), signal: abort.signal
      }).then(
        () => { settled = true; },
        error => { settled = true; rejection = error; }
      );

      await vi.advanceTimersByTimeAsync(4000);
      expect(emailInput.waitFor).toHaveBeenCalledOnce();
      abort.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(rejection).toBe(reason);
      expect(emailInput.clear).not.toHaveBeenCalled();
    } finally {
      release?.();
      await observed;
      vi.useRealTimers();
    }
  });

  it('aborts an entered login trigger wait before it resolves', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let observed: Promise<void> | undefined;
    try {
      const continueEmail = createMockLocator();
      continueEmail.waitFor = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));

      const page = createMockPage({
        url: vi.fn(() => 'https://www.capcut.com/login'),
        getByText: vi.fn(() => continueEmail)
      });
      continueEmail.page = () => page;

      const abort = new AbortController();
      const reason = new Error('STOP-LOGIN-TRIGGER-WAIT');
      let settled = false;
      let rejection: unknown;
      observed = loginCapcut(page, {} as BrowserContext, {
        email: 'fixture@example.test', password: 'Fixture1!'
      }, vi.fn(), {
        ui: createDirectUiInteraction(abort.signal), signal: abort.signal
      }).then(
        () => { settled = true; },
        error => { settled = true; rejection = error; }
      );

      await vi.advanceTimersByTimeAsync(4000);
      expect(continueEmail.waitFor).toHaveBeenCalledOnce();
      abort.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(rejection).toBe(reason);
      expect(continueEmail.click).not.toHaveBeenCalled();
    } finally {
      release?.();
      await observed;
      vi.useRealTimers();
    }
  });

  it('aborts an entered overlay survey mask detached wait before it resolves', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let observed: Promise<boolean> | undefined;
    try {
      const mask = createMockLocator();
      mask.count = vi.fn(async () => 1);
      mask.waitFor = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));

      const skip = createMockLocator();
      skip.count = vi.fn(async () => 1);
      skip.isVisible = vi.fn(async () => true);

      const page = createMockPage({
        locator: vi.fn((sel: string) => {
          if (sel.includes('.lv-modal-mask')) return mask;
          return skip;
        })
      });
      mask.page = () => page;
      skip.page = () => page;

      const abort = new AbortController();
      const reason = new Error('STOP-OVERLAY-MASK');
      let settled = false;
      let rejection: unknown;
      observed = skipOnboardingSurvey(
        page,
        vi.fn(),
        createDirectUiInteraction(abort.signal),
        abort.signal
      ).then(
        () => { settled = true; return true; },
        error => { settled = true; rejection = error; return false; }
      );

      await vi.advanceTimersByTimeAsync(100);
      expect(mask.waitFor).toHaveBeenCalledOnce();
      abort.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(rejection).toBe(reason);
    } finally {
      release?.();
      await observed;
      vi.useRealTimers();
    }
  });

  it('stops after typed mask timeout without another Skip', async () => {
    const timeout = new DomReadTimeoutError('overlay:survey-mask-detached');
    const mask = createMockLocator();
    mask.count = vi.fn(async () => 1);
    mask.waitFor = vi.fn(async () => { throw timeout; });
    const skip = createMockLocator();
    skip.count = vi.fn(async () => 1);
    skip.isVisible = vi.fn(async () => true);
    skip.click = vi.fn(async () => {});
    const page = createMockPage({
      locator: vi.fn((selector: string) =>
        selector.includes('.lv-modal-mask') ? mask : skip)
    });
    mask.page = () => page;
    skip.page = () => page;
    const signal = new AbortController().signal;
    const next = vi.fn();
    await expect(skipOnboardingSurvey(
      page, vi.fn(), createDirectUiInteraction(signal), signal
    ).then(next)).rejects.toBe(timeout);
    expect(skip.click).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});


