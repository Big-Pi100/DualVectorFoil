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

## 为什么整张图必须接近方形（V2 重做，2026-11-26）

旧版是 1448×220 格 = **6.58:1**，玩家原话「基本上就是一个横线」。

去量了《月下》正城的实际像素（Dracula's Castle 15648×12032）：

    区域              屏幕数(256x224)   宽/高
    ─────────────────────────────────────────
    全城堡            61.1 x 53.7      1.30   ← 整体接近方形
    Outer Wall 外壁    8.1 x 20.6      0.45   ← 唯一的高瘦型
    Catacombs 墓穴    33.1 x  3.4     11.04   ← 极扁
    Long Library      17.5 x  4.6      4.38
    Marble Gallery    39.1 x 16.0      2.79
    Royal Chapel      28.1 x 21.7      1.48

单个区域的比例从 0.45 跨到 11.04，**差 24 倍**。所以「每个区域都要竖」
是错的 —— 恰恰相反，多数区域是 2–3:1 的横厅。

真正的秘密是：**2–3:1 的横厅，在垂直方向叠了 10 层**。
9.7 倍反差的形状被堆起来，整体自然就是 1.3:1。

旧版错在只堆了 2–3 层，而且所有房间都是 4–5:1 的同一种横条。

结论（本文件的三条硬约束）：
  1. 包围盒长宽比落在 **1.15–1.45**；
  2. 房间形状必须分档：asp < 0.9 / 0.9–1.6 / 1.6–3.5 / > 3.5 四档都要有货；
  3. 垂直方向至少 **8 个不同的 y 带**有房间 —— 这就是「叠了几层」。

## 为什么必须是环，不能是树

矩形布局上的树 = 一棵树 n 个节点只有 n-1 条边 = **数学上不可能有环**。
没有环的地图，玩家永远只有一条路，走多远都是「往前推」，这就是白哥说的
「一个横线」的拓扑根因 —— 不只是长得像，是**结构上就只有一条线**。

《月下》的正城是 13 个区域互咬，区域级就有十几个独立环。
本文件用 `loops = E - V + 1` 直接算独立环数，要求 **≥ 6**。

## 坐标系

原点左上，y 向下（与 Godot 2D 一致）。单位 TILE。
房间之间紧贴或留 ≤12 格。

跑：python tools/worldmap/build_world.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = ROOT / "godot" / "data" / "world_map.json"
OUT_HTML = ROOT / "docs" / "gdd" / "map" / "world_map.html"

TILE = 48
MAP_W, MAP_H = 360, 280

# 层 = 区域。y 区间故意互相重叠：区域本来就是咬在一起的，硬套「层带」
# 会逼着所有房间排成横杠 —— 那正是旧版 6.58:1 的成因。
LAYERS = {
    "canopy": dict(name="冠",     color="#8a7a3a", order=1,
                   note="最高处。终局厅 + 东西双枝 + 冠层回廊（自带一个环）"),
    "trunk":  dict(name="干",     color="#3f6b52", order=2,
                   note="垂直主轴。外壁 / 钟塔 / 礼拜堂三条竖井咬在主井上"),
    "west":   dict(name="西翼",   color="#4a6b8a", order=3,
                   note="藏书廊 + 居所。夹在干的两条横桥之间，是教学用的第一个环"),
    "east":   dict(name="东翼",   color="#8a5b4a", order=4,
                   note="实验室 + 斗技场。从钟室挂下去，末端封死放技能"),
    "root":   dict(name="根",     color="#8a6a4f", order=5,
                   note="出生地。一条 6 段的地下长廊 —— 横着长是对的（《月下》墓穴 11:1）"),
    "deep":   dict(name="深根",   color="#4a4438", order=6,
                   note="最底。竖井 + 墓穴 + 水脉 + 矿坑，末端封死放技能"),
}

# kind = 形状身份，不只是功能。
# (中文, 安全房, 最小宽, 最大宽, 最小高, 最大高, 一句话)
#
# 旧版所有 kind 的 h 上限都是 14–18，等于宣布「不许有竖房间」。
# 现在 spire / well 单列，竖着长是被允许而且被要求的。
KINDS = {
    "safe":   ("安全", True,   40, 120, 11, 20, "无敌人 / 无掉落压力"),
    "combat": ("战斗", False,  36, 120, 11, 24, "净战斗 40–90 秒"),
    "dark":   ("暗房", True,   30, 120, 11, 24, "存档 / 回血 / 耕地"),
    "hub":    ("枢纽", True,   40, 160, 16, 26, "多出口，不安排强制战斗"),
    "boss":   ("Boss", False,  40, 160, 12, 22, "考核房，一次打满 3–5 分钟"),
    "hall":   ("大厅", True,   60, 320, 12, 22, "横向贯通的大空间，天然要横向相机"),
    "corr":   ("走廊", True,   20, 200,  8, 24, "纯连通，不放敌人"),
    "bridge": ("廊桥", True,   60, 140,  8, 14, "细长的横向连接体，跨在竖井之间"),
    "spire":  ("竖塔", False,  20,  52, 28, 60, "高 > 宽。墙面攀爬 / 逐层坠落"),
    "well":   ("竖井", True,   14,  24, 20, 40, "窄到只能上下，是垂直交通的骨骼"),
}

