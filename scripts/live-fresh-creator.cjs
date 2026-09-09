const {randomUUID,createHash}=require('node:crypto');
const {ProxyAgent,fetch}=require('undici');
const {accountApiQuery}=require('./account-api-query.cjs');
const {observedTaskRequest}=require('../src/main/services/capcut/http/observedTaskRequest.ts');
const {acknowledgeCompletedOperation}=require('./live-account-task-proof.cjs');

function templateBody(rows,pathname,stage){
 const row=rows.find(r=>r.stage===stage&&r.request?.method==='POST'&&new URL(r.request.url).pathname===pathname);
 if(!row)throw new Error('CREATOR_TEMPLATE_MISSING');
 const related=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
 return JSON.parse(row.request.postData??related.find(r=>r.type==='request-body')?.postData);
}
async function runFreshCreator({rows,templates,journal,context,page,proxy,persist,report,maxCredits,projectContract}){
 const API='https://edit-api-sg.capcut.com';const query=accountApiQuery(rows).toString();
 const source=observedTaskRequest(rows).request.headers;const headers={};
 for(const name of ['appid','appvr','did','lan','pf','store-country-code','store-country-code-src','user-agent','cookie'])if(source[name])headers[name]=source[name];
 headers['content-type']='application/json';
 const post=async(path,body,stage)=>{
  const response=await context.post(API+path+'?'+query,{headers,data:JSON.stringify(body),timeout:25000,maxRetries:0,maxRedirects:0});
  try{const json=await response.json();persist(stage,'response',{status:response.status(),json});report({stage,mechanism:'direct-http',status:response.status(),ret:json.ret});if(!response.ok()||String(json.ret)!=='0')throw new Error('CREATOR_SERVER_REJECTED');return json;}finally{await response.dispose();}
 };
 const signedByBrowser=async(path,triggerBody,stage)=>{
  let captured;const handler=async route=>{const req=route.request();const u=new URL(req.url());if(req.method()==='POST'&&u.origin===API&&u.pathname===path){captured={url:req.url(),body:req.postData()??'',headers:await req.allHeaders()};await route.abort('aborted');}else await route.continue();};
  await page.route('**/*',handler);try{
   const wait=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).origin===API&&new URL(r.url()).pathname===path,{timeout:30000}).catch(()=>null);
   if(path==='/storyboard/v1/studio_draft/create_project')await page.goto('https://www.capcut.com/ai-creator/studio?enter_from=credit_task',{waitUntil:'domcontentloaded',timeout:45000});
   const request=await wait;if(!captured&&request)captured={url:request.url(),body:request.postData()??'',headers:await request.allHeaders()};
   if(!captured?.body)throw new Error('SIGNED_PREPARATION_NOT_OBSERVED');
   persist(stage,'signed-prepared',{url:captured.url,body:captured.body});
   const response=await context.post(captured.url,{headers:captured.headers,data:captured.body,timeout:30000,maxRedirects:0,maxRetries:0});let json;try{json=await response.json();}finally{await response.dispose();}
   persist(stage,'response',{status:response.status(),json});report({stage,mechanism:'direct-http',status:response.status(),ret:json.ret,signedByBrowser:true,domClicks:0});
   if(!response.ok()||String(json.ret)!=='0')throw new Error('CREATOR_SIGNED_REQUEST_REJECTED');return json;
  }finally{await page.unroute('**/*',handler);}
 };
 const once=async(stage,path,body)=>{
  const old=journal.find(r=>r.stage===stage&&r.state==='response'&&String(r.data?.json?.ret)==='0');if(old)return old.data.json;
  if(journal.some(r=>r.stage===stage&&r.state==='dispatching'))throw new Error('CREATOR_OPERATION_ALREADY_DISPATCHED');
  persist(stage,'dispatching',{path,body});return post(path,body,stage);
 };
 let init=journal.find(r=>r.stage==='fresh-creator'&&r.state==='initialized')?.data;
 if(!init){init={conversationId:randomUUID(),messageId:randomUUID(),confirmId:randomUUID(),localDraftId:randomUUID()};persist('fresh-creator','initialized',init);}
 const projectTemplate=templateBody(templates,'/storyboard/v1/studio_draft/create_project','creator:generate');
 const draft=typeof projectTemplate.draft_content==='string'?JSON.parse(projectTemplate.draft_content):projectTemplate.draft_content;
 if(draft.children?.length||draft.materials?.length||!draft.meta)throw new Error('CREATOR_EMPTY_DRAFT_REQUIRED');draft.meta.draftId=init.localDraftId;
 let project=journal.find(r=>r.stage==='fresh-creator-project'&&r.state==='response'&&String(r.data?.json?.ret)==='0')?.data?.json;
 if(!project){
  if(!projectContract?.body)throw new Error('CREATOR_FRESH_PROJECT_CONTRACT_REQUIRED');
  if(journal.some(r=>r.stage==='fresh-creator-project'&&r.state==='dispatching'))throw new Error('CREATOR_PROJECT_ALREADY_DISPATCHED');
  const u=new URL(projectContract.url);if(u.origin!==API||u.pathname!=='/storyboard/v1/studio_draft/create_project')throw new Error('CREATOR_PROJECT_ORIGIN_REJECTED');
  persist('fresh-creator-project','dispatching',{url:projectContract.url,body:projectContract.body});
  const r=await context.post(projectContract.url,{headers:projectContract.headers,data:projectContract.body,timeout:25000,maxRetries:0,maxRedirects:0});
  try{project=await r.json();persist('fresh-creator-project','response',{status:r.status(),json:project});report({stage:'fresh-creator-project',mechanism:'direct-http',status:r.status(),ret:project.ret,exactPreparedRequest:true});if(!r.ok()||String(project.ret)!=='0')throw new Error('CREATOR_PROJECT_REJECTED');}finally{await r.dispose();}
 }
 const draftId=project.data?.draft_id;if(typeof draftId!=='string'||!draftId)throw new Error('CREATOR_DRAFT_ID_MISSING');
 const original=templateBody(templates,'/storyboard_agent/v1/ai_lab/send_msg','creator:generate');
 const content=typeof original.content.data==='string'?JSON.parse(original.content.data):original.content.data;
 content.input_text='Create a realistic image of a small black dog in a sunny garden.';
 const message={...original,id:init.messageId,round_id:init.messageId,create_time:Date.now(),conversation_info:{conversation_id:init.conversationId,title:JSON.stringify(content)},
  content:{...original.content,data:JSON.stringify(content),assets:[]},option:{...original.option,__project_id:draftId}};
 await once('fresh-creator-message','/storyboard_agent/v1/ai_lab/send_msg',message);
 const dispatcher=new ProxyAgent({uri:proxy.server,...(proxy.username?{token:'Basic '+Buffer.from(proxy.username+':'+(proxy.password??'')).toString('base64')}:{})});
 const pollTemplate=templateBody(templates,'/storyboard_agent/v1/ai_lab/poll_by_event_id','creator:open');
 const poll=async(stage,match,budget)=>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),budget);const events=[];
  try{
   const r=await fetch(API+'/storyboard_agent/v1/ai_lab/poll_by_event_id?'+query,{dispatcher,method:'POST',headers,body:JSON.stringify({...pollTemplate,session_id:init.conversationId,event_id:''}),signal:controller.signal,redirect:'error'});
   if(!r.ok||!r.headers.get('content-type')?.includes('event-stream')){await r.body?.cancel();throw new Error('CREATOR_STREAM_REJECTED');}
   const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0;
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8*1024*1024)throw new Error('CREATOR_STREAM_LIMIT');buffer+=decoder.decode(part.value,{stream:true});let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trimEnd();buffer=buffer.slice(end+1);if(!line.startsWith('data:'))continue;let e;try{e=JSON.parse(line.slice(5));}catch{continue;}
     if(e.conversation_info?.conversation_id&&e.conversation_info.conversation_id!==init.conversationId)throw new Error('CREATOR_EVENT_ACCOUNT_MISMATCH');
     persist(stage,'event',e);events.push(e);const found=match(e);if(found){report({stage,mechanism:'direct-http',events:events.length,matched:true});return found;}
    }
   }}finally{await reader.cancel().catch(()=>{});}
   throw new Error('CREATOR_EVENT_MISSING');
  }finally{clearTimeout(timer);}
 };
 try{
  const card=await poll('fresh-creator-estimate',e=>{
   if(e.round_id!==init.messageId||e.content?.content_type!=='strong_commercial_card')return;
   let card;try{card=JSON.parse(e.content.data);}catch{return;}
   if(card.card_type==='confirm')return card;
  },60000);
  const amount=Number(card.need_used_credits);report({stage:'fresh-creator-cost',credits:amount,budget:maxCredits,remaining:card.remain_credits});
  if(!Number.isFinite(amount)||amount<0||amount>maxCredits||Number(card.remain_credits)<amount)throw new Error('CREATOR_COST_NOT_AUTHORIZED');
  const confirmTemplate=templateBody(templates,'/storyboard_agent/v1/ai_lab/send_msg','creator:confirm');
  const confirm={...confirmTemplate,id:init.confirmId,round_id:init.confirmId,create_time:Date.now(),conversation_info:message.conversation_info,option:{...confirmTemplate.option,__project_id:draftId},content:{...confirmTemplate.content,data:JSON.stringify({credits_confirm:true}),assets:[]}};
  await once('fresh-creator-confirm','/storyboard_agent/v1/ai_lab/send_msg',confirm);
  const artifact=await poll('fresh-creator-generation',e=>{
   if(e.author?.role!=='tool'||e.content?.tool_call_name!=='generate_image'||e.content?.content_type!=='media_list')return;
   let data;try{data=JSON.parse(e.content.data);}catch{return;}
   return data.items?.find(i=>i.type==='image'&&i.status==='succeed'&&i.resource_id&&i.resource_type==='tos_key');
  },240000);
  persist('fresh-creator-generation','succeeded',{artifact,conversationId:init.conversationId,draftId});
  const exportTemplate=templateBody(templates,'/storyboard_agent/v1/ai_lab/batch_query_assets','creator:export');
  const queried=await post('/storyboard_agent/v1/ai_lab/batch_query_assets',{items:[{...exportTemplate.items[0],resource:artifact.resource_id,resource_type:artifact.resource_type}]},'fresh-creator-export-query');
  const item=queried.data?.items?.find(i=>i.resource===artifact.resource_id);if(!item?.url)throw new Error('CREATOR_EXPORT_RESOURCE_MISMATCH');
  const url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)ibyteimg\.com$/.test(url.hostname))throw new Error('CREATOR_EXPORT_HOST_INVALID');
  const download=await context.get(url.toString(),{timeout:30000,maxRetries:0,maxRedirects:0});
  try{const bytes=await download.body();if(!download.ok()||bytes.length<100||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('CREATOR_EXPORT_IMAGE_INVALID');persist('fresh-creator-export','downloaded',{resource:artifact.resource_id,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});report({stage:'fresh-creator-export',mechanism:'direct-http',bytes:bytes.length,pngVerified:true});}finally{await download.dispose();}
  for(const action of ['capcut_web_video_studio_send_msg','capcut_web_video_studio_generate_done','capcut_web_video_studio_export']){
   await acknowledgeCompletedOperation({rows,context,page,action,receipt:{verified:true,operationId:init.conversationId,kind:action,artifact:artifact.resource_id},persist,report,journal});
  }
 }finally{await dispatcher.destroy();}
}
module.exports={runFreshCreator};
