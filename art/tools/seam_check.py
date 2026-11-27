#!/usr/bin/env python3
"""底板接缝检查 —— 三段底板（left / mid / right）拼起来会不会露缝。

## 为什么单独一个工具

这条检查原本住在 `art/tools/scene_state.py` 里。2026-11-27 那支产线停用
（两态方案被环境光取代，见 `ASSET_RULES §3.2.6`），`--check` 整体 exit 2 ——
可接缝这条跟两态**毫无关系**，它只读母版 `ground_left/mid/right`，
那三张还在、还在被用。为了停一条废止的产线，把一条**仍然有效**的断言一起
埋掉，是拿"清理"当借口删证据。

所以抽出来独立成篇：scene_state 停用不影响它。

## 它守什么（两条不变量，现在成立）

1. `ground_mid` 左列 == 右列 —— 自身可以无限横铺
2. `ground_left` == `mirror(ground_right)` —— 两端是镜像关系

## 它报什么（已知缺陷，现在**不**断言）

`ground_left` 右缘与 `ground_mid` 左缘**并不相等**：实测最大差 141、平均 17，
144 行里只有 7 行相同。`manifest.json` 里那句「右缘与 ground_mid 左缘逐像素相等」
是假的 —— 已在 `§3.2.4` 记過。

这条差值平时无人消费（房间里 Floor 还是 `ColorRect` 纯色块），所以默认只报不断言。
`--strict` 才会拿它当门禁：**接 TileMapLayer 之前必须先跑通 `--strict`**。
不设默认阈值，是因为它现在必然红——让它默认红，等于让人习惯看红。

## 用法

    python art/tools/seam_check.py            # 两条不变量 + 差值实测
    python art/tools/seam_check.py --strict   # 额外要求差值 ≤8（接 TileMapLayer 前置）

退出码：0 通过 / 1 不变量被破坏 / 2 缺文件
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TERRAIN = ROOT / "art" / "approved" / "Terrain"

STEMS = ("ground_left", "ground_mid", "ground_right")

# 接 TileMapLayer 后相邻瓦片会紧贴，差值会在画面里连成竖线。
# 8/255 是八位色深下一个"看不出来"的量级；实测现在是 141，差得远。
STRICT_MAX_DELTA = 8


def path_of(stem: str) -> Path:
    return TERRAIN / f"{stem}.png"


def load() -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for s in STEMS:
        p = path_of(s)
        if not p.exists():
            raise FileNotFoundError(f"缺底板：{p}")
        out[s] = np.array(Image.open(p).convert("RGBA"))
    return out


def check(a: dict[str, np.ndarray]) -> list[str]:
    """两条不变量。破坏任何一条 → 拼起来必露缝。"""
    errs: list[str] = []
    mid = a["ground_mid"]
    if not np.array_equal(mid[:, 0], mid[:, -1]):
        errs.append("ground_mid: 左列 ≠ 右列 —— 自身不能无限横铺")
    if not np.array_equal(a["ground_left"], a["ground_right"][:, ::-1]):
        errs.append("ground_left ≠ mirror(ground_right) —— 两端不是镜像关系")
    return errs


def facts(a: dict[str, np.ndarray]) -> list[tuple[str, int, float, int, int]]:
    """接缝差值的实测（已知缺陷，如实报）。返回 (标签, 最大差, 平均, 相同行, 总行)。"""
    i = {k: v.astype(int) for k, v in a.items()}
    out = []
    for tag, x, y in (
        ("left右缘|mid左缘", i["ground_left"][:, -1], i["ground_mid"][:, 0]),
        ("mid右缘|right左缘", i["ground_mid"][:, -1], i["ground_right"][:, 0]),
    ):
        d = np.abs(x - y).max(1)
        out.append((tag, int(d.max()), float(d.mean()), int((d == 0).sum()), len(d)))
    return out


def main() -> int:
    strict = "--strict" in sys.argv[1:]
    try:
        a = load()
    except FileNotFoundError as e:
        print(f"[seam] {e}")
        return 2

    print(f"[seam] 底板 {len(a)} 张  {a['ground_mid'].shape[1]}×{a['ground_mid'].shape[0]}")

    print("\n[1] 不变量（现在必须成立）")
    errs = check(a)
    if errs:
        for e in errs:
            print(f"  ✗ {e}")
    else:
        print("  ✓ ground_mid 左列 == 右列（可无限横铺）")
        print("  ✓ ground_left == mirror(ground_right)")

    print("\n[2] 接缝差值实测（已知缺陷，默认只报不断言）")
    worst = 0
    for tag, mx, avg, same, total in facts(a):
        worst = max(worst, mx)
        print(f"  · {tag}: 最大差 {mx}  平均 {avg:.1f}  相同行 {same}/{total}")

    if strict:
        print(f"\n[3] --strict：接 TileMapLayer 前置（要求最大差 ≤{STRICT_MAX_DELTA}）")
        if worst > STRICT_MAX_DELTA:
            print(f"  ✗ 最大差 {worst} > {STRICT_MAX_DELTA} —— 底板还不能进 TileMapLayer，")
            print("    紧贴后会连成一条竖线。先把接缝修到一致再接线。")
            errs.append("strict: 接缝差超限")
        else:
            print(f"  ✓ 最大差 {worst} ≤ {STRICT_MAX_DELTA}")

    if errs:
        print(f"\n❌ 失败 {len(errs)} 条")
        return 1
    print("\n✅ 通过" + ("" if strict else f"（差值最大 {worst}，未消费；接 TileMapLayer 前跑 --strict）"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
