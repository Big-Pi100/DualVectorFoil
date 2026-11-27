#!/usr/bin/env python3
"""按 `art/ASSET_RULES.md` 的角色规则复检 `art/approved/` 全库。

    python art/tools/asset_rules_check.py
    python art/tools/asset_rules_check.py -v      # 逐张打印

它查五件事，每件都是规则里写死过的：

  1. **manifest 覆盖**：库里每张 PNG 都有条目，每个条目对应的文件都存在
     —— 防「孤儿资产」（入库了但没人知道它是什么角色）和「死引用」。
  2. **role 齐全**：每个条目都能推断出 role，且 role 是已知六类之一。
  3. **role 专属断言**：`tile_cap`/`tile_mid` 走三段拼接的全套判据
     （尺寸 / 三条接缝 / 回文 / 收口 / 无洞），`sprite` 查帧框。
  4. **摆件不进关卡**：`prop` 类不得出现在任何 Godot 场景里（§4 的硬规则）。
  5. **弃用件不得被引用**：`contact_sheet.py` 判成 `S_DROP` 的资产，
     任何 `.tscn` / `.tres` / `.gd` 都不许引用它 —— 哪怕只是拿来当占位替身。
     （2026-11-27 补：`terrain_stone_block` 判了弃用却还在 Room04/05 的
     书堆、灯塔里当替身贴图，四天没人发现，因为"弃用"和"引用"之间
     从来没有检查连着。判据写在表里，不等于判据被执行。）

风格（笔触 / 洋红 / 门禁 G1–G5）不归这里管，归 `ART_GUIDE.md` 和 `extract_magenta.py`。
两套判据是**并联**的：都过才算能用的资产。
"""

from __future__ import annotations

import argparse
import ast
import json
import re
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


def tile_assets(rel: str, depth: int = 0) -> set[str]:
    """该文件**经由 TileSet** 真正铺成瓦片的贴图 stem 集合。

    为什么不能直接看文本里有没有 `TileMapLayer`：房间接上地面图层之后，
    每个 `.tscn` 都含这个词，于是"摆件不许铺格"退化成"房间里有摆件就违规"，
    把 15 处合法的 Sprite2D 构景全判死（2026-11-27 实测的假阳性）。
    真正的判据只有一条：**这张图是否被某个 TileSet 资源引用**。
    """
    if depth > 3:
        return set()
    p = ROOT / rel
    if not p.exists():
        return set()
    text = p.read_text(encoding="utf-8", errors="ignore")
    is_tileset = '[gd_resource type="TileSet"' in text
    out: set[str] = set()
    for m in re.finditer(r'\[ext_resource type="([^"]+)"[^\]]*?path="res://([^"]+)"', text):
        typ, path = m.group(1), m.group(2)
        if typ == "Texture2D" and is_tileset:
            out.add(Path(path).stem)
        elif typ == "TileSet":
            out |= tile_assets("godot/" + path, depth + 1)
    return out

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

# ── 摆件用法登记（`ASSET_RULES §4`）────────────────────────────────
# §4 的规则是「摆件不许当可站立表面」，**不是**「摆件不许进场景」。
# 2026-11-27 并进来的完整工程里，摆件被 15 处正常使用（风车塔身、灯塔、书堆、
# 草皮点缀、长凳、土块），全是 Sprite2D 构景 —— 老断言「出现在任何场景里就算错」
# 会把合法的背景用法一并判死，所以改成登记制：
#
#   每个 (场景文件, 摆件) 组合必须先在这里写明用途。新用法没登记 = FAIL。
#
# 登记制的好处不是"省事"，是**加摆件时必须回答一次"它是不是当地面"**。
# 另有一条硬规则不看登记：摆件出现在 TileMapLayer / TileSet 里直接算错（那是铺格）。
PROP_USAGE_OK: dict[str, dict[str, str]] = {
    "godot/world/rooms/Room01.tscn": {
        "terrain_grass_decor": "Floor/GrassDecor0-3 草皮点缀（Sprite2D，不参与碰撞形状）",
    },
    "godot/world/rooms/Room02.tscn": {
        "terrain_grass_decor": "Floor/GrassDecor0-3 草皮点缀（Sprite2D，不参与碰撞形状）",
    },
    "godot/world/rooms/Room03.tscn": {
        "terrain_grass_decor": "Floor/GrassDecor0-3 草皮点缀（Sprite2D）",
    },
    "godot/world/rooms/Room04.tscn": {
        "terrain_grass_decor": "Floor/GrassDecor0-1 草皮点缀（Sprite2D）",
    },
    "godot/world/rooms/Room05.tscn": {
        "terrain_grass_decor": "Floor/GrassDecor0-3 草皮点缀（Sprite2D）",
    },
    "godot/world/rooms/SafeHouse.tscn": {
        "terrain_grass_decor": "Floor 下草皮点缀（Sprite2D）",
    },
    "godot/world/interactables/RestBench.tscn": {
        "terrain_stone_bench": "休息长凳的凳体（Sprite2D；玩法见 RestBench.gd）",
    },
    "godot/world/interactables/SoilPlot.tscn": {
        "terrain_grass_decor": "SoilRect 土块贴图（Sprite2D）",
    },
    "godot/tests/test_world_visual_swap.gd": {
        "terrain_grass_decor": "换色测试的取样图，不实例化进关卡",
    },
}


