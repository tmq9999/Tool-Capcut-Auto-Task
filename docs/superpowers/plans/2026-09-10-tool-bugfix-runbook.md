# Runbook Antigravity — đóng 8 nhóm lỗi còn lại sau P01–P06

## 1. Đọc đầu vào

AGENTS.md → Superpowers using-superpowers → [Spec](../specs/2026-09-10-tool-bugfix-spec.md) → [Plan V01–V08](2026-09-10-tool-bugfix-plan.md) → runbook này.

Bộ này thay trực tiếp bản P01–P06 cũ. Không áp lại các fix đã đúng: span Close thực,4acks→Stop đúng4proof, system-stop label, expected-close lifecycle và selective settlement canonical.

Baseline source **7ba6d23 + dirty Antigravity**,453JS/TSfiles. Review gần nhất:339tests/9filesPASS, typecheck/lint/buildPASS,95selectorchecksPASS. Đây là baseline, không chứng minh V01–V08 đãfix.

Giữ do_action/task_list/claim, trial gate, endpoint/op_id/order/pacing/restock và plaintext APIkey/password/proxyDashboard. Không product_mission/media/vault/masking hoặc mutationretryflowmới.

## 2. Preflight và quyền

~~~powershell
git status --short
git rev-parse HEAD
git diff --stat
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/main/providers/MultiloginProvider.ts'
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/main/services/AutomationRunService.ts'
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/main/repositories/AccountTaskRepository.ts'
~~~

Đọc currentfunctions/callers/tests trước patch. Nếu source đổi so với review, tái hiện lại; khôngcopy oldwholefile hoặc resetdirtytree. Chỉ apply_patch đúnghunks.

Không sửauserDB/retainedleases, retrofillproof từlog, retryStop/stop-all hoặc killprocess. Không chạy livepurchase/trial/providerwrite/commit/push/deploy ngoài quyềnđượcgiao. Testflagkhôngthayapproval.

Một owner nativeaddon; không rebuild khi app/testprocess khác dùng. Một owner AutomationRunService tronglaneproof và khiV06 đụngruntime.

## 3. Execution order

| Lane | Thứ tự | Gate |
|---|---|---|
| Stop | V01 → V06 | Malformedstatuskhôngconfirm; phase/cause/remote-localstateđúng |
| Proof | V04 → V03 → V02 | Firstcause/priority → ownerwriter → abortfallback |
| Modal | V05 | Readfailure/ambiguitykhôngCSSfirstbypass |
| Repository | V07 | Canonicaltimecompare, no newerproofdelete |
| Integration | V08 | Actualproducer/runtime/SQLite vàexactresources |

V06 runtimehunk triển khai sau V02 hoặc cùngowner; không concurrencyghiđè.

## 4. Task cycle

1. Read specAC và path fixture.
2. Thêm regressionđúngactualboundary.
3. Run RED,ghiassertion; compile/ABI/no-tests-found khôngRED.
4. Minimalpatch giữhealthytrace.
5. Run GREEN vàneighbors.
6. Review source+testoracle; khôngcommitmessage/testcount làm bằngchứng.
7. Ghi status; commitfocused chỉkhi cóquyền.

~~~text
Task:
Baseline hash:
Trigger / root cause:
RED command / exit / assertion:
Patch files:
GREEN command / exit / count:
Acceptance IDs:
Happy flow / proof / cleanup unchanged:
Reviewer:
Remaining gap:
~~~

## 5. Những lỗi không được tái tạo

### V01/V06 — Stop

- Empty `states:{}` hợp lệ khác missing/null/arraystates. Khôngparserfilterbadrow làmprofilebiếnmất.
- Mapkey/profile_idconflict phải reject, khôngđổiidentity rồicoiabsence.
- Observer/log callback throw không được đổi Stopoutcome/cause.
- Remoteconfirmed khác CDPattachmentclosed. Keepbothfacts; conservativeownerretention vẫnnhưcũ.
- Phaseunknown khi fallbackkhôngobserver; khôngbịa token/status từmessage.
- Outerdeadline giữcause/latestphase; latephasekhôngthaylockedoutcome.
- Khôngtăng10s/5s/60s haythêmStopretry/routeautofree.

