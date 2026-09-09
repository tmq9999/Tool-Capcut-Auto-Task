import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { checkEmailRegistered, readAuthenticatedAccount, registerVerifyLogin, sendEmailCode } from '../authHttp';
import { createAccountHttpSession } from '../accountSession';
import { createCycleTlsContext } from '../cycleTlsContext';
import { createHttpOnlyTransport } from '../httpOnlyTransport';
import type { HttpOnlyClient } from '../httpTypes';
import type { CycleTlsDriverRequest } from '../cycleTlsRuntime';

const context = { headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'sid=current' }, query: { aid: '348188', webid: 'web-1', msToken: 'fresh', 'X-Bogus': 'fresh', 'X-Gnarly': 'fresh' } };

describe('HTTP auth contracts', () => {
  it('reads the authenticated identity from a native jar cookie without forwarding a raw Cookie header', async () => {
    const nativeRequests: CycleTlsDriverRequest[] = [];
    const native = await createCycleTlsContext({
      proxy: { server: 'http://proxy.example.test:8080' }
    }, { createDriver: async () => ({
      async request(request) {
        nativeRequests.push(request);
        if (new URL(request.url).pathname.endsWith('/passport/web/email/register_verify_login/')) {
          return {
            status: 200,
            headers: [{ name: 'Set-Cookie', value: 'sid=server-rotated; Path=/; HttpOnly' }],
            body: Buffer.from(JSON.stringify({ message: 'success', data: { user_id_str: 'user-1' } })),
            finalUrl: request.url
          };
        }
        expect(request.headers.cookie).toBe('sid=server-rotated');
        return {
          status: 200,
          headers: [],
          body: Buffer.from(JSON.stringify({ message: 'success', data: { user_id_str: 'user-1', email: 'synthetic@example.test' } })),
          finalUrl: request.url
        };
      },
      dispose: async () => undefined
    }) });
    const transport = createHttpOnlyTransport(createAccountHttpSession({
      accountId: 'a',
      proxy: { server: 'http://127.0.0.1:9' },
      origin: 'https://login-row.www.capcut.com',
      context: native
    }));
    const forwarded: Array<Record<string, string> | undefined> = [];
    const authClient: HttpOnlyClient = {
      requestForm: request => { forwarded.push(request.headers); return transport.requestForm(request); },
      requestJson: request => { forwarded.push(request.headers); return transport.requestJson(request); },
      requestText: request => transport.requestText(request)
    };
    const jarOnlyContext = {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      query: { aid: '348188', webid: 'web-1', msToken: 'fresh', 'X-Bogus': 'fresh', 'X-Gnarly': 'fresh' }
    };
    try {
      await registerVerifyLogin(authClient, { email: 'encoded', password: 'encoded', code: '123456' }, jarOnlyContext);
      await expect(readAuthenticatedAccount(authClient, jarOnlyContext)).resolves.toEqual({
        userId: 'user-1', email: 'synthetic@example.test'
      });
      expect(forwarded.every(headers => !Object.keys(headers ?? {}).some(name => name.toLowerCase() === 'cookie'))).toBe(true);
      expect(nativeRequests).toHaveLength(2);
    } finally {
      await native.dispose();
    }
  });

  it('sends captured form contracts directly', async () => {
    const requestForm = vi.fn().mockResolvedValue({ status: 200, ok: true, data: { message: 'success', data: { is_registered: 0 } } });
    await checkEmailRegistered({ requestForm } as never, { mix_mode: 'captured', email: 'new@example.com', fixed_mix_mode: 'captured' }, context);
    expect(requestForm).toHaveBeenCalledWith(expect.objectContaining({ path: '/passport/web/user/check_email_registered', effect: 'mutation', form: { mix_mode: 'captured', email: 'new@example.com', fixed_mix_mode: 'captured' } }));
  });

  it('preserves the OTP ticket dependency and rejects empty verification input', async () => {
    const requestForm = vi.fn().mockResolvedValue({ status: 200, ok: true, data: { message: 'success', data: { email_ticket: 'ticket' } } });
    await sendEmailCode({ requestForm } as never, { email: 'new@example.com', password: 'p', type: 'captured' }, context);
    expect(requestForm.mock.calls[0][0].form.email).toBe('new@example.com');
    await expect(registerVerifyLogin({ requestForm } as never, { email: 'new@example.com', code: '', password: 'p' }, context)).rejects.toThrow('AUTH_VERIFICATION_INPUT_MISSING');
  });
});
