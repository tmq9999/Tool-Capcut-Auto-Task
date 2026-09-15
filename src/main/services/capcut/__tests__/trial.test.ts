import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import type { BrowserContext, Page, Locator } from 'playwright-core';

import { createDirectUiInteraction } from '../uiInteractionScheduler';
import { checkProTrial, isEligible, MIN_TRIAL_DAYS, READ_TRIAL, type TrialInfo } from '../trial';
import { DomReadTimeoutError } from '../cancellation';

vi.mock('../diag', () => ({ dump: vi.fn(async () => 'trial-read-dump') }));

const base: TrialInfo = {
  status: 'eligible',
  canTrial: true,
  days: 7,
  trialPrice: '0₫',
  listPrice: '222,000₫',
  hasStartButton: true,
};

describe('trial', () => {
  it('đủ điều kiện: Pro 0₫ trong 7 ngày', () => {
    expect(isEligible(base)).toBe(true);
  });

  it('KHÔNG đủ điều kiện khi dưới 7 ngày', () => {
    expect(isEligible({ ...base, days: 3 })).toBe(false);
    expect(isEligible({ ...base, days: 0, canTrial: false })).toBe(false);
  });

  it('nhiều hơn 7 ngày vẫn đủ điều kiện', () => {
    expect(isEligible({ ...base, days: 14 })).toBe(true);
  });

  it('không đủ điều kiện khi kết quả đọc trial là unknown', () => {
    const broken: TrialInfo = {
      status: 'unknown',
      canTrial: false,
      days: 0,
      trialPrice: '',
      listPrice: '',
      hasStartButton: false,
      error: 'không mở được modal nâng cấp',
    };
    expect(isEligible(broken)).toBe(false);
  });

  it('không đủ điều kiện khi fallback lỗi có days=0', () => {
    expect(isEligible({
      ...base,
      status: 'unknown',
      canTrial: false,
      days: 0,
      error: 'không thấy thẻ gói Pro trong modal',
    })).toBe(false);
  });

  it('MIN_TRIAL_DAYS đúng bằng 7 như yêu cầu', () => {
    expect(MIN_TRIAL_DAYS).toBe(7);
  });
});

function trialPage(evaluateResult: unknown, evaluateRejects = false): Page {
  const page = {
    goto: vi.fn(async () => null),
    waitForTimeout: vi.fn(async () => {}),
    bringToFront: vi.fn(async () => {}),
    evaluate: evaluateRejects
      ? vi.fn(async () => { throw new Error('DOM read failed'); })
      : vi.fn(async () => evaluateResult),
    locator: vi.fn((selector: string) => {
      const isUpgradeEntry = selector === '[data-id="TitleBarUpgradeVip"]';
      const isProduct = selector === '[class*="subscriptionProduct"]';
      const locator = {
        first: () => locator,
        filter: () => locator,
        count: vi.fn(async () => isUpgradeEntry ? 1 : 0),
        isVisible: vi.fn(async () => isProduct),
        click: vi.fn(async () => {}),
      };
      return locator;
    }),
  };
  return page as unknown as Page;
}

async function runWithFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    let finished = false;
    let result: T;
    let error: unknown;
    fn().then(
      r => { finished = true; result = r; },
      e => { finished = true; error = e; }
    );
    let guard = 0;
    while (!finished && guard < 100) {
      guard++;
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.resolve();
    }
    if (!finished) {
      throw new Error('RUN_WITH_FAKE_TIMERS_EXHAUSTED');
    }
    if (error) throw error;
    return result!;
  } finally {
    vi.useRealTimers();
  }
}

