# ToolCapCut — Implementation Plan cho Antigravity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Đóng R01–R09 của review mới nhất, giữ nguyên flow do_action và hiển thị rõ dữ liệu Dashboard.

**Architecture:** Hoàn thiện các error/ownership boundaries đang có. Tận dụng TaskEvidenceError, pending-proof repository và log cutoff đã được triển khai; không tạo framework hay migration mới. Các bản sửa cũ đã đạt được giữ nguyên.

**Tech Stack:** TypeScript, Vitest, React/Electron, Playwright-core và better-sqlite3 trong package.json.

**Spec:** [2026-09-10-tool-bugfix-spec.md](../specs/2026-09-10-tool-bugfix-spec.md)

## Global Constraints

- Giữ browser do_action → task_list → claim → đối soát; giữ endpoints, op_id, thứ tự, pacing và retry nghiệp vụ hiện tại.
- Dashboard phải hiển thị/copy được API key, password và proxy; không mask/reveal, auto-hide, xóa cấu hình hoặc redesign storage.
- Không thêm product_mission, media-artifact gate hay blanket refusal.
- Chỉ sửa lỗi có bằng chứng, theo test RED/GREEN; không refactor hoặc mở rộng chức năng không liên quan.
- Giữ changes người dùng và schema đã triển khai; không sửa checksum migrations cũ.
- Tests dùng fixture. Live/purchase/activate trial/commit/push/deploy chỉ khi có quyền riêng.

## Sử dụng kế hoạch

Baseline lúc viết ebf8b0a; kiểm lại HEAD và source khi bắt đầu. Tài liệu không phải code đã được chạy. Các code blocks đặt vào file được chỉ định và dùng fixture hiện hữu đã nêu.

Thứ tự: T1 → T2; T3 và T4 có thể độc lập sau khi owner thống nhất file; T5/T6/T7 độc lập. Không hai agent cùng sửa EmailPurchaseService hoặc cùng controller. Mỗi task có RED/GREEN/review; commit scoped chỉ sau quyền triển khai. Không tạo thêm file đính chính hay áp lại toàn bộ kế hoạch cũ.

## T1 — R01/R02/R03: chung một boundary cho paid mailbox

**Files:** src/main/services/EmailPurchaseService.ts; src/main/services/__tests__/EmailPurchaseService.test.ts.

**Interfaces:** giữ openAcquisitionSession/acquireOne/ReservedEmail/CAS; không thêm schema. Stats.confirmed vẫn được tăng sau response thành công dù persistence thất bại. Observer phải chạy sau persistence.

- [ ] RED tests dưới đây đặt trong file EmailPurchaseService.test.ts có các fixtures db/credRepo/purchasedRepo/vault/gmail/dongvan/customDomain/idCounter/storeKey và import AccountMutationRepository, vi:

