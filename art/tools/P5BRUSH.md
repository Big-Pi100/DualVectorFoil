# p5.brush 能力评估（2026-11-25 实测）

> 上游：[acamposuribe/p5.brush](https://github.com/acamposuribe/p5.brush)（MIT，1.4k★）
> 本地：`.deps/p5.brush`（29MB，已 gitignore，只用于查源码与出图）
> 结论先说：**它是插画工具，不是纹理瓦片工具。** 分工见 §5。

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

## 4. 实测：做不到什么 —— 三条硬伤

我把同样的活儿交给它：**画我们游戏里的 192px 墙面瓦片**（`shots/cmp_wall_raw.png` 上排是它，下排是我 Python 版）。

### 硬伤 1：没有 wrap，平铺必然有缝

它的每一笔都裁在当前画布内。要无缝只能画 3×3 再取中心（9 倍面积、9 倍时间），
我试了（`shots/pw_wall_9tile.png`）：笔迹确实跨边界连续了，但**砖块结构仍然错**，
因为竖缝的相位是我手写坐标算的，一步算错整面墙就散。

### 硬伤 2：笔触尺度跟画布绑死 —— 这是致命的

`mass` 的笔触是**弧线**，弧长跟画布尺寸挂钩：

| 画布 | scaleBrushes | 笔触弧线半径 | 砖块 48px 的结果 |
|---|---|---|---|
| 192px | 0.55 | 100+ px | **比砖块还大**，结构全糊 |
| 384px | 1.1 | 100+ px | 还是大，砖面被两三道弧线抹平 |

`shots/pw_wall384.png` 就是 384 版的实拍：砖缝细得看不见，砖块加深变成一堆孤立小色块，
一条污渍变成巨大的斜向排线。

**它不是"参数没调好"，是尺度关系错了。** 它的笔触是给 600–1500px 的插画设计的。

### 硬伤 3：`strength` 是"排线密度"，不是"涂得薄"

我们墙面需要"薄薄一层挂不住纸"，靠低 `coverage` 做。它的 `strength: 0.46` 给的是
**只画几道弧线**，中间大片留白 —— 看起来像没画完，不像薄涂。

**结论**：拿它做 192px 平铺瓦片，等于用它做它没打算做的事。
我 Python 版（下排）结构清晰、砖缝连贯，正是因为它把"结构"和"质感"分开管。

## 5. 分工（按尺度，不按喜好）

| 图层 | 谁做 | 理由 |
|---|---|---|
| 墙 / 地 / 平台 **瓦片** | `art/tools/crayon.py` | 要 wrap、要薄涂、要逐块控色，三条它都不满足 |
| **房间装饰贴片**（污渍、苔藓、水渍、裂纹、剥落） | **p5.brush 出透明底 PNG** | 有机形状、无接缝问题、笔触表现力强，正是它的强项 |
| 标题画面 / CG / 过场 | **p5.brush** | 一次性整图，笔触尺度正合适 |
| 角色立绘 / 角色卡 | **p5.brush** | 大尺度、要笔触 |
| 特效（火、烟、尘、光） | **p5.brush** `field` + `mass` | 矢量场是它独有的 |
| UI 手绘元素（血条格、刻字牌） | 待定 | 要精确像素，可能仍归 Python |

**最值得马上做的一件事**：让 p5.brush 出 10–15 张 256px 的**透明底贴片**
（苔藓、水渍、裂缝、剥落、墙面污渍），随机贴在 Python 瓦片之上。
这样墙不再"每块一样"，而且每一块都是同一支笔画的 —— 这是现在最缺的一层。

### 为什么不整体切换

1. 瓦片必须 wrap，它没有
2. 它的随机是全局的（`seed` 一变整张图变），我们瓦片需要"逐块独立可复现"
3. 引入 123KB 库 + WebGL2 运行时，只为已经做好的 8 张瓦片，不划算

### 为什么不整体不切

它能做到的三件事（`spline` 变宽、矢量场、`mass` 的涂面手感）我们 Python 版没有，
而且这三件正是"看起来像手绘"和"看起来像滤镜"的分界。

## 6. 贴片实测（`art/decal/`，4 张 256px）

试的是我推荐它干的那件事：出透明底贴片，贴到 Python 瓦片上增加变化。
真实结果（`shots/decal_on_wall.png`）比预想的更挑内容：

| 贴片 | 做法 | 结果 |
|---|---|---|
| **苔藓** | 16 个小 `circle(r 10~30, irregularity .95)` 聚成一簇 + 短 stroke | ✅ 可用。多而小才像苔藓，7 个大圆叠出来是"两颗橄榄球" |
| **剥落** | 不规则多边形 `mass(outline:true)` + 描边 | ✅ 基本可用。像一块破损墙皮 |
| **裂缝** | 递归分叉 `spline` | 🟠 太重。`charcoal` 加粗到 3.4 后像树枝，细了又过不了抠图阈值 |
| **水渍** | 6 层同心 `mass` + 一道不规则外圈 | ❌ 失败。`mass` 在圆里涂出来是**一圈圈同方向弧线**，读成"涂鸦"不是"渗水" |

### 一个关键教训：透明画布不能用

第一版用 `brush.clear()`（不带参数）出透明底，结果是：
- `stroke` 的 RGB 失准 —— 裂缝变成**白色发丝线**
- `fill`（水彩）整块带一层白 —— 水渍贴上去是个**白方块**

**水彩的整个模型建立在"纸"上**，抽掉纸它没法算。这不是 bug，是设计前提。

改法：**纸底渲染 + 色差抠图**（`lo=14, hi=34`，再 `MinFilter(3)` 收 1px）。
颜色 100% 是渲染时的样子，因为我们看的就是纸上的效果。
代价是浅色内容会被当纸纹滤掉 —— 裂缝因此必须画得比"看起来合适"更重。

### 分界线在哪

`mass` 适合**有内在方向/纹理的物体**：苔藓、草、布料、木纹、皮肤。
不适合**各向同性的痕迹**：水渍、渗水、雾、均匀渐变 —— 它的笔触是弧线，
在一块圆形区域里涂，自然就成了"一圈圈"，方向感甩不掉。

水渍这类应该走 `fill()`（水彩），而水彩必须叠在纸上、必须放弃透明底 ——
那就得把水渍**直接画进瓦片**，而不是做成可复用的贴片。
