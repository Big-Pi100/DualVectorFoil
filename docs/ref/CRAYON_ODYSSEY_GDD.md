# 《色彩旅人 / Crayon Odyssey》GDD & TDD（原文归档）

> 2026-11-25 收到的第三方文档，作者不详，Godot 4.4.1 触屏优先。
> **这是原文，不是本项目的设计**。判断见 [`OTHERS_GDD_REVIEW.md`](OTHERS_GDD_REVIEW.md)；
> 其手感数值已逐字抄成可切换预设（游戏内按 `F2`），见 `godot/scripts/player.gd`。
>
> 归档原因：数值的**出处**要能查。只留结论不留原文，半年后没人说得清 480/1320 是哪来的。

---

这是一份为你量身定制的完整 **《游戏策划与技术开发文档（GDD & TDD）》**。你可以直接将其保存为项目根目录下的 `GDD.md`，无论是自己梳理剧本、规划美术资产，还是直接喂给 AI（如 Cursor / Claude Code）作为全局开发蓝图，都能完美通用。

---

# 游戏策划与技术开发文档（GDD & TDD）

**暂定代号**：《色彩旅人 / Crayon Odyssey》

**引擎与平台**：Godot 4.3+（GDScript 2.0）/ 移动端优先（iOS / Android 触屏适配），兼容 PC 调试

---

## 第一部分：核心理念与游戏定位（Game Vision）

### 1.1 一句话概念（High Concept）

一款**蜡笔彩色童趣手绘风**的 2D 横版探索冒险游戏——融合《奥日》般的绘本旅行沉浸感、轻量化《重生细胞》的爽快动作打击感，以及大地图原位种植、战力转化与柔和守护的治愈长线循环。

### 1.2 核心体验支柱（Core Pillars）

1. **会动的蜡笔旅行绘本（美术与氛围核心）**：彻底抛弃传统恶魔城的暗黑哥特风，采用高饱和蜡笔笔触、水彩纸质感、手绘微抖动动画与动态眺望运镜，让每一次跑图都像在翻阅一本温暖的立体童话书。
2. **零挫败感的爽快动作（操作与战斗基调）**：保留《重生细胞》式的流畅连招、翻滚无敌帧与打击顿帧，但大幅降低难度与惩罚；内置手机触屏自适应辅助，重视觉爽感而非硬核微操，绝不因操作卡关阻断剧情。
3. **固定互联大地图与深度叙事（世界观与剧本核心）**：采用手工精雕的箱庭房间联通结构，依靠环境细节、碎片化涂鸦、旅途 NPC 对话与“旅行手账地图”娓娓道来一个完整而动人的故事。
4. **播种色彩与守护家园（长线循环与战力驱动）**：在已探索的地图中亲手种下魔法植物，随探索步数自然生长并转化为自身战力；抵御滑稽“黑白橡皮擦/墨水怪”的温和入侵，将灰白区域重新染回五彩斑斓。

---

## 第二部分：核心玩法循环（Core Gameplay Loop）

```text
[ 1. 自由旅行与箱庭探索 ] ──> 推进主线剧情、解锁新区域/捷径、收集魔法种子与武器图纸
          │
          ▼
[ 2. 原位播种与自然生长 ] ──> 在大地图指定“魔法花坛”播种，随切换房间步数推进自动成长
          │
          ├──────────────────────────┐
          ▼                          ▼
[ 3A. 收获转化为自身战力 ]   [ 3B. 触发温和区域入侵 ]
  提炼颜料/点心，强化武器     黑白怪将局部背景染灰（作物暂停生长但不枯死）
  攻击、机动能力与血瓶上限     返回轻松清场，恢复全屏彩色并获额外奖励
          │                          │
          └────────────┬─────────────┘
                       ▼
           [ 4. 挑战新区域与剧情高潮 ]

```

---

## 第三部分：详细系统设计（System Design）

### 3.1 角色移动与触屏战斗系统（轻量化《重生细胞》手感）

