/**
 * =============================================================================
 * NHỊP NGƯỜI DÙNG (`stepDelay*` / `typeDelay*`) — SÀN LÀ BẤT BIẾN
 * =============================================================================
 * Hai ô cấu hình của Dashboard chỉ được làm CHẬM HƠN nhịp engine đã đo. CapCut
 * chạy Shark Risk Control: nó chấm điểm độ trễ giữa các phím, và bản gõ nhanh
 * hơn `45–130ms`/ký tự bị trả `err_no 8001003` lúc claim thưởng
 * (docs/AUTOMATION-ENGINE.md §5). Nên ở đây kiểm đúng ba điều:
 *
 *   1. đặt 0 (hay bất cứ số nhỏ hơn sàn) thì nhịp vẫn ≥ 45ms
 *   2. số LỚN hơn sàn thì được tôn trọng nguyên vẹn
 *   3. không truyền `pace` thì hành vi y như trước khi có ô cấu hình
 * =============================================================================
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locator, Page } from 'playwright-core';

import { humanType, perCharDelayRange, type PerCharDelay } from '../human';
import { paceGapMs } from '../runTasks';
import { fillEditor } from '../steps';
import type { CapcutPace } from '../types';

/** Trang giả: chỉ ghi lại `delay` mà nhịp gõ đưa cho từng ký tự. */
function stubTarget(): { page: Page; locator: Locator; delays: number[] } {
  const delays: number[] = [];

  const page = {
    keyboard: {
      type: async (_ch: string, options?: { delay?: number }): Promise<void> => {
        delays.push(options?.delay ?? 0);
      },
    },
  } as unknown as Page;

  // `boundingBox` trả null để `humanClick` đi nhánh click thường: test này đo
  // nhịp gõ, không đo quỹ đạo chuột (quỹ đạo là bất biến khác, không đổi ở đây).
  const locator = {
    scrollIntoViewIfNeeded: async (): Promise<void> => {},
    boundingBox: async (): Promise<null> => null,
    click: async (): Promise<void> => {},
  } as unknown as Locator;

  return { page, locator, delays };
}

/**
 * Chạy một lượt gõ chữ dưới đồng hồ giả.
 *
 * `humanType` xen `sleep()` trước, giữa và sau các ký tự (nhịp "suy nghĩ" của
 * người thật), nên đồng hồ thật sẽ tốn cả giây cho mỗi lượt test. Gọi
 * `runAllTimersAsync` trong vòng lặp vì mỗi khoảng chờ chỉ được xếp lịch SAU khi
 * khoảng trước resolve.
 */
async function runTyping(task: () => Promise<void>): Promise<void> {
  vi.useFakeTimers();
  let finished = false;
  const running = task().then(() => {
    finished = true;
  });
  for (let guard = 0; guard < 100 && !finished; guard++) {
    await vi.runAllTimersAsync();
  }
  await running;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('perCharDelayRange — sàn 45–130ms mỗi ký tự', () => {
  it('không truyền gì thì đúng khoảng engine đã đo', () => {
    expect(perCharDelayRange()).toEqual({ minMs: 45, maxMs: 130 });
  });

  it('typeDelayMinMs = 0 vẫn bị đẩy lên sàn 45ms', () => {
    expect(perCharDelayRange({ minMs: 0, maxMs: 0 })).toEqual({ minMs: 45, maxMs: 130 });
  });

  it('mọi số nhỏ hơn sàn đều không làm gõ nhanh hơn', () => {
    expect(perCharDelayRange({ minMs: 5, maxMs: 20 })).toEqual({ minMs: 45, maxMs: 130 });
  });

  it('số lớn hơn sàn được tôn trọng nguyên vẹn', () => {
    expect(perCharDelayRange({ minMs: 300, maxMs: 900 })).toEqual({ minMs: 300, maxMs: 900 });
  });

  it('chỉ Max lớn hơn sàn thì giữ Max, Min vẫn là sàn', () => {
    expect(perCharDelayRange({ minMs: 0, maxMs: 400 })).toEqual({ minMs: 45, maxMs: 400 });
  });

  it('cấu hình ngược (Max < Min) không sinh khoảng âm', () => {
    // `max` lấy Math.max(min, ...) nên xấu nhất là gõ đúng bằng min.
    expect(perCharDelayRange({ minMs: 900, maxMs: 10 })).toEqual({ minMs: 900, maxMs: 900 });
  });
});

describe('humanType — nhịp thật đưa cho từng ký tự', () => {
  it('typeDelayMinMs = 0: mọi ký tự vẫn ≥ 45ms và ≤ 130ms', async () => {
    const { page, locator, delays } = stubTarget();

    await runTyping(() => humanType(page, locator, 'hello', { minMs: 0, maxMs: 0 }));

    expect(delays).toHaveLength(5);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(45);
      expect(delay).toBeLessThanOrEqual(130);
    }
  });

  it('giá trị lớn hơn sàn đi thẳng vào page.keyboard.type', async () => {
    const { page, locator, delays } = stubTarget();

    await runTyping(() => humanType(page, locator, 'hello', { minMs: 400, maxMs: 700 }));

    expect(delays).toHaveLength(5);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(400);
      expect(delay).toBeLessThanOrEqual(700);
    }
  });

  it('không có pace thì y như cũ: rand(45, 130)', async () => {
    const { page, locator, delays } = stubTarget();

    await runTyping(() => humanType(page, locator, 'hello'));

    expect(delays).toHaveLength(5);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(45);
      expect(delay).toBeLessThanOrEqual(130);
    }
  });
});

describe('fillEditor — mission truyền nhịp xuống được', () => {
  it('nhịp của người dùng tới đúng từng ký tự', async () => {
    const { page, locator, delays } = stubTarget();
    const perChar: PerCharDelay = { minMs: 500, maxMs: 500 };

    await runTyping(() => fillEditor(page, locator, 'ab', perChar));

    expect(delays).toEqual([500, 500]);
  });

  it('không truyền perChar thì vẫn là nhịp đã đo', async () => {
    const { page, locator, delays } = stubTarget();

    await runTyping(() => fillEditor(page, locator, 'ab'));

    expect(delays).toHaveLength(2);
    expect(delays.every((delay) => delay >= 45 && delay <= 130)).toBe(true);
  });
});

describe('paceGapMs — khoảng nghỉ THÊM giữa các bước lớn', () => {
  const pace: CapcutPace = { stepMinMs: 500, stepMaxMs: 2000, typeMinMs: 0, typeMaxMs: 0 };

  it('không có pace thì không sinh khoảng chờ nào', () => {
    expect(paceGapMs()).toBe(0);
    expect(paceGapMs(undefined)).toBe(0);
  });

  it('nghỉ trong đúng khoảng người dùng đặt', () => {
    for (let i = 0; i < 50; i++) {
      const gap = paceGapMs(pace);
      expect(gap).toBeGreaterThanOrEqual(500);
      expect(gap).toBeLessThanOrEqual(2000);
    }
  });

  it('đặt 0/0 thì không cộng thêm gì vào nhịp gốc của engine', () => {
    expect(paceGapMs({ stepMinMs: 0, stepMaxMs: 0, typeMinMs: 0, typeMaxMs: 0 })).toBe(0);
  });
});
