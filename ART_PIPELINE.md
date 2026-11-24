# ART_PIPELINE · 素材管线与规格

> 建 2026-11-25。起因：canvas 代码绘制被判定为 programmer art，全部推翻。
> 结论：**美术 100% 走生图；代码只做分层平移、视差、合成、动画、特效，不画任何形状。**

---

## 1. 两个图层，两套渲染语言

| 图层 | 归属 | 描边 | 明暗 | 产出方式 |
|---|---|---|---|---|
| sprite 层（角色/敌人/拾取物） | 前景 | **3px 硬描边**（按 150px 身高） | 三档平涂 | 生图 → 抠品红 → 定尺寸 |
| paint 层（天空/远中景树/地面） | 背景 | **无描边** | 连续微渐变 + 空气透视 | 生图 → 抠品红 → 分层 |

判据：一张图里只有 sprite 层有闭合轮廓线。背景出现轮廓线 = 不合格。

## 2. 角色规范锚点（锁死，唯一真源）

`art/out/hero_idle.png` — 563×1296，真 alpha。

设定：无胡须的年轻旅人 / 宽檐深藏青礼帽 / 深藏青长风衣（下摆开衩外扩）/
青灰围巾垂在身后 / 细直剑尖朝下持于近手 / 厚底靴。
**5 头身**，下摆宽度 ≈ 总高 0.43。

> 后续所有含角色的图，**必须**把这张作为 `image1/image2` 参考输入。
> 不允许让模型自由发挥角色长相——上一轮就是这么变成"蓄胡大叔"的。

尺码表：总高 150px 时 → 宽 65px，帽檐宽约 52px，靴高约 30px。

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

```
STYLE ANCHOR（每个 prompt 必带，一字不改）：
hand-painted 2D game art, vector-clean — confident smooth curves,
no sketchy strokes, no texture noise, no photographic detail, no pixel grid.
Three value steps per material. Cheerful and bright, never moody.

TECHNICAL（抠图用，每个素材图必带）：
flat solid pure magenta #FF00FF background filling every gap,
no cast shadow, no contact shadow, ambient occlusion excluded,
no characters, no text, no watermark, no signature, no frame, no border.

EXCLUDE（固定负面）：
pixel art, 3D render, photorealistic, oil painting texture,
dark gothic mood, night, fog, glow effects, magic aura, UI, HUD.
```

水印处理：图生模型会在右下角打"AI生成/WORKBUDDY"，统一 `crop((0,0,w,h-84))`。
（按 1024/1536 宽的实测值，换尺寸要重新量。）

## 5. 硬约束：生图做不出连续动画帧

这是必须提前认下的：

- 同一个 prompt 连生 8 次，角色的帽子角度、大衣褶皱、剑的长度都会漂
- 直接当 sprite sheet 用 → 播放起来"抖动"，比不做动画更难看

**解法（选这条）**：**分件 + 程序骨骼**。

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

1. `asset_report.py --require-alpha` 必须 exit 0（真 alpha，不是假透明）
2. 150px 尺度下截屏，能一眼指出主角位置
3. 灰度检查：主角区域平均亮度是全画面最低 15%
4. 背景层不得出现闭合轮廓线
5. 同一屏内 sprite 层描边宽度只有一档
