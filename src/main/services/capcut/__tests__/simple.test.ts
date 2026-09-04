/**
 * =============================================================================
 * DÒNG NHIỆM VỤ ĐANG LÀ "CLAIM" THÌ PHẢI BẤM CLAIM
 * =============================================================================
 * Đo được 04/09/2026 trên account gmail94 `oskarkukk8412@gmail.com`, nhiệm vụ
 * `capcut_web_push_authorize` (Enable browser notifications):
 *
 *   · Đã bấm Allow ở thanh "Allow notifications from CapCut?"
 *   · Nút của "Enable browser notifications" đang là "Claim", không bấm Go
 *   ❌ Enable browser notifications (+70) — không thấy do_action
 *      "capcut_web_push_authorize" sau 45000ms
 *
 * Nút đã là "Claim" nghĩa là CapCut ĐÃ ghi nhận hành động — `do_action` bắn từ
 * trước, nên chờ nó lần nữa là chờ một thứ không bao giờ tới. Bản cũ chỉ bấm khi
 * nút là "Go" và bỏ qua mọi nhãn khác, nên nhiệm vụ đứng mãi ở trạng thái chờ
 * nhận. Nhánh dự phòng `claimIfPending` cũng không cứu được vì nó đòi
 * `task_status === 2` từ API, mà API và popover của CapCut đã đo được là lệch
 * nhau (xem lệch reward +210 vs +70).
 *
 * Bấm Claim là THAO TÁC UI — nó không kết luận nhiệm vụ xong. Kết luận vẫn chỉ
 * do `runGroup` + snapshot `task_status` của CapCut đưa ra (AGENTS.md §30).
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { decideRowAction } from '../missions/simple';

describe('decideRowAction', () => {
  it('nút Go thì bấm Go', () => {
    expect(decideRowAction('Go')).toBe('go');
  });

  it('nút Claim thì BẤM CLAIM — đó là cách nhiệm vụ được hoàn thành', () => {
    expect(decideRowAction('Claim')).toBe('claim');
  });

  it('không phân biệt hoa thường và bỏ khoảng trắng hai đầu', () => {
    expect(decideRowAction('  claim ')).toBe('claim');
    expect(decideRowAction('GO')).toBe('go');
  });

  it('Done / Tomorrow thì không bấm gì', () => {
    expect(decideRowAction('Done')).toBe('skip');
    expect(decideRowAction('Tomorrow')).toBe('skip');
  });

  it('nhãn rỗng hoặc lạ thì không bấm gì', () => {
    expect(decideRowAction('')).toBe('skip');
    expect(decideRowAction('Xem thêm')).toBe('skip');
  });
});
