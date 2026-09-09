# Kế hoạch triển khai kiểm từng step và thu network

> **For agentic workers:** REQUIRED SUB-SKILL: dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans khi người dùng duyệt triển khai. Một task chỉ xong sau RED → GREEN → review; không tự chuyển sang live hoặc mua mail.

**Goal:** Biến quy trình S00–S28 thành kiểm chứng chạy được trong code: bước lỗi không đi tiếp, bằng chứng không nhận nhầm, kết quả nghiệp vụ không bị lẫn với task thưởng, request/response đủ để tìm nguyên nhân và chuẩn bị HTTP.

**Architecture:** Thêm hợp đồng kết quả, provenance và các hook có phạm vi tài khoản vào flow hiện có. Giữ `AutomationRunService` sở hữu tài nguyên; giữ scheduler riêng session. Recorder chỉ quan sát; `TaskStore` vẫn là nguồn proof duy nhất. Không tạo workflow engine, strategy registry hay cơ chế HTTP fallback mới.

**Tech Stack:** TypeScript, Electron/Windows, Playwright Core 1.62.1, Vitest, SQLite.

**Spec:** [Quy trình kiểm S00–S28, capture và giới hạn chi phí](2026-09-09-stepwise-evidence-network-plan.md). Tài liệu này là **thứ tự thi công** cho spec đó, không thay bảng điều kiện thành công, lịch sử bằng chứng hay ngân sách của spec.

**Status:** Người dùng đã duyệt triển khai. Task1 baseline/contract inventory đã thực hiện, Task2 đang RED/GREEN. PWA/Inspiration/Canvas business contracts vẫn unresolved; export cần file hoàn tất. Chưa chạy live/provider/purchase mới. Trạng thái chi tiết trong `.superpowers/sdd/2026-09-09-stepwise-implementation/progress.md`; không làm lại các sửa selector-first/capture UUID đã có.

## Global Constraints

- R1 — Chỉ bước có đủ hậu điều kiện mới được ghi PASS; hàm return, click resolve, HTTP200 và task_status 4 là các tín hiệu khác nhau.
- R2 — Kiểm tra **trước khi đi bước kế tiếp**, không đợi hết `MissionGroup.act()` mới kiểm chứng tất cả.
- R3 — Gate thuộc tài khoản/session đó. A chờ response hoặc bị dừng không chặn B/C; tuyệt đối không `Promise.all` làm barrier cuối mỗi step giữa các worker.
- R4 — FAIL/UNKNOWN chặn bước phụ thuộc của tài khoản đó. Giữ kết quả đã chứng minh; không xoá lịch sử lỗi nếu lần sau hồi phục.
- R5 — Timeout sau khi đã gửi mutation = kết quả chưa rõ, không đồng nghĩa chưa thực hiện. Không click/send/upload/generate/export hay mua mail lần hai để thử vận may.
- Giữ pacing, guards, Stop, exact cleanup, 12 task/9 action leaf/2 task cha; không bịa proof cho đăng ký hoặc parent.
- Không thay parser sang endpoint khác chỉ để có task_list. Không coi tải object HTTP200 hay `suggestedFilename()` là file hoàn tất.
- Giữ dirty worktree/index; không reset/stash/commit/push/xoá bằng chứng. Bản sửa chỉ khôi phục chính delta của task nếu cần.
- Capture chỉ trong session/workflow được phép; secrets phải redacted hoặc mã hoá theo opt-in riêng. Không OS-wide capture, MITM, tắt TLS, replay credentials hoặc reward-only substitution.
- Chưa có live authorization mới: **0 email, 0 profile vendor, 0 request provider mới** được phép chỉ vì plan này tồn tại. Tất cả Task 1–15 trước live dùng fixtures/fakes/local test.

## 1. Thứ tự, trách nhiệm và đầu ra

| Đợt | Task | Đầu ra kiểm được | Cổng sang đợt sau |
| --- | --- | --- | --- |
|0|1|Baseline, file ownership, 4 business contract còn cần chốt|Không đánh dấu contract mơ hồ là PASS|
|1|2–5|Verdict đúng; recorder có accounting; normalizer nối được request/response; target/stream coverage rõ|Fixtures chứng minh không báo thành công/capture giả|
|2|6–8|Proof đúng attempt; provider scope đúng; intent bền qua restart|Lost response không dẫn đến replay/double purchase|
|3|9–10|Runner dừng đúng step; partial proof giữ được; export/file outcome truyền tới counter/validator|Reward12 + exportfail không thể báo end-to-end completed|
|4|11–14|Auth/bootstrap, Design, Video, PWA/push được kiểm tại từng step|Lỗi có bằng chứng và delta riêng; step trước/sau + peer tests qua|
|5|15|Full offline + fault3/10/20 + local browser/recorder tests|Reviewer chấp nhận bản build cố định, không missing critical evidence|
|6|16|Live đúng step có duyệt → 1 fresh → 3 fresh → xác nhận3 → 10|Mỗi lượt có phiếu chi phí, tiêu chí PASS và cleanup riêng|
|7|17|Contract inventory chuẩn cho phase HTTP|Chỉ sau UI qualification; chưa gửi HTTP mutation từ plan này|

Một implementer sở hữu task đang sửa; root kiểm interface và ghép; reviewer đọc delta độc lập. Agent khác có thể chuẩn bị fixture, phân tích hoặc review **read-only** song song. Không hai agent sửa `types.ts`, `CapcutEngineService.ts`, runner hoặc recorder cùng lúc. Không rebuild Node/Electron đồng thời với test SQLite.

Task 2–5 có thể chuẩn bị độc lập nhưng tích hợp theo thứ tự bảng. Task 8 không được để “sẽ làm sau” rồi chạy live trước. Business contract cần thêm quan sát có thể dùng lượt targeted ở Task 16 sau mọi điều kiện an toàn; không chặn việc xây/test offline, nhưng chặn qualification toàn flow.

### Bảng truy vết yêu cầu → task triển khai

| Yêu cầu | Task chịu trách nhiệm | Bằng chứng nghiệm thu |
| --- | --- | --- |
|S00–S02 và S28 tài nguyên/chi phí/cleanup|1,7,8,9|Preflight, purchase intent trước call, exact stop, outcome sau cleanup|
|S03–S09 đăng ký/đăng nhập/OTP/bootstrap|6,9,11|Form/response/auth binding; không có reward request được phân loại đúng|
|S10–S11 PWA/push|1,14|Business contract chốt; quyền/subscription và reward riêng; không action lặp|
|S12–S20 Inspiration/Design/canvas|6,9,12|Mỗi leaf có hậu kiểm trước leaf kế; sai panel/inert/readback/asset không đi tiếp|
|S21–S26 Video/generate/export|6,9,10,13|Job/asset đúng; export terminal/file hợp lệ; thưởng không che lỗi client|
|S27 proof/receipt cuối|6,9|Request-origin đúng; identity/freshness/12 key được owner kiểm|
|F01–F03 báo cáo export/bootstrap|9–11,16|Sửa false success bằng RED/GREEN; nguyên nhân client/bootstrap chỉ đóng khi có phép đo đúng|
|F04–F07 fallback/readiness/toolbar/duplicate|12–14|Regression đúng branch + step trước/sau + shared callers|
|F08–F09 lỗi capture/normalizer|3–5,7|Paired records, codes/privacy, boundedness, target coverage/omissions|
|F10 no-replay|8,9,15|Crash/restart/run mới không lặp mutation hoặc reset purchase cap|
|Ảnh hưởng giữa luồng/HTTP tương lai|15–17|C01–C10 độc lập; chỉ qualification sạch mới mở kế hoạch HTTP tiếp|

