#!/usr/bin/env python3
"""单间房间的美术元素与排布盘点（2026-11-27）。

为什么单独有这支工具：地图文档（`04_关卡与地图.md`）管的是**房间之间**怎么连，
`ASSET_RULES` 管的是**单张图**怎么画。中间那一层——**一间房里放什么、放在哪、
留多少空**——此前没有任何东西在看。15:36 那次把地面换成 TileMapLayer 之后，
`GrassDecor` 立刻暴露成"摆在草地上的砖"，就是这个空缺的直接后果：
没有人说过一间房里元素该分几层、该占多少画面。

本工具只做**测量**，不做好看。它把每间房拆成可比的数字：

  层次   背景 / 中景 / 地面 / 前景  —— 各占多少像素
  横向   10 列的占用直方图        —— 元素是聚在一堆还是铺开
  纵向   上 / 中 / 下三段          —— 垂直空间是空的还是用了
  密度   非空地面积占屏比          —— 画面上有多少东西

用法：
  python tools/ref/room_layout.py            # 人读的清单
  python tools/ref/room_layout.py --json     # 机器读
  python tools/ref/room_layout.py --check    # 排布断言（不通过 exit 1）
  python tools/ref/room_layout.py --sheet    # 六宫格空间占用图

坐标约定：房间根节点在 (0,0)，屏幕 1280×720（`project.godot` viewport）。
地面碰撞顶边 y=600，是这条产线的基准线 —— 所有"贴地"判断都以它为准。
"""
from __future__ import annotations

import base64
import json
import re
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROOMS = ROOT / "godot" / "world" / "rooms"
ART = ROOT / "godot" / "art"
OUT = ROOT / "art" / "out" / "room"

SCREEN_W, SCREEN_H = 1280, 720
GROUND_Y = 600.0          # 地面碰撞顶边，全球 8 个房间一致

# 只盘这些房间。TestCombat / WhiteboxTest 是白盒调试场景，故意空。
ROOM_FILES = ["Room01", "Room02", "Room03", "Room04", "Room05", "SafeHouse"]

# 不算"美术元素"的节点类型：它们要么不可见，要么是逻辑/UI。
SKIP_TYPES = {
    "Marker2D", "CollisionShape2D", "Label", "Node", "CanvasLayer",
    "CharacterBody2D", "Area2D", "StaticBody2D", "Camera2D", "Timer",
}

# 后处理层里的全屏 ColorRect 单独算一档：它们不占"内容"，但决定画面观感。
POST_LAYER_NAMES = {"DesaturateRect", "PaperGrainRect", "EnvLightRect"}


@dataclass
class Node:
    name: str
    type: str
    parent: str
    props: dict = field(default_factory=dict)
    children: list["Node"] = field(default_factory=list)
    instance: bool = False

    # ---- 便捷读取 ----
    def pos(self) -> tuple[float, float]:
        v = self.props.get("position")
        if v is None:
            return (0.0, 0.0)
        return v

    def scale(self) -> tuple[float, float]:
        v = self.props.get("scale")
        return v if v else (1.0, 1.0)


def _parse_vec(s: str) -> tuple[float, float] | None:
    m = re.match(r"Vector2\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)", s)
    return (float(m.group(1)), float(m.group(2))) if m else None


def parse_tscn(path: Path) -> tuple[dict[str, str], list[Node]]:
    """极简 tscn 解析。只认本工程用到的写法，不追求通用。"""
    txt = path.read_text(encoding="utf-8")
    exts: dict[str, str] = {}
    for m in re.finditer(r'\[ext_resource type="([^"]+)" path="([^"]+)" id="([^"]+)"', txt):
        exts[m.group(3)] = m.group(2)

    nodes: list[Node] = []
    # 按 [node ...] 切块
    blocks = re.split(r"\n(?=\[node )", txt)
    for blk in blocks:
        m = re.match(r'\[node name="([^"]+)" type="([^"]+)"(?: parent="([^"]*)")?', blk)
        if not m:
            continue
        n = Node(name=m.group(1), type=m.group(2), parent=m.group(3) or "")
        if "instance=" in blk.split("\n")[0]:
            n.instance = True
        for line in blk.split("\n")[1:]:
            line = line.strip()
            pm = re.match(r"^(position|scale|offset_left|offset_top|offset_right|offset_bottom|texture|color|tile_set|tile_map_data)\s*=\s*(.+)$", line)
            if not pm:
                continue
            key, val = pm.group(1), pm.group(2).strip()
            if key in ("position", "scale"):
                v = _parse_vec(val)
                if v:
                    n.props[key] = v
            elif key.startswith("offset_"):
                n.props[key] = float(val)
            elif key == "texture":
                tm = re.match(r'ExtResource\("([^"]+)"\)', val)
                if tm:
                    n.props["texture"] = exts.get(tm.group(1), "")
            elif key == "tile_map_data":
                tm = re.search(r'PackedByteArray\("([^"]+)"\)', val)
                if tm:
                    n.props["tile_map_data"] = tm.group(1)
            else:
                n.props[key] = val
        nodes.append(n)

    # 建树
    by_path: dict[str, Node] = {".": None}  # type: ignore
    root = None
    for n in nodes:
        if n.parent == "":
            root = n
            by_path["."] = n
            continue
        # parent 是相对根的点分路径
        key = n.parent
        par = by_path.get(key)
        if par is not None:
            par.children.append(n)
        by_path[f"{key}.{n.name}" if key != "." else n.name] = n
    return exts, ([root] if root else [])


