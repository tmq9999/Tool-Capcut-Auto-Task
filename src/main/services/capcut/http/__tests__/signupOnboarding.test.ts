import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { createAccountHttpSession } from '../accountSession';
import {
  signupHttpWithOnboarding,
  type SignupOnboardingInput,
} from '../httpSignup';
import { createHttpOnlyTransport } from '../httpOnlyTransport';
import type {
  NativeHttpContext,
  NativeHttpRequestOptions,
  NativeHttpResponse,
} from '../nativeHttpContext';
import type {
  SignupOnboardingContext,
  SignupRequestContextProvider,
  SignupResponseContextInput,
} from '../signupOnboarding';

interface WireCall {
  readonly url: string;
  readonly options: NativeHttpRequestOptions;
}

const passportContext = {
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'x-csrf-token': 'caller-current-csrf',
  },
  query: {
    aid: '348188',
    webid: 'caller-web-id',
    mix_mode: 1,
    msToken: 'caller-current-ms-token',
    'X-Bogus': 'caller-current-bogus',
    'X-Gnarly': 'caller-current-gnarly',
  },
};

const productContext = {
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    sign: 'caller-current-product-sign',
    'sign-ver': '1',
    'device-time': 'caller-current-device-time',
    did: 'caller-device',
  },
  query: {},
};

function snapshotContext(context: SignupOnboardingContext): SignupOnboardingContext {
  return {
    passport: {
      headers: { ...context.passport.headers },
      query: { ...context.passport.query },
    },
    product: {
      headers: { ...context.product.headers },
      query: { ...context.product.query },
    },
  };
}

function nativeResponse(value: unknown, headers: Readonly<Record<string, string>> = {}): NativeHttpResponse {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    status: () => 200,
    ok: () => true,
    headers: () => headers,
    headersArray: () => Object.entries(headers).map(([name, headerValue]) => ({ name, value: headerValue })),
    body: async () => Buffer.from(bytes),
    text: async () => bytes.toString('utf8'),
    json: async () => JSON.parse(bytes.toString('utf8')) as unknown,
    dispose: vi.fn(async () => undefined),
  };
}

function successFor(path: string, userInfoRet = 0, ageThreshold = 18): unknown {
  if (path.endsWith('/user/check_email_registered')) {
    return { message: 'success', data: { is_registered: 0 } };
  }
  if (path.endsWith('/email/send_code/')) {
    return { message: 'success', data: { email_ticket: 'current-send-response-ticket' } };
  }
  if (path.endsWith('/email/register_verify_login/')) {
    return {
      message: 'success',
      data: {
        user_id_str: 'registered-user-1',
        sec_user_id: 'registered-sec-user-1',
        screen_name: 'registered-screen-name-1',
      },
    };
  }
  if (path.endsWith('/get_age_gate_config')) {
    return { ret: '0', data: { age_threshold: ageThreshold } };
  }
  if (path.endsWith('/check_age_without_uid')) {
    return { ret: '0', data: { passed: true, age_threshold: 18, lock_duration_hours: 0 } };
  }
  if (path.endsWith('/set_birthday_by_uid')) {
    return { ret: '0', base_resp: { StatusCode: 0, StatusMessage: '' } };
  }
  if (path.endsWith('/passport/web/account/info/')) {
    return { message: 'success', data: { user_id_str: 'registered-user-1' } };
  }
  if (path.endsWith('/lv/v1/user/web/user_info')) {
    return userInfoRet === 0
      ? { ret: 0, data: { user_info: { user_id: 'registered-user-1', has_birthday: true }, space_info: { workspace_id: 'user-info-workspace-1' } } }
      : { ret: userInfoRet, errmsg: 'blocked' };
  }
  if (path.endsWith('/cc/v1/workspace/get_user_workspaces')) {
    return { ret: 0, data: { workspace_infos: [{ workspace_id: 'current-workspace-1' }] } };
  }
  return { message: 'success', data: {} };
}

