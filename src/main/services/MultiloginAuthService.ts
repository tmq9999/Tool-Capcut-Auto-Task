import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import { ProviderError } from '../providers/ProviderError';
import {
  MULTILOGIN_SERVICE_NAME,
  MULTILOGIN_TOKEN_TTL_MS,
  MULTILOGIN_TOKEN_REFRESH_SKEW_MS,
  type MultiloginTokens
} from '../providers/MultiloginProvider';
import type { ObservationScope } from '../providers/ObservedHttpClient';

/** The slice of MultiloginProvider this service depends on. */
export interface IMultiloginAuthApi {
  signIn(email: string, password: string): Promise<MultiloginTokens>;
  refreshTokens(email: string, refreshToken: string, workspaceId?: string): Promise<MultiloginTokens>;
}

export interface ClockProvider {
  now(): number;
}

interface StoredSession {
  jwtToken: string;
  refreshToken: string;
  issuedAt: number;
}

interface StoredAuthBlob {
  mode?: string;
  automationToken?: string;
  email?: string;
  password?: string;
  workspaceId?: string;
  session?: StoredSession;
}

function configError(message: string): ProviderError {
  return new ProviderError('CONFIG_ERROR', message, MULTILOGIN_SERVICE_NAME);
}

/**
 * Owns the Multilogin token lifecycle. Regular JWT tokens live 30 minutes, so a
 * cached token is refreshed inside its skew window and the rotated refresh token
 * is written back to the encrypted credential blob. Automation tokens are used
 * verbatim. Secrets never leave the main process.
 */
export class MultiloginAuthService {
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly credRepo: CredentialRepository,
    private readonly vault: ICredentialVault,
    private readonly api: IMultiloginAuthApi,
    private readonly clock: ClockProvider = { now: () => Date.now() },
    private readonly observation?: ObservationScope
  ) {}

  private observeShared<T>(operation: 'sign-in' | 'token-refresh', action: () => Promise<T>): Promise<T> {
    const identity = {
      provider: 'multilogin',
      operation,
      workerAlias: null,
      acquisitionAlias: null,
      accountAlias: null,
      sessionAlias: null
    } as const;
    return this.observation?.withObservationScope(identity, action) ?? action();
  }

  private readBlob(): StoredAuthBlob {
    const record = this.credRepo.getCredential(MULTILOGIN_SERVICE_NAME);
    if (!record) {
      throw configError('Chưa cấu hình Multilogin trong Settings.');
    }

    let decrypted: string;
    try {
      decrypted = this.vault.decrypt(record.encryptedCredentials);
    } catch {
      throw configError('Không giải mã được thông tin Multilogin đã lưu.');
    }

    try {
      const parsed: unknown = JSON.parse(decrypted);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('unexpected shape');
      }
      return parsed as StoredAuthBlob;
    } catch {
      throw configError('Thông tin Multilogin đã lưu không đúng định dạng.');
    }
  }

  private persistSession(blob: StoredAuthBlob, session: StoredSession): void {
    const next: StoredAuthBlob = { ...blob, session };
    const record = this.credRepo.getCredential(MULTILOGIN_SERVICE_NAME);
    this.credRepo.saveCredential(
      MULTILOGIN_SERVICE_NAME,
      this.vault.encrypt(JSON.stringify(next)),
      record?.metadata ?? { maskedHint: '••••••••', status: 'unknown' }
    );
  }

  private isSessionFresh(session: StoredSession): boolean {
    if (!session.jwtToken || typeof session.issuedAt !== 'number') return false;
    const age = this.clock.now() - session.issuedAt;
    return age < MULTILOGIN_TOKEN_TTL_MS - MULTILOGIN_TOKEN_REFRESH_SKEW_MS;
  }

  private async resolveToken(): Promise<string> {
    const blob = this.readBlob();

    if (blob.mode === 'token') {
      const automationToken = blob.automationToken;
      if (!automationToken) {
        throw configError('Automation token của Multilogin đang trống.');
      }
      return automationToken;
    }

    const email = blob.email;
    const password = blob.password;
    if (!email) {
      throw configError('Thiếu email Multilogin trong cấu hình.');
    }

    const session = blob.session;
    if (session && this.isSessionFresh(session)) {
      return session.jwtToken;
    }

    const existingRefreshToken = session?.refreshToken;
    if (existingRefreshToken) {
      try {
        const rotated = await this.observeShared('token-refresh', () =>
          this.api.refreshTokens(email, existingRefreshToken, blob.workspaceId));
        this.persistSession(blob, {
          jwtToken: rotated.token,
          refreshToken: rotated.refreshToken,
          issuedAt: this.clock.now()
        });
        return rotated.token;
      } catch (err: unknown) {
        // A refresh token can be invalidated at any time — Multilogin rotates it
        // on every sign-in, so signing in elsewhere kills the stored one, and it
        // answers HTTP 400 (not 401) for that case. Whatever the reason, a fresh
        // sign-in is the recovery path; only rethrow when we cannot sign in.
        if (!password) throw err;
      }
    }

    if (!password) {
      throw configError('Thiếu mật khẩu Multilogin, không thể đăng nhập lại.');
    }

    const signedIn = await this.observeShared('sign-in', () => this.api.signIn(email, password));
    this.persistSession(blob, {
      jwtToken: signedIn.token,
      refreshToken: signedIn.refreshToken,
      issuedAt: this.clock.now()
    });
    return signedIn.token;
  }

  /**
   * Returns a usable bearer token, signing in or refreshing as needed.
   * Concurrent callers share one in-flight authentication.
   * When a draft payload is provided, test against the draft directly.
   */
  async getAccessToken(draft?: unknown): Promise<string> {
    if (typeof draft === 'object' && draft !== null && 'mode' in draft) {
      const d = draft as { mode: 'token' | 'credentials'; automationToken?: string; email?: string; password?: string };
      if (d.mode === 'token') {
        const token = d.automationToken?.trim();
        if (!token) throw configError('Automation token của Multilogin đang trống.');
        return token;
      }
      if (d.mode === 'credentials') {
        const email = d.email?.trim();
        const password = d.password?.trim();
        if (!email || !password) throw configError('Thiếu email hoặc mật khẩu Multilogin.');
        const signedIn = await this.observeShared('sign-in', () => this.api.signIn(email, password));
        return signedIn.token;
      }
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const pending = this.resolveToken().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = pending;
    return pending;
  }

  /** Drops any cached session so the next call re-authenticates. */
  invalidateSession(): void {
    this.inFlight = null;
    let blob: StoredAuthBlob;
    try {
      blob = this.readBlob();
    } catch {
      return;
    }
    if (!blob.session) return;
    const { session: _discarded, ...rest } = blob;
    const record = this.credRepo.getCredential(MULTILOGIN_SERVICE_NAME);
    this.credRepo.saveCredential(
      MULTILOGIN_SERVICE_NAME,
      this.vault.encrypt(JSON.stringify(rest)),
      record?.metadata ?? { maskedHint: '••••••••', status: 'unknown' }
    );
  }

  isConfigured(): boolean {
    return this.credRepo.getCredential(MULTILOGIN_SERVICE_NAME) !== null;
  }
}