~~~ts
it.each(['observer','settlement'] as const)(
  'R01/R03 keeps paid row and releases undelivered reservation on %s failure',
  async point=>{
    storeKey('dongvanfb','DV-DEMO');
    const ledger=new AccountMutationRepository(db);
    ledger.registerApproval({authorityRef:'auth-paid',budgetOwnerRef:'budget-paid',
      provider:'dongvanfb',approvedUnits:2});
    const failure=new Error('fixture-'+point);
    const settle=vi.spyOn(ledger,'settleIntent');
    if(point==='settlement')settle.mockImplementationOnce(()=>{throw failure;});
    dongvan.rows=[[{email:'paid@example.test',password:'PASS-DEMO',
      refreshToken:null,clientId:null,raw:'fixture'}]];
    const service=new EmailPurchaseService(credRepo,purchasedRepo,vault,
      {gmail94:gmail,dongvanfb:dongvan,customdomain:customDomain},{
        nextId:()=> 'pe-'+ ++idCounter,
        mutationContext:{repository:ledger,authorityRef:'auth-paid',budgetOwnerRef:'budget-paid'}
      });
    const signal=new AbortController().signal;
    const session=await service.openAcquisitionSession('dongvanfb',1,{
      maxBillablePurchases:2,
      onPurchaseEvent:event=>{
        if(point==='observer' && event.outcome==='confirmed')throw failure;
      }
    },signal);
    try{
      await expect(session.acquireOne('w1',signal,{
        ownerRef:'owner-paid',runId:'run-paid',stepAttemptId:'attempt-paid'
      })).rejects.toBe(failure);
      expect(purchasedRepo.listRecent(10)).toHaveLength(1);
      expect(purchasedRepo.countAvailable('dongvanfb')).toBe(1);
      expect(dongvan.buyCalls).toBe(1);
      expect(dongvan.oauthCalls).toEqual([]);
      expect(session.purchaseStats()).toMatchObject({attempted:1,confirmed:1});
      expect(ledger.getIntent('auth-paid','purchase:owner-paid:attempt-paid')?.state)
        .toBe(point==='settlement'?'outcome-unknown':'effect-confirmed');
    }finally{settle.mockRestore();}
  }
);
it('R02 never delivers a fresh mailbox after OAuth CAS loses ownership',async()=>{
  storeKey('dongvanfb','DV-DEMO');
  dongvan.rows=[[{email:'cas@example.test',password:'PASS-DEMO',
    refreshToken:null,clientId:null,raw:'fixture'}]];
  let other:ReturnType<PurchasedEmailRepository['reserveOldestAvailable']>=null;
  const oauth=vi.spyOn(dongvan,'getOauth2').mockImplementationOnce(async()=>{
    purchasedRepo.clearStaleReservations(); // isolated test DB only
    other=purchasedRepo.reserveOldestAvailable('dongvanfb','other-owner');
    return {refreshToken:'REFRESH-DEMO',clientId:'CLIENT-DEMO'};
  });
  const signal=new AbortController().signal;
  const session=await createService().openAcquisitionSession('dongvanfb',1,
    {maxBillablePurchases:1},signal);
  try{
    await expect(session.acquireOne('original',signal)).rejects.toMatchObject({
      state:'failed',reason:{code:'INTERNAL_ERROR'}});
    expect(other).not.toBeNull();
    expect(purchasedRepo.countAvailable('dongvanfb')).toBe(0);
    expect(purchasedRepo.consumeReserved(other!.id,'other-owner',null)).toBe(true);
    expect(dongvan.buyCalls).toBe(1);
  }finally{oauth.mockRestore();}
});
~~~

- [ ] Run node node_modules/vitest/vitest.mjs run src/main/services/__tests__/EmailPurchaseService.test.ts -t "R01|R02|R03". RED observer lưu0row, settlement available0, CAS acquisition resolve.
- [ ] GREEN tách counting khỏi observer. Thay mọi call confirmPurchase sau valid response bằng increment không callback; persist rồi thực hiện post-insert work trong một try/catch:

~~~ts
// Successful provider result đã validate:
stats.confirmed += 1;
// Generate id/reservation trước insert để có identity khi phải kiểm lỗi persistence.
let purchasedEmail = this.purchasedRepo.insertReserved(paidInput, reservationId);
try {
  settlePurchase(purchasedEmail.id);
  try {
    emitPurchaseEvent('confirmed');
  } catch (error) {
    poisonPurchaseAccounting();
    throw error;
  }
  // Đặt khối OAuth hiện hữu tại đây, giữ cùng request/payload.
  // Sau updateReservedOauth:
  if (!updated) {
    throw new AutomationTerminalError('failed',{code:'INTERNAL_ERROR'},
      'Quyền sở hữu mailbox đã thay đổi; chưa cấp mailbox cho worker.');
  }
  workerSignal.throwIfAborted();
  return {purchasedEmail,reservationId,
    ...(mutationIdentity?{ownerRef:mutationIdentity.ownerRef}:{})};
} catch (error) {
  try {
    this.purchasedRepo.releaseReservation(purchasedEmail.id,reservationId);
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError],
      'Paid mailbox delivery and reservation cleanup both failed.');
  }
  throw error;
}
~~~

Fragment mô tả vị trí ghép, không thêm biến không khai báo: paidInput là object insert hiện tại giữ nguyên, updated là boolean CAS trong khối OAuth hiện tại; CAS check chỉ nằm trong branch có OAuth. Gmail không có OAuth nhưng phải cùng boundary settlement/observer/delivery. Nếu callback original đã là AutomationTerminalError thì giữ nguyên, không đổi thành generic success.

