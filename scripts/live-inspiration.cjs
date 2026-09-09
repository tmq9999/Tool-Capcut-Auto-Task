const {randomUUID}=require('node:crypto');
const {submitInspirationHttp}=require('../src/main/services/capcut/http/inspiration.ts');

function captured(rows,pathname){
  const row=rows.find(r=>r.stage==='inspiration:submit'&&r.request?.method==='POST'&&new URL(r.request.url).pathname===pathname);
  if(!row)throw new Error('INSPIRATION_CONTRACT_MISSING');
  const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
  const raw=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;
  if(!raw)throw new Error('INSPIRATION_BODY_MISSING');
  const headers={};for(const[k,v]of Object.entries(row.request.headers??{}))if(!['cookie','host','content-length','user-agent','referer','origin','sign'].includes(k.toLowerCase()))headers[k]=v;
  const url=new URL(row.request.url);for(const key of ['msToken','X-Bogus','X-Gnarly'])url.searchParams.delete(key);
  return{url:url.toString(),headers,body:raw};
}
async function runInspiration({rows,page,persist,report}){
  const check=captured(rows,'/commerce/v3/benefits/batch_check_withhold_deduct');
  if(new URL(check.url).origin!=='https://commerce-api-sg.capcut.com')throw new Error('INSPIRATION_BENEFIT_ORIGIN_INVALID');
  const operation=captured(rows,'/lv/v1/common_task/new');
  const payload=JSON.parse(operation.body);
  if(payload.tasks?.length!==1||!payload.tasks[0].payload?.template_id)throw new Error('INSPIRATION_TEMPLATE_MISSING');
  // This is a new intent; only the client-generated binding ID is regenerated.
  if(!/^[0-9a-f-]{36}$/i.test(payload.bind_id))throw new Error('INSPIRATION_BIND_ID_CONTRACT_UNKNOWN');
  payload.bind_id=randomUUID();
  const benefit=await page.evaluate(async wire=>{
    const r=await fetch(wire.url,{method:'POST',headers:wire.headers,body:wire.body,credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});
    const json=await r.json();return{status:r.status,ok:r.ok,ret:json.ret,data:json.data};
  },check);
  persist('inspiration','allowance-response',benefit);
  const items=benefit.data?.item_list;
  const expected=JSON.parse(check.body).item_list;
  const free=benefit.ok&&String(benefit.ret)==='0'&&benefit.data?.status===1&&Array.isArray(items)&&items.length===expected.length&&items.every(i=>
    expected.some(e=>e.resource_id===i.resource_id&&e.resource_type===i.resource_type&&e.benefit_type===i.benefit_type)&&i.status===1&&i.credits_amount===0&&i.consume_types?.length===1&&i.consume_types[0]==='LimitFree');
  report({stage:'inspiration-free-check',mechanism:'browser-http',status:benefit.status,freeOnly:free,ret:benefit.ret,
    status:benefit.data?.status,itemCount:items?.length,expectedCount:expected?.length,
    itemStatuses:items?.map(i=>({status:i.status,credits:i.credits_amount,free:i.consume_types?.includes('LimitFree'),types:i.consume_types?.length})),
    expectedMatches:items?.map(i=>expected.some(e=>e.resource_id===i.resource_id&&e.resource_type===i.resource_type&&e.benefit_type===i.benefit_type))});
  if(!free)throw new Error('INSPIRATION_FREE_ALLOWANCE_UNPROVEN');
  operation.body=JSON.stringify(payload);
  persist('inspiration','dispatching',operation);
  const receipt=await submitInspirationHttp(page,operation,AbortSignal.timeout(45000));
  persist('inspiration','accepted',receipt);
  report({stage:'inspiration-http-submission',mechanism:'browser-http',status:receipt.status,accepted:receipt.accepted,taskIdPresent:Boolean(receipt.taskId),domClicks:0});
  return receipt;
}
module.exports={runInspiration};
