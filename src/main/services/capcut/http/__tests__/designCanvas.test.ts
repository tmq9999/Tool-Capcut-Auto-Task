import { describe, expect, it, vi } from 'vitest';
import { submitCanvasEdit } from '../designCanvas';

describe('HTTP canvas edit', () => {
  it('uses direct HTTP SSE and validates required linkage', async () => {
    const dispose = vi.fn(async () => {});
    const stream = response([
      { type: 'run_start', thread_id: 't', run_id: 'job' },
      { type: 'content_block_delta', run_id: 'job', content_block: { delta: JSON.stringify({ artifacts: [{ resource_id: 'image', main_url: 'https://image.example.test/image', status: { ret: '0' } }] }) } },
      { type: 'run_end', run_id: 'job' }
    ], dispose);
    const requestStream = vi.fn(async () => stream);
    const receipt = await submitCanvasEdit({ requestStream } as never, input());
    expect(receipt).toMatchObject({ accepted: true, threadId: 't', runId: 'job', artifacts: 1 });
    expect(requestStream).toHaveBeenCalledWith(expect.objectContaining({ path: '/lv/v2/intelligence/thread/run/start', effect: 'mutation', body: expect.objectContaining({ source: 1, mode: 1 }) }));
    expect(dispose).toHaveBeenCalled();
  });

  it('rejects missing workspace linkage', async () => {
    await expect(submitCanvasEdit({ requestStream: vi.fn() } as never, { ...input(), workspaceId: '' })).rejects.toThrow('CANVAS_INPUT_INVALID');
  });

  it.each([
    [],
    [{ type: 'run_start', thread_id: 'other-thread', run_id: 'job' }, { type: 'run_end', run_id: 'job' }],
    [{ type: 'run_start', thread_id: 't', run_id: 'job' }],
    [{ type: 'run_start', thread_id: 't', run_id: 'job' }, { type: 'run_end', run_id: 'job' }],
    [{ type: 'run_start', thread_id: 't', run_id: 'job' }, { type: 'artifact', run_id: 'other-job', artifacts: [{ resource_id: 'image', main_url: 'https://image.example.test/image' }] }, { type: 'run_end', run_id: 'job' }],
    [{ type: 'run_end', run_id: 'job' }, { type: 'run_start', thread_id: 't', run_id: 'job' }, { type: 'artifact', artifacts: [{ resource_id: 'image', main_url: 'https://image.example.test/image' }] }]
  ])('never calls an incomplete or mismatched stream accepted', async (...events) => {
    const rows = events.flat();
    const requestStream = vi.fn(async () => response(rows));
    await expect(submitCanvasEdit({ requestStream } as never, input())).rejects.toThrow('CANVAS_HTTP_OUTCOME_UNKNOWN');
    expect(requestStream).toHaveBeenCalledTimes(1);
  });

  it('reports a failed generated artifact instead of accepting run_end', async () => {
    const requestStream = vi.fn(async () => response([
      { type: 'run_start', thread_id: 't', run_id: 'job' },
      { type: 'artifact', run_id: 'job', artifacts: [{ status: { ret: '53001057', errmsg: 'failed' } }] },
      { type: 'run_end', run_id: 'job' }
    ]));
    await expect(submitCanvasEdit({ requestStream } as never, input())).rejects.toThrow('CANVAS_GENERATION_FAILED');
  });

  it('requires captured source/mode and image input before dispatch', async () => {
    const requestStream = vi.fn();
    await expect(submitCanvasEdit({ requestStream } as never, { ...input(), source: undefined } as never)).rejects.toThrow('CANVAS_INPUT_INVALID');
    await expect(submitCanvasEdit({ requestStream } as never, { ...input(), contents: [{ type: 'text', text: 'edit' }] })).rejects.toThrow('CANVAS_INPUT_INVALID');
    expect(requestStream).not.toHaveBeenCalled();
  });
});

function input() {
  return { workspaceId: 'w', resourceId: 'r', threadId: 't', source: 1, mode: 1,
    contents: [{ type: 'text', text: 'edit' }, { type: 'image', image_id: 'input-image' }] };
}

function response(events: unknown[], dispose = async () => {}) {
  return { status: 200, ok: true, headers: { 'content-type': 'text/event-stream' }, dispose,
    body: (async function* () { for (const event of events) yield new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'); })() };
}
