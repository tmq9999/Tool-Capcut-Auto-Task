import { describe, it, expect, vi } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import { readAuthFinalState, classifyAuthUrl, hasAuthenticatedWorkspace } from '../authState';

function createMockLocator(visible = false): Locator {
  const loc: Record<string, unknown> = {
    first: () => loc as unknown as Locator,
    isVisible: vi.fn().mockResolvedValue(visible),
    count: vi.fn().mockResolvedValue(visible ? 1 : 0),
    page: () => ({} as Page)
  };
  return loc as unknown as Locator;
}

function createMockPage(url: string, locatorMap: Record<string, boolean> = {}): Page {
  const page = {
    url: vi.fn().mockReturnValue(url),
    locator: vi.fn((sel: string) => {
      for (const [key, isVis] of Object.entries(locatorMap)) {
        if (sel.includes(key)) return createMockLocator(isVis);
      }
      return createMockLocator(false);
    })
  } as unknown as Page;
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
      const page = createMockPage('https://www.capcut.com/', {});
      page.locator = vi.fn(() => {
        const locator = createMockLocator();
        locator.isVisible = vi.fn(async () => { throw new Error('READ_FIXTURE'); });
        return locator;
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

    it('returns unreadable when page.url() throws', async () => {
      const page = {
        url: vi.fn(() => { throw new Error('Target closed'); }),
        locator: vi.fn(() => createMockLocator(false))
      } as unknown as Page;
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
  });

  describe('hasAuthenticatedWorkspace', () => {
    it('returns true only when workspace marker is true and no conflicting auth form or landing is visible', () => {
      expect(hasAuthenticatedWorkspace({
        kind: 'workspace',
        path: '/my-edit',
        workspaceMarker: true,
        authFormVisible: false,
        publicLandingVisible: false
      })).toBe(true);

      expect(hasAuthenticatedWorkspace({
        kind: 'workspace',
        path: '/my-edit',
        workspaceMarker: true,
        authFormVisible: true,
        publicLandingVisible: false
      })).toBe(false);

      expect(hasAuthenticatedWorkspace({
        kind: 'auth-form',
        path: '/my-edit',
        workspaceMarker: false,
        authFormVisible: true,
        publicLandingVisible: false
      })).toBe(false);

      expect(hasAuthenticatedWorkspace({
        kind: 'other',
        path: '/my-edit',
        workspaceMarker: false,
        authFormVisible: false,
        publicLandingVisible: false
      })).toBe(false);
    });
  });
});
