import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads .env from the repository root once, so the live provider checks can read
 * real credentials without any extra dependency. Absent file is not an error:
 * every suite skips itself when its credential is missing.
 */
let loaded = false;

export function loadLiveEnv(): void {
  if (loaded) return;
  loaded = true;

  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  // process.loadEnvFile is available on Node 20.6+ and does not overwrite
  // variables that are already set in the shell.
  const loader = (process as unknown as { loadEnvFile?: (file: string) => void }).loadEnvFile;
  if (typeof loader === 'function') {
    loader.call(process, envPath);
    return;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function readEnv(name: string): string | null {
  loadLiveEnv();
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function isFlagOn(name: string): boolean {
  const value = readEnv(name);
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Masks a value so a log line can prove it was read without disclosing it. */
export function mask(value: string): string {
  if (value.length <= 4) return '••••';
  return value.slice(0, 2) + '••••' + value.slice(-2);
}

export function report(label: string, detail: string): void {
  process.stdout.write('    · ' + label + ': ' + detail + '\n');
}

export function skipNotice(vendor: string, envName: string): void {
  process.stdout.write('    · ' + vendor + ': bỏ qua (chưa điền ' + envName + ' trong .env)\n');
}
