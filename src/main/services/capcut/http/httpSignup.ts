import type { CapcutHttpResponse, HttpOnlyClient } from './httpTypes';
import {
  assertAuthContext,
  checkEmailRegistered,
  readAuthenticatedAccount,
  registerVerifyLogin,
  sendEmailCode,
  type AuthIdentity,
  type AuthRequestContext,
} from './authHttp';
import {
  assertProductUserInfoBody,
  assertSignupBirthday,
  assertSignupOnboardingContextShape,
  assertSignupProductContext,
  assertWorkspaceReadBody,
  broadcastPassportAuth,
  checkAgeWithoutUid,
  persistBirthdayByUid,
  readAgeGateConfig,
  readProductUserInfo,
  readUserWorkspaces,
  requestPassportRegion,
  signupOrigins,
  signupRequestCapabilities,
  type DeriveSignupContext,
  type ProductUserInfoBody,
  type ProductUserInfoResponse,
  type SignupContextStage,
  type SignupOnboardingContext,
  type SignupRequestContextProvider,
  type SignupRequestCapability,
  type WorkspaceReadBody,
} from './signupOnboarding';

export interface HttpSignupInput {
  checkEmailBody: Record<string, string | number | boolean>;
  sendCodeBody: Record<string, string | number | boolean>;
  /** Wait for OTP and prepare encoded fields/current signing context via HTTP.
   * The orchestrator must not replace biz_param with the send-code ticket. */
  prepareRegistration(signal?: AbortSignal): Promise<{
    body: Record<string, string | number | boolean>;
    context: AuthRequestContext;
  }>;
  loginContext: AuthRequestContext;
  accountContext: AuthRequestContext;
  loginClient: HttpOnlyClient;
  accountClient: HttpOnlyClient;
  signal?: AbortSignal;
}

/** Sequences prepared HTTP requests. The caller owns routing, encoding and signing. */
export async function signupHttp(input: HttpSignupInput): Promise<AuthIdentity> {
  input.signal?.throwIfAborted();
  const checked = await checkEmailRegistered(input.loginClient, input.checkEmailBody, input.loginContext, input.signal);
  if (!checked.ok || checked.data?.message !== 'success' || ![0, 1].includes(checked.data.data?.is_registered ?? -1)) throw new Error('AUTH_EMAIL_CHECK_REJECTED');
  if (checked.data.data?.is_registered !== 0) throw new Error('AUTH_EMAIL_ALREADY_REGISTERED');

  input.signal?.throwIfAborted();
  const sent = await sendEmailCode(input.loginClient, input.sendCodeBody, input.loginContext, input.signal);
  if (!sent.ok || sent.data?.message !== 'success') throw new Error('AUTH_SEND_CODE_REJECTED');

  input.signal?.throwIfAborted();
  const registration = await input.prepareRegistration(input.signal);
  input.signal?.throwIfAborted();
  const registered = await registerVerifyLogin(input.loginClient, registration.body, registration.context, input.signal);
  input.signal?.throwIfAborted();
  const identity = await readAuthenticatedAccount(input.accountClient, input.accountContext, input.signal);
  if (identity.userId !== registered.data.data?.user_id_str) throw new Error('AUTH_ACCOUNT_IDENTITY_MISMATCH');
  return identity;
}

type RegistrationResponse = Awaited<ReturnType<typeof registerVerifyLogin>>;

export interface SignupOnboardingRegistrationInput {
  readonly signal?: AbortSignal;
  readonly context: SignupOnboardingContext;
  readonly sendCodeResponse: Awaited<ReturnType<typeof sendEmailCode>>;
}

export interface SignupOnboardingBroadcastInput {
  readonly signal?: AbortSignal;
  readonly context: SignupOnboardingContext;
  readonly registeredResponse: RegistrationResponse;
}

export interface SignupProductUserInfoInput {
  readonly signal?: AbortSignal;
  readonly context: SignupOnboardingContext;
  readonly identity: AuthIdentity;
}

export interface SignupWorkspaceReadInput {
  readonly signal?: AbortSignal;
  readonly context: SignupOnboardingContext;
  readonly userInfoResponse: CapcutHttpResponse<ProductUserInfoResponse>;
}

