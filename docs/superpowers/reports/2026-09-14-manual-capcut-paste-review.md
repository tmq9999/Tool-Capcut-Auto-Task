# Audit feature dán tài khoản CapCut có sẵn — 14/09/2026

Baseline: HEAD3bb6b72/v3.0.3, source sạch trước audit. Chỉ review và lập tài liệu; không triển khai fix. Bộ bàn giao: [Spec](../specs/2026-09-10-tool-bugfix-spec.md), [Plan](../plans/2026-09-10-tool-bugfix-plan.md), [Runbook](../plans/2026-09-10-tool-bugfix-runbook.md).

## Kết luận

Feature hiện **chưa hoạt động đúng** vì UI gọi là Dán thủ công nhưng runtime đang coi mỗi dòng là mailbox/account mới.

Trace thực tế:

UI email|password → toRunConfig mode manual → ManualWorkSource kind new/emailPassword → createThreadRecord tự sinh capcutPassword → authAttempt initial → login fail có thể fallback signup/OTP.

Đây là lỗi P1, không phải lỗi do textarea không nhận paste.

## Findings

### MP01 — P1: sai loại tài khoản và sai auth flow

Files/functions:

- renderer/pages/Dashboard/AutomationConfigGrid.tsx:300–314,393–400
- renderer/pages/Dashboard/automationConfig.ts:125–185
- main/services/AutomationWorkSource.ts:136–167
- main/services/AutomationRunService.ts:createThreadRecord, runThreadWorkload
- main/services/capcut/auth.ts:ensureInApp

Probe actual:

~~~json
{
  "workKind": "new",
  "pastedField": "emailPassword",
  "runnerPassword": "random-generated-not-pasted",
  "authAttempt": "initial",
  "isNewAccount": false,
  "getOtp": "absent"
}
~~~

isNewAccount false không đủ để chọn login-only. authAttempt vẫn initial và ensureInApp cho signup fallback. Kết quả là password CapCut người dùng dán không bao giờ được sử dụng.

Fix: runtime discriminator pasted-existing, thread isExistingAccount=true, capcutPassword lấy đúng input, authAttempt existing-only, allowSignupFallback=false, không OTP/signup/purchase. Giữ legacy source mode manual trong test/CLI nếu không đi qua discriminator mới; UI mode manual map sang pasted-existing.

### MP02 — P1: password bị cắt và ghi nhầm emailPassword

AutomationWorkSource.ts dùng trimmed.split('|') và lấy hai phần đầu. Input email|A|B thành A; whitespace password bị trim; item ghi emailPassword. Password CapCut phải giữ phần sau separator đầu tiên nguyên vẹn.

Fix: shared parser split first pipe; email trim riêng; capcutPassword giữ phần còn lại; reject rỗng/whitespace-only; không log secret.

### MP03 — P1: validation UI chậm hơn main và policy batch không rõ

automationConfig.ts chỉ chặn textarea hoàn toàn rỗng; schema entries chỉ là string. Invalid email được main reject sau khi user bấm Start; thiếu separator/password và duplicate/conflict thì main hiện vẫn nhận. Không có validation chung cho pasted CapCut credentials.

Fix: shared parser trả line number + issue category; renderer và main cùng dùng rule. Reject atomic trước proxy/profile. Blank lines không làm sai số dòng. Preview chỉ hiển thị email/line/status, không password.

### MP04 — P1: duplicate/conflicting email chạy song song

Input same@example.com|A, SAME@example.com|B, same@example.com|A tạo ba work items. Không dedup trước capacity; password conflict không deterministic.

Fix: normalize email lowercase cho identity; cùng password giữ dòng đầu; khác password reject mọi dòng liên quan trước resource acquisition. Không đổi policy legacy mode manual trực tiếp.

### MP05 — P2: global password panel chặn input hợp lệ

passwordMode custom + customPassword empty làm toRunConfig false dù mỗi dòng đã có CapCut password. Secret transient không persist nên reload càng dễ rơi vào lỗi này.

Fix: pasted-existing bỏ qua generator password validation; UI hiện note password lấy từ từng dòng. API/new-mailbox generator giữ nguyên.

### MP06 — P2: proxy capacity tính trước effective pasted count

prepareRun dùng threadCount/mailLimit trước source.prepare. 10 threads + 2 pasted rows có thể bị yêu cầu 10 proxy rồi reject, dù chỉ cần 2 worker.

