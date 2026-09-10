import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { migration001 } from '../../src/main/database/migrations/001_initial_schema';
import { CredentialRepository } from '../../src/main/repositories/CredentialRepository';

const require = createRequire(import.meta.url);
const { insertMultiloginIfMissing } = require('../liveCredentials.cjs');

describe('B16 live credentials schema & helper', () => {
  it('B16 uses existing credential columns and preserves an existing record', () => {
    const db = new Database(':memory:');
    try {
      db.exec(migration001);
      const repo = new CredentialRepository(db);
      expect(insertMultiloginIfMissing(repo, Buffer.from('payload-A'))).toBe(true);
      expect(insertMultiloginIfMissing(repo, Buffer.from('payload-B'))).toBe(false);
      const row = db
        .prepare('SELECT encrypted_credentials FROM service_credentials WHERE service_name=?')
        .get('multilogin') as { encrypted_credentials: Buffer };
      expect(row.encrypted_credentials.toString()).toBe('payload-A');
    } finally {
      db.close();
    }
  });

  it('B16 live script does not reference non-existent id or created_at columns in service_credentials', () => {
    const liveScriptPath = path.resolve('scripts/live-test-capcut-engine.cjs');
    const content = fs.readFileSync(liveScriptPath, 'utf8');
    expect(content).not.toMatch(/SELECT id FROM service_credentials/i);
    expect(content).not.toMatch(/INSERT INTO service_credentials\s*\([^)]*\bid\b/i);
    expect(content).not.toMatch(/INSERT INTO service_credentials\s*\([^)]*\bcreated_at\b/i);
  });
});