* **基础机动**：左右奔跑、二段跳、**无敌帧翻滚/冲刺**、**自动抓边攀爬（Ledge Grab）**（防止手机虚拟摇杆跳跃差一点掉坑）。
* **触屏容错机制**：
* **输入缓冲（Input Buffer，0.15s）**：在攻击后摇结束前提前点击翻滚或跳跃，后摇结束瞬间自动无缝衔接。
* **轻度自动索敌转向**：挥砍瞬间若身后 1 个身位内有敌人且未推反方向摇杆，角色自动转向攻击。


* **简化移动端 HUD**：左侧浮动虚拟摇杆；右侧仅保留 **3 个大尺寸核心按键**（主攻击/长按连招、翻滚冲刺、互动/魔法道具）+ 1 个快捷血瓶（颜料瓶）按钮。
* **打击感表现（Juice）**：命中触发 `0.04s` 局部顿帧（Hitstop）、轻微屏幕震动、彩色蜡笔碎屑粒子爆发，以及手绘拟声词特效（“砰！”、“唰！”）。
* **零惩罚失败机制**：血量归零时角色像折纸般坐地，由伴随小精灵用纸飞机送回本房间入口或最近休息点，**不掉落任何材料、不回档剧情进度**。

### 3.2 世界大地图与叙事系统（旅行手账）

* **房间联通结构**：世界由若干手工搭建的独立房间场景（`.tscn`）通过门/边缘触发器无缝切换连接，支持单向捷径开启与能力门锁（如需要风之蜡笔乘风飞跃的高台）。
* **风景眺望点（Vista Zones）**：在悬崖、瀑布、巨型童话地标处设置触发区，角色驻足时摄像机平滑拉远（Zoom Out）并淡出 HUD，配合环境音效展现绘本全景。
* **旅行手账（世界地图与收集册）**：
* 替代传统线框小地图，采用**手绘牛皮纸旅行手账**形式。
* 走过的房间自动用蜡笔涂色并盖上地标印章；已种植的田地、成熟状态及被入侵区域均以可爱的贴纸图标标注，杜绝大地图迷路。
* 集成剧情回忆录、已结识角色档案与植物图鉴。



### 3.3 大地图原位种植与战力转化

* **魔法花坛（`SoilPlot`）**：固定分布在各区域风景优美且安全的角落，玩家路过点击互动即可选择种子种下。
* **步数驱动生长（拒绝现实时间挂机焦虑）**：
* 种子分为 3 个阶段：`种子期 -> 发芽开花期 -> 成熟发光期`。
* 每次玩家在不同房间之间切换（探索推进），所有未被入侵的已种植地块自动积累生长步数（例如每切换 4 个房间成长一阶段）。


* **战力与能力转化（在任意休息长椅或手账中一键操作）**：
* **火焰辣椒果（红）**：提升武器基础攻击力，解锁“火焰蜡笔”武器附魔（挥砍附带燃烧轨迹）。
* **弹弹棉花糖（蓝）**：提升颜料瓶（血瓶）上限、延长翻滚无敌帧或解锁额外空中跳跃。
* **荧光蒲公英（黄/绿）**：解锁探索辅助能力（照亮黑暗洞穴、唤醒藤蔓桥梁、或召唤小花精自动照料农田）。



### 3.4 温和区域入侵系统（非惩罚性守卫）

* **触发条件**：玩家每累计探索一定步数，系统从“已种植作物且非当前所在”的已探索房间中，随机挑选 1 个触发入侵。
* **低焦虑规则**：
* 入侵发生时，手账地图上对应区域出现一个抖动的黑色涂鸦小标记。
* **零永久损失**：入侵仅会让该房间内的作物“受惊缩进土里暂停生长”，**永远不会摧毁或扣除作物**，玩家可随时按自己节奏回去处理。


* **视觉与玩法表现**：
* 玩家进入被入侵房间时，局部场景呈现**黑白铅笔素描去色滤镜**。
* 3～5 只滑稽的“黑白橡皮擦怪 / 墨水团子”正在田边涂鸦捣乱；部分已成熟的魔法植物会自带趣味辅助效果（如泡泡花吐泡泡困住怪物）。
* 清完怪物后，触发**彩色颜料波纹扩散特效**，全屏瞬间恢复绚丽蜡笔色彩，并额外掉落稀有强化颜料。



