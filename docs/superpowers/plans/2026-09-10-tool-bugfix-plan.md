# Remaining Bugs — Implementation Plan G01–G12

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Làm từng task, RED → minimal fix → GREEN → review. Không tự commit/deploy khi chưa có quyền.

**Goal:** Sửa các lỗi còn tồn đọng sau Antigravity mà không thay flow tool.

**Architecture:** Giữ các module hiện tại. Vá admission, document/owner/read ordering và error handling ngay tại boundary sở hữu; không viết lại runtime/controller. Các nhánh paste đã hoạt động là regression baseline.

**Tech Stack:** TypeScript strict, Electron/React, Zod4, Vitest4, SQLite, Playwright offline fixtures.

**Spec:** [2026-09-10-tool-bugfix-spec.md](../specs/2026-09-10-tool-bugfix-spec.md)
**Evidence:** [Review15/09](../reports/2026-09-15-antigravity-project-review.md)

## Global Constraints

- Giữ do_action → task_list → claim/đối soát, endpoints, op_id, thứ tự, pacing, trial gate và normal restock.
- API key/password/proxy trên Dashboard vẫn plaintext/selectable; không masking, vault redesign hoặc reveal toggle mới.
- Pasted-existing dùng password từng dòng, existing-only auth; không signup/fallback, OTP, mua mailbox hoặc HTTP-only.
- Giữ UI/persisted manual và legacy runtime manual/API/custom/existing; không đổi ngầm contract hoặc mở feature đang khóa.
- Không auto-overwrite mật khẩu row đã có từ pasted login; Add/Edit explicit vẫn là nơi người dùng chủ động đổi.
- Chỉ fix đúng boundary và tests; không đổi framework, thêm dependency, refactor toàn controller/runtime hoặc thêm business retry.
- Không reset DB, xóa account/proof/lease, sửa migration checksum hay auto-release tài nguyên chưa xác nhận thu hồi.
- Fixtures dùng DEMO và DB/profile tạm; không live purchase/signup/trial, commit/push/deploy nếu chưa được cấp quyền riêng.

## Baseline, sequencing, file ownership

HEAD3bb6b72 + dirty Antigravity; không checkout/reset các thay đổi hiện tại. Fullsuite baseline2377tests/175files; typecheck/lint/build/selectors95/UI7/Electron đang pass, nhưng findings chưa có regression.

| Task | Findings / AC | Owner / dependency |
|---|---|---|
| G01 | F04/F05; G01.1–4 | Shared parser + runtime admission |
| G02 | F01; G02.1–4 | Auth |
| G03 | F02; G03.1–4 | Trial |
| G04 | F03; G04.1–4 | Signup/DOB; cùng auth owner nếu chạy G02 |
| G05 | F06; G05.1–4 | Proxy + runtime; sau G01 để tránh chồng file |
| G06 | F07; G06.1–3 | LogBus, độc lập |
| G07 | F08/F09; G07.1–6 | Runtime proof; sau G05 |
| G08 | F10; G08.1–3 | Runtime cleanup; sau G07 |
| G09 | F11/F12; G09.1–5 | Dashboard/Logs |
| G10 | F13/F14; G10.1–5 | Accounts + Dashboard; phối hợp G09 |
| G11 | F15; G11.1–4 | Settings |
| G12 | F16; G12.1–6 | Mounted/integration/final gates sau các task |

Ưu tiên triệu chứng: G02/G03/G05/G06 trước; sau đó G01/G07/G08/G09/G10/G11/G04. Dependency tránh concurrent edit, không buộc tạo framework điều phối. G12 một owner harness, không cùng lúc rebuild native.

Mỗi task kết thúc bằng focused tests + review diff. Nếu cần commit, xin quyền riêng; không git add . vào worktree dirty. Snippet là recipe chưa áp dụng, không tính là fixes đã chạy.

## G01 — Parser và service admission (F04/F05)

**Files Modify:**

- src/shared/schemas/pasted-capcut.schema.ts
- src/shared/schemas/automation.schema.ts
- src/main/services/AutomationRunService.ts
- src/shared/schemas/__tests__/pasted-capcut.schema.test.ts
- src/shared/schemas/__tests__/automation.schema.test.ts
- src/main/services/__tests__/pastedCapcutIntegration.test.ts

**Interfaces:** Giữ parsePastedCapcutText(text):PastedCapcutParseResult, normalizePastedCapcutEntries(entries):PastedCapcutParseResult. Reuse PastedCapcutSourceSchema trong EmailSourceConfigSchema. Không đổi legacy payload.

- [ ] **1. RED parser tests:**

~~~ts
it('reports original malformed line without a fake empty-input issue', () => {
  expect(parsePastedCapcutText('\n\nbad-row').issues).toEqual([
    { line: 3, code: 'MISSING_SEPARATOR' }
  ]);
});
it('normalizes structured email but preserves exact password', () => {
  const result = normalizePastedCapcutEntries([
    { line: 3, email: '  Demo@Example.test  ', capcutPassword: '  A|B  ' }
  ]);
  expect(result.issues).toEqual([]);
  expect(result.entries).toEqual([
    { line: 3, email: 'Demo@Example.test', capcutPassword: '  A|B  ' }
  ]);
});
it('shares conflict rejection in standalone source schema', () => {
  expect(PastedCapcutSourceSchema.safeParse({
    mode: 'pasted-existing', entries: [
      { line: 1, email: 'a@example.test', capcutPassword: 'A' },
      { line: 2, email: 'A@example.test', capcutPassword: 'B' }
    ]
  }).success).toBe(false);
});
~~~

- [ ] **2. Run RED:** node node_modules/vitest/vitest.mjs run src/shared/schemas/__tests__/pasted-capcut.schema.test.ts --maxWorkers=4. Expect extra EMPTY_INPUT/untrimmed validation mismatch.
- [ ] **3. Minimal parser patch:** normalize candidate email before validation and return; keep exact password. In parse text keep blank-input early return, then:

~~~ts
const normalized: PastedCapcutParseResult = candidates.length === 0
  ? { entries: [], issues: [], duplicateLines: [] }
  : normalizePastedCapcutEntries(candidates);
~~~

Move duplicate/conflict refinement into exported source schema and reference in union. No duplicate validator implementations.
- [ ] **4. RED service matrix:** actual factory/runtime fixture, pass typed config without schema.parse. Cases pasted+random, HTTP-only, budget1, rolloutStage, approvedMailboxes, stopAfter; legacy+per-account; line0; conflict after mailLimit1. Assert reject before workSources.create/httpOnlyRunner.preflight/account lookup/create/proxy acquisition/logReset.capture. Active run owner/summary untouched.
- [ ] **5. Admission patch** after existing-owner checks, before nextId/publish:

~~~ts
if (config.emailSource.mode === 'pasted-existing' || config.password.mode === 'per-account') {
  const parsed = AutomationRunConfigSchema.safeParse(config);
  if (!parsed.success) {
    return Promise.reject(new ProviderError(
      'CONFIG_ERROR',
      'Cấu hình tài khoản dán không hợp lệ: ' +
        parsed.error.issues.map(issue => issue.message).join('; ')
    ));
  }
  config = parsed.data;
}
~~~

Add value import AutomationRunConfigSchema. No raw config logging. Structured schema checks shape before normalizer.
- [ ] **6. GREEN/review:** parser/schema/pasted integration tests; API/custom/manual/existing regressions unchanged, no settings enum edits.

## G02 — Same-document auth classification (F01)

**Files Modify:** src/main/services/capcut/authState.ts; callers login.ts/signup.ts/auth.ts only if shared result wiring requires; tests capcut/__tests__/authState.test.ts, auth.test.ts, authCancellation.test.ts; tools/verify-selectors.ts.
**Create:** tools/fixtures/dom-auth-state-owners.html.
**Interface:** Giữ AuthFinalState/hasAuthenticatedWorkspace. Internal snapshot evaluator consumes one Document, returns href and all boolean facts synchronously.

- [ ] **1. RED mock semantics:** createMockPage currently boolean/selector. Support match arrays and deferred read so tests model hidden first + visible second, navigation external and same-URL document replacement.
- [ ] **2. RED structural matrix:** hidden password+visible authpanel+workspace→false; hidden credit+visible credit→true; newsletter email+workspace→true; empty document→other; failed read→unreadable; abort→same reason. Caller ensureInApp existing-only must throw RecoveryLoginError with signup calls0.
- [ ] **3. Replace chained reads with one document snapshot.** Add internal evaluator; use DOM-compatible selectors, not Playwright :has-text. Candidate selection base:

~~~ts
function readAuthDocument(doc: Document) {
  const view = doc.defaultView;
  const visible = (el: Element): boolean => {
    if (!view || el.closest('[hidden], [inert]')) return false;
    const style = view.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' && el.getClientRects().length > 0;
  };
  const any = (selector: string, text?: RegExp): boolean =>
    Array.from(doc.querySelectorAll(selector)).some(el =>
      visible(el) && (!text || text.test(el.textContent ?? '')));
  const authPanel = any('.lv_sign_in_panel_wide');
  const passwordOrCode = any(
    'input[type="password"], input[name*="code" i], input[maxlength="6"]'
  );
  const authEmail = Array.from(doc.querySelectorAll('form, [role="dialog"]')).some(owner => {
    if (!visible(owner) || !/sign in|log in|sign up|create an account|verification/i.test(owner.textContent ?? '')) {
      return false;
    }
    return Array.from(owner.querySelectorAll('input[type="email"]')).some(visible);
  });
  return {
    href: view?.location.href ?? '',
    workspaceMarker: any('.credit-section, button[class*="credit"], [data-id="TitleBarTaskList"]') ||
      any('button', /Free credits/i),
    authFormVisible: authPanel || passwordOrCode || authEmail,
    publicLandingVisible: any('h1', /AI-Powered Photo & Video Editor|^CapCut$/i) ||
      any('a[href*="/login"]', /Sign in/i) || any('a[href*="/signup"]')
  };
}
~~~

Use fixture to qualify existing selector variants; unrelated settings password controls must also be scoped if present in captured workspace. Keep predicate rationale, no arbitrary avatar auth success.
- [ ] **4. Navigation/document fence:** capture main-frame event epoch before evaluateHandle(document), read snapshot through handle.evaluate(readAuthDocument), compare owner===currentdocument before publish. A single URL reread insufficient. Core:

~~~ts
let epoch = 0;
const onNavigation = (frame: import('playwright-core').Frame): void => {
  if (frame === page.mainFrame()) epoch += 1;
};
page.on('framenavigated', onNavigation);
try {
  const before = epoch;
  const acquiring = page.evaluateHandle(() => document);
  let owner: Awaited<typeof acquiring>;
  try {
    owner = await boundedDomRead(() => acquiring, 'auth-state:document', 3000, signal);
  } catch (error: unknown) {
    // The waiter ended; a late-created handle still belongs to this read.
    void acquiring.then(handle => boundedDomRead(
      () => handle.dispose(), 'auth-state:late-dispose', 1000
    )).catch(() => undefined);
    throw error;
  }
  try {
    const facts = await boundedDomRead(
      () => owner.evaluate(readAuthDocument), 'auth-state:facts', 3000, signal
    );
    const same = await boundedDomRead(
      () => page.evaluate(doc => doc === document, owner),
      'auth-state:document-current', 3000, signal
    );
    signal.throwIfAborted();
    if (!same || before !== epoch) {
      return { kind: 'unreadable', path: '', workspaceMarker: false,
        authFormVisible: false, publicLandingVisible: false };
    }
    // Classify facts with existing origin/predicate rules only after this fence.
    const location = classifyAuthUrl(facts.href);
    if (!location.allowedOrigin) {
      return { kind: 'other', path: '', workspaceMarker: false,
        authFormVisible: false, publicLandingVisible: false };
    }
    return {
      kind: facts.authFormVisible ? 'auth-form' : facts.workspaceMarker ? 'workspace'
        : facts.publicLandingVisible ? 'public-landing' : 'other',
      path: location.pathname,
      workspaceMarker: facts.workspaceMarker,
      authFormVisible: facts.authFormVisible,
      publicLandingVisible: facts.publicLandingVisible
    };
  } finally {
    await boundedDomRead(() => owner.dispose(), 'auth-state:dispose', 1000).catch(() => undefined);
  }
} finally {
  page.off('framenavigated', onNavigation);
}
~~~