### Chu kỳ áp dụng cho mọi task code

1. [ ] Đọc đúng file; sao lưu nội dung và hash trước sửa vào workspace riêng của plan; không dùng HEAD làm baseline vì đang có thay đổi chưa commit.
2. [ ] Viết test mô tả break cụ thể, chạy RED đúng nguyên nhân; dependency ngoài mới fake, code mình đang sửa phải chạy thật.
3. [ ] Sửa tối thiểu; chạy focused test trong task → caller phụ thuộc → typecheck/lint. Không tăng timeout hoặc xoá assertion để làm xanh.
4. [ ] Review exact delta + RED/GREEN output + giới hạn. Critical/Important chưa xử lý thì không bắt đầu task phụ thuộc.
5. [ ] Ghi ledger `Task N: offline-verified` với files/hash/command/outcome; chưa gọi `live-verified`. Không tạo commit nếu chưa được yêu cầu.

---

## Task 1: Chốt baseline và contract nghiệp vụ

**Phụ thuộc:** Không. **Sửa:** chỉ ledger của plan và phần quyết định A0 trong spec, không source.

- [ ] Đọc `AGENTS.md`, `package.json`, migration registry, git status/index, bản live report. Kiểm không còn runner/profile của lượt cũ; không tự đóng profile không thuộc task.
- [ ] Tạo baseline trước sửa cho `src`, `scripts`, `tools`, package/config và index; inventory các file mới được phép tạo ở các task bên dưới. Existing dirty files được giữ.
- [ ] Đối chiếu fixture `tools/fixtures/task-list-initial.json`: 12 key, 9 leaf có action, đăng ký và 2 parent không thêm mutation.
- [ ] Ghi 4 decision records ngắn ngay trong spec A0: PWA install thật hay task reward; Inspiration accepted hay generated result; Canvas accepted hay applied result; Export download hay branch output khác. Mỗi record có evidenceRefs, accepted/browser-required/unsupported, mandatory axes. Chưa có dữ liệu thì giữ `unresolved` và câu hỏi/quan sát cần thu; **không tự thu hẹp nghĩa thành công**.
- [ ] Baseline offline: chạy các test đang có với Node ABI đúng; failure cũ ghi riêng, không gộp vào sửa task mới. Không cài dependency/bật provider để lấy baseline.

**Hoàn tất:** biết chính xác trạng thái xuất phát và đường qualification bị chặn bởi quyết định nào; không cần mua email để hoàn thành inventory.

## Task 2: Hợp đồng step và kết luận không nói quá

**Files:** tạo `src/main/services/capcut/stepEvidence.ts`, `src/main/services/capcut/__tests__/stepEvidence.test.ts`; sửa `src/main/services/capcut/types.ts` để tham chiếu kiểu, chưa nối counter runtime.

**Interface:** dùng `StepResult`, `StepObserver`, `RewardAttempt`, `VerifyRewardStep` trong spec A1; thêm validator thuần, không scheduler/IO:

```ts
export type EvidenceAxis = 'business' | 'reward' | 'coverage';
export function deriveStepVerdict(
  required: readonly EvidenceAxis[],
  observed: Record<EvidenceAxis, EvidenceState>
): 'pass' | 'fail' | 'unknown';
```

`EvidenceState` giữ đúng `'pass'|'fail'|'unknown'|'not-required'` từ spec. `required` lấy từ contract cố định của step; caller không tự gỡ reward/business khỏi required. FAIL có ưu tiên hơn UNKNOWN; `not-required` trong trục required phải UNKNOWN/invalid, không pass.

**RED mẫu:**

```ts
it('does not turn a rewarded export into a completed artifact', () => {
  expect(deriveStepVerdict(['business', 'reward', 'coverage'], {
    business: 'unknown', reward: 'pass', coverage: 'pass'
  })).toBe('unknown');
});
```

- [ ] Thêm case fail+pass, missing evidenceRefs, wrong identity, duplicate terminal, result A pass không bị result B fail ghi đè; skip là `not-run` có lý do `ALREADY_VERIFIED/NOT_APPLICABLE`, không tăng executed/pass.
- [ ] Zod/schema kiểm StepId S00–S28, attempt identity và reason codes trước persist; giữ module schema main-only nếu chưa IPC, không kéo browser classes qua renderer.
- [ ] Tạo `StepVerificationError(result)` cho FAIL/UNKNOWN và `DiagnosticBoundaryReached(stepId)` cho dừng dự kiến. Hai loại này không được ngụy trang `DOM_READ_TIMEOUT`; Task 9 sẽ nối đường xử lý.
- [ ] Chạy `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/stepEvidence.test.ts`.

**Hoàn tất:** model không thể tạo PASS chỉ từ reward; chưa thay hành vi mission hoặc claim runtime đã sửa.

## Task 3: Recorder/redactor không làm mất lỗi hoặc làm nghẽn worker

**Files:** sửa `src/main/services/capcut/httpCapture.ts`, `src/main/services/capcut/captureRedaction.ts`; tạo module nhỏ `src/main/services/capcut/evidenceBudget.ts` chỉ tính byte budget của một session và test `src/main/services/capcut/__tests__/evidenceBudget.test.ts`; reuse `src/main/services/capcut/__tests__/httpCaptureRecorder.test.ts`, `src/main/services/__tests__/CapcutCaptureSession.test.ts`. Chưa bật private raw capture.

**Interface:** giữ `attachRedactedHttpCapture`, `CaptureController.mark/stop`; mở rộng record phiên bản mới có immutable identity và bước. Thêm typed `markStep({stepId,stepAttemptId,phase})`; `phase` là before/action/client/proof/snapshot/end/fail. Schema record đặt trong chính module hoặc một file schema nếu chia trách nhiệm thực sự cần.

