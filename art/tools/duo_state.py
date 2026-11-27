#!/usr/bin/env python3
"""duo_state.py —— 一套造型，两套色系（怪物态 ↔ 原住民态）的唯一产出入

## 这个工具解决什么

2026-11-27 白哥定：**原住民就是树上的动物，有怪物和原住民两种形态**
（史莱姆-小精灵、暗黑蝙蝠-粉色蝙蝠），要求
**「完全同样造型的两套色系的美术资产」**。

一套 sprite + 一次换色 = 两个形态，美术量不翻倍。

## 为什么不是「提亮去饱和」（v2 的错，留档）

v2 用的是 `v' = 1-(1-v)(1-lift)` + `s' = s×0.42`。实测三张：

| 敌人 | Δ色相 | Δ饱和 | 明度对比度 |
|---|---|---|---|
| slime | +5.4° | −58% | 0.95 → 0.43 |
| bat   | +5.5° | −58% | 0.95 → 0.43 |
| spike | +5.4° | −58% | 0.78 → 0.35 |

色相只挪了 5 度 —— **肉眼认不出是"另一个颜色"，只认得出"变淡了"**。
白哥原话：「你只是让精灵图整个颜色变淡了，并没有真的改变颜色，是褪色不是变色。」

技术上为什么必然如此：`v'=1-(1-v)(1-lift)` 是**往白里推**，暗部 v=0.28 被抬到 0.68、
亮部 0.47→0.76，差值从 0.19 压到 0.08 —— **对比度塌了**。对比度一塌，
蜡笔的笔触肌理就没有了，剩下的一片淡色只能读作"蒙了层白纱"。

> **褪色 = 往白推（压缩对比度 + 降饱和）**
> **换色 = 换色相（对比度与饱和另算）**
> 这两件事在公式上长得像，结果完全不同。判据是色相位移，不是亮度。

## v3 的做法：色相分区映射

先把 dark 版的色相分布量出来（`--probe`），找出它的**色相锚点**：
主体色、暗部、点缀色（眼睛/刺）各在哪个色相区间。然后**给每只敌人配一张色卡**，
把每个锚点搬到一个**明确指定的目标色相**上。

以史莱姆为例（实测：主体 H300-330 淡紫 60%、背光 H255-290 冷紫 14%、眼嘴 H0-30 暗红棕 7%）：

| dark 锚点 | 是什么 | → ally 目标 | 为什么 |
|---|---|---|---|
| H292-352 淡紫 | 主体 | **H148 嫩芽绿**（S×1.85） | 草叶精灵；原饱和仅 0.19，不放大读不出绿 |
| H250-292 冷紫 | 背光面 | **H122 青绿** | 比主体冷而深，立体感留着 |
| H352-62 暗红棕 | 眼睛/嘴 | **H44 蜜金** | 暗红棕是"凶"的来源，蜜金是小精灵的眼 |

三条硬规矩：
1. **色调真变**：主体色相位移 ≥ 60°。少于这个数，人眼判为"同一个颜色的深浅"。
2. **饱和不许塌**：`S_ally ≥ S_dark × 0.85`。要"粉""绿"这些有彩色感的名字，
   靠的是饱和不是亮度 —— 史莱姆原 S 只有 0.19，必须 ×1.85 才叫绿。
3. **明度对比度不许塌**：`(Vp95−Vp5)_ally ≥ (Vp95−Vp5)_dark × 0.85`。
   这条直接封死 v2 那条路 —— 往白推必塌。

明度只用**加法平移**（`v+add`），不做乘性压缩：平移是平移整段，
区间宽度不变，对比度天然保住；乘性/往白推会按 v 缩放，暗部被抬得比亮部多，层次就糊了。

## 同造型怎么保证（四条断言，不靠肉眼）

1. 尺寸相同
2. **alpha 掩码逐像素相同** —— 改一个像素的轮廓就等于"不是同一个造型"
3. alpha 数值分布相同（半透明边缘也不能动，否则缩放时边缘发毛）
4. 上述三条色彩断言（色调/饱和/对比度）

RGB 全变、alpha 一个字节不动 ⇒ 轮廓逐像素一致 ⇒ 是同一只生物换了皮。

## 它做不到什么

色系能表达**「同一只生物的状态」**，不能表达**「另一种气质」**。

眼睛的形状没变：`enemy_*_ally` 的眼睛还是 dark 版那双（竖瞳、凶的眉）。
史莱姆靠"圆 + 软"能过；蝙蝠靠颜色过不了 —— 深紫红凶眼换成樱粉还是凶眼。
**色系管状态，眼睛管情绪。** 第二套眼睛（瞳圆化、瞳仁放大）是明确的欠账，
见 `art/ASSET_RULES.md §3.1`「待做」，不在本工具范围内。

## 用法

    python art/tools/duo_state.py            # 生成到 art/out/duo/hue/（**不碰 approved**）
    python art/tools/duo_state.py --approve  # 确认要上换色版时才写进 approved
    python art/tools/duo_state.py --check    # 只验 approved 里的 ally 是否满足全部断言
    python art/tools/duo_state.py --sheet    # 额外输出对比图到 art/out/duo/_sheet.png
    python art/tools/duo_state.py --probe    # 打印每只敌人的色相直方图（调色卡用）

新增敌人时：先 `--probe` 看到它的锚点，再在 `PALETTES` 里加一张色卡。
**没色卡就硬报错，不猜** —— 用默认参数换色等于让工具替你做美术决策。
"""

