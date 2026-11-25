#!/usr/bin/env python3
"""crayon.py —— 蜡笔笔刷原语库（"程序画"的唯一入口）

## 为什么要有这一层

旧做法是直接写 `ctx.fillRect(x, y, 48, 3)` + `'#8A6A3C'`。全项目 73 处 fillRect、
78 个 hex 值，一致性只靠"我记得住 12 色板"。工具化之后，一致性由代码保证：
LLM 只能调下面的原语，原语只接受**色板里的名字**、只接受 **1–6px 笔宽**。
写错会抛异常，而不是画出一张"看起来有点不一样"的图。

这条和「模型画法，程序几何」是同一条原则，只是把"程序几何"再往下压一层：
几何也不该由 LLM 手写坐标，而应该由**受约束的笔**画出来。

## 蜡笔的物理（四条，缺一条就不像蜡笔）

1. **干性介质** —— 蜡笔只在纸的凸起处沾色，凹陷处不沾。所以天然断续、有颗粒。
   这是它和水彩/油画最根本的区别，也是"看着像蜡笔"的第一判据。
2. **压力决定沾色率**，但压力再大也保留颗粒（不是油漆）。
3. **叠色不混色** —— 后画的盖住先画的，交界处会露底一线。
4. **纸纹全图共用** —— 同一张纸反复涂，会在同样的凸起上堆色。
   这才是"所有瓦片出自同一支笔"的真正来源：不是颜色一样，是**纸一样**。

## 用法

    c = Crayon(96, 96, seed=3, tile=(0, 0))
    c.fill([(0,0),(96,0),(96,96),(0,96)], 'cold_grey', coverage=0.55)
    c.stroke([(4,20),(90,22)], 'charcoal', width=2, pressure=0.6)
    c.outline(rect, 'charcoal', width=2, gap=0.35)   # gap>0 = 断续（世界层）
    c.save('art/tiles/wall_0.png')

世界层的三条硬参数（STYLE_LOCK §L2）：断续 1px、纸白留 30–50%、出界 3–8px。
`outline(gap=…)` 和 `fill(coverage=…)` 就是这两个旋钮，不是靠目测。
"""

from __future__ import annotations

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ── 12 色板（STYLE_LOCK §L5，硬约束）────────────────────────────────────
PALETTE = {
    'paper':     '#E8DCBE',   # 纸：成片底材，全图最亮
    'wax_white': '#FBF7EC',   # 蜡白：只给主角高光
    'charcoal':  '#2B2320',   # 炭黑：轮廓、最深阴影
    'cold_grey': '#8C8B84',   # 冷灰：石头、远景
    'deep_blue': '#1F2E5C',   # 深蓝：夜、拱门暗部
    'grey_blue': '#4C6E8C',   # 灰蓝：远景建筑、雾
    'blood':     '#9B2226',   # 血红：城堡、蜡烛、危险
    'ochre':     '#B98A2E',   # 赭金：火、屋顶、金饰
    'umber':     '#6B4B32',   # 土褐：木头、地面
    'skin':      '#D9A16B',   # 皮色
    'moss':      '#4F6B3A',   # 苔绿：草
    'violet':    '#3B2340',   # 紫黑：敌人
}

# 明度阶梯（规范 B，按上表取，不另调）
LADDER = ['paper', 'wax_white', 'grey_blue', 'cold_grey', 'moss',
          'umber', 'blood', 'deep_blue', 'charcoal', 'violet']

MAX_WIDTH = 20.0         # 笔尖直径上限（192px 瓦片里 30 算大笔；再粗就成刷墙了）


def _hex(name: str) -> tuple[int, int, int]:
    if name not in PALETTE:
        raise ValueError(
            f'色板里没有 {name!r}。只许用：{sorted(PALETTE)}\n'
            f'（STYLE_LOCK §L5：不许新增中间色，中间色靠叠色叠出来）')
    h = PALETTE[name].lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


