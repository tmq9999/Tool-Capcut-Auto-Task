import {createHash} from 'node:crypto';
import type {APIRequestContext,Page} from 'playwright-core';
import {inspectDesignReceipt} from './designReceipt';
import {observedTaskRequest} from './observedTaskRequest';

interface Row{sessionId?:number;requestId?:string;type?:string;postData?:string;headers?:Record<string,string>;request?:{url:string;method:string;postData?:string;headers?:Record<string,string>}}
interface Journal{accountId:string;stage:string;state:string;data:Record<string,unknown>}
const ACTION='capcut_web_design_studio_canvas_edit';

/** Finishes an already executed edit. No generation/upload is repeated. */
export async function finishCanvasReceipt(input:{accountId:string;rows:Row[];journal:Journal[];context:APIRequestContext;page:Page;persist:(stage:string,state:string,data:unknown)=>void;report:(row:Record<string,unknown>)=>void}){
  const {journal,rows,context,page,persist,report}=input;
  if(!journal.length||journal.some(r=>r.accountId!==input.accountId))throw new Error('CANVAS_RECEIPT_ACCOUNT_MISMATCH');
  const dispatch=journal.find(r=>r.stage==='canvas-http'&&r.state==='dispatching'&&r.data.body);
  const response=journal.find(r=>r.stage==='canvas-http'&&r.state==='response');
  if(!dispatch||typeof response?.data.raw!=='string')throw new Error('CANVAS_RECEIPT_MISSING');
  const body=(typeof dispatch.data.body==='string'?JSON.parse(dispatch.data.body):dispatch.data.body) as {thread_id?:string;contents?:Array<{type:string;image_id?:string}>};
  if(!body.thread_id||!body.contents?.some(c=>c.type==='image'))throw new Error('CANVAS_RECEIPT_INPUT_MISSING');
  const receipt=inspectDesignReceipt(response.data.raw,body.thread_id);
  if(!receipt.accepted||!receipt.ended||!receipt.artifacts)throw new Error('CANVAS_RECEIPT_INVALID');
  let artifact:{resource_id:string;main_url:string;width:number;height:number}|undefined;
  for(const line of response.data.raw.split(/\r?\n/)){
    if(!line.startsWith('data:'))continue;
    let e;try{e=JSON.parse(line.slice(5));}catch{continue;}
    let delta=e.content_block?.delta;try{if(typeof delta==='string')delta=JSON.parse(delta);}catch{continue;}
    artifact=delta?.artifacts?.find((a:{resource_id?:string;main_url?:string;status?:{ret?:string;errmsg?:string}})=>a.resource_id&&a.main_url&&(!a.status?.ret||a.status.ret==='0')&&!a.status?.errmsg)??artifact;
  }
  if(!artifact)throw new Error('CANVAS_ARTIFACT_MISSING');
  const url=new URL(artifact.main_url);
  if(url.protocol!=='https:'||!/(^|\.)(ibyteimg\.com|capcut\.com|capcutstatic\.com)$/.test(url.hostname)||url.username||url.password)throw new Error('CANVAS_ARTIFACT_ORIGIN_REJECTED');
  const download=await context.get(url.toString(),{timeout:20000,maxRedirects:0,maxRetries:0});
  try{
    const bytes=await download.body();
    const isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isWebp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    const isJpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!download.ok()||bytes.length<100||bytes.length>30*1024*1024||!(isPng||isWebp||isJpeg))throw new Error('CANVAS_ARTIFACT_DOWNLOAD_INVALID');
    persist('canvas-finalize','artifact-verified',{runId:receipt.runId,threadId:body.thread_id,resourceId:artifact.resource_id,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
    report({stage:'canvas-output-verified',mechanism:'direct-http',bytes:bytes.length,mime:download.headers()['content-type'],width:artifact.width,height:artifact.height});
  }finally{await download.dispose();}
  const contract=observedTaskRequest(rows);
  const snapshot=async()=>{
    const res=await context.post(contract.origin+contract.request.path,{headers:contract.request.headers,data:contract.request.body,timeout:15000,maxRedirects:0,maxRetries:0});
    try{const json=await res.json();if(!res.ok()||json?.err_no!==0||!Array.isArray(json?.data?.task_list))throw new Error('CANVAS_SNAPSHOT_INVALID');return json.data.task_list as Array<{task_key:string;task_status:number;task_reward_view?:{reward_amount:number}}>;}
    finally{await res.dispose();}
  };
  const initial=await snapshot();
  if(!initial.some(t=>t.task_key===ACTION))throw new Error('CANVAS_TASK_UNAVAILABLE');
  if(initial.find(t=>t.task_key===ACTION)?.task_status!==4){
    if(journal.some(r=>r.stage==='canvas-finalize'&&r.state==='ack-dispatching'))throw new Error('CANVAS_ACK_ALREADY_DISPATCHED');
    const suffixes=new Set<string>();let template:Row|undefined;
    for(const row of rows){
      if(row.request?.method!=='POST')continue;
      const u=new URL(row.request.url);if(u.origin!==contract.origin||!u.pathname.endsWith('/task/v1/do_action'))continue;
      const related=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
      let p;try{p=JSON.parse(row.request.postData??related.find(r=>r.type==='request-body')?.postData??'');}catch{continue;}
      if(typeof p.action_key!=='string'||!/^capcut_web_/.test(p.action_key)||typeof p.op_id!=='string'||!p.op_id.startsWith(p.action_key+'_'))continue;
      const suffix=p.op_id.slice(p.action_key.length);if(!/^_\d+_\d{4}-\d{2}-\d{2}$/.test(suffix))throw new Error('CANVAS_ACK_CONTRACT_CHANGED');
      suffixes.add(suffix);template=row;
    }
    if(suffixes.size!==1||!template)throw new Error('CANVAS_ACK_IDENTITY_UNPROVEN');
    const suffix=[...suffixes][0];if(!suffix.endsWith(new Date().toISOString().slice(0,10)))throw new Error('CANVAS_ACK_PERIOD_STALE');
    const ackUrl=new URL('/luckycat/i18n/capcut/task/v1/do_action',contract.origin);
    const old=new URL(template.request!.url);for(const key of ['aid','device_platform']){const value=old.searchParams.get(key);if(value!==null)ackUrl.searchParams.set(key,value);}
    const headers:Record<string,string>={};for(const[k,v]of Object.entries(contract.request.headers??{}))if(!['cookie','user-agent','referer','origin','sign','host','content-length'].includes(k))headers[k]=v;
    const ackBody={action_key:ACTION,op_id:ACTION+suffix};persist('canvas-finalize','ack-dispatching',{body:ackBody,runId:receipt.runId});
    const ack=await page.evaluate(async({url,headers,body})=>{const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});const json=await res.json();return{status:res.status,ok:res.ok,errNo:json.err_no};},{url:ackUrl.toString(),headers,body:ackBody});
    persist('canvas-finalize','ack-response',ack);report({stage:'canvas-ack',mechanism:'browser-http',status:ack.status,errNo:ack.errNo,domClicks:0});
    if(!ack.ok||ack.errNo!==0)throw new Error('CANVAS_ACK_REJECTED');
  }
  const final=await snapshot();persist('canvas-finalize','snapshot',final);
  const done=final.filter(t=>t.task_status===4).length;
  report({stage:'canvas-proof-snapshot',mechanism:'direct-http',done,total:final.length,credits:final.filter(t=>t.task_status===4).reduce((s,t)=>s+(t.task_reward_view?.reward_amount??0),0),missing:final.filter(t=>t.task_status!==4).map(t=>t.task_key),fullHttpRun:false});
  if(final.find(t=>t.task_key===ACTION)?.task_status!==4)throw new Error('CANVAS_PROOF_PENDING');
}
