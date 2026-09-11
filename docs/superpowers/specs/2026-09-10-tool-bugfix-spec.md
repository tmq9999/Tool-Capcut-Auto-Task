# ToolCapCut — Spec đóng phần còn lại sau review P01–P06

## Baseline và phạm vi

Ngày11/09/2026. Source: **7ba6d231e2a876bfa0b51376fb57dc750d5b5e88 + dirty Antigravity**,453JS/TSfiles. Lượt review gần nhất xác nhận8nhóm lỗi còn lại; các task V01–V08 dưới đây map trực tiếp8nhóm đó.

Bộ hiện hành: [Plan](../plans/2026-09-10-tool-bugfix-plan.md), [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md), spec này. Viết lại trực tiếp bộ cũ, không cộng thêm lớp “đính chính”. Báo cáo trước giữ lịch sử; không áp lại toàn P01–P06.

Đã kiểm chứng đúng và phải giữ: span Close của modal thật;4acks→Stop giữ4proof không action5; expected tab-close và system-stop labels; selective same-run proof settlement trên timestamp canonical. **Chưa có full Node/live evidence cho mọi edge.** Baseline review339tests/9files, typecheck/lint/buildPASS, selectors95PASS; không lấy counts này làm nghiệm thu fix mới.

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

## Tóm tắt bằng chứng và mapping

| Task | Lỗi đã tái hiện | Bằng chứng |
|---|---|---|
| V01 | Malformed quick statuses thành “đã stop” | HTTP200 data{} hoặc ownrownull → provider[] → stop resolves |
| V02 | Proof-bearing error sau abort bị bỏ lưu | 4knownproofs, currentthread/session, aborted → saves0/stopped |
| V03 | Owner không đúng và missing sink silent-success | Đổi iterationOwners token vẫn writes1; missing sink resolves/writes0 |
| V04 | Proof error mất cause và chiếm account-terminal priority | Publicmessage chứa raw sinkerror; causeundefined; ACK rồi accountwritefail vẫn ACKreason |
| V05 | Modal readerror/ambiguity bị bypass | Presenceerror→true;2visibleowners đóng1; ambiguousClose→CSSfirstclick |
| V06 | Stop reporting/state thiếu chính xác | Loggerthrow thay cause; CDPclosefail mất remoteconfirmed; outerdeadline mấtphase |
| V07 | Timestamp text comparison sai timezone | observed10:00+07 < proof04:00Z nhưng SQL textdeleteproof |
| V08 | Incidenttest chưa đi hết producer/repo | Manualcallbacks, arraysink, rows9 nhưng receipt12, dedupSet che repeatedwrites |

## V01 — Chỉ snapshot statuses hợp lệ mới chứng minh absence

- V01.1: getQuickProfileStatuses phải yêu cầu envelope/data/states là object hợp lệ khôngarray; missing/null/scalar/arraystates → typed ProviderError, không trả[].
- V01.2: valid states:{} vẫn hợp lệ. Không silent flatMap bỏ malformedrow; snapshot có badrow phải reject trước khi launcher suy ownprofile absent.
- V01.3: map key là profileidentity; field profile_id nếu có phải stringnonempty và khớp map key. Mismatch không được đổi targetid rồi giảabsent. Không épstatusunknownthànhstopped; statusnonempty string nhưng lạ vẫn “chưa confirmed stopped”.
- V01.4: giữ port parsing và message-port fallback đang hỗ trợ, không thay launcherstart flow. Nếu optionalfield malformed ảnh hưởng identity/confirmation thì reject, khônginventdefaultstopped.
- V01.5: test actual FakeHttpClient→MultiloginProvider→ApiV3Launcher, không fakeapi trả[] sẵn. Malformed→reject confirm-status, validempty/stopped→success, validrunning→existingwaitpolicy. Zero route release trên confirmationinvalid.

## V03 — Writer theo iteration token, sink không được optional-success

V03 thực thi sau V04 và trước V02. Thêm state nội bộ vào ThreadRuntime, không schema/IPC:

~~~ts
interface IterationProofState {
  readonly ownerToken: object;
  readonly acceptedProofWrites: Map<string, Promise<void>>;
}
~~~

