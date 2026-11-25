# ART_PIPELINE · 素材管线与规格

> 建 2026-11-25。起因：canvas 代码绘制被判定为 programmer art，全部推翻。
> 结论：**美术 100% 走生图；代码只做分层平移、视差、合成、动画、特效，不画任何形状。**
>
> **2026-11-26 补注**：瓦片曾是全项目唯一不走生图的资产（p5.brush 程序渲染），
> 现按本行纲领归队，产线见 §4.5、规格见 `STYLE_LOCK.md §L11`。
> 也就是说：**现在这份纲领没有例外。** 如果以后又要给某个资产开例外，先在这行登记理由。

---

## 1. 两个图层，两套渲染语言

| 图层 | 归属 | 描边 | 明暗 | 产出方式 |
|---|---|---|---|---|
| sprite 层（角色/敌人/拾取物） | 前景 | **2px 硬描边**（按 100px 身高，即 200px 出图时的 4px） | 三档平涂 | 生图 → 抠品红 → 定尺寸 |
| paint 层（天空/远中景树/地面） | 背景 | **无描边** | 连续微渐变 + 空气透视 | 生图 → 抠品红 → 分层 |

判据：一张图里只有 sprite 层有闭合轮廓线。背景出现轮廓线 = 不合格。

## 2. 角色规范锚点（锁死，唯一真源）

**锚点 = `art/out/card_painted.png`** — 621×1413，真 alpha，正面站姿。

它是"手绘化的角色卡"，不是"游戏的英雄设计"。两者区别是整个项目的地基：

| | 角色卡（本项目的真源） | 英雄设计（我编错的那条线） |
|---|---|---|
| 从哪来 | 真人照片 → 像素卡 → 手绘化 | 凭空画 |
| 一个项目几张 | **一个玩家一张** | 全世界只有一张 |
| 能否替换 | 必须能，随时换 | 不能 |
| 长相谁定 | 玩家 | 画师 |

> 🔴 因此素材管线是**参数化的**，不是"画一个固定英雄"。
> 管线输入 = 任意一张角色卡；输出 = 该卡的可玩 sprite 组。
> 不存在"主角立绘"这种一次性产物，只存在"某人这张卡的一套动作"。

### 2.1 已锁定的那一张（样本卡）

`card_painted.png` 是**当前唯一可用的样本卡**（来自 `men_32_split_v2.png` 的真实照片还原）：
短卷发 + 额前一撮 / 络腮胡 / 白短袖 T 恤 / 棕短裤 / 棕鞋 / 正面站姿 / 双臂垂于体侧 / **无武器**。

- 总高比例：素材 w/h = **0.44**（含双臂展开宽度，不是躯干宽）
- 出图规格：**200px 高（2x）**，运行时按 100px 布局（见 CANON §5）
- 关键识别特征（100px 下必须还能认出的）：发型轮廓与额前那撮、胡须形状、白 T 恤 + 棕短裤的色块关系

### 2.2 关键发现：角色卡 ≠ 游戏角色（中间缺一道工序）

实测两张图对比，问题很清楚：

| 素材 | 头身比 | 视角 | 脚 | 能不能动 |
|---|---|---|---|---|
| `card_pixel.png`（像素卡） | ≈ **2.5 头身**，头占 40% | 正面 | 有 | 不能 |
| `card_painted.png`（手绘化后） | ≈ **2.3 头身**，头占 60%，**脚被裁掉** | 正面 | 残 | 不能 |

**角色卡是展示用的**：大头、正面、像本人 —— 它的用途是"炫耀我还剩多少"，
不是"在横版里跑跳"。把它直接当游戏角色，头会大到没有躯干可动。

所以管线必须多一道 **体型重设（re-proportion）**，我之前整段跳过了：

```
照片
 → 像素卡          （身份提取：发型/胡须/服装/配色，比例=大头展示）
 → 体型重设 + 侧视  （★ 缺失的那道：改成 5 头身、全身、侧向、脚完整）
 → 手绘化           （渲染语言统一：厚描边 + 三档平涂）
 → 分件骨骼动画     （见 §4）
```

**身份 vs 体型，必须分开对待**：

| 保留（身份，不许变） | 重设（体型，必须变） |
|---|---|
| 发型轮廓 + 额前那撮 | 头身比 2.5 → **5** |
| 胡须形状与浓密 | 头占身高比例 40% → **20%** |
| 白 T 恤 / 棕短裤 / 棕鞋 | 正面 → **严格侧视 profile** |
| 肤色、发色 | 裁到脚的画面 → **全身含脚，留边距** |

