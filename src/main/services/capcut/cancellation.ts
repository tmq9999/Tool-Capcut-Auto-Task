export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  // The caller may have already started an operation before noticing Stop.
  void operation.catch(() => undefined);
  signal.throwIfAborted();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([operation, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const operation = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  const result = abortable(operation, signal);
  return result.finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

export class OperationDeadlineError extends Error {
  constructor() { super('Operation deadline exceeded'); }
}

export class DomReadTimeoutError extends Error {
  readonly code = 'DOM_READ_TIMEOUT';
  constructor(stage: string) { super('DOM_READ_TIMEOUT: ' + stage); }
}

export function isDomReadTimeout(error: unknown): error is DomReadTimeoutError {
  return error instanceof DomReadTimeoutError ||
    (error instanceof Error && (error as { code?: unknown }).code === 'DOM_READ_TIMEOUT');
}

/** A timeout abandons the wait, not the browser command. Do not retry it blindly. */
export async function boundedDomRead<T>(
  read: () => Promise<T>, stage: string, timeoutMs = 1000, signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  try {
    return await withinDeadline(read(), timeoutMs, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof OperationDeadlineError) throw new DomReadTimeoutError(stage);
    throw error;
  }
}

/** Bounds a read/teardown promise; resource-creating calls must keep ownership. */
export async function withinDeadline<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OperationDeadlineError()), Math.max(0, timeoutMs));
  });
  const bounded = Promise.race([operation, timeout]);
  try {
    return await (signal ? abortable(bounded, signal) : bounded);
  } finally {
    clearTimeout(timer);
  }
}
