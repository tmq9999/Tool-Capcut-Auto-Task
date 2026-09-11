import { expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { dismissOperationFeatureModal, ensurePageUsable, skipOnboardingSurvey } from '../overlays';
import { createDirectUiInteraction } from '../uiInteractionScheduler';
import { DomReadTimeoutError } from '../cancellation';

vi.mock('../diag', async (original) => ({ ...await original<typeof import('../diag')>(), dump: async () => 'blocked-modal-capture' }));
it('throws at the guard when an unknown modal remains instead of allowing the next UI step', async () => {
  const node = (selector: string) => ({
    count: async () => selector.includes('lv-modal-mask') ? 1 : 0,
    isVisible: async () => false,
    innerText: async () => 'Unknown blocking modal',
    first() { return this; }, filter() { return this; }, or() { return this; }
  });
  const page = { locator: node } as unknown as Page;
  const signal = new AbortController().signal;
  const action = vi.fn();
  const operation = ensurePageUsable(page, () => {}, createDirectUiInteraction(signal), signal).then(action);
  await expect(operation).rejects.toMatchObject({ name: 'StepError', dumpName: 'blocked-modal-capture' });
  expect(action).not.toHaveBeenCalled();
});

it('does not count or repeat a rejected onboarding Skip click', async () => {
  const click = vi.fn().mockRejectedValue(new Error('Element is outside of the viewport'));
  const blockingMask = {
    count: async () => 1,
    first() { return this; },
    waitFor: async () => undefined
  };
  const skip = {
    first() { return this; },
    isVisible: async () => true,
    click
  };
  const surveyWrapper = {
    count: async () => 1,
    isVisible: async () => true,
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => skip)
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('lv-modal-mask')) return blockingMask;
      if (selector.includes('lv-modal-wrapper')) return surveyWrapper;
      return skip;
    })
  } as unknown as Page;
  const messages: string[] = [];
  const signal = new AbortController().signal;

  await expect(skipOnboardingSurvey(
    page,
    (message) => messages.push(message),
    createDirectUiInteraction(signal),
    signal
  )).resolves.toBe(false);

  expect(click).toHaveBeenCalledTimes(1);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('sau 0 lần Skip');
});

it('does not classify feature announcement modal as an onboarding survey', async () => {
  const mask = {
    count: async () => 1,
    first() { return this; },
  };
  const featureWrapper = {
    count: async () => 1,
    isVisible: async () => true,
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => ({
      first() { return this; },
      isVisible: async () => true,
      click: vi.fn(async () => {}),
    })),
  };
  const emptyLocator = {
    count: async () => 0,
    isVisible: async () => false,
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => emptyLocator),
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('lv-modal-mask')) return mask;
      if (selector.includes('operation-features-modal')) return featureWrapper;
      return emptyLocator;
    }),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const result = await skipOnboardingSurvey(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  );

  expect(result).toBe(true);
  expect(messages).toHaveLength(0);
});

it('dismissOperationFeatureModal clicks owned Got it button within feature wrapper and waits for hide', async () => {
  let modalVisible = true;
  const gotItClick = vi.fn(async () => {
    modalVisible = false;
  });
  const gotItButton = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: gotItClick,
  };
  const featureWrapper = {
    count: vi.fn(async () => (modalVisible ? 1 : 0)),
    isVisible: vi.fn(async () => modalVisible),
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn((selector: string) => {
      if (selector.includes('Got it')) return gotItButton;
      return { first() { return this; }, isVisible: async (): Promise<boolean> => false };
    }),
    waitFor: vi.fn(async () => undefined),
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('operation-features-modal') || selector.includes('lv-modal-wrapper')) {
        return featureWrapper;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const dismissed = await dismissOperationFeatureModal(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  );

  expect(dismissed).toBe(true);
  expect(gotItClick).toHaveBeenCalledTimes(1);
  expect(messages.some((m) => m.includes('Đã đóng modal giới thiệu tính năng'))).toBe(true);
});

