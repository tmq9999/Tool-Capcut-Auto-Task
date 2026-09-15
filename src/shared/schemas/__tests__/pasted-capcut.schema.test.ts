import { describe, it, expect } from 'vitest';
import {
  parsePastedCapcutText,
  normalizePastedCapcutEntries,
  normalizeCapcutEmail,
  formatPastedCapcutIssues,
  PastedCapcutCredentialSchema,
  PastedCapcutSourceSchema
} from '../pasted-capcut.schema';

describe('pasted-capcut.schema', () => {
  describe('normalizeCapcutEmail', () => {
    it('trims and converts email to lowercase', () => {
      expect(normalizeCapcutEmail('  User@Example.COM  ')).toBe('user@example.com');
    });
  });

  describe('parsePastedCapcutText', () => {
    it('preserves the entire CapCut password after the first pipe', () => {
      const parsed = parsePastedCapcutText('  User@Example.test  |  A|B  \r\n\r\nsecond@example.test|P2');
      expect(parsed.issues).toEqual([]);
      expect(parsed.entries).toEqual([
        { line: 1, email: 'User@Example.test', capcutPassword: '  A|B  ' },
        { line: 3, email: 'second@example.test', capcutPassword: 'P2' }
      ]);
    });

    it('handles UTF-8 BOM, CRLF, LF, and CR line endings correctly', () => {
      const text = '\uFEFFline1@example.com|pass1\rline2@example.com|pass2\r\nline3@example.com|pass3\n';
      const parsed = parsePastedCapcutText(text);
      expect(parsed.issues).toEqual([]);
      expect(parsed.entries).toHaveLength(3);
      expect(parsed.entries[0]).toEqual({ line: 1, email: 'line1@example.com', capcutPassword: 'pass1' });
      expect(parsed.entries[1]).toEqual({ line: 2, email: 'line2@example.com', capcutPassword: 'pass2' });
      expect(parsed.entries[2]).toEqual({ line: 3, email: 'line3@example.com', capcutPassword: 'pass3' });
    });

    it('deduplicates identical credentials and records duplicateLines', () => {
      const same = parsePastedCapcutText('a@example.test|P1\nA@example.test|P1');
      expect(same.issues).toEqual([]);
      expect(same.entries).toHaveLength(1);
      expect(same.entries[0]).toEqual({ line: 1, email: 'a@example.test', capcutPassword: 'P1' });
      expect(same.duplicateLines).toEqual([2]);
    });

    it('rejects password conflicts for the same normalized email', () => {
      const conflict = parsePastedCapcutText('a@example.test|P1\nA@example.test|P2');
      expect(conflict.issues).toHaveLength(2);
      expect(conflict.issues.map((i) => i.line)).toEqual([1, 2]);
      expect(conflict.issues.every((i) => i.code === 'CONFLICTING_DUPLICATE')).toBe(true);
      expect(conflict.issues[0].relatedLines).toContain(2);
      expect(conflict.issues[1].relatedLines).toContain(1);
    });

    it('flags empty input with EMPTY_INPUT on line 1', () => {
      const empty = parsePastedCapcutText('   \r\n\n  ');
      expect(empty.entries).toHaveLength(0);
      expect(empty.issues).toEqual([{ line: 1, code: 'EMPTY_INPUT' }]);
    });

    it('flags MISSING_SEPARATOR when line lacks a pipe', () => {
      const parsed = parsePastedCapcutText('valid@example.com|pass\ninvalid_line_no_pipe\nother@example.com|pass2');
      expect(parsed.issues).toEqual([{ line: 2, code: 'MISSING_SEPARATOR' }]);
    });

    it('flags EMPTY_PASSWORD when password is empty or whitespace-only', () => {
      const parsed = parsePastedCapcutText('a@example.com|\nb@example.com|   ');
      expect(parsed.issues).toEqual([
        { line: 1, code: 'EMPTY_PASSWORD' },
        { line: 2, code: 'EMPTY_PASSWORD' }
      ]);
    });

    it('flags INVALID_EMAIL when email format is invalid', () => {
      const parsed = parsePastedCapcutText('not-an-email|password123');
      expect(parsed.issues).toEqual([{ line: 1, code: 'INVALID_EMAIL' }]);
    });

    it('preserves line numbers across blank lines', () => {
      const text = '\n\na@example.com|passA\n\n\nb@example.com|bad';
      const parsed = parsePastedCapcutText(text);
      expect(parsed.entries[0].line).toBe(3);
      expect(parsed.entries[1].line).toBe(6);
    });

    it('does not cap rows at 200 (handles > 200 rows)', () => {
      const rows = Array.from({ length: 250 }, (_, i) => `user${i}@example.com|Secret${i}!`);
      const parsed = parsePastedCapcutText(rows.join('\n'));
      expect(parsed.issues).toEqual([]);
      expect(parsed.entries).toHaveLength(250);
    });
  });

  describe('normalizePastedCapcutEntries', () => {
    it('normalizes structured entries with identical validation and dedup', () => {
      const input = [
        { line: 1, email: 'A@Example.COM', capcutPassword: 'pass' },
        { line: 2, email: 'a@example.com', capcutPassword: 'pass' }
      ];
      const result = normalizePastedCapcutEntries(input);
      expect(result.issues).toEqual([]);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].email).toBe('A@Example.COM');
      expect(result.duplicateLines).toEqual([2]);
    });

    it('detects conflicting duplicates in structured entries', () => {
      const input = [
        { line: 5, email: 'user@example.com', capcutPassword: 'pass1' },
        { line: 8, email: 'USER@example.com', capcutPassword: 'pass2' }
      ];
      const result = normalizePastedCapcutEntries(input);
      expect(result.issues).toHaveLength(2);
      expect(result.issues.map((i) => i.line)).toEqual([5, 8]);
      expect(result.issues.every((i) => i.code === 'CONFLICTING_DUPLICATE')).toBe(true);
    });
  });

  describe('formatPastedCapcutIssues', () => {
    it('formats issues into readable messages without leaking secrets', () => {
      const issues = [
        { line: 2, code: 'MISSING_SEPARATOR' as const },
        { line: 4, code: 'CONFLICTING_DUPLICATE' as const, relatedLines: [7] }
      ];
      const message = formatPastedCapcutIssues(issues);
      expect(message).toContain('Dòng 2');
      expect(message).toContain('Dòng 4');
      expect(message).not.toContain('password');
      expect(message).not.toContain('Secret');
    });
  });

  describe('Zod Schemas', () => {
    it('validates PastedCapcutCredentialSchema', () => {
      expect(PastedCapcutCredentialSchema.safeParse({
        line: 1,
        email: 'user@example.com',
        capcutPassword: 'my-password'
      }).success).toBe(true);

      expect(PastedCapcutCredentialSchema.safeParse({
        line: 1,
        email: 'invalid-email',
        capcutPassword: 'my-password'
      }).success).toBe(false);

      expect(PastedCapcutCredentialSchema.safeParse({
        line: 1,
        email: 'user@example.com',
        capcutPassword: '   '
      }).success).toBe(false);
    });

    it('validates PastedCapcutSourceSchema', () => {
      expect(PastedCapcutSourceSchema.safeParse({
        mode: 'pasted-existing',
        entries: [{ line: 1, email: 'a@example.com', capcutPassword: 'p1' }]
      }).success).toBe(true);

      expect(PastedCapcutSourceSchema.safeParse({
        mode: 'pasted-existing',
        entries: []
      }).success).toBe(false);
    });

    it('reports original malformed line without a fake empty-input issue', () => {
      expect(parsePastedCapcutText('\n\nbad-row').issues).toEqual([
        { line: 3, code: 'MISSING_SEPARATOR' }
      ]);
    });

    it('normalizes structured email but preserves exact password', () => {
      const result = normalizePastedCapcutEntries([
        { line: 3, email: '  Demo@Example.test  ', capcutPassword: '  A|B  ' }
      ]);
      expect(result.issues).toEqual([]);
      expect(result.entries).toEqual([
        { line: 3, email: 'Demo@Example.test', capcutPassword: '  A|B  ' }
      ]);
    });

    it('shares conflict rejection in standalone source schema', () => {
      expect(PastedCapcutSourceSchema.safeParse({
        mode: 'pasted-existing',
        entries: [
          { line: 1, email: 'a@example.test', capcutPassword: 'A' },
          { line: 2, email: 'A@example.test', capcutPassword: 'B' }
        ]
      }).success).toBe(false);
    });
  });
});
