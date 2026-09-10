/**
 * =============================================================================
 * PROXY TRỰC TIẾP — ĐỌC ĐỦ ĐỊNH DẠNG, VÀ KHÔNG BAO GIỜ BỎ DÒNG IM LẶNG
 * =============================================================================
 * Audit 04/09/2026 tìm ra hậu quả nặng nhất trong cả bản kiểm:
 *
 *   `parseDirectProxy` chỉ `split(':')` và ghim `type: 'http'`, nên
 *   `socks5://1.2.3.4:8080` ra `host='socks5'`, `port=NaN` → trả `null`.
 *   `buildThreadPlans` dùng `flatMap` LOẠI dòng đó KHÔNG LOG GÌ, rồi gán proxy
 *   theo index. Dán 5 dòng mà 2 dòng có scheme → 3 luồng có proxy, **2 luồng
 *   chạy bằng IP thật của máy**, không một dòng cảnh báo nào.
 *
 * Với công việc này, chạy lộ IP thật còn tệ hơn là không chạy. Nên luật ở đây:
 * đọc được mọi định dạng người dùng thật sự dùng, và dòng nào không đọc được thì
 * TỪ CHỐI CẢ LƯỢT CHẠY chứ không chạy tiếp với ít proxy hơn.
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { parseDirectProxy } from '../AutomationRunService';

describe('parseDirectProxy — định dạng không có scheme', () => {
  it('ip:port mặc định là http', () => {
    expect(parseDirectProxy('1.2.3.4:8080')).toEqual({ host: '1.2.3.4', port: 8080, type: 'http' });
  });

  it('ip:port:user:pass giữ nguyên thông tin xác thực', () => {
    expect(parseDirectProxy('1.2.3.4:8080:bob:s3cret')).toEqual({
      host: '1.2.3.4', port: 8080, type: 'http', username: 'bob', password: 's3cret'
    });
  });
});

describe('parseDirectProxy — có scheme', () => {
  it('socks5:// đọc ra type socks5, KHÔNG ép về http', () => {
    expect(parseDirectProxy('socks5://1.2.3.4:1080')).toEqual({
      host: '1.2.3.4', port: 1080, type: 'socks5'
    });
  });

  it('socks5:// kèm user:pass', () => {
    expect(parseDirectProxy('socks5://1.2.3.4:1080:bob:s3cret')).toEqual({
      host: '1.2.3.4', port: 1080, type: 'socks5', username: 'bob', password: 's3cret'
    });
  });

  it('http:// và https:// và socks4://', () => {
    expect(parseDirectProxy('http://1.2.3.4:8080')?.type).toBe('http');
    expect(parseDirectProxy('https://1.2.3.4:8443')?.type).toBe('https');
    expect(parseDirectProxy('socks4://1.2.3.4:1080')?.type).toBe('socks4');
  });

  it('không phân biệt hoa thường và bỏ khoảng trắng hai đầu', () => {
    expect(parseDirectProxy('  SOCKS5://1.2.3.4:1080  ')?.type).toBe('socks5');
  });

  it('tên miền cũng dùng được, không chỉ IP', () => {
    expect(parseDirectProxy('socks5://proxy.example.com:1080')?.host).toBe('proxy.example.com');
  });

  it('hỗ trợ định dạng chuẩn URL user:pass@host:port (HTTP và SOCKS5)', () => {
    expect(parseDirectProxy('http://bob:s3cret@1.2.3.4:8080')).toEqual({
      host: '1.2.3.4', port: 8080, type: 'http', username: 'bob', password: 's3cret'
    });
    expect(parseDirectProxy('socks5://alice:p@ssword@proxy.domain.com:1080')).toEqual({
      host: 'proxy.domain.com', port: 1080, type: 'socks5', username: 'alice', password: 'p@ssword'
    });
  });

  it('hỗ trợ user:pass@host:port không có scheme (mặc định http)', () => {
    expect(parseDirectProxy('bob:s3cret@1.2.3.4:8080')).toEqual({
      host: '1.2.3.4', port: 8080, type: 'http', username: 'bob', password: 's3cret'
    });
  });
});

describe('parseDirectProxy — dòng hỏng', () => {
  it('scheme lạ thì trả null chứ không đoán', () => {
    expect(parseDirectProxy('ftp://1.2.3.4:21')).toBeNull();
  });

  it('thiếu port, port không phải số, hoặc ngoài dải đều là null', () => {
    expect(parseDirectProxy('1.2.3.4')).toBeNull();
    expect(parseDirectProxy('1.2.3.4:abc')).toBeNull();
    expect(parseDirectProxy('1.2.3.4:0')).toBeNull();
    expect(parseDirectProxy('1.2.3.4:70000')).toBeNull();
  });

  it('chuỗi rỗng là null', () => {
    expect(parseDirectProxy('   ')).toBeNull();
  });

  it('có user mà thiếu pass vẫn nhận — nhiều nhà cung cấp cho phép', () => {
    expect(parseDirectProxy('1.2.3.4:8080:bob')).toEqual({
      host: '1.2.3.4', port: 8080, type: 'http', username: 'bob'
    });
  });
});

describe('parseDirectProxy — password chứa dấu hai chấm (colon) và chuẩn hóa', () => {
  it('ip:port:user:pass giữ nguyên password chứa colon', () => {
    expect(parseDirectProxy('192.0.2.1:8080:demo:a:b')).toMatchObject({
      host: '192.0.2.1',
      port: 8080,
      username: 'demo',
      password: 'a:b',
    });
  });

  it('user:pass@host:port giữ nguyên password chứa colon', () => {
    expect(parseDirectProxy('http://demo:a:b@192.0.2.1:8080')).toMatchObject({
      host: '192.0.2.1',
      port: 8080,
      username: 'demo',
      password: 'a:b',
    });
  });

  it('chuẩn hóa host và scheme về lowercase', () => {
    expect(parseDirectProxy('HTTP://MY-HOST.COM:8080')).toEqual({
      host: 'my-host.com',
      port: 8080,
      type: 'http',
    });
  });
});