# ── 房间：(id, 名字, 层, 类型, x, y, w, h) ──────────────────────────────
# 包围盒目标：x 16..340（324 格） / y 6..262（256 格） → 1.27:1
ROOMS = [
    # ══ 冠 canopy ═══════════════════════════════════════════════════════
    # 冠自带一个 6 房环路：终厅 → 西枝 → 西塔 → 回廊 → 东塔 → 东枝 → 终厅。
    # 玩家一进冠就能左右绕，不用「只能往前」。
    ("C1", "冠·终厅",   "canopy", "boss",   140,   6,  96, 16),
    ("C2", "冠·西枝",   "canopy", "combat",  52,  10,  88, 14),
    ("C3", "冠·东枝",   "canopy", "combat", 236,  10,  76, 14),
    ("C4", "冠·西塔",   "canopy", "spire",   16,  20,  36, 36),
    ("C5", "冠·东塔",   "canopy", "spire",  300,  24,  36, 32),
    ("C6", "冠·回廊",   "canopy", "hall",    52,  44, 248, 12),
    ("C7", "冠·顶井",   "canopy", "well",   152,  22,  20, 22),

    # ══ 干 trunk ════════════════════════════════════════════════════════
    # 主井 x160-176 从 y74 一路通到 y142（T2+T9，68 格 = 6 屏），
    # 两侧各挂一条横桥（T3/T4），桥头再接竖塔（T7 礼拜堂 / T5 钟塔，58 格高）。
    # 这是《月下》Outer Wall 的做法：竖向交通是骨骼，横厅是器官。
    ("T1",  "干·顶厅",   "trunk", "hub",    152,  56,  40, 18),
    ("T2",  "干·上井",   "trunk", "well",   160,  74,  16, 34),
    ("T3",  "干·西桥",   "trunk", "bridge",  88,  74,  72, 12),
    ("T4",  "干·东桥",   "trunk", "bridge", 176,  74,  76, 12),
    ("T5",  "干·钟塔",   "trunk", "spire",  252,  74,  28, 58),
    ("T6",  "干·钟室",   "trunk", "combat", 246,  58,  36, 14),
    ("T7",  "干·礼拜堂", "trunk", "spire",   88,  86,  36, 46),
    ("T8",  "干·钟顶",   "trunk", "dark",    84,  58,  44, 14),
    ("T9",  "干·下井",   "trunk", "well",   160, 108,  16, 34),
    ("T10", "干·中庭",   "trunk", "hub",    104, 142, 128, 20),
    ("T11", "干·西降",   "trunk", "corr",   104, 170,  20, 16),
    ("T12", "干·东降",   "trunk", "corr",   210, 162,  20, 24),
    ("T13", "干·西桥下", "trunk", "bridge",  40, 174,  64, 12),
    ("T14", "干·东桥下", "trunk", "bridge", 232, 174,  60, 12),
    ("T15", "干·钟塔底", "trunk", "spire",  252, 132,  32, 30),
    ("T16", "干·外壁",   "trunk", "spire",   16,  56,  36, 34),
    ("T17", "干·外壁底", "trunk", "corr",    16,  90,  36, 20),
    ("T18", "干·西联",   "trunk", "corr",    52,  74,  36, 12),

    # ══ 西翼 west ═══════════════════════════════════════════════════════
    # 夹在 T17（上）与 T13（下）之间 → 天然成环，不需要门。
    # 这是玩家遇到的第一个环，用来教「这游戏可以绕回来」。
    ("W1", "西翼·藏书廊", "west", "hall",   16, 110,  68, 14),
    ("W2", "西翼·居所上", "west", "hub",    16, 124,  60, 18),
    ("W3", "西翼·居所下", "west", "combat", 16, 146,  60, 18),

    # ══ 东翼 east ═══════════════════════════════════════════════════════
    # 从钟室（T6）挂下来的一条独立竖链，末端 E2 封死 → 放第二个技能。
    ("E3", "东翼·实验廊", "east", "combat", 284,  58,  52, 14),
    ("E1", "东翼·实验场", "east", "combat", 288,  72,  48, 20),
    ("E2", "东翼·实验底", "east", "combat", 288,  92,  48, 20),
    ("E4", "东翼·斗技场", "east", "boss",   300, 150,  48, 18),
    ("E5", "东翼·底廊",   "east", "corr",   292, 168,  48, 12),

    # ══ 根 root ═════════════════════════════════════════════════════════
    # 6 段横廊，宽 312 格 = 15.6 屏。《月下》的 Catacombs 是 33 屏 x 3.4 屏，
    # 横着长本身没问题 —— 问题只在「整张图只有这一种方向」。
    ("R0", "根·上庭",   "root", "hub",    116, 186, 100, 20),
    ("R1", "根·西降",   "root", "corr",   120, 206,  20, 12),
    ("R2", "根·东降",   "root", "corr",   196, 206,  20, 12),
    ("R3", "根·出生点", "root", "safe",    16, 218,  56, 14),
    # 出生点正下方一条 24 格的死巷 —— 开局第一分钟就能拿投掷，
    # 不用走完 6 段根廊。枝末端（degree=1）是技能房的唯一合法位置。
    ("R3b", "根·须",   "root", "combat",  16, 236,  36, 14),
    ("R4", "根·一",     "root", "combat",  72, 218,  54, 14),
    ("R5", "根·二",     "root", "combat", 130, 218,  48, 14),
    ("R6", "根·三",     "root", "dark",   182, 222,  48, 14),
    ("R7", "根·四",     "root", "combat", 234, 218,  52, 14),
    ("R8", "根·末",     "root", "boss",   290, 214,  40, 16),

    # ══ 深根 deep ═══════════════════════════════════════════════════════
    ("D1", "深·竖井", "deep", "well",   136, 232,  20, 30),
    ("D5", "深·斜井", "deep", "corr",    56, 232,  20, 18),
    ("D2", "深·墓穴", "deep", "boss",    56, 250,  80, 12),
    ("D3", "深·水脉", "deep", "combat", 156, 250, 100, 12),
    ("D4", "深·矿坑", "deep", "combat", 256, 248,  64, 14),
]