it('when survey, feature, and pricing coexist, each handler only clicks its owned controls', async () => {
  let surveyVisible = true;
  const skipClick = vi.fn(async () => {
    surveyVisible = false;
  });
  const gotItClick = vi.fn(async () => {});
  const pricingCloseClick = vi.fn(async () => {});

  const skipButton = {
    first() { return this; },
    isVisible: vi.fn(async () => surveyVisible),
    click: skipClick,
  };
  const gotItButton = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: gotItClick,
  };
  const pricingCloseButton = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: pricingCloseClick,
  };

  const surveyWrapper = {
    count: vi.fn(async () => (surveyVisible ? 1 : 0)),
    isVisible: vi.fn(async () => surveyVisible),
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => skipButton),
  };
  const featureWrapper = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => gotItButton),
    waitFor: vi.fn(async () => undefined),
  };
  const pricingModal = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    first() { return this; },
  };

  const page = {
    bringToFront: vi.fn(async () => {}),
    keyboard: { press: vi.fn(async () => {}) },
    waitForTimeout: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('lv-modal-mask')) {
        return { count: async (): Promise<number> => 1, first() { return this; }, waitFor: async () => undefined };
      }
      if (selector.includes('subscriptionModal')) {
        if (selector.includes('Close') || selector.includes('close')) return pricingCloseButton;
        return pricingModal;
      }
      if (selector.includes('operation-features-modal')) return featureWrapper;
      if (selector.includes('lv-modal-wrapper')) {
        return {
          first() { return this; },
          count: async (): Promise<number> => 2,
          filter: (criteria: { has?: unknown }) => {
            if (criteria?.has === featureWrapper) return featureWrapper;
            return surveyWrapper;
          },
          or: (other: unknown) => other,
        };
      }
      if (selector.includes('.skip-mrkR37') || selector.includes('Skip')) return skipButton;
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const signal = new AbortController().signal;
  const ui = createDirectUiInteraction(signal);

  // Calling skipOnboardingSurvey only clicks Skip
  await skipOnboardingSurvey(page, () => {}, ui, signal);
  expect(skipClick).toHaveBeenCalledTimes(1);
  expect(gotItClick).not.toHaveBeenCalled();
  expect(pricingCloseClick).not.toHaveBeenCalled();

  // Calling dismissOperationFeatureModal only clicks Got it
  await dismissOperationFeatureModal(page, () => {}, ui, signal);
  expect(gotItClick).toHaveBeenCalledTimes(1);
  expect(pricingCloseClick).not.toHaveBeenCalled();
});

it('returns false when Got it click resolves without modal closing', async () => {
  const gotItButton = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => {}),
  };
  const featureWrapper = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true), // remains visible after click
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => gotItButton),
    waitFor: vi.fn(async () => undefined),
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('operation-features-modal') || selector.includes('lv-modal-wrapper')) {
        return featureWrapper;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const dismissed = await dismissOperationFeatureModal(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  );

  expect(dismissed).toBe(false);
  expect(messages.some((m) => m.includes('VẪN MỞ'))).toBe(true);
});

it('rejects when Got it click resolves but final readback throws or times out', async () => {
  const readFailure = new Error('FEATURE_READ_FAILED');
  let reads = 0;
  const gotItButton = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => {}),
  };
  const featureWrapper = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => {
      if (++reads === 1) return true;
      throw readFailure;
    }),
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => gotItButton),
    waitFor: vi.fn(async () => undefined),
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('operation-features-modal') || selector.includes('lv-modal-wrapper')) {
        return featureWrapper;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const result = await dismissOperationFeatureModal(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  ).then(value => ({ value }), error => ({ error }));

  expect(reads).toBe(2);
  expect(result).not.toEqual({ value: true });
  expect(result).toEqual({ error: readFailure });
  expect(messages.some(message => message.includes('Đã đóng modal giới thiệu tính năng'))).toBe(false);
});

it('rejects with typed DomReadTimeoutError when feature readback times out', async () => {
  const timeoutError = new DomReadTimeoutError('overlay:feature-modal-still-visible');
  let reads = 0;
  const gotItButton = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => {}),
  };
  const featureWrapper = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => {
      if (++reads === 1) return true;
      throw timeoutError;
    }),
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => gotItButton),
    waitFor: vi.fn(async () => undefined),
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('operation-features-modal') || selector.includes('lv-modal-wrapper')) {
        return featureWrapper;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const signal = new AbortController().signal;
  await expect(dismissOperationFeatureModal(
    page,
    () => {},
    createDirectUiInteraction(signal),
    signal
  )).rejects.toBe(timeoutError);
});