from __future__ import annotations

import colorsys
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ART = Path(__file__).resolve().parents[1]
ROOT = ART.parent
MANIFEST = ART / "approved" / "manifest.json"
ENEMY_DIR = ART / "approved" / "Enemies"      # ally 版是**资产**，不是临时产物
SHEET_DIR = ART / "out" / "duo"               # 对比图才是临时产物

ENEMY_CATEGORY = "Enemies"

# 断言阈值 —— 三条都直接对应"褪色 vs 变色"的分界线
MIN_HUE_SHIFT = 60.0      # 主体色相至少挪 60°（30° 内人眼判为"同色深浅"）
MIN_SAT_KEEP = 0.85       # 饱和不许比原来低过 15%
MIN_CMP_KEEP = 0.85       # 明度对比度不许比原来低过 15%
SAT_GATE = 0.08           # S 低于此视为无彩色（白高光/黑描边），不参与换色

# ── 两套色系（2026-11-27 白哥定：「把两个状态各自的色系定下来，做明显的风格区分」）──
#
# 风格区分不能靠"亮一点/暗一点"：slime 的暗黑态本来 V 就 0.71（淡紫，不暗），
# spike 两态 V 都是 0.73。明度和饱和都分不开。**能分开的只有色相。**
#
#   暗黑态 = 紫靛带 H215-322 —— 三只实测 220 / 250 / 312，全在带内。
#            这是「黑色素沉积」的色相指纹：无论原物种什么颜色，被改写后一律发紫。
#   解放态 = 四条自然色带 —— 每只挑一条，且不许重复（这棵树有很多种居民，
#            全挤在同一个色才叫没有风格）。
#
# 两条带相邻但**不重叠**（水蓝带上限 212 < 暗带下限 215），所以判定互不打架。
DARK_HUE_BAND = (215.0, 322.0)
ALLY_HUE_BANDS = [
    (20.0, 62.0),    # 暖金 / 蜜 —— 火、秋叶、花粉
    (88.0, 175.0),   # 嫩绿 / 薄荷 —— 草、芽、叶
    (180.0, 212.0),  # 水蓝 / 天蓝 —— 水、露、晨雾
    (325.0, 355.0),  # 樱粉 / 玫 —— 花、果、腮
]
ALLY_MIN_SAT = 0.40       # 解放态饱和下限：低于这个数读作"灰"，v2 是 0.14
ALLY_MIN_V = 0.60         # 解放态明度下限：原住民是活物，不许做成暗部

