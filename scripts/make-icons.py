#!/usr/bin/env python3
"""Generate the PNG app icons (no dependencies; pure-Python PNG writer).

Draws the same glyph as public/icons/icon.svg: three white rounded bars on a
teal square. Output is full-bleed so it works as a maskable icon on Android and
as an apple-touch-icon (iOS rounds the corners itself).

Usage: npm run icons   (or python3 scripts/make-icons.py)
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "icons")

BG = (0x0E, 0x7C, 0x86)
FG = (0xFF, 0xFF, 0xFF)
# (x, y, w, h) in a 512x512 space; corner radius = w/2 (pill shape)
BARS = [(148, 196, 48, 120), (232, 136, 48, 240), (316, 176, 48, 160)]
SUPERSAMPLE = 3

TARGETS = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}


def inside_bar(x, y):
    for bx, by, bw, bh in BARS:
        r = bw / 2
        cx, cy = bx + bw / 2, by + bh / 2
        dx = max(abs(x - cx) - (bw / 2 - r), 0.0)
        dy = max(abs(y - cy) - (bh / 2 - r), 0.0)
        if dx * dx + dy * dy <= r * r:
            return True
    return False


def near_any_bar(x, y, pad):
    for bx, by, bw, bh in BARS:
        if bx - pad <= x <= bx + bw + pad and by - pad <= y <= by + bh + pad:
            return True
    return False


def coverage(px, py, scale):
    # fraction of sub-samples inside a bar, for anti-aliasing
    if not near_any_bar((px + 0.5) / scale, (py + 0.5) / scale, 2 / scale):
        return 0.0
    hits = 0
    n = SUPERSAMPLE
    for sy in range(n):
        for sx in range(n):
            x = (px + (sx + 0.5) / n) / scale
            y = (py + (sy + 0.5) / n) / scale
            if inside_bar(x, y):
                hits += 1
    return hits / (n * n)


def render(size):
    scale = size / 512
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            a = coverage(px, py, scale)
            row += bytes(round(BG[i] * (1 - a) + FG[i] * a) for i in range(3))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 per scanline
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size in TARGETS.items():
        path = os.path.join(OUT, name)
        write_png(path, size, render(size))
        print(f"wrote {os.path.relpath(path, os.path.join(HERE, '..'))} ({size}x{size})")


if __name__ == "__main__":
    main()