Keep outer error→unreadable with originalabort/typeddeadline rethrow. Disposal failure must not replace primary error. Add deferred-handle-acquisition Stop test: late handle disposed once, no facts read, no unhandled rejection. No auto retry.
- [ ] **5. RED/GREEN commands:** node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/authState.test.ts src/main/services/capcut/__tests__/auth.test.ts src/main/services/capcut/__tests__/authCancellation.test.ts --maxWorkers=4; npm run selectors. Check handles/listeners cleanup, no URLshortcut regression.

## G03 — Trial bounded read / pricing owner (F02)

**Files Modify:** src/main/services/capcut/trial.ts; capcut/__tests__/trial.test.ts, authCancellation.test.ts; tools/verify-selectors.ts.
**Create:** tools/fixtures/dom-trial-owner-variants.html.
**Interfaces:** TrialInfo/isEligible/MIN_TRIAL_DAYS unchanged. Internal READ_TRIAL found:false for absent/ambiguous owner.

- [ ] **1. RED deferred-read Stop:** reuse trialPage/runWithFakeTimers; abort only after evaluate entered:

~~~ts
it('stops during the actual Pro-card read', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const reason = new Error('STOP_DURING_PRO_CARD_READ');
  let entered = false;
  let resolveRead!: (value: unknown) => void;
  const page = trialPage(null);
  vi.mocked(page.evaluate).mockImplementation(() => {
    entered = true;
    return new Promise(resolve => { resolveRead = resolve; });
  });
  const pending = checkProTrial(page, {} as BrowserContext, () => {},
    createDirectUiInteraction(controller.signal), controller.signal);
  let settled = false;
  let rejection: unknown;
  void pending.then(
    () => { settled = true; },
    error => { settled = true; rejection = error; }
  );
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(entered).toBe(true);
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(rejection).toBe(reason);
  } finally {
    controller.abort(reason);
    resolveRead?.({ found: true, days: 7 });
    await Promise.allSettled([pending]);
    vi.useRealTimers();
  }
});
~~~

Add noabort+neverresolve→typedtimeout. Mock main read only, not assertions or helper under test.
- [ ] **2. RED actual DOM reader:** hidden stale Pro7 + current visible Pro3→3; one visible Pro7→7; two active owners→unknown; unrelated CTA outside pricing owner not mixed. Use offlineFixture.ts so actual READ_TRIAL executes; current evaluateResult stubs alone insufficient.
- [ ] **3. Bounded read patch:**

~~~ts
const raw = await boundedDomRead(
  () => page.evaluate(READ_TRIAL), 'trial:pro-card-read', 5000, signal
).catch((error: unknown) => {
  signal.throwIfAborted();
  if (isDomReadTimeout(error)) throw error;
  return null;
});
signal.throwIfAborted();
~~~

Keep raw type fields/unknown fallback. Wrap openUpgradeModal raw presence/count similarly and rethrow interruptions. Bound dump on error, not resource creation.
- [ ] **4. Replace READ_TRIAL first-card resolution** inside existing string with ES-compatible logic:

~~~js
function visible(el) {
  if (!el || el.closest('[hidden], [inert]')) return false;
  var s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' &&
    s.visibility !== 'collapse' && el.getClientRects().length > 0;
}
var owners = Array.prototype.slice.call(
  document.querySelectorAll('[class*="subscriptionModal-wrapper"]')
).filter(visible);
if (owners.length !== 1) return { found: false, reason: 'PRICING_OWNER_UNKNOWN' };
var owner = owners[0];
var cards = Array.prototype.slice.call(
  owner.querySelectorAll('[class*="subscriptionProductSection-pro"]')
).filter(visible);
if (cards.length !== 1) return { found: false, reason: 'PRO_CARD_UNKNOWN' };
var card = cards[0];
~~~

Keep existing days/prices extraction below; scope CTA candidates to owner. If actual fixture uses wrapper without this class, add only measured relation and fixture, not globalfallback.
- [ ] **5. GREEN:** node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/trial.test.ts src/main/services/capcut/__tests__/authCancellation.test.ts src/main/services/__tests__/CapcutEngineService.test.ts --maxWorkers=4; npm run selectors. No price/CTA newgate or Start-free-trial click.

## G04 — Birthday dropdown ownership (F03)

**Files Modify:** src/main/services/capcut/signup.ts; capcut/__tests__/signupBirthday.test.ts; tools/verify-selectors.ts.
**Create:** tools/fixtures/dom-birthday-owner-variants.html.
**Interface:** selectBirthdayDropdownOption signature/codes giữ nguyên. Không đổi birthday production range.

- [ ] **1. RED:** createBirthdayTestPage hiện tự map state.open→đúng container, che bug. Thêm explicit global panel list with before/after visibility/owner, không suy từ state.open. Absent aria-controls + preexisting unrelatedJune solepanel phải optionClicks0/continueClicks0/OWNER_MISSING. Controlled realmonth + unrelatedJune phải chỉ click birthday.
- [ ] **2. Actual DOM variants:** no owner, multiple owners, quoted/backslash ID, hidden duplicate label, month/day + leapdayreadback. Assert foreign handlers count0 và typedabort identity.
- [ ] **3. Minimal resolver:** ưu tiên exact aria-controls. Fallback có triggerid chỉ accept visible panel có aria-labelledby chứa đúng token; có nhiều/không có thì error. Nếu DOM thực không có cả2relation, capture fixture để thêm relation concrete, không tự đoán globalfirst. Core replacement cho else branch:

