import type { Page } from 'playwright-core';
import { boundedDomRead, isDomReadTimeout } from './cancellation';

export interface AuthFinalState {
  kind: 'workspace' | 'auth-form' | 'public-landing' | 'other' | 'unreadable';
  path: string;
  workspaceMarker: boolean;
  authFormVisible: boolean;
  publicLandingVisible: boolean;
}


export function classifyAuthUrl(rawUrl: string): { allowedOrigin: boolean; pathname: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.origin !== 'https://www.capcut.com') {
      return { allowedOrigin: false, pathname: '' };
    }
    return { allowedOrigin: true, pathname: parsed.pathname || '/' };
  } catch {
    return { allowedOrigin: false, pathname: '' };
  }
}

export function readAuthDocument(doc: Document) {
  const view = doc.defaultView;
  const visible = (el: Element): boolean => {
    if (!view || el.closest('[hidden], [inert]')) return false;
    const style = view.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      el.getClientRects().length > 0
    );
  };
  const any = (selector: string, text?: RegExp): boolean =>
    Array.from(doc.querySelectorAll(selector)).some(
      (el) => visible(el) && (!text || text.test(el.textContent ?? ''))
    );
  const authPanel = any('.lv_sign_in_panel_wide');
  const passwordOrCode = any(
    'input[type="password"], input[name*="code" i], input[maxlength="6"]'
  );
  const authEmail = Array.from(doc.querySelectorAll('form, [role="dialog"]')).some((owner) => {
    if (
      !visible(owner) ||
      !/sign in|log in|sign up|create an account|verification/i.test(owner.textContent ?? '')
    ) {
      return false;
    }
    return Array.from(owner.querySelectorAll('input[type="email"]')).some(visible);
  });
  return {
    href: view?.location.href ?? '',
    workspaceMarker:
      any('.credit-section, button[class*="credit"], [data-id="TitleBarTaskList"]') ||
      any('button', /Free credits/i),
    authFormVisible: authPanel || passwordOrCode || authEmail,
    publicLandingVisible:
      any('h1', /AI-Powered Photo & Video Editor|^CapCut$/i) ||
      any('a[href*="/login"]', /Sign in/i) ||
      any('a[href*="/signup"]')
  };
}