Không đặt release trước khi biết row/ownership: insertReserved có thể insert rồi DTO-read fail; generate id trước, persistence error giữ failed state và chặn automatic repurchase, xử lý exact row nếu tồn tại, không xóa dữ liệu. Failure release của chính reservation cũng phải được báo, không thả owner khác.

- [ ] GREEN thêm bindMailbox fail riêng (không yêu cầu binding được tạo khi chính bind fail), post-purchase abort, final gate khi đã có OAuth, Gmail observer failure và insert failure confirmed count. Existing reuse/CAS/early-bound-account tests vẫn pass.
- [ ] Test observer+cleanup failure bằng `vi.spyOn(purchasedRepo,'releaseReservation').mockImplementationOnce(()=>{throw cleanupError;})` trong fixture observer ở trên: expect error là AggregateError với errors=[failure,cleanupError], paid row còn1; cleanup success vẫn reject đúng original failure, không AggregateError giả.
- [ ] Review “paid response trước fallible callback” và “no second purchase”; commit nếu được phép: fix: preserve paid mailbox through post-purchase failures.

## T2 — R04: fenced restock retry không trùng intent

**Files:** src/main/services/EmailPurchaseService.ts; src/main/providers/ProviderError.ts; Gmail94Provider.ts/DongVanFBProvider.ts khi đã có fixture raw stock; tests provider và EmailPurchaseService.test.ts.

**Interfaces:** thêm ConfirmedOutOfStockError extends ProviderError để phân biệt no-effect có chứng cứ; không đổi API request. AccountMutationRepository.recordIntent/settleIntent đã có dùng nguyên.

Test import phải thêm `import { ConfirmedOutOfStockError } from '../../providers/ProviderError';`; provider fixture phải chứng minh explicit stock trước dùng marker.

- [ ] RED using createFencedService có2approval units, fixtures gmail/orderFailures:

~~~ts
it('R04 uses a distinct approved intent for confirmed-stock retry',async()=>{
  storeKey('gmail94','GM-DEMO');
  const service=createFencedService();
  const ledger=new AccountMutationRepository(db);
  const recorded=vi.spyOn(AccountMutationRepository.prototype,'recordIntent');
  gmail.orderFailures=[new ConfirmedOutOfStockError('gmail94')];
  const signal=new AbortController().signal;
  const session=await service.openAcquisitionSession('gmail94',1,
    {maxBillablePurchases:1,emailRetryIntervalMs:0},signal);
  try{
    const result=await session.acquireOne('w1',signal,{
      ownerRef:'stock-owner',runId:'stock-run',stepAttemptId:'stock-attempt'});
    const [first,second]=recorded.mock.calls.map(call=>call[0]);
    expect(gmail.createCalls).toHaveLength(2);
    expect(first.stepAttemptId).toBe('stock-attempt');
    expect(second.stepAttemptId).not.toBe(first.stepAttemptId);
    expect(second.operationKey).not.toBe(first.operationKey);
    expect(second.ownerRef).toBe(first.ownerRef);
    expect(ledger.getIntent('auth-test',first.operationKey)?.state).toBe('no-effect-confirmed');
    expect(ledger.getIntent('auth-test',second.operationKey)?.state).toBe('effect-confirmed');
    expect(ledger.getApproval('auth-test')?.consumedUnits).toBe(2);
    expect(session.purchaseStats()).toEqual({budget:1,attempted:1,confirmed:1,ambiguous:0});
    session.release(result);
  }finally{recorded.mockRestore();}
});
~~~

- [ ] Run R04, expect duplicate intent before fix. ConfirmedOutOfStockError new type missing lúc đầu là setup RED; phải thấy behavioral RED sau khi thêm type nhưng chưa sửa loop.
- [ ] GREEN marker code:

~~~ts
export class ConfirmedOutOfStockError extends ProviderError {
  constructor(serviceName:string) {
    super('OUT_OF_STOCK','Provider xác nhận hết hàng, chưa cấp mailbox.',serviceName);
    this.name='ConfirmedOutOfStockError';
  }
}
~~~

