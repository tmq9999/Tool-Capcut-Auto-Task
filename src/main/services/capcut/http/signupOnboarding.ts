import { assertAuthContext, type AuthRequestContext } from './authHttp';
import type { CapcutHttpResponse, HttpOnlyClient } from './httpTypes';

export type SignupContextStage =
  | 'region-row'
  | 'region-us'
  | 'email-check'
  | 'age-config'
  | 'age-check'
  | 'send-code'
  | 'register'
  | 'broadcast-row'
  | 'broadcast-us'
  | 'birthday-persist'
  | 'account-info'
  | 'product-user-info'
  | 'workspace';

export interface SignupProductRequestContext {
  readonly headers: Record<string, string>;
  /** Exact caller-prepared query for the signed product request. */
  readonly query: Record<string, string | number | boolean>;
}

export interface SignupOnboardingContext {
  readonly passport: AuthRequestContext;
  readonly product: SignupProductRequestContext;
}

export type SignupRequestOperation = SignupContextStage | 'region-row' | 'region-us';

export interface SignupRequestCapability {
  readonly operation: SignupRequestOperation;
  readonly origin: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly encoding: 'form' | 'json' | 'none';
  readonly context: 'passport' | 'product';
}

export interface SignupRequestPreparation extends SignupRequestCapability {
  readonly accountId: string;
  readonly body?: string;
  readonly query: Readonly<Record<string, string | number | boolean>>;
  readonly session: SignupOnboardingContext;
  readonly signal?: AbortSignal;
}

/** Caller-owned source of current opaque request context; it does not sign or dispatch here. */
export interface SignupRequestContextProvider {
  readonly accountId: string;
  supports(capability: SignupRequestCapability): boolean;
  prepare(request: SignupRequestPreparation): Promise<SignupOnboardingContext>;
}

export interface SignupResponseContextInput {
  readonly stage: SignupContextStage;
  readonly previous: SignupOnboardingContext;
  readonly response: CapcutHttpResponse<unknown>;
}

export type DeriveSignupContext = (input: SignupResponseContextInput) => SignupOnboardingContext;

export interface ProductUserInfoBody {
  readonly sem_info: {
    readonly is_sem: boolean;
    readonly medium: string;
    readonly register_source: string;
    readonly register_second_source: string;
  };
}

export interface ProductUserInfoResponse {
  readonly ret?: string | number;
  readonly errmsg?: string;
  readonly data?: {
    readonly user_info?: {
      readonly user_id?: string;
      readonly has_birthday?: boolean;
    };
    readonly space_info?: { readonly workspace_id?: string };
  };
}

export interface WorkspaceReadBody {
  readonly cursor: string;
  readonly count: number;
  readonly need_convert_workspace: boolean;
}

export interface WorkspaceReadResponse {
  readonly ret?: string | number;
  readonly errmsg?: string;
  readonly data?: {
    readonly workspace_infos?: readonly { readonly workspace_id?: string }[];
    readonly has_more?: boolean;
    readonly next_cursor?: string;
  };
}

const LOGIN_ROW = 'https://login-row.www.capcut.com';
const LOGIN_US = 'https://login.us.capcut.com';
const WEB = 'https://www.capcut.com';
const EDIT = 'https://edit-api-sg.capcut.com';

