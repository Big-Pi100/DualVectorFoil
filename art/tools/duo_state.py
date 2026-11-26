#!/usr/bin/env python3
"""duo_state.py —— 一套造型，两套色系（怪 ↔ 原住民）的唯一产出入

## 为什么要有这个工具

2026-11-27 白哥定：**原住民就是树上的动物，有怪物和原住民两种形态**
（史莱姆-小精灵、暗黑蝙蝠-粉色蝙蝠），而且要求
**「完全同样造型的两套色系的美术资产」**。

这句话如果照字面执行 = 每个敌人画两遍 = 美术量直接翻倍。
但 `art/ASSET_RULES.md §0` 早就写了这条路：

> 同一形状换调色板就是地下关、城堡关、夜关 —— **不重画，只换色**；
> 判据：换色前后轮廓是否一致。

所以本工具不是新发明，是把 R3（换色）从「地形主题」**接到敌人状态上**。
一套 sprite + 一次色彩变换 = 两个形态。

## 变换为什么是「提亮 + 去脏 + 微暖」而不是「换成另一个颜色」

叙事上（`docs/gdd/05_叙事与主角.md §1.5`）：黑暗化 = 病原堵住导管 + 黑色素沉积
（**黑就是堵**）。所以「叫醒」不是给它刷一层新漆，是**把渗进去的墨洗掉**。

色彩上就对应三件事：
- `lift`  **提亮**：往白里推 —— 墨被洗掉，明度回来
- `sat`   **去脏**：压饱和 —— 沉积物没了，颜色变干净
- `hue`   **微暖**：色相往暖偏一点点 —— 活的、有血色的

> 意外收获（实测，见 `_probe.png`）：史莱姆原本是深紫，提亮去脏后**自然变粉紫**。
> 白哥要的「粉色蝙蝠 / 史莱姆-小精灵」不需要扩 12 色蜡笔盒
> —— **粉是紫黑在明度/饱和变换后的自然产物**（`STYLE_LOCK §L5` 第 12 色紫黑 `#3B2340`）。
> 这条很重要：如果为了"粉"去加第 13 色，就破了「一盒 12 色」的硬约束。

## 它做不到什么（必须写下来，否则会被当成万能）

色系变换能表达**「同一只生物的状态」**，不能表达**「另一种气质」**。

实测三张：
- 史莱姆：深紫带刺 → 淡粉团子，**成立**（它本来就是圆的、软的）
- 蝙蝠：深紫红 → 淡灰紫，**勉强**（凶的那双眼睛还在，靠颜色盖不住）
- 刺球：蓝色带红刺 → 淡蓝，**不成立**（蓝海胆提亮还是蓝海胆）

结论：**色系管"状态"，眼睛管"情绪"。**
要让"可爱"真的成立，`enemy_*_ally` 还需要**第二套眼睛**（瞳仁放大、眼白露出来 = 几像素的 patch），
那是 §「待做」里的事，不在本工具范围内。**本工具只保证"同造型、换色系"这一半。**

## 用法

    python art/tools/duo_state.py            # 生成 ally 版到 art/approved/Enemies/
    python art/tools/duo_state.py --check    # 只验：已生成的 ally 版轮廓是否逐像素等于 dark 版
    python art/tools/duo_state.py --sheet    # 额外输出对比图到 art/out/duo/_sheet.png

ally 版的落点是 **`art/approved/Enemies/`**，不是 `out/`：
白哥要的是"两套色系的美术资产"，那它就得和 dark 版并排躺在 approved 里、
在 manifest 里有条目、被 `asset_wiring` 管着。放 out/ 就只是一次性产物，下个人不知道它存在。

## 断言（这四条就是"完全同样造型"的可判定定义）

1. 尺寸相同
2. **alpha 掩码逐像素相同** —— 改一个像素的轮廓就等于"不是同一个造型"
3. alpha 通道的数值分布相同（半透明边缘也不能动，否则边缘会变毛）
4. 亮部像素占比上升（否则等于什么都没做 —— 提亮了但图没变亮，说明参数被改坏了）
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ART = Path(__file__).resolve().parents[1]
ROOT = ART.parent
MANIFEST = ART / "approved" / "manifest.json"
ENEMY_DIR = ART / "approved" / "Enemies"      # ally 版是**资产**，不是临时产物
SHEET_DIR = ART / "out" / "duo"               # 对比图才是临时产物

# 默认变换参数（三张实测选定：史莱姆成立、蝙蝠勉强、刺球不成立 —— 见模块 docstring）
DEFAULT = {"lift": 0.55, "sat": 0.42, "hue": 0.015}

# 只处理这两类：敌人。角色（player）不参与 —— 主角没有"黑暗化形态"。
ENEMY_CATEGORY = "Enemies"


# ── HSV（自己写，不引 cv2：这个工程只依赖 PIL + numpy） ──────────────
def _to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    f = rgb.astype(np.float32) / 255.0
    mx, mn = f.max(-1), f.min(-1)
    d = mx - mn
    v = mx
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    idx = m & (mx == r)
    h[idx] = ((g - b)[idx] / d[idx]) % 6
    idx = m & (mx == g)
    h[idx] = ((b - r)[idx] / d[idx]) + 2
    idx = m & (mx == b)
    h[idx] = ((r - g)[idx] / d[idx]) + 4
    return h / 6.0, s, v


def _from_hsv(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    h = (h % 1.0) * 6.0
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    out = np.zeros(v.shape + (3,), np.float32)
    table = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    for k, (R, G, B) in enumerate(table):
        m = i == k
        out[..., 0][m], out[..., 1][m], out[..., 2][m] = R[m], G[m], B[m]
    return (np.clip(out, 0, 1) * 255).round().astype(np.uint8)


def transform(im: Image.Image, lift: float, sat: float, hue: float) -> Image.Image:
    """dark → ally。只动 RGB，**alpha 原样搬过去**（这是"同造型"的硬保证）。"""
    a = np.array(im.convert("RGBA"))
    rgb, alpha = a[..., :3].copy(), a[..., 3].copy()
    h, s, v = _to_hsv(rgb)
    v2 = 1 - (1 - v) * (1 - lift)      # 往白里推 lift 比例
    s2 = s * sat                        # 压饱和 = 去脏
    h2 = (h + hue) % 1.0                # 微暖
    return Image.fromarray(np.dstack([_from_hsv(h2, s2, v2), alpha]), "RGBA")


# ── 清单 ────────────────────────────────────────────────────────────
def enemy_sources() -> list[tuple[str, Path]]:
    """从 manifest 里取敌人 sprite。缺 manifest 条目就是硬错误，不猜目录。"""
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    out = []
    for key, ent in sorted(data.items()):
        if ent.get("category") != ENEMY_CATEGORY:
            continue
        if not key.endswith("_sprite"):
            continue
        # 自己的输出不能再当输入：ally 版一旦入库，它也会出现在 manifest 里。
        # 少了这一行，工具会把 ally 当 dark 再变换一次，然后拿它跟自己比
        # —— 报「没有变亮」，实际是原地打转。（2026-11-27 踩过一次）
        if "_ally_" in key:
            continue
        src = ROOT / ent["approved"]
        if not src.exists():
            raise SystemExit(f"manifest 指向的敌人在哪？ {src} 不存在")
        out.append((key, src))
    if not out:
        raise SystemExit("manifest 里一个 Enemies/*_sprite 都没有 —— 敌人产线还没接")

    # 每一只 dark 都必须有 ally：白哥要的是"两套色系"，缺一套就是没做（不是"待做"）
    missing = [k for k, _ in out if ally_path(k).stem not in data]
    if missing:
        raise SystemExit(
            "这些敌人只有一套色（缺 ally 版），先跑一次不带 --check 的：\n  " + "\n  ".join(missing))
    return out


def ally_path(key: str) -> Path:
    """enemy_slime_idle_00_sprite → enemy_slime_ally_00_sprite

    命名必须沿用资产规范 `enemy_<物种>_<状态>_<帧>_sprite`，只把状态位换成 `ally`
    —— 这样它天然落在 `ART_INVENTORY` 的同一个格子里，不会变成"另一套命名体系"。
    """
    m = re.match(r"(enemy_[a-z0-9]+)_[a-z]+_(\d+)_sprite$", key)
    if not m:
        raise SystemExit(f"敌人 sprite 名字不合规范：{key}（应为 enemy_<物种>_<状态>_<帧>_sprite）")
    return ENEMY_DIR / f"{m.group(1)}_ally_{m.group(2)}_sprite.png"


# ── 四条断言 ────────────────────────────────────────────────────────
def verify(dark: Image.Image, ally: Image.Image, name: str) -> list[str]:
    errs = []
    d = np.array(dark.convert("RGBA"))
    a = np.array(ally.convert("RGBA"))

    if d.shape != a.shape:
        return [f"{name}: 尺寸变了 {d.shape} → {a.shape} —— 不是同一个造型"]

    ad, aa = d[..., 3], a[..., 3]
    if not np.array_equal(ad, aa):
        diff = int((ad != aa).sum())
        errs.append(f"{name}: alpha 有 {diff} 个像素不同 —— 轮廓被动了，等于重画了一只")

    # 半透明边缘也不能动：否则边缘会变毛，缩放时露馅
    edge = (ad > 0) & (ad < 255)
    if edge.any() and not np.array_equal(ad[edge], aa[edge]):
        errs.append(f"{name}: 半透明边缘 {int(edge.sum())} px 的 alpha 被改 —— 边缘会发毛")

    # 真的变亮了才算做了事（防参数被改成空操作）
    vis = ad > 16
    if vis.any():
        lum_d = d[..., :3][vis].mean()
        lum_a = a[..., :3][vis].mean()
        if lum_a <= lum_d:
            errs.append(f"{name}: ally 版没有变亮（{lum_d:.1f} → {lum_a:.1f}）—— 变换等于没做")
    return errs


def main() -> int:
    args = set(sys.argv[1:])
    unknown = args - {"--check", "--sheet"}
    if unknown:
        print(f"不认识的参数 {sorted(unknown)}；只支持 --check / --sheet")
        return 2

    ENEMY_DIR.mkdir(parents=True, exist_ok=True)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    srcs = enemy_sources()
    errs: list[str] = []
    rows = []

    for key, src in srcs:
        dark = Image.open(src).convert("RGBA")
        dst = ally_path(key)
        if "--check" in args:
            if not dst.exists():
                errs.append(f"{key}: 还没生成 {dst.name} —— 跑一次不带 --check 的")
                continue
            ally = Image.open(dst).convert("RGBA")
        else:
            ally = transform(dark, **DEFAULT)
            ally.save(dst)
        errs += verify(dark, ally, key)
        rows.append((key, dark, ally))

    for key, _d, _a in rows:
        print(f"  {'✓' if not errs else '·'} {key}")

    if "--sheet" in args and rows:
        pad, w = 8, 128
        sheet = Image.new("RGBA", (w * 2 + pad, (w + pad) * len(rows)), (232, 220, 190, 255))
        for i, (_k, d, a) in enumerate(rows):
            sheet.alpha_composite(d.resize((w, w)), (0, i * (w + pad)))
            sheet.alpha_composite(a.resize((w, w)), (w + pad, i * (w + pad)))
        p = SHEET_DIR / "_sheet.png"
        sheet.save(p)
        print(f"  对比图 → {p}（左 dark / 右 ally）")

    print()
    if errs:
        for e in errs:
            print("FAIL  " + e)
        return 1
    print(f"PASS  {len(rows)} 个敌人：两套色系的轮廓逐像素一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
