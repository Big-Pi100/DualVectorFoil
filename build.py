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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", default=DEFAULT_ATLAS)
    ap.add_argument("--man", default=DEFAULT_MAN)
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

    html = (tpl.replace("__MAN__", json.dumps(man, ensure_ascii=False))
               .replace("__B64__", b64)
               .replace("__AUDIO__", aud)
               .replace("__GAME__", game)
               .replace("__MOBILE__", mob))
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)
    print("→ %s  %.0fKB  (atlas %d×%d, %d 帧)"
          % (args.out, os.path.getsize(args.out) / 1024,
             man["meta"]["size"]["w"], man["meta"]["size"]["h"],
             len(man["frames"])))


if __name__ == "__main__":
    sys.exit(main())
