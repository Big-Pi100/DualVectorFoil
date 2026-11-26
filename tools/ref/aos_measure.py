#!/usr/bin/env python3
"""量《晓月》每个区域的实际可走面积。

为什么用它：白哥要「每区房间数」，但《晓月》没有房间口径 —— 游戏只认
「地图格」（pixelguides 实测：一个格 = 场景 256×256 px，走到格内即点亮，
RATE 就是点亮的格数）。房间是玩家语感，不是游戏的计量单位。

所以这里量的是**面积当量（屏）**：一个屏幕 = 240×160 场景像素。
我们的房间正好一屏一个，因此这个数可以直接和我们 48 房对比。

两条独立测量互相印证：
  A. 逐区渲染图（13 张，VGMaps TerraEsperZ 拼接，1:1 游戏像素）
  B. 全城堡整图（6000×4148，同一套素材的另一份拼接）
两条差 10% 以内才放行。缩放过的图按 VGMaps 原始宽度反推比例，
比例本身也当成断言检查。

用法：
  python tools/ref/aos_measure.py            # 测量并写 JSON
  python tools/ref/aos_measure.py --check    # 只校验，不改文件
  python tools/ref/aos_measure.py --fetch    # 图片缺失时重新下载
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "ref" / "_src" / "aos_maps"
OUT = ROOT / "docs" / "ref" / "aos" / "aos_map_area.json"
AREAS_JSON = ROOT / "docs" / "ref" / "aos" / "aos_areas.json"

SCREEN = 240 * 160          # 一个游戏屏幕的场景像素
CELL = 256 * 256            # 一个地图格（pixelguides 实测，RATE 的计量单位）
TILE = 16 * 16              # GBA 瓦片 8px，我们项目 16px；对比时统一换算
BG_TOL = 30                 # 与背景色的曼哈顿距离阈值

# (区域 id, 文件名, VGMaps 原始宽度)  —— pixelguides 把宽度 >6000 的图缩到 6000
AREA_FILES = [
    ("castle_corridor", "castle-corridor", 10808),
    ("chapel", "chapel", 2576),
    ("study", "study", 2576),
    ("dance_hall", "dance-hall", 2920),
    ("inner_quarters", "inner-quarters", 3448),
    ("floating_garden", "floating-garden", 6680),
    ("clock_tower", "clock-tower", 2032),
    ("underground_reservoir", "underground-reservoir", 8448),
    ("underground_cemetery", "underground-cemetery", 4504),
    ("the_arena", "the-arena", 3272),
    ("forbidden_area", "forbidden-area", 3528),
    ("top_floor", "top-floor", 2200),
    ("chaotic_realm", "chaotic-realm", 2800),
]
WHOLE = ("aos_whole.webp", 12752, 8816)   # 全城堡整图（VGMaps 原始宽高）


def bg_color(a: np.ndarray) -> np.ndarray:
    """背景 = 出现最多的颜色。整图背景是 (25,32,48)，混沌领域是 (4,4,89)，
    所以不能写死，必须每张自己算。"""
    flat = a[::3, ::3].reshape(-1, 3).astype(np.int32)
    key = (flat[:, 0] << 16) | (flat[:, 1] << 8) | flat[:, 2]
    k = int(np.bincount(key).argmax())
    return np.array([(k >> 16) & 255, (k >> 8) & 255, k & 255])


def measure(path: Path, scale: float) -> dict:
    a = np.asarray(Image.open(path).convert("RGB"))
    bg = bg_color(a)
    mask = np.abs(a.astype(np.int16) - bg).sum(2) > BG_TOL

    # 每张图左上角都贴了同一块署名框（TERRAESPERZ / OCTOBER MMX）。
    # 它的底色不是背景色，会被算成面积，必须剔掉。
    # 判据：连通块 + 位置贴左上角 + 尺寸小（真房间的块都是几百上千像素宽）。
    lab, n = ndimage.label(mask)
    objs = ndimage.find_objects(lab)
    sizes = np.bincount(lab.ravel())
    credit = []
    for i in range(1, n + 1):
        sl = objs[i - 1]
        if sl is None:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if sl[1].start < 40 and sl[0].start < 40 and w < 800 and h < 500 and sizes[i] > 800:
            credit.append(i)
    clean = mask.copy()
    for i in credit:
        clean[lab == i] = False

    ys, xs = np.where(clean)
    bw = int(xs.max() - xs.min() + 1)
    bh = int(ys.max() - ys.min() + 1)
    floor_px = int(clean.sum())
    screens = floor_px / (SCREEN * scale * scale)
    return {
        "screens": round(screens, 1),
        "cells": round(screens * SCREEN / CELL, 1),
        "bbox_px": [bw, bh],
        "extent": [round(bw / (240 * scale), 1), round(bh / (160 * scale), 1)],
        "fill": round(floor_px / (bw * bh), 3),
        "floor_px": floor_px,
        "scale": round(scale, 4),
        "credit_box_px": int(sum(sizes[i] for i in credit)),
        "bg": [int(v) for v in bg],
        "image": list(a.shape[1::-1]),
    }


def load_manifest() -> dict:
    return json.loads((SRC / "MANIFEST.json").read_text(encoding="utf-8"))


def missing_files() -> list[str]:
    miss = [f for _, f, _ in AREA_FILES if not (SRC / (f + ".webp")).exists()]
    if not (SRC.parent / "aos_whole.webp").exists():
        miss.append("aos_whole")
    return miss


def fetch() -> None:
    man = load_manifest()
    for name, meta in man["files"].items():
        dst = SRC / (name + ".webp")
        if dst.exists():
            continue
        print(f"↓ {name} …", flush=True)
        urllib.request.urlretrieve(meta["url"], dst)
    print("下载完成")


def build() -> dict:
    man = load_manifest()
    areas_doc = json.loads(AREAS_JSON.read_text(encoding="utf-8"))
    cn = {a["id"]: a["cn"] for a in areas_doc["areas"]}

    out_areas: dict[str, dict] = {}
    for aid, name, orig_w in AREA_FILES:
        p = SRC / (name + ".webp")
        im = Image.open(p)
        fw, fh = im.size
        scale = fw / orig_w
        rec = measure(p, scale)
        rec["cn"] = cn[aid]
        rec["vgmaps_size"] = [orig_w, man["files"][name]["vgmaps_size"][1]]
        rec["sha256_16"] = man["files"][name]["sha256_16"]
        out_areas[aid] = rec

    whole_path = SRC.parent / "aos_whole.webp"
    wi = Image.open(whole_path)
    whole = measure(whole_path, wi.size[0] / WHOLE[1])
    whole["image"] = list(wi.size)
    whole["vgmaps_size"] = [WHOLE[1], WHOLE[2]]

    s_all = sum(r["screens"] for r in out_areas.values())
    s_real = sum(r["screens"] for k, r in out_areas.items() if k != "chaotic_realm")

    doc = {
        "meta": {
            "purpose": "《晓月》13 区实际可走面积实测。用于替代「每区房间数」这个不存在口径的指标。",
            "unit": "面积当量（屏）。一屏 = 240×160 场景像素；我们的房间正好一屏。",
            "why_not_rooms": (
                "《晓月》不按房间计量。游戏只认地图格：一格 = 256×256 px，走到就点亮，"
                "RATE 就是点亮格数占比。房间大小在 1–4 屏之间浮动，"
                "跨游戏硬比房间数会把「大小不同」误读成「数量不同」。"
            ),
            "method": [
                "1. 逐张图取出现最多的颜色当背景（不同区域背景不同，不能写死）",
                "2. 与背景色曼哈顿距离 >30 的像素算可走面积",
                "3. 剔除左上角署名框（同一块 TERRAESPERZ 水印，每张图都有）",
                "4. 面积 = 像素数 / (240×160)；缩放图按 VGMaps 原始宽度反推比例",
            ],
            "cross_check": "逐区 13 张（A 路）与全城堡整图（B 路）各自独立算总量，差 <10% 放行",
            "source": "VGMaps（TerraEsperZ 拼接），pixelguides 转存",
            "manifest": "tools/ref/_src/aos_maps/MANIFEST.json（下载地址 + sha256，原图不入库）",
            "not_included": "Boss Rush 竞技场（独立模式，不在城堡地图内）",
        },
        "constants": {
            "screen_px": SCREEN,
            "cell_px": CELL,
            "cell_note": "地图格 = 256×256 px，pixelguides 实测（走到格内才点亮）",
        },
        "areas": out_areas,
        "totals": {
            "screens_all_13": round(s_all, 1),
            "screens_rated_12": round(s_real, 1),
            "cells_all_13": round(s_all * SCREEN / CELL, 1),
            "cells_rated_12": round(s_real * SCREEN / CELL, 1),
            "whole_map_screens": round(whole["screens"], 1),
            "whole_map_scale": round(wi.size[0] / WHOLE[1], 4),
            "whole_map_px": list(wi.size),
            "whole_map_bbox_screens": whole["extent"],
            "area_sum_vs_whole_pct": round((s_real - whole["screens"]) / whole["screens"] * 100, 1),
        },
        "derived": {
            "rooms_estimate": 650,
            "rooms_range": [600, 680],
            "rooms_note": (
                "推断，不是官方口径。依据 pixelguides 的实测记录：RATE 从 70.6% 到 71.2% "
                "正好是「四个未探索房间点亮」，0.6% 对应 4 个地图格 → 1 间房 ≈ 1 格，"
                "总格数 ≈ 4/0.006 = 667。本案 13 区实算 647 格，与 667 差 3%，两条对上。"
                "所以「房间数 ≈ 地图格数 ≈ 650」是能站住的量级判断，误差 ±5%。"
            ),
            "rooms_vs_ours": "我们 48 房 ÷ 650 ≈ 7%，面积 48 屏 ÷ 1211 屏 ≈ 4%",
        },
    }
    return doc


def check(doc: dict) -> list[str]:
    bad: list[str] = []
    areas_doc = json.loads(AREAS_JSON.read_text(encoding="utf-8"))
    want = {a["id"] for a in areas_doc["areas"]}
    got = set(doc["areas"])
    if want != got:
        bad.append(f"区域集合对不上：缺 {want - got}，多 {got - want}")

    for aid, r in doc["areas"].items():
        if not 20 <= r["screens"] <= 320:
            bad.append(f"{aid} 面积 {r['screens']} 屏超出了合理区间 20–320")
        if not 0.15 <= r["fill"] <= 0.85:
            bad.append(f"{aid} 填充率 {r['fill']} 超出 0.15–0.85（背景色可能判错了）")
        fw, fh = r["image"]
        ow, oh = r["vgmaps_size"]
        s = r["scale"]
        # 缩放比例必须同时对上宽和高；只对宽会被「图裁过」骗过去
        if abs(fw / ow - s) > 1e-3 or abs(fh / oh - s) > 0.005:
            bad.append(f"{aid} 缩放比例不一致：宽 {fw/ow:.4f} / 高 {fh/oh:.4f} / 记录 {s}")
        if r["credit_box_px"] == 0 and aid != "top_floor":
            bad.append(f"{aid} 没找到署名框 —— 皮肤可能变了，先确认背景色判定")

    t = doc["totals"]
    ws = t["whole_map_scale"]
    fw, fh = doc["totals"]["whole_map_px"]
    if abs(fw / WHOLE[1] - ws) > 1e-3 or abs(fh / WHOLE[2] - ws) > 0.005:
        bad.append(f"整图比例不一致：宽 {fw/WHOLE[1]:.4f} / 高 {fh/WHOLE[2]:.4f} / 记录 {ws}")
    if not 1000 <= t["screens_all_13"] <= 1400:
        bad.append(f"总面积 {t['screens_all_13']} 屏超出 1000–1400")
    if abs(t["area_sum_vs_whole_pct"]) > 10:
        bad.append(f"两路测量差 {t['area_sum_vs_whole_pct']}%，超过 10% 容差")
    cells = t["cells_rated_12"]
    if not 600 <= cells <= 780:
        bad.append(f"地图格数 {cells} 超出 600–780")
    rm = doc["derived"]["rooms_estimate"]
    if not 600 <= rm <= 780:
        bad.append(f"房间量级 {rm} 超出 600–780")
    # 房间数与格数同量级是这套推断的核心，差太多说明前提不成立
    if abs(rm - cells) / cells > 0.10:
        bad.append(f"房间量级 {rm} 与格数 {cells} 差 >10%（两者应大致相等）")
    return bad


def main() -> int:
    if "--fetch" in sys.argv:
        fetch()

    miss = missing_files()
    if miss:
        print("✗ 缺少原图：" + ", ".join(miss))
        print("  跑 python tools/ref/aos_measure.py --fetch 重新下载")
        return 1

    doc = build()
    bad = check(doc)

    if "--check" in sys.argv:
        if bad:
            print("✗ 校验失败：")
            for b in bad:
                print("   ", b)
            return 1
        old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
        if old.get("areas") != doc["areas"]:
            print("✗ 磁盘上的 JSON 与当前测量结果不一致 —— 跑 python tools/ref/aos_measure.py")
            return 1
        t = doc["totals"]
        print(f"✓ 面积实测一致：13 区 {t['screens_all_13']} 屏（计 RATE 的 12 区 {t['screens_rated_12']}）"
              f" / 地图格 {t['cells_rated_12']} / 两路差 {t['area_sum_vs_whole_pct']}%")
        return 0

    if bad:
        print("✗ 校验失败，不写文件：")
        for b in bad:
            print("   ", b)
        return 1

    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{'区域':22s} {'面积(屏)':>8s} {'外接(屏)':>13s} {'填充':>6s} {'比例':>6s}")
    for aid, r in sorted(doc["areas"].items(), key=lambda kv: -kv[1]["screens"]):
        print(f"{r['cn']:8s}{aid:16s} {r['screens']:8.1f} "
              f"{r['extent'][0]:5.1f}x{r['extent'][1]:5.1f} {r['fill']*100:5.0f}% {r['scale']:6.3f}")
    t = doc["totals"]
    print(f"\n13 区合计 {t['screens_all_13']} 屏 · 计 RATE 的 12 区 {t['screens_rated_12']} 屏")
    print(f"全图独立测量 {t['whole_map_screens']} 屏，两路差 {t['area_sum_vs_whole_pct']}%")
    print(f"地图格 {t['cells_rated_12']} · 房间量级 {doc['derived']['rooms_estimate']}"
          f"（{doc['derived']['rooms_range'][0]}–{doc['derived']['rooms_range'][1]}）")
    print(f"→ {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