- V03.1: ownerToken là chính object đã lưu trong iterationOwners khi createThreadRecord. Không dùng sessionSequence thay quyền sở hữu iteration. Capture immutable accountId/runId.
- V03.2: một private persistAcceptedProofs(thread,proofs):Promise<void> dùng chung cho callback/fallback. Kiểm iterationOwners.get(accountId)===ownerToken trước ghi; staleowner reject, không silently resolve và không publish lỗi lên successor run.
- V03.3: missing taskProgress.recordUnsettled ở runtime hoặc missing repo.recordUnsettledProofs ở production composition phải typed persistencefailure; không optionalchain thànhsaved.
- V03.4: callback chỉ mở trong invocation hiện hành; sauseal oldcallback reject, kể cả iteration còn sống vì recycle. Writer fallback nội bộ được phép sau invocationseal nhưng trước iteration release, vì nó được gọi từ trusted catch của invocation đãawait.
- V03.5: versionidentity=JSON.stringify([key,opId,at]); tạo và giữ writepromise trước dispatch bằng microtask. Cache cả success lẫn failure; repeatedversion không ghi lại/retry khi fallback. Map chỉ tồn tại một accountiteration, không backgroundqueue/framework.
- V03.6: không gate localpersistence bằng AbortSignal/browserliveness/activeThreads/current session. Sau abort, knownproof vẫn được ghi nếu owner hợp lệ. Ownerrelease/notifyDone chỉ sau awaited writes.
- V03.7: register exact identities được checkpointcommit thành công vào memo để fallback không reinsert settledproof. Không mark trước transaction success, không memoclaim acknowledgedversion khác.
- V03.8: tests retired/replacedowner, sealedinvocation, missingsink, concurrentduplicate, rejectedpromise reused, browserclosedwhileowneractive; no false “saved”.

## V02 — Fallback drain sau cancellation không mất proof

- V02.1: TaskEvidenceError từ awaited session chứa knownproofs phải qua V03writer trước generic aborted→stopped; bỏ browserliveness/!aborted gates nhưng **giữ iteration owner fence**.
- V02.2: không dùng callback đãsealed đểdrain. Dùng internal writer được authorizedbởi threadowner; old-session arbitrary callback bị reject ở V03.
- V02.3: producer streaming4proof + fallbacksame4 → tổng4physicalwrites, không8. Legacyrunner khôngstream + fallback4 sauabort →4writes trướcterminal/notifyDone.
- V02.4: checkpoint đãsettle version rồi fallback lặp → không reinsert. Failedwrite version lặp → cùng failure, không retry.
- V02.5: proof-persistence error đi V04 trước aborted classification; không bọc thành TaskEvidenceError rồi thửghi lần nữa. Original stopreason vẫn phân biệt user/system; không giả extra taskfailure hoặc mutationretry.
- V02.6: cancel khi action5pending sau4acks không tínhproof5, late response không checkpoint/navigation/claim. Preserve hiện case4ack→Stop noaction5.

## V04 — Cause và ưu tiên persistence tách biệt

- V04.1: terminalPersistenceFailure giữ riêng account-terminal DB write; thêm proofPersistenceFailure riêng. Cảhai reset chỉ khi accepted newrun, không reset khi concurrentStartbịreject.
- V04.2: helper acceptProofPersistenceFailure(error):AutomationTerminalError giữ firstprooferror; fixedpublicmessage “Không lưu được bằng chứng nhiệm vụ đã được xác nhận.”; reason TASK_CHECKPOINT_PERSISTENCE_FAILED/details.failure ACK_PROOF_PERSISTENCE_FAILED.
- V04.3: createTaskProgressSink record/recordUnsettled catch(error) truyền originalError vào cause; runtime không biến originalDBcause thành textwrapper. Non-Error cause wrapmain-only fixedError. No raw cause text/public keypayload.
- V04.4: finalization/Stop ưu tiên account-terminalfailure → prooffailure → ordinaryterminalpolicy hiện có. Giữ secondaryproofcause main-only khiaccountfailurewins; cleanupdetailsappend, không thay reasonroot.
- V04.5: authorityprooffailure đặt trước observer/cleanup/abortclassification, không đợi stopProfile thành công mớinhậnfailure. Cleanup vẫnchạy; firstaccount/proofcauseskhông ghi đè.
- V04.6: tests ACKDBfailure + user/systemabort + cleanupfail; ACKfail rồi accountupdatefail; logger/observerthrow. Countersoneoutcome/account, khôngfakesuccess/doublewrite/retry.