Provider chỉ tạo marker từ raw error shape stock đã xác minh bằng fixture. Generic400/429, invalid request/status:false hoặc malformed success không được đánh marker. Đây là bắt buộc để không settle UNKNOWN sai. Đọc fixture hiện có; nếu chỉ có generic “Invalid request” thì chưa đủ để certify provider stock, không invent code/message.

Trong acquireOne dùng dispatchAttemptId: first giữ supplied identity, retry dùng this.nextId() mới (safe ref). recordPurchaseIntent và settlePurchase dùng cùng attempt đang active. Trong catch stock:
- non-fenced: giữ policy hiện có.
- fenced ConfirmedOutOfStockError: settle exact attempt no-effect-confirmed, không hoàn consumedUnits; rollback local attempted theo semantics không-purchase hiện có; wait cấu hình; retry phải qua approval recordIntent mới.
- fenced error không có marker: giữ UNKNOWN, dừng qua ambiguous path, không retry.
- Settlement fail: giữ failure và không dispatch kế tiếp.
- Approval hết: báo exhausted trước dispatch, không duplicate-key generic error.

- [ ] GREEN2units→stock/success;1unit→stock/no second dispatch; UNKNOWN/network/malformed/generic stock không unlock; Stop trong wait; owner/run giữ nguyên. Unit marker pass chưa đồng nghĩa upstream classification có evidence: provider fixture còn thiếu thì ghi riêng unverified và không close R04 toàn phần.
- [ ] Review scope chỉ fenced accounting, normal polling không bị thay. Commit: fix: account for fenced restock attempts explicitly.

## T3 — R05: timeout không làm mất proofs đã accepted

**Files:** src/main/services/capcut/httpTasks.ts; src/main/services/capcut/__tests__/httpTasks.test.ts; src/main/services/__tests__/automationTaskProgress.test.ts.

**Interfaces:** tái sử dụng TaskEvidenceError và recordUnsettled đã có. Không schema/migration hoặc retry mới.

- [ ] RED trong describe executeHttpTasks có callbackPage/taskRows/LEAF_TASKS, thêm TaskEvidenceError import:

~~~ts
it.each(['list','claim-count'] as const)('R05 carries accepted proof on %s timeout',async failure=>{
  vi.useFakeTimers();
  let release!:()=>void,entered!:()=>void;
  const reached=new Promise<void>(resolve=>{entered=resolve;});
  const {page,fetchMock}=callbackPage({err_no:0},{err_no:0,data:{task_list:taskRows(2)}});
  fetchMock.mockImplementation(async(url:string)=>{
    if(url.includes('/account/info/'))return new Response(JSON.stringify({data:{user_id_str:'123456789'}}));
    if(url.includes('/do_action')||url.includes('/grant_reward'))return new Response('{"err_no":0}');
    if(url.includes('/task_list')){
      if(failure==='list'){
        entered();return new Promise<Response>(resolve=>{
          release=()=>resolve(new Response(JSON.stringify({err_no:0,data:{task_list:taskRows()}})));
        });
      }
      return new Response(JSON.stringify({err_no:0,data:{task_list:taskRows(2)}}));
    }
    throw new Error('Unexpected fixture URL');
  });
  if(failure==='claim-count')Object.assign(page,{locator:()=>({
    first:()=>({isVisible:async()=>false}),
    filter:()=>({count:()=>{entered();return new Promise<number>(resolve=>{release=()=>resolve(0);});}})
  })});
  const checkpoint=vi.fn(async()=>{});
  const run=executeHttpTasks({page,signal:new AbortController().signal,
    log:()=>{},actionDelayMs:0,onCheckpoint:checkpoint});
  const settled=run.then(()=>null,error=>error);
  try{
    await reached;await vi.advanceTimersByTimeAsync(failure==='list'?30001:1001);
    const error=await settled;
    expect(error).toBeInstanceOf(TaskEvidenceError);
    expect(error.unsettledProofs.map((x:{key:string})=>x.key)).toEqual([...LEAF_TASKS]);
    expect(fetchMock.mock.calls.filter(([url])=>url.includes('/do_action'))).toHaveLength(9);
    expect(checkpoint).not.toHaveBeenCalled();
  }finally{release?.();await settled;vi.useRealTimers();}
});
~~~

