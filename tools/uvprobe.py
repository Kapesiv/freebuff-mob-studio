#!/usr/bin/env python3
"""Print per-pixel color classes (single char per pixel) for a texture region."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from decode_png import decode_png

def classify(r, g, b, a):
    if a < 128: return 'T'  # transparent
    lum = (r * 299 + g * 587 + b * 114) // 1000
    if lum > 200: return 'W'  # white/bright
    if lum > 150: return '.'  # light
    if lum > 100: return '-'  # mid
    return ' '  # dark

path = sys.argv[1]
x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
w, h, ch, px = decode_png(path)
for yy in range(y0, y1):
    row = ''
    for xx in range(x0, x1):
        i = (yy * w + xx) * ch
        row += classify(px[i], px[i+1], px[i+2], px[i+3] if ch == 4 else 255)
    print(f'{yy:2d} ' + ' '.join(row))
