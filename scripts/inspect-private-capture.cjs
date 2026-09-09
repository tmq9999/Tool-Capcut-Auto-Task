const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { summarizePrivateCapture } = require('./private-capture-summary.cjs');
require('tsx/cjs');
const { createCaptureRedactor } = require('../src/main/services/capcut/captureRedaction.ts');
app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

app.whenReady().then(() => {
  const file = process.argv[2];
  if (!file || path.extname(file) !== '.enc') throw new Error('Expected encrypted capture path');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))));
  if (process.argv.includes('--auth-dependencies')) {
    const findings = [];
    const pending = new Map();
    const pair = row => rows.filter(item => item.sessionId === row.sessionId && item.requestId === row.requestId);
    for (const row of rows) {
      if (row.request?.method !== 'POST') continue;
      const route = new URL(row.request.url).pathname;
      if (!['/passport/web/email/send_code/', '/passport/web/email/register_verify_login/'].includes(route)) continue;
      const related = pair(row);
      const raw = row.request.postData ?? related.find(item => item.type === 'request-body')?.postData;
      const response = related.find(item => item.type === 'response-body');
      let result;
      try { result = JSON.parse(response?.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response?.body); } catch { continue; }
      if (typeof raw !== 'string' || result?.message !== 'success') continue;
      const body = Object.fromEntries(new URLSearchParams(raw));
      if (route.endsWith('/send_code/')) {
        pending.set(row.sessionId, { body, ticket: result.data?.email_ticket });
        continue;
      }
      const sent = pending.get(row.sessionId);
      let biz;
      try { biz = JSON.parse(body.biz_param); } catch { biz = undefined; }
      const ticket = typeof sent?.ticket === 'string' && sent.ticket.length ? sent.ticket : null;
      findings.push({
        pairedSuccessfulSend: Boolean(sent),
        ticketReturned: Boolean(ticket),
        ticketInRegisterForm: ticket === null ? null : Object.values(body).some(value => value.includes(ticket)),
        bizParamEqualsTicket: ticket === null ? null : body.biz_param === ticket,
        bizParamJsonType: biz === null ? 'null' : Array.isArray(biz) ? 'array' : typeof biz,
        emailContainsAt: typeof body.email === 'string' && body.email.includes('@'),
        emailMatchesSend: Boolean(sent) && body.email === sent.body.email,
        passwordMatchesSend: Boolean(sent) && body.password === sent.body.password,
        otpPresent: typeof body.code === 'string' && body.code.length > 0,
        status: related.find(item => item.response)?.response.status
      });
    }
    process.stdout.write(JSON.stringify({ registrations: findings.length, findings }) + '\n');
    return;
  }
  if (process.argv.includes('--auth-schema')) {
    const details = [];
    const pairs = new Map();
    for (const row of rows) {
      const key = `${row.sessionId}:${row.requestId}`;
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(row);
    }
    const shape = (value, depth = 0) => {
      if (depth > 8) return '<depth>';
      if (value === null) return 'null';
      if (Array.isArray(value)) return value.slice(0, 1).map(item => shape(item, depth + 1));
      if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item, depth + 1)]));
      return typeof value;
    };
    for (const row of rows) {
      if (!row.request?.url) continue;
      const url = new URL(row.request.url);
      if (!url.pathname.startsWith('/passport/') || row.request.method === 'OPTIONS') continue;
      const related = pairs.get(`${row.sessionId}:${row.requestId}`);
      const raw = row.request.postData ?? related.find(item => item.type === 'request-body')?.postData;
      let body;
      try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw ?? '')); }
      const response = related.find(item => item.type === 'response-body');
      let result;
      try { result = JSON.parse(response?.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response?.body); } catch { result = null; }
      details.push({ method: row.request.method, origin: url.origin, path: url.pathname,
        queryKeys: [...url.searchParams.keys()], headerKeys: Object.keys(row.request.headers ?? {}),
        encoding: Object.entries(row.request.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.split(';')[0],
        body: shape(body), status: related.find(item => item.response)?.response.status,
        message: ['success', 'error'].includes(result?.message) ? result.message : undefined,
        result: shape(result), errorCode: typeof result?.data?.error_code === 'number' ? result.data.error_code : undefined });
    }
    process.stdout.write(JSON.stringify({ records: rows.length, authRequests: details.length, details }) + '\n');
    return;
  }
  if(process.argv.includes('--creator-header-schema')){
    const seen=new Set();
    for(const row of rows.filter(r=>r.request?.method==='POST'&&/studio_draft\/create_project|ai_lab\/send_msg|ai_lab\/poll_by_event_id/.test(r.request.url))){
      const url=new URL(row.request.url);const h=Object.fromEntries(Object.entries(row.request.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
      if(seen.has(url.pathname))continue;seen.add(url.pathname);
      process.stdout.write(JSON.stringify({path:url.pathname,queryKeys:[...url.searchParams.keys()],headerKeys:Object.keys(h),appid:h.appid,appvr:h.appvr,pf:h.pf,signPresent:Boolean(h.sign)})+'\n');
    }return;
  }
  if(process.argv.includes('--thread-contract-audit')) {
    const redact=createCaptureRedactor();
    for(const row of rows) {
      if(row.stage?.endsWith('-thread')) process.stdout.write(JSON.stringify({stage:row.stage,state:row.state,ret:row.data?.ret,hasThread:Boolean(row.data?.data?.thread_info?.thread_id),body:redact.value(row.data)})+'\n');
      if(row.request?.method==='POST'&&new URL(row.request.url).pathname.includes('/thread/')) {
        const u=new URL(row.request.url);const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const res=rel.find(r=>r.type==='response-body');let j;try{j=JSON.parse(res?.body);}catch{}
        process.stdout.write(JSON.stringify({path:u.pathname,queryKeys:[...u.searchParams.keys()],ret:j?.ret,bodyKeys:Object.keys(JSON.parse(row.request.postData??'{}'))})+'\n');
      }
    }return;
  }
  if(process.argv.includes('--storage-owner-binding')){
    const owners=new Set();
    for(const r of rows.filter(r=>r.request?.url&&new URL(r.request.url).pathname.endsWith('/get_user_workspaces'))){
      const p=rows.find(x=>x.sessionId===r.sessionId&&x.requestId===r.requestId&&x.type==='response-body');try{JSON.parse(p.body).data.workspace_infos.forEach(w=>owners.add(String(w.owner)));}catch{}
    }
    for(const r of rows.filter(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.startsWith('/upload/'))){
      const owner=Object.entries(r.request.headers??{}).find(([k])=>k.toLowerCase()==='x-storage-u')?.[1];
      process.stdout.write(JSON.stringify({hasStorageOwner:Boolean(owner),matchesWorkspaceOwner:owners.has(owner),knownOwners:owners.size})+'\n');
    }return;
  }
  if(process.argv.includes('--fresh-upload-audit')){
    const commit=rows.find(r=>r.stage==='image-upload'&&r.state==='commit-response')?.data?.json;
    const plugin=commit?.Result?.PluginResult?.[0];
    const requests=rows.filter(r=>r.stage==='fresh-image-meta'&&r.state==='request');
    process.stdout.write(JSON.stringify({commit:{uriStatus:commit?.Result?.Results?.[0]?.UriStatus,uriPrefix:plugin?.ImageUri?.split('/')[0],width:plugin?.ImageWidth,height:plugin?.ImageHeight,format:plugin?.ImageFormat},
      requests:requests.slice(-1).map(r=>({path:new URL(r.data.url).pathname,resourceMatchesCommit:r.data.body.resource_id===plugin?.ImageUri,resourceType:r.data.body.resource_type,format:r.data.body.format}))})+'\n');return;
  }
  if(process.argv.includes('--metadata-header-shape')){
    const seen=new Set();
    for(const r of rows.filter(r=>r.request?.method==='POST'&&/image_meta|chat_upload_sign|get_user_workspaces/.test(new URL(r.request.url).pathname))){
      const p=new URL(r.request.url).pathname;const headers=Object.fromEntries(Object.entries(r.request.headers).map(([k,v])=>[k.toLowerCase(),v]));
      const summary={path:p,appid:headers.appid,appvr:headers.appvr,pf:headers.pf,loc:headers.loc,lan:headers.lan,signVer:headers['sign-ver'],keys:Object.keys(headers).sort()};
      const text=JSON.stringify(summary);if(seen.has(text))continue;seen.add(text);process.stdout.write(text+'\n');
    }return;
  }
  if(process.argv.includes('--workspace-response')){
    for(const row of rows.filter(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/get_user_workspaces'))){const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const s=rel.find(r=>r.type==='response-body');try{const j=JSON.parse(s.body);process.stdout.write(JSON.stringify({ret:j.ret,errNo:j.err_no,keys:Object.keys(j),workspaceCount:j.data?.workspace_infos?.length})+'\n')}catch{}}return;
  }
  if(process.argv.includes('--account-context')) {
    const task=rows.find(r=>r.request?.url&&r.request.method==='POST'&&new URL(r.request.url).pathname.endsWith('/task/v1/task_list'));
    const work=rows.find(r=>r.request?.url&&r.request.method==='POST'&&new URL(r.request.url).pathname.endsWith('/get_user_workspaces'));
    const user=rows.find(r=>r.request?.url&&r.request.method==='POST'&&new URL(r.request.url).pathname.endsWith('/user_info'));
    const ids=[];for(const r of rows){if(!r.request?.url)continue;const u=new URL(r.request.url);for(const k of ['aid','web_id','webid','region','device_platform'])if(u.searchParams.has(k))ids.push([k,u.searchParams.get(k)]);}
    let taskCount;try{const rel=rows.filter(r=>r.sessionId===task.sessionId&&r.requestId===task.requestId);const b=rel.find(r=>r.type==='response-body');taskCount=JSON.parse(b.body).data.task_list.length;}catch{}
    let workspaceCount;try{const rel=rows.filter(r=>r.sessionId===work.sessionId&&r.requestId===work.requestId);const b=rel.find(r=>r.type==='response-body');const j=JSON.parse(b.body);workspaceCount=j.data.workspace_infos.length;}catch{}
    process.stdout.write(JSON.stringify({taskCount,workspaceCount,ids:[...new Map(ids).entries()],hasCookies:rows.some(r=>Array.isArray(r.associatedCookies)&&r.associatedCookies.some(c=>c.cookie&&/capcut\.com$/.test(c.cookie.domain.replace(/^\./,'')))),hasUser:Boolean(user)})+'\n');return;
  }
  if(process.argv.includes('--inspiration-allowance')){
    const redact=createCaptureRedactor();
    const checkRow=rows.find(r=>r.stage==='inspiration:submit'&&r.request?.method==='POST'&&r.request.url.includes('batch_check_withhold_deduct'));
    const check=checkRow?JSON.parse(checkRow.request.postData):{};
    for(const row of rows.filter(r=>r.stage==='inspiration:submit'&&r.request?.method==='POST'&&/batch_check_withhold_deduct|batch_get_user_benefit|common_task\/new/.test(r.request.url))){
      const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const raw=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;
      const res=rel.find(r=>r.type==='response-body');let data;try{data=JSON.parse(res.body);}catch{continue;}
      const body=JSON.parse(raw);if(new URL(row.request.url).pathname.endsWith('/new')){process.stdout.write(JSON.stringify({path:'/lv/v1/common_task/new',ret:data.ret,taskStatuses:data.data?.tasks?.map(t=>({status:t.status,idPresent:Boolean(t.id)})),requestShape:{bindIdType:typeof body.bind_id,payloadType:typeof body.tasks?.[0]?.payload},body:redact.value(body)})+'\n');}
      else {
        const assets=(data.data?.asset_list??[]).filter(a=>check.item_list?.some(i=>i.resource_id===a.resource_id&&i.benefit_type===a.benefit_type));
        if(assets.length||row.request.url.includes('batch_check_withhold_deduct'))process.stdout.write(JSON.stringify({path:new URL(row.request.url).pathname,body:row.request.url.includes('batch_check_withhold_deduct')?body:undefined,response:row.request.url.includes('batch_check_withhold_deduct')?{ret:data.ret,data:data.data}:{ret:data.ret,assets:assets.map(a=>({resource_type:a.resource_type,resource_id:a.resource_id,benefit_type:a.benefit_type,quota_left:a.quota_left,asset_details:a.asset_details}))}})+'\n');
      }
    }return;
  }
  if(process.argv.includes('--inspiration-contracts')){
    const redact=createCaptureRedactor();
    for(const row of rows.filter(r=>r.stage==='inspiration:submit'&&r.request?.method==='POST')){
      const url=new URL(row.request.url);if(!/inspiration|common_task\/new|thread\/run|thread\/create|canvas\/save|do_action/.test(url.pathname))continue;
      const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
      const raw=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;let body;try{body=JSON.parse(raw);}catch{body={missing:!raw};}
      const resp=rel.find(r=>r.type==='response-body');let result;try{result=JSON.parse(resp.body);}catch{result={missing:true};}
      process.stdout.write(JSON.stringify({path:url.pathname,body:redact.value(body),response:redact.value(result),stream:rel.filter(r=>r.type==='stream').length})+'\n');
    }return;
  }
  if(process.argv.includes('--upload-address')){
    for(const row of rows.filter(r=>r.stage==='image-upload'&&r.state==='apply-response')){
      const a=row.data.json?.Result?.UploadAddress;
      process.stdout.write(JSON.stringify({hosts:a?.UploadHosts,storeUriPrefix:a?.StoreInfos?.[0]?.StoreUri?.split('/')[0],sessionKeyPresent:Boolean(a?.SessionKey)})+'\n');
    }return;
  }
  if(process.argv.includes('--object-upload')){
    for(const row of rows.filter(r=>r.request?.url&&new URL(r.request.url).pathname.startsWith('/upload/'))){
      const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const response=rel.find(r=>r.type==='response-body');
      let json;try{json=JSON.parse(response?.body);}catch{}
      process.stdout.write(JSON.stringify({origin:new URL(row.request.url).origin,pathShape:new URL(row.request.url).pathname.replace(/\/[^/]+$/,'/<object>'),method:row.request.method,
        headers:Object.entries(row.request.headers).map(([k,v])=>({key:k,value:/content-type|content-length|crc32|content-disposition|x-storage-u/i.test(k)?v:'<redacted>'})),
        postDataLength:row.request.postData?.length,entries:row.request.postDataEntries?.map(p=>({base64Length:p.bytes?.length,magic:p.bytes?Buffer.from(p.bytes,'base64').subarray(0,8).toString('hex'):undefined})),
        response:json?createCaptureRedactor().value(json):undefined,code:json?.code,responseCrc32:json?.data?.crc32})+'\n');
    }return;
  }
  if(process.argv.includes('--imagex-signature')) {
    const {inspectImagexSigning}=require('./imagex-contract.cjs');
    process.stdout.write(JSON.stringify(inspectImagexSigning(rows))+'\n');return;
  }
  if(process.argv.includes('--upload-protocol')) {
    for(const row of rows.filter(r=>r.request?.url&&r.request.method!=='OPTIONS'&&/chat_upload_sign|ttuploader_proxy|thread\/image_meta/.test(new URL(r.request.url).pathname))){
      const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const raw=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;
      const resp=rel.find(r=>r.type==='response-body');let json;try{json=JSON.parse(resp?.body);}catch{}
      const url=new URL(row.request.url);const h=row.request.headers;const auth=h.Authorization??h.authorization??'';
      const scope=auth.match(/Credential=[^/]+\/([^, ]+)/)?.[1];
      process.stdout.write(JSON.stringify({path:url.pathname,method:row.request.method,body:url.pathname.includes('ttuploader')?{keys:raw?Object.keys(JSON.parse(raw)):[]}:raw?JSON.parse(raw):null,
        action:url.searchParams.get('Action'),version:url.searchParams.get('Version'),scope:scope?.replace(/\d{8}/,'<date>'),signedHeaders:auth.match(/SignedHeaders=([^, ]+)/)?.[1],
        domain:json?.data?.domain,region:json?.data?.region,serviceId:json?.data?.service_id,
        uploadHosts:json?.Result?.UploadAddress?.UploadHosts,resultStatuses:json?.Result?.Results?.map(r=>r.UriStatus)})+'\n');
    }return;
  }
  if(process.argv.includes('--upload-contracts')) {
    const redact=createCaptureRedactor();
    for(const row of rows.filter(r=>r.request?.url&&r.request.method!=='OPTIONS'&&/upload|material|image_meta/.test(new URL(r.request.url).pathname))) {
      const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
      const raw=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;
      let body;try{body=redact.value(JSON.parse(raw));}catch{body={bytes:raw?.length,hasPostData:row.request.hasPostData,entries:row.request.postDataEntries?.length};}
      const response=rel.find(r=>r.type==='response-body');let data;try{data=redact.value(JSON.parse(response?.base64Encoded?Buffer.from(response.body,'base64').toString():response?.body));}catch{}
      process.stdout.write(JSON.stringify({url:redact.url(row.request.url),method:row.request.method,headerKeys:Object.keys(row.request.headers),body,response:data})+'\n');
    }return;
  }
  if(process.argv.includes('--image-meta')) {
    const redact=createCaptureRedactor();
    for(const row of rows.filter(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/thread/image_meta'))) {
      const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
      const body=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;
      const res=rel.find(r=>r.type==='response-body');
      process.stdout.write(JSON.stringify({body:redact.value(JSON.parse(body)),response:res?.body?redact.value(JSON.parse(res.body)):null})+'\n');
    }return;
  }
  if(process.argv.includes('--receipt-audit')) {
    const {inspectDesignReceipt}=require('../src/main/services/capcut/http/designReceipt.ts');
    const p=rows.find(r=>r.stage==='canvas-discovery'&&r.state==='prepared-request')??rows.find(r=>r.stage==='canvas-http'&&r.state==='dispatching'&&r.data?.body);
    const r=rows.find(r=>r.stage==='canvas-http'&&r.state==='response');
    if(!p||!r)throw new Error('RECEIPT_MISSING');
    const evidence=inspectDesignReceipt(r.data.raw,(typeof p.data.body==='string'?JSON.parse(p.data.body):p.data.body).thread_id);
    process.stdout.write(JSON.stringify({...evidence,runId:evidence.runId?'present':undefined})+'\n');return;
  }
  if(process.argv.includes('--canvas-input')) {
    const redact=createCaptureRedactor();
    const prepared=rows.find(r=>r.stage==='canvas-discovery'&&r.state==='prepared-request');
    if(!prepared)throw new Error('PREPARED_MISSING');
    const body=JSON.parse(prepared.data.body);
    const images=body.contents.filter(c=>c.type==='image').map(c=>({imageIdPresent:Boolean(c.image_id),imageIdLength:c.image_id?.length,
      imageIdFormat:/^\d+$/.test(c.image_id)?'numeric':/^data:/.test(c.image_id)?'data':/^https?:/.test(c.image_id)?'url':/^tos-/.test(c.image_id)?'tos':'other',
      imageType:c.image_type,usage:c.usage,nameLength:c.name?.length,text:c.text}));
    process.stdout.write(JSON.stringify({source:body.source,mode:body.mode,images,models:redact.value(body.selected_models),prompt:body.contents.filter(c=>c.type==='text').map(c=>c.text)})+'\n');return;
  }
  if (process.argv.includes('--canvas-result')) {
    const redact=createCaptureRedactor();
    for(const row of rows) {
      if(row.stage==='canvas-http'&&row.state==='response') {
        let json;try{json=JSON.parse(row.data.raw);}catch{continue;}
        process.stdout.write(JSON.stringify({status:row.data.status,ret:json.ret,errmsg: /^[a-zA-Z _.,-]{1,150}$/.test(json.errmsg??'')?json.errmsg:undefined,data:redact.value(json)})+'\n');
      }
      if(row.stage==='canvas-discovery'&&row.state==='prepared-request')process.stdout.write(JSON.stringify({body:redact.value(JSON.parse(row.data.body)),headerKeys:Object.keys(row.data.headers)})+'\n');
    }return;
  }
  if (process.argv.includes('--canvas-contracts')) {
    const redact = createCaptureRedactor();
    for (const row of rows.filter(r => r.request?.method === 'POST' && /canvas\/save|thread\/create|thread\/run\/start/.test(r.request.url))) {
      const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
      const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
      let body; try {body=JSON.parse(raw);} catch {continue;}
      const detail = typeof body.canvas_detail === 'string' ? JSON.parse(body.canvas_detail) : body.canvas_detail;
      process.stdout.write(JSON.stringify({stage:row.stage,path:new URL(row.request.url).pathname,source:body.source,mode:body.mode,referrerPath:new URL(row.request.headers?.Referer ?? row.request.url).pathname,
        children:detail?.children?.length,body: redact.value(body)})+'\n');
    }
    return;
  }
  if (process.argv.includes('--design-events')) {
    const redact = createCaptureRedactor();
    for (const row of rows.filter(r => (r.stage === 'design-chat' && r.state === 'browser-response') || (r.stage === 'canvas-http' && r.state === 'response'))) {
      for (const line of row.data.raw.split(/\r?\n/).filter(line => line.startsWith('data:'))) {
        let event; try {event=JSON.parse(line.slice(5).trim());} catch {continue;}
        let delta=event.content_block?.delta; try { if(typeof delta==='string')delta=JSON.parse(delta); } catch {}
        const statuses=delta?.artifacts?.map(a=>({ret:a.status?.ret,hasResource:Boolean(a.resource_id),message: /^[a-zA-Z _.,:0-9-]{1,180}$/.test(a.status?.errmsg??'')?a.status.errmsg:'<redacted>'}));
        process.stdout.write(JSON.stringify({ event: redact.value(event), type: event.type, eventType:event.event_type,artifactStatuses:statuses })+'\n');
      }
    }
    return;
  }
  if (process.argv.includes('--proof-shape')) {
    const suffixes = new Set();
    for (const row of rows.filter(r => r.request?.method === 'POST' && new URL(r.request.url).pathname.endsWith('/task/v1/do_action'))) {
      const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
      const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
      const body = JSON.parse(raw); const suffix = String(body.op_id).slice(String(body.action_key).length); suffixes.add(suffix);
      process.stdout.write(JSON.stringify({ action: body.action_key, origin: new URL(row.request.url).origin, queryKeys: [...new URL(row.request.url).searchParams.keys()],
        prefixMatches: String(body.op_id).startsWith(body.action_key + '_'), suffixShape: suffix.replace(/\d/g, 'D'), cookiePresent: related.some(r => Object.keys(r.headers ?? {}).some(k => k.toLowerCase() === 'cookie')) }) + '\n');
    }
    process.stdout.write(JSON.stringify({ distinctSuffixes: suffixes.size })+'\n'); return;
  }
  if (process.argv.includes('--proof-contracts')) {
    const redact = createCaptureRedactor();
    for (const row of rows.filter(r => r.request?.method === 'POST' && new URL(r.request.url).pathname.endsWith('/task/v1/do_action'))) {
      const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
      const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
      let requestBody; try { requestBody = JSON.parse(raw); } catch { continue; }
      const res = related.find(r => r.type === 'response-body');
      let responseBody; try { responseBody = JSON.parse(res?.body); } catch { responseBody = { missing: true }; }
      process.stdout.write(JSON.stringify({ stage: row.stage, at: row.at, path: new URL(row.request.url).pathname, request: redact.value(requestBody), response: redact.value(responseBody) }) + '\n');
    }
    return;
  }
  if (process.argv.includes('--creator-contracts')) {
    const redact = createCaptureRedactor();
    for (const row of rows.filter(r => r.request?.method === 'POST' && /ai_lab\/(send_msg|poll_by_event_id|get_conversations|batch_query_assets)|studio_draft\/(create_project|fetch_latest_version)/.test(r.request.url))) {
      const related = rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
      const raw = row.request.postData ?? related.find(r => r.type === 'request-body')?.postData;
      let requestBody; try { requestBody = JSON.parse(raw); } catch { requestBody = { missingBody: true }; }
      const res = related.find(r => r.type === 'response-body');
      let responseBody; try { responseBody = JSON.parse(res?.base64Encoded ? Buffer.from(res.body, 'base64').toString() : res?.body); } catch { responseBody = { missingBody: true }; }
      process.stdout.write(JSON.stringify({ stage: row.stage, path: new URL(row.request.url).pathname, request: redact.value(requestBody), response: redact.value(responseBody) }) + '\n');
    }
    return;
  }
  if (process.argv.includes('--intent-errors')) {
    for (const row of rows) {
      const data = row.data?.data ?? row.data?.json;
      if (data?.errmsg) process.stdout.write(JSON.stringify({ stage: row.stage, ret: data.ret,
        message: /^[a-zA-Z .,;:_-]{1,160}$/.test(data.errmsg) ? data.errmsg : '<non-ascii-or-sensitive>',
        at: row.at }) + '\n');
    }
    return;
  }
  if (process.argv.includes('--intent-error-detail')) {
    for (const line of fs.readFileSync(file,'utf8').trim().split('\n')) { try { const r=JSON.parse(safeStorage.decryptString(Buffer.from(line,'base64'))); if (r.state?.includes('response') && r.data?.errmsg) process.stdout.write(JSON.stringify({stage:r.stage,state:r.state,ret:r.data.ret,errmsg:r.data.errmsg})+'\n'); } catch {} }
    return;
  }
  if (process.argv.includes('--intent-dump')) {
    const redact = createCaptureRedactor();
    for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) {
      try { const row = JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))); process.stdout.write(JSON.stringify({ stage: row.stage, state: row.state, data: redact.value(row.data) }) + '\n'); } catch {}
    }
    return;
  }
  fs.writeFileSync(file + '.summary.json', JSON.stringify(summarizePrivateCapture(rows), null, 2));
  process.stdout.write('PRIVATE_CAPTURE_SUMMARY_WRITTEN\n');
}).catch(() => { console.error('PRIVATE_CAPTURE_INSPECTION_FAILED'); process.exitCode = 1; }).finally(() => setTimeout(() => app.quit(), 500));
