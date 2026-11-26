# ART_PIPELINE · 素材管线与规格

> 🔴 **2026-11-26 起本文降级为 LEGACY**：美术规范统一到 [`art/ART_GUIDE.md`](art/ART_GUIDE.md)（v1.3，G1–G5 全过），
> 提示词统一到 [`art/prompts/Master_v1.3.md`](art/prompts/Master_v1.3.md)，抠图统一到 [`art/tools/extract_magenta.py`](art/tools/extract_magenta.py)（P1–P11）。
> 本文的配方（瓦片生图、画布算式、pick_tiles）保留为历史记录；**新资产按 `art/README.md` §4 的九步走**。

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

## 4. 生成配方（锚点由代码提供，本节只写"每类资产改哪个槽位"）

> ⚠ **本节原来的手写 STYLE ANCHOR 已作废**（2026-11-26）。理由不只是"和 L4 冲突"，
> 更实质的是：**手写的锚点在每处会漂**。同一句话在三个脚本里各写一遍，三个月后必然出现
> 三个版本，而且没人知道哪个是权威。
>
> 现在锚点是代码：`art/prompts/style_anchor.py`。七层结构、每个槽位的正文、六条实测结论
> 都在 `STYLE_LOCK.md §L0.5`。本节只负责回答一个问题：**出某一类资产时，选哪一组槽位。**

| 出什么 | profile | 命令 |
|---|---|---|
| 角色 / 敌人帧表 | `sheet` | `python art/prompts/sprite_prompt.py walk --json` |
| 瓦片素材板 | `tile` | 见 §4.5.5 |
| 道具 / UI 元素 | `prop` | `compose(SUBJECT, **PROFILE["prop"])` |
| 背景板 | `bg` | `art/prompts/bg_prompt.md`（骨架 + 三处反向差异） |
| 风格参考图 | `ref` | `compose(SUBJECT, **PROFILE["ref"])` |

```python
import sys; sys.path.insert(0, 'art/prompts')
from style_anchor import compose, PROFILE
prompt = compose(SUBJECT, **PROFILE["tile"])      # 七层 + 底色自动拼好
```

### 4.1 帧表专属：洋红底 + 绿分割线

锚点里的 `bed="magenta"` 只负责"背景是纯洋红、不许有纸"。
**帧表还需要分割线**，这一段不在锚点里（它只对多格帧表有意义），由
`sprite_prompt.py` 自己写进 subject 段：

```
SEPARATORS: exactly {N-1} vertical bars of pure saturated green #00FF00,
each about 14px wide, perfectly straight, running the FULL height of the image
from the very top edge to the very bottom edge, dividing the row into {N} equal columns;
the bars must not be interrupted. No green and no magenta anywhere inside the figures.
```

**为什么底色和分割线这么死板**：`STYLE_LOCK.md` §L3.5 有完整推导（白 T 与纸底的
G 通道只差 27，洋红底差 247）。这一步选错，后面要补泛洪抠纸、去纸色、能量切刀口
三个补丁，而且每个补丁都会带来新的缺陷 —— 已经踩过一整轮。

### 4.2 每类资产还要自己补的负面项

L5 是**风格级**否定（3D / 水彩 / 厚涂 / 描边干净）。**物体级**的否定必须由 subject 段自己给，
而且只给"这一张不该出现的东西"：

| 资产 | subject 里必须有的额外负面 | 为什么 |
|---|---|---|
| 角色 attack / dash | `weapon, sword` | 空手设定，模型爱给刀 |
| 角色 cast | `magic glow, aura, sparkles, orb, staff` | 一加光效就变魔法游戏 |
| 角色 hurt | `blood, wound, gore` | 这个项目的残酷来自反差，不来自血 |
| 角色帧表 | `front view, three-quarter view` | 必须侧视，正面帧在游戏里是躺着的 |
| 瓦片 | `green, moss, olive, yellow-green` | 赭石与苔绿相邻，不排会读成发霉的石头 |

> ⚠ 这些负面**不能**搬进 L5。L5 一长就会把 subject 淹掉（`STYLE_LOCK §L0.5.4` 第 4 条），
> 而且"瓦片不要绿"这种约束对角色帧表毫无意义，写进全局只会稀释真正重要的那几条。

### 4.3 水印

图生模型会在右下角打"AI生成/WORKBUDDY"。
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

### 4.5.2 提示词（subject 段逐字复用，锚点自动拼）

**先说一句最关键的：这段 subject 里不许出现 `block` / `brick` / `masonry`。**
这三个词自带 3D 语义先验，实测连出三版全是立体砖块（`shots/prompt_trials.png` T1–T3）。
换成 `flat-faced stones` + "建筑立面图"这个类比之后，第一次出平面形状（T4）。
这条规则是 2026-11-26 六次出图里唯一稳定复现的结论。

