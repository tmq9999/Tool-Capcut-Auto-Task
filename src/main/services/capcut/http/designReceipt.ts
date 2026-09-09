/** SSE envelopes can finish normally even when an artifact failed. */
export function inspectDesignReceipt(raw: string, threadId: string) {
  const events: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try { const event: unknown = JSON.parse(line.slice(5).trim()); if (event && typeof event==='object' && !Array.isArray(event)) events.push(event as Record<string, unknown>); } catch { /* heartbeat/text */ }
  }
  const startIndex = events.findIndex(e=>e.type==='run_start' && e.thread_id===threadId && typeof e.run_id==='string' && e.run_id.length > 0);
  const start = events[startIndex];
  const endIndex = start ? events.findIndex((e, index)=>index > startIndex && e.type==='run_end' && e.run_id===start.run_id) : -1;
  const scoped = start ? events.slice(startIndex, endIndex < 0 ? undefined : endIndex + 1).filter(e =>
    (e.run_id === undefined || e.run_id === start.run_id) && (e.thread_id === undefined || e.thread_id === threadId)) : [];
  const artifactErrors: string[] = []; let artifacts=0;
  const scan = (value: unknown, depth=0): void => {
    if(depth>30 || value===null) return;
    if(typeof value==='string') { if(/^[{[]/.test(value)) {try{scan(JSON.parse(value),depth+1);}catch { return; }} return; }
    if(Array.isArray(value)) {value.forEach(v=>scan(v,depth+1));return;}
    if(typeof value!=='object')return;
    const obj=value as Record<string,unknown>;
    if(Array.isArray(obj.artifacts)) for(const item of obj.artifacts) {
      if(!item || typeof item!=='object')continue;
      const artifact=item as Record<string,unknown>; const status=artifact.status as {ret?:unknown;errmsg?:unknown}|undefined;
      const code=status?.ret==null?'':String(status.ret);
      const failed=(code!==''&&code!=='0')||Boolean(status?.errmsg);
      if(failed) artifactErrors.push(code||'ARTIFACT_ERROR_MESSAGE');
      if(typeof artifact.resource_id==='string' && artifact.resource_id && typeof artifact.main_url==='string' && artifact.main_url && !failed) artifacts++;
    }
    Object.values(obj).forEach(v=>scan(v,depth+1));
  };
  scoped.forEach(e=>scan(e));
  const errorEvent=scoped.some(e=>typeof e.type==='string' && /error|fail/i.test(e.type));
  return {runId: typeof start?.run_id==='string'?start.run_id:undefined,started:Boolean(start),ended:endIndex >= 0,
    artifactErrors,artifacts,eventCount:events.length,accepted:Boolean(start)&&!errorEvent&&!artifactErrors.length};
}
