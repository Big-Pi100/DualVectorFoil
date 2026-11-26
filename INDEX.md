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
| **`docs/gdd/`** | ⭐ **玩的唯一真源（2026-11-26 起）**：定位与支柱 / 核心循环 / 战斗 / 经营种植 / 关卡地图 / 叙事主角 / 数值表 / MVP / 存档与离线。8 轮问答落地，十个决定可追溯。**先读 `docs/gdd/README.md`** | 11-26 |
| `docs/gdd/00` · `01` | 定位与四大支柱（动作手感第一）、五级循环（秒/分/十分钟/半小时/隔天） | 11-26 |
| `docs/gdd/02` · `03` | 四技能（投掷/折叠/生长/底片）、两档五敌；**经营差异化**：作物五类、现实时间、袭击、招安 | 11-26 |
| `docs/gdd/04` · `05` · `06` | 世界树五层 + 能力门判据；叙事与主角裁定；**数值唯一真源** | 11-26 |
| `docs/gdd/07` · `08` | **MVP 只做根系**：阶段出口三态、可平铺地形第一优先、资产三态、验收 A1–D3；**存档与离线**：写盘点、坏档恢复、离线确定性结算 | 11-26 |
| ⭐ `docs/gdd/map/` | **大地图与切房**（11-26）：`world_map.html` 全局 48 房可点（尺寸/连接/门，包围盒 1.22:1、12 个环、轮廓覆盖 56%），`rooms_preview.html` 切出来的房间骨架。规则见 `docs/gdd/04 §10` | 11-26 |
| ⭐ `tools/worldmap/` | `build_world.py` 定义房间矩形 → `godot/data/world_map.json`；`slice_rooms.py` 切房 → `godot/data/rooms.json`。**地图格的单位是 TILE 不是屏幕**（540÷48=11.25 不是整数） | 11-26 |
| 🔴 `CANON.md` | 旧设定真源：世界/迷宫/主角/敌人/数值/裁定。**已并入 `docs/gdd/`**，保留为素材 | 🔴 LEGACY |
| **`DEV_FLOW.md`** | **唯一流程真源**：影响面三问、改动类型→动作、构建时机、回归矩阵、文档同步矩阵、收工检查单、反面清单 | 11-25 |
| **`art/ART_GUIDE.md`** | ⭐ **美术唯一真源（2026-11-26 起）**：《二向箔》美术风格规范 **v1.3**。风格六特征 / 主角锁定 / 门禁流水线 G0→G5 / 评分与 PASS 判据 / 洋红底与青色分隔线规则 **P1–P11** / Godot 尺寸链 / **§12 本项目 Canvas 适配（尺寸换算、资产可用性、主角变更）**。（来自 `E:/Dual_Vector_Foil`，门禁全过原样移植） | 11-26 |
| **`art/README.md`** | ⭐ **美术总索引 + 新资产九步流程**：目录路由（ACTIVE / LEGACY 逐条）、41 张资产清单与尺寸、接入前必知两件事（换主角 / 地形不是瓦片）、失败样本位置 | 11-26 |
| `art/prompts/Master_v1.3.md` | **唯一提示词前缀**：风格身份 / 媒介 / 轮廓 / 造型 / 色彩 / 纸面 / 资产清晰度 / 技术附加段（独立资产 / 多格）。全文置于资产描述之前，不许逐图改写 | 11-26 |
| `art/tools/extract_magenta.py` | **唯一抠图工具**：P9 实测底色（非死阈值）/ P1 连通域只删边界连通 / P4 despill / P8 水印 / P10 采样避水印 / P11 最近邻扩散防双线性混洋红 | 11-26 |
| `art/approved/` | **正式资产 41 张**（29 正式 + 12 精灵派生）+ `manifest.json` 追溯。过门禁才能进 | 11-26 |
| `art/reference/` | 视觉母版 `character_style_sheet.jpg` + `derived/` 20 张派生裁剪 | 11-26 |
| `art/reports/Gate_Review.md` · `Experiment_Log.md` | G1–G5 门禁评审 + E01–E04 实验记录（改规范前先看判定依据） | 11-26 |
| `STYLE_LOCK.md` | **画风定版 = 蜡笔（P6）**：统一机制、L2 完成度判据、分辨率分档、§L3.5 出图底色（洋红 + 绿分割线）+ **§L0.5 提示词七层锚点（含六条实测结论）**、蜡笔四条物理、12 色板、动画帧数、UI 落点、验收清单、反面清单、**§L11 瓦片（当前：生图素材板 → 切片，一张 PNG = 一块砖，54×48，游戏内按 1/6 显示；§L11.4 p5.brush 退场结论）** | 🔴 LEGACY |
| `MOVESET.md` | **主角 10 状态完整定义 + 31 帧全部出齐**：状态 × 帧 × 时间区间 × 判定 × 无敌 × 取消 × 反馈 × 脚滑判据，锚点统一脚底 (80,152)、检测方法 T1–T4、§7 出图工艺 | 🔴 LEGACY |
| `art/prompts/style_anchor.py` | **七层提示词锚点，唯一真源**（11-26 建）：L1 媒介 / L2 笔触 / L3 可读 / L3.5 朝向 / L3.6 投影 / L4 色板 / L5 禁区 + 底色（工序参数）+ 5 个 profile。`--check` 与定版模板对账，`--budget` 卡 2200 字符。理由与六条实测在 `STYLE_LOCK §L0.5` | 🔴 LEGACY |
| `art/prompts/sprite_prompt.py` | **出图唯一入口**：骨架锁死在 `sprite_template.txt`，只允许改四处背景句；10 状态配置 + 帧数 + fps | 🔴 LEGACY |
| `art/tools/crayon.py` | 受约束的蜡笔笔刷原语（stroke/fill/outline/hatch/speck），只收 12 色板名 + 有限笔宽。**当前零调用者**，仅作机制存档，见 `STYLE_LOCK §L11.5` | 🟠 存档 |
| ⭐ `godot/` | **唯一开发主线（2026-11-26 定）**，引擎锁定 **Godot 4.7.2-stable**（`tests/env_check.gd` 守卫）：所有新功能只写这里。玩家移动/跳跃/5 状态动画 + 战斗组件 + WorldState 存档 + 沸腾线 shader + 单屏测试房。**缺相机/多房间/攻击接线/敌人**（`docs/gdd/07 §10.3` 第 0 步）。用 Godot 打开这个子目录，不是仓库根 | 🟠 主线 |
| 🔴 `src/` | **冻结的 web 基线**：唯一完整可玩版本（13 套回归 + 424 项断言），不再加功能。归档条件见 `docs/gdd/07 §10.4` | 🔴 冻结 |
| `godot/README.md` | Godot 工程说明：打开方式、**版本定版与守卫**、手感标定记录、资产同步、渲染设置、移植顺序 | 🟢 现行 |
| `docs/ref/OTHERS_GDD_REVIEW.md` | 别人那份 GDD/TDD 的逐条核对：可吸收 / 照抄会炸（9 处）/ 不适用；**§6 说明它的数值已抄成 `F2` 对照预设的用途**。再收到同类文档先看这份 | 🟢 现行 |
| `art/tools/tile_from_gen.py` | **瓦片切片**（11-26 起）：洋红底素材板 → 洋红键 → 连通域分行 → 每块归一化到 54×48（保持比例、贴底、居中）→ 平铺预览。用法见 `ART_SKILLS §6`，配方见 `ART_PIPELINE §4.5` | 🔴 LEGACY |
| `art/tools/pick_tiles.py` | **选砖**：从 12~16 块里按贪心最大最小距离挑 6 块 → `wall_0..5.png`。不许"取前 6 张" | 🔴 LEGACY |
| `art/tools/asset_audit.py` | **资产体检**：尺寸 / 真 alpha / 帧数与配置对账 / 同类尺寸一致 / 有无消费点 / 死引用。`--strict` 有 P0 则非零退出 | 🟢 现行 |
| `art/ref/style_ref_v1.png` | **风格参考图**（11-26）：主角 + 石头 + 草 + 史莱姆同框，验"同一支笔"与颗粒感。**不进游戏**，用途是改风格后花一张图确认没漂 | 🔴 LEGACY |
| `art/tiles/gen/_trials/` | 本轮 6 张**失败样本** `t1..t6`，每张一个变量。**不删** —— 半年后要能复查"为什么这句话不能写" | 🟠 证据 |
| `art/tiles/gen/` | 瓦片生图**素材板原图**（1024×1024，洋红底）+ `wallB_sheet.png` 切片位置可视化。旧产线，只读 | 🔴 LEGACY |
| `art/prompts/bg_prompt.md` | **背景出图配方**：与精灵表共用 Medium / 12 色板，只改三处 | 🔴 LEGACY |
| `art/bg/bg_<room>.png` | **背景板**：960×540 整幅蜡笔背景（96 色量化），镜像拼接平铺，视差 0.28 | 🔴 LEGACY |
| `art/hero/` | **主角 10 状态成表**：`hero_<state>.png` + `.gif` + `_proof.png`，总表 `_ALL_STATES.png` | 🔴 LEGACY |
| `art/tools/build_sheet_magenta.py` | **切片薄适配层**：160×160 网格/锚点/连通域过滤/缩放基准（tallest·head） | 🔴 LEGACY |
| `_probe_crayon.js` | **接入验收**：脚底/地面差、蹲站身高比、离锚点、翻转横移，全出数字 | 🟢 现行 |
| `UI_SKIN.md` | **UI 皮肤方案**：三层分离、九宫格、离散量条、UI 在明度阶梯的站位、迁移顺序 | 🟢 现行 |
| `ASSET_MANIFEST.md` | **美术资产清单**：7 类实盘（精灵/瓦片/背景/道具/特效/UI/角色卡线），含数量与生产顺序 | 🟠 待改 |
| `ART_INVENTORY.md` | **美术资产实盘盘点**（11-26 二次）：三条生图产线各自怎么跑、样图索引、问题分级（**背景盖住 95% 画面** / 地砖废件 / 墙砖亮边）、下一步排序。**问"美术现在什么状态"看这份** | 🟠 存档 |
| `ART_PIPELINE.md` | 素材管线：分层规格、生成配方（锚点由代码提供，本节只写槽位）、瓦片六次实测修订记录、分件骨骼、成本台账 | 🔴 LEGACY |
| **`ART_SKILLS.md`** | **美术生产技能手册**：10 个 skill（出图/切片/选砖/内嵌/取证/手感/体检）各自的触发、参数、命令、判据、失败模式；三条端到端管线与门；判据速查表；接入新资产的 9 步检查单。**动手做资产时照着这份做** | 🔴 LEGACY |
| `ACTION_CHAIN.md` | 操作-动作五段链路（意图→输入→动作→判定→反馈）+ 待裁定 | 🔴 LEGACY |
| `DOC_CONTROLS.md` | 操控代码完整实现与核对清单 | 11-25 |
| `FEEL_TABLE.md` | 手感数字表（**自动生成，勿手改**，源头是 `feel_table.js`） | 11-24 |
| `DESIGN_A.md` | 路线选择：老实复刻《重生细胞》 | 🔴 LEGACY |
| `README.md` | 怎么玩 / 怎么改 / 13 套回归 + 4 探针命令 | 11-25 |

