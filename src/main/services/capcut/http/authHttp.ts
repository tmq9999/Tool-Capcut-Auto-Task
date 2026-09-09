import type { CapcutHttpResponse } from './httpTypes';
import type { HttpOnlyClient } from './httpTypes';

export interface AuthRequestContext {
  headers: Record<string, string>;
  query: Record<string, string | number | boolean>;
}

export interface AuthIdentity { userId: string; sessionKey?: string; email?: string; }

export function assertAuthContext(context: AuthRequestContext, signed = false, _authenticated = false): void {
  requireDynamic(context);
  if (signed && (!context.query.msToken || !context.query['X-Bogus'] || !context.query['X-Gnarly'])) {
    throw new Error('AUTH_SIGNATURE_CONTEXT_MISSING');
  }
}

function authHeaders(context: AuthRequestContext): Record<string, string> {
  return Object.fromEntries(Object.entries(context.headers).filter(([name]) => name.toLowerCase() !== 'cookie'));
}

function requireDynamic(context: AuthRequestContext): void {
  if (!context.headers['content-type']?.includes('application/x-www-form-urlencoded')) throw new Error('AUTH_FORM_ENCODING_REQUIRED');
  if (!context.query.aid || !context.query.webid) throw new Error('AUTH_QUERY_CONTEXT_MISSING');
}

async function form<T>(client: HttpOnlyClient, path: string, body: Record<string, string | number | boolean>, context: AuthRequestContext, signal?: AbortSignal, origin?: string): Promise<CapcutHttpResponse<T>> {
  assertAuthContext(context, path.endsWith('/send_code/') || path.endsWith('/register_verify_login/'));
  return client.requestForm<T>({ ...(origin ? { origin } : {}), path, method: 'POST', form: body, headers: authHeaders(context), query: context.query, effect: 'mutation', signal });
}

export async function checkEmailRegistered(client: HttpOnlyClient, body: Record<string, string | number | boolean>, context: AuthRequestContext, signal?: AbortSignal, origin?: string) {
  // Wire credentials may be encoded by the passport contract, not plain email.
  if (typeof body.email !== 'string' || !body.email.trim()) throw new Error('AUTH_EMAIL_INVALID');
  return form<{ message?: string; data?: { is_registered?: number } }>(client, '/passport/web/user/check_email_registered', body, context, signal, origin);
}

export async function sendEmailCode(client: HttpOnlyClient, body: Record<string, string | number | boolean>, context: AuthRequestContext, signal?: AbortSignal, origin?: string) {
  if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new Error('AUTH_CREDENTIAL_INPUT_MISSING');
  return form<{ message?: string; data?: { email_ticket?: string } }>(client, '/passport/web/email/send_code/', body, context, signal, origin);
}

export async function registerVerifyLogin(client: HttpOnlyClient, body: Record<string, string | number | boolean>, context: AuthRequestContext, signal?: AbortSignal, origin?: string): Promise<CapcutHttpResponse<{ message?: string; data?: { user_id_str?: string; session_key?: string; email?: string; sec_user_id?: string; screen_name?: string } }>> {
  if (typeof body.email !== 'string' || typeof body.code !== 'string' || !body.code) throw new Error('AUTH_VERIFICATION_INPUT_MISSING');
  const response = await form<{ message?: string; data?: { user_id_str?: string; session_key?: string; email?: string; sec_user_id?: string; screen_name?: string } }>(client, '/passport/web/email/register_verify_login/', body, context, signal, origin);
  if (!response.ok || response.data?.message !== 'success' || !response.data.data?.user_id_str) throw new Error('AUTH_REGISTER_REJECTED');
  return response;
}

export async function readAuthenticatedAccount(client: HttpOnlyClient, context: AuthRequestContext, signal?: AbortSignal): Promise<AuthIdentity> {
  assertAuthContext(context, false, true);
  const response = await client.requestJson<{ message?: string; data?: { user_id_str?: string; session_key?: string; email?: string } }>({
    path: '/passport/web/account/info/', method: 'GET', headers: authHeaders(context), query: context.query, effect: 'read', signal
  });
  const data = response.data.data;
  if (!response.ok || response.data?.message !== 'success' || !data?.user_id_str) throw new Error('AUTH_ACCOUNT_INFO_REJECTED');
  return { userId: data.user_id_str, ...(data.session_key ? { sessionKey: data.session_key } : {}), ...(data.email ? { email: data.email } : {}) };
}
