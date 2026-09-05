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

/** Bounds a read/teardown promise; resource-creating calls must keep ownership. */
export async function withinDeadline<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Operation deadline exceeded')), Math.max(0, timeoutMs));
  });
  const bounded = Promise.race([operation, timeout]);
  try {
    return await (signal ? abortable(bounded, signal) : bounded);
  } finally {
    clearTimeout(timer);
  }
}