START = "R3"

# ── 连接：(a, b, 方向, 门) ────────────────────────────────────────────
# 方向 = 从 a 看过去 b 在哪边。门：None / "toss" / "fold" / "grow" / "neg"
#
# **门只出现在枝的入口**，而且这个技能必须是玩家已经有的。
# 枝的末端才给新技能 —— 所以永远不会「打不开也不知道为什么」。
LINKS = [
    # ── 冠：6 房环路 ──────────────────────────────────────────────
    ("C1", "C2", "left",  "neg"),     # 终厅 ← 西枝，终局门
    ("C1", "C3", "right", "neg"),     # 终厅 ← 东枝，终局门（两条都锁，绕不过）
    ("C1", "C7", "down",  None),
    ("C2", "C4", "left",  None),
    ("C3", "C5", "down",  None),
    ("C4", "C6", "right", None),
    ("C5", "C6", "left",  None),
    ("C6", "C7", "up",    None),

    # 冠 ↔ 干：三条下降口（顶井 / 回廊正中 / 回廊东段）
    ("C6", "T1",  "down", None),
    ("C6", "T6",  "down", None),
    ("C4", "T16", "down", None),

    # ── 干：主井 + 两条横桥 + 两条竖塔 ────────────────────────────
    ("T1", "T2", "down", None),
    ("T1", "T3", "down", None),
    ("T1", "T4", "down", None),
    ("T2", "T4", "right", None),
    ("T2", "T9", "down", None),
    ("T3", "T18", "left", None),
    ("T18", "T16", "left", None),
    ("T3", "T7", "down", None),
    ("T3", "T8", "up",   "toss"),     # 钟顶：封死的枝，给「折叠」
    ("T4", "T5", "right", None),
    ("T4", "T6", "up",   None),
    ("T5", "T6", "up",   None),
    ("T5", "T15", "down", None),
    ("T7", "T10", "down", None),
    ("T9", "T10", "down", None),
    ("T10", "T11", "down", None),
    ("T10", "T12", "down", None),
    ("T11", "T13", "left", None),
    ("T12", "T14", "right", None),
    ("T14", "T15", "up", None),
    ("T16", "T17", "down", None),

    # ── 西翼（无门：教「环」这个概念本身）────────────────────────
    ("T17", "W1", "down", None),
    ("W1", "W2", "down", None),
    ("W2", "W3", "down", None),
    ("W3", "T13", "down", None),

    # ── 东翼：从钟室挂下去的竖链，末端封死 ───────────────────────
    ("T6", "E3", "right", None),
    ("E3", "E1", "down",  None),
    ("E1", "E2", "down",  "fold"),    # 实验底：给「生长」
    ("E4", "E5", "down",  None),
    ("E5", "T14", "left", None),

    # ── 根：上庭两降 + 6 段横廊 ──────────────────────────────────
    ("T11", "R0", "down", None),
    ("T12", "R0", "down", None),
    ("R0", "R1", "down", None),
    ("R0", "R2", "down", None),
    ("R1", "R4", "down", None),
    ("R1", "R5", "down", None),
    ("R2", "R6", "down", None),
    ("R3", "R3b", "down", None),
    ("R3", "R4", "right", None),
    ("R4", "R5", "right", None),
    ("R5", "R6", "right", None),
    ("R6", "R7", "right", None),
    ("R7", "R8", "right", None),

    # ── 深根 ────────────────────────────────────────────────────
    ("R5", "D1", "down", None),
    ("D1", "D2", "left", None),
    ("D1", "D3", "right", None),
    ("R3", "D5", "down", None),
    ("D5", "D2", "down", None),
    ("D3", "D4", "right", "grow"),    # 矿坑：封死，给「底片」
]