~~~ts
const triggerId = await boundedDomRead(
  () => selector.getAttribute('id'),
  'signup:birthday-' + ownerType + '-trigger-id', 2000, signal
);
const panels = page.locator(
  '.lv-select-dropdown:visible, [role="listbox"]:visible, .semi-select-option-list:visible'
);
const count = await boundedDomRead(
  () => panels.count(), 'signup:birthday-' + ownerType + '-owners', 2000, signal
);
const owned: Locator[] = [];
if (triggerId) {
  for (let index = 0; index < count; index += 1) {
    const panel = panels.nth(index);
    const labelledBy = await boundedDomRead(
      () => panel.getAttribute('aria-labelledby'),
      'signup:birthday-' + ownerType + '-labelled-by', 2000, signal
    );
    if ((labelledBy ?? '').split(/\s+/).includes(triggerId)) owned.push(panel);
  }
}
if (owned.length !== 1) {
  const code = owned.length > 1 ? 'OWNER_AMBIGUOUS' : 'OWNER_MISSING';
  throw new Error('SIGNUP_BIRTHDAY_' + ownerType.toUpperCase() + '_' + code);
}
container = owned[0];
~~~

Exact-ID branch cần uniquevisible check; không first nếu duplicate IDs. No unescaped CSS interpolation; readback/error must not click Continue.
- [ ] **4. Random regression:** lazy generation when DOB present only, same intended date during retry/readback, leapday and random range helper tests giữ. Production1990–2004 remains WAITING-DOB-POLICY; không invent range khác hoặc hoãn owner fix.
- [ ] **5. RED/GREEN:** node node_modules/vitest/vitest.mjs run src/main/services/capcut/__tests__/signupBirthday.test.ts src/main/services/capcut/__tests__/birthday.test.ts --maxWorkers=4; npm run selectors.

## G05 — Refresh idle proxy preflight (F06)

**Files Modify:** src/main/services/LazyProxyLeaseSource.ts, AutomationRunService.ts; tests __tests__/LazyProxyLeaseSource.test.ts, AutomationRunService.test.ts, ProxyLeaseManager.test.ts.
**Interface Add:** IProxyLeaseSource.resetIdlePreflightCache?():void; implement LazyProxyLeaseSource. Runtime calls once at admitted proxykey attempt before configure/availableSlots, not each acquire.

- [ ] **1. RED fixture:** FakeManager có availableSlots token captured. Same config/authfail→change token→nextStart must factoryNEW. Real ProxyLeaseManager fake listKeys inventory1→2 must listCalls2. Use actual same AutomationRunService two Starts, không chỉ gọi source helper.
- [ ] **2. Minimal implementation:**

~~~ts
resetIdlePreflightCache(): void {
  if (this.cleanupState !== 'idle' || this.ownedLeases.size > 0 ||
      this.acquisitionsInFlight > 0 || this.releaseAllPromise) {
    throw new Error('CANNOT_RESET_PROXY_PREFLIGHT_WHILE_OWNED');
  }
  this.manager = null;
}
~~~

No provider release/DB mutation; keep keys/region. configure active sameconfig reuse unchanged.
- [ ] **3. Wire:** prepareRun proxykey branch calls resetIdlePreflightCache?.(), configure currentkeys/region, then availableSlots. Add value import abortable from capcut/cancellation beside existing imports; wrap metadata await with abortable(readPromise,runSignal), observe late read. Do not discard any owner to make Stop/newStart pass; guard method handles ownership.
- [ ] **4. Guard regression:** active lease/inflight acquire/releasing/failedcleanup resetreject and same manager retained; cleanup success allows nextattempt; currentrun acquisitions reuse one manager. Test failed source.prepare after capacity also refreshes nextStart.
- [ ] **5. GREEN:** node node_modules/vitest/vitest.mjs run src/main/services/__tests__/LazyProxyLeaseSource.test.ts src/main/services/__tests__/ProxyLeaseManager.test.ts src/main/services/__tests__/AutomationRunService.test.ts --maxWorkers=4.

## G06 — LogBus observer isolation (F07)

**Files Modify:** src/main/services/LogBus.ts, src/main/services/__tests__/LogBus.test.ts.
**Interface:** emit(LogEntryInput):CanonicalRuntimeLog unchanged.

- [ ] **1. RED using current createBus helper:**

~~~ts
it('continues delivery and flush when one subscriber throws', () => {
  const stored: CanonicalRuntimeLog[] = [];
  const bus = createBus({ insertBatch: rows => stored.push(...rows) }, 1);
  let delivered = 0;
  bus.subscribe(() => { throw new Error('DEMO listener failure'); });
  bus.subscribe(() => { delivered += 1; });
  expect(() => bus.emit({
    email: 'demo@example.test', step: 'Run', status: 'INFO', message: 'entry'
  })).not.toThrow();
  expect(delivered).toBe(1);
  expect(stored).toHaveLength(1);
});
~~~

- [ ] **2. Minimal patch:**

~~~ts
for (const listener of this.listeners) {
  try {
    listener(entry);
  } catch {
    // Observers must not interrupt delivery or the automation caller.
  }
}
~~~

Keep flush after loop. No recursive emit from reporter.
- [ ] **3. Sinkfail variant:** listenerthrow + insertBatchfail keeps queue/retryNotBefore, healthylistener still called; recovery notice once. Reset/exact-ID ticket tests preserve.
- [ ] **4. RED/GREEN:** node node_modules/vitest/vitest.mjs run src/main/services/__tests__/LogBus.test.ts --maxWorkers=4.

