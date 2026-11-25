#!/usr/bin/env python3
"""build_sheet_magenta.py —— 洋红底 + 纯绿分割线 → 标准精灵表（160×160 网格）

‼ 这个文件是**薄适配层**，不是新轮子。
   切帧、洋红 chroma key、despill、四级刀口降级，全在
   `E:/IdentityCard/tools/process_spritesheet.py`（前几轮踩出来的，别再重写）。
   本文件只补它没做的两件事：

   1) 裁到「角色高 128 / 单帧 160×160 / 固定锚点」的网格（MOVESET §1 规格）
      —— process_spritesheet 输出的是统一高度的自由尺寸 RGBA 帧，没有网格概念。
   2) 连通域按**面积比例**过滤，而不是只留最大块
      —— 蜡笔笔触是断的，一条缝隙可能把腿和躯干切成两块；只留最大块会砍掉腿。
         游离的拳头/断肢面积通常 < 最大块的 6%，按比例砍才分得开这两件事。

为什么必须洋红底（教训，别再犯）：
   蜡笔的白 T 恤和纸底只差 30，用色差抠会把衣服一起抠掉。
   洋红 #FF00FF 在人物调色板里绝迹，`min(R,B)-G` 只看色相不受明暗影响，
   抠得干净且不留浅色描边 —— 这不是偏好，是唯一能可靠抠图的底色。

为什么必须纯绿分割线：
   分割线把「切哪儿」从"猜"变成"读"。没有它就只能靠空白列/最窄腰线，
   而手臂伸进相邻格时这两种都会切错。绿而不是洋红，是因为洋红分割线和
   "人物内部的空隙"无法区分；绿在人物调色板里也绝迹，且能和背景分开判。

用法：
  python art/tools/build_sheet_magenta.py <源图> art/hero/hero_walk4 --frames 4 --fps 9
输出：<前缀>.png（行表）、<前缀>.gif、<前缀>_proof.png
"""
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, r"E:\IdentityCard\tools")
import process_spritesheet as ps          # noqa: E402  复用，不重写

PAPER = (243, 228, 199)     # 仅用于验收图/预览底，不参与抠图
CELL = 160
CHAR_H = 128
ANCHOR_FEET_Y = 152         # 地面状态：脚底
ANCHOR_PELVIS_Y = 94        # 空中状态：骨盆（= 152 - 58，站立时两者等价）


def alpha_of(arr, chroma_thr=42, keep_ratio=0.06, min_area=50):
    """洋红底 → alpha（0/255）。

    keep_ratio: 只有面积 ≥ 最大连通块 6% 的块才留下。
      游离拳头 ≈ 2–4%，被蜡笔缝隙切断的腿 ≈ 30–40% —— 阈值落在这中间。
    chroma_thr: 由调用方按**实际底色**自适应算（见 auto_thr）。
      实测模型会把洋红冲淡成 #AD446F（min(R,B)-G 只有 43），
      硬编码 42 会让整个背景判成前景 —— 所以阈值必须跟着底色走。
    """
    fg = (ps.magenta_score(arr) <= chroma_thr).astype(np.uint8) * 255
    # 分割线：先膨胀再清。绿→洋红的抗锯齿过渡带，green_score 掉到 60 以下、
    # 洋红色度也不够高，会被判成前景，在格边留下 1px 宽的竖线残渣（实测 556px 高）。
    g = (ps.green_score(arr) > ps.SEP_GREEN_THR).astype(np.uint8) * 255
    g = cv2.dilate(g, np.ones((5, 5), np.uint8))
    fg[g > 0] = 0
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    num, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    if num <= 1:
        return None
    amax = st[1:, cv2.CC_STAT_AREA].max()
    keep = np.zeros(fg.shape, np.uint8)
    dropped = []
    for i in range(1, num):
        a = st[i, cv2.CC_STAT_AREA]
        w, h = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
        if min(w, h) <= 2:
            continue                      # 细渣（分割线残边），无所谓面积
        if a >= max(min_area, amax * keep_ratio):
            keep[lab == i] = 255
        elif a >= min_area:
            dropped.append(int(a))
    if dropped:
        print(f"    砍掉游离件 {len(dropped)} 个，面积 {dropped}")
    return keep


