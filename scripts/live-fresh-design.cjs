const {fetchJsonFromCapture}=require('./fresh-account-context.cjs');
const {prepareImagexUpload,commitImagexUpload,attachImageToNewCanvas}=require('./live-imagex-upload.cjs');
const {uploadImagexBytes}=require('../src/main/services/capcut/http/imagexUpload.ts');

async function uploadFreshCanvas({rows,templates,uploadTemplates,context,sampleImage,persist,report}) {
  // Old captures provide schema/constants only; every credential, workspace,
  // owner and newly created asset comes from this live account.
  const work=await fetchJsonFromCapture(rows,context,'/cc/v1/workspace/get_user_workspaces',report);
  const candidates=work.data?.workspace_infos?.filter(w=>w.workspace_id&&w.owner);
  if(candidates?.length!==1)throw new Error('FRESH_WORKSPACE_SELECTION_AMBIGUOUS');
  const workspace=candidates[0];persist('fresh-session','workspace',{workspaceId:workspace.workspace_id,owner:workspace.owner});
  const prepared=await prepareImagexUpload({rows,protocolRows:uploadTemplates,context,sampleImage,persist,report,storageOwner:String(workspace.owner)});
  persist('fresh-upload','dispatching',{uri:prepared.address.StoreInfos[0].StoreUri});
  const byteReceipt=await uploadImagexBytes({context,address:prepared.address,file:sampleImage,storageOwner:String(workspace.owner),signal:AbortSignal.timeout(30000),report});
  persist('fresh-upload','bytes-sent',byteReceipt);
  const asset=await commitImagexUpload({rows:uploadTemplates,context,prepared,persist,report,sessionHeaders:prepared.headers});
  const canvas=await attachImageToNewCanvas({rows:templates,context,asset,persist,report,
    session:{headers:prepared.headers,workspaceId:String(workspace.workspace_id),owner:String(workspace.owner)}});
  if(canvas.workspaceId!==String(workspace.workspace_id))throw new Error('FRESH_CANVAS_WORKSPACE_MISMATCH');
  persist('fresh-design','ready',{canvas,asset});
  report({stage:'fresh-design-ready',mechanism:'direct-http',uiClicks:0,assetCreated:true,canvasCreated:true});
  return {canvas,asset,headers:prepared.headers};
}
async function resumeFreshCanvas({rows,templates,journal,context,page,persist,report,liveHeaders,metadataOnly=false,metadataRows}){
  const commit=journal.find(r=>r.stage==='image-upload'&&r.state==='commit-response')?.data?.json;
  const info=commit?.Result?.PluginResult?.[0];
  const workspace=journal.find(r=>r.stage==='fresh-session'&&r.state==='workspace')?.data;
  if(!info?.ImageUri||!workspace?.workspaceId||!workspace?.owner)throw new Error('FRESH_UPLOAD_RECEIPT_MISSING');
  const tokenRow=[...rows].reverse().find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/file/chat_upload_sign'));
  if(!tokenRow)throw new Error('FRESH_SESSION_HEADERS_MISSING');
  const headers={};for(const[k,v]of Object.entries(liveHeaders??tokenRow.request.headers))if(!['cookie','sign','referer','origin','host','content-length','user-agent','loc'].includes(k.toLowerCase()))headers[k]=v;
  report({stage:'metadata-header-source',mechanism:'browser-http',liveHeaders:Boolean(liveHeaders),appid:headers.appid,appvr:headers.appvr,pf:headers.pf,headerKeys:Object.keys(headers)});
  const sendJson=async(url,body,stage)=>{
    persist(stage,'request',{url,body});
    if(metadataRows){
      const path=new URL(url).pathname;const row=[...metadataRows].reverse().find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname===path);
      if(!row)throw new Error('FRESH_VERIFIED_HEADER_MISSING');
      const rel=metadataRows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);
      const allowed=new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);
      const h={};for(const source of[row.request.headers??{},...rel.filter(r=>r.type==='request-extra').map(r=>r.headers??{})])for(const[k,v]of Object.entries(source))if(allowed.has(k.toLowerCase()))h[k.toLowerCase()]=v;
      if(!h.cookie)throw new Error('FRESH_VERIFIED_COOKIE_MISSING');
      const res=await context.post(url,{headers:h,data:JSON.stringify(body),timeout:20000,maxRetries:0,maxRedirects:0});
      try{return{status:res.status(),ok:res.ok(),json:await res.json()};}finally{await res.dispose();}
    }
    return page.evaluate(async({url,body,headers})=>{const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000)});return{status:r.status,ok:r.ok,json:await r.json()};},{url,body,headers});
  };
  let response;
  for(let attempt=1;attempt<=1;attempt++){
    response=await sendJson('https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/image_meta',{resource_id:info.ImageUri,resource_type:3,format:3},'fresh-image-meta');
    persist('fresh-image-meta','response',{attempt,...response});report({stage:'fresh-image-meta',mechanism:metadataRows?'direct-http':'browser-http',status:response.status,ret:response.json?.ret,attempt});
    if(String(response.json?.ret)==='0')break;
    if(String(response.json?.ret)!=='1014')break;
    await new Promise(r=>setTimeout(r,2000));
  }
  if(!response.ok||String(response.json?.ret)!=='0'||!response.json?.data?.image?.resource_id)throw new Error('FRESH_IMAGE_META_REJECTED');
  if(metadataOnly)return{metadata:response.json.data.image};
  const asset={uri:info.ImageUri,md5:info.ImageMd5,width:info.ImageWidth,height:info.ImageHeight,image:response.json.data.image};
  const canvas=await attachImageToNewCanvas({rows:templates,context,asset,persist,report,session:{...workspace,headers},sendJson});
  persist('fresh-design','ready',{canvas,asset});return{canvas,asset,headers};
}
module.exports={uploadFreshCanvas,resumeFreshCanvas};
