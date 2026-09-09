import { expect, it } from 'vitest';
import { summarizePrivateCapture } from '../private-capture-summary.cjs';

it('keeps POST after preflight and decodes recovered body and base64 response', () => {
  const request = (id, method, extra = {}) => ({ sessionId: 1, requestId: id, type: 'Fetch', stage: 'design:chat', request: { url: 'https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/run/start', method, headers: {}, ...extra } });
  const summary = summarizePrivateCapture([
    request('1', 'OPTIONS'), request('2', 'POST', { hasPostData: true }),
    { sessionId: 1, requestId: '2', type: 'request-body', postData: '{"thread_id":"secret-thread","content":{"text":"private-prompt"}}' },
    { sessionId: 1, requestId: '2', type: 'response-body', base64Encoded: true, body: Buffer.from('{"data":{"job_id":"private-job"}}').toString('base64') },
    { type: 'capture-end' }
  ]);
  const post = summary.details.find(r => r.method === 'POST');
  expect(post.body).toEqual({ thread_id: '<string:13>', content: { text: '<string:14>' } });
  expect(post.response).toEqual({ data: { job_id: '<string:11>' } });
  expect(JSON.stringify(summary)).not.toMatch(/secret-thread|private-prompt|private-job/);
});

it('decodes binary postDataEntries and does not mix sessions', () => {
  const url = 'https://edit-api-sg.capcut.com/storyboard_agent/v1/ai_lab/send_msg';
  const summary = summarizePrivateCapture([
    { sessionId: 1, requestId: 'a', stage: 'creator:generate', request: { url, method: 'POST', headers: {}, postDataEntries: [{ bytes: Buffer.from('{"message":"hello"}').toString('base64') }] } },
    { sessionId: 2, requestId: 'a', type: 'response-body', body: '{"wrong":true}' }
  ]);
  expect(summary.details[0].body).toEqual({ message: '<string:5>' });
  expect(summary.details[0].response).not.toHaveProperty('wrong');
});
