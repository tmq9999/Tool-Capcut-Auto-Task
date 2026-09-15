import { z } from 'zod';

export interface PastedCapcutCredential {
  line: number;
  email: string;
  capcutPassword: string;
}

export type PastedCapcutIssueCode =
  | 'EMPTY_INPUT'
  | 'MISSING_SEPARATOR'
  | 'INVALID_EMAIL'
  | 'EMPTY_PASSWORD'
  | 'CONFLICTING_DUPLICATE';

export interface PastedCapcutIssue {
  line: number;
  code: PastedCapcutIssueCode;
  relatedLines?: number[];
}

export interface PastedCapcutParseResult {
  entries: PastedCapcutCredential[];
  issues: PastedCapcutIssue[];
  duplicateLines: number[];
}

export const PastedCapcutCredentialSchema = z.object({
  line: z.number().int().min(1),
  email: z.string().trim().email(),
  capcutPassword: z.string().refine((p) => p.trim().length > 0, {
    message: 'Mật khẩu không được để trống'
  })
}).strict();

export const PastedCapcutSourceSchema = z.object({
  mode: z.literal('pasted-existing'),
  entries: z.array(PastedCapcutCredentialSchema).min(1)
}).strict().superRefine((val, ctx) => {
  const normalized = normalizePastedCapcutEntries(val.entries);
  if (normalized.issues.length > 0) {
    for (const issue of normalized.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: `Dòng ${issue.line}: ${issue.code}`
      });
    }
  }
});

export function normalizeCapcutEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emailValidator = z.string().email();

export function normalizePastedCapcutEntries(
  entries: readonly PastedCapcutCredential[]
): PastedCapcutParseResult {
  if (entries.length === 0) {
    return {
      entries: [],
      issues: [{ line: 1, code: 'EMPTY_INPUT' }],
      duplicateLines: []
    };
  }

  const issues: PastedCapcutIssue[] = [];
  const duplicateLines: number[] = [];
  const validCandidates: PastedCapcutCredential[] = [];

  for (const entry of entries) {
    let hasIssue = false;
    const trimmedEmail = entry.email.trim();
    if (!emailValidator.safeParse(trimmedEmail).success) {
      issues.push({ line: entry.line, code: 'INVALID_EMAIL' });
      hasIssue = true;
    }
    if (entry.capcutPassword.trim().length === 0) {
      issues.push({ line: entry.line, code: 'EMPTY_PASSWORD' });
      hasIssue = true;
    }
    if (!hasIssue) {
      validCandidates.push({
        line: entry.line,
        email: trimmedEmail,
        capcutPassword: entry.capcutPassword
      });
    }
  }

  const groups = new Map<string, PastedCapcutCredential[]>();
  for (const candidate of validCandidates) {
    const key = normalizeCapcutEmail(candidate.email);
    const list = groups.get(key);
    if (!list) {
      groups.set(key, [candidate]);
    } else {
      list.push(candidate);
    }
  }

  const resolvedEntries: PastedCapcutCredential[] = [];

  for (const [, group] of groups) {
    if (group.length === 1) {
      resolvedEntries.push(group[0]);
      continue;
    }

    const firstPassword = group[0].capcutPassword;
    const hasConflict = group.some((item) => item.capcutPassword !== firstPassword);

    if (hasConflict) {
      const allLines = group.map((item) => item.line);
      for (const item of group) {
        const relatedLines = allLines.filter((l) => l !== item.line);
        issues.push({
          line: item.line,
          code: 'CONFLICTING_DUPLICATE',
          relatedLines
        });
      }
    } else {
      resolvedEntries.push(group[0]);
      for (let i = 1; i < group.length; i += 1) {
        duplicateLines.push(group[i].line);
      }
    }
  }

  issues.sort((a, b) => a.line - b.line);
  duplicateLines.sort((a, b) => a - b);
  resolvedEntries.sort((a, b) => a.line - b.line);

  return {
    entries: resolvedEntries,
    issues,
    duplicateLines
  };
}

export function parsePastedCapcutText(text: string): PastedCapcutParseResult {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r\n|\n|\r/);

  const candidates: PastedCapcutCredential[] = [];
  const syntaxIssues: PastedCapcutIssue[] = [];
  let nonBlankCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim().length === 0) continue;
    nonBlankCount += 1;
    const lineNum = index + 1;
    const separator = raw.indexOf('|');
    if (separator < 0) {
      syntaxIssues.push({ line: lineNum, code: 'MISSING_SEPARATOR' });
      continue;
    }
    const email = raw.slice(0, separator).trim();
    const capcutPassword = raw.slice(separator + 1);
    candidates.push({ line: lineNum, email, capcutPassword });
  }

  if (nonBlankCount === 0) {
    return {
      entries: [],
      issues: [{ line: 1, code: 'EMPTY_INPUT' }],
      duplicateLines: []
    };
  }

  const normalized: PastedCapcutParseResult = candidates.length === 0
    ? { entries: [], issues: [], duplicateLines: [] }
    : normalizePastedCapcutEntries(candidates);
  const combinedIssues = [...syntaxIssues, ...normalized.issues];
  combinedIssues.sort((a, b) => a.line - b.line);

  return {
    entries: normalized.entries,
    issues: combinedIssues,
    duplicateLines: normalized.duplicateLines
  };
}

export function formatPastedCapcutIssues(issues: readonly PastedCapcutIssue[]): string {
  if (issues.length === 0) return '';
  return issues
    .map((issue) => {
      switch (issue.code) {
        case 'EMPTY_INPUT':
          return 'Danh sách tài khoản đang trống.';
        case 'MISSING_SEPARATOR':
          return `Dòng ${issue.line}: thiếu dấu '|' phân cách giữa email và mật khẩu.`;
        case 'INVALID_EMAIL':
          return `Dòng ${issue.line}: địa chỉ email không đúng định dạng.`;
        case 'EMPTY_PASSWORD':
          return `Dòng ${issue.line}: mật khẩu không được để trống.`;
        case 'CONFLICTING_DUPLICATE': {
          const related = issue.relatedLines?.length ? ` (xung đột với dòng ${issue.relatedLines.join(', ')})` : '';
          return `Dòng ${issue.line}: cùng email nhưng mật khẩu khác nhau${related}.`;
        }
        default:
          return `Dòng ${issue.line}: dữ liệu không hợp lệ.`;
      }
    })
    .join('\n');
}
