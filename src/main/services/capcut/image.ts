/**
 * Tạo ảnh PNG THẬT (không phải 1x1 pixel) để dùng cho các nhiệm vụ upload.
 * CapCut từ chối ảnh quá nhỏ / trống, nên cần ảnh đủ lớn và có nội dung.
 *
 * Tự sinh bằng zlib + CRC32 thuần, không cần thư viện ngoài.
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// Bảng CRC32 cho chunk PNG
const CRC_TABLE = (function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Sinh ảnh PNG RGB có nội dung (gradient + khối màu) để trông như ảnh sản phẩm.
 * @param w chiều rộng
 * @param h chiều cao
 */
export function generatePng(w = 1024, h = 1024): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;

  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.28;

  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter type: none
    for (let x = 0; x < w; x++) {
      // Nền gradient chéo
      let R = Math.floor((x / w) * 120) + 30;
      let G = Math.floor((y / h) * 110) + 40;
      let B = 180 - Math.floor(((x + y) / (w + h)) * 90);

      // Khối hình tròn sáng ở giữa (mô phỏng "sản phẩm")
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r * r) {
        R = 240;
        G = 236;
        B = 228;
      }
      // Sọc ngang tạo chi tiết
      if (y % 64 < 3) {
        R = Math.min(255, R + 40);
        G = Math.min(255, G + 40);
        B = Math.min(255, B + 40);
      }

      raw[o++] = R;
      raw[o++] = G;
      raw[o++] = B;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Tạo (nếu chưa có) file ảnh mẫu và trả về đường dẫn tuyệt đối
 *
 * `dir` do NGƯỜI GỌI truyền, engine không đoán cwd: bản CLI ghi vào cwd được,
 * còn app đóng gói thì KHÔNG — main process phải đưa một thư mục ghi được
 * (`app.getPath('userData')`). `log` được inject vì mọi dòng phải đi qua
 * `LogBus`, không dùng `console.log` (AGENTS.md §16).
 */
export function ensureSampleImage(
  dir: string,
  fileName = 'sample_product.png',
  log: (m: string) => void = () => {}
): string {
  const p = path.resolve(dir, fileName);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p) || fs.statSync(p).size < 5000) {
    fs.writeFileSync(p, generatePng(1024, 1024));
    log(`   🖼️  Đã tạo ảnh mẫu ${fileName} (${fs.statSync(p).size} bytes)`);
  }
  return p;
}
