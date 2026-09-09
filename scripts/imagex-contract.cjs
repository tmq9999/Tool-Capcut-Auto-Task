const aws4 = require('aws4');
const { createHash } = require('node:crypto');

function pair(rows, row) {
  return rows.filter(r => r.sessionId === row.sessionId && r.requestId === row.requestId);
}
function jsonResponse(rows, row) {
  const r = pair(rows,row).find(r => r.type === 'response-body');
  if (!r?.body) return null;
  try { return JSON.parse(r.base64Encoded ? Buffer.from(r.body,'base64').toString() : r.body); } catch { return null; }
}

// Matches only the standard object-storage SigV4 signature, not the web anti-abuse SDK.
function inspectImagexSigning(rows) {
  const credentials = rows.filter(r => r.request?.method === 'POST' && new URL(r.request.url).pathname.endsWith('/file/chat_upload_sign'))
    .map(r => jsonResponse(rows,r)?.data).filter(Boolean);
  const results=[];
  for (const row of rows.filter(r => r.request?.method !== 'OPTIONS' && r.request?.url && new URL(r.request.url).pathname === '/ttuploader_proxy')) {
    const url=new URL(row.request.url);
    const headers=Object.fromEntries(Object.entries(row.request.headers).map(([k,v])=>[k.toLowerCase(),v]));
    const auth=headers.authorization;
    const fields=auth?.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([a-f0-9]+)$/);
    if(!fields) {results.push({action:url.searchParams.get('Action'),matched:false,reason:'UNSUPPORTED_AUTH'});continue;}
    const creds=credentials.find(c=>c.access_key_id===fields[1]);
    if(!creds) {results.push({action:url.searchParams.get('Action'),matched:false,reason:'CREDENTIAL_PAIR_MISSING'});continue;}
    const raw=row.request.postData??pair(rows,row).find(r=>r.type==='request-body')?.postData??'';
    for(const pathname of ['/',url.pathname]) {
      const signedHeaders=Object.fromEntries(fields[5].split(';').map(k=>[k,headers[k]]));
      const opts={host:creds.domain,path:pathname+url.search,method:row.request.method,service:fields[4],region:fields[3],body:raw,headers:signedHeaders,
        extraHeadersToIgnore:{host:true,'content-type':true,'content-length':true}};
      const signed=aws4.sign(opts,{accessKeyId:creds.access_key_id,secretAccessKey:creds.secret_access_key,sessionToken:creds.session_token});
      results.push({action:url.searchParams.get('Action'),canonicalPath:pathname,matched:signed.headers.Authorization===auth,region:fields[3],service:fields[4],signedHeaders:fields[5]});
    }
  }
  return results;
}

function signImagex(url, method, body, credentials, region) {
  const headers={ 'X-Amz-Date':new Date().toISOString().replace(/[:-]|\.\d{3}/g,''), 'X-Amz-Security-Token':credentials.session_token };
  if(method==='POST') headers['X-Amz-Content-Sha256']=createHash('sha256').update(body).digest('hex');
  const signed=aws4.sign({host:url.hostname,path:url.pathname+url.search,method,body,service:'imagex',region,headers,
    extraHeadersToIgnore:{host:true,'content-type':true,'content-length':true}},
    {accessKeyId:credentials.access_key_id,secretAccessKey:credentials.secret_access_key,sessionToken:credentials.session_token});
  delete signed.headers.Host;delete signed.headers['Content-Length'];
  return signed.headers;
}
module.exports={inspectImagexSigning,signImagex,pair,jsonResponse};
