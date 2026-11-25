#!/usr/bin/env python3
"""tile_from_gen.py —— 洋红底生图素材板 → 单块瓦片（一张 PNG = 一块砖）

‼ 这是**瓦片的唯一产线**（2026-11-26 起）。上一代 p5.brush 程序渲染已废。

为什么要这个脚本，而不是让模型直接画瓦片：
  模型排不好砖。让它"画一面 4×3 的墙"，缝宽不齐、砖大小不一、边界切砖，
  平铺后是歪的 —— 这是 v3e~v7 连错 5 版的根因。
  所以分工是：**模型只画"一块块散开的石头"，排布和尺寸交给代码**。
  模型负责笔触（人画不出来），代码负责几何（模型算不准）。

和 build_sheet_magenta.py 的关系：不重写抠图。
  洋红键、自适应阈值、despill 全部复用 `E:/IdentityCard/tools/process_spritesheet.py`
  （`magenta_score` 用 min(R,B)-G 只看色相，不受明暗影响；这个判据踩过一整轮才定下来）。
  本脚本只补它没做的：**多个自由形状 → 每块单独归一化到同一块固定画布**。

为什么必须洋红底而不是纸底：
  上一批 floor_0..5 的废件，就是从纸底生图上按网格硬裁出来的 —— 框落在石头周围的
  留白上，6 张全是纸色 + 零星笔触。纸底没有"前景/背景"的硬边界，裁切只能靠猜。
  洋红底 + 连通域，"每块石头在哪"是量出来的，不是猜出来的。

为什么保持长宽比、只贴底边：
  不许拉伸。拉伸会让同一张图里的石头粗细不一致，也把笔触压变形。
  不同石头在游戏里高度不同 —— 那正是砌石墙该有的样子（大小不一才有手工感）。
  但**底边必须贴底**：否则上下两行之间会出现宽度随机的水平亮缝。

用法：
  # 出一组墙砖（64×48 画布，内容贴底、水平居中）
  python art/tools/tile_from_gen.py art/tiles/gen/wall_sheet.png art/tiles/wall --tw 64 --th 48

  # 同时出平铺预览（验无缝、验缝宽）
  python art/tools/tile_from_gen.py ... --preview shots/tile_tiling.png

输出：
  <prefix>_0..N.png   每块一块砖，固定画布，RGBA
  <prefix>_sheet.png  原图切片位置的可视化（红框 = 每块的包围盒），出问题时看这张
"""
import argparse
import glob
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, r"E:\IdentityCard\tools")
import process_spritesheet as ps          # noqa: E402  复用，不重写

PAPER = (243, 228, 199)


def chroma_thr_of(arr: np.ndarray) -> int:
    """按实际底色自适应算洋红阈值。

    饱和洋红 #FF00FF → 色度 222 → thr 42（与共享工具一致）
    被模型冲淡的 #AD446F → 色度 43 → thr 19
    硬编码 42 会让整个背景判成前景 —— 这是实测踩到的。
    """
    bg = ps.dominant_bg(arr)
    score = int(ps.magenta_score(np.array([[bg]]))[0][0])
    thr = max(12, min(42, round(score * 0.45)))
    print(f"  底色 #{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}  洋红色度 {score} → 阈值 {thr}")
    return thr


def alpha_of(arr: np.ndarray, thr: int, min_area_ratio: float) -> np.ndarray:
    """洋红底 → 前景 alpha（0/255），顺手清掉碎渣。"""
    fg = (ps.magenta_score(arr) <= thr).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    num, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    min_area = max(40, arr.shape[0] * arr.shape[1] * min_area_ratio)
    keep = np.zeros(fg.shape, np.uint8)
    dropped = 0
    for i in range(1, num):
        a = st[i, cv2.CC_STAT_AREA]
        w, h = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
        if a < min_area or min(w, h) <= 3:
            dropped += 1
            continue
        keep[lab == i] = 255
    if dropped:
        print(f"  丢弃碎渣 {dropped} 个（面积 < {min_area:.0f}px 或最小边 ≤3px）")
    return keep


def collect_blocks(alpha: np.ndarray) -> list[tuple]:
    """连通域 → 按行分组、行内按 x 排序的 bbox 列表。

    分行用中心 y 聚类，不靠固定网格 —— 模型不保证等距，
    但只要每块之间是分开的，顺序就是确定的。
    """
    num, lab, st, _ = cv2.connectedComponentsWithStats(alpha, 8)
    boxes = []
    for i in range(1, num):
        x, y = st[i, cv2.CC_STAT_LEFT], st[i, cv2.CC_STAT_TOP]
        w, h = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
        boxes.append((x, y, x + w, y + h, i))
    if not boxes:
        raise SystemExit("!! 一块石头都没读到 —— 底色不是洋红，或者阈值不对")

    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows, cur = [], [boxes[0]]
    for b in boxes[1:]:
        prev_cy = (cur[-1][1] + cur[-1][3]) / 2
        cy = (b[1] + b[3]) / 2
        h_med = np.median([q[3] - q[1] for q in cur])
        if cy - prev_cy > h_med * 0.6:
            rows.append(cur)
            cur = [b]
        else:
            cur.append(b)
    rows.append(cur)
    for r in rows:
        r.sort(key=lambda b: b[0])
    return [b for r in rows for b in r]


