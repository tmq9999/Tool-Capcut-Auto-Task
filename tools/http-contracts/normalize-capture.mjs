import fs from 'node:fs';

const SAFE_TASK_KEYS = /^capcut_web_[a-z0-9_]+$/i;
const SAFE_PATH = /^\/(?:luckycat\/i18n\/capcut\/)?task\/v1\/(?:task_list|do_action)(?:\/)?$|^\/api\/[a-z0-9_./:-]+$/i;
const SAFE_ORIGIN = /^https:\/\/(?:[a-z0-9-]+\.)?capcut(?:api|static)?\.com$/i;
const SAFE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const SECRET_KEY = /(token|cookie|authorization|password|secret|signature|xbogus|gnarly|otp|refresh|code)/i;
const SAFE_RESPONSE_NUMBERS = new Set(['err_no', 'ret', 'error_code', 'status_code', 'status', 'task_status', 'reward_amount']);
const REVIEWED_RESPONSE_ROUTES = new Set([
  'edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',
  'edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list',
  'edit-api-sg.capcut.com/task/v1/task_list'
]);
const SAFE_BODY_STATES = new Set(['json', 'form', 'empty', 'omitted-binary', 'omitted-stream', 'policy-omitted', 'oversize', 'capacity-omitted', 'timeout', 'unreadable', 'omitted-non-json']);
const SAFE_PHASES = new Set(['before', 'action', 'client', 'proof', 'snapshot', 'end', 'fail']);
function reviewedResponseNumber(route, path, key) {
  if (!REVIEWED_RESPONSE_ROUTES.has(route)) return false;
  if ((path === '$' || path === `$.${key}`) && SAFE_RESPONSE_NUMBERS.has(key)) return true;
  return /task_list$/.test(route) && (
    (path === '$.data.task_list[]' || path === '$.data.task_list[].task_status') && key === 'task_status' ||
    (path === '$.data.task_list[].task_reward_view' || path === '$.data.task_list[].task_reward_view.reward_amount') && key === 'reward_amount'
  );
}

function scalar(value, key = '', ids = new Map(), direction = 'request', route = '', path = '$') {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (direction === 'response' && reviewedResponseNumber(route, path, key) && Number.isFinite(value)) return value;
    return '<redacted-number>';
  }
  if (typeof value !== 'string') return '<redacted-value>';
  if (direction === 'response' && reviewedResponseNumber(route, path, key) && /^-?\d+$/.test(value)) return value;
  if (SAFE_TASK_KEYS.test(value) && key === 'action_key') return value;
  if (key === 'task_key' && SAFE_TASK_KEYS.test(value)) return value;
  if (key === 'op_id' || key === 'asset_id') return '<redacted-id>';
  if (key === 'job_id') {
    if (!ids.has(value)) ids.set(value, `<id-${ids.size + 1}>`);
    return ids.get(value);
  }
  if (SECRET_KEY.test(key) || /@/.test(value) || /^Bearer\s/i.test(value)) return '<redacted-credential>';
  return '<redacted-string>';
}

function redact(value, key = '', ids = new Map(), direction = 'request', route = '', path = '$') {
  if (value === null || typeof value !== 'object') return scalar(value, key, ids, direction, route, path);
  if (Array.isArray(value)) return value.map(entry => redact(entry, key, ids, direction, route, `${path}[]`));
  const entries = Object.entries(value).map(([name, entry], index) => {
    const safeName = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : `<redacted-key-${index}>`;
    if (SECRET_KEY.test(name) && !/^(otp|code)$/i.test(name) && !(direction === 'response' && reviewedResponseNumber(route, path, name))) return [`<redacted-key-${index}>`, '<redacted-credential>'];
    return [safeName, redact(entry, name, ids, direction, route, `${path}.${name}`)];
  });
  return Object.fromEntries(entries);
}

function parseJson(value, ids = new Map(), direction = 'request', route = '') {
  if (typeof value !== 'string') {
    if (value?.content?.encoding === 'base64') return '<omitted-binary>';
    if (value && typeof value === 'object') return redact(value, '', ids, direction, route);
    return '<redacted-body>';
  }
  try { return redact(JSON.parse(value), '', ids, direction, route); } catch {
    if (/=/.test(value) && !/cookie/i.test(value) && !/\s/.test(value) && /^[\w%.-]+=/.test(value)) {
      const params = new URLSearchParams(value);
      return Object.fromEntries([...params.entries()].map(([key, entry]) => [key, redact(entry, key, ids, direction, route)]));
    }
    return '<redacted-body>';
  }
}