- [ ] RED headers arrive + body never settles: HTTP status phải được ghi trước deadline body; response body là event nối sau. Requestfailed sau response phải được ghi, không bị `responseSeen` loại.
- [ ] RED cap2: burst10 body events, 2 raw promises không settle → chỉ2 raw calls, còn lại capacity-omitted; outer timeout không nhả permit. Metadata vẫn ghi; Stop không chờ vô hạn.
- [ ] RED disk error/backpressure/close error: summary phải báo đúng scheduled/written/failed và stopTimedOut; không có capture-end nói ioErrors0 nếu close sau đó thất bại.
- [ ] Dùng budgets spec §5.5: tối đa **2 raw body reads chưa settle đồng thời** trên một session, không phải chỉ2 reads cho cả phiên. Permit được dùng lại chỉ khi promise gốc settle; wrapper timeout không nhả permit. Queue4MiB, normalbody2MiB, stream/step8MiB, file128MiB, **tổng session256MiB bao gồm network, ảnh và artifact**. Body read5s, close5s là bounds riêng, không mission timeout. Tính ciphertext/base64 size trước cap nếu sau này mã hoá.
- [ ] Owner tạo đúng một `SessionEvidenceBudget` cho session rồi inject cùng instance vào recorder, dump/screenshot và export writer (Task5/10). Interface `reserve(category, bytes): Reservation | null`, `Reservation.commit(actualBytes): void`, `release(): void`; reservation đồng bộ, không chờ worker khác; không cho commit vượt phần đã reserve. Không tạo một budget256MiB riêng cho mỗi sink. File streaming reserve trước từng chunk; screenshot/buffer có sẵn kiểm trước ghi, vượt cap thì omitted rõ. Không gọi capdisk là hardRAM cap.
- [ ] RED tổng240MiB network +20MiB screenshot/artifact phải bị từ chối phần vượt **trước ghi**, dù từng file chưa chạm128MiB; release/failedwrite không double-credit; sink A không lấy reservation/session củaB; counter actual/reserved/rejected nhất quán. Đây là accountant thuần, không workflow engine hoặc global throttle.
- [ ] RED privacy: request OTP/auth `code` bị che; response `ret/error_code/status_code` giữ numeric chỉ ở JSON path+endpoint đã allowlist; unknown text opaque. Giữ content length/timing/type phục vụ lỗi, không lộ cookie/querysignature.
- [ ] Không xoá metadata do URL/resource type: ghi mọi request quan sát được, body policy có thể omitted. Emit counters riêng về eligibility/omission, không gọi filtered là network không xảy ra.

**Pseudocode giới hạn cần hiện thực và test trên recorder thật:**

```ts
// Permit is tied to the raw operation, not the timeout wrapper.
raw.finally(releasePermit).catch(() => undefined);
const outcome = await boundedObservation(raw);
// outcome timeout is recorded; it does not releasePermit or retry the read.
```

Tên `raw/releasePermit/boundedObservation` là biến nội bộ của đoạn minh hoạ, không public API mới. Test gọi recorder với fake transport + real sink để chứng minh số read và output.

**Chạy:** `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/httpCaptureRecorder.test.ts src/main/services/__tests__/CapcutCaptureSession.test.ts`.

## Task 4: Nối đúng request/response và chặn contract giả

**Phụ thuộc:** Task 3 schema. **Files:** `tools/http-contracts/normalize-capture.mjs`, `scripts/__tests__/normalize-capture.test.mjs`, `tools/http-contracts/README.md`.

**Interface:** giữ `normalizeCapture(input)`; output phải chứa identity/hop, request, response, body-state, completeness và semantic-role. Registry thực thi HTTP chưa được bật.

- [ ] RED fixture2 event v2 trong spec B1: request URLobject + response rời phải thành một transaction. Response rời không được coi body request; URL object truthy nhưng thiếu origin/path/method không được `captured`.
- [ ] RED same requestId khác capture/target và redirect hops không lẫn; missing base/response → `incomplete`; background request gần thời điểm action không thành confirmed dependency.
- [ ] Normalize v2 theo `(captureId,requestId)`; phiên bản mới theo `(captureId,targetId,requestId,redirectHop)`. Không giả hop/extraheader mà dữ liệu v2 không có.
- [ ] Fixture do_action0 có role `reward-acknowledgement`, không role upload/generate/export-operation. Không export raw decoded payload ra stdout hoặc repo.
- [ ] Review secret scan fixtures; chạy `npx --userconfig=NUL vitest run scripts/__tests__/normalize-capture.test.mjs scripts/__tests__/private-capture-summary.test.mjs`.

**Hoàn tất:** đọc capture cũ đúng nhưng vẫn nêu phần thiếu; không promote thành native HTTP contract.

## Task 5: Target, stream, client error và ảnh theo đúng session

**Files:** `src/main/services/capcut/http/privateCapture.ts`, `src/main/services/capcut/httpCapture.ts`, `src/main/services/capcut/diag.ts`, `src/main/services/CapcutEngineService.ts`; tests `src/main/services/capcut/http/__tests__/privateCapture.test.ts`, `src/main/services/capcut/__tests__/httpCaptureRecorder.test.ts`, `src/main/services/capcut/__tests__/boundedDump.test.ts`.

- [ ] RED extra-info trước request, redirect reuse ID, failed-after-headers, popup/frame/worker/cache/preflight; đúng record accounting, không doublecount. Target không hỗ trợ phải capability=false, không metadataComplete=true.
- [ ] RED SSE prefix+chunks không lặp nội dung; WS direction/opcode/frame error/close đúng; body sensitive chỉ redacted shape ở tầng public. Attach đúng target owned, không mọi tab của máy.
- [ ] Bound attach/Network.enable/commands/detach và raw pending theo spec; chỉ2 target body buffers đồng thời/session, metadata vẫn tiếp tục. Không dùng global worker lock để recorder theo kịp.
- [ ] Phần raw encrypted giữ OFF mặc định; khi cần, sửa filename thành session/capture unique, OS-vault encryption bắt buộc, không plaintext encoder, không synchronous unlimited writes. Failure encryption/ACL/cap phải explicit; không tự bật khi script muốn biết error.
- [ ] Thêm pageerror/console error/dialog/toast observation đã sanitize, download lifecycle metadata và screenshot BEFORE/AFTER có step/session refs. Screenshot chỉ ở responsive safe boundary; không thêm command sau hang/quarantine. Lưu dưới run/session riêng, không `pruneDumps` toàn cục xoá ảnh worker khác.
- [ ] Mọi screenshot/DOM/private ciphertext write dùng chung budget instance Task3. Cap failure ghi policy-limit/coverage thiếu, không tắt kiểm hậu điều kiện để vẫn báo pass.
- [ ] Giữ capture quanh dependency chain, không global networkidle; response muộn mang originStep cũ. Bản download bytes kiểm ở Task 10, không dump binary vô hạn ở recorder.

**Chạy:** focused3 files trên + `src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts`. **Hoàn tất:** synthetic local server chứng minh headers/SSE/WS/errors/redirect/popup; vendor capabilities còn cần probe được duyệt, không nhận vơ từ Chrome thường.

## Task 6: Proof đúng attempt, không nhận response cũ đến muộn

**Files:** `src/main/services/capcut/taskApi.ts`, `src/main/services/capcut/types.ts`, `src/main/services/capcut/missionRunner.ts`, `src/main/services/capcut/runTasks.ts`; tests `src/main/services/capcut/__tests__/taskApi.test.ts`, `src/main/services/capcut/__tests__/missionRunner.test.ts`, `src/main/services/capcut/__tests__/runTasksReceiptIntegration.test.ts`.

**Interface:** `RewardAttempt`, `VerifyRewardStep` như spec A1; implement `TaskStore.beginAttempt(attempt)`/`endAttempt(stepAttemptId)` và provenance sidecar. `attachTaskMonitor` phải được gắn trước action, nghe request-start và headers-arrival; body parse time không được giả làm request/event time. Recorder không thay TaskStore làm nguồn proof.

`attachTaskMonitor(context, store, identity): () => void` trả disposer và pair tại context request/response để bao phủ popup/target quan sát được; `identity` owner-bound chứa run/session. Thay match URL `includes` bằng hostname allowlist + pathname đã xác minh; orphan/unsupported target có reason chứ không proof giả. Đối với nhánh `httpTaskApi` tạo synthetic task_list trong bootstrap: strict diagnostic giữ OFF; không bơm body/timestamp thiếu provenance vào store để pass.

