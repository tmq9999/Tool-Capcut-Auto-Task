import { describe, it, expect } from 'vitest';
import { generateCapcutPassword } from '../passwordGenerator';

describe('generateCapcutPassword', () => {
  it('returns the fixed value when the user chose a custom password', () => {
    const password = generateCapcutPassword({
      mode: 'custom',
      value: 'MyFixedPass1!',
      length: 12,
      uppercase: true,
      numbers: true,
      special: true
    });
    expect(password).toBe('MyFixedPass1!');
  });

  it('honours the requested length in random mode', () => {
    const password = generateCapcutPassword({
      mode: 'random',
      length: 16,
      uppercase: true,
      numbers: true,
      special: true
    });
    expect(password).toHaveLength(16);
  });

  it('includes at least one character from every enabled class', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const password = generateCapcutPassword({
        mode: 'random',
        length: 10,
        uppercase: true,
        numbers: true,
        special: true
      });
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%^&*]/);
    }
  });

  it('omits disabled character classes entirely', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const password = generateCapcutPassword({
        mode: 'random',
        length: 12,
        uppercase: false,
        numbers: false,
        special: false
      });
      expect(password).toMatch(/^[a-z]+$/);
    }
  });

  it('produces a different password on each call', () => {
    const config = { mode: 'random' as const, length: 14, uppercase: true, numbers: true, special: false };
    const generated = new Set(Array.from({ length: 20 }, () => generateCapcutPassword(config)));
    expect(generated.size).toBeGreaterThan(1);
  });

  it('throws PASSWORD_GENERATION_NOT_ALLOWED when invoked in per-account mode', () => {
    expect(() => generateCapcutPassword({ mode: 'per-account' })).toThrow(
      'PASSWORD_GENERATION_NOT_ALLOWED'
    );
  });
});
