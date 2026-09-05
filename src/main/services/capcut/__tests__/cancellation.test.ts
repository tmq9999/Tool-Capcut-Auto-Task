import { afterEach, expect, it, vi } from 'vitest';
import { abortable, abortableDelay } from '../cancellation';

afterEach(() => vi.useRealTimers());
it('cancels the timer and unregisters its abort listener immediately', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const result = abortableDelay(60_000, controller.signal).catch((error: unknown) => error);
  controller.abort(new Error('stop'));
  expect(await result).toMatchObject({ message: 'stop' });
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalled();
});
it('unregisters a cancelled operation without waiting for its underlying promise', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const operation = abortable(new Promise(() => {}), controller.signal).catch((error: unknown) => error);
  controller.abort(new Error('stop'));
  expect(await operation).toMatchObject({ message: 'stop' });
  expect(remove).toHaveBeenCalled();
});

it('does not leave a timer when a delay is requested after Stop', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  try { await abortableDelay(60_000, controller.signal); } catch { /* expected cancellation */ }
  expect(vi.getTimerCount()).toBe(0);
});