---

## 第四部分：美术与视听规范（Art & Audio Direction）

### 4.1 视觉分层与辨识度法则

1. **背景层（低对比度、柔和纸感）**：采用米白/淡黄水彩纸纹理底色，搭配低饱和度蜡笔平涂远景与视差滚动（`Parallax2D`），营造绘本景深。
2. **地形层（清晰边缘）**：`TileMapLayer` 平台边缘带有明确的蜡笔勾线与草叶/积雪覆层，确保跳跃落点清晰可辨。
3. **前景交互层（高饱和度 + 粗描边）**：主角、怪物、宝箱与魔法植物均采用深褐色/黑色手绘粗描边与高饱和色彩，确保在手机小屏幕上轮廓一眼分明。

### 4.2 关键技术美术 Shader（由 AI 编写）

* **手绘沸腾线 Shader（Boiling Line）**：每 `0.15s` 对贴图 UV 施加极微小的随机扰动，让静态手绘贴图呈现《茶杯头》般的“活绘本/手翻书”呼吸感。
* **全局纸张颗粒叠加层**：屏幕最上层覆盖一层低透明度素描纸纹混合，统一所有美术资产质感。
* **去色与色彩恢复 Shader**：用于入侵状态（实时灰度去色）与净化瞬间（从主角位置向外扩散的彩色圆形遮罩动画）。

### 4.3 音频风格

* **BGM**：以钢琴、八音盒、木琴、原声吉他与轻快弦乐为主，随区域变换情绪（晴朗草地的轻快、遗忘玩具城的怀旧、被入侵时的滑稽顿音变奏）。
* **音效（SFX）**：蜡笔沙沙涂抹声、翻书页声（打开手账地图）、木质玩具碰撞声、清脆风铃声。

---

## 第五部分：Godot 4 技术架构蓝图（Technical Design）

### 5.1 基础工程配置

* **视口分辨率**：`1280 x 720`（16:9 横屏基准）
* **窗口拉伸设置**：`Stretch Mode = canvas_items`，`Aspect = expand`（完美自适应全面屏手机比例）
* **物理步进**：`60 FPS`，统一使用 **静态类型 GDScript 2.0**

### 5.2 标准工程目录结构

```text
res://
├── AGENTS.md                 # AI 编程助手全局规范文件
├── GDD.md                    # 本文档（策划与架构基准）
├── core/                     # 核心底层与全局单例 (Autoload)
│   ├── WorldState.gd         # 全局状态单例（剧情标记、农田字典、入侵列表、JSON存取）
│   ├── SceneTransition.gd    # 房间无缝切换、淡入淡出与探索步数计数器
│   ├── AudioManager.gd       # BGM 交叉淡化与音效池管理
│   └── components/           # 通用解耦组件
│       ├── Hitbox.gd         # 攻击判定框 (Area2D)
│       ├── Hurtbox.gd        # 受击判定框 (Area2D)
│       └── StateMachine.gd   # 通用有限状态机节点
├── entities/
│   ├── player/               # 主角场景、状态子节点 (Idle/Run/Jump/Roll/Attack)
│   └── enemies/              # 常规野外怪与入侵“橡皮擦/墨水怪”
├── world/
│   ├── rooms/                # 手工箱庭房间场景 (.tscn)
│   ├── interactables/        # 魔法花坛 (SoilPlot.tscn)、休息长椅、门锁、眺望区 (VistaZone)
│   └── shaders/              # 沸腾线 (boiling_line.gdshader)、去色恢复 (desaturate.gdshader)
├── data/                     # 自定义 Resource (.tres) 数据驱动配置
│   ├── weapons/              # WeaponData 资源（连击段数、伤害、附魔特效）
│   └── crops/                # CropData 资源（种子图标、生长所需步数、转化属性类型）
├── dialogue/                 # 剧本对话文件（配合 Dialogue Manager 插件）
└── ui/
    ├── TouchHUD.tscn         # 移动端自适应虚拟摇杆与简化按键
    └── TravelJournal.tscn    # 旅行手账（大地图、农田/入侵状态、战力转化界面）

```