Fix: pasted-existing effective target min(threadCount, dedupedRows, mailLimit); dùng target khi parse direct proxy/proxykey capacity. Legacy manual/API/existing accountIds giữ nguyên.

### MP07 — P2: không bind local account identity

kind new luôn accounts.create, nên paste lại cùng remote account tạo local rows trùng và task history phân tán.

Fix: AccountRepository/AccountService findByEmail case-insensitive. Một local row reuse accountId; zero row tạo tracking row với password CapCut dán khi accepted; nhiều row block. Password dán của row có sẵn chỉ transient, không tự overwrite stored secret trong đợt fix này kể cả login success. Đây là local tracking, không phải tạo remote account.

### MP08 — P2: test hiện tại false-green/thiếu mounted path

capcutSignupPath.test.ts chỉ assert isNewAccount false, không assert password/authAttempt/getOtp/no signup. AutomationWorkSource.test.ts:158–178 cố ý chấp nhận duplicate cho legacy manual. Không có mounted Dashboard paste → Start → captured typed config.

Add tests cho shared parser/schema/source/runtime/auth/local identity/effective capacity và mounted Dashboard. Preserve existing legacy tests separately.

## Probe matrix

| Input | Hiện tại | Cần đạt |
|---|---|---|
| existing@example.com\|CapCutPass | kind new, global/generated password, initial | pasted-existing, exact password, existing-only |
| email\|A\|B | password A | password A\|B nguyên vẹn |
| email only | accepted by renderer/source | reject line |
| good + invalid line | renderer accepts, main rejects later | renderer/main reject before resources |
| same email case variants | 3 workers | one item or conflict |
| 10 threads + 2 rows | capacity asks 10 | effective target2 |
| custom global password empty + per-line passwords | Start blocked | Start allowed |
| login error | signup fallback possible | RecoveryLoginError, no signup/OTP |

## Verification

- npm run typecheck: PASS exit0 trong lượt này
- npm run lint: PASS exit0 trong lượt này
- Focused config/worksource/controller/auth/schema suites: 228 tests/10 files PASS; tests hiện hữu chưa kiểm đúng pasted-existing contract mới
- No live provider/account, purchase, OTP, DB user mutation or source fix
- Worktree clean before documentation changes

## Scope guard

Không thay do_action/task_list/claim/trial gate/pacing/restock. Không mask password/API key/proxy trên Dashboard.

## Snapshot và kiểm tra bàn giao

Đã đối chiếu HEAD3bb6b72 và inventory454JS/TSfiles; git diff --name-only -- src scripts tools không có thay đổi. Lượt này chỉ viết lại3tài liệu bàn giao và thêm report. Native addon đã được rebuild về Electron; không chạy app/live account hoặc thay dữ liệu user.

| File | SHA-256 |
|---|---|
| `src/renderer/pages/Dashboard/automationConfig.ts` | `fe738a625390384627f3592f7a26ee37b9880046327849f349ebe4c401df1aa4` |
| `src/renderer/pages/Dashboard/AutomationConfigGrid.tsx` | `f782733c1528661542407647f8916e73f0e96c3e1ba5bb9aafd80cf74209073f` |
| `src/shared/schemas/automation.schema.ts` | `1695da14d11146fa9b8e408b66bef39e69b3c2f7c2da39c33969556b84e145f9` |
| `src/main/services/AutomationWorkSource.ts` | `add11a775d66ab795d681ea1b85ce5935e808fa85674f3aec3e775ae28fa0377` |
| `src/main/services/AutomationRunService.ts` | `7acc1b267530e7215a173c01c9a36ca965cd93c71bf2ec90fa5cea221293e597` |
| `src/main/services/capcut/auth.ts` | `8d6192337da379b58d8ff5b03e98d56f00569a9b9f5cccf14fd0a4398c9cf849` |
| `src/main/services/AccountService.ts` | `b72cafb5efe9b9c2acd9a975b3a34967517cdcb525a7fc376be4a1d74319ff39` |
| `src/main/repositories/AccountRepository.ts` | `286fa6637e5f2ee98590e52723da246e07a63359e0779cc9a97fac07419d5473` |

Tài liệu:44acceptancecriteria map đủ6tasks, codeblock syntax và local links được kiểm; git diff --check PASS. Snippet là kế hoạch chưa triển khai, không tính là fixes/testGREEN.
