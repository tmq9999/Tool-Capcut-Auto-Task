import type { BrowserContext, Page } from 'playwright-core';

interface CookieRow { associatedCookies?: Array<{ blockedReasons?: unknown[]; cookie?: {
  name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite?: 'Strict' | 'Lax' | 'None';
} }> }

export async function restoreCapturedCookies(context: BrowserContext, rows: CookieRow[]): Promise<void> {
  const cookies = new Map();
  for (const row of rows) for (const entry of row.associatedCookies ?? []) {
    const c = entry.cookie;
    if (!c || !/(^|\.)capcut\.com$/.test(c.domain.replace(/^\./,'')) || entry.blockedReasons?.length) continue;
    cookies.set(c.domain + ':' + c.path + ':' + c.name, { name:c.name, value:c.value, domain:c.domain, path:c.path,
      expires:c.expires > 0 ? c.expires : -1, httpOnly:c.httpOnly, secure:c.secure, ...(c.sameSite ? {sameSite:c.sameSite} : {}) });
  }
  if (!cookies.size) throw new Error('ACCOUNT_COOKIES_UNAVAILABLE');
  await context.addCookies([...cookies.values()]);
}

/** Runs web-session HTTP, not a DOM action or request replay. Returns bounded SSE evidence. */
export async function sendDesignInBrowser(page: Page, wire: { url: string; headers: Record<string,string>; body: string }) {
  const target = new URL(wire.url);
  if (target.origin !== 'https://edit-api-sg.capcut.com' || target.pathname !== '/lv/v2/intelligence/thread/run/start') throw new Error('DESIGN_ORIGIN_REJECTED');
  // Captured anti-replay values must not be transplanted to a different body.
  for (const key of ['msToken','X-Bogus','X-Gnarly']) target.searchParams.delete(key);
  const headers: Record<string,string> = {};
  for (const [k,v] of Object.entries(wire.headers)) if (!['cookie','user-agent','referer','origin','sign','content-length','host'].includes(k.toLowerCase())) headers[k] = v;
  return page.evaluate(async ({ url, headers, body }) => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    let status = 0; let mime = ''; let raw = ''; let timedOut = false;
    try {
      const response = await fetch(url, { method:'POST', headers, body, credentials:'include', redirect:'error', signal:controller.signal });
      status = response.status; mime = response.headers.get('content-type') ?? '';
      if (!response.body) throw new Error('DESIGN_RESPONSE_MISSING');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength; if (bytes > 2*1024*1024) throw new Error('DESIGN_RESPONSE_LIMIT');
          raw += decoder.decode(part.value, {stream:true});
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch {
      if (controller.signal.aborted) timedOut = true;
      else throw new Error('DESIGN_BROWSER_HTTP_OUTCOME_UNKNOWN');
    } finally { clearTimeout(timer); }
    return { status, mime, raw, timedOut };
  }, { url: target.toString(), headers, body:wire.body });
}