it('owner regression: feature mask + unrelated visible Skip before survey wrapper does not click Skip when no survey', async () => {
  const unrelatedSkipClick = vi.fn(async () => {});
  const unrelatedSkip = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: unrelatedSkipClick,
  };
  const blockingMask = {
    count: async (): Promise<number> => 1,
    first() { return this; },
    waitFor: async (): Promise<void> => undefined
  };
  const emptySurveyWrapper = {
    count: async (): Promise<number> => 0,
    isVisible: async (): Promise<boolean> => false,
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => ({ first() { return this; }, isVisible: async (): Promise<boolean> => false, click: vi.fn() }))
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('lv-modal-mask')) return blockingMask;
      if (selector.includes('lv-modal-wrapper')) return emptySurveyWrapper;
      if (selector.includes('.skip-mrkR37') || selector.includes('Skip') || selector.includes('Not now')) {
        return unrelatedSkip;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    })
  } as unknown as Page;

  const signal = new AbortController().signal;
  const ui = createDirectUiInteraction(signal);
  const result = await skipOnboardingSurvey(page, () => {}, ui, signal);

  expect(result).toBe(true);
  expect(unrelatedSkipClick).not.toHaveBeenCalled();
});

it('owner regression: feature mask + unrelated visible Skip before survey wrapper clicks only survey wrapper own Skip', async () => {
  let surveyVisible = true;
  const unrelatedSkipClick = vi.fn(async () => {});
  const surveySkipClick = vi.fn(async () => {
    surveyVisible = false;
  });

  const unrelatedSkip = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: unrelatedSkipClick,
  };
  const surveySkip = {
    first() { return this; },
    isVisible: vi.fn(async () => surveyVisible),
    click: surveySkipClick,
  };
  const blockingMask = {
    count: async (): Promise<number> => 1,
    first() { return this; },
    waitFor: async (): Promise<void> => undefined
  };
  const surveyWrapper = {
    count: async (): Promise<number> => (surveyVisible ? 1 : 0),
    isVisible: async (): Promise<boolean> => surveyVisible,
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    locator: vi.fn(() => surveySkip)
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('lv-modal-mask')) return blockingMask;
      if (selector.includes('lv-modal-wrapper')) return surveyWrapper;
      if (selector.includes('.skip-mrkR37') || selector.includes('Skip') || selector.includes('Not now')) {
        // Global query returns unrelatedSkip first
        return unrelatedSkip;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    })
  } as unknown as Page;

  const signal = new AbortController().signal;
  const ui = createDirectUiInteraction(signal);
  const result = await skipOnboardingSurvey(page, () => {}, ui, signal);

  expect(result).toBe(true);
  expect(surveySkipClick).toHaveBeenCalledTimes(1);
  expect(unrelatedSkipClick).not.toHaveBeenCalled();
});

