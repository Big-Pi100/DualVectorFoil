#!/usr/bin/env python3
"""asset_audit.py —— 美术资产体检：文件在不在、能不能用、有没有人用

为什么需要这个脚本：
  2026-11-25 那轮，`art/tiles/floor_0..5.png` 六张图一直躺在仓库里，
  文档写着"已无绘制入口，待恢复" —— 暗示图是好的、只要接线。
  实际打开看，6 张全是纸底 + 零星笔触，0 张有石头。**图和函数都得重做。**

  "资产存在" 和 "资产可用" 是两件事。这个脚本把两者分开报。

三档问题：
  P0  资产不可用（尺寸错 / 全透明 / 有图无消费点）→ 会直接导致游戏里看不到或画错
  P1  不一致（同类资产尺寸不统一 / 帧数与配置不符 / 命名不规范）→ 会静默降级
  P2  卫生（死引用 / 体积异常）→ 现在不影响，但会误导下一个人

用法：
  python art/tools/asset_audit.py
  python art/tools/asset_audit.py --strict     # 有 P0 就以退出码 1 结束
"""
import argparse
import glob
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CELL = 160
STATES = ["stand", "walk", "jump", "fall", "attack",
          "cast", "hurt", "crouch", "slide", "dash"]

p0, p1, p2 = [], [], []


def add(bucket: list, msg: str) -> None:
    bucket.append(msg)
    print(f"  {msg}")


def png_size(p: str):
    with Image.open(p) as im:
        return im.size, im.mode


# ── 1. 角色表 ────────────────────────────────────────────────
def audit_hero() -> None:
    print("\n[1] 角色表  art/hero/hero_<state>.png")
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "sprite_prompt", os.path.join(ROOT, "art", "prompts", "sprite_prompt.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cfg = mod.STATES

    total = 0
    for st in STATES:
        p = os.path.join(ROOT, "art", "hero", f"hero_{st}.png")
        if not os.path.exists(p):
            add(p0, f"P0 缺 hero_{st}.png —— build 会退回空包，该状态不画")
            continue
        (w, h), mode = png_size(p)
        want_n = cfg[st]["n"]
        got_n = w // CELL if w % CELL == 0 else -1
        total += got_n if got_n > 0 else 0
        if h != CELL:
            add(p0, f"P0 hero_{st}.png 高 {h}，应为 {CELL}")
        if got_n < 0:
            add(p0, f"P0 hero_{st}.png 宽 {w} 不是 {CELL} 的整数倍，帧会对不齐")
        elif got_n != want_n:
            add(p1, f"P1 hero_{st}.png 有 {got_n} 帧，sprite_prompt 配的是 {want_n} 帧")
        if "A" not in mode:
            add(p0, f"P0 hero_{st}.png 没有 alpha 通道（mode={mode}）")
        print(f"    {st:<7} {w}x{h}  {max(got_n, 0)} 帧")

    if total != sum(v["n"] for v in cfg.values()):
        add(p1, f"P1 总帧数 {total}，配置是 {sum(v['n'] for v in cfg.values())}")
    else:
        print(f"    ✓ 总帧数 {total}，与 sprite_prompt 一致")

    # 总表新鲜度：_ALL_STATES.png 没有生成脚本（手工拼），只能比 mtime。
    # 这张表是"10 状态并排肉眼验收"的唯一入口，过期了等于验收看到的是旧图。
    allp = os.path.join(ROOT, "art", "hero", "_ALL_STATES.png")
    if not os.path.exists(allp):
        add(p1, "P1 缺 _ALL_STATES.png —— 10 状态并排的肉眼验收没有入口")
    else:
        newest, newest_st = 0.0, ""
        for st in STATES:
            p = os.path.join(ROOT, "art", "hero", f"hero_{st}.png")
            if os.path.exists(p) and os.path.getmtime(p) > newest:
                newest, newest_st = os.path.getmtime(p), st
        if os.path.getmtime(allp) < newest:
            add(p1, f"P1 _ALL_STATES.png 比 hero_{newest_st}.png 旧 —— 总表过期，重拼一遍再验收")


# ── 2. 瓦片 ──────────────────────────────────────────────────
def audit_tiles() -> None:
    print("\n[2] 瓦片  art/tiles/<kind>_<i>.png")
    game = open(os.path.join(ROOT, "src", "game.js"), encoding="utf-8").read()
    files = sorted(glob.glob(os.path.join(ROOT, "art", "tiles", "*.png")))
    if not files:
        add(p1, "P1 art/tiles/ 下没有任何 PNG")
        return

    by_kind: dict[str, list] = {}
    for p in files:
        fn = os.path.basename(p)
        # build.py 的规则：下划线开头跳过；必须含 _ 才有 kind
        if fn.startswith("_"):
            add(p2, f"P2 {fn} 下划线开头，build.py 会跳过（如果这不是草稿，就是命名错）")
            continue
        if "_" not in fn:
            add(p1, f"P1 {fn} 不含下划线，build.py 收不到（kind 无法解析）")
            continue
        kind = fn.rsplit("_", 1)[0]
        (w, h), _ = png_size(p)
        by_kind.setdefault(kind, []).append((fn, w, h))

    for kind, items in sorted(by_kind.items()):
        sizes = {(w, h) for _, w, h in items}
        if len(sizes) > 1:
            add(p0, f"P0 {kind} 组内尺寸不一致 {sorted(sizes)} —— pattern 平铺会撕裂")
        used = len(re.findall(rf"tileImgs\.{kind}\b", game))
        flag = "✓" if used else "✗"
        print(f"    {kind:<8} {len(items)} 张  {next(iter(sizes))}  消费点 {used} 处 {flag}")
        if used == 0:
            add(p0, f"P0 {kind} 有 {len(items)} 张图，但 src/game.js 里没有任何 tileImgs.{kind} 读取点"
                    f" —— 「有图没人用」")


# ── 3. 背景 ──────────────────────────────────────────────────
def audit_bg() -> None:
    print("\n[3] 背景  art/bg/bg_<room>.png")
    game = open(os.path.join(ROOT, "src", "game.js"), encoding="utf-8").read()
    files = sorted(glob.glob(os.path.join(ROOT, "art", "bg", "bg_*.png")))
    if not files:
        add(p1, "P1 art/bg/ 下没有背景板 —— 房间会退回程序化绘制")
        return
    for p in files:
        fn = os.path.basename(p)
        room = fn[3:-4]
        (w, h), _ = png_size(p)
        if (w, h) != (960, 540):
            add(p1, f"P1 {fn} 是 {w}x{h}，规格 960x540（缩放在游戏里做，别把源图压了）")
        if room not in game:
            add(p1, f"P1 {fn} 的房间名 '{room}' 在 game.js 里找不到 —— ROOMS 键对不上")
        else:
            print(f"    {fn:<20} {w}x{h}  ✓ 房间键存在")
    if len(files) == 1:
        add(p2, "P2 只有一间房的背景 —— 第二个房间会复用或退回程序化")


# ── 4. 空图 / 单色 ───────────────────────────────────────────
def audit_degenerate() -> None:
    print("\n[4] 空图 / 单色检查")
    bad = 0
    for p in sorted(glob.glob(os.path.join(ROOT, "art", "**", "*.png"), recursive=True)):
        if "_ref" in p or "_archive" in p or "_rejected" in p:
            continue
        try:
            with Image.open(p) as im:
                rgba = im.convert("RGBA")
                ex = rgba.getextrema()
        except Exception as e:                       # noqa: BLE001
            add(p1, f"P1 打不开 {os.path.relpath(p, ROOT)}: {e}")
            continue
        if ex[3] == (0, 0):
            add(p0, f"P0 {os.path.relpath(p, ROOT)} 全透明")
            bad += 1
        elif len(set(ex[i] for i in range(3))) == 1 and ex[0][0] == ex[0][1]:
            add(p1, f"P1 {os.path.relpath(p, ROOT)} 是单色（生图失败常见产物）")
            bad += 1
    if not bad:
        print("    ✓ 无空图 / 单色图")


# ── 5. 死引用 ────────────────────────────────────────────────
REF_RE = re.compile(r"`([A-Za-z_][\w./\-]*\.(?:py|js|gd|gdshader|tscn|md|sh))`")
SKIP_DIR = {".git", "node_modules", ".godot", "__pycache__", "shots",
            "_archive", "_rejected", "_ref", "_exp"}


def _index_by_basename() -> dict:
    """文件名 → 实际位置。用于判断"文档只写了 game.js，没说 src/game.js"这种情况。

    同时索引仓库外的共享工具目录 `E:/IdentityCard/tools/`：
    `process_spritesheet.py` 是跨项目复用件，文档写裸文件名是对的。
    """
    idx: dict[str, list] = {}
    extra = os.path.join(os.path.dirname(ROOT), "tools")
    for base in [ROOT] + ([extra] if os.path.isdir(extra) else []):
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR]
            for fn in filenames:
                idx.setdefault(fn, []).append(os.path.join(dirpath, fn))
    return idx


