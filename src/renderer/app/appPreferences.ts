import type { GeneralSettingsDTO } from '@shared/schemas/settings.schema';

/**
 * Bản sao nhẹ của hai cài đặt cần biết TRƯỚC khi IPC kịp trả lời.
 *
 * Nguồn thật vẫn là SQLite (`app_settings`, AGENTS §8/§12) — đây chỉ là bộ đệm
 * khởi động: `HashRouter` phải chọn trang đầu và `<html>` phải có class theme
 * ngay khung hình đầu tiên, trong khi `settings.get()` là bất đồng bộ. Không có
 * dữ liệu nghiệp vụ nào ở đây, chỉ hai lựa chọn hiển thị và tên trang.
 */
export const BOOT_PREFERENCES_KEY = 'automanager.boot-preferences';

/** Các trang thật của app — chặn dữ liệu rác trở thành đường dẫn. */
export const KNOWN_ROUTES = ['/dashboard', '/accounts', '/settings', '/logs'] as const;

export type KnownRoute = typeof KNOWN_ROUTES[number];

export interface BootPreferences {
  theme: GeneralSettingsDTO['theme'];
  sessionRestore: boolean;
  lastRoute: KnownRoute | null;
}

/** Chỉ hai giá trị này là hợp lệ; mọi thứ khác coi như dark. */
function normalizeTheme(value: unknown): GeneralSettingsDTO['theme'] {
  return value === 'light' ? 'light' : 'dark';
}

function normalizeRoute(value: unknown): KnownRoute | null {
  return typeof value === 'string' && (KNOWN_ROUTES as readonly string[]).includes(value)
    ? (value as KnownRoute)
    : null;
}

/** Phần API của `Storage` mà module này dùng — để test không cần jsdom. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readBootPreferences(storage: PreferenceStorage): BootPreferences {
  let raw: unknown = null;
  try {
    const stored = storage.getItem(BOOT_PREFERENCES_KEY);
    raw = stored ? JSON.parse(stored) : null;
  } catch {
    // Bộ đệm hỏng thì dùng mặc định — không được làm app không mở lên được.
    raw = null;
  }

  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    theme: normalizeTheme(record.theme),
    sessionRestore: record.sessionRestore === true,
    lastRoute: normalizeRoute(record.lastRoute)
  };
}

function persist(storage: PreferenceStorage, next: BootPreferences): void {
  try {
    storage.setItem(BOOT_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Hết chỗ lưu thì thôi: đây là tiện lợi, không phải dữ liệu nghiệp vụ.
  }
}

/** Ghi lại hai cài đặt hiển thị, GIỮ NGUYÊN trang đang nhớ. */
export function writeBootPreferences(
  storage: PreferenceStorage,
  input: { theme: GeneralSettingsDTO['theme']; sessionRestore: boolean }
): void {
  const current = readBootPreferences(storage);
  persist(storage, {
    theme: normalizeTheme(input.theme),
    sessionRestore: input.sessionRestore === true,
    lastRoute: current.lastRoute
  });
}

/** Nhớ trang đang xem. Đường dẫn không có trong app thì bỏ qua. */
export function rememberRoute(storage: PreferenceStorage, path: string): void {
  const route = normalizeRoute(path);
  if (!route) return;
  const current = readBootPreferences(storage);
  if (current.lastRoute === route) return;
  persist(storage, { ...current, lastRoute: route });
}

/**
 * Áp theme lên phần tử gốc. Tailwind cấu hình `darkMode: 'class'` nên toàn bộ
 * bảng màu bám vào class `dark` ở `<html>` (trước đây hard-code trong
 * `index.html`, tức là ô "Giao diện" ở Settings không điều khiển gì).
 */
export function applyTheme(theme: GeneralSettingsDTO['theme'], root: HTMLElement): void {
  if (normalizeTheme(theme) === 'light') {
    root.classList.remove('dark');
    return;
  }
  root.classList.add('dark');
}
