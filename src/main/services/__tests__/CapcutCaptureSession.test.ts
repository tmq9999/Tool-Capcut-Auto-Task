import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserContext, Page, Request, Response } from 'playwright-core';
import { createDirectUiInteraction } from '../capcut/uiInteractionScheduler';

const ensureInApp = vi.fn();

vi.mock('../capcut/auth', () => ({
  ensureInApp: (...args: unknown[]) => ensureInApp(...args)
}));

const { CapcutEngineService } = await import('../CapcutEngineService');

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  ensureInApp.mockReset();
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakePage(): Page {
  const page = {
    isClosed: () => false,
    on: () => page
  };
  return page as unknown as Page;
}

function emitResponse(context: EventEmitter, attempt: number): void {
  const request = {
    url: () => 'https://edit-api-sg.capcut.com/task/v1/task_list',
    resourceType: () => 'xhr',
    headers: () => ({ 'content-type': 'application/json' }),
    postData: () => null,
    redirectedFrom: () => null,
    method: () => 'GET'
  } as unknown as Request;
  const response = {
    request: () => request,
    headers: () => ({ 'content-type': 'application/json' }),
    body: async () => Buffer.from(JSON.stringify({ err_no: attempt, token: 'private-token' })),
    status: () => 200
  } as unknown as Response;
  context.emit('request', request);
  context.emit('response', response);
}

it('preserves closed response captures for two attempts of the same account', async () => {
  vi.stubEnv('CAPCUT_CAPTURE_HTTP', '1');
  vi.stubEnv('CAPCUT_CAPTURE_PRIVATE', '0');
  vi.stubEnv('CAPCUT_HTTP_DISCOVERY_ONLY', '1');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcut-capture-session-'));
  tempDirs.push(userDataDir);
  const context = new EventEmitter();
  const signal = new AbortController().signal;
  let attempt = 0;
  ensureInApp.mockImplementation(async () => {
    emitResponse(context, ++attempt);
    return { mode: 'login', created: false };
  });
  const engine = new CapcutEngineService({ userDataDir });
  const input = {
    page: fakePage(),
    context: context as unknown as BrowserContext,
    email: 'same-account@example.com',
    password: 'Str0ngPass',
    accountId: 'same-account',
    isNewAccount: false,
    signal,
    ui: createDirectUiInteraction(signal),
    log: () => {}
  };

  await engine.runAccount(input);
  await engine.runAccount(input);

  const captureDir = path.join(userDataDir, 'captures');
  const files = fs.readdirSync(captureDir).filter((file) => file.endsWith('.ndjson'));
  expect(files).toHaveLength(2);
  expect(files.every((file) => file.startsWith('same-account-'))).toBe(true);
  const bodyStatuses = files.map((file) => {
    const records = fs.readFileSync(path.join(captureDir, file), 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.at(-1)).toMatchObject({ type: 'capture-end' });
    const response = records.find((record) => record.type === 'response-body') as {
      body: { value: { err_no: number } };
    };
    expect(JSON.parse(fs.readFileSync(path.join(captureDir, file) + '.summary.json', 'utf8'))).toMatchObject({
      version: 3,
      closure: 'closed',
      summary: { summaryPersisted: true, stopTimedOut: false }
    });
    return response.body.value.err_no;
  });
  expect(bodyStatuses.sort()).toEqual([1, 2]);
  expect(ensureInApp).toHaveBeenCalledTimes(2);
});
