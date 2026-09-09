import type { HttpOnlyClient } from './httpTypes';

export interface PollResult<T> { value: T; attempts: number; elapsedMs: number; }

function retryAfterMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Polls a read-only HTTP endpoint until a caller-defined terminal value exists. */
export async function pollHttpJob<T>(
  client: HttpOnlyClient,
  request: { path: string; body: unknown; headers?: Record<string, string>; query?: Record<string, string | number | boolean> },
  isTerminal: (data: unknown) => data is T,
  signal: AbortSignal,
  options: { deadlineMs: number; intervalMs?: number } = { deadlineMs: 240_000 }
): Promise<PollResult<T>> {
  const started = performance.now(); let attempts = 0;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('HTTP_JOB_TIMEOUT')), options.deadlineMs);
  const abort = () => deadline.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!deadline.signal.aborted) {
      signal.throwIfAborted(); attempts += 1;
      let response;
      try { response = await client.requestJson({ ...request, method: 'POST', effect: 'read', signal: deadline.signal }); }
      catch (error) { if (deadline.signal.aborted && !signal.aborted) throw new Error('HTTP_JOB_TIMEOUT'); throw error; }
      if (deadline.signal.aborted) throw new Error('HTTP_JOB_TIMEOUT');
      if (response.ok && isTerminal(response.data)) return { value: response.data, attempts, elapsedMs: performance.now() - started };
      const remaining = options.deadlineMs - (performance.now() - started);
      if (remaining <= 0) break;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const retryMs = retryAfterMs(response.headers?.['retry-after'] ?? response.headers?.['Retry-After']);
        const delay = Math.min(Math.max(options.intervalMs ?? 1000, retryMs ?? 0), remaining);
        const wait = setTimeout(() => { settled = true; deadline.signal.removeEventListener('abort', onAbort); resolve(); }, delay);
        const onAbort = () => { if (settled) return; settled = true; clearTimeout(wait); deadline.signal.removeEventListener('abort', onAbort); reject(signal.aborted ? signal.reason : new Error('HTTP_JOB_TIMEOUT')); };
        deadline.signal.addEventListener('abort', onAbort, { once: true });
        wait.unref?.();
      });
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
  throw new Error('HTTP_JOB_TIMEOUT');
}