## G07 — Proof ownership/drain và failure priority (F08/F09)

**Files Modify:** src/main/services/AutomationRunService.ts; src/main/services/__tests__/automationTaskProgress.test.ts, AutomationRunService.test.ts; src/main/repositories/__tests__/accountTaskRepository.test.ts only if repository regression belongs there.
**Interfaces:** Keep onAcceptedProof/onTaskCheckpoint and ICapcutTaskProgressSink. Add private assertProofOwner(thread):void only; no public manager/queue layer.

- [ ] **1. RED regression matrix:** reuse StubCapcutRunner/StubAccounts/StubLauncher and recording sinks in automationTaskProgress.test.ts:
  1. Capture checkpoint callback, return runner, owner retired while session retained→callback rejects/no sink call.
  2. Persistproof then replacedowner→sameproof memo-hit rejects/no newwrite.
  3. BatchproofA reject + B deferred→outer promise still pending until Bsettles.
  4. Successful checkpoint row opId/provedAt settled + fallback sameproof→realrepo listUnsettledProofs remains[].
  5. Same key different opId/timestamp→new proof persisted.
  6. Pre-existing cleanup abort + fallback persistencefail→accountfailed, other peer onlyaborted→stopped.
- [ ] **2. Guard implementation:**

~~~ts
private assertProofOwner(thread: ThreadRuntime): void {
  if (this.iterationOwners.get(thread.accountId) !== thread.ownerToken) {
    throw new Error('STALE_ACK_PROOF_OWNER');
  }
}
~~~

Use at persistAcceptedProofs entry before sink/memo and in newwrite dispatch. In runUiSessionAttempt define assertInvocation:

~~~ts
const assertInvocation = (): void => {
  if (!invocationOpen) throw new Error('INVOCATION_CLOSED');
  this.assertProofOwner(thread);
  if (thread.session !== session) throw new Error('STALE_CHECKPOINT_SESSION');
};
~~~

Both callbacks call it before side effects. Accepted callback already checks owner; consolidate rather than duplicate policy. Callback received while aborting may still own accepted evidence; do not signal.throwIfAborted before persisting an already accepted proof solely because cleanup aborted.
- [ ] **3. Drain implementation:** replace early Promise.all rejection with await allSettled; preserve first domain failure already stored, otherwise first rejected result:

~~~ts
const settled = await Promise.allSettled(writes);
const rejected = settled.find(
  (result): result is PromiseRejectedResult => result.status === 'rejected'
);
if (rejected) throw rejected.reason;
~~~

Use the first rejected **owned write** above; global failure slots finalize run reason but must not make a merely aborted peer fail. Track **both** accepted-proof and checkpoint jobs: a deferred sink.record starts before its versions enter acceptedProofWrites. Add a private per-invocation Set, not a public queue layer:

~~~ts
const invocationWrites = new Set<Promise<void>>();
const ownWrite = (operation: Promise<void>): Promise<void> => {
  invocationWrites.add(operation);
  void operation.catch(() => undefined);
  return operation;
};
~~~

Both callbacks return ownWrite of their full async body, including guard, sink call and memo update. Keep jobs in the Set through settlement; do not delete failed jobs before collecting errors. After uiRunner settles, close invocation and drain union of invocationWrites + thread.acceptedProofWrites before owner retirement/notifyDone. Snapshot primary result/error before drain; **this account's terminal persistence failure > this account's proof persistence failure > ordinary runner error/cleanup abort**. Preserve lower-priority primary as cause/evidence, but never let ordinary AbortError/TaskEvidenceError hide independent owned persistence failure. Unrelated global peer failure must not reclassify this account. Add runner-returns-while-checkpoint-pending test: accepted map empty, checkpoint still owned; cannot retire until it settles. No timeout that falsely declares sink writes canceled.
- [ ] **4. Memo after successful checkpoint:** copy version identities before await; after record succeeds populate map for unsettled plus rows with nonempty opId and finite Date.parse(provedAt). Key exactly JSON.stringify([taskKey,opId,epochMs]) as writer. Existing in-flight promise must not be overwritten with resolved marker before it settles. Pattern:

~~~ts
for (const row of checkpoint.rows) {
  if (!row.opId || !row.provedAt) continue;
  const at = Date.parse(row.provedAt);
  if (!Number.isFinite(at)) continue;
  const key = JSON.stringify([row.key, row.opId, at]);
  if (!thread.acceptedProofWrites.has(key)) {
    thread.acceptedProofWrites.set(key, Promise.resolve());
  }
}
~~~

Apply only while still owner; no memo after failed record. Preserve valid unsettled loop and proof copy. Real SQLite regression should include snapshot observedAt newer than provedAt and requiredAfter; no false-equal timestamps.
- [ ] **5. Independent failure priority:** in both outer catches compute failedterminal from **err** first; RESOURCE_CLEANUP_FAILED itself represents peer safety stop, not unrelated err when signal happens to contain cleanup:

~~~ts
const isIndependentFailure = err instanceof AutomationTerminalError &&
  err.state === 'failed' && err.reason.code !== 'RESOURCE_CLEANUP_FAILED';
if (!isIndependentFailure && (iterationSignal.aborted || this.runAbort?.signal.aborted)) {
  return { kind: 'stopped', status: 'stopped',
    step: this.deriveStopMessage(iterationSignal, err) };
}
~~~

Snippet is runThreadWorkload branch; workerLoop must keep its own recordOutcome/continue/finally mechanics, change only predicate. Explicit proof/account persistence priority already implemented must not regress.
- [ ] **6. GREEN:** node node_modules/vitest/vitest.mjs run src/main/services/__tests__/automationTaskProgress.test.ts src/main/services/__tests__/AutomationRunService.test.ts src/main/repositories/__tests__/accountTaskRepository.test.ts --maxWorkers=4.
- [ ] **7. Review exposure:** tests must label contract/deferred sink vs defaultHTTP. No claim default always reinserts settledproof; no taskbusiness change.

