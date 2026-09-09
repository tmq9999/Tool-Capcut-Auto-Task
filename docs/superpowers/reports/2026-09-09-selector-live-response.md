# Live selector-first: FAIL nghiệm thu 3 luồng

Run: `fd05b724-383d-4e0e-a94d-2bdb50e1b162`. Headed Multilogin, 3 email mới, 3 worker, không mua thay thế. Khoảng wrapper 02:51:00.252–02:55:38.547 ngày 09/09/2026 (+07), 278.295 giây.

## Đính chính kết quả export

**2/3 là số tài khoản server ghi nhận 12/12 task thưởng, không phải 2/3 luồng được chứng minh chạy không lỗi hoặc xuất file hoàn chỉnh.** Người dùng quan sát một tài khoản lỗi ở export cuối. Bản báo đầu chưa tách trạng thái task thưởng và kết quả export thực tế.

| Alias nội bộ | Bằng chứng server | Bằng chứng export thực tế |
| --- | --- | --- |
| account-1 / worker-2 | Bootstrap task_list hết 30s, không có receipt | Không tới export |
| account-2 / worker-3 | Fresh final12/12, 9 action proofs, export do_action HTTP200/err_no0 | Có log nhận sự kiện download 02:55:32.565; **chưa chứng minh download hoàn tất** |
| account-3 / worker-1 | Fresh final12/12, 9 action proofs, export do_action HTTP200/err_no0 | Chỉ log click export 02:55:25.884, **không có log download**; không được gọi export thành công |

Hai response task thưởng export thật đã che dữ liệu nhạy cảm:

```json
{"account":"account-3","at":"2026-09-08T19:55:26.213Z","httpStatus":200,"actionKey":"capcut_web_video_studio_export","body":{"data":{},"err_no":0,"err_tips":""}}
{"account":"account-2","at":"2026-09-08T19:55:30.367Z","httpStatus":200,"actionKey":"capcut_web_video_studio_export","body":{"data":{},"err_no":0,"err_tips":""}}
```

`missions/videoStudio.ts:458–480` chỉ lưu `suggestedFilename()` khi phát sinh sự kiện `download`, rồi chờ một khoảng cố định và log "Đã tải file". Không chờ `download.failure()`/artifact hoàn tất, không thu lỗi toast/client export. `missionRunner.ts` kiểm do_action và task_status4, nên task thưởng vẫn có thể được xác minh trong khi export UI báo lỗi. **Đã xác định khoảng trống kiểm chứng/báo cáo; chưa xác định nguyên nhân lỗi export người dùng thấy.**

Capture account-3 ghi `batch_query_assets` HTTP200 lúc 02:55:26.104 và GET artifact HTTP200 lúc 02:55:26.957; body artifact bị lược bỏ dạng binary. Các response này không chứng minh client render/encode/save thành công. Không tự gán mã lỗi hay kết luận người dùng nhìn nhầm.

## Bằng chứng còn lại

- Official verifier thường và `--require-independent`: FAIL `INVALID_TERMINAL_COUNTERS`. Peak editor thực tế2, chưa nghiệm thu stage3.
- Terminal: accepted3, completed2, failed1, stopped0, skipped0; không dùng `state=completed` của batch để gọi cả batch thành công.
- Mua mail attempted3/confirmed3/ambiguous0; DB test có đúng3 account và3 mail mới. Không chạy lại hoặc mua thêm.
- Profile3 start/3 stop xác nhận, tài nguyên workers/profiles/proxies/mail reservations cuối lượt đều0, cleanupFailures0. Không quarantine/DOM_READ_TIMEOUT ghi nhận trong lượt này; không đồng nghĩa không có lỗi UI/client.
- 3 file capture đóng đầy đủ, tổng5300 response;68 task_list và20 do_action. Hai account làm nhiệm vụ có18 do_action err_no0 và2 response8001001 ở lần thông báo lặp; giữ nguyên mã lỗi, không tự coi mọi lỗi là vô hại.
- Recorder có0 dropped/0 I/O errors. Có1725 body bị lược bỏ (binary, oversize, timeout hoặc không đọc được); không gọi capture là đầy đủ mọi byte.
- Account thất bại: recorder hoạt động xuyên suốt bootstrap;0 request endpoint thưởng `/task/v1/task_list`, không nằm trong các request incomplete. Có4 request riêng `lv/v2/task/get_task_list`, đều HTTP200 với task_list rỗng; không được thay thế endpoint thưởng bằng dữ liệu khác. Chưa rõ vì sao app không phát request thưởng.
-407 fingerprint source/build không đổi trong live. DB account/mail gốc không đổi. SQLite đã trả về Node ABI137 sau lượt test.

## Thay đổi phục vụ capture trước live

Chỉ thêm UUID vào tên file redacted capture để lần recovery không va `wx/EEXIST`; regression tái hiện RED, sửa GREEN,41 test liên quan/typecheck/lint/build qua, review độc lập duyệt. Không đổi mission/scheduler/auth/proof. Private raw capture không bật.

Artifact chẩn đoán riêng: `.superpowers/sdd/2026-09-09-selector-live-response/response-summary.json` và manifest cùng thư mục trỏ tới capture đã redacted ngoài repo. Không commit DB, credentials hay capture.

## Hướng kiểm chứng tiếp theo — chưa triển khai

Yêu cầu mới đã được lập thành [kế hoạch kiểm từng step và thu network](../plans/2026-09-09-stepwise-evidence-network-plan.md). Kế hoạch chưa cho phép tự chạy thêm live hoặc mua mail.

1. Giữ nguyên bằng chứng task thưởng nhưng báo riêng export UX/artifact: click, download started, completed/failed/không quan sát được; không dùng `suggestedFilename` để log tải xong.
2. Thu lỗi client/toast và outcome download/encode/save trên đúng account/session nếu được duyệt lượt chẩn đoán tiếp; không bấm export lại để đoán.
3. Điều tra độc lập vì sao account-1 không phát request thưởng; không tăng bootstrap timeout hay chấp nhận endpoint task_list khác để làm test xanh.

Không sửa thêm production hoặc chạy thêm live trong quá trình đối chiếu phản hồi của người dùng.
