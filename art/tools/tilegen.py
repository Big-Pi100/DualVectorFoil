#!/usr/bin/env python3
"""tilegen.py —— 蜡笔瓦片生成器（背景与地形的唯一来源）

## 为什么背景必须瓦片化

一张 1536×1024 整图看着好，但它有三个死结：
  1. **房间长度被图锁死**。回廊 32 格一张图，钟塔要重出一张，10 个房间 10 张，
     每张都要重新对齐一次"一致性"——一致性变成一件每次都靠运气的事。
  2. **不能分视差层**。远近全糊在一张里，走起来背景整体平移，横版最忌这个。
  3. **不能复用**。墙角那套笔触在 A 房间调好了，B 房间用不上。

瓦片把这三件事一次解决：任意长度、任意分层、一套资产供所有房间。

## 为什么瓦片必须是"画"出来的，不是"切"出来的

从大图上切瓦片解决不了任何问题——你仍然需要那张大图，只是多了一步切。
真正要的是：**瓦片本身是笔刷指令的产物**。这样墙角那笔和天花板那笔是同一天
同一支笔画出来的，一致性来自"笔没变"，而不是"我记得住规范"。

## 用法

    python art/tools/tilegen.py --preview      # 出图 + 平铺预览
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crayon import Crayon, PALETTE  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'art', 'tiles')

# 瓦片尺寸：192 = 4×4 个游戏格（TILE=48）。
# 不能更小 —— 蜡笔笔尖 12–18px，96px 的瓦片里只画得下五六道笔，细节全糊成噪点。
# 也不能更大 —— 越大越难藏重复，192 配 3 变体 + 四向翻转刚好。
N = 192

# 砖：48 高（=1 格），96 宽，错缝。191 高正好 4 行，平铺时上下接得上
BRICK_H = 48
BRICK_W = 96
ROWS = N // BRICK_H      # 4


def build_wall(seed: int) -> Crayon:
    """墙面：冷灰薄涂 + 炭黑砖缝 + 局部加深 + 裂纹。

    ‼ 第一版的错：把"世界层 = 断续"直接套到 192px 的墙上，结果满屏噪点。
      那条判据本来是给 128px 角色的，放大 4 倍后同样的"断续"就成了雪花。
    **墙面要的是大面积平静 + 少量结构线**：几道水平大笔（人手涂墙就是左右涂），
    加几条尽量直的砖缝。花的那部分交给砖面差异，不交给笔触。
    """
    c = Crayon(N, N, seed=seed, tile=(seed * 7 + 3, seed * 13 + 5), wrap=True)
    rng = np.random.default_rng(seed * 31 + 7)

    # ① 底：3–4 道水平粗笔。angle 只在 0 附近抖 —— 斜纹会读成"布"或"木板"
    c.fill([(0, 0), (N, 0), (N, N), (0, N)], 'cold_grey',
           coverage=0.46, width=30, out=10, pressure=0.5,
           angle=float(rng.uniform(-6, 6)))

    # ② 砖缝：横 4 条 + 隔行错开半块的竖缝。jitter 压到 0.5 ——
    #    手画直线是"大致直但有点抖"，不是波浪。上一版 1.4 把墙抖成了水波
    for r in range(ROWS):
        y = r * BRICK_H
        c.stroke([(-10, y), (N + 10, y)], 'charcoal', width=2.4,
                 pressure=0.72, jitter=0.5, textured=False)
    for r in range(ROWS):
        y0 = r * BRICK_H
        off = (r % 2) * (BRICK_W // 2)
        for x in range(off, N, BRICK_W):
            c.stroke([(x, y0 + 2), (x, y0 + BRICK_H - 2)], 'charcoal',
                     width=2.0, pressure=0.62, jitter=0.45, textured=False)

    # ③ 砖面差异：这才是打破重复的主力。每块砖 ±15% 明度，
    #    有的偏褐有的偏冷，平铺时同一块瓦片再出现也认不出来
    for r in range(ROWS):
        off = (r % 2) * (BRICK_W // 2)
        for x in range(off - BRICK_W, N + BRICK_W, BRICK_W):
            k = rng.random()
            if k < 0.22:
                c.fill([(x + 4, r * BRICK_H + 4), (x + BRICK_W - 4, r * BRICK_H + 4),
                        (x + BRICK_W - 4, (r + 1) * BRICK_H - 4), (x + 4, (r + 1) * BRICK_H - 4)],
                       'umber', coverage=0.86, width=34, out=2, pressure=0.26)
            elif k > 1.01:
                # 深蓝压一角：老墙的返潮。只用一点点，多了就脏
                c.fill([(x + 10, r * BRICK_H + 10), (x + BRICK_W - 14, r * BRICK_H + 12),
                        (x + BRICK_W - 18, (r + 1) * BRICK_H - 10), (x + 8, (r + 1) * BRICK_H - 12)],
                       'deep_blue', coverage=0.07, width=14, out=2, pressure=0.20)

    # ④ 裂纹：1–2 条折线。这是唯一"随机走向"的元素，最容易被一眼看出重复
    for _ in range(int(rng.integers(1, 3))):
        x, y = rng.uniform(0, N), rng.uniform(0, N)
        pts = [(x, y)]
        d = rng.uniform(0, 6.28)
        for _ in range(int(rng.integers(2, 5))):
            d += rng.uniform(-0.7, 0.7)
            L = rng.uniform(16, 34)
            x += np.cos(d) * L
            y += np.sin(d) * L
            pts.append((x, y))
        c.stroke(pts, 'charcoal', width=1.3, pressure=0.45, jitter=0.6)

    return c


def build_floor(seed: int) -> Crayon:
    """地面：石砌层。比墙深一档、笔更密，让"能站"先于受光面被读出来。

    ‼ 层高必须固定成 48 的整数倍，层内的石块宽度才随机。
      上一版用随机层高（18–34），横线在 y=192 处对不齐，平铺时每 192px
      出现一条横向的密度断层。**无缝的前提是"跨边界的元素相位一致"**，
      不是"画了 wrap 就无缝"。
    层内宽度用凑满 192 的组合，所以左右边界也落在石缝上。
    """
    c = Crayon(N, N, seed=seed, tile=(seed * 11 + 2, seed * 17 + 9), wrap=True)
    rng = np.random.default_rng(seed * 53 + 3)
    c.fill([(0, 0), (N, 0), (N, N), (0, N)], 'umber',
           coverage=0.80, width=22, out=8, pressure=0.66, angle=30)

    COMBOS = [[64, 80, 48], [96, 48, 48], [48, 48, 96],
              [80, 64, 48], [48, 80, 64], [64, 48, 80]]
    for r in range(ROWS):
        y0 = r * BRICK_H
        ws = COMBOS[int(rng.integers(0, len(COMBOS)))]
        x = 0
        for w in ws:
            # 同层里深浅交替才读得出"一块一块"，但**不用炭黑** ——
            # 炭黑明度 12，在整片土褐里出现就是一块黑补丁，像拼贴不像石头。
            # 深浅只靠"同色不同遍数"做：多涂一遍就深，少涂一遍就浅。
            k = rng.random()
            if k < 0.34:
                c.fill([(x + 2, y0 + 2), (x + w - 2, y0 + 2),
                        (x + w - 2, y0 + BRICK_H - 2), (x + 2, y0 + BRICK_H - 2)],
                       'umber', coverage=0.62, width=20, out=2, pressure=0.52)
            elif k > 0.66:
                c.fill([(x + 2, y0 + 2), (x + w - 2, y0 + 2),
                        (x + w - 2, y0 + BRICK_H - 2), (x + 2, y0 + BRICK_H - 2)],
                       'cold_grey', coverage=0.30, width=20, out=2, pressure=0.34)
            # 缝：贴着块边走，gap 让它断断续续（世界层）
            c.outline([(x + 2, y0 + 2), (x + w - 2, y0 + 2),
                       (x + w - 2, y0 + BRICK_H - 2), (x + 2, y0 + BRICK_H - 2)],
                      'charcoal', width=1.8, gap=0.30, pressure=0.55)
            x += w

    c.speck(46, 'charcoal', (0, 0, N, N), rmin=0.5, rmax=1.2, pressure=0.55)
    c.speck(24, 'ochre', (0, 0, N, N), rmin=0.5, rmax=1.0, pressure=0.5)
    return c


REGISTRY = {
    'wall': (build_wall, 6),
    'floor': (build_floor, 2),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', action='store_true', help='出平铺预览图')
    ap.add_argument('--only', default=None, help='只出一类')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    made = {}
    for name, (fn, count) in REGISTRY.items():
        if args.only and name != args.only:
            continue
        made[name] = []
        for i in range(count):
            c = fn(i)
            p = os.path.join(OUT, f'{name}_{i}.png')
            # ‼ 必须**贴纸色存成不透明**。存 RGBA 的话，针孔（透明处）在游戏里
            #   露出的是引擎的深色底，整面墙会变成"深灰 + 亮噪点"——
            #   在纸色背景上预览完全看不出来，进游戏才发现。
            #   蜡笔的针孔露的本来就是"纸"，不是"虚空"。
            c.on_paper().save(p)
            made[name].append(c.image())
            print(f'  {os.path.basename(p)}  {os.path.getsize(p) // 1024}KB')

    if args.preview:
        _preview(made)


def _preview(made):
    """平铺预览：4×3 拼，专门看接缝和重复感。

    接缝判据：拼接处能不能看到一条 1px 的硬边。看不到 = 无缝做对了。
    """
    cols, rows = 4, 3
    for name, imgs in made.items():
        W, H = cols * N, rows * N
        canvas = Image.new('RGBA', (W, H))
        rng = np.random.default_rng(11)
        for r in range(rows):
            for cix in range(cols):
                im = imgs[int(rng.integers(0, len(imgs)))]
                if rng.random() < 0.28:
                    im = im.transpose(Image.FLIP_LEFT_RIGHT)
                canvas.alpha_composite(im, (cix * N, r * N))
        bg = Image.new('RGB', (W, H), PALETTE['paper'])
        bg.paste(canvas, (0, 0), canvas)
        p = os.path.join(ROOT, 'shots', f'tile_{name}_preview.png')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        bg.save(p)
        print(f'→ {os.path.relpath(p, ROOT)}')


if __name__ == '__main__':
    main()