export interface SignupOnboardingInput {
  readonly accountId: string;
  readonly checkEmailBody: Record<string, string | number | boolean>;
  readonly sendCodeBody: Record<string, string | number | boolean>;
  prepareRegistration(input: SignupOnboardingRegistrationInput): Promise<{
    readonly body: Record<string, string | number | boolean>;
    readonly context: SignupOnboardingContext;
  }>;
  prepareBroadcast(input: SignupOnboardingBroadcastInput): Promise<{
    readonly body: Record<string, string | number | boolean>;
    readonly context: SignupOnboardingContext;
  }>;
  prepareProductUserInfo(input: SignupProductUserInfoInput): Promise<{
    readonly body: ProductUserInfoBody;
    readonly context: SignupOnboardingContext;
  }>;
  prepareWorkspaceRead(input: SignupWorkspaceReadInput): Promise<{
    readonly body: WorkspaceReadBody;
    readonly context: SignupOnboardingContext;
  }>;
  readonly initialContext: SignupOnboardingContext;
  readonly contextProvider: SignupRequestContextProvider;
  readonly deriveContext: DeriveSignupContext;
  readonly regionBody: Record<string, string | number | boolean>;
  readonly birthday: string;
  readonly region: string;
  readonly loginClient: HttpOnlyClient;
  readonly productClient: HttpOnlyClient;
  readonly accountClient: HttpOnlyClient;
  readonly signal?: AbortSignal;
}

export type SignupProductReadiness =
  | { readonly status: 'ready'; readonly workspaceCount: number }
  | {
    readonly status: 'blocked';
    readonly stage: 'user-info' | 'workspace';
    readonly reason: 'application-rejected' | 'identity-mismatch' | 'product-data-missing' | 'workspace-missing';
    readonly ret: number | null;
  };

export interface SignupOnboardingResult {
  readonly identity: AuthIdentity;
  readonly ageThreshold: number;
  readonly agePassed: true;
  readonly birthdayPersisted: true;
  readonly productReadiness: SignupProductReadiness;
  readonly context: SignupOnboardingContext;
}

function assertBody(value: unknown): asserts value is Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  for (const [key, child] of Object.entries(value)) {
    if (!key.trim() || /[\r\n\0]/.test(key) ||
      !['string', 'number', 'boolean'].includes(typeof child) ||
      (typeof child === 'string' && /[\r\n\0]/.test(child)) ||
      (typeof child === 'number' && !Number.isFinite(child))) {
      throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
    }
  }
}

function assertSuccess(response: { ok: boolean; data?: { message?: string } }, error: string): void {
  if (!response.ok || response.data?.message !== 'success') throw new Error(error);
}

