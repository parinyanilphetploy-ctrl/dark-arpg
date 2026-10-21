// Generates the PWA / home-screen icons into public/icons/ (no image tools needed).
// Design: silver sword inside a blood-red rune ring on a dark radial background.
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../public/icons/", import.meta.url);
const SS = 3; // supersampling per axis for smooth edges

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v) => Math.max(0, Math.min(1, v));

/** Colour at normalised coords (0..1). Shapes are kept inside the maskable safe zone (r < 0.4). */
function shade(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  let c = mix([58, 10, 14], [11, 9, 7], clamp(r / 0.62));

  // Rune ring with soft glow
  const ringDist = Math.abs(r - 0.33);
  c = mix(c, [120, 16, 24], clamp(1 - ringDist / 0.07) * 0.45);
  if (ringDist < 0.016) c = mix(c, [230, 40, 52], 1);

  // Sword: blade, crossguard, grip, pommel
  const steel = [214, 208, 196];
  const blade = Math.abs(dx) < 0.032 - (y < 0.25 ? (0.25 - y) * 0.45 : 0) && y > 0.16 && y < 0.64;
  const fuller = Math.abs(dx) < 0.007 && y > 0.22 && y < 0.6;
  const guard = Math.abs(dx) < 0.15 && Math.abs(y - 0.655) < 0.018;
  const grip = Math.abs(dx) < 0.02 && y >= 0.67 && y < 0.79;
  const pommel = Math.hypot(dx, y - 0.815) < 0.033;
  if (blade) c = fuller ? [150, 146, 140] : steel;
  if (guard || pommel) c = [180, 150, 110];
  if (grip) c = [70, 20, 22];
  return c;
}

function render(size) {
  const px = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          acc = acc.map((v, i) => v + c[i]);
        }
      px.set(acc.map((v) => Math.round(v / (SS * SS))), (y * size + x) * 3);
    }
  }
  return encodePng(size, px);
}

// --- Minimal PNG encoder (RGB, 8-bit) ---------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  // Each scanline: filter byte 0 + pixels
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * size * 3, size * 3).copy(raw, y * (size * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
]) {
  writeFileSync(new URL(name, OUT), render(size));
  console.log(`wrote public/icons/${name}`);
}