- [ ] Run R05; RED raw OperationDeadlineError/DomReadTimeoutError không proofs.
- [ ] GREEN sau proofMemory init, thêm helper:

~~~ts
async function preserveTaskEvidence<T>(operation:()=>Promise<T>):Promise<T>{
  try{return await operation();}
  catch(error:unknown){
    signal.throwIfAborted();
    if(error instanceof TaskEvidenceError || proofMemory.size===0)throw error;
    throw new TaskEvidenceError(error instanceof Error?error.message:String(error),
      [...proofMemory].map(([key,proof])=>({key,proof})));
  }
}
~~~

Wrap existing task/browser awaits sau map init (action/list/grant/auxiliary DOM) bằng helper. Không wrap input.onCheckpoint/persistence errors. Với DOM read giữ existing catch interruption **bên trong** wrapper:

~~~ts
const claimCount=await preserveTaskEvidence(()=>
  boundedDomRead(()=>claimButtons.count(),'http-task-claim:count',1000,signal)
    .catch(error=>{
      signal.throwIfAborted();
      if(isDomReadTimeout(error))throw error;
      return 0;
    })
);
~~~

Callback/payload/request order giữ nguyên. Không đổi accepted status của request timed-out; chỉ mang proof đã có. Stop propagate original signal reason, không TaskEvidenceError, không thêm recycle.

- [ ] GREEN Stop-after-acceptance, late resolver zero next calls, owner test recordUnsettled once đúng account/run, completed0/failed1, checkpoint0. Pending sink failure vẫn TASK_CHECKPOINT_PERSISTENCE_FAILED path, không ordinary failed rồi lặng.
- [ ] Commit: fix: carry accepted task evidence through thrown read failures.

## T4 — R06: pending upsert chỉ nhận mới hơn

**Files:** src/main/repositories/AccountTaskRepository.ts; src/main/repositories/__tests__/accountTaskRepository.test.ts.

**Interfaces:** giữ recordUnsettledProofs và ISO format hiện tại; không migration mới.

- [ ] RED với db fixture migrated:

~~~ts
it('R06 keeps newer evidence and allows a genuinely newer replacement',()=>{
  const repo=new AccountTaskRepository(db),key='capcut_web_pwa_install';
  const proof=(opId:string,at:number)=>[{key,proof:{actionKey:key,opId,errNo:0 as const,at}}];
  repo.recordUnsettledProofs('a','r',proof('new',2000));
  repo.recordUnsettledProofs('a','r',proof('old',1000));
  repo.recordUnsettledProofs('a','r',proof('equal',2000));
  expect(repo.listUnsettledProofs('a','r')[0]).toMatchObject({opId:'new',provedAt:new Date(2000).toISOString()});
  repo.recordUnsettledProofs('a','r',proof('newest',3000));
  expect(repo.listUnsettledProofs('a','r')[0].opId).toBe('newest');
  expect(repo.getLatestReceipt('a')).toBeNull();
  expect(repo.listByAccount('a')).toEqual([]);
});
~~~

- [ ] Run R06; RED old/equal overwrite.
- [ ] GREEN thêm đúng predicate vào existing conflict clause:

~~~sql
ON CONFLICT(account_id, run_id, task_key) DO UPDATE SET
 op_id = excluded.op_id,
 proved_at = excluded.proved_at
WHERE excluded.proved_at > account_unsettled_proofs.proved_at
~~~

Giữ transaction/validation. Equal giữ record cũ; không clear keys khác. Timestamp phải được normalize hợp lệ trước ghi, không thay bằng string tùy ý.
- [ ] GREEN newer/older/equal, duplicate input rollback, different run/account; existing migration009 tests giữ pass.
- [ ] Commit: fix: retain the newest pending task proof.

## T5 — R07: Clear và load không hủy kết quả nhau

**Files:** src/renderer/pages/Logs/logsController.ts; src/renderer/pages/Logs/__tests__/logsController.test.ts. Main LogBus cutoff/schema đã có, không thay thêm protocol.

