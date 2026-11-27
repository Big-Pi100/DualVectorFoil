#!/usr/bin/env python3
"""场景两态换色 —— 把「一个造型两套色系」从敌人搬到地形上。

敌人那套（`duo_state.py` §3.1）解决的是「同一只生物的两个状态」；
地形这一套解决的是「同一块地的两个状态」：**被占据的堵塞态 ↔ 清完后的恢复态**。
两者是同一个 R3（同形状换色），只是换色的目的不同：

| | 状态换色（敌人） | **状态换色（场景）** |
|---|---|---|
| 换来干什么 | 换一只生物的健康状态 | 换一块地的**归属** |
| 谁决定 | 能不能招安 | 有没有清完（`01 §3` 清区变田） |
| 几何 | 轮廓 IoU ≥0.95（眼睛要重画） | **alpha 逐像素相同**（瓦片几何一动，接缝就断） |

## 判据为什么不能照搬敌人那边

敌人是**单一材质**的生物：一只史莱姆就是一身紫，一条色相带说得清。
场景是**多材质**拼在一起的：草、土、石各有各的色相。

第一版照搬了色带（把所有材质塞进同一条 82–100），结果**石头变成了玉** ——
石砖 H24→H84，出来一块绿砖；石柱更糟，直接变玉雕。这不是参数没调好，是判据错了。

改用三条，全部可量：

| # | 断言 | 为什么是这条 |
|---|---|---|
| 1 | **alpha 逐像素相同** | 瓦片几何一动，拼起来就出缝（敌人那边放宽到 IoU，是因为眼睛必须重画；瓦片没有这个借口） |
| 2 | **色温**：堵塞态冷像素（H150–260）≥0.75，恢复态 ≤0.25 | 不要求任何材质落在某个具体色相上，只要求整块地的冷温，材质关系因此能保留 |
| 3 | **材质不糊**：原图分得开的土/草，输出还得差 ≥25° | 这条正是第一版绿砖的抓点：实测只剩 2° |
| 4 | 饱和 ≤0.36/0.44 | 背景不许比演员艳（现状草皮 S0.63，比史莱姆还艳） |
| 5 | 明度区间 + 恢复态比堵塞态亮 ≥0.08 | 「清干净了」必须有画面回报 |
| 6 | 明度对比度 ≥原图 85% | 蜡笔笔触不许被洗平 |

第 7 条不在 `--check` 里，在 `--matrix`：**20 组演员×场景逐个验**（见下）。

## 为什么要压饱和

实测现状：草皮 S0.63–0.70、V0.74–0.83，**比绝大多数敌人还艳**。
背景比演员艳 = 演员被吃掉。两套场景色都带饱和上限（DARK ≤0.36 / ALLY ≤0.44），
把地形按回「背景层」。

## 演员能不能站上去 —— 参照物只能是「脚下那块」

`--matrix` 第一版拿整块瓦片的主色当参照，报出来的是**土**（占 56%），
于是纸虱（暖金 H36）被判成「和背景只差 14°，读不出」。
可实机里站着的怪物脚下是**草**，土在草皮底下、被角色自己挡住。
参照物选错，判据就会把一个明明看得清的组合判死（合成图里它很清楚）。
所以参照取「草」这个材质的输出色（`surface_hue`）。

## 用法

    python art/tools/scene_state.py                # 只出候选到 art/out/scene/states/
    python art/tools/scene_state.py --approve      # 确认后写进 art/approved/Terrain/
    python art/tools/scene_state.py --check        # 只验 approved 里的两态
    python art/tools/scene_state.py --matrix       # 敌人 × 场景可读性矩阵
    python art/tools/scene_state.py --palette      # 两套场景色系总览图
    python art/tools/scene_state.py --sheet        # 实机尺寸合成图（敌人站在两种地上）
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ART = Path(__file__).resolve().parents[1]
ROOT = ART.parent
TERRAIN_DIR = ART / "approved" / "Terrain"
MANIFEST = ART / "approved" / "manifest.json"
OUT = ART / "out" / "scene"

# 只做**地面件**。两个排除项各有理由，别靠感觉往回调：
#
# | 排除 | 理由 |
# |---|---|
# | `*_200` | R4 整数缩放的派生物（`ASSET_RULES R4`），由基准件重新派生即可 —— 让缩放件也各自出两态，等于同一件事存三份 |
# | `terrain_stone_block` / `pillar` / `bench` / `grass_decor` | **立体摆件，本作不接入**（`ART_GUIDE §12.3`、`README §3`）。它们带顶面/厚度，不进 tilemap、不作地面，也不占两态资产位 |
#
# 摆件这条踩过一次：2026-11-27 之前 `BASE_STEMS` 把四个摆件一起收了，
# 于是「已判定不接入」的 `terrain_stone_block` 又长出了 `_dark` / `_ally`
# 两态并注册进 manifest —— 文档说不接入、磁盘上却有两态资产，两边对不上。
# 现在由 `stray_variants()` 兜底：approved 里出现不属于地面的两态文件就报错。
#
# ============================================================================
# DEPRECATED（2026-11-27）：本工具产出的两态图已被环境光 shader 取代。
# ============================================================================
# 白哥看过实机紫月效果后给的结论是「紫月够紫，不用改了」——方案验收通过。
# 8 张 `_dark` / `_ally` 已移到 `art/_legacy/scene_two_state_2026-11-27/`
# （含 `_WHY_MOVED.md`，写明为什么移、留着有什么价值、怎么回退）。
#
# 取代者：`godot/world/shaders/env_light.gdshader` + `art/tools/env_light.py`
# 契约：`art/ASSET_RULES.md §3.2.6`
#
# **为什么 BASE_STEMS 清空而不是留着**：清单里留 4 个 stem，`--check` 就会去验
# 4 个已不存在的基准件 → 报「缺基准件」；把检查改成"跳过缺失"更糟，那是把
# 失败伪装成通过。清空 + DEPRECATED 拦截，是唯一诚实的写法。
#
# **为什么 --check 在空清单时必须 exit 2**：`for stem in BASE_STEMS` 遍历空列表
# → 一条断言都不跑 → `errs` 为空 → 打印 PASS。这是"空集合上做全称判断永远为真"，
# 本项目已经踩过三次（5 种敌人磁盘只有 3 种、空矩阵假通过、BASE_STEMS 漏野文件）。
# 一个静静报 PASS 的废止工具，比没有这个工具更危险。
#
# 回退办法见 `art/_legacy/scene_two_state_2026-11-27/_WHY_MOVED.md`：
# 把图 checkout 回去，然后把下面这个开关改回 False。
DEPRECATED = True
DEPRECATED_WHY = "两态方案已被 env_light 环境光取代（ASSET_RULES §3.2.6，2026-11-27 验收通过）"

BASE_STEMS: list[str] = []
# 废止前的清单（回退时恢复这一段，并把 DEPRECATED 改为 False）：
#     "terrain_grass_top",   # 草皮母版（ground_* 由它裁切）
#     "ground_left",
#     "ground_mid",
#     "ground_right",

# ---------------------------------------------------------------- 两套场景色系

SCENE: dict[str, dict] = {
    "dark": dict(
        cn="堵塞态",
        why="导管堵了、叶绿素退了 —— 冷、湿、没有光。所有材质往冷端搬，"
            "但**保留材质之间的色相差**（土/石 → 深蓝 222°，草 → 青 188°），"
            "所以石头还是石头、草还是草，不是把整块地泡进同一个染缸",
        cold=(0.75, 1.01),          # 冷像素（H150–260）占比必须落在这个区间
        s_max=0.36,
        v_range=(0.40, 0.62),
        # (源色相 lo, hi, 目标色相, 饱和倍率, 明度 a, 明度 b)  v' = a*v + b
        zones=[
            (0, 42, 222, 0.55, 1.00, -0.19),     # 土 / 石 / 树皮棕 → 深蓝（蜡笔盒 5 号）
            (42, 108, 188, 0.52, 1.00, -0.19),   # 草 / 黄绿 → 冷青
            (108, 360, 205, 0.55, 1.00, -0.19),  # 苔绿及余项
        ],
        fallback=(205, 0.55, 1.00, -0.19),
    ),
    "ally": dict(
        cn="恢复态",
        why="糖在流、苔在长 —— 暖木 + 苔绿。草从荧光黄绿（H45）退回蜡笔盒定义的"
            "**苔绿 #4F6B3A（H95）**，土/石留在土褐一带（H32）；"
            "压饱和只为把地按回背景层，不改材质关系",
        cold=(-0.01, 0.25),
        s_max=0.44,
        v_range=(0.52, 0.78),
        zones=[
            (0, 42, 22, 0.76, 1.00, -0.03),      # 土 / 石 / 树皮棕 → 红壤土褐（蜡笔盒 9 号偏红）
            (42, 108, 96, 0.64, 1.00, -0.08),    # 草 / 黄绿 → 苔绿（蜡笔盒 11 号）
            (108, 360, 80, 0.68, 1.00, -0.06),
        ],
        fallback=(80, 0.68, 1.00, -0.06),
    ),
}

SAT_GATE = 0.08          # 无彩色（纸白高光 / 炭黑描边）不换色：那是蜡笔的明暗骨架
MIN_CMP_KEEP = 0.85      # 明度对比度不得低于原图 85%（低于此笔触被洗平 = 褪色）
MIN_STATE_COLD = 0.50    # 两态的"冷像素占比"至少差 0.50 —— 这是尺度而非色相
MIN_STATE_V = 0.08       # 恢复态必须比堵塞态亮至少 0.08
MAT_MIN_GAP = 25.0       # 材质之间至少差 25°：低于这个数，草和土就糊成一片
MAT_MIN_SHARE = 0.12     # 第二材质至少占 12% 才算"一个材质"
MIN_ACTOR_HUE = 40.0     # 演员 vs 场景的色相安全距离
MIN_ACTOR_V = 0.15       # 色相不够近时的替代判据：明度差
MIN_ACTOR_S = 0.10       # 同上：饱和差


# ---------------------------------------------------------------- 基础工具

def _duo():
    """复用 duo_state 的 HSV 与敌人度量 —— 两条产线不能各算一套色相。"""
    spec = importlib.util.spec_from_file_location("duo_state", ART / "tools" / "duo_state.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


DUO = _duo()


def stats(im: Image.Image) -> dict:
    """场景量度。**色相按面积取众数，不做位置加权。**

    和 `duo_state.metrics` 的区别就在这一条：那边是精灵，身体在画布中心，
    高斯位置加权能把外围的刺/脚压下去；这边是瓦片，整张都是内容，
    "中心更重要的"这个前提不成立。
    """
    a = np.array(im.convert("RGBA"))
    vis = a[..., 3] > 16
    if not vis.any():
        return dict(hue=0.0, sat=0.0, vavg=0.0, cmp=0.0, n=0)

    h, s, v = DUO._to_hsv(a[..., :3])
    sel = vis & (s > SAT_GATE) & (v > 0.12)
    if sel.sum() >= 20:
        hv, sv = h[sel], s[sel]
        best_c, best_n = 0.0, -1
        for c in range(0, 360, 10):
            n_ = int((np.abs(((hv - c + 180.0) % 360.0) - 180.0) <= 30).sum())
            if n_ > best_n:
                best_c, best_n = float(c), n_
        near = np.abs(((hv - best_c + 180.0) % 360.0) - 180.0) <= 30
        ang = np.deg2rad(hv[near])
        hue = float(np.rad2deg(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360)
        sat = float(sv[near].mean())
    else:
        hue, sat = 0.0, 0.0

    vv = v[vis]
    lo, hi = float(np.percentile(vv, 5)), float(np.percentile(vv, 95))
    return dict(hue=hue, sat=sat, vavg=float(vv.mean()), cmp=hi - lo, n=int(vis.sum()))


COLD_WEDGE = (150.0, 260.0)   # "冷" 的色相范围：青 → 蓝 → 靛


def cold_ratio(im: Image.Image) -> float:
    """冷像素占比。**这是场景两态的主判据，替代敌人那边的"色相带"。**

    为什么不沿用色相带：敌人是单一材质的生物，一只一个主色，一条带说得清；
    场景是多材质拼在一起 —— 草、土、石各有各的色相。第一版硬把所有材质
    塞进同一条带（82–100），结果**石头变成了玉**（实测石砖 H24→H84，
    出来后是一块绿砖）。色相带这个判据从敌人搬到这里就是不成立的。

    改用「冷像素占比」：它不要求任何材质落在某个具体色相上，
    只要求**整块地的色温**落在冷端还是暖端。材质关系因此可以保留。
    """
    a = np.array(im.convert("RGBA"))
    vis = a[..., 3] > 16
    if not vis.any():
        return 0.0
    h, s, v = DUO._to_hsv(a[..., :3])
    chrom = vis & (s > SAT_GATE) & (v > 0.12)
    if chrom.sum() < 20:
        return 0.0
    hv = h[chrom]
    return float(((hv >= COLD_WEDGE[0]) & (hv <= COLD_WEDGE[1])).mean())


MAT_ZONES = {"土/石": (0.0, 42.0), "草": (42.0, 108.0)}


def material_gap(base: Image.Image, out: Image.Image) -> tuple[float, dict]:
    """两个材质在输出里还差多少度。**拿原图的色相分区当掩膜**，不靠猜。

    为什么不用色相直方图找双峰：实测每个文件都会在"离主峰 40°"处报出一个假峰
    （10° 宽的桶，取隔一个桶就够 35°），而石凳这种单材质件也报 40°，
    到了输出又变成 0° —— 那个数在测噪声，不在测材质。

    改成按**原图**的色相分区做掩膜，量输出里两块的色相重心：
    源像素是哪些，输出里就还是哪些，中间没有任何"找峰"的猜测。

    返回 (角距, {材质: (输出色相, 占比)})。占比不足 MAT_MIN_SHARE 的材质不参与。
    """
    b = np.array(base.convert("RGBA"))
    o = np.array(out.convert("RGBA"))
    vis = b[..., 3] > 16
    hb, sb, vb = DUO._to_hsv(b[..., :3])
    ho = DUO._to_hsv(o[..., :3])[0]
    chrom = vis & (sb > SAT_GATE) & (vb > 0.12)
    if chrom.sum() < 50:
        return 0.0, {}

    info: dict[str, tuple[float, float]] = {}
    for name, (lo, hi) in MAT_ZONES.items():
        m = chrom & DUO._hue_in(hb, lo, hi)
        share = float(m.sum() / chrom.sum())
        if share < MAT_MIN_SHARE:
            continue
        ang = np.deg2rad(ho[m])
        info[name] = (float(np.rad2deg(np.arctan2(np.sin(ang).mean(),
                                                  np.cos(ang).mean())) % 360), share)

    if len(info) < 2:
        return 0.0, info
    a, c = list(info.values())[0][0], list(info.values())[1][0]
    return abs(((a - c + 180.0) % 360.0) - 180.0), info


def transform(im: Image.Image, pal: dict) -> Image.Image:
    """按源色相分区搬到目标色相；饱和乘、明度仿射。**alpha 一个字节都不动。**

    明度只做**加法平移**（`a` 恒为 1.00），这是量出来的结论不是偏好：

    | 做法 | 结果 |
    |---|---|
    | 乘法 `v×0.74` | 对比度 0.53→0.38（保留 **72%**），八个文件全部 FAIL —— 那是 §3.1.1 的褪色 |
    | 加法 `v−0.19` | 对比度 **分毫不动**（加常数不改差值），暗部 p5 0.45→0.26 仍有层次 |

    乘法会按比例压缩**差值**，压在亮部看起来是"变柔"，压在暗部就是"笔触没了"。
    场景瓦片的值域本来就顶到 1.00（纸白高光），乘法一压，整块地的明暗关系同比例缩小，
    蜡笔的深浅就成了一条窄带 —— 和敌人那次的坑是同一个。

    **代价要写清**：加法把整块地往下平移，`p1` 会从 0.31 掉到 0.12 附近。
    也就是说最深的 1% 像素被压到接近黑。这些像素在瓦片上就是描边和缝，
    本来也该是最深的 —— 可接受，且 `v_range` 下限 0.42 拦着，不让自己越推越黑。
    """
    a = np.array(im.convert("RGBA"))
    alpha = a[..., 3].copy()
    rgb = a[..., :3]
    h, s, v = DUO._to_hsv(rgb)

    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    hit = np.zeros(h.shape, bool)

    for lo, hi, to, ks, va, vb in pal["zones"]:
        m = DUO._hue_in(h, lo, hi) & ~hit
        h2[m] = to
        s2[m] = np.clip(s[m] * ks, 0, 0.92)
        v2[m] = np.clip(v[m] * va + vb, 0, 1)
        hit |= m

    to, ks, va, vb = pal["fallback"]
    m = ~hit
    h2[m] = to
    s2[m] = np.clip(s[m] * ks, 0, 0.92)
    v2[m] = np.clip(v[m] * va + vb, 0, 1)

    out_rgb = DUO._from_hsv(h2, s2, v2)
    # 无彩色（纸白高光、炭黑描边）不染 —— 蜡笔的高光是纸本身透出来的
    # （`STYLE_LOCK L0.5.3`：lightest areas left uncoloured so the base shows through）
    plain = s < SAT_GATE
    out_rgb[plain] = rgb[plain]

    return Image.fromarray(np.dstack([out_rgb, alpha]), "RGBA")


def variant_path(stem: str, state: str) -> Path:
    return TERRAIN_DIR / f"{stem}_{state}.png"


def base_path(stem: str) -> Path:
    return TERRAIN_DIR / f"{stem}.png"


# ---------------------------------------------------------------- 断言

def verify(base: Image.Image, dark: Image.Image, ally: Image.Image, name: str) -> list[str]:
    errs: list[str] = []
    bm = stats(base)

    for state, im in (("dark", dark), ("ally", ally)):
        pal = SCENE[state]

        if im.size != base.size:
            errs.append(f"{name}[{state}]: 尺寸 {im.size} ≠ 原图 {base.size}")

        ba, aa = np.array(base.convert("RGBA"))[..., 3], np.array(im.convert("RGBA"))[..., 3]
        if not np.array_equal(ba, aa):
            errs.append(
                f"{name}[{state}]: alpha 有 {int((ba != aa).sum())} px 不同 —— "
                "瓦片几何一动，拼起来就出缝")

        m = stats(im)
        cr = cold_ratio(im)
        lo, hi = pal["cold"]
        if not (lo <= cr <= hi):
            errs.append(
                f"{name}[{state}]: 冷像素占比 {cr:.2f} 不在 {lo:.2f}–{hi:.2f} —— "
                f"这一态应当{'偏冷' if state == 'dark' else '偏暖'}")

        if m["sat"] > pal["s_max"]:
            errs.append(
                f"{name}[{state}]: 饱和 {m['sat']:.2f} > 上限 {pal['s_max']:.2f} —— "
                "背景比演员艳，演员会被吃掉")
        if not (pal["v_range"][0] <= m["vavg"] <= pal["v_range"][1]):
            errs.append(
                f"{name}[{state}]: 明度 V{m['vavg']:.2f} 不在 "
                f"{pal['v_range'][0]:.2f}–{pal['v_range'][1]:.2f}")

        if bm["cmp"] > 0 and m["cmp"] < bm["cmp"] * MIN_CMP_KEEP:
            errs.append(
                f"{name}[{state}]: 明度对比度 {bm['cmp']:.2f} → {m['cmp']:.2f}"
                f"（保留 {m['cmp'] / bm['cmp'] * 100:.0f}%）—— 蜡笔笔触被洗平")

        # 材质不能糊：原图分得开的两个材质，输出还得分开
        gap, info = material_gap(base, im)
        if len(info) >= 2 and gap < MAT_MIN_GAP:
            errs.append(
                f"{name}[{state}]: 材质只剩 {gap:.0f}° 差距"
                f"（{' / '.join(f'{k} H{v[0]:.0f}' for k, v in info.items())}）"
                f" —— 低于 {MAT_MIN_GAP:.0f}°，草和土糊成一片")

    dm, am = stats(dark), stats(ally)
    dc, ac = cold_ratio(dark), cold_ratio(ally)
    if (dc - ac) < MIN_STATE_COLD:
        errs.append(
            f"{name}: 两态冷像素占比只差 {dc - ac:.2f}（下限 {MIN_STATE_COLD:.2f}）"
            " —— 玩家分不出「清干净了」和「还堵着」")
    if (am["vavg"] - dm["vavg"]) < MIN_STATE_V:
        errs.append(
            f"{name}: 恢复态只比堵塞态亮 {am['vavg'] - dm['vavg']:.2f}"
            f"（下限 {MIN_STATE_V:.2f}）—— 清理没有任何画面回报")

    return errs


def stray_variants() -> list[str]:
    """approved 里不该存在的两态文件。**这条是防"废弃件又长回来"的。**

    起因：`terrain_stone_block` 在 `ART_GUIDE §12.3` / `README §3` 里判定
    「本作不接入」，可它一度出了 `_dark` / `_ally` 两态并注册进 manifest。
    文档和磁盘各说各话，而且没有一条断言会抓到 —— 因为 `--check` 只遍历
    `BASE_STEMS`，**不在清单里的文件它根本不看**（空集合上做全称判断永远为真，
    这个坑本项目栽过第三次）。

    所以反过来查：磁盘上有哪些 `*_dark` / `*_ally`，减去 `BASE_STEMS` 该有的，
    剩下的就是野生的。多一个都算 FAIL，不靠人眼。
    """
    expect = {f"{s}_{st}.png" for s in BASE_STEMS for st in ("dark", "ally")}
    errs = []
    for p in sorted(TERRAIN_DIR.glob("*_dark.png")) + sorted(TERRAIN_DIR.glob("*_ally.png")):
        if p.name not in expect:
            stem = p.stem.rsplit("_", 1)[0]
            why = "（立体摆件，本作不接入）" if stem.startswith("terrain_") else ""
            errs.append(
                f"{p.name}: 不属于地面件的两态资产{why} —— "
                "要么删掉，要么把 stem 加进 BASE_STEMS 并写清理由")
    return errs


def seam_check() -> list[str]:
    """底板接缝不变量。**换色是逐像素纯函数，所以接缝必然保持** —— 这条是守它的。

    但守的同时必须**报出真实存在的缺陷**：`ground_left/right` 与 `ground_mid`
    的相邻边并不相等（实测最大差 141、平均 17，144 行里只有 7 行相同），
    manifest 里那句「右缘与 ground_mid 左缘逐像素相等」是假的。
    """
    errs: list[str] = []
    a = {k: np.array(Image.open(base_path(k)).convert("RGBA"))
         for k in ("ground_left", "ground_mid", "ground_right")}

    if not np.array_equal(a["ground_mid"][:, 0], a["ground_mid"][:, -1]):
        errs.append("ground_mid: 左列 ≠ 右列 —— 自身不能无限重复")
    if not np.array_equal(a["ground_left"], a["ground_right"][:, ::-1]):
        errs.append("ground_left ≠ mirror(ground_right) —— 两端不是镜像关系")

    return errs


def seam_facts() -> list[str]:
    """接缝的**已知缺陷**（不改，只如实报）。断言不该假装它不存在。"""
    a = {k: np.array(Image.open(base_path(k)).convert("RGBA")).astype(int)
         for k in ("ground_left", "ground_mid", "ground_right")}
    out = []
    for tag, x, y in (("left右缘|mid左缘", a["ground_left"][:, -1], a["ground_mid"][:, 0]),
                      ("mid右缘|right左缘", a["ground_mid"][:, -1], a["ground_right"][:, 0])):
        d = np.abs(x - y).max(1)
        out.append(f"{tag}: 最大差 {int(d.max())} 平均 {d.mean():.1f} "
                   f"相同行 {int((d == 0).sum())}/{len(d)}")
    return out


# ---------------------------------------------------------------- 可读性矩阵

def surface_hue(state: str) -> float:
    """演员**脚下那块**材质的色相 —— 不是整块瓦片的主色。

    第一版拿 `stats(ground_mid)` 当参照，报出来的是**土**（占 56%），
    于是纸虱（暖金 H36）被判成「和背景只差 14°，读不出」。
    可实机里站着的怪物脚下是**草**，土在草皮底下、被角色自己挡住 ——
    参照物选错了，判据就会把一个看得清的组合判死（合成图里它明明很清楚）。

    所以参照取「草」这个材质的输出色；单材质件（石砖/石柱）才退回整块主色。
    """
    p = variant_path("ground_mid", state)
    base = base_path("ground_mid")
    if not p.exists():
        return -1.0
    gap, info = material_gap(Image.open(base), Image.open(p))
    if "草" in info:
        return info["草"][0]
    return stats(Image.open(p))["hue"]


def readability_matrix() -> tuple[list[str], list[str]]:
    """每个敌人态 × 每个场景态。这是「场景换色」唯一真正的风险点：
    地换了色，站在上面的敌人还在不在。"""
    enemy_dir = ART / "approved" / "Enemies"
    keys = []
    for p in sorted(enemy_dir.glob("enemy_*_00_sprite.png")):
        parts = p.stem.split("_")
        keys.append((parts[1], "dark" if parts[2] == "idle" else "ally"))

    rows, errs = [], []
    missing = [st for st in ("dark", "ally") if not variant_path("ground_mid", st).exists()]
    if missing:
        # 缺文件时必须报错，不能 continue。第一版写的是 continue，
        # 于是 approved 里一个场景态都没有时，矩阵是**空的**，却印了"20 组全部通过"。
        # 空集合上做全称判断永远为真 —— 这条以前栽过（"文档说 5 种、磁盘只有 3 种"）。
        return rows, [f"场景态缺 {'/'.join(missing)} —— 矩阵无从计算，先跑 --approve"]

    ref = {st: surface_hue(st) for st in ("dark", "ally")}

    for sp, estate in keys:
        e = Image.open(enemy_dir / f"enemy_{sp}_{'idle' if estate == 'dark' else 'ally'}_00_sprite.png")
        em = DUO.metrics(e)
        for sstate in ("dark", "ally"):
            dh = abs(((em["hue"] - ref[sstate] + 180.0) % 360.0) - 180.0)
            dv = em["vavg"] - stats(Image.open(variant_path("ground_mid", sstate)))["vavg"]
            ds = em["sat"] - stats(Image.open(variant_path("ground_mid", sstate)))["sat"]
            ok = dh >= MIN_ACTOR_HUE or (dv >= MIN_ACTOR_V and ds >= MIN_ACTOR_S)
            rows.append(
                f"{sp:<6}{estate:<5} on {sstate:<5}  "
                f"ΔH{dh:5.0f}°  ΔV{dv:+5.2f}  ΔS{ds:+5.2f}  "
                f"{'OK' if ok else 'FAIL'}")
            if not ok:
                errs.append(
                    f"{sp}[{estate}] 站在场景[{sstate}]上读不出："
                    f"ΔH{dh:.0f}° < {MIN_ACTOR_HUE:.0f}° 且 ΔV{dv:+.2f}/ΔS{ds:+.2f} 不够")
    return rows, errs


# ---------------------------------------------------------------- 出图

def _font(sz: int):
    for p in (r"C:\Windows\Fonts\msyh.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


def _hsv_rgb(h: float, s: float, v: float) -> tuple[int, int, int]:
    r, g, b = DUO._from_hsv(np.array([h]), np.array([s]), np.array([v]))[0]
    return int(r), int(g), int(b)


def palette_sheet() -> Path:
    """两套场景色系总览。色条上标的是**材质**，不是一条统一的带 ——
    「一个场景一条带」这个想法本身就是第一版失败的原因。"""
    W, H = 900, 420
    im = Image.new("RGB", (W, H), (245, 242, 235))
    d = ImageDraw.Draw(im)
    f_t, f_s, f_m = _font(21), _font(14), _font(15)

    bar_x, bar_w, bar_h = 56, W - 112, 26
    for i, state in enumerate(("dark", "ally")):
        pal = SCENE[state]
        y0 = 22 + i * 200
        d.text((40, y0), f"SCENE {state.upper()}  ·  {pal['cn']}", font=f_t, fill=(40, 34, 30))
        d.text((40, y0 + 26),
               f"冷像素占比 {'≥0.75' if state == 'dark' else '≤0.25'}"
               f"　饱和 ≤{pal['s_max']:.2f}"
               f"　明度 {pal['v_range'][0]:.2f}–{pal['v_range'][1]:.2f}",
               font=f_s, fill=(110, 100, 92))

        by = y0 + 56
        for x in range(bar_w):
            d.line([(bar_x + x, by), (bar_x + x, by + bar_h)],
                   fill=_hsv_rgb(x / bar_w * 360, 0.50, 0.70))
        c1 = bar_x + int(COLD_WEDGE[0] / 360 * bar_w)
        c2 = bar_x + int(COLD_WEDGE[1] / 360 * bar_w)
        d.rectangle([c1, by - 5, c2, by + bar_h + 5], outline=(60, 90, 130), width=2)
        for k, (_lo, _hi, to, *_rest) in enumerate(pal["zones"][:2]):
            tx = bar_x + int(to / 360 * bar_w)
            d.line([(tx, by - 9), (tx, by + bar_h + 9)], fill=(30, 26, 24), width=2)
        for x, lab in ((0, "0"), (90, "90"), (180, "180"), (270, "270"), (359, "360")):
            d.text((bar_x + x / 360 * bar_w - 8, by + bar_h + 7), lab, font=f_s,
                   fill=(150, 140, 130))

        # 图例单列一行：所有标注放在同一条线上，互不压字
        legend = f"□ 冷区 H{COLD_WEDGE[0]:.0f}–{COLD_WEDGE[1]:.0f}"
        for k, (_lo, _hi, to, *_rest) in enumerate(pal["zones"][:2]):
            legend += f"　│ {('土/石' if k == 0 else '草')} H{to:.0f}"
        d.text((40, by + bar_h + 28), legend, font=f_s, fill=(70, 62, 55))

        pv = variant_path("ground_mid", state)
        if pv.exists():
            mm, cr = stats(Image.open(pv)), cold_ratio(Image.open(pv))
            d.text((40, by + bar_h + 50),
                   f"实测 ground_mid：冷 {cr:.2f}　S{mm['sat']:.2f}　V{mm['vavg']:.2f}　"
                   f"对比度 {mm['cmp']:.2f}",
                   font=f_m, fill=(48, 42, 37))

    p = OUT / "_scene_palette.png"
    im.save(p)
    return p


def scene_sheet() -> Path:
    """实机尺寸合成：**四种组合全摆出来**，因为判据是 20 组而不是 4 组。

    场景两态 × 演员两态。只摆「同态配对」（黑暗的地配暗黑敌人）会漏掉真正危险的组合：
    刚招安的亮色原住民站在还没清的暗地上、或者暗黑敌人爬进已经清干净的地，
    这两种在玩法里都会发生（`03 §6` 招安、`03 §7` 守田）。
    """
    W, PANEL_H = 960, 240
    cols = [("dark", "dark"), ("dark", "ally"), ("ally", "dark"), ("ally", "ally")]

    tiles: dict[str, Image.Image] = {}
    for st in ("dark", "ally"):
        p = variant_path("ground_mid", st)
        tiles[st] = Image.open(p if p.exists() else base_path("ground_mid")).convert("RGBA")

    sheet = Image.new("RGBA", (W, PANEL_H * len(cols) + 6 * (len(cols) - 1)),
                      (232, 220, 190, 255))
    d = ImageDraw.Draw(sheet)
    f = _font(16)
    floor = 190

    for i, (sstate, estate) in enumerate(cols):
        y0 = i * (PANEL_H + 6)
        band = Image.new("RGBA", (W, PANEL_H), (232, 220, 190, 255))
        gm = tiles[sstate]
        for x in range(0, W, gm.width):
            band.alpha_composite(gm, (x, floor))
            band.alpha_composite(gm, (x, floor + gm.height))
        for j, n in enumerate(["slime", "bat", "spike", "lice", "ink"]):
            e = Image.open(ART / "approved" / "Enemies" /
                           f"enemy_{n}_{'idle' if estate == 'dark' else 'ally'}_00_sprite.png"
                           ).convert("RGBA")
            band.alpha_composite(e, (30 + j * 180, floor - 87))
        sheet.alpha_composite(band, (0, y0))
        d.text((12, y0 + 8),
               f"SCENE {sstate.upper()} · {SCENE[sstate]['cn']}　＋　"
               f"演员 {'DARK 暗黑态' if estate == 'dark' else 'ALLY 解放态'}",
               font=f, fill=(40, 34, 30))

    p = OUT / "_scene_readability.png"
    sheet.convert("RGB").save(p)
    return p


# ---------------------------------------------------------------- 主流程

def main() -> int:
    args = set(sys.argv[1:])
    unknown = args - {"--check", "--approve", "--matrix", "--palette", "--sheet", "--probe"}
    if unknown:
        print(f"不认识的参数 {sorted(unknown)}")
        print("支持 --check / --approve / --matrix / --palette / --sheet / --probe")
        return 2

    # 停用拦截必须放在最前面：BASE_STEMS 已清空，继续往下走会"遍历 0 个件 → 0 个错
    # → 打印 PASS"，把废止伪装成健康。exit 2 而不是 0，是为了不骗任何脚本/CI。
    if DEPRECATED:
        print(f"[scene_state] 已停用：{DEPRECATED_WHY}")
        print("  替代品：python art/tools/env_light.py --check")
        print("  8 张两态图已移到 art/_legacy/scene_two_state_2026-11-27/")
        print("  真要回退：把图 checkout 回来，再把 scene_state.py 的 DEPRECATED 改为 False")
        return 2

    missing = [s for s in BASE_STEMS if not base_path(s).exists()]
    if missing:
        print(f"缺基准件：{missing}")
        return 2

    # ---- probe
    if "--probe" in args:
        for stem in BASE_STEMS:
            bs = stats(Image.open(base_path(stem)))
            print(f"{stem:<24} H{bs['hue']:6.1f} S{bs['sat']:.2f} "
                  f"V{bs['vavg']:.2f} cmp{bs['cmp']:.2f}")
        return 0

    produce = not any(f in args for f in ("--check", "--palette", "--sheet", "--matrix"))
    errs: list[str] = []

    for stem in BASE_STEMS:
        base = Image.open(base_path(stem)).convert("RGBA")
        paths = {s: variant_path(stem, s) for s in ("dark", "ally")}

        if "--check" in args:
            if not all(p.exists() for p in paths.values()):
                errs.append(f"{stem}: 缺 {'/'.join(s for s, p in paths.items() if not p.exists())} 版")
                continue
            imgs = {s: Image.open(p).convert("RGBA") for s, p in paths.items()}
        elif produce:
            imgs = {s: transform(base, SCENE[s]) for s in ("dark", "ally")}
            if "--approve" in args:
                for s, im in imgs.items():
                    paths[s].parent.mkdir(parents=True, exist_ok=True)
                    im.save(paths[s])
                print(f"  approve → {stem}_dark / {stem}_ally")
            else:
                cand = OUT / "states"
                cand.mkdir(parents=True, exist_ok=True)
                for s, im in imgs.items():
                    im.save(cand / paths[s].name)
        else:
            continue

        errs += verify(base, imgs["dark"], imgs["ally"], stem)

    # ---- 接缝（只验 approved 里的基准件，与两态无关）
    if "--check" in args:
        errs += seam_check()
        errs += stray_variants()

    if errs:
        print("\n".join("FAIL  " + e for e in errs))
        print(f"\n{len(errs)} 处不合格")
        return 1

    if "--check" in args:
        print(f"PASS  {len(BASE_STEMS)} 个基准件 × 2 态：几何逐像素同、色温分开、"
              "材质没糊、饱和/明度/对比度全在")
        for line in seam_facts():
            print(f"  [已知缺陷] {line}")

    if "--matrix" in args:
        rows, merrs = readability_matrix()
        print("\n演员 × 场景 可读性矩阵（ΔH≥40° 或 ΔV≥0.15 且 ΔS≥0.10）")
        print("\n".join("  " + r for r in rows))
        if merrs:
            print("\n".join("FAIL  " + e for e in merrs))
            return 1
        print(f"  {len(rows)} 组全部通过")

    if "--palette" in args:
        p = palette_sheet()
        print(f"\n  场景两套色系 → {p}")

    if "--sheet" in args:
        p = scene_sheet()
        print(f"  实机合成 → {p}")

    if produce and "--approve" not in args:
        print(f"\n  候选已出到 {OUT / 'states'}（未写 approved，确认后加 --approve）")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
