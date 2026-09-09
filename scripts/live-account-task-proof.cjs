const {observedTaskRequest}=require('../src/main/services/capcut/http/observedTaskRequest.ts');
const API='https://edit-api-sg.capcut.com';
async function readTasks(rows,context){
  const contract=observedTaskRequest(rows);
  const response=await context.post(contract.origin+contract.request.path,{headers:contract.request.headers,data:contract.request.body,timeout:15000,maxRetries:0,maxRedirects:0});
  try{
    const json=await response.json();
    if(!response.ok()||json?.err_no!==0||!Array.isArray(json?.data?.task_list))throw new Error('TASK_SNAPSHOT_INVALID');
    return json.data.task_list;
  }finally{await response.dispose();}
}
async function acknowledgeCompletedOperation({rows,context,page,action,receipt,persist,report,journal}){
  if(!receipt?.verified||!receipt.operationId)throw new Error('TASK_OPERATION_RECEIPT_MISSING');
  const creator=['capcut_web_video_studio_send_msg','capcut_web_video_studio_generate_done','capcut_web_video_studio_export'];
  if(!['capcut_web_design_studio_ai_chat','capcut_web_design_studio_canvas_edit',...creator].includes(action))throw new Error('TASK_ACK_OPERATION_UNSUPPORTED');
  if(creator.includes(action)&&(!receipt.artifact||receipt.kind!==action))throw new Error('CREATOR_PROOF_RECEIPT_MISSING');
  const before=await readTasks(rows,context);const task=before.find(t=>t.task_key===action);
  if(!task)throw new Error('TASK_NOT_AVAILABLE');
  if(task.task_status===4){report({stage:'http-task-proof',action,alreadyComplete:true});return;}
  const stage='proof:'+action;
  if(journal.some(r=>r.stage===stage&&r.state==='dispatching'))throw new Error('TASK_ACK_ALREADY_DISPATCHED');
  let template;const suffixes=new Set();
  for(const row of rows){
    if(row.request?.method!=='POST')continue;const url=new URL(row.request.url);
    if(url.origin!==API||url.pathname!=='/luckycat/i18n/capcut/task/v1/do_action')continue;
    const related=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
    let body;try{body=JSON.parse(row.request.postData??related.find(r=>r.type==='request-body')?.postData);}catch{continue;}
    if(typeof body.action_key!=='string'||!/^capcut_web_/.test(body.action_key)||typeof body.op_id!=='string'||!body.op_id.startsWith(body.action_key+'_'))continue;
    const suffix=body.op_id.slice(body.action_key.length);if(!/^_\d+_\d{4}-\d{2}-\d{2}$/.test(suffix))throw new Error('TASK_ACK_ID_CONTRACT_CHANGED');
    suffixes.add(suffix);template=row;
  }
  if(suffixes.size!==1)throw new Error('TASK_ACK_ACCOUNT_ID_AMBIGUOUS');
  const suffix=[...suffixes][0];if(!suffix.endsWith(new Date().toISOString().slice(0,10)))throw new Error('TASK_ACK_PERIOD_STALE');
  const target=new URL('/luckycat/i18n/capcut/task/v1/do_action',API);const old=new URL(template.request.url);
  for(const k of ['aid','device_platform']){const v=old.searchParams.get(k);if(v!==null)target.searchParams.set(k,v);}
  const headerSource=observedTaskRequest(rows).request.headers;const headers={};
  for(const[k,v]of Object.entries(headerSource))if(!['cookie','host','sign','content-length','user-agent','referer','origin'].includes(k))headers[k]=v;
  const body={action_key:action,op_id:action+suffix};persist(stage,'dispatching',{body,receipt});
  const ack=await page.evaluate(async({url,headers,body})=>{
    const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});
    const json=await res.json();return{status:res.status,ok:res.ok,errNo:json.err_no};
  },{url:target.toString(),headers,body});
  persist(stage,'response',ack);report({stage:'http-task-ack',mechanism:'browser-http',action,status:ack.status,errNo:ack.errNo,domClicks:0});
  if(!ack.ok||ack.errNo!==0)throw new Error('TASK_ACK_REJECTED');
  const after=await readTasks(rows,context);persist(stage,'snapshot',after);
  const confirmed=after.find(t=>t.task_key===action)?.task_status===4;
  report({stage:'http-task-proof',mechanism:'direct-http',action,confirmed,done:after.filter(t=>t.task_status===4).length,total:after.length,fullHttpRun:false});
  if(!confirmed)throw new Error('TASK_ACK_SNAPSHOT_PENDING');
}
module.exports={readTasks,acknowledgeCompletedOperation};
