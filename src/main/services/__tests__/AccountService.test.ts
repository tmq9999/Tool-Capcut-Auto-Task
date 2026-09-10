import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { AccountRepository } from '../../repositories/AccountRepository';
import { AccountService } from '../AccountService';
import type { ICredentialVault } from '../../security/CredentialVault';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(plainText: string): Buffer { return Buffer.from('enc:' + plainText, 'utf8'); }
  decrypt(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : raw;
  }
}

let tmpDir: string;
let db: Database.Database;
let repo: AccountRepository;
let vault: PlainVault;
let idCounter: number;

function createService(): AccountService {
  return new AccountService(repo, vault, { nextId: () => 'acc-' + ++idCounter });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-accountsvc-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  repo = new AccountRepository(db);
  vault = new PlainVault();
  idCounter = 0;
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AccountService.create', () => {
  it('encrypts every secret before persisting and returns only the new id', () => {
    const service = createService();

    const created = service.create({
      email: 'worker@example.com',
      emailProvider: 'gmail94',
      emailPassword: 'mailpass',
      passwordCapcut: 'capcutpass',
      emailData: 'worker@example.com|mailpass|refresh|client',
      credit: 0,
      status: 'waiting'
    });

    expect(created).toEqual({ id: 'acc-1' });

    const stored = repo.getAccountById('acc-1');
    expect(vault.decrypt(stored?.emailPasswordEncrypted as Buffer)).toBe('mailpass');
    expect(vault.decrypt(stored?.passwordCapcutEncrypted as Buffer)).toBe('capcutpass');
    expect(vault.decrypt(stored?.emailDataEncrypted as Buffer)).toBe(
      'worker@example.com|mailpass|refresh|client'
    );
  });

  it('leaves optional secrets null when they are not supplied', () => {
    const service = createService();
    service.create({ email: 'a@b.com', emailProvider: 'manual', credit: 0, status: 'active' });

    const stored = repo.getAccountById('acc-1');
    expect(stored?.emailPasswordEncrypted).toBeNull();
    expect(stored?.passwordCapcutEncrypted).toBeNull();
  });
});

describe('AccountService.list', () => {
  it('returns list items that expose presence flags instead of secrets', () => {
    const service = createService();
    service.create({
      email: 'x@y.com',
      emailProvider: 'gmail94',
      emailPassword: 'p',
      credit: 5,
      status: 'active'
    });

    const page = service.list({ page: 1, pageSize: 50 });

    expect(page.total).toBe(1);
    expect(page.items[0].hasEmailPassword).toBe(true);
    expect(JSON.stringify(page.items)).not.toContain('"p"');
  });

  it('filters by status', () => {
    const service = createService();
    service.create({ email: 'a@a.com', emailProvider: 'm', credit: 0, status: 'active' });
    service.create({ email: 'b@b.com', emailProvider: 'm', credit: 0, status: 'error' });

    const page = service.list({ page: 1, pageSize: 50, status: 'error' });

    expect(page.items.map((row) => row.email)).toEqual(['b@b.com']);
  });
});

describe('AccountService.update', () => {
  it('replaces a secret only when the operation asks for it', () => {
    const service = createService();
    service.create({
      email: 'a@a.com',
      emailProvider: 'm',
      passwordCapcut: 'old',
      credit: 0,
      status: 'active'
    });

    service.update('acc-1', { passwordCapcutOp: { action: 'keep' } });
    expect(vault.decrypt(repo.getAccountById('acc-1')?.passwordCapcutEncrypted as Buffer)).toBe('old');

    service.update('acc-1', { passwordCapcutOp: { action: 'replace', value: 'new' } });
    expect(vault.decrypt(repo.getAccountById('acc-1')?.passwordCapcutEncrypted as Buffer)).toBe('new');

    service.update('acc-1', { passwordCapcutOp: { action: 'clear' } });
    expect(repo.getAccountById('acc-1')?.passwordCapcutEncrypted).toBeNull();
  });

  it('updates the runtime status and automation step independently', () => {
    const service = createService();
    service.create({ email: 'a@a.com', emailProvider: 'm', credit: 0, status: 'active' });

    service.update('acc-1', { status: 'processing', automationStep: 'Đang mở browser' });

    const stored = repo.getAccountById('acc-1');
    expect(stored?.status).toBe('processing');
    expect(stored?.automationStep).toBe('Đang mở browser');
  });

  it('reports failure for an unknown id', () => {
    const service = createService();
    expect(service.update('nope', { status: 'done' })).toEqual({ success: false });
  });
});

describe('AccountService.remove', () => {
  it('deletes the requested accounts and reports the count', () => {
    const service = createService();
    service.create({ email: 'a@a.com', emailProvider: 'm', credit: 0, status: 'active' });
    service.create({ email: 'b@b.com', emailProvider: 'm', credit: 0, status: 'active' });

    expect(service.remove(['acc-1', 'acc-2'])).toEqual({ deletedCount: 2 });
    expect(service.list({ page: 1, pageSize: 50 }).total).toBe(0);
  });

  it('UI-03 guards removing an owned account while run is active', () => {
    const active = new Set(['acc-1']);
    const service = new AccountService(repo, vault, {
      nextId: () => 'acc-1',
      isAccountActive: (id) => active.has(id),
    });
    service.create({ email: 'owned@example.test', emailProvider: 'manual', credit: 0, status: 'active' });

    expect(() => service.remove(['acc-1'])).toThrow(/ACCOUNT_IN_USE/);
    expect(repo.getAccountById('acc-1')).not.toBeNull();
  });
});

describe('AccountService.getAutomationCredential', () => {
  it('loads CapCut credentials in main process without exposing them in DTO output', () => {
    const service = createService();
    service.create({
      email: 'user@example.com',
      emailProvider: 'manual',
      passwordCapcut: 'superSecretCapcutPass123',
      credit: 0,
      status: 'active'
    });

    const cred = (service as unknown as { getAutomationCredential: (id: string) => unknown }).getAutomationCredential('acc-1');
    expect(cred).toEqual({
      accountId: 'acc-1',
      email: 'user@example.com',
      emailProvider: 'manual',
      capcutPassword: 'superSecretCapcutPass123'
    });

    // Personal Dashboard displays the plaintext password for copy/view
    const list = service.list({ page: 1, pageSize: 50 });
    expect(list.items[0].hasPasswordCapcut).toBe(true);
    expect(list.items[0].passwordCapcut).toBe('superSecretCapcutPass123');
  });

  it('R08 returns the saved account password for the personal Dashboard', () => {
    const service = createService();
    service.create({
      email: 'a@example.test',
      emailProvider: 'manual',
      passwordCapcut: 'PASS-DEMO',
      credit: 0,
      status: 'active'
    });
    expect(service.list({ page: 1, pageSize: 50 }).items[0].passwordCapcut).toBe('PASS-DEMO');
  });
});