### 5.3 核心全局数据结构（`WorldState.gd`）

```gdscript
# 全局核心存档数据示例
var story_flags: Dictionary = {}          # 例如: {"met_origami_bird": true}
var unlocked_abilities: Array[String] = [] # 例如: ["double_jump", "flame_crayon"]
var visited_rooms: Array[String] = []      # 已探索房间 ID，用于手账地图涂色

# 农田状态字典: { "room_01_plot_a": { "crop_id": "flame_pepper", "steps": 3, "is_mature": false } }
var farm_plots: Dictionary = {}

# 被入侵房间列表: ["room_01"]
var invaded_rooms: Array[String] = []
var total_room_transitions: int = 0        # 累计切换房间步数，驱动作物生长与入侵判定

```

---

## 第六部分：分阶段开发路线图（Roadmap）

### 第一阶段：白盒核心手感与“播种-入侵”最小闭环（第 1～2 周）

* **目标**：不画任何正式美术，全用色块搭建 **1 个休息安全屋 + 2 个相连野外房间**。
* **交付物**：
1. 带输入缓冲、翻滚无敌帧、自动抓边与虚拟按键的触屏玩家控制器。
2. 基础武器挥砍（含顿帧、击退）与 1 种基础敌人。
3. 房间无缝切换 + `WorldState` 记录探索步数。
4. 房间内放置 1 个 `SoilPlot` 花坛：实现“种下种子 -> 来回切换房间 4 次长大 -> 收割加攻击力 -> 触发一次去色入侵并清怪恢复色彩”的完整闭环。



### 第二阶段：蜡笔美术管线与旅行仪式感搭建（第 3～4 周）

* **目标**：替换首批蜡笔美术资产，确立最终视觉标杆与演出质感。
* **交付物**：
1. 接入“手绘沸腾线 Shader”、“全局纸纹叠加”与“入侵黑白去色扩散 Shader”。
2. 实现 `VistaZone`（风景眺望镜头平滑拉远）。
3. 搭建初版“旅行手账 UI”（查看已探索地图、花坛成熟度与入侵标记、一键转化作物战力）。
4. 接入 **Dialogue Manager** 插件，跑通第一段完整开篇旅行剧情与 NPC 对话。



### 第三阶段：世界扩展、内容填充与双端打包调优（第 5 周起）

* **目标**：按章节扩充大地图房间、设计新魔法植物与武器附魔、打磨全流程剧本。
* **交付物**：
1. 扩充至 3～4 个风格迥异的童话生态区（如：风车蜡笔草地、折纸图书馆、糖果星光灯塔）。
2. 真机（iOS / Android）触屏按键布局与帧率性能测试。
3. 完整主线结局与二周目自由旅行收集体验。



---

**文档使用建议**：
你可以直接把这份文档保存为项目根目录的 `GDD.md`。接下来在 Godot 4 中每开始写一个模块，只需对 AI 说：**“请阅读 `GDD.md` 和 `AGENTS.md`，现在帮我实现【第六阶段第一阶段的第 X 项】”**，AI 就能精准对齐你的所有设计意图，不会跑偏。

需要我现在直接为你生成**第一阶段第 1 步**的完整节点树和代码（**手机端高容错玩家控制器 + 轻量化挥砍系统**）吗？

---

## 第二封：锁定 Godot 4.4.1 + 完整 Player.gd

太好了，**Godot 4.4.1** 是非常稳定且成熟的版本（拥有完善的 `TileMapLayer`、更强的 2D 物理和静态类型推导）。

为了确保你本地的 AI 编程工具在写代码时完全贴合 **4.4.1** 的语法，不出现任何版本过时警告或报错，请把之前文档里的版本号统一锁定为 `4.4.1`，并开启静态类型检查（`Project Settings -> Debug -> GDScript -> Untyped Declaration` 设为 `Warn` 或 `Ignore` 按需即可）。