# ── 色卡 ────────────────────────────────────────────────────────────
# zones: (dark_lo, dark_hi, target_h, sat_k, v_add)
#   dark_lo > dark_hi 表示跨 0° 环绕（如 (352, 62) = 352~360 与 0~62）
#   target_h : 目标色相（度）
#   sat_k    : 饱和倍率（>1 提饱和 —— 把"淡紫"变成读得出名字的"绿"）
#   v_add    : 明度加法平移（只抬暗图；加法保留对比度，不用乘性压缩）
# fallback : 没落进任何 zone 的像素（极少）用的 (target_h, sat_k, v_add)
#
# 每条 zone 的 lo/hi 都是 `--probe` 量出来的，不是估的。
PALETTES: dict[str, dict] = {
    "slime": dict(
        species="小精灵",
        eye_h=208,
        why="淡紫 → 淡蓝（水精灵）。原 S 仅 0.19，×2.1 才读得出蓝；眼嘴暗红棕 → 蜜金，和蓝差 160° 所以眼睛跳出来",
        zones=[
            (250, 292, 198, 1.55, 0.00),   # 背光冷紫 → 深蓝（同色相偏深，立体感靠明度）
            (292, 352, 208, 2.10, 0.02),   # 主体淡紫 → 淡蓝
            (352, 62,   44, 1.70, 0.10),   # 眼/嘴暗红棕 → 蜜金
        ],
        fallback=(208, 2.10, 0.02),
    ),
    "bat": dict(
        species="粉翼蝠",
        eye_h=342,
        why="深紫蓝 → 樱粉。原 V 0.46 太暗，+0.22 让粉亮起来；紫高光同色相只提亮提饱和，靠明暗分层次而不是靠色相；金黄眼本来就可爱，保留",
        zones=[
            (222, 300, 342, 1.55, 0.22),   # 主体深紫蓝 → 樱粉
            (300, 352, 342, 1.20, 0.30),   # 紫高光 → 同色相更亮更淡的粉
            (352, 62,   48, 1.60, 0.02),   # 金黄眼 → 保持金黄
        ],
        fallback=(342, 1.55, 0.22),
    ),
    "spike": dict(
        species="绒刺球",
        eye_h=148,
        why="亮蓝 → 薄荷绿，红刺 → 暖橙（不加明度，否则刺被洗淡）。身体与刺换后仍差 112°，刺不会糊进身体",
        zones=[
            (205, 258, 148, 1.05, 0.02),   # 主体亮蓝 → 薄荷绿
            (258, 342, 136, 1.20, 0.02),   # 蓝紫暗边 → 深绿
            (342, 62,   28, 1.40, 0.00),   # 红刺 → 暖橙（不提亮，保住刺的浓度）
        ],
        fallback=(148, 1.05, 0.02),
    ),
}


# ── HSV（自己写，不引 cv2：这个工程只依赖 PIL + numpy） ──────────────
def _to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    f = rgb.astype(np.float32) / 255.0
    mx, mn = f.max(-1), f.min(-1)
    d = mx - mn
    v = mx
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    idx = m & (mx == r)
    h[idx] = ((g - b)[idx] / d[idx]) % 6
    idx = m & (mx == g)
    h[idx] = ((b - r)[idx] / d[idx]) + 2
    idx = m & (mx == b)
    h[idx] = ((r - g)[idx] / d[idx]) + 4
    return h * 60.0, s, v