function fixture(options: {
  readonly userInfoRet?: number;
  readonly workspaceRet?: number;
  readonly malformedWorkspace?: boolean;
  readonly malformedWorkspaceRows?: boolean;
  readonly ageThreshold?: number;
  readonly afterFetch?: (path: string) => void;
} = {}) {
  const calls: WireCall[] = [];
  const fetch = vi.fn(async (url: string, requestOptions?: NativeHttpRequestOptions) => {
    const path = new URL(url).pathname;
    calls.push({ url, options: requestOptions ?? {} });
    let body = successFor(path, options.userInfoRet, options.ageThreshold);
    if (path.endsWith('/cc/v1/workspace/get_user_workspaces')) {
      body = options.malformedWorkspace
        ? { ret: 0, data: { workspace_infos: null } }
        : options.malformedWorkspaceRows
          ? { ret: 0, data: { workspace_infos: [null, {}, { workspace_id: '' }] } }
        : options.workspaceRet === undefined
          ? body
          : { ret: options.workspaceRet, errmsg: 'blocked' };
    }
    const result = nativeResponse(body, { 'x-stage-response': path });
    options.afterFetch?.(path);
    return result;
  });
  const native: NativeHttpContext = {
    transport: 'cycletls',
    fetch,
    get: vi.fn(),
    stream: vi.fn(),
    dispose: vi.fn(async () => undefined),
  };
  const makeTransport = (origin: string) => createHttpOnlyTransport(createAccountHttpSession({
    accountId: `signup-onboarding-${origin}`,
    origin,
    proxy: { server: 'http://127.0.0.1:9' },
    context: native,
  }));
  const loginClient = makeTransport('https://login-row.www.capcut.com');
  const productClient = makeTransport('https://www.capcut.com');
  const accountClient = makeTransport('https://www.capcut.com');
  const deriveContext = vi.fn((deriveInput: SignupResponseContextInput): SignupOnboardingContext => {
    const previous = snapshotContext(deriveInput.previous);
    const productQuery = deriveInput.stage === 'broadcast-us' ? { region: 'VN' } : previous.product.query;
    return {
      passport: {
        headers: { ...previous.passport.headers, 'x-derived-stage': deriveInput.stage },
        query: previous.passport.query,
      },
      product: {
        headers: { ...previous.product.headers, 'x-derived-stage': deriveInput.stage },
        query: productQuery,
      },
    };
  });
  const prepareRegistration: SignupOnboardingInput['prepareRegistration'] = vi.fn(async callbackInput => ({
    body: {
      email: 'encoded-account-email',
      password: 'encoded-account-password',
      code: 'encoded-current-otp',
      birthday: '2000-01-02',
      biz_param: '{}',
    },
    context: snapshotContext(callbackInput.context),
  }));
  const prepareBroadcast: SignupOnboardingInput['prepareBroadcast'] = vi.fn(async callbackInput => ({
    body: {
      final_domain: 'www.capcut.com',
      hashed_id: 'caller-account-hash',
      is_retry: 0,
      pre_path: '/',
      screen_name: callbackInput.registeredResponse.data.data?.screen_name ?? '',
      sec_uid: callbackInput.registeredResponse.data.data?.sec_user_id ?? '',
      type: 1,
    },
    context: snapshotContext(callbackInput.context),
  }));
  const prepareProductUserInfo: SignupOnboardingInput['prepareProductUserInfo'] = vi.fn(async callbackInput => {
    const previous = snapshotContext(callbackInput.context);
    const context: SignupOnboardingContext = {
      passport: previous.passport,
      product: {
        headers: previous.product.headers,
        query: {
          msToken: 'current-user-info-ms-token',
          'X-Bogus': 'current-user-info-bogus',
          'X-Gnarly': 'current-user-info-gnarly',
        },
      },
    };
    return {
      body: {
        sem_info: {
          is_sem: false,
          medium: '',
          register_source: '',
          register_second_source: '',
        },
      },
      context,
    };
  });
  const prepareWorkspaceRead: SignupOnboardingInput['prepareWorkspaceRead'] = vi.fn(async callbackInput => {
    expect(callbackInput.userInfoResponse.data.data?.space_info?.workspace_id).toBe('user-info-workspace-1');
    const previous = snapshotContext(callbackInput.context);
    const context: SignupOnboardingContext = {
      passport: previous.passport,
      product: { headers: previous.product.headers, query: {} },
    };
    return {
      body: { cursor: '', count: 20, need_convert_workspace: true },
      context,
    };
  });
  const contextProvider = {
    accountId: 'signup-account-1',
    supports: vi.fn(() => true),
    prepare: vi.fn(async request => snapshotContext(request.session)),
  } satisfies SignupRequestContextProvider;
  const input: SignupOnboardingInput = {
    accountId: 'signup-account-1',
    checkEmailBody: { email: 'encoded-account-email', mix_mode: '1', fixed_mix_mode: '1' },
    sendCodeBody: { email: 'encoded-account-email', password: 'encoded-account-password', type: 1 },
    prepareRegistration,
    prepareBroadcast,
    prepareProductUserInfo,
    prepareWorkspaceRead,
    initialContext: {
      passport: snapshotContext({ passport: passportContext, product: productContext }).passport,
      product: snapshotContext({ passport: passportContext, product: productContext }).product,
    },
    contextProvider,
    deriveContext,
    regionBody: { type: 1, hashed_id: 'caller-account-hash' },
    birthday: '2000-01-02',
    region: 'VN',
    loginClient,
    productClient,
    accountClient,
  };
  return {
    calls,
    fetch,
    input,
    deriveContext,
    prepareRegistration: vi.mocked(prepareRegistration),
    prepareBroadcast: vi.mocked(prepareBroadcast),
    prepareProductUserInfo: vi.mocked(prepareProductUserInfo),
    prepareWorkspaceRead: vi.mocked(prepareWorkspaceRead),
    contextProvider,
  };
}

