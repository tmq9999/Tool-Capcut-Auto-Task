import { performance } from 'node:perf_hooks';

export type MonotonicNow = () => number;

export function canonicalStageName(stage: string): string {
  const ascii = stage
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const token = ascii
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || 'unknown';
}

export async function measureStage<T>(
  stage: string,
  operation: () => Promise<T>,
  log: (message: string) => void,
  now: MonotonicNow = () => performance.now()
): Promise<T> {
  const startedAt = now();
  const safeStage = canonicalStageName(stage);
  let outcome: 'success' | 'error' = 'success';
  try {
    return await operation();
  } catch (error: unknown) {
    outcome = 'error';
    throw error;
  } finally {
    const elapsedMs = Math.max(0, Math.round(now() - startedAt));
    log('stage=' + safeStage + ' elapsedMs=' + elapsedMs + ' outcome=' + outcome);
  }
}
