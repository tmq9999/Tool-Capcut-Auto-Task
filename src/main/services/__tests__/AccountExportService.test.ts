import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { AccountRepository } from '../../repositories/AccountRepository';
import { AccountExportService } from '../AccountExportService';
import type { ICredentialVault } from '../../security/CredentialVault';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(plainText: string): Buffer { return Buffer.from('enc:' + plainText, 'utf8'); }
  decrypt(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : raw;
  }
}

/** Vault mở được lúc mã hoá nhưng chết lúc giải mã — đúng hình dạng khi khoá OS đổi. */
class DecryptFailsVault extends PlainVault {
  decrypt(): string { throw new Error('safeStorage không giải mã được'); }
}

let tmpDir: string;
let db: Database.Database;
let repo: AccountRepository;

/** Đường dẫn hộp thoại trả về; đặt null để giả lập người dùng bấm Cancel. */
let savePath: string | null;
let suggestedNames: string[];

function createService(vault: ICredentialVault = new PlainVault()): AccountExportService {
  return new AccountExportService(repo, vault, {
    chooseSavePath: async (suggestedFileName: string) => {
      suggestedNames.push(suggestedFileName);
      return savePath;
    },
    now: () => new Date(2026, 8, 4, 10, 20, 30)
  });
}

const vaultForSeed = new PlainVault();

function seedAccount(input: {
  id: string;
  email: string;
  emailProvider?: string;
  passwordCapcut?: string;
  emailData?: string;
  credit?: number;
  subscription?: string | null;
  status?: 'active' | 'done' | 'error';
}): void {
  repo.createAccount({
    id: input.id,
    email: input.email,
    emailProvider: input.emailProvider ?? 'gmail94',
    passwordCapcutEncrypted: input.passwordCapcut ? vaultForSeed.encrypt(input.passwordCapcut) : null,
    emailDataEncrypted: input.emailData ? vaultForSeed.encrypt(input.emailData) : null,
    credit: input.credit ?? 0,
    subscription: input.subscription ?? null,
    status: input.status ?? 'active'
  });
}

/** Tách dòng bất kể CRLF hay LF — file .txt/.csv ghi ra dùng CRLF cho Windows. */
function readLines(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Bỏ BOM nếu có (CSV luôn mở đầu bằng BOM để Excel đọc đúng chữ có dấu).
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return withoutBom.trim().split(/\r?\n/);
}

/** Đọc lại text của một sheet trong file .xlsx thật vừa ghi ra. */
function readXlsxStrings(filePath: string): string {
  const zip = unzipSync(new Uint8Array(fs.readFileSync(filePath)));
  const names = Object.keys(zip).filter((n) => n.startsWith('xl/'));
  return names.map((n) => strFromU8(zip[n])).join('\n');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-export-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  repo = new AccountRepository(db);
  savePath = path.join(tmpDir, 'out.txt');
  suggestedNames = [];
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AccountExportService — định dạng TXT (AGENTS §21)', () => {
  it('ghi tiêu đề rồi từng dòng account, ngăn bằng dấu |', async () => {
    seedAccount({
      id: 'a1',
      email: 'one@example.com',
      passwordCapcut: 'Capcut#1',
      emailData: 'one@example.com|mailpass|refresh|client',
      credit: 12,
      subscription: 'pro'
    });

    const result = await createService().export({
      format: 'TXT',
      fields: ['email', 'passwordCapcut', 'emailData', 'credit', 'subscription', 'createdAt'],
      scope: { kind: 'all' }
    });

    expect(result.canceled).toBe(false);
    expect(result.exportedCount).toBe(1);
    const lines = readLines(savePath as string);
    expect(lines[0]).toBe('Email|Password CapCut|Email Data|Credit|Subscription|Create At');
    expect(lines[1].startsWith('one@example.com|Capcut#1|one@example.com|mailpass|refresh|client|12|pro|')).toBe(true);
  });

  it('giữ đúng thứ tự cột của §21 kể cả khi request gửi thứ tự khác', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com', credit: 5 });

    await createService().export({
      format: 'TXT',
      fields: ['credit', 'email'],
      scope: { kind: 'all' }
    });

    const lines = readLines(savePath as string);
    expect(lines[0]).toBe('Email|Credit');
    expect(lines[1]).toBe('one@example.com|5');
  });

  it('gộp mọi ký tự xuống dòng trong giá trị lại thành một dòng cho mỗi account', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com', emailData: 'line1\nline2\r\nline3' });

    await createService().export({
      format: 'TXT',
      fields: ['email', 'emailData'],
      scope: { kind: 'all' }
    });

    const lines = readLines(savePath as string);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('one@example.com|line1 line2 line3');
  });
});

