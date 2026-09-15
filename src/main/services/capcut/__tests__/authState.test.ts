import { describe, it, expect, vi } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import {
  readAuthFinalState,
  classifyAuthUrl,
  hasAuthenticatedWorkspace,
  readAuthDocument
} from '../authState';

function createMockLocator(visible = false): Locator {
  const loc: Record<string, unknown> = {
    first: () => loc as unknown as Locator,
    isVisible: vi.fn().mockResolvedValue(visible),
    count: vi.fn().mockResolvedValue(visible ? 1 : 0),
    page: () => ({} as Page)
  };
  return loc as unknown as Locator;
}

function computeFactsFromLocatorMap(url: string, locatorMap: Record<string, boolean>) {
  const authFormVisible = Object.entries(locatorMap).some(
    ([k, v]) =>
      v &&
      (k.includes('password') ||
        k.includes('lv_sign_in_panel_wide') ||
        k.includes('code') ||
        k.includes('email') ||
        k.includes('sign_in'))
  );
  const workspaceMarker = Object.entries(locatorMap).some(
    ([k, v]) =>
      v &&
      (k.includes('credit') ||
        k.includes('Free credits') ||
        k.includes('TitleBarTaskList'))
  );
  const publicLandingVisible = Object.entries(locatorMap).some(
    ([k, v]) =>
      v &&
      (k.includes('Photo & Video') ||
        k.includes('CapCut') ||
        k.includes('Sign in') ||
        k.includes('/signup'))
  );
  return {
    href: url,
    workspaceMarker,
    authFormVisible,
    publicLandingVisible
  };
}

function createMockPage(
  url: string,
  locatorMap: Record<string, boolean> = {},
  options: {
    documentSame?: boolean;
    simulateNavigationDuringRead?: boolean;
    throwOnAcquire?: Error;
    throwOnEvaluate?: Error;
    customFacts?: Partial<ReturnType<typeof computeFactsFromLocatorMap>>;
  } = {}
): Page & { triggerNavigation: () => void } {
  const mainFrame = { id: 'main-frame' };
  const navListeners = new Set<(frame: unknown) => void>();

  const triggerNavigation = () => {
    for (const listener of navListeners) {
      listener(mainFrame);
    }
  };

  const handle = {
    evaluate: vi.fn(async (fn: unknown) => {
      if (options.throwOnEvaluate) throw options.throwOnEvaluate;
      if (options.simulateNavigationDuringRead) {
        triggerNavigation();
      }
      if (typeof fn === 'function') {
        const computed = computeFactsFromLocatorMap(url, locatorMap);
        return { ...computed, ...options.customFacts };
      }
      return computeFactsFromLocatorMap(url, locatorMap);
    }),
    dispose: vi.fn().mockResolvedValue(undefined)
  };

  const page = {
    url: vi.fn().mockReturnValue(url),
    mainFrame: vi.fn().mockReturnValue(mainFrame),
    on: vi.fn((event: string, cb: (frame: unknown) => void) => {
      if (event === 'framenavigated') navListeners.add(cb);
    }),
    off: vi.fn((event: string, cb: (frame: unknown) => void) => {
      if (event === 'framenavigated') navListeners.delete(cb);
    }),
    evaluateHandle: vi.fn(async () => {
      if (options.throwOnAcquire) throw options.throwOnAcquire;
      return handle;
    }),
    evaluate: vi.fn(async (fn: unknown, arg?: unknown) => {
      if (typeof fn === 'function' && arg === handle) {
        return options.documentSame !== undefined ? options.documentSame : true;
      }
      return true;
    }),
    locator: vi.fn((sel: string) => {
      for (const [key, isVis] of Object.entries(locatorMap)) {
        if (sel.includes(key)) return createMockLocator(isVis);
      }
      return createMockLocator(false);
    }),
    triggerNavigation
  } as unknown as Page & { triggerNavigation: () => void };

  return page;
}

