/**
 * Minimal TGA decoder (RGBA output). Supports type 2 (uncompressed) and
 * type 10 (RLE), 24/32-bit, bottom-up and top-down. No color maps, no
 * interlacing. Returns { width, height, channels, data } like decode_png.
 */
export function decodeTga(buf) {
  const idLen = buf[0];
  const cmapType = buf[1];
  const type = buf[2];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const bpp = buf[16];
  const desc = buf[17];
  const topDown = (desc & 0x20) !== 0;
  const channels = bpp === 32 ? 4 : bpp === 24 ? 3 : null;
  if (!channels) throw new Error('Unsupported TGA bpp: ' + bpp);
  if (cmapType !== 0 && cmapType !== 1) throw new Error('Unsupported TGA color map: ' + cmapType);

  let off = 18 + idLen;
  if (cmapType === 1) {
    const cmapEntries = buf.readUInt16LE(5);
    const cmapBits = buf[7];
    off += cmapEntries * Math.ceil(cmapBits / 8);
  }

  const total = width * height * channels;
  const bgra = Buffer.alloc(total);
  if (type === 2) {
    buf.copy(bgra, 0, off, off + total);
  } else if (type === 10) {
    let p = 0;
    while (p < total) {
      const packet = buf[off++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        const px = buf.subarray(off, off + channels);
        off += channels;
        for (let i = 0; i < count; i++) {
          px.copy(bgra, p);
          p += channels;
        }
      } else {
        const n = count * channels;
        buf.copy(bgra, p, off, off + n);
        off += n;
        p += n;
      }
    }
  } else {
    throw new Error('Unsupported TGA type: ' + type);
  }

  // BGRA -> RGBA
  const rgba = Buffer.alloc(total);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    rgba[s] = bgra[s + 2];
    rgba[s + 1] = bgra[s + 1];
    rgba[s + 2] = bgra[s];
    if (channels === 4) rgba[s + 3] = bgra[s + 3];
  }

  // Vertical flip if stored bottom-up
  let data = rgba;
  if (!topDown) {
    data = Buffer.alloc(total);
    const stride = width * channels;
    for (let y = 0; y < height; y++) {
      rgba.copy(data, y * stride, (height - 1 - y) * stride, (height - y) * stride);
    }
  }
  return { width, height, channels, data };
}
