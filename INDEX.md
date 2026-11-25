# INDEX · 文档索引（谁算数）

> 规则：**同一事实只允许一个真源**。这张表说明每份文档的状态，避免"新的做完旧的忘"。
> 每次新增/废弃文档，必须改这张表。表里没有的文档 = 不算数。
>
> 分层：**根目录只放现行规格**；参考分析进 `docs/ref/`；历史报告进 `docs/history/`。

## 状态图例

| 标记 | 含义 | 该不该读 |
|---|---|---|
| 🟢 | **现行规格**，必须遵守 | 动手前必读 |
| 🔵 | **设定**，世界观与内容 | 写内容/美术前必读 |
| 🟡 | **参考分析**，别人的东西 | 需要时读 |
| ⚪ | **历史报告**，只读不改 | 追根因时读 |
| 🔴 | **已废** | 不要读，不要引用 |

---

## 🟢 现行规格

| 文档 | 管什么 | 更新 |
|---|---|---|
| **`CANON.md`** | **唯一设定真源**：世界/迷宫/主角/敌人/数值/裁定 | 11-25 |
| **`DEV_FLOW.md`** | **唯一流程真源**：影响面三问、改动类型→动作、构建时机、回归矩阵、文档同步矩阵、收工检查单、反面清单 | 11-25 |
| `STYLE_LOCK.md` | **画风定版 = 蜡笔（P6）**：统一机制、L2 完成度判据、分辨率分档、§L3.5 出图底色（洋红 + 绿分割线）+ 提示词锁死、蜡笔四条物理、12 色板、动画帧数、UI 落点、验收清单、反面清单、**§L11 瓦片（当前：一张 PNG = 一块砖，64×48，游戏内按 1/6 显示）** | 11-25 |
| `MOVESET.md` | **主角 10 状态完整定义 + 31 帧全部出齐**：状态 × 帧 × 时间区间 × 判定 × 无敌 × 取消 × 反馈 × 脚滑判据，锚点统一脚底 (80,152)、检测方法 T1–T4、§7 出图工艺 | 🟢 现行 |
| `art/prompts/sprite_prompt.py` | **出图唯一入口**：骨架锁死在 `sprite_template.txt`，只允许改四处背景句；10 状态配置 + 帧数 + fps | 🟢 现行 |
| `art/tools/crayon.py` | **程序画的唯一入口**。受约束的蜡笔笔刷原语（stroke/fill/outline/hatch/speck），只收 12 色板名 + 有限笔宽 | 🟢 现行 |
| `godot/` | **Godot 4.4 工程（正式发行形态）**：与 web 原型并存。玩家移动/跳跃/5 状态动画 + 战斗组件（Hitbox/Hurtbox/局部顿帧）+ WorldState 存档 + 沸腾线 shader + 单屏测试房。用 Godot 打开这个子目录，不是仓库根 | 🟠 移植中 |
| `godot/README.md` | Godot 工程说明：打开方式、手感标定记录、资产同步、渲染设置、移植顺序 | 🟢 现行 |
| `docs/ref/OTHERS_GDD_REVIEW.md` | 别人那份 GDD/TDD 的逐条核对：可吸收 / 照抄会炸（9 处）/ 不适用；**§6 说明它的数值已抄成 `F2` 对照预设的用途**。再收到同类文档先看这份 | 🟢 现行 |
| `art/tools/p5brush/tilegen8.html` | **瓦片生成器（现行）**：一张 PNG = 一块砖，64×48，6 seed 出 6 外形。渲染用 `art/tools/p5brush/render.js shot` | 🟢 现行 |
| `art/tools/P5BRUSH.md` | **p5.brush 评估**：命令集全表、11 个内置笔刷手感、三条实测硬伤（无 wrap / 尺度绑画布 / strength 是排线密度）、尺度分工表 | 🟢 现行 |
| `art/tools/p5brush/` | 上游 p5.brush 的**可复现调用层**。`setup.sh` 拉仓库，`render.js` 出图 | 🟢 现行 |
| `art/prompts/bg_prompt.md` | **背景出图配方**：与精灵表共用 Medium / 12 色板，只改三处 | 🟢 现行 |
| `art/bg/bg_<room>.png` | **背景板**：960×540 整幅蜡笔背景（96 色量化），镜像拼接平铺，视差 0.28 | 🟢 现行（仅 hall） |
| `art/hero/` | **主角 10 状态成表**：`hero_<state>.png` + `.gif` + `_proof.png`，总表 `_ALL_STATES.png` | 🟢 现行 |
| `art/tools/build_sheet_magenta.py` | **切片薄适配层**：160×160 网格/锚点/连通域过滤/缩放基准（tallest·head） | 🟢 现行 |
| `_probe_crayon.js` | **接入验收**：脚底/地面差、蹲站身高比、离锚点、翻转横移，全出数字 | 🟢 现行 |
| `UI_SKIN.md` | **UI 皮肤方案**：三层分离、九宫格、离散量条、UI 在明度阶梯的站位、迁移顺序 | 🟢 现行 |
| `ASSET_MANIFEST.md` | **美术资产清单**：7 类实盘（精灵/瓦片/背景/道具/特效/UI/角色卡线），含数量与生产顺序 | 🟢 现行 |
| `ART_INVENTORY.md` | **美术资产实盘盘点**（11-26）：四条产线各自怎么跑、坐标图、13 条问题（地砖废件 / 砖尺度冲突 / 工具断点）、下一步排序。**问"美术现在什么状态"看这份** | 🟢 现行 |
| `ART_PIPELINE.md` | 素材管线：分层规格、生成配方、分件骨骼、成本台账 | 11-25 改写 |
| `ACTION_CHAIN.md` | 操作-动作五段链路（意图→输入→动作→判定→反馈）+ 待裁定 | 11-25 |
| `DOC_CONTROLS.md` | 操控代码完整实现与核对清单 | 11-25 |
| `FEEL_TABLE.md` | 手感数字表（**自动生成，勿手改**，源头是 `feel_table.js`） | 11-24 |
| `DESIGN_A.md` | 路线选择：老实复刻《重生细胞》 | 11-25 |
| `README.md` | 怎么玩 / 怎么改 / 13 套回归 + 4 探针命令 | 11-25 |

