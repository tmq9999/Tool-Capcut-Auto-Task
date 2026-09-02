import crypto from 'node:crypto';
import type { PasswordConfig } from '../../shared/schemas/automation.schema';

const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*';

function pick(alphabet: string): string {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

/**
 * Builds the CapCut account password for a run. Random mode guarantees at least
 * one character from every enabled class, then fills the rest from the union and
 * shuffles so the guaranteed characters are not always at the front.
 */
export function generateCapcutPassword(config: PasswordConfig): string {
  if (config.mode === 'custom') {
    return config.value;
  }

  const classes: string[] = [LOWERCASE];
  if (config.uppercase) classes.push(UPPERCASE);
  if (config.numbers) classes.push(DIGITS);
  if (config.special) classes.push(SPECIAL);

  const alphabet = classes.join('');
  const characters = classes
    .slice(0, Math.min(classes.length, config.length))
    .map((alphabetClass) => pick(alphabetClass));

  while (characters.length < config.length) {
    characters.push(pick(alphabet));
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapWith = crypto.randomInt(0, index + 1);
    const held = characters[index];
    characters[index] = characters[swapWith];
    characters[swapWith] = held;
  }

  return characters.join('');
}
