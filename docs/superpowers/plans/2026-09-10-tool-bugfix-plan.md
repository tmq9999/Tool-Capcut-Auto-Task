# ToolCapCut — Implementation Plan cho Antigravity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Đóng B01–B16 từ review mới nhất, giữ do_action và dữ liệu Dashboard đọc/copy được.

**Architecture:** Vá trực tiếp các service/controller/repository đang có; dùng error carrying evidence chỉ cho lỗi mất proof và owner token chỉ cho cleanup. Không redesign credential storage hoặc flow nghiệp vụ.

**Tech Stack:** TypeScript, Vitest, React, Electron, Playwright-core, better-sqlite3 đang cài; không thêm dependency mặc định.

**Spec:** [2026-09-10-tool-bugfix-spec.md](../specs/2026-09-10-tool-bugfix-spec.md)

## Global Constraints

- Giữ do_action → task_list → claim → đối soát, danh sách action, endpoint, op_id, thứ tự, transport và pacing hiện tại.
- API key/password/proxy trên Dashboard phải đọc/copy được; không mask, auto-hide hoặc đổi storage trong đợt bugfix.
- Không thêm product_mission, media-artifact gate, blanket refusal hay flow thay thế.
- Sửa đúng nguyên nhân bằng patch nhỏ và test hồi quy; happy path hiện tại vẫn hoạt động.
- Giữ thay đổi của người dùng; SQL ở repository, renderer không tự mở Node/SQLite.
- Tests dùng dữ liệu giả. Không chạy live, mua mailbox, activate trial, commit/push/deploy khi chưa có quyền riêng.

## Cách chạy

Thay đổi thực hiện khi được giao triển khai. Code trong plan là phương án đặt vào file được nêu, chưa phải code đã chạy. Đọc fixture hiện tại trước ghép snippets; lỗi ABI/missing-tool không tính là RED chức năng. Không dùng kết quả 1.972 test của lượt review làm kết quả sau sửa.

Thứ tự: T0 → T1 → T2/T3 → T4 → T5/T6 → T7 → T8/T9/T10 → T11 → gate cuối. Các task sửa cùng file chạy tuần tự. Mỗi task review/commit riêng; chỉ commit khi được phép, stage đúng hunks, không git add toàn workspace.

## T0 — D00: bảo toàn hiển thị rõ trên Dashboard

**Files đọc/đụng chỉ khi đang cản yêu cầu:** src/renderer/pages/Dashboard/columns.tsx, DashboardPage.tsx, AutomationConfigGrid.tsx, dashboardController.ts; src/shared/schemas/account.schema.ts; src/main/services/AccountService.ts; src/preload/preload.ts.

- [ ] Ghi baseline hành vi xem/copy API key/password/proxy bằng dữ liệu fixture. Đây là acceptance constraint, không phải “lỗ hổng cần khắc phục”.
- [ ] Không thêm task encrypt/mask/reveal/clear-config. Không xóa API key/password khi Save refresh. Existing storage hoạt động thì giữ nguyên.
- [ ] Nếu Dashboard đang chỉ có hasPassword thay vì value, bổ sung value đúng account qua service/main bridge hẹp và hiển thị text/copy; không truy SQLite trực tiếp từ renderer. Không thay mọi màn hình hay cấu trúc database.
- [ ] Regression UI: nhập KEY-DEMO/PASS-DEMO/proxy-demo → save/load → cùng giá trị đọc/copy được. Không lấy credentials thật để chạy fixture.
- [ ] Các task sau đều phải giữ D00; nếu proposed patch làm dấu sao/chuỗi rỗng xuất hiện thay value thì không nhận patch.

## T1 — B01: malformed purchase chỉ dispatch một lần

**Files:** src/main/providers/DongVanFBProvider.ts; tests src/main/providers/__tests__/DongVanFBProvider.test.ts và src/main/services/__tests__/EmailPurchaseService.test.ts.

**Interfaces:** không đổi public API. Provider NETWORK_ERROR hiện được EmailPurchaseService chuyển thành PURCHASE_OUTCOME_UNKNOWN.

- [ ] RED thêm vào EmailPurchaseService.test.ts, sử dụng fixtures credRepo/purchasedRepo/vault/gmail/customDomain/storeKey và imports HttpResponse/DongVanFBProvider đã có:

~~~ts
it('B01 stops malformed success without order_code after one dispatch',async()=>{
  storeKey('dongvanfb','DV-DEMO');
  let calls=0;
  const realProvider=new DongVanFBProvider({
    async send():Promise<HttpResponse>{
      calls++;
      if(calls>1)throw new Error('fixture retry detected');
      return {ok:true,status:200,rawText:'',
        body:{status:true,data:{list_data:[]}}};
    }
  });
  const service=new EmailPurchaseService(credRepo,purchasedRepo,vault,
    {gmail94:gmail,dongvanfb:realProvider,customdomain:customDomain});
  const signal=new AbortController().signal;
  const session=await service.openAcquisitionSession('dongvanfb',1,
    {maxBillablePurchases:1,emailRetryIntervalMs:0},signal);
  await expect(session.acquireOne('w1',signal)).rejects.toMatchObject({
    reason:{code:'PURCHASE_OUTCOME_UNKNOWN'}});
  expect(calls).toBe(1);
  expect(session.purchaseStats()).toEqual({budget:1,attempted:1,confirmed:0,ambiguous:1});
});
~~~

- [ ] Run: node node_modules/vitest/vitest.mjs run src/main/services/__tests__/EmailPurchaseService.test.ts -t B01. RED calls=2 (fixture chặn retry, không treo test).
- [ ] GREEN thay riêng mails.length===0 branch sau successful unwrap:

~~~ts
if (mails.length === 0) {
  throw new ProviderError('NETWORK_ERROR',
    'Kết quả mua không có mailbox hợp lệ; cần đối soát đơn mua.',
    DONGVANFB_SERVICE_NAME);
}
~~~

Không phụ thuộc order_code. Giữ explicit stock response/polling hiện có; không đổi endpoint, quantity hoặc delay. Không thêm lần mua dự phòng.

- [ ] GREEN focused và provider tests; table có/không order_code, missing data, malformed list; explicit stock→success vẫn theo cấu hình.
- [ ] Review budget/calls; proposed commit: fix: stop ambiguous mailbox purchases from retrying.

## T2 — B02: account owned đến hết cleanup

**Files:** src/main/services/AutomationRunService.ts; src/main/services/__tests__/AutomationRunService.test.ts; src/main/services/__tests__/AccountService.test.ts.

**Interfaces:** giữ isAccountActive(accountId):boolean. Thêm private iterationOwners:Map<string,object>, không đổi chức năng Stop/Delete.

- [ ] RED trong AutomationRunService.test.ts với fixtures emailSource/createService/baseConfig/proxySource:

~~~ts
it('B02 keeps account owned during delayed proxy cleanup',async()=>{
  emailSource.available=1;
  const service=createService();
  await service.start(baseConfig({threadCount:1,testDurationMs:600000,mailLimit:1}));
  await service.waitUntilRunning();
  let enter!:()=>void,finish!:()=>void;
  const entered=new Promise<void>(r=>{enter=r;});
  const gate=new Promise<void>(r=>{finish=r;});
  const release=proxySource.release.bind(proxySource);
  proxySource.release=async lease=>{enter();await gate;await release(lease);};
  const stopping=service.stopThread('acc-1');
  try{
    await entered;
    expect(service.isAccountActive('acc-1')).toBe(true);
  }finally{
    finish();await stopping;await service.waitForCompletion();
  }
  expect(service.isAccountActive('acc-1')).toBe(false);
});
~~~

- [ ] Run focused B02; RED false trước finish.
- [ ] GREEN đăng ký ownership trong createThreadRecord cạnh completionPromise:

~~~ts
const token={};
this.iterationOwners.set(accountId,token);
let notifyDone:()=>void=()=>{};
const completionPromise=new Promise<void>(resolve=>{
  notifyDone=()=>{
    if(this.iterationOwners.get(accountId)===token)this.iterationOwners.delete(accountId);
    resolve();
  };
});
~~~

isAccountActive OR iterationOwners/activeThreads/iterationAbort. Start không cho run mới khi iterationOwners chưa rỗng. Không clear token giữa cleanup/stop; notifyDone hiện ở sau cleanup. Failed profile stop vẫn owned qua activeThreads.

- [ ] GREEN whole-run Stop, HTTP-only injected fake và failed-stop cases; existing AccountService.remove test phải reject trực tiếp với active callback. Sau cleanup settled lỗi proxy, account token có thể hết nhưng T3 vẫn giữ proxy owner để cleanup; không giữ account vĩnh viễn vô lý.
- [ ] Review không auto-stop khi Delete; commit: fix: retain account ownership through iteration completion.

## T3 — B03/B04: stale lease và thay manager

**Files:** src/main/services/ProxyLeaseManager.ts; src/main/services/LazyProxyLeaseSource.ts; hai file __tests__ tương ứng.

**Interfaces:** giữ release/configure/acquire/releaseAll. Thêm local ownedLeases:Set<string> và acquisitionsInFlight:number ở lazy wrapper.

- [ ] RED trong ProxyLeaseManager.test.ts, helpers StubProxyApi/createManager/leaseRepo:

~~~ts
it('B03 ignores completed lease when the key has a successor',async()=>{
  const api=new StubProxyApi(['K1']);
  api.setIps('K1',['80.0.0.1','80.0.0.2','80.0.0.3']);
  const manager=createManager(api,{keys:['K1'],acquireTimeoutMs:200});
  const first=await manager.acquire();await manager.release(first);
  const second=await manager.acquire();await manager.release(first);
  expect(api.released).toEqual(['K1']);
  expect(manager.activeLeaseCount()).toBe(1);
  await expect(manager.acquire()).rejects.toMatchObject({code:'CONFIG_ERROR'});
  await manager.release(second);
});
~~~

- [ ] RED lazy wrapper bằng FakeManager:

~~~ts
it('B04 refuses changed config until leases are released',async()=>{
  const built:FakeManager[]=[];
  const source=new LazyProxyLeaseSource({readSimpleKey:()=> 'TOKEN'},options=>{
    const manager=new FakeManager(options.apiToken,options.keys);built.push(manager);return manager;
  });
  source.configure({keys:['K1']});
  const lease=await source.acquire();
  expect(()=>source.configure({keys:['K2']})).toThrow();
  expect(built).toHaveLength(1);
  expect(()=>source.configure({keys:['K1']})).not.toThrow();
  await source.release(lease);
  source.configure({keys:['K2']});await source.acquire();
  expect(built.map(x=>x.keys)).toEqual([['K1'],['K2']]);
});
~~~

- [ ] Run both files, confirm RED extra /out/configure allowed.
- [ ] GREEN after current single-flight lookup:

~~~ts
const owned=this.activeLeases.get(lease.leaseId);
if(!owned)return;
~~~

Remote/local release dùng owned.keyValue/owned.leaseId, không dùng unchecked caller metadata. Local DB failure giữ active; stale release không clear key mới.

Lazy acquire nắm manager local, increment inFlight trước await, add leaseId sau acquire thành công, decrement trong finally. Release xóa tracked ID sau manager release thành công. ReleaseAll clears set/reference chỉ khi underlying success; pending/failure vẫn giữ. Changed configure kiểm owned/inFlight trước gán keys/region; same config no-op. ReleaseAll lúc acquire pending báo ownership pending, không drop late lease.

- [ ] GREEN deferred acquire/release, stale twice, key khác concurrent, DB release throw→retry. Sửa các test “giữa hai phiên” để release trước đổi config.
- [ ] Commit riêng theo B03/B04: fix: preserve proxy lease and manager ownership.

## T4 — B05/B06: recovery mailbox không tạo account sai

**Files:** src/main/services/EmailPurchaseService.ts; src/main/services/__tests__/EmailPurchaseService.test.ts; current AccountMutationRepository read methods. Không thay credential storage.

**Interfaces:** DiagnosticMutationContext.repository require getOwnerByMailbox/getBinding đã có ở concrete repo (không optional fallback giấu lỗi adapter); delivery vẫn ReservedEmail.

- [ ] RED trong EmailPurchaseService.test.ts:

~~~ts
it('B06 refuses a mailbox already bound to another account before delivery',async()=>{
  const ledger=new AccountMutationRepository(db);
  ledger.registerApproval({authorityRef:'auth-r',budgetOwnerRef:'budget-r',
    provider:'dongvanfb',approvedUnits:2});
  const service=new EmailPurchaseService(credRepo,purchasedRepo,vault,
    {gmail94:gmail,dongvanfb:dongvan,customdomain:customDomain},
    {nextId:()=> 'pe-'+ ++idCounter,mutationContext:{repository:ledger,
      authorityRef:'auth-r',budgetOwnerRef:'budget-r'}});
  storeKey('dongvanfb','DV-DEMO');
  dongvan.rows=[[{email:'a@example.test',password:'p',refreshToken:'r',clientId:'c',raw:'fixture'}]];
  const signal=new AbortController().signal;
  const session=await service.openAcquisitionSession('dongvanfb',1,{maxBillablePurchases:1},signal);
  const first=await session.acquireOne('w1',signal,
    {ownerRef:'owner-A',runId:'run-A',stepAttemptId:'attempt-A'});
  session.bindAccount!(first,'account-A');session.release(first);
  await expect(session.acquireOne('w2',signal,
    {ownerRef:'owner-B',runId:'run-B',stepAttemptId:'attempt-B'})).rejects.toMatchObject({
      reason:{code:'PROVIDER_CONFIG_ERROR',details:{accountId:'account-A'}}});
  expect(dongvan.buyCalls).toBe(1);
  expect(ledger.getBinding('owner-A')?.accountId).toBe('account-A');
  expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
});
~~~

Thêm B05 no-key test ngay trong file fixture đó:

