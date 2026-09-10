# Runbook Antigravity — fix backlog full-file audit

## 1. Chỉ dẫn đầu vào

Đọc AGENTS.md → Superpowers using-superpowers → [Spec](../specs/2026-09-10-tool-bugfix-spec.md) → [Plan T01–T19](2026-09-10-tool-bugfix-plan.md).

[Audit report](../reports/2026-09-10-full-file-audit.md) và [coverage](../reports/2026-09-10-full-file-audit-coverage.md) là bằng chứng baseline, không phải checklist cũ cần áp lại từ đầu.

Mục tiêu: 25 findings chính +5 legacy; giữ patches F/S hiện có. Không sửa flow do_action/task_list/claim/trial gate/pacing/normal restock. API key/password/proxy vẫn hiện plaintext. Không masking/storage redesign, media gate, đổi transport hoặc thêm retry để né lỗi.

Lượt viết tài liệu chưa sửa application source. Khi được giao triển khai, thực thi task theo plan; live/purchase/activate trial/commit/push/deploy cần quyền tương ứng. Không suy người dùng chạy executable nào.

## 2. Khóa baseline trước khi sửa

~~~powershell
git status --short
git rev-parse HEAD
git diff --stat
~~~

Baseline: dd8a16e + dirty working tree đã review, không clean HEAD. Lúc lập kế hoạch đã so436hash và không khác report. Không reset/stash/checkout để bỏ changes Antigravity.

Trước task, ghi SHA256 đúng file sẽ sửa:

~~~powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/main/services/AutomationRunService.ts'
~~~

Thay path bằng file task. Nếu file đã khác audit, đọc diff/tái hiện lại, không patch mù theo line number.

Giữ đường dẫn writable workspace; không sửa .env, credential DB, captured private data hoặc migration checksum. Một owner quản lý native addon trong suốt vòng test.

## 3. Hàng đợi thực thi

| Wave | Tasks | Điều phối |
|---|---|---|
| 1 — lỗi ưu tiên | T01, T02; T04 rồi T05; T06 | Auth cùng files tuần tự; CAS độc lập runtime |
| 2 — Start/save/UI | T07-A → T08 → T07-B; T09 sau contract T08 | Một người sửa Dashboard/IPC contracts tránh ghi đè |
| 3 — proxy/log | T10; T11 sau T07; T12 | T10 dùng AutomationRunService, không đồng thời T05/T07 |
| 4 — CRUD/lifecycle | T13 rồi T14; T15; T16 | Shared Accounts component fixture chung một owner |
| 5 — legacy | T17, T18 | Chỉ offline test, không chạy live script main |
| Xuyên suốt | T19 | Sửa false-green tại task tạo regression và verify chung cuối |
| DOB | T03-A, T03-B | A chuẩn bị generator/fixture; B chờ range đã được xác nhận |

T03-B không được bỏ khỏi báo cáo. Nếu chưa có earliest/latest hoặc minAge/maxAge user chọn, status WAITING-DOB-POLICY và tiếp tục task khác. Không tự dùng range demo làm production policy; không cài runtime blocker thiếu range vào signup đang dùng rồi báo fixed.

## 4. Chu trình cho từng task

1. Đọc function, caller, test fixture theo Plan.
2. Thêm regression với đúng return type/timer/DB/DOM behavior.
3. Chạy focused RED; ghi assertion cụ thể. Environment/import/ABI fail không phải RED nghiệp vụ.
4. Patch nhỏ; không copy whole-file cũ hoặc sửa module ngoài allowlist.
5. Chạy GREEN cùng regression và toàn neighboring test files.
6. Reviewer khác kiểm: AC, code diff, actual failure path, happy trace giữ nguyên.
7. Commit focused nếu có quyền; không được cấp thì giữ diff bàn giao. Không tự push/merge.
8. Nếu task chưa đạt, giữ open; không dùng full-suite count thay assertion.

Checkpoint:

~~~text
Task / findings:
Baseline file hash:
Repro + root cause:
RED command / exit / assertion:
Patch files:
GREEN command / exit:
AC đạt / còn mở:
Happy flow và plaintext giữ nguyên:
Reviewer:
~~~

## 5. Những lỗi không được lặp lại trong implementation

### Auth/DOB/trial

- Pacing dùng abortableDelay cùng duration, không withinDeadline(browserSleep, đúng duration).
- Đợi boundary spy entered rồi mới abort trong test; pre-abort không chứng minh in-flight cancellation.
- DOB là task riêng bắt buộc: không1998/globalfirst/nth14; range chưa chốt thì không tự bịa.
- Terms test phải có dynamic unchecked locator; đánh count xử lý không thay checked state.
- Survey DOM read lỗi khác survey absent. Fatal trial phải failed, intentional ineligible skip giữ nguyên.
- Không bọc resource-creating promise rồi bỏ owner khi timeout.

