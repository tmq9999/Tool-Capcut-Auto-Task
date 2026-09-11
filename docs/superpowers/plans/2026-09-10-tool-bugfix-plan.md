# ToolCapCut — Remaining P01–P06 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng 8 nhóm lỗi còn lại từ review mới, không thay flow tool.

**Architecture:** Sửa parser xác nhận Stop; gom streamed/fallback proof vào một writer theo iteration; tách hai loại persistence failure. Hoàn thiện modal ownership, stop observation và timestamp normalization tại module hiện có; kiểm chứng bằng actual producer/runtime/repository.

**Tech Stack:** TypeScript strict, Electron35, Playwright, Vitest4, SQLite/better-sqlite3.

**Spec:** [2026-09-10-tool-bugfix-spec.md](../specs/2026-09-10-tool-bugfix-spec.md)

## Global Constraints

- Giữ do_action → task_list → claim/đối soát, trial gate, endpoints, op_id, thứ tự, pacing và normal restock; không thêm product_mission/media gate hoặc mutation retry.
- API key/password/proxy trên Dashboard vẫn hiện plaintext để xem/copy; không masking, reveal toggle, vault hoặc storage redesign.
- Giữ dirty patches đã đúng; không reset source, user DB, account, mailbox, receipt hoặc proof.
- Không tự retry Stop, stop-all, kill process hoặc giải phóng route/profile chưa đủ xác nhận theo owner hiện hành.
- Chỉ patch lỗi đã review; không rewrite subsystem, thêm framework/dependency hay generic IPC.
- Chỉ tạo proof từ ack đã quan sát và kiểm err_no=0; request chưa biết kết quả không được tính proof.
- Mỗi fix cần behavioral RED → minimal patch → GREEN và review; fixture dựng sẵn kết quả không thay runtime/repository evidence.
- Không live purchase/trial/provider mutation, commit/push/deploy ngoài quyền được giao. Tests dùng DEMO và DB/profile tạm.
- Log chỉ chứa phase/code/count an toàn; cause gốc giữ main-only. Quy tắc này không thay plaintext Dashboard.

## Baseline và điều phối

HEAD7ba6d23 + dirty Antigravity,453JS/TSfiles. Không reset về cleanHEAD hoặc áp lại các fix cũ đã đúng. Snippets dưới đây là **kế hoạch chưa triển khai**, không được tính vào testPASS.

| Lane | Thứ tự | Owner |
|---|---|---|
| Stop | V01 → V06 | Provider/launcher; phối hợp runtime sau lane proof |
| Proof | V04 → V03 → V02 | Một owner AutomationRunService/providerStack |
| Modal | V05 | Độc lập overlays/fixture |
| Repository | V07 | Độc lập, một owner native addon |
| Gate | V08 | Sau các lane, reviewer + full verification |

V04/V03/V02 là ba review checkpoint cùng một lane; không merge partial wiring làm callback mất sink. V06 sửa runtime không đồng thời lane proof.

## V01 — Reject malformed statuses, không xác nhận Stop từ dữ liệu thiếu

**Files:** Modify `src/main/providers/MultiloginProvider.ts::getQuickProfileStatuses`; Test `src/main/providers/__tests__/MultiloginProvider.test.ts`, `src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts`.
**Interfaces:** return MultiloginQuickProfileStatus[] giữ nguyên; malformed payload throws fixed ProviderError NETWORK_ERROR. Không thêm endpoint/retry.

- [ ] **1. Add actual provider→launcher regression** trong MultiloginProvider.test.ts; FakeHttpClient là local helper đã có. Import ApiV3Launcher từ ../../services/capcut/launcher/ApiV3Launcher:

~~~ts
it('does not confirm stop from missing states', async () => {
  const http = new FakeHttpClient();
  http.enqueue({ body: { status: { http_code: 200 }, data: {} } });
  http.enqueue({ body: { status: { http_code: 200 }, data: {} } });
  const launcher = new ApiV3Launcher(
    { getAccessToken: async () => 'DEMO' },
    new MultiloginProvider(http)
  );
  await expect(launcher.stop('profile-DEMO')).rejects.toMatchObject({
    diagnostic: { phase: 'confirm-status' }
  });
  expect(http.requests).toHaveLength(2);
});
~~~

