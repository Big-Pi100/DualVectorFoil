#!/usr/bin/env python3
"""把生图素材合成为真实游戏画面。程序只做分层/定位/视差，不画任何形状。"""
import sys
from PIL import Image, ImageFilter, ImageEnhance

W, H = 1280, 720
GROUND_Y = 566          # 可站立面
HERO_H = 100            # 运行时主角身高（代码 P_H 的真实值，不是 150）
MAGENTA = (255, 0, 255)


def load_rgba(path, crop_bottom=0):
    im = Image.open(path).convert('RGB')
    if crop_bottom:
        im = im.crop((0, 0, im.width, im.height - crop_bottom))
    px = im.load()
    w, h = im.size
    a = Image.new('L', (w, h), 255)
    ap = a.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r > 120 and b > 120 and g < (min(r, b) - 40):
                ap[x, y] = 0
    im = im.convert('RGBA')
    im.putalpha(a)
    return im


def sky(w, h):
    top, mid, bot = (0xa6, 0xdb, 0xee), (0xd7, 0xee, 0xf0), (0xff, 0xef, 0xd2)
    img = Image.new('RGB', (w, h))
    d = img.load()
    for y in range(h):
        t = y / (h - 1)
        if t < 0.55:
            k = t / 0.55
            c = tuple(round(top[i] + (mid[i] - top[i]) * k) for i in range(3))
        else:
            k = (t - 0.55) / 0.45
            c = tuple(round(mid[i] + (bot[i] - mid[i]) * k) for i in range(3))
        for x in range(w):
            d[x, y] = c
    return img


def place(canvas, layer, x, bottom_y, width=None, scale=1.0, **kw):
    if width:
        r = width / layer.width
        layer = layer.resize((width, max(1, round(layer.height * r))), Image.LANCZOS)
    if scale != 1.0:
        layer = layer.resize((max(1, round(layer.width * scale)),
                              max(1, round(layer.height * scale))), Image.LANCZOS)
    y = bottom_y - layer.height
    canvas.alpha_composite(layer, (round(x), round(y)))
    return layer


def make(bg_path, ground_path, hero_path, out_path, tree_width=1720, tree_y=578,
         far=True):
    canvas = sky(W, H).convert('RGBA')

    trees = load_rgba(bg_path, crop_bottom=84)
    ground = load_rgba(ground_path, crop_bottom=84)

    # 远景：树的副本，压暗+去饱和+模糊，制造空气透视
    if far:
        f = trees.copy()
        f = ImageEnhance.Color(f).enhance(0.42)
        f = ImageEnhance.Brightness(f).enhance(1.10)
        f = f.filter(ImageFilter.GaussianBlur(2.4))
        place(canvas, f, -180, 502, width=round(tree_width * 1.18))

    place(canvas, trees, -140, tree_y, width=tree_width)

    # 地面：草线上沿(约图高 40%)对齐 GROUND_Y
    gw = 1440
    gr = gw / ground.width
    gh = round(ground.height * gr)
    place(canvas, ground, -60, GROUND_Y + round(gh * 0.40), width=gw)

    hero = load_rgba(hero_path)
    r = HERO_H / hero.height
    hero = hero.resize((round(hero.width * r), HERO_H), Image.LANCZOS)
    canvas.alpha_composite(hero, (392, GROUND_Y - hero.height + 2))

    canvas.convert('RGB').save(out_path)
    print('wrote', out_path, canvas.size)


if __name__ == '__main__':
    S = 'art/src/'
    make(S + 'PRODUCTION_BACKGROUND_LAYER____2026-11-24T17-42-20.png',
         S + 'PRODUCTION_GROUND_LAYER___the__2026-11-24T17-42-57.png',
         'art/out/card_painted.png',
         'art/out/composite_v1.png')
