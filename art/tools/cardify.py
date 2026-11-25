#!/usr/bin/env python3
"""
cardify.py —— R2「薄卡片 2.5D」的程序化实现。

为什么要有这个脚本：
  其余候选画法（木刻/浮世绘/低多边形/斜投影）的签名效果都必须靠**逐张重画**，
  93 个资产就是 93 次手工。R2 的签名效果只有一个参数——**固定 45° 等长厚度**，
  而厚度 = 轮廓沿固定方向平移 = 可计算。
  所以只有 R2 能做到：一次实现，全部资产自动同厚度、同方向、同投影。
  这不只是省钱，是**一致性由代码保证**，不靠画师手感。

合规边界（规范 A / H）：
  - 厚度等长、方向固定 → 无近大远小 → 仍是 2D 平面（不是透视）
  - 投影是硬边 + 单一位移，不是高斯模糊
  - 不生成纸纹、不生成实物背景台
"""
import argparse
import sys
from PIL import Image, ImageFilter


def extract_mask(im):
    """取前景 mask。有 alpha 用 alpha；白底图用边界泛洪近似（阈值分离）。"""
    im = im.convert("RGBA")
    a = im.split()[-1]
    if a.getextrema()[0] < 250:          # 真有 alpha
        return a.point(lambda v: 255 if v > 40 else 0), im
    # 白底：亮度 < 245 视为前景
    g = im.convert("L")
    m = g.point(lambda v: 255 if v < 245 else 0)
    # 填内部空洞：对 mask 做一次闭运算
    m = m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    out = im.copy()
    out.putalpha(m)
    return m, out


def quantize(im, n):
    """把连续调压成平色。n=0 跳过。

    注意：quantize 会丢掉 alpha —— 所以 alpha 单独存，量化完再贴回，
    否则整张裁剪矩形都会变成实心色块（第一版就踩了这个坑）。
    """
    if n <= 0:
        return im
    im = im.convert("RGBA")
    alpha = im.split()[-1]
    # 透明像素的 RGB 是垃圾值（会污染调色板），先剔除
    clean = Image.new("RGB", im.size, (255, 255, 255))
    clean.paste(im.convert("RGB"), (0, 0), alpha)
    q = clean.quantize(colors=n, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    out = q.convert("RGBA")
    out.putalpha(alpha)
    return out


def extrude(mask, thickness, dx, dy, color):
    """把 mask 沿 (dx,dy) 逐步平移 thickness 次并堆叠 → 等长厚度带（平行投影）。"""
    layer = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    solid = Image.new("RGBA", mask.size, color)
    for k in range(thickness, 0, -1):
        shifted = mask.transform(
            mask.size, Image.AFFINE,
            (1, 0, -dx * k, 0, 1, -dy * k),
            resample=Image.NEAREST,
        )
        layer.paste(solid, (0, 0), shifted)
    return layer


DIRS = {"se": (1, 1), "sw": (-1, 1), "ne": (1, -1), "nw": (-1, -1), "s": (0, 1)}


def cardify(src, out, thickness_ratio=0.085, colors=0,
            edge=(172, 150, 118, 255), shadow=(24, 18, 12, 55),
            shadow_mult=0.55, bg=(0, 0, 0, 0), direction="se"):
    im = Image.open(src)
    mask, cut = extract_mask(im)
    cut = quantize(cut, colors)
    bbox = mask.getbbox()
    if bbox:
        pad = int((bbox[3] - bbox[1]) * 0.06) + 4
        box = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
               min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad))
        mask, cut = mask.crop(box), cut.crop(box)

    h = mask.size[1]
    t = max(2, int(round(h * thickness_ratio)))
    dx, dy = DIRS[direction]

    canvas = Image.new("RGBA", (mask.size[0] + t * 3, mask.size[1] + t * 3), bg)

    # 1) 硬投影（单一位移，无模糊）
    s = int(round(t * shadow_mult))
    sm = mask.transform(mask.size, Image.AFFINE, (1, 0, -s, 0, 1, -s), resample=Image.NEAREST)
    canvas.paste(Image.new("RGBA", mask.size, shadow), (t, t), sm)

    # 2) 厚度带（墨色）
    canvas.alpha_composite(extrude(mask, t, dx, dy, edge), (t, t))

    # 3) 卡片正面
    canvas.alpha_composite(cut, (t, t))
    if bg[3] == 0:
        canvas.save(out)
    else:
        canvas.convert("RGB").save(out, quality=95)
    print(f"OK {out}  size={canvas.size} thickness={t}px ({thickness_ratio:.3f}*h)")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("out")
    p.add_argument("--ratio", type=float, default=0.085)
    p.add_argument("--colors", type=int, default=0)
    p.add_argument("--dir", default="se", choices=list(DIRS))
    p.add_argument("--edge", default="96805c")
    a = p.parse_args()
    e = a.edge.lstrip("#")
    edge = (int(e[0:2], 16), int(e[2:4], 16), int(e[4:6], 16), 255)
    cardify(a.src, a.out, thickness_ratio=a.ratio, colors=a.colors,
            edge=edge, direction=a.dir)
