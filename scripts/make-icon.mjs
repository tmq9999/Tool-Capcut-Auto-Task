/**
 * =============================================================================
 * SINH build/icon.ico — không dùng thư viện ngoài
 * =============================================================================
 * electron-builder cảnh báo `default Electron icon is used` nếu thiếu file này.
 * ICO chỉ là một container: header + bảng entry + dữ liệu ảnh; Windows 10/11 đọc
 * được PNG nhúng ở mọi kích cỡ, nên mỗi entry là một PNG RGBA.
 *
 * Vẽ ở 4× rồi thu nhỏ (supersampling) để cạnh cong không bị răng cưa — ở 16px
 * thì đó là khác biệt giữa "nhận ra được" và "một cục màu".
 *
 * CHẠY: node scripts/make-icon.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** RGBA (color type 6) → PNG. */
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter none
    rgba.copy(raw, o, y * size * 4, (y + 1) * size * 4);
    o += size * 4;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Bảng màu: nền xanh đen của theme tối, dấu hiệu màu cyan của app.
const BG_TOP = [15, 23, 42];      // slate-900
const BG_BOTTOM = [23, 37, 64];
const MARK = [34, 211, 238];      // cyan-400
const MARK_DIM = [125, 211, 252]; // sky-300

/**
 * Vẽ một khung ở độ phân giải `S` (đã nhân 4), trả về RGBA.
 *
 * Hình: bo góc vuông + ba cột tăng dần (tiến độ tự động hoá) + một dấu chấm
 * ở cột cao nhất. Ba cột đọc được cả ở 16px, chữ thì không — nên không dùng chữ.
 */
function drawMark(S) {
  const px = Buffer.alloc(S * S * 4);
  const radius = S * 0.22;
  const inside = (x, y) => {
    // Bo góc: khoảng cách tới hình chữ nhật co lại.
    const cx = Math.min(Math.max(x, radius), S - radius);
    const cy = Math.min(Math.max(y, radius), S - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };

  const bars = [
    { x: 0.24, h: 0.28, c: MARK_DIM },
    { x: 0.44, h: 0.40, c: MARK },
    { x: 0.64, h: 0.52, c: MARK }
  ];
  const barW = 0.12;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!inside(x + 0.5, y + 0.5)) continue;

      const t = y / S;
      px[i] = Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t);
      px[i + 1] = Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t);
      px[i + 2] = Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t);
      px[i + 3] = 255;

      const u = x / S;
      const v = y / S;
      for (const b of bars) {
        const top = 0.78 - b.h;
        if (u >= b.x && u <= b.x + barW && v >= top && v <= 0.78) {
          px[i] = b.c[0];
          px[i + 1] = b.c[1];
          px[i + 2] = b.c[2];
        }
      }
      /**
       * Chấm "đang chạy", tách RỜI khỏi cột cao nhất. Bản đầu đặt nó ở
       * (0.70, 0.10) nên nó dính vào đỉnh cột và trông như lỗi vẽ.
       */
      const dx = u - 0.70;
      const dy = v - 0.145;
      if (dx * dx + dy * dy <= 0.0052) {
        px[i] = MARK[0];
        px[i + 1] = MARK[1];
        px[i + 2] = MARK[2];
      }
    }
  }
  return px;
}

/** Thu nhỏ 4× bằng trung bình 16 điểm — đây là chỗ khử răng cưa. */
function downscale(src, S, size) {
  const f = S / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < f; sy++) {
        for (let sx = 0; sx < f; sx++) {
          const i = ((y * f + sy) * S + (x * f + sx)) * 4;
          const al = src[i + 3];
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / (f * f));
    }
  }
  return out;
}

const SIZES = [16, 32, 48, 64, 128, 256];
const pngs = SIZES.map((size) => {
  const S = size * 4;
  return { size, data: encodePng(size, downscale(drawMark(S), S, size)) };
});

// ICONDIR + ICONDIRENTRY × N + dữ liệu
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);            // type 1 = icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + pngs.length * 16;
const entries = [];
for (const { size, data } of pngs) {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;       // 0 nghĩa là 256
  e[1] = size >= 256 ? 0 : size;
  e[2] = 0;                             // số màu trong palette
  e[3] = 0;
  e.writeUInt16LE(1, 4);                // planes
  e.writeUInt16LE(32, 6);               // bit depth
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += data.length;
}

const out = path.resolve('build/icon.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));

console.log('đã ghi', out, '—', fs.statSync(out).size, 'byte,', pngs.length, 'kích cỡ:', SIZES.join('/'));
// Ghi kèm bản PNG 256 để soi mắt thường.
fs.writeFileSync(path.resolve('build/icon-preview.png'), pngs.find((p) => p.size === 256).data);
console.log('bản xem trước: build/icon-preview.png');
