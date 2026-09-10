# ToolCapCut — coverage audit từng file/hàm

## Quy ước và giới hạn

Snapshot: HEAD dd8a16e + working tree Antigravity hiện tại ngày 10/09/2026. Hash SHA-256 khóa nội dung từng file đã đọc, không dùng commit hash thay dirty source.

- **D**: toàn file production/script đã đọc, gồm functions/methods/callbacks; flow/caller thuộc domain đã trace. D không phải PASS/runtime coverage100%.
- **T**: toàn test/helper file đã đọc; đã kiểm mục đích assertion/mock, không suy test xanh chứng minh mọi case.
- **P**: probe cụ thể mô tả trong [report findings](2026-09-10-full-file-audit.md). Không phải mọi file/hàm đều có P.
- Symbol `name@line` là index cú pháp từ TypeScript AST để tìm hàm sau khi review. Callbacks không tên được đếm riêng và nằm trong phần đọc file; count không phải branch coverage. Class prefix có thể áp cho nested callback trong method.
- Không chạy live script/provider tests, không sửa source. Không đọc `.env`/credential payload thật để audit. Generated artifacts/node_modules/private captures không được coi là source để sửa.

## Tổng kết coverage

| Nhóm | File đã đọc | Phạm vi |
|---|---:|---|
| src/main/services/capcut | 79 | Auth/trial/default tasks, legacy missions, HTTP/native/capture, launcher |
| src/main/services ngoài capcut | 21 | Runtime/worksource/purchase/proxy/settings/CRUD/logging |
| src/main core ngoài services | 44 | Bootstrap/lifecycle/IPC/DB/migrations/repos/providers |
| renderer/preload/shared | 75 | UI/controllers/contracts/schemas/types |
| scripts/tools JS/TS | 49 | Diagnostic/live/verification/build, chỉ đọc |
| tests/helpers src/scripts | 168 | 163 default test files; 3 live test files +2helpers ngoài test mặc định |
| Go/config/CSS/HTML | xem cuối | Bổ sung ngoài inventory JS/TS |

219 production TS/TSX files, 38.255 dòng; 1.319 named callable declarations +1.251 anonymous callbacks. 49 scripts/tools có252 named callables. 168 test/helper files khoảng43.610 dòng, đã đọc bodies/helpers, không chỉ tên tests. Line count tính dòng cuối rỗng có thể hơn Get-Content một dòng.

## Tìm theo chức năng

- Signup/DOB/terms/pacing: A01–A05.
- Runtime/resource/persistence: M01–M07, C01–C03.
- UI editing/async/logs/dialogs: B01–B10.
- Legacy/dormant: D01–D05, không phải default do_action.
- Không finding riêng được xác nhận không có nghĩa bảo đảm không còn bug.

## A — CapCut production

### src/main/services/capcut/auth.ts

D · 160 dòng · SHA-256 `8d6192337da379b58d8ff5b03e98d56f00569a9b9f5cccf14fd0a4398c9cf849`.

Chức năng/ranh giới: Already/login/signup routing; fallback limits, account identity and abort forwarding.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `looksExisting@80`, `RecoveryLoginError.constructor@88`, `isRecoveryLoginError@94`, `ensureInApp@101`, `assertInApp@156`.

Callback/anonymous callables: 1.

### src/main/services/capcut/cancellation.ts

D · 68 dòng · SHA-256 `bbac52c3ec765d89b4b6cad007a060994c646ce142b6cfac766d546be85e0dbb`.

Chức năng/ranh giới: Abort race, abortable timer và bounded read; waiter cancellation khác remote-operation cancellation.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `abortable@1`, `abortableDelay@15`, `OperationDeadlineError.constructor@28`, `DomReadTimeoutError.constructor@33`, `isDomReadTimeout@36`, `boundedDomRead@42`, `withinDeadline@56`.

Callback/anonymous callables: 8.

### src/main/services/capcut/captureRedaction.ts

D · 83 dòng · SHA-256 `5fe1a918cd72c8fa6814cc6d42adc966050ca9e4c7fd3f313cfd027101924203`.

Chức năng/ranh giới: Canonical redaction for capture refs, fields, URLs, headers and nested response data.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createCaptureRedactor@13`, `ref@15`, `field@20`, `value@21`, `responseValue@39`, `url@59`, `headers@72`.

Callback/anonymous callables: 9.

### src/main/services/capcut/diag.ts

D · 308 dòng · SHA-256 `1d9c646cad4592a3ead506e66e6319a946525f35cb7b3eaf7ac4c1c5a08dbb58`.

Chức năng/ranh giới: Bounded screenshots/HTML, file pruning, inert/hit checks và passive network diagnostics.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `classifyNetError@25`, `StepError.constructor@34`, `setDumpDir@62`, `getDumpDir@66`, `captureStepScreenshot@82`, `alias@84`, `randomScreenshotId@104`, `pruneDumps@128`, `dump@151`, `mustSee@179`, `assertNotInert@206`, `assertHittable@237`, `waitNotInert@267`, `attachNetDiag@289`, `hook@292`.

Callback/anonymous callables: 16.

### src/main/services/capcut/evidenceBudget.ts

D · 76 dòng · SHA-256 `10d7538104639a9d5acdce0953d6f1f020c9178339c7988b1666b197435bef29`.

Chức năng/ranh giới: Byte reservations/commit/release và bounded evidence accounting.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `assertNonNegativeBytes@20`, `SessionEvidenceBudget.constructor@32`, `SessionEvidenceBudget.reserve@38`, `SessionEvidenceBudget.settle@47`, `SessionEvidenceBudget.commit@55`, `SessionEvidenceBudget.snapshot@66`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/accountSession.ts

D · 68 dòng · SHA-256 `ed840b7cde8c9805a96db6a1d275d2493e24e842c10b13a31b837e1eb4d1eb7f`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `assertAccountHttpSessionInput@27`, `createAccountHttpSession@50`, `assertAccountHttpSessionUsable@64`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/acknowledgeExport.ts

D · 93 dòng · SHA-256 `504767ba04a17f3acf851c645c0563a34058bdbbb128813a23dafd18f38b814a`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `acknowledgeExport@18`, `readSnapshot@32`.

Callback/anonymous callables: 13.

### src/main/services/capcut/http/authHttp.ts

D · 59 dòng · SHA-256 `05ac9b9e047255c956ebf300b4ac5d39865ea68fcf8c87a4dcedb5c6c7c2cc95`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `assertAuthContext@11`, `authHeaders@18`, `requireDynamic@22`, `form@27`, `checkEmailRegistered@32`, `sendEmailCode@38`, `registerVerifyLogin@43`, `readAuthenticatedAccount@50`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/browserHttpSession.ts

D · 49 dòng · SHA-256 `67c1fe33b047ff28e7ff3ef389f00a8ff739c876be50aae850ddcae5bf4c3c41`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `restoreCapturedCookies@7`, `sendDesignInBrowser@20`.

Callback/anonymous callables: 3.

### src/main/services/capcut/http/CapcutHttpClient.ts

D · 186 dòng · SHA-256 `b37b3520263761d7409730a6ab5d312cc9be6946b113aa35849dfe87cb7b127d`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `CapcutHttpClient.constructor@31`, `CapcutHttpClient.fromRequestContext@43`, `CapcutHttpClient.fromAccountSession@47`, `CapcutHttpClient.requestJson@53`, `CapcutHttpClient.requestForm@109`, `CapcutHttpClient.requestText@142`, `CapcutHttpClient.dispatchSigned@161`.

Callback/anonymous callables: 2.

### src/main/services/capcut/http/capturedCreatorAsset.ts

D · 29 dòng · SHA-256 `2163b7536054ac2a1cb024a45ecd658761de0f1f1d4484e93342d42890b3a9b0`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `queryAndDownloadCreatorAsset@7`.

Callback/anonymous callables: 5.

### src/main/services/capcut/http/capturedCreatorExport.ts

D · 72 dòng · SHA-256 `eae9b682208cbe7684d60aab775509fa80d61d777056230c35f34d567510c679`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `exportCapturedCreatorAsset@18`.

Callback/anonymous callables: 8.

### src/main/services/capcut/http/capturedCreatorGenerate.ts

D · 119 dòng · SHA-256 `a6885c4d450bc515499c4bbe4aad17ce5dc5d24c22ccdeab5bc284dd09209784`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `wire@10`, `replaceStrings@29`, `postJson@35`, `runCapturedCreatorGenerate@41`, `observeCreatorConversation@71`, `confirmCapturedCreator@106`.

Callback/anonymous callables: 11.

### src/main/services/capcut/http/capturedDesignChat.ts

D · 122 dòng · SHA-256 `9d3e02969ba79d29f189dd5ec561df237b0ccc4f61bc79031bd5f7e70971514e`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `capturedWire@13`, `runCapturedDesignChat@42`, `dispatchJson@113`.

Callback/anonymous callables: 11.

### src/main/services/capcut/http/contractRegistry.ts

D · 66 dòng · SHA-256 `c2791e35e9c449404ed765f38bd2ef10156d6208e3b0ae666ebc54076182f961`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `HttpContractRegistry.register@24`, `HttpContractRegistry.registerMany@31`, `HttpContractRegistry.fromManifest@35`, `HttpContractRegistry.get@49`, `HttpContractRegistry.assertDispatchable@55`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/creator.ts

D · 28 dòng · SHA-256 `0f89ca307e3ebe6961964dcf6ca7b1a18f9902b625855d87672003512b2afce2`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sendCreatorMessage@5`, `pollCreatorEvent@9`, `queryGeneration@13`, `submitDraftChanges@17`, `fetchDraftVersion@21`, `updateCanvasCover@25`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/creatorExport.ts

D · 35 dòng · SHA-256 `8c829f27b65b3092229ae6029e982e30d766d68445ef868c13088f5c94a8b21e`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `exportCreatorAsset@18`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/creatorFlow.ts

D · 188 dòng · SHA-256 `b62dbe64faefa9da332bc36b9d78fb494d824db60117806c7fd124f6cfa9ca75`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `cloneBody@32`, `preparedIdentity@37`, `assertMutationAccepted@46`, `parseCreditAmount@58`, `readSseMatch@67`, `eventConversation@107`, `runCreatorHttpFlow@112`.

Callback/anonymous callables: 3.

### src/main/services/capcut/http/cycleTlsContext.ts

D · 490 dòng · SHA-256 `bfe7ab1d6c007a57bfac95594536444df11d6e64a3751d2e1586d63da9899291`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `positiveInteger@54`, `validateUrl@60`, `validateHeaders@74`, `requestBody@88`, `targetUrl@98`, `flattenedHeaders@108`, `responseMetadata@118`, `bufferedResponse@133`, `status@139`, `ok@140`, `headers@141`, `headersArray@142`, `body@143`, `text@144`, `json@145`, `dispose@146`, `streamResponse@150`, `fail@172`, `abort@180`, `dispose@183`, `status@200`, `ok@201`, `headers@202`, `headersArray@203`, `[Symbol.asyncIterator]@205`, `seedInitialCookies@241`, `seedInitialResponseCookies@254`, `applyResponseCookies@286`, `createCycleTlsContext@294`, `serializeJarOperation@318`, `driver@324`, `close@335`, `dispatch@363`, `reject@414`, `fetch@449`, `get@459`, `stream@469`.

Callback/anonymous callables: 24.

### src/main/services/capcut/http/cycleTlsProtocol.ts

D · 92 dòng · SHA-256 `24cd65929d7a1692522a32e125076b5017675dfd7b59ac6b5a6f4a9940fced02`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `Reader.constructor@13`, `Reader.u16@15`, `Reader.u32@22`, `Reader.string16@29`, `Reader.bytes@33`, `Reader.done@40`, `Reader.require@44`, `parseCycleTlsFrame@51`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/cycleTlsRuntime.ts

D · 447 dòng · SHA-256 `6f3f8e524935d9119aa576ae718e845a13b6177db1c49de3602d7bb260bc7498`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `BoundedAsyncQueue.push@66`, `BoundedAsyncQueue.end@72`, `BoundedAsyncQueue.fail@77`, `BoundedAsyncQueue.[Symbol.asyncIterator]@83`, `BoundedAsyncQueue.next@84`, `resolveCycleTlsExecutable@94`, `allocateLoopbackPort@105`, `reserveUniquePort@117`, `childEnvironment@127`, `proxyUrl@132`, `validatedCycleTlsProxy@140`, `assertCycleTlsProxyForTarget@163`, `fingerprintOptions@169`, `runtimeError@182`, `awaitReady@184`, `finish@188`, `onData@196`, `connectSocket@211`, `finish@213`, `onOpen@220`, `onError@221`, `socketData@227`, `validateRequest@232`, `validatedCycleTlsFingerprintOptions@240`, `stopChild@251`, `createCycleTlsDriver@268`, `clearPending@314`, `cancel@319`, `failAll@326`, `handleFrame@330`, `dispose@338`, `request@382`, `dispose@419`.

Callback/anonymous callables: 35.

### src/main/services/capcut/http/designCanvas.ts

D · 54 dòng · SHA-256 `d0d4a8f725ef69bcb22f506907078097b0b2fd572037db2334a2c195227ecfa8`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `submitCanvasEdit@20`, `nonempty@21`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/designReceipt.ts

D · 35 dòng · SHA-256 `a4a11f995de421fd0af67b7fe9a1883a902cffabc22567f4262fc2414db9a5d0`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `inspectDesignReceipt@2`, `scan@14`.

Callback/anonymous callables: 7.

### src/main/services/capcut/http/designStudio.ts

D · 39 dòng · SHA-256 `a190da19c0d548a869c40a0130fb490a5428ada0e88ea39777c4a35aa879b026`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `submitDesignChat@21`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/discoverCanvasRequest.ts

D · 64 dòng · SHA-256 `d921e4d82bd606a1dd930b36915093bff7998b6a6a6291abd45fc28279ae5167`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `discoverCanvasRequest@6`, `intercept@17`.

Callback/anonymous callables: 5.

### src/main/services/capcut/http/finishCanvasReceipt.ts

D · 76 dòng · SHA-256 `aabd13251d01d90e9b8d9d8b08477e712eef6721f352f137345b714ac4022609`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `finishCanvasReceipt@11`, `snapshot@42`.

Callback/anonymous callables: 17.

### src/main/services/capcut/http/httpMissionStrategy.ts

D · 56 dòng · SHA-256 `c0a4e45d0480e691c163f045b2b0e4600552f558c66318c586618e5ba4704e0f`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `HttpMissionStrategy.constructor@18`, `HttpMissionStrategy.designChat@25`, `HttpMissionStrategy.requestContext@37`, `HttpMissionStrategy.mark@52`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/httpOnlyAccount.ts

D · 25 dòng · SHA-256 `727a1d6ec22bf8c5c67b23bdd3a64430114dbc11e85508cacf09ea14404d7085`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `runHttpOnlyAccount@12`, `getTaskList@18`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/httpOnlyRunner.ts

D · 94 dòng · SHA-256 `5a50f103c5f0069a6715a0a94563a951fb97b203a4487d4c7b81fe796f024e36`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `HttpOnlyRunner.constructor@32`, `HttpOnlyRunner.run@34`, `HttpOnlyRunner.covered@49`, `availableHttpTasks@91`.

Callback/anonymous callables: 7.

### src/main/services/capcut/http/httpOnlyTransport.ts

D · 162 dòng · SHA-256 `4b7f654bf48c8862f68cdf4214a1aa0ff7f66e03c72d88dfa0a56570123feef2`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `validateHeaders@16`, `createHttpOnlyTransport@29`, `execute@34`, `requestStream@76`, `abort@97`, `cleanup@116`, `[Symbol.asyncIterator]@124`, `requestJson@156`, `requestForm@157`, `requestText@158`.

Callback/anonymous callables: 4.

### src/main/services/capcut/http/httpSessionFactory.ts

D · 50 dòng · SHA-256 `46501b7dcdc157c63bd8c55968c5ac6c48eb6aff93582827c6e3914284e5c9a8`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createHttpOnlySession@25`, `dispose@43`.

Callback/anonymous callables: 2.

### src/main/services/capcut/http/httpSignup.ts

D · 588 dòng · SHA-256 `bd01879498723055bc00b0fd0a0535e5aa3956803a39b364e95ac6f68f10f8fb`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `signupHttp@53`, `assertBody@149`, `assertSuccess@161`, `responseRet@165`, `deepFreeze@171`, `bodySnapshot@179`, `responseSnapshot@183`, `contextSnapshot@192`, `abortGate@205`, `snapshotQuery@209`, `serializedBody@222`, `assertPreparedRequestContext@231`, `prepareRequestContext@242`, `createRunBoundary@274`, `preflightContextProvider@294`, `capability@302`, `advanceContext@308`, `baseResult@326`, `signupHttpWithOnboarding@343`.

Callback/anonymous callables: 4.

### src/main/services/capcut/http/httpTypes.ts

D · 54 dòng · SHA-256 `3cec9089187e255eee1ee0c06389148556d78595a4472f1d18c59ea2b48f065e`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/services/capcut/http/imagexUpload.ts

D · 25 dòng · SHA-256 `47471e27535602dc79b7501f6d6df1853e09384f7ac4a59693fa282b089668c5`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `crc32@6`, `uploadImagexBytes@8`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/inspectCanvasAsset.ts

D · 30 dòng · SHA-256 `5619469d3999cc2d2c0cba82378e11be4a0a697b71209b759e661a9484b8e7fb`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `inspectCanvasAsset@4`.

Callback/anonymous callables: 5.

### src/main/services/capcut/http/inspiration.ts

D · 136 dòng · SHA-256 `f082cd8650f7f1d3439f16cb718aca57b3a4ba94745486c208cd1c5357881f1d`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `parseJsonObject@37`, `identity@44`, `requestedAllowanceIdentities@56`, `assertOneTemplate@63`, `assertFreeAllowance@76`, `submitInspirationHttp@96`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/jobPolling.ts

D · 52 dòng · SHA-256 `cd237f3b4b9c12e55aceb6ca05b22fa3b55ed984f472e20a4b82e2c35d3b1a76`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `retryAfterMs@5`, `pollHttpJob@14`, `abort@24`, `onAbort@41`.

Callback/anonymous callables: 3.

### src/main/services/capcut/http/mutationBridge.ts

D · 51 dòng · SHA-256 `99b846fb87839f58977df3c785ab30ee7c9ffd6c0bf5c11da49d0eb5cfac867d`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `attachMutationBridge@24`, `handler@27`.

Callback/anonymous callables: 3.

### src/main/services/capcut/http/nativeHttpContext.ts

D · 51 dòng · SHA-256 `3853b2b1a7655e995f820dafb4d468b957106521bf5ae053cdfe620cd932da2e`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/services/capcut/http/observedTaskRequest.ts

D · 33 dòng · SHA-256 `f3002566c271cbb09cc458099a704c00b1d4f718fc75d2064bcf33102658087f`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `observedTaskRequest@14`.

Callback/anonymous callables: 4.

### src/main/services/capcut/http/passportContext.ts

D · 77 dòng · SHA-256 `41181146a535ae3ec99220aed50f6dc5505a960d961a4d13bed70830f24be7b9`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `requireText@23`, `createPassportRequestContext@30`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/privateCapture.ts

D · 208 dòng · SHA-256 `8c925f84b2322d31db8695e9f043024d4aaffa4af2a6d01df0a294224e26dad6`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `attachPrivateCapture@27`, `warn@51`, `write@54`, `done@73`, `track@84`, `boundedCommand@85`, `boundedDetach@86`, `attach@91`, `save@101`, `bodyCommand@106`, `onPage@171`, `mark@187`, `stop@188`.

Callback/anonymous callables: 24.

### src/main/services/capcut/http/signedRequest.ts

D · 38 dòng · SHA-256 `349f84bd620999fff10c875be3ed87f16ac0af22112f205f5ef5f8cf772a0eda`.

Chức năng/ranh giới: Captured browser request→draft contract; actual Request-vs-draft runtime type checked.

Finding/evidence: D02; xem report để phân biệt probe và source-only.

Hàm/method có tên: `captureNextSignedRequest@15`, `assertSignedRequest@33`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/signupOnboarding.ts

D · 347 dòng · SHA-256 `0fe25d26570a6bde34f7dffaa8b4a617930f9d012468da084c172af152b6d6b1`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `withoutHeaders@122`, `passportHeaders@127`, `productHeaders@131`, `requireText@135`, `assertRecord@141`, `assertSignupBirthday@145`, `assertSignupProductContext@155`, `assertSignupOnboardingContext@162`, `assertSignupOnboardingContextShape@169`, `assertDerivedSignupContext@179`, `assertProductUserInfoBody@187`, `assertWorkspaceReadBody@196`, `requestPassportRegion@205`, `broadcastPassportAuth@225`, `readAgeGateConfig@245`, `checkAgeWithoutUid@263`, `persistBirthdayByUid@283`, `readProductUserInfo@306`, `readUserWorkspaces@326`.

Callback/anonymous callables: 3.

### src/main/services/capcut/http/taskApi.ts

D · 25 dòng · SHA-256 `471920739421a730c8ef0868dd63ee614ff17505f15df304268f32e7bf036c11`.

Chức năng/ranh giới: Task parsing/store/passive monitoring and timestamps; distinguish legacy monitor vs default HTTP validation.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `CapcutHttpTaskApi.constructor@7`, `CapcutHttpTaskApi.getTaskList@11`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/taskClient.ts

D · 51 dòng · SHA-256 `a0020c7ffd6f5c814a854be827b5ea9d8ad0cd714bf73cd9c7c5232f7d21e428`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `record@3`, `optionalText@8`, `parseHttpTaskList@15`.

Callback/anonymous callables: 1.

### src/main/services/capcut/http/taskEvidence.ts

D · 66 dòng · SHA-256 `3a6c089f6833eaa0dfe583908107911cf1d2367d2d54a5dae95106bab006ff25`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `HttpTaskEvidenceReducer.applySnapshot@19`, `HttpTaskEvidenceReducer.applyProof@38`, `HttpTaskEvidenceReducer.markUnknown@54`, `HttpTaskEvidenceReducer.get@59`, `HttpTaskEvidenceReducer.all@60`, `taskIsVerified@63`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/taskMutation.ts

D · 21 dòng · SHA-256 `bdf61c16d0450727ad8cdd3b077f284f99ad12c2d4fe3a89d3775cbc76c2be5c`.

Chức năng/ranh giới: Optional HTTP do_action adapter and response acknowledgement; not default caller.

Finding/evidence: D03; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sendTaskAction@6`.

