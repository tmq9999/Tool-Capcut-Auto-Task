import { describe, it, expect, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { signupCapcut } from '../signup';
import type { BirthdayInfo } from '../birthday';
import { MONTH_NAMES } from '../birthday';
import { createDirectUiInteraction } from '../uiInteractionScheduler';

interface MockOption {
  text: string;
  value: number;
  visible?: boolean;
  owner?: 'month' | 'day' | 'other';
}

interface BirthdayFixtureOwnershipControls {
  optionCountGate?: Promise<void>;
  onOptionCount?: () => void;
  monthAriaControls?: string | null;
  dayAriaControls?: string | null;
  monthTriggerId?: string | null;
  dayTriggerId?: string | null;
  unrelatedPanelVisible?: boolean;
  hasMonthPanel?: boolean;
  ariaControlsError?: Error;
  multipleVisiblePanels?: boolean;
}

interface BirthdayFixtureState extends BirthdayFixtureOwnershipControls {
  selectedYear: string;
  selectedMonth: number | null;
  selectedDay: number | null;
  open: 'month' | 'day' | null;
  continueClicks: number;
  optionClicks: string[];
  monthOptions: MockOption[];
  dayOptions: MockOption[];
  otherOptions?: MockOption[];
  failYearFill?: boolean;
  failMonthSelect?: boolean;
  failDaySelect?: boolean;
  deferredRead?: Promise<string>;
}

function createBirthdayTestPage(initialConfig: Partial<BirthdayFixtureState> = {}) {
  const defaultMonthOptions: MockOption[] = [
    { text: 'DECOY_FIRST', value: 999, owner: 'month' }, // decoy at index 0
    ...MONTH_NAMES.map((name, i) => ({ text: name, value: i + 1, owner: 'month' as const }))
  ];

  const defaultDayOptions: MockOption[] = [
    { text: 'DECOY_DAY', value: 999, owner: 'day' }, // decoy at index 0
    ...Array.from({ length: 31 }, (_, i) => ({ text: String(i + 1), value: i + 1, owner: 'day' as const }))
  ];

  const state: BirthdayFixtureState = {
    selectedYear: '',
    selectedMonth: null,
    selectedDay: null,
    open: null,
    continueClicks: 0,
    optionClicks: [],
    monthOptions: defaultMonthOptions,
    dayOptions: defaultDayOptions,
    ...initialConfig
  };

  const isOptionVisible = (opt: MockOption): boolean => {
    if (opt.visible === false) return false;
    if (opt.owner === 'month') {
      return state.open === 'month';
    }
    if (opt.owner === 'day') {
      return state.open === 'day';
    }
    return true;
  };

  const createOptionLocator = (opt: MockOption) => {
    const optLoc: Record<string, unknown> = {
      page: () => page,
      first: () => optLoc,
      nth: () => optLoc,
      isVisible: vi.fn(async () => isOptionVisible(opt)),
      textContent: vi.fn(async () => opt.text),
      click: vi.fn(async () => {
        state.optionClicks.push(`${opt.owner ?? 'unknown'}:${opt.text}`);
        if (opt.owner === 'month' && !state.failMonthSelect) {
          state.selectedMonth = opt.value;
          state.open = null;
        } else if (opt.owner === 'day' && !state.failDaySelect) {
          state.selectedDay = opt.value;
          state.open = null;
        }
      })
    };
    return optLoc;
  };

  const createOptionsListLocator = (options: MockOption[]) => {
    const listLoc: Record<string, unknown> = {
      page: () => page,
      count: vi.fn(async () => {
        state.onOptionCount?.();
        if (state.optionCountGate) await state.optionCountGate;
        return options.length;
      }),
      first: () => createOptionLocator(options[0] ?? { text: '', value: 0, visible: false }),
      last: () => createOptionLocator(options[options.length - 1] ?? { text: '', value: 0, visible: false }),
      nth: vi.fn((i: number) => createOptionLocator(options[i] ?? { text: '', value: 0, visible: false })),
      filter: vi.fn((filterOpts?: { hasText?: string | RegExp }) => {
        const filtered = options.filter(o => {
          if (!filterOpts?.hasText) return true;
          if (typeof filterOpts.hasText === 'string') {
            return o.text.includes(filterOpts.hasText);
          }
          return filterOpts.hasText.test(o.text);
        });
        const filteredList: Record<string, unknown> = {
          page: () => page,
          count: vi.fn(async () => {
            state.onOptionCount?.();
            if (state.optionCountGate) await state.optionCountGate;
            return filtered.length;
          }),
          first: () => createOptionLocator(filtered[0] ?? { text: '', value: 0, visible: false }),
          last: () => createOptionLocator(filtered[filtered.length - 1] ?? { text: '', value: 0, visible: false }),
          nth: vi.fn((i: number) => createOptionLocator(filtered[i] ?? { text: '', value: 0, visible: false })),
          isVisible: vi.fn(async () => {
            const first = filtered[0];
            return first ? isOptionVisible(first) : false;
          })
        };
        return filteredList;
      })
    };
    return listLoc;
  };

  const getAllDomOptions = (): MockOption[] => {
    return [
      ...(state.otherOptions ?? []),
      ...state.monthOptions.map(o => ({ ...o, owner: (o.owner ?? 'month') as 'month' | 'day' | 'other' })),
      ...state.dayOptions.map(o => ({ ...o, owner: (o.owner ?? 'day') as 'month' | 'day' | 'other' }))
    ];
  };

  const createContainerLocator = (owner: 'month' | 'day') => {
    const getOptions = () => {
      const opts = owner === 'month' ? state.monthOptions : state.dayOptions;
      return opts.map(o => ({ ...o, owner: (o.owner ?? owner) as 'month' | 'day' | 'other' }));
    };
    const containerLoc: Record<string, unknown> = {
      page: () => page,
      first: () => containerLoc,
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => state.open === owner),
      locator: vi.fn((childSel: string) => {
        if (childSel.includes('lv-select-option') || childSel.includes('[role="option"]')) {
          return createOptionsListLocator(getOptions());
        }
        return dummyLoc;
      })
    };
    return containerLoc;
  };

  const yearInputLoc: Record<string, unknown> = {
    page: () => page,
    first: () => yearInputLoc,
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => {}),
    fill: vi.fn(async (v: string) => {
      if (!state.failYearFill) {
        state.selectedYear = v;
      }
    }),
    inputValue: vi.fn(async () => {
      if (state.deferredRead) await state.deferredRead;
      return state.selectedYear;
    })
  };

  const monthSelectorLoc: Record<string, unknown> = {
    page: () => page,
    first: () => monthSelectorLoc,
    isVisible: vi.fn(async () => true),
    getAttribute: vi.fn(async (attr: string) => {
      if (attr === 'aria-controls') {
        if (state.ariaControlsError) throw state.ariaControlsError;
        if (state.monthAriaControls !== undefined) return state.monthAriaControls;
        return 'birthday-month-dropdown';
      }
      if (attr === 'id') {
        if (state.monthTriggerId !== undefined) return state.monthTriggerId;
        return 'birthday-month-trigger-id';
      }
      return null;
    }),
    click: vi.fn(async () => {
      state.open = 'month';
    }),
    textContent: vi.fn(async () => {
      if (state.deferredRead) await state.deferredRead;
      if (state.selectedMonth == null) return '';
      const m = state.monthOptions.find(o => o.value === state.selectedMonth && o.owner !== 'other');
      return m ? m.text : String(state.selectedMonth);
    })
  };

  const daySelectorLoc: Record<string, unknown> = {
    page: () => page,
    last: () => daySelectorLoc,
    first: () => daySelectorLoc,
    isVisible: vi.fn(async () => true),
    getAttribute: vi.fn(async (attr: string) => {
      if (attr === 'aria-controls') {
        if (state.dayAriaControls !== undefined) return state.dayAriaControls;
        return 'birthday-day-dropdown';
      }
      if (attr === 'id') {
        if (state.dayTriggerId !== undefined) return state.dayTriggerId;
        return 'birthday-day-trigger-id';
      }
      return null;
    }),
    click: vi.fn(async () => {
      state.open = 'day';
    }),
    textContent: vi.fn(async () => {
      if (state.deferredRead) await state.deferredRead;
      return state.selectedDay != null ? String(state.selectedDay) : '';
    })
  };

  const continueBtnLoc: Record<string, unknown> = {
    page: () => page,
    first: () => continueBtnLoc,
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => {
      state.continueClicks++;
      throw new Error('AFTER_BIRTHDAY_CONTINUE_SENTINEL');
    })
  };

  const dummyLoc: Record<string, unknown> = {
    page: () => page,
    first: () => dummyLoc,
    last: () => dummyLoc,
    nth: () => dummyLoc,
    count: vi.fn(async () => 0),
    isVisible: vi.fn(async () => false),
    click: vi.fn(async () => {}),
    waitFor: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    pressSequentially: vi.fn(async () => {}),
    inputValue: vi.fn(async () => ''),
    textContent: vi.fn(async () => '')
  };

  const page = {
    url: vi.fn().mockReturnValue('https://www.capcut.com/signup'),
    goto: vi.fn().mockResolvedValue(null),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    getByRole: vi.fn((role: string, opts?: { name?: unknown; level?: number }) => {
      if (role === 'heading') {
        const nameStr = opts?.name ? String(opts.name) : '';
        const isBday = /birthday/i.test(nameStr);
        const headingLoc: Record<string, unknown> = {
          page: () => page,
          first: () => headingLoc,
          isVisible: vi.fn(async () => true),
          textContent: vi.fn(async () => (isBday ? "When's your birthday?" : 'Create an account'))
        };
        return headingLoc;
      }
      if (role === 'button') {
        const btnLoc: Record<string, unknown> = {
          page: () => page,
          first: () => btnLoc,
          isVisible: vi.fn(async () => true),
          waitFor: vi.fn(async () => {}),
          click: vi.fn(async () => {})
        };
        return btnLoc;
      }
      return dummyLoc;
    }),
    getByText: vi.fn(() => dummyLoc),
    locator: vi.fn((sel: string) => {
      if (sel === 'input[type="email"]') {
        const emailLoc: Record<string, unknown> = {
          ...dummyLoc,
          page: () => page,
          first: () => emailLoc,
          isVisible: vi.fn(async () => true),
          inputValue: vi.fn(async () => 'test@example.com')
        };
        return emailLoc;
      }
      if (sel === 'input[type="password"]') {
        const pwLoc: Record<string, unknown> = {
          ...dummyLoc,
          page: () => page,
          first: () => pwLoc,
          nth: () => pwLoc,
          count: vi.fn(async () => 1),
          isVisible: vi.fn(async () => true),
          inputValue: vi.fn(async () => 'Password123!')
        };
        return pwLoc;
      }
      if (sel.includes('checkbox')) {
        return { ...dummyLoc, count: vi.fn(async () => 0) };
      }
      if (sel.includes('placeholder="Year"') || sel.includes('gate_birthday-picker-input')) {
        return yearInputLoc;
      }
      if (sel.includes('gate_birthday-picker-selector')) {
        return {
          first: () => monthSelectorLoc,
          last: () => daySelectorLoc,
          isVisible: vi.fn(async () => true)
        };
      }
      if (sel.includes('aria-labelledby')) {
        if (state.multipleVisiblePanels) {
          const panel = createContainerLocator('month');
          return {
            ...panel,
            count: vi.fn(async () => 2),
            first: () => panel
          };
        }
        const match = /aria-labelledby~="([^"]+)"/.exec(sel);
        const token = match ? match[1].replace(/\\/g, '') : '';
        const currentTriggerId = state.open === 'day'
          ? (state.dayTriggerId !== undefined ? state.dayTriggerId : 'birthday-day-trigger-id')
          : (state.monthTriggerId !== undefined ? state.monthTriggerId : 'birthday-month-trigger-id');
        if (state.hasMonthPanel !== false && token && currentTriggerId && token === currentTriggerId) {
          return createContainerLocator(state.open === 'day' ? 'day' : 'month');
        }
        const emptyLoc: Record<string, unknown> = {
          ...dummyLoc,
          count: vi.fn(async () => 0),
          first: () => emptyLoc,
          isVisible: vi.fn(async () => false)
        };
        return emptyLoc;
      }
      if (state.unrelatedPanelVisible && (sel.includes('.lv-select-dropdown') || sel.includes('[role="listbox"]') || sel.includes('.semi-select-option-list')) && !sel.includes('option')) {
        const unrelatedLoc: Record<string, unknown> = {
          page: () => page,
          first: () => unrelatedLoc,
          count: vi.fn(async () => 1),
          isVisible: vi.fn(async () => true),
          locator: (childSel: string) => {
            if (childSel.includes('lv-select-option') || childSel.includes('[role="option"]')) {
              return createOptionsListLocator([{ text: 'June', value: 6, owner: 'other', visible: true }]);
            }
            return dummyLoc;
          }
        };
        return unrelatedLoc;
      }
      if (state.multipleVisiblePanels && (sel.includes('.lv-select-dropdown') || sel.includes('[role="listbox"]') || sel.includes('.semi-select-option-list'))) {
        const panel = createContainerLocator('month');
        return {
          ...panel,
          count: vi.fn(async () => 2),
          first: () => panel
        };
      }
      if (state.monthAriaControls && sel.includes(state.monthAriaControls.replace(/["\\]/g, '\\$&'))) {
        return createContainerLocator('month');
      }
      if (sel.includes('birthday-month-dropdown') || (sel.includes('[role="listbox"]') && state.open === 'month')) {
        return createContainerLocator('month');
      }
      if (sel.includes('birthday-day-dropdown') || (sel.includes('[role="listbox"]') && state.open === 'day')) {
        return createContainerLocator('day');
      }
      if (sel.includes('[role="listbox"]') || sel.includes('lv-select-dropdown') || sel.includes('semi-select-option-list')) {
        if (!sel.includes('option')) {
          if (state.open === 'month') return createContainerLocator('month');
          if (state.open === 'day') return createContainerLocator('day');
          const inactiveContainerLoc: Record<string, unknown> = {
            page: () => page,
            first: () => inactiveContainerLoc,
            isVisible: vi.fn(async () => false),
            count: vi.fn(async () => 0),
            locator: () => dummyLoc
          };
          return inactiveContainerLoc;
        }
      }
      if (sel.includes('lv-select-option') || sel.includes('[role="option"]')) {
        return createOptionsListLocator(getAllDomOptions());
      }
      if (sel.includes('birthday-next') || sel.includes('button:has-text("Continue")')) {
        return continueBtnLoc;
      }
      return dummyLoc;
    })
  } as unknown as Page;

  return { page, state };
}