> 🔴 判据：一张素材如果**脚不完整**或者**头超过身高 1/3**，它就是角色卡而不是游戏角色，不能进游戏。

### 2.3 已锁定的样本卡与出图规格

样本卡来源：`art/out/card_pixel.png`（由 `verify/svg-lab/pipeline/assets/men_32_split_v2.png` 的真实照片还原）。

出图规格：**200px 高（2x）** → 运行时 100px 布局（代码 `P_H = 100`、`P_W = 28`，宽高比 0.28）。
5 头身侧视的躯干宽度天然比正面窄，与 0.28 吻合；**正面大头卡宽高比 0.44–0.53，对不上**。

> 上一轮的教训：不做参考输入，模型就会自作主张换人（"蓄胡大叔"事件）。
> **任何含角色的图，都必须把 `card_pixel.png` 挂上去做身份参考。**

## 3. 分层规格（游戏内 1280×720）

| 层 | 素材 | 游戏内尺寸 | 备注 |
|---|---|---|---|
| 天空 | 代码渐变（3 段） | 1280×720 | 唯一允许代码画的层，纯色渐变不丢人 |
| 远景 | 生图横带（低饱和+模糊） | 高 ≈340，宽 ≥1600 | 视差 0.25 |
| 中景树 | 生图横带 | 高 ≈420，宽 ≥1700 | 视差 0.55 |
| 地面 | 生图横带 | 高 ≈220，宽 ≥1600 | 视差 1.0，可站立面 y=566 |
| 角色 | sprite | 高 150 | 视差 1.0 |

**尺度基准**：树干宽 50–60px、树冠半径 110–140px。不是这个数就重生成，
不要靠缩放去凑（缩放会连带改变描边粗细，两棵树的线宽就不一致了）。

## 4. 生成配方（逐字复用，只改槽位）

> ⚠ **本节已按 `STYLE_LOCK.md`（P6 蜡笔）改写。** 原 STYLE ANCHOR 那段
> `vector-clean, confident smooth curves, no texture noise` 与 L4「没有直线、涂不满、
> 颗粒是特征」**直接冲突**，留着会让每张图都往"数码蜡笔滤镜"漂 —— 已删除，不再使用。

```
STYLE ANCHOR（每个 prompt 必带，一字不改）：
real wax crayon on warm cream paper, waxy and slightly broken colour,
irregular hand-drawn contour ~3px, wobbly lines, no smooth vector curves,
the paper showing through at the edges of every stroke.
Flat 2D graphic art only. Palette strictly the 12-crayon box in STYLE_LOCK §L5:
cream #E8DCBE, wax white #FBF7EC, charcoal #2B2320, cool grey #8C8B84,
deep blue #1F2E5C, slate blue #4C6E8C, blood red #9B2226, ochre #B98A2E,
umber #6B4B32, skin #D9A16B, moss #4F6B3A, violet black #3B2340.

TECHNICAL（抠图用，每个素材图必带）：
flat solid PURE SATURATED MAGENTA RGB 255,0,255 — bright neon magenta, edge to edge.
NOT mauve, NOT dusty rose, NOT pink, NOT maroon, NOT muted. No paper in the background.
For frame strips: EXACTLY {N-1} vertical bars of pure saturated green RGB 0,255,0,
~14px wide, perfectly straight, running the FULL height top to bottom,
dividing the row into {N} equal columns. Bars must not be interrupted.
No green and no magenta anywhere inside the figures.
no cast shadow, no contact shadow, ambient occlusion excluded,
no text, no watermark, no signature, no frame, no border.

EXCLUDE（固定负面）：
photograph, photo of paper, paper texture, cream background, white background,
3D render, perspective, vanishing point, drop shadow, soft shadow, gradient, airbrush,
pixel art, dithering, clean vector linework, front view, three-quarter view,
dark gothic mood, fog, glow effects, magic aura, UI, HUD.
```

**为什么底色和分割线这么死板**：`STYLE_LOCK.md` §L3.5 有完整推导（白 T 与纸底的
G 通道只差 27，洋红底差 247）。这一步选错，后面要补泛洪抠纸、去纸色、能量切刀口
三个补丁，而且每个补丁都会带来新的缺陷 —— 已经踩过一整轮。

水印处理：图生模型会在右下角打"AI生成/WORKBUDDY"。
洋红底上可直接用 `process_spritesheet.patch_watermark()`（把浅色低饱和像素涂回背景色），
**不要用 `crop` 硬裁底部** —— 会切到靴子。旧文档写的 `crop((0,0,w,h-84))` 作废。