## 🔵 设定

| 文档 | 管什么 | 状态 |
|---|---|---|
| `STORY.md` | 《二向箔》故事设定 v0.3（快门、二维、场景、反派、结局） | 🟢 有效，但**世界形态已被 CANON §2 覆盖**（照片拍的是树） |

## 🟡 参考分析（`docs/ref/`）

| 文档 | 来源 | 有用的是什么 |
|---|---|---|
| `docs/ref/REF_DEADCELLS.md` | 《重生细胞》手机版拆解 | 数值对照、取消窗口、rally 机制 |
| `docs/ref/LOOP.md` | 月下主循环逐行拆解 | 帧结构、状态机顺序 |
| `docs/ref/STYLE_CANDIDATES.md` | 风格选型 | 17 种 2D 平面画法 + 实测评分，**已定 P6** |
| `docs/ref/CONSULT_001_controls_hud_art.md` | 外部咨询 | 控制/HUD/美术方向问题清单 |
| `docs/ref/AUDIT_001_DVF.md` | 外部审计 | DVF（方向/速度/感觉）评分 |
| `docs/ref/NIGHTFALL_REVIEW.md` | 外部评审 | 技术与产品意见 |
| `docs/ref/CRAYON_ODYSSEY_GDD.md` | 《色彩旅人》GDD/TDD **原文归档** | 数值出处（480 / 1320 / 460 / 0.14…）。已抄成 `F2` 预设，只作对照 |

## ⚪ 历史报告（`docs/history/`，只读，不再更新）

| 文档 | 内容 |
|---|---|
| `docs/history/S1_S3_REPORT.md` | 三个地基（渲染/输入/时间步）落实 |
| `docs/history/S4_REPORT.md` | Flatten 实验（已回滚，见 `.bak/pre_unflat_20261125/`） |
| `docs/history/S5_REPORT.md` | Q1–Q17、Q22–Q24 裁定落地 |
| `docs/history/WO3_REPORT.md` | 操作与 HUD 可用性 |
| `docs/history/WO3_1_REPORT.md` | 组合回滚修正 |
| `docs/history/WO4_REPORT.md` | 四格装备栏 + 布局可调 |
| `docs/history/PACKAGE_README.md` | 代码包分发说明 |
| `docs/history/STYLE_N1.md` | 旧的"明快自然"画风（N1），已停用，只留作配色参考 |

## 🔴 已废（已于 2026-11-25 清理出库）

> 这些不再占仓库体积。需要追溯时从 git 历史取（`git log --diff-filter=D -- <path>`）。
> **被推翻的方案不留文件，只留结论。** 结论写进本文或 `docs/history/`。

| 文档/目录 | 为什么废 | 现状 |
|---|---|---|
| `art/tools/tilegen.py` | 几何直线 + 纸纹针孔，不是蜡笔 | 已删，由 `art/tools/p5brush/tilegen8.html` 取代 |
| `art/tools/p5brush/tilegen.html` ~ `tilegen7.html` | 中间尝试（整面墙瓦片 / 切半砖 / 一张图多块砖） | 已删，结论见 `docs/history/STYLE_L11_修订史.md` |
| `art/tools/p5brush/probe_*.html` + `cap/decal/t_width/tile.html` | 一次性机制探针，验证完即废 | 已删 |
| `art/tiles/_exp/`（除 2 张基准图） | 涂法与排布的失败变体，共 396 张 | 已删，仅留 `art/tiles/_ref/cmp_gen_downscale.png`、`art/tiles/_ref/_ref_wall_zoom.png` |
| `art/tiles/_coat_*.png` | 17 张涂法变体，全部被否 | 已删 |
| `art/decal/` | 4 张贴片，只验证过，未接入游戏 | 已删 |
| `.bak/` | 各阶段快照（文件均在 git 库中） | 已删 |
| `style_lab.html` / `style_proto.html` | 风格板 / 含作废风衣旅人的原型 | 已删 |
| `shots/style2..style5*` | 5 批 24 张方向图，全部被否 | 已删 |
| `shots/01~29_*.png` + 临时调试图 | 开发过程截图 / `_crop_*`、`_dbg_*` | 已删 |

---

## 新增文档时的三步

1. 先在本文抢一个状态（🟢/🔵/🟡/⚪/🔴），并决定放根目录还是 `docs/`
2. 写清"管什么"——一句话，写不出就是没想清楚
3. 若与已有文档冲突，**当场改唯一真源**（设定 → CANON，画风 → STYLE_LOCK，流程 → DEV_FLOW），不要两边都留

---

## 文档分层

```
game-soulkeep/
├─ CANON.md  INDEX.md  PROJECT_MAP.md  DEV_FLOW.md  README.md   ← 先读这五个
├─ STYLE_LOCK.md  MOVESET.md  DESIGN_A.md  ACTION_CHAIN.md
├─ DOC_CONTROLS.md  FEEL_TABLE.md  UI_SKIN.md  ASSET_MANIFEST.md
├─ ART_PIPELINE.md  STORY.md                                    ← 现行规格，平铺根目录
├─ docs/
│  ├─ ref/       参考分析（别人的东西，需要时读）
│  └─ history/   历史报告（只读，追根因时读）
├─ src/          游戏代码
├─ art/          素材与生成器
└─ shots/        截图证据
```