function bodyEnvelope(value, ids, direction, route = '') {
  if (value && typeof value === 'object' && typeof value.state === 'string') {
    const state = value.state;
    return { state: SAFE_BODY_STATES.has(state) ? state : 'opaque', body: (state === 'json' || state === 'form') && Object.prototype.hasOwnProperty.call(value, 'value') ? redact(value.value, '', ids, direction, route) : state === 'empty' ? null : `<omitted-body:${SAFE_BODY_STATES.has(state) ? state : 'unknown'}>` };
  }
  if (value === undefined) return { state: 'missing', body: '<missing-body>' };
  const body = parseJson(value, ids, direction, route);
  return { state: typeof body === 'string' ? 'opaque' : 'json', body };
}

function normalizeUrl(value) {
  let origin = null; let path = null; let valid = false;
  if (typeof value === 'string') {
    try { const parsed = new URL(value); origin = parsed.origin; path = parsed.pathname; valid = SAFE_ORIGIN.test(origin) && SAFE_PATH.test(path) && !/(secret|private|\d{5,})/i.test(path); }
    catch { return { origin: null, path: '<invalid-url>', valid: false }; }
  } else if (value && typeof value === 'object') {
    origin = typeof value.origin === 'string' ? value.origin : null;
    path = typeof value.path === 'string' ? value.path : null;
    valid = Boolean(origin && path && SAFE_ORIGIN.test(origin) && SAFE_PATH.test(path) && !/(secret|private|\d{5,})/i.test(path));
  }
  return { origin: valid ? origin : origin && SAFE_ORIGIN.test(origin) ? origin : null, path: valid ? path : path ? (path === '<invalid-url>' ? path : '/<redacted-path>') : '<missing-url>', valid };
}

function normalizeMethod(value) {
  const method = typeof value === 'string' ? value.toUpperCase() : null;
  return method && SAFE_METHODS.has(method) ? method : null;
}

function safeIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const clean = {};
  for (const key of ['runId', 'sessionId', 'accountId']) clean[key] = typeof identity[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(identity[key]) ? identity[key] : null;
  return clean;
}
function completeIdentity(identity) { return Boolean(identity && identity.runId && identity.sessionId && identity.accountId); }

function identityKey(identity) { return JSON.stringify(identity ?? null); }
function hopOf(record) { return Number.isSafeInteger(record?.redirectHop) && record.redirectHop >= 0 ? record.redirectHop : null; }
function targetOf(record) { return typeof record?.targetId === 'string' && record.targetId.length > 0 ? record.targetId : null; }
function safeMetadata(value, fallback) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value) ? value : value == null ? null : fallback; }
function safeSequence(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function safeTimestamp(value) { if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12) return value; if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))) return value; return null; }
function safeStep(value) { if (!value || typeof value !== 'object') return null; const stepId = safeMetadata(value.stepId, null); const stepAttemptId = safeMetadata(value.stepAttemptId, null); return stepId && stepAttemptId && SAFE_PHASES.has(value.phase) ? { stepId, stepAttemptId, phase: value.phase } : null; }
function safeEventType(value) { return ['request', 'request-start', 'response', 'response-body', 'request-terminal'].includes(value) ? value : null; }

function eventKind(record) {
  if (record?.version === 2 && (record.type === 'request' || record.type === 'response')) return 'v2';
  if (record?.version >= 3 && ['request-start', 'response', 'response-body', 'request-terminal'].includes(record.type)) return 'v3';
  return null;
}

function groupKey(record, kind) {
  const captureId = typeof record.captureId === 'string' ? record.captureId : '<legacy>';
  const requestId = String(record.requestId);
  if (kind === 'v2') return `v2|${captureId}|${requestId}`;
  if (kind === 'v3') return `v3|${captureId}|${identityKey(safeIdentity(record.identity))}|${targetOf(record) ?? '<target-unknown>'}|${requestId}|${hopOf(record) ?? '<hop-unknown>'}`;
  return `legacy|${captureId}|${record.sessionId ?? '<session>'}|${requestId}`;
}