- [ ] RED same key/session: attemptA request bắt đầu → attemptB bắt đầu → responseA về; B không PASS. RED task_list request trước mutation, body về sau mutation: không fresh.
- [ ] RED same requestId ở2 page/context, parent completion, pre-completed signup, missing provenance legacy: không gán nhầm attempt, không ép12 action. Case9 proof+2parent+signup hợp lệ vẫn giữ reward snapshot.
- [ ] Request-origin chỉ giúp loại response cũ, không tự chứng minh causal link. Chỉ matched action/job/message hoặc contract đối chứng mới `confirmed-related`; temporal-only là UNKNOWN trong gate nghiêm ngặt.
- [ ] Inject `verifyRewardStep` closure từ runner giữ store riêng vào mission env; giữa các leaf sau action đã settle gọi gate trước leaf tiếp. Final reconciliation dùng cùng provenance rule, không còn đường bỏ qua bằng timestamp cũ.
- [ ] Không nhân group proof budget mỗi leaf: PWA12s, notification20s, Design90s, Video240s tổng wait; preserve generation/layout budgets riêng. Signal/Stop được truyền tới mọi wait.

**Chạy:** focused3 files + `src/main/services/capcut/__tests__/runTasks.test.ts`. **Hoàn tất:** request cũ không thể đẩy step mới lên PASS; legacy receipt vẫn đọc được nhưng không biến thành current evidence.

## Task 7: Provider HTTP scope không lẫn mua mail/OTP giữa luồng

**Files:** `src/main/providers/HttpClient.ts`, tạo `src/main/providers/ObservedHttpClient.ts`, `src/main/runtime/providerStack.ts`, `src/main/services/AutomationRunService.ts`, `src/main/services/AutomationWorkSource.ts`, `src/main/services/EmailPurchaseService.ts`, `src/main/services/ProxyLeaseManager.ts`, `src/main/services/MultiloginAuthService.ts`; test mới `src/main/providers/__tests__/ObservedHttpClient.test.ts` và service tests cùng tên hiện có.

**Interface:** giữ `HttpClient.send(HttpRequest): Promise<HttpResponse>`; `withObservationScope<T>(identity, operation): Promise<T>` dùng AsyncLocalStorage riêng observer; identity immutable gồm run/worker/acquisition và account/session nếu đã bind. Metadata không được đưa vào HTTP header/query/body gửi đi.

- [ ] RED2 request mua/OTP response đảo thứ tự vẫn owner đúng; outside scope ghi unscoped, không lấy currentAccount của peer. Shared token refresh ghi provider/run scope, không account giả.
- [ ] `AutomationRunService` bind scope quanh launcher/proxy/OTP và work-source acquisition call; `providerStack` inject observer cùng transport. Trước account/profile có identity thì ghi unassigned với acquisition/authorityref, không tạo worker/account giả.
- [ ] RED response headers rồi body timeout vẫn có status; observer throw không thay raw provider request/response, retry/balance behavior. Unknown purchase là ambiguous, không mua lại.
- [ ] Hook headers sớm bên trong FetchHttpClient, không chỉ wrapper sau `response.text()`. Capture chỉ names/types/status/code đã allowlist; inbox, OTP, raw purchase line không đi report.
- [ ] Chạy `npx --userconfig=NUL vitest run src/main/providers/__tests__/ObservedHttpClient.test.ts src/main/services/__tests__/EmailPurchaseService.test.ts src/main/services/__tests__/AutomationWorkSource.test.ts src/main/services/__tests__/purchaseBudgetWiring.test.ts`.

**Hoàn tất:** quan sát provider không đổi side effect, scope và budget; chưa authorize gọi provider thật.

## Task 8: Durable intent và không né UNKNOWN bằng restart/run mới

**Files:** dự kiến `src/main/database/migrations/008_account_mutation_intents.ts`, `src/main/database/migrations/index.ts`; tạo `src/main/repositories/AccountMutationRepository.ts`, `src/main/repositories/__tests__/accountMutationRepository.test.ts`; sửa `src/main/runtime/providerStack.ts`, `src/main/services/AutomationWorkSource.ts`, `src/main/services/EmailPurchaseService.ts`, `src/main/services/AutomationRunService.ts`. Reuse `src/main/database/__tests__/migrator.test.ts`, `src/main/services/__tests__/AutomationRunService.test.ts`.

Migration hiện cuối007; nếu008 đã được người dùng thêm khi triển khai thì dừng resolve version, không ghi đè. Không sửa checksum migration cũ.

**Repository contract:**

```ts
type IntentState = 'outcome-unknown' | 'effect-confirmed' | 'no-effect-confirmed';
interface MutationIntent {
  authorityRef: string; budgetOwnerRef: string;
  ownerRef: string; accountId: string | null;
  runId: string; sessionAlias: string | null;
  stepAttemptId: string; stepId: string; taskKey: string | null;
  intentAt: string; state: IntentState; evidenceRef: string | null;
}
// Synchronous SQLite transactions; no lock held across an await/network call.
interface AccountMutationPort {
  recordIntent(intent: MutationIntent, billableUnits: 0 | 1): void;
  bindAccount(ownerRef: string, accountId: string): void;
  assertNoUnknown(identity: { authorityRef: string; budgetOwnerRef: string; ownerRef: string; accountId?: string }): void;
  settleIntent(ownerRef: string, stepAttemptId: string, state: Exclude<IntentState, 'outcome-unknown'>, evidenceRef: string): void;
}
```

Đây là methods của `AccountMutationRepository`, không các function global. Schema `account_mutation_intents` theo spec A2b; dùng `session_alias NULL` khi purchase xảy ra trước profile (không tạo session giả). Thêm bảng binding durable `owner_ref ↔ account_id/source mailbox reference`; lookup UNKNOWN xuyên mọi run, không chỉ primary key `(owner,run,attempt)`.

**Authority/cost identity bắt buộc:** `authorityRef` là phiếu duyệt được persist trước start, không ID tạo lại mỗi retry; `budgetOwnerRef` là opaque ID bền của provider/credential scope, không chứa APIkey và không đổi khi tạo run/acquisition mới. Cùng UNKNOWN purchase chưa có mailbox sẽ block budgetOwnerRef, không chỉ acquisitionalias. Tạo authority mới không tự xoá UNKNOWN cũ; phải reconciliation/định hướng xử lý riêng có audit.

Trong migration008 thêm `diagnostic_approvals(authority_ref PRIMARY KEY, budget_owner_ref, provider, approved_units, consumed_units)` và `authority_ref/budget_owner_ref` vào intents; binding owner↔account/mailbox giữ bền. `recordIntent(...,1)` phải atomically kiểm approval còn units, tăng consumed và insertUNKNOWN trước providercall trong cùng transaction; UIintent billableUnits0 không tăngmailcount. Không có approvalrecord hợp lệ thì fail trước mutation. `consumed_units` không giảm vì timeout/UNKNOWN; refund chỉ theo record provider được xác minh, không xóa intent.

