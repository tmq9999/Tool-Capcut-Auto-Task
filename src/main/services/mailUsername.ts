import crypto from 'node:crypto';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const MIN_LETTERS = 8;
const MAX_LETTERS = 17;
const MIN_DIGITS = 4;
const MAX_DIGITS = 5;

function pick(alphabet: string, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

/**
 * Builds a mailbox name for a catch-all domain: a run of lowercase letters
 * followed by digits, e.g. "toibisidamatroi19090". Letters-then-digits keeps the
 * local part valid everywhere and reads like a human-picked handle.
 */
export function generateMailUsername(): string {
  const letters = pick(LETTERS, crypto.randomInt(MIN_LETTERS, MAX_LETTERS + 1));
  const digits = pick(DIGITS, crypto.randomInt(MIN_DIGITS, MAX_DIGITS + 1));
  return letters + digits;
}

/** Generates `count` distinct usernames, skipping any the caller already holds. */
export function generateMailUsernames(count: number, taken?: ReadonlySet<string>): string[] {
  if (count <= 0) return [];

  const seen = new Set<string>(taken ?? []);
  const out: string[] = [];

  while (out.length < count) {
    const candidate = generateMailUsername();
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }

  return out;
}

export function buildCustomDomainAddress(username: string, domain: string): string {
  const cleanUser = username.trim().toLowerCase();
  const cleanDomain = domain.trim().toLowerCase().replace(/^@+/, '');
  return cleanUser + '@' + cleanDomain;
}