def tex_size(rel: str) -> tuple[int, int] | None:
    """读 PNG 头拿尺寸，不依赖 Pillow（CI 上可能没有）。"""
    if not rel.startswith("res://"):
        return None
    p = ROOT / "godot" / rel[len("res://"):]
    if not p.exists():
        return None
    with p.open("rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", head[16:24])
    return (w, h)


def walk(node: Node, ox: float = 0.0, oy: float = 0.0,
         sx: float = 1.0, sy: float = 1.0,
         order: list[int] | None = None) -> list[dict]:
    """展开成世界坐标的元素清单。只保留"看得见"的东西。

    `order` 是一个单元素列表，充当绘制序计数器：同一父级下后遍历的后画（在上层）。
    用它判"塔压草"还是"草盖塔根"——这两者画面上完全不同，但 bbox 一模一样。
    """
    if order is None:
        order = [0]
    out: list[dict] = []
    px, py = node.pos()
    nx, ny = ox + px * sx, oy + py * sy
    nsx, nsy = sx * node.scale()[0], sy * node.scale()[1]

    t = node.type
    visible = t not in SKIP_TYPES and not node.instance

    if visible:
        box = None
        kind = None
        cells: list[tuple[int, int, int]] = []
        if t == "TileMapLayer" and "tile_map_data" in node.props:
            raw = base64.b64decode(node.props["tile_map_data"])
            for i in range(2, len(raw) - 11, 12):
                x, y, _src, ax, _ay, _alt = struct.unpack("<hhhhhh", raw[i:i + 12])
                cells.append((x, y, ax))
            if cells:
                ts = 96  # 本项目 tile 尺寸，由 gen_tileset.gd 固定
                xs = [c[0] for c in cells]
                ys = [c[1] for c in cells]
                w = (max(xs) - min(xs) + 1) * ts
                h = (max(ys) - min(ys) + 1) * 144
                box = (nx + min(xs) * ts, ny + min(ys) * 144, w, h)
                kind = "ground_tiles"
        elif t == "ColorRect":
            l = node.props.get("offset_left", 0.0)
            r = node.props.get("offset_right", 0.0)
            tp = node.props.get("offset_top", 0.0)
            b = node.props.get("offset_bottom", 0.0)
            if r > l and b > tp:
                box = (nx + l * nsx, ny + tp * nsy, (r - l) * nsx, (b - tp) * nsy)
                kind = "ground_base" if node.name == "Visual" else "band"
        elif t == "Sprite2D":
            rel = node.props.get("texture", "")
            sz = tex_size(rel)
            if sz:
                w, h = sz[0] * nsx, sz[1] * nsy
                box = (nx - w / 2, ny - h / 2, w, h)   # Sprite2D 默认居中
                if node.name.startswith("GrassDecor"):
                    kind = "ground_decor"
                elif h >= 300:
                    kind = "prop_tall"
                else:
                    kind = "prop"

        if box:
            order[0] += 1
            out.append({
                "name": node.name,
                "type": t,
                "kind": kind,
                "x": round(box[0], 1), "y": round(box[1], 1),
                "w": round(box[2], 1), "h": round(box[3], 1),
                "draw_order": order[0],
                "texture": node.props.get("texture", ""),
                "cells": cells,
                "origin": (round(nx, 1), round(ny, 1)),
                "scale": (round(nsx, 3), round(nsy, 3)),
                "node_path": node.parent,
            })

    for c in node.children:
        out += walk(c, nx, ny, nsx, nsy, order)
    return out


