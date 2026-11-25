#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — 把 src/ 打成单文件可玩的 HTML（含 atlas 的 base64）

为什么单文件：游戏要能双击就开、也能直接丢进浏览器预览面板，
file:// 下 fetch 会被拦，所以 atlas.png 必须内联。

用法:
    python build.py            # → SoulKeep.html
    python build.py --atlas <atlas.png> --man <atlas.json>
"""
import argparse
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ATLAS = os.path.join(HERE, "..", "verify", "svg-lab", "pipeline",
                             "anim_out", "export", "atlas.png")
DEFAULT_MAN = os.path.join(HERE, "..", "verify", "svg-lab", "pipeline",
                           "anim_out", "export", "atlas.json")
# 蜡笔包（P6 定版）：art/hero/hero_<state>.png，每张 n 帧横排、帧框 160×160。
# 目录约定和帧数必须与 art/prompts/sprite_prompt.py 的 STATES 对齐，
# 所以这里**不写死帧数**，只核对文件在不在 —— 帧数由 game.js 的 CRAYON.n 说了算，
# 两处不一致会在下面那句打印里露出来（帧宽 = 图宽 / n 不是 160 就是错）。
DEFAULT_CRAYON = os.path.join(HERE, "art", "hero")
CRAYON_STATES = ["stand", "walk", "jump", "fall", "attack",
                 "cast", "hurt", "crouch", "slide", "dash"]
CRAYON_CELL = 160


def load_crayon(d):
    """→ ({state: b64}, [缺失/尺寸异常的提示], 总字节)"""
    out, warn, total = {}, [], 0
    for st in CRAYON_STATES:
        p = os.path.join(d, "hero_%s.png" % st)
        if not os.path.exists(p):
            warn.append("缺 hero_%s.png" % st)
            continue
        with open(p, "rb") as f:
            raw = f.read()
        out[st] = base64.b64encode(raw).decode()
        total += len(raw)
        # 只做宽度整除检查：能整除说明格子对齐，具体几帧交给 game.js
        try:
            import struct
            w, h = struct.unpack(">II", raw[16:24])
            if h != CRAYON_CELL or w % CRAYON_CELL:
                warn.append("hero_%s.png 尺寸 %dx%d 不是 160 的整数倍" % (st, w, h))
            else:
                print("   %-7s %2d 帧  %dx%d  %4dKB"
                      % (st, w // CRAYON_CELL, w, h, len(raw) // 1024))
        except Exception:
            pass
    return out, warn, total


def load_bg(d):
    """→ {roomId: b64}；文件命名 bg_<room>.png，房间 id 与 ROOMS 的键一致"""
    out = {}
    if not os.path.isdir(d):
        return out
    for fn in sorted(os.listdir(d)):
        if not (fn.startswith("bg_") and fn.endswith(".png")):
            continue
        room = fn[3:-4]
        p = os.path.join(d, fn)
        with open(p, "rb") as f:
            raw = f.read()
        out[room] = base64.b64encode(raw).decode()
        print("   背景 %-6s %4dKB" % (room, len(raw) // 1024))
    return out


DEFAULT_TILES = os.path.join(HERE, "art", "tiles")


def load_tiles(d):
    """→ ({kind: [b64,...]}, 总字节)；文件命名 `<kind>_<i>.png`

    为什么要瓦片：一张整图把房间长度锁死了（回廊 32 格正好一张，钟塔要重出），
    也没法分视差层。瓦片随便多长、能分层、一套资产供所有房间。
    """
    out, total = {}, 0
    if not os.path.isdir(d):
        return out, 0
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".png") or "_" not in fn:
            continue
        # 下划线开头 = 草稿/实验/中间产物，一律不进包。
        # 这条是踩出来的：p5.brush 调瓦片期间生成了十几个 _exp_/_new_ 对比图，
        # 全被当成新"类别"打进包里，单文件从 2.5MB 涨到 4.3MB。
        if fn.startswith("_"):
            continue
        kind = fn.rsplit("_", 1)[0]
        p = os.path.join(d, fn)
        with open(p, "rb") as f:
            raw = f.read()
        out.setdefault(kind, []).append(base64.b64encode(raw).decode())
        total += len(raw)
        print("   瓦片 %-10s %4dKB" % (fn, len(raw) // 1024))
    return out, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", default=DEFAULT_ATLAS)
    ap.add_argument("--man", default=DEFAULT_MAN)
    ap.add_argument("--crayon", default=DEFAULT_CRAYON)
    ap.add_argument("--bg", default=os.path.join(HERE, "art", "bg"))
    ap.add_argument("--tiles", default=DEFAULT_TILES)
    ap.add_argument("--out", default=os.path.join(HERE, "SoulKeep.html"))
    args = ap.parse_args()

    # 贴图是可选的：拿不到就用空图集，游戏退化成程序化矢量绘制
    # （game.js 里是 `if (atlasMan && b64)` 才装载，空 base64 天然跳过）。
    # 为什么必须降级而不是报错：这个项目要能"解压出来直接 python build.py"就构建，
    # atlas 不在仓库里（它是上游管线产物），硬依赖会让别人第一步就卡住。
    if os.path.exists(args.atlas) and os.path.exists(args.man):
        with open(args.atlas, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        with open(args.man, encoding="utf-8") as f:
            man = json.load(f)
    else:
        print("⚠ 找不到 atlas/manifest（%s），用空图集构建：游戏将使用程序化绘制"
              % os.path.dirname(args.atlas))
        b64 = ""
        man = {"meta": {"size": {"w": 0, "h": 0}}, "frames": {}}

    tpl = open(os.path.join(HERE, "src", "index.html"), encoding="utf-8").read()
    game = open(os.path.join(HERE, "src", "game.js"), encoding="utf-8").read()
    mob = open(os.path.join(HERE, "src", "mobile.js"), encoding="utf-8").read()
    aud = open(os.path.join(HERE, "src", "audio.js"), encoding="utf-8").read()

    print("蜡笔包（%s）：" % args.crayon)
    crayon, cwarn, cbytes = load_crayon(args.crayon)
    for w in cwarn:
        print("   ⚠ " + w)
    if cwarn:
        print("   → 缺的会退回空，游戏里对应状态不画（不会崩，但那是残缺的包）")

    print("背景板（%s）：" % args.bg)
    bg = load_bg(args.bg)
    if not bg:
        print("   （无）→ 房间仍用程序化背景")

    print("蜡笔瓦片（%s）：" % args.tiles)
    tiles, tbytes = load_tiles(args.tiles)
    if not tiles:
        print("   （无）→ 墙面退回整图/程序化绘制")

    html = (tpl.replace("__MAN__", json.dumps(man, ensure_ascii=False))
               .replace("__B64__", b64)
               .replace("__CRAYON__", json.dumps(crayon))
               .replace("__BG__", json.dumps(bg))
               .replace("__TILES__", json.dumps(tiles))
               .replace("__AUDIO__", aud)
               .replace("__GAME__", game)
               .replace("__MOBILE__", mob))
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)
    print("→ %s  %.0fKB  (atlas %d×%d, %d 帧；蜡笔 %d 张 / %dKB；背景 %d 张；瓦片 %d 类 / %dKB)"
          % (args.out, os.path.getsize(args.out) / 1024,
             man["meta"]["size"]["w"], man["meta"]["size"]["h"],
             len(man["frames"]), len(crayon), cbytes // 1024, len(bg),
             len(tiles), tbytes // 1024))


if __name__ == "__main__":
    sys.exit(main())