- [ ] RED intent write fail trước action → action0; crash sau intent trước dispatch → vẫn cấm replay (chấp nhận false block); crash sau dispatch trước proof → actioncount1 sau restart.
- [ ] RED đổi run/manifest/acquisition alias nhưng cùng authorityRef/budgetOwnerRef vẫn không bỏ UNKNOWN hoặc reset units; newauthority cùngbudgetowner đangUNKNOWN cũng bịchặn. Binding từ purchasedEmailId/order ref sang account commit bền và idempotent. Mọi test reopen DB thật, không chỉ giữ state in-memory.
- [ ] Diagnostic registry tồn tại bền ở workspace dữ liệu được chỉ định; mọi manifest của cùng qualification phải trỏ cùng registry. Tạo userData mới không được tạo fence trống để né. Thiếu registry đã khai hoặc không xác minh lineage → refuse start, không mua.
- [ ] Purchase: ghi intent+billed-slot trước provider call, xác nhận order/reservation rồi settle; proof CapCut không settle purchase. Export: reward 0 không settle file outcome. Upload/generate cần operation asset/job receipt, không parent/task_status đơn lẻ.
- [ ] Vị trí purchase fence: ngay trước `createOtpOrder`/`buyMail` trong `EmailPurchaseService.acquireOne`, không sau `AutomationWorkSource.next()` vì lúc đó đã mua. Immutable acquisition identity truyền từ work source; bind owner với account ngay khi `createThreadRecord` có accountId, không đợi reservation commit sau browser launch. Test crash ở cả hai khoảng trống này và confirm provider success nhưng `insertReserved` fail: vẫn UNKNOWN, không mua lại.
- [ ] `no-effect-confirmed` cần chưa dispatch hoặc definitive no-effect response theo contract; timeout/task_status!=4 không đủ. Các bước đọc thuần không tạo intent.
- [ ] Inject `beforeMutation`/settle callback owner-bound vào service/engine ở Task 9; repository không tự gọi browser/provider. Persistence failure dùng fail-closed terminal, no next mutation; không ghi rawSQL ngoài repo.
- [ ] Test migration upgrade/reopen/rollback failure, transactions và UNKNOWN query không quét/bỏ mất receipts cũ. Không drop table để rollback code; giữ unresolved intents fail-closed.

**Hoàn tất Task8:** repository/binding/approvalbudget và **purchase/acquisition fencing** đúng cả restart. Browser mutation fencing chưa hoàn chỉnh ở task này; cần owner-bound injection+mission callers ở Task9–14 trước khi tuyên bố bảo vệ UI replay. Task8 là dependency bắt buộc, không tự đủ để được phép live.

## Task 9: Nối step gate → engine → owner → counter → validator trong một delta

**Phụ thuộc:** Task2/6/8; capture Task3/5/7 phải có trước live. **Files:** `src/main/services/capcut/types.ts`, `src/main/services/capcut/missionRunner.ts`, `src/main/services/capcut/runTasks.ts`, `src/main/services/CapcutEngineService.ts`, `src/main/services/AutomationRunService.ts`, `src/main/runtime/providerStack.ts`, `src/main/services/stageTiming.ts`, `src/shared/schemas/automation.schema.ts`, `src/shared/schemas/automation-evidence.schema.ts`, `src/shared/contracts/api.ts`, `scripts/live-capcut-options.mjs`, `scripts/live-capcut-run.mjs`, `scripts/verify-rollout-evidence.mjs`; các tests cùng module và `src/renderer/pages/Dashboard/__tests__/dashboardRendering.test.tsx` nếu sửa nhãn kết quả UI.

**Interfaces mới:** `CapcutMissionEnv` nhận owner-bound `beforeMutation`/`onStep`/`verifyRewardStep`. `RunTasksResult` có `stepFailure?: StepResult` và `diagnosticStop?: { stepId: string }`. `CapcutUiAccountResult` giữ nguyên reward receipt và thêm `execution` chứa step results/expected scope; thiếu execution trên dữ liệu cũ là `not-evaluated`, không business-pass. Schema record `step-result` chứa identity fixed, kết quả và refs, không payload secret.

```ts
export interface ExecutionSummary {
  scope: 'diagnostic-target' | 'full-account';
  requiredStepIds: readonly string[];
  results: readonly StepResult[];
  complete: boolean;
  exit?: { kind: 'stop-after' | 'blocked'; stepId: string };
}
```

`complete` được validator tính từ contract/version + results, không tin boolean caller tự đặt. `requiredStepIds` từ scope đã validate ở start, không từ result engine tự thu hẹp. Các kiểu trên dùng một tên `execution` xuyên `MissionGroupResult/RunTasksResult/CapcutUiAccountResult` và service; không thêm `businessVerification` thứ hai có thể mâu thuẫn. Missing summary và malformed summary không đủ để completed.

- [ ] RED real chain: group.act phát `StepVerificationError(S26)` nhưng store đã có export reward 0/fresh12 → preserve reward receipt, stop các bước sau, account không completed. Hiện `reconcileMissionEvidence` bắt lỗi thường rồi có thể bỏ qua khi proofs đủ; phải sửa cả propagation, không chỉ throw ở Video Studio.
- [ ] RED controlled `DiagnosticBoundaryReached(S18)` unwind không bị convert thành retry/failure mission rồi tiếp tục S19. Kết quả planned stop khác account full completed; pass target chỉ được trả diagnostic success khi target và prerequisites đã kiểm, cleanup đạt.
- [ ] `reconcileMissionEvidence` đối chiếu/passively preserve proof đã về nhưng trả `stepFailure/diagnosticStop` ngay cho `runTasks` sau budget hợp lệ; không chạy group sau hay vòng2. DOM fatal/Stop giữ precedence và quarantine hiện có.
- [ ] `classifyUiResult` kiểm lỗi và execution **trước log SUCCESS**. Reward12 được log “server ghi nhận”; business fail/unknown không được `accountsCompleted++`. Persist progress task thật trước, không dùng missing=[] để suy tất cả nghiệp vụ tốt.
- [ ] Receipt validation tại owner: runId/sessionAlias khớp session được giao; observedAt > requiredAfter; serverDone/Total khớp rows và done/total, đúng12 key duy nhất theo scope qualification, status4 đủ; late/wrong session/booleancomplete giả không PASS. Reuse validator thuần ở `stepEvidence.ts` hoặc schema hiện có, không thêm framework. RED bằng service test với receipt sai identity và timestamp bằng nhau dù complete=true.
- [ ] S00–S02 và S28 do owner ghi; S03–S27 do engine ghi. Final end-to-end chỉ chốt sau owner cleanup đúng; nếu engine pass nhưng close thất bại, không log clean success. Một terminal/account, các bộ đếm tổng không mâu thuẫn.
- [ ] Kiểm `recordOutcome` và đường finalization trong `AutomationRunService`: không increment completed trước cleanup rồi chỉ sửa text sau. Phần engine xác minh S03–S27; owner ghép S00–S02/S28 sau exact cleanup mới derive full-account execution. Không tạo vòng chờ engine phải xác minh S28 trước khi owner được cleanup.
- [ ] Runner expose diagnostic config có validate, ví dụ `diagnostic: { stopAfterStep, maxAttemptsPerStep:1, allowSessionRecycle:false }`. Tên CLI cuối cùng được test ở options trước khi ghi help; không dùng flag chưa tồn tại. Budget/purchase flags cũ vẫn mandatory, HTTP/private capture flags bị từ chối ở UI-diagnostic trừ opt-in riêng đã chốt.
- [ ] Planned target reached dùng account outcome `stopped` + typed diagnostic reason (không `completed`); diagnostic validator có thể trả exit0 khi đúng target/prerequisite/capture/cleanup đã PASS. Standard full-account validator không chấp nhận planned stop làm thành công12/12. Chứng minh rõ hai mode trong runner tests.
- [ ] `captureStage` sync không được làm gate; manual pause chỉ sau release. Giữ editor lease cả group ở bản đầu; stop-after-microstep unwind nó. Không tách/rewrite scheduler chỉ để có nút Next.
- [ ] Runner chính mới xử lý strict report schema; validator cũ vẫn đọc v1 reward artifacts với nhãn legacy-reward-only, **không** dùng v1 làm strict PASS. Test thiếu step event/duplicate/late/wrong session/expected target mismatch đều reject.
- [ ] `stageTiming.ts` giữ monotonic clock, bổ sung boundaries cần cho ownQueue/active/remote/capture/operator dwell, không đổi measured outcome thành businesspass. Regression `src/main/services/__tests__/stageTiming.test.ts` kiểm không số âm, không doublecount human pause/remote wait, duration gắn đúng attempt.

