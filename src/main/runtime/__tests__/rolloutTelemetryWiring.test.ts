import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import type { ICredentialVault } from '../../security/CredentialVault';
import type { HttpClient, HttpRequest, HttpResponse } from '../../providers/HttpClient';

const captured = vi.hoisted(() => ({ runtime: undefined as unknown }));

vi.mock('../../services/AutomationRunService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/AutomationRunService')>();
  return {
    ...original,
    AutomationRunService: class {
      constructor(_collaborators: unknown, runtime: unknown) {
        captured.runtime = runtime;
      }
    }
  };
});

vi.mock('../../services/CapcutEngineService', () => ({
  CapcutEngineService: class {
    constructor(_options: unknown) {}
  }
}));

import { createProviderStack, createProviderStackRepositories } from '../providerStack';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(value: string): Buffer { return Buffer.from(value); }
  decrypt(value: Buffer): string { return value.toString('utf8'); }
}

class NoopHttp implements HttpClient {
  async send(_request: HttpRequest): Promise<HttpResponse> {
    return { status: 200, ok: true, body: {}, rawText: '' };
  }
}

describe('provider stack rollout telemetry wiring', () => {
  let directory: string;
  let database: Database.Database;

  beforeEach(() => {
    captured.runtime = undefined;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'am-rollout-wiring-'));
    database = createDatabaseConnection(path.join(directory, 'test.db'));
    runMigrations(database);
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('passes the exact runtime userData directory to AutomationRunService', () => {
    createProviderStack(
      createProviderStackRepositories(database),
      new PlainVault(),
      new NoopHttp(),
      { userDataDir: directory }
    );

    expect(captured.runtime).toEqual({ userDataDir: directory });
  });
});
