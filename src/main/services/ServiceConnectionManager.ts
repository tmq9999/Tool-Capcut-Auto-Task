import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import type {
  CredentialDiagnosticMetadata,
  CredentialStatusDTO,
  DiagnosticStatus,
  SanitizedDiagnosticResult,
} from '../../shared/schemas/diagnostics.schema';
import { ProviderError } from '../providers/ProviderError';
import { isConnectivityProvider } from './ProviderRegistry';

export interface IProviderRegistry {
  get(serviceName: string): unknown | undefined;
  has(serviceName: string): boolean;
}

export class EmptyProviderRegistry implements IProviderRegistry {
  get(_serviceName: string): undefined {
    return undefined;
  }
  has(_serviceName: string): boolean {
    return false;
  }
}

export interface ClockProvider {
  now(): number;
}

export type StatusPublisher = (statuses: CredentialStatusDTO[]) => void;

const KNOWN_SERVICES = ['gmail94', 'multilogin', 'kiotproxy', 'dongvanfb', 'gologin'] as const;
const STALE_THRESHOLD_MS = 86_400_000; // 24 hours

export class ServiceConnectionManager {
  constructor(
    private readonly credRepo: CredentialRepository,
    _vault: ICredentialVault,
    private readonly providerRegistry: IProviderRegistry,
    private readonly clock: ClockProvider = { now: () => Date.now() },
    private readonly statusPublisher?: StatusPublisher
  ) {}

  getDiagnosticStatuses(): CredentialStatusDTO[] {
    const allCreds = this.credRepo.getAllCredentials();
    const credMap = new Map(allCreds.map((c) => [c.serviceName, c]));

    const now = this.clock.now();
    const statuses: CredentialStatusDTO[] = KNOWN_SERVICES.map((serviceName) => {
      const cred = credMap.get(serviceName);
      if (!cred) {
        return {
          serviceName,
          isConfigured: false,
          isStale: false,
          metadata: {
            maskedHint: '••••••••',
            status: 'unknown',
          },
        };
      }

      const lastTestedAtMs = cred.metadata.lastTestedAt
        ? new Date(cred.metadata.lastTestedAt).getTime()
        : null;

      const isStale = lastTestedAtMs !== null && !isNaN(lastTestedAtMs)
        ? now - lastTestedAtMs > STALE_THRESHOLD_MS
        : false;

      return {
        serviceName,
        isConfigured: true,
        isStale,
        metadata: cred.metadata,
      };
    });

    if (this.statusPublisher) {
      this.statusPublisher(statuses);
    }

    return statuses;
  }

  private static toDiagnosticStatus(code: SanitizedDiagnosticResult['code']): DiagnosticStatus {
    if (code === 'OK') return 'connected';
    if (code === 'RATE_LIMITED') return 'degraded';
    return 'offline';
  }

  /**
   * Runs the registered probe for a service, caches the sanitized outcome on the
   * credential row, and republishes statuses so the UI reflects reality. A
   * service without a probe is reported as not implemented and its cached
   * metadata is left untouched.
   */
  async testConnection(
    serviceName: string,
    draftSecret?: string,
    multiloginDraft?: {
      mode: 'token' | 'credentials';
      automationToken?: string;
      email?: string;
      password?: string;
    }
  ): Promise<SanitizedDiagnosticResult> {
    const timestamp = new Date(this.clock.now()).toISOString();
    const provider = this.providerRegistry.get(serviceName);

    if (!isConnectivityProvider(provider)) {
      return {
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message: 'Dịch vụ chưa được hỗ trợ trong phiên bản hiện tại.',
        timestamp,
      };
    }

    const isDraft = typeof draftSecret === 'string' || multiloginDraft !== undefined;
    const initialCredential = !isDraft ? this.credRepo.getCredential(serviceName) : null;
    const expectedBlob = initialCredential ? Buffer.from(initialCredential.encryptedCredentials) : null;

    let result: SanitizedDiagnosticResult;
    try {
      result = await provider.testConnection(draftSecret ?? multiloginDraft);
    } catch (err: unknown) {
      result = err instanceof ProviderError
        ? err.toDiagnostic(timestamp)
        : {
            code: 'NETWORK_ERROR',
            message: 'Không kết nối được tới dịch vụ. Kiểm tra mạng và cấu hình.',
            timestamp,
          };
    }

    if (expectedBlob && !isDraft) {
      const current = this.credRepo.getCredential(serviceName);
      if (current && current.encryptedCredentials.equals(expectedBlob)) {
        const metadata: CredentialDiagnosticMetadata = {
          ...current.metadata,
          status: ServiceConnectionManager.toDiagnosticStatus(result.code),
          lastTestedAt: timestamp,
          lastTestResult: result,
        };

        const balance = result.details?.balance;
        if (typeof balance === 'number') {
          metadata.balance = balance;
          metadata.balanceFetchedAt = timestamp;
        }

        const updated = this.credRepo.updateMetadataIfUnchanged(serviceName, expectedBlob, metadata);
        if (updated) {
          this.getDiagnosticStatuses();
        }
      }
    }

    return result;
  }
}
