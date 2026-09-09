# Rà lại capture gốc: lỗi flow và mức độ đọc thực tế

## Kết quả chính

Đã đọc lại toàn bộ **3.315 trao đổi HTTP** từ file gốc, đối chiếu hash/offset và lập hồ sơ theo từng ID bằng ba phân vùng không trùng nhau. Đã tìm thấy lỗi thật trong logic hiện hành và nhiều bước chưa nối vào đường chạy production. **Không sửa production code, không mua mail, không chạy live và không gửi lại request claim trong lượt này.**

Tôi nhận trách nhiệm về hai điểm báo cáo trước thiếu chính xác: gọi một primitive/harness đã chạy là bộ flow đã triển khai chưa phản ánh đường chạy thật của app; object giá `capcut.cloud.*` được người dùng dán là storage/workspace, không phải response VIP. Rà soát này sửa lại bằng chứng, không lấy kết quả đăng ký thành công để thay cho việc tài khoản làm nhiệm vụ/nhận điểm thành công.

Nguồn được kiểm tra là `Capture/Capture_Full_Capcut_Flow`, **526.282.871 byte**. SHA-256 vẫn là `e5e97fb2aa376d98417d2ebeb9041889c17639e95a24aba1ea4b7d122b52e1d9`; không chỉnh sửa capture.

## Sai lệch cụ thể đã tìm thấy

| Mã | Bằng chứng | Vấn đề trong code/flow hiện hành | Ảnh hưởng |
|---|---|---|---|
| F01 | `trial.ts` trả `canTrial:true` khi lỗi; `isEligible(error)` trả true; engine thay `days=0` thành 7 | Trial DOM vẫn fail-open | Có thể báo “Pro trial 7 ngày” khi chưa đọc được trial |
| F02 | Tìm toàn bộ production caller: parser/API trial mới không được engine gọi | Code mới chỉ được scratch harness/tests dùng; engine vẫn gọi `checkProTrial` DOM | Thay đổi primitive không đồng nghĩa app đã chuyển HTTP-only |
| F03 | #211 → #220 → #230 → #235 → #237 | Harness bỏ ba request age-gate quanh đăng ký; cũng thiếu các bước region/broadcast có trong capture | Chưa giữ nguyên chuỗi tạo tài khoản → khởi tạo trạng thái sản phẩm; cần kiểm chứng phụ thuộc |
| F04 | Live `user_info` và workspace đều `ret=1014`; harness vẫn chạy tiếp và exit 0 | `registered=true`/exit 0 không biểu diễn trạng thái sản phẩm lỗi | Có thể gọi lượt test thành công dù chưa có workspace hợp lệ |
| F05 | Snapshot #3113 có 12 task status4 và 9 `do_action` thành công | Reducer yêu cầu action proof riêng cho cả signup/nhóm cha; chạy offline chỉ ra 9 verified, 3 pending | Nhiệm vụ nhóm có thể bị báo chưa xác minh dù server đã hoàn tất |
| F06 | Nhóm cha chuyển status2 → status4 ở snapshot sau: #2588 → #2593, #2958 → #2961 | Runner chỉ đọc snapshot ngay sau operation; chưa có bước đối soát cuối có giới hạn | Có thể trả kết quả trước khi server chốt nhóm cha |
| F07 | Stream giả chỉ có `run_start` tái hiện `accepted=true`, `ended=false`; capture tốt có `run_end` | `submitDesignChat` chỉ kiểm HTTP; `inspectDesignReceipt.accepted` không đòi kết thúc | Có thể nhận stream dở/lỗi là thành công |
| F08 | Không có bộ concrete operation đủ 9 leaf được nối vào runner production | Các primitive, CLI và capability flags chưa thành một full flow | Chưa thể nghiệm thu 12/12 bằng tool hiện hành |
| F09 | #1987/#1993 được điểm trước khi job #1988 hoàn tất #2065; export #2957/#2958 chỉ kèm metadata | Điểm thưởng và kết quả sản phẩm có thời điểm/điều kiện khác nhau | Không dùng điểm được cấp để suy ra ảnh/video/file export đã tạo xong |
| F10 | Capture Creator chỉ có một stream dài từ cursor rỗng; code mở hai lần cursor rỗng | Chưa có bằng chứng reconnect/replay đúng | Có thể bỏ lỡ/lặp milestone; chưa đủ dữ liệu kết luận lỗi thực tế |
| F11 | Response đầu bạn dán là object price-list đơn (`response` chứa object `all_price_list`); response batch phía sau mới là mảng entry có `key` | `parseTrialOffers` hiện chỉ nhận envelope batch (`response` là array hoặc `data` là array); nếu adapter đưa object đơn vào parser sẽ nhận `TRIAL_RESPONSE_SCHEMA_UNRECOGNIZED` | Có thể biến response VIP hợp lệ thành lỗi parse; adapter phải phân biệt single price-list response với batch response |

