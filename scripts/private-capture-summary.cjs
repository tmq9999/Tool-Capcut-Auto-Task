function shape(v, name = '', depth = 0) {
  if (/cookie|token|password|secret|sign|authorization|credential/i.test(name)) return '<secret>';
  if (depth > 15) return '<depth>';
  if (v === null) return null;
  if (Array.isArray(v)) return v.slice(0, 2).map(x => shape(x, name, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 100).map(([k,x]) => [k, shape(x, k, depth + 1)]));
  if (typeof v === 'string') {
    try { if (/^[\[{]/.test(v)) return { serializedJson: shape(JSON.parse(v), name, depth + 1) }; } catch {}
    return `<string:${v.length}>`;
  }
  return typeof v;
}

function summarizePrivateCapture(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.requestId) continue;
    const key = `${row.sessionId}:${row.requestId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const counts = {}; const details = []; const seen = new Set();
  for (const entries of groups.values()) {
    const r = entries.find(x => x.request?.url);
    if (!r) continue;
    const url = new URL(r.request.url);
    const route = url.pathname;
    const s = entries.find(x => x.response?.status);
    const b = entries.find(x => x.type === 'request-body');
    const response = entries.find(x => x.type === 'response-body');
    const body = r.request.postData ?? b?.postData ?? (r.request.postDataEntries?.length
      ? Buffer.concat(r.request.postDataEntries.map(x => Buffer.from(x.bytes ?? '', 'base64'))).toString('utf8') : undefined);
    counts[route] = (counts[route] || 0) + 1;
    const id = `${r.stage}:${r.request.method}:${route}`;
    if (!/thread\/(create|run\/start)|ai_lab\/(send_msg|poll_by_event_id)|task\/v1\/task_list|canvas\/save|upload_sign|ttuploader/.test(route) || seen.has(id)) continue;
    seen.add(id);
    let decoded; try { decoded = JSON.parse(body); } catch { decoded = { bodyType: typeof body, length: body?.length, entries: r.request.postDataEntries?.map(x => x.bytes?.length) }; }
    let result; try { result = JSON.parse(response?.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response?.body); } catch { result = { length: response?.body?.length }; }
    details.push({ stage: r.stage, route, method: r.request.method, queryKeys: [...url.searchParams.keys()], headers: Object.keys(r.request.headers), body: shape(decoded), status: s?.response.status, response: shape(result), streamChunks: entries.filter(x => x.type === 'stream').length });
  }
  return { records: rows.length, end: rows.at(-1)?.type, counts, details };
}
module.exports = { summarizePrivateCapture };