# 传送：不是物理连接，所以不进 LINKS（也不参与「相邻」校验）。
# 打完根·末 Boss 后不必重走整条根廊。
WARPS = [("R6", "T1", "根·三 → 干·顶厅。回主干用，不必重走根末 Boss")]

# 技能解锁链：空心 BFS，按这个顺序逐轮放开
UNLOCK_CHAIN = [[], ["toss"], ["fold"], ["grow"], ["neg"]]

# 每个技能由哪个房间给（都必须是封死的枝末端）
SKILL_FROM = {"toss": "R3b", "fold": "T8", "grow": "E2", "neg": "D4"}

# 长宽比目标。上下界不是审美偏好，是量出来的：
#   《月下》正城 1.30 / 主楼 1.39 / 实验室 1.34，最松的礼拜堂 1.48。
ASPECT_MIN, ASPECT_MAX = 1.15, 1.45
MIN_LOOPS = 6           # E - V + 1
MIN_Y_BANDS = 8         # 垂直方向至少叠几层
MIN_OVERLAP = 3         # 门洞至少 3 格宽 = 144px


def rect(r):
    return r[4], r[5], r[4] + r[6], r[5] + r[7]


def overlap(a, b) -> tuple[int, int]:
    ax0, ay0, ax1, ay1 = rect(a)
    bx0, by0, bx1, by1 = rect(b)
    return min(ax1, bx1) - max(ax0, bx0), min(ay1, by1) - max(ay0, by0)


def bbox() -> tuple[int, int, int, int]:
    xs = [r[4] for r in ROOMS] + [r[4] + r[6] for r in ROOMS]
    ys = [r[5] for r in ROOMS] + [r[5] + r[7] for r in ROOMS]
    return min(xs), min(ys), max(xs), max(ys)


