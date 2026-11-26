#!/usr/bin/env python3
"""按 `art/ASSET_RULES.md` 的角色规则复检 `art/approved/` 全库。

    python art/tools/asset_rules_check.py
    python art/tools/asset_rules_check.py -v      # 逐张打印

它查四件事，每件都是规则里写死过的：

  1. **manifest 覆盖**：库里每张 PNG 都有条目，每个条目对应的文件都存在
     —— 防「孤儿资产」（入库了但没人知道它是什么角色）和「死引用」。
  2. **role 齐全**：每个条目都能推断出 role，且 role 是已知六类之一。
  3. **role 专属断言**：`tile_cap`/`tile_mid` 走三段拼接的全套判据
     （尺寸 / 三条接缝 / 回文 / 收口 / 无洞），`sprite` 查帧框。
  4. **摆件不进关卡**：`prop` 类不得出现在任何 Godot 场景里（§4 的硬规则）。

风格（笔触 / 洋红 / 门禁 G1–G5）不归这里管，归 `ART_GUIDE.md` 和 `extract_magenta.py`。
两套判据是**并联**的：都过才算能用的资产。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import slice_ground  # noqa: E402  三段拼接的判据只写一份，这里复用

ROOT = Path(__file__).resolve().parents[2]
APPROVED = ROOT / "art" / "approved"
MANIFEST = APPROVED / "manifest.json"
GODOT = ROOT / "godot"

ROLES = {"tile_cap", "tile_mid", "sprite", "prop", "fx", "item", "ui"}

# 角色推断：显式覆盖优先，其次按目录
OVERRIDE = {
    "ground_left": "tile_cap",
    "ground_right": "tile_cap",
    "ground_mid": "tile_mid",
}
BY_DIR = {
    "Characters": "sprite",
    "Enemies": "sprite",
    "Terrain": "prop",
    "Effects": "fx",
    "Items": "item",
    "UI": "ui",
}


def role_of(key: str, entry: dict) -> str | None:
    if key in OVERRIDE:
        return OVERRIDE[key]
    if entry.get("role"):
        return entry["role"]
    return BY_DIR.get(entry.get("category", ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    bad: list[str] = []
    data: dict = json.loads(MANIFEST.read_text(encoding="utf-8"))

    on_disk = {p.relative_to(APPROVED).as_posix() for p in APPROVED.rglob("*.png")}
    in_manifest = {Path(e["approved"]).relative_to("art/approved").as_posix(): k
                   for k, e in data.items() if "approved" in e}

    for rel in sorted(on_disk - set(in_manifest)):
        bad.append(f"孤儿资产：{rel} 没有 manifest 条目（不知道它是什么角色）")
    for rel in sorted(set(in_manifest) - on_disk):
        bad.append(f"死引用：manifest 指向 {rel}，文件不存在")

    by_role: dict[str, list[str]] = {}
    for key, entry in data.items():
        rel = Path(entry.get("approved", "")).relative_to("art/approved").as_posix()
        if rel not in on_disk:
            continue
        role = role_of(key, entry)
        if role not in ROLES:
            bad.append(f"{key} 推不出合法 role（得到 {role!r}）")
            continue
        by_role.setdefault(role, []).append(key)

        img = Image.open(APPROVED / rel)
        if img.mode not in ("RGBA", "LA", "PA"):
            bad.append(f"{key} 不是真 alpha（mode={img.mode}），P1/P11 会出白边")

        if role == "sprite" and key.endswith("_sprite"):
            want = (128, 128) if entry.get("category") == "Enemies" else (340, 340)
            if img.size != want:
                bad.append(f"{key} 帧框 {img.size}，{role} 应为 {want}（一态一图，脚底锚同帧框）")
        if role in ("tile_cap", "tile_mid") and img.size[0] % 48:
            bad.append(f"{key} 宽 {img.size[0]} 不是 TILE(48) 整数倍")
        if args.verbose:
            print(f"  {role:<8} {key:<32} {img.size}")

    # ── 三段拼接：规则里最硬的一条，直接复用切图工具的判据 ──
    print("\n[tiles] 底板三段")
    parts = {}
    for key in ("ground_left", "ground_mid", "ground_right"):
        p = APPROVED / "Terrain" / f"{key}.png"
        if p.exists():
            parts[key] = Image.open(p).convert("RGBA")
    if len(parts) == 3:
        bad += slice_ground.verify(parts)
    else:
        bad.append("底板三段不齐：ground_left / ground_mid / ground_right 必须同时存在")

    # ── 摆件不得进关卡 ──
    print("\n[props] 立体摆件是否被误接进关卡")
    prop_names = {k for k, v in data.items() if role_of(k, v) == "prop"}
    hits: list[str] = []
    for f in GODOT.rglob("*"):
        if f.suffix not in (".tscn", ".gd", ".tres") or ".godot" in f.parts:
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        for name in prop_names:
            if name in text:
                hits.append(f"{f.relative_to(ROOT).as_posix()} 引用了摆件 {name}")
    if hits:
        bad += hits
    else:
        print(f"  ✓ {len(prop_names)} 张摆件没有任何一处进场景（§4：只摆不拼，本作不接入）")

    print("\n[role] 分布")
    for role in sorted(by_role):
        print(f"  {role:<9} {len(by_role[role]):>3} 张")

    if bad:
        print("\n[rules] FAIL")
        for b in bad:
            print("   ✗ " + b)
        return 1
    print(f"\n[rules] PASS  {len(on_disk)} 张资产全部有 role 且满足各自断言")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
