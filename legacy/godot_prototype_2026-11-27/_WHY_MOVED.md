# 为什么这份原型骨架被移到 legacy/（2026-11-27）

同目录的 `README.md` 是 `godot/` 在合并前的原始文档，**原文未改**，只在这里补一段说明。

> README 里所有 `../xxx` 开头的相对链接，是按它当时的位置（`godot/`）写的，
> 现在要读成**从仓库根开始**：`../art/ASSET_RULES.md` → `art/ASSET_RULES.md`，
> `../docs/ref/...` → `docs/ref/...`。

## 发生了什么

2026-11-27 查清：本项目在 GitHub 上有**两条互不相干的历史**（无任何共同提交）：

| | `DualVectorFoil/master` | 本地 `game-soulkeep` |
|---|---|---|
| 起于 | 2026-11-26 09:33 | 2026-11-25 |
| 工程规模 | 230+ 代码文件、`dialogue_manager`、24 个测试、房间/交互物全套 | **17 个 `.gd`**，单屏 feel 测试房 |
| 独有 | 三平台导包 CI、`export_presets.cfg` | 文档、`art/tools` 产线、全部美术 |

白哥裁定「**本地仓库为准，把远端工程并进来**」，于是：

- 远端完整工程 → `godot/`（现役）
- 这份 17 文件的原型骨架 → `legacy/godot_prototype_2026-11-27/`（本目录，存档）

**没有删除**，因为它承载 11-25 → 11-26 的手感标定证据：`P_JUMP_V 991` 的来由、
两套预设 F1/F2 的实测对照、`ground_strip` 的「96×2+384×N」拼接、沸腾线 shader 的
linear 过滤实测。这些数字在 `docs/` 和 `FEEL_TABLE.md` 里有结论，但原始推演过程只在
这份 README 里。

## 例外：`data/` 被移回 `godot/data/` 了

原来的 `godot/data/{world_map,rooms}.json` 看起来像骨架的一部分，其实**是活工具的产物**：
`tools/worldmap/build_world.py` 与 `slice_rooms.py` 直接写这两个路径，而 `04 §8` 把
`world_map.json` 定为世界结构的**权威数据**。跟着骨架一起移走会让整条工具链写到一个
不存在的目录。所以它回到 `godot/data/` —— 本目录里没有 `data/`，别去别处找。

## 它现在跑不起来

引用的资源镜像已从 `godot/assets/art/` 改名为 `godot/art/`（配合新工程的 `res://art/`），
而这里的脚本写的是 `res://assets/art/`。要参考**只读代码**，别指望能启动。

真要启动：

```bash
cp -r legacy/godot_prototype_2026-11-27 /tmp/proto
mkdir -p /tmp/proto/assets && cp -r godot/art /tmp/proto/assets/art
# 然后用 Godot 4.7.2 打开 /tmp/proto
```

## 回滚整次迁移

```bash
git tag -l | grep pre-godot-merge          # pre-godot-merge-2026-11-27
git reset --hard pre-godot-merge-2026-11-27
```