def y_bands(n: int = 8, band: int = 24) -> int:
    """把 y 轴切成 band 格高的横带，数有多少条带里有房间。

    「叠了几层」的量化。旧版 220 格高 = 9 条带，但房间只落在 4 条里
    （其余是竖井的同一段），所以看着还是横线。
    """
    hit = set()
    for r in ROOMS:
        for y in range(r[5], r[5] + r[7]):
            hit.add(y // band)
    return len(hit)


def loop_count() -> int:
    """独立环数 = E - V + C（连通分量数）。这里先只算整体，要求连通。"""
    ids = {r[0] for r in ROOMS}
    adj: dict[str, set[str]] = {i: set() for i in ids}
    for a, b, _d, _g in LINKS:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    seen, comps = set(), 0
    for s in ids:
        if s in seen:
            continue
        comps += 1
        stack = [s]
        while stack:
            u = stack.pop()
            if u in seen:
                continue
            seen.add(u)
            stack.extend(adj[u] - seen)
    return len(LINKS) - len(ids) + comps


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

    # 2. 尺寸（按 kind 的形状区间）
    for r in ROOMS:
        _id, _n, _l, kind, x, y, w, h = r
        if kind not in KINDS:
            bad.append(f"{_id} 未知 kind={kind}")
            continue
        kname, _safe, minw, maxw, minh, maxh, _ = KINDS[kind]
        if not (minw <= w <= maxw):
            bad.append(f"{_id} 宽 {w} 超出 {minw}–{maxw}（{kname}）")
        if not (minh <= h <= maxh):
            bad.append(f"{_id} 高 {h} 超出 {minh}–{maxh}（{kname}）")
        if x < 0 or y < 0 or x + w > MAP_W or y + h > MAP_H:
            bad.append(f"{_id} 越出地图边界 {MAP_W}×{MAP_H}")

    # 3. 每个 link 的两端必须真的挨着，且重叠够宽（门洞放得下）
    for a, b, d, gate in LINKS:
        if a not in by_id or b not in by_id:
            bad.append(f"连接 {a}→{b} 有端点不存在")
            continue
        ox, oy = overlap(by_id[a], by_id[b])
        if d in ("right", "left"):
            ok = oy >= MIN_OVERLAP and -12 <= ox <= 0
            detail = f"y 重叠 {oy}"
        elif d in ("up", "down"):
            ok = ox >= MIN_OVERLAP and -12 <= oy <= 0
            detail = f"x 重叠 {ox}"
        else:
            bad.append(f"连接 {a}→{b} 方向非法 {d}")
            continue
        if not ok:
            bad.append(f"连接 {a}→{b}({d}) 不挨着或太窄：{detail}"
                       f"  —— 门洞至少要 {MIN_OVERLAP} 格宽（{MIN_OVERLAP * TILE}px）")

    # 4. 孤立房
    degree: dict[str, int] = {r[0]: 0 for r in ROOMS}
    for a, b, _d, _g in LINKS:
        degree[a] = degree.get(a, 0) + 1
        degree[b] = degree.get(b, 0) + 1
    for rid, deg in degree.items():
        if deg == 0:
            bad.append(f"{rid} 没有任何连接 —— 孤立房间")

    # 5. 可达性：按解锁链逐轮 BFS
    have: set[str] = set()
    reached: set[str] = {START}
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

    # 6. 技能必须来自封死的枝末端 —— 否则玩家可以绕过它去拿下一个
    for skill, rid in SKILL_FROM.items():
        if rid not in by_id:
            bad.append(f"技能 {skill} 的来源 {rid} 不存在")
            continue
        if degree.get(rid, 0) > 1:
            bad.append(f"技能 {skill} 在 {rid}，但它有 {degree[rid]} 条连接"
                       f" —— 枝末端必须是死路，否则可以绕过")

    # 7. 包围盒长宽比 —— 直接对着「太扁」这个病
    x0, y0, x1, y1 = bbox()
    W, H = x1 - x0, y1 - y0
    asp = W / H
    if not (ASPECT_MIN <= asp <= ASPECT_MAX):
        bad.append(f"整图 {W}×{H} 格 = {asp:.2f}:1，超出 {ASPECT_MIN}–{ASPECT_MAX}"
                   f"  —— 《月下》正城是 1.30:1，横条就是「一个横线」")

    # 8. 环数 —— 树的 E-V+1 恒为 0，这条断言直接禁止树形拓扑
    loops = loop_count()
    if loops < MIN_LOOPS:
        bad.append(f"独立环只有 {loops} 个（要求 ≥{MIN_LOOPS}）"
                   f"  —— 树形拓扑 n 个点最多 n-1 条边，永远绕不回来")

    # 9. 垂直堆叠层数
    bands = y_bands()
    if bands < MIN_Y_BANDS:
        bad.append(f"只有 {bands} 条 y 带有房间（要求 ≥{MIN_Y_BANDS}）"
                   f"  —— 房间全挤在同几层，堆不出高度")

    # 10. 形状分档 —— 不允许多数房间是同一种横条
    buckets = {"<0.9": 0, "0.9-1.6": 0, "1.6-3.5": 0, ">3.5": 0}
    for r in ROOMS:
        a = r[6] / r[7]
        if a < 0.9:
            buckets["<0.9"] += 1
        elif a < 1.6:
            buckets["0.9-1.6"] += 1
        elif a < 3.5:
            buckets["1.6-3.5"] += 1
        else:
            buckets[">3.5"] += 1
    empty = [k for k, v in buckets.items() if v < 2]
    if empty:
        bad.append(f"形状档位太单一，以下档位不足 2 间：{empty}（实测 {buckets}）")

    # 11. 每个区域至少 2 条对外连接 —— 单出口的区域就是死胡同
    for layer in LAYERS:
        inner = {r[0] for r in ROOMS if r[2] == layer}
        if not inner:
            bad.append(f"层 {layer} 没有房间")
            continue
        ext = sum(1 for a, b, _d, _g in LINKS
                  if (a in inner) != (b in inner))
        if ext < 2:
            bad.append(f"区域 {LAYERS[layer]['name']} 只有 {ext} 条对外连接"
                       f"  —— 单出口 = 必须原路返回")

    # 12. 「折叠捷径」不成立 —— 否定断言，防止有人把 GDD 原文抄回来
    #     折叠门单次跨越 ≤6.85 格，根系(R8 顶 218) 到主干(T10 底 162) 差 56 格。
    def gap_ok(a, b, max_gap):
        ra, rb = by_id.get(a), by_id.get(b)
        if not ra or not rb:
            return True
        return max(abs(ra[5] - rb[5]), abs(ra[4] - rb[4])) <= max_gap

    if not gap_ok("R8", "T10", 7):
        for a, b, _d, g in LINKS:
            if g == "fold" and {a, b} & {"R8", "T10"}:
                bad.append("折叠门被接在根系与主干之间 —— 垂直差 >7 格，折叠跳不过去")

    return bad


def stats() -> dict:
    x0, y0, x1, y1 = bbox()
    area = sum(r[6] * r[7] for r in ROOMS)
    return dict(
        bbox=(x0, y0, x1, y1),
        width=x1 - x0, height=y1 - y0,
        aspect=(x1 - x0) / (y1 - y0),
        area=area,
        screens=area / (20 * 11.25),
        loops=loop_count(),
        bands=y_bands(),
        rooms=len(ROOMS),
        links=len(LINKS),
    )


def to_json() -> dict:
    st = stats()
    return {
        "meta": {
            "name": "世界树",
            "grid": TILE,
            "width": MAP_W,
            "height": MAP_H,
            "coord": "origin=top-left, y down, unit=TILE(48px)",
            "bbox": {"x": st["bbox"][0], "y": st["bbox"][1],
                     "w": st["width"], "h": st["height"]},
            "aspect": round(st["aspect"], 3),
            "loops": st["loops"],
            "y_bands": st["bands"],
            "start": START,
            "why_tile_not_screen": (
                "一屏 960x540 的纵向 540/48=11.25 不是整数，用屏幕格会让房间边界卡在 1/4 格上。"
                "地图格 = TILE。"),
            "why_square": (
                "《月下》正城 15648x12032 = 1.30:1。单区域比例从外壁 0.45 跨到墓穴 11.04，"
                "靠 2-3:1 的横厅垂直叠 10 层得到整体方形。"),
            "room_count": len(ROOMS),
            "link_count": len(LINKS),
        },
        "layers": LAYERS,
        "kinds": {k: {"name": v[0], "safe": v[1],
                      "min_w": v[2], "max_w": v[3],
                      "min_h": v[4], "max_h": v[5], "note": v[6]}
                  for k, v in KINDS.items()},
        "skill_from": SKILL_FROM,
        "rooms": [
            {
                "id": r[0], "name": r[1], "layer": r[2], "kind": r[3],
                "rect": {"x": r[4], "y": r[5], "w": r[6], "h": r[7]},
                "rect_px": {"x": r[4] * TILE, "y": r[5] * TILE,
                            "w": r[6] * TILE, "h": r[7] * TILE},
                "screens": {"w": round(r[6] / 20, 2), "h": round(r[7] / 11.25, 2)},
                "aspect": round(r[6] / r[7], 2),
            }
            for r in ROOMS
        ],
        "links": [{"from": a, "to": b, "dir": d, "gate": g} for a, b, d, g in LINKS],
        "warps": [{"from": a, "to": b, "why": w} for a, b, w in WARPS],
    }


# ── 图 ────────────────────────────────────────────────────────────────
def render_html() -> str:
    # 形状跨度大（16 格竖井 ↔ 248 格回廊），缩放要够大才看得清窄房间的 id，
    # 又不能让宽房间撑爆页面。2.2 是 248×2.2=546px 能放进 aside 旁的安全值。
    S = 2.2
    by_id = {r[0]: r for r in ROOMS}
    pad = 30
    x0, y0, x1, y1 = bbox()
    BX0, BX1 = x0 - 16, x1 + 16
    BY0, BY1 = y0 - 16, y1 + 16
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

    # 实体层：包围盒填成比背景深一档的"岩体"，房间读起来像从里面挖出来的。
    parts.append(f'<rect class="solid" x="{pad-14:.1f}" y="{pad-14:.1f}" '
                 f'width="{(BX1-BX0)*S+28:.1f}" height="{(BY1-BY0)*S+28:.1f}" rx="10"/>')

    # 每 50 格一条刻度线
    for gy in range(int(BY0 // 50) * 50, int(BY1) + 1, 50):
        y = Y(gy)
        parts.append(f'<line class="tick" x1="{pad-10:.1f}" y1="{y:.1f}" '
                     f'x2="{W-pad+6:.1f}" y2="{y:.1f}"/>')
        parts.append(f'<text class="ticktxt" x="{pad-13:.1f}" y="{y+3.5:.1f}">{gy}</text>')

    # 连接段：把房间之间的空隙填上，读起来才是"连成一片的城堡"而不是"散落的方块"。
    for a, b, d, gate in LINKS:
        A, B = by_id[a], by_id[b]
        ox, oy = overlap(A, B)
        if d in ("left", "right"):
            ax0, ax1 = A[4], A[4] + A[6]
            bx0, bx1 = B[4], B[4] + B[6]
            gx0, gx1 = min(ax1, bx1), max(ax0, bx0)
            yy = max(A[5], B[5])
            if gx1 > gx0 and oy > 0:
                parts.append(f'<rect class="conn" x="{X(gx0):.1f}" y="{Y(yy):.1f}" '
                             f'width="{(gx1-gx0)*S:.1f}" height="{oy*S:.1f}"/>')
        else:
            ay0, ay1 = A[5], A[5] + A[7]
            by0, by1 = B[5], B[5] + B[7]
            gy0, gy1 = min(ay1, by1), max(ay0, by0)
            xx = max(A[4], B[4])
            if gy1 > gy0 and ox > 0:
                parts.append(f'<rect class="conn" x="{X(xx):.1f}" y="{Y(gy0):.1f}" '
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
        show_name = pw >= 56 and ph >= 24
        show_id = pw >= 26 and ph >= 14
        label = f'<text class="rid" x="{px+pw/2:.1f}" y="{py+ph/2+(1.5 if show_name else 3):.1f}">{_id}</text>'
        if show_name:
            label += f'<text class="rnm" x="{px+pw/2:.1f}" y="{py+ph/2+10.5:.1f}">{name}</text>'
        parts.append(
            f'<g class="room kind-{kind}" data-id="{_id}">'
            f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="{ph:.1f}" '
            f'rx="3" fill="{col}" fill-opacity="{0.9 if big else 0.78}" '
            f'stroke="{"#2b2620" if big else col}" stroke-width="{1.6 if big else 1.1}"'
            f'{"" if kind != "corr" else " stroke-dasharray=\"3 2\""}/>'
            + label + '</g>')

    # 门
    for a, b, d, gate in LINKS:
        if not gate:
            continue
        A, B = by_id[a], by_id[b]
        mx, my = (cx(A) + cx(B)) / 2, (cy(A) + cy(B)) / 2
        mark = {"toss": "投", "fold": "折", "grow": "长", "neg": "底"}[gate]
        parts.append(f'<circle class="gate" cx="{mx:.1f}" cy="{my:.1f}" r="8.5"/>'
                     f'<text class="gatetxt" x="{mx:.1f}" y="{my+3.6:.1f}">{mark}</text>')

    st = stats()
    n = st["rooms"]
    fill = st["area"] / (st["width"] * st["height"]) * 100

    layer_legend = ''.join(
        f'<div><span class="sw" style="background:{L["color"]}"></span>'
        f'{L["name"]}</div>'
        for L in LAYERS.values())

    kind_legend = ''.join(
        f'<div><span class="sw" style="background:#fffdf5;border:1px solid #cfc6b2"></span>'
        f'{v[0]} <span style="opacity:.45">{v[2]}–{v[3]}×{v[4]}–{v[5]}</span></div>'
        for v in KINDS.values())

    room_json = json.dumps(
        [dict(id=r[0], name=r[1], layer=LAYERS[r[2]]["name"], kind=KINDS[r[3]][0],
              note=KINDS[r[3]][6], x=r[4], y=r[5], w=r[6], h=r[7],
              asp=round(r[6] / r[7], 2)) for r in ROOMS],
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
  .sub {{ font-size:12.5px; opacity:.75; max-width:940px; }}
  .stat {{ display:flex; gap:18px; margin-top:9px; font-size:12px; opacity:.8; flex-wrap:wrap; }}
  .stat b {{ color:#2f6b52; }}
  .wrap {{ display:flex; align-items:flex-start; }}
  .map {{ flex:1; min-width:0; padding:6px 0 6px 4px; }}
  svg {{ width:100%; height:auto; display:block; }}
  aside {{ width:288px; flex:0 0 288px; padding:16px 20px 30px; border-left:1px solid var(--line); }}
  .solid {{ fill:#ebe3cd; stroke:#d8cdb2; stroke-width:1; }}
  .conn {{ fill:#cabe9f; }}
  .tick {{ stroke:#dbd0b6; stroke-width:.6; }}
  .ticktxt {{ font-size:7.5px; fill:#b3a890; text-anchor:end; }}
  .link {{ stroke:#b8ad96; stroke-width:1; stroke-dasharray:2 3; }}
  .link.gate-toss {{ stroke:#8a5b2a; stroke-width:2.2; stroke-dasharray:none; }}
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
  <h1>世界树 · 大地图 <small>{n} 房 / {st['links']} 连接 / {st['loops']} 个环 / {len(WARPS)} 传送</small></h1>
  <div class="sub">一格 = 48px（TILE）。原点左上、y 向下，与 Godot 一致。
    包围盒 <b>{st['width']}×{st['height']}</b> 格 = <b>{st['aspect']:.2f}:1</b>
    —— 《月下》正城 15648×12032 = 1.30:1。房间形状不统一是刻意的：
    外壁 0.95、墓穴 6.7，靠不同比例叠出高度。</div>
  <div class="stat">
    <span>矩形净面积 ≈ <b>{st['screens']:.0f} 屏</b></span>
    <span>填充率 <b>{fill:.0f}%</b></span>
    <span>垂直堆叠 <b>{st['bands']} 条 y 带</b>（每条 24 格）</span>
    <span>独立环 <b>{st['loops']}</b>（E−V+1）</span>
    <span>技能链：投掷 → 折叠 → 生长 → 底片</span>
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
      <h2 style="margin-top:20px">区域</h2>
      {layer_legend}
      <h2 style="margin-top:16px">形状身份</h2>
      {kind_legend}
      <h2 style="margin-top:16px">门</h2>
      <div><span class="sw" style="background:#8a5b2a"></span>投掷</div>
      <div><span class="sw" style="background:#b7791f"></span>折叠 · 台高 4.5–6.5 格</div>
      <div><span class="sw" style="background:#2f7d6f"></span>生长 · 立面 &gt;7 格、无落脚</div>
      <div><span class="sw" style="background:#6b5b9a"></span>底片</div>
      <div><span class="sw" style="background:#b03a2e;opacity:.6"></span>传送（非物理连接）</div>
    </div>
    <div class="rule">
      <b>门只放在枝的入口，技能只在封死的末端。</b>
      所以玩家第一次见到某扇门时一定已经有对应能力，也不会绕过去提前拿到下一个技能。
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
const GATE = {{toss:'投掷', fold:'折叠', grow:'生长', neg:'底片'}};
const DIR = {{up:'上', down:'下', left:'左', right:'右'}};
const GIVES = Object.fromEntries(Object.entries(skills).map(([k,v]) => [v, k]));
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
      <b style="color:#2f7d6f">${{GATE[GIVES[id]]}}</b></div>` : '';
    document.getElementById('detail').innerHTML = `
      <div style="font-size:16px;font-weight:700;line-height:1.3">${{r.name}}</div>
      <div style="font-size:12px;opacity:.55;margin-bottom:9px">${{id}} · ${{r.layer}} · ${{r.kind}}</div>
      <div class="kv"><span>格子</span><b>${{r.w}} × ${{r.h}}</b></div>
      <div class="kv"><span>长宽比</span><b>${{r.asp}}</b></div>
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
    st = stats()
    print(f"[world] {st['rooms']} 房 / {st['links']} 连接 → {OUT_JSON.relative_to(ROOT)}")

    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(render_html(), encoding="utf-8")
    print(f"[world] 图 → {OUT_HTML.relative_to(ROOT)}")

    print(f"[world] 包围盒 {st['width']}×{st['height']} 格 = {st['aspect']:.2f}:1"
          f"（《月下》1.30）")
    print(f"[world] 净面积 {st['area']} 格² = {st['screens']:.0f} 屏；"
          f"填充 {st['area']/(st['width']*st['height'])*100:.0f}%")
    print(f"[world] 独立环 {st['loops']} 个；垂直堆叠 {st['bands']} 条 y 带")
    for k, v in KINDS.items():
        c = sum(1 for r in ROOMS if r[3] == k)
        if c:
            print(f"[world]   {v[0]:<4}{c:>3}")
    for layer in LAYERS:
        c = sum(1 for r in ROOMS if r[2] == layer)
        print(f"[world]   {LAYERS[layer]['name']:<8}{c:>3} 房")


if __name__ == "__main__":
    main()
