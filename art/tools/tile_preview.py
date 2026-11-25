#!/usr/bin/env python3
"""瓦片检查图：放大看笔触，平铺看接缝。

    python art/tools/tile_preview.py A B C          # 实验对比
    python art/tools/tile_preview.py wall_0 wall_1  # 正式瓦片

为什么两栏都要看：
  - 1 倍平铺看的是"读起来像不像墙"和"能不能数出方格"；
  - 3 倍放大看的是"笔触有没有被纸纹吃掉"。
  只看 1 倍，砖缝糊了也看不出来；只看 3 倍，看不出重复感。
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
N = 192
COLS, ROWS = 4, 3


def load(name):
    p = os.path.join(ROOT, 'art', 'tiles', f'{name}.png')
    return Image.open(p).convert('RGB')


def main(names):
    imgs = [load(n) for n in names]
    for n, im in zip(names, imgs):
        if im.size != (N, N):
            print(f'  ! {n} 尺寸 {im.size}，期望 {(N, N)}')

    k = 3
    gap = 8
    w1 = len(imgs) * (N * k) + (len(imgs) - 1) * gap
    w2 = COLS * N
    W = max(w1, w2) + gap * 2
    H = gap + N * k + gap + ROWS * N + gap
    cv = Image.new('RGB', (W, H), (24, 24, 28))

    x = gap
    for im in imgs:
        cv.paste(im.resize((N * k, N * k), Image.NEAREST), (x, gap))
        x += N * k + gap
    x = gap
    for im in imgs:
        for r in range(ROWS):
            for c in range(COLS):
                cv.paste(im, (x + c * N, gap + N * k + gap + r * N))
        x += COLS * N + gap

    out = os.path.join(ROOT, 'shots', 'tile_check.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cv.save(out)
    print('→', os.path.relpath(out, ROOT), cv.size)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('用法: python art/tools/tile_preview.py <名字...>')
    main(sys.argv[1:])
