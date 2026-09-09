import type { Page } from 'playwright-core';

const FIXTURE_URL = 'http://127.0.0.1/offline-fixture';
const CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Serve captured markup from memory, with no network or captured script execution. */
export async function loadOfflineFixture(page: Page, html: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await page.route('**/*', async (route) => {
    if (route.request().url() !== FIXTURE_URL || route.request().method() !== 'GET') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'content-security-policy': CSP },
      body: html
    });
  });
  signal?.throwIfAborted();
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  signal?.throwIfAborted();
}
