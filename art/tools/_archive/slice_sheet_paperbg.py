#!/usr/bin/env python3
"""
slice_sheet.py —— 把「一行 N 帧」的生成图，切成标准精灵表。

为什么要这一步，而不是让模型直接出标准表：
  模型画得出蜡笔，画不准网格 —— 实测两次：第一次第 3 帧断腿，第二次帧距不齐。
  所以分工：**模型负责画法，程序负责几何**。
  切完每帧都要满足 MOVESET §1 的硬规格：单帧 160×160、脚底锚点 (80,152)、角色高 128。

为什么不用"颜色阈值抠纸"：
  蜡笔里的白 T 恤 和纸底只差 30 出头 —— 这正是 STYLE_LOCK L2 说的"主角与纸同值"，
  用色差抠会把衣服一起抠掉（第一版就这么翻的车，整帧被压成一条）。
  所以走**暗轮廓**：每个部件都有深色描边，用亮度 <150 定人物范围，
  再从四角泛洪抠纸（描边闭合，泛洪进不去衣服）。

用法：
  python art/tools/slice_sheet.py <源图> <输出前缀> --frames 6 --trim-bottom 200
输出：<前缀>.png（行表）、<前缀>.gif（12fps 预览）、<前缀>_proof.png（验收图）
"""
import argparse
from PIL import Image, ImageDraw

PAPER = (243, 228, 199)
CELL = 160
ANCHOR = (80, 152)      # 脚底
CHAR_H = 128
SENTINEL = (255, 0, 255)


def dark_mask_bbox(im, box, lum_thr=150):
    """用深色描边定位人物：返回 box 内的 (x0,y0,x1,y1)，绝对坐标。"""
    sub = im.crop(box).convert("L")
    w, h = sub.size
    px = sub.load()
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        row = False
        for x in range(w):
            if px[x, y] < lum_thr:
                row = True
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
        if row:
            if y < y0:
                y0 = y
            if y > y1:
                y1 = y
    if x1 < 0:
        return None
    return (box[0] + x0, box[1] + y0, box[0] + x1 + 1, box[1] + y1 + 1)


def key_out_paper(cell, tol=34):
    """从四角泛洪把纸抠成透明。描边闭合，所以衣服不会被抠掉。"""
    w, h = cell.size
    work = cell.copy()
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        try:
            ImageDraw.floodfill(work, seed, SENTINEL, thresh=tol)
        except Exception:
            pass
    out = cell.convert("RGBA")
    wp, op = work.load(), out.load()
    for y in range(h):
        for x in range(w):
            if wp[x, y][:3] == SENTINEL:
                r, g, b, _ = op[x, y]
                op[x, y] = (r, g, b, 0)
    return out



def dewax_paper_inside(cell, tol=80):
    """人物内部的"纸色"往蜡白推一截。

    为什么：眼白和白 T 恤的原色和纸底只差 20~30，抠成透明背景后
    **看起来就是破洞**（实测 attack 帧的脸被读成"眼睛是洞"）。
    规范 L5 本来就规定"蜡白只给主角"，所以这不是修饰，是执行规范。
    """
    out = cell.copy()
    op = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = op[x, y]
            if a < 20:
                continue
            # 只动「接近纸色 **且低饱和**」的像素。
            # 第一版只判色差，把皮肤高光（暖褐色，饱和 60）也推成了白斑 ——
            # 脸上出现一块明显白，比破洞还难接受。加饱和度闸门即可。
            if (abs(r - PAPER[0]) + abs(g - PAPER[1]) + abs(b - PAPER[2]) < tol
                    and max(r, g, b) - min(r, g, b) < 22):
                op[x, y] = (
                    int(r + (251 - r) * 0.62),
                    int(g + (247 - g) * 0.62),
                    int(b + (236 - b) * 0.62),
                    a,
                )
    return out


