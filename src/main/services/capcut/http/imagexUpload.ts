import {createHash} from 'node:crypto';
import fs from 'node:fs';
import type {APIRequestContext} from 'playwright-core';

const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(data:Buffer){let c=0xffffffff;for(const b of data)c=CRC_TABLE[(c^b)&255]^(c>>>8);return ((c^0xffffffff)>>>0).toString(16).padStart(8,'0');}
export interface ImagexUploadAddress {StoreInfos?:Array<{StoreUri?:string;Auth?:string;UploadID?:string}>;UploadHosts?:string[];}
export async function uploadImagexBytes(input:{context:APIRequestContext;address:ImagexUploadAddress;file:string;signal:AbortSignal;report:(x:Record<string,unknown>)=>void;storageOwner?:string}){
  const info=input.address.StoreInfos?.[0];const host=input.address.UploadHosts?.[0];if(!info?.StoreUri||!info.Auth||!host)throw new Error('IMAGE_X_ADDRESS_INVALID');
  const bytes=fs.readFileSync(input.file);if(bytes.length<100||bytes.length>30*1024*1024)throw new Error('IMAGE_X_FILE_INVALID');
  const origin=new URL('https://'+host);if(origin.pathname!=='/'||origin.username||origin.password||origin.port||origin.search||origin.hash||!/(^|\.)(tiktokcdn\.com|byteoversea\.com|vodupload\.com)$/.test(origin.hostname))throw new Error('IMAGE_X_HOST_INVALID');
  if(!/^tos-[a-z0-9-]+\/[a-zA-Z0-9_-]+$/.test(info.StoreUri))throw new Error('IMAGE_X_STORE_URI_INVALID');
  const url=new URL('/upload/v1/'+info.StoreUri,origin);
  const headers={'Authorization':info.Auth,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="sample_product.png"','Content-CRC32':crc32(bytes),...(input.storageOwner?{'X-Storage-U':input.storageOwner}:{})};
  input.report({stage:'imagex-upload-http',host:url.hostname,bytes:bytes.length,crc32:headers['Content-CRC32']});
  const response=await input.context.fetch(url.toString(),{method:'POST',headers,data:bytes,signal:input.signal,timeout:30000,maxRedirects:0,maxRetries:0});
  try {
  const raw=await response.body();
  let json:unknown;try{json=JSON.parse(raw.toString('utf8'));}catch{json=undefined;}
  const result=json as {Result?:{UriStatus?:number};code?:number;success?:boolean;data?:{crc32?:unknown}};input.report({stage:'imagex-upload-response',status:response.status(),uriStatus:result?.Result?.UriStatus,code:result?.code,success:result?.success,crc32Present:Boolean(result?.data?.crc32),bodyBytes:raw.length,bodyKeys:json&&typeof json==='object'?Object.keys(json):[]});
  if(!response.ok() || result?.code!==2000 || String(result?.data?.crc32).toLowerCase()!==headers['Content-CRC32']) throw new Error('IMAGE_X_UPLOAD_REJECTED');
  return {storeUri:info.StoreUri,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  } finally { await response.dispose(); }
}
