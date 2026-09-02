import type { SanitizedDiagnosticResult } from '../../shared/schemas/diagnostics.schema';

export type ProviderErrorCode = SanitizedDiagnosticResult['code'];

/**
 * Normalized provider failure. The message is user-facing and must never carry
 * credentials, tokens, or raw vendor payloads (AGENTS.md §13, §27).
 */
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly serviceName?: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  toDiagnostic(timestamp: string): SanitizedDiagnosticResult {
    return { code: this.code, message: this.message, timestamp };
  }
}

export function statusToProviderCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 404 || status === 422) return 'CONFIG_ERROR';
  return 'NETWORK_ERROR';
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readString(source: Record<string, unknown> | null, key: string): string | null {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readNumber(source: Record<string, unknown> | null, key: string): number | null {
  if (!source) return null;
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
  if (!source) return null;
  const value = source[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}
