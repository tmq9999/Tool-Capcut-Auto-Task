// Existing-account HTTP investigation. No browser launch and no mailbox purchase.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
require('tsx/cjs');
const Database = require('better-sqlite3');
const { request } = require('playwright-core');
const { CredentialRepository } = require('../src/main/repositories/CredentialRepository.ts');
const { ProxyLeaseRepository } = require('../src/main/repositories/ProxyLeaseRepository.ts');
const { CredentialVault } = require('../src/main/security/CredentialVault.ts');
const { SecretReader } = require('../src/main/services/SecretReader.ts');
const { FetchHttpClient } = require('../src/main/providers/HttpClient.ts');
const { KiotProxyProvider } = require('../src/main/providers/KiotProxyProvider.ts');
const { ProxyLeaseManager } = require('../src/main/services/ProxyLeaseManager.ts');
const { observedTaskRequest } = require('../src/main/services/capcut/http/observedTaskRequest.ts');
const { runCapturedDesignChat } = require('../src/main/services/capcut/http/capturedDesignChat.ts');
const { exportCapturedCreatorAsset } = require('../src/main/services/capcut/http/capturedCreatorExport.ts');
const { runCapturedCreatorGenerate, observeCreatorConversation } = require('../src/main/services/capcut/http/capturedCreatorGenerate.ts');
const { confirmCapturedCreator } = require('../src/main/services/capcut/http/capturedCreatorGenerate.ts');
const { queryAndDownloadCreatorAsset } = require('../src/main/services/capcut/http/capturedCreatorAsset.ts');
const { acknowledgeExport } = require('../src/main/services/capcut/http/acknowledgeExport.ts');
const { randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');
const { MultiloginProvider } = require('../src/main/providers/MultiloginProvider.ts');
const { MultiloginAuthService } = require('../src/main/services/MultiloginAuthService.ts');
const { ApiV3Launcher } = require('../src/main/services/capcut/launcher/ApiV3Launcher.ts');
const { restoreCapturedCookies, sendDesignInBrowser } = require('../src/main/services/capcut/http/browserHttpSession.ts');
const { discoverCanvasRequest } = require('../src/main/services/capcut/http/discoverCanvasRequest.ts');
const { attachPrivateCapture } = require('../src/main/services/capcut/http/privateCapture.ts');
const { ensureSampleImage } = require('../src/main/services/capcut/image.ts');
const { inspectDesignReceipt } = require('../src/main/services/capcut/http/designReceipt.ts');
const { inspectCanvasAsset } = require('../src/main/services/capcut/http/inspectCanvasAsset.ts');
const { finishCanvasReceipt } = require('../src/main/services/capcut/http/finishCanvasReceipt.ts');
const { prepareImagexUpload, commitImagexUpload, attachImageToNewCanvas } = require('./live-imagex-upload.cjs');
const { uploadImagexBytes } = require('../src/main/services/capcut/http/imagexUpload.ts');
const { runInspiration } = require('./live-inspiration.cjs');
const { fetchJsonFromCapture } = require('./fresh-account-context.cjs');
const { uploadFreshCanvas, resumeFreshCanvas } = require('./live-fresh-design.cjs');
const { runFreshDesignOperation } = require('./live-fresh-design-operations.cjs');
const { accountApiQuery } = require('./account-api-query.cjs');
const { discoverThreadContract } = require('./discover-thread-contract.cjs');
const { runFreshCreator } = require('./live-fresh-creator.cjs');
const { discoverCreatorContract } = require('./discover-creator-contract.cjs');
app.setPath('userData', path.join(app.getPath('appData'), 'automanager-desktop'));

let exitCode = 1;
app.whenReady().then(async () => {
  const file = process.argv[2];
  if (!file || path.extname(file) !== '.enc') throw new Error('CAPTURE_REQUIRED');
  const accountId = path.basename(file, '.enc');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))));
  const contract = observedTaskRequest(rows);
  const db = new Database(path.join(app.getPath('userData'), 'automanager.db'), { fileMustExist: true });
  const repo = new ProxyLeaseRepository(db);
  if (process.argv.includes('--cleanup-owned')) {
    try {
      const account = db.prepare('SELECT proxy, browser_profile_id FROM accounts WHERE id=?').get(accountId);
      if (!account?.browser_profile_id) throw new Error('OWNED_PROFILE_MISSING');
      const vault = new CredentialVault(safeStorage);
      const credentials = new CredentialRepository(db);
      const api = new MultiloginProvider(new FetchHttpClient());
      const auth = new MultiloginAuthService(credentials, vault, api);
      const token = await auth.getAccessToken();
      const before = await api.getQuickProfileStatuses(token, 10000);
      const own = before.find(p => p.profileId === account.browser_profile_id);
      if (own && own.status !== 'stopped') await api.stopProfile(token, account.browser_profile_id, 10000);
      const after = await api.getQuickProfileStatuses(token, 10000);
      if (after.some(p => p.profileId === account.browser_profile_id && p.status !== 'stopped')) throw new Error('PROFILE_STILL_ACTIVE');
      const leases = repo.listActive().filter(l => l.host + ':' + l.port === account.proxy);
      const kiot = new KiotProxyProvider(new FetchHttpClient());
      const keys = await kiot.listKeys(new SecretReader(credentials, vault).readSimpleKey('kiotproxy'));
      for (const lease of leases) {
        const key = keys.find(k => createHash('sha256').update(k.keyValue).digest('hex') === lease.keyHash);
        if (!key) throw new Error('OWNED_PROXY_KEY_MISSING');
        await kiot.releaseKey(key.keyValue); repo.release(lease.id);
      }
      process.stdout.write(JSON.stringify({ stage: 'cleanup-owned', profileStopped: true, leasesReleased: leases.length }) + '\n');
      exitCode = 0; return;
    } finally { db.close(); }
  }
  // Do not rotate keys while another locally recorded run owns any lease.
  if (repo.listActive().length) { db.close(); throw new Error('OTHER_RUN_ACTIVE'); }
  const secrets = new SecretReader(new CredentialRepository(db), new CredentialVault(safeStorage));
  const manager = new ProxyLeaseManager(new KiotProxyProvider(new FetchHttpClient()), repo, { apiToken: secrets.readSimpleKey('kiotproxy'), acquireTimeoutMs: 60000 });
  let lease; let context;
  const results = [];
  const report = data => { const row = { at: new Date().toISOString(), mechanism: 'direct-http', ...data }; results.push(row); process.stdout.write(JSON.stringify(row) + '\n'); };
  try {
    if (!db.prepare('SELECT id FROM accounts WHERE id=?').get(accountId)) throw new Error('ACCOUNT_NOT_FOUND');
    report({ stage: 'proxy-acquisition', account: accountId });
    lease = await manager.acquire(AbortSignal.timeout(60000));
    report({ stage: 'proxy-ready', protocol: lease.protocol, credentialsPresent: Boolean(lease.username || lease.password) });
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: lease.host, port: lease.port });
      socket.setTimeout(5000);
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => { socket.destroy(); reject(new Error('PROXY_TCP_FAILED')); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('PROXY_TCP_TIMEOUT')); });
    });
    report({ stage: 'proxy-tcp', reachable: true });
    context = await request.newContext({ proxy: { server: `${lease.protocol}://${lease.host}:${lease.port}`, ...(lease.username ? { username: lease.username } : {}), ...(lease.password ? { password: lease.password } : {}) }, timeout: 20000, maxRedirects: 0 });
    const started = Date.now();
    const response = await context.fetch(contract.origin + contract.request.path, { method: 'POST', headers: contract.request.headers, data: contract.request.body, timeout: 20000, maxRedirects: 0, maxRetries: 0 });
    let body; try { body = await response.json(); } catch { throw new Error('TASK_LIST_NON_JSON'); }
    const list = body?.data?.task_list;
    report({ stage: 'task-list', status: response.status(), errNo: body?.err_no, valid: response.ok() && body?.err_no === 0 && Array.isArray(list), elapsedMs: Date.now() - started,
      tasks: Array.isArray(list) ? list.map(t => ({ key: t.task_key, status: t.task_status, reward: t.task_reward_view?.reward_amount })) : undefined });
    await response.dispose();
    if(process.argv.includes('--discover-creator-contract')){
     const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
     const target=file+'.'+randomUUID()+'.creator-contract.enc';const fd=fs.openSync(target,'wx',0o600);
     try{
      profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
      await restoreCapturedCookies(profile.context,rows);
      await discoverCreatorContract({page:profile.page,context:profile.context,report,persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
      report({stage:'creator-contract-file',file:path.basename(target)});
     }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const freshCreatorFlag=process.argv.find(a=>a.startsWith('--fresh-creator='));
    if(freshCreatorFlag){
     const templateFile=freshCreatorFlag.slice('--fresh-creator='.length);const decode=p=>fs.readFileSync(p,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
     const templates=decode(templateFile);const journalFile=process.argv.find(a=>a.startsWith('--creator-journal='))?.slice('--creator-journal='.length);
     const projectContractFile=process.argv.find(a=>a.startsWith('--project-contract='))?.slice('--project-contract='.length);
     let projectContract;
     if(projectContractFile){const prepared=decode(projectContractFile);if(prepared.some(r=>r.accountId!==accountId))throw new Error('CREATOR_CONTRACT_ACCOUNT_MISMATCH');projectContract=prepared.find(r=>r.stage==='creator-contract'&&r.state==='blocked-project')?.data;}
     const maxCredits=Number(process.argv.find(a=>a.startsWith('--credit-budget='))?.slice('--credit-budget='.length));if(!Number.isFinite(maxCredits)||maxCredits<0)throw new Error('CREATOR_CREDIT_BUDGET_REQUIRED');
     const target=journalFile??file+'.'+randomUUID()+'.fresh-creator.enc';const journal=journalFile?decode(target):[];
     if(journal.some(r=>r.accountId!==accountId)||!path.basename(target).startsWith(accountId+'.enc.'))throw new Error('CREATOR_JOURNAL_ACCOUNT_MISMATCH');
     const fd=fs.openSync(target,journalFile?'a':'wx',0o600);const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
     const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
     report({stage:'fresh-creator-journal',file:path.basename(target)});
     try{
      profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
      await restoreCapturedCookies(profile.context,rows);await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
      await runFreshCreator({rows,templates,journal,context,page:profile.page,proxy:{server:`${lease.protocol}://${lease.host}:${lease.port}`},maxCredits,projectContract,report,persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
     }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const nativeThreadFlag=process.argv.find(a=>a.startsWith('--create-thread-from-contract='));
    if(nativeThreadFlag){
     const capturedFile=nativeThreadFlag.slice('--create-thread-from-contract='.length);const targetJournal=process.argv.find(a=>a.startsWith('--design-journal='))?.slice('--design-journal='.length);
     if(!targetJournal)throw new Error('THREAD_TARGET_JOURNAL_MISSING');
     const decode=p=>fs.readFileSync(p,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
     const native=decode(capturedFile),journal=decode(targetJournal);if([...native,...journal].some(r=>r.accountId!==accountId))throw new Error('THREAD_CONTRACT_ACCOUNT_MISMATCH');
     const wire=native.find(r=>r.stage==='thread-contract'&&r.state==='blocked-request')?.data;const ready=journal.find(r=>r.stage==='fresh-design'&&r.state==='ready')?.data;
     if(!wire?.body||!ready?.canvas)throw new Error('THREAD_CONTRACT_INCOMPLETE');
     const url=new URL(wire.url);if(url.origin!=='https://edit-api-sg.capcut.com'||url.pathname!=='/lv/v2/intelligence/thread/create')throw new Error('THREAD_CONTRACT_ORIGIN_INVALID');
     const payload=JSON.parse(wire.body);if(payload.workspace_id!==ready.canvas.workspaceId||payload.source!==1)throw new Error('THREAD_CONTRACT_WORKSPACE_MISMATCH');payload.resource_id=ready.canvas.canvasId;
     const isCanvas=process.argv.includes('--canvas-thread');
     if(isCanvas)payload.source=2;
     const threadStage=isCanvas?'fresh-design-canvas-thread':'fresh-design-chat-thread';
     if(journal.some(r=>r.stage===threadStage&&r.state==='native-contract-dispatching'))throw new Error('THREAD_CONTRACT_ALREADY_DISPATCHED');
     const fd=fs.openSync(targetJournal,'a');const persist=(state,data)=>{fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage:threadStage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);};
     try{
      persist('native-contract-dispatching',{url:wire.url,body:payload});
      const response=await context.post(wire.url,{headers:wire.headers,data:JSON.stringify(payload),timeout:20000,maxRetries:0,maxRedirects:0});
      try{const json=await response.json();persist('native-contract-response',json);report({stage:'native-contract-thread-http',status:response.status(),ret:json.ret,threadPresent:Boolean(json.data?.thread_info?.thread_id),resource:'http-created-canvas'});if(!response.ok()||String(json.ret)!=='0'||!json.data?.thread_info?.thread_id)throw new Error('THREAD_NATIVE_CONTRACT_REJECTED');}finally{await response.dispose();}
     }finally{fs.closeSync(fd);}
    }
    if(process.argv.includes('--discover-thread-contract')){
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
      const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
      const journalFile=file+'.'+randomUUID()+'.thread-contract.enc';const fd=fs.openSync(journalFile,'wx',0o600);
      const persist=(stage,state,data)=>{fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);};
      try{
       profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
       await restoreCapturedCookies(profile.context,rows);
       const observed=await discoverThreadContract({page:profile.page,context:profile.context,persist,report});
       const metaFile=process.argv.find(a=>a.startsWith('--metadata-capture='))?.slice('--metadata-capture='.length);
       if(metaFile){
        if(!path.basename(metaFile).startsWith(accountId+'.enc.'))throw new Error('CONTRACT_ACCOUNT_MISMATCH');
        const network=fs.readFileSync(metaFile,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
        const meta=network.find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/thread/image_meta'));
        const h=Object.fromEntries(Object.entries(meta?.request?.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
        report({stage:'thread-header-comparison',keysDifferent:Object.entries(observed.headers).filter(([k,v])=>h[k]!==v).map(([k])=>k),nativeSignPresent:Boolean(observed.headers.sign),nativeQueryKeys:[...new URL(observed.url).searchParams.keys()]});
       }
       report({stage:'thread-contract-file',journalFile:path.basename(journalFile)});
      }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const inspectSession=process.argv.find(a=>a.startsWith('--inspect-design-session='));
    if(inspectSession){
      const journalFile=inspectSession.slice('--inspect-design-session='.length);
      const journal=fs.readFileSync(journalFile,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      if(journal.some(r=>r.accountId!==accountId))throw new Error('SESSION_ACCOUNT_MISMATCH');
      const owned=journal.find(r=>r.stage==='fresh-session'&&r.state==='workspace')?.data;
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
      try{
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);
        const nativeResponses=[];const pendingReads=[];
        profile.context.on('response',r=>{
          const url=new URL(r.url());
          if(url.origin!=='https://edit-api-sg.capcut.com'||!/^\/cc\/v1\/workspace\/|^\/lv\/v1\/user\/web\/user_info/.test(url.pathname))return;
          const p=r.json().then(json=>nativeResponses.push({path:url.pathname,status:r.status(),ret:json.ret,workspaceCount:json.data?.workspace_infos?.length,
            expectedWorkspacePresent:json.data?.workspace_infos?.some(w=>String(w.workspace_id)===String(owned?.workspaceId)),expectedOwnerPresent:json.data?.workspace_infos?.some(w=>String(w.owner)===String(owned?.owner))})).catch(()=>{});pendingReads.push(p);
        });
        const work=profile.page.waitForResponse(r=>['/cc/v1/workspace/get_user_workspaces','/cc/v1/workspace/mget_workspace_info'].includes(new URL(r.url()).pathname)&&r.request().method()==='POST',{timeout:20000});void work.catch(()=>{});
        await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        const response=await work.catch(()=>null);
        report({stage:'session-surface',path:new URL(profile.page.url()).pathname,title:await profile.page.title(),body:(await profile.page.locator('body').innerText({timeout:5000})).slice(0,1800).replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi,'<email>')});
        await Promise.allSettled(pendingReads);report({stage:'native-session-reads',responses:nativeResponses});
        if(!response)throw new Error('NATIVE_WORKSPACE_RESPONSE_MISSING');
        const json=await response.json();
        const w=json?.data?.workspace_infos??[];
        report({stage:'native-design-session',mechanism:'browser-bootstrap-read',status:response.status(),ret:json.ret,workspaceCount:w.length,
          expectedWorkspacePresent:w.some(x=>String(x.workspace_id)===String(owned?.workspaceId)),expectedOwnerPresent:w.some(x=>String(x.owner)===String(owned?.owner)),domClicks:0});
        const h=await response.request().allHeaders();
        report({stage:'native-design-header-schema',keys:Object.keys(h),appvr:h.appvr,appid:h.appid,loc:h.loc,cookiePresent:Boolean(h.cookie)});
        const nativeProbe=await profile.page.evaluate(async()=>{const r=await fetch('https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/inspiration/check',{method:'POST',headers:{'content-type':'application/json'},body:'{}',credentials:'include',signal:AbortSignal.timeout(15000)});const j=await r.json();return{status:r.status,ret:j.ret,enable:j.enable};});
        report({stage:'native-minimal-http-read',mechanism:'browser-http',...nativeProbe});
      }finally{if(profile)await launcher.stop(profile.profileId);}
    }
    if(process.argv.includes('--thread-routing-probe')){
      const query=accountApiQuery(rows);
      const headers={...contract.request.headers};delete headers.sign;
      for(const variant of ['without-routing-query','with-account-routing-query']){
        const url='https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/inspiration/check'+(variant==='with-account-routing-query'?'?'+query.toString():'');
        const r=await context.post(url,{headers,data:'{}',timeout:15000,maxRetries:0,maxRedirects:0});
        try{const json=await r.json();report({stage:'thread-routing-probe',variant,status:r.status(),ret:json.ret,enable:json.enable});}finally{await r.dispose();}
      }
    }
    const designOperationFlag=process.argv.find(a=>a.startsWith('--design-operation='));
    if(designOperationFlag){
      const kind=designOperationFlag.slice('--design-operation='.length);if(!['chat','canvas'].includes(kind))throw new Error('DESIGN_OPERATION_INVALID');
      const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
      const journalFile=arg('design-journal');const networkFile=arg('metadata-capture');const templateFile=arg('operation-template');
      if(!journalFile||!networkFile||!templateFile||!path.basename(networkFile).startsWith(accountId+'.enc.'))throw new Error('DESIGN_OPERATION_INPUT_MISSING');
      const decode=p=>fs.readFileSync(p,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      const journal=decode(journalFile);if(journal.some(r=>r.accountId!==accountId))throw new Error('DESIGN_OPERATION_ACCOUNT_MISMATCH');
      const network=decode(networkFile);const templates=decode(templateFile);
      const fd=fs.openSync(journalFile,'a');const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
      const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
      try{
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);
        const liveRequest=profile.page.waitForRequest(r=>new URL(r.url()).origin==='https://edit-api-sg.capcut.com'&&r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/cc/v1/workspace/'),{timeout:20000}).catch(()=>null);
        await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        const liveHeaders=await liveRequest.then(r=>r?.allHeaders());
        await runFreshDesignOperation({kind,rows,network,templates,journal,context,page:profile.page,report,minimalHeaders:process.argv.includes('--minimal-headers'),liveHeaders,persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
      }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const bootstrapChatFlag=process.argv.includes('--bootstrap-chat-http');
    if(bootstrapChatFlag){
      const journalFile=process.argv.find(a=>a.startsWith('--design-journal='))?.slice('--design-journal='.length);
      if(!journalFile)throw new Error('DESIGN_JOURNAL_REQUIRED');
      const journal=fs.readFileSync(journalFile,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      if(journal.some(r=>r.accountId!==accountId))throw new Error('CHAT_BOOTSTRAP_ACCOUNT_MISMATCH');
      const workspace=journal.find(r=>r.stage==='fresh-session'&&r.state==='workspace')?.data;
      const canvas=journal.find(r=>r.stage==='canvas-upload'&&r.state==='attached')?.data;
      if(!workspace?.workspaceId||!canvas?.canvasId)throw new Error('CHAT_BOOTSTRAP_CONTEXT_MISSING');
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;const fd=fs.openSync(journalFile,'a');
      try{
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});await restoreCapturedCookies(profile.context,rows);await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        const createResponse=profile.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/lv/v2/intelligence/thread/create',{timeout:30000});
        await profile.page.getByText('New chat',{exact:true}).click({timeout:15000});
        const cr=await createResponse;const createJson=await cr.json();const threadId=createJson?.data?.thread_info?.thread_id;if(String(createJson.ret)!=='0'||!threadId)throw new Error('CHAT_BOOTSTRAP_CREATE_REJECTED');
        const headers=await cr.request().allHeaders();const body={source:1,mode:1,contents:[{type:'text',text:'Suggest a simple layout for this uploaded product image.'}],thread_id:threadId,workspace_id:String(workspace.workspaceId),resource_id:String(canvas.canvasId),selected_models:[{category:1,models:[]}],libra_params:{enable_coding_ppt:false,new_agent_panel_type:1,commerce_new:true}};
        fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage:'fresh-design-chat-http',state:'dispatching',data:{threadId,body}})).toString('base64')+'\n');fs.fsyncSync(fd);
        const result=await sendDesignInBrowser(profile.page,{url:'https://edit-api-sg.capcut.com/lv/v2/intelligence/thread/run/start',headers,body:JSON.stringify(body)});const evidence=inspectDesignReceipt(result.raw,threadId);
        report({stage:'fresh-design-chat-http',mechanism:'browser-http',status:result.status,mime:result.mime,accepted:evidence.accepted,runEnded:evidence.ended,errors:evidence.artifactErrors,domClicks:1,mutationDomClicks:0});
        fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage:'fresh-design-chat-http',state:'response',data:{status:result.status,mime:result.mime,raw:result.raw}})).toString('base64')+'\n');fs.fsyncSync(fd);
        if(!evidence.accepted)throw new Error('CHAT_HTTP_RECEIPT_MISSING');
      }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const metaCompare=process.argv.find(a=>a.startsWith('--metadata-compare='));
    if(metaCompare){
      const p=metaCompare.slice('--metadata-compare='.length);const j=process.argv.find(a=>a.startsWith('--asset-journal='))?.slice('--asset-journal='.length);
      const decode=f=>fs.readFileSync(f,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      if(!path.basename(p).startsWith(accountId+'.enc.')||!j)throw new Error('METADATA_COMPARE_ACCOUNT_MISMATCH');
      const network=decode(p);const journal=decode(j);if(journal.some(r=>r.accountId!==accountId))throw new Error('METADATA_COMPARE_ACCOUNT_MISMATCH');
      const uri=journal.find(r=>r.stage==='image-upload'&&r.state==='commit-response')?.data?.json?.Result?.PluginResult?.[0]?.ImageUri;
      const row=network.find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/thread/image_meta'));if(!uri||!row)throw new Error('METADATA_COMPARE_INPUT_MISSING');
      const rel=network.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const headers={};
      for(const h of [row.request.headers,...rel.filter(r=>r.type==='request-extra').map(r=>r.headers)])for(const[k,v]of Object.entries(h??{}))if(!k.startsWith(':')&&!['host','content-length'].includes(k.toLowerCase()))headers[k]=v;
      const payload=JSON.parse(row.request.postData??rel.find(r=>r.type==='request-body')?.postData);
      for(const variant of ['native-asset','http-uploaded-asset']){
        const body={...payload,...(variant==='http-uploaded-asset'?{resource_id:uri}:{})};
        const r=await context.post(row.request.url,{headers,data:JSON.stringify(body),timeout:15000,maxRetries:0,maxRedirects:0});
        try{const json=await r.json();report({stage:'metadata-differential',variant,status:r.status(),ret:json.ret,imagePresent:Boolean(json.data?.image?.resource_id)});}finally{await r.dispose();}
      }
    }
    const resumeDesignFlag=process.argv.find(a=>a.startsWith('--resume-fresh-design='));
    if(resumeDesignFlag){
      const journalFile=resumeDesignFlag.slice('--resume-fresh-design='.length);
      const templateFile=process.argv.find(a=>a.startsWith('--design-template='))?.slice('--design-template='.length);
      if(!templateFile)throw new Error('FRESH_DESIGN_TEMPLATE_MISSING');
      const decode=p=>fs.readFileSync(p,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      const journal=decode(journalFile);if(journal.some(r=>r.accountId!==accountId))throw new Error('FRESH_JOURNAL_ACCOUNT_MISMATCH');
      if(journal.some(r=>r.stage==='fresh-design'&&r.state==='ready'))throw new Error('FRESH_CANVAS_ALREADY_CREATED');
      const templates=decode(templateFile);const fd=fs.openSync(journalFile,'a');
      const metadataFile=process.argv.find(a=>a.startsWith('--metadata-capture='))?.slice('--metadata-capture='.length);
      if(metadataFile&&!path.basename(metadataFile).startsWith(accountId+'.enc.'))throw new Error('METADATA_ACCOUNT_MISMATCH');
      const metadataRows=metadataFile?decode(metadataFile):undefined;
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
      try{
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);
        let liveHeaders;
        const headerPromise=profile.page.waitForRequest(r=>new URL(r.url()).origin==='https://edit-api-sg.capcut.com'&&r.method()==='POST'&&new URL(r.url()).pathname.includes('/lv/'),{timeout:20000}).then(r=>r.allHeaders());void headerPromise.catch(()=>{});
        await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        if(process.argv.includes('--current-headers'))liveHeaders=await headerPromise;
        await resumeFreshCanvas({rows,templates,journal,context,page:profile.page,report,liveHeaders,metadataRows,metadataOnly:process.argv.includes('--metadata-only'),persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
      }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const freshDesignFlag=process.argv.find(a=>a.startsWith('--fresh-design='));
    if(freshDesignFlag){
      const templateFile=freshDesignFlag.slice('--fresh-design='.length);
      const uploadFile=process.argv.find(a=>a.startsWith('--upload-template='))?.slice('--upload-template='.length);
      if(!uploadFile)throw new Error('FRESH_UPLOAD_TEMPLATE_MISSING');
      const decode=p=>fs.readFileSync(p,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      const templates=decode(templateFile);const uploadTemplates=decode(uploadFile);
      const journalFile=file+'.'+randomUUID()+'.fresh-design.enc';const fd=fs.openSync(journalFile,'wx',0o600);
      try{await uploadFreshCanvas({rows,templates,uploadTemplates,context,sampleImage:ensureSampleImage(path.join(app.getPath('userData'),'assets')),report,
        persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
      }finally{fs.closeSync(fd);}
    }
    if(process.argv.includes('--fresh-context')){
      const work=await fetchJsonFromCapture(rows,context,'/cc/v1/workspace/get_user_workspaces',report);
      report({stage:'fresh-account-context',mechanism:'direct-http',workspaces:work.data?.workspace_infos?.length??0,workspaceIds:work.data?.workspace_infos?.map(w=>String(w.workspace_id)).filter(Boolean),domClicks:0});
    }
    if(process.argv.includes('--inspiration-http')){
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
      const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
      const fd=fs.openSync(file+'.'+randomUUID()+'.inspiration-http.enc','wx',0o600);
      try{
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);
        await profile.page.goto('https://www.capcut.com/my-edit?from_page=landing_page&start_tab=video&inspirationKey=7611886117142531329',{waitUntil:'domcontentloaded',timeout:45000});
        await runInspiration({rows,page:profile.page,report,persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
      }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    if(process.argv.includes('--capture-upload-only')){
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
      const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;let capture;
      try{
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);
        const networkFile=file+'.'+randomUUID()+'.upload-network.enc';
        capture=await attachPrivateCapture(profile.context,networkFile,text=>safeStorage.encryptString(text));capture.mark('upload-only');
        await profile.context.route('**/task/v1/do_action*',route=>route.abort('aborted'));
        await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        const metadata=profile.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/thread/image_meta'),{timeout:45000});void metadata.catch(()=>{});
        const complete=profile.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/ttuploader_proxy'&&new URL(r.url()).searchParams.get('Action')==='CommitImageUpload',{timeout:45000});
        void complete.catch(()=>{});
        const chooser=profile.page.waitForEvent('filechooser',{timeout:20000});void chooser.catch(()=>{});
        await profile.page.locator('[aria-label="Canvas tools"] [aria-label="Upload image"]').click({timeout:20000});
        await(await chooser).setFiles(ensureSampleImage(path.join(app.getPath('userData'),'assets')));
        const response=await complete;const json=await response.json();
        report({stage:'upload-only-capture',mechanism:'ui-discovery',status:response.status(),uriStatus:json?.Result?.Results?.[0]?.UriStatus,networkFile:path.basename(networkFile)});
        const metaResponse=await metadata;const meta=await metaResponse.json();
        report({stage:'upload-native-metadata',mechanism:'ui-discovery',status:metaResponse.status(),ret:meta.ret,imagePresent:Boolean(meta.data?.image?.resource_id)});
        const direct=await context.post(metaResponse.request().url(),{headers:await metaResponse.request().allHeaders(),data:metaResponse.request().postData(),timeout:15000,maxRedirects:0,maxRetries:0});
        try{const json=await direct.json();report({stage:'upload-metadata-direct-parity',status:direct.status(),ret:json.ret,imagePresent:Boolean(json.data?.image?.resource_id)});}finally{await direct.dispose();}
      }finally{try{await capture?.stop();if(profile)await launcher.stop(profile.profileId);}finally{report({stage:'upload-discovery-cleanup'});}}
    }
    const uploadFlag=process.argv.find(a=>a.startsWith('--prepare-http-upload='));
    if(uploadFlag){
      const networkFile=uploadFlag.slice('--prepare-http-upload='.length);
      if(!path.basename(networkFile).startsWith(accountId+'.enc.'))throw new Error('UPLOAD_NETWORK_ACCOUNT_MISMATCH');
      const networkRows=fs.readFileSync(networkFile,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      const fd=fs.openSync(file+'.'+randomUUID()+'.upload-http.enc','wx',0o600);
      try{const prepared=await prepareImagexUpload({rows:networkRows,context,sampleImage:ensureSampleImage(path.join(app.getPath('userData'),'assets')),report,
        persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
        if(process.argv.includes('--execute-http-upload')) {
          const persist=(stage,state,data)=>{fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);};
          persist('image-upload','byte-dispatching',{uri:prepared.address.StoreInfos[0].StoreUri});
          const receipt=await uploadImagexBytes({context,address:prepared.address,file:ensureSampleImage(path.join(app.getPath('userData'),'assets')),signal:AbortSignal.timeout(60000),report});
          persist('image-upload','bytes-uploaded',receipt);
          const committed=await commitImagexUpload({rows:networkRows,context,prepared,persist,report});
          persist('image-upload','ready',committed);
          if(process.argv.includes('--attach-upload-canvas'))await attachImageToNewCanvas({rows,context,asset:committed,persist,report});
        }
      }finally{fs.closeSync(fd);}
    }
    const finishCanvasFlag=process.argv.find(a=>a.startsWith('--finish-canvas='));
    if(finishCanvasFlag){
      const intentPath=finishCanvasFlag.slice('--finish-canvas='.length);
      const journal=fs.readFileSync(intentPath,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      if(journal.some(r=>r.accountId!==accountId))throw new Error('CANVAS_ACCOUNT_MISMATCH');
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
      const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;const fd=fs.openSync(intentPath,'a');
      try{
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        await finishCanvasReceipt({accountId,rows,journal,context,page:profile.page,report,persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
      }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const retryCanvasFlag=process.argv.find(a=>a.startsWith('--retry-failed-canvas='));
    if(retryCanvasFlag){
      const journalFile=retryCanvasFlag.slice('--retry-failed-canvas='.length);
      const journal=fs.readFileSync(journalFile,'utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
      if(journal.some(r=>r.accountId!==accountId))throw new Error('CANVAS_ACCOUNT_MISMATCH');
      const prepared=journal.find(r=>r.stage==='canvas-discovery'&&r.state==='prepared-request');
      const previous=journal.find(r=>r.stage==='canvas-http'&&r.state==='response');
      if(!prepared?.data?.body||!previous?.data?.raw)throw new Error('CANVAS_PREVIOUS_RECEIPT_MISSING');
      const payload=JSON.parse(prepared.data.body);const prior=inspectDesignReceipt(previous.data.raw,payload.thread_id);
      if(prior.artifactErrors.length!==1||prior.artifactErrors[0]!=='53001057')throw new Error('CANVAS_RETRY_OUTCOME_NOT_RECONCILED');
      const lock=journalFile+'.retry.intent.enc';const fd=fs.openSync(lock,'wx',0o600);
      const persist=(stage,state,data)=>{fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);};
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
      const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);let profile;
      try{
        const networkRows=fs.readFileSync(journalFile+'.network.enc','utf8').trim().split('\n').map(l=>JSON.parse(safeStorage.decryptString(Buffer.from(l,'base64'))));
        const template=networkRows.find(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname==='/lv/v2/intelligence/thread/create');
        if(!template)throw new Error('CANVAS_THREAD_CONTRACT_MISSING');
        const related=networkRows.filter(r=>r.sessionId===template.sessionId&&r.requestId===template.requestId);
        const createBody=template.request.postData??related.find(r=>r.type==='request-body')?.postData;
        const h={};const allowed=new Set(['appid','appvr','device-time','sign','sign-ver','did','tdid','lan','pf','store-country-code','store-country-code-src','user-agent','accept','content-type','referer','origin','cookie']);
        for(const source of [template.request.headers??{},...related.filter(r=>r.type==='request-extra').map(r=>r.headers??{})])for(const[k,v]of Object.entries(source))if(allowed.has(k.toLowerCase()))h[k.toLowerCase()]=v;
        const parsed=JSON.parse(createBody);if(parsed.resource_id!==payload.resource_id||parsed.workspace_id!==payload.workspace_id||parsed.source!==2)throw new Error('CANVAS_THREAD_DEPENDENCY_MISMATCH');
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        persist('canvas-thread','dispatching',{url:template.request.url,body:parsed});
        const create=await context.post(template.request.url,{headers:h,data:createBody,timeout:20000,maxRedirects:0,maxRetries:0});
        let json;try{json=await create.json();persist('canvas-thread','response',json);}finally{await create.dispose();}
        if(String(json.ret)!=='0'||!json.data?.thread_info?.thread_id)throw new Error('CANVAS_THREAD_CREATE_REJECTED');
        payload.thread_id=json.data.thread_info.thread_id;
        payload.contents=payload.contents.map(c=>c.type==='text'?{...c,text:'Change the white circle to bright red. Keep the original background unchanged.'}:c);
        persist('canvas-http','dispatching',{body:payload});
        const result=await sendDesignInBrowser(profile.page,{...prepared.data,body:JSON.stringify(payload)});persist('canvas-http','response',result);
        const receipt=inspectDesignReceipt(result.raw,payload.thread_id);persist('canvas-http','validated-receipt',receipt);
        report({stage:'canvas-retry-http',mechanism:'browser-http',status:result.status,mime:result.mime,accepted:receipt.accepted,runEnded:receipt.ended,artifactErrors:receipt.artifactErrors,artifacts:receipt.artifacts,domClicks:0});
        if(!receipt.accepted)throw new Error('CANVAS_BACKEND_OPERATION_FAILED');
      }finally{try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const imageFlag=process.argv.find(a=>a.startsWith('--inspect-canvas-image='));
    if(imageFlag){
      const networkFile=imageFlag.slice('--inspect-canvas-image='.length);
      if(!path.basename(networkFile).startsWith(accountId+'.enc.'))throw new Error('CANVAS_NETWORK_ACCOUNT_MISMATCH');
      const networkRows=fs.readFileSync(networkFile,'utf8').trim().split('\n').map(line=>JSON.parse(safeStorage.decryptString(Buffer.from(line,'base64'))));
      await inspectCanvasAsset(networkRows,context,report);
    }
    const canvasFlag = process.argv.find(a => a.startsWith('--execute-canvas='));
    if (canvasFlag) {
      const intentPath = canvasFlag.slice('--execute-canvas='.length);
      const journal = fs.readFileSync(intentPath,'utf8').trim().split('\n').map(line=>JSON.parse(safeStorage.decryptString(Buffer.from(line,'base64'))));
      if (journal.some(r=>r.accountId!==accountId)) throw new Error('CANVAS_ACCOUNT_MISMATCH');
      if (journal.some(r=>r.stage==='canvas-http'&&r.state==='dispatching')) throw new Error('CANVAS_ALREADY_DISPATCHED');
      const prepared=journal.find(r=>r.stage==='canvas-discovery'&&r.state==='prepared-request');
      if(!prepared?.data?.body) throw new Error('CANVAS_PREPARED_BODY_MISSING');
      const payload=JSON.parse(prepared.data.body);
      if(payload.source!==2||payload.mode!==2||!payload.contents?.some(c=>c.type==='image')||!payload.thread_id||!payload.workspace_id||!payload.resource_id) throw new Error('CANVAS_OPERATION_CONTRACT_INVALID');
      const credentials=new CredentialRepository(db);const vault=new CredentialVault(safeStorage);const api=new MultiloginProvider(new FetchHttpClient());
      const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);
      let profile; const fd=fs.openSync(intentPath,'a');
      const persist=(stage,state,data)=>{fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);};
      try {
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);
        await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        persist('canvas-http','dispatching',{threadId:payload.thread_id,workspaceId:payload.workspace_id,resourceId:payload.resource_id});
        const result=await sendDesignInBrowser(profile.page,prepared.data);
        persist('canvas-http','response',result);
        const events=result.raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>{try{return JSON.parse(l.slice(5).trim());}catch{return null;}}).filter(Boolean);
        const start=events.find(e=>e.type==='run_start'&&e.thread_id===payload.thread_id&&typeof e.run_id==='string');
        const end=start&&events.find(e=>e.type==='run_end'&&e.run_id===start.run_id);
        const errors=events.filter(e=>/error|fail/i.test(e.type??''));
        report({stage:'canvas-http-result',mechanism:'browser-http',status:result.status,mime:result.mime,events:events.length,runStarted:Boolean(start),runEnded:Boolean(end),errors:errors.length,timedOut:result.timedOut,domClicks:0});
        const evidence=inspectDesignReceipt(result.raw,payload.thread_id);
        persist('canvas-http','validated-receipt',evidence);
        if(!evidence.accepted||!start||errors.length)throw new Error('CANVAS_HTTP_RECEIPT_MISSING');
        persist('canvas-http','accepted',{threadId:payload.thread_id,runId:start.run_id,workspaceId:payload.workspace_id,resourceId:payload.resource_id,runEnded:Boolean(end)});
      } finally {try{if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    if (process.argv.includes('--discover-canvas')) {
      const credentials = new CredentialRepository(db); const vault = new CredentialVault(safeStorage); const api = new MultiloginProvider(new FetchHttpClient());
      const launcher = new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);
      let profile; let capture;
      const discoveryFile=file+'.'+randomUUID()+'.canvas-discovery.enc';
      const fd=fs.openSync(discoveryFile,'wx',0o600);
      try {
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:false,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows);
        capture=await attachPrivateCapture(profile.context,discoveryFile+'.network.enc',text=>safeStorage.encryptString(text));
        capture.mark('canvas-discovery');
        const prepared=await discoverCanvasRequest({page:profile.page,context:profile.context,sampleImage:ensureSampleImage(path.join(app.getPath('userData'),'assets')),report,
          persist(stage,state,data){fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);}});
        if(process.argv.includes('--execute-prepared-canvas')) {
          const persist=(stage,state,data)=>{fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n');fs.fsyncSync(fd);};
          const payload=JSON.parse(prepared.body);
          persist('canvas-http','dispatching',{threadId:payload.thread_id,source:payload.source,mode:payload.mode});
          const result=await sendDesignInBrowser(profile.page,prepared);persist('canvas-http','response',result);
          const events=result.raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>{try{return JSON.parse(l.slice(5).trim());}catch{return null;}}).filter(Boolean);
          const start=events.find(e=>e.type==='run_start'&&e.thread_id===payload.thread_id);
          const end=start&&events.find(e=>e.type==='run_end'&&e.run_id===start.run_id);
          report({stage:'canvas-same-session-http',mechanism:'browser-http',status:result.status,mime:result.mime,events:events.length,runStarted:Boolean(start),runEnded:Boolean(end),mutationDomClicks:0});
          const evidence=inspectDesignReceipt(result.raw,payload.thread_id);
          persist('canvas-http','validated-receipt',evidence);
          if(!evidence.accepted||!start)throw new Error('CANVAS_HTTP_RECEIPT_MISSING');
          persist('canvas-http','accepted',{threadId:payload.thread_id,runId:start.run_id,workspaceId:payload.workspace_id,resourceId:payload.resource_id,runEnded:Boolean(end)});
          const proofs=rows.filter(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/task/v1/do_action'));
          let suffix;
          for(const row of proofs){const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const raw=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;try{const b=JSON.parse(raw);if(typeof b.op_id==='string'&&b.op_id.startsWith('capcut_web_design_studio_canvas_edit_'))suffix=b.op_id.slice('capcut_web_design_studio_canvas_edit'.length);}catch{}}
          if(!suffix)throw new Error('CANVAS_ACK_SUFFIX_MISSING');
          const ackUrl='https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action';
          const ack=await profile.page.evaluate(async ({url,body})=>{const r=await fetch(url,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error'});const j=await r.json();return {status:r.status,ok:r.ok,errNo:j.err_no};},{url:ackUrl,body:{action_key:'capcut_web_design_studio_canvas_edit',op_id:'capcut_web_design_studio_canvas_edit'+suffix}});
          report({stage:'canvas-ack-http',mechanism:'browser-http',status:ack.status,errNo:ack.errNo,domClicks:0});
          if(!ack.ok||ack.errNo!==0)throw new Error('CANVAS_ACK_REJECTED');
          persist('canvas-http','proof',{actionKey:'capcut_web_design_studio_canvas_edit',suffix});
        }
      } finally {try{await capture?.stop();if(profile)await launcher.stop(profile.profileId);}finally{fs.closeSync(fd);}}
    }
    const canvasAckFlag = process.argv.find(a => a.startsWith('--ack-canvas='));
    if (canvasAckFlag) {
      const intentPath = canvasAckFlag.slice('--ack-canvas='.length);
      const journal = fs.readFileSync(intentPath,'utf8').trim().split('\n').map(line=>JSON.parse(safeStorage.decryptString(Buffer.from(line,'base64'))));
      if (journal.some(r=>r.accountId!==accountId)) throw new Error('CANVAS_ACK_ACCOUNT_MISMATCH');
      if (!journal.some(r=>r.stage==='canvas-http'&&r.state==='accepted')) throw new Error('CANVAS_HTTP_RECEIPT_MISSING');
      const prepared=journal.find(r=>r.stage==='canvas-discovery'&&r.state==='prepared-request');
      const capturedResponse=journal.find(r=>r.stage==='canvas-http'&&r.state==='response');
      if(!prepared?.data?.body||!capturedResponse?.data?.raw)throw new Error('CANVAS_HTTP_RECEIPT_MISSING');
      const evidence=inspectDesignReceipt(capturedResponse.data.raw,JSON.parse(prepared.data.body).thread_id);
      report({stage:'canvas-receipt-audit',mechanism:'browser-http',accepted:evidence.accepted,artifactErrors:evidence.artifactErrors,artifacts:evidence.artifacts});
      if(!evidence.accepted)throw new Error('CANVAS_BACKEND_OPERATION_FAILED');
      const proofs=rows.filter(r=>r.request?.method==='POST'&&new URL(r.request.url).pathname.endsWith('/task/v1/do_action'));
      let suffix;
      for(const row of proofs){const rel=rows.filter(r=>r.sessionId===row.sessionId&&r.requestId===row.requestId);const raw=row.request.postData??rel.find(r=>r.type==='request-body')?.postData;try{const b=JSON.parse(raw);if(typeof b.op_id==='string'&&b.op_id.startsWith('capcut_web_design_studio_canvas_edit_'))suffix=b.op_id.slice('capcut_web_design_studio_canvas_edit'.length);}catch{}}
      if(!suffix)throw new Error('CANVAS_ACK_SUFFIX_MISSING');
      const credentials=new CredentialRepository(db); const vault=new CredentialVault(safeStorage); const api=new MultiloginProvider(new FetchHttpClient()); const launcher=new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api); let profile;
      try {
        profile=await launcher.launch({proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)},headless:true,signal:AbortSignal.timeout(45000)});
        await restoreCapturedCookies(profile.context,rows); await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        const ack=await profile.page.evaluate(async body=>{const r=await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/do_action',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error'});const j=await r.json();return {status:r.status,ok:r.ok,errNo:j.err_no};},{action_key:'capcut_web_design_studio_canvas_edit',op_id:'capcut_web_design_studio_canvas_edit'+suffix});
        report({stage:'canvas-ack-http',mechanism:'browser-http',status:ack.status,errNo:ack.errNo,domClicks:0}); if(!ack.ok||ack.errNo!==0)throw new Error('CANVAS_ACK_REJECTED');
        await new Promise(r=>setTimeout(r,1000));
        const latest=await profile.page.evaluate(async()=>{const r=await fetch('https://edit-api-sg.capcut.com/luckycat/i18n/capcut/task/v1/task_list',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({scene:'capcut_web_task'})});return await r.json();});
        const tasks=latest?.data?.task_list??[]; const canvas=tasks.find(t=>t.task_key==='capcut_web_design_studio_canvas_edit'); const parent=tasks.find(t=>t.task_key==='capcut_web_design_studio_picture_creation');
        report({stage:'canvas-task-proof-http',mechanism:'browser-http',canvasStatus:canvas?.task_status,canvasReward:canvas?.task_reward_view?.reward_amount,parentStatus:parent?.task_status,parentReward:parent?.task_reward_view?.reward_amount,done:tasks.filter(t=>t.task_status===4).length,total:tasks.length,domClicks:0});
      } finally { if(profile) await launcher.stop(profile.profileId); }
    }
    if (process.argv.includes('--design-browser-http')) {
      const credentials = new CredentialRepository(db); const vault = new CredentialVault(safeStorage); const api = new MultiloginProvider(new FetchHttpClient());
      const launcher = new ApiV3Launcher(new MultiloginAuthService(credentials,vault,api),api);
      let profile;
      const fd = fs.openSync(file + '.' + randomUUID() + '.design-browser.enc','wx',0o600);
      try {
        profile = await launcher.launch({ proxy:{scheme:lease.protocol,host:lease.host,port:String(lease.port)}, headless:true, signal:AbortSignal.timeout(45000) });
        await restoreCapturedCookies(profile.context,rows);
        await profile.page.goto('https://www.capcut.com/ai-design',{waitUntil:'domcontentloaded',timeout:45000});
        report({ stage:'design-session-ready', mechanism:'browser-http', domClicks:0 });
        await runCapturedDesignChat({ rows, proxy:{server:`${lease.protocol}://${lease.host}:${lease.port}`}, signal:AbortSignal.timeout(60000),report,
          browserSend: wire => sendDesignInBrowser(profile.page,wire),
          persist(stage,state,data) { fs.writeSync(fd,safeStorage.encryptString(JSON.stringify({accountId,at:Date.now(),stage,state,data})).toString('base64')+'\n'); fs.fsyncSync(fd); }
        });
      } finally { try { if(profile) await launcher.stop(profile.profileId); } finally { fs.closeSync(fd); } }
    }
    const ackFlag = process.argv.find(a => a.startsWith('--ack-export='));
    if (ackFlag) {
      const intentPath = ackFlag.slice('--ack-export='.length);
      const intents = fs.readFileSync(intentPath, 'utf8').trim().split('\n').map(line => JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))));
      const fd = fs.openSync(intentPath, 'a');
      let launcher; let profile;
      try {
        let sendAcknowledgement;
        if (process.argv.includes('--browser-http')) {
          const vault = new CredentialVault(safeStorage); const credentials = new CredentialRepository(db);
          const api = new MultiloginProvider(new FetchHttpClient());
          launcher = new ApiV3Launcher(new MultiloginAuthService(credentials, vault, api), api);
          profile = await launcher.launch({ proxy: { scheme: lease.protocol, host: lease.host, port: String(lease.port),
            ...(lease.username ? { username: lease.username } : {}), ...(lease.password ? { password: lease.password } : {}) }, headless: true, signal: AbortSignal.timeout(45000) });
          const cookies = new Map();
          for (const row of rows) for (const entry of row.associatedCookies ?? []) {
            const cookie = entry.cookie;
            if (!cookie || !/(^|\.)capcut\.com$/.test(cookie.domain.replace(/^\./,'')) || (entry.blockedReasons?.length ?? 0) > 0) continue;
            cookies.set(cookie.domain + ':' + cookie.path + ':' + cookie.name, { name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
              expires: cookie.expires > 0 ? cookie.expires : -1, httpOnly: cookie.httpOnly, secure: cookie.secure,
              ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}) });
          }
          if (!cookies.size) throw new Error('ACCOUNT_COOKIES_UNAVAILABLE');
          await profile.context.addCookies([...cookies.values()]);
          await profile.page.goto('https://www.capcut.com/my-edit', { waitUntil: 'domcontentloaded', timeout: 45000 });
          report({ stage: 'ack-browser-bootstrap', mechanism: 'browser-http', domClicks: 0 });
          sendAcknowledgement = async wire => {
            const headers = {};
            for (const [k,v] of Object.entries(wire.headers)) if (!['cookie','user-agent','referer','origin','sign'].includes(k)) headers[k] = v;
            const response = await profile.page.evaluate(async ({ url, body, headers }) => {
              const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body, signal: AbortSignal.timeout(15000), redirect: 'error' });
              const json = await r.json(); return { status: r.status, ok: r.ok, json: { err_no: json.err_no } };
            }, { url: wire.url, body: wire.body, headers });
            report({ stage: 'ack-network-result', mechanism: 'browser-http', status: response.status, errNo: response.json.err_no, domClicks: 0 });
            return response;
          };
        }
        await acknowledgeExport({ accountId, rows, intents, context, signal: AbortSignal.timeout(45000), report,
          sendAcknowledgement,
          persist(stage, state, data) { fs.writeSync(fd, safeStorage.encryptString(JSON.stringify({ accountId, at: Date.now(), stage, state, data })).toString('base64') + '\n'); fs.fsyncSync(fd); }
        });
      } finally { try { if (profile) await launcher.stop(profile.profileId); } finally { fs.closeSync(fd); } }
    }
    const resumeFlag = process.argv.find(a => a.startsWith('--observe-creator='));
    if (resumeFlag) {
      const intentPath = resumeFlag.slice('--observe-creator='.length);
      const intents = fs.readFileSync(intentPath, 'utf8').trim().split('\n').map(line => JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))));
      const accepted = intents.find(r => r.accountId === accountId && r.stage === 'creator-generate' && r.state === 'accepted');
      if (!accepted?.data?.conversationId) throw new Error('CREATOR_RESUME_INTENT_MISSING');
      const fd = fs.openSync(intentPath, 'a');
      try {
        await observeCreatorConversation({ rows, context, signal: AbortSignal.timeout(25000), report, conversationId: accepted.data.conversationId,
          proxy: { server: `${lease.protocol}://${lease.host}:${lease.port}`, username: lease.username || undefined, password: lease.password || undefined },
          persist(stage, state, data) { fs.writeSync(fd, safeStorage.encryptString(JSON.stringify({ accountId, at: Date.now(), stage, state, data })).toString('base64') + '\n'); fs.fsyncSync(fd); }
        });
      } finally { fs.closeSync(fd); }
    }
    const confirmFlag = process.argv.find(a => a.startsWith('--creator-confirm='));
    if (confirmFlag) {
      const intentPath = confirmFlag.slice('--creator-confirm='.length);
      const intents = fs.readFileSync(intentPath, 'utf8').trim().split('\n').map(line => JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))));
      const accepted = intents.find(r => r.accountId === accountId && r.stage === 'creator-generate' && r.state === 'accepted');
      if (intents.some(r => r.accountId !== accountId)) throw new Error('CREATOR_INTENT_ACCOUNT_MISMATCH');
      if (intents.some(r => r.stage === 'creator-confirm' && r.state === 'dispatching')) throw new Error('CREATOR_CONFIRM_ALREADY_DISPATCHED');
      if (!accepted?.data?.conversationId || !accepted?.data?.draftId || !accepted?.data?.roundId) throw new Error('CREATOR_CONFIRM_INTENT_MISSING');
      const fd = fs.openSync(intentPath, 'a');
      try { await confirmCapturedCreator({ rows, context, signal: AbortSignal.timeout(30000), report, conversationId: accepted.data.conversationId, draftId: accepted.data.draftId, roundId: accepted.data.roundId, persist(stage, state, data) { fs.writeSync(fd, safeStorage.encryptString(JSON.stringify({ accountId, at: Date.now(), stage, state, data })).toString('base64') + '\n'); fs.fsyncSync(fd); } }); }
      finally { fs.closeSync(fd); }
    }
    const assetFlag = process.argv.find(a => a.startsWith('--creator-asset='));
    if (assetFlag) {
      await queryAndDownloadCreatorAsset(rows, assetFlag.slice('--creator-asset='.length), context, AbortSignal.timeout(60000), report);
    }
    const generatedExportFlag = process.argv.find(a => a.startsWith('--export-generated='));
    if (generatedExportFlag) {
      const intentPath = generatedExportFlag.slice('--export-generated='.length);
      const intents = fs.readFileSync(intentPath, 'utf8').trim().split('\n').map(line => JSON.parse(safeStorage.decryptString(Buffer.from(line, 'base64'))));
      if (intents.some(r => r.accountId !== accountId)) throw new Error('CREATOR_INTENT_ACCOUNT_MISMATCH');
      const accepted = intents.find(r => r.stage === 'creator-generate' && r.state === 'accepted');
      const confirmed = intents.find(r => r.stage === 'creator-confirm' && r.state === 'response' && String(r.data?.json?.ret) === '0');
      if (!accepted || !confirmed) throw new Error('CREATOR_GENERATION_NOT_CONFIRMED');
      const event = [...intents].reverse().find(r => r.stage === 'creator-poll' && r.data?.round_id === accepted.data.roundId &&
        r.data?.conversation_info?.conversation_id === accepted.data.conversationId &&
        r.data?.author?.role === 'tool' && r.data?.content?.tool_call_name === 'generate_image' && r.data?.content?.content_type === 'media_list');
      const item = event && JSON.parse(event.data.content.data).items?.find(i => i.status === 'succeed' && i.resource_type === 'tos_key' && i.type === 'image');
      if (!item?.resource_id) throw new Error('CREATOR_GENERATED_ASSET_NOT_READY');
      const receipt = await queryAndDownloadCreatorAsset(rows, item.resource_id, context, AbortSignal.timeout(60000), report);
      fs.appendFileSync(intentPath, safeStorage.encryptString(JSON.stringify({ accountId, at: Date.now(), stage: 'creator-export', state: 'downloaded',
        data: { ...receipt, resourceId: item.resource_id, conversationId: accepted.data.conversationId, roundId: accepted.data.roundId } })).toString('base64') + '\n');
    }
    if (process.argv.includes('--creator-export') && body?.err_no === 0 && Array.isArray(list)) {
      const fd = fs.openSync(file + '.' + randomUUID() + '.export.enc', 'wx', 0o600);
      try {
        await exportCapturedCreatorAsset({ rows, context, signal: AbortSignal.timeout(45000), report,
          persist(stage, state, data) { fs.writeSync(fd, safeStorage.encryptString(JSON.stringify({ accountId, at: Date.now(), stage, state, data })).toString('base64') + '\n'); fs.fsyncSync(fd); }
        });
      } finally { fs.closeSync(fd); }
    }
    if (process.argv.includes('--creator-generate') && body?.err_no === 0 && Array.isArray(list)) {
      const fd = fs.openSync(file + '.' + randomUUID() + '.creator-generate.enc', 'wx', 0o600);
      try {
        await runCapturedCreatorGenerate({ rows, context, signal: AbortSignal.timeout(90000), report,
          persist(stage, state, data) { fs.writeSync(fd, safeStorage.encryptString(JSON.stringify({ accountId, at: Date.now(), stage, state, data })).toString('base64') + '\n'); fs.fsyncSync(fd); }
        });
      } finally { fs.closeSync(fd); }
    }
    if (process.argv.includes('--design-chat') && body?.err_no === 0 && Array.isArray(list)) {
      const intentFile = file + '.' + randomUUID() + '.intent.enc';
      const fd = fs.openSync(intentFile, 'wx', 0o600);
      try {
        await runCapturedDesignChat({ rows, proxy: { server: `${lease.protocol}://${lease.host}:${lease.port}`, username: lease.username || undefined, password: lease.password || undefined },
          signal: AbortSignal.timeout(45000), report,
          persist(stage, state, data) { fs.writeSync(fd, safeStorage.encryptString(JSON.stringify({ accountId, at: Date.now(), stage, state, data })).toString('base64') + '\n'); fs.fsyncSync(fd); }
        });
      } finally { fs.closeSync(fd); }
    }
    exitCode = body?.err_no === 0 && Array.isArray(list) ? 0 : 1;
  } catch (error) {
    const message = String(error?.message ?? '');
    let safeMessage = message.split('\n')[0];
    for (const value of [...Object.values(contract.request.headers ?? {}), lease?.host, lease?.username, lease?.password].filter(Boolean).sort((a,b) => b.length-a.length)) safeMessage = safeMessage.split(value).join('<redacted>');
    safeMessage = safeMessage.replace(/https?:\/\/\S+/g, '<url>');
    const code = /^[A-Z_]+$/.test(message) ? message : /Timeout|timeout/.test(message) ? 'TRANSPORT_TIMEOUT' : /ECONN|connect|proxy/i.test(message) ? 'TRANSPORT_CONNECTION_FAILED' : 'HTTP_RUN_FAILED';
    report({ stage: 'failed', code, detail: safeMessage.slice(0, 200), networkCode: message.match(/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|ERR_[A-Z_]+|407|403/)?.[0] });
  } finally {
    if (context) await context.dispose();
    try { if (lease) { await manager.release(lease); report({ stage: 'cleanup', released: true }); } }
    finally { db.close(); fs.writeFileSync(file + '.existing-http.json', JSON.stringify(results, null, 2)); }
  }
}).catch(error => { process.stdout.write(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'HTTP_RUN_SETUP_FAILED' }) + '\n'); }).finally(() => app.exit(exitCode));
