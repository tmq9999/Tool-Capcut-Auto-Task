import { describe, expect, it } from 'vitest';
import { runHttpOnlyAccount } from '../httpOnlyAccount';

describe('HTTP-only account entrypoint', () => {
  it('rejects invalid account material before transport setup', async () => {
    await expect(runHttpOnlyAccount({ accountId: '', proxy: { server: 'http://127.0.0.1:9' }, headers: {} }, [], new AbortController().signal)).rejects.toThrow('HTTP_SESSION_ACCOUNT_ID_REQUIRED');
  });
});