Callback/anonymous callables: 0.

### src/main/services/capcut/http/taskTypes.ts

D · 27 dòng · SHA-256 `c96c837924c60ab1ceda94ed839b02d49052233c7d229e81d76bc1cd7a8f6446`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/services/capcut/http/trialApi.ts

D · 56 dòng · SHA-256 `081563708969cd2089a0f4f9383c60846c07cdb94bec37699beae2fc7688623b`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `readTrialOffers@17`.

Callback/anonymous callables: 2.

### src/main/services/capcut/http/trialOffers.ts

D · 198 dòng · SHA-256 `943d016204646bc06685686839b92a78138430ab12b27a6c6fe97c1ad63a6b15`.

Chức năng/ranh giới: HTTP/native/captured: payload/response/order/abort/owner/dispose; nhánh riêng, không gán requirement vào default do_action.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `isRecord@48`, `isRet@52`, `isZeroRet@57`, `parseJson@61`, `optionalNumber@69`, `optionalString@73`, `safeEntryRetCode@77`, `parseOffer@84`, `parseEntry@107`, `parseTrialOffers@148`.

Callback/anonymous callables: 5.

### src/main/services/capcut/httpCapture.ts

D · 618 dòng · SHA-256 `15afb266ecabdb8d15c1bf9076aadc522f4d5fe3ceaf558d69bc63c234c0596c`.

Chức năng/ranh giới: CDP request/response correlation, safe capture writes/budgets/output acknowledgement/stop.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `positive@51`, `attachRedactedHttpCapture@57`, `safeAlias@90`, `warn@120`, `omit@121`, `envelope@131`, `omitRecord@132`, `rejectWrite@148`, `settleWrite@153`, `write@173`, `cdpDeadline@203`, `detachTarget@204`, `trackWork@208`, `safeTargetCategory@212`, `allowedTargetUrl@214`, `attachTarget@222`, `requestState@241`, `opaqueFrame@242`, `opaqueSocket@248`, `safeHeaders@253`, `onExtra@254`, `onRequest@262`, `onResponseExtra@286`, `onResponse@290`, `onData@299`, `onSse@303`, `onTerminal@310`, `onWebSocketCreated@315`, `onWebSocketHandshake@320`, `onWebSocketFrame@326`, `onWebSocketError@339`, `onWebSocketClosed@343`, `hookClientPage@373`, `onPageError@377`, `onConsole@381`, `onDialog@386`, `onDownload@391`, `dispose@405`, `onTargetPage@414`, `mimeOf@415`, `decode@416`, `parseRoute@428`, `bodyPolicyEligible@429`, `currentContext@435`, `safely@436`, `onRequest@439`, `writeBody@470`, `accepted@477`, `written@478`, `omitted@479`, `onResponse@482`, `accepted@493`, `written@494`, `terminal@517`, `onFailed@527`, `onFinished@528`, `mark@542`, `markStep@547`, `stop@554`, `persistSummary@586`.

Callback/anonymous callables: 25.

### src/main/services/capcut/httpTasks.ts

D · 665 dòng · SHA-256 `83a2ee762a95ecd984a4c203d0847412392abc5c9f5117b80f3d6eab1d55ed13`.

Chức năng/ranh giới: Numeric user ID → nine do_action → task_list/claim → fresh receipt/pending proofs; default flow preserved.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `validateTaskRows@65`, `resolveNumericUserId@99`, `executeHttpTasks@146`, `preserveTaskEvidence@206`, `fetchTaskList@302`.

Callback/anonymous callables: 45.

### src/main/services/capcut/human.ts

D · 274 dòng · SHA-256 `0b4a1e5e217e0093ee35763b4d63eb99d5ee2bef006a5f5218170e18afa4ae21`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `foregroundPage@25`, `command@43`, `pause@50`, `rethrowInterrupted@54`, `sleep@59`, `rand@61`, `pick@64`, `humanClickUnlocked@66`, `perCharDelayRange@112`, `humanTypeUnlocked@118`, `humanClick@147`, `humanType@158`, `isDisabled@177`, `read@178`, `waitEnabled@195`, `clickIfVisible@208`, `dismissOverlays@235`.

Callback/anonymous callables: 18.

### src/main/services/capcut/image.ts

D · 122 dòng · SHA-256 `e1452b4f0d360a4d00ee0149a5146e794997641aa6dae20ae209ff23e7388bce`.

Chức năng/ranh giới: Pure PNG/CRC generation and owned sample asset storage.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `buildTable@13`, `crc32@25`, `pngChunk@33`, `generatePng@47`, `ensureSampleImage@109`.

Callback/anonymous callables: 1.

### src/main/services/capcut/launcher/ApiV3Launcher.ts

D · 283 dòng · SHA-256 `27bd5810621a5a5dd94b9a664b480bb78b1abe758cad163fdc5d2e91e0d0a47a`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `toProxyConnection@66`, `ApiV3Launcher.constructor@104`, `ApiV3Launcher.resolvePort@122`, `ApiV3Launcher.wait@147`, `ApiV3Launcher.launch@160`, `ApiV3Launcher.stop@239`, `ApiV3Launcher.stopProfile@259`.

Callback/anonymous callables: 8.

### src/main/services/capcut/launcher/BrowserLauncher.ts

D · 397 dòng · SHA-256 `39a9865c403c1c5dc0b1909911fb0da4ae3f9947a5207da9ff72a695ee833561`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `isBrowserLauncherKind@36`, `NO_LAUNCHER_LOG@47`, `defaultSleep@49`, `connectOverCdpWithRetry@142`, `onAbort@160`, `configureHeadedWindowUnlocked@208`, `attachOverCdp@364`.

Callback/anonymous callables: 19.

### src/main/services/capcut/launcher/index.ts

D · 84 dòng · SHA-256 `c49d9fe65de48f6c7885af67a47ef27538a138e5779153569c2e6517d2db9686`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createBrowserLauncher@56`.

Callback/anonymous callables: 0.

### src/main/services/capcut/launcher/XcliLauncher.ts

D · 346 dòng · SHA-256 `63ee525e49c509a230f90e9a01de935ac3443113c4ecc614b35eac11bf02abe6`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `XcliLauncher.constructor@108`, `XcliLauncher.buildArgs@130`, `XcliLauncher.launch@159`, `XcliLauncher.stop@264`, `XcliLauncher.wait@282`, `XcliLauncher.stopViaXcli@304`, `XcliLauncher.killByCdp@337`.

Callback/anonymous callables: 8.

### src/main/services/capcut/login.ts

D · 297 dòng · SHA-256 `241547487dd46bb32f821b3c32ad1d5e839a841df3e6655f1ac7d7daebc06f1e`.

Chức năng/ranh giới: Navigation, verified typing, headings, auth state and onboarding; abort/pacing boundaries.

Finding/evidence: A01, A05; xem report để phân biệt probe và source-only.

Hàm/method có tên: `rethrowInterrupted@47`, `fillVerified@59`, `clickUntilVisible@97`, `isLoggedIn@124`, `loginCapcut@159`.

Callback/anonymous callables: 16.

### src/main/services/capcut/missionRunner.ts

D · 554 dòng · SHA-256 `a18960cc438e77fbb6415540bd85adff2d93ae12f96b89fefcd7ff27d665fb5c`.

Chức năng/ranh giới: Legacy task entries/group evidence/popover/claim reconciliation, not default flow requirement.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `NO_LOG@49`, `selectGroups@61`, `describe@114`, `findTaskEntries@131`, `findTaskEntry@154`, `countTaskRows@160`, `closeTaskPopover@173`, `wait@183`, `assertNoPopover@213`, `reconcileMissionEvidence@236`, `runAct@253`, `remaining@281`, `runGroup@348`, `findTaskRow@380`, `withTaskPopover@408`, `remaining@419`, `waitRows@426`, `tryHere@435`, `claimIfPending@502`.

Callback/anonymous callables: 27.

### src/main/services/capcut/missions/designStudio.ts

D · 384 dòng · SHA-256 `aa222d8a9128f6037d6a4768c9aeac4190c72162b17352ce686bc2afaf6380f2`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `uploadToCanvas@47`, `waitCanvasReady@75`, `hideChatPanel@119`, `canvasPromptIsReady@137`, `openCanvasPrompt@163`, `editOnCanvas@189`, `interaction@202`, `act@309`.

Callback/anonymous callables: 21.

### src/main/services/capcut/missions/simple.ts

D · 240 dòng · SHA-256 `a0db2436588fe1ca0603cf3c0cd355339cda83b8ffa3d4821f9bfaea6d2806aa`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `decideRowAction@36`, `clickGoOnPage@43`, `act@92`, `act@217`.

Callback/anonymous callables: 17.

### src/main/services/capcut/missions/videoStudio.ts

D · 485 dòng · SHA-256 `c66d727b64467d7429c787b93ebb01eff4486188e43b6c5f8ec429e3921a4070`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `openStudio@48`, `selectImageMode@62`, `waitImageEditor@75`, `closeSubscriptionModal@102`, `confirmCredits@121`, `nodeIds@171`, `ensureNodeToolbar@196`, `findExportButton@222`, `generateImage@278`, `waitNodeRendered@347`, `act@380`.

Callback/anonymous callables: 27.

### src/main/services/capcut/overlays.ts

D · 310 dòng · SHA-256 `0bc171fd3fff3028cf9d11bfd62c75990fe91f3a4ae68b054237273846e47fd7`.

Chức năng/ranh giới: Survey/pricing/error overlays, helper budget và visible/hit-state checks.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `requireInteraction@71`, `rethrowInterrupted@77`, `isSurveyBlocking@83`, `skipOnboardingSurvey@98`, `succeed@108`, `closeBlockingPricingModal@171`, `closePageErrorModal@233`, `ensurePageUsable@282`.

Callback/anonymous callables: 22.

### src/main/services/capcut/pageRecovery.ts

D · 77 dòng · SHA-256 `53846984d1b3892a9f9a9b6f76dc8c8723e79c8dc0878008e1a3fb70e07a20f1`.

Chức năng/ranh giới: Primary page watch/choose/replace; account browser ownership.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `PrimaryPageResolver.constructor@10`, `PrimaryPageResolver.watch@19`, `PrimaryPageResolver.isUsableCapcutPage@32`, `PrimaryPageResolver.resolve@41`.

Callback/anonymous callables: 3.

### src/main/services/capcut/prefs.ts

D · 156 dòng · SHA-256 `a1568fc1b28a9fd06f552850e5ec74ad1f1076a553e5955210be2a7ed51726c8`.

Chức năng/ranh giới: Profile preference discovery/seed/write with bounded polling.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `findPreferencesFile@27`, `safeDirs@40`, `disablePasswordPrompt@64`, `applyKeys@77`, `writePrefs@96`, `seedPreferences@119`, `findProfileDir@146`.

Callback/anonymous callables: 4.

### src/main/services/capcut/rendererHealth.ts

D · 47 dòng · SHA-256 `446b2df390b9adb8040fa5589adad51d6660b3d82a3c5f505acccd76c98ece96`.

Chức năng/ranh giới: Renderer geometry/liveness probe và bounded commands.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `checkRendererHealth@11`.

Callback/anonymous callables: 6.

### src/main/services/capcut/runTasks.ts

D · 745 dòng · SHA-256 `e4114ae590b2ac75a7ee059b934881b69457cd97d5cae1bed21b2f26731b544a`.

Chức năng/ranh giới: Default-vs-legacy routing, group rounds, carried proof/snapshot/checkpoint semantics.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `needsFinalSnapshotRefresh@94`, `waitForDelay@131`, `paceGapMs@158`, `buildUnsettledProofs@170`, `mergeGroupEvidence@190`, `summarize@227`, `bootstrap@273`, `log@298`, `verifyRewardStep@304`, `remaining@314`, `tryGet@315`, `claimPending@405`, `runAllTasks@464`, `paceGap@477`, `unsettledFor@528`, `emitCheckpoint@539`.

Callback/anonymous callables: 26.

### src/main/services/capcut/runTelemetry.ts

D · 102 dòng · SHA-256 `ce2ac9f99be8ed8462ec47ffe67a3081b1c46698a8fcf13ab269328b9ba08c31`.

Chức năng/ranh giới: Validated JSONL run evidence, single terminal writer, manifest replacement.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createRunTelemetry@18`, `record@42`, `close@56`, `filePath@98`, `artifactBasename@99`.

Callback/anonymous callables: 1.

### src/main/services/capcut/signup.ts

D · 571 dòng · SHA-256 `315de9c7ad2b1eca71fdedad0b6339e0893437c5153e35d984178ba07d0fda7e`.

Chức năng/ranh giới: Email/password/terms/DOB/OTP/onboarding inputs and readbacks; option/live-locator assumptions.

Finding/evidence: A01, A02, A03, A05; xem report để phân biệt probe và source-only.

Hàm/method có tên: `rethrowInterrupted@71`, `fillVerified@81`, `clickUntilVisible@119`, `getOtpCode@150`, `fillOtp@178`, `acceptTermsIfAny@219`, `readAuthHeading@242`, `handleBirthdayIfPresent@254`, `isInsideApp@339`, `dismissOnboarding@357`, `signupCapcut@405`.

Callback/anonymous callables: 48.

### src/main/services/capcut/stepEvidence.ts

D · 349 dòng · SHA-256 `a08eadc6f4b82eb9e7cb70d832d90e7d3860f72af052e14818794b6b75863a8d`.

Chức năng/ranh giới: Diagnostic evidence input validation, invariants, collector and immutable verdict.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `validateRewardAttempt@94`, `deriveStepVerdict@139`, `immutableResult@159`, `validateStepResult@166`, `StepResultCollector.constructor@250`, `StepResultCollector.record@267`, `StepResultCollector.results@290`, `StepResultCollector.summary@294`, `StepVerificationError.constructor@325`, `DiagnosticBoundaryReached.constructor@342`.

Callback/anonymous callables: 3.

### src/main/services/capcut/steps.ts

D · 441 dòng · SHA-256 `df640a5bba8b9b0cc65e9446ec2d43e6ff5857005c7d16942917c3251420aa2c`.

Chức năng/ranh giới: Legacy upload/editor/chat/inspiration command chain and acknowledgements.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `snap@112`, `uploadImage@131`, `fillEditor@177`, `clickSend@188`, `stepInspirationTemplate@234`, `setFilesOutsideChat@334`, `stepChatWithAgent@366`.

Callback/anonymous callables: 16.

### src/main/services/capcut/taskApi.ts

D · 794 dòng · SHA-256 `7dfe61e2f992c4b79b893eb464106a3382ccb719cf1e13a8215ba8905bfb8541`.

Chức năng/ranh giới: Task parsing/store/passive monitoring and timestamps; distinguish legacy monitor vs default HTTP validation.

Finding/evidence: D01; xem report để phân biệt probe và source-only.

Hàm/method có tên: `parseTaskList@37`, `parseDoAction@81`, `attachTaskListDiagnostics@124`, `identify@135`, `emit@148`, `onRequest@154`, `onFailed@158`, `recordResponse@162`, `onResponse@204`, `stop@207`, `RewardAttemptOverlapError.constructor@275`, `TaskStore.validateAttempt@305`, `TaskStore.beginAttempt@313`, `TaskStore.endAttempt@334`, `TaskStore.registerActionContract@343`, `TaskStore.registerMonitor@355`, `TaskStore.releaseMonitor@370`, `TaskStore.nextRequestId@374`, `TaskStore.bindRequestOrigin@378`, `TaskStore.notifyChange@406`, `TaskStore.pushTaskList@411`, `TaskStore.pushObservedTaskList@415`, `TaskStore.pushAction@440`, `TaskStore.pushObservedAction@444`, `TaskStore.pushGrant@471`, `TaskStore.snapshot@475`, `TaskStore.seenActions@479`, `TaskStore.seenGrants@483`, `TaskStore.verifyRewardStep@487`, `TaskStore.inspect@493`, `TaskStore.cleanup@571`, `TaskStore.onChange@576`, `TaskStore.onAbort@577`, `TaskStore.waitForAction@597`, `TaskStore.cleanup@611`, `TaskStore.onAbort@616`, `TaskStore.resolve@623`, `TaskStore.waitForSnapshot@641`, `TaskStore.cleanup@651`, `TaskStore.onAbort@656`, `TaskStore.resolve@662`, `attachTaskMonitor@684`, `endpointFor@699`, `onRequest@718`, `onResponse@738`, `dispose@783`.

Callback/anonymous callables: 23.

### src/main/services/capcut/TaskEvidenceError.ts

D · 12 dòng · SHA-256 `d93287845cf2ebccd9168e88e54ebe9d180bb315e540c4f53632d1b14c5409d9`.

Chức năng/ranh giới: Typed failure carrying accepted unsettled proof copies.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `TaskEvidenceError.constructor@6`.

Callback/anonymous callables: 1.

### src/main/services/capcut/trial.ts

D · 317 dòng · SHA-256 `06796257de5cbd6fa8d2ba70896e099fd525888f539697ac935232b88a85148b`.

Chức năng/ranh giới: Survey removal, Upgrade candidates, Pro-card parsing và eligible/ineligible/unknown state.

Finding/evidence: A01, A04; xem report để phân biệt probe và source-only.

Hàm/method có tên: `clearTrialSurvey@109`, `openUpgradeModal@143`, `checkProTrial@239`, `fallback@249`, `isEligible@314`.

Callback/anonymous callables: 16.

### src/main/services/capcut/types.ts

D · 174 dòng · SHA-256 `da4279b0f821bb9632e1ae4f731014e796c0d473be8dad61044dafef026841e2`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/services/capcut/uiInteractionScheduler.ts

D · 708 dòng · SHA-256 `d3525192472d163f3511b47425820e223d9a8e8e934841fc98cb65744fd4179d`.

