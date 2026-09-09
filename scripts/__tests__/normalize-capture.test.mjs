import { describe, expect, it } from 'vitest';
import { normalizeCapture } from '../../tools/http-contracts/normalize-capture.mjs';

describe('normalizeCapture', () => {
  it('joins separate v2 request and response events without moving the response body into the request', () => {
    const rows = normalizeCapture([
      {
        version: 2,
        captureId: 'fixture-a',
        type: 'request',
        requestId: 'req-1',
        method: 'POST',
        url: {
          origin: 'https://edit-api-sg.capcut.com',
          path: '/luckycat/i18n/capcut/task/v1/do_action',
          query: []
        },
        body: { state: 'json', value: { action_key: 'capcut_web_video_studio_export' } }
      },
      {
        version: 2,
        captureId: 'fixture-a',
        type: 'response',
        requestId: 'req-1',
        status: 200,
        body: { state: 'json', value: { err_no: 0, data: {} } }
      }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      schemaVersion: 2,
      captureId: 'fixture-a',
      identity: null,
      hop: null,
      requestId: 'req-1',
      request: {
        method: 'POST',
        origin: 'https://edit-api-sg.capcut.com',
        url: '/luckycat/i18n/capcut/task/v1/do_action',
        body: { action_key: 'capcut_web_video_studio_export' }
      },
      response: { status: 200, body: { err_no: 0, data: {} } },
      bodyStates: { request: 'json', response: 'json' },
      completeness: 'complete',
      contractState: 'captured',
      role: 'reward-acknowledgement',
      dependency: 'unconfirmed',
      captureClosure: 'unknown'
    });
    expect(rows[0].request.body).not.toHaveProperty('err_no');
    expect(rows[0].role).not.toMatch(/upload|generate|export-operation/);
  });

  it('does not promote a truthy URL object with missing safe request facts', () => {
    const [row] = normalizeCapture([
      { version: 2, captureId: 'fixture-a', type: 'request', requestId: 'req-2', url: { query: [] }, body: { state: 'empty' } },
      { version: 2, captureId: 'fixture-a', type: 'response', requestId: 'req-2', status: 200, body: { state: 'empty' } }
    ]);

    expect(row.request).toMatchObject({ method: null, origin: null, url: '<missing-url>' });
    expect(row).toMatchObject({ completeness: 'incomplete', contractState: 'unmapped', hop: null });
  });

  it('scopes v3 joins by capture, identity, target and redirect hop and trusts only a matching final sidecar', () => {
    const identityA = { runId: 'run-a', sessionId: 'session-a', accountId: 'account-a' };
    const identityB = { runId: 'run-a', sessionId: 'session-b', accountId: 'account-b' };
    const envelope = (captureId, identity, sequence, extra = {}) => ({
      version: 3,
      captureId,
      identity,
      requestId: 'same-id',
      targetId: 'target-1',
      redirectHop: 0,
      stage: 'video:export',
      step: { stepId: 'S26', stepAttemptId: 'attempt-1', phase: 'action' },
      sequence,
      timestamp: `2026-09-09T00:00:0${sequence}.000Z`,
      elapsedMs: sequence,
      ...extra
    });
    const complete = (captureId, identity, action, offset = 0) => [
      envelope(captureId, identity, offset + 1, {
        type: 'request-start', method: 'POST',
        url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action', query: [] },
        body: { state: 'json', value: { action_key: action } }
      }),
      envelope(captureId, identity, offset + 2, { type: 'response', status: 200, headers: {} }),
      envelope(captureId, identity, offset + 3, { type: 'response-body', body: { state: 'json', value: { err_no: 0 } } }),
      envelope(captureId, identity, offset + 4, { type: 'request-terminal', outcome: 'finished' })
    ];
    const redirect = complete('capture-a', identityA, 'capcut_web_video_studio_generate', 4)
      .map(row => ({ ...row, redirectHop: 1 }));
    const records = [
      ...complete('capture-a', identityA, 'capcut_web_video_studio_export'),
      ...redirect,
      ...complete('capture-b', identityB, 'capcut_web_pwa_install')
    ];
    const rows = normalizeCapture({
      records,
      summary: { version: 3, captureId: 'capture-a', identity: identityA, closure: 'closed', summary: {} }
    });

    expect(rows).toHaveLength(3);
    expect(rows.map(row => [row.captureId, row.identity.accountId, row.hop])).toEqual([
      ['capture-a', 'account-a', 0],
      ['capture-a', 'account-a', 1],
      ['capture-b', 'account-b', 0]
    ]);
    expect(rows.map(row => row.request.body.action_key)).toEqual([
      'capcut_web_video_studio_export',
      'capcut_web_video_studio_generate',
      'capcut_web_pwa_install'
    ]);
    expect(rows.map(row => row.captureClosure)).toEqual(['closed', 'closed', 'unknown']);
    expect(rows.every(row => row.contractState === 'captured')).toBe(true);
    const [mismatched] = normalizeCapture({ records: complete('capture-a', identityA, 'capcut_web_pwa_install'), summary: { version: 3, captureId: 'capture-a', identity: identityB, closure: 'closed' } });
    expect(mismatched.captureClosure).toBe('unknown');
  });

  it('keeps orphan and unfinished event groups incomplete and temporal background traffic unconfirmed', () => {
    const identity = { runId: 'run-a', sessionId: 'session-a', accountId: 'account-a' };
    const base = { version: 3, captureId: 'capture-a', identity, targetId: 'target-1', redirectHop: 0, stage: 'design:chat', step: null };
    const rows = normalizeCapture([
      { ...base, type: 'response', requestId: 'orphan', status: 200, sequence: 1, timestamp: '2026-09-09T00:00:01Z', elapsedMs: 1 },
      {
        ...base, type: 'request-start', requestId: 'background', method: 'GET',
        url: { origin: 'https://www.capcut.com', path: '/api/background/poll', query: [] },
        body: { state: 'empty' }, sequence: 2, timestamp: '2026-09-09T00:00:02Z', elapsedMs: 2
      }
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ requestId: 'orphan', completeness: 'incomplete', contractState: 'unmapped' });
    expect(rows[1]).toMatchObject({
      requestId: 'background', completeness: 'incomplete', contractState: 'unmapped',
      role: 'unclassified', dependency: 'unconfirmed'
    });
  });

  it('always masks request OTP and code values while retaining reviewed response error codes', () => {
    const [row] = normalizeCapture([{
      method: 'POST',
      url: 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      reqBody: { otp: 123456, code: 654321, action_key: 'capcut_web_pwa_install' },
      resBody: { err_no: 0, error_code: 8001001, code: 987654 },
      status: 200
    }]);

    expect(row.request.body).toMatchObject({ otp: '<redacted-number>', code: '<redacted-number>' });
    expect(row.response.body).toMatchObject({ err_no: 0, error_code: 8001001, code: '<redacted-number>' });
    expect(JSON.stringify(row)).not.toMatch(/123456|654321|987654/);
  });

  it('fails closed on unsafe metadata, conflicting v3 events and omission bodies while scoping opaque refs per capture', () => {
    const identity = { runId: 'run-a', sessionId: 'session-a', accountId: 'account-a' };
    const base = { version: 3, identity, requestId: 'request secret@example.com', targetId: 'target secret@example.com', redirectHop: 0, stage: 'stage secret@example.com', step: null };
    const rows = normalizeCapture([
      { ...base, captureId: 'capture-a', type: 'request-start', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action', query: [] }, body: { state: 'json', value: { job_id: 'same-private-job' } }, sequence: 1, timestamp: '2026-09-09T00:00:01Z', elapsedMs: 1 },
      { ...base, captureId: 'capture-a', type: 'response', status: 200, headers: {}, sequence: 2, timestamp: '2026-09-09T00:00:02Z', elapsedMs: 2 },
      { ...base, captureId: 'capture-a', type: 'response', status: 500, headers: {}, sequence: 3, timestamp: '2026-09-09T00:00:03Z', elapsedMs: 3 },
      { ...base, captureId: 'capture-a', type: 'response-body', body: { state: 'omitted-binary' }, sequence: 4, timestamp: '2026-09-09T00:00:04Z', elapsedMs: 4 },
      { ...base, captureId: 'capture-a', type: 'request-terminal', outcome: 'finished', error: 'private terminal error@example.com', sequence: 5, timestamp: '2026-09-09T00:00:05Z', elapsedMs: 5 },
      { ...base, captureId: 'capture-b', type: 'request-start', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action', query: [] }, body: { state: 'json', value: { job_id: 'same-private-job' } }, sequence: 1, timestamp: '2026-09-09T00:00:01Z', elapsedMs: 1 }
    ]);

    expect(rows[0]).toMatchObject({ completeness: 'incomplete', contractState: 'unmapped', bodyStates: { response: 'omitted-binary' } });
    expect(rows[0].response.body).toBe('<omitted-body:omitted-binary>');
    expect(rows[0].requestId).toBe('<redacted-id>');
    expect(rows[0].targetId).toBe('<redacted-id>');
    expect(rows[0].stage).toBe('<redacted-label>');
    expect(rows[0].terminal.error).toBe('REQUEST_FAILED');
    expect(rows[0].request.body.job_id).toBe('<id-1>');
    expect(rows[1].request.body.job_id).toBe('<id-1>');
    expect(JSON.stringify(rows)).not.toMatch(/secret@example|private terminal|same-private-job/);
  });

  it('does not capture a v3 transaction when a critical JSON body patch omits its value', () => {
    const base = { version: 3, captureId: 'capture-a', identity: { runId: 'run-a', sessionId: 'session-a', accountId: 'account-a' }, targetId: 'target-1', redirectHop: 0, requestId: 'req-1', stage: 'stage', step: { stepId: 'secret step', stepAttemptId: 'attempt@example.com', phase: 'unknown' } };
    const [row] = normalizeCapture([
      { ...base, type: 'request-start', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action' }, body: { state: 'json', value: { action_key: 'capcut_web_pwa_install' } } },
      { ...base, type: 'response', status: 200 },
      { ...base, type: 'response-body', body: { state: 'json' } },
      { ...base, type: 'request-terminal', outcome: 'finished' }
    ]);
    expect(row).toMatchObject({ completeness: 'incomplete', contractState: 'unmapped', bodyStates: { response: 'json' } });
  });

  it('redacts untrusted v3 metadata and preserves only reviewed response codes', () => {
    const base = { version: 3, captureId: 'capture-a', identity: { runId: 'run-a', sessionId: 'session-a', accountId: 'account-a' }, targetId: 'target-1', redirectHop: 0, requestId: 'req-1', stage: 'stage', step: null };
    const [row] = normalizeCapture([
      { ...base, type: 'request-start', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/api/unknown' }, body: { state: 'json', value: {} }, sequence: -1, timestamp: 'not-a-date', elapsedMs: 'not-number' },
      { ...base, type: 'response', status: 200 },
      { ...base, type: 'response-body', body: { state: 'json', value: { code: 123456, err_no: 0 } } },
      { ...base, type: 'request-terminal', outcome: 'surprise', error: 'raw secret' }
    ]);
    expect(row.sequence).toEqual({});
    expect(row.timestamp).toEqual({});
    expect(row.elapsedMs).toBeNull();
    expect(row.step).toBeNull();
    expect(row.terminal).toMatchObject({ outcome: null, error: 'REQUEST_FAILED' });
    expect(row.response.body).toMatchObject({ code: '<redacted-number>', err_no: '<redacted-number>' });
  });

  it('marks conflicting v2 request/response events incomplete instead of selecting the first', () => {
    const [row] = normalizeCapture([
      { version: 2, captureId: 'capture-a', type: 'request', requestId: 'req-1', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action' }, body: { state: 'empty' } },
      { version: 2, captureId: 'capture-a', type: 'response', requestId: 'req-1', status: 200, body: { state: 'empty' } },
      { version: 2, captureId: 'capture-a', type: 'response', requestId: 'req-1', status: 500, body: { state: 'empty' } }
    ]);
    expect(row).toMatchObject({ completeness: 'incomplete', contractState: 'unmapped' });
  });

  it('decodes HAR response content text and ignores capture-end as a transaction', () => {
    const rows = normalizeCapture({ log: { entries: [
      { time: 1, request: { method: 'POST', url: 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action', headers: [], postData: { text: '{"action_key":"capcut_web_pwa_install"}' } }, response: { status: 200, content: { mimeType: 'application/json', text: '{"err_no":0}' } } },
      { version: 3, captureId: 'capture-a', type: 'capture-end', closure: 'flush-pending' }
    ] } });
    expect(rows).toHaveLength(1);
    expect(rows[0].response.body).toMatchObject({ err_no: 0 });
  });

  it('does not join or capture v2/v3 events when capture or request identity is missing', () => {
    const rows = normalizeCapture([
      { version: 2, type: 'request', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action' }, body: { state: 'empty' } },
      { version: 2, type: 'response', status: 200, body: { state: 'empty' } },
      { version: 3, captureId: 'capture-a', type: 'request-start', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action' }, body: { state: 'empty' } }
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.completeness === 'incomplete' && row.contractState === 'unmapped')).toBe(true);
  });

  it('requires available request and response payloads before a transaction is captured', () => {
    const base = { version: 3, captureId: 'capture-a', identity: { runId: 'run-a', sessionId: 'session-a', accountId: 'account-a' }, requestId: 'req-1', stage: 'stage', step: null };
    for (const [requestBody, responseBody] of [
      [{ state: 'json' }, { state: 'json', value: { err_no: 0 } }],
      [{ state: 'form' }, { state: 'json', value: { err_no: 0 } }],
      [{ state: 'json', value: {} }, { state: 'omitted-binary' }],
      [{ state: 'json', value: {} }, { state: 'timeout' }]
    ]) {
      const [row] = normalizeCapture([
        { ...base, type: 'request-start', method: 'POST', url: { origin: 'https://www.capcut.com', path: '/task/v1/do_action' }, body: requestBody },
        { ...base, type: 'response', status: 200 },
        { ...base, type: 'response-body', body: responseBody },
        { ...base, type: 'request-terminal', outcome: 'finished' }
      ]);
      expect(row).toMatchObject({ metadataComplete: true, bodyComplete: false, completeness: 'incomplete', contractState: 'unmapped' });
    }
  });

  it('requires a safe HTTP status and complete v3 identity before capture', () => {
    const eventRows = (status, identity) => {
      const base = { version: 3, captureId: 'capture-a', identity, requestId: 'req-1', stage: 'stage', step: null };
      return [
        { ...base, type: 'request-start', method: 'GET', url: { origin: 'https://www.capcut.com', path: '/api/safe' }, body: { state: 'empty' } },
        { ...base, type: 'response', status },
        { ...base, type: 'response-body', body: { state: 'empty' } },
        { ...base, type: 'request-terminal', outcome: 'finished' }
      ];
    };
    const full = { runId: 'run-a', sessionId: 'session-a', accountId: 'account-a' };
    for (const status of ['', 0, Number.NaN, 700]) {
      const [row] = normalizeCapture(eventRows(status, full));
      expect(row).toMatchObject({ completeness: 'incomplete', contractState: 'unmapped', response: { status: null } });
    }
    for (const identity of [null, { runId: 'run-a', sessionId: 'session-a' }]) {
      const [row] = normalizeCapture(eventRows(200, identity));
      expect(row).toMatchObject({ completeness: 'incomplete', contractState: 'unmapped' });
    }
  });

  it('redacts unsafe keys, arbitrary numbers and raw event type markers but preserves reviewed numeric strings', () => {
    const reviewed = normalizeCapture([{
      method: 'POST', url: 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
      reqBody: { arbitrary: 424242, 'email@example.com': 'private' }, resBody: { ret: '0', arbitrary: 313131 }, status: 200, type: 'private-event@example.com'
    }])[0];
    const unknown = normalizeCapture([{
      method: 'POST', url: 'https://www.capcut.com/api/unknown', reqBody: {}, resBody: { ret: '0' }, status: 200
    }])[0];
    expect(reviewed.response.body.ret).toBe('0');
    expect(reviewed.request.body.arbitrary).toBe('<redacted-number>');
    expect(reviewed.response.body.arbitrary).toBe('<redacted-number>');
    expect(unknown.response.body.ret).toBe('<redacted-string>');
    const output = JSON.stringify([reviewed, unknown]);
    expect(output).not.toMatch(/424242|313131|email@example|private-event/);
  });

  it('redacts nested credentials while preserving task/action contract shape', () => {
    const [row] = normalizeCapture([{
      method: 'POST',
      url: 'https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action?token=real',
      headers: { Authorization: 'Bearer real', Cookie: 'sid=secret', 'Content-Type': 'application/json' },
      reqBody: JSON.stringify({ action_key: 'capcut_web_design_studio_ai_chat', op_id: 'user-secret' }),
      resBody: JSON.stringify({ err_no: 0, err_tips: '' }),
      status: 200
    }]);
    expect(row).toMatchObject({
      request: { method: 'POST', url: '/luckycat/i18n/capcut/task/v1/do_action', body: { action_key: 'capcut_web_design_studio_ai_chat', op_id: '<redacted-id>' } },
      response: { status: 200, body: { err_no: 0, err_tips: '<redacted-string>' } },
      contractState: 'captured'
    });
    expect(JSON.stringify(row)).not.toContain('real');
    expect(JSON.stringify(row)).not.toContain('secret');
  });

  it('keeps proof-only fixtures explicitly non-replayable', () => {
    const [row] = normalizeCapture([{ reqBody: '{"action_key":"capcut_web_pwa_install"}', resBody: '{"err_no":0}' }]);
    expect(row.contractState).toBe('proof-only');
    expect(row.request.url).toBe('<missing-url>');
    expect(row.request.method).toBeNull();
    expect(row.response.status).toBeNull();
  });

  it('does not preserve unknown URL paths or raw malformed bodies', () => {
    const [row] = normalizeCapture([{ method: 'GET', url: 'https://evil.example/raw/private', reqBody: 'cookie=raw', resBody: 'not-json' }]);
    expect(row.request.url).toBe('/<redacted-path>');
    expect(row.request.body).toBe('<redacted-body>');
    expect(row.response.body).toBe('<redacted-body>');
  });

  it('redacts sensitive numbers, object keys, arbitrary task labels and path segments', () => {
    const [row] = normalizeCapture([{
      method: 'POST', url: 'https://www.capcut.com/api/private-secret/123456',
      reqBody: { otp: 987654, action_key: 'private-task-secret', 'private-key-secret': 'value-secret', token: 'capcut_web_private_secret' },
      resBody: { balance: 765432, 'private-field-secret': ['nested-secret'] }
    }]);
    const output = JSON.stringify(row);
    for (const value of ['987654', '765432', 'private-secret', 'private-task-secret', 'private-key-secret', 'value-secret', 'nested-secret', 'capcut_web_private_secret']) {
      expect(output).not.toContain(value);
    }
    expect(row.request.url).toBe('/<redacted-path>');
  });

  it('preserves capture-local id relationships without collapsing different jobs', () => {
    const rows = normalizeCapture([
      { method: 'POST', url: 'https://www.capcut.com/task/v1/do_action', reqBody: { job_id: 'job-secret-a' }, resBody: { job_id: 'job-secret-b' } },
      { method: 'POST', url: 'https://www.capcut.com/task/v1/do_action', reqBody: { job_id: 'job-secret-b' } }
    ]);
    expect(rows[0].request.body.job_id).not.toBe(rows[0].response.body.job_id);
    expect(rows[0].response.body.job_id).toBe(rows[1].request.body.job_id);
    expect(rows[0].correlation.job_id).toBe(rows[0].request.body.job_id);
    expect(JSON.stringify(rows)).not.toContain('job-secret');
  });

  it('normalizes HAR without exposing headers, query values, or binary bodies', () => {
    const [row] = normalizeCapture({ log: { entries: [{
      startedDateTime: '2026-09-06T00:00:00Z', time: 42,
      request: { method: 'POST', url: 'https://www.capcut.com/task/v1/do_action?token=secret-query', headers: [{ name: 'Cookie', value: 'secret-cookie' }], postData: { mimeType: 'application/x-www-form-urlencoded', text: 'op_id=secret-id&otp=654321' } },
      response: { status: 200, headers: [{ name: 'Set-Cookie', value: 'secret-new-cookie' }], content: { mimeType: 'image/png', encoding: 'base64', text: 'secret-binary' } }
    }] } });
    expect(row.request.method).toBe('POST');
    expect(row.response.status).toBe(200);
    expect(row.response.body).toBe('<omitted-binary>');
    expect(row.request.body.op_id).toBe('<redacted-id>');
    expect(JSON.stringify(row)).not.toContain('secret');
    expect(row.elapsedMs).toBe(42);
  });

  it('reports malformed records without echoing raw input', () => {
    expect(() => normalizeCapture('{"secret-input":')).toThrow('CAPTURE_INVALID');
    try { normalizeCapture('{"secret-input":'); } catch (error) { expect(error.message).not.toContain('secret-input'); }
    expect(() => normalizeCapture([null])).toThrow('CAPTURE_INVALID');
  });
});