~~~ts
it('B05 releases the reservation when reusable OAuth setup fails',async()=>{
  purchasedRepo.insert({id:'mail-reuse',provider:'dongvanfb',email:'reuse@example.test',
    passwordEncrypted:vault.encrypt('PASS-DEMO')});
  const signal=new AbortController().signal;
  const session=await createService().openAcquisitionSession('dongvanfb',1,
    {maxBillablePurchases:0},signal);
  await expect(session.acquireOne('w1',signal)).rejects.toMatchObject({code:'CONFIG_ERROR'});
  expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
  expect(dongvan.buyCalls).toBe(0);
});
~~~

Không storeKey ở case này để tái hiện đúng lỗi cấu hình. Fake getOwnerByMailbox throw, vault.decrypt throw, getSecrets missing và updateReservedOauth false cũng release đúng reservation.

- [ ] Run B05/B06 focused, RED delivery resolves/available0.
- [ ] GREEN cả Gmail và DongVan reusable branches: một try/catch từ owner lookup tới enrichment/CAS/delivery. Catch release reservation hiện tại rồi throw. Không có decrypt/readApiKey ngoài boundary. CAS false:

~~~ts
if(!updated)throw new AutomationTerminalError('failed',{code:'INTERNAL_ERROR'},
  'Quyền sở hữu mailbox đã thay đổi; chưa cấp mailbox cho worker.');
~~~

Fenced reusable: assertNoUnknown trước, getBinding(originalOwner), nếu đã accountId → terminal blocked PROVIDER_CONFIG_ERROR với details.accountId và hướng dẫn kiểm tra account có sẵn. Trả lỗi trước work source tạo account B. Không xóa binding hoặc tự resume/repurchase. Ngoài fenced composition giữ behavior hiện có.

- [ ] GREEN owner chưa bind vẫn reuse, post-await abort, CAS conflict, lookup failure, UNKNOWN persistence. Lưu payload đã mua trước OAuth là bản sửa tốt cần giữ.
- [ ] Commit: fix: release failed mailbox reservations and detect bound recovery.

## T5 — B08/B10/B11: snapshot/current proof

**Files:** src/main/services/capcut/httpTasks.ts; tests src/main/services/capcut/__tests__/httpTasks.test.ts; engine receipt tests.

**Interfaces:** giữ RunTasksResult/TaskSnapshotSummary/TaskOutcome.

- [ ] RED tests đặt trong describe có callbackPage/taskRows hiện hữu:

~~~ts
it('B08 equal timestamp is not fresh and does not clear pending proof',async()=>{
  const {page}=callbackPage({err_no:0},{err_no:0,data:{task_list:taskRows()}});
  vi.spyOn(Date,'now').mockReturnValue(2000);
  const result=await executeHttpTasks({page,signal:new AbortController().signal,
    log:()=>{},actionDelayMs:0,sessionStartedAt:1000});
  expect(result.snapshot).toMatchObject({fresh:false,final:false});
  expect(result.unsettledProofs).toHaveLength(9);
});
it.each([undefined,null,'bad',{}])('B10 malformed list container is invalid: %j',async list=>{
  const {page}=callbackPage({err_no:0},{err_no:0,data:{task_list:list}});
  const r=await executeHttpTasks({page,signal:new AbortController().signal,
    log:()=>{},actionDelayMs:0});
  expect(r.snapshot).toBeNull();
  expect(r.fatalError?.message).toBe('TASK_LIST_RESPONSE_INVALID');
});
it('B11 failed current mutation does not claim old proof as new',async()=>{
  const key=LEAF_TASKS[0];
  const proof={actionKey:key,opId:'old-op',at:1000,errNo:0 as const,errTips:''};
  const {page}=callbackPage({err_no:1},{err_no:0,data:{task_list:taskRows(1)}});
  const r=await executeHttpTasks({page,signal:new AbortController().signal,
    log:()=>{},actionDelayMs:0,unsettledProofs:[{key,proof}]});
  expect(r.outcomes.find(x=>x.key===key)?.proof).toBeUndefined();
  expect(r.unsettledProofs).toContainEqual({key,proof});
});
~~~

- [ ] Run focused IDs; RED equals fresh/malformed list accepted/old proof current.
- [ ] GREEN:

~~~ts
// Trong browser callback, trước normalize rawList:
const hasTaskList=Array.isArray(dataObj.task_list);
const valid=r.ok && numeric && body.err_no===0 && hasTaskList;
// Trong host summary:
const fresh=listRes.valid && observedAt>requiredAfter;
// Cạnh merged proofMemory:
const currentAcceptedProofs=new Map<string,ActionProof & {errNo:0}>();
~~~

Accepted current response cập nhật cả maps; outcomes.proof chỉ lấy currentAcceptedProofs, pending dùng merged memory. Settle từng carried proof chỉ khi observedAt>proof.at và status4; không xóa proof tương lai/stale. Invalid refresh sau claim trả cùng invalid-result path với pending proofs, không rows cũ+timestamp lỗi.