Lần đầu là StopACK; lần hai là statuses malformed. Không mock getQuickProfileStatuses trả[].
- [ ] **2. RED:** `node node_modules/vitest/vitest.mjs run src/main/providers/__tests__/MultiloginProvider.test.ts -t "missing states"`. Currentstop resolves.
- [ ] **3. Validate snapshot trước mapping:** states phải object khôngarray; eachrow object; mapkey nonempty; profile_id nếu có stringnonempty khớp key; status nếu có phải stringnonempty, unknownstring không là stopped. Không flatMap bỏ row lỗi. Giữ validstates{} control, port/message fallback và normalpolling.
- [ ] **4. Implement fixed validation failure** tại parser boundary:

~~~ts
const states = asRecord(data.states);
if (!states) {
  throw new ProviderError(
    'NETWORK_ERROR',
    'Multilogin trả về trạng thái profile không hợp lệ.',
    MULTILOGIN_SERVICE_NAME
  );
}
~~~

Dùng cùng failure cho malformedrow/identityconflict; no rawpayload/message. Ownprofilemissing chỉ được suy sau toàn snapshot hợp lệ.
- [ ] **5. Cases:** missing/null/arraystates, ownrownull, otherrowmalformed, mismatchedprofile_id; validempty, validstopped, validrunning, unknownstatus. Runtime route-release test phải dùng actualprovider malformedpath và assert không confirmed/release.
- [ ] **6. GREEN:** provider + launcher suites; review V01.1–V01.5. Commit suggestion `fix: validate profile status snapshots before stop confirmation`.

## V04 — Giữ cause và precedence riêng cho proof persistence

**Files:** AutomationRunService.ts; runtime/providerStack.ts; AutomationRunService.test.ts; automationTaskProgress.test.ts.
**Interfaces:** thêm private proofPersistenceFailure:AutomationTerminalError|null; giữ terminalPersistenceFailure cho account write. Private acceptProofPersistenceFailure(error:unknown):AutomationTerminalError dùng bởi V03/V02.

- [ ] **1. Regression tại nhóm P02 trong AutomationRunService.test.ts**, dùng createStubFactory và constructor/sink/launcher fixture đã có:
  - sink recordUnsettled throws exact dbCause; expect publicmessage cố định và causechain giữ dbCause;
  - callback failure rồi accounts.update terminal throws accountCause; expect final INTERNAL_ERROR/details.failure ACCOUNT_TERMINAL_PERSISTENCE_FAILED;
  - proof failure còn giữ riêng, cleanupdetails không thay rootreason.
  - Commit assertion cụ thể:

~~~ts
expect(summary.terminalReason).toMatchObject({
  code: 'INTERNAL_ERROR',
  details: { failure: 'ACCOUNT_TERMINAL_PERSISTENCE_FAILED', persisted: false }
});
expect(summary.accountsFailed).toBe(1);
expect(summary.accountsCompleted).toBe(0);
expect(summary.message).not.toContain('RAW_DB_DEMO');
~~~

Fixture phải thực sự gọi callback rồi terminalupdate, không set privatefailure field thay behavior.
- [ ] **2. RED:** `node node_modules/vitest/vitest.mjs run src/main/services/__tests__/AutomationRunService.test.ts -t "proof persistence"` sau đặt tên tests tương ứng. Currentsharedslot giữACKreason/cause mất.
- [ ] **3. Create separate firstfailure owner**:

~~~ts
const failure = new AutomationTerminalError(
  'failed',
  {
    code: 'TASK_CHECKPOINT_PERSISTENCE_FAILED',
    details: { failure: 'ACK_PROOF_PERSISTENCE_FAILED' }
  },
  'Không lưu được bằng chứng nhiệm vụ đã được xác nhận.',
  originalCause
);
this.proofPersistenceFailure ??= failure;
~~~

originalCause là Error gốc sau unwrap only known AutomationTerminalError.cause; non-Error wrap fixedmain-onlyerror. Không đọc rawerror.message vào publicmessage.
- [ ] **4. providerStack wrappers:** catch(error), truyềncause trongconstructor; recordUnsettled thiếu repositorymethod throws fixedtypedfailure. Sửa cả record/recordUnsettled để không mất cause khi đi qua wrappers.
- [ ] **5. Normalize priority ở finalization và stop:** accountterminalfailure → prooffailure → existingnormalpolicy. Ghi owner trước observer/cleanup; abort acquisition/peers đúng existingfailure semantics; cleanupvẫn chạy. Không chờ stopconfirmed mới giữ prooffailure, không fakeaccountwrite/replay.
- [ ] **6. GREEN:** runtime/automationTaskProgress; cases proofwritefail+Stop/cleanupfail, firstcause unchanged, newrunreset, repeatedStop, accountDBfailafterACKfail. Review V04.1–V04.6; commit `fix: separate proof and account persistence failures`.