接下来我们直接进入**第六阶段 · 第一阶段的第 1 步**：搭建“高容错手机触屏 + 轻量化《重生细胞》手感”的主角原型。

你可以直接把下面的内容复制发给你的 AI 编程工具（或者自己按步骤新建），10 分钟内就能在 Godot 4.4.1 里跑通一个能跑、能二段跳、能无敌帧翻滚、能挥砍带顿帧的小人。

---

### 一、 主角场景节点树结构（`res://entities/player/Player.tscn`）

在 Godot 4.4.1 中新建一个场景，根节点选 **`CharacterBody2D`**，重命名为 `Player`，严格按以下层级建立子节点：

```text
Player (CharacterBody2D)               <-- 挂载脚本: Player.gd
├── Visuals (Node2D)                   <-- 翻转容器（改变 scale.x = -1 实现左右转身）
│   ├── BodyRect (ColorRect)           <-- 占位美术：宽 32, 高 48, 位置 (-16, -48), 暖黄色
│   ├── EyeRect (ColorRect)            <-- 朝向指示：宽 8, 高 8, 位置 (4, -40), 黑色
│   └── WeaponPivot (Node2D)           <-- 武器挂点，位置 (0, -24)
│       ├── SwordRect (ColorRect)      <-- 武器占位：宽 44, 高 10, 位置 (12, -5), 初始隐藏
│       └── Hitbox (Area2D)            <-- 攻击判定区（挂载 Hitbox.gd，初始禁用）
│           └── CollisionShape2D       <-- 矩形碰撞体，大小 (44, 24), 位置 (34, 0)
├── CollisionShape2D                   <-- 角色物理碰撞体：胶囊体或矩形，大小 (28, 46), 位置 (0, -23)
├── LedgeCheckTop (RayCast2D)          <-- 自动抓边检测（上）：位置 (0, -48), Target Position (22, 0)
├── LedgeCheckBottom (RayCast2D)       <-- 自动抓边检测（下）：位置 (0, -34), Target Position (22, 0)
└── Camera2D                           <-- 跟随摄像机（开启 Position Smoothing，速度 8.0）

```

> **快速配置提示**：
> 在 Godot 菜单栏 `Project -> Project Settings -> Input Map` 中添加 4 个动作（方便你现在在电脑键盘上直接测试，后续手机虚拟按键也会映射这 4 个动作）：
> * `move_left`（绑定 `A` / `Left`）
> * `move_right`（绑定 `D` / `Right`）
> * `jump`（绑定 `Space` / `W` / `K`）
> * `roll`（绑定 `Shift` / `L`）
> * `attack`（绑定 `J` / 鼠标左键）
> 
> 

---

### 二、 核心代码（严格适配 Godot 4.4.1 静态类型语法）

#### 1. 通用攻击判定组件：`res://core/components/Hitbox.gd`

```gdscript
class_name Hitbox
extends Area2D

@export var damage: float = 10.0
@export var knockback_force: Vector2 = Vector2(220.0, -120.0)
@export var hitstop_duration: float = 0.045 # 《重生细胞》式打击顿帧时长

@onready var collision_shape: CollisionShape2D = $CollisionShape2D

func _ready() -> void:
	# 默认关闭判定，仅在挥砍瞬间开启
	collision_shape.disabled = true
	area_entered.connect(_on_area_entered)

func activate(duration: float = 0.12) -> void:
	collision_shape.set_deferred("disabled", false)
	await get_tree().create_timer(duration).timeout
	collision_shape.set_deferred("disabled", true)

func _on_area_entered(area: Area2D) -> void:
	if area.has_method("take_damage"):
		var dir: float = sign(global_position.x - area.global_position.x) * -1.0
		if dir == 0.0:
			dir = 1.0
		var final_knockback := Vector2(knockback_force.x * dir, knockback_force.y)
		area.take_damage(damage, final_knockback)
		_trigger_hitstop()

func _trigger_hitstop() -> void:
	# 极短暂的局部时间减速，营造清爽的蜡笔碰撞打击感
	Engine.time_scale = 0.05
	await get_tree().create_timer(hitstop_duration, true, false, true).timeout
	Engine.time_scale = 1.0

```