it('P01 regression: dismissOperationFeatureModal clicks accessible Close button, not Try now or outside Got it', async () => {
  let modalVisible = true;
  const closeClick = vi.fn(async () => {
    modalVisible = false;
  });
  const tryNowClick = vi.fn(async () => {});
  const outsideGotItClick = vi.fn(async () => {});

  const closeControl = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: closeClick,
  };
  const tryNowControl = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: tryNowClick,
  };
  const outsideGotItControl = {
    first() { return this; },
    isVisible: vi.fn(async () => true),
    click: outsideGotItClick,
  };

  const featureWrapper = {
    count: vi.fn(async () => (modalVisible ? 1 : 0)),
    isVisible: vi.fn(async () => modalVisible),
    first() { return this; },
    filter() { return this; },
    or() { return this; },
    getByRole: vi.fn((role: string, options?: { name?: string | RegExp; exact?: boolean }) => {
      if (role === 'button' && (options?.name === 'Close' || options?.name === 'close')) {
        return closeControl;
      }
      return { first() { return this; }, isVisible: async () => false, click: vi.fn() };
    }),
    locator: vi.fn((selector: string) => {
      if (selector.includes('Try now') || selector.includes('tryNow')) return tryNowControl;
      // Inside wrapper, Got it is absent
      return { first() { return this; }, isVisible: async () => false, click: vi.fn() };
    }),
    waitFor: vi.fn(async () => {
      modalVisible = false;
    }),
  };

  const page = {
    bringToFront: vi.fn(async () => {}),
    getByRole: vi.fn((role: string, options?: { name?: string | RegExp; exact?: boolean }) => {
      return featureWrapper.getByRole(role, options);
    }),
    locator: vi.fn((selector: string) => {
      if (selector.includes('operation-features-modal') || selector.includes('lv-modal-wrapper')) {
        return featureWrapper;
      }
      if (selector.includes('Got it') || selector.includes('guideBubble')) {
        return outsideGotItControl;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const result = await dismissOperationFeatureModal(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  );

  expect(result).toBe(true);
  expect(closeClick).toHaveBeenCalledOnce();
  expect(tryNowClick).not.toHaveBeenCalled();
  expect(outsideGotItClick).not.toHaveBeenCalled();
  expect(featureWrapper.waitFor).toHaveBeenCalledWith({ state: 'hidden', timeout: 4000 });
});

it('P01 edge case: repeated dismissOperationFeatureModal after modal already closed performs no action and no dump', async () => {
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn(() => ({
      count: async () => 0,
      isVisible: async () => false,
      first() { return this; },
      filter() { return this; },
      or() { return this; },
    })),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const result = await dismissOperationFeatureModal(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  );

  expect(result).toBe(true);
  expect(messages).toHaveLength(0);
});

it('P01 edge case: hidden owner before visible sibling correctly chooses visible modal to close', async () => {
  let visibleClosed = false;
  const closeClick = vi.fn(async () => {
    visibleClosed = true;
  });
  const hiddenWrapper = {
    count: async () => 2,
    isVisible: vi.fn(async () => false),
    first() { return this; },
    filter() { return this; },
  };
  const visibleWrapper = {
    count: async () => 2,
    isVisible: vi.fn(async () => !visibleClosed),
    getByRole: vi.fn((role: string, options?: { name?: string | RegExp; exact?: boolean }) => {
      if (role === 'button' && (options?.name === 'Close' || options?.name === 'close')) {
        return {
          first() { return this; },
          isVisible: async () => !visibleClosed,
          click: closeClick,
        };
      }
      return { first() { return this; }, isVisible: async () => false, click: vi.fn() };
    }),
    locator: vi.fn(() => ({ first() { return this; }, isVisible: async () => false, click: vi.fn() })),
    waitFor: vi.fn(async () => {
      visibleClosed = true;
    }),
  };

  const wrappers = {
    count: async (): Promise<number> => 2,
    nth: vi.fn((i: number) => (i === 0 ? hiddenWrapper : visibleWrapper)),
    first() { return hiddenWrapper; },
    filter() { return this; },
  };

  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('operation-features-modal') || selector.includes('lv-modal-wrapper')) {
        return wrappers;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const result = await dismissOperationFeatureModal(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  );

  expect(result).toBe(true);
  expect(closeClick).toHaveBeenCalledOnce();
  expect(hiddenWrapper.isVisible).toHaveBeenCalled();
  expect(visibleWrapper.waitFor).toHaveBeenCalledWith({ state: 'hidden', timeout: 4000 });
});

it('P01 edge case: missing close button returns false and logs warning with dump capture', async () => {
  const featureWrapper = {
    count: async (): Promise<number> => 1,
    isVisible: async (): Promise<boolean> => true,
    first() { return this; },
    filter() { return this; },
    getByRole: vi.fn(() => ({ first() { return this; }, isVisible: async () => false, click: vi.fn() })),
    locator: vi.fn(() => ({ first() { return this; }, isVisible: async () => false, click: vi.fn() })),
    waitFor: vi.fn(async () => undefined),
  };

  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector.includes('operation-features-modal') || selector.includes('lv-modal-wrapper')) {
        return featureWrapper;
      }
      return { count: async (): Promise<number> => 0, isVisible: async (): Promise<boolean> => false, first() { return this; } };
    }),
  } as unknown as Page;

  const messages: string[] = [];
  const signal = new AbortController().signal;

  const result = await dismissOperationFeatureModal(
    page,
    (m) => messages.push(m),
    createDirectUiInteraction(signal),
    signal
  );

  expect(result).toBe(false);
  expect(messages.some((m) => m.includes('không thấy nút Close hoặc Got it'))).toBe(true);
  expect(messages.some((m) => m.includes('blocked-modal-capture'))).toBe(true);
});

it('P01 edge case: abort signal throws and does not report false closed log', async () => {
  const controller = new AbortController();
  controller.abort(new Error('ABORTED_BY_TEST'));

  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn(() => ({
      count: async (): Promise<number> => 1,
      isVisible: async (): Promise<boolean> => true,
      first() { return this; },
      filter() { return this; },
    })),
  } as unknown as Page;

  const messages: string[] = [];

  await expect(
    dismissOperationFeatureModal(
      page,
      (m) => messages.push(m),
      createDirectUiInteraction(controller.signal),
      controller.signal
    )
  ).rejects.toThrow();

  expect(messages.some((m) => m.includes('Đã đóng modal'))).toBe(false);
});

