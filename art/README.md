# art/ · 美术总索引

> **唯一规范**：[`ART_GUIDE.md`](ART_GUIDE.md)（《二向箔》美术风格规范 v1.3，2026-11-26 门禁 G1–G5 全过）
> **唯一视觉基准**：[`reference/character_style_sheet.jpg`](reference/character_style_sheet.jpg)
> **唯一提示词前缀**：[`prompts/Master_v1.3.md`](prompts/Master_v1.3.md)
> **唯一抠图工具**：[`tools/extract_magenta.py`](tools/extract_magenta.py)（P1–P11 全实现）
>
> 2026-11-26 起，**本项目美术一律走本目录这套**。下方标 `LEGACY` 的内容仅作历史证据保留，禁止新增。

---

## 1. 目录路由

| 路径 | 状态 | 是什么 |
| --- | --- | --- |
| `ART_GUIDE.md` | **ACTIVE** | 美术规范唯一真源。风格定义 / 门禁流水线 / 洋红与分隔线规则 / 抠图 P1–P11 / 本项目适配（§12） |
| `reference/character_style_sheet.jpg` | **ACTIVE** | 视觉母版（主角三视图 + 动作 + 三敌 + 场景道具） |
| `reference/derived/` | **ACTIVE** | 母版派生裁剪，生成时按类引用，**每次只引相关一张**；多格图禁用于单帧动作（§1.1.1） |
| `prompts/Master_v1.3.md` | **ACTIVE** | 固定提示词前缀，全文置于资产描述之前，不得逐图改写 |
| `approved/` | **ACTIVE** | 正式资产 41 张 PNG + `manifest.json`。**只有过了门禁的才能进这里** |
| `reports/Gate_Review.md` | **ACTIVE** | G1–G5 门禁评审记录（判定依据，改规范前先看） |
| `reports/Experiment_Log.md` | **ACTIVE** | E01–E04 实验记录（每张样本的 prompt / 参数 / 评分） |
| `tools/extract_magenta.py` | **ACTIVE** | 洋红底抠图，含 P9 实测底色 / P1 连通域 / P4 despill / P8 水印 / P10 采样避水印 / P11 最近邻扩散 |
| `tools/asset_audit.py` | ACTIVE | 资产体检（尺寸 / 真 alpha / 死引用 / 有无消费点） |
| `tools/build_sheet_magenta.py` | LEGACY | 旧精灵表构建（洋红底 + 纯绿分割线 → 160 网格）。新资产走 `approved/` 标准化帧，不再需要 |
| `tools/tile_from_gen.py` · `pick_tiles.py` | LEGACY | 旧瓦片产线（生图散石 → 连通域分行 → 54×48） |
| `tools/crayon.py` · `cardify.py` · `_archive/` | LEGACY | p5.brush 时代的笔刷与卡片生成，已退场 |
| `prompts/style_anchor.py` · `sprite_prompt.py` · `sprite_template.txt` · `bg_prompt.md` | LEGACY | 旧七层锚点产线。被 `Master_v1.3.md` 取代 |
| `hero/` | LEGACY | 旧主角 31 帧（大胡子白 T，帧框 160×160）。见 `ART_GUIDE §12.4` |
| `bg/` | LEGACY | 旧背景（`bg_hall.png` 从未被绘制，见 `ART_INVENTORY` P0-1） |
| `tiles/` | LEGACY | 旧瓦片（54×48 两行错缝） |
| `out/` `src/` `ref/` | LEGACY | 旧的对比图、生成原图、风格参考 |

> `ART_INVENTORY.md` / `ART_PIPELINE.md` / `ART_SKILLS.md` / `STYLE_LOCK.md` 描述的是 **LEGACY 那套**，
> 保留为「为什么当初那样做」的记录。**新工作不要照它们执行**，照 `ART_GUIDE.md`。

---

## 2. 资产清单（`approved/`）

| 类别 | 张数 | 关键尺寸 | 直接可用 |
| --- | --- | --- | --- |
| `Characters/` | 17 | 原图 1024² / 帧 340² 脚底 y=295 / 小鸟 128² | ⚠️ 换主角，见 §3 |
| `Enemies/` | 6 | 原图 1024² / 帧 128² | ✅ |
| `Items/` | 4 | 原图 1024² / `item_star_sprite` 48² | ✅ |
| `Effects/` | 4 | 220–558²（已按 F12 裁紧） | ✅ |
| `Terrain/` | 7 | 摆件 200×165 / 200×323 / 200×103 / 61×52 | 🔴 不是瓦片，见 §3 |
| `UI/` | 3 | 1024² | ✅ |

