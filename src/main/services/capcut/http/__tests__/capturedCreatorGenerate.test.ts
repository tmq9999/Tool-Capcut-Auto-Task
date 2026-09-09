import { expect, it } from 'vitest';
import { runCapturedCreatorGenerate } from '../capturedCreatorGenerate';

it('requires an account-owned captured contract instead of inventing creator payloads', async () => {
  await expect(runCapturedCreatorGenerate({ rows: [], context: {} as never, signal: new AbortController().signal, report: () => {}, persist: () => {} })).rejects.toThrow('CREATOR_HTTP_CONTRACT_MISSING');
});