## 4.5 瓦片生图配方（2026-11-26 起，唯一产线）

> 瓦片曾走 p5.brush 程序渲染，是**全项目唯一不走生图的资产**。已退回生图，
> 退场结论见 `STYLE_LOCK.md §L11.4`。规格定版同样在 §L11。

### 4.5.1 一句话原则

**模型只画"一块块散开的石头"，排布和尺寸全部由代码做。**

模型擅长笔触、不擅长几何。让它画一面 4×3 的墙，缝宽不齐、砖大小不一、边界切砖，
平铺后是歪的（v3e~v7 连错五版就是这么错的）。让它画一片散石，再让脚本切，
两个短板都规避掉了。

### 4.5.2 提示词（逐字复用，只改块数和比例）

```
A tile source sheet for a hand-drawn 2D side-scroller game.

Exactly TWELVE separate stone blocks, arranged in a loose grid of 4 columns and
3 rows, floating on a flat solid PURE SATURATED MAGENTA background RGB 255,0,255,
bright neon magenta, edge to edge.

Each stone is a BLOCKY, NEARLY RECTANGULAR masonry block — a cut ashlar stone,
not a pebble. Its four edges are almost straight with only small hand-drawn
wobbles and a few chipped corners. It must NOT be round, NOT oval, NOT a boulder,
NOT a cobblestone. Width to height ratio about 1.35, so slightly wider than tall.

Each stone is outlined with a wobbly dark charcoal #2B2320 contour about 3px
thick. It is filled with flat wax crayon colour: mainly warm umber #6B4B32 and
cool grey #8C8B84 in large calm patches, a few short strokes of ochre #B98A2E as
highlights, and a slightly darker band along the bottom edge to sit it down.
STRICTLY NO green, NO moss colour, NO yellow-green, NO olive. The palette is
warm brown-grey stone, not diseased or mossy.

The twelve stones differ from one another in outline shape and in where the
crayon shading sits, but all are clearly drawn by the same hand with the same
twelve-crayon box.

CRITICAL COMPOSITION: every stone must be completely separated from every other
stone by at least 24 pixels of clean empty magenta. No stone may touch another
stone. No stone may touch the edge of the image.

Flat 2D graphic art, orthographic front view, no perspective, no vanishing point,
real wax crayon on paper feel, wobbly hand-drawn lines, no smooth vector curves.

EXCLUDE: cast shadow, contact shadow, ambient occlusion, gradient, glow, airbrush,
3D render, photograph, paper background, cream background, white background,
green, text, numbers, watermark, signature, border, frame, grid lines, arrows,
labels.
```

**参数**：`1024×1024`、`quality high`、`background opaque`。

### 4.5.3 实测修订记录（两次出图，别重复踩）

| 版 | 提示词差异 | 结果 | 判据 |
|---|---|---|---|
| 1 | "irregular rounded polygon like a hand-cut fieldstone"，色板含 moss | **像鹅卵石**。石头偏圆，四角空隙大；黄绿色占主导，平铺是"长苔的碎石地" | 外观 1.09:1、平铺后横向缝是纵向的 3 倍 |
| 2 | 改 "BLOCKY / NEARLY RECTANGULAR / NOT round / NOT pebble"；颜色改 umber+灰主导，加 **STRICTLY NO green** | **成**。块状、褐灰、缝均匀，平铺读作砌石墙 | 见 `shots/gen_tile_tilingB.png` |

两条硬经验：

1. **"rounded" 一个字就能毁掉整批**。要砌石，必须写明 `nearly rectangular`、
   并逐条否定 `NOT round / NOT oval / NOT boulder / NOT cobblestone`。
2. **负面约束要写"STRICTLY NO"，不能只写"no"**。第 1 版写了 no moss 也没用，
   因为同时在正向描述里给了 moss 色 —— **正向色板和负面清单必须一致**。

### 4.5.4 画布比例：跟素材走，不跟"想要的尺寸"走

切片脚本 `art/tools/tile_from_gen.py` 保持长宽比缩放（不拉伸），所以画布比例
必须匹配素材比例，否则会空出一大片：

```
石头实测 176×162  →  比例 1.086
margin 2px        →  inner_w = tw - 4,  inner_h = th - 2
要求刚好填满      →  tw - 4 = 1.086 × (th - 2)
th = 48           →  tw = 54
```

