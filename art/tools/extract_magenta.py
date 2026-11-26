#!/usr/bin/env python3
"""
《二向箔》洋红底资产抠图工具（ART_GUIDE.md 9.6 的 P1/P4/P8/P9 实现）。

用法:
    python art/tools/extract_magenta.py <输入png> <输出png> [--tolerance 90]

规则（全部来自 ART_GUIDE.md 9.6，勿随意改）:
  P9 不按死阈值 #FF00FF：从画布四角实测背景色，按实测色做色距判定。
  P1 只删与边缘连通的背景：用 scipy.ndimage.label 做 4 连通域，
     仅删除"与画布边界相连"的背景像素；主体内部的类背景像素
     （如红围巾的暖红、纸白间隙）一律保留，避免整片误删。
  P4 despill 去品红边：对主体边缘偏品红像素，把蓝通道压回绿通道附近。
  P8 水印剔除：生成工具强制右下角"AI生成/WORKBUDDY"水印不与背景连通，
     按 x>84% / y>90% 强制透明。
  P2 纸白间隙必须保留为颜料：由 P1 的连通域规则保证（内部像素不动）。

输出为 RGBA 透明 PNG。所有参数可查、可追溯。
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

TOLERANCE = 90
WATERMARK_X = 0.84
WATERMARK_Y = 0.90


def extract(src: str, dst: str, tolerance: float = TOLERANCE) -> dict:
    img = Image.open(src).convert("RGB")
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]

    # P9: 实测背景色（每张生成器输出都不同，禁用固定值）
    # E04 F10 修正：不能只取四角——右下角采样点会落在生成工具水印上
    # （水印 G 通道偏高，如 [255,102,201]），污染 median 导致背景删不干净。
    # 改为从画面边缘条带取样本、排除右下水印区后取中位数。
    wm_x0, wm_y0 = int(w * WATERMARK_X), int(h * WATERMARK_Y)
    ys, xs = np.mgrid[0:h, 0:w]
    in_watermark = (xs >= wm_x0) & (ys >= wm_y0)
    edge = (xs < 24) | (xs >= w - 24) | (ys < 24) | (ys >= h - 24)
    samples = a[edge & ~in_watermark]
    bg = np.median(samples, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    bg_mask = dist < tolerance

    # P1: 4 连通域标记，只删与画布边界连通的背景
    structure = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)
    labels, n = ndimage.label(bg_mask, structure=structure)
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | \
                    set(labels[:, 0]) | set(labels[:, -1])
    border_labels.discard(0)
    flood = np.isin(labels, list(border_labels)) if border_labels else np.zeros_like(bg_mask)

    # P8: 水印区强制并入"要删除"区域
    wm_x0, wm_y0 = int(w * WATERMARK_X), int(h * WATERMARK_Y)
    removed = flood.copy()
    removed[wm_y0:, wm_x0:] = True

    # P2: 主体内部的类背景像素保持不动（removed 未覆盖它们）
    interior_bg = int((bg_mask & ~flood).sum())
    alpha = np.where(removed, 0, 255).astype(np.uint8)

    # P4: 保守 despill，只处理主体边缘偏品红像素，避开暖红围巾主体
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    fringe = ((~removed) & (b > g * 1.3) & (r > 150) & (b > 100) & (dist < 180))
    b2 = np.where(fringe, np.minimum(b, g * 1.2), b)

    # E04 F11: 清除被删像素的 RGB（alpha=0 但 RGB 残留洋红时，
    # Godot Image.resize 双线性插值会把洋红混进半透明边缘，产生品红边）。
    # 用最近邻"颜色扩散"把主体边缘颜色填入透明区，使插值不引入洋红。
    keep_rgb = np.dstack([r, g, b2]).astype(np.uint8)
    nearest = ndimage.distance_transform_edt(
        removed, return_distances=False, return_indices=True
    )
    idx = tuple(nearest[i] for i in range(2))
    filled_rgb = keep_rgb[idx]                      # 每个透明像素取最近的主体色
    filled_rgb[~removed] = keep_rgb[~removed]       # 主体像素保持原色

    out = np.dstack([filled_rgb, alpha])
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(dst)

    return {
        "src": src,
        "dst": dst,
        "size": f"{w}x{h}",
        "bg": [round(float(v), 1) for v in bg],
        "tolerance": tolerance,
        "removed_px": int(removed.sum()),
        "interior_bg_kept_px": interior_bg,
        "despill_px": int(fringe.sum()),
        "watermark_region": f"x>{WATERMARK_X:.0%}, y>{WATERMARK_Y:.0%}",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--tolerance", type=float, default=TOLERANCE)
    args = ap.parse_args()
    info = extract(args.src, args.dst, args.tolerance)
    for k, v in info.items():
        print(f"{k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
