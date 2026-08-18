// Bake the sheep face onto the woolly head's north face.
// Modern Bedrock (1.21.30+) bakes the face at alpha=3 (subsurface-scattering
// material); our renderer can't show that, so we copy the full-color face from
// the sheared head region into the woolly head's north face with alpha=255.
// Sheared head: size(6,6,8) uv(0,0)  -> north face (8,8)-(14,14)
// Woolly head: size(6,6,6) uv(0,32) -> north face (6,38)-(12,44)
import { readFileSync, writeFileSync } from 'fs';
import zlib from 'zlib';
const { deflateSync, inflateSync } = zlib;

const PATH = 'assets/vanilla/textures/sheep.png';

function decodePng(path) {
  const data = readFileSync(path);
  let pos = 8;
  let idat = Buffer.alloc(0);
  let width = 0, height = 0, bitdepth = 0, colortype = 0;
  while (pos < data.length) {
    const ln = data.readUInt32BE(pos);
    const ctype = data.toString('ascii', pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + ln);
    if (ctype === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitdepth = chunk[8];
      colortype = chunk[9];
    } else if (ctype === 'IDAT') {
      idat = Buffer.concat([idat, chunk]);
    }
    pos += 12 + ln;
  }
  const channels = { 2: 3, 6: 4 }[colortype];
  const stride = width * channels;
  const raw = Buffer.from(inflateSync(idat));
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    if (f === 1) for (let i = channels; i < stride; i++) line[i] = (line[i] + line[i - channels]) & 0xFF;
    else if (f === 2) for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 0xFF;
    else if (f === 3) for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF;
    }
    else if (f === 4) for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      line[i] = (line[i] + pr) & 0xFF;
    }
    out.set(line, y * stride);
    prev = line;
  }
  return { width, height, channels, data: out };
}

function encodePng({ width, height, channels, data }) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: None
    const line = data.subarray(y * stride, (y + 1) * stride);
    line.copy(raw, p);
    p += stride;
  }
  const idat = deflateSync(raw);
  function chunk(type, payload) {
    const out = Buffer.alloc(12 + payload.length);
    out.writeUInt32BE(payload.length, 0);
    out.write(type, 4, 'ascii');
    payload.copy(out, 8);
    let crc = 0xFFFFFFFF;
    const t = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
    for (let i = 0; i < t.length; i++) {
      crc ^= t[i];
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    out.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 8 + payload.length);
    return out;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const img = decodePng(PATH);
const { width: W, channels: CH, data: D } = img;
const idx = (x, y) => (y * W + x) * CH;

const SRC = { x0: 8, y0: 8, x1: 14, y1: 14 };   // sheared head north face
const DST = { x0: 6, y0: 38, x1: 12, y1: 44 };  // woolly head north face

let copied = 0;
for (let y = 0; y < SRC.y1 - SRC.y0; y++) {
  for (let x = 0; x < SRC.x1 - SRC.x0; x++) {
    const s = idx(SRC.x0 + x, SRC.y0 + y);
    const d = idx(DST.x0 + x, DST.y0 + y);
    const r = D[s], g = D[s + 1], b = D[s + 2];
    if (r + g + b > 750) continue; // skip pure-white wool pixels
    D[d] = r; D[d + 1] = g; D[d + 2] = b;
    if (CH === 4) D[d + 3] = 255;
    copied++;
  }
}
console.log('face pixels baked:', copied);

const out = encodePng(img);
writeFileSync(PATH, out);
console.log('wrote', PATH, out.length, 'bytes');
