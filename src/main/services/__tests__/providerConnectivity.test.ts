import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { CredentialRepository } from '../../repositories/CredentialRepository';
import { ServiceConnectionManager } from '../ServiceConnectionManager';
import { ProviderRegistry } from '../ProviderRegistry';
import { ProviderError } from '../../providers/ProviderError';
import type { ICredentialVault } from '../../security/CredentialVault';
import type { CredentialStatusDTO, SanitizedDiagnosticResult } from '../../../shared/schemas/diagnostics.schema';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(plainText: string): Buffer { return Buffer.from('enc:' + plainText, 'utf8'); }
  decrypt(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : raw;
  }
}

let tmpDir: string;
let db: Database.Database;
let credRepo: CredentialRepository;
let vault: PlainVault;
let published: CredentialStatusDTO[][];
const FIXED_NOW = Date.parse('2026-09-01T12:00:00.000Z');

function storeKey(serviceName: string, value: string): void {
  credRepo.saveCredential(serviceName, vault.encrypt(value), {
    maskedHint: '••••••••',
    status: 'unknown'
  });
}

function createManager(registry: ProviderRegistry): ServiceConnectionManager {
  return new ServiceConnectionManager(
    credRepo,
    vault,
    registry,
    { now: () => FIXED_NOW },
    (statuses) => published.push(statuses)
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-connectivity-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  credRepo = new CredentialRepository(db);
  vault = new PlainVault();
  published = [];
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ProviderRegistry', () => {
  it('resolves a registered service and reports unknown ones as absent', () => {
    const probe = { async testConnection(): Promise<SanitizedDiagnosticResult> {
      return { code: 'OK', message: 'ok', timestamp: new Date(FIXED_NOW).toISOString() };
    } };
    const registry = new ProviderRegistry(new Map([['gmail94', () => probe]]));

    expect(registry.has('gmail94')).toBe(true);
    expect(registry.get('gmail94')).toBe(probe);
    expect(registry.has('gologin')).toBe(false);
    expect(registry.get('gologin')).toBeUndefined();
  });
});

describe('ServiceConnectionManager.testConnection with a registered provider', () => {
  it('returns the provider diagnostic and caches it on the credential', async () => {
    storeKey('gmail94', 'GM-KEY');
    const registry = new ProviderRegistry(new Map([['gmail94', () => ({
      async testConnection(): Promise<SanitizedDiagnosticResult> {
        return {
          code: 'OK',
          message: 'Gmail94 sẵn sàng',
          timestamp: new Date(FIXED_NOW).toISOString(),
          details: { balance: 969500 }
        };
      }
    })]]));
    const manager = createManager(registry);

    const result = await manager.testConnection('gmail94');

    expect(result.code).toBe('OK');
    const cached = credRepo.getCredential('gmail94');
    expect(cached?.metadata.status).toBe('connected');
    expect(cached?.metadata.lastTestedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(cached?.metadata.lastTestResult?.code).toBe('OK');
    expect(cached?.metadata.balance).toBe(969500);
    expect(cached?.metadata.balanceFetchedAt).toBe('2026-09-01T12:00:00.000Z');
  });

  it('caches an authentication failure as an offline status', async () => {
    storeKey('kiotproxy', 'KP-TOKEN');
    const registry = new ProviderRegistry(new Map([['kiotproxy', () => ({
      async testConnection(): Promise<SanitizedDiagnosticResult> {
        return {
          code: 'AUTH_ERROR',
          message: 'Api-token không hợp lệ',
          timestamp: new Date(FIXED_NOW).toISOString()
        };
      }
    })]]));
    const manager = createManager(registry);

    const result = await manager.testConnection('kiotproxy');

    expect(result.code).toBe('AUTH_ERROR');
    expect(credRepo.getCredential('kiotproxy')?.metadata.status).toBe('offline');
  });

  it('marks a rate-limited service as degraded rather than offline', async () => {
    storeKey('dongvanfb', 'DV-KEY');
    const registry = new ProviderRegistry(new Map([['dongvanfb', () => ({
      async testConnection(): Promise<SanitizedDiagnosticResult> {
        return { code: 'RATE_LIMITED', message: 'quá nhiều yêu cầu', timestamp: new Date(FIXED_NOW).toISOString() };
      }
    })]]));
    const manager = createManager(registry);

    await manager.testConnection('dongvanfb');

    expect(credRepo.getCredential('dongvanfb')?.metadata.status).toBe('degraded');
  });
});

describe('ServiceConnectionManager.testConnection error normalization', () => {
  it('normalizes a thrown ProviderError into a sanitized diagnostic', async () => {
    storeKey('multilogin', JSON.stringify({ mode: 'credentials', email: 'a@b.com', password: 'secret' }));
    const registry = new ProviderRegistry(new Map([['multilogin', () => ({
      async testConnection(): Promise<SanitizedDiagnosticResult> {
        throw new ProviderError('AUTH_ERROR', 'Multilogin đăng nhập thất bại.', 'multilogin');
      }
    })]]));
    const manager = createManager(registry);

    const result = await manager.testConnection('multilogin');

    expect(result).toEqual({
      code: 'AUTH_ERROR',
      message: 'Multilogin đăng nhập thất bại.',
      timestamp: '2026-09-01T12:00:00.000Z'
    });
    expect(result.message).not.toContain('secret');
  });

  it('normalizes an unexpected throw without leaking its text', async () => {
    storeKey('gmail94', 'GM-KEY');
    const registry = new ProviderRegistry(new Map([['gmail94', () => ({
      async testConnection(): Promise<SanitizedDiagnosticResult> {
        throw new Error('ECONNREFUSED 127.0.0.1:443 token=GM-KEY');
      }
    })]]));
    const manager = createManager(registry);

    const result = await manager.testConnection('gmail94');

    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.message).not.toContain('GM-KEY');
  });

  it('publishes refreshed statuses after a test so the UI updates', async () => {
    storeKey('gmail94', 'GM-KEY');
    const registry = new ProviderRegistry(new Map([['gmail94', () => ({
      async testConnection(): Promise<SanitizedDiagnosticResult> {
        return { code: 'OK', message: 'ok', timestamp: new Date(FIXED_NOW).toISOString() };
      }
    })]]));
    const manager = createManager(registry);

    await manager.testConnection('gmail94');

    const lastPublish = published[published.length - 1];
    const gmail = lastPublish.find((entry) => entry.serviceName === 'gmail94');
    expect(gmail?.metadata.status).toBe('connected');
  });

  it('leaves cached metadata untouched for a service with no provider yet', async () => {
    storeKey('gologin', 'GL-TOKEN');
    const manager = createManager(new ProviderRegistry(new Map()));

    const result = await manager.testConnection('gologin');

    expect(result.code).toBe('PROVIDER_NOT_IMPLEMENTED');
    expect(credRepo.getCredential('gologin')?.metadata.status).toBe('unknown');
    expect(published).toHaveLength(0);
  });

  it('does not write metadata for a provider whose credential was never saved', async () => {
    const registry = new ProviderRegistry(new Map([['gmail94', () => ({
      async testConnection(): Promise<SanitizedDiagnosticResult> {
        return { code: 'OK', message: 'ok', timestamp: new Date(FIXED_NOW).toISOString() };
      }
    })]]));
    const manager = createManager(registry);

    await manager.testConnection('gmail94');

    expect(credRepo.getCredential('gmail94')).toBeNull();
  });
});