## 🔵 设定

| 文档 | 管什么 | 状态 |
|---|---|---|
| `STORY.md` | 《二向箔》故事设定 v0.3（快门、二维、场景、反派、结局） | 🔴 LEGACY |

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
| `docs/ref/REF_ARIA_OF_SORROW.md` | 《晓月圆舞曲》魂/道具系统拆解 | **技能分层（4 层成本模型）、55:24:35:6 配比、贵≠强的效率表、能力门 5/6 确定获取**。数据在 `aos_souls.json`（120 条），可视化 `aos_souls.html` |
| ⭐ `docs/ref/aos/` | **《晓月》完整资料库**（11-26 建）：**入口是 `REF_AOS_COMPLETE.md`**（§0 按开发工序索引），数据四份 `aos_enemies.json`（109 敌）/ `aos_areas.json`（13 区 + 能力门）/ `aos_bosses.json`（11 BOSS）/ `aos_systems.json`（公式·掉落·结局），一页总览 `aos_atlas.html`。**109 敌 / 13 区 / 11 BOSS / 1–99 级公式 / 3 结局** | 🟡 参考 |
| `tools/ref/aos_build.py` | 资料库构建器 + 校验器：`--check` 跑公式端点回代、五点比对、区域聚合、魂名交叉引用。**原始抓取证据在 `tools/ref/_src/aos_enemies_raw.txt`，永不改** | 🟡 参考 |

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
| `art/tools/tilegen.py` | 几何直线 + 纸纹针孔，不是蜡笔 | 已删 |
| `art/tools/_archive/p5brush/` | **瓦片程序渲染整条产线**（tilegen8.html + render.js + setup.sh）。11-26 退回生图后归档，四条退场原因见 `STYLE_LOCK §L11.4` | 已归档，只读 |
| `art/tools/_archive/P5BRUSH.md` | p5.brush 评估（命令集、11 个笔刷手感、三条硬伤）。**结论已被"退回生图"取代**，只作机制参考 | 已归档，只读 |
| `art/tools/tile_preview.py` | `N = 192` 断言过期，功能被 `tile_from_gen.py --preview` 覆盖 | 已删 |
| `art/tools/BG_SCOPE.md` | 背景分工建立在"用 p5.brush 画贴片"上，前提失效。§2 的判据（各向同性效果 / 精确几何 / 运行时粒子）仍可读 | 🟠 存档，头部已标注 |
| `p5brush/tilegen.html` ~ `tilegen7.html` | 中间尝试（整面墙瓦片 / 切半砖 / 一张图多块砖） | 已删，结论见 `docs/history/STYLE_L11_修订史.md` |
| `p5brush/probe_*.html` + `cap/decal/t_width/tile.html` | 一次性机制探针，验证完即废 | 已删 |
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
3. 若与已有文档冲突，**当场改唯一真源**（设定 → CANON，**画风 → `art/ART_GUIDE.md`**，流程 → DEV_FLOW），不要两边都留