# ── 笔尖纹理 ────────────────────────────────────────────────────────────
# 转写自 p5.brush（acamposuribe/p5.brush, MIT）的 brush tip 模型。
# 它把笔尖做成一张带 alpha 的纹理图，沿路径 stamp，crayon 参数是
# scatter 1.9 / grain 2 / spacing 0.07 —— 关键就是"笔尖不是一个实心圆"。
#
# 我原来的笔尖是实心圆 + 纸纹打孔，出来的线是"实线被啃掉几口"。
# 真蜡笔（见 art/ref 的样本表）是**一团颗粒堆成线**：芯实、边碎、外面还有飞屑。
# 这一层 tip 就是补这个。
_TIPS: list[np.ndarray] | None = None


def _make_tip(seed: int, size: int = 64) -> np.ndarray:
    """一个笔尖：不规则实心核 + 外圈飞屑。

    核用几个正弦扰动半径（不要正圆 —— 正圆叠出来是"珠链"），
    飞屑是随机小点，越靠外密度越低。
    """
    rng = np.random.default_rng(1000 + seed)
    c = (size - 1) / 2.0
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    ang = np.arctan2(y - c, x - c)
    dist = np.hypot(x - c, y - c)
    a1, a2, a3 = rng.random(3) * 6.28
    # 核心必须撑满笔尖的 85%：第一版按 0.50 算，缩放后核心只有笔宽的 6.5px，
    # 叠出来中间是空的，只能靠碎屑兜底 —— 看上去就像"一串图章"。
    R = (0.84 + 0.09 * np.sin(ang * 3 + a1)
              + 0.05 * np.sin(ang * 7 + a2)
              + 0.03 * np.sin(ang * 11 + a3)) * size * 0.5
    core = np.clip((R - dist) / 1.5 + 0.5, 0, 1)

    # size 64 是刻意的：笔尖要缩到 10–30px 用，碎屑在原尺寸就得是 0.5–1.5px，
    # 缩下来才是"粉"，不是"碎纸屑"。
    n = int(rng.integers(46, 72))
    px, py = rng.random(n) * size, rng.random(n) * size
    pr = rng.uniform(0.4, 1.3, n)
    crumbs = np.zeros((size, size), np.float32)
    for i in range(n):
        m = np.clip((pr[i] - np.hypot(x - px[i], y - py[i])) / 0.85 + 0.5, 0, 1)
        np.maximum(crumbs, m, out=crumbs)
    # 飞屑只在**核的外圈**长。上一版无差别叠上去，核内也全是 0.38 的半透明点，
    # 整块面读成"掉漆"。蜡笔的碎屑是笔尖擦过边缘掉下来的，核里是实的。
    outer = np.clip((dist - R * 0.82) / (size * 0.16), 0, 1)
    return np.maximum(core, crumbs * 0.55 * outer)


def _tips() -> list[np.ndarray]:
    global _TIPS
    if _TIPS is None:
        _TIPS = [_make_tip(i) for i in range(10)]
    return _TIPS
_ATLAS_CACHE: dict[int, Image.Image] = {}


def _paper_atlas(seed: int, size: int = 1024):
    """三层纸纹，各有各的活，混在一起用就互相打架。

    第一版把三层加成一张再切阈值，结果是"针孔"和"留白"同源 ——
    低压力时切出 20px 大块（像迷彩），高压力时又满屏椒盐（像电视雪花）。
    现在拆开：fine 只做针孔，band 只做薄厚，mid 做笔压起伏。
    """
    rng = np.random.default_rng(seed)

    def _band(cells, blur=0.0):
        g = rng.random((cells, cells)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8), 'L').resize(
            (size, size), Image.BICUBIC)
        if blur:
            im = im.filter(ImageFilter.GaussianBlur(blur))
        return np.asarray(im, np.float32) / 255.0

    fine = rng.random((size, size)).astype(np.float32)
    fine = np.asarray(
        Image.fromarray((fine * 255).astype(np.uint8), 'L')
        .filter(ImageFilter.GaussianBlur(0.35)), np.float32) / 255.0
    # 均衡化：让 coverage 参数有物理含义（"coverage .7" 真的等于 70% 面积）
    flat = fine.ravel()
    rank = np.empty(flat.size, np.float32)
    rank[np.argsort(flat, kind='stable')] = np.linspace(0, 1, flat.size, dtype=np.float32)
    fine = rank.reshape(fine.shape)
    # 40px 那一层改到 24px 周期、幅度 ±20%：蜡笔涂墙不是均匀的砂纸，
    # 是"这几笔厚、那几笔薄"，薄的地方纸白多。这个不匀必须在瓦片里，
    # 因为它是"手"的证据；而"大面积重复感"才交给游戏层的低频 overlay。
    return fine, _band(128, 0.9), _band(10, 6.0)