describe('F07-A: Signup Birthday Form Selection & Readback Verification', () => {
  const intendedBirthday: BirthdayInfo = {
    year: 1998,
    month: 7,
    monthIndex: 6,
    day: 25,
    dayIndex: 24,
    monthName: 'July'
  };

  it('selects correct options and advances to Continue when form readback matches intended', async () => {
    const { page, state } = createBirthdayTestPage();
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('AFTER_BIRTHDAY_CONTINUE_SENTINEL');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.selectedYear).toBe('1998');
      expect(state.selectedMonth).toBe(7);
      expect(state.selectedDay).toBe(25);
      expect(state.continueClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with SIGNUP_BIRTHDAY_READBACK_MISMATCH and zero Continue clicks if Year differs intended', async () => {
    const { page, state } = createBirthdayTestPage({ failYearFill: true });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('SIGNUP_BIRTHDAY_READBACK_MISMATCH');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails and zero Continue clicks if target Month option is missing', async () => {
    // Remove July from month options
    const monthsWithoutJuly = MONTH_NAMES.filter(m => m !== 'July').map((name, i) => ({ text: name, value: i + 1 }));
    const { page, state } = createBirthdayTestPage({ monthOptions: monthsWithoutJuly });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects intended Month even when options are reordered or have decoys', async () => {
    // Reverse month options + decoy at first position
    const reorderedMonths: MockOption[] = [
      { text: 'DECOY_FIRST', value: 999 },
      ...MONTH_NAMES.map((name, i) => ({ text: name, value: i + 1 })).reverse()
    ];
    const { page, state } = createBirthdayTestPage({ monthOptions: reorderedMonths });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('AFTER_BIRTHDAY_CONTINUE_SENTINEL');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.selectedMonth).toBe(7);
      expect(state.continueClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Stop during selected-value read rejects with original reason', async () => {
    let releaseRead!: (v: string) => void;
    const deferredRead = new Promise<string>(r => { releaseRead = r; });
    const { page, state } = createBirthdayTestPage({ deferredRead });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);
    const stopReason = new Error('STOP-BIRTHDAY-READ');

    vi.useFakeTimers();
    try {
      let settled = false;
      let rejection: unknown;
      void signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      }).then(
        () => { settled = true; },
        err => { settled = true; rejection = err; }
      );

      await vi.advanceTimersByTimeAsync(15000);
      abort.abort(stopReason);
      await vi.advanceTimersByTimeAsync(0);

      expect(settled).toBe(true);
      expect(rejection).toBe(stopReason);
      expect(state.continueClicks).toBe(0);
    } finally {
      releaseRead?.('1998');
      vi.useRealTimers();
    }
  });

  it('selects active Month option when previous hidden match and unrelated visible match exist', async () => {
    // Unrelated visible 'July' outside the dropdown, plus hidden 'July' before active 'July' in monthOptions
    const monthOptionsWithHiddenAndActive: MockOption[] = [
      { text: 'July', value: 7, visible: false, owner: 'month' }, // hidden from previous dropdown
      { text: 'July', value: 7, visible: true, owner: 'month' }    // active visible in month dropdown
    ];
    const otherOptions: MockOption[] = [
      { text: 'July', value: 999, visible: true, owner: 'other' }  // unrelated visible elsewhere on page
    ];
    const { page, state } = createBirthdayTestPage({
      monthOptions: monthOptionsWithHiddenAndActive,
      otherOptions
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('AFTER_BIRTHDAY_CONTINUE_SENTINEL');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.selectedMonth).toBe(7);
      expect(state.continueClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with SIGNUP_BIRTHDAY_MONTH_OPTION_DUPLICATE when multiple visible month matches exist', async () => {
    const monthOptionsWithDuplicates: MockOption[] = [
      { text: 'July', value: 7, visible: true, owner: 'month' },
      { text: 'July', value: 7, visible: true, owner: 'month' }
    ];
    const { page, state } = createBirthdayTestPage({
      monthOptions: monthOptionsWithDuplicates
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('SIGNUP_BIRTHDAY_MONTH_OPTION_DUPLICATE');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts during option count read and propagates original stop reason with zero Continue clicks', async () => {
    const abort = new AbortController();
    const stopReason = new Error('STOP-BIRTHDAY-COUNT');
    let releaseGate!: () => void;
    const optionCountGate = new Promise<void>(resolve => { releaseGate = resolve; });

    const { page, state } = createBirthdayTestPage({
      optionCountGate,
      onOptionCount: () => {
        abort.abort(stopReason);
        releaseGate();
      }
    });
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toBe(stopReason);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.continueClicks).toBe(0);
    } finally {
      releaseGate?.();
      vi.useRealTimers();
    }
  });

  it('fails and propagates aria-controls error without selecting or clicking Continue', async () => {
    const ariaErr = new Error('READ_ARIA_CONTROLS_FAILED');
    const { page, state } = createBirthdayTestPage({
      ariaControlsError: ariaErr
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toBe(ariaErr);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with SIGNUP_BIRTHDAY_MONTH_OWNER_AMBIGUOUS when aria-controls is null and multiple visible panels exist', async () => {
    const { page, state } = createBirthdayTestPage({
      monthAriaControls: null,
      multipleVisiblePanels: true
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('SIGNUP_BIRTHDAY_MONTH_OWNER_AMBIGUOUS');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('correctly matches dynamic ID containing special characters (colon, dot, quote) without CSS interpolation injection', async () => {
    const { page, state } = createBirthdayTestPage({
      monthAriaControls: 'panel:1.0"test'
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('AFTER_BIRTHDAY_CONTINUE_SENTINEL');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.selectedMonth).toBe(7);
      expect(state.continueClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks option clicks with owner prefix and selects intended month and day', async () => {
    const { page, state } = createBirthdayTestPage();
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('AFTER_BIRTHDAY_CONTINUE_SENTINEL');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.optionClicks).toContain('month:July');
      expect(state.optionClicks).toContain('day:25');
    } finally {
      vi.useRealTimers();
    }
  });

  it('R05 (F03): absent aria-controls + absent triggerId throws SIGNUP_BIRTHDAY_MONTH_OWNER_MISSING without clicking options', async () => {
    const { page, state } = createBirthdayTestPage({
      monthAriaControls: null,
      monthTriggerId: null,
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('SIGNUP_BIRTHDAY_MONTH_OWNER_MISSING');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.optionClicks.length).toBe(0);
      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R06 (F03): absent aria-controls + preexisting unrelated listbox panel throws SIGNUP_BIRTHDAY_MONTH_OWNER_MISSING when triggerId does not match', async () => {
    const { page, state } = createBirthdayTestPage({
      monthAriaControls: null,
      monthTriggerId: 'birthday-month-trigger-id',
      hasMonthPanel: false,
      unrelatedPanelVisible: true,
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('SIGNUP_BIRTHDAY_MONTH_OWNER_MISSING');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.optionClicks.length).toBe(0);
      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R07 (F03): absent aria-controls + panel matched via aria-labelledby containing triggerId succeeds', async () => {
    const { page, state } = createBirthdayTestPage({
      monthAriaControls: null,
      monthTriggerId: 'birthday-month-trigger-id',
      dayAriaControls: null,
      dayTriggerId: 'birthday-day-trigger-id',
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('AFTER_BIRTHDAY_CONTINUE_SENTINEL');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.selectedMonth).toBe(7);
      expect(state.selectedDay).toBe(25);
      expect(state.continueClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R08 (F03): absent aria-controls + multiple panels matching triggerId throws SIGNUP_BIRTHDAY_MONTH_OWNER_AMBIGUOUS', async () => {
    const { page, state } = createBirthdayTestPage({
      monthAriaControls: null,
      monthTriggerId: 'birthday-month-trigger-id',
      multipleVisiblePanels: true,
    });
    const abort = new AbortController();
    const ui = createDirectUiInteraction(abort.signal);

    vi.useFakeTimers();
    try {
      const running = signupCapcut(page, {} as BrowserContext, {
        email: 'test@example.com',
        password: 'Password123!'
      }, {
        ui,
        signal: abort.signal,
        birthday: intendedBirthday,
        log: () => {}
      });

      const assertion = expect(running).rejects.toThrow('SIGNUP_BIRTHDAY_MONTH_OWNER_AMBIGUOUS');
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(state.continueClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
