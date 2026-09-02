import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright-core';
import { FetchHttpClient } from '../HttpClient';
import { MultiloginProvider } from '../MultiloginProvider';
import { isFlagOn, mask, readEnv, report, skipNotice } from './liveEnv';

/**
 * Proves a Multilogin quick profile is really drivable: start it, discover its
 * remote-debugging port from the launcher statuses, attach Playwright over CDP,
 * navigate, then stop ONLY that profile.
 *
 * Run with: npm run verify:providers   (needs VERIFY_MULTILOGIN_CDP=1)
 */
const http = new FetchHttpClient();

async function resolveToken(provider: MultiloginProvider): Promise<string | null> {
  const email = readEnv('MULTILOGIN_EMAIL');
  const password = readEnv('MULTILOGIN_PASSWORD');
  const refreshToken = readEnv('MULTILOGIN_REFRESH_TOKEN');
  const accessToken = readEnv('MULTILOGIN_ACCESS_TOKEN');
  const automationToken = readEnv('MULTILOGIN_AUTOMATION_TOKEN');

  if (email && password) return (await provider.signIn(email, password)).token;
  if (email && refreshToken) return (await provider.refreshTokens(email, refreshToken)).token;
  if (accessToken) return accessToken;
  return automationToken;
}

async function waitForPort(
  provider: MultiloginProvider,
  token: string,
  profileId: string,
  timeoutMs: number
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statuses = await provider.getQuickProfileStatuses(token);
    const own = statuses.find((entry) => entry.profileId === profileId);
    if (own?.port) return own.port;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

describe('Multilogin CDP + Playwright (live)', () => {
  const enabled = isFlagOn('VERIFY_MULTILOGIN_CDP');

  it.skipIf(!enabled)('drives a quick profile through Playwright over CDP', async () => {
    const provider = new MultiloginProvider(http);

    const token = await resolveToken(provider);
    expect(token).not.toBeNull();
    report('Auth', 'token ' + mask(token as string));

    // Headed + an automation type: the launcher only publishes a
    // remote-debugging port when the profile is started for automation.
    const profile = await provider.startQuickProfile(token as string, {
      isHeadless: false,
      automation: 'playwright'
    });
    report('Quick profile', profile.profileId + ' (' + profile.browserType + ', automation=playwright)');

    let attachedPort: number | null = null;
    try {
      attachedPort = await waitForPort(provider, token as string, profile.profileId, 60_000);
      report('Debug port', attachedPort === null ? 'KHONG lay duoc' : String(attachedPort));
      expect(attachedPort).not.toBeNull();

      const endpoint = 'http://127.0.0.1:' + attachedPort;

      const version = await (await fetch(endpoint + '/json/version')).json() as Record<string, string>;
      report('CDP /json/version', (version.Browser ?? '?') + ' | ws ' + (version.webSocketDebuggerUrl ? 'co' : 'khong'));
      expect(typeof version.Browser).toBe('string');

      const browser = await chromium.connectOverCDP(endpoint);
      try {
        report('Playwright', 'connectOverCDP OK, contexts ' + browser.contexts().length);
        expect(browser.contexts().length).toBeGreaterThan(0);

        const context = browser.contexts()[0];
        const page = context.pages()[0] ?? (await context.newPage());

        await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const title = await page.title();
        const heading = await page.locator('h1').first().innerText();
        report('Page', 'title "' + title + '", h1 "' + heading + '"');
        expect(title.length).toBeGreaterThan(0);

        const userAgent = await page.evaluate(() => navigator.userAgent);
        report('Fingerprint UA', userAgent.slice(0, 70) + '...');
        expect(userAgent.length).toBeGreaterThan(0);
      } finally {
        // Detach only. Closing the Playwright browser here would tear down the
        // profile behind the launcher's back.
        await browser.close();
      }
    } finally {
      // Stop exactly this profile. No stop-all anywhere.
      await provider.stopProfile(token as string, profile.profileId);
      report('Stop', 'da dung rieng profile ' + profile.profileId);
    }

    const remaining = await provider.getQuickProfileStatuses(token as string);
    report('Con lai sau khi dung', String(remaining.length) + ' quick profile');
  }, 240_000);

  it.runIf(!enabled)('is skipped unless the CDP probe is enabled', () => {
    skipNotice('Multilogin CDP', 'VERIFY_MULTILOGIN_CDP=1');
    expect(enabled).toBe(false);
  });
});
