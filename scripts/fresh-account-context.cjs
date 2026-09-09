async function fetchJsonFromCapture(rows, context, path, report = () => {}) {
  const row=[...rows].reverse().find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname===path);
  if(!row?.request)throw new Error('FRESH_CONTEXT_REQUEST_MISSING');
  const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
  const body=row.request.postData??rel.find(r=>r.type==='request-body')?.postData??'';
  const origin=new URL(row.request.url).origin;
  if(origin!=='https://edit-api-sg.capcut.com')throw new Error('FRESH_CONTEXT_ORIGIN_REJECTED');
  const allowed=new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);
  const headers={};for(const source of [row.request.headers??{},...rel.filter(r=>r.type==='request-extra').map(r=>r.headers??{})])for(const[k,v]of Object.entries(source))if(allowed.has(k.toLowerCase()))headers[k.toLowerCase()]=v;
  if(!headers.cookie){const source=rowsForCookie(rows,row);if(source)headers.cookie=source;}
  const response=await context.post(row.request.url,{headers,data:body,timeout:20000,maxRedirects:0,maxRetries:0});let json;try{json=await response.json();}finally{await response.dispose();}
  report({stage:'account-context-read',path,status:response.status(),ret:/^-?\d+$/.test(String(json.ret))?String(json.ret):undefined,errNo:typeof json.err_no==='number'?json.err_no:undefined,cookiePresent:Boolean(headers.cookie)});
  if(!response.ok() || (String(json.ret) !== '0' && String(json.err_no) !== '0')) throw new Error('FRESH_CONTEXT_REQUEST_REJECTED'); return json;
}
function rowsForCookie(rows,row){
  const origin=new URL(row.request.url).origin;
  const requests=new Set(rows.filter(r=>r.sessionId===row.sessionId&&r.request?.url&&new URL(r.request.url).origin===origin).map(r=>r.requestId));
  for(const r of [...rows].reverse().filter(x=>x.sessionId===row.sessionId&&requests.has(x.requestId)&&x.type==='request-extra'))for(const[k,v]of Object.entries(r.headers??{}))if(k.toLowerCase()==='cookie')return v;
  return undefined;
}
module.exports={fetchJsonFromCapture};
