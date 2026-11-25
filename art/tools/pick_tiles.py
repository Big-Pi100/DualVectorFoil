#!/usr/bin/env python3
"""pick_tiles.py —— 从切片里挑差异最大的 N 块，作为正式瓦片

为什么要挑，而不是"取前 N 张"：
  同一张素材板上的 16 块石头，外表极像 —— 前 6 张往往是同一块石头的微调。
  直接取前 6 张，平铺出来是"同一块砖复印"，规律感一眼能看出来。
  这里用贪心最大最小距离（farthest-point sampling）：每轮挑"离已选集合最远"的那块。

为什么特征只用 alpha + 灰度×alpha：
  颜色噪声（每块石的色相本来就有抖动）会主导距离，让"颜色差一点但形状一样"的块被选中。
  形状（alpha）和明暗结构才决定平铺后能不能区分。

用法：
  # 从 wallB_0..15 里挑 6 块 → art/tiles/wall_0..5.png
  python art/tools/pick_tiles.py art/tiles/gen --pattern "wallB_*.png" \
         --n 6 --out art/tiles --name wall

  # 只看看会挑哪几张，不写文件
  python art/tools/pick_tiles.py art/tiles/gen --pattern "wallB_*.png" --n 6 --dry-run
"""
import argparse
import glob
import os
import re
import shutil
import sys

import numpy as np
from PIL import Image


def feature(path: str) -> np.ndarray:
    """一块瓦片 → 特征向量（alpha 与 灰度×alpha 各自展平）。

    灰度乘 alpha：透明区的颜色不参与比较。瓦片都贴底居中，画布尺寸一致，
    所以展平后可以直接逐元素比。
    """
    a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32)
    al = a[:, :, 3:4] / 255.0
    gray = a[:, :, :3].mean(axis=2, keepdims=True)
    return np.concatenate([al, gray * al / 255.0], axis=2).ravel()


def sort_key(p: str):
    """wallB_10.png 要排在 wallB_2.png 后面，按数字排。"""
    m = re.search(r"(\d+)\.png$", p)
    return int(m.group(1)) if m else 0


def pick(feats: list[np.ndarray], n: int) -> list[int]:
    """贪心最大最小距离。返回被选中的下标，按选中顺序。"""
    k = len(feats)
    if n > k:
        raise SystemExit(f"!! 只有 {k} 块，挑不出 {n} 块")

    D = np.zeros((k, k), dtype=np.float64)
    for i in range(k):
        for j in range(i + 1, k):
            d = float(np.abs(feats[i] - feats[j]).mean())
            D[i, j] = D[j, i] = d

    # 起点：到其他所有块平均距离最小 = 最"中庸"的一块，避免起点本身是极端样本
    sel = [int(np.argmin(D.sum(axis=1)))]
    while len(sel) < n:
        # 每块到已选集合的"最近距离"，取其中最大者
        best, best_d = -1, -1.0
        for c in range(k):
            if c in sel:
                continue
            dmin = min(D[c, s] for s in sel)
            if dmin > best_d:
                best, best_d = c, dmin
        sel.append(best)
    return sel


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir", help="切片所在目录")
    ap.add_argument("--pattern", default="*_[0-9]*.png",
                    help="切片文件名模式（默认 *_<数字>.png，会自动排除 _sheet.png）")
    ap.add_argument("--n", type=int, default=6, help="挑几块")
    ap.add_argument("--out", default=".", help="输出目录")
    ap.add_argument("--name", default="wall", help="输出前缀，如 wall → wall_0..N.png")
    ap.add_argument("--dry-run", action="store_true", help="只打印，不写文件")
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.src_dir, a.pattern)), key=sort_key)
    files = [p for p in files if not p.endswith("_sheet.png")]
    if not files:
        raise SystemExit(f"!! {a.src_dir}/{a.pattern} 一块都没匹配到")

    # 尺寸必须一致，否则展平后维度对不上
    sizes = set()
    for p in files:
        with Image.open(p) as im:
            sizes.add(im.size)
    if len(sizes) > 1:
        raise SystemExit(f"!! 切片尺寸不一致 {sorted(sizes)} —— 先重跑 tile_from_gen.py")

    print(f"候选 {len(files)} 块，画布 {sizes.pop()}")
    feats = [feature(p) for p in files]
    sel = pick(feats, a.n)

    # 报告两两最小差，作为"完全撞车"的下限保护。
    # ⚠ 这个指标**对局部差异不敏感**：一块砖只在轮廓和涂法上不同，大部分像素是共同实心区，
    #   所以 6 块肉眼明显不同时，这个数也可能只有 0.007。
    #   它只能抓"两块几乎逐像素相同"，形状是否够不一样必须靠肉眼并排看。
    k = len(feats)
    D = np.zeros((k, k))
    for i in range(k):
        for j in range(i + 1, k):
            D[i, j] = D[j, i] = np.abs(feats[i] - feats[j]).mean()
    dmin = min(D[i, j] for i in sel for j in sel if i != j) if a.n > 1 else 0.0
    print(f"选中 {sel}   选中集合内两两最小差 {dmin:.5f}（仅作撞车下限，不作质量判据）")
    if dmin < 0.004:
        print("   ⚠ 有两块几乎逐像素相同 —— 平铺会出现「同一块砖复印」")
        print("     处置：重出素材板（增加块数），或把 --n 降到 4~5")
    print("   最终判据：6 块并排放大 3× 能一眼分出形状差异（人看，不是这个数字）")

    os.makedirs(a.out, exist_ok=True)
    for out_i, src_i in enumerate(sel):
        src = files[src_i]
        dst = os.path.join(a.out, f"{a.name}_{out_i}.png")
        print(f"  {os.path.basename(dst):<14} <- {os.path.basename(src)}")
        if not a.dry_run:
            shutil.copy(src, dst)
    if not a.dry_run:
        print(f"\n写入 {a.n} 张到 {a.out}/   → 接着跑 python build.py")


if __name__ == "__main__":
    sys.exit(main())
