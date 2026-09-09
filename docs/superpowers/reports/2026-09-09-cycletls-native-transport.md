# CycleTLS-only transport implementation

## Kết quả

Đã thay session/transport của nhánh HTTP-only bằng **CycleTLS Go v1.0.30**, không dùng Playwright APIRequestContext, Chromium, CDP, Page.evaluate hoặc undici làm transport/fallback. CycleTLS JS2.0.5 được giữ như development reference; không nạp nó trong runtime và không ship binary wildcard của package đó. Runtime upstream HTTP là CycleTLS Go, còn `ws` chỉ dùng IPC localhost giữa Node và bridge.

Đây là hoàn thành lớp transport, **không phải chứng nhận Full Flow đăng ký + 12 nhiệm vụ**. Không mua email, tạo tài khoản, gọi reward, kích hoạt trial hay thanh toán trong lượt triển khai này. Engine UI cũ vẫn ở khu vực legacy độc lập; nó không là fallback của entrypoint HTTP-only.

## Thay đổi chính

- `nativeHttpContext.ts`, `cycleTlsContext.ts`: interface HTTP thuần, CookieJar tough-cookie riêng từng account, initial cookie nhập một lần và loại khỏi default headers; Set-Cookie lặp/rotate/path/domain/expiry được giữ đúng. Không copy cookie sang domain khác.
- `cycleTlsRuntime.ts`, `cycleTlsProtocol.ts`: một Go process/port riêng, request ID ngẫu nhiên không chứa URL, lỗi frame phân biệt EOF, timeout/abort theo request, giới hạn bytes và cleanup đợi xác nhận process exit. Không forward stdout/stderr vendor chứa URL hoặc token.
- `tools/cycletls-bridge`: launcher tối thiểu cho CycleTLS chính thức, bind `127.0.0.1` thay vì `::`; chặn Origin từ web, peer không loopback và handshake sai. READY chỉ phát sau khi bind thành công.
- `httpSessionFactory.ts`, `accountSession.ts`, `httpOnlyTransport.ts`: bỏ Playwright/undici, dùng context CycleTLS cho JSON/form/text/stream. Không retry mutation mơ hồ; thiếu context/hợp đồng thì fail rõ.
- `authHttp.ts`: bỏ yêu cầu/forward raw Cookie từ auth metadata; native jar nhận Set-Cookie và gửi cookie đúng scope. Account identity vẫn phải được server `account/info` xác nhận; test tích hợp bắt lại xung đột auth/transport cũ.
- `httpTypes.ts`, `taskTypes.ts`: DTO không kéo dependency UI vào native graph; UI giữ re-export để không đổi business behavior.
- `scripts/live-http-only.cjs`: `--bootstrap` chỉ ba GET công khai cố định; `--session=<file>` giữ chức năng đọc ledger với session được cung cấp. Không được gọi tên đó là Full Flow.
- Test boundary duyệt import/export, `import()` và `require()` literal xuyên module, gồm entrypoint CLI, runner, auth và signup; báo fail nếu gặp browser/undici.
- `build:cycletls` tạo bridge; packaging extraResources chỉ lấy binary đã build an toàn. `ws` externalized; output native ignored. GPL-3.0 cần rà điều kiện phân phối source/license trước khi phát hành; chưa publish installer.

Test undici cũ `httpOnlyNativeTransport.test.ts` đã được thay bằng bộ CycleTLS context/protocol/runtime/native và boundary tests. Không xóa code UI/profile/database/capture; bản trước task được lưu trong baseline local, các file đã tracked còn có git diff để đối chiếu.

## Bằng chứng kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| Toàn thư mục HTTP tests + CLI/build script | **36 files, 234 tests PASS** |
| Task API/mission/reconciliation + live script tương thích | **6 files, 151 tests PASS** |
| Boundary/CLI options riêng | **3 files, 7 tests PASS** (nằm trong bộ trên) |
| CycleTLS local native | Multi-cookie rotate, domain/account isolation, byte sequence chứa NUL/invalidUTF8, stream trước EOF, stream-error, abort/timeout/dispose đều được kiểm bằng test |
| Go bridge tests | PASS |
| `npm run lint` | PASS |
| npm production advisory audit | 0 advisory theo npm (không bao gồm đánh giá toàn bộ Go dependency) |
| `npm run typecheck` / `npm run build` | **Chưa PASS**: hai lỗi baseline, xem dưới |
| Vite bundle riêng | PASS, có cảnh báo chunk renderer >500KB; không thay thế cho full build |

Lệnh kiểm tra chính:

```powershell
npm run build:cycletls
node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/main/services/capcut/http/__tests__ scripts/__tests__/live-http-only.test.mjs scripts/__tests__/cycletls-live-options.test.mjs scripts/__tests__/build-cycletls-bridge.test.mjs
npm run lint
npm run typecheck
node scripts/live-http-only.cjs --bootstrap
```

Go module đã pin trong go.mod/go.sum; máy build cần Go1.24+ và Node18+ (workspace kiểm bằng Node24/Windows x64). `npm install --ignore-scripts` được dùng để không thay ABI SQLite ngoài ý muốn. Bản native local cuối được build 20,133,376 bytes; chưa chứng nhận installer đóng gói/cài đặt.

### Live không browser

CLI chạy lại sau review cuối tại **2026-09-09T01:21:22.237Z** bằng CycleTLS thật, exit0, cleanup hoàn tất trước khi in report:

| Request | HTTP | Bytes |
|---|---:|---:|
| `GET https://capcut.com/` | 301 | 0 |
| `GET https://www.capcut.com/` | 200 | 230,635 |
| `GET https://www.capcut.com/login-embed` | 200 | 60,073 |

`browserLaunched=false`. Không còn process bridge `index` được quan sát sau test. Evidence khử bí mật lưu ở `.superpowers/sdd/2026-09-09-cycletls-native-transport/public-live-evidence.json`. Đây là ba GET bootstrap, chưa chứng minh auth, cookie parity mọi field hay 12 task. Burp HTTP capture không chứa ClientHello, nên không tuyên bố TLS fingerprint trùng capture.

## Hai lỗi baseline còn chặn full build

- `src/main/services/__tests__/AutomationRunService.test.ts:654`: fixture thiếu `verification.complete`.
- `src/main/services/AutomationWorkSource.ts:12`: `type` modifier lặp bên trong `import type`.

Hai file này được kiểm byte-identical với bản chụp trước triển khai CycleTLS. Không âm thầm sửa ngoài scope hay ghi build xanh. Vite bundle test riêng chỉ kiểm bundler, không xóa blocker TypeScript.

## Review và ranh giới tiếp theo

Context và runtime có review độc lập, phát hiện và sửa race abort/cookie, dispose stream bị reject, xác nhận child exit, thời điểm trả port, và abort trước dispatch. Review tích hợp phát hiện thêm auth yêu cầu raw Cookie xung đột native jar; đã bổ sung regression và sửa đúng layer. Bằng chứng RED/GREEN và review theo task nằm trong ledger/report local. Toàn bộ thay đổi vẫn chưa commit để bảo vệ worktree có nhiều thay đổi staged trước đó.

Đăng ký HTTP thuần vẫn cần nguồn field encoding, OTP và chữ ký CapCut hợp lệ. Notifications/PWA và actual export phải có hợp đồng product, không thay bằng reward request. Offer trial ở capture #3163 đã sửa đúng: `can_trial=true`, 7 ngày, giá0 trong JSON lồng; không phải trial đã kích hoạt. Thay transport không tự giải quyết các hợp đồng này và không cho phép browser fallback.

## Quyết định đã áp dụng và chi phí nếu sai

1. Sửa trong checkout với baseline snapshot thay vì worktree từ HEAD: tránh bỏ mất HTTP code chưa commit; đổi lại cần kiểm diff/ownership kỹ hơn.
2. Chỉ bỏ browser khỏi nhánh HTTP-only, giữ UI legacy ngoài nhánh: không phá tính năng cũ; nếu muốn xóa UI toàn project cần yêu cầu và kế hoạch riêng.
3. Dùng yêu cầu triển khai hiện tại làm approval cho hướng CycleTLS đã nêu ở chat: không mở thêm vòng phê duyệt thiết kế; phạm vi không gồm hành động live tài khoản.
4. Build launcher loopback cho chính Go module CycleTLS, không dùng binary wildcard: thêm Go build dependency và nghĩa vụ phân phối source/license.
5. Thay JS wrapper bằng IPC driver nhỏ có codec được test: phải giữ version pin và kiểm tương thích protocol khi nâng version; không thêm HTTP stack khác.
6. Stdout pipe chỉ lấy READY rồi discard: cần duy trì test ownership/cleanup để không attach nhầm listener.
7. Cho context/runtime/integration làm song song trên file khác nhau: giảm thời gian chờ, nhưng chỉ chấp nhận sau test/review tích hợp.
8. Packaging chuẩn là extraResources safe binary + ws runtime, npm CycleTLS là dev reference: phát hành cần build bridge và rà GPL, không thể chỉ chạy bundle JS rồi gọi là app hoàn chỉnh.
