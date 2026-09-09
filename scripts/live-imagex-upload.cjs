const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {pair,inspectImagexSigning,signImagex}=require('./imagex-contract.cjs');
const allowed=new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);

async function prepareImagexUpload({rows,protocolRows=rows,context,sampleImage,persist,report,storageOwner}) {
  const matches=inspectImagexSigning(protocolRows).filter(r=>r.matched);
  if(matches.length!==2||matches.some(r=>r.canonicalPath!=='/ttuploader_proxy'))throw new Error('UPLOAD_SIGNATURE_CONTRACT_UNVERIFIED');
  const row=[...rows].reverse().find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/file/chat_upload_sign')&&JSON.parse(r.request.postData??'{}').biz==='thread');
  if(!row?.request)throw new Error('UPLOAD_TOKEN_CONTRACT_MISSING');
  const headers={};for(const source of [row.request.headers??{},...pair(rows,row).filter(r=>r.type==='request-extra').map(r=>r.headers??{})])for(const[k,v]of Object.entries(source))if(allowed.has(k.toLowerCase()))headers[k.toLowerCase()]=v;
  if(!headers.cookie)throw new Error('UPLOAD_TOKEN_SESSION_MISSING');
  const tokenResponse=await context.post(row.request.url,{headers,data:row.request.postData,timeout:15000,maxRedirects:0,maxRetries:0});
  let token;try{const j=await tokenResponse.json();if(!tokenResponse.ok()||String(j.ret)!=='0')throw new Error('UPLOAD_TOKEN_REJECTED');token=j.data;}finally{await tokenResponse.dispose();}
  if(!token?.access_key_id||!token?.secret_access_key||!token?.session_token||!token?.service_id)throw new Error('UPLOAD_TOKEN_INVALID');
  report({stage:'upload-token-http',ret:'0',temporaryCredentials:true});
  const bytes=fs.readFileSync(sampleImage);if(bytes.length>10*1024*1024||bytes.length<100)throw new Error('UPLOAD_FILE_SIZE_INVALID');
  const apply=protocolRows.find(r=>r.request?.method==='GET'&&new URL(r.request.url).searchParams.get('Action')==='ApplyImageUpload');
  if(!apply)throw new Error('UPLOAD_APPLY_CONTRACT_MISSING');
  const observedUrl=new URL(apply.request.url);
  const url=new URL(observedUrl.origin+observedUrl.pathname);
  for(const key of ['Action','Version','device_platform']){const value=observedUrl.searchParams.get(key);if(value!==null)url.searchParams.set(key,value);}
  if(url.origin!=='https://www.capcut.com'||url.pathname!=='/ttuploader_proxy')throw new Error('UPLOAD_APPLY_ORIGIN_INVALID');
  url.searchParams.set('ServiceId',token.service_id);url.searchParams.set('FileSize',String(bytes.length));
  // Preserve observed non-secret request parameters; authorization is fresh.
  const signed=signImagex(url,'GET','',token,matches[0].region);
  persist('image-upload','apply-dispatching',{url:url.toString(),bytes:bytes.length,md5:createHash('md5').update(bytes).digest('hex')});
  const res=await context.get(url.toString(),{headers:{...signed,cookie:headers.cookie},timeout:20000,maxRedirects:0,maxRetries:0});
  let json;try{json=await res.json();persist('image-upload','apply-response',{status:res.status(),json});
    report({stage:'upload-apply-http',status:res.status(),errorCode:json.ResponseMetadata?.Error?.Code,addressPresent:Boolean(json.Result?.UploadAddress?.StoreInfos?.length)});
    if(!res.ok()||!json.Result?.UploadAddress?.StoreInfos?.length)throw new Error('UPLOAD_APPLY_REJECTED');
  }finally{await res.dispose();}
  return {token,bytes,address:json.Result.UploadAddress,region:matches[0].region,headers};
}
async function commitImagexUpload({rows,context,prepared,persist,report,sessionHeaders}) {
  const template=rows.find(r=>r.request?.method==='POST'&&new URL(r.request.url).searchParams.get('Action')==='CommitImageUpload');
  if(!template||!prepared.address.SessionKey)throw new Error('UPLOAD_COMMIT_CONTRACT_MISSING');
  const oldUrl=new URL(template.request.url);const url=new URL(oldUrl.origin+oldUrl.pathname);
  for(const key of ['Action','Version']){const value=oldUrl.searchParams.get(key);if(value!==null)url.searchParams.set(key,value);}
  if(url.origin!=='https://www.capcut.com'||url.pathname!=='/ttuploader_proxy')throw new Error('UPLOAD_COMMIT_ORIGIN_INVALID');
  url.searchParams.set('ServiceId',prepared.token.service_id);
  const body=JSON.stringify({SessionKey:prepared.address.SessionKey});
  const headers=signImagex(url,'POST',body,prepared.token,prepared.region);
  persist('image-upload','commit-dispatching',{url:url.toString(),body});
  const res=await context.post(url.toString(),{headers:{...headers,cookie:prepared.headers.cookie,'content-type':'application/json'},data:body,timeout:20000,maxRedirects:0,maxRetries:0});
  let result;
  try{
    result=await res.json();persist('image-upload','commit-response',{status:res.status(),json:result});
    const info=result?.Result?.PluginResult?.[0];
    const uri=prepared.address.StoreInfos[0].StoreUri;
    const stored=result?.Result?.Results?.find(r=>r.Uri===uri);
    report({stage:'imagex-commit-http',status:res.status(),uriStatus:stored?.UriStatus,width:info?.ImageWidth,height:info?.ImageHeight});
    if(!res.ok()||stored?.UriStatus!==2000||!info||info.ImageUri!==uri||info.ImageMd5!==createHash('md5').update(prepared.bytes).digest('hex'))throw new Error('UPLOAD_COMMIT_REJECTED');
  }finally{await res.dispose();}
  const info=result.Result.PluginResult[0];
  const meta=rows.find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/thread/image_meta'));
  if(!meta)throw new Error('UPLOAD_META_CONTRACT_MISSING');
  const raw=meta.request.postData??pair(rows,meta).find(r=>r.type==='request-body')?.postData;
  const metaBody=JSON.parse(raw);metaBody.resource_id=info.ImageUri;
  const metaHeaders={};for(const source of sessionHeaders?[sessionHeaders]:[meta.request.headers??{},...pair(rows,meta).filter(r=>r.type==='request-extra').map(r=>r.headers??{})])for(const[k,v]of Object.entries(source))if(allowed.has(k.toLowerCase()))metaHeaders[k.toLowerCase()]=v;
  if(!metaHeaders.cookie)metaHeaders.cookie=prepared.headers.cookie;
  const metaUrl=new URL(meta.request.url);if(metaUrl.origin!=='https://edit-api-sg.capcut.com')throw new Error('UPLOAD_META_ORIGIN_INVALID');
  const response=await context.post(metaUrl.origin+metaUrl.pathname,{headers:metaHeaders,data:JSON.stringify(metaBody),timeout:15000,maxRedirects:0,maxRetries:0});
  try{
    const json=await response.json();persist('image-upload','image-meta-response',{status:response.status(),json});
    report({stage:'imagex-meta-http',status:response.status(),ret:json?.ret,imageIdPresent:Boolean(json?.data?.image?.resource_id),imageType:json?.data?.image?.resource_type});
    if(!response.ok()||String(json?.ret)!=='0'||!json?.data?.image?.resource_id)throw new Error('UPLOAD_META_REJECTED');
    return {uri:info.ImageUri,md5:info.ImageMd5,width:info.ImageWidth,height:info.ImageHeight,image:json.data.image};
  }finally{await response.dispose();}
}
async function attachImageToNewCanvas({rows,context,asset,persist,report,session,sendJson}) {
  const saves=rows.filter(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname==='/lv/v2/canvas/save').map(row=>{
    const raw=row.request.postData??pair(rows,row).find(r=>r.type==='request-body')?.postData;
    try{const body=JSON.parse(raw);const detail=typeof body.canvas_detail==='string'?JSON.parse(body.canvas_detail):body.canvas_detail;return{row,body,detail};}catch{return null;}
  }).filter(Boolean);
  const empty=saves.find(r=>!r.body.canvas_id&&r.detail.children?.length===0);
  const populated=saves.find(r=>r.detail.children?.length===1&&r.detail.meta?.projectMaterialMeta?.length===1);
  if(!empty||!populated||empty.body.workspace_id!==populated.body.workspace_id)throw new Error('CANVAS_UPLOAD_TEMPLATE_MISSING');
  const headersFor=row=>{const h={};for(const s of session?[session.headers]:[row.request.headers??{},...pair(rows,row).filter(r=>r.type==='request-extra').map(r=>r.headers??{})])for(const[k,v]of Object.entries(s))if(allowed.has(k.toLowerCase()))h[k.toLowerCase()]=v;if(!h.cookie)throw new Error('CANVAS_UPLOAD_AUTH_MISSING');return h;};
  const save=async(body,template,stage)=>{
    persist(stage,'dispatching',{body});
    if(session){
      body.workspace_id=session.workspaceId;
      for(const key of ['createSource','uploadSource'])if(body.canvas_meta?.[key]){body.canvas_meta[key].owner=session.owner;body.canvas_meta[key].systemVersion=session.headers['user-agent'];}
    }
    const u=new URL(template.row.request.url);if(u.origin!=='https://edit-api-sg.capcut.com')throw new Error('CANVAS_UPLOAD_ORIGIN_INVALID');
    if(sendJson){const result=await sendJson(u.origin+u.pathname,body,stage);persist(stage,'response',result);report({stage,mechanism:'browser-http',status:result.status,ret:result.json?.ret});if(!result.ok||String(result.json?.ret)!=='0'||!result.json?.data?.canvas_id)throw new Error('CANVAS_SAVE_REJECTED');return result.json.data.canvas_id;}
    const r=await context.post(u.origin+u.pathname,{headers:headersFor(template.row),data:JSON.stringify(body),timeout:20000,maxRedirects:0,maxRetries:0});
    try{const json=await r.json();persist(stage,'response',{status:r.status(),json});report({stage,ret:json?.ret,status:r.status()});if(!r.ok()||String(json?.ret)!=='0'||!json?.data?.canvas_id)throw new Error('CANVAS_SAVE_REJECTED');return json.data.canvas_id;}
    finally{await r.dispose();}
  };
  const refresh=body=>{const commit=require('node:crypto').randomUUID();body.commit_id=commit;const meta=body.canvas_meta;
    if(meta?.uploadSource){meta.uploadSource.commitId=commit;meta.uploadSource.createTime=Date.now();}
    if(meta?.draft)meta.draft.updateTime=Date.now();};
  const base=structuredClone(empty.body);refresh(base);
  const canvasId=await save(base,empty,'canvas-create-http');
  const original=populated.detail.meta.projectMaterialMeta[0];const oldNode=populated.detail.children[0];
  if(!original.resourceId||!original.imageXUri||!original.md5||!oldNode.id||!asset.image?.resource_id||!asset.image?.main_url)throw new Error('CANVAS_ASSET_BINDING_INVALID');
  const replacements=new Map([[original.resourceId,asset.image.resource_id],[original.imageXUri,asset.uri],[original.md5,asset.md5],
    [original.url,asset.image.main_url],[original.cover,asset.image.second_url||asset.image.main_url],[populated.body.canvas_id,canvasId],
    [oldNode.id,require('node:crypto').randomUUID()]]);
  const replace=v=>{
    if(typeof v==='string')return replacements.get(v)??v;
    if(Array.isArray(v))return v.map(replace);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)]));
    return v;
  };
  const next=replace(populated.body);const detail=replace(populated.detail);
  detail.meta.projectMaterialMeta[0].width=asset.width;detail.meta.projectMaterialMeta[0].height=asset.height;
  detail.children[0].layout.width=asset.width;detail.children[0].layout.height=asset.height;
  if(detail.children[0].layout.clipRect){detail.children[0].layout.clipRect.width=asset.width;detail.children[0].layout.clipRect.height=asset.height;}
  next.canvas_detail=typeof populated.body.canvas_detail==='string'?JSON.stringify(detail):detail;
  next.canvas_id=canvasId;refresh(next);
  const savedId=await save(next,populated,'canvas-attach-image-http');
  if(savedId!==canvasId)throw new Error('CANVAS_SAVE_ID_MISMATCH');
  const receipt={canvasId,workspaceId:next.workspace_id,imageId:asset.image.resource_id,imageType:asset.image.resource_type,uri:asset.uri,nodeId:detail.children[0].id};
  persist('canvas-upload','attached',receipt);report({stage:'canvas-upload-attached',imageType:receipt.imageType,canvasIdPresent:true,nodeIdPresent:true,uiClicks:0});
  return receipt;
}
module.exports={prepareImagexUpload,commitImagexUpload,attachImageToNewCanvas};