**F01, F05, F07 và F11 đã được tái hiện offline bằng code hiện tại.** F03 là bước thiếu được chứng minh bằng request, nhưng chưa chứng minh riêng bước đó gây `1014` hay hạn chế tài khoản. F10 là khoảng trống hợp đồng, không được gán thành nguyên nhân đã xác minh.

Vị trí code và mốc request chi tiết:

- [Auth, trial và tích hợp engine](auth-trial.md)
- [Nhiệm vụ, Design, Creator và export](task-products.md)
- [Bootstrap, HTTP còn lại và so sánh với live](remaining-http.md)
- [JavaScript từng file/inline và nguồn thiếu](javascript.md)
- [Toàn bộ 244 nhóm HTTP của phần còn lại, kèm từng ID](remaining-groups.md)

## Request live chưa tương đương capture ở đâu

Đối chiếu offline đã đọc trực tiếp response live được mã hóa DPAPI, không replay:

1. `login-embed` bỏ các query `col`, `lang`, `login4`, `scene`, `sdk_login_preset`.
2. Chuỗi region/CSRF/context trước đăng ký khác; các header `store-country-code-src` tại một số bước không cùng nguồn với request capture được so.
3. `user_info` live không có query `msToken` như #237; các trường ký `X-Bogus`, `X-Gnarly`, `sign`, cùng metadata liên quan, vẫn chưa được triển khai/kiểm chứng đầy đủ.
4. Header task-resource/task-list live thiếu `appvr`, `pf`, `lan` trong bản ghi explicit trước transport.
5. Teams bị bỏ khỏi trial batch do workspace thất bại trước đó. Không được chèn workspace của capture để thay thế.
6. Dữ liệu HTTP bootstrap live chỉ lưu header/status, không lưu HTML body. Do đó không thể phục hồi toàn bộ bootstrap-state của lượt đó từ log hiện có.

Bản ghi header live là dữ liệu trước transport, không phải capture packet. Cookie được jar bổ sung; User-Agent có thể đến từ cấu hình CycleTLS. Không kết luận thiếu trên wire chỉ từ việc vắng trong object header explicit. Không sao chép token/cookie/signature giữa các tài khoản để làm cho hai request trông giống nhau.

## Trial: kết luận đúng theo đúng loại dữ liệu

- **Storage/workspace:** direct `cc_web_price_list` #316/#1673/#2223 trả sáu gói cloud; `can_trial=false` ở đó không kết luận được trial Pro.
- **VIP batch:** #3163 chứa `response` là JSON string; parse ra mảng, chọn theo key `cc_price_list_vip`, rồi đọc `response.data.all_price_list`. Hai trong bốn offer thỏa trial miễn phí bảy ngày.
- **Live mới nhất:** response batch là các sản phẩm Pro/Ultra thật, không phải cloud storage; VIP4 và Ultra2 đều false. Mảng trả Ultra trước VIP. Parser theo key đọc đúng response này, nhưng request/context/flow còn chưa tương đương capture.
- **Trial đang active:** là trạng thái khác với offer khả dụng. Lượt kiểm tra không gọi kích hoạt.

## Độ bao phủ và phần không thể tự nhận đã hiểu hết

| Phần | Số trao đổi | Độ đọc được ghi nhận |
|---|---:|---|
| Auth + trial, toàn domain | 477 | 364 endpoint/body semantic; 80 preflight; 33 opaque/support internals còn giới hạn |
| Task + Design + Creator | 911 | 471 endpoint/body structured; 440 binary/preflight/source-delegated; không chạm giới hạn nested-depth |
| Phần còn lại | 1.927 | Mỗi ID có disposition; 1.619 endpoint/schema, 210 protocol, 32 JS/HTML cross-review, 59 binary, 7 SDK opaque |
| Tổng | **3.315** | **3.315 ID duy nhất, không thiếu ID, hash và số byte khớp** |

Tổng body đã đọc: **16.924.270 byte request**, **494.069.992 byte response**. Các response Google update có tiền tố anti-XSSI đã được phân biệt khỏi JSON lỗi của CapCut. Hồ sơ không coi đọc/hash binary là hiểu nội dung hình/âm thanh/video.

### JavaScript thực sự có trong capture

Kiểm kê toàn file theo MIME, content-type, extension và nội dung tìm thấy:

- **26 response ứng viên script, 1.859.032 byte**: 23 là JS, ba là dữ liệu bị gắn nhãn giống script.
- **192 script nhúng không rỗng**: 49 executable, 143 JSON data blocks, đều có ID/hash và mức phân tích riêng.
- 49 executable inline đã được đọc tĩnh: 43 theo toàn bộ nguồn nhỏ, sáu theo các vùng nguồn liên tiếp; năm JS response lớn cũng được đọc theo vùng. Tổng 95 vùng có offset/hash liên tục đã được root kiểm lại. Không còn executable inline chỉ ghi mức parse cú pháp.
- **18 response manifest tài nguyên** được đọc để truy nguồn file.
- Nguồn duy nhất là response JS từ `www.capcut.com`: worker VE #3000; không phải bundle Passport/trial/task. Worker có nhánh import động và fallback import tới module không nằm trong capture.
- HTML/manifest/telemetry tham chiếu **741 origin/path không có response tương ứng**, đã kiểm cả exact URL và cùng origin/path để tránh nhầm query khác thành nguồn thiếu. Danh sách cụ thể nằm trong `missing-scripts.json`.

**Vì vậy không thể gọi đây là “đã đọc toàn bộ mã nguồn CapCut”.** Những bundle vắng body không có nội dung để đọc. Với file minify lớn đã có, báo cáo giữ riêng mức đọc tĩnh từng vùng và phần internals chưa giải thích, không dùng AST/hash thay cho hiểu mọi function. Lượt này không tải bù hoặc chạy script ngoài.

Ví dụ nguồn được tham chiếu nhưng thiếu body: bundle `services`/`runtime` của `video_online` trên `sf16-web-login-neutral.capcutstatic.com`, các chunk `ai_design_online`, `ai_creator_oversea_online`, và fallback `vesdk-lvapi-opt.js` của worker #3000. Đây là khoảng trống nguồn kiểm được từ file, không phải lý do để bỏ qua các bước đã hiện rõ trong request như onboarding và đối soát nhóm cha.

## Trạng thái nghiệm thu và thứ tự xử lý tiếp

Đây là kết quả audit, **không phải bản fix đã xong**. Tài khoản không nhận được điểm theo kiểm tra trực tiếp của người dùng không được nghiệm thu là tài khoản dùng được chỉ vì Passport trả success.

Thứ tự sửa được đề xuất từ bằng chứng, chưa triển khai trong lượt audit:

1. Chặn báo thành công giả: trial unknown không đổi thành eligible; lỗi product/workspace phải thể hiện trong kết quả tổng; stream chưa kết thúc không được accepted.
2. Thiết kế lại state/proof cho signup, 9 leaf và 2 nhóm cha; kiểm thử snapshot chuyển tiếp trong một tài khoản, không đặt barrier giữa các tài khoản.
3. Nối production runner với các operation đã kiểm chứng, không chỉ khai báo capability. Bảo toàn CookieJar/proxy/state riêng và lỗi riêng từng worker.
4. Bổ sung nguồn capture còn thiếu để phân tích các bundle nghiệp vụ; chỉ dùng nguồn/account data được phép. Các giá trị SDK opaque vẫn là giới hạn chưa giải quyết, không tự tạo công thức hay cơ chế vượt hạn chế.
5. Chỉ lên lịch live tiếp khi có test regression, contract từng bước và bằng chứng tương ứng; không mua thêm mail để thử ngẫu nhiên.

Các thay đổi kế hoạch trong lượt này: mở rộng phân tích ngoài domain focus để không bỏ HTTP/JS dependency; tách exact-URL khỏi path-only khi kiểm nguồn; nâng các dòng JS chỉ parse cú pháp thành đọc nguồn tĩnh có ghi mức giới hạn; giữ production nguyên trạng. Superpowers systematic debugging, phân công độc lập và kiểm chứng trước kết luận được dùng để buộc mọi phát hiện có request ID hoặc tái hiện code.

## Hồ sơ kiểm chứng cục bộ

Tại `.superpowers/sdd/2026-09-09-capture-reread/`:

- `coverage-verification.json`: đối chiếu độc lập ID, byte, hash và ledger.
- `machine/all-requests.jsonl`: schema traversal mỗi request/response, không giá trị credential.
- `auth-trial/auth-trial-rows.jsonl`, `task-product-rows.jsonl`, `remaining-reviewed.jsonl`: phân công đủ 3.315 ID.
- `javascript-ledger.json`, `missing-scripts.json`: từng response/inline script, nguồn và mức đọc.
- `live-capture-comparison.json`: so sánh request/cấu trúc response đã che giá trị riêng tư.
- `reproduced-findings.json`: kết quả tái hiện ba lỗi code offline.

Không stage/commit/reset, không xóa evidence cũ, không thay khóa/proxy/tài khoản trong lượt này.