Chức năng/ranh giới: Per-session foreground/editor ownership, FIFO/capacity/abort/poison/drain/confirmed profile-stop.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `RunUiInteractionScheduler.constructor@69`, `RunUiInteractionScheduler.forSession@74`, `RunUiInteractionScheduler.foreground@77`, `RunUiInteractionScheduler.editor@79`, `RunUiInteractionScheduler.confirmProfileStopped@84`, `RunUiInteractionScheduler.closeSession@115`, `RunUiInteractionScheduler.shutdown@122`, `RunUiInteractionScheduler.getSnapshot@165`, `RunUiInteractionScheduler.snapshot@187`, `RunUiInteractionScheduler.enqueue@191`, `RunUiInteractionScheduler.onAbort@231`, `RunUiInteractionScheduler.processQueue@261`, `RunUiInteractionScheduler.runForegroundTicket@307`, `RunUiInteractionScheduler.handler@363`, `RunUiInteractionScheduler.runEditorTicket@431`, `RunUiInteractionScheduler.handler@487`, `RunUiInteractionScheduler.poison@554`, `RunUiInteractionScheduler.drainSessionQueues@573`, `RunUiInteractionScheduler.releaseEditorOwner@586`, `RunUiInteractionScheduler.emitEvent@595`, `createDirectUiInteraction@605`, `run@609`, `foreground@615`, `editor@616`, `mapUiSchedulerEventToEvidence@620`.

Callback/anonymous callables: 14.

### src/main/services/capcut/urls.ts

D · 31 dòng · SHA-256 `9f689dc27485c71e14d991998441c7cd3b73c5742dd0c210d4f113250aba1691`.

Chức năng/ranh giới: URL constants and inspiration key mapping.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `inspirationKey@27`.

Callback/anonymous callables: 0.

## B — Renderer, preload và shared

### src/preload/preload.ts

D · 91 dòng · SHA-256 `6c654a5732cb340c12d8adc9dd6545c0d4f1e3965d2b1beac924f65cf6c8051e`.

Chức năng/ranh giới: Narrow named IPC invoke payloads and wrapped subscriptions/unsubscribe.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `subscribe@25`, `wrapped@26`, `ping@40`, `get@42`, `save@43`, `test@46`, `list@52`, `create@53`, `update@54`, `remove@56`, `export@57`, `tasks@59`, `list@63`, `clear@64`, `onEntry@65`, `start@69`, `health@70`, `userData@71`, `stop@72`, `stopThread@73`, `threads@74`, `progress@75`, `onProgress@76`, `providers@80`, `readOtp@81`, `onStatusChanged@85`.

Callback/anonymous callables: 1.

### src/renderer/app/App.tsx

D · 80 dòng · SHA-256 `063d63200bcb19bc0b267d3f369bd1d26cd307ba5860cf10486d99f6599374ec`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `PreferenceSync@23`, `App@52`.

Callback/anonymous callables: 5.

### src/renderer/app/appPreferences.ts

D · 101 dòng · SHA-256 `1a0fa48454181b0497ad838b51cb9a77bab3b8c0e9fcab295825e6d1f7340eb1`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `normalizeTheme@25`, `normalizeRoute@29`, `readBootPreferences@41`, `persist@59`, `writeBootPreferences@68`, `rememberRoute@81`, `applyTheme@94`.

Callback/anonymous callables: 0.

### src/renderer/components/ui/Badge.tsx

D · 127 dòng · SHA-256 `688d40b49bfdb97fe592e2992aab2a2131309bd494c759e39ca55fe251f959c6`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `Badge@25`.

Callback/anonymous callables: 0.

### src/renderer/components/ui/Button.tsx

D · 46 dòng · SHA-256 `666e5a716f2c9a65ef485f101c96192042fa25c18d0a5dde29ea70e0ef60cd09`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### src/renderer/components/ui/Checkbox.tsx

D · 46 dòng · SHA-256 `dbc4da27e4c34827897c91a839dcbe07b4c7154db34747c0ee450b06541bd007`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### src/renderer/components/ui/DataGrid.tsx

D · 154 dòng · SHA-256 `f248b22ee55e9f947f80f84ec5577f9145fcce3b3f6fa55a6050f2a19fd40800`.

Chức năng/ranh giới: TanStack row/selection/pagination model and complete row rendering.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `DataGrid@43`.

Callback/anonymous callables: 5.

### src/renderer/components/ui/Drawer.tsx

D · 103 dòng · SHA-256 `02441c989af5f3c57f812a4446a78346c74e86a1f5cced34207b8661c9e49897`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `Drawer@17`, `handleKeyDown@28`.

Callback/anonymous callables: 2.

### src/renderer/components/ui/IconButton.tsx

D · 40 dòng · SHA-256 `72b706985c94031322f3953535c14c4a91b04edda1e733dba30751df153ee216`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### src/renderer/components/ui/Input.tsx

D · 52 dòng · SHA-256 `1c33d7969b9d34b8ba4b5a84c23cd72234f1380662214bba4c8db380b8c8654b`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### src/renderer/components/ui/Modal.tsx

D · 104 dòng · SHA-256 `cb41de36f8ac7e75bba65f90ed0be1e3e71c1d52b70d12b05435616ada21c7df`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `Modal@17`, `handleKeyDown@28`.

Callback/anonymous callables: 2.

### src/renderer/components/ui/NumberStepper.tsx

D · 99 dòng · SHA-256 `8eedf64976807a0268613f3edc76294ad1883d46172c6c0d4659cc27fc5cf021`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `NumberStepper@16`, `handleDecrement@26`, `handleIncrement@32`, `handleChange@38`.

Callback/anonymous callables: 0.

### src/renderer/components/ui/Pagination.tsx

D · 67 dòng · SHA-256 `e5d71c42d66000104edcb6094e3276cc8a89c598b7b9f46a6588fe6961bed716`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `Pagination@14`.

Callback/anonymous callables: 2.

### src/renderer/components/ui/Panel.tsx

D · 44 dòng · SHA-256 `9f78a06a323c042419866ca9f609dfb0c93982ee8f8e3cd903ac4a372bf64dc4`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### src/renderer/components/ui/SegmentedControl.tsx

D · 76 dòng · SHA-256 `35b3f9cc431edb2a4dfba7494dd05fdd8e23c59293b7e574066f702e9f1c8d2e`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `SegmentedControl@28`.

Callback/anonymous callables: 2.

### src/renderer/components/ui/Select.tsx

D · 40 dòng · SHA-256 `d1c9a970106d7679a005fb7b1e28aace2c07ad572218b3418786f1614ac0acc1`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### src/renderer/components/ui/Switch.tsx

D · 39 dòng · SHA-256 `c4d20a986aa9a4d87b558fea03b1bc33e7311be3bf5625b9af3f7ac0f98eb96e`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `Switch@12`.

Callback/anonymous callables: 1.

### src/renderer/components/ui/Textarea.tsx

D · 29 dòng · SHA-256 `a42627a04c07524ed6b224c1083e8ec71c33dc08d6199332c22c0368effadb6b`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### src/renderer/layouts/AppHeader.tsx

D · 41 dòng · SHA-256 `cd662a2992a1d5267ca300636f9b6b33e547ea2b23e997b606b3a13563364db8`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AppHeader@11`.

Callback/anonymous callables: 0.

### src/renderer/layouts/AppShell.tsx

D · 25 dòng · SHA-256 `9ef3b0236e774137d716576d6a3171f47e06015d6947ed40f4327b3bb8cbccae`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AppShell@9`.

Callback/anonymous callables: 0.

### src/renderer/layouts/Sidebar.tsx

D · 89 dòng · SHA-256 `f94dc2ac3d41b298cb00b7184091fac826e9482458bb4b661bb4a4a10eb2e81f`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `CapCutLogo@13`, `Sidebar@19`.

Callback/anonymous callables: 4.

### src/renderer/layouts/StatusBar.tsx

D · 98 dòng · SHA-256 `45696ba09f5dc99a3620af2382bb6926af848dfeea0d718523c41255b0758117`.

Chức năng/ranh giới: Initial provider diagnostic states and push subscription display.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `StatusBar@9`, `findStatus@38`, `getStatusDotClass@45`, `getStatusLabel@55`.

Callback/anonymous callables: 5.

### src/renderer/main.tsx

D · 11 dòng · SHA-256 `c6c360c6b86f8dfde2b44bdc48df16d580b822079661d9bb52830387036812a5`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/renderer/pages/Accounts/accountsController.ts

D · 385 dòng · SHA-256 `5c6bc9825384407b8dcea7e40a899de5b3ff74858e23b60ae46f857b60c4c3aa`.

Chức năng/ranh giới: DTO/view mapping, query pagination, CRUD, task/export bridges and error envelopes.

Finding/evidence: B07, B08; xem report để phân biệt probe và source-only.

Hàm/method có tên: `dateFilterToCreatedFrom@39`, `cleanFilter@54`, `toViewAccount@103`, `parseBrowserProfile@138`, `secretOp@150`, `optionalSecret@158`, `AccountsController.constructor@180`, `AccountsController.getState@185`, `AccountsController.subscribe@189`, `AccountsController.setState@196`, `AccountsController.load@203`, `AccountsController.create@278`, `AccountsController.update@310`, `AccountsController.remove@338`, `AccountsController.loadTasks@355`, `AccountsController.exportAccounts@370`.

Callback/anonymous callables: 4.

### src/renderer/pages/Accounts/AccountsPage.tsx

D · 361 dòng · SHA-256 `07b138b0a1247c756506f829e181439f384594565139fc43360b647e346eb4e3`.

Chức năng/ranh giới: Server-paged CRUD/export/task dialogs and selected row owner wiring.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `list@31`, `create@32`, `update@36`, `remove@40`, `export@44`, `tasks@48`, `AccountsPage@55`, `handleEditAccount@159`, `handleEditSelected@164`, `handleClearFilters@174`, `handleAddAccount@184`, `handleSaveAccount@188`, `handleDeleteSelected@192`, `handleConfirmDelete@196`, `onViewTasks@206`.

Callback/anonymous callables: 26.

### src/renderer/pages/Accounts/AccountsSummaryBar.tsx

D · 57 dòng · SHA-256 `7964a6acf994a9bed47b26dfd5ea55dce2c95324d0b0b51b35b351dbb2c5ca5d`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AccountsSummaryBar@8`.

Callback/anonymous callables: 4.

### src/renderer/pages/Accounts/AccountsToolbar.tsx

D · 168 dòng · SHA-256 `0a29d4df9aadbb1462faaefb7b769f98c6a93d160177ca3921b77f979455d277`.

Chức năng/ranh giới: Canonical filters/chips/page controls.

Finding/evidence: B09; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AccountsToolbar@13`.

Callback/anonymous callables: 8.

### src/renderer/pages/Accounts/AddAccountDrawer.tsx

D · 200 dòng · SHA-256 `dcac1153c5e047a4c0fb56ad132e7919aaae48f6225bdd1aa06ce5d867f1f128`.

Chức năng/ranh giới: Form defaults, provider/browser options, create payload and submission/close guards.

Finding/evidence: B09; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AddAccountDrawer@15`, `resetForm@30`, `handleClose@47`, `handleSubmit@53`.

Callback/anonymous callables: 9.

### src/renderer/pages/Accounts/columns.tsx

D · 201 dòng · SHA-256 `01fe4672051eba00f88bf941031494715955e90b9e4edf36950e868d66615cc7`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createAccountsColumns@14`, `header@20`, `cell@29`, `cell@43`, `cell@52`, `cell@63`, `cell@72`, `cell@77`, `cell@92`, `cell@104`, `cell@112`, `cell@136`, `cell@146`, `cell@155`, `header@166`, `cell@168`.

Callback/anonymous callables: 2.

### src/renderer/pages/Accounts/DeleteAccountDialog.tsx

D · 61 dòng · SHA-256 `2ccd8ef6b7ce184f517cc1695ca8958a772cb977b9eba111fd3d283fbff89079`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `DeleteAccountDialog@13`.

Callback/anonymous callables: 1.

### src/renderer/pages/Accounts/EditAccountDrawer.tsx

D · 202 dòng · SHA-256 `eab05ad26c79aa1098b703093b913c0ad8b7ea790d771d4ea4f3691d6e77bba4`.

Chức năng/ranh giới: Account hydration/secret keep semantics, metadata editing and submission guards.

Finding/evidence: B09; xem report để phân biệt probe và source-only.

Hàm/method có tên: `EditAccountDrawer@16`, `handleClose@47`, `handleSubmit@52`.

Callback/anonymous callables: 10.

### src/renderer/pages/Accounts/ExportDialog.tsx

D · 301 dòng · SHA-256 `9c1854b99cb7e13860c822aa1d75cb6c6df909c417d351f64894902ab2122119`.

Chức năng/ranh giới: Field/scope/format selection, export IPC promise and dialog lifecycle.

Finding/evidence: B07; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ExportDialog@31`, `getFormatIcon@61`, `getScopeCount@72`, `handleExport@84`.

Callback/anonymous callables: 8.

### src/renderer/pages/Accounts/TaskProgressDialog.tsx

D · 168 dòng · SHA-256 `4b4541144dcda57505ceef44bf9753a9bcc7981d1fd4da7d34cc4b25fd3dd853`.

Chức năng/ranh giới: Account task read effect, receipt/counter display and request cancellation.

Finding/evidence: B08; xem report để phân biệt probe và source-only.

Hàm/method có tên: `statusVariant@20`, `verificationBadgeConfig@26`, `TaskProgressDialog@49`.

Callback/anonymous callables: 5.

### src/renderer/pages/Dashboard/automationConfig.ts

D · 288 dòng · SHA-256 `fe738a625390384627f3592f7a26ee37b9880046327849f349ebe4c401df1aa4`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `clampConfigNumber@95`, `splitLines@113`, `toRunConfig@124`, `toPersistedConfig@217`, `fromPersistedConfig@258`.

Callback/anonymous callables: 3.

### src/renderer/pages/Dashboard/AutomationConfigGrid.tsx

D · 655 dòng · SHA-256 `f782733c1528661542407647f8916e73f0e96c3e1ba5bb9aafd80cf74209073f`.

Chức năng/ranh giới: Controls→config patches, provider/browser availability and plaintext key/proxy display.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AutomationConfigGrid@53`.

Callback/anonymous callables: 35.

### src/renderer/pages/Dashboard/columns.tsx

D · 174 dòng · SHA-256 `c6c780832ac87fbcfffe24db48905e5817ad42e3ce920d4d4249ac1ef2fad847`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `accountStatusBadgeVariant@24`, `createDashboardColumns@30`, `header@37`, `cell@46`, `cell@60`, `cell@69`, `cell@75`, `cell@95`, `cell@104`, `cell@113`, `cell@124`, `cell@132`, `header@143`, `cell@145`.

Callback/anonymous callables: 2.

### src/renderer/pages/Dashboard/DashboardActionBar.tsx

D · 166 dòng · SHA-256 `27fc96036cb96444f15fcd087f16818b13fcec9ae50c99d55079c377f5d448aa`.

Chức năng/ranh giới: Counters/status/start-stop/save/data controls.

Finding/evidence: B03; xem report để phân biệt probe và source-only.

Hàm/method có tên: `formatCapacityDetails@17`, `DashboardActionBar@61`.

Callback/anonymous callables: 1.

### src/renderer/pages/Dashboard/dashboardController.ts

D · 509 dòng · SHA-256 `1d152bdcce79d11d6f63ea1e3ffa7c5bd75ece0b690889dea36e9f6197c28026`.

Chức năng/ranh giới: UI edits/autosave/load, current-next snapshot pair, start/stop/thread/remove and live subscriptions.

Finding/evidence: B01, B02, B03; xem report để phân biệt probe và source-only.

Hàm/method có tên: `DashboardController.constructor@121`, `DashboardController.getState@145`, `DashboardController.subscribe@149`, `DashboardController.setState@156`, `DashboardController.isRunning@163`, `DashboardController.updateConfig@167`, `DashboardController.flushPendingSave@175`, `DashboardController.saveConfig@187`, `DashboardController.requestSnapshotRefresh@214`, `DashboardController.executeSnapshotPair@240`, `DashboardController.isThreadRunning@298`, `DashboardController.stopThread@303`, `DashboardController.load@318`, `DashboardController.attach@359`, `DashboardController.start@400`, `DashboardController.removeAccounts@431`, `DashboardController.stop@444`, `DashboardController.stopAndRefresh@454`, `DashboardController.dispose@472`, `getSharedDashboardController@495`, `resetSharedDashboardController@505`.

Callback/anonymous callables: 11.

### src/renderer/pages/Dashboard/DashboardPage.tsx

D · 351 dòng · SHA-256 `8cc7e327b1eb042e476059c5bb569ff598cb1a0e58dadf294f4209cf271904b0`.

Chức năng/ranh giới: Shared controller lifecycle + table/config/action bar wiring; selection and filters.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `list@20`, `remove@21`, `list@24`, `onEntry@25`, `start@28`, `stop@32`, `stopThread@33`, `threads@34`, `progress@35`, `onProgress@49`, `providers@52`, `get@55`, `save@59`, `DashboardPage@66`, `handleClearAccounts@135`, `isThreadRunning@157`, `onStopThread@158`.

Callback/anonymous callables: 31.

### src/renderer/pages/Dashboard/DockedLiveLogs.tsx

D · 64 dòng · SHA-256 `e277daddf9f44d3e57bcf2a19481a27b68bd98aa272bec07050dccd304af9a54`.

Chức năng/ranh giới: Canonical timestamp/status rendering for embedded feed.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `toClockTime@10`, `DockedLiveLogs@15`.

Callback/anonymous callables: 1.

### src/renderer/pages/Logs/columns.tsx

D · 76 dòng · SHA-256 `b24d4b144a47458e584debb021c86b6211f9a0b2d5999d90651ae5f0296a3e33`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: B10; xem report để phân biệt probe và source-only.

Hàm/method có tên: `cell@10`, `cell@20`, `cell@37`, `cell@47`, `cell@66`.

Callback/anonymous callables: 0.

### src/renderer/pages/Logs/logsController.ts

D · 395 dòng · SHA-256 `5e83bbe475c8dd4206514e713f8906494cfa07e68acb94a4efdd9a23c8fdd8ea`.

Chức năng/ranh giới: Canonical sort/cache/upsert, unconfirmed provenance, query/lifecycle/Clear barrier và UI views.

Finding/evidence: B06; xem report để phân biệt probe và source-only.

Hàm/method có tên: `normalizeFilterValue@41`, `toViewLog@48`, `LogsController.constructor@106`, `LogsController.getState@113`, `LogsController.subscribe@117`, `LogsController.setState@124`, `LogsController.normalize@132`, `LogsController.compareLogs@144`, `LogsController.upsertSorted@151`, `LogsController.compact@168`, `LogsController.visible@176`, `LogsController.publishRows@188`, `LogsController.isCurrentLoad@199`, `LogsController.matchesFilter@203`, `LogsController.load@214`, `LogsController.loadHistory@232`, `LogsController.loadError@242`, `LogsController.attach@276`, `LogsController.setPaused@309`, `LogsController.dispose@313`, `LogsController.clear@325`, `LogsController.finishClear@345`.

Callback/anonymous callables: 13.

### src/renderer/pages/Logs/LogsFilterBar.tsx

D · 88 dòng · SHA-256 `ff5e42b7ad9f62a72418953269dd171a1b3042b7b97cc10c392dcb5aa0a7bc6c`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `LogsFilterBar@14`.

Callback/anonymous callables: 5.

### src/renderer/pages/Logs/LogsPage.tsx

D · 176 dòng · SHA-256 `d176ec224adb193db6c72a6a2bfdd9045d56cb7617c49e598a2262c0a1c48f27`.

Chức năng/ranh giới: Attach/dispose, query debounce, live state, local search và autoscroll.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `list@14`, `clear@15`, `onEntry@16`, `LogsPage@20`, `handleTogglePause@100`.

Callback/anonymous callables: 18.

### src/renderer/pages/Settings/BrowserSettingsPanel.tsx

D · 481 dòng · SHA-256 `4995545855d13b2588671b758d212eab3ce6fa577b803212cd5a542f851c46f6`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `BrowserSettingsPanel@32`, `handleCredentialsChange@53`, `getStatusHeaderAction@73`.