- [ ] GREEN T1 happy trace9actions, parents/preexisting status4 không bắt current proof; claim passes/delay/op_id không đổi.
- [ ] Commit: fix: align task freshness and proof attribution.

## T6 — B09: Stop cắt auxiliary DOM waits

**Files:** src/main/services/capcut/httpTasks.ts; existing HTTP/cancellation tests.

**Interfaces:** dùng boundedDomRead từ ./cancellation; không đổi locator/click/pacing.

- [ ] RED:

~~~ts
it('B09 Stop interrupts an auxiliary visibility read',async()=>{
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{enter=r;});
  const pending=new Promise<boolean>(r=>{release=()=>r(false);});
  const controller=new AbortController(),stop=new Error('STOP');
  const evaluate=vi.fn();
  const locator={first(){return this;},isVisible:()=>{enter();return pending;}};
  const run=executeHttpTasks({page:{locator:()=>locator,evaluate} as unknown as Page,
    signal:controller.signal,log:()=>{},actionDelayMs:0});
  await entered;controller.abort(stop);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const outcome=await Promise.race([
      run.then(()=> 'resolved',error=>error),
      new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('still-pending'),100);})
    ]);
    expect(outcome).toBe(stop);
    expect(evaluate).not.toHaveBeenCalled();
  }finally{
    clearTimeout(timer);release();await run.catch(()=>{});
  }
});
~~~

- [ ] Run B09; RED waiter timeout, không gọi live.
- [ ] GREEN mỗi isVisible/count hiện hữu:

~~~ts
const visible=await boundedDomRead(()=>btn.isVisible(),
  'http-task-popup:visible',1000,signal).catch(error=>{
    signal.throwIfAborted();
    if(isDomReadTimeout(error))throw error;
    return false;
  });
~~~

Dùng deadline phù hợp từng read; import isDomReadTimeout. Không swallow abort/deadline vào “không thấy”. Giữ foreground adapter đã có, không thêm UI mission/jitter. Host timeout chỉ ngừng chờ, không hứa remote rollback.

- [ ] GREEN popup/task-entry/claim count, late resolver không bắt đầu checkpoint/action kế tiếp; happy trace giữ nguyên.
- [ ] Commit: fix: bound auxiliary reads during task cancellation.

## T7 — B07: giữ pending proofs qua engine failure

**Files:** Create src/main/services/capcut/TaskEvidenceError.ts; modify CapcutEngineService.ts, AutomationRunService.ts, runtime/providerStack.ts, repositories/AccountTaskRepository.ts; create database/migrations/009_unsettled_proofs_without_receipt.ts và đăng ký index.ts; tests engine/automationTaskProgress/accountTaskRepository/migrator.

**Interfaces mới nhỏ:**

~~~ts
// TaskEvidenceError.ts
import type {UnsettledTaskProof} from './types';
export class TaskEvidenceError extends Error {
  readonly unsettledProofs:readonly UnsettledTaskProof[];
  constructor(message:string,proofs:readonly UnsettledTaskProof[]){
    super(message);this.name='TaskEvidenceError';
    this.unsettledProofs=proofs.map(x=>({key:x.key,proof:{...x.proof}}));
  }
}
~~~

ICapcutTaskProgressSink thêm recordUnsettled(accountId,runId,proofs):Promise<void>. Repository thêm recordUnsettledProofs(accountId,runId,proofs):void upsert-only. Chỉ sửa luồng error, không thêm request/retry/normal step.

- [ ] RED trong CapcutEngineService.test.ts với runAllTasks/runInput fixtures:

~~~ts
it('B07 carries proofs through an invalid-snapshot failure',async()=>{
  const proofs=[{key:'capcut_web_pwa_install',proof:{
    actionKey:'capcut_web_pwa_install',opId:'accepted-op',errNo:0 as const,
    errTips:'',at:2000}}];
  runAllTasks.mockResolvedValueOnce({outcomes:[],snapshot:null,
    fatalError:new Error('TASK_LIST_RESPONSE_INVALID'),unsettledProofs:proofs});
  const onTaskCheckpoint=vi.fn();
  await expect(new CapcutEngineService({userDataDir:'C:/tmp/fixture'})
    .runAccount(runInput({onTaskCheckpoint}))).rejects.toMatchObject({
      name:'TaskEvidenceError',unsettledProofs:proofs});
  expect(onTaskCheckpoint).not.toHaveBeenCalled();
});
~~~

