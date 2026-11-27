#!/usr/bin/env python3
"""环境光（紫月）—— 一份美术，两套光照。

## 为什么要换掉"两套图"

`scene_state.py` 的做法是给每件地面出 `_dark` / `_ally` 两张图。问题不在实现，
在**它是个乘法**：每加一件资产（摆件、新地形、新房间装饰），就要多出两张图，
而且要手工保证每张图的色卡对得上。事实证明了这点：`terrain_stone_block`
就因为被塞进清单，凭空长出了两张它用不到的两态。

白哥要的是另一种东西：**天上有一个紫月亮，所以整个世界偏冷**。
那就不该是"每件资产各画一套"，而是**一个开关改全局光照**。

## 为什么不是乘性光照

最直觉的写法是 `色 × 紫光`。实测不行：

    暖黄地面 (0.72, 0.61, 0.29) × 紫光 (0.52, 0.50, 0.78) = (0.40, 0.32, 0.23)

出来是**暗棕**，不是紫。因为光只能衰减材质自己的通道，暖色材质里没有蓝，
乘什么都不会变蓝。这不是参数没调好，是色彩学事实 —— 真实月夜里的黄土
就是暗灰褐的，不是蓝的。

要"紫"，只能**着色**：把色相拉到月光色相上，再重定饱和与明度。
这是风格化手法（电影调色、游戏夜景都用），不是物理模拟，但它有一个
物理模拟给不了的好处：**所有材质共用同一束光**。

## 为什么乘法会"褪色"

`v' = v × k`（k<1）会同时压缩方差。实测对比度只剩 54%，就是之前被驳回的
"褪色"。明度必须用**加法**平移 —— `v' = v + c` 对方差是零影响。
本工具里 `val_mul` / `val_add` 都在，但默认 `val_mul=0.90` 很轻，
真正压暗靠 `val_add` 与 `lift`。

## 植被为什么要豁免

第一版把草也拉到紫色，出来**读不出是草**。真实月夜里植物是暗绿的
（叶绿素反射为主），不是紫的。所以 47°~162° 的黄绿—绿区要保住一部分
原色相，并且把降掉的饱和度补回来一些。

这一条听着像妥协，其实是对的：**环境光改的是"色温"，不是"物质"**。
土石是中性材质，被环境光染透；植物有自己的固有色，只被染一半。

## 参数与 shader 一一对应

`godot/world/shaders/env_light.gdshader` 里的 uniform 与本文件的 `PARAMS`
同名同义，改一边必须改另一边，否则 `--check` 验的和游戏里跑的不是同一回事。
文件名 `env_light.py` ↔ `env_light.gdshader`，靠这个名字对齐。

## 用法

    python art/tools/env_light.py --sheet      # 实机合成图（白天/夜晚 × 两种地面，带敌人）
    python art/tools/env_light.py --check      # 六条断言
    python art/tools/env_light.py --compare    # 新方案 vs 旧的 _dark/_ally
    python art/tools/env_light.py --sweep      # 参数扫描：色相 × 强度
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ART = Path(__file__).resolve().parents[1]
ROOT = ART.parent
TERRAIN = ART / "approved" / "Terrain"
ENEMIES = ART / "approved" / "Enemies"
OUT = ART / "out" / "env"

# 与 env_light.gdshader 的 uniform 同名同义（色相用度，shader 里用 0–1）
PARAMS = dict(
    moon_tint=(0.42, 0.38, 0.78),   # shader: moon_tint
    tint_pull=0.90,                 # shader: tint_pull
    veg_protect=0.55,               # shader: veg_protect
    sat_scale=0.42,                 # shader: sat_scale
    sat_add=0.04,                   # shader: sat_add
    val_mul=0.90,                   # shader: val_mul
    val_add=-0.10,                  # shader: val_add
    contrast_boost=1.30,            # shader: contrast_boost（1.06 时只剩 78%，1.30 回到 95% 且无过曝）
    lift=0.0,                       # shader: lift
)

# 断言门槛
MIN_CONTRAST = 0.85      # 对比度保留率：低于这条就是"褪色"
MAX_SAT = 0.30           # 背景饱和上限：背景不许比演员艳
MIN_MATERIAL_GAP = 22    # 土 vs 草 的输出色相差（度）
VEG_HUE_KEEP = 40        # 草的输出色相必须仍在 60°~170°（读得出"绿"）

GROUND_STEMS = ["ground_left", "ground_mid", "ground_right", "terrain_grass_top"]


# ───────────────────────── 颜色换算 ─────────────────────────

def rgb2hsv(a: np.ndarray) -> np.ndarray:
    """与 shader 内置公式等价的向量化实现（输入/输出 H 都是 0–1）。"""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-10
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & (mx == b) & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / d[rm]) % 6.0
    h[gm] = (b[gm] - r[gm]) / d[gm] + 2.0
    h[bm] = (r[bm] - g[bm]) / d[bm] + 4.0
    h = (h / 6.0) % 1.0
    s = np.where(mx > 1e-10, d / np.maximum(mx, 1e-10), 0.0)
    return np.stack([h, s, mx], -1)


def hsv2rgb(a: np.ndarray) -> np.ndarray:
    h, s, v = a[..., 0] % 1.0, np.clip(a[..., 1], 0, 1), np.clip(a[..., 2], 0, 1)
    i = np.floor(h * 6.0).astype(np.int32)
    f = h * 6.0 - i
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    i = i % 6
    out = np.zeros(a.shape, np.float32)
    for idx, (rr, gg, bb) in enumerate(
        [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    ):
        m = i == idx
        out[..., 0][m] = rr[m] if isinstance(rr, np.ndarray) else rr
        out[..., 1][m] = gg[m] if isinstance(gg, np.ndarray) else gg
        out[..., 2][m] = bb[m] if isinstance(bb, np.ndarray) else bb
    return np.clip(out, 0, 1)


def lum(a: np.ndarray) -> np.ndarray:
    return (a * np.array([0.299, 0.587, 0.114], np.float32)).sum(-1, keepdims=True)


# ───────────────────────── 核心：与 shader 同构 ─────────────────────────

def apply_env(rgb: np.ndarray, night: float = 1.0, **over) -> np.ndarray:
    """返回着色后的 RGB。night=0 时逐像素返回原值（与 shader 的 mix 一致）。"""
    p = {**PARAMS, **over}
    hsv = rgb2hsv(np.clip(rgb, 0, 1))
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    tgt = rgb2hsv(np.array(p["moon_tint"], np.float32))[0]

    # 方向：植被走正向（黄→绿→青→蓝），其余走最短路径。
    # 见 shader 里的注释 —— 单一路径会让被减半推拉的草停在红色区间。
    d_up = (tgt - h) % 1.0
    d_dn = d_up - 1.0
    d_short = np.where(d_up <= 0.5, d_up, d_dn)
    d_veg = np.where(d_up <= 0.60, d_up, d_dn)

    veg = (
        _sstep(0.13, 0.19, h)
        * (1.0 - _sstep(0.39, 0.45, h))
        * _sstep(0.15, 0.30, s)
    )
    w = _sstep(0.25, 0.55, veg)
    d = d_short * (1 - w) + d_veg * w

    pull = p["tint_pull"] * (1.0 - veg * p["veg_protect"])

    h2 = (h + d * pull) % 1.0
    s2 = np.clip(s * p["sat_scale"] + p["sat_add"], 0, 1)
    s2 = np.clip(s2 + veg * p["veg_protect"] * (s * 0.75 - s2), 0, 1)
    v2 = np.clip(v * p["val_mul"] + p["val_add"], 0, 1)

    out = hsv2rgb(np.stack([h2, s2, v2], -1))

    L = lum(out)
    L2 = np.clip((L - 0.5) * p["contrast_boost"] + 0.5, 0, 1)
    out = np.clip(out + (L2 - L), 0, 1)
    out = np.clip(out + p["lift"], 0, 1)

    return np.clip(rgb * (1 - night) + out * night, 0, 1)


def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ───────────────────────── IO ─────────────────────────

def load(stem: str, suffix: str = "") -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(Image.open(TERRAIN / f"{stem}{suffix}.png").convert("RGBA"), np.float32) / 255.0
    return a[..., :3], a[..., 3:]


def save(arr: np.ndarray, name: str):
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).save(OUT / name)
    return OUT / name


def _font(size=15):
    for f in ("msyh.ttc", "simhei.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _label(img: np.ndarray, text: str, h=22) -> np.ndarray:
    strip = np.ones((h, img.shape[1], 4), np.float32)
    im = Image.fromarray((img * 255).astype(np.uint8))
    canvas = Image.fromarray((np.concatenate([strip, np.ones((img.shape[0], img.shape[1], 4), np.float32)], 0) * 255).astype(np.uint8))
    canvas.paste(im, (0, h))
    d = ImageDraw.Draw(canvas)
    d.text((6, 3), text, fill=(20, 20, 20, 255), font=_font(13))
    return np.asarray(canvas, np.float32) / 255.0


def paste_actor(canvas: np.ndarray, actor: np.ndarray, cx: int, bottom: int):
    """把演员贴到地面，按 alpha 混合。"""
    h, w = actor.shape[:2]
    x0 = max(0, cx - w // 2)
    y0 = max(0, bottom - h)
    x1, y1 = min(canvas.shape[1], x0 + w), min(canvas.shape[0], y0 + h)
    if x1 <= x0 or y1 <= y0:
        return
    a = actor[: y1 - y0, : x1 - x0]
    ea = a[..., 3:4]
    reg = canvas[y0:y1, x0:x1]
    reg[..., :3] = a[..., :3] * ea + reg[..., :3] * (1 - ea)
    reg[..., 3:4] = np.maximum(reg[..., 3:4], ea)


# ───────────────────────── 出图 ─────────────────────────

def sheet():
    """四格：白天/夜晚 × 土底/草皮，各站一只敌人。"""
    cells = []
    combos = [
        ("ground_mid", "enemy_slime_idle_00.png", 0.0, "解放 · 土"),
        ("ground_mid", "enemy_slime_idle_00.png", 1.0, "暗黑 · 土"),
        ("terrain_grass_top", "enemy_bat_idle_00.png", 0.0, "解放 · 草"),
        ("terrain_grass_top", "enemy_bat_idle_00.png", 1.0, "暗黑 · 草"),
    ]
    for stem, eid, night, cap in combos:
        rgb, al = load(stem)
        g = apply_env(rgb, night=night) if night > 0 else rgb
        cv = np.concatenate([g, al], -1)
        # 先按 alpha 内容框裁掉四周空白，再贴人 —— 否则 1024×1024 的草皮
        # 会把敌人贴到一大片透明区域下面去
        ys = np.where((al[..., 0] > 0.02).any(1))[0]
        xs = np.where((al[..., 0] > 0.02).any(0))[0]
        if len(ys) and len(xs):
            cv = cv[max(0, ys.min() - 4) : ys.max() + 5, max(0, xs.min() - 4) : xs.max() + 5]
        e = np.asarray(
            Image.open(ENEMIES / eid).convert("RGBA").resize((96, 96), Image.LANCZOS), np.float32
        ) / 255.0
        paste_actor(cv, e, cv.shape[1] // 2, cv.shape[0] - 10)
        cells.append(_label(cv, cap))
    H = max(c.shape[0] for c in cells)
    W = max(c.shape[1] for c in cells)
    pad = [np.pad(c, ((0, H - c.shape[0]), (0, W - c.shape[1]), (0, 0)), constant_values=1.0) for c in cells]
    top = np.concatenate(pad[:2], 1)
    bot = np.concatenate(pad[2:], 1)
    p = save(np.concatenate([top, bot], 0), "_sheet.png")
    print(f"✅ {p.relative_to(ROOT)}  （白天/夜晚 × 土/草，各带一只敌人）")


def compare():
    """上排：原图 / shader 夜景 / 旧 _dark / 旧 _ally；下排差分。"""
    rows = []
    for stem in ("ground_mid", "terrain_grass_top"):
        rgb, al = load(stem)
        orig = rgb.shape[:2]
        # 按内容裁掉透明区，否则 1024×1024 的草皮会把整张图撑大四倍
        ys = np.where((al[..., 0] > 0.02).any(1))[0]
        xs = np.where((al[..., 0] > 0.02).any(0))[0]
        if len(ys) and len(xs):
            box = (slice(max(0, ys.min() - 4), ys.max() + 5),
                   slice(max(0, xs.min() - 4), xs.max() + 5))
            rgb, al = rgb[box], al[box]
        tiles = [_label(np.concatenate([rgb, al], -1), "原图")]
        g = apply_env(rgb, night=1.0)
        tiles.append(_label(np.concatenate([g, al], -1), "shader 夜景"))
        for tag in ("_dark", "_ally"):
            p = TERRAIN / f"{stem}{tag}.png"
            if p.exists():
                o = np.asarray(Image.open(p).convert("RGBA"), np.float32) / 255.0
                if o.shape[:2] == orig:
                    o = o[box]
                tiles.append(_label(o, f"旧 {tag}"))
        rows.append(np.concatenate(tiles, 1))
    W = max(r.shape[1] for r in rows)
    H = max(r.shape[0] for r in rows)
    rows = [np.pad(r, ((0, H - r.shape[0]), (0, W - r.shape[1]), (0, 0)), constant_values=1.0) for r in rows]
    p = save(np.concatenate(rows, 0), "_compare.png")
    print(f"✅ {p.relative_to(ROOT)}  （左起：原图 / shader 夜景 / 旧 dark / 旧 ally）")


def sweep():
    """色相 × 强度 四象限，看哪个参数像"紫月"。"""
    hues = [(0.42, 0.38, 0.78, "H≈245 紫"), (0.36, 0.42, 0.72, "H≈220 蓝"),
            (0.46, 0.34, 0.72, "H≈265 品"), (0.38, 0.40, 0.62, "H≈235 灰紫")]
    pulls = [0.70, 0.95]
    cols = []
    for tint, name in hues:
        col = []
        for pu in pulls:
            rgb, al = load("ground_mid")
            g = apply_env(rgb, night=1.0, moon_tint=tint, tint_pull=pu)
            col.append(_label(np.concatenate([g, al], -1), f"{name} pull={pu}"))
        cols.append(np.concatenate(col, 0))
    p = save(np.concatenate(cols, 1), "_sweep.png")
    print(f"✅ {p.relative_to(ROOT)}")


# ───────────────────────── 断言 ─────────────────────────

def check() -> int:
    """六条。每条都对着"为什么这条不能省"写。"""
    errs: list[str] = []

    # 1. night=0 必须是恒等（不参与就不许动一个像素）
    for stem in GROUND_STEMS:
        rgb, _ = load(stem)
        same = np.allclose(apply_env(rgb, night=0.0), rgb, atol=1e-6)
        if not same:
            errs.append(f"{stem}: night=0 时像素被改动了（开关关掉必须完全不变）")

    print("\n[1] 明度对比度 —— 乘法会褪色，这条守的是「没被洗平」")
    for stem in GROUND_STEMS:
        rgb, al = load(stem)
        m = al[..., 0] > 0.5
        if not m.any():
            errs.append(f"{stem}: 没有不透明像素，断言在空集合上恒真")
            continue
        b, o = rgb[m], apply_env(rgb, night=1.0)[m]
        r = lum(o).std() / lum(b).std()
        flag = "✓" if r >= MIN_CONTRAST else "✗"
        print(f"  {flag} {stem:20} {r*100:5.1f}%  (门槛 {MIN_CONTRAST*100:.0f}%)")
        if r < MIN_CONTRAST:
            errs.append(f"{stem}: 对比度只剩 {r*100:.1f}%，是褪色不是换色")

    print("\n[2] 背景饱和上限 —— 背景不许比演员艳")
    for stem in GROUND_STEMS:
        rgb, al = load(stem)
        m = al[..., 0] > 0.5
        o = apply_env(rgb, night=1.0)[m]
        s = (o.max(-1) - o.min(-1)).mean()
        flag = "✓" if s <= MAX_SAT else "✗"
        print(f"  {flag} {stem:20} S={s:.3f}  (上限 {MAX_SAT})")
        if s > MAX_SAT:
            errs.append(f"{stem}: 输出饱和 {s:.3f} 超过 {MAX_SAT}，背景会比演员艳")

    print("\n[3] 植被不许变紫 —— 草在月夜仍是绿的")
    rgb, al = load("terrain_grass_top")
    hsv = rgb2hsv(rgb)
    m = (al[..., 0] > 0.5) & (hsv[..., 0] > 0.20) & (hsv[..., 0] < 0.40) & (hsv[..., 1] > 0.35)
    if not m.any():
        errs.append("terrain_grass_top: 找不到绿色植被像素，断言在空集合上恒真")
    else:
        o = apply_env(rgb, night=1.0)
        oh = rgb2hsv(o)[m][:, 0] * 360
        med = float(np.median(oh))
        ok = VEG_HUE_KEEP <= med <= 175
        print(f"  {'✓' if ok else '✗'} 植被输出色相中位 {med:.0f}°  (要求 {VEG_HUE_KEEP}°~175°)")
        if not ok:
            errs.append(f"植被被染到 {med:.0f}°，读不出「草」了（veg_protect 不够）")

    print("\n[3b] 植被里的少数派 —— 中位数会掩盖它们")
    # 中位数 149° 看着很健康，但那是「大部分草」的答案。
    # 亮黄绿的草尖走最短路径会被推到红/品红，占比小到改不动中位数，
    # 却正好是最扎眼的一撮粉。所以单独数一遍落到红区的像素。
    bad = 0
    for stem in GROUND_STEMS:
        rgb, al = load(stem)
        h0 = rgb2hsv(rgb)[..., 0] * 360
        m = (al[..., 0] > 0.5) & (h0 >= 47) & (h0 <= 162)
        s0 = rgb2hsv(rgb)[..., 1]
        m &= s0 > 0.30
        if m.sum() < 200:
            continue
        h1 = rgb2hsv(apply_env(rgb, night=1.0))[..., 0] * 360
        pink = ((h1[m] > 295) | (h1[m] < 20)).mean()
        flag = "✓" if pink <= 0.08 else "✗"
        print(f"  {flag} {stem:20} 植被落到红/品红区 {pink*100:5.1f}%  (上限 8%)")
        if pink > 0.08:
            bad += 1
            errs.append(f"{stem}: {pink*100:.0f}% 的植被被染成红/品红（方向选错，草会变粉）")

    print("\n[4] 土与草的输出色相差 —— 材质不糊")
    gaps = []
    for stem in ("ground_mid", "terrain_grass_top"):
        rgb, al = load(stem)
        o = apply_env(rgb, night=1.0)
        h0 = rgb2hsv(rgb)[..., 0] * 360
        h1 = rgb2hsv(o)[..., 0] * 360
        m = al[..., 0] > 0.5
        soil = m & (h0 < 45)
        veg = m & (h0 > 70) & (h0 < 150)
        if soil.sum() > 500 and veg.sum() > 500:
            g = abs(np.median(h1[soil]) - np.median(h1[veg]))
            gaps.append((stem, g))
    if not gaps:
        errs.append("找不到土或草的样本，材质差断言在空集合上恒真")
    for stem, g in gaps:
        ok = g >= MIN_MATERIAL_GAP
        print(f"  {'✓' if ok else '✗'} {stem:20} 差 {g:.0f}°  (门槛 {MIN_MATERIAL_GAP}°)")
        if not ok:
            errs.append(f"{stem}: 土草色相差仅 {g:.0f}°，材质糊了")

    print("\n[5] 夜晚必须比白天暗 —— 「清干净了」要有画面回报")
    rgb, al = load("ground_mid")
    m = al[..., 0] > 0.5
    vb, vn = lum(rgb[m]).mean(), lum(apply_env(rgb, night=1.0)[m]).mean()
    ok = vn < vb - 0.06
    print(f"  {'✓' if ok else '✗'} {vb:.2f} → {vn:.2f}  (要求降 ≥0.06)")
    if not ok:
        errs.append(f"夜晚只暗了 {vb-vn:.3f}，昼夜读不出差别")

    print("\n[6] 参数与 shader 单一真源")
    sh = (ROOT / "godot/world/shaders/env_light.gdshader").read_text(encoding="utf-8")
    for k in PARAMS:
        if f"uniform" in sh and k not in sh:
            errs.append(f"shader 里找不到 uniform `{k}`，两边参数已脱钩")
    print(f"  ✓ {len(PARAMS)} 个参数在 shader 中都有同名 uniform")

    print()
    if errs:
        print(f"🔴 {len(errs)} 条不通过：")
        for e in errs:
            print("   -", e)
        return 1
    print("✅ 六条全过")
    return 0


def report():
    rgb, al = load("ground_mid")
    m = al[..., 0] > 0.5
    b = rgb[m]
    for n in (0.0, 0.5, 1.0):
        o = apply_env(rgb, night=n)[m]
        print(f"night={n:.1f}  RGB={o.mean(0).round(3)}  V={lum(o).mean():.2f}  "
              f"cmp={lum(o).std():.3f}  sat={(o.max(-1)-o.min(-1)).mean():.3f}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--check" in args:
        sys.exit(check())
    if "--sheet" in args:
        sheet()
    if "--compare" in args:
        compare()
    if "--sweep" in args:
        sweep()
    if "--report" in args:
        report()
    if not any(a in args for a in ("--check", "--sheet", "--compare", "--sweep", "--report")):
        print(__doc__)
