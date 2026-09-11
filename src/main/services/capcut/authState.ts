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

export async function readAuthFinalState(page: Page, signal: AbortSignal): Promise<AuthFinalState> {
  signal.throwIfAborted();
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

  // 1. Workspace marker: actual in-app UI element (recognized controls, no arbitrary avatar)
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

  // 2. Auth form visible: password / code / email inputs or login panel
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

  // 3. Public landing visible: public landing headline, hero or marketing elements
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

  // Classify based on marker facts:
  // Positive auth form has precedence over generic workspace controls
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

export function hasAuthenticatedWorkspace(state: AuthFinalState): boolean {
  return (
    state.kind === 'workspace' &&
    state.workspaceMarker &&
    !state.authFormVisible &&
    !state.publicLandingVisible
  );
}
