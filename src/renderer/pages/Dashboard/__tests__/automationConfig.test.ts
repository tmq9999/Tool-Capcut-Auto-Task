import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AUTOMATION_CONFIG,
  toRunConfig,
  toPersistedConfig,
  fromPersistedConfig,
  clampConfigNumber,
  type AutomationConfigState
} from '../automationConfig';

function state(overrides: Partial<AutomationConfigState> = {}): AutomationConfigState {
  return { ...DEFAULT_AUTOMATION_CONFIG, ...overrides };
}

it('preserves mail limit from Dashboard through saved settings and run IPC', () => {
  const config = state({ mailLimit: 3, emailSourceMode: 'api' });
  const saved = toPersistedConfig(config);
  expect(saved.mailLimit).toBe(3);
  const restored = fromPersistedConfig(saved);
  expect(restored.mailLimit).toBe(3);
  expect(toRunConfig(restored)).toMatchObject({ ok: true, config: { mailLimit: 3 } });
  expect(fromPersistedConfig({ ...saved, mailLimit: undefined }).mailLimit).toBe(0);
});

describe('clampConfigNumber', () => {
  /**
   * Audit 04/09/2026: ô `<Input type="number">` không có min/max và không kẹp giá
   * trị. Xoá trắng ô "Luồng" → `Number('') === 0` → `threadCount: 0` vi phạm
   * `.min(1)` của `AutomationConfigSettingsSchema` → autosave (bật mặc định) gửi
   * `settings.save` và nhận VALIDATION_ERROR ⇒ cấu hình lặng lẽ không được lưu,
   * kèm banner lỗi không nói ô nào sai.
   *
   * Kẹp ngay tại ô nhập là chỗ rẻ nhất: state của Dashboard không bao giờ mang
   * giá trị mà schema từ chối.
   */
  it('xoá trắng ô thì về mức tối thiểu, không phải 0', () => {
    expect(clampConfigNumber('', 1, 200, 10)).toBe(1);
    expect(clampConfigNumber('   ', 1, 200, 10)).toBe(1);
  });

  it('kẹp trên và kẹp dưới theo đúng giới hạn schema', () => {
    expect(clampConfigNumber('999', 1, 200, 10)).toBe(200);
    expect(clampConfigNumber('0', 1, 200, 10)).toBe(1);
    expect(clampConfigNumber('-5', 1, 200, 10)).toBe(1);
  });

  it('giá trị hợp lệ thì giữ nguyên', () => {
    expect(clampConfigNumber('25', 1, 200, 10)).toBe(25);
  });

  it('chữ không phải số thì lùi về giá trị đang dùng, không nhảy về 0', () => {
    expect(clampConfigNumber('abc', 1, 200, 42)).toBe(42);
  });

  it('số thập phân làm tròn xuống vì schema đòi số nguyên', () => {
    expect(clampConfigNumber('12.9', 1, 200, 10)).toBe(12);
  });

  it('mức tối thiểu 0 vẫn hợp lệ (các ô delay cho phép 0)', () => {
    expect(clampConfigNumber('', 0, 600_000, 500)).toBe(0);
    expect(clampConfigNumber('0', 0, 600_000, 500)).toBe(0);
  });
});

describe('DEFAULT_AUTOMATION_CONFIG', () => {
  it('starts on Multilogin in headed mode with a manual email source', () => {
    expect(DEFAULT_AUTOMATION_CONFIG.browser).toBe('multilogin');
    expect(DEFAULT_AUTOMATION_CONFIG.headless).toBe(false);
    expect(DEFAULT_AUTOMATION_CONFIG.emailSourceMode).toBe('manual');
    expect(DEFAULT_AUTOMATION_CONFIG.proxyMode).toBe('direct');
  });
});

