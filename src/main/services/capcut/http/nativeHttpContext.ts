import type { Buffer } from 'node:buffer';

export interface NativeHttpHeader {
  name: string;
  value: string;
}

export type NativeHttpHeaders = Readonly<Record<string, string>>;

export type NativeHttpRequestBody = string | URLSearchParams | Buffer | Uint8Array;

export interface NativeHttpRequestOptions {
  method?: string;
  headers?: Readonly<Record<string, string>>;
  data?: NativeHttpRequestBody;
  params?: URLSearchParams | Readonly<Record<string, string | number | boolean>>;
  signal?: AbortSignal;
  timeout?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxRetries?: number;
}

export interface NativeHttpResponse {
  status(): number;
  ok(): boolean;
  headers(): NativeHttpHeaders;
  headersArray(): readonly NativeHttpHeader[];
  body(): Promise<Buffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface NativeHttpStreamResponse {
  status(): number;
  ok(): boolean;
  headers(): NativeHttpHeaders;
  headersArray(): readonly NativeHttpHeader[];
  readonly body: AsyncIterable<Buffer>;
  dispose(): Promise<void>;
}

export interface NativeHttpContext {
  readonly transport: 'cycletls';
  fetch(url: string, options?: NativeHttpRequestOptions): Promise<NativeHttpResponse>;
  get(url: string, options?: Omit<NativeHttpRequestOptions, 'method'>): Promise<NativeHttpResponse>;
  stream(url: string, options?: NativeHttpRequestOptions): Promise<NativeHttpStreamResponse>;
  dispose(): Promise<void>;
}
