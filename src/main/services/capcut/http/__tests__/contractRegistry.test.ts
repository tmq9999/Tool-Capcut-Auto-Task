import { describe, expect, it } from 'vitest';
import { HttpContractRegistry } from '../contractRegistry';

const contract = { operation: 'task-list', revision: 'r1', origin: 'https://edit-api-sg.capcut.com', method: 'POST' as const, path: '/task/v1/task_list', fields: [{ name: 'cookie', origin: 'session' as const, required: true }], state: 'fixture-verified' as const };

describe('HTTP contract registry', () => {
  it('rejects unverified contracts and missing dynamic fields', () => {
    const registry = new HttpContractRegistry();
    registry.register({ ...contract, state: 'captured' });
    expect(() => registry.assertDispatchable('task-list', { cookie: 'sid' })).toThrow('CONTRACT_UNAVAILABLE');
  });

  it('allows only verified contracts with required values', () => {
    const registry = new HttpContractRegistry();
    registry.register(contract);
    expect(() => registry.assertDispatchable('task-list', {})).toThrow('HTTP_CONTRACT_FIELD_MISSING_cookie');
    expect(registry.assertDispatchable('task-list', { cookie: 'sid' }).operation).toBe('task-list');
  });

  it('loads only schema-complete manifest entries', () => {
    const registry = HttpContractRegistry.fromManifest([contract]);
    expect(registry.get('task-list').revision).toBe('r1');
    expect(() => HttpContractRegistry.fromManifest([{ ...contract, fields: undefined }])).toThrow('HTTP_CONTRACT_MANIFEST_INVALID');
  });
});