**不用 64 的原因**：64×48 是 4:3，装 1.086 的石头，横向会空 14px
（每边 7px）。平铺后横向缝 14px、纵向缝 4px，整面墙是一道道竖白条。
`shots/gen_tile_tiling.png`（错误版）与 `gen_tile_tilingB.png`（正确版）可直接对比。

### 4.5.5 命令

```bash
# 1. 出图（1024×1024，洋红底，16 块散石）
# 2. 切片 + 平铺预览（平铺预览是唯一硬判据，不是看单块）
python art/tools/tile_from_gen.py art/tiles/gen/<源图>.png art/tiles/gen/wall --tw 54 --th 48 \
       --preview shots/gen_tile_tilingB.png

# 3. 从中挑差异最大的 6 块 → art/tiles/wall_0..5.png（贪心最大最小距离，不要随手取前 6 张）
# 4. 重建内嵌 + 回归
python build.py && node test.js
```

### 4.5.6 验收（四条，缺一条就是不能用）

| # | 判据 | 怎么看 |
|---|---|---|
| 1 | 平铺后横纵缝宽一致 | `--preview` 出图，眼量。不一致 = 画布比例错 |
| 2 | 单块读作"砖"，不是"鹅卵石" | 石头四边接近直线、只轻微起伏 |
| 3 | 6 块之间肉眼可分 | 用贪心最大最小距离选，不取前 6 张（生图 16 块外表极像） |
| 4 | 游戏内 9×8 还认得出 | 按 9×8 缩一次再放大 4× 看，别在高分辨率下判断 |

> 已知缺陷（可接受，待改进）：每块砖的左侧和下缘会留一圈浅色边（生图的纸色描边
> 缩小后变成亮边），平铺有轻微规律感。要压掉得在切片时做边缘暗化，或出更多 seed。

---

## 5. 硬约束：生图做不出连续动画帧

这是必须提前认下的：

- 同一个 prompt 连生 8 次，角色的帽子角度、大衣褶皱、剑的长度都会漂
- 直接当 sprite sheet 用 → 播放起来"抖动"，比不做动画更难看

> **2026-11-25 修正（实测）**：一行 N 帧 + 洋红底 + 绿分割线这条路**能走通**，
> walk 4 帧、attack 4 帧都已成表（`MOVESET.md` §7）。前提是三个条件同时满足：
> ① 分割线钉死刀口（切点不再靠猜）② 全帧共用一个缩放系数（否则抬腿帧被压小）
> ③ 姿态差异被 prompt 逼到极端（帧间差 <6px 时动起来像原地抖）。
> **所以下面的"分件 + 程序骨骼"不是唯一解，而是最终形态**：
> 逐帧 strip 用于 S 档（128px）的 10 个动作状态；分件用于要做 squash/stretch、
> 要换装、要让衣摆延迟摆动的场合。两条路不冲突，先出 strip 让手感跑起来。

**解法（最终形态）**：**分件 + 程序骨骼**。

| 件 | 用途 |
|---|---|
| 头+帽（整体一件） | 随躯干轻微摆动 |
| 躯干+大衣主体 | 核心，做 squash/stretch |
| 大衣下摆（单独一件） | 延迟摆动，跑动时飘起 |
| 前臂+剑 | 攻击时旋转 |
| 腿（可只做一条，镜像） | 跑步循环 |

每件单独生图、单独抠图，代码里按关节拼。好处：
① 一致性 100%（永远是同几张图）② 能随时调幅度 ③ 成本只有 5 张而不是 40 帧。

代价：透视变化有限，做不出大幅转身——但横版动作游戏用不上。

## 6. 成本台账

单张 5–10 credits。已消耗 6 张（1 张方向图废弃，5 张有效）。

扩批预算（建议）：
- 分件 5 张
- 敌人 2 种 × 1 张
- 背景 3 层 + 地面 1 层
- 拾取物/道具 3 张
合计 ≈ 16 张 ≈ 80–160 credits。

## 7. 验收

1. `python art/tools/asset_audit.py` 输出 **P0 = 0**（尺寸 / 真 alpha / 有无消费点）。
   旧版这里写的是 `asset_report.py --require-alpha`，该脚本**从未存在过**，
   2026-11-26 由 `asset_audit.py` 取代 —— 见 `ART_SKILLS.md §12`。
2. 100px 真实尺度下截屏，能一眼指出主角位置
3. 灰度检查：主角区域平均亮度是全画面最低 15%
4. 背景层不得出现闭合轮廓线
5. 同一屏内 sprite 层描边宽度只有一档
