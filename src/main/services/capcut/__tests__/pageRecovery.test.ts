import { describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { PrimaryPageResolver } from '../pageRecovery';
import { URLS } from '../urls';

type TestPage = Page & {
  closed: boolean;
  gotoCalls: string[];
  observedEvents: string[];
  emitTest(event: 'close' | 'crash'): void;
};

type TestContext = BrowserContext & {
  newPageCalls: number;
};

function fakePage(initialUrl: string, initiallyClosed: boolean): TestPage {
  let currentUrl = initialUrl;
  const listeners = new Map<string, Array<() => void>>();
  const page = {
    closed: initiallyClosed,
    gotoCalls: [] as string[],
    observedEvents: [] as string[],
    isClosed: () => page.closed,
    url: () => currentUrl,
    on: (event: string, listener: () => void) => {
      page.observedEvents.push(event);
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return page;
    },
    off: (event: string, listener: () => void) => {
      const list = listeners.get(event) ?? [];
      listeners.set(event, list.filter((l) => l !== listener));
      return page;
    },
    emitTest: (event: 'close' | 'crash') => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    goto: async (url: string) => {
      currentUrl = url;
      page.gotoCalls.push(url);
      return null;
    }
  };
  return page as unknown as TestPage;
}

function fakeContext(initialPages: TestPage[]): TestContext {
  const pages = [...initialPages];
  const context = {
    newPageCalls: 0,
    pages: () => [...pages],
    newPage: async () => {
      context.newPageCalls += 1;
      const page = fakePage('about:blank', false);
      pages.push(page);
      return page;
    }
  };
  return context as unknown as TestContext;
}

describe('PrimaryPageResolver', () => {
  it('reuses the newest open capcut page before creating one', async () => {
    const closedMain = fakePage('https://www.capcut.com/my-edit', true);
    const otherSite = fakePage('https://example.com', false);
    const capcut = fakePage('https://www.capcut.com/ai-design', false);
    const context = fakeContext([closedMain, otherSite, capcut]);
    const resolver = new PrimaryPageResolver(context, closedMain, () => {});

    await expect(resolver.resolve('trial')).resolves.toBe(capcut);
    expect(context.newPageCalls).toBe(0);
  });

  it('creates and navigates at most one replacement page', async () => {
    const initial = fakePage('https://www.capcut.com/my-edit', true);
    const context = fakeContext([initial]);
    const resolver = new PrimaryPageResolver(context, initial, () => {});

    const replacement = await resolver.resolve('mission:PWA') as TestPage;
    expect(context.newPageCalls).toBe(1);
    expect(replacement.gotoCalls).toEqual([URLS.main]);

    replacement.closed = true;
    await expect(resolver.resolve('mission:Design Studio')).rejects.toThrow(
      'Tab CapCut chính đã đóng lần thứ hai'
    );
    expect(context.newPageCalls).toBe(1);
  });

  it('treats a crashed current page as unusable even before isClosed changes', async () => {
    const crashed = fakePage('https://www.capcut.com/my-edit', false);
    const context = fakeContext([crashed]);
    const resolver = new PrimaryPageResolver(context, crashed, () => {});

    crashed.emitTest('crash');
    const replacement = await resolver.resolve('trial') as TestPage;

    expect(replacement).not.toBe(crashed);
    expect(context.newPageCalls).toBe(1);
    expect(replacement.gotoCalls).toEqual([URLS.main]);
  });

  it('P04: suppresses close warning when isExpectedClose returns true but still marks page unusable', async () => {
    const logs: string[] = [];
    const initial = fakePage('https://www.capcut.com/my-edit', false);
    const backup = fakePage('https://www.capcut.com/my-edit', false);
    const context = fakeContext([initial, backup]);
    const stopRequested = true;
    const resolver = new PrimaryPageResolver(
      context,
      initial,
      (msg) => logs.push(msg),
      { isExpectedClose: () => stopRequested }
    );

    initial.emitTest('close');
    expect(logs).toEqual([]);

    // Page must still be marked unusable, so resolving gives backup page
    const next = await resolver.resolve('next');
    expect(next).toBe(backup);
  });

  it('P04: logs close warning when isExpectedClose returns false', async () => {
    const logs: string[] = [];
    const initial = fakePage('https://www.capcut.com/my-edit', false);
    const context = fakeContext([initial]);
    const resolver = new PrimaryPageResolver(
      context,
      initial,
      (msg) => logs.push(msg),
      { isExpectedClose: () => false }
    );

    initial.emitTest('close');
    expect(logs).toEqual(['Tab CapCut chính vừa đóng.']);
    expect(resolver).toBeDefined();
  });

  it('P04: always logs crash warning even if isExpectedClose returns true', async () => {
    const logs: string[] = [];
    const initial = fakePage('https://www.capcut.com/my-edit', false);
    const context = fakeContext([initial]);
    const resolver = new PrimaryPageResolver(
      context,
      initial,
      (msg) => logs.push(msg),
      { isExpectedClose: () => true }
    );

    initial.emitTest('crash');
    expect(logs).toEqual(['Tab CapCut chính vừa crash.']);
    expect(resolver).toBeDefined();
  });

  it('P04: dispose detaches listeners and prevents subsequent warnings', async () => {
    const logs: string[] = [];
    const initial = fakePage('https://www.capcut.com/my-edit', false);
    const context = fakeContext([initial]);
    const resolver = new PrimaryPageResolver(
      context,
      initial,
      (msg) => logs.push(msg),
      { isExpectedClose: () => false }
    );

    resolver.dispose();
    initial.emitTest('close');
    initial.emitTest('crash');
    expect(logs).toEqual([]);
  });
});