Callback/anonymous callables: 16.

### src/renderer/pages/Settings/EmailProviderPanel.tsx

D · 293 dòng · SHA-256 `a731bdd27538b0104e071079910e39c1f1cfa8a5523638573c55b314ee2b9826`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `EmailProviderPanel@28`, `renderStatusBadge@40`.

Callback/anonymous callables: 9.

### src/renderer/pages/Settings/ExportSettingsPanel.tsx

D · 180 dòng · SHA-256 `d4f247c3967d7e64932511952b80a63a9fd36731f03b41125ff57c40eca3a728`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ExportSettingsPanel@29`, `handleToggleField@33`, `getDelimiter@58`.

Callback/anonymous callables: 8.

### src/renderer/pages/Settings/GeneralSettingsPanel.tsx

D · 135 dòng · SHA-256 `82675ca85454018bd38415245eb643610d14484a23b0278b0e9c39170a963fa6`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `GeneralSettingsPanel@16`.

Callback/anonymous callables: 5.

### src/renderer/pages/Settings/ProxyProviderPanel.tsx

D · 153 dòng · SHA-256 `cf08796dfd889a09f7239cce43db52a3facc70edddd8876692979815483111d7`.

Chức năng/ranh giới: Component/effects/handlers/props và parent wiring; không tương đương GUI E2E.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ProxyProviderPanel@20`, `renderStatusBadge@31`.

Callback/anonymous callables: 3.

### src/renderer/pages/Settings/settingsController.ts

D · 365 dòng · SHA-256 `f424f4767e236862867cc14418ec570df45bba26534a6bd1a84553fdf4f4eb15`.

Chức năng/ranh giới: Settings load/save/draft revision, metadata và async response lifecycle.

Finding/evidence: B04; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createInitialStatuses@74`, `createInitialDrafts@109`, `cloneDefaultSettings@119`, `SettingsController.constructor@128`, `SettingsController.getState@140`, `SettingsController.subscribe@144`, `SettingsController.notify@151`, `SettingsController.load@157`, `SettingsController.updateSettings@216`, `SettingsController.setSimpleDraft@226`, `SettingsController.setMultiloginDraft@239`, `SettingsController.save@252`, `SettingsController.dispose@357`.

Callback/anonymous callables: 1.

### src/renderer/pages/Settings/SettingsPage.tsx

D · 355 dòng · SHA-256 `6b4cdaf5cecb8e3b4bb12d269c0e60d22f58acabb78176c19e2d9d9c57f3ea36`.

Chức năng/ranh giới: Controller/panel lifecycle and reset/save/test actions, local boot preference synchronization.

Finding/evidence: B05; xem report để phân biệt probe và source-only.

Hàm/method có tên: `SettingsPage@20`, `get@30`, `save@37`, `handleResetDefaults@72`, `handleSaveSettings@83`, `handleTestConnection@97`.

Callback/anonymous callables: 21.

### src/shared/contracts/api.ts

D · 256 dòng · SHA-256 `f4f5d32aacba6a74e357641902e8b9fd966a5372bac837f4536ded3d9b29e499`.

Chức năng/ranh giới: Shared IPC request/response registry and ElectronBridge contracts.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/contracts/ipc-channels.ts

D · 48 dòng · SHA-256 `a032caa673f7af590ad49189270413cdd2c9458fba75b7df43575edf09b351f6`.

Chức năng/ranh giới: Channel/event constants and uniqueness.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/account-export.schema.ts

D · 82 dòng · SHA-256 `cce03a07c8049f20d64276e617cc79caf9628ad001832c1ba1b18cbbf57035b4`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/account-task.schema.ts

D · 57 dòng · SHA-256 `c12a73ce95bdb31634ef95eb9d18bc1c260e47b458f2e6d668e2e02bf4299a37`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `taskStatusLabel@52`.

Callback/anonymous callables: 0.

### src/shared/schemas/account.schema.ts

D · 101 dòng · SHA-256 `cc378dd68c43f143341012f0dc41605e8d6d0cb104cda93aa1ada918e3636d08`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/automation-evidence.schema.ts

D · 248 dòng · SHA-256 `0826473044b06c6a3d273849eb6e9e199fa9d1f832bd351d9e205dea42a376cc`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `toUiEvidenceLabel@21`.

Callback/anonymous callables: 1.

### src/shared/schemas/automation.schema.ts

D · 272 dòng · SHA-256 `1695da14d11146fa9b8e408b66bef39e69b3c2f7c2da39c33969556b84e145f9`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `isBrowserImplemented@29`, `reject@156`.

Callback/anonymous callables: 5.

### src/shared/schemas/credentials.schema.ts

D · 25 dòng · SHA-256 `8932ca161691606ec1fe282590cc9a787ba65f1c2dc9c8380574ddf015c727ea`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/diagnostics.schema.ts

D · 53 dòng · SHA-256 `7661ddb736d012fa16ebe80d75964c71d45e0d49e0af1bccb33e8b5875b92923`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/ipc-envelope.schema.ts

D · 27 dòng · SHA-256 `646fe538235465db9e9032e9d358afb6751e2b00388eca5d480263da25809a6e`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createIpcEnvelopeSchema@11`.

Callback/anonymous callables: 0.

### src/shared/schemas/log.schema.ts

D · 40 dòng · SHA-256 `27dc522b3f06f00cb9cce5762ca5c9fac1c46b4a8b964a68beea85d6d87d81e8`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/provider.schema.ts

D · 69 dòng · SHA-256 `68426806949d97637718a7580dbcbe4af23a6d09f789a7f775f0dad67df3b959`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/settings-save.schema.ts

D · 34 dòng · SHA-256 `28edc52db88af3fac1a9d9be83b4c2d2fcd6e77e3c5581e2845a9243bb8f8480`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/schemas/settings.schema.ts

D · 167 dòng · SHA-256 `2544546d555aa553e48a876109821618f0e1bdc4d3bb60aacc2fbac9129da031`.

Chức năng/ranh giới: Schemas/defaults/refinements và caller compatibility đã đọc.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/settings/default-settings.ts

D · 60 dòng · SHA-256 `4935c08f8b144758d2d11674de7b4badc06756aaf193accd5c045803a88fcd01`.

Chức năng/ranh giới: Toàn declaration/helper/callback/caller interface đã đọc; chưa finding riêng đủ chứng cứ.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/account.ts

D · 37 dòng · SHA-256 `7d31a7607233952c9ea7a40208ca851247bd396b0a55044f2de713f7a976aea7`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/canonical-log.ts

D · 2 dòng · SHA-256 `dfab798564843eb4fcb09e0e8a0c1d1735052bb3de499d1f2a70a4850c317534`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/diagnostics.ts

D · 7 dòng · SHA-256 `c4c8c8985eea8ccd5d77a4b589a983ba408c23c7dd214ec66652042b8bff1634`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/domain.ts

D · 25 dòng · SHA-256 `fc03219ad2585eee38dfa05c5a2a239a26567ad42bbf639f9e82e113dae20f57`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/log.ts

D · 20 dòng · SHA-256 `8475a3d9dcab50593f7d268478aa32c445180e22c1d4260713e234e045a2aae0`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: B10; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/provider-interfaces.ts

D · 24 dòng · SHA-256 `f8e2ecf26ca15387d5feda33eb6d220b49c5e5ddb7cb469a4711bdf8d3b3f919`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/services.ts

D · 8 dòng · SHA-256 `d31ff4edb66b655ac281e5a438b0c5d403cb23ea3c8339cfe04153b9f1dd2baa`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/settings-dto.ts

D · 8 dòng · SHA-256 `a93f3a50b75e3367d39cb03d41bbd97ddf4d870a934bfa231fbdbab3cdbf5af5`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/shared/types/settings.ts

D · 66 dòng · SHA-256 `b84613e8de74364ca21803913794b4f706036ccc4b62b80b596b4e35ff2cf634`.

Chức năng/ranh giới: Type declarations/contract; không bịa runtime effects.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

## C — Main core

### src/main/database/connection.ts

D · 82 dòng · SHA-256 `cc90dbb0e29c7a96b3c8478651a79710a51f9831f5eeba2894238886119d88ab`.

Chức năng/ranh giới: SQLite init PRAGMAs/native failures and cleanup.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `DatabaseConfigurationError.constructor@6`, `createDatabaseConnection@12`.

Callback/anonymous callables: 0.

### src/main/database/migrations/001_initial_schema.ts

D · 56 dòng · SHA-256 `fa511778b1d3b4e37a99c18406f04b8ff5fe2e855c7b09d6f6a5a69b19abaf89`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/002_provider_runtime.ts

D · 44 dòng · SHA-256 `15962fadbf12dc116daed2f74bddd2dfa96c649b66fb5c30690169c3705fe45b`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/003_proxy_lease_ip_reuse.ts

D · 11 dòng · SHA-256 `6b7e8faa26784f417f1a8ce9f81afdeafb2a8e848de51d47728ca00ee115d6e8`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/004_account_task_progress.ts

D · 53 dòng · SHA-256 `cafb5976d845751e4417eb087e2e5769d89ab5cb2ed1820bd99f0ddad9a7be26`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/005_purchased_email_reservations.ts

D · 26 dòng · SHA-256 `5a578ef859982de6ca2a7f035d621a1f9c6035b6e64df3a69e97ceee64d756ad`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/006_account_task_receipts.ts

D · 24 dòng · SHA-256 `b416011f9849478ed2ee844f153178093372e33f0289db565c108249d92d0280`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/007_account_unsettled_proofs.ts

D · 12 dòng · SHA-256 `8e97c9a98cdf4c39ff9e1778fa57a6a384dfd73a7d1800444f618be6f4e6b53b`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/008_account_mutation_intents.ts

D · 59 dòng · SHA-256 `144fdbeb9223e975174671a054e4c0391874a8b94268647d2919f72c0bef06c7`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/009_unsettled_proofs_without_receipt.ts

D · 15 dòng · SHA-256 `0a9adaec11ff32a97f11ca07d5fa0270ae9a6414febb823e4efc582657787f5b`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrations/index.ts

D · 64 dòng · SHA-256 `91d7cc75e60a6184d29f6d84e4aaca80d1051edb888a0b012e8c328c39b65313`.

Chức năng/ranh giới: Migration SQL/checksum/order/schema ownership; không sửa lịch sử migration.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### src/main/database/migrator.ts

D · 118 dòng · SHA-256 `267b16b8b99774818c11003fa4128fbfbb8110685c75c57c16debf3ede70a107`.

Chức năng/ranh giới: Migration ordering/checksum/transaction application.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `MigrationChecksumMismatchError.constructor@8`, `computeMigrationChecksum@20`, `validateMigrationRegistry@24`, `bootstrapMigrationsTable@54`, `getAppliedMigrations@64`, `runMigrations@70`.

Callback/anonymous callables: 3.

### src/main/database/transaction.ts

D · 14 dòng · SHA-256 `b364b7421e3c6454a64156ad813fc0b679c5708d0198a13654eaa5c33cda08bb`.

Chức năng/ranh giới: Repository transaction adapter.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `DatabaseTransactionRunner.constructor@8`, `DatabaseTransactionRunner.run@10`.

Callback/anonymous callables: 0.

### src/main/ipc/accountsIpc.ts

D · 109 dòng · SHA-256 `7b876121eb4946a5a85df505cf77e62f5529c37255cf15255fb39701ca8f0b60`.

Chức năng/ranh giới: Account create/list/update/delete/export/tasks validation and service calls.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `registerAccountsIpc@13`.

Callback/anonymous callables: 7.

### src/main/ipc/automationIpc.ts

D · 143 dòng · SHA-256 `5e1cc4c3a6c6ec1da3534dc3083407167fa87e574e967a0824e5e2aec33eab7f`.

Chức năng/ranh giới: Start/Stop/thread/progress/health/email IPC and side-effect ordering.

Finding/evidence: C02; xem report để phân biệt probe và source-only.

Hàm/method có tên: `registerAutomationIpc@16`.

Callback/anonymous callables: 10.

### src/main/ipc/ipcResult.ts

D · 70 dòng · SHA-256 `a5baf60963cfed88c6ccebf166b338fbaa9a93f7cb9a90179ba6da8f90c38003`.

Chức năng/ranh giới: Envelope/validation/known-error normalization.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `validationError@23`, `ok@38`, `toErrorEnvelope@47`.

Callback/anonymous callables: 2.

### src/main/ipc/logsIpc.ts

D · 54 dòng · SHA-256 `cc41fc1795633b0c7d3b343b86216e32fd57af931684e598e3b2bc41c7ccce4b`.

Chức năng/ranh giới: Log list/Clear with LogBus sequence cutoff.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `registerLogsIpc@11`.

Callback/anonymous callables: 4.

### src/main/ipc/registerIpc.ts

D · 44 dòng · SHA-256 `c4b169912fcbc46973e9f3fbcd9720932e6900e23a02cc4b036e68abe3c36a3a`.

Chức năng/ranh giới: Baseline IPC registration/lifecycle cleanup.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `now@20`, `registerBaselineIpc@23`.

Callback/anonymous callables: 2.

### src/main/ipc/settingsIpc.ts

D · 107 dòng · SHA-256 `7a669667ab4ca5c6b7620710fd10f8e9e14631a4e111a2d75f4c6c8236275f09`.

Chức năng/ranh giới: Settings/diagnostic request validation and service calls.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `registerSettingsIpc@11`.

Callback/anonymous callables: 4.

### src/main/lifecycle.ts

D · 124 dòng · SHA-256 `b0270159e772df0955045170658998e2d00ef35e9a0d8336017ae2ab37c1bb30`.

Chức năng/ranh giới: Bounded automation-stop/log-flush/DB-close quit guard.

Finding/evidence: C01; xem report để phân biệt probe và source-only.

Hàm/method có tên: `runBounded@47`, `createShutdownManager@73`, `handleBeforeQuit@78`.

Callback/anonymous callables: 5.

### src/main/main.ts

D · 335 dòng · SHA-256 `b8e0c0dc90ab1433e96588bb54c522a241928783bca76ac9458b9b94813fdba8`.

Chức năng/ranh giới: Primary Electron process startup DB/services/IPC/subscriptions/window/lifecycle ordering.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sendToRenderer@73`, `getAppContext@78`, `error@83`, `createWindow@89`, `initializePrimaryInstance@122`, `now@157`, `chooseSavePath@219`, `flush@265`.

Callback/anonymous callables: 13.

### src/main/providers/connectivity.ts

D · 223 dòng · SHA-256 `d624550e50f97282d00ab3c52b6a4ef35b52b3a4c5d0aefee8151b10841bd191`.

Chức năng/ranh giới: Provider request/response parsing và error mapping; không gọi vendor thật.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `now@18`, `ok@20`, `Gmail94Connectivity.constructor@30`, `Gmail94Connectivity.testConnection@36`, `DongVanFBConnectivity.constructor@67`, `DongVanFBConnectivity.testConnection@73`, `KiotProxyConnectivity.constructor@103`, `KiotProxyConnectivity.testConnection@109`, `MultiloginConnectivity.constructor@160`, `MultiloginConnectivity.testConnection@166`.

Callback/anonymous callables: 0.

### src/main/providers/CustomDomainMailProvider.ts

D · 121 dòng · SHA-256 `9b78013142201ab5b077a3b9c8bd1e48a7ecc3008b3e5f0d0ba439adad7a25f8`.

Chức năng/ranh giới: Provider request/response parsing và error mapping; không gọi vendor thật.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `joinUrl@33`, `CustomDomainMailProvider.constructor@45`, `CustomDomainMailProvider.toEmail@47`, `CustomDomainMailProvider.unwrap@62`, `CustomDomainMailProvider.listInbox@89`, `CustomDomainMailProvider.readOtp@101`.

Callback/anonymous callables: 3.

### src/main/providers/DongVanFBProvider.ts

D · 362 dòng · SHA-256 `739781c1466b7772d7dd84f39bfa78571213d9ac0d550c6840f29c73d9b26b56`.

Chức năng/ranh giới: Provider request/response parsing và error mapping; không gọi vendor thật.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `splitPipe@55`, `splitLines@62`, `DongVanFBProvider.constructor@79`, `DongVanFBProvider.unwrap@87`, `DongVanFBProvider.checkBalance@145`, `DongVanFBProvider.listAccountTypes@162`, `DongVanFBProvider.toPurchasedMail@186`, `DongVanFBProvider.buyMail@220`, `DongVanFBProvider.getOauth2@262`, `DongVanFBProvider.readCode@299`, `DongVanFBProvider.createMailServerAddress@333`, `DongVanFBProvider.readMailServerCode@350`.

Callback/anonymous callables: 5.

### src/main/providers/Gmail94Provider.ts

D · 205 dòng · SHA-256 `0a441849f06135c09fedbe02808d99aa77004f79afe034f2905ff345466d042b`.

Chức năng/ranh giới: Provider request/response parsing và error mapping; không gọi vendor thật.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `Gmail94Provider.constructor@44`, `Gmail94Provider.unwrap@51`, `Gmail94Provider.getProfile@113`, `Gmail94Provider.createOtpOrder@127`, `Gmail94Provider.readOtp@156`, `Gmail94Provider.listServices@182`.

Callback/anonymous callables: 1.

### src/main/providers/HttpClient.ts

D · 101 dòng · SHA-256 `958dc7c4fedb651704c90ab710b3aa762912d46c15d7734c3f5ca940b4ec5364`.

Chức năng/ranh giới: Transport request/body/timeouts and error normalization.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `HttpTransportError.constructor@36`, `FetchHttpClient.constructor@48`, `FetchHttpClient.send@53`.

Callback/anonymous callables: 1.

### src/main/providers/KiotProxyProvider.ts

D · 260 dòng · SHA-256 `b494da1e01cda9e969d3e3765b24ed77dfe1188a0ea809a62fe620a23ca8cbd9`.

Chức năng/ranh giới: Provider request/response parsing và error mapping; không gọi vendor thật.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ProxyKeyUnavailableError.constructor@21`, `KiotProxyProvider.constructor@62`, `KiotProxyProvider.unwrap@74`, `KiotProxyProvider.listKeys@98`, `KiotProxyProvider.toLease@142`, `KiotProxyProvider.getNewProxy@197`, `KiotProxyProvider.getCurrentProxy@223`, `KiotProxyProvider.releaseKey@234`, `KiotProxyProvider.getUserInfo@246`.

Callback/anonymous callables: 1.

### src/main/providers/MultiloginProvider.ts

D · 288 dòng · SHA-256 `018d1dbdaf05533d544e8ff4c9454aeb7c37cfdd7b970c08be9904f742f5209f`.

Chức năng/ranh giới: Provider request/response parsing và error mapping; không gọi vendor thật.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `md5Hex@63`, `defaultOsType@67`, `MultiloginProvider.constructor@77`, `MultiloginProvider.unwrap@90`, `MultiloginProvider.readTokens@123`, `MultiloginProvider.signIn@137`, `MultiloginProvider.refreshTokens@146`, `MultiloginProvider.startQuickProfile@164`, `MultiloginProvider.stopProfile@214`, `MultiloginProvider.getQuickProfileStatuses@229`, `MultiloginProvider.getLauncherVersion@255`, `MultiloginProvider.listWorkspaceFolders@272`.

Callback/anonymous callables: 2.

### src/main/providers/ObservedHttpClient.ts

D · 317 dòng · SHA-256 `ac597f73df9e1083d04d6ae51167a8517423a7b8ca521836d84c5cecbf0965ab`.

Chức năng/ranh giới: AsyncLocalStorage identity propagation and safe request observations.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sanitizeAlias@115`, `sanitizeIdentity@119`, `mergeIdentity@136`, `freezeIdentity@151`, `routeTemplate@156`, `businessCategory@172`, `bodyType@190`, `safeErrorCode@196`, `safeErrorName@202`, `ObservedHttpClient.constructor@214`, `ObservedHttpClient.withObservationScope@219`, `ObservedHttpClient.captureResponseHeaders@228`, `ObservedHttpClient.send@246`, `ObservedHttpClient.emit@306`.

Callback/anonymous callables: 4.

### src/main/providers/ProviderError.ts

D · 68 dòng · SHA-256 `0adf7ab8302ebb53cd7cc45a0e3744c102de16076658e1306744c0a188251b57`.

Chức năng/ranh giới: Provider request/response parsing và error mapping; không gọi vendor thật.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ProviderError.constructor@10`, `ProviderError.toDiagnostic@19`, `ConfirmedOutOfStockError.constructor@25`, `statusToProviderCode@31`, `asRecord@38`, `readString@43`, `readNumber@49`, `readBoolean@60`.

