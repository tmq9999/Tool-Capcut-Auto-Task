import fs from 'node:fs/promises';
import writeXlsxFile from 'write-excel-file/node';
import type { AccountDbRecord, AccountRepository } from '../repositories/AccountRepository';
import type { ICredentialVault } from '../security/CredentialVault';
import { ProviderError } from '../providers/ProviderError';
import type { ExportField } from '../../shared/schemas/settings.schema';
import {
  CANONICAL_EXPORT_FIELD_ORDER,
  EXPORT_FIELD_HEADERS,
  type AccountExportRequestDTO,
  type AccountExportResultDTO
} from '../../shared/schemas/account-export.schema';

export interface AccountExportDeps {
  /** Mở hộp thoại lưu file. Trả `null` khi người dùng bấm Cancel. */
  chooseSavePath(suggestedFileName: string): Promise<string | null>;
  now?: () => Date;
}

type ExportRepo = Pick<AccountRepository, 'queryAccountsForExport'>;

const EXTENSIONS = { TXT: 'txt', CSV: 'csv', XLSX: 'xlsx' } as const;

/**
 * Xuất account ra file. Chạy TRỌN VẸN ở main process vì hai cột bắt buộc của
 * AGENTS §21 — "Password CapCut" và "Email Data" — nằm trong DB ở dạng đã mã
 * hoá; `AccountListItemDTO` chỉ mang cờ boolean nên renderer không có giá trị
 * nào để ghi ra file. Giải mã ở đây, ghi thẳng ra đĩa, renderer chỉ nhận lại
 * đường dẫn và số dòng (AGENTS §13: secret không rời main process).
 */
export class AccountExportService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: ExportRepo,
    private readonly vault: ICredentialVault,
    private readonly deps: AccountExportDeps
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  async export(request: AccountExportRequestDTO): Promise<AccountExportResultDTO> {
    const records = this.readRecords(request);
    if (records.length === 0) {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Không có tài khoản nào khớp phạm vi đã chọn nên không xuất được file.'
      );
    }

    // Thứ tự cột KHÔNG theo thứ tự request gửi lên — §21 chốt sẵn thứ tự.
    const fields = CANONICAL_EXPORT_FIELD_ORDER.filter((f) => request.fields.includes(f));
    if (fields.length === 0) {
      throw new ProviderError('CONFIG_ERROR', 'Chưa chọn cột nào để xuất.');
    }

    // Giải mã TRƯỚC khi mở hộp thoại: vault chết thì đừng hỏi người dùng chỗ lưu.
    const rows = records.map((record) => this.toRow(record, fields));

    const suggestedFileName = this.suggestFileName(request.format);
    const filePath = await this.deps.chooseSavePath(suggestedFileName);
    if (!filePath) return { canceled: true, filePath: null, exportedCount: 0 };

    const headers = fields.map((f) => EXPORT_FIELD_HEADERS[f]);
    if (request.format === 'XLSX') {
      await this.writeXlsx(filePath, headers, rows);
    } else if (request.format === 'CSV') {
      await fs.writeFile(filePath, '﻿' + toCsv(headers, rows), 'utf8');
    } else {
      await fs.writeFile(filePath, toTxt(headers, rows), 'utf8');
    }

    return { canceled: false, filePath, exportedCount: rows.length };
  }

  private readRecords(request: AccountExportRequestDTO): AccountDbRecord[] {
    const scope = request.scope;
    if (scope.kind === 'checked') return this.repo.queryAccountsForExport({ ids: scope.ids });
    if (scope.kind === 'filtered') return this.repo.queryAccountsForExport(scope.filter);
    return this.repo.queryAccountsForExport({});
  }

  /**
   * Giải mã một ô secret. Thất bại thì NÉM, không trả ô rỗng: khoá OS đổi là sự
   * cố thật, xuất ra file thiếu cột mà không nói gì thì người dùng tưởng account
   * chưa có mật khẩu.
   */
  private decryptCell(encrypted: Buffer | null, email: string): string {
    if (!encrypted || encrypted.length === 0) return '';
    try {
      return this.vault.decrypt(encrypted);
    } catch {
      throw new ProviderError(
        'CONFIG_ERROR',
        'Không giải mã được dữ liệu đã lưu của ' + email +
          '. File chưa được ghi. Nguyên nhân thường gặp: khoá mã hoá của Windows đã đổi.'
      );
    }
  }

  private toRow(record: AccountDbRecord, fields: readonly ExportField[]): string[] {
    return fields.map((field) => {
      switch (field) {
        case 'email':
          return record.email;
        case 'passwordCapcut':
          return this.decryptCell(record.passwordCapcutEncrypted, record.email);
        case 'emailData':
          return this.decryptCell(record.emailDataEncrypted, record.email);
        case 'credit':
          return String(record.credit);
        case 'subscription':
          return record.subscription ?? '';
        case 'createdAt':
          return record.createdAt;
      }
    });
  }

  private suggestFileName(format: AccountExportRequestDTO['format']): string {
    const d = this.now();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes());
    return 'accounts-' + stamp + '.' + EXTENSIONS[format];
  }

  /**
   * `credit` đi ra dạng số để cột còn cộng/sắp xếp được trong Excel; mọi ô khác
   * là chuỗi — kể cả `Create At`, để file XLSX khớp từng ký tự với TXT/CSV thay
   * vì bị Excel đổi múi giờ.
   */
  private async writeXlsx(filePath: string, headers: string[], rows: string[][]): Promise<void> {
    const creditIndex = headers.indexOf(EXPORT_FIELD_HEADERS.credit);
    const sheet = [
      headers.map((h) => ({ value: h, type: String, fontWeight: 'bold' as const })),
      ...rows.map((row) =>
        row.map((cell, index) =>
          index === creditIndex
            ? { value: Number(cell), type: Number }
            : { value: cell, type: String }
        )
      )
    ];

    await writeXlsxFile(sheet, { sheet: 'Accounts' }).toFile(filePath);
  }
}

/** TXT: một dòng một account, cột ngăn bằng `|` đúng như §21. */
function toTxt(headers: string[], rows: string[][]): string {
  const flatten = (cell: string) => cell.replace(/\r\n|\r|\n/g, ' ');
  const lines = [headers.join('|'), ...rows.map((row) => row.map(flatten).join('|'))];
  return lines.join('\r\n') + '\r\n';
}

/** CSV theo RFC 4180: bọc ngoặc kép khi cần, ngoặc kép bên trong thì nhân đôi. */
function toCsv(headers: string[], rows: string[][]): string {
  const sanitize = (cell: string) =>
    /^[\t\r\n]/.test(cell) || /^\s*[=+\-@]/.test(cell) ? "'" + cell : cell;
  const escape = (cell: string) => {
    const safe = sanitize(cell);
    return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))];
  return lines.join('\r\n') + '\r\n';
}