def full_height_seps(im, dry_run=False):
    """把绿分割条补满整幅高度，再交给 ps._sep_spans。

    为什么需要：实测模型虽然被要求"从最上边画到最下边"，但两批都只画到
    人物那么高（约 43% 高度）。而 _sep_spans 的判据是"绿像素占列高 60% 以上"，
    所以一条都读不到 —— 刀口退回"猜"，分割线白画了。
    做法是沿绿列把**背景像素**补成绿色（只补背景，绝不覆盖人物），
    让覆盖率去到 ~100%。这样既不碰共享工具，也不会把刀口藏到人物身上。
    """
    arr = np.asarray(im.convert("RGB")).astype(int)
    H, W = arr.shape[:2]
    g = ps.green_score(arr) > 60
    cov = g.mean(axis=0)

    spans, i = [], 0
    cand = cov >= 0.20                     # 只要求"绿到过 20% 高度"，防止漏检
    while i < W:
        if cand[i]:
            j = i
            while j < W and cand[j]:
                j += 1
            if j - i >= 4:
                spans.append((i, j))
            i = j
        else:
            i += 1
    if dry_run or not spans:
        return im, spans

    out = arr.copy()
    bgish = ps.magenta_score(arr) > 12      # 只认背景族，人物像素不碰
    for a, b in spans:
        for y in range(H):
            for x in range(a, b):
                if bgish[y, x]:
                    out[y, x] = (0, 255, 0)
    return Image.fromarray(out.astype(np.uint8), "RGB"), spans


