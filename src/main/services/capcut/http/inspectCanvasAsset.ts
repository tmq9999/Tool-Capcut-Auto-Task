import type {APIRequestContext} from 'playwright-core';

interface Row {sessionId?:number;requestId?:string;type?:string;postData?:string;headers?:Record<string,string>;request?:{url:string;method:string;postData?:string;headers?:Record<string,string>};body?:string}
export async function inspectCanvasAsset(rows:Row[],context:APIRequestContext,report:(data:Record<string,unknown>)=>void) {
  const template=rows.find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname==='/lv/v2/intelligence/thread/image_meta');
  if(!template?.request)throw new Error('CANVAS_IMAGE_META_CONTRACT_MISSING');
  const url=new URL(template.request.url);
  if(url.origin!=='https://edit-api-sg.capcut.com')throw new Error('CANVAS_IMAGE_ORIGIN_INVALID');
  const rel=rows.filter(r=>r.sessionId===template.sessionId&&r.requestId===template.requestId);
  const body=template.request.postData??rel.find(r=>r.type==='request-body')?.postData;
  if(!body)throw new Error('CANVAS_IMAGE_BODY_MISSING');
  const allowed=new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);
  const headers:Record<string,string>={};
  for(const h of [template.request.headers??{},...rel.filter(r=>r.type==='request-extra').map(r=>r.headers??{})])for(const[k,v]of Object.entries(h))if(allowed.has(k.toLowerCase()))headers[k.toLowerCase()]=v;
  if(!headers.cookie)throw new Error('CANVAS_IMAGE_AUTH_MISSING');
  const response=await context.post(url.toString(),{data:body,headers,timeout:15000,maxRetries:0,maxRedirects:0});
  let json;try{json=await response.json();}finally{await response.dispose();}
  const image=json?.data?.image;
  report({stage:'canvas-image-meta',ret:json?.ret,width:image?.width,height:image?.height,resourcePresent:Boolean(image?.resource_id),urlPresent:Boolean(image?.main_url)});
  if(String(json?.ret)!=='0'||!image?.main_url)throw new Error('CANVAS_IMAGE_NOT_READY');
  const asset=new URL(image.main_url);
  if(asset.protocol!=='https:'||!/(^|\.)(ibyteimg\.com|capcut\.com|capcutstatic\.com)$/.test(asset.hostname)||asset.username||asset.password)throw new Error('CANVAS_IMAGE_ASSET_ORIGIN_INVALID');
  const download=await context.get(asset.toString(),{timeout:20000,maxRetries:0,maxRedirects:0});
  try{
    const bytes=await download.body();const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    report({stage:'canvas-image-bytes',status:download.status(),bytes:bytes.length,mime:download.headers()['content-type'],png,
      width:png&&bytes.length>=24?bytes.readUInt32BE(16):undefined,height:png&&bytes.length>=24?bytes.readUInt32BE(20):undefined});
  }finally{await download.dispose();}
}
