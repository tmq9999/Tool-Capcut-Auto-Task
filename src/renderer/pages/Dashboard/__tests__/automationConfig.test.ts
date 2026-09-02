import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AUTOMATION_CONFIG,
  toRunConfig,
  toPersistedConfig,
  fromPersistedConfig,
  type AutomationConfigState
} from '../automationConfig';

function state(overrides: Partial<AutomationConfigState> = {}): AutomationConfigState {
  return { ...DEFAULT_AUTOMATION_CONFIG, ...overrides };
}

describe('DEFAULT_AUTOMATION_CONFIG', () => {
  it('starts on Multilogin in headed mode with a manual email source', () => {
    expect(DEFAULT_AUTOMATION_CONFIG.browser).toBe('multilogin');
    expect(DEFAULT_AUTOMATION_CONFIG.headless).toBe(false);
    expect(DEFAULT_AUTOMATION_CONFIG.emailSourceMode).toBe('manual');
    expect(DEFAULT_AUTOMATION_CONFIG.proxyMode).toBe('direct');
  });
});

describe('toRunConfig', () => {
  it('maps a manual run and splits the pasted email list by line', () => {
    const result = toRunConfig(state({ emailList: 'a@x.com|p1\n\nb@x.com|p2\n' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.emailSource).toEqual({
      mode: 'manual',
      entries: ['a@x.com|p1', 'b@x.com|p2']
    });
  });

  it('maps an API run to the selected email provider', () => {
    const result = toRunConfig(state({
      emailSourceMode: 'api',
      emailApiProvider: 'dongvanfb',
      otpService: 'facebook'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.emailSource).toEqual({
      mode: 'api',
      provider: 'dongvanfb',
      service: 'facebook'
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

  it('always requests the ten second connectivity window', () => {
    const result = toRunConfig(state({ emailList: 'a@x.com|p' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.testDurationMs).toBe(10_000);
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
    otpService: 'capcut',
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

  it('không bao giờ ghi secret vào phần cấu hình được lưu', () => {
    const persisted = toPersistedConfig(edited);
    const asJson = JSON.stringify(persisted);

    expect(asJson).not.toContain('secret-pass');
    expect(asJson).not.toContain('1.1.1.1');
    expect(asJson).not.toContain('Str0ng!Secret');
    expect(asJson).not.toContain('K-SECRET-PROXY-KEY');
    expect(Object.keys(persisted)).not.toContain('emailList');
    expect(Object.keys(persisted)).not.toContain('proxyList');
    expect(Object.keys(persisted)).not.toContain('proxyKeyList');
    expect(Object.keys(persisted)).not.toContain('customPassword');
  });

  it('giữ lại toàn bộ nút điều chỉnh không phải secret', () => {
    expect(toPersistedConfig(edited)).toEqual({
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
      otpService: 'capcut',
      passwordMode: 'custom',
      passwordLength: 20,
      includeUppercase: false,
      includeNumbers: false,
      includeSpecial: true
    });
  });

  it('nạp lại đúng những gì đã lưu và để trống các ô secret', () => {
    const restored = fromPersistedConfig(toPersistedConfig(edited));

    expect(restored.threadCount).toBe(25);
    expect(restored.proxyMode).toBe('proxykey');
    expect(restored.emailApiProvider).toBe('dongvanfb');
    expect(restored.passwordMode).toBe('custom');
    expect(restored.emailList).toBe('');
    expect(restored.proxyList).toBe('');
    expect(restored.proxyKeyList).toBe('');
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