def place(cell: np.ndarray, tw: int, th: int, margin: int) -> tuple:
    """把一块石头缩进 tw×th 画布：保持长宽比 + 水平居中 + 底边贴底。

    返回 (canvas_rgba, 缩放系数, 未缩放原始尺寸)
    """
    inner_w, inner_h = tw - 2 * margin, th - margin
    bh, bw = cell.shape[0], cell.shape[1]
    k = min(inner_w / bw, inner_h / bh)
    nw, nh = max(1, round(bw * k)), max(1, round(bh * k))

    # 预乘 alpha 再缩放：不预乘会让透明区的洋红渗成一圈紫边（角色表踩过）
    a = cell[:, :, 3].astype(np.float32) / 255.0
    rgb = cell[:, :, :3].astype(np.float32) * a[:, :, None]
    small_rgb = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)
    small_a = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((th, tw, 4), np.uint8)
    ox = (tw - nw) // 2
    oy = th - margin - nh
    with np.errstate(divide="ignore", invalid="ignore"):
        canvas[oy:oy + nh, ox:ox + nw, :3] = np.where(
            small_a[:, :, None] > 1e-4, small_rgb / np.maximum(small_a[:, :, None], 1e-4), 0
        )
    canvas[oy:oy + nh, ox:ox + nw, 3] = (small_a * 255).clip(0, 255)
    return canvas, k, (bw, bh)


def despill(canvas: np.ndarray) -> np.ndarray:
    al = canvas[:, :, 3]
    rgb = ps.despill_magenta(canvas[:, :, :3], al)
    out = canvas.copy()
    out[:, :, :3] = rgb
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="洋红底生图素材板")
    ap.add_argument("prefix", help="输出前缀，如 art/tiles/wall")
    ap.add_argument("--tw", type=int, default=64, help="目标画布宽（源图像素）")
    ap.add_argument("--th", type=int, default=48, help="目标画布高（源图像素）")
    ap.add_argument("--margin", type=int, default=2, help="四周留边，平铺时相邻砖不粘连")
    ap.add_argument("--min-area-ratio", type=float, default=0.0015, help="碎渣面积占全图比例")
    ap.add_argument("--warn-ratio", type=float, default=0.42,
                    help="内容高度低于画布这个比例就报警（说明石头太扁）")
    ap.add_argument("--preview", default=None, help="平铺预览输出路径")
    ap.add_argument("--cols", type=int, default=8, help="预览平铺列数")
    ap.add_argument("--rows", type=int, default=6, help="预览平铺行数")
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    print(f"输入 {os.path.basename(a.src)}  {im.width}x{im.height}")
    arr = np.asarray(im)

    thr = chroma_thr_of(arr)
    alpha = alpha_of(arr, thr, a.min_area_ratio)
    if not alpha.any():
        raise SystemExit("!! alpha 全空 —— 阈值/底色有问题，不要往下走")

    blocks = collect_blocks(alpha)
    print(f"读到 {len(blocks)} 块石头")
    print(f"  原始尺寸: {[f'{b[2]-b[0]}x{b[3]-b[1]}' for b in blocks]}")

    os.makedirs(os.path.dirname(a.prefix) or ".", exist_ok=True)
    for old in glob.glob(a.prefix + "_[0-9]*.png"):
        os.remove(old)

    # 原图切片可视化：出问题时第一眼看它，比看图集快
    vis = im.copy()
    dv = ImageDraw.Draw(vis)
    tiles = []
    warn = []
    for i, (x0, y0, x1, y1, lab_id) in enumerate(blocks):
        dv.rectangle([x0 - 1, y0 - 1, x1, y1], outline=(220, 60, 50), width=3)
        dv.text((x0 + 4, max(0, y0 - 14)), str(i), fill=(220, 60, 50))
        rgba = np.dstack([arr, alpha])
        cell = rgba[y0:y1, x0:x1].copy()
        canvas, k, orig = place(cell, a.tw, a.th, a.margin)
        canvas = despill(canvas)
        tiles.append(canvas)
        Image.fromarray(canvas, "RGBA").save(f"{a.prefix}_{i}.png")

        fill = (canvas[:, :, 3] > 0).mean()
        content_h = (canvas[:, :, 3] > 0).any(axis=1).sum()
        ratio = content_h / a.th
        print(f"  [{i}] 源 {orig[0]}x{orig[1]}  比 {orig[0]/max(1,orig[1]):.2f}  "
              f"→ 占画布 {canvas[:, :, 3].astype(bool).sum() / (a.tw * a.th):.1%} 高 {content_h}px")
        if ratio < a.warn_ratio:
            warn.append(f"[{i}] 太扁：高 {content_h}px < {a.warn_ratio:.0%}×{a.th}")

    vis.save(f"{a.prefix}_sheet.png")
    print(f"输出 {len(tiles)} 张 → {a.prefix}_0..{len(tiles)-1}.png")

    # 平铺预览：这是判断"能不能用"的唯一硬指标，不是看单块
    if a.preview:
        W, H = a.tw * a.cols, a.th * a.rows
        pv = Image.new("RGB", (W, H), PAPER)
        for r in range(a.rows):
            for c in range(a.cols):
                t = tiles[(r * 2 + c) % len(tiles)]      # 隔行错开，模拟 game.js 的 pattern
                pv.paste(Image.fromarray(t, "RGBA"), (c * a.tw, r * a.th), Image.fromarray(t, "RGBA"))
        pv.save(a.preview)
        print(f"平铺预览 {a.cols}x{a.rows} → {a.preview}")

    if warn:
        print("\n⚠ 以下砖块内容高度不足，平铺会像砂砾而不是砌石：")
        for w in warn:
            print("   ", w)
        print("   处理：重出素材板，提示词里把长宽比压到 1.2~1.6，或减少块数")


if __name__ == "__main__":
    main()