def _from_hsv(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    hh = (h % 360.0) / 60.0
    i = np.floor(hh).astype(int) % 6
    f = hh - np.floor(hh)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    out = np.zeros(v.shape + (3,), np.float32)
    table = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    for k, (R, G, B) in enumerate(table):
        m = i == k
        out[..., 0][m], out[..., 1][m], out[..., 2][m] = R[m], G[m], B[m]
    return (np.clip(out, 0, 1) * 255).round().astype(np.uint8)


def _hue_in(h: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """色相区间判定；lo>hi 表示跨 0° 环绕。"""
    if lo <= hi:
        return (h >= lo) & (h < hi)
    return (h >= lo) | (h < hi)


def transform(im: Image.Image, card: dict) -> Image.Image:
    """dark → ally。只动 RGB，**alpha 原样搬过去**（这是"同造型"的硬保证）。"""
    a = np.array(im.convert("RGBA"))
    rgb, alpha = a[..., :3].copy(), a[..., 3].copy()
    h, s, v = _to_hsv(rgb)

    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    hit = np.zeros(h.shape, bool)

    for lo, hi, to_h, sat_k, v_add in card["zones"]:
        m = _hue_in(h, lo, hi) & ~hit
        h2[m] = to_h
        s2[m] = np.clip(s[m] * sat_k, 0, 0.98)
        v2[m] = np.clip(v[m] + v_add, 0, 1)
        hit |= m

    if (~hit).any():
        to_h, sat_k, v_add = card["fallback"]
        m = ~hit
        h2[m] = to_h
        s2[m] = np.clip(s[m] * sat_k, 0, 0.98)
        v2[m] = np.clip(v[m] + v_add, 0, 1)

    # 无彩色像素（白高光 / 黑描边）不换色 —— 它们是蜡笔画的明暗骨架，
    # 染了色反而脏。
    plain = s < SAT_GATE
    out_rgb = _from_hsv(h2, s2, v2)
    out_rgb[plain] = rgb[plain]

    # ── 眼珠同色化 ──────────────────────────────────────────────
    # 上面那一步把「黑眼珠」和「黑描边」一起跳过了，但两者视觉后果相反：
    # 描边是该留在轮廓上的骨架；眼珠留成死黑，就会变成「绿身子 + 一双眼白里的黑点」，
    # 读作凶。判据用**到 alpha 边缘的距离**：描边贴着边，眼珠在内部。
    # 不动形状、不动 alpha —— 只把眼珠从死黑换成目标色系的深版，让它属于这套色。
    inside = _erode(alpha > 128, it=3)
    aperture = inside & (v < 0.34) & (s < 0.40)
    if aperture.any():
        n = int(aperture.sum())
        out_rgb[aperture] = _from_hsv(
            np.full(n, float(card["eye_h"])),
            np.clip(s[aperture] * 2.2 + 0.30, 0.25, 0.62),
            np.full(n, 0.26))

    return Image.fromarray(np.dstack([out_rgb, alpha]), "RGBA")


def _erode(mask: np.ndarray, it: int = 1) -> np.ndarray:
    """3×3 腐蚀（不引 scipy）。用来区分「贴边的描边」和「内部的眼珠」。"""
    m = mask.copy()
    for _ in range(it):
        p = np.pad(m, 1, constant_values=False)
        m = m & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return m


# ── 指标（断言和报表共用同一套算法，不搞两套口径） ──────────────────
def metrics(im: Image.Image) -> dict:
    """一次算齐色相/饱和/明度。色相只看**中心区域的滑窗众数**（见下）。"""
    a = np.array(im.convert("RGBA"))
    vis = a[..., 3] > 16
    if not vis.any():
        return dict(hue=0.0, sat=0.0, vlo=0.0, vhi=0.0, vavg=0.0, cmp=0.0, n=0)

    h2, s2, v2 = _to_hsv(a[..., :3])

    # 主体色相 = **中心区域 + 60° 滑窗 + 按像素数**（三条都是踩出来的）
    # 1. 只看中心：刺球外圈全是橙刺、蝙蝠脚是橙的。按全图算会被刺带走 ——
    #    spike 的 ally 被判成 20°，Δ色相算出 164° 这种荒唐值。
    # 2. 滑窗不用单桶：bat 的紫横跨 240-330，单桶最大值只有 26%，会被相邻桶分票。
    # 3. 不按饱和度加权：bat 的橙脚更饱和，加权后反而赢过紫的身体。
    #    （更早一次是"全体加权平均被紫高光+黄眼拉到 285°，Δ 只算出 59.1° 卡在门槛外"。）
    hh, ww = h2.shape
    # 位置权重：越靠中心越高（高斯）。为什么不用"中心矩形"——
    # spike 球体的中心恰好是最亮的浅绿（饱和低），而饱和高的是外围橙刺；
    # 切矩形会把身体切掉、只剩刺。高斯加权是平滑的折中：
    # 身体在中心拿到高权重，刺/脚在外围权重低，谁也不至于被整块切走。
    gy, gx = np.mgrid[0:hh, 0:ww]
    wgt = np.exp(-(((gy - hh / 2) / (hh * 0.34)) ** 2
                   + ((gx - ww / 2) / (ww * 0.34)) ** 2))
    wsel = vis & (s2 > SAT_GATE) & (v2 > 0.18)
    if wsel.sum() >= 20:
        hv, sv, wv = h2[wsel], s2[wsel], wgt[wsel]
        best_c, best_w = 0.0, -1.0
        for c in range(0, 360, 10):
            m_ = np.abs(((hv - c + 180.0) % 360.0) - 180.0) <= 30
            w_ = float(wv[m_].sum())
            if w_ > best_w:
                best_c, best_w = float(c), w_
        near = np.abs(((hv - best_c + 180.0) % 360.0) - 180.0) <= 30
        ang = np.deg2rad(hv[near])
        hue = float(np.rad2deg(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360)
        sat = float((sv[near] * wv[near]).sum() / max(wv[near].sum(), 1e-6))
    else:
        hue, sat = 0.0, 0.0

    vv = v2[vis]
    lo, hi = float(np.percentile(vv, 5)), float(np.percentile(vv, 95))
    return dict(hue=hue, sat=sat, vlo=lo, vhi=hi, vavg=float(vv.mean()),
                cmp=hi - lo, n=int(vis.sum()))


def _in_band(h: float, band: tuple[float, float]) -> bool:
    return band[0] <= h <= band[1]


def outline_iou(a_img: Image.Image, b_img: Image.Image, n: int = 128) -> float:
    """两版轮廓的交并比。换色版恒为 1.0（alpha 逐像素同），生成版实测 ~0.96。"""
    def m(img):
        al = np.array(img.convert("RGBA"))[..., 3] > 40
        ys, xs = np.nonzero(al)
        if not len(ys):
            return np.zeros((n, n), bool)
        sub = al[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        return np.array(Image.fromarray((sub * 255).astype(np.uint8))
                        .resize((n, n), Image.LANCZOS)) > 128
    a, b = m(a_img), m(b_img)
    return float((a & b).sum() / max((a | b).sum(), 1))


MIN_IOU = 0.95    # 生成版轮廓下限。宁可松这一档，也不要为了 alpha 一致放弃「可爱」


def _hue_delta(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


# ── 断言 ────────────────────────────────────────────────────────────
def verify(dark: Image.Image, ally: Image.Image, name: str) -> list[str]:
    errs = []
    d = np.array(dark.convert("RGBA"))
    a = np.array(ally.convert("RGBA"))

    if d.shape != a.shape:
        return [f"{name}: 尺寸变了 {d.shape} → {a.shape} —— 不是同一个造型"]

    ad, aa = d[..., 3], a[..., 3]
    same_outline = bool(np.array_equal(ad, aa))
    # 轮廓判据分两档：换色版 alpha 逐像素同（IoU = 1.0）；生成版允许 ≤5% 差异。
    # 为什么放这一档：凶感来自眼型（斜杏/竖瞳/两瞳对视），那是形状不是 RGB，
    # 换色永远做不到「可爱」。2026-11-27 白哥：「扣不了就生成也可以」。
    if not same_outline:
        iou = outline_iou(dark, ally)
        diff = int((ad != aa).sum())
        if iou < MIN_IOU:
            errs.append(
                f"{name}: 轮廓 IoU {iou:.3f} < {MIN_IOU}（alpha 差 {diff} px）"
                " —— 变形超出『同一只』的范围")

    md, ma = metrics(dark), metrics(ally)

    # ① 色调必须真变 —— 这条是"褪色 vs 变色"的分水岭
    dh = _hue_delta(md["hue"], ma["hue"])
    if dh < MIN_HUE_SHIFT:
        errs.append(
            f"{name}: 色相只挪了 {dh:.1f}°（要求 ≥{MIN_HUE_SHIFT:.0f}°）"
            f" {md['hue']:.0f}°→{ma['hue']:.0f}° —— 这是褪色不是换色系")

    # ② 饱和不许塌 —— 只对**换色版**要求"不低于原图的 85%"。
    # 生成版是重画的，色系来自目标带而不是继承 dark，所以改用绝对下限 ALLY_MIN_SAT
    # （下面 ④ 里那条），否则 spike 的亮蓝(0.65)会把薄荷绿(0.52)判成"砍了饱和"。
    if same_outline and md["sat"] > SAT_GATE and ma["sat"] < md["sat"] * MIN_SAT_KEEP:
        errs.append(
            f"{name}: 饱和被砍 {ma['sat'] / md['sat'] * 100:.0f}%"
            f"（{md['sat']:.2f}→{ma['sat']:.2f}，下限 {MIN_SAT_KEEP * 100:.0f}%）"
            " —— 又走回'蒙白纱'那条路")

    # ③ 明度对比度不许塌（v2 就是死在这条上）
    if same_outline and md["cmp"] > 0 and ma["cmp"] < md["cmp"] * MIN_CMP_KEEP:
        errs.append(
            f"{name}: 明度对比度从 {md['cmp']:.2f} 塌到 {ma['cmp']:.2f}"
            f"（保留 {ma['cmp'] / md['cmp'] * 100:.0f}%，下限 {MIN_CMP_KEEP * 100:.0f}%）"
            " —— 蜡笔笔触会被洗平")

    # ④ 两态各自的色系（风格区分的硬判据，不是"看着不一样就行"）
    if not _in_band(md["hue"], DARK_HUE_BAND):
        errs.append(
            f"{name}: 暗黑态主体色相 {md['hue']:.0f}° 不在紫靛带 "
            f"{DARK_HUE_BAND[0]:.0f}-{DARK_HUE_BAND[1]:.0f}° —— 被改写的东西一律发紫，"
            "生图时就该把这个色相按住")

    hit_band = next((b for b in ALLY_HUE_BANDS if _in_band(ma["hue"], b)), None)
    if hit_band is None:
        bands = " / ".join(f"{b[0]:.0f}-{b[1]:.0f}°" for b in ALLY_HUE_BANDS)
        errs.append(
            f"{name}: 解放态主体色相 {ma['hue']:.0f}° 不在任何自然色带（{bands}）"
            " —— 原住民必须是自然色，不是'淡一点的紫'")

    if ma["sat"] < ALLY_MIN_SAT:
        errs.append(
            f"{name}: 解放态饱和 {ma['sat']:.2f} 低于下限 {ALLY_MIN_SAT} —— 读作灰，不是活物")

    if ma["vavg"] < ALLY_MIN_V:
        errs.append(
            f"{name}: 解放态整体明度 {ma['vavg']:.2f} 低于下限 {ALLY_MIN_V} —— 原住民不许压暗")

    return errs


# ── 清点路径 ────────────────────────────────────────────────────────
def enemy_sources() -> list[tuple[str, Path]]:
    """从 manifest 里取敌人 sprite。缺 manifest 条目就是硬错误，不猜目录。"""
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    out = []
    for key, ent in sorted(data.items()):
        if ent.get("category") != ENEMY_CATEGORY:
            continue
        if not key.endswith("_sprite"):
            continue
        # 自己的输出不能再当输入：ally 版一旦入库，它也会出现在 manifest 里。
        # 少了这一行，工具会把 ally 当 dark 再变换一次，然后拿它跟自己比。
        # （2026-11-27 踩过一次）
        if "_ally_" in key:
            continue
        src = ROOT / ent["approved"]
        if not src.exists():
            raise SystemExit(f"manifest 指向的敌人在哪？ {src} 不存在")
        out.append((key, src))
    if not out:
        raise SystemExit("manifest 里一个 Enemies/*_sprite 都没有 —— 敌人产线还没接")
    return out


def species_of(key: str) -> str:
    m = re.match(r"enemy_([a-z0-9]+)_[a-z]+_\d+_sprite$", key)
    if not m:
        raise SystemExit(f"敌人 sprite 名字不合规范：{key}（应为 enemy_<物种>_<状态>_<帧>_sprite）")
    return m.group(1)


def ally_path(key: str) -> Path:
    """enemy_slime_idle_00_sprite → enemy_slime_ally_00_sprite

    命名沿用资产规范，只把状态位换成 `ally` —— 这样它天然落在 `ART_INVENTORY`
    的同一个格子里，不会变成"另一套命名体系"。
    """
    m = re.match(r"(enemy_[a-z0-9]+)_[a-z]+_(\d+)_sprite$", key)
    if not m:
        raise SystemExit(f"敌人 sprite 名字不合规范：{key}（应为 enemy_<物种>_<状态>_<帧>_sprite）")
    return ENEMY_DIR / f"{m.group(1)}_ally_{m.group(2)}_sprite.png"


# 五个物种的中文名（GDD 05 §5 / 02 §5.3 同源）。色卡只管走**换色产线**的物种；
# 走生图产线的物种没有色卡，靠 ally_from_gen.py 的 TARGET_HUE —— 但它们在
# `--check` 里仍要参与同一份断言，所以名字必须能取到。
SPECIES_CN = {
    "slime": "小精灵", "bat": "粉翼蝠", "spike": "绒刺球",
    "lice": "纸虱", "ink": "露珠虫",
}


def card_of(key: str) -> dict:
    sp = species_of(key)
    if sp in PALETTES:
        return PALETTES[sp]
    if sp not in SPECIES_CN:
        raise SystemExit(f"未知物种 {sp}：既没色卡也不在 SPECIES_CN 里，不猜")
    return dict(species=SPECIES_CN[sp], why="生图产线（ally_from_gen.py）", generated=True)


# ── probe：量色相锚点（配色卡时的依据） ─────────────────────────────
def probe(srcs: list[tuple[str, Path]]) -> None:
    for key, src in srcs:
        a = np.array(Image.open(src).convert("RGBA"))
        m = a[..., 3] > 200
        px = a[..., :3][m] / 255.0
        hsv = np.array([colorsys.rgb_to_hsv(*r) for r in px])
        h, s, v = hsv[:, 0] * 360, hsv[:, 1], hsv[:, 2]
        sent = s >= SAT_GATE
        tot = int(sent.sum())
        print("=" * 70)
        print(f"{key}   可见 {int(m.sum())} px / 有色 {tot} px ({tot / max(m.sum(), 1) * 100:.0f}%)")
        if not tot:
            continue
        hh, ss, vv = h[sent], s[sent], v[sent]
        bins = np.histogram(hh, bins=24, range=(0, 360))[0]
        for i, c in enumerate(bins):
            if c / tot <= 0.02:
                continue
            sel = (hh >= i * 15) & (hh < (i + 1) * 15)
            print(f"  H{i * 15:3d}-{i * 15 + 15:3d}  {c / tot * 100:5.1f}%"
                  f"   S{ss[sel].mean():.2f}  V{vv[sel].mean():.2f}  Vmax{vv[sel].max():.2f}")


def _font(sz: int):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def _hsv_rgb(h: float, s: float, v: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360.0, s, v)
    return int(r * 255), int(g * 255), int(b * 255)


def palette_sheet(rows) -> Path:
    """两套色系总览：色相带 + 每只的实际主色 + 实测数字。

    这张图就是「色系定下来了」的凭据 —— 后续新增敌人照着带往里放，
    不用再问"到底该多亮多鲜"。上下两块不重叠，一眼看得出风格区分在哪。
    """
    W, H = 960, 520
    im = Image.new("RGB", (W, H), (250, 246, 236))
    d = ImageDraw.Draw(im)
    f_t, f_m, f_s = _font(20), _font(15), _font(13)

    bar_x, bar_w, bar_h = 152, 430, 30

    def block(y0: int, title: str, sub: str, bands, rows_of, which: int):
        d.text((28, y0), title, font=f_t, fill=(40, 34, 30))
        d.text((28, y0 + 26), sub, font=f_s, fill=(120, 110, 100))

        by = y0 + 46
        for x in range(bar_w):                       # 360° 色相条
            d.line([(bar_x + x, by), (bar_x + x, by + bar_h)],
                   fill=_hsv_rgb(x / bar_w * 360, 0.85, 0.95))
        for lo, hi in bands:                          # 该态允许的色带
            x1 = bar_x + int(lo / 360 * bar_w)
            x2 = bar_x + int(hi / 360 * bar_w)
            d.rectangle([x1, by - 5, x2, by + bar_h + 5], outline=(30, 26, 24), width=2)
        for x, lab in ((0, "0"), (90, "90"), (180, "180"), (270, "270"), (359, "360")):
            d.text((bar_x + x / 360 * bar_w - 8, by + bar_h + 8), lab, font=f_s,
                   fill=(140, 130, 120))

        for i, (key, _d, _a, card, _e) in enumerate(rows_of):
            md = metrics(_d if which == 1 else _a)
            ry = by + 62 + i * 26
            col = _hsv_rgb(md["hue"], max(md["sat"], 0.18), min(max(md["vavg"], 0.45), 0.95))
            d.ellipse([28, ry, 44, ry + 16], fill=col, outline=(60, 52, 46))
            d.text((52, ry - 1),
                   f"{card['species']:<8s} H{md['hue']:5.0f}°  S{md['sat']:.2f}  V{md['vavg']:.2f}",
                   font=f_m, fill=(40, 34, 30))

    block(26, "DARK  ·  暗黑态（被改写）",
          "紫靛带 H215-322 —— 不管原物种什么颜色，被注入黑色素后一律发紫",
          [DARK_HUE_BAND], rows, 1)
    block(276, "ALLY  ·  解放态（本来的样子）",
          "四条自然色带，同带最多 2 种（须近亲）—— 这棵树有很多种居民",
          ALLY_HUE_BANDS, rows, 2)

    d.line([(28, 262), (W - 28, 262)], fill=(210, 200, 188))
    p = SHEET_DIR / "_palette.png"
    im.save(p)
    return p


def main() -> int:
    args = set(sys.argv[1:])
    unknown = args - {"--check", "--sheet", "--probe", "--palette", "--approve"}
    if unknown:
        print(f"不认识的参数 {sorted(unknown)}；支持 --check / --sheet / --probe / --palette / --approve")
        return 2

    ENEMY_DIR.mkdir(parents=True, exist_ok=True)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    srcs = enemy_sources()

    if "--probe" in args:
        probe(srcs)
        return 0

    errs: list[str] = []
    rows = []
    # 只有"纯产出"（不带任何查看开关）才动文件。--palette/--sheet 只是画图，
    # 不该顺手重算候选，更不该因为遇到生图物种就炸掉整张总览图。
    produce = not any(f in args for f in ("--check", "--palette", "--sheet", "--probe"))

    for key, src in srcs:
        dark = Image.open(src).convert("RGBA")
        dst = ally_path(key)
        card = card_of(key)
        if "--check" in args or not produce:
            if not dst.exists():
                errs.append(f"{key}: 还没生成 {dst.name} —— 跑一次不带 --check 的")
                continue
            ally = Image.open(dst).convert("RGBA")
        else:
            if card.get("generated"):
                raise SystemExit(
                    f"{key}: {card['species']} 没有色卡 —— 它走的是生图产线。"
                    "换色救不了眼睛（凶感来自眼型），请用 ally_from_gen.py --set")
            # 默认只出候选，**不覆盖 approved**。
            # 2026-11-27 踩过：守卫循环里 `python duo_state.py`（无参数）跑了一次，
            # 把生成版 ally 覆盖回了换色版，而 --check 随后报 PASS（换色版本身是合法的）。
            # 结果"检查通过"其实检查的是被自己覆盖掉的另一个文件。
            ally = transform(dark, card)
            if "--approve" in args:
                dst.parent.mkdir(parents=True, exist_ok=True)
                ally.save(dst)
                print(f"  approve → {dst.name}")
            else:
                cand = SHEET_DIR / "hue"
                cand.mkdir(parents=True, exist_ok=True)
                ally.save(cand / dst.name)
        e = verify(dark, ally, key)
        errs += e
        rows.append((key, dark, ally, card, e))

    print(f"{'敌人':<28}{'Δ色相':>9}{'饱和':>14}{'明度对比度':>16}")
    print("-" * 70)
    for key, d, al, card, e in rows:
        md, ma = metrics(d), metrics(al)
        if card.get("generated"):
            # 生图版是重画的：色系来自目标带而不是继承 dark，
            # 印"Δ色相/饱和塌没塌"会误导 —— 那两条判据对它本来就是关的。
            print(f"{key:<28}{'生成版':>8}"
                  f"  S {ma['sat']:.2f}   V {ma['vavg']:.2f}   带 {ma['hue']:.0f}°")
        else:
            print(f"{key:<28}{_hue_delta(md['hue'], ma['hue']):>7.0f}°"
                  f"  {md['sat']:.2f}→{ma['sat']:.2f}"
                  f"   {md['cmp']:.2f}→{ma['cmp']:.2f}")
        print(f"  └ {card['species']}：{card['why']}")
        for msg in e:
            print(f"  ✗ {msg}")

    if "--palette" in args and rows:
        p = palette_sheet(rows)
        print(f"\n  两套色系 → {p}（上 DARK / 下 ALLY）")

    if "--sheet" in args and rows:
        pad, w = 8, 128
        sheet = Image.new("RGBA", (w * 2 + pad + 150, (w + pad) * len(rows)), (232, 220, 190, 255))
        for i, (_k, d, al, _c, _e) in enumerate(rows):
            sheet.alpha_composite(d.resize((w, w)), (0, i * (w + pad)))
            sheet.alpha_composite(al.resize((w, w)), (w + pad, i * (w + pad)))
        p = SHEET_DIR / "_sheet.png"
        sheet.save(p)
        print(f"\n  对比图 → {p}（左 dark / 右 ally）")

    print()
    if errs:
        for e in errs:
            print("FAIL  " + e)
        return 1
    print(f"PASS  {len(rows)} 个敌人：色系真变、落在两套色带内、轮廓是同一只")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
