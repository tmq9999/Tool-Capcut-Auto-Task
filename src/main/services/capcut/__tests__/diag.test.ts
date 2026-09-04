/**
 * =============================================================================
 * DUMP KHÔNG ĐƯỢC LỚN VÔ HẠN — VÀ VIỆC DỌN KHÔNG ĐƯỢC LÀM HỎNG VIỆC GHI
 * =============================================================================
 * `docs/MERGE-PLAN.md` yêu cầu hai lần (Pha 1 và bảng rủi ro): `dump()` ghi vào
 * `app.getPath('userData')/debug` và **giữ tối đa N dump**. Chỗ ghi đã đúng
 * (`setDumpDir`), phần giới hạn thì chưa bao giờ có — mỗi lỗi thêm một cặp
 * `NNN_label.png` + `NNN_label.html` và không ai xoá. Riêng ngày 04/09/2026 đã
 * sinh đủ dump để cắt ra 5 fixture, mà thư mục đó nằm trong `userData` của
 * người dùng.
 *
 * Luật thứ hai quan trọng không kém: DUMP LÀ ĐỂ ĐIỀU TRA SỰ CỐ, NÓ KHÔNG ĐƯỢC
 * TỰ GÂY SỰ CỐ. Dọn dẹp thất bại (file bị Explorer/antivirus giữ, quyền ghi bị
 * chặn) thì hiện trường của lần lỗi HIỆN TẠI vẫn phải được ghi ra.
 * =============================================================================
 */

import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';

import { dump, getDumpDir, MAX_DUMPS, pruneDumps, setDumpDir } from '../diag';

/** Thư mục dump riêng cho từng test — không đụng `.debug` của repo. */
function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcut-dump-'));
  setDumpDir(dir);
  return dir;
}

/** Tạo sẵn một cặp dump (png + html) như `dump()` thật vẫn ghi. */
function seedDump(dir: string, name: string): void {
  fs.writeFileSync(path.join(dir, name + '.png'), 'png');
  fs.writeFileSync(path.join(dir, name + '.html'), '<html></html>');
}

/** Số dump theo CẶP file, không phải theo file. */
function dumpNames(dir: string): string[] {
  return [...new Set(
    fs.readdirSync(dir)
      .filter((f) => /\.(png|html)$/i.test(f))
      .map((f) => f.replace(/\.(png|html)$/i, ''))
  )].sort();
}

/** Trang giả: `dump()` chỉ cần đúng hai method này. */
const fakePage = {
  screenshot: async ({ path: p }: { path: string }): Promise<void> => {
    fs.writeFileSync(p, 'png');
  },
  content: async (): Promise<string> => '<html></html>'
} as unknown as Page;

let dir: string;

beforeEach(() => {
  dir = freshDir();
});

describe('pruneDumps', () => {
  it('giữ đúng N dump mới nhất và xoá cũ nhất trước', () => {
    for (let i = 1; i <= 8; i++) seedDump(dir, String(i).padStart(3, '0') + '_loi');

    pruneDumps(dir, 3);

    expect(dumpNames(dir)).toEqual(['006_loi', '007_loi', '008_loi']);
  });

  it('đếm theo DUMP chứ không theo file: png + html của cùng lần là MỘT dump', () => {
    for (let i = 1; i <= 4; i++) seedDump(dir, String(i).padStart(3, '0') + '_loi');

    pruneDumps(dir, 4);

    expect(dumpNames(dir)).toHaveLength(4);
    expect(fs.readdirSync(dir)).toHaveLength(8);
  });

  it('xoá cả hai nửa của dump bị loại, không để lại png mồ côi', () => {
    seedDump(dir, '001_cu');
    seedDump(dir, '002_moi');

    pruneDumps(dir, 1);

    expect(fs.readdirSync(dir).sort()).toEqual(['002_moi.html', '002_moi.png']);
  });

  it('KHÔNG chạm vào file không phải dump', () => {
    seedDump(dir, '001_loi');
    seedDump(dir, '002_loi');
    fs.writeFileSync(path.join(dir, 'ghi-chu.txt'), 'của người dùng');

    pruneDumps(dir, 1);

    expect(fs.readdirSync(dir)).toContain('ghi-chu.txt');
  });

  it('thư mục không tồn tại thì im lặng, không ném', () => {
    expect(() => pruneDumps(path.join(dir, 'khong-co'), 5)).not.toThrow();
  });

  it('MAX_DUMPS là một trần hữu hạn', () => {
    expect(MAX_DUMPS).toBe(50);
  });
});

describe('dump — tự giữ trần sau khi ghi', () => {
  it('ghi 60 lần thì còn tối đa MAX_DUMPS dump', async () => {
    for (let i = 0; i < 60; i++) {
      expect(await dump(fakePage, 'loi_lien_tuc')).not.toBeNull();
    }

    expect(dumpNames(dir).length).toBeLessThanOrEqual(MAX_DUMPS);
  });

  it('dump VỪA GHI luôn còn lại — không tự xoá hiện trường mới nhất', async () => {
    for (let i = 0; i < 55; i++) await dump(fakePage, 'cu');
    const name = await dump(fakePage, 'moi_nhat');

    expect(name).not.toBeNull();
    expect(fs.existsSync(path.join(dir, name + '.html'))).toBe(true);
  });

  it('dọn lỗi KHÔNG được làm hỏng việc ghi dump', async () => {
    /**
     * Một "dump" cũ mà `unlinkSync` không xoá được: xoá thư mục bằng unlink ném
     * trên cả Windows lẫn POSIX. Đây là bản mô phỏng của file đang bị giữ hoặc
     * bị chặn quyền — nguyên nhân thật khiến dọn dẹp thất bại.
     */
    fs.mkdirSync(path.join(dir, '001_khong_xoa_duoc.html'));
    fs.writeFileSync(path.join(dir, '001_khong_xoa_duoc.png'), 'png');
    for (let i = 2; i <= 55; i++) seedDump(dir, String(i).padStart(3, '0') + '_cu');

    const name = await dump(fakePage, 'phai_ghi_duoc');

    expect(name).not.toBeNull();
    expect(fs.existsSync(path.join(dir, name + '.html'))).toBe(true);
  });
});

describe('getDumpDir', () => {
  it('trả về đúng thư mục đã đặt', () => {
    expect(getDumpDir()).toBe(dir);
  });
});
