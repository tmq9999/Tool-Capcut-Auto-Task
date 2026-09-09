import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { exportCreatorAsset } from '../creatorExport';

describe('HTTP-only Creator export', () => {
  it('requires a ready asset and verifies downloaded bytes', async () => {
    const client = { requestJson: async () => ({ status: 200, ok: true, data: { ret: 0, data: { items: [{ resource: 'r1', url: 'https://artifact.example/r1' }] } } }) };
    const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(100)])); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const session = { accountId: 'a', proxy: { server: 'http://127.0.0.1:9' }, context: { get: async () => ({ ok: () => true, body: async () => Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(100)]), headers: () => ({ 'content-type': 'image/png' }), dispose: async () => {} }) }, headers: {} } as never;
    const receipt = await exportCreatorAsset(client as never, session, { path: '/storyboard_agent/v1/ai_lab/batch_query_assets', body: {}, assetResource: 'r1', downloadOrigin: 'https://artifact.example' });
    expect(receipt.resource).toBe('r1');
    server.close(); void port;
  });
});