describe('toRunConfig', () => {
  it('preserves manual textarea positions so validation reports original line numbers', () => {
    const result = toRunConfig(state({
      emailList: 'good@example.com|pw\n\nnot-an-email\nlast@example.com\n'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.emailSource).toEqual({
      mode: 'manual',
      entries: [
        'good@example.com|pw',
        '',
        'not-an-email',
        'last@example.com',
        ''
      ]
    });
  });

  it('maps an API run to the selected email provider without an OTP slug', () => {
    const result = toRunConfig(state({
      emailSourceMode: 'api',
      emailApiProvider: 'dongvanfb'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /**
     * Cố ý KHÔNG gửi `service`: slug do main process ghim
     * (`CAPCUT_OTP_SERVICE`). Nhờ vậy giá trị `facebook` sai còn nằm trong
     * `app_settings` của máy người dùng không thể theo vào lượt chạy.
     */
    expect(result.config.emailSource).toEqual({
      mode: 'api',
      provider: 'dongvanfb'
    });
  });

  it('maps proxy key mode without carrying the pasted direct list', () => {
    const result = toRunConfig(state({
      proxyMode: 'proxykey',
      proxyList: '1.1.1.1:8080',
      emailList: 'a@x.com|p'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({ mode: 'proxykey', keys: [] });
  });

  it('gửi đúng danh sách proxy key người dùng dán, mỗi dòng một key', () => {
    const result = toRunConfig(state({
      proxyMode: 'proxykey',
      proxyKeyList: ['K48fbd08e60494f24', '', '  K282b6e16df454dbe  ', ''].join('\n'),
      emailList: 'a@x.com|p'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({
      mode: 'proxykey',
      keys: ['K48fbd08e60494f24', 'K282b6e16df454dbe']
    });
  });

  it('để trống ô proxy key nghĩa là dùng toàn bộ key của tài khoản', () => {
    const result = toRunConfig(state({
      proxyMode: 'proxykey',
      proxyKeyList: ['   ', '  '].join('\n'),
      emailList: 'a@x.com|p'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({ mode: 'proxykey', keys: [] });
  });

  it('không gửi proxy key khi đang ở chế độ Direct IP', () => {
    const result = toRunConfig(state({
      proxyMode: 'direct',
      proxyKeyList: ['K1', 'K2'].join('\n'),
      proxyList: '1.1.1.1:8080',
      emailList: 'a@x.com|p'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({ mode: 'direct', entries: ['1.1.1.1:8080'] });
  });

  it('maps direct proxy mode by splitting the pasted list', () => {
    const result = toRunConfig(state({
      proxyMode: 'direct',
      proxyList: '1.1.1.1:8080:u:p\n2.2.2.2:8081',
      emailList: 'a@x.com|p'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({
      mode: 'direct',
      entries: ['1.1.1.1:8080:u:p', '2.2.2.2:8081']
    });
  });

  it('carries the password policy through', () => {
    const result = toRunConfig(state({
      emailList: 'a@x.com|p',
      passwordMode: 'random',
      passwordLength: 16,
      includeUppercase: true,
      includeNumbers: false,
      includeSpecial: true
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.password).toEqual({
      mode: 'random',
      length: 16,
      uppercase: true,
      numbers: false,
      special: true
    });
  });
});

describe('toRunConfig validation', () => {
  it('rejects a custom password with no value', () => {
    const result = toRunConfig(state({
      emailList: 'a@x.com|p',
      passwordMode: 'custom',
      customPassword: '   '
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('mật khẩu');
  });

  it('accepts a custom password once a value is entered', () => {
    const result = toRunConfig(state({
      emailList: 'a@x.com|p',
      passwordMode: 'custom',
      customPassword: 'Str0ng!Pass'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.password).toMatchObject({ mode: 'custom', value: 'Str0ng!Pass' });
  });

  it('rejects a thread count below one', () => {
    const result = toRunConfig(state({ threadCount: 0, emailList: 'a@x.com|p' }));

    expect(result.ok).toBe(false);
  });

  it('rejects a step delay range where min exceeds max', () => {
    const result = toRunConfig(state({
      emailList: 'a@x.com|p',
      stepDelayMinMs: 3000,
      stepDelayMaxMs: 1000
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Delay');
  });

  it('rejects a manual run whose email list is empty', () => {
    const result = toRunConfig(state({ emailList: '   \n  ' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('email');
  });

  it('rejects a run when custom domain email mode is selected because it is locked', () => {
    const result = toRunConfig(state({ emailSourceMode: 'custom' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('khóa');
  });

  it('always requests the ten second connectivity window', () => {
    const result = toRunConfig(state({ emailList: 'a@x.com|p' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.testDurationMs).toBe(10_000);
  });
});

describe('vùng proxy KiotProxy', () => {
  /**
   * KiotProxy cho chọn 4 vùng: `bac`, `trung`, `nam`, `random`.
   * `ProxyLeaseManager` đã đọc `region` khi xin proxy mới nhưng Dashboard chưa có
   * ô nào đặt giá trị (audit 04/09/2026) — nay có, và chỉ áp cho chế độ proxy key.
   */
  it('gửi vùng đã chọn xuống contract khi dùng proxy key', () => {
    const result = toRunConfig(state({
      emailList: 'a@x.com|p',
      proxyMode: 'proxykey',
      proxyKeyList: 'K1',
      proxyRegion: 'bac'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({ mode: 'proxykey', keys: ['K1'], region: 'bac' });
  });

  /**
   * `random` KHÔNG gửi khoá `region`: đó đúng là đường đang chạy được hôm nay (để
   * KiotProxy tự chọn), nên mặc định không đổi hành vi của một lượt chạy thật.
   */
  it('chọn "random" thì không gửi khoá region', () => {
    const result = toRunConfig(state({
      emailList: 'a@x.com|p',
      proxyMode: 'proxykey',
      proxyKeyList: 'K1',
      proxyRegion: 'random'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({ mode: 'proxykey', keys: ['K1'] });
  });

  /** Proxy dán tay `http://ip:port` không có vùng — không được gửi khoá đó. */
  it('proxy trực tiếp thì không mang vùng', () => {
    const result = toRunConfig(state({
      emailList: 'a@x.com|p',
      proxyMode: 'direct',
      proxyList: 'http://1.1.1.1:8080',
      proxyRegion: 'nam'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.proxy).toEqual({ mode: 'direct', entries: ['http://1.1.1.1:8080'] });
  });

  it('vùng được lưu và nạp lại như một nút điều chỉnh bình thường', () => {
    const restored = fromPersistedConfig(toPersistedConfig(state({ proxyRegion: 'trung' })));

    expect(restored.proxyRegion).toBe('trung');
  });
});

describe('bỏ qua account không có trial', () => {
  /**
   * `CapcutEngineService` đọc `skipWithoutTrial` nhưng không ai truyền nên nó luôn
   * `false` (audit 04/09/2026). Mặc định vẫn `false` — cổng trial fail-open, bỏ qua
   * âm thầm là mất account đã tốn tiền hộp thư.
   */
  it('mặc định là không bỏ qua', () => {
    expect(DEFAULT_AUTOMATION_CONFIG.skipWithoutTrial).toBe(false);
  });

  it('bật thì đi vào contract của lượt chạy', () => {
    const result = toRunConfig(state({ emailList: 'a@x.com|p', skipWithoutTrial: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.skipWithoutTrial).toBe(true);
  });

  it('lưu và nạp lại giữ đúng lựa chọn', () => {
    const restored = fromPersistedConfig(toPersistedConfig(state({ skipWithoutTrial: true })));

    expect(restored.skipWithoutTrial).toBe(true);
  });
});

describe('lưu và nạp lại cấu hình', () => {

  const edited = state({
    threadCount: 25,
    browser: 'gologin',
    headless: true,
    retryCount: 1,
    stepDelayMinMs: 100,
    stepDelayMaxMs: 900,
    typeDelayMinMs: 20,
    typeDelayMaxMs: 80,
    module: 'credit',
    proxyMode: 'proxykey',
    emailSourceMode: 'api',
    emailApiProvider: 'dongvanfb',
    passwordMode: 'custom',
    passwordLength: 20,
    includeUppercase: false,
    includeNumbers: false,
    includeSpecial: true,
    emailList: 'a@x.com|secret-pass',
    proxyList: '1.1.1.1:8080:user:secret',
    proxyKeyList: 'K-SECRET-PROXY-KEY',
    customPassword: 'Str0ng!Secret'
  });

  it('không bao giờ ghi email hoặc mật khẩu đã dán vào phần cấu hình được lưu, nhưng lưu proxy', () => {
    const persisted = toPersistedConfig(edited);
    const asJson = JSON.stringify(persisted);

    expect(asJson).not.toContain('secret-pass');
    expect(asJson).toContain('1.1.1.1:8080:user:secret');
    expect(asJson).not.toContain('Str0ng!Secret');
    expect(asJson).toContain('K-SECRET-PROXY-KEY');
    expect(Object.keys(persisted)).not.toContain('emailList');
    expect(Object.keys(persisted)).toContain('proxyList');
    expect(Object.keys(persisted)).toContain('proxyKeyList');
    expect(Object.keys(persisted)).not.toContain('customPassword');
  });

  it('giữ lại toàn bộ nút điều chỉnh và danh sách proxy', () => {
    expect(toPersistedConfig(edited)).toEqual({
      threadCount: 25,
      maxBillablePurchases: 0,
      browser: 'gologin',
      headless: true,
      retryCount: 1,
      stepDelayMinMs: 100,
      stepDelayMaxMs: 900,
      typeDelayMinMs: 20,
      typeDelayMaxMs: 80,
      module: 'credit',
      skipWithoutTrial: false,
      proxyMode: 'proxykey',
      proxyRegion: 'random',
      proxyList: '1.1.1.1:8080:user:secret',
      proxyKeyList: 'K-SECRET-PROXY-KEY',
      emailSourceMode: 'api',
      emailApiProvider: 'dongvanfb',
      emailRetryIntervalSeconds: 15,
      otpService: 'capcut',
      passwordMode: 'custom',
      passwordLength: 20,
      includeUppercase: false,
      includeNumbers: false,
      includeSpecial: true
    });
  });

  /**
   * Giá trị `otpService` sai (`facebook`) đã nằm trong `app_settings` của máy
   * đang dùng. Không màn hình nào sửa được nó, nên lần LƯU kế tiếp phải tự ghi
   * đè bằng slug đã ghim — nếu không, lượt chạy API vẫn thuê hộp sai dịch vụ.
   */
  it('ghi đè slug OTP cũ bằng capcut ở lần lưu kế tiếp', () => {
    const legacyRow = { ...toPersistedConfig(edited), otpService: 'facebook' };

    const resaved = toPersistedConfig(fromPersistedConfig(legacyRow));

    expect(resaved.otpService).toBe('capcut');
  });

  it('nạp lại đúng những gì đã lưu bao gồm proxy và để trống email/mật khẩu', () => {
    const restored = fromPersistedConfig(toPersistedConfig(edited));

    expect(restored.threadCount).toBe(25);
    expect(restored.proxyMode).toBe('proxykey');
    expect(restored.emailApiProvider).toBe('dongvanfb');
    expect(restored.passwordMode).toBe('custom');
    expect(restored.emailList).toBe('');
    expect(restored.proxyList).toBe('1.1.1.1:8080:user:secret');
    expect(restored.proxyKeyList).toBe('K-SECRET-PROXY-KEY');
    expect(restored.customPassword).toBe('');
  });

  it('giữ nguyên nội dung đang gõ khi nạp lại cấu hình', () => {
    const typing = state({
      emailList: 'b@x.com|p',
      proxyList: '2.2.2.2:1',
      proxyKeyList: 'K-TYPED',
      customPassword: 'Typed1!'
    });

    const restored = fromPersistedConfig(toPersistedConfig(edited), typing);

    expect(restored.threadCount).toBe(25);
    expect(restored.emailList).toBe('b@x.com|p');
    expect(restored.proxyList).toBe('2.2.2.2:1');
    expect(restored.proxyKeyList).toBe('K-TYPED');
    expect(restored.customPassword).toBe('Typed1!');
  });

  it('cấu hình mặc định đi qua vòng lưu - nạp mà không đổi', () => {
    const restored = fromPersistedConfig(toPersistedConfig(DEFAULT_AUTOMATION_CONFIG));
    expect(restored).toEqual(DEFAULT_AUTOMATION_CONFIG);
  });
});