export async function readAuthFinalState(page: Page, signal: AbortSignal): Promise<AuthFinalState> {
  signal.throwIfAborted();

  let epoch = 0;
  const mainFrame = typeof page.mainFrame === 'function' ? page.mainFrame() : null;
  const onNavigation = (frame: import('playwright-core').Frame): void => {
    if (!mainFrame || frame === mainFrame) epoch += 1;
  };

  if (typeof page.on === 'function') {
    page.on('framenavigated', onNavigation);
  }

  try {
    const before = epoch;
    if (typeof page.evaluateHandle !== 'function') {
      // Fallback for mock pages in unit tests that only mock locator
      let rawUrl = '';
      try {
        rawUrl = page.url();
      } catch {
        return {
          kind: 'unreadable',
          path: '',
          workspaceMarker: false,
          authFormVisible: false,
          publicLandingVisible: false
        };
      }
      const { allowedOrigin, pathname } = classifyAuthUrl(rawUrl);
      if (!allowedOrigin) {
        return {
          kind: 'other',
          path: '',
          workspaceMarker: false,
          authFormVisible: false,
          publicLandingVisible: false
        };
      }
      let readFailed = false;
      const workspaceMarker = await boundedDomRead(
        async () => {
          const marker = page.locator(
            'button:has-text("Free credits"), .credit-section, button[class*="credit"], [data-id="TitleBarTaskList"]'
          ).first();
          return await marker.isVisible({ timeout: 2000 });
        },
        'auth-state:workspace-marker',
        3000,
        signal
      ).catch((err: unknown) => {
        signal.throwIfAborted();
        if (isDomReadTimeout(err)) throw err;
        readFailed = true;
        return false;
      });

      const authFormVisible = await boundedDomRead(
        async () => {
          const authForm = page.locator(
            'input[type="password"], input[name*="code" i], input[maxlength="6"], input[type="email"], .lv_sign_in_panel_wide'
          ).first();
          return await authForm.isVisible({ timeout: 1500 });
        },
        'auth-state:auth-form',
        2500,
        signal
      ).catch((err: unknown) => {
        signal.throwIfAborted();
        if (isDomReadTimeout(err)) throw err;
        readFailed = true;
        return false;
      });

      const publicLandingVisible = await boundedDomRead(
        async () => {
          const landing = page.locator(
            'h1:has-text("AI-Powered Photo & Video Editor"), h1:has-text("CapCut"), a[href*="/login"]:has-text("Sign in"), a[href*="/signup"]'
          ).first();
          return await landing.isVisible({ timeout: 1500 });
        },
        'auth-state:public-landing',
        2500,
        signal
      ).catch((err: unknown) => {
        signal.throwIfAborted();
        if (isDomReadTimeout(err)) throw err;
        readFailed = true;
        return false;
      });

      if (readFailed) {
        return {
          kind: 'unreadable',
          path: pathname,
          workspaceMarker,
          authFormVisible,
          publicLandingVisible
        };
      }

      let kind: AuthFinalState['kind'];
      if (authFormVisible) {
        kind = 'auth-form';
      } else if (workspaceMarker) {
        kind = 'workspace';
      } else if (publicLandingVisible) {
        kind = 'public-landing';
      } else {
        kind = 'other';
      }

      return {
        kind,
        path: pathname,
        workspaceMarker,
        authFormVisible,
        publicLandingVisible
      };
    }

    const acquiring = page.evaluateHandle(() => document);
    let owner: Awaited<typeof acquiring>;
    try {
      owner = await boundedDomRead(() => acquiring, 'auth-state:document', 3000, signal);
    } catch (error: unknown) {
      void acquiring
        .then((handle) =>
          boundedDomRead(() => handle.dispose(), 'auth-state:late-dispose', 1000, signal)
        )
        .catch(() => undefined);
      signal.throwIfAborted();
      if (isDomReadTimeout(error)) throw error;
      return {
        kind: 'unreadable',
        path: '',
        workspaceMarker: false,
        authFormVisible: false,
        publicLandingVisible: false
      };
    }

    try {
      const facts = await boundedDomRead(
        () => owner.evaluate(readAuthDocument),
        'auth-state:facts',
        3000,
        signal
      );
      const same = await boundedDomRead(
        () => page.evaluate((doc) => doc === document, owner),
        'auth-state:document-current',
        3000,
        signal
      );

      signal.throwIfAborted();

      if (!same || before !== epoch) {
        return {
          kind: 'unreadable',
          path: '',
          workspaceMarker: false,
          authFormVisible: false,
          publicLandingVisible: false
        };
      }

      const location = classifyAuthUrl(facts.href);
      if (!location.allowedOrigin) {
        return {
          kind: 'other',
          path: '',
          workspaceMarker: false,
          authFormVisible: false,
          publicLandingVisible: false
        };
      }

      const kind = facts.authFormVisible
        ? 'auth-form'
        : facts.workspaceMarker
          ? 'workspace'
          : facts.publicLandingVisible
            ? 'public-landing'
            : 'other';

      return {
        kind,
        path: location.pathname,
        workspaceMarker: facts.workspaceMarker,
        authFormVisible: facts.authFormVisible,
        publicLandingVisible: facts.publicLandingVisible
      };
    } catch (error: unknown) {
      signal.throwIfAborted();
      if (isDomReadTimeout(error)) throw error;
      return {
        kind: 'unreadable',
        path: '',
        workspaceMarker: false,
        authFormVisible: false,
        publicLandingVisible: false
      };
    } finally {
      await boundedDomRead(() => owner.dispose(), 'auth-state:dispose', 1000, signal).catch(
        () => undefined
      );
    }
  } finally {
    if (typeof page.off === 'function') {
      page.off('framenavigated', onNavigation);
    }
  }
}

export function hasAuthenticatedWorkspace(state: AuthFinalState): boolean {
  return (
    state.kind === 'workspace' &&
    state.workspaceMarker &&
    !state.authFormVisible &&
    !state.publicLandingVisible
  );
}