**总数 41 = 29 张正式资产 + 12 张精灵派生图。**
29 与 `ART_GUIDE` 里写的「29 张入库」是同一个数（G5 当次口径）：9 角色 + 3 敌 + 3 道具 + 4 特效 + 7 地形 + 3 UI。
多出的 12 张是 `_sprite` 后缀的标准化帧（8 角色 + 3 敌 + 1 星），由原图派生、脚底锚点统一，供运行时直接用。

完整来源追溯见 `approved/manifest.json`（每个 key 记录 source → approved 路径 + 门禁备注）。

---

## 3. 接入本项目前必须知道的两件事

**① 主角换了。** 母版主角是「棕发 + 红围巾 + 米白上衣黄星 + 蓝短裤 + 蓝挎包」，
本项目旧 31 帧是「大胡子 + 白 T」。已按「完全复用」以母版为准，旧帧未删可回滚。
**同一游戏不应有两个主角**，建议尽快统一。

**② 地形不是瓦片。** `Terrain/` 是整块摆件（一块石头 = 一张图），本项目是 `TILE=48` 的 tilemap。
直接铺会露缝、断边。要铺 tilemap **必须另做可平铺瓦片**，不能拿摆件凑。

---

## 4. 新增一张资产的标准动作（别再自己发明流程）

**本节只给命令和顺序。判据一律引用 `ART_GUIDE.md` 的条款号，不在这里另立一套门槛。**

```bash
# 1. 选参考：按类别挑 reference/derived/ 里一张（动作类必须单帧，禁多格图 → §10.7 F13）
# 2. 拼 prompt：Master_v1.3.md 全文 + 资产描述 + 对应技术附加段（独立资产 / 多格 → §9.3）
# 3. 生成：一张图一个资产（主角一律独立资产，禁多格）
# 4. 放大复核：关节有没有多余肢体（整体缩略图看不出来 → §7.2）
# 5. 抠图（P1–P11）：
python art/tools/extract_magenta.py raw.png art/approved/<类>/<名>.png
# 6. 三背景检：棋盘格 / 白 / 黑 各看一次边缘，再在 960×540 实机按真实显示尺寸看一次（§12.5）
# 7. 抽样 E01–E04：每批做一次，不是每张做（§10.7 第 7 条）
# 8. 登记：写 approved/manifest.json（source / approved / note）
# 9. 体检：
python art/tools/asset_audit.py
```

判据：**静态大图好看不算过**，必须在 `P_SPRITE_H=128` 的真实显示尺寸下仍然认得出（§12.2）。

### 4.1 门禁只有一套，别重复走

| 门禁 | 本项目怎么用 |
|---|---|
| **G0–G5 / E01–E04** | 来源项目的**历史**门禁，2026-11-26 已全 PASS。**不重跑**——现有 41 张就是它们的产物 |
| **P1–P11**（抠图） | **每张新图都走**，没有例外 |
| **§10.7 批量生产流程** | **每批新资产走这条**（含抽样 E01–E04、入库终检） |

> G5 开放 ≠ 免检。新资产要**抽样** E01–E04，因为风格漂移通常只在批量生产几批后才显形。

---

## 5. 失败样本去哪

不删。`art/tiles/gen/_trials/`（旧提示词六次失败）、`art/hero/_rejected/`（旧主角废稿）都在原地。
理由：半年后要能复查「为什么这句话不能写」。门禁失败的样本标记 `FAIL_` 前缀，不得混入 `approved/`。

---

## 6. 移植验收证据（2026-11-26）

| 图 | 看什么 | 结论 |
| --- | --- | --- |
| [`shots/approved_overview.png`](../shots/approved_overview.png) | 41 张全景（棋盘格底，按六类分组） | 41 张齐全，无空图、无白底、无脏边 |
| [`shots/hero_swap_compare.png`](../shots/hero_swap_compare.png) | 左右同场景同道具，只换主角（960×540 实机比例） | 两主角同高 128；敌人 1 格、星星 1 格、石头高于角色 —— 比例成立 |
| [`shots/hero_readability.png`](../shots/hero_readability.png) | 新主角 128 / 96 / 72 三档显示高 | 128 清楚、96（75%）仍可辨、72 已糊 → **128 是正确档位** |

**洋红残留实测（41 张全检）**：可见像素中接近 `#FF00FF` 的 = **0**；
全透明像素里仍带洋红 RGB 的（P11 关心的「幽灵洋红」，会被缩放插值混进边缘）= **0**。
判据用严格口径 `R>200 && B>200 && G<95` —— 宽口径会把主角粉脸颊误报成洋红，别用。
