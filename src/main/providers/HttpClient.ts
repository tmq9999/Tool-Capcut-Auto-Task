export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** JSON request body. Serialized by the client. */
  json?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  /** Parsed JSON when the payload was JSON, otherwise null. */
  body: unknown;
  rawText: string;
}

export interface HttpClient {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export class HttpTransportError extends Error {
  public readonly code = 'ERR_HTTP_TRANSPORT';

  constructor(message: string) {
    super(message);
    this.name = 'HttpTransportError';
  }
}

/**
 * fetch-based transport. Bodies are parsed defensively: a non-JSON payload
 * yields body === null with rawText preserved for diagnostics.
 * Request headers are never logged by this class.
 */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(request.headers ?? {})
      };
      if (request.json !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers,
        body: request.json === undefined ? undefined : JSON.stringify(request.json),
        signal: controller.signal
      });

      const rawText = await response.text();
      let body: unknown = null;
      if (rawText.length > 0) {
        try {
          body = JSON.parse(rawText);
        } catch {
          body = null;
        }
      }

      return { status: response.status, ok: response.ok, body, rawText };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new HttpTransportError('Request timed out after ' + timeoutMs + 'ms');
      }
      throw new HttpTransportError('Network request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
