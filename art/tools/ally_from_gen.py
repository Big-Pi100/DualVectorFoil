#!/usr/bin/env python3
"""ally_from_gen.py —— 从生图产出 ally（解放态）sprite

## 为什么有第二个产出工具

`duo_state.py`（换色）能保证「alpha 逐像素同」，但**解决不了"可爱"**：
凶感来自眼型（斜杏、竖瞳、两瞳对视），那是形状不是 RGB。
像素级 patch 试过三版全失败（坐标读偏、椭圆盖不住斜杏、圆珠+白边），
128px 蜡笔 sprite 上做局部重绘必然出现贴片感。

白哥 2026-11-27：「手功能扣当然最好，但是如果扣不了就生成也可以。」
→ 生图重画整只，只改眼睛。

## 生图会不会破掉「完全同样造型」

不会 —— 用 `input_fidelity=high` + 「identical silhouette」指令，
实测 slate 轮廓 IoU = **0.986**（换色版是 1.000）。
判据因此从「alpha 逐像素同」改成「轮廓 IoU ≥ 0.95」，同样可断言、不靠眼力。

## 流程

    生图(1024, 洋红底) → 泛洪抠底 → 裁到生物 bbox → 缩放到 dark 版同尺寸
    → 贴回 128 画布同一位置 → 色相归位到 ally 带 → 校验(IoU / 色系)

## 色相归位为什么需要

生图不保证落进我们定的 ally 色带：bat 生成出来是紫（H290，带在 325-355），
spike 青绿偏了 18°。做一次**全局色相旋转**，但**金色/黄色的眼睛像素不旋转**
（否则黄眼会变成绿眼 —— 旋转是对全图一致的，眼睛受不了）。

用法：
    python art/tools/ally_from_gen.py --set slime=path/to/raw.png [...]
    python art/tools/ally_from_gen.py --check
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ART = Path(__file__).resolve().parents[1]
ROOT = ART.parent
ENEMY_DIR = ART / "approved" / "Enemies"
OUT = ART / "out" / "duo" / "gen"

MIN_IOU = 0.95            # 轮廓 IoU 下限：低于这个数就不是"同一只"
EYE_HUE_KEEP = (15.0, 68.0)   # 金/黄眼睛不参与色相旋转
EYE_SAT_KEEP = 0.38

# 目标主体色相（= ASSET_RULES §3.1.3 定的四条自然色带）
TARGET_HUE = {
    "slime": 206.0,   # 水蓝
    "bat": 342.0,     # 樱粉
    "spike": 147.0,   # 薄荷绿
}
# 生成版的色相分布横跨太宽，整体旋转到不了目标（bat 的紫跨 H240-330，
# 一律 +31° 之后仍在 271-361，还是紫）。所以对这类要**分区映射**：
# 每个区间的像素搬到指定色相，眼睛的金黄和刺的橙单独 keep 住不动。
# slime 的蓝本来就准（H214 vs 目标 206），不需要分区。
ZONES = {
    "slime": None,
    "bat": dict(
        zones=[(232, 288, 337, 1.95, 0.22),
               (288, 336, 344, 1.85, 0.21),
               (336, 12, 342, 1.80, 0.21)],
        keep=[(12, 72)],                      # 金黄眼（放宽：生成的眼偏橙色，范围窄了会漏）
        fallback=(342, 1.85, 0.21),
    ),
    "spike": dict(
        zones=[(100, 180, 150, 2.70, 0.0),
               (180, 345, 150, 1.90, 0.0)],
        keep=[(345, 52)],                     # 橙刺（跨 0°）
        fallback=(150, 1.90, 0.0),
    ),
}

# 生图偏暗时的明度补偿（加法平移，跟换色那条路同一个理由：平移保对比度）
V_ADD = {"slime": 0.0, "bat": 0.10, "spike": 0.0}
# 生图的饱和度普遍低于换色版（bat 的紫、spike 的绿都发灰），
# 光旋色相救不回来，必须把身体区域的饱和拉到目标值。
TARGET_SAT = {"slime": 0.50, "bat": 0.54, "spike": 0.56}


# ── 抠图 ────────────────────────────────────────────────────────────
def cut_out(path: Path) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """洋红底 → RGBA。动态取背景色（三张生成的底色不一样，写死会漏）。"""
    rgb = np.array(Image.open(path).convert("RGB"))
    h, w = rgb.shape[:2]
    rgb[int(h * 0.88):, :] = rgb[2, 2]                   # 抹掉右下角水印

    work = Image.fromarray(rgb.copy())
    for c in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(work, c, (0, 0, 0), thresh=52)
    mk = np.array(work).max(-1) > 8                       # 没被泛洪 = 生物

    bg = np.median(np.concatenate([rgb[2:18].reshape(-1, 3),
                                   rgb[-18:-2].reshape(-1, 3)]), 0).astype(np.float32)
    f = rgb.astype(np.float32)
    diff = np.abs(f - bg).max(-1)
    alpha = np.where(mk, np.clip((diff - 12) / 45, 0, 1), 0.0)
    af = np.maximum(alpha, 1e-3)[..., None]
    col = np.clip((f - bg * (1 - af)) / af, 0, 255)        # 反解，去掉粉边

    im = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8), "RGBA")
    ys, xs = np.nonzero(alpha > 0.5)
    bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return im.crop(bb), bb


# ── 色相归位 ────────────────────────────────────────────────────────
def _hsv(rgb: np.ndarray):
    r, g, b = rgb[..., 0] / 255.0, rgb[..., 1] / 255.0, rgb[..., 2] / 255.0
    mx, mn = rgb.max(-1) / 255.0, rgb.min(-1) / 255.0
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
    v = mx
    h = np.zeros_like(mx)
    m = d > 1e-6
    i = m & (mx == r)
    h[i] = ((g - b)[i] / d[i]) % 6
    i = m & (mx == g)
    h[i] = ((b - r)[i] / d[i]) + 2
    i = m & (mx == b)
    h[i] = ((r - g)[i] / d[i]) + 4
    return h * 60.0, s, v


def _rgb(h, s, v):
    hh = (h % 360.0) / 60.0
    i = np.floor(hh).astype(int) % 6
    f = hh - np.floor(hh)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    out = np.zeros(v.shape + (3,), np.float32)
    for k, (R, G, B) in enumerate([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]):
        m = i == k
        out[..., 0][m], out[..., 1][m], out[..., 2][m] = R[m], G[m], B[m]
    return (np.clip(out, 0, 1) * 255).round().astype(np.uint8)


def main_hue(rgb: np.ndarray) -> float:
    """主体色相 —— 只看画面中心 50% 区域，用 60° 滑窗找覆盖最多的色相。

    两条修正，都是踩出来的：
    1. **只看中心**：刺球外圈全是橙刺、蝙蝠脚是橙色。按全图算，色相会被刺带走
       （实测 spike 判成 20°，于是"转到 147"把身体旋成了紫色）。
    2. **按像素数、不按饱和度加权**：bat 中心是紫(40%)+橙脚(19%)，
       加权时橙色因为更饱和反而赢了，判定成 33°。按个数算才是紫。
    """
    h, w = rgb.shape[:2]
    core = rgb[int(h * .28):int(h * .72), int(w * .28):int(w * .72)]
    hh, s, v = _hsv(core)
    m = (s > 0.10) & (v > 0.25)
    if m.sum() < 20:
        return -1.0
    hs = hh[m]
    best_c, best_n = 0.0, -1
    for c in range(0, 360, 10):
        n = int((np.abs(((hs - c + 180) % 360) - 180) <= 30).sum())
        if n > best_n:
            best_c, best_n = float(c), n
    near = np.abs(((hs - best_c + 180) % 360) - 180) <= 30
    a = np.deg2rad(hs[near])
    return float(np.rad2deg(np.arctan2(np.sin(a).mean(), np.cos(a).mean())) % 360)


def _zone_hit(h, lo, hi):
    return (h >= lo) & (h < hi) if lo <= hi else (h >= lo) | (h < hi)


def zone_remap(rgb: np.ndarray, spec: dict) -> np.ndarray:
    h, s, v = _hsv(rgb)
    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    hit = np.zeros(h.shape, bool)
    for lo, hi in spec.get("keep", []):
        hit |= _zone_hit(h, lo, hi)           # 眼睛/刺先占位，不参与映射
    for lo, hi, to, k, va in spec["zones"]:
        m = _zone_hit(h, lo, hi) & ~hit
        h2[m] = to
        s2[m] = np.clip(s[m] * k, 0, 0.94)
        v2[m] = np.clip(v[m] + va, 0, 1)
        hit |= m
    m = ~hit
    to, k, va = spec["fallback"]
    h2[m] = to
    s2[m] = np.clip(s[m] * k, 0, 0.94)
    v2[m] = np.clip(v[m] + va, 0, 1)
    return _rgb(h2, s2, v2)


def sat_normalize(rgb: np.ndarray, target: float) -> tuple[np.ndarray, float]:
    """把**中心（身体）区域**的平均饱和拉到 target。

    只按中心的当前值算倍率，全图同比乘 —— 这样身体到位、刺/眼跟着一起变鲜，
    色相关系不动（不是直接写死饱和，那会抹平层次）。
    """
    h, w = rgb.shape[:2]
    core = rgb[int(h * .28):int(h * .72), int(w * .28):int(w * .72)]
    hh, s, v = _hsv(core)
    m = (s > 0.10) & (v > 0.25)
    if m.sum() < 20:
        return rgb, 1.0
    cur = float(np.median(s[m]))
    k = float(np.clip(target / max(cur, 0.05), 0.6, 1.75))   # 上限卡住：×2.4 会把薄荷绿推到荧光
    hh, s, v = _hsv(rgb)
    return _rgb(hh, np.clip(s * k, 0, 0.94), v), k


def rotate_to(rgb: np.ndarray, target: float, v_add: float = 0.0) -> tuple[np.ndarray, float]:
    cur = main_hue(rgb)
    if cur < 0:
        return rgb, 0.0
    dh = ((target - cur + 180) % 360) - 180
    h, s, v = _hsv(rgb)
    eye = (h >= EYE_HUE_KEEP[0]) & (h <= EYE_HUE_KEEP[1]) & (s >= EYE_SAT_KEEP)
    h2 = np.where(eye, h, (h + dh) % 360)          # 金色眼睛不跟着转
    v2 = np.clip(np.where(eye, v, v + v_add), 0, 1)
    return _rgb(h2, s, v2), dh


# ── 对齐与校验 ──────────────────────────────────────────────────────
def align(cut: Image.Image, dark_path: Path) -> Image.Image:
    """缩放到 dark 版生物同尺寸，贴在 128 画布同一位置。"""
    d = Image.open(dark_path).convert("RGBA")
    da = np.array(d)
    ys, xs = np.nonzero(da[..., 3] > 40)
    bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    canvas = Image.new("RGBA", d.size, (0, 0, 0, 0))
    canvas.alpha_composite(cut.resize((bb[2] - bb[0], bb[3] - bb[1]), Image.LANCZOS),
                           (bb[0], bb[1]))
    return canvas


def outline_iou(a_path: Path, b_path: Path, n: int = 128) -> float:
    def m(p):
        al = np.array(Image.open(p).convert("RGBA"))[..., 3] > 40
        ys, xs = np.nonzero(al)
        sub = al[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        return np.array(Image.fromarray((sub * 255).astype(np.uint8))
                        .resize((n, n), Image.LANCZOS)) > 128
    a, b = m(a_path), m(b_path)
    return float((a & b).sum() / max((a | b).sum(), 1))


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] == "--check":
        return check()
    if args[0] == "--cut":
        OUT.mkdir(parents=True, exist_ok=True)
        for spec in args[1:]:
            sp, raw = spec.split("=", 1)
            cut, _ = cut_out(Path(raw))
            aligned = align(cut, ENEMY_DIR / f"enemy_{sp}_idle_00_sprite.png")
            aligned.save(OUT / f"{sp}_128.png")
            print(f"  {sp}: 抠图 → {sp}_128.png")
        return 0

    if args[0] != "--set":
        print("用法: --cut a=<raw> ... | --set a=<raw> ... | --check")
        return 2

    for spec in args[1:]:
        if "=" not in spec:
            print(f"坏参数 {spec}")
            return 2
        sp, raw = spec.split("=", 1)
        raw_p = Path(raw)
        dark_p = ENEMY_DIR / f"enemy_{sp}_idle_00_sprite.png"
        dst = ENEMY_DIR / f"enemy_{sp}_ally_00_sprite.png"

        cut, _ = cut_out(raw_p)
        aligned = align(cut, dark_p)
        a = np.array(aligned)
        vis = a[..., 3] > 0
        zn = ZONES.get(sp)
        if zn:
            rgb = zone_remap(a[..., :3], zn)
            dh, ks = 0.0, 1.0
        else:
            rgb, dh = rotate_to(a[..., :3], TARGET_HUE[sp], V_ADD[sp])
            rgb, ks = sat_normalize(rgb, TARGET_SAT[sp])
        a[..., :3][vis] = rgb[vis]
        Image.fromarray(a, "RGBA").save(dst)
        print(f"  {sp}: " + ("分区映射" if zn else f"色相 {dh:+.1f}° 饱和 ×{ks:.2f}") + f" → {dst.name}")
    return check()


def check() -> int:
    sys.path.insert(0, str(ART / "tools"))
    from duo_state import ALLY_HUE_BANDS, ALLY_MIN_SAT, ALLY_MIN_V, metrics, _in_band

    errs = []
    print(f"{'敌人':<10}{'IoU':>7}{'H':>8}{'S':>7}{'V':>7}   色系")
    print("-" * 52)
    for sp in TARGET_HUE:
        dark = ENEMY_DIR / f"enemy_{sp}_idle_00_sprite.png"
        ally = ENEMY_DIR / f"enemy_{sp}_ally_00_sprite.png"
        if not ally.exists():
            errs.append(f"{sp}: 没有 ally 版")
            continue
        iou = outline_iou(dark, ally)
        arr = np.array(Image.open(ally).convert("RGBA"))
        m = metrics(Image.open(ally))
        # 用中心区域的身体色相判色带 —— 和 rotate_to 同一口径，
        # 否则"转到了 342"和"验出 30（刺）"会互相打架
        m["hue"] = main_hue(arr[..., :3])
        band = next((b for b in ALLY_HUE_BANDS if _in_band(m["hue"], b)), None)
        ok = "✓ " + (f"{band[0]:.0f}-{band[1]:.0f}" if band else "✗ 不在带内")
        print(f"{sp:<10}{iou:>7.3f}{m['hue']:>8.1f}{m['sat']:>7.2f}{m['vavg']:>7.2f}   {ok}")
        if iou < MIN_IOU:
            errs.append(f"{sp}: 轮廓 IoU {iou:.3f} < {MIN_IOU} —— 不是同一只了")
        if band is None:
            errs.append(f"{sp}: 主体色相 {m['hue']:.0f}° 不在自然色带")
        if m["sat"] < ALLY_MIN_SAT:
            errs.append(f"{sp}: 饱和 {m['sat']:.2f} < {ALLY_MIN_SAT}")
        if m["vavg"] < ALLY_MIN_V:
            errs.append(f"{sp}: 明度 {m['vavg']:.2f} < {ALLY_MIN_V}")
    print()
    if errs:
        for e in errs:
            print("FAIL  " + e)
        return 1
    print("PASS  三只解放态：轮廓同一只、颜色落在自然色带、够鲜够亮")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