function routeRole(path) { return /(?:^|\/)task\/v1\/do_action\/?$/i.test(path ?? '') ? 'reward-acknowledgement' : 'unclassified'; }

function toTransaction(group, ids, closureByCapture) {
  const { kind, records } = group;
  const start = records.find(row => kind === 'v3' ? row.type === 'request-start' : kind === 'v2' ? row.type === 'request' : row.request?.url || row.url);
  const responseEvent = records.find(row => row.type === 'response' || row.response?.status !== undefined || row.status !== undefined || row.statusCode !== undefined || row.resBody !== undefined || row.responseBody !== undefined || (kind === 'v2' && row.type === 'response'));
  const bodyEvent = kind === 'v3' ? records.find(row => row.type === 'response-body') : responseEvent;
  const terminal = kind === 'v3' ? records.find(row => row.type === 'request-terminal') : null;
  const requestSource = start?.request ?? start;
  const rawUrl = start?.url ?? requestSource?.url;
  const url = normalizeUrl(rawUrl);
  const method = normalizeMethod(requestSource?.method);
  const requestBodyRaw = kind === 'v3' ? start?.body : kind === 'v2' ? start?.body : requestSource?.postData?.text ?? requestSource?.postData ?? start?.reqBody ?? start?.requestBody ?? (typeof start?.body === 'object' ? start.body : undefined);
  const harContent = responseEvent?.response?.content;
  const harBody = harContent ? (harContent.encoding === 'base64' ? { content: { encoding: 'base64' } } : harContent.text) : undefined;
  const responseBodyRaw = kind === 'v3' ? bodyEvent?.body : kind === 'v2' ? responseEvent?.body : responseEvent?.resBody ?? responseEvent?.responseBody ?? harBody ?? responseEvent?.response?.body;
  const requestBody = requestBodyRaw === undefined && kind === 'legacy' && ['GET', 'HEAD'].includes(method) ? { state: 'empty', body: null } : bodyEnvelope(requestBodyRaw, ids, 'request');
  const responseRoute = url.origin && url.path ? `${new URL(url.origin).hostname}${url.path}` : '';
  const responseBody = kind === 'v3' ? bodyEnvelope(responseBodyRaw, ids, 'response', responseRoute) : responseBodyRaw === undefined ? { state: 'opaque', body: '<redacted-body>' } : bodyEnvelope(responseBodyRaw, ids, 'response', responseRoute);
  const responseStatus = responseEvent?.status ?? responseEvent?.statusCode ?? responseEvent?.response?.status;
  const status = typeof responseStatus === 'number' && Number.isSafeInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599 ? responseStatus : null;
  const hasBase = Boolean(start && method && url.valid);
  const hasResponse = Boolean(responseEvent && status !== null);
  const hasTerminal = kind !== 'v3' || Boolean(terminal && ['finished', 'failed'].includes(terminal.outcome));
  const eventCounts = type => records.filter(row => row.type === type).length;
  const conflicting = ['v2', 'v3'].includes(kind) && ['request', 'request-start', 'response', 'response-body', 'request-terminal'].some(type => eventCounts(type) > 1);
  const source = start ?? records[0];
  const captureId = typeof source?.captureId === 'string' ? source.captureId : null;
  const identity = safeIdentity(source?.identity);
  const hop = hopOf(source);
  const targetId = targetOf(source);
  const storedBody = body => ['json', 'form'].includes(body.state) ? body.body !== '<omitted-body:json>' && body.body !== '<omitted-body:form>' : body.state === 'empty';
  const requestAvailable = storedBody(requestBody);
  const responseAvailable = storedBody(responseBody);
  const bodyComplete = requestAvailable && responseAvailable;
  const metadataComplete = hasBase && hasResponse && hasTerminal && !conflicting && (kind !== 'v3' || completeIdentity(identity));
  const complete = metadataComplete && bodyComplete && !(terminal?.outcome === 'incomplete');
  const row = {
    schemaVersion: kind === 'v3' ? 3 : kind === 'v2' ? 2 : null,
    captureId: safeMetadata(captureId, '<redacted-id>'), identity, targetId: safeMetadata(targetId, '<redacted-id>'), hop,
    requestId: safeMetadata(source?.requestId, '<redacted-id>'),
    stage: safeMetadata(source?.stage, '<redacted-label>'), step: safeStep(source?.step),
    sequence: Object.fromEntries(records.map(r => [safeEventType(r.type), safeSequence(r.sequence)]).filter(([type, value]) => type && value !== null)),
    timestamp: Object.fromEntries(records.map(r => [safeEventType(r.type), safeTimestamp(r.timestamp)]).filter(([type, value]) => type && value !== null)),
    elapsedMs: typeof (source?.elapsedMs ?? source?.time) === 'number' && Number.isFinite(source?.elapsedMs ?? source?.time) && (source?.elapsedMs ?? source?.time) >= 0 ? source?.elapsedMs ?? source?.time : null,
    request: { method, origin: url.origin, url: url.path, headers: redact(requestSource?.headers ?? {}, 'headers', ids, 'request'), body: requestBody.body },
    response: { status, headers: redact(responseEvent?.headers ?? responseEvent?.response?.headers ?? {}, 'headers', ids, 'response'), body: responseBody.body },
    bodyStates: { request: requestBody.state, response: responseBody.state },
    metadataComplete, bodyComplete,
    terminal: terminal ? { outcome: ['finished', 'failed', 'incomplete'].includes(terminal.outcome) ? terminal.outcome : null, error: terminal.error ? 'REQUEST_FAILED' : null } : null,
    completeness: complete ? 'complete' : 'incomplete',
    contractState: complete ? 'captured' : (kind === 'legacy' && !url.valid && !records.some(record => record.request?.url || record.url) ? 'proof-only' : 'unmapped'),
    role: routeRole(url.path), dependency: 'unconfirmed',
    captureClosure: captureId && closureByCapture.has(`${captureId}|${identityKey(identity)}`) ? closureByCapture.get(`${captureId}|${identityKey(identity)}`) : 'unknown'
  };
  const correlation = {};
  if (requestBody.body && typeof requestBody.body === 'object' && !Array.isArray(requestBody.body)) for (const key of ['action_key', 'task_key', 'op_id', 'job_id', 'asset_id']) if (key in requestBody.body) correlation[key] = requestBody.body[key];
  row.correlation = correlation;
  return row;
}