### V04/V03/V02 — Proof

- Account-terminalfailure priority riêng; prooffailure khôngchiếmslot rồi chặnaccountfailure.
- DBcause giữmain-only, publicmessagefixed.
- iterationOwners token mới làquyền; sessionSequence khôngthay được.
- Missingproduction sink khôngthành saved.
- Cacheexactackversionpromise trướcdispatch; fulfilled/rejected đều giữ. Đây làmemo choiteration, khôngretryqueue.
- Callbacksealedreject; trustedfallback sau runnerthrow vẫn đượcdrain khiiterationownerchưaexpire.
- No !aborted/activeThreads/thread.session gate cho localknownproof persistence.
- Checkpointsettledproofversion không đượcfallbackinsertlại.
- Abortunobservedaction5 không tạo5thproof. No newmutation/navigation/claim sauabort.

### V05/V07/V08

- Modalreaderror khôngabsent;2visibleowners/2Closekhôngfirstfallback.
- TimestampoffsetnormalizebeforeSQL; strictequalnotsettled.
- Testkhôngsửa receipt totals đểgiảmatch; healthy12rows/12receipt/key/session/timekhớp.
- RealSQLite13proof, no Setcheduplicatewrites; exactprofile/leaseids.
- Fakefetch perpage, khôngglobalmutablefetchacrossconcurrentawait.
- Failuretestfinally phảiabort/releasegates/settle trướcDBclose, khônghang.

## 6. Focused commands

Chạy đúngfileđãtạo. NewaccountTaskSettlement.test.ts chỉchạy sauV07. DBtests yêu cầuNodeABI.

~~~powershell
node node_modules/vitest/vitest.mjs run src/main/providers/__tests__/MultiloginProvider.test.ts src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/CapcutEngineService.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/httpTasks.test.ts src/main/services/capcut/__tests__/overlayGuard.test.ts src/main/services/capcut/__tests__/authCancellation.test.ts src/main/services/capcut/__tests__/trial.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/main/repositories/__tests__/accountTaskSettlement.test.ts src/main/repositories/__tests__/repositories.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/lateRunScenario.test.ts src/main/services/__tests__/deterministicHarnessOracle.test.ts --maxWorkers=4
~~~

Mỗicommandriêng/exitrõ. NếuABI/importfail, sửaenvironment rồi chạy lại; khôngbỏtestđểclaimGREEN.

## 7. Full verification và native ABI

Máy review Node24ABI137/Electron35ABI133. Lượtplan khôngrebuild. Khi app/testsownersidle:

~~~powershell
npm run rebuild:node
~~~

NếuđúngEALLOWSCRIPTS inheritedenv trênmáynày, workaroundchildenv:

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const testEnv={...process.env};for(const k of Object.keys(testEnv))if(k.toLowerCase()==='npm_config_allow_scripts')delete testEnv[k];const r=spawnSync(process.execPath,['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','rebuild','better-sqlite3'],{env:testEnv,stdio:'inherit'});process.exit(r.status??1);"
~~~

Không globalpolicyedit. Máykhác resolve npmclipathtrước; sandbox/networkblock xinquyền đúnglệnh.

Finalsourcegates:

~~~powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=4
npm run typecheck
npm run lint
npm run build
npm run selectors
git diff --check
~~~

OldEOF whitespace ởsource/test cóthểdọn đúngtaskhunks, khôngunrelatedrewrite. Không lấyPASScommandcuốicheFAILcommandtrước.

Actualmountedrole/fixture (xinquyềnlaunchẩn nếucần):

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['scripts/check-bugfix-ui.mjs'],{windowsHide:true,timeout:55000,stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??1);"
~~~

Existingcomponentsequences khôngthayproducer/SQLiteintegration. Runnerownedlocalhost/DEMO/profiletạm; closeunconfirmedgiữtemp,báopath; khôngkillbroadnode/electron. Táchboundedbatches thay tăngtimeoutchehang.

