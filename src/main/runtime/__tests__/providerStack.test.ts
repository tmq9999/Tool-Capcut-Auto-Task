import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { createProviderStack, createProviderStackRepositories } from '../providerStack';
import type { HttpClient, HttpRequest, HttpResponse } from '../../providers/HttpClient';
import type { ICredentialVault } from '../../security/CredentialVault';
import type { HttpObservationEvent } from '../../providers/ObservedHttpClient';

class PlainVault implements ICredentialVault {
  isAvailable(): boolean { return true; }
  encrypt(plainText: string): Buffer { return Buffer.from('enc:' + plainText, 'utf8'); }
  decrypt(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    return raw.startsWith('enc:') ? raw.slice(4) : raw;
  }
}

class RecordingHttp implements HttpClient {
  public requests: HttpRequest[] = [];
  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return { status: 200, ok: true, body: { success: true, data: { money: '1000' } }, rawText: '' };
  }
}

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-stack-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createProviderStack', () => {
  it('registers connectivity probes only for the four implemented services', () => {
    const stack = createProviderStack(createProviderStackRepositories(db), new PlainVault(), new RecordingHttp());

    expect(stack.providerRegistry.registeredServices().sort()).toEqual([
      'dongvanfb', 'gmail94', 'kiotproxy', 'multilogin'
    ]);
    expect(stack.providerRegistry.has('gologin')).toBe(false);
  });

  it('exposes the services the IPC layer needs', () => {
    const stack = createProviderStack(createProviderStackRepositories(db), new PlainVault(), new RecordingHttp());

    expect(typeof stack.accountService.list).toBe('function');
    expect(typeof stack.automationRunService.start).toBe('function');
    expect(typeof stack.emailPurchaseService.getProviderConfigs).toBe('function');
    const runtimeService = stack.automationRunService as unknown as {
      deps: { workSources: unknown; emailOtp: unknown };
    };
    expect(runtimeService.deps.workSources).toBeDefined();
    expect(runtimeService.deps.emailOtp).toBe(stack.emailPurchaseService);
  });

  it('reports both email providers as unconfigured on a fresh database', () => {
    const stack = createProviderStack(createProviderStackRepositories(db), new PlainVault(), new RecordingHttp());

    expect(stack.emailPurchaseService.getProviderConfigs()).toEqual([
      { provider: 'gmail94', isConfigured: false, maskedHint: '••••••••' },
      { provider: 'dongvanfb', isConfigured: false, maskedHint: '••••••••' }
    ]);
  });

  it('routes a Gmail94 connectivity probe through the injected http client', async () => {
    const http = new RecordingHttp();
    const repositories = createProviderStackRepositories(db);
    const vault = new PlainVault();
    repositories.credentialRepo.saveCredential('gmail94', vault.encrypt('GM-KEY'), {
      maskedHint: '••••••••',
      status: 'unknown'
    });
    const stack = createProviderStack(repositories, vault, http);

    const probe = stack.providerRegistry.get('gmail94');
    await probe?.testConnection();

    expect(http.requests[0].url).toContain('/profile?token=GM-KEY');
  });

  it('decorates the shared injected transport without adding metadata to its request', async () => {
    const events: HttpObservationEvent[] = [];
    const http = new RecordingHttp();
    const repositories = createProviderStackRepositories(db);
    const vault = new PlainVault();
    repositories.credentialRepo.saveCredential('gmail94', vault.encrypt('GM-KEY'), {
      maskedHint: '••••••••', status: 'unknown'
    });
    const stack = createProviderStack(repositories, vault, http, {
      httpObserver: (event) => { events.push(event); }
    });

    await stack.providerRegistry.get('gmail94')?.testConnection();

    expect(events.map((event) => event.phase)).toEqual(['request', 'response']);
    expect(events[0]).toMatchObject({
      routeTemplate: '/profile',
      businessCategory: 'other',
      identity: { scope: 'unscoped' }
    });
    expect(http.requests[0]).toEqual({
      method: 'GET',
      url: 'https://gmail94.com/api/profile?token=GM-KEY'
    });
  });

  /**
   * Tên test này luôn nói "refuses to start", nhưng phần assert cũ lại khẳng định
   * run VẪN start rồi mới có 1 luồng fail — hai thứ mâu thuẫn nhau. Audit
   * 04/09/2026 chỉ ra đó chính là lỗi: `start()` mua email TRƯỚC, `launchThread`
   * fail SAU, nên chọn browser chưa có là tiêu tiền hộp thư rồi mới báo lỗi.
   * Nay hành vi khớp với cái tên: từ chối ngay, không tạo luồng nào.
   */
  it('refuses to start a run for a browser that is not implemented yet', async () => {
    const stack = createProviderStack(createProviderStackRepositories(db), new PlainVault(), new RecordingHttp());

    await expect(
      stack.automationRunService.start({
        threadCount: 1,
        browser: 'gologin',
        headless: false,
        retryCount: 0,
        stepDelayMinMs: 0,
        stepDelayMaxMs: 0,
        typeDelayMinMs: 0,
        typeDelayMaxMs: 0,
        module: 'credit',
        skipWithoutTrial: false,
        emailSource: { mode: 'manual', entries: ['a@b.com|p'] },
        proxy: { mode: 'direct', entries: [] },
        password: { mode: 'random', length: 12, uppercase: true, numbers: true, special: false },
        testDurationMs: 0
      })
    ).rejects.toMatchObject({
      state: 'blocked',
      reason: { code: 'PROVIDER_CONFIG_ERROR' }
    });

    expect(stack.automationRunService.isRunning()).toBe(false);
  });

  it('tạo AccountTaskRepository trên cùng database của stack', () => {
    const stack = createProviderStack(createProviderStackRepositories(db), new PlainVault(), new RecordingHttp());

    stack.repositories.accountTaskRepo.upsertMany('acc-1', [
      { key: 'capcut_web_pwa_install', title: 'Install app', reward: 30, status: 4, opId: 'op-1' }
    ]);

    // Ghi qua repository của stack thì đọc lại được từ chính connection đó — bảng
    // `account_tasks` của migration 004 đã có mặt trong DB mà stack đang dùng.
    const rows = db.prepare('SELECT account_id, task_key, status, op_id FROM account_tasks').all();
    expect(rows).toEqual([
      { account_id: 'acc-1', task_key: 'capcut_web_pwa_install', status: 4, op_id: 'op-1' }
    ]);
  });
});