Callback/anonymous callables: 0.

### src/main/repositories/AccountMutationRepository.ts

D · 450 dòng · SHA-256 `9bf723ed68ac1e73368a79638cd70160a188baee3c1bacd15b2d79ce61ab97b5`.

Chức năng/ranh giới: Durable approval/intent/binding ownership, budget consumption and exact settlement.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ApprovalConflictError.constructor@101`, `ApprovalExhaustedError.constructor@108`, `IntentAlreadyRecordedError.constructor@115`, `UnknownMutationError.constructor@122`, `IdentityBindingConflictError.constructor@129`, `requireRef@135`, `requireOptionalRef@139`, `toIntent@143`, `sameNewIntent@163`, `AccountMutationRepository.constructor@180`, `AccountMutationRepository.registerApproval@182`, `AccountMutationRepository.getApproval@213`, `AccountMutationRepository.readApproval@218`, `AccountMutationRepository.recordIntent@230`, `AccountMutationRepository.validateNewIntent@287`, `AccountMutationRepository.getIntent@315`, `AccountMutationRepository.listBlocking@321`, `AccountMutationRepository.assertNoUnknown@349`, `AccountMutationRepository.bindMailbox@354`, `AccountMutationRepository.bindAccount@358`, `AccountMutationRepository.bindIdentity@362`, `AccountMutationRepository.getBinding@401`, `AccountMutationRepository.getOwnerByMailbox@406`, `AccountMutationRepository.readBinding@415`, `AccountMutationRepository.settleIntent@421`.

Callback/anonymous callables: 5.

### src/main/repositories/AccountRepository.ts

D · 373 dòng · SHA-256 `4860fceeb5110cf8f8f6822da14ea3aba591d27c3b9e19d64c0d855c78d3cd90`.

Chức năng/ranh giới: SQL create/read/update/list/export/delete; filtering/date normalization/secret ops.

Finding/evidence: C03; xem report để phân biệt probe và source-only.

Hàm/method có tên: `toSqliteDateTime@92`, `AccountRepository.constructor@100`, `AccountRepository.createAccount@102`, `AccountRepository.toRecord@132`, `AccountRepository.getAccountById@153`, `AccountRepository.updateAccount@160`, `AccountRepository.buildFilterClause@251`, `AccountRepository.queryAccountsForExport@300`, `AccountRepository.listAccounts@330`, `AccountRepository.deleteAccounts@366`.

Callback/anonymous callables: 4.

### src/main/repositories/AccountTaskRepository.ts

D · 395 dòng · SHA-256 `23c5c7b592a70c8717bab88c45debe89ff771059e8cfc2e0e7c36130dac4a2d4`.

Chức năng/ranh giới: Exact task receipt/checkpoint/pending proof transactions and explicit account cleanup.

Finding/evidence: C03; xem report để phân biệt probe và source-only.

Hàm/method có tên: `toRecord@91`, `AccountTaskRepository.constructor@105`, `AccountTaskRepository.upsertMany@123`, `AccountTaskRepository.listByAccount@157`, `AccountTaskRepository.recordCheckpoint@168`, `AccountTaskRepository.getLatestReceipt@273`, `AccountTaskRepository.recordUnsettledProofs@331`, `AccountTaskRepository.listUnsettledProofs@379`, `AccountTaskRepository.deleteByAccount@387`.

Callback/anonymous callables: 4.

### src/main/repositories/CredentialRepository.ts

D · 123 dòng · SHA-256 `07142408365093b0f4d06990d8e09a47efad02a05a0b9811555fa2d411f622ea`.

Chức năng/ranh giới: Stored credential blobs and diagnostic metadata.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `DataCorruptionError.constructor@8`, `CredentialRepository.constructor@29`, `CredentialRepository.parseMetadata@31`, `CredentialRepository.saveCredential@54`, `CredentialRepository.getCredential@71`, `CredentialRepository.getAllCredentials@88`, `CredentialRepository.updateMetadata@103`, `CredentialRepository.delete@114`.

Callback/anonymous callables: 1.

### src/main/repositories/LogRepository.ts

D · 104 dòng · SHA-256 `61cffcc8a557ca23b6ec365e330345d6984ad53116cc2747e85fee68546d1469`.

Chức năng/ranh giới: Canonical log batches/filtering/retention/clear SQL.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `LogRepository.constructor@20`, `LogRepository.insertBatch@22`, `LogRepository.queryLogs@48`, `LogRepository.cleanupOldLogs@87`, `LogRepository.clearAllLogs@100`.

Callback/anonymous callables: 2.

### src/main/repositories/ProxyLeaseRepository.ts

D · 139 dòng · SHA-256 `01dbadb8d73035ec0db4b5deb528005c8c26135f850f24d5ba95ab7ce76f7a38`.

Chức năng/ranh giới: Active unique-IP lease records and exact release state.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ProxyIpInUseError.constructor@11`, `hashProxyKey@54`, `toRecord@58`, `ProxyLeaseRepository.constructor@73`, `ProxyLeaseRepository.recordLease@75`, `ProxyLeaseRepository.isIpActive@96`, `ProxyLeaseRepository.activeIps@103`, `ProxyLeaseRepository.listActive@110`, `ProxyLeaseRepository.countActiveForKey@117`, `ProxyLeaseRepository.release@124`, `ProxyLeaseRepository.releaseAll@132`.

Callback/anonymous callables: 1.

### src/main/repositories/PurchasedEmailRepository.ts

D · 262 dòng · SHA-256 `d856a2450b1756fde2fc48cdaee26747243231616c10824c6567951a6d9b88d9`.

Chức năng/ranh giới: Reserved/available/consumed mailbox CAS, secret DTO reads and startup recovery.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `toIso@43`, `toDto@49`, `PurchasedEmailRepository.constructor@64`, `PurchasedEmailRepository.getDtoById@66`, `PurchasedEmailRepository.insert@72`, `PurchasedEmailRepository.insertReserved@91`, `PurchasedEmailRepository.reserveOldestAvailable@114`, `PurchasedEmailRepository.consumeReserved@144`, `PurchasedEmailRepository.releaseReservation@153`, `PurchasedEmailRepository.updateReservedOauth@161`, `PurchasedEmailRepository.countAvailable@174`, `PurchasedEmailRepository.clearStaleReservations@192`, `PurchasedEmailRepository.listUnconsumed@200`, `PurchasedEmailRepository.listRecent@208`, `PurchasedEmailRepository.getSecretsById@215`, `PurchasedEmailRepository.getSecretsByEmail@231`, `PurchasedEmailRepository.markConsumed@239`, `PurchasedEmailRepository.release@255`.

Callback/anonymous callables: 1.

### src/main/repositories/SettingsRepository.ts

D · 63 dòng · SHA-256 `1778f17b46bd6be3af436cdf0bfd4921d0946339b9cc8c5de6e4d64d80425321`.

Chức năng/ranh giới: Persisted app settings and tolerant shape loading.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `SettingsRepository.constructor@15`, `SettingsRepository.getAppSettings@17`, `SettingsRepository.saveAppSettings@50`.

Callback/anonymous callables: 0.

### src/main/rolloutUserData.ts

D · 47 dòng · SHA-256 `4e2e1e896a2580c43be65212307f5a9372ca40f0a5238c840b2c2c7703ccfb2d`.

Chức năng/ranh giới: Isolated runtime storage path validation before bootstrap.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `isPathInsideOrEqual@10`, `configureRolloutUserData@22`.

Callback/anonymous callables: 0.

### src/main/runtime/logRetention.ts

D · 77 dòng · SHA-256 `fb369caf168319613d4af6ec83ebb4effbcec356b11bb05de7e1abe6a6cbedb0`.

Chức năng/ranh giới: Retention startup job and safe summary log.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `runLogRetentionCleanup@42`, `say@44`.

Callback/anonymous callables: 0.

### src/main/runtime/providerStack.ts

D · 295 dòng · SHA-256 `e54dc6f345f4212c5cb1cffb1400af92efe129a90e024827e9921cef9451c33f`.

Chức năng/ranh giới: Repositories/services/provider registry/runtime assembly and task-progress sink.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createProviderStackRepositories@80`, `createTaskProgressSink@92`, `record@96`, `recordUnsettled@120`, `recordLegacy@131`, `createProviderStack@159`, `captureResponseHeaders@168`, `isAccountActive@199`, `customEmail@209`, `launcherFactory@237`, `log@246`.

Callback/anonymous callables: 8.

### src/main/security/CredentialVault.ts

D · 83 dòng · SHA-256 `6c34c8ae0c8c80902c3afbe488b39ebde8cd63c17d1b245bf2c55f0487305353`.

Chức năng/ranh giới: OS storage availability and error-normalized encrypt/decrypt.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `VaultUnavailableError.constructor@4`, `CredentialEncryptionError.constructor@13`, `CredentialDecryptionError.constructor@22`, `CredentialVault.constructor@41`, `CredentialVault.isAvailable@43`, `CredentialVault.encrypt@51`, `CredentialVault.decrypt@67`.

Callback/anonymous callables: 0.

### src/main/singleInstance.ts

D · 43 dòng · SHA-256 `c51ef2e85bc60ea97c991e5976c29a8f2c99f64b77d5d6a9cb297cfad2382fa1`.

Chức năng/ranh giới: Primary lock and activation behavior.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `acquireSingleInstance@15`, `startPrimaryInstance@34`.

Callback/anonymous callables: 1.

### src/main/startupRecovery.ts

D · 17 dòng · SHA-256 `3895dbdfe2f3f8e0f24fea3bd748a9639f2440db161fa243cc2fd360f8c1e1a3`.

Chức năng/ranh giới: Recover stale purchased-email reservations at controlled startup.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `recoverStaleEmailReservations@5`.

Callback/anonymous callables: 0.

## D — Scripts/tools

### scripts/account-api-query.cjs

D · 13 dòng · SHA-256 `933a83d2457c169e55b3924491ad7bade2dede9f3f3e79224d146ddd7f547158`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `accountApiQuery@2`.

Callback/anonymous callables: 2.

### scripts/build-cycletls-bridge.mjs

D · 52 dòng · SHA-256 `fea0fef9887deeb802bc4255004c5cf90a326d4b51f9a40fb4aabbbd1b741892`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `createBuildSpec@6`, `buildCycleTlsBridge@27`.

Callback/anonymous callables: 2.

### scripts/check-all-tabs.mjs

D · 109 dòng · SHA-256 `756d6fd890d61e5b08eb52450cd32b34a0c34c4d464d2fa7b69cffb1f1041797`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sleep@21`, `attach@23`, `check@35`, `main@44`, `run@59`.

Callback/anonymous callables: 14.

### scripts/check-installed-app.mjs

D · 92 dòng · SHA-256 `efa165ee4ca230fb64d2c73fb5a07ebe60942b94cd1a6f53246f75c9d0c28cfc`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sleep@19`, `check@22`, `attach@30`, `main@41`.

Callback/anonymous callables: 9.

### scripts/check-logs-tab.mjs

D · 77 dòng · SHA-256 `1ac31c669403c403accc18387317cf015f19180cd18d088c6f22268429662670`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sleep@21`, `attach@23`, `main@34`.

Callback/anonymous callables: 9.

### scripts/check-packaged-app.mjs

D · 197 dòng · SHA-256 `21bd6e931cbfdfd39269ae8acca74d29ec7feb623619c2b297c084077ca8569b`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `sleep@31`, `validateSmokeTarget@33`, `runPackagedSmoke@46`, `check@48`.

Callback/anonymous callables: 9.

### scripts/check-status.cjs

D · 101 dòng · SHA-256 `2bad2702d920a8d0161f1d6951437014aca350605cd7fd110888fabc3b6f5bf6`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `check@13`.

Callback/anonymous callables: 4.

### scripts/discover-creator-contract.cjs

D · 29 dòng · SHA-256 `f0de07c87115a553d787e9f624bc640ae2587b104aac41ef4c9bd604e69886eb`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `discoverCreatorContract@1`, `handler@3`.

Callback/anonymous callables: 6.

### scripts/discover-thread-contract.cjs

D · 27 dòng · SHA-256 `aafbe05c59f593a42dfdf1885d97fea4b2deadb4e1d50ef918652362b070006f`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `discoverThreadContract@1`, `handler@3`.

Callback/anonymous callables: 3.

### scripts/execute-http-tasks.cjs

D · 127 dòng · SHA-256 `9314d964e1b383bdbc2950bd3606059583ff44263868f59d8d24d4429eed3515`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `run@24`.

Callback/anonymous callables: 4.

### scripts/find-luckycat.cjs

D · 13 dòng · SHA-256 `fc5a4c8bb602bd2dd2934e620e9576751f166325d3ac320daaf8bca7c7d83896`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 2.

### scripts/fresh-account-context.cjs

D · 22 dòng · SHA-256 `ad54c8e0b77333245d29ae33d0a6b67e4c1202f00ee3ae0efdd53cb3db985b76`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `fetchJsonFromCapture@1`, `rowsForCookie@15`.

Callback/anonymous callables: 9.

### scripts/generate-capcut-icon.mjs

D · 98 dòng · SHA-256 `3b1509a58ade352d39056ca31ff3c23f8ba7e54a73ba51cddba706416f1a8d8c`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `main@33`.

Callback/anonymous callables: 2.

### scripts/http-runtime-inventory.cjs

D · 37 dòng · SHA-256 `31764e50398fb12dac381d380cc1c8f30d68be12e96b19e671ee490980033976`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 6.

### scripts/imagex-contract.cjs

D · 48 dòng · SHA-256 `f7c94de7a130a599c616213cf64bf1b733d99a9832424675c842d3b6c7fc12af`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `pair@4`, `jsonResponse@7`, `inspectImagexSigning@14`, `signImagex@38`.

Callback/anonymous callables: 9.

### scripts/inspect-private-capture.cjs

D · 328 dòng · SHA-256 `af52b1f8c7b526fc503c748a7314d5eefda702c4bef21a06bc9c2c1fc85275ce`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `pair@16`, `shape@60`.

Callback/anonymous callables: 102.

### scripts/live-account-task-proof.cjs

D · 51 dòng · SHA-256 `42894f1e84ce92097d926247973af17b60d4a93f784624067ff93a033ce6136b`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `readTasks@3`, `acknowledgeCompletedOperation@12`.

Callback/anonymous callables: 7.

### scripts/live-capcut-options.mjs

D · 385 dòng · SHA-256 `31700cecb466d5ef91c9765c8e198249736351bb2aa274534d206cfe33a18e25`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `LiveOptionError.constructor@12`, `LiveTimeoutError.constructor@20`, `LiveEvidenceError.constructor@28`, `resolveExitCode@35`, `assertBillableEmailAllowed@49`, `terminalAccountCount@62`, `isTerminalRunState@68`, `parseHeadlessFlag@73`, `parseKnownFlags@86`, `validateSelectedMode@190`, `parseLiveCapcutOptions@381`.

Callback/anonymous callables: 0.

### scripts/live-capcut-run.mjs

D · 582 dòng · SHA-256 `d6423dfa61f59315f4e96fc087c5c93d754640b450287ab8e396d3b8fb6ad651`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `emptyResult@22`, `evidenceMode@26`, `expectedCount@32`, `normalizeIdentity@36`, `sameResolvedPath@49`, `buildRunConfig@55`, `createChildEnvironment@100`, `reserveLoopbackPort@123`, `waitForTerminal@138`, `withinDeadline@158`, `requestBoundedStop@177`, `releaseChild@184`, `withinDuration@202`, `main@217`, `bounded@235`, `onSpawned@239`, `createLiveInvocation@312`, `unwrapData@328`, `parseAccountIdsDocument@335`, `createProductionDependencies@358`, `sleep@380`, `boundedTeardown@381`, `now@396`, `writeStdout@398`, `spawnElectron@399`, `onSpawn@415`, `onInitialError@419`, `attachToApp@437`, `resolveAppUserData@490`, `runHealth@494`, `startRun@501`, `getProgress@515`, `stopRun@519`, `readEvidenceByRunId@523`, `killChild@526`.

Callback/anonymous callables: 44.

### scripts/live-complete-and-claim.cjs

D · 369 dòng · SHA-256 `ee345bea43ab6c39e0427b75b7c4889926d6aef4862ac0f47b158e434485048b`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: D05; xem report để phân biệt probe và source-only.

Hàm/method có tên: `getAccessToken@94`, `isPortFree@98`, `pickFreePort@98`, `log@99`, `openPopover@257`.

Callback/anonymous callables: 20.

### scripts/live-fresh-creator.cjs

D · 107 dòng · SHA-256 `ab9bb006df746f22cef6e1664c461826a82574693c7516f4e48fa574950c3c40`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `templateBody@7`, `runFreshCreator@13`, `post@18`, `signedByBrowser@22`, `handler@23`, `once@35`, `poll@63`.

Callback/anonymous callables: 16.

### scripts/live-fresh-design-operations.cjs

D · 73 dòng · SHA-256 `50ce9d1bcd5bdb34a06f685b880117a62c9ca127af84b92853b281fe48f4baa8`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `accountHeaders@7`, `operationTemplate@16`, `runFreshDesignOperation@25`.

Callback/anonymous callables: 26.

### scripts/live-fresh-design.cjs

D · 62 dòng · SHA-256 `011f3e996984e506823eccf987944a1d9da9dd6487f853e5bed3751b7a9aaa6b`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `uploadFreshCanvas@5`, `resumeFreshCanvas@24`, `sendJson@33`.

Callback/anonymous callables: 10.

### scripts/live-http-existing.cjs

D · 677 dòng · SHA-256 `144c92a29f64a5db197661846a8dfc801ddbbd56d405cee6ee018f35f66c9727`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `report@88`, `persist@116`, `decode@122`, `persist@136`, `decode@143`, `persist@153`, `persist@164`, `arg@225`, `decode@228`, `persist@239`, `decode@268`, `decode@287`, `persist@302`, `decode@310`, `persist@314`, `persist@329`, `persist@363`, `persist@365`, `persist@385`, `persist@399`, `persist@446`, `persist@477`, `persist@479`, `browserSend@542`, `persist@543`, `persist@586`, `persist@600`, `persist@613`, `persist@641`, `persist@649`, `persist@659`.

Callback/anonymous callables: 167.

### scripts/live-http-only.cjs

D · 156 dòng · SHA-256 `08811a119986411bd8b6d85a9eb85eb93586b535b3a41ba670d3f44bdae3b4ec`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `readArg@16`, `parseOptions@21`, `loadProxyRoute@45`, `runBootstrap@67`, `runSession@109`, `main@136`, `sanitizeError@142`.

Callback/anonymous callables: 6.

### scripts/live-hybrid-onboarding.cjs

D · 409 dòng · SHA-256 `9eda2925bc9903cf240b5e0f06e8306c3a3da6c4d0deede06b67d67ce0e1623c`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `md5Hex@25`, `resolveRunDir@29`, `emit@47`, `getAccessToken@94`, `log@96`, `log@208`, `getOtp@210`.

Callback/anonymous callables: 8.

### scripts/live-imagex-upload.cjs

D · 121 dòng · SHA-256 `f1ae7ccf2591b4dcc8ee4ce1923b411c5a6a7e56c3452e671a512934eca2e961`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `prepareImagexUpload@6`, `commitImagexUpload@35`, `attachImageToNewCanvas@71`, `headersFor@79`, `save@80`, `refresh@92`, `replace@102`.

Callback/anonymous callables: 20.

### scripts/live-inspiration.cjs

D · 45 dòng · SHA-256 `2c52303e463e2b2ce80fdfa8c439006e979e4325074d875b13568ad751573c29`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `captured@4`, `runInspiration@14`.

Callback/anonymous callables: 9.

### scripts/live-onboarding-probe.cjs

