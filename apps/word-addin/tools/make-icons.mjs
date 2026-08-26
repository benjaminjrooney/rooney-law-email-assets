/**
 * Generate the ribbon icons.
 *
 * Word needs PNGs at several sizes and the add-in has no build pipeline, so the
 * envelope glyph is drawn arithmetically and encoded with a small PNG writer
 * (zlib is in Node's standard library). Run with `npm run icons`.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 80, 128];

// Firm burgundy, matching the task pane accent.
const INK = [0x7a, 0x1f, 0x2b];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {Uint8Array} rgba raw RGBA pixels, row-major */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Coverage of a stroked line segment at a point, for cheap anti-aliasing. */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Draw an envelope: a rounded rectangle outline with the flap creased in. */
function drawEnvelope(size) {
  const pixels = new Uint8Array(size * size * 4);
  const stroke = Math.max(1, size * 0.075);
  const half = stroke / 2;

  const left = size * 0.11;
  const right = size * 0.89;
  const top = size * 0.235;
  const bottom = size * 0.765;
  const flapY = top + (bottom - top) * 0.52;

  const edges = [
    [left, top, right, top],
    [right, top, right, bottom],
    [right, bottom, left, bottom],
    [left, bottom, left, top],
    [left, top, (left + right) / 2, flapY],
    [(left + right) / 2, flapY, right, top],
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let nearest = Infinity;
      for (const [x1, y1, x2, y2] of edges) {
        nearest = Math.min(nearest, distanceToSegment(px, py, x1, y1, x2, y2));
      }
      // 1px feather from the stroke edge outward.
      const coverage = Math.max(0, Math.min(1, half + 0.5 - nearest));
      const offset = (y * size + x) * 4;
      pixels[offset] = INK[0];
      pixels[offset + 1] = INK[1];
      pixels[offset + 2] = INK[2];
      pixels[offset + 3] = Math.round(coverage * 255);
    }
  }
  return pixels;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, size, drawEnvelope(size));
  writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), png);
  process.stdout.write(`wrote icon-${size}.png (${png.length} bytes)\n`);
}