function responseRet(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const ret = (value as { ret?: unknown }).ret;
  return typeof ret === 'number' || (typeof ret === 'string' && /^-?\d+$/.test(ret)) ? Number(ret) : null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function bodySnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function responseSnapshot<T>(response: CapcutHttpResponse<T>): CapcutHttpResponse<T> {
  return deepFreeze({
    status: response.status,
    ok: response.ok,
    data: structuredClone(response.data),
    ...(response.headers ? { headers: { ...response.headers } } : {}),
  });
}

function contextSnapshot(context: SignupOnboardingContext): SignupOnboardingContext {
  return deepFreeze({
    passport: {
      headers: { ...context.passport.headers },
      query: { ...context.passport.query },
    },
    product: {
      headers: { ...context.product.headers },
      query: { ...context.product.query },
    },
  });
}

function abortGate(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function snapshotQuery(context: SignupOnboardingContext, capability: SignupRequestCapability): Record<string, string | number | boolean> {
  return { ...(capability.context === 'passport' ? context.passport.query : context.product.query) };
}

interface SignupRunBoundary {
  readonly accountId: string;
  readonly provider: SignupRequestContextProvider;
  readonly providerAccountId: string;
  readonly supports: SignupRequestContextProvider['supports'];
  readonly prepare: SignupRequestContextProvider['prepare'];
  readonly signal?: AbortSignal;
}

function serializedBody(body: unknown, encoding: SignupRequestCapability['encoding']): string | undefined {
  if (encoding === 'none') return undefined;
  if (encoding === 'form') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('SIGNUP_CONTEXT_PROVIDER_INPUT_INVALID');
    return new URLSearchParams(Object.entries(body as Record<string, string | number | boolean>).map(([key, value]) => [key, String(value)])).toString();
  }
  return JSON.stringify(body === undefined ? {} : body);
}

function assertPreparedRequestContext(context: SignupOnboardingContext, capability: SignupRequestCapability): void {
  assertSignupOnboardingContextShape(context);
  if (capability.context === 'passport') {
    const signed = capability.operation === 'send-code' || capability.operation === 'register';
    assertAuthContext(context.passport, signed);
  } else {
    // Product signer values remain opaque; only the request helper's shape is checked here.
    assertSignupProductContext(context.product);
  }
}

async function prepareRequestContext(
  run: SignupRunBoundary,
  capability: SignupRequestCapability,
  context: SignupOnboardingContext,
  body: unknown,
): Promise<SignupOnboardingContext> {
  abortGate(run.signal);
  const session = contextSnapshot(context);
  const query = Object.freeze(snapshotQuery(context, capability));
  const request = Object.freeze({
    ...capability,
    accountId: run.accountId,
    body: serializedBody(body, capability.encoding),
    query,
    session,
    signal: run.signal,
  });
  let prepared: SignupOnboardingContext;
  try {
    prepared = await run.prepare(request);
  } catch {
    abortGate(run.signal);
    throw new Error('SIGNUP_CONTEXT_PROVIDER_FAILED');
  }
  abortGate(run.signal);
  if (run.provider.accountId !== run.providerAccountId || run.providerAccountId !== run.accountId) {
    throw new Error('SIGNUP_CONTEXT_PROVIDER_ACCOUNT_MISMATCH');
  }
  assertPreparedRequestContext(prepared, capability);
  return contextSnapshot(prepared);
}

function createRunBoundary(input: SignupOnboardingInput): SignupRunBoundary {
  const provider = input.contextProvider;
  const accountId = input.accountId;
  if (!provider) throw new Error('SIGNUP_CONTEXT_PROVIDER_REQUIRED');
  if (typeof provider.supports !== 'function' || typeof provider.prepare !== 'function') {
    throw new Error('SIGNUP_CONTEXT_PROVIDER_UNSUPPORTED');
  }
  if (typeof accountId !== 'string' || !accountId.trim() || provider.accountId !== accountId) {
    throw new Error('SIGNUP_CONTEXT_PROVIDER_ACCOUNT_MISMATCH');
  }
  return Object.freeze({
    accountId,
    provider,
    providerAccountId: provider.accountId,
    supports: provider.supports.bind(provider),
    prepare: provider.prepare.bind(provider),
    signal: input.signal,
  });
}

function preflightContextProvider(run: SignupRunBoundary): void {
  for (const capability of signupRequestCapabilities) {
    let supported: unknown;
    try { supported = run.supports(capability); } catch { throw new Error('SIGNUP_CONTEXT_PROVIDER_UNSUPPORTED'); }
    if (supported !== true) throw new Error('SIGNUP_CONTEXT_PROVIDER_UNSUPPORTED');
  }
}

function capability(operation: SignupRequestCapability['operation']): SignupRequestCapability {
  const found = signupRequestCapabilities.find(item => item.operation === operation);
  if (!found) throw new Error('SIGNUP_CONTEXT_PROVIDER_UNSUPPORTED');
  return found;
}

function advanceContext(
  deriveContext: DeriveSignupContext,
  stage: SignupContextStage,
  previous: SignupOnboardingContext,
  response: CapcutHttpResponse<unknown>,
  signal?: AbortSignal
): SignupOnboardingContext {
  abortGate(signal);
  const next = deriveContext({
    stage,
    previous: contextSnapshot(previous),
    response: responseSnapshot(response),
  });
  abortGate(signal);
  assertSignupOnboardingContextShape(next);
  return contextSnapshot(next);
}

function baseResult(
  identity: AuthIdentity,
  ageThreshold: number,
  productReadiness: SignupProductReadiness,
  context: SignupOnboardingContext
): SignupOnboardingResult {
  return deepFreeze({
    identity: { ...identity },
    ageThreshold,
    agePassed: true,
    birthdayPersisted: true,
    productReadiness,
    context: contextSnapshot(context),
  });
}

/** Captured signup + product onboarding sequence with explicit response-context boundaries. */
export async function signupHttpWithOnboarding(input: SignupOnboardingInput): Promise<SignupOnboardingResult> {
  const run = createRunBoundary(input);
  abortGate(run.signal);
  preflightContextProvider(run);
  const birthday = input.birthday;
  const region = input.region;
  const checkEmailBody = bodySnapshot(input.checkEmailBody);
  const sendCodeBody = bodySnapshot(input.sendCodeBody);
  const regionBody = bodySnapshot(input.regionBody);
  const loginClient = input.loginClient;
  const productClient = input.productClient;
  const accountClient = input.accountClient;
  const deriveContext = input.deriveContext;
  const prepareRegistration = input.prepareRegistration;
  const prepareBroadcast = input.prepareBroadcast;
  const prepareProductUserInfo = input.prepareProductUserInfo;
  const prepareWorkspaceRead = input.prepareWorkspaceRead;
  assertSignupBirthday(birthday);
  if (!/^[A-Z]{2}$/.test(region)) throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  for (const body of [checkEmailBody, sendCodeBody, regionBody]) assertBody(body);
  if (regionBody.type === undefined || regionBody.hashed_id === undefined ||
      checkEmailBody.email !== sendCodeBody.email) {
    throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  }
  assertSignupOnboardingContextShape(input.initialContext);

  let context = contextSnapshot(input.initialContext);
  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('region-row'), context, regionBody);
  const regionRow = responseSnapshot(await requestPassportRegion(loginClient, 'https://login-row.www.capcut.com', regionBody, context.passport, run.signal));
  abortGate(run.signal);
  assertSuccess(regionRow, 'SIGNUP_REGION_REJECTED');
  context = advanceContext(deriveContext, 'region-row', context, regionRow, run.signal);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('region-us'), context, regionBody);
  const regionUs = responseSnapshot(await requestPassportRegion(loginClient, 'https://login.us.capcut.com', regionBody, context.passport, run.signal));
  abortGate(run.signal);
  assertSuccess(regionUs, 'SIGNUP_REGION_REJECTED');
  context = advanceContext(deriveContext, 'region-us', context, regionUs, run.signal);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('email-check'), context, checkEmailBody);
  const checked = responseSnapshot(await checkEmailRegistered(loginClient, checkEmailBody, context.passport, run.signal, signupOrigins.loginRow));
  abortGate(run.signal);
  if (!checked.ok || checked.data?.message !== 'success' || checked.data.data?.is_registered !== 0) {
    throw new Error(checked.data?.data?.is_registered === 1 ? 'AUTH_EMAIL_ALREADY_REGISTERED' : 'AUTH_EMAIL_CHECK_REJECTED');
  }
  context = advanceContext(deriveContext, 'email-check', context, checked, run.signal);

  abortGate(run.signal);
  const ageConfigBody = bodySnapshot({});
  context = await prepareRequestContext(run, capability('age-config'), context, ageConfigBody);
  const ageConfig = responseSnapshot(await readAgeGateConfig(productClient, context.product, run.signal));
  abortGate(run.signal);
  const ageThreshold = ageConfig.ok && responseRet(ageConfig.data) === 0 && typeof ageConfig.data.data?.age_threshold === 'number' && Number.isFinite(ageConfig.data.data.age_threshold) && ageConfig.data.data.age_threshold > 0
    ? ageConfig.data.data.age_threshold : null;
  if (ageThreshold === null) throw new Error('SIGNUP_AGE_CONFIG_REJECTED');
  context = advanceContext(deriveContext, 'age-config', context, ageConfig, run.signal);

  abortGate(run.signal);
  const ageCheckBody = bodySnapshot({ birthday });
  context = await prepareRequestContext(run, capability('age-check'), context, ageCheckBody);
  const ageCheck = responseSnapshot(await checkAgeWithoutUid(productClient, birthday, context.product, run.signal));
  abortGate(run.signal);
  if (!ageCheck.ok || responseRet(ageCheck.data) !== 0 || ageCheck.data.data?.passed !== true) throw new Error('SIGNUP_AGE_CHECK_REJECTED');
  context = advanceContext(deriveContext, 'age-check', context, ageCheck, run.signal);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('send-code'), context, sendCodeBody);
  const sent = responseSnapshot(await sendEmailCode(loginClient, sendCodeBody, context.passport, run.signal, signupOrigins.loginRow));
  abortGate(run.signal);
  if (!sent.ok || sent.data?.message !== 'success') throw new Error('AUTH_SEND_CODE_REJECTED');
  context = advanceContext(deriveContext, 'send-code', context, sent, run.signal);

  abortGate(run.signal);
  const registration = await prepareRegistration({
    signal: run.signal,
    context: contextSnapshot(context),
    sendCodeResponse: sent,
  });
  abortGate(run.signal);
  const registrationBody = bodySnapshot(registration.body);
  assertBody(registrationBody);
  if (registrationBody.birthday !== birthday ||
      registrationBody.email !== sendCodeBody.email ||
      registrationBody.password !== sendCodeBody.password) {
    throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  }
  assertSignupOnboardingContextShape(registration.context);
  context = contextSnapshot(registration.context);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('register'), context, registrationBody);
  const registered = responseSnapshot(await registerVerifyLogin(loginClient, registrationBody, context.passport, run.signal, signupOrigins.loginRow));
  abortGate(run.signal);
  context = advanceContext(deriveContext, 'register', context, registered, run.signal);

  abortGate(run.signal);
  const broadcast = await prepareBroadcast({
    signal: run.signal,
    context: contextSnapshot(context),
    registeredResponse: registered,
  });
  abortGate(run.signal);
  const broadcastBody = bodySnapshot(broadcast.body);
  assertBody(broadcastBody);
  const registeredData = registered.data.data;
  if (broadcastBody.final_domain === undefined || broadcastBody.hashed_id === undefined ||
      typeof registeredData?.sec_user_id !== 'string' || typeof registeredData.screen_name !== 'string' ||
      broadcastBody.sec_uid !== registeredData.sec_user_id || broadcastBody.screen_name !== registeredData.screen_name) {
    throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  }
  assertSignupOnboardingContextShape(broadcast.context);
  context = contextSnapshot(broadcast.context);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('broadcast-row'), context, broadcastBody);
  const broadcastRow = responseSnapshot(await broadcastPassportAuth(loginClient, 'https://login-row.www.capcut.com', broadcastBody, context.passport, run.signal));
  abortGate(run.signal);
  assertSuccess(broadcastRow, 'SIGNUP_BROADCAST_REJECTED');
  context = advanceContext(deriveContext, 'broadcast-row', context, broadcastRow, run.signal);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('broadcast-us'), context, broadcastBody);
  const broadcastUs = responseSnapshot(await broadcastPassportAuth(loginClient, 'https://login.us.capcut.com', broadcastBody, context.passport, run.signal));
  abortGate(run.signal);
  assertSuccess(broadcastUs, 'SIGNUP_BROADCAST_REJECTED');
  context = advanceContext(deriveContext, 'broadcast-us', context, broadcastUs, run.signal);

  abortGate(run.signal);
  const birthdayBody = bodySnapshot({ birthday });
  context = await prepareRequestContext(run, capability('birthday-persist'), context, birthdayBody);
  const persisted = responseSnapshot(await persistBirthdayByUid(productClient, birthday, region, context.product, run.signal));
  abortGate(run.signal);
  if (!persisted.ok || responseRet(persisted.data) !== 0 || persisted.data.base_resp?.StatusCode !== 0) throw new Error('SIGNUP_BIRTHDAY_PERSIST_REJECTED');
  context = advanceContext(deriveContext, 'birthday-persist', context, persisted, run.signal);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('account-info'), context, undefined);
  const account = responseSnapshot(await accountClient.requestJson<{ message?: string; data?: { user_id_str?: string; session_key?: string; email?: string } }>({
    origin: 'https://www.capcut.com',
    path: '/passport/web/account/info/',
    method: 'GET',
    effect: 'read',
    headers: Object.fromEntries(Object.entries(context.passport.headers).filter(([name]) =>
      !['cookie', 'content-type'].includes(name.toLowerCase()))),
    query: context.passport.query,
    signal: run.signal,
  }));
  abortGate(run.signal);
  if (!account.ok || account.data?.message !== 'success' || !account.data.data?.user_id_str) throw new Error('AUTH_ACCOUNT_INFO_REJECTED');
  if (account.data.data.user_id_str !== registered.data.data?.user_id_str) throw new Error('AUTH_ACCOUNT_IDENTITY_MISMATCH');
  context = advanceContext(deriveContext, 'account-info', context, account, run.signal);
  const identity: AuthIdentity = {
    userId: account.data.data.user_id_str,
    ...(account.data.data.session_key ? { sessionKey: account.data.data.session_key } : {}),
    ...(account.data.data.email ? { email: account.data.data.email } : {}),
  };

  abortGate(run.signal);
  const userInfoInput = await prepareProductUserInfo({
    signal: run.signal,
    context: contextSnapshot(context),
    identity: deepFreeze({ ...identity }),
  });
  abortGate(run.signal);
  const userInfoBody = bodySnapshot(userInfoInput.body);
  assertProductUserInfoBody(userInfoBody);
  assertSignupOnboardingContextShape(userInfoInput.context);
  context = contextSnapshot(userInfoInput.context);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('product-user-info'), context, userInfoBody);
  const userInfo = responseSnapshot(await readProductUserInfo(productClient, userInfoBody, context.product, run.signal));
  abortGate(run.signal);
  if (!userInfo.ok) throw new Error('SIGNUP_PRODUCT_USER_INFO_HTTP_REJECTED');
  context = advanceContext(deriveContext, 'product-user-info', context, userInfo, run.signal);
  const userInfoRet = responseRet(userInfo.data);
  if (userInfoRet !== 0) {
    return baseResult(identity, ageThreshold, {
      status: 'blocked',
      stage: 'user-info',
      reason: 'application-rejected',
      ret: userInfoRet,
    }, context);
  }
  const productUser = userInfo.data.data?.user_info;
  if (!productUser?.user_id) {
    return baseResult(identity, ageThreshold, {
      status: 'blocked',
      stage: 'user-info',
      reason: 'product-data-missing',
      ret: userInfoRet,
    }, context);
  }
  if (productUser.user_id !== identity.userId) {
    return baseResult(identity, ageThreshold, {
      status: 'blocked',
      stage: 'user-info',
      reason: 'identity-mismatch',
      ret: userInfoRet,
    }, context);
  }

  abortGate(run.signal);
  const workspaceInput = await prepareWorkspaceRead({
    signal: run.signal,
    context: contextSnapshot(context),
    userInfoResponse: userInfo,
  });
  abortGate(run.signal);
  const workspaceBody = bodySnapshot(workspaceInput.body);
  assertWorkspaceReadBody(workspaceBody);
  assertSignupOnboardingContextShape(workspaceInput.context);
  context = contextSnapshot(workspaceInput.context);

  abortGate(run.signal);
  context = await prepareRequestContext(run, capability('workspace'), context, workspaceBody);
  const workspaces = responseSnapshot(await readUserWorkspaces(productClient, workspaceBody, context.product, run.signal));
  abortGate(run.signal);
  if (!workspaces.ok) throw new Error('SIGNUP_WORKSPACE_HTTP_REJECTED');
  context = advanceContext(deriveContext, 'workspace', context, workspaces, run.signal);
  const workspaceRet = responseRet(workspaces.data);
  if (workspaceRet !== 0) {
    return baseResult(identity, ageThreshold, {
      status: 'blocked',
      stage: 'workspace',
      reason: 'application-rejected',
      ret: workspaceRet,
    }, context);
  }
  const workspaceInfos = Array.isArray(workspaces.data.data?.workspace_infos) ? workspaces.data.data.workspace_infos : [];
  const workspaceCount = workspaceInfos.filter(workspace =>
    workspace && typeof workspace.workspace_id === 'string' && workspace.workspace_id.trim()).length;
  if (workspaceCount === 0) {
    return baseResult(identity, ageThreshold, {
      status: 'blocked',
      stage: 'workspace',
      reason: 'workspace-missing',
      ret: workspaceRet,
    }, context);
  }
  return baseResult(identity, ageThreshold, { status: 'ready', workspaceCount }, context);
}
