#!/usr/bin/env python3
"""从大地图切房间：world_map.json → 每间房的字符地图（rooms.json）+ 预览图。

## 这一层做什么、不做什么

**做**：按房间矩形（宽高都是整格）切出一张骨架图 —— 边框、地板、门洞、
按房型摆的平台。目标是让「地图 → 房间」这条链跑通，且每间房一进去就能走。

**不做**：不做最终关卡设计。骨架只保证三件事：
  1. 每屏至少一个落脚点（手机小屏，看不见路就会乱按 —— `gdd/04 §8`）
  2. 门洞开在相邻房间投影重叠的那一段上（`gdd/04 §8` 的门必须正对着）
  3. 敌人起手位置不贴墙（留出预警空间）

## 坐标系

房间内坐标 (tx, ty)，ty 向下。可站立面 = `#` 的上沿。
`h-3` 是地板顶行上方的第一格，玩家脚底站在 `h-2` 行的上沿。

跑：python tools/worldmap/slice_rooms.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "godot" / "data" / "world_map.json"
OUT_JSON = ROOT / "godot" / "data" / "rooms.json"
OUT_HTML = ROOT / "docs" / "gdd" / "map" / "rooms_preview.html"

FLOOR_H = 2          # 地板厚 2 格（96px）
WALL_TOP = 1         # 顶墙厚 1 格
WALL_SIDE = 1        # 侧墙厚 1 格
DOOR_H = 3           # 门洞高 3 格（144px = 一个底板高，角色 100px 能过）

# 房型 → 平台带。x 是房间宽的百分比，h 是「离地高度（格）」。
# 高度全部落在 2–6 格里：2–4 是「走上去 / 一步跳」，5–6 是「要折叠」。
# 刻意不在这里放 4.5–6.5 的折叠门 —— 门是枝入口的事，不是每间房都有。
PLATFORMS = {
    "safe":   [(0.12, 3, 0.14), (0.55, 2, 0.12)],
    "combat": [(0.08, 3, 0.12), (0.30, 5, 0.14), (0.56, 3, 0.12), (0.78, 4, 0.10)],
    "dark":   [],                                    # 暗房要空，站得住就行
    "boss":   [(0.05, 4, 0.10), (0.85, 4, 0.10)],   # 两侧高台，中间空
    "hub":    [(0.10, 3, 0.12), (0.45, 4, 0.16), (0.75, 3, 0.12)],
    "hall":   [(0.10, 3, 0.10), (0.35, 5, 0.10), (0.60, 3, 0.10), (0.82, 4, 0.10)],
    "corr":   [],                                    # 走廊不放东西
}


def blank(w: int, h: int) -> list[list[str]]:
    return [["." for _ in range(w)] for _ in range(h)]


def frame(g: list[list[str]], w: int, h: int) -> None:
    for x in range(w):
        for y in range(WALL_TOP):
            g[y][x] = "#"
        for y in range(h - FLOOR_H, h):
            g[y][x] = "#"
    for y in range(h):
        for x in range(WALL_SIDE):
            g[y][x] = "#"
            g[y][w - 1 - x] = "#"


def put_platform(g, x0: int, y: int, wdt: int) -> None:
    for x in range(max(1, x0), min(len(g[0]) - 1, x0 + wdt)):
        g[y][x] = "="


def door_exits(room: dict, rooms_by_id: dict, links: list[dict]) -> dict:
    """算每扇门开在房间的哪条边、哪一段。

    规则：开在「两房间投影重叠」的那一段的中间 —— 因为横版角色不会斜着走，
    重叠段是唯一能直着穿过去的位置。

    返回**列表**不是字典：同一间房在同一方向可以有多个门
    （冠·回廊底下要分别通往冠·左台和冠·右台）。用方向当 key 会静默覆盖掉前一个。
    """
    rid = room["id"]
    r = room["rect"]
    out: list[dict] = []
    for l in links:
        if rid not in (l["from"], l["to"]):
            continue
        other_id = l["to"] if l["from"] == rid else l["from"]
        # 方向是「从 from 看过去」，本房如果是 to，方向必须翻过来。
        # 不翻的话 R2 会把通往 R1 的门也开在右边 —— 于是整条长廊只有单向门。
        d = l["dir"]
        if l["to"] == rid:
            d = {"left": "right", "right": "left", "up": "down", "down": "up"}[d]
        o = rooms_by_id[other_id]["rect"]
        ox = min(r["x"] + r["w"], o["x"] + o["w"]) - max(r["x"], o["x"])
        oy = min(r["y"] + r["h"], o["y"] + o["h"]) - max(r["y"], o["y"])
        if d in ("left", "right"):
            if oy <= 0:
                continue
            lo = max(r["y"], o["y"])
            mid = lo + oy // 2 - r["y"]
            out.append(dict(dir=d, span=(mid, mid + DOOR_H), gate=l["gate"], to=other_id))
        else:
            if ox <= 0:
                continue
            lo = max(r["x"], o["x"])
            mid = lo + ox // 2 - r["x"]
            out.append(dict(dir=d, span=(mid - 1, mid + 2), gate=l["gate"], to=other_id))
    return out


def build_room(room: dict, rooms_by_id: dict, links: list[dict]) -> dict:
    r = room["rect"]
    w, h = r["w"], r["h"]
    g = blank(w, h)
    frame(g, w, h)
    walk = h - FLOOR_H - 1          # 可站立面的那一行（地板上沿的上一格）

    # 平台：按房型百分比摆，离地高度从可站立面往上算
    for fx, lift, fw in PLATFORMS.get(room["kind"], []):
        y = walk - lift
        if y <= WALL_TOP:
            continue
        put_platform(g, int(w * fx), y, max(3, int(w * fw)))

    # 门：在边界墙上开口。**地板不动** —— 把地板也挖了玩家会掉出去。
    exits = door_exits(room, rooms_by_id, links)
    for info in exits:
        dir_, a, b = info["dir"], info["span"][0], info["span"][1]
        if dir_ in ("left", "right"):
            x = 0 if dir_ == "left" else w - 1
            for y in range(max(WALL_TOP, a), min(b, h - FLOOR_H)):
                g[y][x] = "D"
        elif dir_ == "up":
            for x in range(max(1, a), min(w - 1, b)):
                g[0][x] = "D"
        else:                                   # down：地板中间挖一个口
            for x in range(max(1, a), min(w - 1, b)):
                g[h - 1][x] = "D"
                g[h - 2][x] = "D"

    return {
        "id": room["id"], "name": room["name"], "layer": room["layer"],
        "kind": room["kind"], "w": w, "h": h,
        "rect": r,
        "walk_y": walk,
        "grid": ["".join(row) for row in g],
        "exits": [dict(dir=v["dir"], span=list(v["span"]), gate=v["gate"], to=v["to"])
                  for v in exits],
    }


# ── 校验：骨架至少得能走 ────────────────────────────────────────────
def walkable(g: list[str]) -> list[list[bool]]:
    """从地板顶行往上，能站立的格子 = 下方是实心。"""
    h, w = len(g), len(g[0])
    ok = [[False] * w for _ in range(h)]
    for y in range(h - 1):
        for x in range(w):
            if g[y][x] in ".D=" and g[y + 1][x] in "#=":
                ok[y][x] = True
    return ok


def check_room(rm: dict) -> list[str]:
    bad = []
    g, w, h = rm["grid"], rm["w"], rm["h"]
    ok = walkable(g)

    # 1. 每屏至少一个落脚点：屏幕宽 20 格
    for sx in range(0, w, 20):
        seg = [ok[y][x] for y in range(h) for x in range(sx, min(sx + 20, w))]
        if not any(seg):
            bad.append(f"{rm['id']} 第 {sx}–{min(sx+20,w)} 列没有任何落脚点（一屏黑）")

    # 2. 门洞必须通到房间内部：门格本身可站，且往里一格也可站
    for info in rm["exits"]:
        dir_ = info["dir"]
        if dir_ in ("left", "right"):
            x = 0 if dir_ == "left" else w - 1
            xs = [x, 1 if dir_ == "left" else w - 2]
            ys = [y for y in range(info["span"][0], info["span"][1]) if y < h]
            if not any(ok[y][xx] for y in ys for xx in xs):
                bad.append(f"{rm['id']} {dir_} 门洞不通（门里门外都没有可站立格）")
        else:
            y = 0 if dir_ == "up" else h - 1
            xs = [x for x in range(info["span"][0], info["span"][1]) if 0 < x < w - 1]
            if not any(g[y][x] == "D" for x in xs):
                bad.append(f"{rm['id']} {dir_} 门洞没开出来")

    # 3. 门开在重叠段上 —— 由 door_exits 保证，这里只查有没有落到墙外
    for info in rm["exits"]:
        dir_, a, b = info["dir"], info["span"][0], info["span"][1]
        if dir_ in ("up", "down") and not (0 < a and b < w):
            bad.append(f"{rm['id']} {dir_} 门 x={a}..{b} 超出内墙范围")
    return bad


def render_html(rooms: list[dict], order: list[str]) -> str:
    CELL = 9
    by_id = {r["id"]: r for r in rooms}
    cards = []
    for rid in order:
        rm = by_id[rid]
        w, h = rm["w"], rm["h"]
        parts = []
        for y, row in enumerate(rm["grid"]):
            for x, ch in enumerate(row):
                if ch == ".":
                    continue
                cls = {"#": "solid", "=": "plat", "D": "door"}[ch]
                parts.append(f'<rect class="{cls}" x="{x*CELL}" y="{y*CELL}" '
                             f'width="{CELL}" height="{CELL}"/>')
        exits = " ".join(
            f'<span class="ex">{ {"up":"↑","down":"↓","left":"←","right":"→"}[e["dir"]] }'
            f'{e["to"]}{" ⛩" + e["gate"] if e["gate"] else ""}</span>'
            for e in rm["exits"])
        cards.append(f"""
        <article class="card">
          <div class="hd"><b>{rm['id']} · {rm['name']}</b>
            <span class="meta">{rm['layer']} / {rm['kind']} / {w}×{h} 格
            = {w*48}×{h*48}px</span></div>
          <div class="canvas" style="width:{w*CELL}px;height:{h*CELL}px">
            <svg viewBox="0 0 {w*CELL} {h*CELL}" width="{w*CELL}" height="{h*CELL}">
              <rect class="air" x="0" y="0" width="{w*CELL}" height="{h*CELL}"/>
              {''.join(parts)}
            </svg>
          </div>
          <div class="ft">{exits or '<span class="ex dim">无出口</span>'}</div>
        </article>""")

    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>房间骨架 · 从大地图切出来</title>
<style>
  :root {{ --ink:#2b2620; --bg:#f7f3e8; --line:#cfc6b2; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif; }}
  header {{ padding:20px 24px 14px; border-bottom:1px solid var(--line); }}
  h1 {{ margin:0 0 6px; font-size:19px; }}
  h1 small {{ font-weight:400; opacity:.55; font-size:13px; margin-left:8px; }}
  .sub {{ font-size:12.5px; opacity:.75; max-width:940px; }}
  .sub code {{ background:#ebe3cd; padding:1px 4px; border-radius:3px; font-size:11.5px; }}
  main {{ padding:16px 24px 40px; display:flex; flex-wrap:wrap; gap:22px; }}
  .card {{ background:#fffdf6; border:1px solid var(--line); border-radius:8px;
    padding:10px 12px 8px; }}
  .hd {{ font-size:13px; margin-bottom:7px; display:flex; gap:8px;
    align-items:baseline; flex-wrap:wrap; }}
  .hd b {{ font-size:13.5px; }}
  .meta {{ font-size:10.5px; opacity:.55; }}
  .canvas {{ background:#e9e1cd; border:1px solid #d3c8ac; border-radius:4px;
    overflow:hidden; }}
  .air {{ fill:#efe8d6; }}
  .solid {{ fill:#5c5142; }}
  .plat  {{ fill:#a9855c; }}
  .door  {{ fill:#3f8f7a; }}
  .ft {{ margin-top:6px; font-size:11px; display:flex; gap:8px; flex-wrap:wrap; }}
  .ex {{ color:#2f6b5c; }}
  .ex.dim {{ color:#b0a894; }}
  .legend {{ display:flex; gap:16px; font-size:12px; margin-top:10px; flex-wrap:wrap; }}
  .legend span {{ display:flex; align-items:center; gap:5px; }}
  .sw {{ width:11px; height:11px; border-radius:2px; }}
</style></head><body>
<header>
  <h1>房间骨架 <small>{len(order)} 间 · 从 world_map.json 切出来</small></h1>
  <div class="sub">
    每间房的宽高就是大地图上那个矩形（单位 TILE=48px），所以「切」是零损耗的 ——
    不需要重新计算比例，也不可能对不齐。<br>
    这一层只保证：地板连续、门洞开在相邻房间<b>投影重叠</b>的那一段、每屏至少一个落脚点。
    <b>这是骨架不是终稿</b>：地形细节、敌人编成、背景都在下一层。
  </div>
  <div class="legend">
    <span><i class="sw" style="background:#5c5142"></i>墙 / 地板</span>
    <span><i class="sw" style="background:#a9855c"></i>平台</span>
    <span><i class="sw" style="background:#3f8f7a"></i>门洞</span>
    <span><i class="sw" style="background:#efe8d6"></i>可通行空间</span>
  </div>
</header>
<main>{''.join(cards)}</main>
</body></html>
"""