**Interfaces:** public load/clear giữ signature. Thêm clearPromise single-flight và clearPushes độc lập pendingPushes của list. Token clear không dùng chung token load.

- [ ] RED với FakeBridge/log fixtures, thêm vi:

~~~ts
it('R07 still applies clear cutoff when load is requested during clear',async()=>{
  let finishClear!:(v:Awaited<ReturnType<ILogsBridge['logs']['clear']>>)=>void;
  bridge.rows=[];
  bridge.logs.clear=()=>new Promise(resolve=>{finishClear=resolve;});
  const c=new LogsController(bridge);c.attach();
  const clearing=c.clear();
  const loading=c.load({level:'ALL'});
  bridge.push(log('pre',{streamSequence:5}));
  bridge.push(log('post',{streamSequence:6}));
  finishClear({success:true,data:{success:true,clearedThrough:5}});
  expect(await clearing).toBe(true);
  await loading;
  bridge.push(log('late-pre',{streamSequence:4}));
  expect(c.getState().logs.map(x=>x.id)).toEqual(['post']);
  expect(c.getState().isLoading).toBe(false);
});
it('R07 failed clear preserves old and intervening live rows',async()=>{
  let finish!:(v:Awaited<ReturnType<ILogsBridge['logs']['clear']>>)=>void;
  const c=new LogsController(bridge);c.attach();await c.load();
  bridge.logs.clear=()=>new Promise(resolve=>{finish=resolve;});
  const clearing=c.clear();bridge.push(log('during',{streamSequence:2}));
  finish({success:false,error:{code:'ERR_PERSISTENCE_FAILED',message:'disk'}});
  expect(await clearing).toBe(false);
  expect(c.getState().logs.map(x=>x.id)).toEqual(['during','log-1']);
  expect(c.getState().isLoading).toBe(false);
});
~~~

- [ ] Run R07; RED clear returnsfalse/cutoff lost hoặc push disappears.
- [ ] GREEN state thiết kế tối thiểu:

~~~ts
private clearPromise:Promise<boolean>|null=null;
private clearPushes:CanonicalRuntimeLog[]=[];
private clearSurvivors:CanonicalRuntimeLog[]=[];
~~~

1. clear start ++loadToken để bỏ preclear replies; capture displayed rows; create clearPromise trước await. Repeated clear trả cùng operation, không xóa twice.
2. load khi clearPromise pending: cập nhật lastQuery và loadToken rồi chờ promise; chỉ request token mới nhất tiếp tục fetch sau clear, không gọi list trong cửa sổ clear chưa settle.
3. Live while clear: bounded clearPushes trước filter; không ghi vào list buffer dùng chung. Pause vẫn bỏ live như hiện tại.
4. clear reply không so với loadToken. Success luôn cập nhật clearedThrough=max(old,new). Keep only clearPushes có seq>cutoff và matching latest query; drop previous history. Late seq<=cutoff vẫn reject.
5. Surviving unflushed pushes được seed vào lần load sau clear; chỉ bỏ seed khi history đã chứa ID hoặc lần clear mới loại nó, buffer capped. Không merge arbitrary previous state.
6. clear failure/rejection restore displayed rows + matching clearPushes, dedupe, loadingfalse/error. Never auto retry deletion.
7. finally clearPromise=null; load đang đợi không deadlock vì clear không gọi public load. Dispose invalidates pending work; no notification sau disposed.
8. Legacy missing cutoff: authoritative reload, không gán sequence giả và không hứa giữ unordered pushes.

Giữ canonical time cho sorting/ID tie nếu buffer cần sắp xếp; không sort HH:mm:ss. Không thêm broker/migration.

- [ ] GREEN duplicate clear oneIPC, filter changes twice during clear, success/failure/rejected promise, late old list/push, paused, unmount. Existing live/history tests giữ pass.
- [ ] Commit: fix: separate log clear lifecycle from pending loads.

## T6 — R08: Dashboard hiện value, Save fail giữ input

**Files:** src/shared/schemas/account.schema.ts, provider.schema.ts; src/main/services/AccountService.ts, EmailPurchaseService.ts; src/renderer/pages/Dashboard/columns.tsx, AutomationConfigGrid.tsx; src/renderer/pages/Settings/settingsController.ts; tests service/contracts/preload/Dashboard rendering/Settings controller.