export const signupRequestCapabilities: readonly SignupRequestCapability[] = Object.freeze([
  { operation: 'region-row', origin: LOGIN_ROW, method: 'POST', path: '/passport/web/region/', encoding: 'form', context: 'passport' },
  { operation: 'region-us', origin: LOGIN_US, method: 'POST', path: '/passport/web/region/', encoding: 'form', context: 'passport' },
  { operation: 'email-check', origin: LOGIN_ROW, method: 'POST', path: '/passport/web/user/check_email_registered', encoding: 'form', context: 'passport' },
  { operation: 'age-config', origin: WEB, method: 'POST', path: '/lv/v1/sc/age_gate/get_age_gate_config', encoding: 'json', context: 'product' },
  { operation: 'age-check', origin: WEB, method: 'POST', path: '/lv/v1/sc/age_gate/check_age_without_uid', encoding: 'json', context: 'product' },
  { operation: 'send-code', origin: LOGIN_ROW, method: 'POST', path: '/passport/web/email/send_code/', encoding: 'form', context: 'passport' },
  { operation: 'register', origin: LOGIN_ROW, method: 'POST', path: '/passport/web/email/register_verify_login/', encoding: 'form', context: 'passport' },
  { operation: 'broadcast-row', origin: LOGIN_ROW, method: 'POST', path: '/passport/web/auth_broadcast/', encoding: 'form', context: 'passport' },
  { operation: 'broadcast-us', origin: LOGIN_US, method: 'POST', path: '/passport/web/auth_broadcast/', encoding: 'form', context: 'passport' },
  { operation: 'birthday-persist', origin: WEB, method: 'POST', path: '/lv/v1/sc/age_gate/set_birthday_by_uid', encoding: 'json', context: 'product' },
  { operation: 'account-info', origin: WEB, method: 'GET', path: '/passport/web/account/info/', encoding: 'none', context: 'passport' },
  { operation: 'product-user-info', origin: WEB, method: 'POST', path: '/lv/v1/user/web/user_info', encoding: 'json', context: 'product' },
  { operation: 'workspace', origin: EDIT, method: 'POST', path: '/cc/v1/workspace/get_user_workspaces', encoding: 'json', context: 'product' },
].map(capability => Object.freeze(capability)) as readonly SignupRequestCapability[]);

function withoutHeaders(headers: Record<string, string>, omitted: readonly string[]): Record<string, string> {
  const names = new Set(omitted.map(name => name.toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !names.has(name.toLowerCase())));
}

function passportHeaders(headers: Record<string, string>): Record<string, string> {
  return withoutHeaders(headers, ['cookie']);
}

function productHeaders(headers: Record<string, string>): Record<string, string> {
  return withoutHeaders(headers, ['cookie', 'content-type']);
}

function requireText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  }
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
}

export function assertSignupBirthday(value: unknown): asserts value is string {
  requireText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  }
}

export function assertSignupProductContext(context: SignupProductRequestContext): void {
  assertRecord(context);
  assertRecord(context.headers);
  assertRecord(context.query);
  for (const name of ['sign', 'sign-ver', 'device-time']) requireText(context.headers[name]);
}

export function assertSignupOnboardingContext(context: SignupOnboardingContext): void {
  assertRecord(context);
  assertAuthContext(context.passport, true);
  assertSignupProductContext(context.product);
}

/** Validates only the transport/session shape; request-specific signer fields are provider-owned. */
export function assertSignupOnboardingContextShape(context: SignupOnboardingContext): void {
  assertRecord(context);
  assertRecord(context.passport);
  assertRecord(context.passport.headers);
  assertRecord(context.passport.query);
  assertRecord(context.product);
  assertRecord(context.product.headers);
  assertRecord(context.product.query);
}

export function assertDerivedSignupContext(context: SignupOnboardingContext): void {
  try {
    assertSignupOnboardingContext(context);
  } catch {
    throw new Error('SIGNUP_CONTEXT_INVALID');
  }
}

export function assertProductUserInfoBody(body: ProductUserInfoBody): void {
  assertRecord(body);
  assertRecord(body.sem_info);
  if (typeof body.sem_info.is_sem !== 'boolean') throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  for (const value of [body.sem_info.medium, body.sem_info.register_source, body.sem_info.register_second_source]) {
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  }
}

export function assertWorkspaceReadBody(body: WorkspaceReadBody): void {
  assertRecord(body);
  if (typeof body.cursor !== 'string' || /[\r\n\0]/.test(body.cursor) ||
      !Number.isSafeInteger(body.count) || body.count <= 0 ||
      typeof body.need_convert_workspace !== 'boolean') {
    throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  }
}

export async function requestPassportRegion(
  client: HttpOnlyClient,
  origin: typeof LOGIN_ROW | typeof LOGIN_US,
  body: Record<string, string | number | boolean>,
  context: AuthRequestContext,
  signal?: AbortSignal
): Promise<CapcutHttpResponse<{ message?: string; data?: unknown }>> {
  assertAuthContext(context);
  return client.requestForm({
    origin,
    path: '/passport/web/region/',
    method: 'POST',
    effect: 'mutation',
    form: body,
    headers: passportHeaders(context.headers),
    query: context.query,
    signal,
  });
}

