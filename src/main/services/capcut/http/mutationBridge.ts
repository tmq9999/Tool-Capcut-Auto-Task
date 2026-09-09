import type { BrowserContext, Route } from 'playwright-core';

export interface MutationBridgeOptions {
  enabled?: boolean;
  log?: (message: string) => void;
  origins?: string[];
  paths?: RegExp[];
}

const DEFAULT_ORIGINS = ['https://edit-api-sg.capcut.com', 'https://commerce-api-sg.capcut.com'];
const DEFAULT_PATHS = [
  /\/lv\/v2\/intelligence\/(thread\/create|file\/chat_upload_sign|inspiration\/check)$/,
  /\/lv\/v2\/canvas\/(save|upload_sign|cover\/update)$/,
  /\/storyboard_agent\/v1\/ai_lab\/send_msg$/,
  /\/storyboard\/v1\/studio_draft\/(create_project|submit_changeset)$/,
  /\/luckycat\/i18n\/capcut\/task\/v1\/(task_list|do_action)$/,
];

/**
 * Single-writer bridge: the page prepares the signed JSON mutation, then the
 * account-owned APIRequestContext performs it and the response is fulfilled
 * back to the page. No second request is made and no signed field is edited.
 */
export async function attachMutationBridge(context: BrowserContext, options: MutationBridgeOptions = {}): Promise<() => Promise<void>> {
  const origins = new Set(options.origins ?? DEFAULT_ORIGINS);
  const paths = options.paths ?? DEFAULT_PATHS;
  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    let url: URL;
    try { url = new URL(request.url()); } catch { return route.continue(); }
    if (!origins.has(url.origin) || !paths.some(pattern => pattern.test(url.pathname))) return route.continue();
    const body = request.postData() ?? undefined;
    const headers = request.headers();
    try {
      const response = await context.request.fetch(request.url(), {
        method: request.method(), headers, data: body, maxRedirects: 0, maxRetries: 0,
        timeout: 30_000,
      });
      options.log?.(`direct-http ${request.method()} ${url.pathname} -> ${response.status()}`);
      await route.fulfill({ response });
    } catch (error) {
      // Never fall through after dispatch: continuing would send a mutation a
      // second time. Abort the intercepted request and surface a bounded log.
      options.log?.(`direct-http ${request.method()} ${url.pathname} failed: ${error instanceof Error ? error.message : 'HTTP_ERROR'}`);
      await route.abort('failed').catch(() => {});
    }
  };
  await context.route('**/*', handler);
  return async () => { await context.unroute('**/*', handler); };
}
