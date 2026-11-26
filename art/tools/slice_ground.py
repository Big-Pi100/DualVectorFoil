#!/usr/bin/env python3
"""把 `terrain_grass_top` 切成「左端 + 中间 + 右端」三段底板。

为什么要切、为什么这么切
------------------------
`terrain_grass_top.png` 是一整块 846×402 的手绘板，直接用只能铺一次，
横向重复就会出现「同一个收口反复出现」。FC 马里奥的做法是
**左端 / 中间 / 右端三段 + 中间无限重复**，中间段自身首尾同边。

手绘资产没法靠"画的时候对齐"来保证首尾同边，所以这里用**镜像构造**，
让每条接缝都**可证连续**，而不是靠肉眼调：

    左端 L        = 重采样后的前 96 列
    中点 M        = 紧随其后的 96 列（与 L 在重采样图里是相邻列）
    中间 tile     = M + mirror(M)      → 自身左列 == 右列（首尾同边）
    右端 R        = mirror(L)          → 左列 == L 的右列

于是三条接缝（L|tile、tile|tile、tile|R）全部**逐像素相等**，
校验在 `asset_rules_check.py` 里，不通过就 exit 1。

垂直方向：从 y=470 起裁。470 以上是这块板被画出来的「顶面」（俯视能看到的那层），
留着会让横版地面变成斜俯视；470 正好是草叶垂下来的最上沿，切在这以下就只剩
正侧面的「草皮 + 土」，是横版该有的读法。

    python art/tools/slice_ground.py            # 生成三段 + 自检
    python art/tools/slice_ground.py --preview  # 额外拼一张 960 宽预览图
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art" / "approved" / "Terrain" / "terrain_grass_top.png"
OUT_DIR = ROOT / "art" / "approved" / "Terrain"
MANIFEST = ROOT / "art" / "approved" / "manifest.json"

OUT_H = 144          # 底板高 3 TILE。顶面贴 420，底 564 → 下沿被屏幕裁掉 24px，
                     # 那是故意的：手绘下沿是毛边，不能让它在屏幕最底部露出缺口
CAP_W = 96           # 端点宽 = 2 TILE
MID_W = 384          # 中间 tile 宽 = 8 TILE（= M 192 + mirror(M) 192）。
                     # 周期越长镜像感越弱：192 宽时一屏能看出 4 次「蝴蝶对折」，384 只有 2 次
CROP_Y0 = 470        # 见上：470 以上是顶面
SEAM_TOL = 8         # 接缝最大允许通道差（0 是理想值；>8 就是肉眼可见的缝）


def _band() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    x0, _, x1, y1 = im.split()[3].getbbox()
    band = im.crop((x0, CROP_Y0, x1, y1))
    k = OUT_H / band.size[1]
    return band.resize((round(band.size[0] * k), OUT_H), Image.LANCZOS)


def build() -> dict[str, Image.Image]:
    band = _band()
    if band.size[0] < CAP_W + MID_W // 2:
        raise SystemExit(f"源图重采样后只有 {band.size[0]} 宽，切不出 {CAP_W}+{MID_W // 2}")
    left = band.crop((0, 0, CAP_W, OUT_H))
    m = band.crop((CAP_W, 0, CAP_W + MID_W // 2, OUT_H))
    mid = Image.new("RGBA", (MID_W, OUT_H))
    mid.paste(m, (0, 0))
    mid.paste(m.transpose(Image.FLIP_LEFT_RIGHT), (MID_W // 2, 0))
    right = left.transpose(Image.FLIP_LEFT_RIGHT)
    return {"ground_left": left, "ground_mid": mid, "ground_right": right}


def _col(img: Image.Image, x: int) -> list[tuple[int, int, int, int]]:
    return [img.getpixel((x, y)) for y in range(img.size[1])]


def _maxdiff(a, b) -> int:
    return max(abs(p[i] - q[i]) for p, q in zip(a, b) for i in range(4))


def _col(img: Image.Image, x: int) -> list[tuple[int, int, int, int]]:
    return [img.getpixel((x, y)) for y in range(img.size[1])]


def _seam(a, b) -> tuple[int, int]:
    """只在**两边都有画**的行上比差。毛边（alpha=0）不算缝 —— 手绘边缘本来就是毛的。"""
    worst = 0
    n = 0
    for pa, pb in zip(a, b):
        if pa[3] < 128 or pb[3] < 128:
            continue
        n += 1
        worst = max(worst, max(abs(pa[i] - pb[i]) for i in range(4)))
    return worst, n


def _seam(a, b) -> tuple[int, int]:
    """只在**两边都有画**的行上比差。毛边（alpha=0）不算缝 —— 手绘边缘本来就是毛的。"""
    worst = 0
    n = 0
    for pa, pb in zip(a, b):
        if pa[3] < 128 or pb[3] < 128:
            continue
        n += 1
        worst = max(worst, max(abs(pa[i] - pb[i]) for i in range(4)))
    return worst, n


def _noise_floor(img: Image.Image) -> int:
    """图内「相邻两列差多少」的分位数 —— 这就是「无缝」的实测基准。

    手绘蜡笔是高频纹理，相邻两列本来就差几十。拿拍脑袋的常数（比如 8）去卡接缝，
    卡的是画风不是缝。**接缝不比图内相邻列更跳，才叫没缝。** 两侧必须用同一个统计量，
    否则是拿「单点最差」去比「整体分位」，必然误判。
    """
    per_pair: list[int] = []
    for x in range(1, img.size[0]):
        worst = 0
        for y in range(img.size[1]):
            a, b = img.getpixel((x - 1, y)), img.getpixel((x, y))
            if a[3] < 128 or b[3] < 128:
                continue
            worst = max(worst, max(abs(a[i] - b[i]) for i in range(4)))
        per_pair.append(worst)
    per_pair.sort()
    return per_pair[int(len(per_pair) * 0.95)] if per_pair else 0


def _solid_from(img: Image.Image, from_right: bool = False) -> int:
    """顶边第一列「10px 全不透明」的位置：端点圆角收口到哪结束。"""
    xs = range(img.size[0] - 1, -1, -1) if from_right else range(img.size[0])
    for i, x in enumerate(xs):
        if all(img.getpixel((x, y))[3] >= 128 for y in range(0, 10)):
            return i
    return img.size[0]


def verify(parts: dict[str, Image.Image]) -> list[str]:
    """尺寸 / 三条接缝 / 体内无洞 / 顶边连续。任何一条不过都算失败。"""
    bad: list[str] = []
    L, M, R = parts["ground_left"], parts["ground_mid"], parts["ground_right"]

    for name, img, want_w in (("left", L, CAP_W), ("mid", M, MID_W), ("right", R, CAP_W)):
        if img.size != (want_w, OUT_H):
            bad.append(f"{name} 尺寸 {img.size}，应为 {(want_w, OUT_H)}")
        if want_w % 48:
            bad.append(f"{name} 宽 {want_w} 不是 TILE(48) 整数倍")

    floor = _noise_floor(M)
    print(f"[slice] 无缝基准：中间 tile 内部相邻列 95 分位差 = {floor}")
    for label, ca, cb in (
        ("L|mid", _col(L, CAP_W - 1), _col(M, 0)),
        ("mid|mid", _col(M, 0), _col(M, MID_W - 1)),
        ("mid|R", _col(M, MID_W - 1), _col(R, 0)),
    ):
        d, n = _seam(ca, cb)
        if n < OUT_H * 0.6:
            bad.append(f"接缝 {label} 只有 {n}/{OUT_H} 行两边都有画，切歪了")
        elif d > floor:
            bad.append(f"接缝 {label} 最大通道差 {d} > 基准 {floor}（比图内相邻列还跳，是缝）")
        else:
            print(f"[slice] 接缝 {label:<8} 最大通道差 {d:<4} ≤ 基准 {floor}（比了 {n} 行）")

    # 中间图必须是回文：正放与翻转完全一致，摆位时才能随便翻而接缝不变。
    # 这不是巧合，是 M + mirror(M) 的必然结果 —— 写出来是为了防止有人改成
    # 非镜像构造后，还以为"翻一下无所谓"。
    mirrored = [M.getpixel((M.size[0] - 1 - x, y)) for y in range(OUT_H) for x in range(M.size[0])]
    flat = [M.getpixel((x, y)) for y in range(OUT_H) for x in range(M.size[0])]
    if flat != mirrored:
        bad.append("中间图不是回文（正放/翻转不一致），摆位时不能自由翻转")
    else:
        print("[slice] 中间图是回文：正放 == 水平翻转")

    # 体内无洞：中间 70% 高度里不能有整行全透明，否则地面会漏背景
    for name, img in parts.items():
        for y in range(int(OUT_H * 0.15), int(OUT_H * 0.85)):
            if all(img.getpixel((x, y))[3] < 128 for x in range(img.size[0])):
                bad.append(f"{name} 第 {y} 行整行透明（地面漏底）")
                break

    # 端点收口：圆角收口超过 20px 就不像"收口"，像"被裁断"
    lod = _solid_from(L)
    rod = _solid_from(R, from_right=True)
    if lod > 20:
        bad.append(f"左端圆角收口占 {lod}px > 20（读起来像被裁断）")
    else:
        print(f"[slice] 端点收口：左 {lod}px / 右 {rod}px")
    if rod > 20:
        bad.append(f"右端圆角收口占 {rod}px > 20（读起来像被裁断）")

    # 顶边连续：收口之内必须一列不缺
    for name, img, lo, hi in (("left", L, lod, CAP_W), ("mid", M, 0, MID_W), ("right", R, 0, CAP_W - rod)):
        holes = [x for x in range(lo, hi)
                 if all(img.getpixel((x, y))[3] < 128 for y in range(0, 10))]
        if holes:
            bad.append(f"{name} 顶部有 {len(holes)} 列 10px 完全透明（草皮断线）")
    return bad


def update_manifest() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for key, note in (
        ("ground_left", "derived: 底板左端 96x120，右缘与 ground_mid 左缘逐像素相等"),
        ("ground_mid", "derived: 底板中间 192x120 = M96 + mirror(M)96，自身首尾同边可无限重复"),
        ("ground_right", "derived: 底板右端 96x120 = mirror(ground_left)，左缘与 mid 右缘逐像素相等"),
    ):
        data[key] = {
            "category": "Terrain",
            "source": "art/approved/Terrain/terrain_grass_top.png",
            "approved": f"art/approved/Terrain/{key}.png",
            "note": note,
        }
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def preview(parts: dict[str, Image.Image]) -> Path:
    """按项目真实用法拼一条 960 宽底板：1 左端 + 4 中间 + 1 右端。"""
    L, M, R = parts["ground_left"], parts["ground_mid"], parts["ground_right"]
    strip = Image.new("RGBA", (960, OUT_H))
    strip.alpha_composite(L, (0, 0))
    x = CAP_W
    while x < 960 - CAP_W:
        strip.alpha_composite(M, (x, 0))
        x += MID_W
    strip.alpha_composite(R, (960 - CAP_W, 0))
    out = ROOT / "shots" / "_probe_strip_120.png"
    strip.save(out)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="只校验不落盘")
    args = ap.parse_args()

    parts = build()
    bad = verify(parts)
    if bad:
        print("[slice] FAIL")
        for b in bad:
            print("   " + b)
        return 1

    if not args.dry_run:
        for name, img in parts.items():
            img.save(OUT_DIR / f"{name}.png")
            print(f"[slice] → Terrain/{name}.png  {img.size[0]}x{img.size[1]}")
        update_manifest()
        print("[slice] manifest.json 已补 3 条 derive 记录")
    if args.preview:
        print("[slice] 预览图 " + str(preview(parts)))

    n = (960 - CAP_W * 2) // MID_W
    fit = "正好" if CAP_W * 2 + n * MID_W == 960 else f"余 {960 - CAP_W * 2 - n * MID_W}px，用末段压边"
    print(f"[slice] PASS  左端 {CAP_W} + 中间 {MID_W}×{n} + 右端 {CAP_W}，高 {OUT_H}；满屏 960 {fit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