describe('AccountExportService — định dạng CSV', () => {
  it('bọc ngoặc kép cho giá trị có dấu phẩy và nhân đôi ngoặc kép bên trong', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com', subscription: 'pro, yearly "gold"' });
    savePath = path.join(tmpDir, 'out.csv');

    await createService().export({
      format: 'CSV',
      fields: ['email', 'subscription'],
      scope: { kind: 'all' }
    });

    const lines = readLines(savePath);
    expect(lines[0]).toBe('Email,Subscription');
    expect(lines[1]).toBe('one@example.com,"pro, yearly ""gold"""');
  });

  it('mở đầu bằng BOM UTF-8 để Excel không hỏng chữ có dấu', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com', subscription: 'gói năm' });
    savePath = path.join(tmpDir, 'out.csv');

    await createService().export({
      format: 'CSV',
      fields: ['email', 'subscription'],
      scope: { kind: 'all' }
    });

    const buffer = fs.readFileSync(savePath);
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(buffer.toString('utf8')).toContain('gói năm');
  });
});

describe('AccountExportService — định dạng XLSX', () => {
  it('ghi ra file .xlsx thật, mở lại được và có đủ tiêu đề lẫn dữ liệu', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com', passwordCapcut: 'Capcut#1', credit: 7 });
    savePath = path.join(tmpDir, 'out.xlsx');

    const result = await createService().export({
      format: 'XLSX',
      fields: ['email', 'passwordCapcut', 'credit'],
      scope: { kind: 'all' }
    });

    expect(result.exportedCount).toBe(1);
    expect(fs.readFileSync(savePath).subarray(0, 2).toString('latin1')).toBe('PK');
    const text = readXlsxStrings(savePath);
    expect(text).toContain('Password CapCut');
    expect(text).toContain('one@example.com');
    expect(text).toContain('Capcut#1');
  });
});

describe('AccountExportService — phạm vi xuất', () => {
  it('phạm vi "checked" chỉ xuất đúng những id được tích', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com' });
    seedAccount({ id: 'a2', email: 'two@example.com' });
    seedAccount({ id: 'a3', email: 'three@example.com' });

    const result = await createService().export({
      format: 'TXT',
      fields: ['email'],
      scope: { kind: 'checked', ids: ['a1', 'a3'] }
    });

    expect(result.exportedCount).toBe(2);
    const raw = fs.readFileSync(savePath as string, 'utf8');
    expect(raw).toContain('one@example.com');
    expect(raw).toContain('three@example.com');
    expect(raw).not.toContain('two@example.com');
  });

  it('phạm vi "filtered" chạy đúng bộ lọc ở SQL, không chỉ trên trang đang xem', async () => {
    seedAccount({ id: 'a1', email: 'ok@example.com', status: 'done' });
    seedAccount({ id: 'a2', email: 'bad@example.com', status: 'error' });

    const result = await createService().export({
      format: 'TXT',
      fields: ['email'],
      scope: { kind: 'filtered', filter: { status: 'error' } }
    });

    expect(result.exportedCount).toBe(1);
    expect(fs.readFileSync(savePath as string, 'utf8')).toContain('bad@example.com');
  });
});

describe('AccountExportService — hộp thoại và lỗi', () => {
  it('người dùng bấm Cancel thì không ghi file nào và báo canceled', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com' });
    const target = savePath as string;
    savePath = null;

    const result = await createService().export({
      format: 'TXT',
      fields: ['email'],
      scope: { kind: 'all' }
    });

    expect(result).toEqual({ canceled: true, filePath: null, exportedCount: 0 });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('gợi ý tên file mang đúng phần mở rộng của định dạng', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com' });
    savePath = path.join(tmpDir, 'out.csv');

    await createService().export({ format: 'CSV', fields: ['email'], scope: { kind: 'all' } });

    expect(suggestedNames[0]).toBe('accounts-20260904-1020.csv');
  });

  it('không có account nào khớp thì từ chối, không mở hộp thoại', async () => {
    await expect(
      createService().export({ format: 'TXT', fields: ['email'], scope: { kind: 'all' } })
    ).rejects.toThrow(/không có tài khoản/i);
    expect(suggestedNames).toHaveLength(0);
  });

  it('giải mã thất bại thì báo lỗi và KHÔNG để lại file nửa vời', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com', passwordCapcut: 'Capcut#1' });
    const target = savePath as string;

    await expect(
      createService(new DecryptFailsVault()).export({
        format: 'TXT',
        fields: ['email', 'passwordCapcut'],
        scope: { kind: 'all' }
      })
    ).rejects.toThrow(/giải mã/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('ô rỗng vẫn là ô rỗng: account chưa có mật khẩu không làm vỡ cột', async () => {
    seedAccount({ id: 'a1', email: 'one@example.com', credit: 3 });

    await createService().export({
      format: 'TXT',
      fields: ['email', 'passwordCapcut', 'credit'],
      scope: { kind: 'all' }
    });

    const lines = readLines(savePath as string);
    expect(lines[1]).toBe('one@example.com||3');
  });
});