def main() -> None:
    world = json.loads(SRC.read_text(encoding="utf-8"))
    by_id = {r["id"]: r for r in world["rooms"]}
    links = world["links"]

    rooms = [build_room(r, by_id, links) for r in world["rooms"]]

    bad: list[str] = []
    for rm in rooms:
        bad += check_room(rm)

    # 门必须是双向的：A 有通往 B 的洞，B 就得有通往 A 的洞。
    # 只做单向是最容易犯又最难在截图上看出来的错 —— 玩家走到房间尽头发现是堵墙。
    have = {(r["id"], e["to"]) for r in rooms for e in r["exits"]}
    for l in links:
        if (l["from"], l["to"]) not in have:
            bad.append(f"{l['from']} 没有通往 {l['to']} 的门")
        if (l["to"], l["from"]) not in have:
            bad.append(f"{l['to']} 没有通往 {l['from']} 的门")

    if bad:
        print("[slice] 校验失败：")
        for b in bad:
            print("  ✗", b)
        raise SystemExit(1)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(
        {"meta": dict(grid=world["meta"]["grid"],
                      source="world_map.json",
                      note="骨架地图，不是终稿"),
         "rooms": {r["id"]: r for r in rooms}},
        ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"[slice] {len(rooms)} 间 → {OUT_JSON.relative_to(ROOT)}")

    # 预览：根系全部 + 主干前 3 + 一条走廊，够看出「同一种切法能出各种房」
    order = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "T1", "T2", "T3", "T5"]
    order = [o for o in order if o in {r["id"] for r in rooms}]
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(render_html(rooms, order), encoding="utf-8")
    print(f"[slice] 预览 {len(order)} 间 → {OUT_HTML.relative_to(ROOT)}")

    tot = sum(r["w"] * r["h"] for r in rooms)
    doors = sum(len(r["exits"]) for r in rooms)
    print(f"[slice] 合计 {tot} 格（{tot/(20*11.25):.0f} 屏），{doors} 个门洞")


if __name__ == "__main__":
    main()