---

## 文档分层

```
game-soulkeep/
├─ INDEX.md  PROJECT_MAP.md  DEV_FLOW.md  README.md            ← 先读这四个
├─ CANON.md  ← 🔴 旧设定真源，已并入 docs/gdd
├─ STYLE_LOCK.md  MOVESET.md  DESIGN_A.md  ACTION_CHAIN.md      ← 🔴 LEGACY（画风参数已并入 art/ART_GUIDE）
├─ DOC_CONTROLS.md  FEEL_TABLE.md  UI_SKIN.md  ASSET_MANIFEST.md
├─ ART_PIPELINE.md  ART_SKILLS.md  ART_INVENTORY.md  STORY.md   ← 🔴 LEGACY = 旧产线记录，别再照做
├─ docs/
│  ├─ gdd/       ⭐ 玩的唯一真源（00~08，先读 README）
│  ├─ ref/       参考分析（别人的东西，需要时读）
│  └─ history/   历史报告（只读，追根因时读）
├─ src/          🔴 冻结的 web 基线（不再加功能）
├─ godot/        ⭐ 唯一开发主线
├─ art/          ← ⭐ 美术唯一入口，先开 art/README.md
│  ├─ ART_GUIDE.md      唯一规范 v1.3（含 §12 本项目适配）
│  ├─ README.md         总索引 + 新资产九步
│  ├─ approved/         41 张正式资产 + manifest.json
│  ├─ reference/        母版 + derived 派生裁剪
│  ├─ prompts/          Master_v1.3.md（唯一前缀）
│  ├─ reports/          Gate_Review + Experiment_Log
│  ├─ tools/            extract_magenta.py（唯一抠图）
│  └─ hero|bg|tiles|out|src|ref/   ← 🔴 LEGACY 旧资产，只读
└─ shots/        截图证据
```