## G08 — Freeze stop diagnostic after lock (F10)

**Files Modify:** src/main/services/AutomationRunService.ts; __tests__/AutomationRunService.test.ts; capcut/launcher/__tests__/BrowserLauncher.test.ts if launcher shape needs existing fixture.
**Interface:** stopOutcomeLocked remains authoritative; no new retry/codes.

- [ ] **1. RED:** actual deferred launcher.stop; watchdog locks cdp-teardown/deadline/remoteConfirmedtrue; capture cause/diagnostic; reject underlying stop with different ProfileStopError. Await settle; expect exact originalreferences/fields/counters/retainedids.
- [ ] **2. Patch startProfileStop catch:** same guard already used in success and onPhase paths must precede every failure-state mutation/log:

~~~ts
if (session.stopOutcomeLocked) return false;
session.stopFailed = true;
session.stopCause = error;
~~~

Keep catch observing promise; not throw unhandled. Do not clear stopPromise to permit retry.
- [ ] **3. Regression matrix:** late success, late reject, phaseafterlock, ordinary unlocked reject; two Stop callers share ownedoperation; no extra providerstop/proxyrelease.
- [ ] **4. GREEN:** node node_modules/vitest/vitest.mjs run src/main/services/__tests__/AutomationRunService.test.ts --maxWorkers=4.

## G09 — Dashboard history và Logs stale Clear (F11/F12)

**Files Modify:** src/renderer/pages/Dashboard/dashboardController.ts, src/renderer/pages/Logs/logsController.ts; corresponding __tests__/dashboardController.test.ts / logsController.test.ts.
**Interfaces:** Không đổi IPC/log schema. Add private logHistoryToken:number và Map<string,CanonicalRuntimeLog> cho genuinely live/unconfirmed entries; không reuse display buffer làm pending.

- [ ] **1. RED sameepoch read:** dùng FakeBridge.logs.list deferred trong Dashboard test, public load hai lần hoặc reset+load; resolve new sameID messageNEW rồi old messageOLD→expectNEW. Add live seq12+SQL sameIDnoseq→reset10→row12 survives. Detach→clear DB→attach/load[]→old persisted row absent. Existing helper log/FakeBridge/flush dùng đúng file hiện tại.
- [ ] **2. Token/core merge:** mỗi refreshLogs increments logHistoryToken, capturegen/resetepoch. Entry publication qua Map riêng, pruneonreset. SameID merge giữ live object khi nó mang higherseq:

~~~ts
const token = ++this.logHistoryToken;
const requestEpoch = this.logResetEpoch;
const requestGen = this.generation;
const response = await this.bridge.logs.list({ page: 1, pageSize: this.maxLogs });
if (this.isDisposed || requestGen !== this.generation ||
    requestEpoch !== this.logResetEpoch || token !== this.logHistoryToken) return;
~~~

History empty authoritative cho persistedrows; merge only live buffer still unconfirmed/currentcutoff, not state.logs. Khi history xác nhận sameID, retire pending row nhưng giữ **sequence metadata** theo current canonical IDs và merge metadata vào mỗi matching SQL row. Không chỉ transfer một lần: live12→SQLnoseq→SQLnoseq→reset10 vẫn phải giữ12. Prune metadata khi ID thực sự absent khỏi authoritative history/reset, không giữ whole stale row để giữ sequence. On detach giữ unconfirmed only; requesttime capture phân biệt pushes trong read. Dedup trước cap, sort canonical time/sequence như hiện tại.
- [ ] **3. RED Logs oldsuccess:** dùng deferred/ClearReply/ListReply/listReply helpers trong current describe:

~~~ts
const clearReply = deferred<ClearReply>();
const historyReply = deferred<ListReply>();
bridge.logs.clear = () => clearReply.promise;
const clearing = c.clear();
bridge.logs.list = () => historyReply.promise;
bridge.pushReset({ clearedThrough: 20 });
historyReply.resolve({ success: false,
  error: { code: 'ERR_PERSISTENCE_FAILED', message: 'NEW-HISTORY-FAIL' } });
await Promise.resolve();
await Promise.resolve();
const currentError = c.getState().error;
expect(currentError).not.toBeNull();
clearReply.resolve({ success: true, data: { success: true, clearedThrough: 10 } });
await clearing;
expect(c.getState().error).toBe(currentError);
~~~

Place after creating/attaching/loading c with FakeBridge in test; pushReset is the current helper. Also pending loading variant/oldfailure and newer-cutoff reply.
- [ ] **4. Minimal stale branch:** khi clearEpoch stale và cutoff absent/<=current, không publish error/loading hoặc restore old rows. Tuy nhiên phải drain **surviving queued pushes**: onEntry trong clearCollecting đưa event vào clearPushes/unconfirmedPushes rồi return. Merge các push có sequence>currentcutoff vào current canonicalRows, giữ nguyên current error/loading, sau đó settle promise/latch. Không early-return làm seq21 mất khỏi view khi finally xóa clearPushes. Test clearpending→reset20→history[]→push21→oldsuccess10: push21 visible, newer error/loading unchanged. When replycutoff>current, apply authoritative reset path and replacementread; don't ignore deletion. Currentepoch success logic giữ. No stale publishRows(canonicalRows,{error:null}).
- [ ] **5. GREEN:** node node_modules/vitest/vitest.mjs run src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts src/renderer/pages/Logs/__tests__/logsController.test.ts --maxWorkers=4. Mountedlogreset+detach add G12. Recheck Startsave singleflight unchanged.

## G10 — Exact account secrets / safe mutation feedback (F13/F14)

