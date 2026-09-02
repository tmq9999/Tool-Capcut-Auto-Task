/**
 * =============================================================================
 * PREFS — TẮT DIALOG "SAVE PASSWORD" CỦA CHROME
 * =============================================================================
 * Dialog lưu mật khẩu là UI của BROWSER, nằm NGOÀI DOM (đã kiểm: đếm element
 * khớp "save password" trong DOM = 0), nên không click hay ẩn được bằng
 * Playwright. Nó che modal Upgrade và làm ảnh chụp khó đọc.
 *
 * CDP cũng không giúp: `Autofill.disable` trả về OK nhưng không ảnh hưởng bong
 * bóng lưu mật khẩu, còn `Browser.getBrowserCommandLine` bị chặn.
 *
 * Cách dùng được: sửa file `Preferences` của Chrome trong thư mục profile
 * Multilogin. Multilogin ghi file này khi tạo profile, nên phải sửa SAU khi
 * `startQuickProfile` xong và TRƯỚC khi trang đăng nhập được mở.
 *
 * Đường dẫn thật (đo được 2026-09-02):
 *   ~/mlx/profiles/<workspaceId>/<folderId>/<profileId>/Default/Preferences
 * =============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';

const MLX_PROFILES = path.join(process.env.USERPROFILE ?? '', 'mlx', 'profiles');

/** Tìm file Preferences của một profileId. Trả null nếu chưa được tạo. */
export function findPreferencesFile(profileId: string): string | null {
  if (!profileId || !fs.existsSync(MLX_PROFILES)) return null;

  // Cấu trúc: profiles/<workspaceId>/<folderId>/<profileId>/Default/Preferences
  for (const ws of safeDirs(MLX_PROFILES)) {
    for (const folder of safeDirs(path.join(MLX_PROFILES, ws))) {
      const p = path.join(MLX_PROFILES, ws, folder, profileId, 'Default', 'Preferences');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function safeDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Tắt dialog lưu mật khẩu + tự động điền.
 * Trả về true nếu đã ghi được file.
 *
 * QUAN TRỌNG — thời điểm: Chrome nạp `Preferences` vào bộ nhớ khi khởi động rồi
 * FLUSH LẠI lúc thoát, nên sửa file trong lúc browser đang chạy là vô ích
 * (đã kiểm 2026-09-02: ghi xong, đọc lại thấy `undefined`).
 *
 * Vì vậy hàm này ghi cho LẦN CHẠY SAU của cùng profileId. Với quick profile —
 * mỗi lượt một profile mới — cách đó không giúp gì, nên `startQuickProfile`
 * dùng thêm đường thứ hai: bơm sẵn Preferences vào thư mục profile TRƯỚC khi
 * browser mở, xem `seedPreferences`.
 */
export async function disablePasswordPrompt(profileId: string, waitMs = 8000): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  let file: string | null = null;
  while (Date.now() < deadline) {
    file = findPreferencesFile(profileId);
    if (file) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!file) return false;
  return writePrefs(file);
}

/** Các khoá tắt password manager + autofill của Chrome. */
function applyKeys(prefs: Record<string, unknown>): void {
  prefs.credentials_enable_service = false;
  prefs.credentials_enable_autosignin = false;

  const profile = (prefs.profile ?? {}) as Record<string, unknown>;
  profile.password_manager_enabled = false;
  prefs.profile = profile;

  const pm = (prefs.password_manager ?? {}) as Record<string, unknown>;
  pm.autofillable_credentials_account_store_login_database = false;
  pm.autofillable_credentials_profile_store_login_database = false;
  prefs.password_manager = pm;

  const autofill = (prefs.autofill ?? {}) as Record<string, unknown>;
  autofill.profile_enabled = false;
  autofill.credit_card_enabled = false;
  prefs.autofill = autofill;
}

function writePrefs(file: string): boolean {
  try {
    const prefs = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    applyKeys(prefs);
    fs.writeFileSync(file, JSON.stringify(prefs));
    return true;
  } catch {
    // Preferences đang bị Chrome giữ hoặc không parse được -> bỏ qua. Dialog chỉ
    // gây rối khi xem, không làm sai kết quả.
    return false;
  }
}

/**
 * Bơm sẵn `Preferences` vào thư mục profile TRƯỚC khi browser mở.
 *
 * Multilogin tạo thư mục profile khi `profile-quick` chạy, nhưng Chrome chỉ đọc
 * `Preferences` lúc khởi động. Gọi hàm này ngay sau khi xcli trả về profileId
 * và trước khi CDP sẵn sàng, ta chen được vào khoảng đó.
 *
 * Nếu file chưa tồn tại thì tạo mới với đúng các khoá cần thiết — Chrome chấp
 * nhận file thiếu khoá khác và tự bù.
 */
export async function seedPreferences(profileId: string, waitMs = 6000): Promise<boolean> {
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    const existing = findPreferencesFile(profileId);
    if (existing) return writePrefs(existing);

    // Thư mục profile có thể đã tạo mà chưa có Default/Preferences.
    const dir = findProfileDir(profileId);
    if (dir) {
      try {
        const def = path.join(dir, 'Default');
        fs.mkdirSync(def, { recursive: true });
        const prefs: Record<string, unknown> = {};
        applyKeys(prefs);
        fs.writeFileSync(path.join(def, 'Preferences'), JSON.stringify(prefs));
        return true;
      } catch {
        /* thử lại vòng sau */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Thư mục gốc của một profile (chưa cần có Default/Preferences). */
function findProfileDir(profileId: string): string | null {
  if (!profileId || !fs.existsSync(MLX_PROFILES)) return null;
  for (const ws of safeDirs(MLX_PROFILES)) {
    for (const folder of safeDirs(path.join(MLX_PROFILES, ws))) {
      const p = path.join(MLX_PROFILES, ws, folder, profileId);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