**Thứ tự tác dụng code cần được test:**

```text
validate prerequisites → durable intent → beginAttempt → exactly-one action
→ business check + correlated proof check → emit step result
→ failure/unknown/target-stop ? preserve+return : next step
→ engine result → owner cleanup → final report/counters
```

**Chạy:** `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/missionRunner.test.ts src/main/services/capcut/__tests__/runTasks.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/__tests__/AutomationRunService.test.ts scripts/__tests__/live-capcut-options.test.mjs scripts/__tests__/live-capcut-run.test.mjs scripts/__tests__/verify-rollout-evidence.test.mjs`.

**Hoàn tất:** không có đường “throw ở step nhưng cuối cùng reward đủ nên vẫn báo completed”. Không bật live trước các mission được gắn checks.

## Task 10: Export/file outcome — sửa lỗi báo cáo đã chứng minh trước

**Files:** `src/main/services/capcut/missions/videoStudio.ts`; tạo `src/main/services/capcut/__tests__/videoExportOutcome.test.ts`; reuse `src/main/services/capcut/__tests__/missionRunner.test.ts`, `src/main/services/__tests__/automationTaskProgress.test.ts`. Chỉ tách helper kiểm artifact thành `src/main/services/capcut/exportOutcome.ts` nếu cần ownership riêng cho download listener/file check, không module chiến lược export.

- [ ] RED export reward 0 + không download event → business UNKNOWN, không completed; download event rồi failure/cancel → business FAIL; file sai/0bytes/wrong MIME → FAIL; event+finished+validbytes → PASS; cùng filename hai account không ghi đè.
- [ ] Gắn listener trước click; lưu event started riêng. Chờ terminal download/save trong deadline đã chọn **trước** test; no event khác failed/timeout. Không log “Đã tải file” ngay từ suggestedFilename.
- [ ] Nếu helper được tách, contract: `observeExportOutcome({ page, signal, deadlineAt, artifactDirectory, stepAttemptId, expectedAssetRef }, clickOnce): Promise<StepResult>`. Owner cấp directory unique `(run,session,attempt)` ngoài repo; `clickOnce` chỉ được gọi1 lần; helper không tự query/generate/bấm lại.
- [ ] Lưu file qua đường lifecycle Playwright được docs/capability probe xác nhận, kiểm byte size/MIME/magic/hash sau hoàn tất; cap30MiB cho sample-image export diagnostic là policy phải ghi trong contract, oversize là UNKNOWN/policy-limit không “vendor lỗi”. Không biến API fetch thay download UI thành PASS.
- [ ] Export writer cùng `SessionEvidenceBudget` của recorder/screenshot Task3. Reserve cap artifact trước save, commit kích thước thực hoặc release phần dư sau terminal; hếtbudget thì không bắt đầu thêm delivery/save mutation, báo policy-limit. Temp/browserdownload bytes ngoài sink phải đo riêng, không tuyên bố kiểmsoát toànRAM/diskbrowser.
- [ ] Client toast/pageerror thu từ Task5; business error hiện rõ ngay cả task_status4. User Stop/cleanup khi còn pending ghi cancelled, không ghi complete. Remove listeners sau terminal; event muộn không cập nhật attempt mới.
- [ ] `ensureNodeToolbar` fatal catch và hover deadline xử lý ở Task 13; Task 10 không nhét fix selector không liên quan.

**Chạy:** test mới + runner/progress tests kể trên. **Hoàn tất:** xác nhận code phân loại export đúng; **chưa khẳng định đã sửa nguyên nhân export UI của live trước**, vì toast/client failure không được thu lúc đó.

## Task 11: S03–S09 auth/bootstrap — đo đúng nơi thiếu request

**Files:** `src/main/services/capcut/auth.ts`, `src/main/services/capcut/signup.ts`, `src/main/services/capcut/login.ts`, `src/main/services/capcut/trial.ts`, `src/main/services/capcut/runTasks.ts`, `src/main/services/capcut/missionRunner.ts`, `src/main/services/capcut/taskApi.ts`; chỉ sửa branch được regression chứng minh.

- [ ] RED branch signup/login, form readback, DOB selected-value, OTP mailbox/time binding, URL-only auth không PASS, overlay trước workspace; secrets chỉ log match boolean. Reuse `auth.test.ts`, `verifiedTyping.test.ts`, `trial.test.ts`, `capcutSignupPath.test.ts`.
- [ ] Bootstrap tách substep S09 navigate/entry/action/popover/request/body; before mỗi action có scope/capture. Listener attached/disposed/cap-count rõ, diagnostic không tự reload trước khi ghi nhánh đầu lỗi.
- [ ] RED fixture expected reward request absent nhưng `/lv/v2/task/get_task_list` emptyHTTP200 có mặt: bootstrap không PASS, mission mutation0; HTTPreject/empty/malformed/bodymissing/oldrequest là các reason khác.
- [ ] Không thay auth/parser/URL khi chưa có bằng chứng nguyên nhân. Measurement card F03 ghi predicate/action nào cần chụp ở targeted live; offline xác nhận recorder phân biệt được no-request và unreadable-body.
- [ ] Giữ bootstrap30s; deadline của substeps là remaining budget, không30s mỗi substep. No-response sau possible mutation không tạo automatic retry.

**Chạy:** `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/auth.test.ts src/main/services/capcut/__tests__/verifiedTyping.test.ts src/main/services/capcut/__tests__/trial.test.ts src/main/services/capcut/__tests__/bootstrap.test.ts src/main/services/capcut/__tests__/taskListDiagnostics.test.ts src/main/services/__tests__/capcutSignupPath.test.ts`.

**Hoàn tất:** diagnostic phân loại được F03 và auth từng step; actual bootstrap root cause chỉ được đóng sau targeted evidence, không ép test xanh bằng endpoint khác.

## Task 12: S12–S20 Inspiration/Design/canvas — chặn fallback và kiểm từng leaf

**Files:** `src/main/services/capcut/steps.ts`, `src/main/services/capcut/missions/designStudio.ts`, `src/main/services/capcut/diag.ts`; reuse tests `simpleActions.test.ts`, `chatAcknowledgement.test.ts`, `designWorkspace.test.ts`, `canvasPromptActivation.test.ts`, `canvasPromptReady.test.ts`, `canvasFlowTimeout.test.ts`, `boundedEvaluation.test.ts` trong `src/main/services/capcut/__tests__/`.

