import { describe, expect, it, vi } from 'vitest';
import { signupHttp, type HttpSignupInput } from '../httpSignup';

const context = { headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'sid=current' }, query: { aid: '348188', webid: 'web-1', msToken: 'fresh', 'X-Bogus': 'fresh', 'X-Gnarly': 'fresh' } };

const ok = (data: unknown) => ({ status: 200, ok: true, data: { message: 'success', data } });

function fixture() {
  const requestForm = vi.fn().mockResolvedValueOnce(ok({ is_registered: 0 }))
    .mockResolvedValueOnce(ok({ email_ticket: 'ticket-1' })).mockResolvedValueOnce(ok({ user_id_str: 'user-1' }));
  const registrationBody = { email: 'encoded-email', password: 'encoded-password', code: 'encoded-otp', biz_param: '{"synthetic":true}' };
  const prepareRegistration = vi.fn(async () => {
    expect(requestForm).toHaveBeenCalledTimes(2);
    return { body: registrationBody, context: { ...context, query: { ...context.query, 'X-Bogus': 'registration-only' } } };
  });
  const requestJson = vi.fn().mockResolvedValue(ok({ user_id_str: 'user-1' }));
  const input: HttpSignupInput = {
    checkEmailBody: { email: 'encoded-email' }, sendCodeBody: { email: 'encoded-email', password: 'encoded-password' },
    prepareRegistration, loginContext: context, accountContext: context,
    loginClient: { requestForm } as never, accountClient: { requestJson } as never
  };
  return { input, requestForm, prepareRegistration, requestJson, registrationBody };
}

describe('HTTP signup sequence (synthetic wire fixtures, not a live contract)', () => {
  it('preserves prepared wire values and prepares registration only after OTP send succeeds', async () => {
    const f = fixture();
    expect((await signupHttp(f.input)).userId).toBe('user-1');
    expect(f.requestForm.mock.calls[0][0].form).toEqual({ email: 'encoded-email' });
    expect(f.requestForm.mock.calls[2][0].form).toEqual(f.registrationBody);
    expect(f.requestForm.mock.calls[2][0].form.biz_param).not.toBe('ticket-1');
    expect(f.requestForm.mock.calls[2][0].query['X-Bogus']).toBe('registration-only');
  });

  it('does not send OTP when account discovery is rejected or malformed', async () => {
    const f = fixture();
    f.requestForm.mockReset().mockResolvedValue({ status: 200, ok: true, data: { message: 'error', data: {} } });
    await expect(signupHttp(f.input)).rejects.toThrow('AUTH_EMAIL_CHECK_REJECTED');
    expect(f.requestForm).toHaveBeenCalledTimes(1);
    expect(f.prepareRegistration).not.toHaveBeenCalled();
  });

  it('does not prepare registration after an OTP send rejection', async () => {
    const f = fixture();
    f.requestForm.mockReset().mockResolvedValueOnce(ok({ is_registered: 0 }))
      .mockResolvedValueOnce({ status: 403, ok: false, data: { message: 'error', data: { email_ticket: 'ticket-1' } } });
    await expect(signupHttp(f.input)).rejects.toThrow('AUTH_SEND_CODE_REJECTED');
    expect(f.prepareRegistration).not.toHaveBeenCalled();
  });

  it('checks account identity against the registration response', async () => {
    const f = fixture();
    f.requestJson.mockResolvedValue(ok({ user_id_str: 'other-account' }));
    await expect(signupHttp(f.input)).rejects.toThrow('AUTH_ACCOUNT_IDENTITY_MISMATCH');
  });

  it('cancels after OTP preparation without sending a registration', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.prepareRegistration.mockImplementation(async () => { controller.abort(); return { body: f.registrationBody, context }; });
    await expect(signupHttp({ ...f.input, signal: controller.signal })).rejects.toThrow();
    expect(f.requestForm).toHaveBeenCalledTimes(2);
  });
});
