import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { dump, setDumpDir, captureStepScreenshot } from '../diag';
import { SessionEvidenceBudget } from '../evidenceBudget';

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capcut-dump-')); });
afterEach(() => {
  vi.useRealTimers(); setDumpDir(path.resolve('.debug'));
  fs.rmSync(directory, { recursive: true });
});

it('returns within 3s when both screenshot and content hang', async () => {
  vi.useFakeTimers();
  setDumpDir(directory);
  const page = {
    screenshot: () => new Promise(() => {}), content: () => new Promise(() => {})
  } as unknown as Page;
  const result = dump(page, 'hung-renderer');
  await vi.advanceTimersByTimeAsync(3000);
  expect(await Promise.race([result, Promise.resolve('still pending')])).toBeNull();
  expect(fs.readdirSync(directory)).toEqual([]);
});

it('still saves DOM if screenshot fails', async () => {
  setDumpDir(directory);
  const page = {
    screenshot: async () => { throw new Error('screenshot unavailable'); },
    content: async () => '<html><body>fixture</body></html>'
  } as unknown as Page;
  const result = await dump(page, 'dom-only');
  expect(result).not.toBeNull();
  expect(fs.readFileSync(path.join(directory, result + '.html'), 'utf8')).toContain('fixture');
});

it('writes a step-scoped screenshot only at a responsive safe boundary using the shared budget', async () => {
  setDumpDir(directory);
  const page = {
    screenshot: async () => Buffer.from('step-image'),
    viewportSize: () => ({ width: 1200, height: 800 }),
    isClosed: () => false
  } as unknown as Page;
  const result = await captureStepScreenshot(page, {
    runId: 'run-1', sessionId: 'session-1', stepId: 'S1', phase: 'before',
    budget: new SessionEvidenceBudget({ maxBytes: 1024 }), responsiveSafe: true
  });
  expect(result).toMatchObject({ runId: 'run-1', sessionId: 'session-1', stepId: 'S1', phase: 'before' });
  expect(result?.filePath).toContain(path.join('run-1', 'session-1'));
  expect(fs.existsSync(result!.filePath)).toBe(true);
});

it('omits screenshots when the safe boundary is not declared or budget rejects them', async () => {
  setDumpDir(directory);
  const page = { screenshot: async () => Buffer.from('step-image'), viewportSize: () => ({ width: 1200, height: 800 }), isClosed: () => false } as unknown as Page;
  await expect(captureStepScreenshot(page, {
    runId: 'run-2', sessionId: 'session-2', stepId: 'S1', phase: 'after',
    budget: new SessionEvidenceBudget({ maxBytes: 1 }), responsiveSafe: true
  })).resolves.toBeNull();
  await expect(captureStepScreenshot(page, {
    runId: 'run-2', sessionId: 'session-2', stepId: 'S2', phase: 'after',
    budget: new SessionEvidenceBudget({ maxBytes: 1024 }), responsiveSafe: false
  })).resolves.toBeNull();
});
