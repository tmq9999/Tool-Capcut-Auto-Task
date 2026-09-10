# ToolCapCut — Kế hoạch fix toàn bộ findings còn tồn đọng

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans để thực hiện từng task. Checklist dùng - [ ]; mỗi task có RED/GREEN/review riêng.

**Goal:** Đóng 25 findings chính và bảo trì 5 findings legacy trong full-file audit, không thay flow tool.

**Architecture:** Vá đúng owner/service/controller hiện có; không rewrite app. CAS credential dùng BLOB hiện hữu; terminal failure giữ sự thật dù DB không ghi được; Start reset có ticket riêng để không xóa preflight logs; UI dùng revision/lifecycle fences.

**Tech Stack:** TypeScript, Vitest, React/Electron, SQLite, Playwright-core hiện có; không dependency mới.

**Spec:** [Spec hiện hành](../specs/2026-09-10-tool-bugfix-spec.md).
**Evidence:** [Audit report](../reports/2026-09-10-full-file-audit.md), [coverage hashes](../reports/2026-09-10-full-file-audit-coverage.md).

## Global Constraints

- Giữ do_action → task_list → claim → đối soát, trial gate, endpoints, op_id, thứ tự, pacing và normal restock.
- API key/password/proxy trên Dashboard phải hiện plaintext để xem/copy; không masking, reveal toggle, auto-hide hoặc redesign vault/storage.
- Không product_mission/media gate, chuyển transport, tăng retry nghiệp vụ, reset DB hoặc sửa checksum migration để làm test xanh.
- Giữ patches đã đạt: paid mailbox F01, per-row password F02, OTP owner, proxy pre-rotation Stop/retained route, Logs normalize/upsert và Dashboard snapshot coalescing.
- Code mới phải có behavioral RED rồi GREEN. Mock phải phản ánh return type/thời gian/lifecycle thật; không nhận missing-module/ABI lỗi là RED.
- Chỉ thêm API nội bộ/typed IPC tối thiểu khi task cần; không generic raw IPC, framework state/resource mới hoặc dependency mới.
- Test fixture/DEMO, không live account/purchase/activate trial/commit/push/deploy ngoài quyền được giao.
- Không kết luận người dùng chạy executable nào. Đóng gói/cài lại không thay thế fix source.

## Baseline, ownership và thứ tự

Baseline dd8a16e + dirty working tree F/S patches; 436 hashes lúc viết khớp audit. 2.085 tests/163 files là baseline. Snippets dưới là hướng dẫn chưa áp vào source; phải chạy RED/GREEN khi thực thi.

- Critical lane trước: T01 → T02; T04 → T05; T06 độc lập.
- T03-A generator/tests độc lập; T03-B wiring chờ DOB range do user xác nhận, không chặn các task khác.
- Main runtime owner làm T05 → T07 → T10; không ba agent sửa AutomationRunService cùng lúc.
- Dashboard owner làm T07-A → T08 → T07-B; Settings owner T08 contract → T09; T13/T14 cùng Accounts files tuần tự.
- LogBus owner T07 → T11; LogsController owner T12 độc lập.
- T15/T16 độc lập sau review boundaries; T17/T18 legacy sau core, chỉ offline verification.
- T19 gồm sửa false-green trong các task tương ứng và gate integration cuối.
- Commit focused sau review nếu được phép; không tự git add . hoặc push.

Các task dưới liệt kê Modify/Create/Test chính xác. File phụ test fixture có thể thêm trong cùng directory nêu rõ, không sửa mã ngoài allowlist vì tiện tay.

## T01 — A01/A05: pacing đúng và Stop trong các chờ auth

**Modify:** src/main/services/capcut/login.ts, src/main/services/capcut/signup.ts, src/main/services/capcut/trial.ts, src/main/services/capcut/auth.ts, src/main/services/capcut/overlays.ts.
**Test:** src/main/services/capcut/__tests__/authCancellation.test.ts, src/main/services/capcut/__tests__/verifiedTyping.test.ts, src/main/services/capcut/__tests__/trial.test.ts, src/main/services/capcut/__tests__/boundedInteractions.test.ts.
**Contract:** giữ public auth/SignupResult, timeout90s/60s và duration hiện có; helper cancellation.ts read-only.

- [ ] Thêm test actual login/signup (createMockPage trong authCancellation.test.ts), không mock module:

~~~ts
it.each(['login', 'signup'] as const)(
  'T01 %s keeps pacing despite browser-channel overhead',
  async kind => {
    vi.useFakeTimers();
    try {
      const page = createMockPage({
        url: vi.fn(() => 'https://www.capcut.com/my-edit'),
        waitForTimeout: vi.fn((ms: number) =>
          new Promise<void>(resolve => setTimeout(resolve, ms + 30)))
      });
      const signal = new AbortController().signal;
      const ui = createDirectUiInteraction(signal);
      const creds = { email: 'fixture@example.test', password: 'Fixture1!' };
      const running = kind === 'login'
        ? loginCapcut(page, {} as BrowserContext, creds, vi.fn(), { ui, signal })
        : signupCapcut(page, {} as BrowserContext, creds, { log: vi.fn(), ui, signal });
      const settled = running.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
      await vi.advanceTimersByTimeAsync(4100);
      expect(await settled).toMatchObject({ ok: true });
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }
);
~~~

- [ ] Run focused RED: current code OperationDeadlineError, không import/type error.
- [ ] Thay deliberate waits chính xác:

~~~ts
await abortableDelay(4000, signal);
// Trial giữ một sample của cùng range:
await abortableDelay(rand(6000, 8000), signal);
await abortableDelay(rand(6000, 9000), signal);
~~~

- [ ] Chuyển các page.waitForTimeout còn lại trong auth/DOB/onboarding được chạm sang abortableDelay cùng duration. Cập nhật fake timers để chạy timer ứng dụng thật; không mock abortableDelay thành immediate để tránh RED.
- [ ] Inventory từng await trong fillVerified/clickUntilVisible/readAuthHeading/fillOtp/DOB/dismissOnboarding/post-submit/fallback goto. Đọc chậm/Stop có gate trước và sau:

~~~ts
await boundedDomRead(
  () => input.waitFor({ state: 'visible', timeout: 25000 }),
  stage + ':visible',
  25000,
  signal
);
signal.throwIfAborted();
~~~

stage/input/signal là parameters của fillVerified hiện có. readAuthHeading thêm signal:AbortSignal và truyền từ caller. Giữ timeout hiện có từng function, không mặc định đổi hết sang 25000.

- [ ] Phân biệt rõ: Playwright navigation đã reject/timeout và settle thì giữ fallback cũ; Abort rethrow đúng signal.reason; host OperationDeadlineError/DomReadTimeoutError khi command còn pending phải rethrow typed failure, không dispatch fallback goto chồng lên navigation chưa settle. Test hai nhánh độc lập. Không abandon newPage/profile/paid request. Kiểm post-await trước callback tiếp theo.
- [ ] Test từng boundary bằng deferred đã entered: post-submit waitForURL, fallback goto, DOB option/readback, heading/overlay. Abort → exact reason, release late → no click/log success. Abort 3999ms trong pacing riêng với marker chưa gọi.
- [ ] Full neighboring tests GREEN; review diff chứng minh không đổi request/order/pacing, chỉ cancellation và bỏ deadline tự tranh với delay.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/authCancellation.test.ts src/main/services/capcut/__tests__/verifiedTyping.test.ts src/main/services/capcut/__tests__/trial.test.ts src/main/services/capcut/__tests__/boundedInteractions.test.ts`

## T02 — A03: checkbox membership ổn định

**Modify:** src/main/services/capcut/signup.ts.
**Create/Test:** src/main/services/capcut/__tests__/signupTerms.test.ts.
**Contract:** chỉ visible unchecked terms hiện hữu được xử lý; no new consent options.

- [ ] Stateful actual-signup fixture phải có locator :not(:checked) thu nhỏ sau click; full checkbox locator không đổi membership. RED hai ô → [true,false] trước Submit.
- [ ] Thay private acceptTermsIfAny, giữ scheduler/click behavior:

~~~ts
const boxes = page.locator('input[type="checkbox"]');
const count = await boundedDomRead(() => boxes.count(), 'signup:terms-count', 1000, signal);
let processed = 0;
for (let index = 0; index < count; index += 1) {
  signal.throwIfAborted();
  const box = boxes.nth(index);
  if (!(await boundedDomRead(() => box.isVisible(), 'signup:terms-visible', 1000, signal))) continue;
  if (await boundedDomRead(() => box.isChecked(), 'signup:terms-checked', 1000, signal)) continue;
  await foregroundPage(page, { signal, stage: 'signup:accept-terms', ui }, async () => {
    await box.click({ timeout: 2500, force: true });
    if (!(await boundedDomRead(() => box.isChecked(), 'signup:terms-readback', 1000, signal))) {
      throw new Error('SIGNUP_TERMS_NOT_ACCEPTED');
    }
  });
  processed += 1;
}
if (processed > 0) log('   → Đã xử lý ' + processed + ' checkbox điều khoản');
~~~

- [ ] Tests checked-first/hidden/two unchecked, second click no effect, Stop, no-checkbox. Submit không chạy khi required visible checkbox không check được. Giữ trạng thái đã check, không toggle lại.
- [ ] GREEN actual-signup chain tới Submit, không chỉ exported helper hoặc regex source check.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/signupTerms.test.ts src/main/services/capcut/__tests__/verifiedTyping.test.ts`

## T03 — A02: random DOB hợp lệ, đúng option và readback

**Create:** src/main/services/capcut/birthday.ts.
**Modify:** src/main/services/capcut/signup.ts, src/main/services/capcut/auth.ts, src/main/services/CapcutEngineService.ts; src/main/runtime/providerStack.ts chỉ khi wiring range đã được xác nhận.
**Create/Test:** src/main/services/capcut/__tests__/birthday.test.ts, src/main/services/capcut/__tests__/signupBirthday.test.ts; tools/fixtures/dom-birthday.html nếu fixture DOM đã review được.
**Interfaces mới:** Birthday{year,month,day}, BirthdayRange{earliest,latest}, generateBirthday(range,random?), SignupOptions/AuthOptions.getBirthday?:()=>Birthday, CapcutEngineOptions.birthdayRange?:BirthdayRange.

### T03-A — chuẩn bị generator và fixture (không tự đổi policy)

- [ ] Tests explicit fixture range leap 2000-02-28…03-01; RNG 0/0.5/1-epsilon phải trả 28/29/01. Test 1900-02-29 invalid, reversed, single-day, invalid RNG, no mutate input.
- [ ] Generator:

~~~ts
export interface Birthday { year: number; month: number; day: number; }
export interface BirthdayRange { earliest: Birthday; latest: Birthday; }
const DAY_MS = 86_400_000;

function dayIndex(value: Birthday): number {
  if (![value.year, value.month, value.day].every(Number.isInteger) ||
      value.year < 1 || value.year > 9999) throw new Error('BIRTHDAY_RANGE_INVALID');
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  if (date.getUTCFullYear() !== value.year ||
      date.getUTCMonth() + 1 !== value.month ||
      date.getUTCDate() !== value.day) throw new Error('BIRTHDAY_RANGE_INVALID');
  return date.getTime() / DAY_MS;
}

export function generateBirthday(
  range: BirthdayRange,
  random: () => number = Math.random
): Birthday {
  const first = dayIndex(range.earliest);
  const last = dayIndex(range.latest);
  if (first > last) throw new Error('BIRTHDAY_RANGE_INVALID');
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('BIRTHDAY_RANDOM_INVALID');
  }
  const date = new Date((first + Math.floor(sample * (last - first + 1))) * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
~~~

- [ ] Không có age 18–35/year-range default ở generator. Fixtures là dữ liệu test, không policy production.

### T03-B — wiring sau khi range được chốt

- [ ] Ghi range/age policy user xác nhận vào checkpoint. Nếu chưa có: WAITING-DOB-POLICY cho T03-B, không claim A02 fixed. Không thêm runtime missing-range blocker vào signup hiện tại trước khi wiring sẵn.
- [ ] Tạo getBirthday cho một signup attempt và chuyển qua cả hai nhánh signup trong auth.ts. Memoize intendedBirthday tại scope signupCapcut bằng closure getAttemptBirthday, không chỉ biến local trong mỗi lần handleBirthdayIfPresent. Closure chỉ gọi nguồn RNG lần đầu khi DOB screen đã detected; các lần helper retry dùng lại cùng triple.
- [ ] Review DOM fixture xác định dropdown owner; không bịa aria-controls/data-value chưa có evidence. Select year/month/day bằng unique visible value/text thuộc dropdown đang mở, không global.first/nth14/fallbackfirst.
- [ ] Read back cả triple trước Continue; missing option/mismatch phải lỗi cụ thể, không đổi intended date để đi tiếp.
- [ ] Giữ 400/600/400/600/400/5000ms pacing bằng abortableDelay; no DOB screen không gọi RNG.
- [ ] Test reordered/hidden options, February/leap, repeated handler retry dùng date cũ, mismatch → no Continue, Stop. Không thêm HTTP DOB endpoint hoặc DB migration.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/birthday.test.ts src/main/services/capcut/__tests__/signupBirthday.test.ts src/main/services/capcut/__tests__/auth.test.ts`

## T04 — A04/M02: uncertainty không biến thành cleared/skipped

**Modify:** src/main/services/capcut/trial.ts; src/main/services/AutomationRunService.ts.
**Test:** src/main/services/capcut/__tests__/trial.test.ts; src/main/services/__tests__/CapcutEngineService.test.ts, src/main/services/__tests__/automationTaskProgress.test.ts, src/main/services/__tests__/AutomationRunService.test.ts.

- [ ] RED survey-read initial/post-Skip rejects; fake must distinguish outer read với read trong skipOnboardingSurvey. Assert no Upgrade/no evaluate, unknown/typed failure; actual mid-read Stop chứ không pre-abort.
- [ ] Xóa .catch(()=>false) ở clearTrialSurvey; only successful false nghĩa absent. Caller xử lý:

~~~ts
let surveyCleared: boolean;
try {
  surveyCleared = await clearTrialSurvey(page, log, ui, signal);
} catch (error) {
  signal.throwIfAborted();
  if (isDomReadTimeout(error) || error instanceof OperationDeadlineError) throw error;
  return fallback('Không xác minh được trạng thái khảo sát onboarding');
}
~~~

Import OperationDeadlineError nếu dùng. Giữ known survey-still-visible unknown và pricing-already-open; không đóng pricing như survey.

- [ ] RED engine shape {skipped:true,fatalError,verification:null} qua actual runtime classifier phải failed; intentional skip không fatal vẫn skipped.
- [ ] Đưa fatalError check lên trước skipped trong classifyUiResult; update subscription nếu đã biết nhưng không set done. Không tăng completed/skipped cho fatal.
- [ ] Full trial/engine/runtime integration GREEN; không sửa isEligible để né read failure.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/trial.test.ts src/main/services/__tests__/CapcutEngineService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/AutomationRunService.test.ts --maxWorkers=4`

## T05 — M05: terminal write failure có owner/counter trung thực

**Modify:** src/main/services/AutomationRunService.ts; src/main/services/AutomationTerminalError.ts nếu thêm optional cause.
**Test:** src/main/services/__tests__/AutomationRunService.test.ts; src/main/services/__tests__/fixtures/deterministicRunHarness.ts chỉ test-oracle improvements T19.
**New internal state:** ThreadRuntime.outcomePersisted?:boolean; terminalPersistenceFailure:AutomationTerminalError|null; commitOutcome(thread,outcome,persisted):void.

- [ ] RED trong existing fixtures, dùng update contract {success:boolean}:

~~~ts
it.each(['throw', 'false'] as const)('T05 terminal update %s fails run', async mode => {
  const original = accounts.update.bind(accounts);
  let terminalAttempts = 0;
  accounts.update = (id, data) => {
    if (['done', 'error', 'stopped'].includes(String(data.status))) {
      terminalAttempts += 1;
      if (mode === 'throw') throw new Error('fixture terminal write failure');
      return { success: false };
    }
    return original(id, data);
  };
  const service = createService();
  await service.start(baseConfig({
    threadCount: 1,
    emailSource: { mode: 'manual', entries: ['demo@example.test|demo'] }
  }));
  const result = await service.waitForCompletion();
  expect(result).toMatchObject({
    state: 'failed', accountsAccepted: 1, accountsCompleted: 0,
    accountsFailed: 1, accountsStopped: 0, workersActive: 0,
    terminalReason: { code: 'INTERNAL_ERROR',
      details: { failure: 'ACCOUNT_TERMINAL_PERSISTENCE_FAILED', persisted: false } }
  });
  expect(terminalAttempts).toBe(1);
  expect(browser.stopped).toEqual(['profile-1']);
  expect(proxySource.released).toEqual(proxySource.acquired);
});
~~~

- [ ] commitOutcome gán outcome một lần + counter tương ứng + account-terminal evidence. recordOutcome chỉ gọi với intended outcome sau DB update.success===true.
- [ ] On DB throw/false: đặt terminalPersistenceFailure đầu tiên trước publish; commit một failed in-memory outcome persisted=false; accept failed intent và abort acquisition/workers; giữ original cause main-only. Không retry write/workload tự động, không bịa DB status đã error.
- [ ] Finalization và stop completion phải ưu tiên flag persistenceFailure này, kể cả terminalIntent đã USER_STOP/MAIL_LIMIT; không thay precedence của các loại lỗi khác. Reset flag khi start run mới.
- [ ] Worker catch thấy failed outcome đã locked không increment lần nữa; finally cleanup/notifyDone vẫn chạy.
- [ ] Test intended completed/skipped/stopped, userStop+writeFail,hai workers fail,writeFail+cleanupFail, true success once, {success:false}. Giữ failed reason/cause và thông báo DB chưa persist.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/automationTaskProgress.test.ts --maxWorkers=4`

## T06 — M01/M07: CAS đúng credential snapshot

**Modify:** src/main/repositories/CredentialRepository.ts; src/main/services/MultiloginAuthService.ts, src/main/services/ServiceConnectionManager.ts.
**Test:** src/main/repositories/__tests__/repositories.test.ts; src/main/services/__tests__/MultiloginAuthService.test.ts, src/main/services/__tests__/providerConnectivity.test.ts.
**No migration.** Không dùng updated_at giây làm unique revision.

- [ ] RED replace/delete giữa deferred signIn/refresh và connectivity probe. New getAccessToken phải dùng config mới, old flight completion không overwrite/delete row mới.
- [ ] Thêm repository methods:

~~~ts
replaceEncryptedIfUnchanged(name: string, expected: Buffer, replacement: Buffer): boolean {
  return this.db.prepare(`
    UPDATE service_credentials
    SET encrypted_credentials = ?, updated_at = datetime('now')
    WHERE service_name = ? AND encrypted_credentials = ?
  `).run(replacement, name, expected).changes === 1;
}

updateMetadataIfUnchanged(
  name: string, expected: Buffer, metadata: CredentialDiagnosticMetadata
): boolean {
  const encoded = JSON.stringify(CredentialDiagnosticMetadataSchema.parse(metadata));
  return this.db.prepare(`
    UPDATE service_credentials SET metadata = ?, updated_at = datetime('now')
    WHERE service_name = ? AND encrypted_credentials = ?
  `).run(encoded, name, expected).changes === 1;
}
~~~

- [ ] readSnapshot returns copied encryptedBuffer + parsedBlob. InFlight keyed by encryptedBuffer.equals and authGeneration. Old finally chỉ clear nếu promise identity còn đúng; new config không share old flight.
- [ ] persistSession(snapshot,generation,session) CAS miss → CONFIG_ERROR fixed message, không return stale token. Session CAS không ghi metadata cũ.
- [ ] Refresh try/catch chỉ bao provider call, không bao CAS/persist; CAS miss không được trigger sign-in fallback bằng old password.
- [ ] Ngay trước fallback sign-in khi provider refresh reject, kiểm lại snapshot BLOB và authGeneration; replace/delete trong lúc refresh pending phải reject CONFIG_ERROR, không gọi signIn bằng credentials cũ. Thêm regression deferred refresh reject sau replace/delete và assert fallback signInCalls=0.
- [ ] invalidateSession tăng generation kể cả chưa có session; remove-session dùng CAS. Draft auth không persist.
- [ ] M07 capture current blob trước provider.testConnection; sau await chỉ merge current metadata nếu blob match và conditional update thành công. Không gắn old result cho newly configured/deleted row.
- [ ] Tests nguyên snapshot, changed blob, deleted, absent→new, A xong sau khi B bắt đầu → third call share B; cùng blob nhưng metadata mới giữ; draft test không write.
- [ ] Limit: BLOB CAS value-based, không claim historical identity cho byte-identical ABA; Multilogin self-rotation có thể skip cache update, report diagnostic return nhưng not cached.

Test addition trong MultiloginAuthService.test.ts:

~~~ts
it.each(['replace', 'delete'] as const)('T06 ignores stale sign-in after %s', async change => {
  storeAuth({ mode: 'credentials', email: 'old@example.test', password: 'old-demo' });
  let resolve!: (value: MultiloginTokens) => void;
  api.signIn = () => new Promise(done => { resolve = done; });
  const service = createService();
  const pending = service.getAccessToken();
  const assertion = expect(pending).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  if (change === 'replace') {
    storeAuth({ mode: 'token', automationToken: 'new-demo' });
    await expect(service.getAccessToken()).resolves.toBe('new-demo');
  } else credRepo.delete('multilogin');
  resolve({ token: 'old-jwt', refreshToken: 'old-refresh' });
  await assertion;
  const current = credRepo.getCredential('multilogin');
  if (change === 'delete') expect(current).toBeNull();
  else expect(JSON.parse(vault.decrypt(current!.encryptedCredentials))).toEqual({
    mode: 'token', automationToken: 'new-demo'
  });
});
~~~

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/__tests__/MultiloginAuthService.test.ts src/main/services/__tests__/providerConnectivity.test.ts src/main/repositories/__tests__/repositories.test.ts --maxWorkers=4`


## T07 — B03/C02: Start single-flight và reset đúng tập log cũ

**Modify:** src/main/services/AutomationRunService.ts, src/main/services/LogBus.ts; src/main/repositories/LogRepository.ts; src/main/runtime/providerStack.ts; src/main/ipc/automationIpc.ts; src/main/main.ts; src/shared/contracts/api.ts, src/shared/contracts/ipc-channels.ts; src/shared/schemas/log.schema.ts; src/preload/preload.ts; src/renderer/pages/Dashboard/dashboardController.ts, src/renderer/pages/Dashboard/DashboardPage.tsx, src/renderer/pages/Dashboard/DashboardActionBar.tsx; src/renderer/pages/Logs/logsController.ts, src/renderer/pages/Logs/LogsPage.tsx.
**Test:** src/main/ipc/__tests__/runtimeIpc.test.ts, src/main/services/__tests__/AutomationRunService.test.ts, src/main/services/__tests__/LogBus.test.ts, src/main/ipc/__tests__/logsIpc.test.ts, src/preload/__tests__/preload.test.ts, src/shared/contracts/__tests__/contracts.test.ts, src/shared/schemas/__tests__/schemas.test.ts; src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts, src/renderer/pages/Logs/__tests__/logsController.test.ts.
**Không đổi startup workflow/vendor requests.** Reset chỉ sau preflight thành công và trước workers.

T07 và T08 là cặp dependency tại controller Start: T07-A làm main reset/event trước; T08 làm config revision/save queue; T07-B nối pinned Start snapshot và regression chung sau đó. Không đánh dấu T07 toàn phần GREEN khi configRevision hoặc flush target của T08 chưa có. Một owner giữ các file Dashboard chung.

### Quyết định implementation

Dùng **exact ID snapshot**, không rowid cutoff (SQLite có thể reuse sau deletion), không DB migration/temp table/log staging. Chi phí một lần/run O(số log IDs hiện có); chỉ giữ IDs, không payload. Ticket free khi attempt settle; không cache cả lịch sử lâu dài.

New main-only interface:

~~~ts
interface StartLogResetTicket {
  runId: string;
  ids: readonly string[];
  throughSequence: number;
}
interface StartLogResetPort {
  capture(runId: string): StartLogResetTicket;
  commit(ticket: StartLogResetTicket): { clearedThrough: number };
}
~~~

AutomationRunCollaborators.logReset?:StartLogResetPort; production wiring có, fixture optional giữ tương thích. Ticket single-use theo object identity/owner runId, không nhận từ renderer.

LogRepository thêm listIds():string[] và deleteIds(ids:readonly string[]):void. listIds chỉ SELECT id; delete batches<=400 trong cùng db.transaction. Queue snapshot lấy IDs hiện tại; commit chỉ remove đúng IDs sau SQL thành công. LogBus đã có sequence; dùng sequence tại capture. IDs runtime là UUID không reuse; manual DB restore ngoài task không được gọi an toàn dưới ticket đang pending.

- [ ] REDs: active Start reject, schema không hợp lệ, preflight thất bại/Stop trước commit đều không xóa; queue cũ flush trong preflight vẫn bị reset; log preflight mới giữ; SQL delete thất bại rollback giữ queue; explicit Clear/retention trước commit không xóa log mới vì UUID IDs khác.
- [ ] Xóa logRepo.clearAllLogs từ RUN_START IPC và xóa renderer logs.clear/optimistic logs=[]; explicit “Xóa Logs” vẫn nguyên.
- [ ] start sau ownership guard reserve attempt và capture ticket trước preflight logs. Sau source.prepare và runSignal.throwIfAborted, commit đồng bộ rồi mới publish running/runPrepared. Commit lỗi → no workers, báo failure, no fake success.
- [ ] Start reply additive clearedThrough?:number qua typed contract. LogBus reset phát **named typed event LOGS_RESET {clearedThrough}** tại commit/explicit Clear sau SQL+queue reset; main forward, preload subscribe. Không raw channel API.
- [ ] SQL transaction + queue update quyết định reset committed. Observer/listener/IPC-forwarder lỗi không được biến reset đã commit thành failed Start hoặc gọi delete lại; isolate lỗi notification, ticket vẫn single-use. Capture ticket lỗi phải giải phóng starting owner trong finally và không chạy preflight/workers.
- [ ] Dashboard/Logs nhận reset: apply max watermark; prune unconfirmedPushes, pendingPushes, clearPushes, clearSurvivors và canonical rows theo cutoff; invalidate history token. Thêm resetEpoch nội bộ cho cả history response và captured previousRows của Clear: higher reset làm captured unsequenced history cũ không được restore khi Clear cũ fail. Giữ received sequence>cutoff, authoritative reload cho history thiếu sequence. Local clearPromise vẫn settle đúng owner; reset event không dispatch delete lần hai. Dispose unsubscribe/generation như hiện tại.
- [ ] Cả header và ActionBar nhận isSubmitting; controller.start đặt latch trước await flush, snapshot config tại entry, release trong finally guarded:

~~~ts
start(): Promise<boolean> {
  if (this.pendingStart) return this.pendingStart;
  const revision = this.configRevision;
  const snapshot = structuredClone(this.state.config);
  this.setState({ isSubmitting: true, error: null });
  const operation = this.startSnapshot(snapshot, revision).finally(() => {
    if (this.pendingStart !== operation) return;
    this.pendingStart = null;
    this.setState({ isSubmitting: false });
  });
  this.pendingStart = operation;
  return operation;
}
~~~

pendingStart và startSnapshot(snapshot, revision) là private mới trong T07. configRevision/save-target behavior phối hợp T08; không đọc current config sau await. Pacing/config payload không đổi. Rejection caught → false+error. Không await snapshot refresh trước gửi Stop IPC.

### AC/verify

- [ ] Double Start trong save pending/run reply pending →1 run.start,0 renderer clear; Start reject không đổi history đang hiển thị.
- [ ] Log preflight tới trước reply phải vẫn visible/DB sau success; failures giữ old+error logs.
- [ ] Active LogsPage nhận reset event khi Dashboard đã rời trang; cutoff không bị late list/push hồi sinh.
- [ ] Explicit Clear khi Start pending, duplicate event/reply, SQL rollback, ticket reused → safe/one commit.
- [ ] Tests actual main port+real temp SQLite transaction, không chỉ assert callback được gọi.
- [ ] Test Clear cũ thất bại sau reset Start mới: không restore old unsequenced previousRows. Test reset cutoff thấp đến sau cutoff cao: watermark không lùi. Notification throw sau commit không đổi start verdict hoặc lặp deletion.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/ipc/__tests__/runtimeIpc.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/services/__tests__/LogBus.test.ts src/preload/__tests__/preload.test.ts src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/renderer/pages/Logs/__tests__/logsController.test.ts --maxWorkers=4`

## T08 — B01/B02: Dashboard save/load theo revision, không stale settings write

**Modify:** src/renderer/pages/Dashboard/dashboardController.ts, src/renderer/pages/Dashboard/DashboardPage.tsx (offline/fallback bridge); src/main/services/SettingsService.ts; src/main/ipc/settingsIpc.ts; src/shared/schemas/settings-save.schema.ts, src/shared/contracts/api.ts, src/shared/contracts/ipc-channels.ts; src/preload/preload.ts.
**Test:** src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts, src/main/services/__tests__/SettingsService.test.ts, src/main/ipc/__tests__/settingsIpc.test.ts, src/preload/__tests__/preload.test.ts, src/shared/contracts/__tests__/contracts.test.ts, src/shared/schemas/__tests__/schemas.test.ts.
**Narrow API:** settings.saveAutomation(automation):Promise<IpcEnvelope<{success:boolean}>>. Đây là save đúng phần Dashboard quản lý, không credential/migration redesign.

- [ ] RED save11→edit12→success11→fail12; fail11→success12; rejected IPC; settings load pending→edit17→reply10; progress push running trước response idle; live push trước history reply empty.
- [ ] Main method validate bằng AppSettingsSchema.shape.automation rồi merge fresh trong transaction:

~~~ts
saveAutomationSettings(automation: AppSettingsDTO['automation']): void {
  const parsed = AppSettingsSchema.shape.automation.parse(automation);
  this.transactionRunner.run(() => {
    const current = this.settingsRepo.getAppSettings() ?? DEFAULT_APP_SETTINGS;
    this.settingsRepo.saveAppSettings({ ...current, automation: parsed });
  });
}
~~~

AppSettingsSchema import từ settings.schema. Thêm SETTINGS_SAVE_AUTOMATION='settings:save-automation' trong ipc-channels.ts, IpcContractRegistry.settings.saveAutomation.request = AppSettingsSchema.shape.automation và response {success:boolean}. ElectronBridge/IDashboardBridge và preload chỉ thêm method named saveAutomation; không credentials array/full stale settings từ Dashboard. Cleanup deregister channel; strict request test loại field ngoài automation. Không sửa format DB/vault.

- [ ] configRevision tăng mỗi edit. Queue tối đa một active save, một coalesced background-next và một pinned Start barrier nếu có. saveConfig boolean chỉ true khi chính snapshot đó được commit; waiter của revision bị supersede/coalesce trả false hoặc internal superseded result, không true giả. saved badge chỉ currentRevision===committedRevision. isSavingConfig phản ánh active/pending owners, không bị old finally tắt sớm.
- [ ] flushPendingSave(targetRevision) đợi snapshot/barrier của target, không chờ global idle khi edits liên tục. Start pin snapshot/revision, không coalesce mất pinned target vào edit sau; sau khi target settle Start gửi đúng snapshot. Nếu autosave tắt thì không buộc save mới; nếu autosave đã thất bại cho target, Start không giả định lưu thành công.
- [ ] Load capture loadToken/lifecycleGeneration/configRevision và per-field touched revisions. Sau mỗi await/catch/finally kiểm token. Hydrate untouched fields, plaintext draft list/custom password giữ.
- [ ] Khi initial load đang pending và user edit trước stored settings ready, chỉ queue autosave sau base load; không overwrite edit.
- [ ] Progress reply chỉ apply nếu không progress push mới từ request start; history merge buffer riêng của request + reset watermark T07.
- [ ] Giữ snapshot pair S03 current/next completion; không thay bằng global drain promise hoặc bypass từ load/stop/remove.
- [ ] Settings edit general/sessionRestore giữa Dashboard load và saveAutomation → general mới vẫn giữ. Test real SettingsService cho narrow merge, không mock tự mong muốn.
- [ ] S03 tests gọi thật poll tick/remove, một nhánh lỗi vẫn chờ nhánh còn lại.

Run (focused): `node node_modules/vitest/vitest.mjs run src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/main/services/__tests__/SettingsService.test.ts src/main/ipc/__tests__/settingsIpc.test.ts src/preload/__tests__/preload.test.ts --maxWorkers=4`

## T09 — B04/B05: Settings hydration và committed boot prefs

**Modify:** src/renderer/pages/Settings/settingsController.ts, src/renderer/pages/Settings/SettingsPage.tsx.
**Test:** src/renderer/pages/Settings/__tests__/settingsController.test.ts; new component interaction test scripts/bugfix-ui fixture taskT13 extension.
**Giữ:** save():Promise<boolean>. Thêm getter getLastCommittedGeneral():{revision:number;general:Pick<AppSettingsDTO['general'],'theme'|'sessionRestore'>}|null, không trả secret payload.

- [ ] RED load pending→draft replace→reply keep; edit general trong lúc load,hai load đảo reply,dispose/replay,old failure/finally; save false+boot write và save true+edit mới trong lúc chờ.
- [ ] Load token/generation; per-service draft revision và per-setting touched-field revision; chỉ hydrate fields chưa sửa. Dispose ngăn stale publish nhưng effect replay không xóa current draft. Real unmount instance không được persisted sang storage mới.
- [ ] save snapshot current payload/revision tại entry; response success.data.success true mới commit; reset keep chỉ sent revision không có edit mới. **Commit và refresh tách hai try/catch**; refresh reject báo warning nhưng boolean true và lastCommittedGeneral đã có.
- [ ] Save/refresh completion cũng capture lifecycle generation như load; old completion có thể ghi nhận commit đã xảy ra nhưng không reset isSaving/error/statuses/drafts của lifecycle mới. Nếu component đã unmount, không apply boot preferences từ callback cũ. Không biến dispose thành hủy một DB write đã dispatch.
- [ ] Page handler dùng committed snapshot, không current draft:

~~~ts
const saved = await controller.save();
if (!saved) return;
const committed = controller.getLastCommittedGeneral();
if (!committed) return;
writeBootPreferences(window.localStorage, committed.general);
applyTheme(committed.general.theme, document.documentElement);
~~~

- [ ] Nếu user edit sessionRestore=false trong lúc snapshot true đang save, UI draft false giữ, boot apply true, isSaved false. Save kế tiếp sẽ commit false. Lỗi localStorage báo lỗi apply local không sửa DB commit status.
- [ ] Explicit failure/reject save không xóa input, noboot write. Busysecond save falsereturnkhôngđượcappplyoldcommit.

Run (focused): `node node_modules/vitest/vitest.mjs run src/renderer/pages/Settings/__tests__/settingsController.test.ts src/renderer/app/__tests__/appPreferences.test.ts`

## T10 — M03/M04: normalize route và bảo toàn password

**Modify:** src/main/services/AutomationRunService.ts, src/main/services/DirectProxyPool.ts nếu cần constructor duplicate guard dùng chung normalizer.
**Test:** src/main/services/__tests__/directProxy.test.ts, src/main/services/__tests__/DirectProxyPool.test.ts, src/main/services/__tests__/AutomationRunService.test.ts.
**Contract:** same full normalized route means scheme/host/port/username/password identical. Không gộp khác proxy credentials như cùng IP.

- [ ] RED parser password chứa colon và capacity route trùng→pool:

~~~ts
expect(parseDirectProxy('192.0.2.1:8080:demo:a:b')).toMatchObject({
  host: '192.0.2.1', port: 8080, username: 'demo', password: 'a:b'
});
~~~

- [ ] Dạng host:port:user:pass: tách ba phần đầu, giữ remaining.join(':') cho password; dạng user:pass@host giữ first auth colon hiện tại semantics. Giữ validation port/scheme, không bỏ qua các phần địa chỉ dư.
- [ ] Normalize scheme/host lowercase, numericport, giữ hoa/thường của auth; JSON.stringify tuple làm route key, không nối delimiter mơ hồ chứa colon/password.
- [ ] parseDirectProxyList reject duplicate với **số dòng**, không log raw credential; check duplicates trước capacity. Không tự giảm concurrency hoặc silently dedup mà thay run config.
- [ ] Pool constructor defensive check nếu direct caller đưa duplicate; export local route-key helper nếu dùng hai nơi, không trùng code/không manager global mới.
- [ ] Tests scheme omitted=http, whitespace normal, cùng host khác auth vẫn distinct, input không hợp lệ,hai route unique/FIFO/cancel, runtime no profile/purchase khi duplicate.
- [ ] Không gửi provider requests để “đo IP” thay cho reject duplicate exact input.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/__tests__/directProxy.test.ts src/main/services/__tests__/DirectProxyPool.test.ts src/main/services/__tests__/AutomationRunService.test.ts --maxWorkers=4`

## T11 — M06: throttle failed log flush, giữ pending và báo đúng shutdown

**Modify:** src/main/services/LogBus.ts; src/main/main.ts, src/main/runtime/providerStack.ts chỉ wiring diagnostic ngoài LogBus.
**Test:** src/main/services/__tests__/LogBus.test.ts, src/main/__tests__/lifecycle.test.ts; LogBus reset T07 tests.
**Chosen policy:** không silent drop. Bound **batch/frequency**, giữ accepted pending FIFO; RAM không được hứa bounded vô hạn. Không thêm spool/drop cap trong task.

- [ ] RED 1.000 emits vào failing sink, clock fixed hiện gây 951 flush. Mục tiêu mới chỉ một attempt trước flush interval kế tiếp; mỗi attempt<=maxBatchSize. Recovery giữ all IDs unique/FIFO.
- [ ] Add retryNotBefore=0. threshold emit thử flush chỉ now>=retryNotBefore; failure đặt now+flushInterval; timer/manual flush tuân thủ gate. No while-drain trong emit.
- [ ] Normal flush một batch queue.slice(0,maxBatchSize), remove đúng số lượng batch after transactional sink success, không trước đó. Thông báo một safe lỗi ghi qua kênh out-of-band; do not recursively bus.emit diagnostic.
- [ ] dispose stops timer, one forced final attempt bypass cooldown; drain finite accepted queue in maxBatch batches while success; failure đầu tiên thì break và throw fixed LOG_FLUSH_INCOMPLETE khi pending còn. Không loop retry failure.
- [ ] ExplicitClear/Start reset ticket T07 deletequeue onlyafterSQL thành công, reset retry flag khi queue rỗng. No xóa log mới.
- [ ] Optional high-water warning một lần/cycle (ví dụ threshold maxBatchSize×100) **không cap/drop**; count pending/durable status mới warning only, không đánh task failure.
- [ ] Test:

~~~ts
it('T11 failed writes wait for retry schedule and recover FIFO', () => {
  let failing = true;
  const attempts: number[] = [];
  const saved: string[] = [];
  const bus = createBus({
    insertBatch: rows => {
      attempts.push(rows.length);
      if (failing) throw new Error('fixture disk full');
      saved.push(...rows.map(row => row.id));
    }
  }, 50);
  bus.start();
  const emitted: string[] = [];
  for (let i = 0; i < 1000; i += 1) {
    emitted.push(bus.emit({ email: 'system', step: 'fixture', status: 'INFO', message: String(i) }).id);
  }
  expect(attempts).toEqual([50]);
  scheduler.tick();
  expect(attempts).toHaveLength(1);
  now += 500;
  scheduler.tick();
  expect(attempts).toEqual([50, 50]);
  failing = false;
  for (let i = 0; i < 20; i += 1) { now += 500; scheduler.tick(); }
  expect(saved).toEqual(emitted);
  expect(bus.pendingCount()).toBe(0);
  bus.dispose();
});
~~~

createBus fixture interval 500ms hiện có. Thêm dispose failure khi pending=1 phải throw; clear failure giữ pending; sink contract all-or-nothing hiện LogRepository.insertBatch.transaction. Diagnostic callback lỗi cũng không được phá queue bookkeeping hoặc recursively emit vào bus.
- [ ] Gate không claim RAM hữu hạn và no-loss trong outage vô hạn; nếu cần hard memory bound phải chọn spool/drop policy ngoài task, không lén drop.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/__tests__/LogBus.test.ts src/main/__tests__/lifecycle.test.ts`

## T12 — B06/B10: provenance Clear replay và WARNING

**Modify:** src/renderer/pages/Logs/logsController.ts, src/renderer/pages/Logs/columns.tsx; src/shared/types/log.ts.
**Test:** src/renderer/pages/Logs/__tests__/logsController.test.ts; create src/renderer/pages/Logs/__tests__/logsRendering.test.tsx.
**Giữ:** normalized WeakMap/upsertSorted, sync push, cap/query/latest load/Clear barrier.

- [ ] RED exact preclear seq1→clear→dispose/attach→waiting load→failure/rejection→SQL[]: row bị mất. Thêm ack rồi history delete không resurrect; success cutoff1 bỏ seq1, giữ seq2.
- [ ] Giữ unconfirmedPushes khi có in-flight Clear hoặc snapshot preclear provenance vào clear-owned context trước dispose; không chỉ giữ displayed previousRows. Cách nhỏ nhất không xóa unconfirmed ở effect dispose, vẫn bound cap/clear/ack. Instance thật unmount sẽ được GC; tránh tạo permanent global cache.
- [ ] finally/identity của old response không xóa context Clear mới; tests nhiều filter/failure lặp/legacy reset/replay event T07.
- [ ] Canonical type:

~~~ts
import type { CanonicalLogStatus } from '../schemas/log.schema';
export type LogStatus = CanonicalLogStatus;
~~~

- [ ] toViewLog status=entry.status không cast. Badge mapping WARNING→warning/waiting style hiện có; SUCCESS xử lý canonical, bỏ obsolete WARN/OK usages sau rg. Test actual cell HTML text+variantclass, không test string trong source.
- [ ] Performance gate S02 existing counts + retained view identity vẫn pass; no full sort mỗi push.

Run (focused): `node node_modules/vitest/vitest.mjs run src/renderer/pages/Logs/__tests__/logsController.test.ts src/renderer/pages/Logs/__tests__/logsRendering.test.tsx`


## T13 — B07/B08: export/task dialog có ownership và xử lý rejection

**Modify:** src/renderer/pages/Accounts/ExportDialog.tsx, src/renderer/pages/Accounts/TaskProgressDialog.tsx; src/renderer/pages/Accounts/accountsController.ts nếu normalize rejected IPC tại boundary.
**Create/Test:** scripts/bugfix-ui/index.html, scripts/bugfix-ui/fixture.tsx, scripts/bugfix-ui/host.cjs; scripts/check-bugfix-ui.mjs. Giữ src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx SSR và src/renderer/pages/Accounts/__tests__/accountsController.test.ts.
**Không thêm test dependency.** Dùng React/Vite/Electron/playwright-core sẵn có, test components thật trên fixture riêng, không production main.

### Production patch

- [ ] Export: ref latch đặt trước await, snapshot format/fields/scope/IDs; catch→error, finally giải phóng đúng operation.
- [ ] Close/reopen chỉ thay session identity của status, không hủy export đã dispatch hoặc mở latch cho export2 trong lúc export1 pending. Old completion release own latch nhưng không show old path/error ở session mới.
- [ ] Reject phải cho retry sau operation settle; canceled save dialog trung tính, không error.
- [ ] Task dialog store identity với data; render receipt chỉ khi loaded.accountId===props.accountId ngay cả render trước useEffect. Trong effect setData(null), setError(null), bounded token/canceled guard ở then/catch/finally.
- [ ] initialData chỉ gắn vào initial account; account change/null/no-loader không để receipt cũ lại dưới email mới.
- [ ] Controller exportAccounts/loadTasks bắt rejected IPC hoặc đảm bảo component bắt; giữ error envelope hiện có, không set empty success.

### Mounted fixture/test boundary

- [ ] index.html chỉ root div và module fixture.tsx. fixture import **actual** ExportDialog/TaskProgressDialog và renderer/styles/index.css; React StrictMode.
- [ ] fixture onExport/loadTasks trả deferred (không copy component logic). Buttons data-testid: open-export, reject-export, resolve-export, cancel-export, open-task-a, open-task-b, resolve-task-a, resolve-task-b, reject-task-b; output export-calls/task-calls. Bấm fixture parent control bằng evaluate(click) khi dialog overlay đang mở.
- [ ] Run script tạo Vite server configFile:false, plugins:[react()], alias @renderer/@shared, host127.0.0.1 port0. Không dùng project Vite config để tự mở production Electron.
- [ ] host.cjs tối thiểu:

~~~js
const { app, BrowserWindow, session } = require('electron');
app.whenReady().then(async () => {
  const target = new URL(process.env.BUGFIX_FIXTURE_URL);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') {
    throw new Error('FIXTURE_LOOPBACK_REQUIRED');
  }
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: url.origin !== target.origin && url.protocol !== 'data:' });
  });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  await win.loadURL(target.href);
}).catch(() => app.exit(1));
app.on('window-all-closed', () => app.quit());
~~~

Runner tạo userData bằng mkdtemp độc lập; _electron.launch(args[host,'--user-data-dir=...'],env với BUGFIX_FIXTURE_URL, remove ELECTRON_RUN_AS_NODE/NODE_OPTIONS/VITE_DEV_SERVER_URL); firstWindow rồi asserts bên dưới. Đóng app rồi server trong independent try/finally; chỉ delete exact owned temp nếu app close đã xác nhận, không process scan/kill.

- [ ] RED/GREEN test sequences:
  1. Open export→click Xuất→reject actual deferred→error visible, retry enabled.
  2. Export pending→close→reopen→export-calls vẫn1; resolve old→không có old success path ở new session, busy cleared.
  3. Show TaskA với receipt A, open B→trước reply không có data A/verified badge; reject B→error text, loading false, không có data A.
  4. A request pending→B request mới→resolve A late→không đè B; close/unmount→late error không unhandled.
  5. Cancel trung tính export không error, success với actual request fields/scope đúng.
- [ ] Runner capture pageerror/unhandledrejection; sau fix expect zero. SSR pass không thay mounted assertions.
- [ ] Test mở rộng T09 render actual SettingsPage fake window.electronAPI.settings: save false→boot prefs không đổi; snapshot true/edit false trong lúc await→save ack true→boot true/current false. Fixture dùng DEMO, không API calls.

Run (focused): `node scripts/check-bugfix-ui.mjs (GUI/Electron permission khi cần), rồi node node_modules/vitest/vitest.mjs run src/renderer/pages/Accounts/__tests__/accountsController.test.ts src/renderer/pages/Accounts/__tests__/TaskProgressDialog.test.tsx`

## T14 — B09: nguồn email nhất quán, không đổi legacy ngầm

**Modify:** src/renderer/pages/Accounts/AddAccountDrawer.tsx, src/renderer/pages/Accounts/EditAccountDrawer.tsx, src/renderer/pages/Accounts/AccountsToolbar.tsx.
**Create:** src/renderer/pages/Accounts/emailSourceOptions.ts (nếu cần dùng chung); src/renderer/pages/Accounts/__tests__/emailSourceOptions.test.ts.
**Test:** src/renderer/pages/Accounts/__tests__/accountsController.test.ts và mounted fixture T13.

- [ ] RED create Gmail từ drawer → filter manual không khớp; edit canonical gmail94 thiếu option. Test payload actual component, không chỉ constant.
- [ ] Canonical new options:

~~~ts
export const EMAIL_SOURCE_OPTIONS = [
  { value: 'manual', label: 'Nhập tay' },
  { value: 'gmail94', label: 'Gmail94' },
  { value: 'dongvanfb', label: 'DongVanFB' },
  { value: 'customdomain', label: 'Domain riêng' }
] as const;
~~~

- [ ] New manual default manual; label “Nguồn email”, không lẫn mailbox host Gmail/Outlook.
- [ ] Edit account legacy value chưa có options thì inject option chính xác hiện tại. Notes/password edit gửi legacy value unchanged; không map Gmail→gmail94 hoặc manual tùy tiện.
- [ ] Toolbar có canonical choices; optional legacy filter chỉ khi data có nhưng không bulk migration.
- [ ] Tests manual create hiện dưới manual filter, canonical bot edit, legacy Outlook notes-only unchanged, customdomain consistent.

Run (focused): `node node_modules/vitest/vitest.mjs run src/renderer/pages/Accounts/__tests__/emailSourceOptions.test.ts src/renderer/pages/Accounts/__tests__/accountsController.test.ts; mounted fixture T13`

## T15 — C03: transaction delete task data đúng account

**Modify:** src/main/repositories/AccountRepository.ts.
**Read:** AccountTaskRepository.deleteByAccount; giữ service.remove active guard.
**Test:** src/main/repositories/__tests__/repositories.test.ts, src/main/repositories/__tests__/accountTaskRepository.test.ts, src/main/repositories/__tests__/accountMutationRepository.test.ts; src/main/services/__tests__/AccountService.test.ts.

- [ ] RED real SQLite migrated: account+task+receipt+pending → deleteAccounts → task tables của account đều rỗng. Purchased payload/consumed_at và mutation ledger giữ nguyên; riêng purchased_emails.account_id thành NULL theo FK hiện có.
- [ ] Compose existing task repo cùng DB transaction, không migration:

~~~ts
deleteAccounts(ids: string[]): number {
  if (ids.length === 0) return 0;
  const tasks = new AccountTaskRepository(this.db);
  const remove = this.db.prepare('DELETE FROM accounts WHERE id = ?');
  return this.db.transaction(() => {
    let deleted = 0;
    for (const id of new Set(ids)) {
      tasks.deleteByAccount(id);
      deleted += remove.run(id).changes;
    }
    return deleted;
  })();
}
~~~

Import AccountTaskRepository; statements một ID tránh variable limit. Existing task delete bốn tables nằm trong outer transaction; không delete approvals/intents/bindings/purchased payload.

- [ ] Existing purchased_emails.account_id FK SET NULL vẫn đúng, consumed_at không reset; mailbox không available lại.
- [ ] Trigger fixture BEFORE DELETE accounts RAISE(ABORT)→rollback cả account/tasks/receipt/pending. Test hai accounts, một failure rollback tất cả; unknown ID/duplicate ID count không thừa; active account service guard trước write.
- [ ] Không quét xóa tất cả orphans cũ trong task; chỉ coordinated delete được user request. Historic orphan cleanup cần thao tác riêng, không suy quyền.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/repositories/__tests__/repositories.test.ts src/main/repositories/__tests__/accountTaskRepository.test.ts src/main/repositories/__tests__/accountMutationRepository.test.ts src/main/services/__tests__/AccountService.test.ts --maxWorkers=4`

## T16 — C01: before-quit lặp vẫn preventDefault

**Modify:** src/main/lifecycle.ts.
**Test:** src/main/__tests__/lifecycle.test.ts.

- [ ] Sửa test đang assert second preventDefault0 thành1. Deferred first stop/flush, second quit không close DB/quit trước first settle.
- [ ] Patch đúng guard:

~~~ts
if (isShutdownFinished) return;
event.preventDefault();
if (isShuttingDown) return;
isShuttingDown = true;
~~~

Đặt thay guard trước try; không gọi stop/flush/close lặp. Final deps.app.quit sau finished đi qua guard không prevent.
- [ ] Test first success,first failure,bounded timeout,duplicate quits 10 lần,DB close fail; giữ timeout policy15s/2s hiện tại, no profile kill mới.
- [ ] Adapter main cleanup IPC/subscriptions không re-register sau quit2; manager async return không có nghĩa event được chặn, assert event.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/__tests__/lifecycle.test.ts src/main/__tests__/singleInstance.test.ts`

## T17 — D01/D02/D03: legacy HTTP evidence/type contract

**Modify:** src/main/services/capcut/taskApi.ts; src/main/services/capcut/http/signedRequest.ts, src/main/services/capcut/http/taskMutation.ts.
**Test:** src/main/services/capcut/__tests__/taskApi.test.ts; src/main/services/capcut/http/__tests__/signedRequest.test.ts, src/main/services/capcut/http/__tests__/taskMutation.test.ts.
**Chỉ legacy/dormant; không bật chúng vào default pipeline.**

- [ ] D01 RED attachTaskMonitor actual EventEmitter response 503/body err_no0 sau đó fresh list không được pass; tách case 200 action/503 snapshot cũng không fresh proof.
- [ ] Check response.status integer 2xx trước authoritative body processing. Giữ origin/time/attempt validation, no new requests. Body err_no numeric strict ở authoritative proof, string/false không pass.
- [ ] D02 sửa fake waitForRequest trả **Request**, không handmade Draft. Materialize result:

~~~ts
const request = await pending;
const url = new URL(request.url());
const method = request.method();
if (method !== 'GET' && method !== 'POST') throw new Error('CAPCUT_SIGNED_REQUEST_INVALID');
return {
  path: url.pathname + url.search,
  method,
  body: request.postData() ?? undefined,
  headers: { ...request.headers() }
};
~~~

Converter dùng chung predicate/result, no as unknown cast. pending.catch observer nếu trigger reject để không unhandled; giữ primary trigger error. Không chỉnh wire query/body.

- [ ] D03 explicit numeric0:

~~~ts
const errNo = response.data.err_no;
if (!response.ok || typeof errNo !== 'number' || !Number.isFinite(errNo) || errNo !== 0) {
  throw new Error('TASK_ACTION_REJECTED');
}
~~~

- [ ] Parameterized values['0',false,null,undefined,NaN,1] reject; numeric0 success. Giữ actionKey/opId/input validation and exact body.
- [ ] Existing legacy happy 200+fresh list pass, default httpTasks strict không đổi.

Run (focused): `node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/taskApi.test.ts src/main/services/capcut/http/__tests__/signedRequest.test.ts src/main/services/capcut/http/__tests__/taskMutation.test.ts src/main/services/capcut/__tests__/httpTasks.test.ts`

## T18 — D04/D05: diagnostic OTP và exit truth, chỉ offline

**Modify:** scripts/live-onboarding-probe.cjs, scripts/live-register-and-claim.cjs, scripts/live-complete-and-claim.cjs.
**Create/Test:** scripts/__tests__/legacy-diagnostics.test.mjs; import-safe helper scripts/legacy-diagnostic-helpers.cjs chỉ nếu cần tách actual OTP loop/exit cleanup để test.
**Không chạy script main vì có purchase/profile effects.**

- [ ] D04 thay getOrderStatus không tồn tại bằng API đang có:

~~~js
const code = await gmailProvider.readOtp(
  process.env.GMAIL94_API_KEY,
  orderInfo.orderId,
  'capcut'
);
if (code) {
  otpCode = code;
  break;
}
~~~

- [ ] Test actual extracted helper được script gọi thật, fake provider chỉ có readOtp trả null rồi code; exact order/service, interval3s/deadline45s hiện có giữ, không log OTP. No local copy helper không dùng production.
- [ ] D05 body failure/cleanup failure set nonzero và finally không override:

~~~js
} catch (error) {
  if (!process.exitCode) process.exitCode = 1;
  console.error('Fatal Error:', error);
} finally {
  // Trong mỗi existing cleanup catch: nếu chưa có nonzero exitCode thì đặt 1.
  process.exit(process.exitCode ?? 0);
}
~~~

Dòng comment là vị trí áp vào cleanup hiện có, không bỏ cleanup block. Giữ exact owned profile/lease policy, không thêm retry/kill/DB sweep.
- [ ] Test VM hoặc helper import-safe actual flow với fake process,launcher,DB: body fail/close fail/healthy/prior nonzero kept, cleanup call order một lần. Không assert regex “exitCode” làm behavioral proof.

Run (focused): `node node_modules/vitest/vitest.mjs run scripts/__tests__/legacy-diagnostics.test.mjs scripts/__tests__/live-capcut-run.test.mjs scripts/__tests__/checkPackagedApp.test.ts`

## T19 — sửa false-green và nghiệm thu giao nhau

**Modify tests only:** src/main/services/__tests__/AutomationRunService.test.ts, src/main/services/__tests__/fixtures/deterministicRunHarness.ts; src/shared/schemas/__tests__/automation.schema.test.ts; scripts/__tests__/live-capcut-options.test.mjs; src/main/services/capcut/__tests__/diag.test.ts; src/main/services/capcut/http/__tests__/imagexUpload.test.ts; các fixture/tests nhắc tại T01–T18.
**Không mở rộng production flow để khớp test có tên sai.**

- [ ] S05 readerError null không được toBeDefined; assert exact Error/abort identity. Quan sát live LogBus subscription hoặc bus.flush sau late completion trước assert no SUCCESS.
- [ ] S06 busy key: đợi current-IP read entered rồi abort, sau đó acquire cùng key; pre-abort test tách riêng. S03 poll tick/removeAccounts gọi đúng API; S07-E giữ release pending rồi race actual cleanup entrypoints, không preset routeReleased.
- [ ] Harness oracle: dùng independent Set<resourceId>, allocate/add và release/delete assert owned; no Math.max clamp che duplicate release. Return observed resource counts và reported terminal snapshot riêng rồi so sánh, không tự chứng minh bằng same object.
- [ ] terminal DB throw/false T05 phải có trong matrix, không chỉ checkpoint persist fail. Simulated release error trước resource-delete nếu lỗi có nghĩa retained; post-delete error là case khác, ghi rõ.
- [ ] Duplicate evidence fixture phải đủ worker/session/account aliases và valid task enum, chỉ duplicate invalid; assert custom issue path/message. Single valid control case pass.
- [ ] Option tests gọi export thật parseLiveCapcutOptions trong scripts/live-capcut-options.mjs, không viết lại parseMissionTransport cục bộ (production không export hàm đó). Assert --mission-transport=ui hợp lệ, http-only bị từ chối theo policy hiện tại; không thêm/đổi transport để chiều test sai. Spy/sentinel phải được inject vào caller thật, không unused spy/secretContent làm safety claim.
- [ ] Diag screenshot fake trả Buffer actual shape, assert bytes; ImageX CRC match theo actual algorithm, không catch mọi error chỉ để test pass.
- [ ] Mapping bảng Spec30 IDs: mỗi ID test name/file/RED/GREEN exit+reviewer; DOB/legacy chưa xong để open.
- [ ] Full gates theo Runbook, source hash/git diff không unrelated changes, do_action payload/order trace không đổi.

## Giao việc và nghiệm thu cuối

Mỗi task có một owner file và reviewer khác. Nếu test không fail theo đúng nguyên nhân, dừng task đó để đọc source/fixture, không sửa expected lỏng hơn. T03-B WAITING-DOB-POLICY không cản các task khác.

| Task | Completion evidence |
|---|---|
| T01–T04 | Actual auth/trial exports + stateful DOM fixtures, no false sleeps/read success |
| T05–T06 | Real ownership/persistence fault cases; counter/CAS snapshots |
| T07–T09 | Main transaction + typed IPC + controller revision/lifecycle integration |
| T10–T12 | Route parser/pool, LogBus counts/recovery, Logs provenance/perf |
| T13–T16 | Mounted dialog/page cases, repo rollback and event cancellation |
| T17–T18 | Legacy fake transport/VM, no live mutation |
| T19 | Independent assertions/matrix + full verification |

[Runbook thực thi và commands](2026-09-10-tool-bugfix-runbook.md). Không dùng report PASS baseline để đánh dấu xong; không push/commit/live/installer ngoài quyền.