function extractInput(input) {
  if (input?.log?.entries) return { records: input.log.entries, summaries: [] };
  if (Array.isArray(input)) return { records: input, summaries: [] };
  if (input && typeof input === 'object' && Array.isArray(input.records ?? input.events)) return { records: input.records ?? input.events, summaries: input.summary ? [input.summary] : input.summaries ?? [] };
  if (typeof input === 'string') return { records: input.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)), summaries: [] };
  throw new Error('CAPTURE_INVALID');
}

export function normalizeCapture(input) {
  try {
    const { records, summaries } = extractInput(input);
    const closureByCapture = new Map();
    for (const summary of summaries) if (summary?.captureId && ['closed', 'closed-with-errors', 'close-timeout'].includes(summary.closure)) {
      const summaryIdentity = safeIdentity(summary.identity);
      if (completeIdentity(summaryIdentity)) closureByCapture.set(`${summary.captureId}|${identityKey(summaryIdentity)}`, summary.closure);
    }
    const groups = new Map();
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object') throw new Error('CAPTURE_INVALID');
      if (record.type === 'capture-end') return;
      const kind = eventKind(record) ?? (record.requestId ? 'legacy' : null);
      if ((kind === 'v2' || kind === 'v3') && (!record.captureId || !record.requestId)) {
        groups.set(`invalid|${index}`, { kind, records: [record] });
        return;
      }
      if (!kind) groups.set(`record|${index}`, { kind: 'legacy', records: [record] });
      else {
        const key = groupKey(record, kind);
        if (!groups.has(key)) groups.set(key, { kind, records: [] });
        groups.get(key).records.push(record);
      }
    });
    const idsByScope = new Map();
    return [...groups.values()].map(group => {
      const first = group.records[0];
      const scope = `${first?.captureId ?? '<legacy>'}|${identityKey(safeIdentity(first?.identity))}`;
      if (!idsByScope.has(scope)) idsByScope.set(scope, new Map());
      return toTransaction(group, idsByScope.get(scope), closureByCapture);
    });
  } catch { throw new Error('CAPTURE_INVALID'); }
}

if (process.argv[1] && process.argv[1].endsWith('normalize-capture.mjs')) {
  const input = fs.readFileSync(process.argv[2], 'utf8');
  process.stdout.write(JSON.stringify(normalizeCapture(input), null, 2));
}