- [ ] RED repo test record pending với account/run chưa có receipt; assert receipt null và task rows rỗng. Hiện FK receipt cản: không tạo fake receipt để pass.
- [ ] GREEN engine null snapshot throw TaskEvidenceError với runResult proofs. Owner catch chỉ persist khi đúng current thread/session/account, signal chưa abort; sau persist rethrow original để giữ failed outcome. Persistence error dùng TASK_CHECKPOINT_PERSISTENCE_FAILED và cleanup path hiện có, không bypass nhánh xử lý bằng throw quá sớm.

Migration9 tối thiểu, transaction do migrator quản lý:

~~~sql
CREATE TABLE account_unsettled_proofs_next (
 account_id TEXT NOT NULL, run_id TEXT NOT NULL, task_key TEXT NOT NULL,
 op_id TEXT NOT NULL, proved_at TEXT NOT NULL,
 PRIMARY KEY(account_id,run_id,task_key)
);
INSERT INTO account_unsettled_proofs_next
 SELECT account_id,run_id,task_key,op_id,proved_at FROM account_unsettled_proofs;
DROP TABLE account_unsettled_proofs;
ALTER TABLE account_unsettled_proofs_next RENAME TO account_unsettled_proofs;
~~~

Chỉ bỏ FK vào receipt để evidence tồn tại khi không có snapshot; không đổi credential tables, không thêm accounts FK gây mất compatibility orphan fixtures. deleteByAccount thêm DELETE pending explicit. Repository validate key/actionKey,errNo0,opId/time,duplicate before write; upsert newer proof, không xóa keys khác/receipt/status. Normal checkpoint vẫn reconcile pending như hiện tại.

- [ ] GREEN migration8→9 bảo toàn rows, repeat migration, foreign_key_check, pending without receipt, batch invalid rollback, owner stale/Stop/persistence failure, runAccount gọi1 lần/no recycle mới.
- [ ] Commit: fix: persist accepted pending evidence without a valid receipt.

## T8 — B12: page/filter/export counts

**Files:** Accounts/accountsController.ts, AccountsPage.tsx, ExportDialog.tsx; existing controller/repository/export tests.

**Interfaces:** state.page là nguồn duy nhất, thêm globalTotal; load(filter?,page?) giữ signature hiện tại. Không đổi scopes hoặc storage.

- [ ] RED AccountsController tests:

~~~ts
it('B12 late page two never overwrites page three',async()=>{
  const replies:Array<(v:IpcEnvelope<{items:AccountListItemDTO[];total:number}>)=>void>=[];
  bridge.accounts.list=()=>new Promise(resolve=>replies.push(resolve));
  const c=new AccountsController(bridge,50);
  const p2=c.load({},2),p3=c.load({},3);
  replies[1]({success:true,data:{items:[dto({id:'p3'})],total:150}});await p3;
  replies[0]({success:true,data:{items:[dto({id:'p2'})],total:150}});await p2;
  expect(c.getState().accounts[0].id).toBe('p3');
  expect(c.getState().page).toBe(3);
});
~~~

- [ ] GREEN load capture requestedPage/query và ++token; response chỉ áp token hiện tại, page=requestedPage. Clamp theo filteredTotal, out-of-range reload một trang hợp lệ. Catch request rejection và loading=false. Remove page local riêng của page component. Không slice DataGrid lần2.
- [ ] globalTotal lấy riêng list({},pageSize1) khi có filter; total hiện có = filteredTotal. Export props filteredCount=total,totalCount=globalTotal; 0filtered vẫn All. Giữ checked IDs cross-page.
- [ ] GREEN out-of-order/filter changes, delete-last,1201IDs, browser-filter All/Filtered/Checked exact IDs. Default format cũng init lúc dialog mở sau settings load, không reset giữa phiên chọn.
- [ ] Commit: fix: keep account pages and export scopes consistent.

## T9 — B13: load/Clear/live race

**Files:** Logs/logsController.ts; main LogBus.ts/logsIpc.ts; shared schemas/log.schema.ts/contracts/api.ts nếu cần cutoff; tests controller/LogBus/runtimeIpc.

**Phương án gọn:** load token + buffer chỉ các pushes trong request; Clear invalidate old load. Do live emit đi trước DB batch, thêm optional sequence nội bộ main và clearedThrough response Clear để phân biệt post-clear unflushed push; không DB migration, broker hoặc event framework.

**Interfaces:** CanonicalRuntimeLog.streamSequence?:safe integer; logs.clear result {success:boolean,clearedThrough?:number}. Main production có cutoff; legacy no-bus response không cutoff dùng reload, không hứa giữ unordered pushes.

- [ ] RED controller với fixtures bridge/log:

~~~ts
it('B13 ignores history response started before Clear',async()=>{
  let finish!:(v:IpcEnvelope<{items:CanonicalRuntimeLog[];total:number}>)=>void;
  bridge.logs.list=()=>new Promise(r=>{finish=r;});
  const c=new LogsController(bridge);const load=c.load();
  await c.clear();
  finish({success:true,data:{items:[log('old')],total:1}});await load;
  expect(c.getState().logs).toEqual([]);
  expect(c.getState().isLoading).toBe(false);
});
~~~

Test riêng history pending + push new + empty reply giữ new; two filters reversed replies; clear fail giữ old; post-clear push sequence>cutoff được giữ dù chưa ghi DB.

- [ ] GREEN LogBus counter tăng trước mỗi publish, không reset. clear(callback) gọi DB clear, queue=[], return current counter. Registry DTO optional cutoff; no unrelated bridge methods. Counter overflow fail trước publish, không wrap.
- [ ] GREEN controller:
  - Load có local token/filter, bounded pushes buffer. Success thay old history, merge buffer theo id, sort canonical createdAt/id. Không merge toàn state cũ.
  - Clear single-flight invalidate token ngay, buffer pushes. Khi reply success set cutoff, bỏ sequence<=cutoff, giữ >cutoff; later old push cũng bị drop. Set loading=false và error rõ.
  - Clear fail không bỏ displayed/pending pushes, loading=false. Không auto-retry xóa.
  - Filter đổi đang clear: dùng latest filter để giải phóng buffer và load tiếp, không áp response filter cũ.
  - Pause/dispose đúng lifecycle; unpaused-only buffer, stale completion không notify.
- [ ] GREEN producer→schema→IPC→controller tests; FakeBridge.clear phải mô phỏng DB empty đúng. Không dùng timestamp để đoán trước/sau clear.
- [ ] Commit: fix: reconcile live logs with history and clear ordering.

## T10 — B14: Settings save không mất edit mới

**Files:** src/renderer/pages/Settings/settingsController.ts; existing __tests__/settingsController.test.ts. Không đổi cách hiển thị/lưu key/password.

- [ ] RED dùng createMockBridge fixture:

~~~ts
it('B14 preserves edits made while an earlier save is pending',async()=>{
  const {bridge,saveSpy}=createMockBridge();
  let finish!:(v:IpcEnvelope<{success:boolean}>)=>void;
  saveSpy.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const c=new SettingsController(bridge);await c.load();
  const saving=c.save();
  c.updateSettings(s=>({...s,browser:{...s.browser,
    multilogin:{...s.browser.multilogin,port:54321}}}));
  c.setSimpleDraft('gmail94',{action:'replace',value:'KEY-NEW-DEMO'});
  finish({success:true,data:{success:true}});await saving;
  expect(c.getState().settings.browser.multilogin.port).toBe(54321);
  expect(c.getState().drafts.gmail94).toEqual({action:'replace',value:'KEY-NEW-DEMO'});
  expect(c.getState().isSaved).toBe(false);
});
~~~

- [ ] GREEN editRevision tăng khi updateSettings/setSimpleDraft/setMultiloginDraft. Save chụp revision và payload. Refresh chỉ thay settings/drafts khi revision vẫn đúng; nếu user đã edit thì cập nhật statuses cần thiết nhưng giữ edits/isSaved=false. Failure giữ edits. Không dùng reset draft như biện pháp “bảo mật”.
- [ ] Đảm bảo Dashboard hiển thị/copy plain text D00 vẫn đúng trước/sau Save. Test same revision success/isSaved, changed revision/saveagain, failure/load failure.
- [ ] Commit: fix: preserve settings edited during pending save.

## T11 — B15/B16: smoke và script SQL

**Files:** scripts/check-packaged-app.mjs; scripts/__tests__/checkPackagedApp.test.ts; scripts/live-test-capcut-engine.cjs; create scripts/liveCredentials.cjs và test offline scripts/__tests__/liveCredentialsSql.test.ts.

- [ ] RED fake _electron.launch trả metadata sai: firstWindow/renderer IPC không được gọi. Fake close reject phải result failure/throw, không success. Test DEFAULT_EXE bằng productName package thay vì AutoManager.exe. Trong checkPackagedApp.test.ts thêm vi, EventEmitter, _electron imports; dùng fake executable do fixture tạo và luôn dọn chính file đó:

~~~ts
it('B15 refuses wrong application identity before renderer access',async()=>{
  const exe=path.join(os.tmpdir(),'smoke-identity-fixture.exe');
  fs.writeFileSync(exe,'fixture');
  const firstWindow=vi.fn();
  const owned={evaluate:vi.fn().mockResolvedValue({name:'wrong',isPackaged:true,
    userData:path.join(os.tmpdir(),'wrong-profile')}),firstWindow,
    close:vi.fn().mockResolvedValue(undefined)};
  const launch=vi.spyOn(_electron,'launch').mockResolvedValue(owned as never);
  try{
    await expect(runPackagedSmoke({exePath:exe,
      userDataDir:path.join(os.tmpdir(),'smoke-identity-profile')})).rejects.toThrow();
    expect(firstWindow).not.toHaveBeenCalled();
    expect(owned.close).toHaveBeenCalledTimes(1);
  }finally{launch.mockRestore();fs.unlinkSync(exe);}
});
~~~