D · 446 dòng · SHA-256 `3a28ac3b972d78bb9b513f3118545b967404553cb5b703fe32661bb7412d64ff`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: D04; xem report để phân biệt probe và source-only.

Hàm/method có tên: `resolveRunDir@18`, `encodeMix@24`, `main@26`, `emit@43`, `send@63`, `absorbCookies@158`, `capcutCall@170`.

Callback/anonymous callables: 6.

### scripts/live-register-and-claim.cjs

D · 314 dòng · SHA-256 `cf30a1afd006a75bd23458978704c6a1b67f667616175c6d564e464086e9ba05`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: D05; xem report để phân biệt probe và source-only.

Hàm/method có tên: `getAccessToken@96`, `isPortFree@100`, `pickFreePort@100`, `log@101`, `getOtp@128`, `log@149`.

Callback/anonymous callables: 14.

### scripts/live-test-capcut-engine.cjs

D · 279 dòng · SHA-256 `826091a926e8bb5d970c5d56c4cb1c42475c4ce34a7ad75a8ff1b9ef4b210d5c`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `getAccessToken@124`, `getAccessToken@128`, `log@135`, `getOtp@161`, `log@197`.

Callback/anonymous callables: 4.

### scripts/liveCredentials.cjs

D · 13 dòng · SHA-256 `0898cce8d23f16fc04922cb60b955abd850c8241edc8a98c2025adca43aea6c5`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `insertMultiloginIfMissing@5`.

Callback/anonymous callables: 0.

### scripts/make-icon.mjs

D · 191 dòng · SHA-256 `d1ffe1c84edf91e309c0355981a7ba93af77cc5a08a1778c4ead11452ff39292`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `crc32@28`, `chunk@34`, `encodePng@44`, `drawMark@77`, `inside@80`, `downscale@132`.

Callback/anonymous callables: 4.

### scripts/private-capture-summary.cjs

D · 44 dòng · SHA-256 `c524e77537c52737700eff604dc78d0943947b5ed6bc3abb03662d472b8e8447`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `shape@1`, `summarizePrivateCapture@14`.

Callback/anonymous callables: 9.

### scripts/probe-captured-task-http.cjs

D · 46 dòng · SHA-256 `dd4e595dfd4ab859fb55c2d9cd130b51acb5c92f065377faeb272c84b0c536e2`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 5.

### scripts/probe-headed-canvas.cjs

D · 75 dòng · SHA-256 `1514b3d179190609bb06048def56cd4d4079c159a4eb0af43cd5a12e377dbff2`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `report@28`, `log@29`.

Callback/anonymous callables: 10.

### scripts/probe-headed-window.cjs

D · 66 dòng · SHA-256 `d06f1b42af0a996f063c68edebd3a7c255633dc7db38d620ff3134aeaf141732`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `measure@35`.

Callback/anonymous callables: 12.

### scripts/record-account-tasks.cjs

D · 50 dòng · SHA-256 `31a8770ff4ff395dd6206a4050deb43151d2b3819d922680097ed41708021e40`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 0.

### scripts/run-electron-harness.cjs

D · 372 dòng · SHA-256 `28a9db305c5c692e8f7e83b6867d375cb55d26ab671b6d76437abb12182d25e7`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `runHarness@27`.

Callback/anonymous callables: 5.

### scripts/test-cycletls-saved-session.cjs

D · 229 dòng · SHA-256 `76b4c52223cb18bdff6a50c6bda79672113e352ecdd72f9385043f8bab0546c2`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `main@16`.

Callback/anonymous callables: 5.

### scripts/test-do-action.cjs

D · 109 dòng · SHA-256 `4c17b216a410ffc0b9f6fa68815bc0f2deec2cfdfebeed16978dc36dbe655204`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `probe@13`.

Callback/anonymous callables: 3.

### scripts/verify-independent-profiles.mjs

D · 208 dòng · SHA-256 `11b705a41067add425eb538980b5fe356566913858daa62f2978aa1677d92e88`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `checked@19`, `probePages@27`, `verifyIndependentProfiles@73`, `sanitize@92`, `fail@98`, `codedError@104`, `stopOwned@105`, `onEvent@125`, `adopt@135`, `onProfileStarted@155`.

Callback/anonymous callables: 27.

### scripts/verify-probe-result.cjs

D · 55 dòng · SHA-256 `79fbfe0870d2a9fd75d02e6a8b1dc63d2d35552043ae9dbfa7fe79bedf14f936`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `main@10`.

Callback/anonymous callables: 1.

### scripts/verify-real-session.cjs

D · 284 dòng · SHA-256 `9d1b33eb0feb249f3ccc5e04f2c152c88c41f0c50ae259204b99459fd278a619`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `log@35`, `getAccessToken@62`, `log@64`, `log@162`.

Callback/anonymous callables: 7.

### scripts/verify-rollout-evidence.mjs

D · 629 dòng · SHA-256 `a86abd03016a117836bc385d74358601ff99e471c5facc2779cea3f0ae87c10e`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `fail@17`, `optionValue@21`, `parseEvidenceOptions@26`, `percentile@78`, `median@84`, `peakDistinctSessions@93`, `intervalWallMs@108`, `summarizeUiConcurrency@132`, `exactlyOne@234`, `assertTerminalCounters@240`, `assertResources@256`, `assertProfileLifecycle@295`, `assertPurchases@356`, `assertAccountEvidence@401`, `validateRolloutEvidence@500`, `validateRolloutEvidenceFile@577`.

Callback/anonymous callables: 59.

### tools/http-contracts/normalize-capture.mjs

D · 236 dòng · SHA-256 `147007a12773416b18eacc336d03f738fbca7b49862aeccde32e84dfe1ef2746`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `reviewedResponseNumber@16`, `scalar@25`, `redact@44`, `parseJson@55`, `bodyEnvelope@70`, `normalizeUrl@80`, `normalizeMethod@93`, `safeIdentity@98`, `completeIdentity@104`, `identityKey@106`, `hopOf@107`, `targetOf@108`, `safeMetadata@109`, `safeSequence@110`, `safeTimestamp@111`, `safeStep@112`, `safeEventType@113`, `eventKind@115`, `groupKey@121`, `routeRole@129`, `toTransaction@131`, `eventCounts@153`, `storedBody@160`, `extractInput@190`, `normalizeCapture@198`.

Callback/anonymous callables: 17.

### tools/offlineFixture.ts

D · 25 dòng · SHA-256 `1a9c7e007bb01c514a52a7296eee91fad7fa2436abff221999b378799fdbe6ff`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `loadOfflineFixture@7`.

Callback/anonymous callables: 1.

### tools/test-mlx-token.cjs

D · 46 dòng · SHA-256 `2a77f244ee346910ed6875da9d4e48686f0aec488b14d5a17f01ccecd8f6d476`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: không có callable có thân được đặt tên (module data/declarations hoặc callbacks).

Callback/anonymous callables: 1.

### tools/verify-selectors.ts

D · 672 dòng · SHA-256 `a50dc9904e5099908182b9ad0117977ccf22f9a91027add7751abd72c34c2add`.

Chức năng/ranh giới: Toàn helper/entrypoint/catch/finally, phân loại diagnostic/build/verification; không chạy live.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `check@38`, `open@48`, `close@54`, `counter@60`, `main@63`, `log@489`, `log@513`, `log@538`.

Callback/anonymous callables: 55.

## M — Main services

### src/main/services/AccountExportService.ts

D · 169 dòng · SHA-256 `7a97d30a44dd1267cdf3311db94b541156315c404d38063e0a68ff9d8660de24`.

Chức năng/ranh giới: Scopes checked/filtered/all → repository rows → decrypt selected fields → dialog → TXT/CSV/XLSX; nguyên tắc không ghi partial trước decrypt.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AccountExportService.constructor@34`, `AccountExportService.export@42`, `AccountExportService.readRecords@76`, `AccountExportService.decryptCell@88`, `AccountExportService.toRow@101`, `AccountExportService.suggestFileName@120`, `AccountExportService.pad@122`, `AccountExportService.writeXlsx@134`, `toTxt@152`, `flatten@153`, `toCsv@159`, `sanitize@160`, `escape@162`.

Callback/anonymous callables: 10.

### src/main/services/AccountService.ts

D · 151 dòng · SHA-256 `b72cafb5efe9b9c2acd9a975b3a34967517cdcb525a7fc376be4a1d74319ff39`.

Chức năng/ranh giới: CRUD và presence/plaintext DTO; main giữ SQL/vault; per-row decrypt failure không làm mất page.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AccountService.constructor@30`, `AccountService.encryptOptional@39`, `AccountService.toBufferOp@44`, `AccountService.create@51`, `AccountService.list@72`, `AccountService.update@104`, `AccountService.remove@123`, `AccountService.getAutomationCredential@134`.

Callback/anonymous callables: 4.

### src/main/services/AccountTaskService.ts

D · 120 dòng · SHA-256 `e54fb2dede59a2296754bf5e7fd1251ff9c5dcb2a9dfce52a3f28102685a8947`.

