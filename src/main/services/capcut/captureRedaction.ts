// Private diagnostic capture, not a replay fixture. Unknown values are opaque.
const SENSITIVE = /cookie|authorization|token|password|passwd|secret|signature|bogus|gnarly|otp|refresh|code|credential/i;
const NUMBERS = new Set(['err_no', 'status', 'task_status', 'reward_amount', 'width', 'height', 'size', 'duration']);
const MIME = new Set(['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/event-stream']);
const REVIEWED_RESPONSE_FIELDS = new Set(
  ['edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action', 'edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list', 'edit-api-sg.capcut.com/task/v1/task_list']
    .flatMap(route => ['err_no', 'ret', 'error_code', 'status_code', 'status'].map(key => `${route}:$.${key}`))
);
const TASK_LIST_ROUTE = 'edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list';
const TASK_LIST_ROUTES = new Set([TASK_LIST_ROUTE, 'edit-api-sg.capcut.com/task/v1/task_list']);
const SAFE_TASK_KEY = /^capcut_web_[a-z_]{1,100}$/;

export function createCaptureRedactor() {
  const refs = new Map<string, string>();
  const ref = (value: unknown): string => {
    const key = typeof value + ':' + String(value);
    if (!refs.has(key)) refs.set(key, '<ref-' + (refs.size + 1) + '>');
    return refs.get(key)!;
  };
  const field = (name: string): string => /^[a-zA-Z_][a-zA-Z0-9_.-]{0,79}$/.test(name) ? name : ref(name);
  const value = (input: unknown, key = '', depth = 0): unknown => {
    if (SENSITIVE.test(key)) return '<redacted>';
    if (depth > 40) return '<omitted-depth>';
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return NUMBERS.has(key) && Number.isFinite(input) ? input : ref(input);
    if (typeof input === 'string') {
      if (input === '') return '';
      if (/^(action_key|task_key)$/.test(key) && /^capcut_web_[a-z_]{1,100}$/.test(input)) return input;
      // JSON serialized inside JSON must be redacted structurally as well.
      if (/^\s*[{[]/.test(input)) {
        try { return value(JSON.parse(input), key, depth + 1); } catch { /* opaque below */ }
      }
      return ref(input);
    }
    if (Array.isArray(input)) return input.map(item => value(item, key, depth + 1));
    if (typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([k, v]) => [field(k), value(v, k, depth + 1)]));
    return '<unavailable>';
  };
  const responseValue = (input: unknown, route: string, key = '', depth = 0, jsonPath = '$'): unknown => {
    if (depth > 40) return '<omitted-depth>';
    const reviewedTaskField = TASK_LIST_ROUTES.has(route) && (
      jsonPath === '$.data.task_list[].task_status' ||
      jsonPath === '$.data.task_list[].task_reward_view.reward_amount'
    );
    if ((REVIEWED_RESPONSE_FIELDS.has(`${route}:${jsonPath}`) || reviewedTaskField) &&
        ((typeof input === 'number' && Number.isFinite(input)) || (typeof input === 'string' && /^-?\d+$/.test(input)))) {
      return input;
    }
    if (TASK_LIST_ROUTES.has(route) && jsonPath === '$.data.task_list[].task_key' && typeof input === 'string' && SAFE_TASK_KEY.test(input)) return input;
    if (SENSITIVE.test(key)) return '<redacted>';
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' || typeof input === 'string') return input === '' ? '' : ref(input);
    if (Array.isArray(input)) return input.map(item => responseValue(item, route, key, depth + 1, `${jsonPath}[]`));
    if (typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([childKey, child]) => [field(childKey), responseValue(child, route, childKey, depth + 1, `${jsonPath}.${childKey}`)]));
    }
    return '<unavailable>';
  };
  const url = (raw: string): unknown => {
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return { state: 'non-http' };
      // Keep API route words, replace identifiers/emails/encoded segments.
      const pathname = parsed.pathname.split('/').map(part => part === '' || part === 'i18n' || /^[a-z_-]{1,64}$/.test(part) || /^v\d{1,2}$/.test(part) ? part : ref(part)).join('/');
      return {
        origin: /(^|\.)(capcut\.com|capcutapi\.com|capcutstatic\.com)$/.test(parsed.hostname) ? parsed.origin : ref(parsed.origin),
        path: pathname,
        query: [...parsed.searchParams].map(([k, v]) => ({ name: field(k), value: value(v, k) }))
      };
    } catch { return { state: 'invalid-url' }; }
  };
  const headers = (raw: Record<string, string>) => Object.fromEntries(Object.entries(raw).map(([k, v]) => {
    const name = k.toLowerCase();
    if (name === 'content-type') {
      const mime = v.split(';')[0].trim().toLowerCase();
      return [name, MIME.has(mime) ? mime : ref(v)];
    }
    if (name === 'content-length' && /^\d+$/.test(v)) return [name, v];
    return [field(name), SENSITIVE.test(name) ? '<redacted>' : ref(v)];
  }));
  return { value, responseValue, url, headers, ref };
}
