import crypto from 'node:crypto';
import type {
  AccountRepository,
  SecretBufferOp,
  UpdateAccountRecordInput
} from '../repositories/AccountRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import type {
  AccountCreateInputDTO,
  AccountFilterDTO,
  AccountListItemDTO,
  AccountUpdateInputDTO,
  SecretOperation
} from '../../shared/schemas/account.schema';

export interface AccountServiceDeps {
  nextId?: () => string;
}

/**
 * Application service for account rows. Owns the encryption boundary: plaintext
 * secrets arrive here, are encrypted through the vault, and only presence flags
 * are handed back to the renderer.
 */
export class AccountService {
  private readonly nextId: () => string;

  constructor(
    private readonly repo: AccountRepository,
    private readonly vault: ICredentialVault,
    deps: AccountServiceDeps = {}
  ) {
    this.nextId = deps.nextId ?? (() => crypto.randomUUID());
  }

  private encryptOptional(value: string | undefined | null): Buffer | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    return this.vault.encrypt(value);
  }

  private toBufferOp(op: SecretOperation | undefined): SecretBufferOp | undefined {
    if (!op) return undefined;
    if (op.action === 'keep') return { action: 'keep' };
    if (op.action === 'clear') return { action: 'clear' };
    return { action: 'replace', encryptedValue: this.vault.encrypt(op.value) };
  }

  create(input: AccountCreateInputDTO): { id: string } {
    const id = this.nextId();
    this.repo.createAccount({
      id,
      email: input.email,
      emailProvider: input.emailProvider,
      emailPasswordEncrypted: this.encryptOptional(input.emailPassword),
      passwordCapcutEncrypted: this.encryptOptional(input.passwordCapcut),
      emailDataEncrypted: this.encryptOptional(input.emailData),
      credit: input.credit,
      subscription: input.subscription ?? null,
      status: input.status,
      automationStep: input.automationStep ?? null,
      proxy: input.proxy ?? null,
      browserProvider: input.browserProvider ?? null,
      browserProfileId: input.browserProfileId ?? null,
      notes: input.notes ?? null
    });
    return { id };
  }

  list(filter: AccountFilterDTO): { items: AccountListItemDTO[]; total: number } {
    return this.repo.listAccounts(filter);
  }

  update(id: string, data: AccountUpdateInputDTO): { success: boolean } {
    const payload: UpdateAccountRecordInput = {
      email: data.email,
      emailProvider: data.emailProvider,
      credit: data.credit,
      subscription: data.subscription,
      status: data.status,
      automationStep: data.automationStep,
      proxy: data.proxy,
      browserProvider: data.browserProvider,
      browserProfileId: data.browserProfileId,
      notes: data.notes,
      emailPasswordOp: this.toBufferOp(data.emailPasswordOp),
      passwordCapcutOp: this.toBufferOp(data.passwordCapcutOp),
      emailDataOp: this.toBufferOp(data.emailDataOp)
    };
    return { success: this.repo.updateAccount(id, payload) };
  }

  remove(ids: string[]): { deletedCount: number } {
    return { deletedCount: this.repo.deleteAccounts(ids) };
  }

  getAutomationCredential(accountId: string): {
    accountId: string;
    email: string;
    emailProvider: string;
    capcutPassword: string;
  } | null {
    const record = this.repo.getAccountById(accountId);
    if (!record || !record.passwordCapcutEncrypted) return null;
    const capcutPassword = this.vault.decrypt(record.passwordCapcutEncrypted);
    return {
      accountId: record.id,
      email: record.email,
      emailProvider: record.emailProvider,
      capcutPassword
    };
  }
}