**Files Modify:** src/renderer/pages/Accounts/accountsController.ts, AccountsPage.tsx, AddAccountDrawer.tsx, EditAccountDrawer.tsx, DeleteAccountDialog.tsx; Dashboard/dashboardController.ts, DashboardPage.tsx; __tests__/accountsController.test.ts, Dashboard/__tests__/dashboardController.test.ts; mountedfixture G12.
**Interfaces:** create/update/remove Promise<boolean> giữ committedmeaning. Add warning:string|null in AccountsState. Change load return to Promise<'loaded' | 'failed' | 'superseded'> (current UI callers only await/ignore, no control-flow change); token-mismatch returns superseded, owned failure failed, owned success loaded. This makes postcommit refresh outcome explicit, not inferred from unrelated state.error. No vault/schema redesign.

- [ ] **1. RED payload tests:** use FakeBridge/create test input currently in accountsController.test.ts, override password='  A|B  '; captured create.passwordCapcut exact; captured update.passwordCapcutOp={action:'replace',value:'  A|B  '}. Blank/mask→keep unchanged.
- [ ] **2. Minimal payload patch:**

~~~ts
function secretOp(value: string | undefined): SecretOperation {
  const raw = value ?? '';
  const probe = raw.trim();
  if (probe.length === 0 || probe === MASKED_SECRET) return { action: 'keep' };
  return { action: 'replace', value: raw };
}
function optionalSecret(value: string | undefined): string | undefined {
  const raw = value ?? '';
  const probe = raw.trim();
  return probe.length === 0 || probe === MASKED_SECRET ? undefined : raw;
}
~~~

No trim on replacement; email still trim.
- [ ] **3. RED rejected transport:** create/update/remove promises reject(Error DEMO_IPC_DOWN); expect resolvesfalse,error populated. Successful commit then loadreject→returnstrue, warning/visible diagnostic, no repeatedcreate/update/remove. Dashboard stopThread/removeAccounts same matrix. Capture state before oldreply after detach/generation to ensure no newerstate overwrite.
- [ ] **4. Error boundary:** surround each mutation await with try/catch; failure set error then returnfalse. Keep await load after confirmedcommit; don't put refresh error into mutationfailed result. Generic reject pattern:

~~~ts
try {
  const response = await this.bridge.accounts.remove(ids);
  if (!response.success) {
    this.setState({ error: response.error.message });
    return false;
  }
  const refresh = await this.load();
  if (refresh === 'failed') {
    this.setState({ warning: 'Đã xóa tài khoản nhưng chưa tải lại được danh sách.' });
  }
  return true;
} catch (error: unknown) {
  this.setState({ error: error instanceof Error ? error.message : 'Không xóa được tài khoản.' });
  return false;
}
~~~

Above uses new warning field and owned refresh result defined in task; load catches internally, preserve that property or split mutation/refresh try scopes. Render warning in AccountsPage alongside existing error banner; clear stale warning at new mutation and on successful current load. Superseded load must not publish failure/success about a later request. Add listener/session guards equivalent to current requesttoken for lifecycle, no new globalstore.
- [ ] **5. Delete owner:** DeleteAccountDialog.handleDelete hiện tự gọi onConfirmDelete() rồi onClose() ngay; **bỏ unconditional child onClose** và để parent đóng sau committed success. Parent useRef singleflight latch trước await; pending disables confirm/close, Modal onClose cũng check current latch (React state update chưa đủ chặn cùng tick). await result; chỉ true clears selection/closes currentdialog, false giữ selection/dialog. Mounted deferredfailure phải assert dialog còn mở ngay sau click và sau failure. Reply cũ không đóng dialog mới. Dashboard .then hiện clears bất kể boolean; condition on committed true + currentgeneration. Drawer catches unexpected callback reject, inlineerror/input retained; isSubmittingfinally released.
- [ ] **6. GREEN:** node node_modules/vitest/vitest.mjs run src/renderer/pages/Accounts/__tests__/accountsController.test.ts src/renderer/pages/Dashboard/__tests__/dashboardController.test.ts --maxWorkers=4. G12 mounted add/edit/delete failure confirms error visible through actual page, not hidden behind drawer.

## G11 — Connection test belongs to current draft (F15)

**Files Modify:** src/renderer/pages/Settings/SettingsPage.tsx; EmailProviderPanel.tsx, ProxyProviderPanel.tsx, BrowserSettingsPanel.tsx for pending indicator only; scripts/bugfix-ui/fixture.tsx and scripts/check-bugfix-ui.mjs tests coordinated G12.
**Interface:** Add optional isTesting?:boolean per panel/service (email panel may take partial record by service). Keep credentials.test payload/return unchanged; no persistence.

- [ ] **1. RED mounted:** actual SettingsPage + fake deferred credentials.test. Atestpending→editB→Btest→Bfail→lateAsuccess must keep Bfail. EdittowardB without test means Aresultignored. Repeat serviceA/B independently, close/remount before resolve. Assert saveCalls0.
- [ ] **2. Implement token+draftrevision refs** keyed KnownServiceName. Current one testResult record can remain, but publish must own service/currentdraft:

~~~ts
const testTokens = useRef<Partial<Record<KnownServiceName, number>>>({});
const draftRevisions = useRef<Partial<Record<KnownServiceName, number>>>({});
const invalidateTest = (service: KnownServiceName): void => {
  testTokens.current[service] = (testTokens.current[service] ?? 0) + 1;
  draftRevisions.current[service] = (draftRevisions.current[service] ?? 0) + 1;
  setTestResult(current => current?.service === service ? null : current);
};
~~~

Call invalidation from all draftonChange/setMultiloginDraft/clear/reset handlers, not just inputtype. Capture at dispatch:

~~~ts
const token = (testTokens.current[serviceName] ?? 0) + 1;
testTokens.current[serviceName] = token;
const revision = draftRevisions.current[serviceName] ?? 0;
const epoch = effectEpoch.current;
const ownsResult = (): boolean =>
  testTokens.current[serviceName] === token &&
  (draftRevisions.current[serviceName] ?? 0) === revision &&
  effectEpoch.current === epoch;