Chức năng/ranh giới: Read latest receipt và task rows; exact membership/server counters, missing/partial/stale/verified UI.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AccountTaskService.constructor@17`, `AccountTaskService.listByAccount@19`.

Callback/anonymous callables: 6.

### src/main/services/AutomationRunService.ts

D · 2859 dòng · SHA-256 `99eb72f33f0d53d5b33fd41373b5b66a949a18bf0093ea4e39ec08d826bb8b4b`.

Chức năng/ranh giới: Work-source preparation → per-worker acquisition → profile ownership → auth/tasks → checkpoint/outcome → cleanup/Stop; counter và resource state.

Finding/evidence: M02, M03, M04, M05; xem report để phân biệt probe và source-only.

Hàm/method có tên: `headlessWorkerStaggerMs@69`, `InitialWaveBarrier.release@337`, `InitialWaveBarrier.constructor@342`, `InitialWaveBarrier.arrive@346`, `InitialWaveBarrier.openBarrier@352`, `InitialWaveBarrier.wait@358`, `parseDirectProxy@382`, `toLauncherProxy@436`, `leaseToProxySettings@448`, `toHttpOnlyProxy@459`, `withTimeout@472`, `AutomationRunService.observe@535`, `AutomationRunService.constructor@539`, `AutomationRunService.getTelemetry@549`, `AutomationRunService.getUserDataDir@553`, `AutomationRunService.subscribe@558`, `AutomationRunService.getProgress@565`, `AutomationRunService.isRunning@569`, `AutomationRunService.createUiScheduler@574`, `AutomationRunService.onEvent@577`, `AutomationRunService.retireUiScheduler@590`, `AutomationRunService.shutdownAllUiSchedulers@600`, `AutomationRunService.runHealthCheck@606`, `AutomationRunService.abortHealthOwnership@628`, `AutomationRunService.snapshot@641`, `AutomationRunService.onEvent@671`, `AutomationRunService.adoptProfile@689`, `AutomationRunService.publish@834`, `AutomationRunService.increment@848`, `AutomationRunService.recordResourceSnapshot@859`, `AutomationRunService.recordEvidence@872`, `AutomationRunService.log@891`, `AutomationRunService.parseDirectProxyList@901`, `AutomationRunService.assertLauncherSupportsConfig@934`, `AutomationRunService.recordOutcome@959`, `AutomationRunService.acceptTerminalError@981`, `AutomationRunService.startProfileStop@1026`, `AutomationRunService.stopSession@1056`, `AutomationRunService.stopSessionWhenOwnershipSettles@1063`, `AutomationRunService.handleStopFailure@1141`, `AutomationRunService.noteCleanupFailure@1183`, `AutomationRunService.cleanupIteration@1197`, `AutomationRunService.createThreadRecord@1290`, `AutomationRunService.notifyDone@1334`, `AutomationRunService.launchSession@1364`, `AutomationRunService.onProfileStarted@1388`, `AutomationRunService.onProfileStarted@1435`, `AutomationRunService.holdForThread@1513`, `AutomationRunService.buildOtpReader@1534`, `AutomationRunService.waited@1541`, `AutomationRunService.say@1542`, `AutomationRunService.recordTaskProgress@1598`, `AutomationRunService.launchThreadSession@1616`, `AutomationRunService.runUiSessionAttempt@1649`, `AutomationRunService.onTaskCheckpoint@1689`, `AutomationRunService.log@1729`, `AutomationRunService.classifyUiResult@1734`, `AutomationRunService.runThreadWorkload@1807`, `AutomationRunService.onTaskProgress@1871`, `AutomationRunService.log@1875`, `AutomationRunService.workerLoop@2039`, `AutomationRunService.timingLog@2232`, `AutomationRunService.runPrepared@2294`, `AutomationRunService.getRunningThreads@2462`, `AutomationRunService.isAccountActive@2474`, `AutomationRunService.stopThread@2478`, `AutomationRunService.start@2497`, `AutomationRunService.prepareRun@2585`, `AutomationRunService.releaseRunningWaiters@2782`, `AutomationRunService.waitUntilRunning@2791`, `AutomationRunService.waitForCompletion@2798`, `AutomationRunService.stop@2806`.

Callback/anonymous callables: 83.

### src/main/services/AutomationTerminalError.ts

D · 18 dòng · SHA-256 `9fdbb58b5d6456b579dfc075f27dbd60778e7e1b76390b84976edfce2754c739`.

Chức năng/ranh giới: Typed terminal failed/blocked reason; không có IO.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `AutomationTerminalError.constructor@9`.

Callback/anonymous callables: 0.

### src/main/services/AutomationWorkSource.ts

D · 339 dòng · SHA-256 `add11a775d66ab795d681ea1b85ce5935e808fa85674f3aec3e775ae28fa0377`.

Chức năng/ranh giới: Manual/existing/continuous queues; synchronous slot reserve, billable budget forwarding, exact reservation bind/commit/release.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `noPurchases@67`, `ExistingAccountWorkSource.constructor@82`, `ExistingAccountWorkSource.prepare@87`, `ExistingAccountWorkSource.next@122`, `ExistingAccountWorkSource.commit@126`, `ExistingAccountWorkSource.release@127`, `ExistingAccountWorkSource.purchaseStats@129`, `ExistingAccountWorkSource.isExhausted@131`, `ManualWorkSource.constructor@140`, `ManualWorkSource.prepare@142`, `ManualWorkSource.next@174`, `ManualWorkSource.commit@178`, `ManualWorkSource.release@179`, `ManualWorkSource.purchaseStats@181`, `ContinuousEmailWorkSource.constructor@190`, `ContinuousEmailWorkSource.prepare@204`, `ContinuousEmailWorkSource.next@224`, `ContinuousEmailWorkSource.acquire@244`, `ContinuousEmailWorkSource.isExhausted@260`, `ContinuousEmailWorkSource.purchaseStats@264`, `ContinuousEmailWorkSource.commit@269`, `ContinuousEmailWorkSource.bind@277`, `ContinuousEmailWorkSource.release@284`, `createAutomationWorkSourceFactory@293`, `create@299`.

Callback/anonymous callables: 2.

### src/main/services/browserRuntime.ts

D · 204 dòng · SHA-256 `feced7969970b97a6df8caf45c5f39b99aa0286b14aa1ead9b8dae3989c46b0e`.

Chức năng/ranh giới: Token/profile start/port poll, dispatch runtime owner, stop by profile ID.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `waitWithSignal@31`, `MultiloginBrowserRuntime.constructor@67`, `MultiloginBrowserRuntime.resolvePort@81`, `MultiloginBrowserRuntime.startProfile@108`, `MultiloginBrowserRuntime.stopProfile@133`, `UnsupportedBrowserRuntime.constructor@141`, `UnsupportedBrowserRuntime.startProfile@143`, `UnsupportedBrowserRuntime.stopProfile@155`, `DispatchingBrowserRuntime.constructor@167`, `DispatchingBrowserRuntime.resolve@172`, `DispatchingBrowserRuntime.startProfile@185`, `DispatchingBrowserRuntime.stopProfile@198`.

Callback/anonymous callables: 6.

### src/main/services/CapcutEngineService.ts

D · 424 dòng · SHA-256 `6d5d7b6386f5576d08d4afb30b38a7aeecfda2d2947ff3985150fac28942ed39`.

Chức năng/ranh giới: Injected browser only: auth → trial → default task runner → receipt/pending proof mapping; không tự tạo profile.

Finding/evidence: M02; xem report để phân biệt probe và source-only.

Hàm/method có tên: `toTaskProgressRows@61`, `toVerificationReceipt@82`, `CapcutEngineService.constructor@134`, `CapcutEngineService.runAccount@139`, `CapcutEngineService.captureStage@209`, `CapcutEngineService.log@246`, `CapcutEngineService.log@345`, `CapcutEngineService.resolvePage@346`, `CapcutEngineService.onCheckpoint@363`.

Callback/anonymous callables: 15.

### src/main/services/DirectProxyPool.ts

D · 116 dòng · SHA-256 `8244fc44a4e67cd08eb1e7027c0b3ab2694d2a994269741d97a7b04a35f4bf77`.

Chức năng/ranh giới: FIFO static route allocation và inUse identity; abortable waiters, release/drain.

Finding/evidence: M03; xem report để phân biệt probe và source-only.

Hàm/method có tên: `DirectProxyPool.constructor@22`, `DirectProxyPool.totalCount@27`, `DirectProxyPool.activeCount@31`, `DirectProxyPool.availableCount@35`, `DirectProxyPool.acquire@44`, `DirectProxyPool.onAbort@59`, `DirectProxyPool.release@77`, `DirectProxyPool.drain@105`.

Callback/anonymous callables: 1.

### src/main/services/EmailPurchaseService.ts

D · 1001 dòng · SHA-256 `0b7ba1d3db879b060c6435d08508383a52a6dfb626444e127b45e7f9c0c17adb`.

Chức năng/ranh giới: Gmail/DongVan/custom acquisition, stock polling, approval identities, paid persistence, CAS delivery, OTP read.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `abortableDelay@31`, `onAbort@38`, `EmailPurchaseService.constructor@176`, `EmailPurchaseService.observe@190`, `EmailPurchaseService.exclusive@194`, `EmailPurchaseService.release@200`, `EmailPurchaseService.awaitTurn@220`, `EmailPurchaseService.preflightGmail94@234`, `EmailPurchaseService.openAcquisitionSession@301`, `EmailPurchaseService.purchaseStats@338`, `EmailPurchaseService.emitPurchaseEvent@339`, `EmailPurchaseService.poisonPurchaseAccounting@347`, `EmailPurchaseService.assertPurchaseBudget@358`, `EmailPurchaseService.beginPurchase@375`, `EmailPurchaseService.rollbackAttempt@385`, `EmailPurchaseService.ambiguousPurchase@390`, `EmailPurchaseService.isDefinitiveProviderFailure@407`, `EmailPurchaseService.acquireOne@415`, `EmailPurchaseService.recordPurchaseIntent@427`, `EmailPurchaseService.settlePurchase@446`, `EmailPurchaseService.bindAccount@893`, `EmailPurchaseService.commit@899`, `EmailPurchaseService.release@914`, `EmailPurchaseService.readApiKey@924`, `EmailPurchaseService.getProviderConfigs@928`, `EmailPurchaseService.readOtp@953`.

Callback/anonymous callables: 30.

### src/main/services/LazyProxyLeaseSource.ts

D · 125 dòng · SHA-256 `5891f6826f9abc9143794ef0d7940f125540d26864355aa2f0de78508fe7df75`.

Chức năng/ranh giới: Manager lifecycle, configure ownership guards, acquisitionsInFlight, release-all singleflight.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `LazyProxyLeaseSource.constructor@29`, `LazyProxyLeaseSource.configure@39`, `LazyProxyLeaseSource.ensureManager@61`, `LazyProxyLeaseSource.acquire@69`, `LazyProxyLeaseSource.availableSlots@84`, `LazyProxyLeaseSource.release@89`, `LazyProxyLeaseSource.releaseAll@95`.

Callback/anonymous callables: 4.

### src/main/services/LogBus.ts

D · 146 dòng · SHA-256 `8c18701e709b5ee458f73f1da8b6b624efd9c331c27cf5975a556ecd8c9d8709`.

Chức năng/ranh giới: Canonical live sequence + batched repository sink; failed flush pending queue và clear cutoff.

Finding/evidence: M06; xem report để phân biệt probe và source-only.

Hàm/method có tên: `setInterval@40`, `clearInterval@41`, `LogBus.constructor@62`, `LogBus.emit@74`, `LogBus.subscribe@104`, `LogBus.flush@111`, `LogBus.clear@122`, `LogBus.start@128`, `LogBus.pendingCount@133`, `LogBus.dispose@137`.

Callback/anonymous callables: 4.

### src/main/services/mailUsername.ts

D · 51 dòng · SHA-256 `42361087f5a2e0a39a0efc034a6e019e9d8a59c3b3194e87a689018a0b7c72ca`.

Chức năng/ranh giới: Random username/taken-name avoidance và custom-domain normalization.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `pick@10`, `generateMailUsername@23`, `generateMailUsernames@30`, `buildCustomDomainAddress@46`.

Callback/anonymous callables: 0.

### src/main/services/MultiloginAuthService.ts

D · 221 dòng · SHA-256 `ce8f3e473d19dcb7db5f7832a5f506e7614308ec9b4c8475dd51abc1a6ea0f2d`.

Chức năng/ranh giới: Stored token/credentials modes, refresh/sign-in, in-flight dedup, session persistence.

Finding/evidence: M01; xem report để phân biệt probe và source-only.

Hàm/method có tên: `configError@37`, `MultiloginAuthService.constructor@50`, `MultiloginAuthService.now@54`, `MultiloginAuthService.observeShared@58`, `MultiloginAuthService.readBlob@70`, `MultiloginAuthService.persistSession@94`, `MultiloginAuthService.isSessionFresh@104`, `MultiloginAuthService.resolveToken@110`, `MultiloginAuthService.getAccessToken@170`, `MultiloginAuthService.invalidateSession@199`, `MultiloginAuthService.isConfigured@217`.

Callback/anonymous callables: 4.

### src/main/services/passwordGenerator.ts

D · 46 dòng · SHA-256 `f748f3e352356bb95ca9c8d0323369b01aa3fc88ad722730861fc4fd1334a27c`.

Chức năng/ranh giới: Random enabled character classes, length, shuffle; custom value unchanged.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `pick@9`, `generateCapcutPassword@18`.

Callback/anonymous callables: 1.

### src/main/services/ProviderRegistry.ts

D · 38 dòng · SHA-256 `1765afa5a0aa554c5504f8b01c8706ba8d7898860a2902e66f42e4b028fecaf5`.

Chức năng/ranh giới: Factory lookup và capability check cho connectivity probes.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `isConnectivityProvider@9`, `ProviderRegistry.constructor@23`, `ProviderRegistry.get@25`, `ProviderRegistry.has@30`, `ProviderRegistry.registeredServices@34`.

Callback/anonymous callables: 0.

### src/main/services/ProxyLeaseManager.ts

D · 336 dòng · SHA-256 `147ad525a3bf9bb1198e4ee6ec302f6603fc373534b6813905f96fa8bbcc547e`.

Chức năng/ranh giới: Key discovery/current-IP/rotation, busy/cooldown, IP lease repository, late mutation ownership và release.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `ProxyLeaseManager.constructor@78`, `ProxyLeaseManager.observe@90`, `ProxyLeaseManager.loadKeys@94`, `ProxyLeaseManager.refreshKeys@114`, `ProxyLeaseManager.isCoolingDown@118`, `ProxyLeaseManager.markCooldown@123`, `ProxyLeaseManager.readCurrentIp@132`, `ProxyLeaseManager.tryKey@146`, `ProxyLeaseManager.acquire@220`, `ProxyLeaseManager.wait@256`, `ProxyLeaseManager.cleanup@261`, `ProxyLeaseManager.onAbort@264`, `ProxyLeaseManager.release@285`, `ProxyLeaseManager.releaseAll@317`, `ProxyLeaseManager.activeLeaseCount@326`, `ProxyLeaseManager.availableSlots@331`.

Callback/anonymous callables: 14.

### src/main/services/SecretReader.ts

D · 57 dòng · SHA-256 `5d01df603d24a8b36332157513ab5591079565904be25240aa20c6d53c69e609`.

Chức năng/ranh giới: Main-only credential read/decrypt/trim/error normalization; không đổi storage.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `SecretReader.constructor@11`, `SecretReader.isConfigured@16`, `SecretReader.maskedHint@20`, `SecretReader.readSimpleKey@25`.

Callback/anonymous callables: 0.

### src/main/services/ServiceConnectionManager.ts

D · 156 dòng · SHA-256 `5f5cd0266b9d799fffcb309f4614d054ee16243fcbb44b209a976732435bd5b9`.

Chức năng/ranh giới: Provider diagnostics → per-credential metadata/status publisher; draft tests không persist.

Finding/evidence: M07; xem report để phân biệt probe và source-only.

Hàm/method có tên: `EmptyProviderRegistry.get@18`, `EmptyProviderRegistry.has@21`, `ServiceConnectionManager.constructor@36`, `ServiceConnectionManager.now@40`, `ServiceConnectionManager.getDiagnosticStatuses@44`, `ServiceConnectionManager.toDiagnosticStatus@86`, `ServiceConnectionManager.testConnection@98`.

Callback/anonymous callables: 2.

### src/main/services/SettingsService.ts

D · 104 dòng · SHA-256 `3d0975b358dde3c06c953fc42281f51483983cd8928b840260127cb5499c6cff`.

Chức năng/ranh giới: Validate/pre-encrypt mutations rồi synchronous DB transaction; keep/replace/clear boundaries.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `SettingsService.constructor@22`, `SettingsService.getSettingsWithCredentials@30`, `SettingsService.saveSettingsWithCredentials@44`.

Callback/anonymous callables: 1.

### src/main/services/stageTiming.ts

D · 38 dòng · SHA-256 `43dfd9c11698ebcdf29af1eb204218b1e0e6d81c7ee308f7d6e01e1aa3b347a5`.

Chức năng/ranh giới: Monotonic timing and outcome log around an operation.

Finding/evidence: Không finding riêng được xác nhận; xem report để phân biệt probe và source-only.

Hàm/method có tên: `canonicalStageName@5`, `measureStage@19`.

Callback/anonymous callables: 1.

## T — Test/helper file ledger

T = full source read: setup/mocks/it.each/callbacks/assertions. Live tests chỉ đọc. Các false-green và thiếu integration proof nằm trong phần E của report.

| File | Dòng | SHA-256 | Phạm vi |
|---|---:|---|---|
| scripts/__tests__/build-cycletls-bridge.test.mjs | 40 | `e368a45a77292500942248440f80798509c79f2c3a30c879f5b088d532a34954` | T · default suite/helpers/assertions |
| scripts/__tests__/checkPackagedApp.test.ts | 231 | `4c9d46eb8942f0ecb4c7925fa6f007c12ddd711b3329565cecf111501cc86e3c` | T · default suite/helpers/assertions |
| scripts/__tests__/cycletls-live-options.test.mjs | 99 | `ef5109d261ebfbde300c1d67cc4709b0d96541d4ef01a22cb02c74e0d77eaf5f` | T · default suite/helpers/assertions |
| scripts/__tests__/live-capcut-options.test.mjs | 462 | `a92561393e86ff82edc8b38ea581ec1d947e0b32f32b11985af6a6720b0ae0f5` | T · default suite/helpers/assertions |
| scripts/__tests__/live-capcut-run.test.mjs | 772 | `41a7917dcd334a75c3a935956289053537cbe50c0b7917f0e95a49aae77f0b41` | T · default suite/helpers/assertions |
| scripts/__tests__/live-http-only.test.mjs | 36 | `1b60c9357a870dc7c1d227dc3e4c95b4976e3b4c9b76cfbdbd3f058818e67bdb` | T · default suite/helpers/assertions |
| scripts/__tests__/liveCredentialsSql.test.ts | 37 | `6bae5fbd54e49cca153097d7f21210ac4c4c984421760a6d7640279df1142bb7` | T · default suite/helpers/assertions |
| scripts/__tests__/normalize-capture.test.mjs | 365 | `23633b8d5ea5a0520bab39d5c9e7dd7411db456fbaa41606094e28c03f920323` | T · default suite/helpers/assertions |
| scripts/__tests__/offline-fixture.test.ts | 48 | `934ac10ef9e3161eadc9aa2a9494a9bbf7628879d844ae826a4b9c08b8b7016c` | T · default suite/helpers/assertions |
| scripts/__tests__/private-capture-summary.test.mjs | 27 | `3d167693a5366b7ee859f107b1e2378d23374f39c8789cd3014c68455f04658d` | T · default suite/helpers/assertions |
| scripts/__tests__/verify-independent-profiles.test.mjs | 275 | `31585cf2b7c35170f13d0a0519a81b28b4c1a72afd14a04498e1f490b96aeb67` | T · default suite/helpers/assertions |
| scripts/__tests__/verify-rollout-evidence.test.mjs | 831 | `bae6316a088eef01e0089a3c1d56b995d0397107c664602554ebc3a88855783c` | T · default suite/helpers/assertions |
| src/main/__tests__/lifecycle.test.ts | 274 | `e915eb014d48a1b2053c28f50226380e0db574ac4c5944b1d8b66145be8ff2f4` | T · default suite/helpers/assertions; wrong expected second-quit |
| src/main/__tests__/rolloutBootstrapOrder.test.ts | 55 | `05127b36cde13270a50c9afa0c37e4f5497a29b87eedc37e6b50c3a8179c59fd` | T · default suite/helpers/assertions |
| src/main/__tests__/rolloutUserData.test.ts | 95 | `2b5ca2c325fcb19c4379ace84e46ce27cfa5f69e6cb08afc0c7659e968242663` | T · default suite/helpers/assertions |
| src/main/__tests__/singleInstance.test.ts | 92 | `6a9da3cd3cc254e8509af318bcee24de576f9c545fad55422b1aac27daa7eed3` | T · default suite/helpers/assertions |
| src/main/__tests__/startupRecovery.test.ts | 22 | `099d1ad8f9c0ff9379efba711960f3064f2f11e21588fac6b7d25a09c31386a2` | T · default suite/helpers/assertions |
| src/main/database/__tests__/connection.test.ts | 78 | `49c2a56e61ee33f474cd5654d07b1a8cb244606680cc8bf192d8c470c6fac017` | T · default suite/helpers/assertions |
| src/main/database/__tests__/migrator.test.ts | 375 | `1586212a0e215baff5d5d4677e2eb319a4b3ddaa5213b010d0bcd64fd97ce03c` | T · default suite/helpers/assertions |
| src/main/database/__tests__/transaction.test.ts | 142 | `9bfa6da76c48a776b64cbe2b590c518394e580d559cfced82b40344586344cc4` | T · default suite/helpers/assertions |
| src/main/ipc/__tests__/ipcResult.test.ts | 81 | `51c8afcbe86889a5f4e86549bd26b265d415942fd817455453943f2f8e7fac66` | T · default suite/helpers/assertions |
| src/main/ipc/__tests__/logsIpc.test.ts | 59 | `6b0fe8789da802351d93ef12b0bca4157274959b45dc010e17e6c1a822dfa668` | T · default suite/helpers/assertions |
| src/main/ipc/__tests__/registerIpc.test.ts | 62 | `73cd2a465a3b996b7e570230eac21c3aa76c775a6dc2f9821dc7940946b91887` | T · default suite/helpers/assertions |
| src/main/ipc/__tests__/rolloutIpc.test.ts | 50 | `08a3be495d3b30af6321b6d912cc26c735ced8ef3886ad20d27c3f8122abdf41` | T · default suite/helpers/assertions |
| src/main/ipc/__tests__/runtimeIpc.test.ts | 534 | `3248b407851d36ad652c9b0e7b033521d0ce96256c5f0c192aad59f209c246ed` | T · default suite/helpers/assertions |
| src/main/ipc/__tests__/settingsIpc.test.ts | 343 | `6d6ef3bf49d55c0a17f19833012eebe2ece4a0c602ce4da1189da89e1363c725` | T · default suite/helpers/assertions |
| src/main/providers/__live__/customDomain.live.test.ts | 60 | `ca246cfaa047968d35d2938ee257cb2d59b76377d57e8f72fab765ee103766f2` | T · live/provider fixture, không chạy |
| src/main/providers/__live__/liveEnv.ts | 63 | `1ce95d8aa1c2dea803b5f63548f262ff01bfaf0d8a97ff1a8561426b97dd745b` | T · live/provider fixture, không chạy |
| src/main/providers/__live__/multiloginCdp.live.test.ts | 112 | `d3c52537016ca146351b7a3f4f5efb43445df4b26995436410f62655352f7fb2` | T · live/provider fixture, không chạy |
| src/main/providers/__live__/providers.live.test.ts | 267 | `9c59f1af42c67911ee27a57c9af270aee036326835622818a4a80d17a7fe974b` | T · live/provider fixture, không chạy |
| src/main/providers/__tests__/CustomDomainMailProvider.test.ts | 242 | `a47e3647470cd33a67357ae1d665e800fb9f3a0d6e0032d51ec9c0ab9588151c` | T · default suite/helpers/assertions |
| src/main/providers/__tests__/DongVanFBProvider.test.ts | 292 | `4e4204cd963993d607d1b91a30dabc4b499d5dcceb4c6a55535e8f5a87f5ee35` | T · default suite/helpers/assertions |
| src/main/providers/__tests__/Gmail94Provider.test.ts | 198 | `54f85acadfc08ddf3069a4aaa466f0d5377408a79637f2314e55cf29d4042c71` | T · default suite/helpers/assertions |
| src/main/providers/__tests__/KiotProxyProvider.test.ts | 236 | `f3a196df56d3ffe5c9e7ba1a845da2d73e382d4905b9e802590d633776c04c6f` | T · default suite/helpers/assertions |
| src/main/providers/__tests__/MultiloginProvider.test.ts | 288 | `9c4df31a2a0c93793640e0549a7fa87b4abb522033c7df657d4848b7d72957d7` | T · default suite/helpers/assertions |
| src/main/providers/__tests__/ObservedHttpClient.test.ts | 242 | `3234cfef4a7c1c3823fb00f7cc66673faf2e26b364719007a2d34f36c8b39974` | T · default suite/helpers/assertions |
| src/main/providers/__tests__/connectivity.test.ts | 293 | `f73f4ccc4f7e6f34b126799acb63098a1a825a9a645cadd8db6d56f04a32fba5` | T · default suite/helpers/assertions |
| src/main/repositories/__tests__/accountMutationRepository.test.ts | 296 | `920481ab84fe1e7ab9a19b51280445286c8c6fea9c89c9745ca8affc6663ba00` | T · default suite/helpers/assertions |
| src/main/repositories/__tests__/accountTaskRepository.test.ts | 448 | `cb5d7d8c36e1f7072cb52c5126af74e12bfadea3b72ac918673cf255349861c2` | T · default suite/helpers/assertions |
| src/main/repositories/__tests__/purchasedEmailRepository.test.ts | 242 | `aa91caa392535c02455b17b23d9a8b843475a90d25ac5891eff16a0a19508123` | T · default suite/helpers/assertions |
| src/main/repositories/__tests__/repositories.test.ts | 536 | `ae1c531c032d2d3b85aec742df03876854deb50f112b690f23a945f929766769` | T · default suite/helpers/assertions |
| src/main/runtime/__tests__/logRetention.test.ts | 177 | `cb2f263781b0299cb2daf4c42ae41ad0228a8f3b4ecbb2dcf6d219ab788a39d4` | T · default suite/helpers/assertions |
| src/main/runtime/__tests__/providerStack.test.ts | 168 | `c726858d647430cb637fa75ff2677ccefddb3ddf3e57b01864270a209ed8c960` | T · default suite/helpers/assertions |
| src/main/runtime/__tests__/rolloutTelemetryWiring.test.ts | 72 | `77bfdfa5eaebaab131a30155be8cc23f4b06df24ae213faebe5a46d581293ba8` | T · default suite/helpers/assertions |
| src/main/security/__tests__/CredentialVault.test.ts | 149 | `ff3568b185386440a56a062a6f3caa14ebcb9d408be26338e4936a1549b0f32c` | T · default suite/helpers/assertions |
| src/main/services/__tests__/AccountExportService.test.ts | 305 | `cdb87513cdb903977f93788474ada19b2a59c66bd4169b301529bbae8c6aa948` | T · default suite/helpers/assertions |
| src/main/services/__tests__/AccountService.test.ts | 273 | `9c270a082c0cb771714acddb1486c6d8dfe5e0042518dd439b886a482d4860d3` | T · default suite/helpers/assertions |
| src/main/services/__tests__/AccountTaskService.test.ts | 149 | `e685c55bae9ccfb9e21c0bf2d4eb598a73a97388e588ae677c7f63ebee0abf8a` | T · default suite/helpers/assertions |
| src/main/services/__tests__/AutomationRunService.test.ts | 4765 | `eec0bef38681dfd1862435b87a731cfba34ea79dfd5e9f6695815ca9f15bdfbf` | T · default suite/helpers/assertions; terminal-DB/S05-log-buffer/S07-preset-flag gaps |
| src/main/services/__tests__/AutomationWorkSource.test.ts | 433 | `c02d569ae3942132e7c1e8af97f722fde24b7904a6494f909de3c825607f8704` | T · default suite/helpers/assertions |
| src/main/services/__tests__/CapcutCaptureSession.test.ts | 106 | `8c47f4f7aca6170d402d549e1d45fe5dc46ee300fa1b57563b8e862778b70432` | T · default suite/helpers/assertions |
| src/main/services/__tests__/CapcutEngineService.test.ts | 539 | `0c64fffd205f1280f3e10e1bfae7cfbef667ca6723c99a6b6ab6d7ebd5a3d23c` | T · default suite/helpers/assertions |
| src/main/services/__tests__/DirectProxyPool.test.ts | 102 | `39d793a9aa2723a480ff41e5e6edfa20cf3e7f4211d5c10cc8a22934f2c9a81f` | T · default suite/helpers/assertions |
| src/main/services/__tests__/EmailPurchaseRetry.test.ts | 190 | `20d55b7ea18d434e2b52465c085fad0987af01d935b22e7b6000baa43de972ea` | T · default suite/helpers/assertions |
| src/main/services/__tests__/EmailPurchaseService.test.ts | 2229 | `f8c8bd629e9b5fefadd3fc0c9918d697c229599ef93de9c755892d34550b447d` | T · default suite/helpers/assertions |
| src/main/services/__tests__/LazyProxyLeaseSource.test.ts | 292 | `60a3843649a9377caf7e0e3b11d13f80b0cf1c4f0b7f90e6f4f9d978222f6897` | T · default suite/helpers/assertions |
| src/main/services/__tests__/LogBus.test.ts | 222 | `22779dac831bc9cde4d9f8f426ca1d63c9207118f76acee97eb2813771a4b929` | T · default suite/helpers/assertions |
| src/main/services/__tests__/MultiloginAuthService.test.ts | 266 | `6190d69406020306cdb34923c2c24c52c3e276908746636b131e3953bd0d3edb` | T · default suite/helpers/assertions |
| src/main/services/__tests__/ProxyLeaseManager.test.ts | 548 | `59b0823c83c4902bef24e7de09dc16188580a4debfb5293403fb4219d150faba` | T · default suite/helpers/assertions |
| src/main/services/__tests__/SettingsService.test.ts | 673 | `e5dcc7da635b320a2115bd6c01c4544db584a22635fd656eff4468fafa0b9458` | T · default suite/helpers/assertions |
| src/main/services/__tests__/automationTaskProgress.test.ts | 1211 | `7160bc913fc53e709244f196a4aef99a1e6d7c2ca94b8ff28880b0b4478daad2` | T · default suite/helpers/assertions |
| src/main/services/__tests__/browserRuntime.test.ts | 236 | `6a827d4e06668d4c6509cd8b69d7bad6bf055dad914d2efd87da5d71deb82bcd` | T · default suite/helpers/assertions |
| src/main/services/__tests__/capcutSignupPath.test.ts | 298 | `d13931ad4b091afe0d670600e3bca2980c12f249dcf8be0df0d5e7a9f5dce2a6` | T · default suite/helpers/assertions |
| src/main/services/__tests__/directProxy.test.ts | 99 | `60152653f54a0f61e46d2253dc555da689440e656a09b98f31b8c01dae9c95ea` | T · default suite/helpers/assertions |
| src/main/services/__tests__/fixtures/deterministicRunHarness.ts | 547 | `7499e40f667bfd5ada8127ace1dda40f0ff6860cae110bd3a8d38123dbecc4c3` | T · helper, không test độc lập; final ownership oracle chưa độc lập |
| src/main/services/__tests__/healthRun.test.ts | 410 | `5a304883ab88f05c32f609816f92792ae8a79fc272746df92536d34262871cc9` | T · default suite/helpers/assertions |
| src/main/services/__tests__/mailUsername.test.ts | 62 | `b4e0271fe6497804a9f69e7940065dfa11d0f7ee391cf3a5be13766782d8182b` | T · default suite/helpers/assertions |
| src/main/services/__tests__/multiThreadedIsolation.test.ts | 594 | `56c0c29a57a644c9743587973f98af1d0cc8134900987621ee415c3fa58f4b43` | T · default suite/helpers/assertions |
| src/main/services/__tests__/passwordGenerator.test.ts | 63 | `15eef954ecd7de39f312f0541b54475dbcfbaf04c03f42b056b7ca75a82404b8` | T · default suite/helpers/assertions |
| src/main/services/__tests__/providerConnectivity.test.ts | 211 | `6790ef10dc613bbce6ce0c66b6105c683258c643a895e3240eb0d759a18364ee` | T · default suite/helpers/assertions |
| src/main/services/__tests__/proxyQueueIntegration.test.ts | 295 | `608dfe37ed12cb2085eb9130f1c52260bfe2a597a6a6e5a20df676714de10268` | T · default suite/helpers/assertions |
| src/main/services/__tests__/purchaseBudgetWiring.test.ts | 53 | `0c55be2b0410522510dafd6c11d2be0c7c5642c0833156c2d688f141f701c9d7` | T · default suite/helpers/assertions |
| src/main/services/__tests__/rolloutRunIntegration.test.ts | 353 | `5be13a6bb31e7ee09e11716e19683adb40ae794e3bf92bf66fa96596bf158c69` | T · default suite/helpers/assertions |
| src/main/services/__tests__/stageTiming.test.ts | 65 | `a7dd58fcf2d8baa45d2e5f6d0621036cacf1ba07acf3b6ef9cb596671ec5db1c` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/auth.test.ts | 151 | `c5660f20b5bf32cac30a9efa9a20ebf514ada47ac7017ee6d225d723d715a00e` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/authCancellation.test.ts | 201 | `a334221abd5deaa3fffa66cd837bd464dc265ace9feff8e8590655c02c44b68f` | T · default suite/helpers/assertions; immediate-sleep/preabort gaps |
| src/main/services/capcut/__tests__/bootstrap.test.ts | 140 | `7d711de658a58e5f1c0800a40901f7587892c5ede4829cf68106bad59e49d40c` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/boundedDump.test.ts | 67 | `209f4227a16f33aad2776dbecef7123bce9d74b954204a118e322fe5c7dd3ff5` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/boundedEvaluation.test.ts | 90 | `b728aaddc002553ac84715a419045a4a3ccdf0e01a787a10ca00d502e26733f6` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/boundedInteractions.test.ts | 471 | `322151b607e1187195866953c99ef26bdddf00e98a20d9b2cfe720d3e257a7e9` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/cancellation.test.ts | 31 | `1254232bb3bf74d4c092795e2e62cf0ba5120571889fd7857f7f63797d72c324` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/canvasChatVisibility.test.ts | 53 | `003e9c4849da92b035e117254ba1f2d2e315c2ee6e8412cb6bb39b099e05f041` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/canvasFlowTimeout.test.ts | 109 | `59056f76eaff833b19f90ade921822e0f4db28d2cd4f9646bf8fc77d3161e19c` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/canvasPromptActivation.test.ts | 164 | `7bfe5017e03dd9be274996c9bf5722a3517c9ad5dcf75a6c25e91deb4be70111` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/canvasPromptReady.test.ts | 61 | `863af99725841982fd31e2cf46a0ecb41bab887f96be027a7181bda0e0c87bc3` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/chatAcknowledgement.test.ts | 62 | `b5105a266b0ea7cae2a7db5bbc9af50a1be2ca78d2790763f17abafeb11dc232` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/claimReconciliation.test.ts | 184 | `909f5805fbbaf6dc65a20b2e5831d0bbe070608e495b8a1919a2baed8671f435` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/designWorkspace.test.ts | 43 | `572b23474c5075fa991b482d7ca0e75f5e270c8e9f6956c4c026158c3e09ada0` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/diag.test.ts | 147 | `ec9eef86082b26ec6cf05cf662d9ccd846cb57dd096c15b229814438b221212f` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/evidenceBudget.test.ts | 56 | `2d7aa1127645200c63a37aaf858da41095595a9f3c23288b8ecb3ea796fd448f` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/httpCaptureRecorder.test.ts | 562 | `ed50afdfc1b0bb35f9ae835d82f7b1b4c52d93bbb316896fe1589e205ae01198` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/httpTasks.test.ts | 391 | `f4d49b8581ccfb91ca510b3b964d3e1f6d44e200fc2ff4fb0e7f24758fe30b71` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/missionRunner.test.ts | 321 | `bded8397db5cd6b1bbdd1e7e1b0d2e8d7b57a9860895665d3a449a94071706a3` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/overlayGuard.test.ts | 52 | `ecbabcbe1717b282079a33f0dda63ea4f73954c9917e564752859c4c110922eb` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/pace.test.ts | 181 | `37896a55dc63134e7e07ace7779cee6198a279b06a7654783f1628622b5ad458` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/pageRecovery.test.ts | 99 | `1cfe2b098a6c21cb72bb9362a0814cac151f05a70099125305bd44a583758ca6` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/popoverLifecycle.test.ts | 92 | `655ca92bb227dbb05cbc3a969a264ee496a147890245e4d8058be50f3dfcd514` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/rendererHealth.test.ts | 55 | `956b506af633ccc73ce3fa0885cfd246d84315b47593fe6f8e55fdc612f08663` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/runTasks.test.ts | 738 | `01e6f2fa332b546bcf2e5ab6b8e73d425288959669cdf00990795293dc0c84d6` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/runTasksReceiptIntegration.test.ts | 218 | `91fc574edee68c645cbf7c0daa84e4cf6d224b2180cc68483e1178e405eeadee` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/runTelemetry.test.ts | 476 | `6c68c9e28bb48d3d30834afb5f69da02fc54d0284c455c9408618d6f15f1cd94` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/runTelemetryBoundary.test.ts | 56 | `6c145d850544de85f47f18b96e5b24507bf9b86cb9af2b18918263bafa123fb5` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/simple.test.ts | 63 | `45e2058d9998a609c269c795ee32cec53ddf53c2c1c2407baf579ae5af1766f5` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/simpleActions.test.ts | 98 | `a11a643d2f7d18e909136665a9c2c675d1026d9901f86609ea6c66e326011a1f` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/stepEvidence.test.ts | 348 | `280c8f3f4ca806a9bfe29c8f0430231772f88763aa2e0f5fc002e5a67c4169de` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/taskApi.test.ts | 547 | `a6dbdc12731bc47a5a831d3b25f5c07525ff291d086aac36cd1d2014587fa4a3` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/taskListDiagnostics.test.ts | 184 | `a77c8be5e454abe11c5c24d238bf44f39f173f5e9fdfbc872bb853ce1bd5ec67` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/trial.test.ts | 400 | `40a96d3e2de9bd0ade9d4732c740c360d6681c741ee2f73cc7ac781f9a1b88a9` | T · default suite/helpers/assertions; immediate-sleep/preabort gaps |
| src/main/services/capcut/__tests__/uiInteractionCoverage.test.ts | 284 | `99fe5f60104652efc0c9586fba392223b25de7274137b426246e42798e75f14b` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/uiInteractionScheduler.test.ts | 784 | `49318c3b858b2f4195659180fb053c5e4fce26d57b5b2708ff44c5480c3f53c9` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/uiQuarantineOwnership.test.ts | 78 | `75437d1953d668147d59e5c8f434b9cfe2e9088577a30041a170c724f7be9beb` | T · default suite/helpers/assertions |
| src/main/services/capcut/__tests__/verifiedTyping.test.ts | 108 | `7d00929bfc276d6ef110d709cf6cf7332d0e7d7e338d86a9adbf63fc89e01061` | T · default suite/helpers/assertions; immediate-sleep/preabort gaps |
| src/main/services/capcut/http/__tests__/CapcutHttpClient.test.ts | 23 | `902951ddc814eb604c90ed0d376416a85828739452a067b02a0c959fb0894910` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/accountSession.test.ts | 46 | `7b0d683b09fea7a1e6ec5e8a456cf49db2e13870a4392d2d7d2980edba63e817` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/authHttp.test.ts | 79 | `fe776ae9318eb33aa93f4240bc812e2b80d037618c82334426556d3a8b125302` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/capturedCreatorGenerate.test.ts | 7 | `f4db6b484afd91c17e87c81b0dc1b59364273a7370f6dfa4157fa05cd33da855` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/contractRegistry.test.ts | 26 | `7229e10bc3d21d483b859b1bc57a26d3b2e325a384362d132a1611dd6d63f4bc` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/creator.test.ts | 22 | `01cdd0a5f5a51afec564e4d20f5a6b01911c6ac835256e308caaf299a11146fd` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/creatorExport.test.ts | 17 | `f3cbb6b461caab1ad4c2d00da0ef4649c234da4dd5282ac92fd396b4584a9752` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/creatorFlow.test.ts | 183 | `502964f97f5ca49aad1cb1ba141d27289791269ab7517bfe35d0e90832831309` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/cycleTlsContext.test.ts | 743 | `9a1d90f17eff5618fa800891ade6b4a434335a940a75dbbbbf91d78a20bdcdb4` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/cycleTlsNative.test.ts | 100 | `dd3414ec7bd6cf6145842f70d241551eb18092ab18cb46b796307770fd285ef7` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/cycleTlsProtocol.test.ts | 78 | `0922b3a0a2bf46ddbbf9ae590ae743b30fc5b39e6dbb81381548cb38a0007413` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/cycleTlsRuntime.test.ts | 424 | `da3cb7faa93eee0eebb9236323a6d0bb2024f04429b5428f3fc9e9e6059b2b85` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/designCanvas.test.ts | 63 | `914f4d19c2da997d037ea800a1382642c04cd4675d305cfdb8139c0b78c50be7` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/designStudio.test.ts | 15 | `cd10aaa864abc67e214a68e5c40a01f29dc439ca8226c48348572a2a47621046` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/directHttp.test.ts | 83 | `4188e68af2c32cc9712993c327a40e972eef6d4ae9cc37af5abc55b8b71553a7` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/dispatchSigned.test.ts | 11 | `dc69686286f73552c3a09efb59e2b9c156ae37dd5bc067f051f7a20a753f222a` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/httpMissionStrategy.test.ts | 8 | `c6212f5bc2b4658f4204e1bfab5a4729aff4d5fd7ecc40cd218f0e4310f9d0f7` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/httpOnlyAccount.test.ts | 9 | `c6b05930711682504f19ad0ca94f19b0a5922e02cb195edb7c22d1ab4abb822d` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/httpOnlyBoundary.test.ts | 80 | `fc60665e90cbc4d91be495edeef6083ab366ba53ef35b2754cb47cd2d6d9fdb5` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/httpOnlyRunner.test.ts | 73 | `51c2b421a48ea12be0cfa3a60e186a915f93551dc32365cd7ac80483e5cd70bb` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/httpOnlyTransport.test.ts | 149 | `7883c9010d1e4e1f7d2a9c5d8e192f05d34dc03609f65b9faf8c9648683db89b` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/httpSessionFactory.test.ts | 107 | `6ea0182e7be6e6c428b2b7f5a9590592aa08aad3c8d9d4829d3f555d19b76311` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/httpSignup.test.ts | 65 | `f03c5a79a0d65efe8c3dfe46001fb797067e857615132caa8b8ec1202654e057` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/imagexUpload.test.ts | 8 | `c165823c5f2063dc85dbf04a36064bf303f0bb53312c676a7d6be4136bb7ce05` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/inspiration.test.ts | 160 | `57f659ad69394b637b0709ad5450f5958d719b2b8ec2289e3fc6802ba2913e70` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/jobPolling.test.ts | 44 | `b65ba12c6dc4347a9f6f69780d76305fd19c6155a3572794c4cd83954fe01bc5` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/mutationBridge.test.ts | 28 | `1d6352b9239abe234cb415fa8d2cc979e92bdede56ecbd1b669fba701abc5227` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/observedTaskRequest.test.ts | 22 | `5e4b556d2cfa3ee538200999e7a82587b703cca0ef8851bc3cf29a281c12d400` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/passportContext.test.ts | 79 | `3b45f9ceed9a930357ec7903104e5477f0f5577a805d8d7f6e52a8a1bbe3c169` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/privateCapture.test.ts | 119 | `d079602e357d541fbc0eb224c78c4ac7f29a4a7e0aa577dd7e156a138a45d7bf` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/signedRequest.test.ts | 17 | `8cc31a4bd444ab2479fd036686551f1c33c243337de307c8262a6b9393154eb7` | T · default suite/helpers/assertions; Request fake sai kiểu |
| src/main/services/capcut/http/__tests__/signupOnboarding.test.ts | 750 | `75c62a46e36fe4d9df88440fb45fcb41da978b0069798220b9ffd6e72325813b` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/taskApi.test.ts | 90 | `fd1d73316c7676b52cfa315fbc3848d537467cb32ab4cdab0af873190a3f9908` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/taskEvidence.test.ts | 61 | `926fe6f56b84c7ac44c85752dff92398d400ec1fab98df3716190c3359afbde9` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/taskMutation.test.ts | 18 | `270d1fa157718e2a03a140875e0e575d7517a724cda8c42af5495dba1ff0c161` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/trialApi.test.ts | 101 | `7416c246a0535cb057f4ddcd41ea983a7f7be62764a2847e535ef218bb5d1077` | T · default suite/helpers/assertions |
| src/main/services/capcut/http/__tests__/trialOffers.test.ts | 324 | `7f40bc95fbe34e0b6aa2f2c8fca471b652a3279557c4fd7373b98664ebe9b925` | T · default suite/helpers/assertions |
| src/main/services/capcut/launcher/__tests__/BrowserLauncher.test.ts | 230 | `676ad3e183639574490a0f52e298d6fc07377b7d8d5b66a6a38ed61622714f1a` | T · default suite/helpers/assertions |
| src/main/services/capcut/launcher/__tests__/launcherLifecycle.test.ts | 268 | `9816a794ab482c3a0934c29db3bec9a43bc85257806cbca0657b9571d8fcaf7d` | T · default suite/helpers/assertions |
| src/preload/__tests__/preload.test.ts | 308 | `20eddeea1c2ec7eea27110715d63b9c3f9fa079b0ea7780447f2668aab0461b9` | T · default suite/helpers/assertions |
| src/renderer/app/__tests__/appPreferences.test.ts | 104 | `9d7d3449db1716b829749611b2e3b9875b78d78a9efa6902dba3a12a45f8d6a8` | T · default suite/helpers/assertions |
| src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx | 81 | `2a0a9f0cc8efef8d1b18762645709b8b08a28639a05b538040c4c44cc59841fe` | T · default suite/helpers/assertions; SSR không chạy effect |
| src/renderer/pages/Accounts/__tests__/accountsController.test.ts | 681 | `df2420b1add87273128a0217d464a9e1a1882a433e10bdeb09d0e42096e0ba0a` | T · default suite/helpers/assertions |
| src/renderer/pages/Dashboard/__tests__/automationConfig.test.ts | 469 | `43679a53838975c12226c2ddb8eb1a50fcf090778831e5b99f237e6f9b97dea6` | T · default suite/helpers/assertions |
| src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts | 975 | `8fddac1a7a6087669cec3d712cf11d1f0f50f1fc475e877e393fc603c080c610` | T · default suite/helpers/assertions |
| src/renderer/pages/Dashboard/__tests__/dashboardRendering.test.tsx | 152 | `db1bda4c85d86a4878f40c648be4ec2446cef23fe28ab0875eb3253d887e78b4` | T · default suite/helpers/assertions |
| src/renderer/pages/Dashboard/__tests__/purchaseBudgetConfig.test.ts | 23 | `c610918ef21600c29fb97a9408c651e0efe9957d4af9e04f9a69597596d3dc7f` | T · default suite/helpers/assertions |
| src/renderer/pages/Logs/__tests__/logsController.test.ts | 739 | `2072551e19b205177af46177a4b72a2ff055972926fb4ecaddd62d592d4f8055` | T · default suite/helpers/assertions |
| src/renderer/pages/Settings/__tests__/settingsController.test.ts | 380 | `141699ab440ae07cd984545fe74268b72d3471d99494207bfde0873caef0f62e` | T · default suite/helpers/assertions |
| src/shared/__tests__/foundation.test.ts | 9 | `a5e88216bc65f4a50d61fe7f282da1ed55f4e9a76648da593d66675f6179be7a` | T · default suite/helpers/assertions |
| src/shared/contracts/__tests__/contracts.test.ts | 278 | `de6a738f5860f8319e9149879ce07014a14d1d6ab85c7c88e12415b23492b811` | T · default suite/helpers/assertions |
| src/shared/schemas/__tests__/automation.schema.test.ts | 358 | `3cbab05534907967ff321daaa4c0d50024451f6880c0e56ac36ef41fd80debc4` | T · default suite/helpers/assertions; duplicate fail trước refinement |
| src/shared/schemas/__tests__/provider.schema.test.ts | 115 | `62124f15b0da819c0203077c5fc1b2e55624c3577f614671831805fece3480ba` | T · default suite/helpers/assertions |
| src/shared/schemas/__tests__/rollout.schema.test.ts | 54 | `4ec54c9472a577e21308c5f151e6fff64e46892b1ee63217d00370adb1f2573a` | T · default suite/helpers/assertions |
| src/shared/schemas/__tests__/rolloutEvidenceBoundary.test.ts | 60 | `65ca7485fe9f084b2bb2489977821e108cff6d485ffb701d84f00f96c3245054` | T · default suite/helpers/assertions |
| src/shared/schemas/__tests__/schemas.test.ts | 474 | `3b150b8716b633e961dd2606e5000bdee13d3647c5f14ce37ef659539884cb10` | T · default suite/helpers/assertions |

## Ngoài TS/JS inventory

Đã đọc Go bridge main.go/main_test.go/go.mod, renderer/styles/index.css, package.json, vite.config.ts, vitest.config.ts, vitest.live.config.ts, electron-builder.yml, tsconfig.json, tsconfig.node.json, eslint.config.js, postcss.config.js, tailwind.config.ts và index.html.

Go functions: loopbackAddress, listenLoopback, websocketHandler, validWebsocketUpgrade, headerContainsToken, run, startBridge, main; test helpers/handshake/port/readiness cũng được đọc. Không chạy Go/network dependency install. go.sum/package-lock.json là generated dependency-lock metadata, không tuyên bố line-by-line logic audit. Assets/png/fonts và fixture HTML/JSON dùng theo từng selector/test, không tuyên bố toàn bộ captured/private payload đã được đọc.

## Verification snapshot

- Default Vitest: **2.085 tests/163 files PASS** trên source audit, không live providers.
- Typecheck/lint/build: PASS, exit0. Build có warning bundle >500kB; không có build error.
- Selectors: 89 pass/0 fail, exit0. Isolated Electron harness: PASS, exit0; SQLite addon cuối là Electron ABI133.
- Đối chiếu 436 inventory hashes cuối audit: không có source/script/test thay đổi trong audit; report/coverage là output mới.
- Pure probes/SQLite :memory: cụ thể xem report; không suy mọi function có runtime proof.
- Source hashes cho phép re-review chính xác file đổi sau audit.
- Không thay source/migrations/credentials/do_action flow/trial gate/plaintext Dashboard.