describe('checkProTrial DOM boundary', () => {
  it('returns explicit unknown and cannot trial when the Pro-card DOM read fails', async () => {
    const signal = new AbortController().signal;
    const result = await runWithFakeTimers(() => checkProTrial(
      trialPage(null, true),
      {} as BrowserContext,
      () => {},
      createDirectUiInteraction(signal),
      signal
    ));

    expect(result).toMatchObject({
      status: 'unknown',
      canTrial: false,
      days: 0,
      error: 'không thấy thẻ gói Pro trong modal',
    });
    expect(isEligible(result)).toBe(false);
  });

  it('preserves an observed seven-day DOM offer as eligible', async () => {
    const signal = new AbortController().signal;
    const result = await runWithFakeTimers(() => checkProTrial(
      trialPage({
        found: true,
        days: 7,
        listPrice: '222,000₫',
        trialPrice: '0₫',
        hasStartButton: true,
      }),
      {} as BrowserContext,
      () => {},
      createDirectUiInteraction(signal),
      signal
    ));

    expect(result).toMatchObject({
      status: 'eligible',
      canTrial: true,
      days: 7,
      listPrice: '222,000₫',
      trialPrice: '0₫',
      hasStartButton: true,
    });
    expect(isEligible(result)).toBe(true);
  });

  it('R03 (F02): stops during the actual Pro-card read when AbortSignal is aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('STOP_DURING_PRO_CARD_READ');
    let entered = false;
    let resolveRead!: (value: unknown) => void;
    const page = trialPage(null);
    vi.mocked(page.evaluate).mockImplementation(() => {
      entered = true;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    });
    const pending = checkProTrial(
      page,
      {} as BrowserContext,
      () => {},
      createDirectUiInteraction(controller.signal),
      controller.signal
    );
    let settled = false;
    let rejection: unknown;
    void pending.then(
      () => {
        settled = true;
      },
      (error) => {
        settled = true;
        rejection = error;
      }
    );
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(entered).toBe(true);
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(rejection).toBe(reason);
    } finally {
      controller.abort(reason);
      resolveRead?.({ found: true, days: 7 });
      await Promise.allSettled([pending]);
      vi.useRealTimers();
    }
  });

  describe('R04 (F02): evaluates actual READ_TRIAL on DOM fixtures with pricing owner scoping', () => {
    interface MockNode {
      className: string;
      style: Record<string, string>;
      hidden?: boolean;
      inert?: boolean;
      innerText: string;
      textContent: string;
      tagName: string;
      children: MockNode[];
      parent: MockNode | null;
      rect: { width: number; height: number };
    }

    function makeMockNode(opts: {
      className?: string;
      style?: Record<string, string>;
      hidden?: boolean;
      inert?: boolean;
      text?: string;
      tagName?: string;
      rect?: { width: number; height: number };
      children?: MockNode[];
    }): MockNode {
      const node: MockNode = {
        className: opts.className ?? '',
        style: opts.style ?? {},
        hidden: opts.hidden,
        inert: opts.inert,
        innerText: opts.text ?? '',
        textContent: opts.text ?? '',
        tagName: (opts.tagName ?? 'div').toUpperCase(),
        children: opts.children ?? [],
        parent: null,
        rect: opts.rect ?? { width: 100, height: 50 },
      };
      for (const child of node.children) {
        child.parent = node;
      }
      return node;
    }

    function queryMockNodes(root: MockNode, sel: string): MockNode[] {
      const results: MockNode[] = [];
      function walk(n: MockNode) {
        let match = false;
        if (sel.includes('[class*="subscriptionModal-wrapper"]') && n.className.includes('subscriptionModal-wrapper')) {
          match = true;
        }
        if (sel.includes('[class*="subscriptionProductSection-pro"]') && n.className.includes('subscriptionProductSection-pro')) {
          match = true;
        }
        if (sel.includes('button') && (n.tagName === 'BUTTON' || sel.includes('[role="button"]'))) {
          match = true;
        }
        if (match) results.push(n);
        for (const c of n.children) walk(c);
      }
      for (const c of root.children) walk(c);
      return results;
    }

    function wrapMockNode(n: MockNode): unknown {
      const wrapped: Record<string, unknown> = {
        className: n.className,
        style: n.style,
        innerText: n.innerText,
        textContent: n.textContent,
        tagName: n.tagName,
        closest: (sel: string) => {
          let cur: MockNode | null = n;
          while (cur) {
            if (sel.includes('[hidden]') && (cur.hidden || cur.style.display === 'none')) return wrapMockNode(cur);
            if (sel.includes('[inert]') && cur.inert) return wrapMockNode(cur);
            cur = cur.parent;
          }
          return null;
        },
        getClientRects: () => [n.rect],
        getBoundingClientRect: () => n.rect,
        querySelectorAll: (sel: string) => queryMockNodes(n, sel).map(wrapMockNode),
      };
      return wrapped;
    }

    function runReadTrial(root: MockNode): Record<string, unknown> {
      const docMock = {
        body: {
          getClientRects: () => [{ width: 1920, height: 1080 }],
          offsetWidth: 1920,
          offsetHeight: 1080,
        },
        querySelectorAll: (sel: string) => queryMockNodes(root, sel).map(wrapMockNode),
      };
      const winMock = {
        getComputedStyle: (el: { style?: Record<string, string> }) => ({
          display: el.style?.display ?? 'block',
          visibility: el.style?.visibility ?? 'visible',
        }),
      };
      return vm.runInNewContext(READ_TRIAL, {
        document: docMock,
        window: winMock,
        getComputedStyle: winMock.getComputedStyle,
        Array,
        String,
        RegExp,
        parseInt,
        Boolean,
        Number,
      }) as Record<string, unknown>;
    }

    it('hidden stale Pro 7 + current visible Pro 3: scopes to visible modal owner and reads 3 days', () => {
      const staleModal = makeMockNode({
        className: 'subscriptionModal-wrapper',
        style: { display: 'none' },
        hidden: true,
        children: [
          makeMockNode({
            className: 'subscriptionProductSection-pro',
            text: 'Pro\n222,000₫\n0₫\nfor 7 days',
            children: [
              makeMockNode({ tagName: 'button', text: 'Start free trial' }),
            ],
          }),
        ],
      });
      const activeModal = makeMockNode({
        className: 'subscriptionModal-wrapper',
        style: { display: 'block' },
        children: [
          makeMockNode({
            className: 'subscriptionProductSection-pro',
            text: 'Pro\n222,000₫\n0₫\nfor 3 days',
            children: [
              makeMockNode({ tagName: 'button', text: 'Start free trial' }),
            ],
          }),
        ],
      });
      const root = makeMockNode({ children: [staleModal, activeModal] });
      const result = runReadTrial(root);

      expect(result.found).toBe(true);
      expect(result.days).toBe(3);
      expect(result.listPrice).toBe('222,000₫');
      expect(result.trialPrice).toBe('0₫');
      expect(result.hasStartButton).toBe(true);
    });

    it('single visible modal owner with Pro 7: reads 7 days correctly', () => {
      const modal = makeMockNode({
        className: 'subscriptionModal-wrapper',
        style: { display: 'block' },
        children: [
          makeMockNode({
            className: 'subscriptionProductSection-pro',
            text: 'Pro\n222,000₫\n0₫\nfor 7 days',
            children: [
              makeMockNode({ tagName: 'button', text: 'Start free trial' }),
            ],
          }),
        ],
      });
      const result = runReadTrial(makeMockNode({ children: [modal] }));

      expect(result.found).toBe(true);
      expect(result.days).toBe(7);
      expect(result.listPrice).toBe('222,000₫');
      expect(result.trialPrice).toBe('0₫');
      expect(result.hasStartButton).toBe(true);
    });

    it('two active visible modal owners: returns found: false with PRICING_OWNER_UNKNOWN', () => {
      const modal1 = makeMockNode({ className: 'subscriptionModal-wrapper', style: { display: 'block' } });
      const modal2 = makeMockNode({ className: 'subscriptionModal-wrapper', style: { display: 'block' } });
      const result = runReadTrial(makeMockNode({ children: [modal1, modal2] }));

      expect(result.found).toBe(false);
      expect(result.reason).toBe('PRICING_OWNER_UNKNOWN');
    });

    it('unrelated CTA outside pricing owner is not mixed into modal ctas', () => {
      const outsideButton = makeMockNode({ tagName: 'button', text: 'Start free trial' });
      const modalWithoutButton = makeMockNode({
        className: 'subscriptionModal-wrapper',
        style: { display: 'block' },
        children: [
          makeMockNode({
            className: 'subscriptionProductSection-pro',
            text: 'Pro\n222,000₫\n0₫\nfor 7 days',
            children: [],
          }),
        ],
      });
      const result = runReadTrial(makeMockNode({ children: [outsideButton, modalWithoutButton] }));

      expect(result.found).toBe(true);
      expect(result.days).toBe(7);
      expect(result.hasStartButton).toBe(false);
    });

    it('modal owner visible but no visible pro card: returns found: false with PRO_CARD_UNKNOWN', () => {
      const modalEmpty = makeMockNode({
        className: 'subscriptionModal-wrapper',
        style: { display: 'block' },
        children: [
          makeMockNode({
            className: 'subscriptionProductSection-pro',
            style: { display: 'none' },
            hidden: true,
            text: 'Pro\n222,000₫\n0₫\nfor 7 days',
          }),
        ],
      });
      const result = runReadTrial(makeMockNode({ children: [modalEmpty] }));

      expect(result.found).toBe(false);
      expect(result.reason).toBe('PRO_CARD_UNKNOWN');
    });
  });
});