~~~

After await/catch publish only if ownsResult; pendingfinally clears only tokenowner. No serialized credential values needed for identity, no secrets in error/log.
- [ ] **3. Pending feedback:** disable repeated test sameunchangeddraft while pending, but editing invalidates oldpending and allows test newdraft. Per-service independentbusy, do not disable all Settings or save existing goodflow.
- [ ] **4. GREEN:** node node_modules/vitest/vitest.mjs run src/renderer/pages/Settings/__tests__/settingsController.test.ts --maxWorkers=4; run expanded mountedharness. Preserve effectEpoch saveguard and plaintext Dashboard.

## G12 — Real mounted Start, repository/auth, tail oracle (F16)

**Files Modify:**

- scripts/bugfix-ui/fixture.tsx, scripts/check-bugfix-ui.mjs, scripts/bugfix-ui/host.cjs only if DEMO bridge needed
- src/main/services/__tests__/pastedCapcutIntegration.test.ts
- src/main/services/__tests__/CapcutEngineService.test.ts
- src/main/services/capcut/__tests__/auth.test.ts
- src/main/services/capcut/__tests__/lateRunScenario.test.ts
- docs/superpowers/reports/2026-09-15-antigravity-project-review.md verification after implementation

**Interfaces:** Existing bridge interfaces IDashboardBridge/ISettingsBridge/IAccountsBridge, existing resetSharedDashboardController() export. New fixture-only deferred controls not production APIs.

- [ ] **1. Strengthen paste fixture:** use in-memory Database/runMigrations/AccountRepository/AccountService with test PlainVault from AccountService.test.ts pattern (define locally, don't import testfile). Unique nextId increasing; use actual createAutomationWorkSourceFactory; no source stub. Knownrow PasswordCapcut before/after byteexact; newrow no emailPassword. Same service two runs retains2rows andsameIDs.
- [ ] **2. Boundary matrices:** 0/1/multiple local matches; active ownership; missinglookup; update false/throw; cancellation after proxyacquire beforecreate; capacity10/2both direct andproxykey; duplicate/conflict pastlimit; sourcecreate/prepareonce. Assert no resources on preflightfail, no mailbox commit/release/bind/counters for pasted.
- [ ] **3. Fix misleading auth test:** failingrunner throws actual RecoveryLoginError rather than just returnedauthenticatedfalse. Engine seam captures ensureInApp options for existing-only and asserts actual policy:

~~~ts
const options = vi.mocked(ensureInApp).mock.calls.at(-1)?.[3];
expect(options).toBeDefined();
expect(options?.forceSignup).toBe(false);
expect(options?.allowSignupFallback).toBe(false);
expect(options?.getOtp).toBeUndefined();
~~~

Here options is captured fourth ensureInApp mock argument in current CapcutEngineService test. In auth.test.ts actual ensureInApp + loginfails + workspacefalse asserts signup spy0 and getOtp0. Runtime integration peer succeeds and badaccountfailed, summary counters match. No bypass auth through synthetic alreadyloggedin unless case tests that branch.
- [ ] **4. Actual page mounting:** import DashboardPage, SettingsPage, AccountsPage; MemoryRouter around pages, StrictMode. Fixture owns DEMO bridge installed before mount, no real preload/purchases. Provide every consumed method with typed deterministic envelope. Render controls outside pages to resolve/reject current requests, capture payload only DEMO. Unmount page and let effect cleanup dispose controller before resetSharedDashboardController(); the reset export only drops singleton reference. Keep standalone panel sequence but label as panel, not fullfeature.
- [ ] **5. Add mounted Start sequences:**
  - Manual valid two rows with pipe/spaces, custom mode empty retained→one run.start request pasted-existing/per-account and exact lines/passwords.
  - Invalid separator/conflict→run.start0; duplicate identical→one entry.
  - AutoSavepending→Start→edit text/threads→resolveSave→capturedStart originalsnapshot.
  - Doubleheader/actionbar Start same tick→one request; rejected Start errorvisible/unlocked.
  - Switch API retains password knobs, switchback retains paste text; plaintext provider key remains visible/selectable.
  - Mount/attach reload log and responseordering; Accounts mutationfail/pendingdelete; Settings drafttest race from G11.
- [ ] **6. Correct tail fixture:** healthy receipt uses input.sessionAlias and observedAt>requiredAfter>=sessionStartedAt:

~~~ts
const requiredMs = input.sessionStartedAt ?? Date.now();
const observedMs = Math.max(Date.now(), requiredMs + 1);
const receipt: CapcutVerificationReceipt = {
  runId: input.runId!,
  sessionAlias: input.sessionAlias!,
  requiredAfter: new Date(requiredMs).toISOString(),
  observedAt: new Date(observedMs).toISOString(),
  fresh: true, final: true, serverTotal: 12, serverDone: 12, complete: true
};
~~~

Current V08 productionlike wave2 actuallyHTTP+SQLite is worth preserving. Keep A9acks/B4acks/C0, exact13durableversions, noafterabortcalls. Add exact retainedlease IDs and cleanupFailures3, counters3completed1failed2stopped for that scenario; don't loosen tests to fit mismatch.
- [ ] **7. Cleanup tests:** own abort controller linked to pending runner gates; finally trigger cancellation/unblock all, await service.stop and waitForCompletion/owned testpromises allsettled before db.close/tempdelete. Do not leave background rejectedpromises or depend on testtimeout teardown. Harness startup must be inside try/finally too; close server even if Electronlaunch fails.
- [ ] **8. Final gates** follow runbook Node→fullsuite→build/selectors→restoreElectron→mounted/Electron. Capture command/exit and scenario evidence; sourcehashcompare after. No claim fixed from green inheritedtests alone.