## V05 — Modal fail-closed khi read/owner/control mơ hồ

- V05.1: initial count/visibility ordinaryerror phải reject, khôngconvert0/false→absent. Typedtimeout/abort giữexactreason. Finalread đãsửa phảigiữ.
- V05.2: canonical owner parent/child mộtmodal, collect visibleowners trước action. Two visibleowners → explicitambiguity trướcclick; hidden+visible → visibleđúng.
- V05.3: accessibleClose count/readerror/strictambiguity không cho phép CSSfallback.first bypass. Fallback chỉ dùng khi confirmedabsence và exactownedvariantđược chứngminh.
- V05.4: require unambiguous visiblecontrol, no arbitraryfirst. SpanClose, outsideGotit vàTrynow behaviorsđãđạt giữnguyên.
- V05.5: Browser4000/host6000 budget và maxattempt/pacing không đổi. TestactualDOM role + separateclickcounters, repeatedinvocationafterclosed0action/dump.

## V06 — Stop state/phase quan sát được, reporter không đổi outcome

Additive internal contracts tại launcher/ProfileStopError.ts và BrowserLauncher.ts:

~~~ts
export interface ProfileStopObservation {
  phase: 'token' | 'stop-request' | 'confirm-status' | 'cdp-close';
  remoteConfirmed: boolean;
}
export interface StopOptions {
  onPhase?: (observation: ProfileStopObservation) => void;
}
// BrowserLauncher method:
// stop(profileId: string, options?: StopOptions): Promise<void>;
~~~

- V06.1: ApiV3 emit observation trước mỗi awaitedphase; remoteConfirmed chỉtrue sau validconfirmation củaV01. Optionscallback/LauncherLog đều guarded; reporterthrow không đổi originalerror hoặc turnconfirmed-success thànhfailure.
- V06.2: session giữ latestphase và remoteConfirmedmonotonic; runtime outerdeadline lưu deadlinecause và phaseknownhoặcunknown, không đoán. Fallback browserruntime khôngcóobserver thìunknown.
- V06.3: ProfileStopDiagnostic.phase cho phép unknown ở runtime wrapper, thêm optional remoteConfirmed; reporter không được serializecause. Phasecallback làread-only observation, không quyền stop/release.
- V06.4: remoteconfirmed + CDPclosefailed → ghi remoteconfirmed/localattachmentfailed; giữ attachedhandle cho failedlocalcleanup, không deletebeforeawaitsuccess. Giữ conservativeowner/routesretention và no-autoretry hiện có; không tự release vì mới cóboolean.
- V06.5: latecompletion/phase sau stopOutcomeLocked không đổi finalverdict/tựrelease. CoalescedStop vẫn1vendorcall; callerobserveoperationshared nhậnlatestphase mà khôngstartoperationmới.
- V06.6: không đổi request10s/confirmation5s/runtime60s hoặc thêmretry. Token/CDPpending được outerdeadlinebound; usefakeclock tests để khôngwaitthật.
- V06.7: tests loggerthrow request-error/confirm-error/success, observerthrow, tokenhang, CDPhang, cdpcloseerrorafterremoteconfirmed, lockedlatecompletion, unknownfallback.

## V07 — So sánh thời gian bằng cùng biểu diễn canonical

- V07.1: parse observedAt/requiredAfter once, requirefinite vàfresh theoinstant, normalize toISOString trước mọi SQLtextcomparison. Store receipt timestamps canonical nếu accepted.
- V07.2: strict proof.at < observedAt giữnguyên; equal khôngsettle. NoncanonicalvalidISOoffset khôngđượcxóa proofnewer vì lexicalordering.
- V07.3: preserve existing selective settlement: same-run/coveredstatus4 only; omitted/newer/other-run retained; no accountwideDELETE quaylại; upsertnewer-only.
- V07.4: actualrepo isolatedDB tests timezoneoffset, UTCcanonical, equal, invalidtime rollback, omitA/staleA/otherRun; no migration/DBreset.

## V08 — Producer/runtime/repository integration thật