## V03 — Writer chung theo đúng iteration owner

**Depends:** V04.
**Files:** AutomationRunService.ts createThreadRecord/runUiSessionAttempt; runtime/providerStack.ts sink guard; runtime tests.
**Interfaces:** thêm cùng token đã đặt trong iterationOwners và write memo vào ThreadRuntime:

~~~ts
interface IterationProofState {
  readonly ownerToken: object;
  readonly acceptedProofWrites: Map<string, Promise<void>>;
}
~~~

ThreadRuntime extends IterationProofState. Tạo Map mới mỗi thread; không share acrossaccounts/runs.

- [ ] **1. Regression:** trong fixture P02streaming, giữrunnerpending và capturecallback. Replace/delete actual iterationOwners token rồi callcallback →reject/no sinkwrite; sealedinvocation callback →reject; sameowner sau browserclosed/abort →write. Missing production sink→typedfailure, không resolves0write.
- [ ] **2. RED:** runtime testfile, exactassertions sinkcount và callbackrejection; current sessionSequenceguard không phát hiện replacedtoken.
- [ ] **3. Add private persistAcceptedProofs(thread,proofs):Promise<void>**. Kiểm owner map identity trước dispatch; sink bắt buộc. Copy/validate proof identity. Cache Promise trước action:

~~~ts
const key = JSON.stringify([item.key, item.proof.opId, item.proof.at]);
let write = thread.acceptedProofWrites.get(key);
if (!write) {
  const copy = structuredClone(item);
  write = Promise.resolve().then(async () => {
    if (this.iterationOwners.get(thread.accountId) !== thread.ownerToken) {
      throw new Error('STALE_ACK_PROOF_OWNER');
    }
    await sink.recordUnsettled(thread.accountId, thread.runId, [copy]);
  });
  thread.acceptedProofWrites.set(key, write);
}
await write;
~~~

sink trong snippet đã được kiểm có recordUnsettled, typednarrow trước. Dispatcherror đúngowner→V04; staleownererror khôngpromote lên successor. Memo giữ rejectedPromise, không deleteđểretry. No signal/browserliveness gate.
- [ ] **4. Callback:** invocationOpen check rồi writer; finally seal sau runner settle. Ownerseal khác invocationseal. Rejected stale callback không log “bỏ qua” rồi resolve như saved.
- [ ] **5. Memo settlement:** giữ fulfilledversion sau checkpointsettle; register exactproofversions của checkpoint sau transaction thành công, không infer arbitrary version chỉ từ key. Không memo trướccommit hoặc clear map khiến fallbackreinsert.
- [ ] **6. Tests concurrentdoublecallback1write, failonce repeatedcallbackstill1attempt, older/newerackversions, oldsession vs sameiteration, actualtokenreplacement**, notifyDoneafterwrites. Streamedcallback4ack→Stop giữ behaviorđãđạt.
- [ ] **7. GREEN:** runtime/engineforwarding/providerStack tests; review V03.1–V03.8. Commit `fix: bind accepted proof writes to iteration ownership`.

## V02 — Drain proof-bearing cancellation qua writer, không retry

**Depends:** V03.
**Files:** AutomationRunService.ts runThreadWorkload; capcut/httpTasks.ts cancellation wrapper nếu cần giữoriginalabortreason; tests runtime/httpTasks/automationTaskProgress.
**Interfaces:** dùng V03writer, không tạocallback mới hoặc wrapper truyền quyền từrenderer.

- [ ] **1. Add integration in runtime P02 fixture:** fake runner throw TaskEvidenceError(4knownproofs) sau signalaborted nhưng iterationtoken vẫnowned. Assert4recordUnsettled writes trước completion. Không chỉ assert outcome stopped.
- [ ] **2. Add streamed+fallback case:** runner gọi onAcceptedProof4 lần, abort, throwsame4proofs. Expect4physicalwrites—not8. Newowner/retiredownerfallback no write. Checkpointsettled rồithrowsameproof →row khôngreappear.
- [ ] **3. RED:** runtime file `-t "proof-bearing cancellation|deduplicates fallback"` theo tên testđặt; current !aborted/activeThreads gate saves0.
- [ ] **4. Trusted catch minimalshape:**

~~~ts
if (error instanceof TaskEvidenceError) {
  await this.persistAcceptedProofs(thread, error.unsettledProofs);
  throw error;
}
~~~