it('V05: initial count error in dismissOperationFeatureModal rejects with failure', async () => {
  const failure = new Error('FEATURE_COUNT_FAILED');
  const closeClick = vi.fn();
  const featureWrapper = {
    count: vi.fn(async () => { throw failure; }),
    isVisible: vi.fn(async () => false),
    first() { return this; },
    filter() { return this; },
    getByRole: vi.fn(() => ({ first() { return this; }, isVisible: async () => false, click: closeClick })),
    locator: vi.fn(() => ({ first() { return this; }, isVisible: async () => false, click: closeClick })),
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn(() => featureWrapper),
  } as unknown as Page;
  const signal = new AbortController().signal;

  await expect(dismissOperationFeatureModal(
    page, vi.fn(), createDirectUiInteraction(signal), signal
  )).rejects.toBe(failure);
  expect(closeClick).not.toHaveBeenCalled();
});

it('V05: initial visibility error in dismissOperationFeatureModal rejects with failure', async () => {
  const failure = new Error('FEATURE_VISIBILITY_FAILED');
  const featureWrapper = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => { throw failure; }),
    first() { return this; },
    filter() { return this; },
    nth: vi.fn(() => featureWrapper),
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn(() => featureWrapper),
  } as unknown as Page;
  const signal = new AbortController().signal;

  await expect(dismissOperationFeatureModal(
    page, vi.fn(), createDirectUiInteraction(signal), signal
  )).rejects.toBe(failure);
});

it('V05: rejects when two visible canonical wrappers exist (ambiguous owners)', async () => {
  const closeClick1 = vi.fn();
  const closeClick2 = vi.fn();
  const wrapper1 = {
    isVisible: vi.fn(async () => true),
    getByRole: vi.fn(() => ({ count: async () => 1, isVisible: async () => true, click: closeClick1 })),
    locator: vi.fn(() => ({ count: async () => 0, isVisible: async () => false, click: vi.fn() })),
    waitFor: vi.fn(),
  };
  const wrapper2 = {
    isVisible: vi.fn(async () => true),
    getByRole: vi.fn(() => ({ count: async () => 1, isVisible: async () => true, click: closeClick2 })),
    locator: vi.fn(() => ({ count: async () => 0, isVisible: async () => false, click: vi.fn() })),
    waitFor: vi.fn(),
  };
  const wrappers = {
    count: vi.fn(async () => 2),
    nth: vi.fn((i: number) => (i === 0 ? wrapper1 : wrapper2)),
    first() { return wrapper1; },
    filter() { return this; },
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn(() => wrappers),
  } as unknown as Page;
  const signal = new AbortController().signal;

  await expect(dismissOperationFeatureModal(
    page, vi.fn(), createDirectUiInteraction(signal), signal
  )).rejects.toThrow(/ambiguous/i);
  expect(closeClick1).not.toHaveBeenCalled();
  expect(closeClick2).not.toHaveBeenCalled();
});

it('V05: rejects when accessible close control is ambiguous and does not fall back to CSS .first()', async () => {
  const cssCloseClick = vi.fn();
  const accessibleClose = {
    count: vi.fn(async () => 2),
    isVisible: vi.fn(async () => { throw new Error('strict mode violation: locator resolved to 2 elements'); }),
    click: vi.fn(),
  };
  const cssClose = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    first() { return this; },
    click: cssCloseClick,
  };
  const wrapper = {
    isVisible: vi.fn(async () => true),
    getByRole: vi.fn(() => accessibleClose),
    locator: vi.fn(() => cssClose),
    waitFor: vi.fn(),
  };
  const wrappers = {
    count: vi.fn(async () => 1),
    nth: vi.fn(() => wrapper),
    first() { return wrapper; },
    filter() { return this; },
  };
  const page = {
    bringToFront: vi.fn(async () => {}),
    locator: vi.fn(() => wrappers),
  } as unknown as Page;
  const signal = new AbortController().signal;

  await expect(dismissOperationFeatureModal(
    page, vi.fn(), createDirectUiInteraction(signal), signal
  )).rejects.toThrow();
  expect(cssCloseClick).not.toHaveBeenCalled();
});



