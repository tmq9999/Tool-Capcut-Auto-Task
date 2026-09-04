import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyTheme,
  rememberRoute,
  readBootPreferences,
  writeBootPreferences,
  BOOT_PREFERENCES_KEY
} from '../appPreferences';

/** Storage tối giản đúng phần API mà module dùng — không cần DOM thật. */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

/** Đủ để kiểm `classList` mà không cần jsdom. */
class FakeElement {
  public classes = new Set<string>();
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); }
  };
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe('applyTheme', () => {
  it('bật class dark cho theme tối', () => {
    const el = new FakeElement();

    applyTheme('dark', el as unknown as HTMLElement);

    expect(el.classes.has('dark')).toBe(true);
  });

  it('bỏ class dark cho theme sáng', () => {
    const el = new FakeElement();
    el.classes.add('dark');

    applyTheme('light', el as unknown as HTMLElement);

    expect(el.classes.has('dark')).toBe(false);
  });
});

describe('rememberRoute', () => {
  it('nhớ trang đang xem để lần mở sau vào đúng chỗ đó', () => {
    rememberRoute(storage, '/logs');

    expect(readBootPreferences(storage).lastRoute).toBe('/logs');
  });

  it('bỏ qua đường dẫn lạ, không ghi rác vào bộ nhớ', () => {
    rememberRoute(storage, '/logs');
    rememberRoute(storage, '/khong-ton-tai');

    expect(readBootPreferences(storage).lastRoute).toBe('/logs');
  });
});

describe('readBootPreferences', () => {
  /**
   * Bản mặc định phải dùng được ngay lúc khởi động: `HashRouter` chọn trang đầu
   * TRƯỚC khi IPC trả settings về, nên không thể chờ DB.
   */
  it('chưa có gì thì mặc định dark, không khôi phục phiên', () => {
    expect(readBootPreferences(storage)).toEqual({
      theme: 'dark',
      sessionRestore: false,
      lastRoute: null
    });
  });

  it('JSON hỏng thì rơi về mặc định thay vì ném', () => {
    storage.setItem(BOOT_PREFERENCES_KEY, '{khong-phai-json');

    expect(readBootPreferences(storage).theme).toBe('dark');
  });

  it('giá trị theme lạ bị bỏ, không truyền vào class của <html>', () => {
    storage.setItem(BOOT_PREFERENCES_KEY, JSON.stringify({ theme: 'neon' }));

    expect(readBootPreferences(storage).theme).toBe('dark');
  });

  it('giữ lastRoute khi ghi lại theme và cờ khôi phục phiên', () => {
    rememberRoute(storage, '/accounts');

    writeBootPreferences(storage, { theme: 'light', sessionRestore: true });

    expect(readBootPreferences(storage)).toEqual({
      theme: 'light',
      sessionRestore: true,
      lastRoute: '/accounts'
    });
  });
});
