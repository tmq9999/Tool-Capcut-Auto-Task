import type { SanitizedDiagnosticResult } from '../../shared/schemas/diagnostics.schema';
import type { IProviderRegistry } from './ServiceConnectionManager';

/** Minimum surface a service must expose to be testable from Settings. */
export interface ConnectivityProvider {
  testConnection(draft?: unknown): Promise<SanitizedDiagnosticResult>;
}

export function isConnectivityProvider(candidate: unknown): candidate is ConnectivityProvider {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { testConnection?: unknown }).testConnection === 'function'
  );
}

/**
 * Maps a service name to its connectivity probe. Services that have not been
 * implemented yet are simply absent, which keeps ServiceConnectionManager
 * answering PROVIDER_NOT_IMPLEMENTED for them.
 */
export class ProviderRegistry implements IProviderRegistry {
  constructor(private readonly factories: Map<string, () => ConnectivityProvider>) {}

  get(serviceName: string): ConnectivityProvider | undefined {
    const factory = this.factories.get(serviceName);
    return factory ? factory() : undefined;
  }

  has(serviceName: string): boolean {
    return this.factories.has(serviceName);
  }

  registeredServices(): string[] {
    return Array.from(this.factories.keys());
  }
}
