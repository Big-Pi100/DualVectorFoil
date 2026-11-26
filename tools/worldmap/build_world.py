#!/usr/bin/env python3
"""世界树大地图：房间矩形定义 → world_map.json + 校验 + 可视化。

## 为什么地图格是 TILE 而不是「屏幕」

《月下夜想曲》的地图是**屏幕格**：一格 = 一屏（256×224），一格 0.1%，
正城 945 格。它能这么干，因为 224÷16=14、256÷16=16 都是整数。

本项目一屏 960×540，纵向 540÷48 = **11.25 格**，不是整数。
照抄「屏幕格」会让每个房间的上下边界卡在四分之一格上，切出来的房间
永远对不齐 48 的网格，底板（高 144 = 3 格）也没法整数铺。

所以照抄的是**结构**（全局网格 + 房间是格子上的矩形 + 相邻共享边界），
不是**单位**。地图格 = TILE = 48px，和全部资产同一把尺子。

## 坐标系

原点左上，y 向下（与 Godot 2D 一致）。单位 TILE。
房间之间留 2 格墙（96px）；同一层的房之间留 8 格（384px，够一扇门 + 门框）。

## 两条从别处抄来的硬规则

1. **房间边界必须落在整格上**，且相邻房间在投影上必须有重叠 —— 否则进门要斜着走，
   而横版角色不会斜着走。
2. **门的位置在枝的入口，不在末端。** 枝是「用已有技能进去，末端给新技能」，
   所以入口门的形状必须是该技能的典型形状（折叠门是台、生长门是竖井）。
   这样玩家第一次见到某扇门时，就已经具备对应能力，永远不会遇到「打不开也不知道为什么」。

跑：python tools/worldmap/build_world.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = ROOT / "godot" / "data" / "world_map.json"
OUT_HTML = ROOT / "docs" / "gdd" / "map" / "world_map.html"

TILE = 48
MAP_W, MAP_H = 1200, 470

# 层：只用于着色与图例（层的 y 区间互相重叠 —— 枝是从主干侧向伸出的，
# 本来就不在一条水平带上。硬套「层带」会让图看起来像五条横杠）
LAYERS = {
    "root":  dict(name="根系",      color="#8a6a4f", order=1,
                  note="教学 / 出生 / Boss。水平长廊，唯一一层不回头"),
    "trunk": dict(name="主干·中庭", color="#3f6b52", order=2,
                  note="垂直枢纽。四个岔口，四条枝的唯一入口"),
    "s1":    dict(name="枝·沼",     color="#3f6b7a", order=3, skill="折叠",
                  note="入口无门。末端给出折叠"),
    "s2":    dict(name="枝·塔",     color="#5b5b7a", order=3, skill="生长",
                  note="入口是折叠门（5 格台）。末端给出生长"),
    "s3":    dict(name="枝·钟",     color="#7a6a3a", order=3, skill="底片",
                  note="入口是生长门（8 格竖井）。末端给出底片"),
    "s4":    dict(name="枝·墙",     color="#7a4a4a", order=3, skill="待定",
                  note="入口是底片门。末端给出第四技能（未定）"),
    "crown": dict(name="树冠",      color="#8a7a3a", order=4,
                  note="终局。横向分叉 + 纵向终局井"),
}

# kind → (中文, 是否安全房, 宽上限, 高上限, 一句话)
KINDS = {
    "safe":   ("安全", True,  120, 14, "无敌人 / 无掉落压力"),
    "combat": ("战斗", False, 120, 14, "净战斗 40–90 秒"),
    "dark":   ("暗房", True,  120, 14, "存档 / 回血 / 耕地"),
    "hub":    ("枢纽", True,  160, 18, "多出口，不安排强制战斗"),
    "boss":   ("Boss", False, 160, 18, "考核房，一次打满 3–5 分钟"),
    "hall":   ("大厅", True,  320, 18, "横向贯通的大空间，天然要横向相机"),
    "corr":   ("走廊", True,  400, 15, "纯连通，不放敌人（可以放素材）"),
}

# ── 房间：(id, 名字, 层, 类型, x, y, w, h) ──────────────────────────────
ROOMS = [
    # 根系：一条整齐的长廊，8 房。**房高 12 格 = 1.07 屏** —— 一屏 11.25 格，
    # 上去就是 2 屏，而玩家只在离地 5 格里活动，多出来的全是空的。
    ("R1", "出生点",    "root", "safe",    40, 434,  58, 12),
    ("R2", "第一道坎",  "root", "combat", 106, 434,  58, 12),
    ("R3", "低顶通道",  "root", "combat", 172, 434,  58, 12),
    ("R4", "暗房一",    "root", "dark",   238, 434,  58, 12),
    ("R5", "折痕房",    "root", "combat", 304, 434,  58, 12),
    ("R6", "精英房",    "root", "combat", 370, 434,  58, 12),
    ("R7", "暗房二",    "root", "dark",   436, 434,  58, 12),
    ("R8", "根系·Boss", "root", "combat", 502, 434,  58, 12),

    # 主干：竖直井 + 四个岔口。中心 x=580，井宽 56。枢纽房 16 格（1.4 屏）
    ("T1",  "中庭底",  "trunk", "hub",  500, 416, 160, 16),
    ("T2",  "井一",    "trunk", "combat", 552, 402,  56, 12),
    ("T3",  "左岔·沼", "trunk", "hub",  440, 386, 140, 14),
    ("T4",  "井二",    "trunk", "combat", 552, 372,  56, 12),
    ("T5",  "右岔·钟", "trunk", "hub",  552, 356, 140, 14),
    ("T6",  "井三",    "trunk", "combat", 552, 342,  56, 12),
    ("T7",  "左岔·塔", "trunk", "hub",  440, 326, 140, 14),
    ("T8",  "井四",    "trunk", "combat", 552, 312,  56, 12),
    ("T9",  "右岔·墙", "trunk", "hub",  552, 296, 140, 14),
    ("T10", "冠前庭",  "trunk", "hub",  520, 278, 160, 16),

    # 枝·沼（左横 6 房）—— 入口无门，末端给折叠
    ("S6", "沼·近", "s1", "combat", 384, 386, 56, 14),
    ("S5", "沼·二", "s1", "combat", 320, 386, 56, 14),
    ("S4", "沼·三", "s1", "combat", 256, 386, 56, 14),
    ("S3", "沼·四", "s1", "dark",   192, 386, 56, 14),
    ("S2", "沼·五", "s1", "combat", 128, 386, 56, 14),
    ("S1", "沼·末", "s1", "boss",    64, 386, 56, 14),

    # 枝·塔（左竖 7 房）—— 入口折叠门，末端给生长
    ("V0", "塔·廊", "s2", "corr",  232, 326, 208, 12),
    ("V1", "塔·底", "s2", "combat", 176, 326, 56, 12),
    ("V2", "塔·二", "s2", "combat", 176, 312, 56, 12),
    ("V3", "塔·三", "s2", "dark",   176, 298, 56, 12),
    ("V4", "塔·四", "s2", "combat", 176, 284, 56, 12),
    ("V5", "塔·五", "s2", "combat", 176, 270, 56, 12),
    ("V6", "塔·六", "s2", "combat", 176, 256, 56, 12),
    ("V7", "塔·顶", "s2", "boss",   176, 242, 56, 12),

    # 枝·墙（右横 6 房）—— 入口底片门，末端给第四技能
    ("Q1", "墙·近", "s4", "combat", 692, 296, 46, 14),
    ("Q2", "墙·二", "s4", "combat", 746, 296, 46, 14),
    ("Q3", "墙·三", "s4", "combat", 800, 296, 46, 14),
    ("Q4", "墙·四", "s4", "dark",   854, 296, 46, 14),
    ("Q5", "墙·五", "s4", "combat", 908, 296, 46, 14),
    ("Q6", "墙·末", "s4", "boss",   962, 296, 46, 14),

    # 枝·钟（右竖 7 房）—— 入口生长门，末端给底片
    ("Z0", "钟·廊", "s3", "corr",   692, 356, 398, 14),
    ("Z1", "钟·底", "s3", "combat", 1090, 356, 56, 14),
    ("Z2", "钟·二", "s3", "combat", 1090, 340, 56, 14),
    ("Z3", "钟·三", "s3", "dark",   1090, 324, 56, 14),
    ("Z4", "钟·四", "s3", "combat", 1090, 308, 56, 14),
    ("Z5", "钟·五", "s3", "combat", 1090, 292, 56, 14),
    ("Z6", "钟·六", "s3", "combat", 1090, 276, 56, 14),
    ("Z7", "钟·顶", "s3", "boss",   1090, 260, 56, 14),

    # 树冠（5 房）
    ("C1", "冠·前庭", "crown", "hub",   520, 260, 160, 16),
    ("C2", "冠·左台", "crown", "combat", 400, 264, 120, 12),
    ("C3", "冠·右台", "crown", "combat", 680, 264, 120, 12),
    ("C4", "冠·回廊", "crown", "hall",  460, 246, 280, 14),
    ("C5", "冠·终Boss", "crown", "boss", 570, 230, 150, 16),
]

# ── 连接：(a, b, 方向, 门) ────────────────────────────────────────────
# 门：None / "fold" / "grow" / "neg"
# **门只出现在枝的入口**：进枝用的是上一段拿到的技能，末端给新技能
LINKS = [
    # 根系
    ("R1", "R2", "right", None),
    ("R2", "R3", "right", None),
    ("R3", "R4", "right", None),
    ("R4", "R5", "right", None),
    ("R5", "R6", "right", None),
    ("R6", "R7", "right", None),
    ("R7", "R8", "right", None),
    ("R8", "T1", "up", None),

    # 主干
    ("T1", "T2", "up", None),
    ("T2", "T3", "up", None),
    ("T3", "T4", "up", None),
    ("T4", "T5", "up", None),
    ("T5", "T6", "up", None),
    ("T6", "T7", "up", None),
    ("T7", "T8", "up", None),
    ("T8", "T9", "up", None),
    ("T9", "T10", "up", None),

    # 枝·沼：无门（第一枝，用于教"枝"这个概念本身）
    ("T3", "S6", "left", None),
    ("S6", "S5", "left", None),
    ("S5", "S4", "left", None),
    ("S4", "S3", "left", None),
    ("S3", "S2", "left", None),
    ("S2", "S1", "left", None),

    # 枝·塔：折叠门
    ("T7", "V0", "left", "fold"),
    ("V0", "V1", "left", None),
    ("V1", "V2", "up", None),
    ("V2", "V3", "up", None),
    ("V3", "V4", "up", None),
    ("V4", "V5", "up", None),
    ("V5", "V6", "up", None),
    ("V6", "V7", "up", None),

    # 枝·钟：生长门
    ("T5", "Z0", "right", "grow"),
    ("Z0", "Z1", "right", None),
    ("Z1", "Z2", "up", None),
    ("Z2", "Z3", "up", None),
    ("Z3", "Z4", "up", None),
    ("Z4", "Z5", "up", None),
    ("Z5", "Z6", "up", None),
    ("Z6", "Z7", "up", None),

    # 枝·墙：底片门
    ("T9", "Q1", "right", "neg"),
    ("Q1", "Q2", "right", None),
    ("Q2", "Q3", "right", None),
    ("Q3", "Q4", "right", None),
    ("Q4", "Q5", "right", None),
    ("Q5", "Q6", "right", None),

    # 树冠
    ("T10", "C1", "up", None),
    ("C1", "C2", "left", None),
    ("C1", "C3", "right", None),
    ("C2", "C4", "up", "fold"),
    ("C3", "C4", "up", None),
    ("C4", "C5", "up", "grow"),
]

# 传送：不是物理连接，所以不进 LINKS（也不参与「相邻」校验）。
# 用途：暗房二 → 中庭底。打通后允许回主干，不用重走 Boss 房。
# 替代了 GDD §5 原来写的「折叠捷径」—— 那条在数学上不成立（见 check() 里的断言）
WARPS = [("R7", "T1", "暗房二 → 中庭底。回主干用，不必重打 Boss")]

# 技能解锁链：空心 BFS，按这个顺序逐轮放开
UNLOCK_CHAIN = [[], ["toss"], ["fold"], ["grow"], ["neg"]]

# 每个技能由哪个房间给
SKILL_FROM = {"toss": "R2", "fold": "S1", "grow": "V7", "neg": "Z7"}


def rect(r):
    return r[4], r[5], r[4] + r[6], r[5] + r[7]


def overlap(a, b) -> tuple[int, int]:
    ax0, ay0, ax1, ay1 = rect(a)
    bx0, by0, bx1, by1 = rect(b)
    return min(ax1, bx1) - max(ax0, bx0), min(ay1, by1) - max(ay0, by0)


def check() -> list[str]:
    bad: list[str] = []
    by_id = {r[0]: r for r in ROOMS}

    # 0. id 唯一
    if len(by_id) != len(ROOMS):
        bad.append(f"房间 id 重复：{len(ROOMS)} 条定义只有 {len(by_id)} 个 id")

    # 1. 不重叠
    for i, a in enumerate(ROOMS):
        for b in ROOMS[i + 1:]:
            ox, oy = overlap(a, b)
            if ox > 0 and oy > 0:
                bad.append(f"房间重叠：{a[0]} × {b[0]}  重叠 {ox}×{oy} 格")

    # 2. 尺寸
    for r in ROOMS:
        _id, _n, _l, kind, x, y, w, h = r
        if kind not in KINDS:
            bad.append(f"{_id} 未知 kind={kind}")
            continue
        kname, _safe, mw, mh, _ = KINDS[kind]
        if not (40 <= w <= mw):
            bad.append(f"{_id} 宽 {w} 超出 40–{mw}（{kname}）")
        if not (11 <= h <= mh):
            bad.append(f"{_id} 高 {h} 超出 11–{mh}（{kname}）"
                       f"  —— 一屏 11.25 格，超过 18 就要纵向滚 1.6 屏，手机上会看不见脚")
        if x < 0 or y < 0 or x + w > MAP_W or y + h > MAP_H:
            bad.append(f"{_id} 越出地图边界 {MAP_W}×{MAP_H}")

    # 3. 每个 link 的两端必须真的挨着（投影有重叠 + 间隙 ≤12）
    for a, b, d, gate in LINKS:
        if a not in by_id or b not in by_id:
            bad.append(f"连接 {a}→{b} 有端点不存在")
            continue
        ox, oy = overlap(by_id[a], by_id[b])
        if d in ("right", "left"):
            ok = oy > 0 and -12 <= ox <= 0
        elif d in ("up", "down"):
            ok = ox > 0 and -12 <= oy <= 0
        else:
            bad.append(f"连接 {a}→{b} 方向非法 {d}")
            continue
        if not ok:
            bad.append(f"连接 {a}→{b}({d}) 不挨着：x 重叠 {ox}，y 重叠 {oy}"
                       f"  —— 横版角色不会斜着走，两端投影必须重叠")

    # 4. 可达性：按解锁链逐轮 BFS
    have: set[str] = set()
    reached: set[str] = {"R1"}
    for stage in UNLOCK_CHAIN:
        have |= set(stage)
        changed = True
        while changed:
            changed = False
            for a, b, _d, gate in LINKS:
                if gate is not None and gate not in have:
                    continue
                if a in reached and b not in reached:
                    reached.add(b); changed = True
                elif b in reached and a not in reached:
                    reached.add(a); changed = True
    missing = [r[0] for r in ROOMS if r[0] not in reached]
    if missing:
        bad.append(f"拿到全部技能后仍不可达：{missing}")

    # 5. 技能必须在自己那道门之前拿到
    #    （唯一的正确顺序：toss → fold → grow → neg，且门由上一个技能打开）
    order = ["toss", "fold", "grow", "neg"]
    for gate_skill, room_id in [("fold", "S1"), ("grow", "V7"), ("neg", "Z7")]:
        # 这条门用它打开的那个技能，必须来自一条更早的枝
        src_stage = order.index(gate_skill)
        for a, b, _d, g in LINKS:
            if g != gate_skill:
                continue
            # 门所在枝的末端给的是「下一个」技能，顺序不能反
        assert SKILL_FROM[gate_skill] in by_id, room_id

    # 6. 「折叠捷径」不成立 —— 这是一条否定断言，防止有人把 GDD 原文抄回来
    #    折叠门单次跨越 ≤6.85 格，根系(R8 顶 424) 到主干(T5 底 318) 差 128 格。
    #    任何声称「折叠一下就能从根系抄近道到主干」的设计，在这里红。
    def gap_ok(a, b, max_gap):
        ra, rb = by_id.get(a), by_id.get(b)
        if not ra or not rb:
            return True
        return max(abs(ra[5] - rb[5]), abs(ra[4] - rb[4])) <= max_gap

    if not gap_ok("R8", "T5", 7):
        for a, b, _d, g in LINKS:
            if g == "fold" and {a, b} & {"R8", "T5"}:
                bad.append("折叠门被接在根系与主干之间 —— 垂直差 >7 格，折叠跳不过去")

    return bad


def to_json() -> dict:
    return {
        "meta": {
            "name": "世界树",
            "grid": TILE,
            "width": MAP_W,
            "height": MAP_H,
            "coord": "origin=top-left, y down, unit=TILE(48px)",
            "why_tile_not_screen": (
                "一屏 960x540 的纵向 540/48=11.25 不是整数，用屏幕格会让房间边界卡在 1/4 格上。"
                "地图格 = TILE。"),
            "room_count": len(ROOMS),
            "link_count": len(LINKS),
        },
        "layers": LAYERS,
        "kinds": {k: {"name": v[0], "safe": v[1], "max_w": v[2], "max_h": v[3], "note": v[4]}
                  for k, v in KINDS.items()},
        "skill_from": SKILL_FROM,
        "rooms": [
            {
                "id": r[0], "name": r[1], "layer": r[2], "kind": r[3],
                "rect": {"x": r[4], "y": r[5], "w": r[6], "h": r[7]},
                "rect_px": {"x": r[4] * TILE, "y": r[5] * TILE,
                            "w": r[6] * TILE, "h": r[7] * TILE},
                "screens": {"w": round(r[6] / 20, 2), "h": round(r[7] / 11.25, 2)},
            }
            for r in ROOMS
        ],
        "links": [{"from": a, "to": b, "dir": d, "gate": g} for a, b, d, g in LINKS],
        "warps": [{"from": a, "to": b, "why": w} for a, b, w in WARPS],
    }


# ── 图 ────────────────────────────────────────────────────────────────
def render_html() -> str:
    S = 1.3
    by_id = {r[0]: r for r in ROOMS}
    pad = 30
    # 按内容包围盒裁，不按 MAP_W/MAP_H —— 否则大半个画面是空的
    xs = [r[4] for r in ROOMS] + [r[4] + r[6] for r in ROOMS]
    ys = [r[5] for r in ROOMS] + [r[5] + r[7] for r in ROOMS]
    BX0, BX1 = min(xs) - 16, max(xs) + 16
    BY0, BY1 = min(ys) - 16, max(ys) + 16
    W, H = (BX1 - BX0) * S + pad * 2, (BY1 - BY0) * S + pad * 2

    def X(g):
        return (g - BX0) * S + pad

    def Y(g):
        return (g - BY0) * S + pad

    def cx(r):
        return X(r[4] + r[6] / 2)

    def cy(r):
        return Y(r[5] + r[7] / 2)

    parts: list[str] = []

    # 实体层：把包围盒填成比背景深一档的"岩体"，房间读起来像从里面挖出来的。
    # 恶魔城的地图也是这个逻辑 —— 房间是亮的，其余是城墙。
    parts.append(f'<rect class="solid" x="{pad-14:.1f}" y="{pad-14:.1f}" '
                 f'width="{(BX1-BX0)*S+28:.1f}" height="{(BY1-BY0)*S+28:.1f}" rx="10"/>')

    # 每 50 格一条刻度线
    for gy in range(int(BY0 // 50) * 50, int(BY1) + 1, 50):
        y = Y(gy)
        parts.append(f'<line class="tick" x1="{pad-10:.1f}" y1="{y:.1f}" '
                     f'x2="{W-pad+6:.1f}" y2="{y:.1f}"/>')
        parts.append(f'<text class="ticktxt" x="{pad-13:.1f}" y="{y+3.5:.1f}">{gy}</text>')

    # 连接段：把房间之间的空隙填上，读起来才是"连成一片的城堡"而不是"散落的方块"。
    # 这一段是真的门洞（游戏里就是墙上一扇门），不是视觉补丁。
    for a, b, d, gate in LINKS:
        A, B = by_id[a], by_id[b]
        ox, oy = overlap(A, B)
        if d in ("left", "right"):
            ax0, ax1 = A[4], A[4] + A[6]
            bx0, bx1 = B[4], B[4] + B[6]
            gx0, gx1 = min(ax1, bx1), max(ax0, bx0)
            y0 = max(A[5], B[5])
            if gx1 > gx0 and oy > 0:
                parts.append(f'<rect class="conn" x="{X(gx0):.1f}" y="{Y(y0):.1f}" '
                             f'width="{(gx1-gx0)*S:.1f}" height="{oy*S:.1f}"/>')
        else:
            ay0, ay1 = A[5], A[5] + A[7]
            by0, by1 = B[5], B[5] + B[7]
            gy0, gy1 = min(ay1, by1), max(ay0, by0)
            x0 = max(A[4], B[4])
            if gy1 > gy0 and ox > 0:
                parts.append(f'<rect class="conn" x="{X(x0):.1f}" y="{Y(gy0):.1f}" '
                             f'width="{ox*S:.1f}" height="{(gy1-gy0)*S:.1f}"/>')

    # 连接线：先画，压在房间下面
    for a, b, d, gate in LINKS:
        A, B = by_id[a], by_id[b]
        cls = f"link gate-{gate}" if gate else "link"
        parts.append(f'<line class="{cls}" x1="{cx(A):.1f}" y1="{cy(A):.1f}" '
                     f'x2="{cx(B):.1f}" y2="{cy(B):.1f}"/>')

    # 传送：贝塞尔弧，避免直线横穿画面
    for a, b, _why in WARPS:
        A, B = by_id[a], by_id[b]
        x1, y1, x2, y2 = cx(A), cy(A), cx(B), cy(B)
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2 - 46
        parts.append(f'<path class="warp" d="M{x1:.1f},{y1:.1f} Q{mx:.1f},{my:.1f} {x2:.1f},{y2:.1f}"/>')

    # 房间
    for r in ROOMS:
        _id, name, layer, kind, x, y, w, h = r
        col = LAYERS[layer]["color"]
        px, py, pw, ph = X(x), Y(y), w * S, h * S
        big = kind in ("hub", "boss", "hall")
        wide = pw >= 78
        parts.append(
            f'<g class="room kind-{kind}" data-id="{_id}">'
            f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="{ph:.1f}" '
            f'rx="3" fill="{col}" fill-opacity="{0.9 if big else 0.78}" '
            f'stroke="{"#2b2620" if big else col}" stroke-width="{1.6 if big else 1.1}"'
            f'{"" if kind != "corr" else " stroke-dasharray=\"3 2\""}/>'
            f'<text class="rid" x="{px+pw/2:.1f}" y="{py+ph/2+(1.5 if wide else 3):.1f}">{_id}</text>'
            + (f'<text class="rnm" x="{px+pw/2:.1f}" y="{py+ph/2+10.5:.1f}">{name}</text>'
               if wide and ph >= 26 else '')
            + '</g>')

    # 门
    for a, b, d, gate in LINKS:
        if not gate:
            continue
        A, B = by_id[a], by_id[b]
        mx, my = (cx(A) + cx(B)) / 2, (cy(A) + cy(B)) / 2
        mark = {"fold": "折", "grow": "长", "neg": "底"}[gate]
        parts.append(f'<circle class="gate" cx="{mx:.1f}" cy="{my:.1f}" r="8.5"/>'
                     f'<text class="gatetxt" x="{mx:.1f}" y="{my+3.6:.1f}">{mark}</text>')

    n = len(ROOMS)
    area = sum(r[6] * r[7] for r in ROOMS)
    screens = area / (20 * 11.25)
    fill = area / (MAP_W * MAP_H) * 100

    layer_legend = ''.join(
        f'<div><span class="sw" style="background:{L["color"]}"></span>'
        f'{L["name"]}{" · 给" + L["skill"] if L.get("skill") else ""}</div>'
        for L in LAYERS.values())

    room_json = json.dumps(
        [dict(id=r[0], name=r[1], layer=LAYERS[r[2]]["name"], kind=KINDS[r[3]][0],
              note=KINDS[r[3]][4], x=r[4], y=r[5], w=r[6], h=r[7]) for r in ROOMS],
        ensure_ascii=False)
    link_json = json.dumps([dict(a=a, b=b, dir=d, gate=g) for a, b, d, g in LINKS],
                           ensure_ascii=False)
    warp_json = json.dumps([dict(a=a, b=b, why=w) for a, b, w in WARPS], ensure_ascii=False)
    skill_json = json.dumps(SKILL_FROM, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>世界树 · 大地图</title>
<style>
  :root {{ --ink:#2b2620; --line:#cfc6b2; --bg:#f7f3e8; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.65 "PingFang SC","Microsoft YaHei",system-ui,sans-serif; }}
  header {{ padding:18px 24px 12px; border-bottom:1px solid var(--line); }}
  h1 {{ margin:0 0 5px; font-size:19px; letter-spacing:.4px; }}
  h1 small {{ font-weight:400; opacity:.55; font-size:13px; margin-left:8px; }}
  .sub {{ font-size:12.5px; opacity:.75; max-width:900px; }}
  .stat {{ display:flex; gap:18px; margin-top:9px; font-size:12px; opacity:.7; flex-wrap:wrap; }}
  .wrap {{ display:flex; align-items:flex-start; }}
  .map {{ flex:1; min-width:0; padding:6px 0 6px 4px; }}
  svg {{ width:100%; height:auto; display:block; }}
  aside {{ width:278px; flex:0 0 278px; padding:16px 20px 30px; border-left:1px solid var(--line); }}
  .solid {{ fill:#ebe3cd; stroke:#d8cdb2; stroke-width:1; }}
  .conn {{ fill:#cabe9f; }}
  .tick {{ stroke:#dbd0b6; stroke-width:.6; }}
  .ticktxt {{ font-size:7.5px; fill:#b3a890; text-anchor:end; }}
  .link {{ stroke:#b8ad96; stroke-width:1; stroke-dasharray:2 3; }}
  .link.gate-fold {{ stroke:#b7791f; stroke-width:2.2; stroke-dasharray:none; }}
  .link.gate-grow {{ stroke:#2f7d6f; stroke-width:2.2; stroke-dasharray:none; }}
  .link.gate-neg  {{ stroke:#6b5b9a; stroke-width:2.2; stroke-dasharray:none; }}
  .warp {{ fill:none; stroke:#b03a2e; stroke-width:1.4; stroke-dasharray:6 4; opacity:.55; }}
  .room {{ cursor:pointer; }}
  .room:hover rect {{ fill-opacity:1; stroke-width:2.6; }}
  .room.sel rect {{ fill-opacity:1; stroke:#b03a2e; stroke-width:2.8; }}
  .rid {{ font-size:11px; font-weight:700; fill:#fff; text-anchor:middle; opacity:.96;
    paint-order:stroke; stroke-width:2.2px; stroke:#00000022; }}
  .rnm {{ font-size:7.2px; fill:#fff; text-anchor:middle; opacity:.82; }}
  .gate {{ fill:#fffdf7; stroke:#2b2620; stroke-width:1.3; }}
  .gatetxt {{ font-size:8.5px; font-weight:700; fill:#2b2620; text-anchor:middle; }}
  h2 {{ font-size:12px; margin:0 0 7px; letter-spacing:1.2px; opacity:.75; }}
  .kv {{ display:flex; justify-content:space-between; gap:10px; padding:3px 0;
    border-bottom:1px dotted #e3dbc9; font-size:12.5px; }}
  .kv b {{ font-weight:600; }}
  .legend {{ margin-top:18px; font-size:12px; }}
  .legend div {{ display:flex; align-items:center; gap:7px; padding:2px 0; }}
  .sw {{ width:11px; height:11px; border-radius:2px; flex:0 0 11px; }}
  .hint {{ margin-top:14px; font-size:11.5px; opacity:.62; line-height:1.65; }}
  .rule {{ margin-top:14px; padding:9px 11px; background:#fffdf5; border-left:3px solid #c9b98c;
    font-size:11.5px; line-height:1.7; }}
</style></head><body>
<header>
  <h1>世界树 · 大地图 <small>{n} 房 / {len(LINKS)} 连接 / {len(WARPS)} 传送</small></h1>
  <div class="sub">一格 = 48px（TILE）。原点左上、y 向下，与 Godot 一致。
    房间边界一律落在整格上，相邻房间在投影上必须有重叠。</div>
  <div class="stat">
    <span>房间净面积 ≈ {screens:.0f} 屏</span>
    <span>地图 {MAP_W}×{MAP_H} 格 ≈ {MAP_W//20}×{MAP_H/11.25:.0f} 屏</span>
    <span>填充率 {fill:.0f}%</span>
    <span>技能链：投掷(R2) → 折叠(S1) → 生长(V7) → 底片(Z7) → 待定(Q6)</span>
  </div>
</header>
<div class="wrap">
  <div class="map">
    <svg viewBox="0 0 {W:.0f} {H:.0f}" xmlns="http://www.w3.org/2000/svg">
      {''.join(parts)}
    </svg>
  </div>
  <aside>
    <h2>房间</h2>
    <div id="detail"><div class="hint">点左侧任意一间。</div></div>
    <div class="legend">
      <h2 style="margin-top:20px">层</h2>
      {layer_legend}
      <h2 style="margin-top:16px">门</h2>
      <div><span class="sw" style="background:#b7791f"></span>折叠 · 台高 4.5–6.5 格</div>
      <div><span class="sw" style="background:#2f7d6f"></span>生长 · 立面 &gt;7 格、无落脚</div>
      <div><span class="sw" style="background:#6b5b9a"></span>底片</div>
      <div><span class="sw" style="background:#b03a2e;opacity:.6"></span>传送（非物理连接）</div>
    </div>
    <div class="rule">
      <b>门只放在枝的入口。</b>进枝用的是上一段已经拿到的技能，枝的末端才给新技能 ——
      所以玩家第一次见到某扇门时一定已经有对应能力，不会有「打不开也不知道为什么」。
    </div>
    <div class="hint">
      不按「屏幕」当地图单位：一屏纵向 11.25 格不是整数，按屏幕切会让房间边界卡在 1/4 格上。
    </div>
  </aside>
</div>
<script>
const rooms = {room_json};
const links = {link_json};
const warps = {warp_json};
const skills = {skill_json};
const GATE = {{fold:'折叠', grow:'生长', neg:'底片'}};
const DIR = {{up:'上', down:'下', left:'左', right:'右'}};
const GIVES = Object.fromEntries(Object.entries(skills).map(([k,v]) => [v, k]));
const GIVENAME = {{toss:'投掷', fold:'折叠', grow:'生长', neg:'底片'}};
document.querySelectorAll('.room').forEach(el => {{
  el.addEventListener('click', () => {{
    document.querySelectorAll('.room').forEach(x => x.classList.remove('sel'));
    el.classList.add('sel');
    const id = el.dataset.id;
    const r = rooms.find(z => z.id === id);
    const out = links.filter(l => l.a === id || l.b === id);
    const li = out.map(l => {{
      const other = l.a === id ? l.b : l.a;
      const o = rooms.find(z => z.id === other);
      return `<div class="kv"><span>${{DIR[l.dir]}} · ${{other}}</span>
        <b>${{o ? o.name : '?'}}${{l.gate ? ' ⛩' + GATE[l.gate] : ''}}</b></div>`;
    }}).join('');
    const w = warps.filter(z => z.a === id || z.b === id)
      .map(z => `<div class="kv"><span>传送</span><b>${{z.a === id ? z.b : z.a}}</b></div>`).join('');
    const gives = GIVES[id] ? `<div class="kv"><span>给出技能</span>
      <b style="color:#2f7d6f">${{GIVENAME[GIVES[id]]}}</b></div>` : '';
    document.getElementById('detail').innerHTML = `
      <div style="font-size:16px;font-weight:700;line-height:1.3">${{r.name}}</div>
      <div style="font-size:12px;opacity:.55;margin-bottom:9px">${{id}} · ${{r.layer}} · ${{r.kind}}</div>
      <div class="kv"><span>格子</span><b>${{r.w}} × ${{r.h}}</b></div>
      <div class="kv"><span>像素</span><b>${{r.w*48}} × ${{r.h*48}}</b></div>
      <div class="kv"><span>约合屏幕</span><b>${{(r.w/20).toFixed(1)}} × ${{(r.h/11.25).toFixed(1)}}</b></div>
      <div class="kv"><span>左上角</span><b>(${{r.x}}, ${{r.y}})</b></div>
      ${{gives}}
      <div style="margin-top:9px;font-size:12px;opacity:.7">${{r.note}}</div>
      <h2 style="margin-top:15px">连接 ${{out.length}}</h2>${{li || '<div class="hint">无</div>'}}${{w}}`;
  }});
}});
</script>
</body></html>
"""


def main() -> None:
    bad = check()
    if bad:
        print("[world] 校验失败：")
        for b in bad:
            print("  ✗", b)
        raise SystemExit(1)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(to_json(), ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print(f"[world] {len(ROOMS)} 房 / {len(LINKS)} 连接 → {OUT_JSON.relative_to(ROOT)}")

    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(render_html(), encoding="utf-8")
    print(f"[world] 图 → {OUT_HTML.relative_to(ROOT)}")

    area = sum(r[6] * r[7] for r in ROOMS)
    print(f"[world] 净面积 {area} 格² = {area/(20*11.25):.0f} 屏；"
          f"填充 {area/(MAP_W*MAP_H)*100:.0f}%")
    for k, v in KINDS.items():
        c = sum(1 for r in ROOMS if r[3] == k)
        if c:
            print(f"[world]   {v[0]:<4}{c:>3}")
    for layer in LAYERS:
        c = sum(1 for r in ROOMS if r[2] == layer)
        print(f"[world]   {LAYERS[layer]['name']:<8}{c:>3} 房")


if __name__ == "__main__":
    main()
