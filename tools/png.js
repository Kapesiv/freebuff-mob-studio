/**
 * Minimal PNG decode/encode for Node (RGBA, 8-bit). Used by the vanilla
 * fetch/convert tooling. Ported from tools/decode_png.py (Python).
 */
import { readFileSync } from 'fs';
import zlib from 'zlib';
const { deflateSync, inflateSync } = zlib;

export function decodePng(pathOrBuffer) {
  const data = Buffer.isBuffer(pathOrBuffer) ? pathOrBuffer : readFileSync(pathOrBuffer);
  let pos = 8;
  let idat = Buffer.alloc(0);
  let width = 0, height = 0, channels = 0;
  while (pos < data.length) {
    const ln = data.readUInt32BE(pos);
    const ctype = data.toString('ascii', pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + ln);
    if (ctype === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      channels = { 2: 3, 6: 4 }[chunk[9]];
    } else if (ctype === 'IDAT') {
      idat = Buffer.concat([idat, chunk]);
    }
    pos += 12 + ln;
  }
  if (!channels) throw new Error('Unsupported PNG color type');
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
    } else if (f === 4) for (let i = 0; i < stride; i++) {
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

export function encodePng({ width, height, channels, data }) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
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
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
