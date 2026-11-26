# PROJECT_MAP · 唯一入口（≤70 行）

> 原来这份文件写的是另一个项目（照片→SVG→贴身体），已作废重写。
> **找东西看这里，找真相看 `CANON.md`，找文档看 `INDEX.md`，找流程看 `DEV_FLOW.md`。**

## 这是什么

《二向箔》—— 一张照片被拍扁之后，你得自己走进去，把里面的人弄出来。
横版动作，复刻《重生细胞》手感（`DESIGN_A.md`）。

> **技术形态：两个工程并存，别搞混。**
> - `src/` + `build.py` → **web 原型**（纯 HTML5 Canvas 2D，功能最全，用于验证玩法与画风），跑 `SoulKeep.html`
> - `godot/` → **Godot 4.4 工程**（正式发行形态），用 Godot 打开 **`godot/` 这个子目录**，不是仓库根
>
> 仓库根目录没有 `project.godot`，用 Godot 打开根目录必然失败。详见 `godot/README.md`。

## 现在到哪一步了

| 环节 | 状态 |
|---|---|
| 手感 / 操作链（13 套回归 + 4 探针全绿） | ✅ 可玩（web 版） |
| **Godot 移植** | 🟠 骨架完成：跑/跳/二段跳/顶点滞空/5 状态动画 + 单屏测试房，手感已标定（满跳 203.9px）；战斗组件、WorldState 存档、沸腾线 shader 已就绪且有测试。相机、攻击接线、房间数据化未做（`godot/README.md`） |
| 美术方向（蜡笔） | ✅ **统一到 `art/ART_GUIDE.md` v1.3**（2026-11-26 从 `Dual_Vector_Foil` 原样移植，门禁 G1–G5 全过）。旧七层锚点/`STYLE_LOCK.md` 退为 LEGACY |
| 正式资产 | ✅ **41 张到手**（`art/approved/`，29 正式 + 12 精灵派生）：敌人 3 种 / 道具 3 种 / 特效 4 张 / UI 3 张 / 地形摆件 7 张 / 角色 8 态 |
| 主角 | 🔴 **两套并存，待裁决**：旧 31 帧（大胡子白 T，已接入）vs 复用母版（棕发红围巾小孩，未接入）。同一游戏不应有两个主角，见 `art/ART_GUIDE.md §12.4` |
| 敌人 / 道具贴图 | 🟠 **素材已到，未接入**（代码仍程序绘制） |
| 背景板 | 🔴 `bg_hall.png` **从未被绘制**：`drawTileField` 成功就跳过它（三级降级的第二级是死代码）。11-26 核实，见 `ART_INVENTORY §P0-1` |
| 墙砖贴图 | 🟠 已接入（`paintWallTiles`，**生图素材板 → 切片**，54×48，游戏内 9×8）；平铺有轻微规律感（`ART_INVENTORY §P1-1`） |
| 地砖贴图 | 🔴 **当前是坏的**：`paintFloorTiles` 被误改成墙砖路径，`floor_*.png` 是废像素（不是缺入口），图和函数都要重做 |
| 可平铺地形瓦片 | 🔴 **仍缺**：复用来的地形是**整块摆件**（200×165 石头等），不是 `TILE=48` 瓦片，不能直接铺（`art/README.md §3`） |
| 迷宫（世界树） | 🔵 设定完成（`CANON.md §2`），未实现 |
| 敌人（纸系） | ❌ 未做素材 |

## 必读入口

| 想干什么 | 读哪份 |
|---|---|
| 定设定 / 定数值 | **`CANON.md`**（唯一真源，冲突以它为准） |
| 查哪份文档算数 | **`INDEX.md`** |
| 改代码 / 换资产要走什么流程 | **`DEV_FLOW.md`** |
| 改美术 / 画风 / 出图 / 抠图 | ⭐ **`art/ART_GUIDE.md`（唯一规范）+ `art/README.md`（总索引 + 八步流程）** |
| 做资产：出图 → 抠图 → 入库 | **`art/README.md` §4**（八步）+ `art/prompts/Master_v1.3.md` |
| 改手感 | `FEEL_TABLE.md`（自动生成）+ `ACTION_CHAIN.md` |
| 改操控 | `DOC_CONTROLS.md` |

## 目录

```
game-soulkeep/
├─ PROJECT_MAP.md  INDEX.md  DEV_FLOW.md  CANON.md  README.md  ← 先读这五个
├─ src/          游戏代码（game.js / mobile.js / audio.js / index.html）
├─ art/          ← ⭐ 美术唯一入口：先开 art/README.md
│                ART_GUIDE.md 规范 · approved/ 41 张 · reference/ 母版 · prompts/ Master_v1.3
│                reports/ 门禁记录 · tools/ extract_magenta
│                hero|bg|tiles|out|src|ref/ = 🔴 LEGACY 旧资产（只读）
├─ docs/         ref/ 参考分析 · history/ 历史报告（只读）
├─ shots/        截图证据
├─ *.js          13 套回归 + 4 探针（清单见 README）
└─ .bak/         历史实验备份
```

## 铁律

1. **先写 CANON 再动手**。对话里冒出的新设定先落文档。
2. **改数值必须同时改 `CANON.md §5`**，否则算没做完。
3. **美术 100% 生图**，代码只做分层、合成、动画、特效，不画形状。
   规范只有一份：`art/ART_GUIDE.md`。**现在没有例外**，要开例外先登记理由。
4. **视觉验证**：每次交付附整体图 + 局部放大 + 对比图 + 缺陷标注。
5. 交付前按 `DEV_FLOW.md §4` 跑对应回归，全量是 13 套 424 项。

## 下一步（按顺序）

0. **裁决主角**（阻塞其余美术）：旧 31 帧大胡子 vs 复用母版红围巾小孩，二选一写进 `CANON.md`。
   不定这条，角色相关资产会分叉成两套（`art/ART_GUIDE.md §12.4`）
1. **P0-1 选一条路**：同一套瓦片现在被 `drawTileField` 按 48px、被 `paintWallTiles` 按 9px
   各铺一遍（`ART_INVENTORY §P0-1`）。推荐 **A：统一到 1/6，`drawTileField` 改 pattern**
2. **重做地砖**：扁石板素材板 → `tile_from_gen.py --tw 48 --th 32` → **新增** `paintFloorTiles()`，
   删 6 张废件（`DEV_FLOW.md §0-3`）
3. 墙砖压掉亮边规律感（重出素材板，挑亮边弱的）
4. 纸系敌人 2 种
5. 世界树迷宫：先做**根系**（教学层），验证"垂直 + 分叉"能不能玩