export async function broadcastPassportAuth(
  client: HttpOnlyClient,
  origin: typeof LOGIN_ROW | typeof LOGIN_US,
  body: Record<string, string | number | boolean>,
  context: AuthRequestContext,
  signal?: AbortSignal
): Promise<CapcutHttpResponse<{ message?: string; data?: unknown }>> {
  assertAuthContext(context);
  return client.requestForm({
    origin,
    path: '/passport/web/auth_broadcast/',
    method: 'POST',
    effect: 'mutation',
    form: body,
    headers: passportHeaders(context.headers),
    query: context.query,
    signal,
  });
}

export async function readAgeGateConfig(
  client: HttpOnlyClient,
  context: SignupProductRequestContext,
  signal?: AbortSignal
): Promise<CapcutHttpResponse<{ ret?: string | number; data?: { age_threshold?: number } }>> {
  assertSignupProductContext(context);
  return client.requestJson({
    origin: WEB,
    path: '/lv/v1/sc/age_gate/get_age_gate_config',
    method: 'POST',
    effect: 'read',
    body: {},
    headers: productHeaders(context.headers),
    query: context.query,
    signal,
  });
}

export async function checkAgeWithoutUid(
  client: HttpOnlyClient,
  birthday: string,
  context: SignupProductRequestContext,
  signal?: AbortSignal
): Promise<CapcutHttpResponse<{ ret?: string | number; data?: { passed?: boolean; age_threshold?: number } }>> {
  assertSignupBirthday(birthday);
  assertSignupProductContext(context);
  return client.requestJson({
    origin: WEB,
    path: '/lv/v1/sc/age_gate/check_age_without_uid',
    method: 'POST',
    effect: 'read',
    body: { birthday },
    headers: productHeaders(context.headers),
    query: context.query,
    signal,
  });
}

export async function persistBirthdayByUid(
  client: HttpOnlyClient,
  birthday: string,
  region: string,
  context: SignupProductRequestContext,
  signal?: AbortSignal
): Promise<CapcutHttpResponse<{ ret?: string | number; base_resp?: { StatusCode?: number } }>> {
  assertSignupBirthday(birthday);
  if (!/^[A-Z]{2}$/.test(region)) throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  assertSignupProductContext(context);
  if (context.query.region !== region) throw new Error('SIGNUP_ONBOARDING_INPUT_INVALID');
  return client.requestJson({
    origin: WEB,
    path: '/lv/v1/sc/age_gate/set_birthday_by_uid',
    method: 'POST',
    effect: 'mutation',
    body: { birthday },
    headers: productHeaders(context.headers),
    query: context.query,
    signal,
  });
}

export async function readProductUserInfo(
  client: HttpOnlyClient,
  body: ProductUserInfoBody,
  context: SignupProductRequestContext,
  signal?: AbortSignal
): Promise<CapcutHttpResponse<ProductUserInfoResponse>> {
  assertProductUserInfoBody(body);
  assertSignupProductContext(context);
  return client.requestJson({
    origin: WEB,
    path: '/lv/v1/user/web/user_info',
    method: 'POST',
    effect: 'read',
    body,
    headers: productHeaders(context.headers),
    query: context.query,
    signal,
  });
}

export async function readUserWorkspaces(
  client: HttpOnlyClient,
  body: WorkspaceReadBody,
  context: SignupProductRequestContext,
  signal?: AbortSignal
): Promise<CapcutHttpResponse<WorkspaceReadResponse>> {
  assertWorkspaceReadBody(body);
  assertSignupProductContext(context);
  return client.requestJson({
    origin: EDIT,
    path: '/cc/v1/workspace/get_user_workspaces',
    method: 'POST',
    effect: 'read',
    body,
    headers: productHeaders(context.headers),
    query: context.query,
    signal,
  });
}

export const signupOrigins = Object.freeze({ loginRow: LOGIN_ROW, loginUs: LOGIN_US, web: WEB, edit: EDIT });