Đặt trước genericaborted classification; không gọi invocationcallback đãsealed. Proofwritefailure→V04, không wrapvàretry. Writer chỉ nhận trustederror của awaitedowninvocation, không arbitraryevent.
- [ ] **5. Producerboundary:** giữonAcceptedProofawait trướclog/pacing; Stopreason bảo toàn khi streaming đủ4 và fifthrequestpending. Nếu transportwrapper giữTaskEvidenceError đểcarrylegacyproof, runtimefinaloutcome vẫn lấy signal.reason đúnguser/system và evidencealreadydrained. Không invent5thproof/lateraction.
- [ ] **6. Tests realprofileclosedbeforefallback, userStop/systemabort, failurecachedpromise, no receipt/credits invented**, exact4ackkeys/runowner andzero postabortcalls.
- [ ] **7. GREEN:** httpTasks/runtime/automationTaskProgress; review V02.1–V02.6. Commit `fix: drain acknowledged proofs before cancellation finalization`.

## V05 — Modal không bypass readerror hoặc ambiguity

**Files:** overlays.ts::dismissOperationFeatureModal; overlayGuard.test.ts; tools/verify-selectors.ts và existingfeaturefixture.
**Interfaces:** giữ helper signature; readfailurethrow, absent/closedtrue, confirmedstillopenfalse.

- [ ] **1. Initialread regression:** extend featurefixture hiện có:

~~~ts
const failure = new Error('FEATURE_COUNT_FAILED');
featureWrapper.count = vi.fn(async () => { throw failure; });
await expect(dismissOperationFeatureModal(
  page, vi.fn(), createDirectUiInteraction(signal), signal
)).rejects.toBe(failure);
expect(closeClick).not.toHaveBeenCalled();
expect(outsideGotItClick).not.toHaveBeenCalled();
~~~

Addfirstvisibilityerror; currentcatch0/false trảtrue.
- [ ] **2. Owner/control cases:** two visiblecanonicalwrappers vs hidden+visible; oneowner/twoaccessibleClose controls; strictlookupthrows but CSSfirstfallbackvisible. Expectexplicitambiguity và0clicks—not arbitraryfirstclosed.
- [ ] **3. RED:** overlayGuard.test.ts. Mock phải có two distinctowners/controlspies, không tất cả selectorreturn one.
- [ ] **4. Patch:** collect canonicalvisibleowners, countunique; count/readerrorspropagate. Accessiblecontrol querycount/readerror không thànhabsence. Fallback chỉ khi lookupconfirmed0, đúngownedvariant; CSScandidate cũng kiểmvisibleuniqueness, khôngfirstbypass.
- [ ] **5. ActualDOMrole gate:** spanCloseexact1, countTrynow/outsideGotit0click; repeated invocationclosed0action; finalread/abort4000/6000behavior giữ.
- [ ] **6. GREEN:** overlayGuard/authCancellation/trial + selectors; review V05.1–V05.5. Commit `fix: reject ambiguous modal owners and failed reads`.

## V06 — Stop observer, reporter isolation và remote/local state

**Depends:** V01; phối hợp runtime sau V02.
**Files:** launcher/BrowserLauncher.ts, ApiV3Launcher.ts, ProfileStopError.ts, launcher/index.ts; AutomationRunService.ts BrowserSessionRuntime/startProfileStop/stopSessionWhenOwnershipSettles; launcher/runtime tests.
**Interfaces:** StopOptions/ProfileStopObservation theo spec; BrowserLauncher.stop(profileId,options?) additive, Promise<void> khôngđổi. Xcli/fakes mộtargcompatible, phase unknown khi khôngobserver.

- [ ] **1. Reporter regression current apiFixture/cdpFixture/profileId ở launcherLifecycle.test.ts:**

~~~ts
const api = apiFixture();
const cause = new ProviderError('AUTH_ERROR', 'DEMO', 'multilogin', 401);
api.stopProfile.mockRejectedValueOnce(cause);
const launcher = new ApiV3Launcher(
  { getAccessToken: async () => 'DEMO' }, api,
  { log: () => { throw new Error('REPORTER_FIXTURE'); } }
);
await expect(launcher.stop(profileId)).rejects.toMatchObject({
  cause, diagnostic: { phase: 'stop-request', providerCode: 'AUTH_ERROR', httpStatus: 401 }
});
~~~