**Interfaces:** additive passwordCapcut?:string|null trên AccountListItemDTO, apiKey?:string|null trên EmailProviderConfigDTO. Giữ flags/metadata để existing consumers không gãy; Dashboard dùng actual fields, không maskedHint/hasPassword làm value. Storage không thay đổi.

- [ ] RED AccountService.test.ts dùng fixtures service/repo/vault:

~~~ts
it('R08 returns the saved account password for the personal Dashboard',()=>{
  const service=createService();
  service.create({email:'a@example.test',emailProvider:'manual',
    passwordCapcut:'PASS-DEMO',credit:0,status:'active'});
  expect(service.list({page:1,pageSize:50}).items[0].passwordCapcut).toBe('PASS-DEMO');
});
~~~

EmailPurchaseService.test.ts:

~~~ts
it('R08 provides the configured email API key value',()=>{
  storeKey('gmail94','KEY-DEMO');
  expect(createService().getProviderConfigs().find(x=>x.provider==='gmail94')?.apiKey).toBe('KEY-DEMO');
});
~~~

Settings controller test dùng createMockBridge/saveSpy:

~~~ts
it('R08 failed save retains the API key input',async()=>{
  const {bridge,saveSpy}=createMockBridge();
  let finish!:(v:IpcEnvelope<{success:boolean}>)=>void;
  saveSpy.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const c=new SettingsController(bridge);await c.load();
  const draft={action:'replace' as const,value:'KEY-DEMO'};
  c.setSimpleDraft('gmail94',draft);
  const saving=c.save();
  expect(c.getState().drafts.gmail94).toEqual(draft);
  finish({success:false,error:{code:'ERR_PERSISTENCE_FAILED',message:'disk'}});
  expect(await saving).toBe(false);
  expect(c.getState().drafts.gmail94).toEqual(draft);
});
~~~

- [ ] Run focused R08; RED absent value/reset draft.
- [ ] GREEN service mapping, không renderer SQL:

~~~ts
// AccountService.list: lấy đúng page như cũ, rồi một batch records theo IDs.
const result=this.repo.listAccounts(filter);
const records=new Map(this.repo.queryAccountsForExport({
  ids:result.items.map(item=>item.id)
}).map(row=>[row.id,row]));
return {
  total:result.total,
  items:result.items.map(item=>{
    const value=records.get(item.id)?.passwordCapcutEncrypted;
    return {...item,passwordCapcut:value?this.vault.decrypt(value):null};
  })
};
~~~

Empty page tránh query phụ nếu muốn; one batch không N+1. Đây chỉ đọc lại dữ liệu đang có, không đổi encryption/schema DB. Error đọc giá trị hiện rõ, không fallback thành dấu sao.

getProviderConfigs thêm apiKey từ readApiKey(provider) khi configured, null nếu chưa cấu hình; existing readSimpleKey đã đọc đúng stored key. Update strict schemas và fixtures; không expose generic credential dump API. Dashboard columns accessor passwordCapcut render raw text; panel dùng selectedEmailProvider.apiKey. Giá trị hiện text/selectable hoặc readOnly text input, giữ layout; không reveal toggle.

Settings.save không reset drafts trước await. Giữ snapshot draft/revision của save, failure giữ bản hiện tại. Success chỉ mark sent operations keep nếu revision không đổi; new edits giữ nguyên. Dashboard fetch từ backend nên success vẫn hiện key dù draft action đã keep. Validate-failure cũng giữ input để sửa, không clear toàn bộ.

- [ ] GREEN service/contract/preload/render tests và actual Dashboard fixture: KEY-DEMO/PASS-DEMO đọc/copy được sau reload, proxy/custom password cũ giữ đúng; no mask/no auto-hide. Kiểm cột thực bằng renderToStaticMarkup tạo từ createDashboardColumns và panel thật, không chỉ test string trong code.
- [ ] Existing “list never contains password” assertions đổi theo explicit personal-tool requirement; vẫn giữ Node/SQLite ở main. Không tự tháo vault hiện hữu hay migration toàn hệ thống.
- [ ] Commit: fix: display personal Dashboard values and preserve failed-save drafts.

