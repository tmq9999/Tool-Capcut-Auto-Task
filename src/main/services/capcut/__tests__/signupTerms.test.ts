import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { signupCapcut } from '../signup';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

interface MockCheckboxState {
  visible: boolean;
  checked: boolean;
  clickToggles?: boolean;
}

function createTermsTestPage(checkboxStates: MockCheckboxState[]) {
  const submitClicked = { value: false };
  const trace: string[] = [];

  const createBoxLocator = (index: number) => {
    const boxLoc: Record<string, unknown> = {
      page: () => page,
      first: () => boxLoc,
      nth: () => boxLoc,
      isVisible: vi.fn(async () => checkboxStates[index]?.visible ?? false),
      isChecked: vi.fn(async () => checkboxStates[index]?.checked ?? false),
      click: vi.fn(async () => {
        trace.push(`click-box-${index}`);
        const state = checkboxStates[index];
        if (!state) return;
        if (state.clickToggles !== false) {
          state.checked = true;
        }
      })
    };
    return boxLoc;
  };

  const page = {
    url: vi.fn().mockReturnValue('https://www.capcut.com/signup'),
    goto: vi.fn().mockResolvedValue(null),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    getByText: vi.fn().mockImplementation(() => {
      const loc: Record<string, unknown> = {
        page: () => page,
        first: () => loc,
        waitFor: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        isVisible: vi.fn().mockResolvedValue(true)
      };
      return loc;
    }),
    getByRole: vi.fn().mockImplementation((role: string, options?: { name?: unknown }) => {
      if (role === 'heading') {
        const hLoc: Record<string, unknown> = {
          page: () => page,
          first: () => hLoc,
          isVisible: vi.fn().mockResolvedValue(true),
          textContent: vi.fn().mockResolvedValue('Create an account')
        };
        return hLoc;
      }
      if (role === 'button') {
        const isSubmit = options && options.name && /Sign up|Create account/i.test(String(options.name));
        const bLoc: Record<string, unknown> = {
          page: () => page,
          first: () => bLoc,
          waitFor: vi.fn().mockResolvedValue(undefined),
          isVisible: vi.fn().mockResolvedValue(true),
          click: vi.fn(async () => {
            if (isSubmit) {
              trace.push('submit-click');
              submitClicked.value = true;
            } else {
              trace.push('continue-click');
            }
          })
        };
        return bLoc;
      }
      const generic: Record<string, unknown> = {
        page: () => page,
        first: () => generic,
        waitFor: vi.fn().mockResolvedValue(undefined),
        isVisible: vi.fn().mockResolvedValue(false)
      };
      return generic;
    }),
    locator: vi.fn((selector: string) => {
      if (selector === 'input[type="email"]') {
        const loc: Record<string, unknown> = {
          page: () => page,
          first: () => loc,
          isVisible: vi.fn().mockResolvedValue(true),
          fill: vi.fn().mockResolvedValue(undefined),
          clear: vi.fn().mockResolvedValue(undefined),
          pressSequentially: vi.fn().mockResolvedValue(undefined),
          inputValue: vi.fn().mockResolvedValue('test@example.com'),
          waitFor: vi.fn().mockResolvedValue(undefined)
        };
        return loc;
      }
      if (selector === 'input[type="password"]') {
        const loc: Record<string, unknown> = {
          page: () => page,
          first: () => loc,
          nth: () => loc,
          count: vi.fn().mockResolvedValue(1),
          isVisible: vi.fn().mockResolvedValue(true),
          fill: vi.fn().mockResolvedValue(undefined),
          clear: vi.fn().mockResolvedValue(undefined),
          pressSequentially: vi.fn().mockResolvedValue(undefined),
          inputValue: vi.fn().mockResolvedValue('Password123!'),
          waitFor: vi.fn().mockResolvedValue(undefined)
        };
        return loc;
      }
      if (selector.includes('checkbox')) {
        const isNotCheckedQuery = selector.includes(':not(:checked)');
        const matchingIndices = checkboxStates
          .map((s, idx) => ({ s, idx }))
          .filter(({ s }) => (isNotCheckedQuery ? !s.checked : true))
          .map(({ idx }) => idx);

        const listLoc: Record<string, unknown> = {
          page: () => page,
          count: vi.fn(async () => matchingIndices.length),
          first: () => createBoxLocator(matchingIndices[0] ?? 0),
          nth: vi.fn((i: number) => createBoxLocator(matchingIndices[i] ?? 0))
        };
        return listLoc;
      }
      const fallbackLoc: Record<string, unknown> = {
        page: () => page,
        first: () => fallbackLoc,
        last: () => fallbackLoc,
        nth: () => fallbackLoc,
        count: vi.fn().mockResolvedValue(0),
        isVisible: vi.fn().mockResolvedValue(false),
        waitFor: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined)
      };
      return fallbackLoc;
    })
  } as unknown as Page;

  return { page, trace, submitClicked, checkboxStates };
}

describe('T02 — A03: signup terms checkbox handling', () => {
  it('checks both checkboxes when two unchecked boxes exist (not skipping the second due to shifting indices)', async () => {
    const { page, checkboxStates } = createTermsTestPage([
      { visible: true, checked: false },
      { visible: true, checked: false }
    ]);
    const controller = new AbortController();
    const ui = createDirectUiInteraction(controller.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: controller.signal,
        getOtp: async () => '123456',
        log: () => {}
      });
      const safeRunning = running.catch(() => {});
      await vi.advanceTimersByTimeAsync(15000);
      await safeRunning;

      // Both checkboxes must be checked!
      expect(checkboxStates[0].checked).toBe(true);
      expect(checkboxStates[1].checked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with SIGNUP_TERMS_NOT_ACCEPTED and does not submit if a checkbox fails readback check', async () => {
    const { page, submitClicked } = createTermsTestPage([
      { visible: true, checked: false, clickToggles: false } // Click does not set checked: true
    ]);
    const controller = new AbortController();
    const ui = createDirectUiInteraction(controller.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: controller.signal,
        log: () => {}
      });
      const assertion = expect(running).rejects.toThrow('SIGNUP_TERMS_NOT_ACCEPTED');
      await vi.advanceTimersByTimeAsync(15000);
      await assertion;
      expect(submitClicked.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