### Persistence/credential

- Account update contract là {success:boolean}; true mới persisted, false/throw là failure.
- In-memory failed + persisted=false phải được phân biệt với DB đã ghi error thành công.
- Terminal DB failure ưu tiên final run failed, cleanup vẫn chạy; không replay account/purchase.
- Credential CAS so encrypted BLOB snapshot; timestamp giây không đủ. Không upsert deleted credential từ response cũ.
- Auth refresh catch không nuốt CAS error rồi sign-in cũ.
- Metadata test result chỉ ghi vào credential đúng snapshot.

### Start/logs

- Không clear logs ở renderer trước Start, không clearAllLogs trong IPC trước admission/preflight.
- T07 dùng exact old ID ticket và stream cutoff; captured pending IDs flush trong preflight vẫn là old. Sau SQL transaction thành công mới prune queue.
- New preflight/active logs không bị xóa; validation/active-owner/preflight failure không reset.
- Named reset event và response cutoff đều idempotent; nhận event không dispatch delete lần nữa.
- LogBus outage: throttle retry, maxBatch slice, giữ FIFO. Không tự cap/drop pending rồi gọi “no loss”.
- Dispose còn queue vì flush failure phải báo; shutdown không được giả flushed.
- Logs provenance qua replay không được mất; giữ normalized view identity/perf patch.

### Save/UI

- Snapshot revision đã gửi khác current edit. Old save success không bật badge cho current unsaved.
- Pinned Start save target không bị later edits làm chờ mãi hoặc đổi run config.
- saveAutomation là typed narrow write merge fresh main settings; không whole stale settings payload.
- Settings save committed + refresh reject vẫn là committed; boot preference dùng committed snapshot không current draft.
- Export/task dialog tests phải mounted effect/interaction; SSR không chạy useEffect.
- Provider source canonical không đồng nghĩa mailbox host; legacy giá trị giữ khi edit field khác.

### Cleanup/tests

- Account delete chỉ task/receipt/pending và account trong transaction; purchased/consumed/financial ledger giữ.
- Quit2 đang pending vẫn preventDefault; stop/close đúng một lần.
- S07 test preset routeReleased không đủ: race actual cleanup trước flag.
- Harness resource oracle phải độc lập identity sets; clamp về0 che duplicate release là không đạt.
- Legacy scripts failure không exit0; test VM/import-safe helper, không import live main rồi chạy thật.

## 6. Focused command index

Chạy sau khi xác nhận Node ABI đúng. Chỉ chạy path mới sau khi task tạo nó.

~~~powershell
node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/authCancellation.test.ts src/main/services/capcut/__tests__/verifiedTyping.test.ts src/main/services/capcut/__tests__/trial.test.ts
node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/signupTerms.test.ts src/main/services/capcut/__tests__/birthday.test.ts src/main/services/capcut/__tests__/signupBirthday.test.ts
node node_modules/vitest/vitest.mjs run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/main/services/__tests__/MultiloginAuthService.test.ts src/main/services/__tests__/providerConnectivity.test.ts src/main/repositories/__tests__/repositories.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/renderer/pages/Settings/__tests__/settingsController.test.ts src/renderer/pages/Logs/__tests__/logsController.test.ts --maxWorkers=4
node node_modules/vitest/vitest.mjs run src/main/services/__tests__/LogBus.test.ts src/main/__tests__/lifecycle.test.ts
~~~

Các task T07–T18 có command lân cận riêng trong Plan, phải chạy cả chúng. Chưa tạo file mà command “no tests found” không được tính PASS.

## 7. Native ABI và full verification

Máy audit: Node24.19.0 ABI137; Electron35.7.5 ABI133. Addon cuối audit đã restore Electron. Không chạy test Node khi addon còn Electron rồi báo hàng trăm bugs logic.

~~~powershell
node --version
node -e "const D=require('better-sqlite3');const db=new D(':memory:');console.log(process.versions.modules);db.close();"
~~~

Nếu mismatch, rebuild Node:

~~~powershell
npm run rebuild:node
~~~

Npm11 inherited allow_scripts có thể gây EALLOWSCRIPTS. Workaround đã dùng trên máy này, chỉ child env:

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const testEnv={...process.env};for(const k of Object.keys(testEnv))if(k.toLowerCase()==='npm_config_allow_scripts')delete testEnv[k];const r=spawnSync(process.execPath,['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','rebuild','better-sqlite3'],{env:testEnv,stdio:'inherit'});process.exit(r.status??1);"
~~~