#### 2. 高容错主角控制器：`res://entities/player/Player.gd`

内置了**土狼时间、跳跃缓冲、翻滚输入缓冲、翻滚无敌状态、自动抓边爬台阶**（手机端防跌落神器）：

```gdscript
class_name Player
extends CharacterBody2D

@export_group("移动与跳跃手感")
@export var move_speed: float = 280.0
@export var acceleration: float = 2200.0
@export var friction: float = 2400.0
@export var jump_velocity: float = -480.0
@export var double_jump_velocity: float = -420.0
@export var gravity_scale: float = 1.35

@export_group("手机端高容错参数")
@export var coyote_time: float = 0.14        # 离开平台边缘后的宽容跳跃时间
@export var jump_buffer_time: float = 0.15   # 落地前提前按跳跃的缓冲时间
@export var action_buffer_time: float = 0.15 # 攻击后摇中提前按翻滚的缓冲时间

@export_group("轻量化《重生细胞》翻滚与挥砍")
@export var roll_speed: float = 460.0
@export var roll_duration: float = 0.26
@export var roll_cooldown: float = 0.25
@export var attack_cooldown: float = 0.24

# 节点引用
@onready var visuals: Node2D = $Visuals
@onready var sword_rect: ColorRect = $Visuals/WeaponPivot/SwordRect
@onready var hitbox: Hitbox = $Visuals/WeaponPivot/Hitbox
@onready var ledge_top: RayCast2D = $LedgeCheckTop
@onready var ledge_bottom: RayCast2D = $LedgeCheckBottom

# 状态变量
var facing_dir: float = 1.0
var can_double_jump: bool = true
var is_rolling: bool = false
var is_invincible: bool = false
var is_attacking: bool = false

# 计时器
var _coyote_timer: float = 0.0
var _jump_buffer_timer: float = 0.0
var _roll_buffer_timer: float = 0.0
var _roll_cd_timer: float = 0.0
var _attack_cd_timer: float = 0.0

func _ready() -> void:
	sword_rect.visible = false

func _physics_process(delta: float) -> void:
	_update_timers(delta)
	_handle_inputs()
	
	if is_rolling:
		# 翻滚期间保持高速水平冲刺，忽略常规重力干扰
		velocity.x = facing_dir * roll_speed
		velocity.y = 0.0
	else:
		_apply_gravity(delta)
		_handle_horizontal_movement(delta)
		_handle_jump()
		_check_auto_ledge_grab()

	move_and_slide()

func _update_timers(delta: float) -> void:
	if is_on_floor():
		_coyote_timer = coyote_time
		can_double_jump = true
	else:
		_coyote_timer -= delta

	_jump_buffer_timer = maxf(0.0, _jump_buffer_timer - delta)
	_roll_buffer_timer = maxf(0.0, _roll_buffer_timer - delta)
	_roll_cd_timer = maxf(0.0, _roll_cd_timer - delta)
	_attack_cd_timer = maxf(0.0, _attack_cd_timer - delta)

func _handle_inputs() -> void:
	if Input.is_action_just_pressed("jump"):
		_jump_buffer_timer = jump_buffer_time
	
	if Input.is_action_just_pressed("roll"):
		_roll_buffer_timer = action_buffer_time
		
	if Input.is_action_just_pressed("attack") and not is_attacking and not is_rolling and _attack_cd_timer <= 0.0:
		_perform_attack()

	# 只要攻击结束或常规状态下，检测到缓冲里有翻滚指令立刻执行
	if _roll_buffer_timer > 0.0 and not is_rolling and not is_attacking and _roll_cd_timer <= 0.0:
		_roll_buffer_timer = 0.0
		_perform_roll()

func _apply_gravity(delta: float) -> void:
	if not is_on_floor():
		var default_gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")
		velocity.y += default_gravity * gravity_scale * delta
		# 限制最大下落速度，保持轻盈的绘本漂浮感
		velocity.y = minf(velocity.y, 750.0)

func _handle_horizontal_movement(delta: float) -> void:
	var input_dir: float = Input.get_axis("move_left", "move_right")
	
	if input_dir != 0.0:
		velocity.x = move_toward(velocity.x, input_dir * move_speed, acceleration * delta)
		# 攻击期间不随意转身，保持出招稳定
		if not is_attacking:
			_set_facing(signf(input_dir))
	else:
		velocity.x = move_toward(velocity.x, 0.0, friction * delta)

func _set_facing(dir: float) -> void:
	if dir == facing_dir:
		return
	facing_dir = dir
	visuals.scale.x = facing_dir
	ledge_top.target_position.x = absf(ledge_top.target_position.x) * facing_dir
	ledge_bottom.target_position.x = absf(ledge_bottom.target_position.x) * facing_dir

func _handle_jump() -> void:
	if _jump_buffer_timer <= 0.0:
		return
		
	if _coyote_timer > 0.0:
		velocity.y = jump_velocity
		_coyote_timer = 0.0
		_jump_buffer_timer = 0.0
	elif can_double_jump:
		velocity.y = double_jump_velocity
		can_double_jump = false
		_jump_buffer_timer = 0.0

func _check_auto_ledge_grab() -> void:
	# 手机端防跌落辅助：空中向前跳且脚部/腰部碰到平台边缘，头部上方是空的，自动向上提拉
	if not is_on_floor() and velocity.y > -100.0:
		if ledge_bottom.is_colliding() and not ledge_top.is_colliding():
			global_position.y -= 18.0
			velocity.y = -180.0

func _perform_roll() -> void:
	is_rolling = true
	is_invincible = true
	_roll_cd_timer = roll_duration + roll_cooldown
	
	# 翻滚视觉反馈：角色压扁并半透明
	visuals.scale = Vector2(facing_dir * 1.25, 0.65)
	visuals.modulate.a = 0.6
	
	await get_tree().create_timer(roll_duration).timeout
	
	visuals.scale = Vector2(facing_dir, 1.0)
	visuals.modulate.a = 1.0
	is_rolling = false
	is_invincible = false

func _perform_attack() -> void:
	is_attacking = true
	_attack_cd_timer = attack_cooldown
	sword_rect.visible = true
	
	# 挥砍时给予轻微向前位移，增强动作爽感
	velocity.x = facing_dir * 140.0
	hitbox.activate(0.12)
	
	await get_tree().create_timer(0.16).timeout
	
	sword_rect.visible = false
	is_attacking = false

```