- [ ] RED Send disabled → no Enter/no click/false-or-StepVerificationError; native/outertimeout không bị catch thành absent. Fix chỉ nhánh clickSend đã biết; các caller phải đối chiếu false, không log đã gửi.
- [ ] RED Inspiration wrong workspace/no acknowledged submit → không tiếp chat; chat prompt không readback → không send; upload filechooser xong nhưng upload/bind fail → không vào canvas selection.
- [ ] RED nested ancestor inert/aria-hidden/duplicate panel; fix predicate waitNotInert phù hợp guard, không force CSS. Readback canvas phải đúng normalized expected value, không `includes` chấp nhận text dư cũ.
- [ ] RED Stop-generating của chat nhưng canvas không ack → S19UNKNOWN/FAIL. Chỉ scoped panel/message correct mới ack; canvas-ready đã chọn đúng không click lại area.
- [ ] Sau mỗi leaf action gọi verifier Task6 trong quỹ group; proof thiếu dừng trước leaf sau. Parent Design chỉ kiểm khi children đủ, không request/action riêng.
- [ ] S20 result observation theo decision Task1: không tự thêm Apply/generate mutation. Contract chưa chốt → qualification blocked, không business pass từ task reward.

**Mẫu branch sửa tối thiểu F04:**

```ts
if (!(await waitEnabled(send, timeoutMs, options.signal))) return false;
await humanClick(page, send, options);
return true; // only dispatched/settled; caller still verifies ack and reward
```

**Hoàn tất:** mỗi substep có before/terminal và next-call suppression; report giữ reward facts và không vượt step lỗi. Kiểm riêng ảnh hưởng clickSend tới Inspiration/chat; canvas Send là caller riêng không được bỏ qua test.

## Task 13: S21–S24 Video send/generate/toolbar

**Files:** `src/main/services/capcut/missions/videoStudio.ts`; tạo `src/main/services/capcut/__tests__/videoSend.test.ts`, `videoGeneration.test.ts`; reuse `videoExportOutcome.test.ts` từTask 10, `uiInteractionCoverage.test.ts`, fixtures toolbar ở `tools/fixtures`.

- [ ] RED mode không thật là Image/prompt readback sai/Send còn disabled: no submit. Kiểm boolean waitEnabled hiện đang bị bỏ.
- [ ] RED jobaccepted nhưng nonterminal/node cũ/sai asset: không select/export. New node phải map tới job/asset của prompt; unknown mapping không tự chọn node cuối cho qualification.
- [ ] RED `ensureNodeToolbar` click ném fatal/Stop: không retry node, đọc toolbar hoặc input tiếp. Ordinary error giữ branch rõ, không catch-all.
- [ ] Hover fallback: native timeout8s/signal + outer9s, bỏforce; normalize native TimeoutError; no-next-hover/tooltipread sau fatal. Expected exported node testid phải scope đúng toolbar/node.
- [ ] Export-only reuse asset chỉ khi prerequisites/owner/hash thật; không auto `generateImage()` vì canvas rỗng trong targeted test mà chưa duyệt chi phí. Nếu cần tạo asset, step prerequisite xuất trong phiếu test.
- [ ] Verify send → generate → ready → select theo step, không đợi tới group-end; không mất send/gen reward khi export fail.

**Chạy:** `npx --userconfig=NUL vitest run src/main/services/capcut/__tests__/videoSend.test.ts src/main/services/capcut/__tests__/videoGeneration.test.ts src/main/services/capcut/__tests__/videoExportOutcome.test.ts src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts`.

## Task 14: S10–S11 PWA/push và task cha — không tạo mutation thừa

**Files:** `src/main/services/capcut/missions/simple.ts`, `src/main/services/capcut/missionRunner.ts`; tests `src/main/services/capcut/__tests__/simpleActions.test.ts`, `simple.test.ts`, `popoverLifecycle.test.ts`, `missionRunner.test.ts`.

- [ ] PWA: giữ record “synthetic appinstalled dispatched” riêng; không gán installation complete. Contract install thật cần capability/UI accepted mà Task1 chốt; unsupported cấm workflow qualification, không giả bằng rewardrequest.
- [ ] Push: before permission → newpage → Allow/Go/row từng action có binding. RED permission granted nhưng subscription unavailable phải theo contractUNKNOWN, không suy từpermission.
- [ ] RED action đầu đã có exactproof+freshsnapshot và C đủ → không click action còn lại phát duplicate8001001. Nếu C chưa đủ, không tự skip; thêm measurement mà không spammutation.
- [ ] Bỏ force trên row chỉ sau fixture chứng minh đúng hit target; error after first action vẫn giữ proof trước. Tabclose không đóng peer; Stop không restorefocus/input sau fatal.
- [ ] Parent + precompleted lấy snapshot hợp lệ và quan hệ server, không làm thêm action để đủ 12 receipts; thiếu key trong snapshot không được fabricate.

**Hoàn tất:** đã có phân loại/trình tự đúng; PWA/push HTTP equivalence vẫn browser-required cho tới khi có bằng chứng riêng.

## Task 15: Nghiệm thu offline, tương tác thật trên fixture và review toàn delta

**Files test chính:** `src/main/services/__tests__/AutomationRunService.test.ts`, `src/main/services/__tests__/fixtures/deterministicRunHarness.ts`, `src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts`, `src/main/services/capcut/__tests__/uiQuarantineOwnership.test.ts`, `scripts/__tests__/verify-independent-profiles.test.mjs`, `scripts/__tests__/verify-rollout-evidence.test.mjs`.

- [ ] Chạy C01–C10 của spec tại3/10/20 worker fake: worker1 held;2/9/19 peers finish trước release; before failure mutation0; after dispatch unknown mutation1 qua restart; same IDs/page/proof không lẫn; Stop exactly once; failed stop → global fail-closed; optional capture failure không global barrier.
- [ ] Vận hành original helpers trên generated local web fixtures để kiểm locator/filechooser/real download started→failed/completed, screenshot mask, popup/stream. Không dùng fake `click` tự trả thành công để chứng minh browser/vendor.
- [ ] Synthetic burst capture và test recorderON/OFF: event-loop lag/peakRSS/queuepeak/bytes/omissions, zero unbounded raw reads. Không đặt arbitrary throughput SLA; sai isolation hoặc critical gap là FAIL bất kể nhanh.
- [ ] Toàn bộ kiểm tra local dưới đây tuần tự khi có SQLite/native rebuild; mỗi lệnh kiểm exitcode trước lệnh kế:

```powershell
npm --userconfig=NUL run rebuild:node
npx --userconfig=NUL vitest run
npm --userconfig=NUL run typecheck
npm --userconfig=NUL run lint
npm --userconfig=NUL run selectors
npm --userconfig=NUL run build
npm --userconfig=NUL run test:electron
npm --userconfig=NUL run rebuild:node
```

- [ ] Electron harness chỉ local; đọc script trước khi chạy để chắc không provider call. GUI/native hoặc network phụ thuộc tool sandbox phải xin phép đúng cơ chế, không bypass.
- [ ] Review toàn delta kể từ baselineTask1, không chỉ HEADdiff; map từng spec requirement tới test. Không chạy live nếu Task 8 restart binding/capturecritical/stepcounter còn fail.