Separateconfirmed-successloggerthrow phảiresolve, khôngfakeconfirmfailure.
- [ ] **2. CDP/error/phase tests:** actuallauncher.launch with mockedprefs/CDP, stop/statusvalidconfirmed rồi browser.close rejects. Assert diagnostic cdp-close+remoteConfirmedtrue, attachedhandle vẫnowned. Token/CDPpending + runtimefakeclockdeadline → phaseknown/causekept. Nonobserverfallback→unknown.
- [ ] **3. RED:** launcherLifecycle + runtimestop tests; currentreporterwins/cdpfalseuncertainty/outerphaseundefined.
- [ ] **4. Patch guardedreport/phasebeforeawait.** ApiV3 receivesStopOptions; operation tracks latestobservation and observers; coalescedcall nhận lateststate+futurephases withoutduplicatevendorcall. Guard eachobserver và LauncherLog; primarycause tạo trướcreport.
- [ ] **5. Runtime locks:** onPhase closure writesphase/remoteConfirmed onlycurrentstopowner&&!stopOutcomeLocked. OuterwithTimeoutcatch preserve firstcause and latestobservation; unknownallowed. Remoteconfirmed boolmonotonic, no “unconfirmed” rewrite afterlocalfail.
- [ ] **6. Keep conservative behavior:** remoteconfirmed/CDPfailed remains localattachmentcleanupfailurewithpendingowner percurrentpolicy, message distinguishes; không auto-release route or retryremoteStop. Delete attachedhandle onlyafterclose success. Latephases/completionafterlocked cannotrelax outcome.
- [ ] **7. GREEN:** token/request/status/CDP failures, actualprovider V01invalidsnapshot, reporter/observerthrows, coalescingcount1, deadline+latereturn, no sideeffects afterlock. Request10s/confirm5s/runtime60s unchanged.
- [ ] **8. Review V06.1–V06.7**, commit `fix: preserve stop observations without changing cleanup ownership`.

## V07 — Normalize timestamp trước SQL settlement

**Files:** AccountTaskRepository.ts::recordCheckpoint; create `src/main/repositories/__tests__/accountTaskSettlement.test.ts` để isolatedfocusedtests.
**Interfaces:** existingrecordCheckpoint/listUnsettledProofs giữ nguyên; no schema/migration.

- [ ] **1. ActualSQLite regression**, newtestfile importsDatabase/beforeEach/afterEach/runMigrations/AccountTaskRepository:

~~~ts
it('does not delete a proof newer than an offset timestamp', () => {
  const proofAt = Date.parse('2026-09-11T04:00:00.000Z');
  repo.recordUnsettledProofs('a', 'r', [{
    key: 'task-a', proof: { actionKey: 'task-a', opId: 'demo-op', errNo: 0, at: proofAt }
  }]);
  repo.recordCheckpoint('a', {
    rows: [{ key: 'task-a', title: 'A', reward: 10, status: 4 }],
    receipt: {
      runId: 'r', sessionAlias: 's',
      observedAt: '2026-09-11T10:00:00+07:00',
      requiredAfter: '2026-09-11T02:00:00.000Z',
      serverTotal: 1, serverDone: 1, isFresh: true, isFinal: true
    },
    unsettledProofs: []
  });
  expect(repo.listUnsettledProofs('a', 'r')).toHaveLength(1);
});
~~~

Setup db=newDatabase(':memory:'), runMigrations(db), repo; closeafterEach. Đây làactualrepo, không chỉ SQLstringcomparison.
- [ ] **2. RED:** newtestfile sau NodeABIprepared; currenttextpredicate deletesnewerproof. ABI/importfailurekhôngRED.
- [ ] **3. Patch oneparse/canonicalization trướctransaction:**

~~~ts
const observedMs = Date.parse(checkpoint.receipt.observedAt);
const requiredMs = Date.parse(checkpoint.receipt.requiredAfter);
if (!Number.isFinite(observedMs) || !Number.isFinite(requiredMs)) {
  throw new Error('INVALID_CHECKPOINT_TIMESTAMP');
}
const observedIso = new Date(observedMs).toISOString();
const requiredIso = new Date(requiredMs).toISOString();
~~~

Bind observedIso cho deletepredicate/receipt; compare numericobservedMs>requiredMs, item.proof.at<observedMs; no rawoffset SQLlexical.
- [ ] **4. Cases equal/stale/newer, canonicalUTC, invalidtimestamptransactionnochange, omittedkey, otherrun, duplicateUPSERT**, preserveselective settlement no accountwideDELETE.
- [ ] **5. GREEN:** newtest+repository suite+automationTaskProgress; review V07.1–V07.4. Commit `fix: normalize proof settlement timestamps`.

