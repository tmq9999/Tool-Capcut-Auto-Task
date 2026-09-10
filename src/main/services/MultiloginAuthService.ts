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

interface CredentialSnapshot {
  encryptedBuffer: Buffer;
  blob: StoredAuthBlob;
  generation: number;
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
  private inFlight: {
    promise: Promise<string>;
    encryptedBuffer: Buffer;
    generation: number;
  } | null = null;
  private authGeneration = 0;

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

  private readSnapshot(): CredentialSnapshot {
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
      return {
        encryptedBuffer: Buffer.from(record.encryptedCredentials),
        blob: parsed as StoredAuthBlob,
        generation: this.authGeneration
      };
    } catch {
      throw configError('Thông tin Multilogin đã lưu không đúng định dạng.');
    }
  }

  private persistSession(snapshot: CredentialSnapshot, session: StoredSession): void {
    if (this.authGeneration !== snapshot.generation) {
      throw configError('Cấu hình Multilogin đã thay đổi trong khi xử lý.');
    }

    const next: StoredAuthBlob = { ...snapshot.blob, session };
    const replacement = this.vault.encrypt(JSON.stringify(next));
    const updated = this.credRepo.replaceEncryptedIfUnchanged(
      MULTILOGIN_SERVICE_NAME,
      snapshot.encryptedBuffer,
      replacement
    );
    if (!updated) {
      throw configError('Cấu hình Multilogin đã thay đổi hoặc bị xóa trong khi xử lý.');
    }
  }

  private isSessionFresh(session: StoredSession): boolean {
    if (!session.jwtToken || typeof session.issuedAt !== 'number') return false;
    const age = this.clock.now() - session.issuedAt;
    return age < MULTILOGIN_TOKEN_TTL_MS - MULTILOGIN_TOKEN_REFRESH_SKEW_MS;
  }

  private async resolveToken(snapshot: CredentialSnapshot): Promise<string> {
    const { blob, encryptedBuffer, generation } = snapshot;

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
    let refreshFailed = false;
    let refreshError: unknown;

    if (existingRefreshToken) {
      let rotated: MultiloginTokens | undefined;
      try {
        rotated = await this.observeShared('token-refresh', () =>
          this.api.refreshTokens(email, existingRefreshToken, blob.workspaceId)
        );
      } catch (err: unknown) {
        refreshFailed = true;
        refreshError = err;
      }

      if (rotated) {
        this.persistSession(snapshot, {
          jwtToken: rotated.token,
          refreshToken: rotated.refreshToken,
          issuedAt: this.clock.now()
        });
        return rotated.token;
      }
    }

    if (refreshFailed) {
      if (!password) {
        throw (refreshError instanceof Error ? refreshError : configError('Làm mới token thất bại.'));
      }
      const current = this.credRepo.getCredential(MULTILOGIN_SERVICE_NAME);
      if (
        !current ||
        !current.encryptedCredentials.equals(encryptedBuffer) ||
        this.authGeneration !== generation
      ) {
        throw configError('Cấu hình Multilogin đã thay đổi hoặc bị xóa trong khi làm mới token.');
      }
    }

    if (!password) {
      throw configError('Thiếu mật khẩu Multilogin, không thể đăng nhập lại.');
    }

    const signedIn = await this.observeShared('sign-in', () => this.api.signIn(email, password));
    this.persistSession(snapshot, {
      jwtToken: signedIn.token,
      refreshToken: signedIn.refreshToken,
      issuedAt: this.clock.now()
    });
    return signedIn.token;
  }

  /**
   * Returns a usable bearer token, signing in or refreshing as needed.
   * Concurrent callers share one in-flight authentication for the same snapshot.
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

    const snapshot = this.readSnapshot();

    if (snapshot.blob.mode === 'token') {
      const automationToken = snapshot.blob.automationToken;
      if (!automationToken) {
        throw configError('Automation token của Multilogin đang trống.');
      }
      return automationToken;
    }

    const session = snapshot.blob.session;
    if (session && this.isSessionFresh(session)) {
      return session.jwtToken;
    }

    if (
      this.inFlight &&
      this.inFlight.generation === snapshot.generation &&
      this.inFlight.encryptedBuffer.equals(snapshot.encryptedBuffer)
    ) {
      return this.inFlight.promise;
    }

    const currentGeneration = snapshot.generation;
    const currentBuffer = snapshot.encryptedBuffer;
    const promise = this.resolveToken(snapshot).finally(() => {
      if (this.inFlight && this.inFlight.promise === promise) {
        this.inFlight = null;
      }
    });

    this.inFlight = {
      promise,
      encryptedBuffer: currentBuffer,
      generation: currentGeneration
    };

    return promise;
  }

  /** Drops any cached session so the next call re-authenticates. */
  invalidateSession(): void {
    this.authGeneration += 1;
    this.inFlight = null;
    let snapshot: CredentialSnapshot;
    try {
      snapshot = this.readSnapshot();
    } catch {
      return;
    }
    if (!snapshot.blob.session) return;
    const { session: _discarded, ...rest } = snapshot.blob;
    const replacement = this.vault.encrypt(JSON.stringify(rest));
    this.credRepo.replaceEncryptedIfUnchanged(
      MULTILOGIN_SERVICE_NAME,
      snapshot.encryptedBuffer,
      replacement
    );
  }

  isConfigured(): boolean {
    return this.credRepo.getCredential(MULTILOGIN_SERVICE_NAME) !== null;
  }
}