- V08.1: existing sixaccounttest phải ghi đúngscope engine-seam nếu cònmanualcallbacks. Newintegration chạy actual executeHttpTasks cho A/B và realAccountTaskRepository sink; no globalfetchrace giữaworkers.
- V08.2: healthy firstwave:12canonicalrows, receipt totals/sessionalias/runid/timestampskhớp;120creditsfixture nếu12×10, không9rows/receipt12.
- V08.3: A9acks→missinglist→hydrationpopupdeadline→normalcleanupfail; B4observedacks trướcabort; Ctrialwait. Pendingaction5 nếu đãdispatch phải được ghi riêng attempts5/acks4, không tínhproof5; no requests sauabort. Case abortduringpacing còn4attempts làregressionriêng.
- V08.4: SQLite rows A9/B4/C0, exactkey/op_id/runownership,0receiptsfailed/stopped,3validreceiptsfirstwave. Countphysicalwrites vàversions, khôngSetcheduplicates/retries.
- V08.5: observedruntime accepted6/completed3/failed1/stopped2, cleanupFailures3,exactretainedprofile/leaseIDs, exactly1stopattempt/profile,2peerstoppedupdates cósystemreason; subsequentStopkhôngretry/release.
- V08.6: cleanupfailedassertion không treotests: namedabortcontrollers/allgatesfinally/boundedsettlement, closerepoafterpromisessettle. No newlivecalls.
- V08.7: final Node/typecheck/lint/build/selectors/roleDOM/Electronharness cùngsource; oneABIowner vàrestoreElectron. Reviewbaseline339/95 không chứngminhnewfixes.

## Không nằm trong đợt fix này

Chưa biết upstream vì sao task_list thiếuarray và chính xácstoprequest/statuscause của incidentthật; diagnosticfixed không đồng nghĩa vendorissuefixed. Không runlive/purchaseđểlấpchỗtrốngnếuchưađược quyền. Backlogauth/DOB/UI khác giữtrongreports, không tựtuyênbốclosed.

## Definition of done

V01–V08 đều có evidence RED/GREEN, no regression cácpatchđúng; owner/settlement/stopstate tests đúngsameinstance+actualrepository. Bàn giao từngtaskstatus/causeunknown vàsourcehash. Lượt viếtplan này chỉsửatài liệu.

## Snapshot kiểm tra trước triển khai

453source/script/test hashes không đổi trong lượt lậpplan; chỉ3tài liệu bàn giao được cập nhật. Các hash trọng yếu dưới đây khóa currentdirty, không thay bằng cleanHEAD. Nếu khác thì đọc delta/tái hiện trước áp patch.

| File | SHA-256 |
|---|---|
| `src/main/providers/MultiloginProvider.ts` | `4de2253bb6d0ffc5a802e63a444288e3803becf4ec114ecd622b3bf9dc25ac75` |
| `src/main/services/AutomationRunService.ts` | `3208b8754991a124fb03febfb31aa3f0ec22b1dc47816397ce05acb55159ef50` |
| `src/main/runtime/providerStack.ts` | `93fb5a78b61baa7ed9d8a1d2e57e79a5567b5a8e0c3a19315c086ad60f3344a6` |
| `src/main/services/capcut/httpTasks.ts` | `1a2ba597040da1525a19fa1e52bd7a2a59d93dec01d99bcbba7af93135ff060f` |
| `src/main/services/capcut/overlays.ts` | `f37e2df0ce39523ce41929a36fb0d7fbcdc2297ba1a9a39442d28e0d690df5b5` |
| `src/main/services/capcut/launcher/ApiV3Launcher.ts` | `9dedc9cc913d585e5cd862e8bbb71eba9d8c10aacc6118b78f12fff06ada5e54` |
| `src/main/services/capcut/launcher/ProfileStopError.ts` | `e74d8c8dd53dc4c767c080b8a066ce906d7188a114347e2775364be5f63eafdd` |
| `src/main/repositories/AccountTaskRepository.ts` | `ca21b2b04cb9b2bea8af8b103a2087ae4fabf54489a133fdc2411721b8067403` |

Kiểm tra tài liệu:5local links tồn tại,15codeblocks kiểm cú pháp,48acceptancecriteria map đủ8tasks; diffcheck docs PASS. Lượt này không sửa code, không chạy lại live/DB/native rebuild và không tuyên bố cácfix đã hoàn tất.
