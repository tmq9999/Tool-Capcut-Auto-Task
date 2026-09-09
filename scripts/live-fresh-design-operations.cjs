const {createHash}=require('node:crypto');
const {sendDesignInBrowser}=require('../src/main/services/capcut/http/browserHttpSession.ts');
const {inspectDesignReceipt}=require('../src/main/services/capcut/http/designReceipt.ts');
const {acknowledgeCompletedOperation,readTasks}=require('./live-account-task-proof.cjs');
const {accountApiQuery}=require('./account-api-query.cjs');

function accountHeaders(network, liveHeaders){
  const row=[...network].reverse().find(r=>r.request?.method==='POST'&&new URL(r.request.url).origin==='https://edit-api-sg.capcut.com'&&new URL(r.request.url).pathname.endsWith('/thread/image_meta'));
  if(!row && liveHeaders) return liveHeaders;
  if(!row)throw new Error('DESIGN_ACCOUNT_HEADERS_MISSING');
  const rel=network.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
  const allowed=new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);const headers={};
  for(const source of[row.request.headers,...rel.filter(r=>r.type==='request-extra').map(r=>r.headers)])for(const[k,v]of Object.entries(source??{}))if(allowed.has(k.toLowerCase()))headers[k.toLowerCase()]=v;
  if(!headers.cookie)throw new Error('DESIGN_ACCOUNT_COOKIE_MISSING');return headers;
}
function operationTemplate(templates,kind){
  if(kind==='canvas'){
    const row=templates.find(r=>r.stage==='canvas-discovery'&&r.state==='prepared-request');if(!row?.data?.body)throw new Error('DESIGN_CANVAS_SHAPE_MISSING');
    const body=JSON.parse(row.data.body);if(body.source!==2||body.mode!==2||!body.contents?.some(c=>c.type==='image'))throw new Error('DESIGN_CANVAS_SHAPE_CHANGED');return body;
  }
  const row=templates.find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname==='/lv/v2/intelligence/thread/run/start'&&['design:chat','design:chat-accepted'].includes(r.stage));
  if(!row)throw new Error('DESIGN_CHAT_SHAPE_MISSING');const rel=templates.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
  const body=JSON.parse(row.request.postData??rel.find(r=>r.type==='request-body')?.postData);if(body.source!==1||body.mode!==1)throw new Error('DESIGN_CHAT_SHAPE_CHANGED');return body;
}
async function runFreshDesignOperation({kind,rows,network,templates,journal,context,page,persist,report,minimalHeaders=false,liveHeaders}){
  const ready=journal.find(r=>r.stage==='fresh-design'&&r.state==='ready')?.data;const workspace=journal.find(r=>r.stage==='fresh-session'&&r.state==='workspace')?.data;
  if(!ready?.canvas||!ready.asset||ready.canvas.workspaceId!==String(workspace?.workspaceId)||ready.canvas.imageId!==ready.asset.image.resource_id)throw new Error('DESIGN_FRESH_DEPENDENCY_MISSING');
  const action=kind==='canvas'?'capcut_web_design_studio_canvas_edit':'capcut_web_design_studio_ai_chat';
  const tasks=await readTasks(rows,context);if(tasks.find(t=>t.task_key===action)?.task_status===4){report({stage:'design-skip-completed',action});return;}
  const stage='fresh-design-'+kind;const headers=accountHeaders(network,liveHeaders);let body;let result;
  const prior=journal.find(r=>r.stage===stage&&r.state==='response');
  if(prior){result=prior.data;body=journal.find(r=>r.stage===stage&&r.state==='dispatching')?.data?.body;if(!body)throw new Error('DESIGN_PRIOR_BODY_MISSING');}
  else{
    if(journal.some(r=>r.stage===stage&&r.state==='dispatching'))throw new Error('DESIGN_DISPATCH_OUTCOME_UNKNOWN');
    const template=operationTemplate(templates,kind);
    let thread=journal.find(r=>r.stage===stage+'-thread'&&['response','corrected-response','minimal-response','native-contract-response'].includes(r.state)&&String(r.data?.ret)==='0')?.data?.data?.thread_info?.thread_id;
    if(!thread){
      const rejected=journal.find(r=>r.stage===stage+'-thread'&&r.state==='response'&&String(r.data?.ret)==='1014');
      if(journal.some(r=>r.stage===stage+'-thread'&&r.state==='dispatching')&&!rejected)throw new Error('DESIGN_THREAD_OUTCOME_UNKNOWN');
      const lastThreadResponse=[...journal].reverse().find(r=>r.stage===stage+'-thread'&&r.state==='response');
      if(journal.some(r=>r.stage===stage+'-thread'&&r.state==='browser-dispatching')&&String(lastThreadResponse?.data?.ret)!=='1014')throw new Error('DESIGN_BROWSER_THREAD_OUTCOME_UNKNOWN');
      const correctedRejected=journal.some(r=>r.stage===stage+'-thread'&&r.state==='corrected-response'&&String(r.data?.ret)==='1014');
      if(journal.some(r=>r.stage===stage+'-thread'&&r.state==='corrected-dispatching')&&!minimalHeaders&&!correctedRejected)throw new Error('DESIGN_CORRECTED_THREAD_ALREADY_DISPATCHED');
      if(minimalHeaders&&journal.some(r=>r.stage===stage+'-thread'&&r.state==='minimal-dispatching'))throw new Error('DESIGN_MINIMAL_THREAD_ALREADY_DISPATCHED');
      const createBody={resource_id:ready.canvas.canvasId,workspace_id:ready.canvas.workspaceId,source:template.source,is_local_resource:false};
      const createUrl='https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/create?'+accountApiQuery(rows).toString();
      persist(stage+'-thread',minimalHeaders?'minimal-dispatching':'corrected-dispatching',{url:createUrl,body:createBody});
      const webHeaders={};for(const[k,v]of Object.entries(headers))if(!['cookie','sign','host','content-length','referer','origin','user-agent'].includes(k))webHeaders[k]=v;
      const result=await page.evaluate(async({url,headers,body})=>{const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000)});return{status:r.status,ok:r.ok,json:await r.json()};},{url:createUrl,headers:minimalHeaders?{'content-type':'application/json'}:webHeaders,body:createBody});
      const json=result.json;persist(stage+'-thread',minimalHeaders?'minimal-response':'corrected-response',json);report({stage:stage+'-thread',mechanism:'browser-http',status:result.status,ret:json.ret,routingQueryPresent:true,minimalHeaders});if(!result.ok||String(json.ret)!=='0'||!json.data?.thread_info?.thread_id)throw new Error('DESIGN_THREAD_REJECTED');thread=json.data.thread_info.thread_id;
    }
    // Construct only observed fields. Old workspace/thread/image values never enter the request.
    const contents=[{type:'text',text:kind==='canvas'?'Change the white circle to bright red. Keep the original background unchanged.':'Hello. Suggest a simple product image layout.'}];
    if(kind==='canvas'){const image=template.contents.find(c=>c.type==='image');contents.push({...image,image_id:ready.canvas.imageId,image_type:ready.canvas.imageType,name:'Image 1',text:'sample_product.png'});}
    body={source:template.source,mode:template.mode,contents,thread_id:thread,workspace_id:ready.canvas.workspaceId,resource_id:ready.canvas.canvasId,selected_models:template.selected_models,libra_params:template.libra_params};
    persist(stage,'dispatching',{body});
    result=await sendDesignInBrowser(page,{url:'https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/run/start',headers:minimalHeaders?{'content-type':'application/json'}:headers,body:JSON.stringify(body)});
    persist(stage,'response',result);
  }
  const evidence=inspectDesignReceipt(result.raw,body.thread_id);
  report({stage:stage+'-receipt',mechanism:'browser-http',status:result.status,mime:result.mime,accepted:evidence.accepted,ended:evidence.ended,artifacts:evidence.artifacts,errors:evidence.artifactErrors,domClicks:0});
  if(!evidence.accepted||!evidence.ended||result.timedOut||(kind==='canvas'&&!evidence.artifacts))throw new Error('DESIGN_OPERATION_UNVERIFIED');
  if(kind==='canvas'){
    let artifact;for(const line of result.raw.split(/\r?\n/)){if(!line.startsWith('data:'))continue;let event;try{event=JSON.parse(line.slice(5));}catch{continue;}let d=event.content_block?.delta;try{if(typeof d==='string')d=JSON.parse(d);}catch{continue;}artifact=d?.artifacts?.find(a=>a.resource_id&&a.main_url&&(!a.status?.ret||a.status.ret==='0')&&!a.status?.errmsg)??artifact;}
    if(!artifact)throw new Error('DESIGN_ARTIFACT_MISSING');const u=new URL(artifact.main_url);
    if(u.protocol!=='https:'||u.username||u.password||!/(^|\.)(ibyteimg\.com|capcut\.com|capcutstatic\.com)$/.test(u.hostname))throw new Error('DESIGN_ARTIFACT_HOST_REJECTED');
    const r=await context.get(u.toString(),{timeout:20000,maxRedirects:0,maxRetries:0});try{const bytes=await r.body();const image=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')||(bytes[0]===255&&bytes[1]===216&&bytes[2]===255);if(!r.ok()||bytes.length<100||!image)throw new Error('DESIGN_ARTIFACT_INVALID');persist(stage,'artifact',{resourceId:artifact.resource_id,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});report({stage:'fresh-canvas-artifact',mechanism:'direct-http',bytes:bytes.length,imageVerified:true});}finally{await r.dispose();}
  }
  persist(stage,'verified',evidence);
  await acknowledgeCompletedOperation({rows,context,page,action,receipt:{verified:true,operationId:evidence.runId},persist,report,journal});
}
module.exports={runFreshDesignOperation};
