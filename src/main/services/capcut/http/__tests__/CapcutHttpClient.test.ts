import { describe, expect, it, vi } from 'vitest';
import { CapcutHttpClient } from '../CapcutHttpClient';

describe('CapcutHttpClient', () => {
  it('rejects using an account session on a different origin', () => {
    const session = { accountId: 'a', origin: 'https://edit-api-sg.capcut.com', proxy: { server: 'http://127.0.0.1:1' }, context: {} as never, headers: {} };
    expect(() => CapcutHttpClient.fromAccountSession(session, 'https://www.capcut.com')).toThrow('CAPCUT_HTTP_SESSION_ORIGIN_MISMATCH');
  });
  it('sends an account-scoped browser HTTP request without DOM actions', async () => {
    const evaluate = vi.fn().mockResolvedValue({ status: 200, ok: true, data: { data: {} } });
    const page = { evaluate } as never;
    const client = new CapcutHttpClient(page);
    await expect(client.requestJson({ path: '/luckycat/i18n/capcut/task/v1/task_list', method: 'POST', body: {} })).resolves.toMatchObject({ status: 200 });
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it('rejects non-relative or unapproved origins', async () => {
    expect(() => new CapcutHttpClient({} as never, 'https://evil.example')).toThrow('CAPCUT_HTTP_ORIGIN_NOT_ALLOWED');
    const client = new CapcutHttpClient({} as never);
    await expect(client.requestJson({ path: 'https://evil.example/x' })).rejects.toThrow('CAPCUT_HTTP_PATH_INVALID');
  });
});