Chỉ test code dùng fake launcher nên không thực sự chạy file fixture; khi production helper thêm process()/close-event, fake phải triển khai EventEmitter tương ứng. Không biến test mismatch thành chỉ kiểm success=false sau khi đã gọi IPC.
- [ ] GREEN resolve absolute executable từ package productName; expected exe/appPath/userData, isPackaged phải khớp. Lấy metadata từ owned main, mismatch throw trước firstWindow, không chỉ increment fail. Identity evaluate có deadline15s/child-close rejection; windows shell PID không phải Electron main PID.
- [ ] Giữ _electron.launch owned transport, không port scan. Env fixture không VITE_DEV_SERVER_URL/ELECTRON_RUN_AS_NODE; cleanup await owned close thành công rồi mới xóa temp đã xác minh. Nếu cleanup fail → failure và giữ temp, không swallow. Count0 hợp lệ.
- [ ] B16 sửa query theo schema hiện có:

~~~sql
SELECT service_name FROM service_credentials WHERE service_name = ?
~~~

Tách thao tác lưu thành pure helper trong scripts/liveCredentials.cjs (không app startup, không network), rồi live script gọi helper với CredentialRepository hiện có; không import toàn live script vào unit test. Helper nhận repository và payload đã chuẩn bị bởi caller hiện có, không đổi cách storage/UI:

~~~js
function insertMultiloginIfMissing(repo, payload) {
  const existing=repo.getCredential('multilogin');
  if(existing)return false;
  repo.saveCredential('multilogin',payload);
  return true;
}
module.exports={insertMultiloginIfMissing};
~~~

SQL test dùng Node DB in-memory hoặc better-sqlite3 đúng ABI và migration schema hiện tại; import pure helper bằng createRequire, không chạy live:

~~~ts
import {createRequire} from 'node:module';
import Database from 'better-sqlite3';
import {it,expect} from 'vitest';
import {migration001} from '../../src/main/database/migrations/001_initial_schema';
import {CredentialRepository} from '../../src/main/repositories/CredentialRepository';
const {insertMultiloginIfMissing}=createRequire(import.meta.url)('../liveCredentials.cjs');
it('B16 uses existing credential columns and preserves an existing record',()=>{
  const db=new Database(':memory:');
  try{
    db.exec(migration001);
    const repo=new CredentialRepository(db);
    expect(insertMultiloginIfMissing(repo,Buffer.from('payload-A'))).toBe(true);
    expect(insertMultiloginIfMissing(repo,Buffer.from('payload-B'))).toBe(false);
    const row=db.prepare('SELECT encrypted_credentials FROM service_credentials WHERE service_name=?')
      .get('multilogin') as {encrypted_credentials:Buffer};
    expect(row.encrypted_credentials.toString()).toBe('payload-A');
  }finally{db.close();}
});
~~~

Không thêm id/created_at vào schema để làm code cũ chạy; không migration credentials và không ép Dashboard che giá trị. Existing repo giữ SQL đúng schema; live script đã dùng tsx/cjs nên có thể require CredentialRepository.ts như các service hiện có. RED B16 có thể thêm assertion source script không còn SELECT/INSERT dùng cột id/created_at rồi fail trước khi thay caller; test helper xác nhận đúng schema/không overwrite record. Không đưa SQL mới ra khỏi repository.

- [ ] Test SQL bằng schema fixture, không chạy live script vì nó mua mail trước khi tới nhánh credentials. Test smoke missing exe/identity mismatch/closefail không GUI/network; actual artifact smoke sau permission.
- [ ] Commit riêng: fix: validate packaged smoke identity and credential schema.

## Gate cuối

- [ ] Mỗi B-ID có RED/GREEN/AC; mục đã sửa trước khi nhận task có test chứng minh, không patch lại.
- [ ] Happy trace UID→9actions→list→claim/reconcile vẫn nguyên; no product mission/refusal.
- [ ] D00 đọc/copy API key/password/proxy đúng, không mask hoặc auto-clear/config migration.
- [ ] Full Vitest độc lập, typecheck/lint/build/selectors; Electron/UI/package tests theo đúng ABI và permission.
- [ ] Reviewer đọc source/test không chỉ count pass; giữ baseline file hashes, không commit hunks người khác.
- [ ] [Runbook](2026-09-10-tool-bugfix-runbook.md) quy định cách bàn giao và phạm vi live riêng.