---

### 三、 顺手附赠：蜡笔“手绘沸腾线” Shader（`res://world/shaders/boiling_line.gdshader`）

如果你现在想顺便看一眼“会动的蜡笔绘本”视觉效果，可以在 Godot 里新建一个 `ShaderMaterial`，挂在任何测试色块或图片上，贴入这段 **Godot 4.4.1** 着色器代码：

```glsl
shader_type canvas_item;

uniform float boil_speed : hint_range(1.0, 20.0) = 6.5;
uniform float boil_strength : hint_range(0.0, 0.02) = 0.004;

// 简易伪随机哈希
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void fragment() {
	// 按离散时间步进跳动，模拟手翻动画书的帧率感
	float discrete_time = floor(TIME * boil_speed);
	vec2 offset = vec2(
		hash(UV * 10.0 + discrete_time) - 0.5,
		hash(UV * 10.0 + discrete_time + 42.0) - 0.5
	) * boil_strength;
	
	COLOR = texture(TEXTURE, UV + offset);
}

```

---

### 下一步建议

你可以先把 `Player.tscn` 和这两个脚本放进 Godot 4.4.1 里，随便建一个 `StaticBody2D` 地板按 `F6` 试跑一下手感（重点感受**二段跳、翻滚缓冲、自动爬台阶**的丝滑度）。

跑通主角手感后，下一步我们就可以接着写 **第一步的下半部分**：**全局 `WorldState.gd` + 房间切换 + 魔法花坛（`SoilPlot`）播种与入侵去色循环**。跑通之后随时告诉我！