def keep_main_component(cell, lum_thr=150):
    """只保留与"身体"连通的那一块，砍掉游离部件。

    为什么需要：实测三次里两次出现"拳头/腿脱离身体"（attack 第 1 帧飞出一个拳头）。
    这类错误不能靠重生成解决 —— 模型会反复犯。做法是把前景做成 mask，
    从身体中列泛洪，**没被泛洪到的前景直接透明掉**。
    """
    w, h = cell.size
    g = cell.convert("L")
    gp = g.load()
    mask = Image.new("RGB", (w, h), (0, 0, 0))
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if gp[x, y] < lum_thr:
                mp[x, y] = (255, 255, 255)
    # 种子：取前景像素最多的那一列的中点
    colc = [0] * w
    for y in range(h):
        for x in range(w):
            if mp[x, y][0]:
                colc[x] += 1
    if max(colc) == 0:
        return cell
    bx = colc.index(max(colc))
    by = next(y for y in range(h) if mp[bx, y][0])
    ImageDraw.floodfill(mask, (bx, by), (0, 255, 0), thresh=0)
    out = cell.convert("RGBA")
    op = out.load()
    removed = 0
    for y in range(h):
        for x in range(w):
            if mp[x, y] == (255, 255, 255):      # 前景但没被泛洪到 = 游离件
                r, gg, b, aa = op[x, y]
                op[x, y] = (r, gg, b, 0)
                removed += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--frames", type=int, default=6)
    ap.add_argument("--trim-bottom", type=int, default=200, help="裁掉水印带")
    ap.add_argument("--fps", type=int, default=12)
    ap.add_argument("--anchor", default="feet", choices=["feet", "pelvis"],
                    help="feet=地面状态；pelvis=空中状态（收腿时脚底不是躯干参考点）")
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    if a.trim_bottom:
        im = im.crop((0, 0, im.width, im.height - a.trim_bottom))

    # 切分：在每个「预期位置」附近找**暗像素最少的一列**当刀口。
    # 等分会在人物跨过边界时把人劈成两半（实测 f1 被切掉后脑勺），必须按能量最小值切。
    lum = im.convert("L").load()
    W, H = im.size
    energy = [sum(1 for y in range(0, H, 2) if lum[x, y] < 150) for x in range(W)]
    step = W / a.frames
    cuts = [0]
    for i in range(1, a.frames):
        c = i * step
        lo, hi = int(c - step * 0.28), int(c + step * 0.28)
        lo, hi = max(1, lo), min(W - 2, hi)
        best = min(range(lo, hi), key=lambda x: energy[x])
        cuts.append(best)
    cuts.append(W)
    segs = [(cuts[i], cuts[i + 1]) for i in range(a.frames)]
    print("刀口:", cuts)
    sheet = Image.new("RGBA", (CELL * a.frames, CELL), (0, 0, 0, 0))
    marks = Image.new("RGB", (CELL * a.frames, CELL), PAPER)
    md = ImageDraw.Draw(marks)
    # 两遍：先量所有帧，**共用一个缩放系数**。
    # 逐帧各自缩到 128 会让"抬腿帧（身高更高）"被压小，头围一帧一个样 ——
    # 实测这比帧距不齐更刺眼：动画看起来像在"呼吸缩放"。
    boxes = []
    for i in range(a.frames):
        x0, x1 = segs[i]
        bb = dark_mask_bbox(im, (x0, 0, x1, im.height))
        if not bb:
            print(f"  f{i + 1}: 空")
            continue
        boxes.append((i, bb))
    if not boxes:
        raise SystemExit("没有找到人物")
    hmax = max(bb[3] - bb[1] for _, bb in boxes)
    k = CHAR_H / hmax
    print(f"共用缩放：1px -> {k:.4f}（最高帧 {hmax}px）")

    for i, bb in boxes:
        cell = im.crop(bb)
        h = max(1, round(cell.height * k))
        w = max(1, round(cell.width * k))
        cell = cell.resize((w, h), Image.LANCZOS)
        cell = key_out_paper(cell)
        cell = keep_main_component(cell)
        cell = dewax_paper_inside(cell)
        x = i * CELL + ANCHOR[0] - w // 2
        if a.anchor == "pelvis":
            # 骨盆锚：站立时骨盆在脚底上方 58px（128 × 45%）。
            # 收腿帧的脚底会浮起来，用脚底锚会让整个人陷进地里。
            y = int(ANCHOR[1] - 58 - h * 0.55) + 58
            y = int(ANCHOR[1] - 58 - (h - 58) * 0.55)
        else:
            y = ANCHOR[1] - h
        sheet.alpha_composite(cell, (x, y))
        bgc = Image.new("RGB", (CELL, CELL), PAPER)
        bgc.paste(cell, (ANCHOR[0] - w // 2, y), cell)
        marks.paste(bgc, (i * CELL, 0))
        md.text((i * CELL + 6, 4), f"f{i + 1}", fill=(43, 35, 32))
        md.line([(i * CELL, ANCHOR[1]), ((i + 1) * CELL, ANCHOR[1])], fill=(190, 90, 90))
        print(f"  f{i + 1}: 高={h} 宽={w} 落点=({x},{y})")

    sheet.save(a.out + ".png")
    marks = marks.resize((marks.width * 3, marks.height * 3), Image.NEAREST)
    marks.save(a.out + "_proof.png")
    print(f"锚点={a.anchor}  共用缩放系数={k:.4f}")

    frames = []
    for i in range(a.frames):
        f = Image.new("RGB", (CELL, CELL), PAPER)
        c = sheet.crop((i * CELL, 0, (i + 1) * CELL, CELL))
        f.paste(c, (0, 0), c)
        frames.append(f.resize((CELL * 2, CELL * 2), Image.NEAREST))
    frames[0].save(a.out + ".gif", save_all=True, append_images=frames[1:],
                   duration=int(1000 / a.fps), loop=0)
    print(f"OK {a.out}.png / .gif / _proof.png")


if __name__ == "__main__":
    main()