## V08 — Test actual producer/runtime/repository và release gates

**Depends:** V01–V07.
**Files:** lateRunScenario.test.ts; AutomationRunService.test.ts/automationTaskProgress.test.ts; fixture/helpers lâncận nếu cần; selectorsharness.
**Interfaces:** actualproduction callback đãcó, no appchanges chỉđểmakefakepass.

- [ ] **1. Keep existingcascade test như engine-seam test**, đổi description nếu còn gọimanualonAcceptedProof; không coiTrackingSinkarray làdurable. Addproducerintegratedtest separately.
- [ ] **2. Real repository sink setup** trong lateRunScenario.test.ts:

~~~ts
import Database from 'better-sqlite3';
import { runMigrations } from '../../../database/migrator';
import { AccountTaskRepository } from '../../../repositories/AccountTaskRepository';
import { createTaskProgressSink } from '../../../runtime/providerStack';

const db = new Database(':memory:');
runMigrations(db);
const repo = new AccountTaskRepository(db);
const taskProgress = createTaskProgressSink(repo);
~~~

db.close trongfinally sau runner/gates đãsettle. KeepTrackingAccounts forruntimeidentity hoặc actualaccountrepo fixture; taskproofrepo phảiactualSQLite.
- [ ] **3. Healthywave rows exactly12**, reuse canonical12keys từ capturedtaskfixture/toTaskProgressRows tests; settitle/key:string,reward10,total12/credits120; receipt input.runId/sessionAlias đúng, observed>requiredAfter>=sessionstart. Không9LEAFrows/receipt12 hay equaltimestampsfresh.
- [ ] **4. Per-page callback executor mới, khôngglobalfetchrace:** definein test:

~~~ts
function evaluateFor(fetchForPage: typeof fetch) {
  return async (fn: (argument: unknown) => unknown, argument?: unknown) => {
    const context = vm.createContext({
      fetch: fetchForPage, Response, URL, URLSearchParams, Date, JSON, argument
    });
    return vm.runInContext('(' + fn.toString() + ')(argument)', context);
  };
}
~~~

Importvmfromnode:vm. Chỉ executeactualproductionevaluatecallbacks, khôngcaptureduntrustedscript. Eachpage ownfetchtrace, no globalfetch swap acrossawait.
- [ ] **5. Entered gates:** A chạy actual executeHttpTasks tới9acks và missing-list, nhưng fake hydration goto giữ pending cho tới B đã có fourth durable write và C đã entered trial waiter. Sau đó release goto, giữ existing hydration pacing, cho popup read bắt đầu và pending tới watchdog1000ms hiện có. Không “release deadline” như Promise gate và không để timer popup khởi động trước B/C readiness. B có thể có fifth response chưa biết kết quả, không tính proof5. Preserve actual TaskEvidenceError/normal cleanup, không dùng fatalCode recycle thay nhánh.
- [ ] **6. Assertions actual state:** accepted6/completed3/failed1/stopped2; repoA9/B4/C0 exact key/opId;0failed/stopped receipts và3healthy receipts. Second wave có13unique acknowledged versions nên recordUnsettled thực hiện13first writes; fallback lặp thực hiện0write mới. Count này tách khỏi checkpoint transactions của first wave. RequestsA9ack/B4ack; nếuBfifthstarted thì ghi5attempts riêng, no callsafterabort.
- [ ] **7. Resource oracle:** exactretainedprofiles/leasesA/B/C, cleanupFailures3,1stopattempt/profile, exactly2peerstoppedrows/systemmessage, repeatedStopcountunchanged. Finallyabort/releasealltestgates, boundedawaitcompletion, thenDBclose/timerrestore. Companioncleanstop letspeerscontinue andfinalresources0.
- [ ] **8. Fullgates runbook**, recordcounts/exits/hash. No live/purchase/trial, no claimvendorcausefixedfromfakes. Self-reviewACmapping and independentreview beforecommit.
- [ ] **9. Review V08.1–V08.7**, commit `test: verify producer proof persistence and cleanup cascade`.

## Handoff

Đọc runbook cùng spec. Chỉ mark taskfixed sau RED/GREEN/reviewer. Giữ unknownrealupstreamcause riêng; không tự động release profile/proxy của phiên08:39. Rollbackchỉtaskhunks/đúngcommitđượcphép, khôngresetworkspace.
