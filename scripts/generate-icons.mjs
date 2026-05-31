/**
 * Generate CareFlow PWA app icons with zero dependencies.
 *
 * Encodes valid PNGs by hand (raw RGBA → zlib deflate → PNG chunks with CRC32)
 * so the repo needs no binary image tooling. Draws a calm slate-900 rounded
 * square with a slate-50 medical "+" — matching the app's theme tokens.
 *
 * Run once after changing the design:  node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/icons");

// Theme colors (resolved from app/globals.css slate palette).
const SLATE_900 = [15, 23, 42, 255]; // --primary / --foreground
const SLATE_50 = [248, 250, 252, 255]; // --primary-foreground
const TRANSPARENT = [0, 0, 0, 0];

// --- PNG encoding ----------------------------------------------------------

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
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]); // CRC covers type+data
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10-12: compression / filter / interlace = 0

  // Prefix each scanline with filter byte 0.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.subarray(y * stride, y * stride + stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Drawing ---------------------------------------------------------------

function makeCanvas(size) {
  const rgba = Buffer.alloc(size * size * 4);
  return {
    size,
    rgba,
    set(x, y, [r, g, b, a]) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    },
  };
}

/** Fill a rounded square; radius 0 → full square (used for maskable). */
function fill(canvas, color, radius) {
  const { size } = canvas;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (radius > 0) {
        const cx = Math.min(x, size - 1 - x);
        const cy = Math.min(y, size - 1 - y);
        if (cx < radius && cy < radius) {
          const dx = radius - cx;
          const dy = radius - cy;
          inside = dx * dx + dy * dy <= radius * radius;
        }
      }
      canvas.set(x, y, inside ? color : TRANSPARENT);
    }
  }
}

/** Draw a centered medical cross occupying `scale` of the canvas. */
function drawCross(canvas, color, scale) {
  const { size } = canvas;
  const arm = Math.round(size * scale); // total length of the cross
  const thick = Math.round(arm * 0.32); // bar thickness
  const c = size / 2;
  const half = arm / 2;
  const ht = thick / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inV = Math.abs(x - c) <= ht && Math.abs(y - c) <= half;
      const inH = Math.abs(y - c) <= ht && Math.abs(x - c) <= half;
      if (inV || inH) canvas.set(x, y, color);
    }
  }
}

function buildIcon(size, { maskable = false } = {}) {
  const canvas = makeCanvas(size);
  fill(canvas, SLATE_900, maskable ? 0 : Math.round(size * 0.22));
  // Maskable icons keep the glyph inside the ~80% safe zone.
  drawCross(canvas, SLATE_50, maskable ? 0.42 : 0.52);
  return encodePng(size, size, canvas.rgba);
}

// --- SVG source (handy reference / favicon) --------------------------------

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0f172a"/>
  <path d="M213 96h86v117h117v86H299v117h-86V299H96v-86h117z" fill="#f8fafc"/>
</svg>
`;

// --- Emit ------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: "icon-192.png", png: buildIcon(192) },
  { name: "icon-512.png", png: buildIcon(512) },
  { name: "icon-maskable-512.png", png: buildIcon(512, { maskable: true }) },
  { name: "apple-touch-icon-180.png", png: buildIcon(180, { maskable: true }) },
];

for (const { name, png } of targets) {
  writeFileSync(resolve(OUT_DIR, name), png);
  console.log(`wrote public/icons/${name} (${png.length} bytes)`);
}
writeFileSync(resolve(OUT_DIR, "icon.svg"), SVG);
console.log("wrote public/icons/icon.svg");
