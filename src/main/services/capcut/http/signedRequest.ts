import type { Page, Request } from 'playwright-core';

export interface SignedRequestDraft {
  path: string;
  method: 'GET' | 'POST';
  body?: string;
  headers: Record<string, string>;
}

function materializeSignedDraft(request: Request): SignedRequestDraft {
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    throw new Error('CAPCUT_SIGNED_REQUEST_INVALID');
  }
  const method = request.method();
  if (method !== 'GET' && method !== 'POST') {
    throw new Error('CAPCUT_SIGNED_REQUEST_INVALID');
  }
  return {
    path: url.pathname + url.search,
    method,
    body: request.postData() ?? undefined,
    headers: { ...request.headers() }
  };
}

/**
 * Captures the browser's already-signed request for an operation. The browser
 * remains the signer only; the returned immutable wire request can then be
 * dispatched through the account's direct HTTP context without DOM actions.
 */
export async function captureNextSignedRequest(
  page: Page,
  predicate: (request: SignedRequestDraft) => boolean,
  trigger: () => Promise<void>,
  timeoutMs = 30_000
): Promise<SignedRequestDraft> {
  const deadline = Date.now() + timeoutMs;
  const pending = page.waitForRequest(request => {
    if (Date.now() > deadline) return false;
    try {
      const draft = materializeSignedDraft(request);
      return predicate(draft);
    } catch {
      return false;
    }
  }, { timeout: timeoutMs });
  pending.catch(() => {});
  await trigger();
  const request = await pending;
  return materializeSignedDraft(request);
}

export function assertSignedRequest(draft: SignedRequestDraft): void {
  if (!draft.path.startsWith('/') || !draft.headers['content-type']) throw new Error('CAPCUT_SIGNED_REQUEST_INVALID');
  if (/[\r\n]/.test(draft.path)) throw new Error('CAPCUT_SIGNED_REQUEST_INVALID');
  if (draft.method === 'POST' && !draft.body) throw new Error('CAPCUT_SIGNED_REQUEST_BODY_MISSING');
}
