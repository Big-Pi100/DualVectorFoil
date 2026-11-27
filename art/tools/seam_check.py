#!/usr/bin/env python3
"""底板接缝检查 —— 三段底板（left / mid / right）拼起来会不会露缝。

## 结论先说（2026-11-27 改）

**这批底板不需要修。** 接缝平均差 16.2，而**同一块材料内部相邻两列就差 18.6** ——
接缝比它自身的笔触变化还平滑。切 96 宽 tile 后内部切点差 16.3，与接缝同级。

之前判"差 141、要修"是**三个统计口径错误叠出来的假警报**，详见下面「上一版错在哪」。

## 判据：相对噪声，不是绝对阈值

蜡笔纹理是逐像素随机的，**任何位置相邻两列都差 ~18**。所以：
- 「接缝 ≤8」这种绝对阈值 = 要求接缝比材料自身更平滑 → 物理上做不到
- 有意义的问法是：**接缝处的差，比材料内部正常的笔触差更大吗？**

    接缝平均差 / 噪声基线  ≤ 1.2   →  不露缝

现在 left|mid = 16.2 / 18.6 = **0.87**，通过。

这条判据自己也会被验：`--strict` 会先把噪声基线算出来打印，
没有基线就不下结论（防止哪天阈值又变成拍脑袋）。

## 上一版错在哪（三处口径，都在 `scene_state.py::seam_facts()`）

| 错法 | 后果 |
| --- | --- |
| 在**全部 144 行**上比差 | 一侧透明的边界行贡献了 **141** 的假最大值；只算双方都有内容的 **135 行**，最大是 87 |
| 「相同行数」不排除双方都透明 | 报「144 行里 7 行相同」，可那 7 行**两边都是空的**，不是纹理对上了 |
| 没有噪声基线 | 阈值只能拍脑袋，8 / 47 / 141 全凭感觉 |

第三条最要命：**没有参照的数值不是判据，是印象。**
本项目在"参照物选错"上已经栽过一次（`--matrix` 第一版拿整块瓦片主色当参照，
把看得清的纸虱判死），这是第二次，只不过错的参照从"颜色"换成了"基线"。

## 现在守什么

1. `ground_mid` 左列 == 右列（自铺，逐字节相等，不容许近似）
2. `ground_left` == `mirror(ground_right)`（两端镜像）
3. 两处接缝的平均差 ≤ 噪声基线 × 1.2
4. mid 按 96 切 4 块后，三个内部切点同样过第 3 条（`--tile`）

## 用法

    python art/tools/seam_check.py            # 两条不变量 + 接缝/噪声比 + tile 切点
    python art/tools/seam_check.py --tile     # 额外验 96×144 切块后的内部切点

退出码：0 通过 / 1 不通过 / 2 缺文件
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TERRAIN = ROOT / "art" / "approved" / "Terrain"

STEMS = ("ground_left", "ground_mid", "ground_right")

## 接缝差 / 噪声基线 的上限。
## 1.2 的依据：噪声基线本身是"相邻两列的平均差"，接缝只要不比它突出就算连续。
## 取 1.2 而不是 1.0，是因为接缝是两条独立绘制的边缘，允许比同侧平均高一点；
## 实测现在 0.87，离门槛还有余量，不是"卡着过"。
SEAM_NOISE_RATIO = 1.2

## TileSet 统一的瓦片宽（mid 384 = 4 × 96，所以整条地面只有一种 tile 尺寸）
TILE_W = 96

## 判定"看得见"的 alpha 门槛：低于这个值的像素在游戏里接近透明，
## 拿它参与比较只会制造假差（上一版就是栽在这里）。
ALPHA_VISIBLE = 200


def path_of(stem: str) -> Path:
    return TERRAIN / f"{stem}.png"


def load() -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for s in STEMS:
        p = path_of(s)
        if not p.exists():
            raise FileNotFoundError(f"缺底板：{p}")
        out[s] = np.array(Image.open(p).convert("RGBA")).astype(int)
    return out


def col_diff(x: np.ndarray, y: np.ndarray) -> np.ndarray | None:
    """两列像素的差，**只在双方都看得见的行**上取。

    透明行必须排除：一侧有内容、另一侧空的边界行，差多少都无所谓 ——
    那位置在游戏里根本画不出对比。上一版没排除，才报出 141。
    """
    ok = (x[:, 3] > ALPHA_VISIBLE) & (y[:, 3] > ALPHA_VISIBLE)
    if ok.sum() < 8:
        return None
    return np.abs(x[:, :3] - y[:, :3]).max(1)[ok]


def noise_baseline(img: np.ndarray, step: int = 13) -> float:
    """噪声基线：材料**内部**连续两列的平均差。

    这是所有判据的参照物。没有它，"接缝差 16"这个数字说明不了任何事 ——
    可能很糟（材料本身很平），也可能很好（材料本身很糙）。
    """
    vals = []
    for c in range(step, img.shape[1] - 1, step):
        d = col_diff(img[:, c], img[:, c + 1])
        if d is not None:
            vals.append(d.mean())
    return float(np.mean(vals)) if vals else 0.0


def invariants(a: dict[str, np.ndarray]) -> list[str]:
    """两条必须逐字节成立的不变量。近似不行 —— 自铺要拼几十次。"""
    errs: list[str] = []
    mid = a["ground_mid"]
    if not np.array_equal(mid[:, 0], mid[:, -1]):
        errs.append("ground_mid: 左列 ≠ 右列 —— 自身不能无限横铺")
    if not np.array_equal(a["ground_left"], a["ground_right"][:, ::-1]):
        errs.append("ground_left ≠ mirror(ground_right) —— 两端不是镜像关系")
    return errs


def seams(a: dict[str, np.ndarray]) -> list[tuple[str, float, float, float, int]]:
    """(标签, 平均差, p95, 最大, 可比行数)"""
    L, M, R = a["ground_left"], a["ground_mid"], a["ground_right"]
    out = []
    for tag, x, y in (("left右缘|mid左缘", L[:, -1], M[:, 0]),
                      ("mid右缘|right左缘", M[:, -1], R[:, 0])):
        d = col_diff(x, y)
        if d is None:
            out.append((tag, -1.0, -1.0, -1.0, 0))
        else:
            out.append((tag, float(d.mean()), float(np.percentile(d, 95)), float(d.max()), len(d)))
    return out


def tile_cuts(a: dict[str, np.ndarray]) -> list[tuple[int, float, float, float, int]]:
    """mid 按 TILE_W 切块后的内部切点。切进 TileSet 后这些位置会紧贴。"""
    M = a["ground_mid"]
    out = []
    for cut in range(TILE_W, M.shape[1], TILE_W):
        d = col_diff(M[:, cut - 1], M[:, cut])
        if d is None:
            out.append((cut, -1.0, -1.0, -1.0, 0))
        else:
            out.append((cut, float(d.mean()), float(np.percentile(d, 95)), float(d.max()), len(d)))
    return out


def main() -> int:
    args = set(sys.argv[1:])
    unknown = args - {"--tile"}
    if unknown:
        # 必须拦：以前传错参数（比如改成 --tile 之前的 --strict）会被静默忽略，
        # 于是"跑了但没验"报 PASS —— 和要求"空清单不许 PASS"是同一条纪律。
        print(f"[seam] 不认识的参数 {sorted(unknown)}")
        print("  支持：--tile（额外验 mid 按 96 切块后的内部切点）")
        return 2
    want_tile = "--tile" in args
    try:
        a = load()
    except FileNotFoundError as e:
        print(f"[seam] {e}")
        return 2

    h, w = a["ground_mid"].shape[:2]
    print(f"[seam] 底板 3 张，mid {w}×{h} = {w // TILE_W} 块 {TILE_W}×{h}")

    print("\n[1] 不变量（逐字节，近似不行）")
    errs = invariants(a)
    if errs:
        for e in errs:
            print(f"  ✗ {e}")
    else:
        print("  ✓ ground_mid 左列 == 右列（可无限横铺）")
        print("  ✓ ground_left == mirror(ground_right)")

    # 噪声基线：所有判据的参照物。先算它，再看接缝。
    base = noise_baseline(a["ground_mid"])
    print(f"\n[2] 噪声基线（mid 内部相邻列平均差）= {base:.1f}")
    print("    ↑ 没有这个数，下面的接缝差说明不了任何事")

    print("\n[3] 接缝（只在双方都不透明的行上比）")
    worst_ratio = 0.0
    for tag, avg, p95, mx, n in seams(a):
        if avg < 0:
            print(f"  ✗ {tag}: 可比行太少，无法判断")
            errs.append(tag)
            continue
        ratio = avg / base if base > 0 else 999.0
        worst_ratio = max(worst_ratio, ratio)
        ok = ratio <= SEAM_NOISE_RATIO
        mark = "✓" if ok else "✗"
        print(f"  {mark} {tag}: 平均 {avg:5.1f}  p95 {p95:5.0f}  最大 {mx:3.0f}  "
              f"可比 {n:3d} 行  →  噪声比 {ratio:.2f}（门槛 {SEAM_NOISE_RATIO}）")
        if not ok:
            errs.append(f"{tag} 噪声比 {ratio:.2f}")

    if want_tile:
        print(f"\n[4] --tile：mid 按 {TILE_W} 切块，内部切点会不会露缝")
        for cut, avg, p95, mx, n in tile_cuts(a):
            if avg < 0:
                print(f"  · x={cut:3d}: 可比行太少，跳过")
                continue
            ratio = avg / base if base > 0 else 999.0
            worst_ratio = max(worst_ratio, ratio)
            ok = ratio <= SEAM_NOISE_RATIO
            print(f"  {'✓' if ok else '✗'} x={cut:3d}: 平均 {avg:5.1f}  最大 {mx:3.0f}  "
                  f"可比 {n:3d} 行  →  噪声比 {ratio:.2f}")
            if not ok:
                errs.append(f"tile x={cut} 噪声比 {ratio:.2f}")

    if errs:
        print(f"\n❌ 失败 {len(errs)} 条")
        return 1
    print(f"\n✅ 通过 —— 最大噪声比 {worst_ratio:.2f}，接缝不比材料自身的笔触更明显")
    if not want_tile:
        print(f"   （接 TileSet 前跑一次 --tile，验 {TILE_W} 宽切块的内部切点）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