function paths(calls: readonly WireCall[]): string[] {
  return calls.map(call => new URL(call.url).pathname);
}

function parsedBody(call: WireCall): unknown {
  if (call.options.data instanceof URLSearchParams) return Object.fromEntries(call.options.data);
  return typeof call.options.data === 'string' ? JSON.parse(call.options.data) as unknown : undefined;
}

describe('HTTP signup onboarding parity', () => {
  it('requires a per-request context provider before any signup mutation', async () => {
    const f = fixture();
    const { contextProvider: _contextProvider, ...withoutProvider } = f.input;

    await expect(signupHttpWithOnboarding(withoutProvider as SignupOnboardingInput)).rejects.toThrow('SIGNUP_CONTEXT_PROVIDER_REQUIRED');

    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.prepareRegistration).not.toHaveBeenCalled();
  });

  it('rejects an unsupported provider capability before any signup mutation', async () => {
    const f = fixture();
    const contextProvider = {
      accountId: 'signup-account-1',
      supports: vi.fn(() => false),
      prepare: vi.fn(),
    };

    await expect(signupHttpWithOnboarding({
      ...f.input,
      accountId: 'signup-account-1',
      contextProvider,
    } as never)).rejects.toThrow('SIGNUP_CONTEXT_PROVIDER_UNSUPPORTED');

    expect(f.fetch).not.toHaveBeenCalled();
    expect(contextProvider.prepare).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'truthy object', value: {} },
    { label: 'promise', value: Promise.resolve(true) },
  ])('rejects non-boolean provider support: $label', async ({ value }) => {
    const f = fixture();
    const contextProvider = {
      ...f.contextProvider,
      supports: vi.fn(() => value),
    };

    await expect(signupHttpWithOnboarding({ ...f.input, contextProvider } as never))
      .rejects.toThrow('SIGNUP_CONTEXT_PROVIDER_UNSUPPORTED');

    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('maps provider preparation exceptions without leaking their message', async () => {
    const f = fixture();
    f.contextProvider.prepare.mockRejectedValue(new Error('private-provider-secret'));

    await expect(signupHttpWithOnboarding(f.input)).rejects.toThrow('SIGNUP_CONTEXT_PROVIDER_FAILED');
    await expect(signupHttpWithOnboarding(f.input)).rejects.not.toThrow('private-provider-secret');
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('rejects a malformed provider before any signup mutation', async () => {
    const f = fixture();

    await expect(signupHttpWithOnboarding({
      ...f.input,
      contextProvider: { accountId: 'signup-account-1' },
    } as never)).rejects.toThrow('SIGNUP_CONTEXT_PROVIDER_UNSUPPORTED');

    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('freezes the provider descriptor and query before awaiting provider code', async () => {
    const f = fixture();
    let descriptorFrozen = false;
    let queryFrozen = false;
    const observedOrigins: string[] = [];
    const observedAids: Array<string | number | boolean | undefined> = [];
    f.contextProvider.prepare.mockImplementation(async request => {
      descriptorFrozen = Object.isFrozen(request);
      queryFrozen = Object.isFrozen(request.query);
      try { (request as { origin: string }).origin = 'https://attacker.invalid'; } catch { /* frozen in strict mode */ }
      try { (request.query as { aid: string }).aid = 'attacker-aid'; } catch { /* frozen in strict mode */ }
      observedOrigins.push(request.origin);
      observedAids.push(request.query.aid);
      return snapshotContext(request.session);
    });

    await expect(signupHttpWithOnboarding(f.input)).resolves.toMatchObject({ identity: { userId: 'registered-user-1' } });

    expect(descriptorFrozen).toBe(true);
    expect(queryFrozen).toBe(true);
    expect(observedOrigins[0]).toBe('https://login-row.www.capcut.com');
    expect(observedAids[0]).toBe('348188');
    expect(new URL(f.calls[0].url).origin).toBe('https://login-row.www.capcut.com');
    expect((f.calls[0].options.params as Record<string, unknown> | undefined)?.aid).toBe('348188');
  });

  it('pins input bodies, account identity, and provider before an asynchronous prepare', async () => {
    const f = fixture();
    let release!: () => void;
    let started!: () => void;
    const preparing = new Promise<void>(resolve => { started = resolve; });
    const deferred = new Promise<void>(resolve => { release = resolve; });
    f.contextProvider.prepare.mockImplementation(async request => {
      if (request.operation === 'region-row') {
        started();
        await deferred;
      }
      return snapshotContext(request.session);
    });
    const replacementProvider = {
      accountId: 'replacement-account',
      supports: vi.fn(() => true),
      prepare: vi.fn(async request => snapshotContext(request.session)),
    } satisfies SignupRequestContextProvider;

    const result = signupHttpWithOnboarding(f.input);
    await preparing;
    (f.input.regionBody as Record<string, string | number | boolean>).hashed_id = 'mutated-hash';
    (f.input as { accountId: string }).accountId = 'replacement-account';
    (f.input as { contextProvider: SignupRequestContextProvider }).contextProvider = replacementProvider;
    release();

    await expect(result).resolves.toMatchObject({ identity: { userId: 'registered-user-1' } });
    expect(parsedBody(f.calls[0])).toEqual({ type: '1', hashed_id: 'caller-account-hash' });
    expect(f.contextProvider.prepare).toHaveBeenCalledTimes(13);
    expect(f.contextProvider.prepare.mock.calls[0][0].accountId).toBe('signup-account-1');
    expect(replacementProvider.prepare).not.toHaveBeenCalled();
  });

  it('snapshots a callback-prepared registration body before awaiting its provider context', async () => {
    const f = fixture();
    const registrationBody = {
      email: 'encoded-account-email',
      password: 'encoded-account-password',
      code: 'encoded-current-otp',
      birthday: '2000-01-02',
      biz_param: '{}',
    };
    let release!: () => void;
    let started!: () => void;
    const preparing = new Promise<void>(resolve => { started = resolve; });
    const deferred = new Promise<void>(resolve => { release = resolve; });
    const prepareRegistration: SignupOnboardingInput['prepareRegistration'] = vi.fn(async callbackInput => ({
      body: registrationBody,
      context: snapshotContext(callbackInput.context),
    }));
    f.contextProvider.prepare.mockImplementation(async request => {
      if (request.operation === 'register') {
        started();
        await deferred;
      }
      return snapshotContext(request.session);
    });

    const result = signupHttpWithOnboarding({ ...f.input, prepareRegistration });
    await preparing;
    registrationBody.code = 'mutated-otp';
    release();

    await expect(result).resolves.toMatchObject({ identity: { userId: 'registered-user-1' } });
    const register = f.calls.find(call => new URL(call.url).pathname.endsWith('/register_verify_login/'));
    expect(register && parsedBody(register)).toMatchObject({ code: 'encoded-current-otp' });
  });

  it('rejects provider account drift before dispatching the next request', async () => {
    const f = fixture();
    f.contextProvider.prepare.mockImplementation(async request => {
      if (request.operation === 'region-us') {
        (f.contextProvider as { accountId: string }).accountId = 'other-account';
      }
      return snapshotContext(request.session);
    });

    await expect(signupHttpWithOnboarding(f.input)).rejects.toThrow('SIGNUP_CONTEXT_PROVIDER_ACCOUNT_MISMATCH');

    expect(paths(f.calls)).toEqual(['/passport/web/region/']);
  });

  it('uses real transport MIME, captured order/exact query shapes, and current registration-bound broadcast data', async () => {
    const f = fixture();

    const result = await signupHttpWithOnboarding(f.input);

    expect(paths(f.calls)).toEqual([
      '/passport/web/region/',
      '/passport/web/region/',
      '/passport/web/user/check_email_registered',
      '/lv/v1/sc/age_gate/get_age_gate_config',
      '/lv/v1/sc/age_gate/check_age_without_uid',
      '/passport/web/email/send_code/',
      '/passport/web/email/register_verify_login/',
      '/passport/web/auth_broadcast/',
      '/passport/web/auth_broadcast/',
      '/lv/v1/sc/age_gate/set_birthday_by_uid',
      '/passport/web/account/info/',
      '/lv/v1/user/web/user_info',
      '/cc/v1/workspace/get_user_workspaces',
    ]);
    expect(f.calls.map(call => new URL(call.url).origin)).toEqual([
      'https://login-row.www.capcut.com',
      'https://login.us.capcut.com',
      'https://login-row.www.capcut.com',
      'https://www.capcut.com',
      'https://www.capcut.com',
      'https://login-row.www.capcut.com',
      'https://login-row.www.capcut.com',
      'https://login-row.www.capcut.com',
      'https://login.us.capcut.com',
      'https://www.capcut.com',
      'https://www.capcut.com',
      'https://www.capcut.com',
      'https://edit-api-sg.capcut.com',
    ]);
    expect(result).toMatchObject({
      identity: { userId: 'registered-user-1' },
      ageThreshold: 18,
      productReadiness: { status: 'ready', workspaceCount: 1 },
    });
    const region = f.calls[0];
    expect(region.options.params).toMatchObject({
      aid: '348188',
      webid: 'caller-web-id',
      mix_mode: 1,
      msToken: 'caller-current-ms-token',
      'X-Bogus': 'caller-current-bogus',
      'X-Gnarly': 'caller-current-gnarly',
    });
    const config = f.calls.find(call => new URL(call.url).pathname.endsWith('/get_age_gate_config'));
    const ageCheck = f.calls.find(call => new URL(call.url).pathname.endsWith('/check_age_without_uid'));
    const persist = f.calls.find(call => new URL(call.url).pathname.endsWith('/set_birthday_by_uid'));
    const userInfo = f.calls.find(call => new URL(call.url).pathname.endsWith('/user/web/user_info'));
    const workspace = f.calls.find(call => new URL(call.url).pathname.endsWith('/get_user_workspaces'));
    expect(config?.options).toMatchObject({ params: {}, headers: { 'content-type': 'application/json' }, data: '{}' });
    expect(ageCheck && parsedBody(ageCheck)).toEqual({ birthday: '2000-01-02' });
    expect(ageCheck?.options.params).toEqual({});
    expect(persist?.options.params).toEqual({ region: 'VN' });
    expect(userInfo?.options.params).toEqual({
      msToken: 'current-user-info-ms-token',
      'X-Bogus': 'current-user-info-bogus',
      'X-Gnarly': 'current-user-info-gnarly',
    });
    expect(workspace?.options.params).toEqual({});
    expect(workspace && parsedBody(workspace)).toEqual({ cursor: '', count: 20, need_convert_workspace: true });
    const broadcast = f.calls.find(call => new URL(call.url).pathname.endsWith('/auth_broadcast/'));
    expect(broadcast && parsedBody(broadcast)).toEqual({
      final_domain: 'www.capcut.com',
      hashed_id: 'caller-account-hash',
      is_retry: '0',
      pre_path: '/',
      screen_name: 'registered-screen-name-1',
      sec_uid: 'registered-sec-user-1',
      type: '1',
    });
    expect(f.prepareRegistration).toHaveBeenCalledOnce();
    expect(f.prepareBroadcast).toHaveBeenCalledOnce();
    expect(f.contextProvider.prepare).toHaveBeenCalledTimes(13);
    expect(f.contextProvider.prepare.mock.calls.map(([request]) => [request.operation, request.origin, request.method, request.path])).toEqual([
      ['region-row', 'https://login-row.www.capcut.com', 'POST', '/passport/web/region/'],
      ['region-us', 'https://login.us.capcut.com', 'POST', '/passport/web/region/'],
      ['email-check', 'https://login-row.www.capcut.com', 'POST', '/passport/web/user/check_email_registered'],
      ['age-config', 'https://www.capcut.com', 'POST', '/lv/v1/sc/age_gate/get_age_gate_config'],
      ['age-check', 'https://www.capcut.com', 'POST', '/lv/v1/sc/age_gate/check_age_without_uid'],
      ['send-code', 'https://login-row.www.capcut.com', 'POST', '/passport/web/email/send_code/'],
      ['register', 'https://login-row.www.capcut.com', 'POST', '/passport/web/email/register_verify_login/'],
      ['broadcast-row', 'https://login-row.www.capcut.com', 'POST', '/passport/web/auth_broadcast/'],
      ['broadcast-us', 'https://login.us.capcut.com', 'POST', '/passport/web/auth_broadcast/'],
      ['birthday-persist', 'https://www.capcut.com', 'POST', '/lv/v1/sc/age_gate/set_birthday_by_uid'],
      ['account-info', 'https://www.capcut.com', 'GET', '/passport/web/account/info/'],
      ['product-user-info', 'https://www.capcut.com', 'POST', '/lv/v1/user/web/user_info'],
      ['workspace', 'https://edit-api-sg.capcut.com', 'POST', '/cc/v1/workspace/get_user_workspaces'],
    ]);
    expect(f.contextProvider.prepare.mock.calls[5][0].body).toBe('email=encoded-account-email&password=encoded-account-password&type=1');
    expect(f.contextProvider.prepare.mock.calls[10][0].body).toBeUndefined();
  });

  it('allows the provider to supply missing current Passport signing context before dispatch', async () => {
    const f = fixture();
    const initialContext = snapshotContext(f.input.initialContext);
    delete initialContext.passport.query.msToken;

    const contextProvider = {
      ...f.contextProvider,
      prepare: vi.fn(async request => {
        const session = snapshotContext(request.session);
        return {
          ...session,
          passport: {
            ...session.passport,
            query: {
              ...session.passport.query,
              msToken: 'provider-current-ms-token',
              'X-Bogus': 'provider-current-bogus',
              'X-Gnarly': 'provider-current-gnarly',
            },
          },
        };
      }),
    };

    await expect(signupHttpWithOnboarding({ ...f.input, initialContext, contextProvider })).resolves.toMatchObject({
      identity: { userId: 'registered-user-1' },
    });

    expect(f.fetch).toHaveBeenCalled();
    expect(f.prepareRegistration).toHaveBeenCalledOnce();
  });

  it.each([undefined, '', '2000-02-31'])('rejects invalid birthday %s before dispatch', async birthday => {
    const f = fixture();

    await expect(signupHttpWithOnboarding({ ...f.input, birthday: birthday as string })).rejects.toThrow('SIGNUP_ONBOARDING_INPUT_INVALID');

    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('returns an explicit blocked result for HTTP 200 ret=1014 and does not read workspaces', async () => {
    const f = fixture({ userInfoRet: 1014 });

    const result = await signupHttpWithOnboarding(f.input);

    expect(result.productReadiness).toEqual({
      status: 'blocked',
      stage: 'user-info',
      reason: 'application-rejected',
      ret: 1014,
    });
    expect(f.prepareWorkspaceRead).not.toHaveBeenCalled();
    expect(paths(f.calls)).not.toContain('/cc/v1/workspace/get_user_workspaces');
  });

  it('returns blocked when the workspace application response is ret=1014', async () => {
    const f = fixture({ workspaceRet: 1014 });

    const result = await signupHttpWithOnboarding(f.input);

    expect(result.productReadiness).toEqual({
      status: 'blocked',
      stage: 'workspace',
      reason: 'application-rejected',
      ret: 1014,
    });
  });

  it('returns blocked rather than throwing or becoming ready for malformed workspace data', async () => {
    const f = fixture({ malformedWorkspace: true });

    const result = await signupHttpWithOnboarding(f.input);

    expect(result.productReadiness).toEqual({
      status: 'blocked',
      stage: 'workspace',
      reason: 'workspace-missing',
      ret: 0,
    });
  });

  it('returns blocked for null or malformed workspace rows', async () => {
    const f = fixture({ malformedWorkspaceRows: true });

    const result = await signupHttpWithOnboarding(f.input);

    expect(result.productReadiness).toEqual({
      status: 'blocked',
      stage: 'workspace',
      reason: 'workspace-missing',
      ret: 0,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid age threshold %s', async ageThreshold => {
    const f = fixture({ ageThreshold });

    await expect(signupHttpWithOnboarding(f.input)).rejects.toThrow('SIGNUP_AGE_CONFIG_REJECTED');
    expect(paths(f.calls)).not.toContain('/lv/v1/sc/age_gate/check_age_without_uid');
  });

  it('requires the caller-prepared birthday region query and never appends it', async () => {
    const f = fixture();
    const deriveContext = vi.fn((deriveInput: SignupResponseContextInput): SignupOnboardingContext => {
      const previous = snapshotContext(deriveInput.previous);
      return {
        passport: previous.passport,
        product: { headers: previous.product.headers, query: {} },
      };
    });

    await expect(signupHttpWithOnboarding({ ...f.input, deriveContext })).rejects.toThrow('SIGNUP_ONBOARDING_INPUT_INVALID');
    expect(paths(f.calls)).not.toContain('/lv/v1/sc/age_gate/set_birthday_by_uid');
  });

  it('rejects a broadcast identity not bound to the current registration before dispatching broadcast', async () => {
    const f = fixture();
    const prepareBroadcast: SignupOnboardingInput['prepareBroadcast'] = vi.fn(async callbackInput => ({
      body: {
        final_domain: 'www.capcut.com',
        hashed_id: 'caller-account-hash',
        sec_uid: 'pre-signup-user',
        screen_name: 'pre-signup-screen',
      },
      context: snapshotContext(callbackInput.context),
    }));

    await expect(signupHttpWithOnboarding({ ...f.input, prepareBroadcast })).rejects.toThrow('SIGNUP_ONBOARDING_INPUT_INVALID');

    expect(paths(f.calls)).not.toContain('/passport/web/auth_broadcast/');
  });

  it('does not retry or resend when the single registration attempt is rejected', async () => {
    const f = fixture();
    const originalFetch = f.fetch.getMockImplementation();
    f.fetch.mockImplementation(async (url, options) => {
      if (new URL(url).pathname.endsWith('/register_verify_login/')) {
        f.calls.push({ url, options: options ?? {} });
        return nativeResponse({ message: 'error', data: {} });
      }
      if (!originalFetch) throw new Error('missing fixture fetch');
      return originalFetch(url, options);
    });

    await expect(signupHttpWithOnboarding(f.input)).rejects.toThrow('AUTH_REGISTER_REJECTED');

    expect(paths(f.calls).filter(path => path.endsWith('/send_code/'))).toHaveLength(1);
    expect(paths(f.calls).filter(path => path.endsWith('/register_verify_login/'))).toHaveLength(1);
    expect(paths(f.calls)).not.toContain('/passport/web/auth_broadcast/');
  });

  it('stops after an aborting response and does not call the next context callback', async () => {
    const controller = new AbortController();
    const f = fixture({
      afterFetch: path => {
        if (path.endsWith('/get_age_gate_config')) controller.abort(new Error('test abort'));
      },
    });

    await expect(signupHttpWithOnboarding({ ...f.input, signal: controller.signal })).rejects.toThrow('CAPCUT_HTTP_ABORTED');

    expect(f.deriveContext.mock.calls.map(([input]) => input.stage)).toEqual(['region-row', 'region-us', 'email-check']);
    expect(paths(f.calls)).not.toContain('/lv/v1/sc/age_gate/check_age_without_uid');
  });

  it('stops when a preparation callback aborts and does not dispatch its request', async () => {
    const controller = new AbortController();
    const f = fixture();
    const prepareBroadcast: SignupOnboardingInput['prepareBroadcast'] = vi.fn(async callbackInput => {
      controller.abort(new Error('callback abort'));
      return {
        body: {
          final_domain: 'www.capcut.com',
          hashed_id: 'caller-account-hash',
          sec_uid: callbackInput.registeredResponse.data.data?.sec_user_id ?? '',
          screen_name: callbackInput.registeredResponse.data.data?.screen_name ?? '',
        },
        context: snapshotContext(callbackInput.context),
      };
    });

    await expect(signupHttpWithOnboarding({ ...f.input, prepareBroadcast, signal: controller.signal })).rejects.toThrow('callback abort');

    expect(paths(f.calls)).not.toContain('/passport/web/auth_broadcast/');
  });

  it('stops when the context provider aborts and does not dispatch its prepared request', async () => {
    const controller = new AbortController();
    const f = fixture();
    f.contextProvider.prepare.mockImplementation(async request => {
      if (request.operation === 'send-code') controller.abort(new Error('provider abort'));
      return snapshotContext(request.session);
    });

    await expect(signupHttpWithOnboarding({ ...f.input, signal: controller.signal })).rejects.toThrow('provider abort');

    expect(paths(f.calls)).not.toContain('/passport/web/email/send_code/');
  });
});