```
TWELVE separate flat-faced stones on an empty sheet, laid out in four columns and
three rows.

PROPORTION, every stone the same: four units wide for every three units high (4 by 3), so
each one is a landscape rectangle, wider than it is tall. Not a portrait rectangle, not
taller than wide.

What you see is a DRAWING of a stone and not the stone itself: four near-straight edges with
small soft hand-drawn wobbles, a couple of tiny nicks taken out of the corners, and flat
crayon colour between them. Picture the way a wall is drawn in an architect's elevation
drawing, or the way a child draws a paved path seen from straight ahead: just the outline
and the flat colour inside it, with nothing to suggest depth. Edges stay calm and close to
straight, with no star points, no spikes, no petals, no flower shapes. A nick shows the
magenta background through, never another colour.

Colour the interior mainly with warm umber #6B4B32 in large calm patches, cool grey #8C8B84
as the second tone, and a few short strokes of ochre #B98A2E. Each stone reads as a mid-tone
warm brown-grey, clearly darker than the magenta around it.

The twelve differ in the shape of their outline and in where the crayon shading sits, but
all are drawn by the same hand.

CRITICAL COMPOSITION: every stone is separated from every other by at least 40 pixels of
clean empty magenta, and none touches the edge of the image. The sheet holds the twelve
stones and nothing else.
```

用法：

```bash
python art/prompts/style_anchor.py --show tile     # 看锚点全长
```

```python
import sys; sys.path.insert(0, 'art/prompts')
from style_anchor import compose, PROFILE
prompt = compose(SUBJECT, tail="Count: exactly twelve stones, four columns by three rows.",
                 **PROFILE["tile"])
```

**`tail` 是干什么的**：把可数的硬指标在末尾再说一遍。4000 字符的 prompt 里，开头那句
`TWELVE` 会被稀释。但要说实话 —— 加了 tail 之后块数仍然不稳（9/12/13/16 都出过），
所以产线不依赖它：切片按连通域走，出几块用几块。

**参数**：`1024×1024`、`quality high`、`background opaque`。

### 4.5.3 实测修订记录（六次出图，按顺序，别重复踩）

| 版 | 改了什么 | 结果 | 结论 |
|---|---|---|---|
| 旧-1 | `irregular rounded polygon like a hand-cut fieldstone`，色板含 moss | 像鹅卵石，黄绿占主导 | 圆度一个词毁整批 |
| 旧-2 | `BLOCKY / NEARLY RECTANGULAR / NOT round`，`STRICTLY NO green` | 成了，但见下条 | 当时以为措辞有效 |
| T1 | 锚点初版 + 12 色板 + 6 个几何否定 | 13 块，**全部 3D 方块**，红蓝绿石头 | 否定清单加重 3D；色板被当清单 |
| T2 | 改正向"剪纸剪影" + tail 复述数量 | 13 块，**仍全 3D** | 只改语气不够 |
| T3 | 锚点压到 2117 + **旧-2 的 subject 逐字照抄** | 9 块，**仍全 3D** | **旧-2 的成功是采样运气，不是措辞** |
| **T4** | **拿掉 block / brick / masonry** | **平面了**，但画出 4 根实体蜡笔 | 3D 先验来自这几个词 |
| T5 | 改掉 `twelve crayons`，禁锯齿 | 12 块、平面、干净，但**竖比例 0.68:1** | `1.35 to 1` 有方向歧义 |
| T6 | 明示 `four units wide per three high` | 16 块、平面、横比例正确，**洋红偏暗** | 比例可解；底色不稳 |

证据图：`shots/prompt_trials.png`。失败样本：`art/tiles/gen/_trials/t1..t6`。

**六次里只有 T4 之后的三次是平的。** 差别只有一个变量：物体名里有没有
`block` / `brick` / `masonry`。这是本轮唯一敢写成"定版规则"的结论。

**还不稳的三件事**（写在 `STYLE_LOCK §L0.5.8`）：块数、洋红纯净度、赭石读成橄榄绿。

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

**新配方动摇了这个前提，必须标出来。**
2026-11-26 起 subject 里写的是 `four units wide per three units high`，即 **4:3**。
若这个比例能连续复现，画布就该从 54×48 改成 **64×48**（正好 4:3，不空边）。

**但现在不改**，理由是证据不足：4:3 只出过 1 张（T6），而且那张洋红偏暗、不能切片。
现存 `art/tiles/wall_0..5.png` 是 54×48，和 `game.js` 的 `WALL_SRC_W = 54` 绑死。

改的顺序只能是：

```
4:3 素材连续两次切片合格
  → tile_from_gen.py --tw 64 --th 48
  → 同步 game.js 的 WALL_SRC_W（游戏内从 9×8 变 10.7×8，砖变大，平铺密度要重看）
  → build.py → node test.js → 实机截图
```

**先验证出图，再动画布。** 反过来做会出现"图还是旧比例、代码已按新比例算"的错位，
而在 9×8 这个尺度下，这种错位肉眼几乎看不出来。

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
