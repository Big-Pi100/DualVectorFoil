#!/usr/bin/env python3
"""cardify 参数对比图：同一角色，四种厚度，游戏实际尺度（100px / 200px）各一行，整体放大 3 倍便于观察。"""
import subprocess, sys
from PIL import Image, ImageDraw

SRC = "art/out/hero_side_idle.png"
RATIOS = [0.0, 0.02, 0.035, 0.05]
ROWS = [100, 200]
S = 3               # 观察放大倍数（最近邻，保留真实像素）
PAD = 14
LABEL = 16
BG = (232, 225, 210)
INK = (46, 38, 30)


def run(ratio):
    out = f"art/out/_c_{int(ratio*1000)}.png"
    subprocess.run([sys.executable, "art/tools/cardify.py", SRC, out, "--ratio", str(ratio)],
                   check=True, capture_output=True)
    return out


def tile(path, h):
    im = Image.open(path).convert("RGBA")
    k = h / 1330.0
    small = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    return small.resize((small.width * S, small.height * S), Image.NEAREST)


grid = []
for h in ROWS:
    grid.append((h, [(r, tile(run(r), h)) for r in RATIOS]))

cellw = max(max(t.width for _, t in row) for _, row in grid) + PAD * 2
cellh = max(max(t.height for _, t in row) for _, row in grid) + PAD * 2
lbl = 20

sheet = Image.new("RGB", (cellw * len(RATIOS), (cellh + lbl) * len(ROWS)), BG)
d = ImageDraw.Draw(sheet)
for ri, (h, row) in enumerate(grid):
    oy = ri * (cellh + lbl)
    for ci, (r, t) in enumerate(row):
        ox = ci * cellw
        d.text((ox + PAD, oy + 4), f"{h}px  " + ("raw" if r == 0 else f"{int(r*1000)/10:g}%"), fill=INK)
        sheet.paste(t, (ox + (cellw - t.width) // 2, oy + lbl + (cellh - t.height) // 2), t)
        d.rectangle([ox + 3, oy + 2, ox + cellw - 4, oy + lbl + cellh - 3], outline=(198, 188, 170))

sheet.save("art/out/proof_card_thickness.png")
print("OK", sheet.size)
