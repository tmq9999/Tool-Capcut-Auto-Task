import { describe, it, expect } from 'vitest';
import { acquireResource, releaseOwned } from './fixtures/deterministicRunHarness';

describe('deterministic harness resource ownership oracle', () => {
  it('throws DUPLICATE_OR_UNKNOWN_RELEASE on duplicate release without reacquire', () => {
    const owned = new Set<string>();
    const released = new Set<string>();

    acquireResource(owned, 'res-1');
    expect(owned.has('res-1')).toBe(true);

    releaseOwned(owned, released, 'res-1');
    expect(owned.has('res-1')).toBe(false);
    expect(released.has('res-1')).toBe(true);

    // Second release must throw DUPLICATE_OR_UNKNOWN_RELEASE
    expect(() => releaseOwned(owned, released, 'res-1')).toThrow('DUPLICATE_OR_UNKNOWN_RELEASE:res-1');
  });

  it('throws DUPLICATE_ACQUIRE when acquiring an already owned resource', () => {
    const owned = new Set<string>();
    acquireResource(owned, 'res-2');
    expect(() => acquireResource(owned, 'res-2')).toThrow('DUPLICATE_ACQUIRE:res-2');
  });

  it('succeeds on acquire -> release -> reacquire -> release cycle', () => {
    const owned = new Set<string>();
    const released = new Set<string>();

    // 1. Acquire
    acquireResource(owned, 'res-3');
    expect(owned.size).toBe(1);
    expect(owned.has('res-3')).toBe(true);

    // 2. Release
    releaseOwned(owned, released, 'res-3');
    expect(owned.size).toBe(0);
    expect(released.has('res-3')).toBe(true);

    // 3. Reacquire (valid ownership cycle)
    acquireResource(owned, 'res-3');
    expect(owned.size).toBe(1);
    expect(owned.has('res-3')).toBe(true);

    // 4. Release again
    releaseOwned(owned, released, 'res-3');
    expect(owned.size).toBe(0);
    expect(released.has('res-3')).toBe(true);
  });
});