def _crop(a: np.ndarray, w: int, h: int, tile: tuple[int, int]) -> np.ndarray:
    H, W = a.shape[:2]
    ox = (tile[0] * 137) % (W - w - 1) if W > w + 1 else 0
    oy = (tile[1] * 149) % (H - h - 1) if H > h + 1 else 0
    return a[oy:oy + h, ox:ox + w]


class Crayon:
    """一张画布 + 一组受约束的笔。所有动作吃同一张纸纹。"""

    def __init__(self, w: int, h: int, seed: int = 0,
                 tile: tuple[int, int] = (0, 0), paper: str = 'paper',
                 wrap: bool = False):
        self.w, self.h = w, h
        self.seed = seed
        # wrap=True：所有笔迹跨边界环绕 —— 瓦片平铺的唯一前提。
        # 不做这一步，两块瓦片一拼就是一条 1px 的硬缝，整面墙立刻"贴图感"。
        self.wrap = wrap
        self.rng = np.random.default_rng(seed)
        self.buf = np.zeros((h, w, 4), np.float32)      # 直通 alpha 累积区
        self.paper = np.asarray(_hex(paper), np.float32) / 255.0
        # 纸纹按 tile 坐标取不同位置：同一套瓦片不共享同一块布纹
        fine, mid8, band = _paper_atlas(seed)
        self.g_fine = _crop(fine, w, h, tile)      # 针孔：只由它切阈值
        self.g_mid = _crop(mid8, w, h, tile)       # 笔压起伏
        self.g_band = _crop(band, w, h, tile)      # 薄厚
        self.grain = self.g_fine                   # 兼容旧调用

    # ── 内部：把一层 coverage(0..1) 按蜡笔物理落到画布 ────────────────
    def _deposit(self, cov: np.ndarray, color: str, pressure: float,
                 area: float | None = None):
        """cov 是笔尖的几何覆盖，此处乘上纸纹得到"实际沾色量"。

        两个旋钮分开，各管一件事（这是让参数有物理含义的关键）：
          area   —— 涂到多少**面积**。阈值 1-area 切纸纹，均衡化之后面积≈area。
                    一笔一笔涂（stroke）时它就是压力本身：压得轻自然断。
          pressure —— 涂到的地方**多深**。蜡笔单遍盖不死纸，两遍才压实。
        soft 给边缘一点过渡，否则断续会像二值化噪点而不是蜡笔。
        """
        r, g, b = (np.array(v, np.float32) / 255.0 for v in _hex(color))
        # 默认：涂到的地方**基本是实的**，只有针孔。
        # 第一版让 area=pressure，压力 0.55 就等于"45% 面积不沾"——
        # 于是每条线都碎成虚线、每块面都变成点阵。真实蜡笔压轻是**变淡**，
        # 不是"整段消失"；"断"应该显式给 gap，不该由噪声偷偷决定。
        area = (0.55 + 0.40 * float(np.clip(pressure, 0, 1))
                if area is None else area)
        thr = 1.0 - float(np.clip(area, 0.02, 0.98))
        soft = 0.05
        # 针孔只由高频 fine 决定 —— 这是"断续/颗粒"的唯一来源
        t = np.clip((self.g_fine - thr) / soft, 0, 1)
        t = t * t * (3 - 2 * t)                          # smoothstep：边缘更柔
        # 低频只调制浓度（±20%），不参与 0/1 判定，否则会切出 20px 大块
        density = 0.90 + 0.40 * (self.g_band - 0.5)
        depth = 0.80 + 0.18 * float(np.clip(pressure, 0, 1))
        # 针孔不是"纯纸"，是"薄薄一层"：蜡笔涂过的地方总归沾到一点。
        # 底从 0.12 提到 0.30 —— 0.12 时针孔 alpha≈0.11，在深底上仍然读成"白点"，
        # 一屏 5 块瓦片就有一万多个，整面墙像结了霜。0.30 时是"浅灰"，
        # 有颗粒但不刺眼；真正的纸白只出现在笔没走到的地方（cov=0）。
        a = (cov * (0.55 + 0.45 * t) * density * depth).clip(0, 1) * 0.97
        if a.max() <= 0:
            return
        # 直通（非预乘）alpha over
        src_a = a[..., None]
        dst_a = self.buf[..., 3:4]
        out_a = src_a + dst_a * (1 - src_a)
        rgb = np.stack([r, g, b], -1)
        # 蜡笔的色本身也被纸拉亮一点（蜡不完全遮底）
        rgb = rgb * 0.94 + self.paper * 0.06
        num = rgb * src_a + self.buf[..., :3] * dst_a * (1 - src_a)
        self.buf[..., :3] = np.where(out_a > 1e-6, num / np.maximum(out_a, 1e-6), 0)
        self.buf[..., 3:4] = out_a

    def _geom(self, draw_fn) -> np.ndarray:
        """跑一个 PIL 绘制回调，拿回 0..1 的几何 mask。"""
        im = Image.new('L', (self.w, self.h), 0)
        draw_fn(ImageDraw.Draw(im))
        return np.asarray(im, np.float32) / 255.0

    def _stroke_cov(self, pts, width: float, pressure: float = 0.75,
                    jitter: float = 1.0, taper: bool = True,
                    into: np.ndarray | None = None,
                    textured: bool = True) -> np.ndarray:
        """算一笔的几何覆盖（0..1），不落色。fill 用它叠多道笔。

        jitter 是手抖幅度（px）。taper 让起收笔变细 —— 真蜡笔起笔轻、提笔收，
        均匀粗细的线是"数字笔"的第一特征，这一条不能省。
        """
        if width > MAX_WIDTH * 2.2:
            raise ValueError(f'笔宽 {width} 超出上限，蜡笔画不出这么粗的线')
        P = np.asarray(pts, np.float64).reshape(-1, 2)
        if len(P) < 2:
            P = np.vstack([P, P[-1] + 0.5])
        # 等距重采样：插值让速度均匀，否则转角处会堆成一个疙瘩
        seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
        L = seg.sum()
        n = max(2, int(L / 0.7))
        t = np.concatenate([[0], np.cumsum(seg) / max(L, 1e-6)])
        u = np.linspace(0, 1, n)
        X = np.interp(u, t, P[:, 0])
        Y = np.interp(u, t, P[:, 1])
        # 低频手抖：正弦叠加，比纯随机更像"手"（纯随机会抖成毛刺）
        for k, amp in ((1.7, 1.0), (4.3, 0.45), (9.1, 0.2)):
            X = X + np.sin(u * k * 6.28 + self.rng.random() * 6.28) * amp * jitter
            Y = Y + np.cos(u * k * 5.13 + self.rng.random() * 6.28) * amp * jitter * 0.8
        cov = np.zeros((self.h, self.w), np.float32) if into is None else into
        tips = _tips() if textured else [None]
        for i in range(n):
            f = 1.0
            if taper:
                e = min(u[i], 1 - u[i]) * 2          # 0..1，两端 0
                f = 0.45 + 0.55 * min(1.0, e / 0.18)
            rad = max(0.6, width * 0.5 * f)
            # 碎屑散开幅度跟着笔宽走：太散会断成点，太齐又变回实线
            sc = rad * 0.45 if textured else 0.0
            tip = tips[int(self.rng.integers(0, len(tips)))]
            self._splat(X[i], Y[i], rad, cov, tip, sc)
            if self.wrap:
                for sx in (-self.w, 0, self.w):
                    for sy in (-self.h, 0, self.h):
                        if sx == 0 and sy == 0:
                            continue
                        px, py = X[i] + sx, Y[i] + sy
                        if -rad - 1 < px < self.w + rad + 1 and -rad - 1 < py < self.h + rad + 1:
                            self._splat(px, py, rad, cov, tip, 0.0)
        return cov

    def _splat(self, cx: float, cy: float, rad: float, cov: np.ndarray,
               tip: np.ndarray | None = None, scatter: float = 0.0):
        """一个笔尖印记。拆出来是为了 wrap 时同一笔能落在画布两侧。

        tip 非空时用纹理笔尖（碎屑感），为空时退回实心圆（speck 之类够用）。
        scatter 让相邻印记抖开 —— p5.brush 的 crayon 用 1.9，效果是线不再是一条。
        """
        if tip is not None and scatter > 0:
            cx += float(self.rng.normal(0, scatter))
            cy += float(self.rng.normal(0, scatter))
        d = int(rad * 2) + 2
        if d < 3:
            return
        x0, y0 = int(cx - rad) - 1, int(cy - rad) - 1
        x1, y1 = x0 + d, y0 + d
        # 裁剪到画布
        sx0, sy0 = max(0, -x0), max(0, -y0)
        sx1 = d - max(0, x1 - self.w)
        sy1 = d - max(0, y1 - self.h)
        if sx0 >= sx1 or sy0 >= sy1:
            return
        if tip is None:
            yy, xx = np.mgrid[y0:y1, x0:x1]
            m = np.clip((rad - np.hypot(xx + 0.5 - cx, yy + 0.5 - cy)) / 1.2 + 0.5, 0, 1)
        else:
            # 最近邻缩放：笔尖本来就带颗粒，双线性会把颗粒糊平
            idx = (np.arange(d) * (tip.shape[0] / d)).astype(np.int32)
            np.clip(idx, 0, tip.shape[0] - 1, out=idx)
            m = tip[np.ix_(idx, idx)]
        dst = cov[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1]
        np.maximum(dst, m[sy0:sy1, sx0:sx1], out=dst)

    # ── 原语 1：一笔 ────────────────────────────────────────────────────
    def stroke(self, pts, color: str, width: float = 3.0,
               pressure: float = 0.75, jitter: float = 1.0,
               taper: bool = True, textured: bool = True):
        """textured=False 用于**结构线**（砖缝、门框）：那些线必须是连续的。
        带碎屑的笔尖画缝，缝会断成一串白点，在游戏里一目了然。"""
        self._deposit(self._stroke_cov(pts, width, pressure, jitter, taper,
                                       textured=textured),
                      color, pressure)

    # ── 原语 2：涂面 ────────────────────────────────────────────────────
    def fill(self, poly, color: str, coverage: float = 0.85, pressure: float = 0.8,
             angle: float | None = None, width: float = 11.0, out: float = 2.0):
        """涂满一个多边形 —— **用一道道粗笔涂，不是用 polygon 填色**。

        这是第一版最大的错：`d.polygon(fill=255)` 出来的边是精确直线，
        纸纹只在 1px 上打碎，一眼就是"电脑填充"。真蜡笔涂面是笔走出来的：
        边毛、笔触之间有缝、有方向。所以这里铺平行笔，再用多边形裁。

        coverage 控制**笔距**（涂几遍）：.92 → 0.63w 近乎盖满；.55 → 1.03w 露纸多。
        out 是允许溢出边界多少 px（世界层 3–8px，主角层 0）。
        """
        pts = [tuple(p) for p in poly]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        if angle is None:
            angle = float(self.rng.choice([22, 34, 41, 47, 55, 128, 145]))
        th = np.deg2rad(angle)
        dx, dy = np.cos(th), np.sin(th)
        # 沿法线方向铺线，覆盖 bbox 外扩一圈，保证四角涂到
        nx, ny = -dy, dx
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        span = np.hypot(x1 - x0, y1 - y0) / 2 + width
        # 笔距决定"露多少纸"。这是世界层纸白 30–50% 的真正来源 ——
        # 是**笔没走到**，不是"走到了但没沾上"（后者会像噪点，不像蜡笔）。
        step = max(2.0, width * (0.72 + 0.92 * (1.0 - coverage)))
        cov = np.zeros((self.h, self.w), np.float32)
        k = int(span / step) + 1
        for i in range(-k, k + 1):
            ox, oy = cx + nx * i * step, cy + ny * i * step
            # 每道笔的粗细/起止都随机一点，缝才不像栅栏
            w = width * self.rng.uniform(0.82, 1.18)
            # ‼ 起止必须**两端都出界**。上一版 a0≈0、只有 a1 延伸，
            #   笔永远从中心往一个方向画，另一侧半个矩形没有笔 —— 填出来是三角形。
            #   （更早一版是 a1 < span，笔比瓦片短，每格留一条竖白带。）
            a0 = span * self.rng.uniform(0.95, 1.06)
            a1 = span * self.rng.uniform(1.02, 1.14)
            # ‼ 涂面用**实心笔**。带碎屑的纹理笔尖在单笔上很好看，
            #   但 fill 要 stamp 上百次，碎屑层层累积，整块面变成"结了霜"的
            #   白点（在游戏里一格一格看得见）。涂面的颗粒交给纸纹，够用。
            self._stroke_cov([(ox - dx * a0, oy - dy * a0),
                              (ox + dx * a1, oy + dy * a1)],
                             w, pressure, jitter=0.9, taper=True, into=cov,
                             textured=False)
        # ‼ wrap 模式下**整块画布**的涂底不能裁 —— 笔迹跨边界会绕到对面
        #   （那正是无缝的来源），一裁就把绕过去那半切掉，平铺时每条边界都是硬缝。
        #   地面瓦片上一版就是这样：4×3 拼出来能数出 192px 的方格。
        #   但小区域（砖面加深）仍然要裁，否则一条长笔会横穿整个瓦片。
        full_bleed = (min(xs) <= 0 and min(ys) <= 0
                      and max(xs) >= self.w and max(ys) >= self.h)
        if not (self.wrap and full_bleed):
            mask = self._geom(lambda d: d.polygon(pts, fill=255))
            if out > 0:
                mask = np.asarray(
                    Image.fromarray((mask * 255).astype(np.uint8), 'L')
                    .filter(ImageFilter.MaxFilter(int(out) * 2 + 1)), np.float32) / 255.0
            cov *= mask
        # area 固定 0.90：笔走过的地方就该是实的，露纸一律交给笔距和 mask。
        # 让 coverage 同时管"笔距"和"面积"是上一版的错 —— 两个旋钮叠在一起，调不动。
        self._deposit(cov, color, pressure, area=0.94)

    # ── 原语 3：轮廓 ────────────────────────────────────────────────────
    def outline(self, poly, color: str, width: float = 2.0,
                gap: float = 0.0, pressure: float = 0.7):
        """沿多边形勾边。gap>0 = 按比例断线（世界层必须断续）。

        世界层判据（STYLE_LOCK §L2）：断续 1px、gap 0.25–0.45。
        主角层：gap=0、width=3、轮廓必须闭合。
        """
        if width > MAX_WIDTH:
            raise ValueError(f'笔宽 {width} 超出 {MAX_WIDTH}px')
        pts = [tuple(p) for p in poly]
        if gap > 0:
            segs = _dash_ring(pts, gap, self.rng)
            for s in segs:
                self.stroke(s, color, width=width, pressure=pressure, jitter=0.8)
        else:
            self.stroke(pts + [pts[0]], color, width=width,
                        pressure=pressure, jitter=0.8)

    # ── 原语 4：排线 ────────────────────────────────────────────────────
    def hatch(self, rect, color: str, angle: float = 45.0,
              spacing: float = 6.0, width: float = 2.0, pressure: float = 0.55):
        """排线，**严格裁在 rect 内**。

        上一版直接把长笔 stroke 出去，线超出矩形一大截（自检图里红排线
        爬满了半个画面）。排线只在框里，出框就是脏。
        """
        if width > MAX_WIDTH:
            raise ValueError(f'笔宽 {width} 超出 {MAX_WIDTH}px')
        x, y, w, h = rect
        th = np.deg2rad(angle)
        dx, dy = np.cos(th), np.sin(th)
        L = np.hypot(w, h) * 1.2
        n = max(1, int(L / spacing))
        cov = np.zeros((self.h, self.w), np.float32)
        for i in range(n):
            off = -L / 2 + i * spacing + self.rng.normal(0, 0.4)
            cx, cy = x + w / 2 - dy * off, y + h / 2 + dx * off
            self._stroke_cov([(cx - dx * L / 2, cy - dy * L / 2),
                              (cx + dx * L / 2, cy + dy * L / 2)],
                             width, pressure, jitter=0.7, into=cov)
        m = np.zeros((self.h, self.w), np.float32)
        m[max(0, y):max(0, y + h), max(0, x):max(0, x + w)] = 1.0
        self._deposit(cov * m, color, pressure)

    # ── 原语 5：撒点 ────────────────────────────────────────────────────
    def speck(self, n: int, color: str, rect, rmin: float = 0.6,
              rmax: float = 1.8, pressure: float = 0.7):
        """蜡笔碎屑/纸面颗粒。量小，但少了会显得"太干净"。"""
        x, y, w, h = rect
        for _ in range(n):
            cx = x + self.rng.random() * w
            cy = y + self.rng.random() * h
            r = rmin + self.rng.random() * (rmax - rmin)
            self.stroke([(cx, cy), (cx + 0.3, cy + 0.3)], color,
                        width=r * 2, pressure=pressure, taper=False, jitter=0)

    # ── 输出 ────────────────────────────────────────────────────────────
    def image(self) -> Image.Image:
        a = self.buf[..., 3:4].clip(0, 1)
        out = np.zeros((self.h, self.w, 4), np.uint8)
        out[..., :3] = (self.buf[..., :3].clip(0, 1) * 255).astype(np.uint8)
        out[..., 3] = (a[..., 0] * 255).astype(np.uint8)
        return Image.fromarray(out, 'RGBA')

    def on_paper(self) -> Image.Image:
        """贴在纸上看效果（预览用；游戏里的纸由渲染层提供）。"""
        bg = Image.new('RGB', (self.w, self.h), PALETTE['paper'])
        bg.paste(self.image(), (0, 0), self.image())
        return bg

    def save(self, path: str):
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        self.image().save(path)
        return path


# ── 工具函数 ────────────────────────────────────────────────────────────
def _lowfreq(w: int, h: int, cells: int, rng) -> np.ndarray:
    g = rng.random((cells, cells)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8), 'L').resize((w, h), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255.0


def _hatch_mask(w: int, h: int, angle: float, spacing: float) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    th = np.deg2rad(angle)
    v = xx * np.cos(th) + yy * np.sin(th)
    return (0.45 + 0.55 * (0.5 + 0.5 * np.cos(v / spacing * 2 * np.pi))).astype(np.float32)


def _dash_ring(pts, gap: float, rng):
    """把闭合折线切成断续的段。段长按 gap 压缩，缺口由 gap 决定。"""
    out, cur = [], [pts[0]]
    for i in range(1, len(pts) + 1):
        p = pts[i % len(pts)]
        cur.append(p)
        if rng.random() < gap:
            if len(cur) >= 2:
                out.append(cur)
            cur = [p]
    if len(cur) >= 2:
        out.append(cur)
    return out