def classify_row(e: dict) -> str:
    """按元素**顶边**归层。用顶边而不是中心：一根 400 高的塔要从它站的那层算起。"""
    y = e["y"]
    if y < 200:
        return "sky"
    if y < 420:
        return "mid"
    if y < GROUND_Y - 8:
        return "near_ground"
    return "ground"


def room_report(path: Path) -> dict:
    _, roots = parse_tscn(path)
    if not roots:
        return {"file": path.name, "error": "解析失败"}
    elems = walk(roots[0])

    # 后处理 / HUD 这类不在 walk 里（CanvasLayer 被跳过）——单独标注
    txt = path.read_text(encoding="utf-8")
    post = [n for n in POST_LAYER_NAMES if n in txt]

    rows = {"sky": 0, "mid": 0, "near_ground": 0, "ground": 0}
    for e in elems:
        rows[classify_row(e)] += 1

    # 横向 10 列占用（每列 128px）
    cols = [0.0] * 10
    for e in elems:
        if e["kind"] in ("ground_tiles", "ground_base"):
            continue  # 满屏地面不算"排布"
        x0, x1 = max(0.0, e["x"]), min(float(SCREEN_W), e["x"] + e["w"])
        if x1 <= x0:
            continue
        for i in range(10):
            a, b = i * 128, (i + 1) * 128
            ov = max(0.0, min(x1, b) - max(x0, a))
            cols[i] += ov / 128.0

    # 非空面积（粗略并集：按 8px 网格打点）
    G = 8
    gw, gh = SCREEN_W // G, SCREEN_H // G
    grid = [[False] * gw for _ in range(gh)]
    for e in elems:
        x0, y0 = int(max(0, e["x"]) // G), int(max(0, e["y"]) // G)
        x1 = int(min(SCREEN_W, e["x"] + e["w"]) // G)
        y1 = int(min(SCREEN_H, e["y"] + e["h"]) // G)
        for yy in range(y0, min(y1, gh)):
            row = grid[yy]
            for xx in range(x0, min(x1, gw)):
                row[xx] = True
    filled = sum(sum(r) for r in grid) / (gw * gh)

    kind_count: dict[str, int] = {}
    for e in elems:
        kind_count[e["kind"]] = kind_count.get(e["kind"], 0) + 1

    return {
        "file": path.name,
        "elements": elems,
        "rows": rows,
        "cols": [round(c, 2) for c in cols],
        "filled_ratio": round(filled, 4),
        "kinds": kind_count,
        "post": post,
        "texture_size": [SCREEN_W, SCREEN_H],
    }


def collect() -> list[dict]:
    return [room_report(ROOMS / f"{n}.tscn") for n in ROOM_FILES]


def fmt_bar(v: float, width: int = 20) -> str:
    n = int(round(v * width))
    return "█" * n + "·" * (width - n)


def _tex_path(rel: str) -> Path | None:
    if not rel.startswith("res://"):
        return None
    p = ROOT / "godot" / rel[len("res://"):]
    return p if p.exists() else None


def render_room(path: Path, r: dict):
    """按 draw_order 把一间房合成成图。不是引擎渲染，但足以判断"空不空"。"""
    from PIL import Image, ImageDraw

    W, H = SCREEN_W, SCREEN_H
    img = Image.new("RGBA", (W, H), (245, 235, 212, 255))  # paper_tint
    d = ImageDraw.Draw(img)

    mid = _tex_path("res://art/approved/Terrain/ground_mid.png")
    mid_img = Image.open(mid).convert("RGBA") if mid else None

    for e in sorted(r["elements"], key=lambda x: x["draw_order"]):
        k = e["kind"]
        if k == "ground_base":
            d.rectangle([e["x"], e["y"], e["x"] + e["w"], e["y"] + e["h"]],
                        fill=(242, 230, 184, 255))
        elif k == "ground_tiles" and mid_img:
            ox, oy = e["origin"]
            for cx, cy, ax in e["cells"]:
                tile = mid_img.crop((ax * 96, 0, ax * 96 + 96, 144))
                img.alpha_composite(tile, (int(ox + cx * 96), int(oy + cy * 144)))
        elif e.get("texture"):
            tp = _tex_path(e["texture"])
            if not tp:
                continue
            src = Image.open(tp).convert("RGBA")
            tw = max(1, int(round(e["w"])))
            th = max(1, int(round(e["h"])))
            if (tw, th) != src.size:
                src = src.resize((tw, th), Image.LANCZOS)
            img.alpha_composite(src, (int(round(e["x"])), int(round(e["y"]))))

    # 玩家：画成 28×72 的实心块。它只有屏高 10%，这张图里能直接看出多小。
    txt = path.read_text(encoding="utf-8")
    m = re.search(r'\[node name="Player".*?\nposition = Vector2\((-?[\d.]+), (-?[\d.]+)\)', txt, re.S)
    px, py = (float(m.group(1)), float(m.group(2))) if m else (220.0, 560.0)
    d.rectangle([px - 14, py - 72, px + 14, py], fill=(196, 104, 74, 230))
    d.text((px - 22, py - 92), "72px", fill=(120, 50, 30))

    # 地面基准线（只为标注，不是场景内容）
    d.line([0, GROUND_Y, W, GROUND_Y], fill=(200, 60, 60, 90), width=1)
    return img


def render_real(reports: list[dict]) -> int:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("生成图需要 Pillow：pip install pillow")
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    imgs = []
    for r in reports:
        p = ROOMS / r["file"]
        imgs.append((r["file"].replace(".tscn", ""), render_room(p, r)))

    COLS, ROWS = 2, 3
    SW, SH = SCREEN_W // 2, SCREEN_H // 2
    pad, top = 8, 20
    sheet = Image.new("RGB", (COLS * SW + pad * (COLS + 1),
                              ROWS * (SH + top) + pad * (ROWS + 1)), (28, 28, 32))
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(imgs):
        cx = pad + (i % COLS) * (SW + pad)
        cy = pad + (i // COLS) * (SH + top + pad)
        d.text((cx + 6, cy + 4), f"{name}", fill=(225, 225, 225))
        sheet.paste(im.convert("RGB").resize((SW, SH), Image.LANCZOS), (cx, cy + top))

    p = OUT / "_rooms_real.png"
    sheet.save(p)
    print(f"写出 {p.relative_to(ROOT)}")
    return 0


def main() -> int:
    args = set(sys.argv[1:])
    unknown = args - {"--json", "--check", "--sheet", "--gaps", "--render"}
    if unknown:
        print(f"不认识的参数 {sorted(unknown)}；支持 --json / --check / --sheet / --gaps / --render")
        return 2

    reports = collect()

    if "--json" in args:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return 0

    if "--sheet" in args:
        return render_sheet(reports)

    if "--render" in args:
        return render_real(reports)

    if "--check" in args:
        return check(reports)

    if "--gaps" in args:
        return gaps(reports)

    for r in reports:
        if "error" in r:
            print(f"{r['file']}: {r['error']}")
            continue
        print(f"\n=== {r['file']} ===")
        print(f"  元素 {len(r['elements'])} 个 | 非空面积 {r['filled_ratio']*100:.1f}% "
              f"| 后处理 {len(r['post'])} 层")
        print(f"  层次  天空区 {r['rows']['sky']:2d}  中景 {r['rows']['mid']:2d}  "
              f"近地 {r['rows']['near_ground']:2d}  地面 {r['rows']['ground']:2d}")
        print("  横向  " + " ".join(f"{i}:{c:.1f}" for i, c in enumerate(r["cols"]) if c > 0) or "（无）")
        print("  横向  " + "".join(fmt_bar(min(1.0, c / 3), 5) for c in r["cols"]))
        for e in r["elements"]:
            print(f"    {e['kind']:12s} {e['name'][:22]:22s} "
                  f"x={e['x']:7.1f} y={e['y']:6.1f} {e['w']:5.0f}×{e['h']:<5.0f}")
    return 0


def check(reports: list[dict]) -> int:
    """排布断言。只判**现在就能修好**的三条；改规则必须同时改文档 §5。

    刻意不收的两类：
      · "必须有背景层"—— 需要新美术，现在必红。让检查长期红等于训练人忽略红。
        它进 `--gaps` 当清单，不当门禁。
      · "草皮不能等距"—— 节奏问题，要重排美术，同上。
    """
    errs: list[str] = []

    for r in reports:
        name = r["file"]
        if "error" in r:
            errs.append(f"{name}: {r['error']}")
            continue

        props = [e for e in r["elements"] if e["kind"] in ("prop", "prop_tall")]

        # 1. 每间房至少要有一个地标。没有地标的房间在 1280×720 上只剩一条地面，
        #    玩家看到的是"没画完"而不是"空旷"。
        if not props:
            errs.append(f"{name}: 没有地标摆件（画面上只有地面与贴地装饰）")

        # 2. 贴地装饰压在地标脚下时，装饰必须在**更上层**。
        #    草盖塔根 = 塔从地里长出来；塔盖草 = 塔是贴片。
        #    bbox 完全相同，只有绘制序能区分，所以这条必须由工具判，眼睛在编辑器里看不出。
        for p in props:
            for d in (e for e in r["elements"] if e["kind"] == "ground_decor"):
                ox = min(p["x"] + p["w"], d["x"] + d["w"]) - max(p["x"], d["x"])
                oy = min(p["y"] + p["h"], d["y"] + d["h"]) - max(p["y"], d["y"])
                if ox > 40 and oy > 20 and d["draw_order"] < p["draw_order"]:
                    errs.append(
                        f"{name}: {p['name']} 盖住了 {d['name']}（重叠 {ox:.0f}×{oy:.0f}px，"
                        f"绘制序 {p['draw_order']} > {d['draw_order']}）—— 应草在前")

        # 3. 元素不能扎堆在 1/10 屏宽里。
        spread = sum(1 for c in r["cols"] if c > 0.05)
        if spread < 3:
            errs.append(f"{name}: 排布只占 {spread}/10 列，元素扎堆")

    if errs:
        print("🔴 排布断言未通过：")
        for e in errs:
            print("   " + e)
        return 1
    print(f"✅ 排布断言通过（{len(reports)} 间房，3 条规则）")
    return 0


def gaps(reports: list[dict]) -> int:
    """缺口清单（不是门禁）。列出现在还做不到的排布要求。"""
    print("排布缺口（不判死，属待办）：\n")
    for r in reports:
        name = r["file"]
        if "error" in r:
            continue
        sky = r["rows"]["sky"]
        mid = r["rows"]["mid"]
        decor = [e for e in r["elements"] if e["kind"] == "ground_decor"]
        xs = sorted(e["x"] + e["w"] / 2 for e in decor)
        steps = [round(b - a, 1) for a, b in zip(xs, xs[1:])]
        uniform = len(steps) > 1 and len(set(steps)) == 1

        print(f"  {name}")
        print(f"    背景层：{'无' if sky == 0 and mid == 0 else f'天空区 {sky} / 中景 {mid} 个元素'}"
              f"（画面 y<420 的内容）")
        print(f"    贴地装饰 {len(decor)} 块，间距 {steps if steps else '—'}"
              f"{' ← 完全等距' if uniform else ''}")
        tall = max((e["h"] for e in r["elements"] if e["kind"] in ("prop", "prop_tall")), default=0)
        print(f"    最高的地标 {tall:.0f}px（屏高 720 的 {tall/720*100:.0f}%）")
        print()
    return 0


def render_sheet(reports: list[dict]) -> int:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("生成图需要 Pillow：pip install pillow")
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    COLS, ROWS = 2, 3
    SW, SH = SCREEN_W // 2, SCREEN_H // 2
    pad, top = 8, 22
    sheet = Image.new("RGB", (COLS * SW + pad * (COLS + 1), ROWS * (SH + top) + pad * (ROWS + 1)), (28, 28, 32))
    d = ImageDraw.Draw(sheet)

    colors = {"ground_tiles": (120, 150, 96), "ground_base": (170, 160, 120),
              "ground_decor": (90, 120, 80), "prop": (200, 120, 90),
              "prop_tall": (220, 90, 70), "band": (100, 100, 110)}

    for idx, r in enumerate(reports):
        cx = pad + (idx % COLS) * (SW + pad)
        cy = pad + (idx // COLS) * (SH + top + pad)
        d.rectangle([cx, cy, cx + SW, cy + top], fill=(40, 40, 46))
        d.text((cx + 6, cy + 5), f"{r['file']}  {len(r['elements'])} el  {r['filled_ratio']*100:.0f}%",
               fill=(220, 220, 220))
        fy = cy + top
        d.rectangle([cx, fy, cx + SW, fy + SH], fill=(247, 243, 232))
        # 地面基准线
        gy = fy + int(GROUND_Y / SCREEN_H * SH)
        d.line([cx, gy, cx + SW, gy], fill=(200, 60, 60), width=1)

        for e in r["elements"]:
            x0 = cx + int(e["x"] / SCREEN_W * SW)
            x1 = cx + int((e["x"] + e["w"]) / SCREEN_W * SW)
            y0 = fy + int(e["y"] / SCREEN_H * SH)
            y1 = fy + int((e["y"] + e["h"]) / SCREEN_H * SH)
            c = colors.get(e["kind"], (150, 150, 150))
            if e["kind"] in ("ground_tiles", "ground_base"):
                d.rectangle([x0, y0, x1, min(y1, fy + SH)], fill=c)
            else:
                d.rectangle([x0, y0, x1, y1], outline=c, width=2)
                d.text((x0 + 2, max(y0, fy) + 1), e["name"][:14], fill=(60, 40, 30))

    p = OUT / "_layout_sheet.png"
    sheet.save(p)
    print(f"写出 {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