describe('authState', () => {
  describe('classifyAuthUrl', () => {
    it('recognizes allowed capcut origins', () => {
      expect(classifyAuthUrl('https://www.capcut.com/my-edit')).toEqual({
        allowedOrigin: true,
        pathname: '/my-edit'
      });
      expect(classifyAuthUrl('https://www.capcut.com/')).toEqual({
        allowedOrigin: true,
        pathname: '/'
      });
    });

    it('flags external origins with empty pathname', () => {
      expect(classifyAuthUrl('https://google.com/search')).toEqual({
        allowedOrigin: false,
        pathname: ''
      });
      expect(classifyAuthUrl('https://edit-api-sg.capcut.com/workspace')).toEqual({
        allowedOrigin: false,
        pathname: ''
      });
    });
  });

  describe('readAuthFinalState', () => {
    it('does not invent public landing from an empty root document', async () => {
      const state = await readAuthFinalState(
        createMockPage('https://www.capcut.com/', {}),
        new AbortController().signal
      );
      expect(state.publicLandingVisible).toBe(false);
      expect(state.kind).toBe('other');
    });

    it('keeps a failed marker read distinct from confirmed absence', async () => {
      const page = createMockPage('https://www.capcut.com/', {}, {
        throwOnEvaluate: new Error('READ_FIXTURE')
      });
      const state = await readAuthFinalState(page, new AbortController().signal);
      expect(state.kind).toBe('unreadable');
    });

    it('classifies public landing with no auth form as public-landing', async () => {
      const page = createMockPage('https://www.capcut.com/', {
        'AI-Powered Photo & Video Editor': true
      });
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state).toEqual({
        kind: 'public-landing',
        path: '/',
        workspaceMarker: false,
        authFormVisible: false,
        publicLandingVisible: true
      });
    });

    it('does not classify /my-edit as workspace if marker is false', async () => {
      const page = createMockPage('https://www.capcut.com/my-edit', {});
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state.workspaceMarker).toBe(false);
      expect(state.kind).not.toBe('workspace');
      expect(state.kind).toBe('other');
    });

    it('classifies active auth form as auth-form', async () => {
      const page = createMockPage('https://www.capcut.com/login', {
        password: true
      });
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state).toEqual({
        kind: 'auth-form',
        path: '/login',
        workspaceMarker: false,
        authFormVisible: true,
        publicLandingVisible: false
      });
    });

    it('classifies workspace when actual workspace marker is visible', async () => {
      const page = createMockPage('https://www.capcut.com/my-edit', {
        'Free credits': true
      });
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state).toEqual({
        kind: 'workspace',
        path: '/my-edit',
        workspaceMarker: true,
        authFormVisible: false,
        publicLandingVisible: false
      });
    });

    it('rethrows abort error when signal is already aborted or aborted in-flight', async () => {
      const page = createMockPage('https://www.capcut.com/my-edit', {});
      const controller = new AbortController();
      controller.abort(new Error('STOP_AUTH_READ'));
      await expect(readAuthFinalState(page, controller.signal)).rejects.toThrow('STOP_AUTH_READ');
    });

    it('returns unreadable when page.evaluateHandle throws', async () => {
      const page = createMockPage('https://www.capcut.com/', {}, {
        throwOnAcquire: new Error('Target closed')
      });
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state).toEqual({
        kind: 'unreadable',
        path: '',
        workspaceMarker: false,
        authFormVisible: false,
        publicLandingVisible: false
      });
    });

    it('returns other with empty path when origin is external', async () => {
      const page = createMockPage('https://example.com/other', {});
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state).toEqual({
        kind: 'other',
        path: '',
        workspaceMarker: false,
        authFormVisible: false,
        publicLandingVisible: false
      });
    });

    it('R01 (F01): does not classify as workspace when hidden first input precedes visible auth panel', async () => {
      const page = createMockPage('https://www.capcut.com/my-edit', {
        'Free credits': true,
        'password': false,
        'lv_sign_in_panel_wide': true
      });
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state.authFormVisible).toBe(true);
      expect(state.kind).toBe('auth-form');
    });

    it('R02 (F01): returns unreadable when navigation occurs during document read', async () => {
      const page = createMockPage('https://www.capcut.com/my-edit', {
        'Free credits': true
      }, {
        simulateNavigationDuringRead: true
      });
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state.kind).toBe('unreadable');
    });

    it('R02-B (F01): returns unreadable when document is replaced during read (doc !== document)', async () => {
      const page = createMockPage('https://www.capcut.com/my-edit', {
        'Free credits': true
      }, {
        documentSame: false
      });
      const signal = new AbortController().signal;
      const state = await readAuthFinalState(page, signal);
      expect(state.kind).toBe('unreadable');
    });
  });

  describe('readAuthDocument direct DOM tests', () => {
    function createMockElement(opts: {
      tagName?: string;
      className?: string;
      type?: string;
      textContent?: string;
      hidden?: boolean;
      inert?: boolean;
      display?: string;
      visibility?: string;
      hasRect?: boolean;
      children?: unknown[];
    }) {
      const el: Record<string, unknown> = {
        tagName: (opts.tagName ?? 'div').toUpperCase(),
        className: opts.className ?? '',
        type: opts.type ?? '',
        textContent: opts.textContent ?? '',
        display: opts.display,
        visibility: opts.visibility,
        closest: (sel: string) => {
          if (sel.includes('hidden') && opts.hidden) return el;
          if (sel.includes('inert') && opts.inert) return el;
          return null;
        },
        getClientRects: () =>
          opts.hasRect !== false ? [{ width: 100, height: 20 }] : [],
        querySelectorAll: (sel: string) => {
          const matched: unknown[] = [];
          for (const child of (opts.children ?? []) as Array<Record<string, unknown>>) {
            if (sel.includes('input[type="email"]') && child.type === 'email') {
              matched.push(child);
            }
          }
          return matched;
        }
      };
      return el;
    }

    function createMockDoc(elements: Array<Record<string, unknown>>, href = 'https://www.capcut.com/my-edit') {
      const view = {
        location: { href },
        getComputedStyle: (el: Record<string, unknown>) => ({
          display: (el.display as string) ?? 'block',
          visibility: (el.visibility as string) ?? 'visible'
        })
      };
      const doc = {
        defaultView: view,
        querySelectorAll: (sel: string) => {
          return elements.filter((el) => {
            const cls = (el.className as string) ?? '';
            const tag = (el.tagName as string) ?? '';
            const type = (el.type as string) ?? '';
            if (sel.includes('.lv_sign_in_panel_wide') && cls.includes('lv_sign_in_panel_wide')) return true;
            if (sel.includes('input[type="password"]') && type === 'password') return true;
            if (sel.includes('.credit-section') && cls.includes('credit-section')) return true;
            if (sel.includes('button') && tag === 'BUTTON') return true;
            if (sel.includes('h1') && tag === 'H1') return true;
            if (sel.includes('form') && tag === 'FORM') return true;
            return false;
          });
        }
      } as unknown as Document;
      return doc;
    }

    it('ignores hidden elements when detecting auth panel and workspace', () => {
      const hiddenPassword = createMockElement({ type: 'password', hidden: true });
      const hiddenCredit = createMockElement({ className: 'credit-section', display: 'none' });
      const doc = createMockDoc([hiddenPassword, hiddenCredit]);
      const facts = readAuthDocument(doc);
      expect(facts.authFormVisible).toBe(false);
      expect(facts.workspaceMarker).toBe(false);
    });

    it('detects visible auth panel even when an earlier element is hidden', () => {
      const hiddenPassword = createMockElement({ type: 'password', hidden: true });
      const visiblePanel = createMockElement({ className: 'lv_sign_in_panel_wide' });
      const visibleCredit = createMockElement({ className: 'credit-section' });
      const doc = createMockDoc([hiddenPassword, visiblePanel, visibleCredit]);
      const facts = readAuthDocument(doc);
      expect(facts.authFormVisible).toBe(true);
      expect(facts.workspaceMarker).toBe(true);
    });

    it('does not classify newsletter email form as auth form', () => {
      const emailInput = createMockElement({ type: 'email' });
      const newsletterForm = createMockElement({
        tagName: 'form',
        textContent: 'Subscribe to our newsletter for weekly updates',
        children: [emailInput]
      });
      const visibleCredit = createMockElement({ className: 'credit-section' });
      const doc = createMockDoc([newsletterForm, visibleCredit]);
      const facts = readAuthDocument(doc);
      expect(facts.authFormVisible).toBe(false);
      expect(facts.workspaceMarker).toBe(true);
    });

    it('classifies login form with email input as auth form', () => {
      const emailInput = createMockElement({ type: 'email' });
      const loginForm = createMockElement({
        tagName: 'form',
        textContent: 'Log in to CapCut or Sign up',
        children: [emailInput]
      });
      const doc = createMockDoc([loginForm]);
      const facts = readAuthDocument(doc);
      expect(facts.authFormVisible).toBe(true);
    });
  });

  describe('hasAuthenticatedWorkspace', () => {
    it('returns true only when workspace marker is true and no conflicting auth form or landing is visible', () => {
      expect(
        hasAuthenticatedWorkspace({
          kind: 'workspace',
          path: '/my-edit',
          workspaceMarker: true,
          authFormVisible: false,
          publicLandingVisible: false
        })
      ).toBe(true);

      expect(
        hasAuthenticatedWorkspace({
          kind: 'workspace',
          path: '/my-edit',
          workspaceMarker: true,
          authFormVisible: true,
          publicLandingVisible: false
        })
      ).toBe(false);

      expect(
        hasAuthenticatedWorkspace({
          kind: 'auth-form',
          path: '/my-edit',
          workspaceMarker: false,
          authFormVisible: true,
          publicLandingVisible: false
        })
      ).toBe(false);

      expect(
        hasAuthenticatedWorkspace({
          kind: 'other',
          path: '/my-edit',
          workspaceMarker: false,
          authFormVisible: false,
          publicLandingVisible: false
        })
      ).toBe(false);
    });
  });
});
