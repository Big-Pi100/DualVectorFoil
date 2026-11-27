#!/usr/bin/env python3
"""蓝图 → 房间立面图。

为什么单独写一个：`room_layout.py --render` 认的是旧场景节点（Floor/ColorRect/贴图），
而现在的房间地形由 `world/tools/gen_room_terrain.gd` 从蓝图生成。
蓝图才是唯一真源，直接画蓝图比反解析 tscn 更准，也不会因为生成器改结构就失效。

用法：
    python tools/ref/render_blueprint.py godot/world/rooms/blueprints/room_02.txt
    python tools/ref/render_blueprint.py --all          # 画全部蓝图 + 拼一张对比图
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BP_DIR = ROOT / "godot/world/rooms/blueprints"
OUT_DIR = ROOT / "art/out/room"

TILE = 48
ORIGIN_X = 16
SCREEN_W, SCREEN_H = 1280, 720

# 与 gen_room_terrain.gd 的取色一致，改一处要改两处
C_BG = (245, 235, 212, 255)
C_SOLID = (148, 138, 117, 255)
C_SOLID_EDGE = (108, 99, 82, 255)
C_PLATFORM = (179, 166, 138, 255)
C_DOOR = (120, 96, 64, 255)
C_GRID = (0, 0, 0, 26)
C_PLAYER = (196, 104, 74, 235)
C_TEXT = (60, 46, 32, 255)
C_MUTED = (140, 122, 96, 255)


def parse(path: Path) -> dict:
    meta: dict[str, str] = {}
    grid: list[str] = []
    in_grid = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if in_grid:
            grid.append(line)
            continue
        if line == "---":
            in_grid = True
            continue
        if line.startswith("!"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            meta[k.strip()] = v.strip()
    return {"meta": meta, "grid": grid, "path": path}


def render(bp: dict):
    from PIL import Image, ImageDraw

    grid = bp["grid"]
    rows, cols = len(grid), len(grid[0])
    img = Image.new("RGBA", (SCREEN_W, SCREEN_H), C_BG)
    d = ImageDraw.Draw(img, "RGBA")

    # 网格底纹：让人一眼看出"这是按 48 对齐的画布"
    for c in range(cols + 1):
        x = ORIGIN_X + c * TILE
        d.line([(x, 0), (x, rows * TILE)], fill=C_GRID)
    for r in range(rows + 1):
        y = r * TILE
        d.line([(0, y), (SCREEN_W, y)], fill=C_GRID)

    # 实心 / 平台 / 门
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            x = ORIGIN_X + c * TILE
            y = r * TILE
            if ch == "#":
                d.rectangle([x, y, x + TILE - 1, y + TILE - 1], fill=C_SOLID, outline=C_SOLID_EDGE)
            elif ch == "=":
                d.rectangle([x, y, x + TILE - 1, y + 10], fill=C_PLATFORM, outline=C_SOLID_EDGE)
            elif ch in "LR":
                d.rectangle([x + 6, y - TILE, x + TILE - 7, y + TILE - 1], fill=C_DOOR)

    # 玩家（72px 视觉高，站在 r12 地面）
    px, py = 220, 624
    d.rectangle([px - 14, py - 72, px + 14, py], fill=C_PLAYER)
    d.text((px - 20, py - 90), "player", fill=C_TEXT)

    # 标注每层的脚面高度
    feet = {}
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch in "#=" and r > 0 and grid[r - 1][c] == ".":
                feet.setdefault(r, c)
    for r, c in sorted(feet.items()):
        y = r * TILE
        d.text((6, y - 13), f"r{r} (y={y})", fill=C_MUTED)

    label = bp["meta"].get("room_id", bp["path"].stem)
    d.text((SCREEN_W - 190, 10), label, fill=C_TEXT)
    d.text((10, 10), "48px grid · 26x15", fill=C_MUTED)
    return img


def main() -> int:
    try:
        from PIL import Image
    except ImportError:
        print("需要 Pillow：pip install pillow")
        return 2

    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args[0] == "--all":
        files = sorted(BP_DIR.glob("*.txt"))
    else:
        files = [Path(a) for a in args]

    made = []
    for f in files:
        if not f.is_absolute():
            f = (ROOT / f).resolve()
        if not f.exists():
            print(f"找不到 {f}")
            return 2
        bp = parse(f)
        if not bp["grid"]:
            print(f"{f.name} 没有地形行")
            return 2
        img = render(bp)
        out = OUT_DIR / f"{f.stem}.png"
        img.save(out)
        made.append((f.stem, out, img))
        print(f"写出 {out.relative_to(ROOT)}")

    # 多个蓝图时拼一张横向对比（缩到半屏）
    if len(made) > 1:
        sw, sh = SCREEN_W // 2, SCREEN_H // 2
        sheet = Image.new("RGB", (sw * len(made) + 8 * (len(made) + 1), sh + 32), (28, 28, 32))
        from PIL import ImageDraw
        d = ImageDraw.Draw(sheet)
        for i, (name, _, im) in enumerate(made):
            x = 8 + i * (sw + 8)
            d.text((x + 4, 6), name, fill=(230, 230, 230))
            sheet.paste(im.convert("RGB").resize((sw, sh), Image.LANCZOS), (x, 26))
        p = OUT_DIR / "_blueprints.png"
        sheet.save(p)
        print(f"写出 {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