describe('S01 — Onboarding survey handling before Upgrade (AC S01-A...F)', () => {
  interface StatefulTrialOptions {
    surveyInitiallyVisible?: boolean;
    skipClosesSurvey?: boolean;
    pricingInitiallyVisible?: boolean;
    upgradeClickFails?: boolean;
    stopOnSurveyRead?: boolean;
    surveyReadError?: Error;
    evaluateResult?: {
      found?: boolean;
      days?: number;
      listPrice?: string;
      trialPrice?: string;
      hasStartButton?: boolean;
    } | null;
  }

  function createStatefulTrialPage(options: StatefulTrialOptions, trace: string[]) {
    let surveyVisible = options.surveyInitiallyVisible ?? false;
    let pricingVisible = options.pricingInitiallyVisible ?? false;

    const page = {
      goto: vi.fn(async () => {
        trace.push('goto');
        return null;
      }),
      waitForTimeout: vi.fn(async () => {}),
      bringToFront: vi.fn(async () => {}),
      evaluate: vi.fn(async () => {
        trace.push('evaluate');
        return options.evaluateResult ?? null;
      }),
      locator: vi.fn((selector: string) => {
        const isWrapper = selector.includes('.lv-modal-wrapper');
        const isSkip = selector.includes('.skip-mrkR37') || selector.includes('Skip');
        const isMask = selector.includes('.lv-modal-mask');
        const isUpgrade = selector === '[data-id="TitleBarUpgradeVip"]';
        const isPricing = selector.includes('subscriptionProduct');
        const isClose = selector.includes('Close') || selector.includes('banner');

        const loc: Record<string, unknown> = {
          first: () => loc as unknown as Locator,
          filter: (_filterOpts?: { has?: unknown }) => {
            return loc as unknown as Locator;
          },
          locator: (subSelector: string) => {
            return (page.locator as unknown as (s: string) => Locator)(subSelector);
          },
          count: vi.fn(async () => {
            if (isUpgrade) return 1;
            if (isMask || isWrapper || isSkip) return surveyVisible ? 1 : 0;
            return 0;
          }),
          isVisible: vi.fn(async () => {
            if (options.stopOnSurveyRead) {
              trace.push('survey-read-check');
            }
            if (isWrapper || isMask || isSkip) {
              if (options.surveyReadError) throw options.surveyReadError;
              return surveyVisible;
            }
            if (isPricing) {
              return pricingVisible;
            }
            if (isClose) {
              return false;
            }
            return false;
          }),
          click: vi.fn(async () => {
            if (isSkip) {
              trace.push('skip-click');
              if (options.skipClosesSurvey !== false) {
                surveyVisible = false;
              }
              return;
            }
            if (isUpgrade) {
              trace.push('upgrade-click');
              if (options.upgradeClickFails) {
                throw new Error('Upgrade button click failed');
              }
              if (!surveyVisible) {
                pricingVisible = true;
              }
              return;
            }
            if (isClose) {
              trace.push('close-click');
              return;
            }
          }),
          waitFor: vi.fn(async () => undefined),
        };
        return loc;
      }),
    };
    return page as unknown as Page;
  }

  it('S01-A: survey blocks upgrade, Skip closes it before Upgrade click, then reads eligible offer', async () => {
    const trace: string[] = [];
    const page = createStatefulTrialPage({
      surveyInitiallyVisible: true,
      skipClosesSurvey: true,
      evaluateResult: {
        found: true,
        days: 7,
        listPrice: '222,000₫',
        trialPrice: '0₫',
        hasStartButton: true,
      }
    }, trace);

    const logs: string[] = [];
    const controller = new AbortController();
    const result = await runWithFakeTimers(() => checkProTrial(
      page,
      {} as BrowserContext,
      (msg) => logs.push(msg),
      createDirectUiInteraction(controller.signal),
      controller.signal
    ));

    expect(trace).toContain('skip-click');
    expect(trace).toContain('upgrade-click');
    const skipIndex = trace.indexOf('skip-click');
    const upgradeIndex = trace.indexOf('upgrade-click');
    expect(skipIndex).toBeLessThan(upgradeIndex);
    // Exactly 1 upgrade attempt since survey was closed and pricing opened
    const upgradeClicks = trace.filter(t => t === 'upgrade-click').length;
    expect(upgradeClicks).toBe(1);
    expect(result).toMatchObject({
      status: 'eligible',
      canTrial: true,
      days: 7,
    });
  });

  it('S01-B: Skip fails to close survey -> returns unknown with clear onboarding blocker error, zero Upgrade clicks', async () => {
    const trace: string[] = [];
    const page = createStatefulTrialPage({
      surveyInitiallyVisible: true,
      skipClosesSurvey: false,
    }, trace);

    const logs: string[] = [];
    const controller = new AbortController();
    const result = await runWithFakeTimers(() => checkProTrial(
      page,
      {} as BrowserContext,
      (msg) => logs.push(msg),
      createDirectUiInteraction(controller.signal),
      controller.signal
    ));

    expect(trace).toContain('skip-click');
    const upgradeClicks = trace.filter(t => t === 'upgrade-click').length;
    expect(upgradeClicks).toBe(0);
    expect(result.status).toBe('unknown');
    expect(result.canTrial).toBe(false);
    expect(result.error).toContain('onboarding');
  });

  it('S01-C: Pricing already opened without survey -> does not click Skip or Close pricing, reads offer intact', async () => {
    const trace: string[] = [];
    const page = createStatefulTrialPage({
      surveyInitiallyVisible: false,
      pricingInitiallyVisible: true,
      evaluateResult: {
        found: true,
        days: 7,
        listPrice: '222,000₫',
        trialPrice: '0₫',
        hasStartButton: true,
      }
    }, trace);

    const logs: string[] = [];
    const controller = new AbortController();
    const result = await runWithFakeTimers(() => checkProTrial(
      page,
      {} as BrowserContext,
      (msg) => logs.push(msg),
      createDirectUiInteraction(controller.signal),
      controller.signal
    ));

    expect(trace).not.toContain('skip-click');
    expect(trace).not.toContain('close-click');
    expect(trace).not.toContain('upgrade-click');
    expect(result.status).toBe('eligible');
  });

  it('S01-D: Upgrade click failure logs error and does not falsely claim success', async () => {
    const trace: string[] = [];
    const page = createStatefulTrialPage({
      surveyInitiallyVisible: false,
      upgradeClickFails: true,
    }, trace);

    const logs: string[] = [];
    const controller = new AbortController();
    const result = await runWithFakeTimers(() => checkProTrial(
      page,
      {} as BrowserContext,
      (msg) => logs.push(msg),
      createDirectUiInteraction(controller.signal),
      controller.signal
    ));

    expect(trace).toContain('upgrade-click');
    expect(result.status).toBe('unknown');
    expect(logs.some(l => l.includes('thất bại'))).toBe(true);
    expect(logs.some(l => l.includes('đã bấm') && !l.includes('thất bại'))).toBe(false);
  });

  it('S01-E: Stop signal during survey wait throws original abort reason without opening Upgrade', async () => {
    const trace: string[] = [];
    const stopError = new Error('USER_STOP_SIGNAL');
    const controller = new AbortController();

    const page = createStatefulTrialPage({
      surveyInitiallyVisible: true,
      stopOnSurveyRead: true,
    }, trace);

    // Abort controller before or when survey is checked
    controller.abort(stopError);

    await expect(
      checkProTrial(
        page,
        {} as BrowserContext,
        () => {},
        createDirectUiInteraction(controller.signal),
        controller.signal
      )
    ).rejects.toBe(stopError);

    expect(trace).not.toContain('upgrade-click');
  });

  it('S01-F: No survey happy path with ineligible trial returns ineligible without survey action', async () => {
    const trace: string[] = [];
    const page = createStatefulTrialPage({
      surveyInitiallyVisible: false,
      evaluateResult: {
        found: true,
        days: 3,
        listPrice: '222,000₫',
        trialPrice: '0₫',
        hasStartButton: true,
      }
    }, trace);

    const logs: string[] = [];
    const controller = new AbortController();
    const result = await runWithFakeTimers(() => checkProTrial(
      page,
      {} as BrowserContext,
      (msg) => logs.push(msg),
      createDirectUiInteraction(controller.signal),
      controller.signal
    ));

    expect(trace).not.toContain('skip-click');
    expect(trace).toContain('upgrade-click');
    expect(result.status).toBe('ineligible');
    expect(result.days).toBe(3);
    expect(isEligible(result)).toBe(false);
  });

  it('T04: survey read timeout (DomReadTimeoutError) rethrows without opening Upgrade modal', async () => {
    const trace: string[] = [];
    const timeoutErr = new DomReadTimeoutError('trial:survey-visible');
    const page = createStatefulTrialPage({
      surveyReadError: timeoutErr
    }, trace);

    const controller = new AbortController();
    await expect(
      runWithFakeTimers(() => checkProTrial(
        page,
        {} as BrowserContext,
        () => {},
        createDirectUiInteraction(controller.signal),
        controller.signal
      ))
    ).rejects.toThrow('DOM_READ_TIMEOUT');

    expect(trace).not.toContain('upgrade-click');
  });

  it('T04: survey read generic error returns status unknown without opening Upgrade modal', async () => {
    const trace: string[] = [];
    const genericErr = new Error('DOM query broken');
    const page = createStatefulTrialPage({
      surveyReadError: genericErr
    }, trace);

    const controller = new AbortController();
    const result = await runWithFakeTimers(() => checkProTrial(
      page,
      {} as BrowserContext,
      () => {},
      createDirectUiInteraction(controller.signal),
      controller.signal
    ));

    expect(trace).not.toContain('upgrade-click');
    expect(result.status).toBe('unknown');
    expect(result.error).toContain('Không xác minh được trạng thái khảo sát onboarding');
  });

  it('post-Skip outer read rejection fails trial read as unknown without clicking upgrade or evaluating', async () => {
    const trace: string[] = [];
    const page = createStatefulTrialPage({
      surveyInitiallyVisible: true,
      skipClosesSurvey: true
    }, trace);
    const originalLocator = page.locator.bind(page);
    let reads = 0;
    const outer = originalLocator('.lv-modal-wrapper:visible');
    outer.isVisible = vi.fn(async () => {
      if (++reads === 1) return true;
      throw new Error('POST_SKIP_READ_FAILED');
    });
    page.locator = vi.fn((sel: string) => {
      if (sel.includes('.lv-modal-wrapper')) return outer as unknown as Locator;
      return originalLocator(sel);
    });
    const signal = new AbortController().signal;
    const result = await runWithFakeTimers(() => checkProTrial(
      page,
      {} as BrowserContext,
      () => {},
      createDirectUiInteraction(signal),
      signal
    ));
    expect(reads).toBe(2);
    expect(trace).toContain('skip-click');
    expect(trace).not.toContain('upgrade-click');
    expect(trace).not.toContain('evaluate');
    expect(result.status).toBe('unknown');
  });
});