RestoreElectron:

~~~powershell
npx --no-install electron-rebuild -f -w better-sqlite3
~~~

Runtimesmokeisolated:

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const e={...process.env};delete e.ELECTRON_RUN_AS_NODE;delete e.NODE_OPTIONS;delete e.VITE_DEV_SERVER_URL;const p=require('node:path').resolve('.debug','antigravity-vfix-'+require('node:crypto').randomUUID());const r=spawnSync(require('electron'),['scripts/run-electron-harness.cjs','--user-data-dir='+p],{env:e,windowsHide:true,timeout:45000,stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??1);"
~~~

Noinstaller/deploy/liveaccount needed. Chỉcleanownedresolvedtemp saucloseconfirmed, khônguserData/workspace broad.

## 8. Live incident scope và điều kiện còn mở

Spec xácđịnh8code/testbugs, khôngchứngminhupstreamvìsao thiếu task_list hoặc phasefailcủaStop08:42. Instrumentationcóthểgiúplầnvalidateđượcduyệt, nhưngkhôngtựchạy lại paidworkflow.

Khôngretrofill4ackcũ nếuthiếuexactproof/op_id/time/authority. Khôngrelease3leasecũ từplan. KhôngđổiDOBpolicy hoặc authflow trongđợtVtasks.

Livevalidationnếucó phải đượcuserduyệtscope/cost/account trước; báo unknowncauses, khôngclaimfixhết từfakes.

## 9. Final handoff

~~~text
HEAD + dirty file hashes:
V01 malformed statuses vs valid empty/stopped:
V02 fallback abort drain / physical writes:
V03 iteration token / missing sink / memo:
V04 first causes / account-terminal precedence:
V05 modal presence/owner/control ambiguity:
V06 phase/remoteConfirmed/local attachment/reporter:
V07 canonical timestamp settlement:
V08 producer/runtime/SQLite13proofs / exactrequests/resources:
RED/GREEN commands/exits:
Fullsuite/typecheck/lint/build/selectors:
Mountedrole/Electronharness/nativeABI:
No flow/plaintext/retry/release changes:
Reviewer:
Unknown live causes / remaining gaps:
~~~

Rollbackchỉhunks/taskcommitkhiđượcquyền; không resetwholeworktree/DB/proofs. Taskchưađạtgiữopen, khôngđổi labelthànhdone.

## Prompt giao Antigravity

~~~text
Đọc AGENTS.md, Superpowers, spec/plan/runbook2026-09-10-tool-bugfix trongdocs/superpowers.
Triển khai V01–V08 trêncurrentdirty7ba6d23; khôngreset vàkhônglàmlạifixđãđúng.
Ưu tiên V01 validstatuses; proof lane V04→V03→V02; V06runtime sau laneproof.
Giữdo_action/task_list/claim,trialgate/endpoints/op_id/order/pacing/restock,
APIkey/password/proxyDashboardplaintext. Khôngproductmission/media/vault/masking.
Malformedstatuskhôngđượcconfirmstop. LocalCDPfailurekhác remoteuncertainty;
reporterthrowkhôngđổicause, outerdeadlinegiữphase, khôngStopretry/autorelease.
Proofwriter dùngactualiterationOwners token, sinkbắtbuộc, memoexactversion
cachesuccess/failuređểfallbacksauabortkhôngmấtproof/ghiđúp/retry.
Account-terminalfailureưu tiênriêng; DBcausemain-only/publicmessagefixed.
Modalreaderror/ambiguitykhôngglobalfirstfallback; timestampcanonicalbeforeSQL.
V08actualexecuteHttpTasks+runtime+SQLite,13pendingrows,valid12rowreceipts,
exactrequests/resources; khôngmanualackarrayhaySetcheduplicatewrite.
MỗitaskRED/minimalpatch/GREEN/review. Khônglivepurchase/trial/providerwrite,
commit/push/deployngoàiquyền; khôngsửauserDB/retainedleases/proofcũ.
Fullgatescùngsource,restoreElectronABIcuối; báotừngVstatus vàunknownlivecauses.
~~~
