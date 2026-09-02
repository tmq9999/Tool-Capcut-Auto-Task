import type { SanitizedDiagnosticResult } from '../schemas/diagnostics.schema';

export interface BaseProfileInfo {
  id: string;
  name: string;
  rawStatus?: string;
}

export interface IProviderConnectivity {
  testConnection(): Promise<SanitizedDiagnosticResult>;
}

export interface IBalanceProvider {
  checkBalance(): Promise<number>;
}

export interface IProfileListProvider {
  listProfiles(): Promise<BaseProfileInfo[]>;
}

export interface IProxyCheckProvider {
  getCurrentProxy(key: string): Promise<string>;
}