def resize_premultiplied(cell, w, h):
    """预乘 alpha 再缩放，缩完还原。

    ‼ 为什么不能用 cell.resize()：PIL 的 LANCZOS 不对 RGBA 做预乘，
      透明像素的颜色（这里就是洋红）会渗进边缘可见像素 ——
      实测每张表有 0.87% 的可见像素洋红色度 >20，最大 255，
      压到深色背景上就是一圈紫红描边，等于白抠。
      预乘之后透明区的颜色权重为 0，渗不进去。
    """
    a = np.asarray(cell).astype(np.float32)
    al = a[:, :, 3:4] / 255.0
    pm = np.concatenate([a[:, :, :3] * al, a[:, :, 3:4]], axis=2)
    out = np.zeros((h, w, 4), np.float32)
    for c in range(4):
        ch = Image.fromarray(pm[:, :, c], "F").resize((w, h), Image.LANCZOS)
        out[:, :, c] = np.asarray(ch)
    al2 = np.clip(out[:, :, 3:4] / 255.0, 0, 1)
    rgb = np.where(al2 > 1e-4, out[:, :, :3] / np.maximum(al2, 1e-4), 0)
    res = np.concatenate([np.clip(rgb, 0, 255), np.clip(out[:, :, 3:4], 0, 255)], axis=2)
    return Image.fromarray(res.astype(np.uint8), "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--fps", type=int, default=12)
    ap.add_argument("--anchor", default="feet", choices=["feet", "pelvis"])
    ap.add_argument("--scale-by", default="tallest", choices=["tallest", "head"],
                    help="tallest=按表内最高帧填满 128px（站立表用）；"
                         "head=按头宽定尺度（整表都是蹲/趴、没有站立帧时用，"
                         "否则蹲姿会被拉成站立高度）")
    ap.add_argument("--head-w", type=float, default=41.0,
                    help="head 模式下的目标头宽（画布 px）。41 来自 walk 表实测："
                         "243px 头宽 × 0.1698 = 41")
    ap.add_argument("--no-watermark", action="store_true")
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    print(f"输入 {os.path.basename(a.src)}  {im.width}x{im.height}")

    if not a.no_watermark:
        im = ps.patch_watermark(im)

    im, spans = full_height_seps(im)
    print(f"绿分割条 {len(spans)} 条 {spans} → 已补满全高")

    frames, seps = ps.cut_frames(im, a.frames, watermark=True)
    if len(seps) != a.frames - 1:
        print(f"  ⚠ 分割线应 {a.frames - 1} 条，实得 {len(seps)} 条 —— 刀口不是确定的，出图要重做")

    # 自适应洋红阈值：取四角底色的色度，打 4.5 折。
    # 饱和洋红 222 → 42（与共享工具一致）；被冲淡的 #AD446F 43 → 19。
    bg = ps.dominant_bg(np.asarray(frames[0]).astype(int))
    bgscore = int(ps.magenta_score(np.array([[bg]]))[0][0])
    thr = max(12, min(42, round(bgscore * 0.45)))
    print(f"底色 #%02X%02X%02X 洋红色度 {bgscore} → chroma_thr {thr}" % tuple(bg))

    # 第一遍：量所有帧的 bbox（用 alpha，不猜亮度）
    items, hmax = [], 0
    for i, f in enumerate(frames):
        arr = np.asarray(f)
        al = alpha_of(arr, chroma_thr=thr)
        if al is None:
            print(f"  f{i + 1}: 全背景，空帧")
            continue
        ys, xs = np.nonzero(al)
        bb = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        hmax = max(hmax, bb[3] - bb[1])
        items.append((i, arr, al, bb))
    if not items:
        raise SystemExit("没有找到人物")

    if a.scale_by == "head":
        hws = []
        for i, arr, al, bb in items:
            x0, y0, x1, y1 = bb
            sub = al[y0:y1, x0:x1] > 0
            H = sub.shape[0]
            hws.append(float(sub[:max(1, int(H * 0.35))].sum(axis=1).max()))
        base = float(np.median(hws))
        k = a.head_w / base
        print(f"共用缩放 1px → {k:.4f}（按头宽：实测中位 {base:.0f}px → 目标 {a.head_w:.0f}px）")
    else:
        k = CHAR_H / hmax
        print(f"共用缩放 1px → {k:.4f}（最高帧 {hmax}px，全帧同一个系数）")

    sheet = Image.new("RGBA", (CELL * a.frames, CELL), (0, 0, 0, 0))
    marks = Image.new("RGB", (CELL * a.frames, CELL), PAPER)
    md = ImageDraw.Draw(marks)

    for i, arr, al, bb in items:
        desp = ps.despill_magenta(arr, al)
        x0, y0, x1, y1 = bb
        rgb = desp[y0:y1, x0:x1]
        alp = al[y0:y1, x0:x1]
        cell = Image.fromarray(np.dstack([rgb, alp]), "RGBA")
        w = max(1, round(cell.width * k))
        h = max(1, round(cell.height * k))
        cell = resize_premultiplied(cell, w, h)

        x = i * CELL + CELL // 2 - w // 2
        if a.anchor == "pelvis":
            # 骨盆在角色高的 55% 处（从上往下）。站立时 h=128 → 等价于脚底锚，
            # 收腿帧 h 变小 → 脚底自然离开地面，这正是空中状态要的效果。
            y = ANCHOR_PELVIS_Y - round(h * 0.55)
        else:
            y = ANCHOR_FEET_Y - h
        sheet.alpha_composite(cell, (x, y))

        bgc = Image.new("RGB", (CELL, CELL), PAPER)
        bgc.paste(cell, (CELL // 2 - w // 2, y), cell)
        marks.paste(bgc, (i * CELL, 0))
        md.text((i * CELL + 6, 4), f"f{i + 1}", fill=(43, 35, 32))
        ay = ANCHOR_FEET_Y if a.anchor == "feet" else ANCHOR_PELVIS_Y
        md.line([(i * CELL, ay), ((i + 1) * CELL, ay)], fill=(190, 90, 90))
        print(f"  f{i + 1}: 高={h} 宽={w} 落点=({x},{y})")

    sheet.save(a.out + ".png")
    marks.resize((marks.width * 3, marks.height * 3), Image.NEAREST).save(a.out + "_proof.png")

    gif = []
    for i in range(a.frames):
        c = sheet.crop((i * CELL, 0, (i + 1) * CELL, CELL))
        f = Image.new("RGB", (CELL, CELL), PAPER)
        f.paste(c, (0, 0), c)
        gif.append(f.resize((CELL * 2, CELL * 2), Image.NEAREST))
    gif[0].save(a.out + ".gif", save_all=True, append_images=gif[1:],
                duration=int(1000 / a.fps), loop=0)
    print(f"OK {a.out}.png / .gif / _proof.png")


if __name__ == "__main__":
    main()
