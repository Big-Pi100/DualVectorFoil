# p5.brush 能力评估（2026-11-25 实测）

> 上游：[acamposuribe/p5.brush](https://github.com/acamposuribe/p5.brush)（MIT，1.4k★）
> 本地：`.deps/p5.brush`（29MB，已 gitignore，只用于查源码与出图）
> 结论先说：**它是笔刷引擎，能画瓦片、也能画贴片。**
> 边界只有两条：元素最小可画尺寸 ≈120px、只做"有方向"的东西。
> 判据与背景需求清单见 `BG_SCOPE.md`；分工见 §5。

## 0. 它是什么

一个给绘画用的**笔刷引擎**：不是"生成图片"，是把「笔刷 + 路径」渲染成像素。
一支笔 = 一张带颗粒的笔尖纹理，沿路径按 `spacing` 盖章，`scatter` 让它横向散开，
`pressure` 让起收笔变细。粉笔/炭笔/蜡笔的区别只是那张纹理和这几个数的组合。

两个构建，**不能混用**：

| | p5 build | standalone build |
|---|---|---|
| 文件 | `dist/p5.brush.js`（111KB） | `dist/brush.js`（123KB） |
| 依赖 | p5.js 2.x + WEBGL 画布 | **无依赖**，只要浏览器 WebGL2 |
| 画布 | `createCanvas(w, h, WEBGL)` | `brush.createCanvas(w, h)` |
| 坐标 | p5 的 `translate()` | `brush.translate()` |
| 种子 | `randomSeed()` / `noiseSeed()` | `brush.seed()` / `brush.noiseSeed()` |
| 落帧 | 自动 | **必须 `brush.render()`**，否则画布全空 |

我们用 **standalone**：headless chromium 实测 WebGL2 可跑，`seed()+noiseSeed()` 两重置后
两次渲染字节完全一致（**只调 `seed()` 不行，噪声不清** —— 这条只看文档想不到）。

## 1. UI：三处，都能用

| 界面 | 路径 | 作用 |
|---|---|---|
| **Brush Maker** | `tools/brush-maker.html` | 滑块调笔刷，实时预览，右侧**自动生成 `brush.add()` 代码**可直接复制 |
| **Flow Field Generator** | `tools/flowfield-maker.html` | 调矢量场（angle min/max、noise scale），生成 `brush.addField()` 代码 |
| 工具索引 | `tools/index.html` | 上面两个的入口 |
| 在线版 | `https://acamposuribe.github.io/p5.brush/tools/brush-maker.html` | 同上，免本地起服务 |
| 在线可编辑示例 | `https://editor.p5js.org/acamposuribe/sketches/bkb_CyJyi` | 逐场演示 6 个特性 |

**Brush Maker 的滑块**（`shots/ui_brushmaker.png`）：

- `identity`：name / type（`default` / `spray` / `marker` / `custom` / `image`）
- `geometry`：**weight** 笔宽、**scatter** 横向散开、**sharpness** 边缘软硬、**grain** 颗粒密度
- `appearance`：**opacity**、**spacing** 盖章间距（1 = 不重叠）、**noise** 逐笔浓淡随机
- `pressure`：start / end（或三点 start/mid/end）

> 本地打开方式：`cd .deps/p5.brush && python -m http.server 8000`，然后开
> `http://127.0.0.1:8000/tools/brush-maker.html`。
> 我截的图里**中间预览区是黑的** —— headless 下预览画布没拿到尺寸，
> 不是坏了；参数面板和右侧代码生成都是活的。

## 2. 命令集

### 2.1 画布与生命周期（standalone）

```js
brush.createCanvas(W, H, { parent?, pixelDensity? })
brush.clear(color?)        // 清成某个底色（不是 background()）
brush.render()             // ‼ 落帧，忘了就全白
brush.load(canvas)         // 切到离屏画布；再调一次切回来
```

### 2.2 笔刷状态

```js
brush.set(name, color, weight)   // 一次设三个，最常用
brush.pick(name)                 // 只换笔，颜色/笔宽不动
brush.stroke(color)              // 只换颜色（同时启用描边）
brush.strokeWeight(w)            // 只换笔宽
brush.noStroke()                 // 关描边（涂面之前必须调）
brush.box()                      // 列出所有可用笔刷名
brush.scaleBrushes(s)            // 全局缩放所有笔刷
```

`weight` 是**倍数**，实际像素 = 笔刷基础 width × weight × scaleBrushes。
这是它最反直觉的一处：`set('HB', c, 1.2)` 在 192px 画布和 768px 画布上粗细差 4 倍。

### 2.3 线

```js
brush.line(x1, y1, x2, y2)
brush.flowLine(x, y, length, dir)      // 沿矢量场走，dir 跟 angleMode
brush.spline([[x,y,p], ...], curv?)    // 逐点压力，返回 Plot 可复用
brush.beginStroke('curve'|'segments', x, y)   // 手动分笔
brush.move(angle, length, pressure)
brush.endStroke(angle, pressure)
```

### 2.4 形状

```js
brush.rect(x, y, w, h, 'corner'|'center')
brush.circle(x, y, r, irregularity)    // irregularity 0~1 = 手绘歪斜
brush.arc(x, y, r, start, end)         // ‼ 只能描边，不能填
brush.polygon([[x,y], ...])            // 返回 Polygon，可后补 hatch/mass
brush.beginShape(curvature?) / brush.vertex(x,y,p?) / brush.endShape(close?)
```

### 2.5 涂面：三种，必须分清

| 方法 | 是什么 | 适合 |
|---|---|---|
| `fill(color, 0-255)` | **水彩**：Hobbs 生长形状，有边界沉积、颗粒沉淀、湿接湿 | 背景层次、天空、远处雾 |
| `mass(name, color, opt)` | **干性手绘填充**：用指定笔刷来回涂满 | 蜡笔/粉笔色块（我们的主力） |
| `hatch(dist, angle, opt)` | **排线**：一组平行线，可叠两组做交叉 | 阴影、明暗、纹理叠加 |

```js
// 水彩
brush.fill(color, opacity)
brush.fillBleed(strength, 'out'|'in', angle?, softness?)   // 边缘渗开
brush.fillTexture(textureStrength, borderIntensity, scatter?, split?)
brush.noFill()

// 干性填充（蜡笔的正确用法）
brush.mass('crayon', color, { precision, strength, gradient, outline })
brush.noMass()

// 排线
brush.hatch(dist, angle, { rand, continuous, gradient })
brush.hatchStyle(name, color, weight)
brush.noHatch()

// 批量（把已存的几何体当一次手势）
brush.hatchArray(polygons, { rule: 'evenodd'|'nonzero' })
brush.massArray(polygons, { rule })
```

> `mass` 的 4 个参数**实测语义**（文档没写清，这是从渲染结果反推的）：
> - `strength` = 排线密度。0.5 是**稀疏几道**（不是"淡"），1.0 才涂满
> - `precision` = 笔触贴合形状边界的程度。高 → 边缘齐；低 → 溢出
> - `gradient` = 沿某个方向的浓淡渐变
> - `outline` = 是否在形状外圈补一道轮廓

### 2.6 矢量场

```js
brush.field(name)          // 内置：hand / curved / zigzag / waves / seabed / spiral / columns
brush.wiggle(intensity)    // = field('hand', intensity)，手抖
brush.noField()
brush.refreshField(t)      // 动画时每帧推进
brush.listFields()
brush.addField(name, (t, grid) => { ... })   // 自定义，返回角度网格
```

### 2.7 变换与裁剪

```js
brush.push() / brush.pop()
brush.translate(x, y) / brush.rotate(a) / brush.scale(x, y?)
brush.angleMode(brush.DEGREES | brush.RADIANS)
brush.clip([x1, y1, x2, y2]) / brush.noClip()
```

> **WebGL 原点在画布中心**，第一句永远要 `brush.translate(-W/2, -H/2)`。

### 2.8 自定义笔刷

```js
brush.add('name', {
  type: 'default'|'spray'|'marker'|'custom'|'image',
  weight, scatter, sharpness, grain, opacity, spacing,
  pressure: [s, e] | [s, m, e] | (t) => v,
  tip: (_m) => { ... },        // type:'custom'，在 100×100 空间里画，原点居中
  image: { src: './tip.png' }, // type:'image'，要 await
  rotate: 'none'|'natural'|'random',
  markerTip: true|false,
  noise: 0..1,
})
```

### 2.9 十一个内置笔刷的实测手感

| 笔 | 特征 | 我们能用来做 |
|---|---|---|
| `pen` / `rotring` | 极细、硬、几乎无颗粒 | 极细结构线、刻字、标注 |
| `2H` / `HB` / `2B` | 铅笔三档（浅→深） | **结构线**（砖缝、门框），连续不断 |
| `cpencil` | 彩色铅笔，柔 | 远景线条、草稿感 |
| `charcoal` | 炭笔，颗粒粗、对比强 | 深色区、阴影、砸实的暗部 |
| `crayon` | **蜡笔**，颗粒中等、边缘碎、有纸白 | 我们的主笔 |
| `pastel` | 粉笔，最软最散、覆盖力强 | 大面积厚色、背景、光晕 |
| `marker` | 马克笔，平头、边缘硬 | 平涂色块、UI 色带 |
| `spray` | 喷枪，纯散点 | 尘、雾、火星（不能画实体） |

## 3. 实测：能做到什么（`shots/p5brush_cap.png`）

这张样张只用我们 12 色板，画了：11 种笔的同一条线（直线+折线+重笔+小圆）、
6 种涂面（水彩 / mass × 两档 strength / pastel / outline / 交叉排线）、
6 个矢量场、`circle` 三档不规则度、`spline` 逐点压力、`clip` 遮罩、三遍叠涂。

**能做好的**：

1. **单笔质量高**：芯实、边碎、外面飞屑 —— 和生图的蜡笔样本表对得上。
   我 Python 版调了七八轮才勉强接近，它开箱就是这样。
2. **`mass` 的涂面有"一笔一笔"的方向感**，边缘毛糙、留纸白。这是它最强的一项。
3. **`spline` 逐点压力**：一笔之内线宽自己变化，Python 版没有这个能力。
4. **矢量场**：草、发丝、烟、雨这类"要顺着某个方向乱"的东西，靠 `field` 一行搞定。
5. **`clip` 遮罩**：排线可以只在框里出现，做 UI 和阴影很有用。
6. **速度**：1240×860 全画完 1.2 秒；192×192 瓦片 90–450ms。

**做不好的**：

1. **`spray` / `pastel` 在细线上完全读不出**（谱系图最后几行糊成一片）。
2. **叠涂三遍会糊成实心黑块**（底部右侧那块），越叠越丢笔触 —— 和真蜡笔"越叠越深但仍有颗粒"不同。
3. **`clip` 只对 stroke 生效**，hatch 会跑出来（图里方框内只有我画的横线，斜排线没进来）。

## 4. 做不到什么 —— 三条，但都被误读过

> **本节 2026-11-25 修订。** 初版写的是"没有 wrap / 笔触尺度绑画布 / strength 不是浓度"，
> 其中第二条是错的，第一条有解。真正的判据见 `BG_SCOPE.md` §2。

### 4.1 没有 wrap —— 有解：9 重放

它的每一笔都裁在当前画布内。无缝平铺要**同一份内容平移 9 次**：

```js
for (const [ox, oy] of [[0,0],[-W,0],[W,0],[0,-H],[0,H],[-W,-H],[-W,H],[W,-H],[W,H]]) {
  brush.seed(S); brush.noiseSeed(S);      // 两个都要重置，只重置 seed 不够
  brush.push(); brush.translate(ox, oy); paint(); brush.pop();
}
```

两个前提：
1. **几何随机必须走自研 PRNG**，不能用 `Math.random()` —— 否则 9 份错开，接缝裂开。
2. **内容本身必须有周期**：砖宽组合必须凑满瓦片宽，起点对齐瓦片宽。
   初版用随机 offset(0~192)，结果同一区域被 `ox=0` 和 `ox=±192` 两套砖同时覆盖，缝交错成乱线。

成本：单张 192 瓦片 8–12 秒。离线生成，可接受。

### 4.2 笔触尺度 —— 绑的是**形状**，不是画布

`mass` 的弧线半径 = `dist(中心, 形状端点)`（`hatch/mass.js:360`）。
`scaleBrushes()` 只改 `weight / scatter / spacing`（`stroke/stroke.js:240`），**管不到半径**。

所以：
- 96×48 的砖里，弧线半径 ≈ 54，一道弧就跨过整块 → 只能落两三道，读成"毛刷扫过"
- 96×96 的石头里，半径 ≈ 68，能落四五道 → 读成"一块被涂过的石头"

**推论：元素最小可画尺寸 ≈ 120px。** 这条直接约束了场景设计（石头 ≥96×48、柱子 ≥128 宽）。

### 4.3 `strength` 是排线密度，不是浓度

0.5 是**稀疏几道弧**（不是"淡"），1.0 才涂满。
想"变深"只有一条路：**同一支笔多涂一遍**，不是降低 strength。
用低 strength 叠"暗部"会得到一把黑毛刷（`shots/wall_new.png` 那版的黑笔触就是它）。

## 5. 分工（按"能不能画得开"，不按喜好）

| 图层 | 谁做 | 理由 |
|---|---|---|
| 墙 / 地 / 平台 **瓦片** | **p5.brush**（`tilegen.html`） | 9 重放能无缝；石头 ≥96×48 时 mass 正好 |
| **房间装饰贴片** | **p5.brush** 出透明底 PNG | 有机形状、无接缝问题 |
| 标题画面 / CG / 过场 | **p5.brush** | 一次性整图，尺度最合适 |
| 角色立绘 / 角色卡 | **p5.brush** | 大尺度、要笔触 |
| 特效（火、烟、尘、光） | **p5.brush** `field` + `mass` | 矢量场是它独有的 |
| 门框 / 窗格 / 齿轮 / UI 边框 | **程序画** | 要精确几何，笔刷画不出直线 |
| 雾 / 光晕 / 暗角 / 均匀渐变 | **引擎层** | 各向同性，mass 做不了 |
| 尘埃粒子 | **引擎层** | 运行时每帧，它是离线渲染器 |

**统一画法 ≠ 统一工具。** 玩家的眼睛认的是"笔触一不一致"，
不是"是不是同一个程序生成的"。程序画的精确直线 + p5.brush 画的材质，
在蜡笔画里本来就是两种笔（尺子 / 蜡笔），并存不冲突。

## 6. 瓦片生成实测记录（2026-11-25）

走了 12 版，每版都是踩出来的：

| 版 | 做法 | 结果 |
|---|---|---|
| A | 整幅 hatch | 粒度对了，但横排线跨过砖缝不断 → 读成草席 |
| C | 整幅 mass | 弧线横跨半张图，彻底失控 |
| D/E | 逐砖短笔 | 砖形出来了，但砖之间是**没涂到的纸色** → 贴纸拼贴 |
| F/G | 逐砖独立涂法 | 涂法有个性了，但白缝 + 蓝灰太跳 |
| H/I | 满铺底 + 逐砖 mass | 缝变成"露出来的白底"，石头边缘一圈亮边 |
| K | 小砖 + 碎笔触 | 被纸白框成贴纸 |
| L | 96×96 大石 + mass | 单看最好，**进游戏读成"预制板"**，10 块铺满一屏 |
| 定版 | 96×48 小砖 + 一密一稀两遍 mass + 黑缝 + 不铺满底 | 砖形、笔触、露纸三者都在 |

定版的三条关键：
1. **不铺满底** —— 蜡笔质感一半来自"纸色从笔缝透出来"，铺密排线会变成刷涂料
2. **一密一稀两遍** —— 密的一遍保证"这块是实心的"，稀的一遍保证"看得见笔"
3. **缝是画上去的暗线，不是露出来的底** —— 露底会让 mass 在 rect 边缘堆出一圈亮边