def audit_refs() -> None:
    """只抓"路径失效"，不抓"省略目录"。

    判据：相对路径存在 → 过；否则同名文件在项目里存在 → 也算过（写的是裸文件名）；
    两者都不成立才算死引用。
    """
    print("\n[5] 文档死引用（md 里提到、但仓库里找不到的脚本）")
    idx = _index_by_basename()

    mds = glob.glob(os.path.join(ROOT, "*.md")) + \
        glob.glob(os.path.join(ROOT, "docs", "**", "*.md"), recursive=True) + \
        glob.glob(os.path.join(ROOT, "art", "**", "*.md"), recursive=True) + \
        glob.glob(os.path.join(ROOT, "godot", "*.md"))

    missing = {}
    for md in mds:
        rel = os.path.relpath(md, ROOT).replace("\\", "/")
        # INDEX 会列已删文件；ref 是别人的原文；history / _archive 是只读存档 —— 都不追
        if rel == "INDEX.md" or "_archive/" in rel or rel.startswith(("docs/ref/", "docs/history/")):
            continue
        text = open(md, encoding="utf-8", errors="ignore").read()
        for ref in set(REF_RE.findall(text)):
            if ref.startswith(("http", "res://")) or "<" in ref:
                continue
            if os.path.exists(os.path.join(ROOT, ref)):
                continue
            if os.path.basename(ref) in idx:
                continue                     # 省略了目录，文件确实存在
            missing.setdefault(ref, []).append(rel)

    if not missing:
        print("    ✓ 无死引用")
        return
    for ref, where in sorted(missing.items()):
        add(p2, f"P2 文档提到 `{ref}`，仓库里找不到（{', '.join(where[:3])}）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="有 P0 时以退出码 1 结束")
    a = ap.parse_args()

    print(f"资产体检  {ROOT}")
    audit_hero()
    audit_tiles()
    audit_bg()
    audit_degenerate()
    audit_refs()

    print("\n" + "─" * 60)
    print(f"P0 {len(p0)} 条 / P1 {len(p1)} 条 / P2 {len(p2)} 条")
    if p0:
        print("\nP0（资产不可用，必须先修）：")
        for m in p0:
            print("  " + m)
    if a.strict and p0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