# 占位：场景里确实在用，但用的是"拿通用石构件拼一个地标"，不是设计过的资产。
# 它们曾经被登记成 PROP_USAGE_OK（"已接入"），等于把占位洗成了合规 —— 这是错的。
# 占位必须报错而不是登记：留着的意义就是"这是一个待办"，绿了就会被忘掉。
#
# 2026-11-27：三条（Room03 风车 / Room04 书堆 / Room05 灯塔）已全部换成
# `Polygon2D` 原始几何体 —— 灰色占位块是灰盒，借用别处的成品图当替身不是。
# 表留空作为机制：以后再有"拿 A 拼 B"的占位，写进这里，它会红。
PROP_PLACEHOLDER: dict[str, dict[str, str]] = {}


def dropped_keys() -> set[str]:
    """从 `contact_sheet.py` 的 `DECISION` 表里读 `S_DROP` 的键。

    用 `ast` 读源码而不是 `import`：`contact_sheet` 会拉起 PIL 并在导入时算表，
    而这里只需要那张表的**键集合**。反而是"判据只有一份"更重要 ——
    两处各写一份弃用清单，迟早会漂。
    """
    src = (Path(__file__).resolve().parent / "contact_sheet.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else []
        if not any(getattr(t, "id", None) == "DECISION" for t in targets):
            continue
        if not isinstance(node.value, ast.Dict):
            continue
        keys: set[str] = set()
        for k, v in zip(node.value.keys, node.value.values):
            first = v.elts[0] if isinstance(v, ast.Tuple) and v.elts else None
            if isinstance(first, ast.Name) and first.id == "S_DROP":
                keys.add(ast.literal_eval(k))
        return keys
    return set()


def _base_key(key: str) -> str:
    """`ground_left_dark` → `ground_left`。两态是同几何换色，角色跟着基准件走。

    不剥后缀的后果实测过：`ground_mid_dark` 会被 `BY_DIR["Terrain"]="prop"`
    判成摆件，于是「摆件不得进关卡」这条断言把地面两态也算进了黑名单。
    这一轮没炸只是因为它恰好没进场景 —— 判据本身是错的，得先修。
    """
    for suf in ("_dark", "_ally"):
        if key.endswith(suf):
            return key[: -len(suf)]
    return key


def role_of(key: str, entry: dict) -> str | None:
    base = _base_key(key)
    if base in OVERRIDE:
        return OVERRIDE[base]
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

    # ── 摆件用法登记（§4）──
    print("\n[props] 立体摆件：只许构景，不许当可站立表面")
    prop_names = {k for k, v in data.items()
                  if role_of(k, v) == "prop" and not k.startswith("terrain_grass_top")}
    ok_hits: list[str] = []
    unregistered: list[str] = []
    placeholders: list[str] = []
    for f in GODOT.rglob("*"):
        if f.suffix not in (".tscn", ".gd", ".tres") or ".godot" in f.parts:
            continue
        rel = f.relative_to(ROOT).as_posix()
        text = f.read_text(encoding="utf-8", errors="ignore")
        tiled = tile_assets(rel)
        for name in sorted(prop_names):
            # 词边界，不是子串：`terrain_stone_block` 是 `terrain_stone_block_200` 的前缀，
            # 用 `in text` 会让每个引用 _200 的文件都"顺带"引用无后缀那张。
            if not re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", text):
                continue
            # 硬规则：摆件**真的**进了 TileSet 才是"被当瓦片铺"。
            # 不能看文件里有没有 "TileMapLayer" 这个词 —— 房间有了地面图层之后，
            # 每个 .tscn 都含这个词，于是所有摆件全被判违规（2026-11-27 的假阳性）。
            if name in tiled:
                bad.append(f"{rel} 用 TileSet 承载摆件 {name} —— 摆件不能铺格")
            if name in PROP_USAGE_OK.get(rel, {}):
                ok_hits.append(f"{rel} · {name} — {PROP_USAGE_OK[rel][name]}")
            elif name in PROP_PLACEHOLDER.get(rel, {}):
                placeholders.append(
                    f"{rel} 用 {name} 拼地标（占位，待专用图）：{PROP_PLACEHOLDER[rel][name]}")
            else:
                unregistered.append(f"{rel} 引用了摆件 {name}，但没在 PROP_USAGE_OK 登记用途")

    bad += unregistered + placeholders
    if placeholders:
        print(f"  🔴 {len(placeholders)} 处占位地标（不是合规用法，是待办）：")
        for line in placeholders:
            print(f"    · {line}")
    if not unregistered:
        print(f"  ✓ {len(ok_hits)} 处已登记用法，全部是 Sprite2D 构景")
        for line in ok_hits:
            print(f"    · {line}")

    print("\n[drop] 弃用件不得被任何场景/脚本引用")
    dropped = dropped_keys()
    drop_hits: list[str] = []
    for f in GODOT.rglob("*"):
        if f.suffix not in (".tscn", ".tres", ".gd") or ".godot" in f.parts:
            continue
        rel = f.relative_to(ROOT).as_posix()
        txt = f.read_text(encoding="utf-8", errors="ignore")
        for name in sorted(dropped):
            if re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", txt):
                drop_hits.append(f"{rel} 引用了弃用件 {name}（contact_sheet 判 S_DROP）")
    bad += drop_hits
    if dropped:
        if drop_hits:
            print(f"  🔴 弃用件 {len(dropped)} 个，被引用 {len(drop_hits)} 处：")
            for line in drop_hits:
                print(f"    · {line}")
        else:
            print(f"  ✓ 弃用件 {len(dropped)} 个（{'、'.join(sorted(dropped))}），零引用")

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
