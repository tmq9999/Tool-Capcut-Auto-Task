export interface CapcutHttpResponse<T> {
  status: number;
  ok: boolean;
  data: T;
  headers?: Readonly<Record<string, string>>;
}

export interface CapcutHttpTextResponse {
  status: number;
  ok: boolean;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface CapcutHttpRequest {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  effect?: 'read' | 'mutation';
}

export interface CapcutHttpFormRequest extends Omit<CapcutHttpRequest, 'body'> {
  form: Record<string, string | number | boolean>;
}

export interface HttpJsonClient {
  requestJson<T>(request: CapcutHttpRequest & { origin?: string }): Promise<CapcutHttpResponse<T>>;
}

export interface HttpTextClient extends HttpJsonClient {
  requestText(request: CapcutHttpRequest & { origin?: string }): Promise<CapcutHttpTextResponse>;
}

export interface HttpFormClient {
  requestForm<T>(request: CapcutHttpFormRequest & { origin?: string }): Promise<CapcutHttpResponse<T>>;
}

export interface HttpOnlyClient extends HttpJsonClient, HttpTextClient, HttpFormClient {}

export interface HttpStreamResponse {
  status: number;
  ok: boolean;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
  dispose(): Promise<void>;
}

export interface HttpStreamClient extends HttpOnlyClient {
  requestStream(request: CapcutHttpRequest & { origin?: string; deadlineMs?: number; maxBytes?: number }): Promise<HttpStreamResponse>;
}