## T7 — R09: quyết định smoke outcome sau cleanup

**Files:** scripts/check-packaged-app.mjs; scripts/__tests__/checkPackagedApp.test.ts.

**Interfaces:** runPackagedSmoke trả {success,failCount} như cũ; validation/launch/close errors vẫn báo thất bại. Không thay owned launch, không thêm process scanner.

- [ ] RED test fake rmSync lỗi sau các kiểm tra pass. Existing test fixture dùng _electron spy, fs/temp paths; không chạy actual exe:

~~~ts
it('R09 temp cleanup failure cannot return success',async()=>{
  const {_electron}=await import('playwright-core');
  const exe=path.join(os.tmpdir(),'smoke-cleanup-fixture.exe');
  const dir=path.join(os.tmpdir(),'smoke-cleanup-fixture-dir');
  fs.writeFileSync(exe,'fixture');
  let evaluations=0;
  const page={waitForFunction:vi.fn().mockResolvedValue(undefined),
    evaluate:vi.fn(async(_fn:unknown,arg?:unknown)=>{
      if(arg!==undefined)return;
      evaluations++;
      if(evaluations===1)return{settings:true,logs:0,accounts:0};
      if(evaluations===2)return{noRequire:true,noProcess:true};
      return{rows:0,loi:[]};
    })};
  const app={evaluate:vi.fn().mockResolvedValue({
    name:'CapCut Automation',isPackaged:true,userData:dir}),
    firstWindow:vi.fn().mockResolvedValue(page),close:vi.fn().mockResolvedValue(undefined)};
  const launch=vi.spyOn(_electron,'launch').mockResolvedValue(app as never);
  const make=vi.spyOn(fs,'mkdtempSync').mockReturnValue(dir);
  const exists=vi.spyOn(fs,'existsSync').mockReturnValue(true);
  const remove=vi.spyOn(fs,'rmSync').mockImplementation(()=>{throw new Error('fixture locked');});
  vi.useFakeTimers();
  try{
    const run=runPackagedSmoke({exePath:exe});
    const result=run.then(value=>value,error=>error);
    await vi.runAllTimersAsync();
    const outcome=await result;
    expect(outcome instanceof Error || outcome.success===false).toBe(true);
  }finally{
    vi.useRealTimers();launch.mockRestore();make.mockRestore();
    exists.mockRestore();remove.mockRestore();fs.unlinkSync(exe);
  }
});
~~~

- [ ] Run R09; RED object successtrue.
- [ ] GREEN bỏ return và “chạy đúng” log trước finally. Capture primaryError, chạy cleanup, nếu temp remove fail tăng fail và ghi error; sau cleanup mới return/result log. Nếu app.close fail throw lỗi, giữ temp như hiện tại. Nếu cả primary và cleanup fail giữ cả hai bằng AggregateError hoặc result errors rõ, không overwrite nguyên nhân.
- [ ] validateSmokeTarget đặt trong phạm vi cleanup temp đã tạo, để invalid exe không leak temp. Chỉ xóa đúng temp do mình tạo, không caller userData. Identity/close tests mới đã pass phải tiếp tục pass.
- [ ] GREEN cleanup success/error, primary+cleanuperror, invalidtarget, launchreject, supplied userData không xóa, emptyDB pass.
- [ ] Commit: fix: include cleanup failures in packaged smoke verdict.

## Gate cuối

- [ ] Chạy focused tests từng T1–T7 rồi full Vitest độc lập; không dùng số PASS baseline làm kết quả mới.
- [ ] Typecheck/lint/build/selectors; Electron harness theo đúng ABI và quyền launch.
- [ ] Happy path do_action/claim/op_id/order/pacing giữ nguyên; R08 text đọc/copy đúng.
- [ ] Không migration mới: migration009 đã có giữ nguyên; R06 SQL change không sửa checksum.
- [ ] Reviewer xác minh R01–R09 theo spec; R04 upstream stock fixture thiếu thì ghi chưa verified phần đó, không claim done.
- [ ] Handoff theo [runbook](2026-09-10-tool-bugfix-runbook.md); không live/purchase/push/deploy ngoài quyền.