**Hoàn tất:** `READY_FOR_AUTHORIZED_TARGETED_TEST`, không `PROJECT_FIXED`.

## Task 16: Chạy live có giới hạn và tìm nguyên nhân thật

**Phụ thuộc:** Task1 business scope phù hợp với nhánh test; Task2–15 đạt theo nhánh; source hash cố định. **Tái sử dụng:** `scripts/live-capcut-run.mjs`, `scripts/live-capcut-options.mjs`, `scripts/verify-independent-profiles.mjs`, validator đã mở rộng Task 9. Không tạo runner bỏ qua ownership để test nhanh.

Mọi phiếu phải ghi exact targetstep, prerequisites, account/source, registryidentity, costquote/currency, provider flag/cap,1 attempt, timeout, evidenceexpected và cleanup. Tên lệnh mới chỉ sử dụng sau Task 9 có parsing/tests/help; không bịa CLI hiện đã hỗ trợ stopstep.

| Thứ tự | Phạm vi | Trần xin duyệt từng lượt | PASS / điểm dừng |
| --- | --- | --- | --- |
|V1|3 Multilogin no-account + localfixture recorder mới|0 mail,3 profiles,3 rounds,5 phút|Input/stream/download fixture đúng; resources0; targetcoverage rõ|
|V2a|S09bootstrap + auth prerequisite|0 mail nếu được duyệt reuse đúng testaccount; tối đa1 fresh nếu cần;10 phút|Phân biệt entry/overlay/route/auth/business/filter. Dữ liệu đủ thì chọn đúng fix; chưa đủ phải ghi thiếu gì, khôngfull flow|
|V2b|S24–S26export + approved readyasset|Tương tự V2a; generation nếu cần phải liệt kê riêng|S25request → clienterror/downloadterminal → artifact; không dùng reward 12 làm PASS|
|V3|1 fresh stepwise S00–S28|1 mail,1 round,15 phút|Step nào fail/unknown dừng account; mọi step đạt và cleanup0 mới qualificationpass|
|V4|3 fresh độc lập, cùng build|3 mail/lượt,15 phút; thêm một lượt xác nhận3 cần duyệt riêng|3/3business+reward+coverage+cleanup, validator independentPASS; không barrier|
|V5|10 fresh|10 mail, budget riêng sau2 lượt 3 sạch|10/10cùng tiêu chí, đo resources/timing; không đạt thì không lên20|

20 chỉ offline ở kế hoạch hiện tại. Không tự thêm rolloutStage20. 7/8email chỉ là estimate một đường qualification không phát sinh retest; tổng thực phụ thuộc số lượt được duyệt, theo công thức spec §9. Authorized cap hiện tại vẫn0.

**Nếu live tìm được lỗi:** lập phiếu Fxx → failingfixture/smallrepro → taskfix nhỏ quay đúng Task 10/11/12/13/14 → reviewer → retest đúngstep. Không sửa source trong khi live đang chạy. Hai lần cùng thiếu một tín hiệu mà không bổ sung measurement thì cấm chạy lần3 chỉ để hy vọng qua.

**Báo cáo mỗi step:** expected/actual, action+requestIds, HTTP/businesscode, client/ảnh/file, reward snapshot, verdict, cause-confidence, ảnh hưởng, fix/test cần làm, elapsed/cost. Bước đã pass giữ nguyên; không ghi “không biết” mà thiếu câu hỏi đo tiếp.

## Task 17: Bàn giao hồ sơ chuẩn bị HTTP — chưa chuyển transport

**Files:** `tools/http-contracts/README.md`, paired fixtures đã redacted và manifest trong `tools/http-contracts/`; `src/main/services/capcut/http/contractRegistry.ts` chỉ audit gate, không enable dormant execution.

- [ ] Mỗi nghiệp vụ có method/origin/path/schema/field-origin/dependency/lifetime, build+run+step provenance, safeerror cases, mutation/cost/retry/unknown reconcile và businessartifact proof.
- [ ] Không `captured` nếu orphan; không `fixture-verified`→tự dispatch; reward-only không trở thành operation contract. BrowserHTTP và native HTTP ghi riêng; PWA/push/creativeclient-dependent phải browser-required nếu chưa thay được.
- [ ] Sau UI V4 đạt mới lập plan HTTP theo từng operation: passivebuilder khôngsend → approved read → approved single mutation → native-equivalence →3/10qualification. Không gửi UI và HTTP mutation cùng task, không fallback sau UNKNOWN.
- [ ] Rawprivate/credentials/cookie/signedURL không vào fixtures. Safe normalizer report đủ đối chiếu request từ input/dependency thật của account, không replay token từcapture.

**Hoàn tất:** inventory dùng được để viết plan HTTP riêng; **không** tuyên bố tool đã thuần HTTP hoặc mọi browser capability có thể thay bằng request.

## Cổng triển khai và bàn giao

- Đợt bắt đầu nên duyệt **Task1–5 (offline)**: model, recorder và normalizer; không chi phí email. Đây là nền để các phép đo tiếp theo có giá trị, không giả đã sửa nguyên nhân export/bootstrap.
- Task6–9 là thay đổi an toàn/correlation/persistence/counter có phạm vi rộng: review riêng trước khi ghép vào missions. No schema migration tự chạy vào DB production chỉ vì test cần.
- Task 10–14 triển khai từng cluster, đầu ra rõ; không gom mọi fix vào một lần build rồi chỉ test full flow.
- Mỗi task có ảnh hưởng rộng được nêu tại file list và caller tests; failure thông thường localaccount, safetyexceptions global đúngspec. Không có shared input lock mới.
- Ledger ghi files/hashes/testcommands/reviewer/findings/residuals và nexttask. Khi bị ngắt, tiếp tục task chưa qua review; không lặp mail/live hay làm lại task đã xong.
- Bàn giao code không chỉ test count: có bảngS00–S28, các Fxx còn mở, capturecoverage, mutationfences, migrationstate, nativeABI, resourcecleanup và liveapprovalstatus.

### Checklist chất lượng bản plan

- [x] Task nhỏ, thứ tự phụ thuộc, file ownership và RED/GREEN cụ thể.
- [x] Spec S00–S28 và F01–F10 được ánh xạ; 12 task không bị đổi thành12 do_action.
- [x] StepFailure/DiagnosticBoundary đi xuyên runner→owner→counter, không bị proof 12 xoá lỗi.
- [x] Request-origin cũ, restartunknown, providercapture và budget đều có task riêng.
- [x] Live không được dùng để thử recorder chưa qua offline; native HTTP chỉ giai đoạn sau.
- [x] Review độc lập bản thi công: 5 finding Important đã sửa; scoped re-review không còn Critical/Important. Minor còn lại về ownership `evidenceBudget.ts` đã được ràng buộc bằng shared-instance contract, không chặn triển khai.
- [ ] Người dùng duyệt implementation; mọi live/purchase/rawcapture vẫn cần duyệt riêng.

**Giới hạn tài liệu:** những đoạn TypeScript là interface/kịch bản triển khai, không code đã tồn tại. Context7 không có công cụ trong phiên lập plan; lúc code dùng Playwright/CDP/AsyncLocalStorage phải đối chiếu docs/type đang cài và probe local, không suy vendor hỗ trợ từ trí nhớ. Không có lệnh live nào được chạy trong lượt lập plan này.
