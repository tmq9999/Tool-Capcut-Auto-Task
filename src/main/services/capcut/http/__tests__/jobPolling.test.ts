import { describe, expect, it, vi } from 'vitest';
import { pollHttpJob } from '../jobPolling';

describe('HTTP job polling', () => {
  it('polls through HTTP until terminal data', async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { status: 'processing' } })
      .mockResolvedValueOnce({ ok: true, data: { status: 'succeeded', asset: 'a1' } });
    const result = await pollHttpJob({ requestJson } as never, { path: '/job', body: { id: 'j' } }, (data): data is { status: string; asset?: string } => (data as { status?: string }).status === 'succeeded', new AbortController().signal, { deadlineMs: 100, intervalMs: 1 });
    expect(result.value).toMatchObject({ status: 'succeeded' });
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it('stops at the deadline without replaying a mutation', async () => {
    const requestJson = vi.fn().mockResolvedValue({ ok: true, data: { status: 'processing' } });
    await expect(pollHttpJob({ requestJson } as never, { path: '/job', body: {} }, (_data): _data is { done: true } => false, new AbortController().signal, { deadlineMs: 2, intervalMs: 1 })).rejects.toThrow('HTTP_JOB_TIMEOUT');
  });

  it('honors Retry-After from a read response without exceeding the deadline', async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { status: 'processing' }, headers: { 'retry-after': '0.01' } })
      .mockResolvedValueOnce({ ok: true, data: { status: 'succeeded' }, headers: {} });
    const result = await pollHttpJob({ requestJson } as never, { path: '/job', body: {} }, (data): data is { status: string } => (data as { status?: string }).status === 'succeeded', new AbortController().signal, { deadlineMs: 100, intervalMs: 50 });
    expect(result.attempts).toBe(2);
  });

  it('aborts while waiting between polls', async () => {
    const controller = new AbortController();
    const requestJson = vi.fn().mockResolvedValue({ ok: true, data: { status: 'processing' } });
    const pending = pollHttpJob({ requestJson } as never, { path: '/job', body: {} }, (_data): _data is { done: true } => false, controller.signal, { deadlineMs: 1000, intervalMs: 100 });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('aborts an in-flight read when the polling deadline expires', async () => {
    const requestJson = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    await expect(pollHttpJob({ requestJson } as never, { path: '/job', body: {} }, (_data): _data is { done: true } => false, new AbortController().signal, { deadlineMs: 5 }))
      .rejects.toThrow('HTTP_JOB_TIMEOUT');
    expect(requestJson).toHaveBeenCalledTimes(1);
  });
});