Đổi đường dẫn npm-cli.js chỉ sau khi resolve đúng cài đặt trên máy khác; không sửa policy npm global. Permission/network bị chặn thì xin quyền đúng lệnh.

Sau các focused GREEN, chạy **tuần tự**:

~~~powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=4
npm run typecheck
npm run lint
npm run build
npm run selectors
git diff --check
~~~

Dừng đọc lỗi từng lệnh, không lấy success của lệnh sau che lệnh trước. Không tăng timeout/bỏ assertions/tăngheap để giấu bug. Baseline2085 không phải target count; tests mới làm count thay đổi.

Cuối Node suite khôi phục Electron:

~~~powershell
npx --no-install electron-rebuild -f -w better-sqlite3
~~~

Harness ẩn sau quyền launch:

~~~powershell
node -e "const{spawnSync}=require('node:child_process');const e={...process.env};delete e.ELECTRON_RUN_AS_NODE;delete e.NODE_OPTIONS;delete e.VITE_DEV_SERVER_URL;const p=require('node:path').resolve('.debug','antigravity-final-'+require('node:crypto').randomUUID());const r=spawnSync(require('electron'),['scripts/run-electron-harness.cjs','--user-data-dir='+p],{env:e,windowsHide:true,timeout:45000,stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??1);"
~~~

Sau T13, chạy node scripts/check-bugfix-ui.mjs với quyền tương ứng. Dùng fixture isolated, không app production userData/provider. Giữ owned temp khi close chưa xác nhận; không kill process khác hoặc recursive delete workspace.

Không bắt buộc dist/installer trong đợt bugfix; không dùng scripts/live-test-capcut-engine.cjs hoặc check-logs-tab.mjs làm QA an toàn.

## 8. Review matrix và rollback

Mỗi ID phải có trạng thái riêng:

- fixed: behavioral regression GREEN, neighbor tests và reviewer đạt.
- open: bug còn/patch chưa đạt.
- waiting-policy: chỉ DOB defaultrange chưa được chốt.
- legacy-maintenance: fix offline trong T17/T18, không tích hợp defaultflow.
- unverified-live: không được dùng thay fixed; chỉ ghi phần upstream/GUI chưa chạy.

Bảng báo cáo cần đủ A01–A05, M01–M07, B01–B10, C01–C03, D01–D05. T19 testgaps mỗi mục có test thật đã sửa hoặc lý do chưa xong.

Rollback không dùng git reset/checkout cảtree. Nếu patch chưa commit: undo đúng hunks do task tạo, không đụng changes khác; nếu đã commit và user cho phép rollback: revert đúng commit task. Không rollback DB migrations vì plan không có migration. Không xóa credential/mailbox/evidence để test pass. Snapshot/regression test giữ để tái kiểm bug.

## 9. Handoff cuối

~~~text
Source HEAD + dirty files:
A01-A05:
M01-M07:
B01-B10:
C01-C03:
D01-D05:
T03-B DOB policy/range: confirmed hoặc WAITING-DOB-POLICY
RED/GREEN commands + exits:
Full suite / typecheck / lint / build / selectors:
Mounted fixture / Electron harness:
Log perf/retry counts:
Credential/terminal/cleanup ownership assertions:
Native ABI cuối:
Reviewer / remaining gaps:
Không thay do_action/trial gate/plaintext Dashboard:
~~~

Không báo “đã fix hết” nếu T03-B hoặc ID khác còn open. Không coi full-suite xanh là chứng minh mọi remote contract hoặc mọi UI tương tác đã được test.

## Prompt giao Antigravity

~~~text
Đọc AGENTS.md, docs/superpowers/specs/2026-09-10-tool-bugfix-spec.md,
docs/superpowers/plans/2026-09-10-tool-bugfix-plan.md và runbook này.
Triển khai T01-T19 để đóng 25 findings chính +5 legacy từ full-file audit.
Dùng current dirty source, giữ patches F/S đã đạt, không reset về clean HEAD.
Giữ do_action/task_list/claim, trial gate, endpoints/op_id/order/pacing/restock
và plaintext API key/password/proxy trên Dashboard. Không redesign flow/storage.
Mỗi task RED đúng nguyên nhân, minimal patch, GREEN+review và AC mapping.
DOB phải random hợp lệ; range production chỉ dùng sau user xác nhận,
chưa chốt thì T03-B waiting-policy và làm tiếp task khác, không bịa default.
Không clear log khi Start reject; không stale credential write; không completed
khi terminal DB write lỗi. Test mounted dialogs và sửa false-green assertions.
Không live/purchase/activate trial/commit/push/deploy ngoài quyền được giao.
Báo đủ30ID, exact evidence, verification gaps và restore Electron ABI cuối.
~~~
