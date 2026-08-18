#!/usr/bin/env python3
"""Minimal PNG decoder: print ASCII brightness map of a texture region."""
import sys, zlib, struct

def decode_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos = 8
    idat = b''
    width = height = bitdepth = colortype = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        ctype = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        if ctype == b'IHDR':
            width, height, bitdepth, colortype = struct.unpack('>IIBB', chunk[:10])
        elif ctype == b'IDAT':
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    channels = {2: 3, 6: 4}[colortype]
    stride = width * channels
    out = bytearray(width * height * channels)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i-channels]) & 0xFF
        elif f == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:  # Average
            for i in range(stride):
                a = line[i-channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:  # Paeth
            for i in range(stride):
                a = line[i-channels] if i >= channels else 0
                b = prev[i]
                c = prev[i-channels] if i >= channels else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y*stride:(y+1)*stride] = line
        prev = line
    return width, height, channels, out

def ascii_map(path, x0, y0, x1, y1, scale=1):
    w, h, ch, px = decode_png(path)
    print(f'{path}: {w}x{h}, channels={ch}')
    for yy in range(y0, y1, scale):
        row = ''
        for xx in range(x0, x1, scale):
            i = (yy * w + xx) * ch
            r, g, b = px[i], px[i+1], px[i+2]
            lum = (r * 299 + g * 587 + b * 114) // 1000
            a = px[i+3] if ch == 4 else 255
            if a < 128:
                row += '..'
            elif lum > 200:
                row += '##'
            elif lum > 150:
                row += '++'
            elif lum > 100:
                row += '--'
            else:
                row += '  '
        print(f'{yy:3d} {row}')
    # sample exact colors for a few points
    def col(x, y):
        i = (y * w + x) * ch
        return tuple(px[i:i+3])
    return col

if __name__ == '__main__':
    path = sys.argv[1]
    x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
    scale = int(sys.argv[6]) if len(sys.argv) > 6 else 1
    ascii_map(path, x0, y0, x1, y1, scale)
