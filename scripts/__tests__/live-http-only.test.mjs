import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('HTTP-only harness boundary', () => {
  it('fails before network/browser when session material is absent', () => {
    const result = spawnSync(process.execPath, ['scripts/live-http-only.cjs'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('HTTP_ONLY_SESSION_REQUIRED');
    expect(result.stdout).not.toContain('electron');
  });

  it('does not claim full flow when bootstrap or ledger modes fail', () => {
    const result = spawnSync(process.execPath, ['scripts/live-http-only.cjs'], { encoding: 'utf8' });
    expect(result.stdout).toContain('"mechanism":"cycletls"');
    expect(result.stdout).not.toMatch(/full[- ]?flow/i);
  });

  it('rejects direct bootstrap before native context initialization', () => {
    const result = spawnSync(process.execPath, ['scripts/live-http-only.cjs', '--bootstrap'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('HTTP_ONLY_PROXY_FILE_REQUIRED');
    expect(result.stdout).not.toContain('CYCLETLS_BINARY_MISSING');
    expect(result.stdout).not.toContain('http://');
  });

  it('sanitizes invalid KiotProxy route content before network', () => {
    const result = spawnSync(process.execPath, [
      'scripts/live-http-only.cjs', '--bootstrap', '--proxy-file=scripts/__tests__/live-http-only.test.mjs'
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('HTTP_ONLY_PROXY_ROUTE_INVALID');
    expect(result.stdout).not.toContain('describe');
    expect(result.stdout).not.toContain('CYCLETLS_BINARY_MISSING');
  });
});
