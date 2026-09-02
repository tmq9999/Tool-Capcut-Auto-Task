import { describe, it, expect } from 'vitest';
import { generateMailUsername, generateMailUsernames, buildCustomDomainAddress } from '../mailUsername';

describe('generateMailUsername', () => {
  it('only uses lowercase letters and digits so the local part is always valid', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateMailUsername()).toMatch(/^[a-z]+[0-9]+$/);
    }
  });

  it('stays inside a sane length range', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const username = generateMailUsername();
      expect(username.length).toBeGreaterThanOrEqual(12);
      expect(username.length).toBeLessThanOrEqual(22);
    }
  });

  it('produces a different username on each call', () => {
    const generated = new Set(Array.from({ length: 200 }, () => generateMailUsername()));
    expect(generated.size).toBe(200);
  });
});

describe('generateMailUsernames', () => {
  it('returns exactly the requested count with no duplicates', () => {
    const usernames = generateMailUsernames(25);
    expect(usernames).toHaveLength(25);
    expect(new Set(usernames).size).toBe(25);
  });

  it('returns nothing for a non-positive count', () => {
    expect(generateMailUsernames(0)).toEqual([]);
    expect(generateMailUsernames(-3)).toEqual([]);
  });

  it('skips usernames the caller says are already taken', () => {
    const taken = new Set<string>();
    const first = generateMailUsernames(5, taken);
    for (const username of first) taken.add(username);

    const second = generateMailUsernames(5, taken);

    expect(second.some((username) => first.includes(username))).toBe(false);
  });
});

describe('buildCustomDomainAddress', () => {
  it('joins the username and the domain', () => {
    expect(buildCustomDomainAddress('toibisidamatroi19090', 'oldevlk.com'))
      .toBe('toibisidamatroi19090@oldevlk.com');
  });

  it('tolerates a domain written with a leading @', () => {
    expect(buildCustomDomainAddress('abc123', '@oldevlk.com')).toBe('abc123@oldevlk.com');
  });

  it('lowercases and trims both halves', () => {
    expect(buildCustomDomainAddress('  ABC123 ', ' OldEvlk.COM ')).toBe('abc123@oldevlk.com');
  });
});
