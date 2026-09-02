import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createDatabaseConnection } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { PurchasedEmailRepository } from '../PurchasedEmailRepository';
import { ProxyLeaseRepository, ProxyIpInUseError } from '../ProxyLeaseRepository';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-purchased-'));
  db = createDatabaseConnection(path.join(tmpDir, 'test.db'));
  runMigrations(db);
});

afterEach(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('PurchasedEmailRepository', () => {
  it('persists a Gmail94 purchase with its order id and returns it as an unconsumed row', () => {
    const repo = new PurchasedEmailRepository(db);
    repo.insert({
      id: 'pe-1',
      provider: 'gmail94',
      email: 'doducs60830@gmail.com',
      orderId: '68bdb654d878a',
      service: 'facebook'
    });

    const rows = repo.listUnconsumed('gmail94', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].orderId).toBe('68bdb654d878a');
    expect(rows[0].hasPassword).toBe(false);
    expect(rows[0].consumedAt).toBeNull();
  });

  it('persists a DongVanFB purchase with encrypted password and refresh token, exposing only booleans', () => {
    const repo = new PurchasedEmailRepository(db);
    repo.insert({
      id: 'pe-2',
      provider: 'dongvanfb',
      email: 'pisangbredna67@hotmail.com',
      passwordEncrypted: Buffer.from('enc-pass'),
      refreshTokenEncrypted: Buffer.from('enc-refresh'),
      clientId: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
      rawPayloadEncrypted: Buffer.from('enc-raw-line')
    });

    const rows = repo.listUnconsumed('dongvanfb', 10);
    expect(rows[0].hasPassword).toBe(true);
    expect(rows[0].hasOauth).toBe(true);
    expect(Object.keys(rows[0])).not.toContain('passwordEncrypted');
  });

  it('returns decryptable secret material only through the explicit secret accessor', () => {
    const repo = new PurchasedEmailRepository(db);
    repo.insert({
      id: 'pe-3',
      provider: 'dongvanfb',
      email: 'x@hotmail.com',
      passwordEncrypted: Buffer.from('enc-pass'),
      refreshTokenEncrypted: Buffer.from('enc-refresh'),
      clientId: 'client-1'
    });

    const secrets = repo.getSecretsById('pe-3');
    expect(secrets?.passwordEncrypted?.toString()).toBe('enc-pass');
    expect(secrets?.clientId).toBe('client-1');
  });

  it('marks a purchase consumed and links it to the created account', () => {
    const repo = new PurchasedEmailRepository(db);
    repo.insert({ id: 'pe-4', provider: 'gmail94', email: 'a@gmail.com', orderId: 'o-1' });

    const changed = repo.markConsumed('pe-4', null);
    expect(changed).toBe(true);
    expect(repo.listUnconsumed('gmail94', 10)).toHaveLength(0);
  });

  it('refuses to store the same email twice for one provider', () => {
    const repo = new PurchasedEmailRepository(db);
    repo.insert({ id: 'pe-5', provider: 'gmail94', email: 'dupe@gmail.com', orderId: 'o-1' });
    expect(() =>
      repo.insert({ id: 'pe-6', provider: 'gmail94', email: 'dupe@gmail.com', orderId: 'o-2' })
    ).toThrow();
  });
});

describe('ProxyLeaseRepository', () => {
  it('records a lease without ever storing the raw proxy key', () => {
    const repo = new ProxyLeaseRepository(db);
    repo.recordLease({
      id: 'lease-1',
      keyValue: 'SECRET-PROXY-KEY',
      ip: '113.161.10.5',
      host: '113.161.10.5',
      port: 20001,
      protocol: 'http'
    });

    const active = repo.listActive();
    expect(active).toHaveLength(1);
    expect(JSON.stringify(active)).not.toContain('SECRET-PROXY-KEY');
  });

  it('refuses to lease an IP that another active lease already holds', () => {
    const repo = new ProxyLeaseRepository(db);
    repo.recordLease({
      id: 'lease-1', keyValue: 'k1', ip: '1.2.3.4', host: '1.2.3.4', port: 20001, protocol: 'http'
    });

    expect(() =>
      repo.recordLease({
        id: 'lease-2', keyValue: 'k2', ip: '1.2.3.4', host: '1.2.3.4', port: 20002, protocol: 'http'
      })
    ).toThrow(ProxyIpInUseError);
  });

  it('allows the same IP to be leased again once the previous lease is released', () => {
    const repo = new ProxyLeaseRepository(db);
    repo.recordLease({
      id: 'lease-1', keyValue: 'k1', ip: '1.2.3.4', host: '1.2.3.4', port: 20001, protocol: 'http'
    });
    repo.release('lease-1');

    expect(() =>
      repo.recordLease({
        id: 'lease-2', keyValue: 'k2', ip: '1.2.3.4', host: '1.2.3.4', port: 20002, protocol: 'http'
      })
    ).not.toThrow();
  });

  it('reports an IP as in use only while its lease is active', () => {
    const repo = new ProxyLeaseRepository(db);
    expect(repo.isIpActive('9.9.9.9')).toBe(false);

    repo.recordLease({
      id: 'lease-1', keyValue: 'k1', ip: '9.9.9.9', host: '9.9.9.9', port: 1080, protocol: 'socks5'
    });
    expect(repo.isIpActive('9.9.9.9')).toBe(true);

    repo.release('lease-1');
    expect(repo.isIpActive('9.9.9.9')).toBe(false);
  });

  it('lists the IPs currently held so a run never double-books one', () => {
    const repo = new ProxyLeaseRepository(db);
    repo.recordLease({
      id: 'lease-1', keyValue: 'k1', ip: '4.4.4.4', host: '4.4.4.4', port: 1, protocol: 'http'
    });
    repo.recordLease({
      id: 'lease-2', keyValue: 'k2', ip: '5.5.5.6', host: '5.5.5.6', port: 2, protocol: 'http'
    });
    repo.release('lease-1');

    expect(repo.activeIps()).toEqual(['5.5.5.6']);
  });

  it('releases a lease so the key is no longer counted as active', () => {
    const repo = new ProxyLeaseRepository(db);
    repo.recordLease({
      id: 'lease-1', keyValue: 'k1', ip: '5.5.5.5', host: '5.5.5.5', port: 20001, protocol: 'http'
    });
    expect(repo.release('lease-1')).toBe(true);
    expect(repo.listActive()).toHaveLength(0);
  });
});
