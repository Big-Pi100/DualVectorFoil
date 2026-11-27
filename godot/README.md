# Godot 工程 · 二向箔

**本仓库唯一的游戏工程。** 打开时选这个目录，不是仓库根：

```
E:\IdentityCard\game-soulkeep\godot\
```

本机编辑器：`E:\godot\Godot_v4.7.2-stable_win64.exe`
引擎版本**定死 4.7.2-stable**（`project.godot` 里 `config/features` 写着 `"4.7"`）——
换版本手感数字会静默失准，`tests/test_*` 里与移动相关的断言会跟着漂。

## 这份工程的来历（2026-11-27）

它**不是**在这台机器上从零长出来的。查清的事实见 `DEV_FLOW §6.1`：

| | 说明 |
| --- | --- |
| 来源 | `Big-Pi100/DualVectorFoil` 的 `master`（2026-11-26 的 9 个提交） |
| 为什么并进来 | 本项目在 GitHub 上有两条 unrelated histories；白哥裁定**本地仓库为准**，把那边完整的 Godot 工程搬到这里 |
| 搬了什么 | `core/` `entities/` `world/` `ui/` `dialogue/` `addons/` `tests/` + `project.godot` + `export_presets.cfg` + 三份 CI |
| 没搬什么 | 那边的 `art/`（旧快照，且 `art/experiments` 95MB，本地已清理）、`AGENTS.md` / `ART_GUIDE.md` / `GDD.md`（本地版本为准） |
| 原来的骨架 | 17 个 `.gd` 的单屏 feel 测试房 → `legacy/godot_prototype_2026-11-27/`（存档，跑不起来） |

原骨架那份 README 记录了 11-25 → 11-26 的手感标定推演（`P_JUMP_V 991` 的来由、F1/F2 两套预设实测对照），
**结论在 `FEEL_TABLE.md`，推演过程在那份 README 里**，需要溯因时去 `legacy/` 看。

## 第一次打开：在 Godot 编辑器里导入

**别选仓库根目录**。根目录 `E:\IdentityCard\game-soulkeep\` 没有 `project.godot`，
选它会提示「项目文件不存在」——它是个美术 + 文档 + 工程的混合仓库，引擎只认 `godot/` 这一层。

1. 双击 `E:\godot\Godot_v4.7.2-stable_win64.exe`，进项目管理器
2. 点右侧 **「导入」**（Import），文件对话框里定位到
   `E:\IdentityCard\game-soulkeep\godot\project.godot` → 选中 → **「导入并编辑」**
   （等价操作：把这个 `project.godot` 直接拖进项目管理器窗口）
3. 首次导入会编译 60 张图 + 扫描脚本，进度条走完约十几秒。**没有报错就是正常**，
   有几行 `WARNING` 关于 UID 变化的可以忽略——那是 `.import` 元数据在改用新路径。
4. 打开后按 **F5**，主场景是 `SafeHouse`（`project.godot` 的 `run/main_scene`）。

命令行等价于第 2–3 步（不用开界面，跑完 `.godot/` 缓存就齐了）：

```bash
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless \
  --path "E:/IdentityCard/game-soulkeep/godot" --import
```

**打开后如果贴图全是白的**：说明 `.import` 里的 `source_file` 还指着旧路径
（原工程是 `res://assets/art/...`，本仓库是 `res://art/approved/...`）。
跑一次上面的 `--import` 会自动修正——这批修正必须提交，否则队友和 CI 拿到的是坏元数据。

## 跑

```bash
# 直接玩（主场景 SafeHouse）
"E:/godot/Godot_v4.7.2-stable_win64.exe" --path godot

# 无头跑单个测试
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/test_hitbox_contract.gd

# 全量（与 CI 同口径：26 套，排除 GPU/实验依赖的 4 个）
cd godot && for f in $(ls tests/test_*.gd | grep -vE "render_capability|test_e04_|test_e05_"); do
  "E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path . --script "res://$f" || echo "FAIL $f"
done
```

2026-11-27 在本机 4.7.2-stable 实测：`--import` 通过，26 套断言 **PASS=26 FAIL=0**。
没装 Godot 时本地验证只剩静态检查（引用扫描 + `sync_godot.py --check`），跑通要靠 CI
（`.github/workflows/build-*.yml` 会先 `--import` 再跑同一批断言，全绿才出包）。

**编辑器里能做什么、不能做什么**：

| 可以 | 不要 |
| --- | --- |
| 改 `.tscn` / `.gd`、调 `env_light.gdshader` 参数、按 F3 看两套光照 | 手动改 `art/approved/` 下的文件（那是镜像，下次 `sync_godot.py` 覆盖） |
| 在 `tests/` 加新断言（CI 用 `ls tests/test_*.gd` 捡，加进去就会跑） | 在 Godot 里重命名/移动 `art/approved/` 里的图（真源在根 `art/approved/`，两边会脱节） |
| 新建场景、加节点 | 重构目录结构（下次从远端取更新会合不动） |

## 结构

```
godot/
├─ project.godot          1280×720 / GL Compatibility / 6 个 Autoload
├─ export_presets.cfg     Web / Android / iOS 三个预设（CI 用的就是这三个名字）
├─ core/
│  ├─ WorldState.gd       Autoload：flags / unlocked / visited / invaded_rooms + 存档
│  ├─ SceneTransition.gd  Autoload：过场
│  ├─ MobileTuner.gd      Autoload：手机端调参
│  └─ components/         Hitbox / Hurtbox
├─ entities/player/       Player.gd + Player.tscn（主角）
├─ world/
│  ├─ rooms/              SafeHouse（主场景）+ Room01–05 + BaseRoom.gd（房间基类）
│  ├─ enemies/            Invader.tscn + InvaderVisual.gd
│  ├─ interactables/      RestBench / RoomDoor / SoilPlot / VistaZone / AbilityPickup
│  ├─ tiles/              **gen_tileset.gd** 生成 ground_tileset.tres（96×144，3 source / 6 块）
│  │                      **apply_ground.gd** 给房间挂 TileMapLayer（幂等，可重跑）
│  └─ shaders/            boiling_line / desaturate_wipe / paper_grain / **env_light**
├─ ui/                    DialogueBalloon / TouchHUD / TravelJournal
├─ dialogue/              StoryDirector + 3 个 .dialogue 剧本
├─ addons/dialogue_manager/  第三方对话插件（118 文件，勿手改）
├─ tests/                 30 个 test_*.gd（CI 跑 26 个）
└─ art/approved/          ← 根 `art/approved/` 的**只读镜像**，不要手改
```

## 键位（以及为什么是这些键）

| 手 | 键 | 动作 | 设计理由 |
| --- | --- | --- | --- |
| 左手 | `A` `D` / `←` `→` | 移动 | — |
| 左手 | `W` `S` / `↑` `↓` | 上/下（爬、下蹲） | — |
| 左手 | `Space` | 跳 | 拇指位，最常按 |
| 左手 | `Q` | 血瓶 | 小指补位，不抢拇指 |
| 右手 | `J` | 主攻（`primary_attack`） | 三键核心之一 |
| 右手 | `K` | 次行动（`secondary_action`） | 三键核心之一 |
| 右手 | `L` | 翻滚（`roll`） | 三键核心之一 |
| 右手 | `U` | 交互（`interact`） | 低频，外圈 |
| 右手 | `I` / `O` | 技能 1 / 2 | 低频，外圈 |
| 右手 | `M` | 折叠画卷手账（`journal`） | 独立，不参与战斗 |
| 兼容 | `J` | `attack`（旧别名，同 `primary_attack`） | 老脚本/老测试仍在引用，别删 |

**禁用键：`F` / `E` / `H` / `Shift`** —— 这几个会被系统或输入法抢走（`Shift` 还会和输入法中英切换打架）。新增动作时先避开它们。

> **`project.godot` 里不要写注释。** 2026-11-27 在编辑器里打开并保存后，Godot 重写了整个文件：
> `[autoload]` 段被挪到 `[display]` 前面（无害），**所有 `;` 注释被删干净**（不可恢复）。
> 上面这张表原本就是 `project.godot` 里的四条中文注释，已搬到这里。
> 结论：**能被机器重写的文件不承载文档**；引擎行为的理由写进 README / `FEEL_TABLE.md`。

## 房间地形：蓝图驱动（2026-11-27 接管）

**地形不再手摆。** 六间房原来各只有一个 `Floor`（1200×40 矩形，顶 y=600）+ 两扇 y=540 的门，
也就是一条从左到右的走廊 —— 没有平台、没有台阶、没有竖井。现在每间房的地形是一张
**ASCII 蓝图**：

```
world/rooms/blueprints/room_02.txt     ← 唯一的真源，改地形 = 改一个字符
```

字符表（26 列 × 15 行，一格 48px，原点 `(16, 0)`）：

| 字符 | 含义 | 生成物 |
|---|---|---|
| `#` | 实心地形 | `Solids` 里的合并矩形 + `Blocks` 灰盒 |
| `=` | 单向平台（可从下方跳穿） | `Platforms`（层 2，`one_way_collision`） |
| `.` | 空 | — |
| `L` / `R` | 左门 / 右门（必须在第 0 列 / 最后一列） | `Doors/DoorToXxx` |
| `P` | 出生点 | `SpawnFromLeft` 等 |
| **`E`** | **敌人生成点** | **`EnemySpawn0..n`**，落在**从该行往下第一个站面**上，并写回 `invader_count` |
| **`A`** | **能力拾取点** | **`AbilityPickup0`**，能力 id 由头部 `ability=<id>` 给出 |

> `E` 是 2026-11-27 加的。之前六间房的敌人统统生成在 `(660 + i*90, 568)` ——
> 一个和地形无关的写死坐标。地面顶从 600 抬到 624 之后，它们全部浮空 31px。
> **蓝图里几个 `E`，这一房就有几个入侵者**，不再靠 `@export invader_count` 手填。
>
> **`E` 的行号有意义**（12 F3）：敌人站在「从 E 所在行往下第一个可站面」上。
> 之前是「整列找最低站面」—— 那样无论 `E` 写在哪一行，敌人永远落在地面，
> 「把敌人放在中台上」在蓝图里根本表达不出来。Room01 现在地面一只、中台一只。

> `A` 是 S2 加的（Room03 的折叠点）。同样不进 tscn：手工塞进去的节点，
> 下次生成就被 `_purge_old` 清掉了（`EnemySpawn` 已经踩过一次）。
> 头部还必须写 `ability=fold`，只写 `A` 不写能力 id 会直接 `push_error`。

**头部开关**：

| 键 | 作用 |
|---|---|
| `require_jump_to_exit=1` | 生成时跑一遍「只许平移和下落」的 BFS，右门落在里面就 **FAIL**。用来证明这间房的跳跃不是装饰（Room01） |
| `vista_at=<列>,<行>` | 观景点不贴地，放到指定站面上 |
| `ability=<id>` | 配合 `A`，能力拾取点 |
| `invade_on_enter`（场景 `@export`，不在蓝图） | 一进门就被占。**新存档进 Room01 原本是空房**（敌人只由种植系统触发），这里是关卡数据不是经济系统的副产物 |

摆件（`SoilPlot` / `VistaPoint`）不写坐标：生成器用"该列地面 y − 固定偏移"
（土块 22 / vista 40）自动贴地，且**幂等** —— 重跑一次不会又挪一遍。

**例外：VistaPoint 不一定贴地。** 想在台上/高处放观景点，就在头部写
`vista_at=<列>,<行>`（行 = 站立面所在行，生成器再抬高 40px）。没写就保持原位不动。
Room03 的观景点就这么搬到了折叠高台上 —— 它同时是这个台的回报（见下节）。

> **"幂等"的正确口径**：两次生成**几何与数值完全一致**，但 `unique_id`
> 每次都会变（Godot 自己分配的节点 ID）。所以别拿文件 md5 判幂等，
> 要过滤 ` unique_id=\d+` 再比。用 md5 判会得出"生成器不幂等"的错误结论。

生成：

```bash
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot \
  --script res://world/tools/gen_room_terrain.gd -- room_02
```

产物结构：

```
Room02
├─ Terrain (z_index=-10)
│   ├─ Backdrop         纸色全屏底（没有它，空白处露的是深灰虚空）
│   ├─ Solids           StaticBody2D 层1，贪心合并后的矩形（26×15 通常合并成 5~8 个）
│   ├─ Blocks           ColorRect 灰盒（**待美术**，现在是纯色块）
│   ├─ Platforms        StaticBody2D 层2，one_way_collision=true
│   ├─ PlatformVisuals
│   └─ GroundArt        Sprite2D 逐块地表贴图（96×144，4 帧循环）
├─ Doors/DoorToXxx
├─ SpawnFromLeft / SpawnFromRight / SpawnFromRest
└─ Player / TouchHUD / PostProcessLayer / InvadersContainer / VistaPoint（保留不动）
```

> 地表贴图**不用 TileMapLayer**：它的 cell 等于 `TileSet.tile_size`（96×144），
> 跟 48 网格和任意地表高度都对齐不了。第一版铺出来全在 y=1872，屏幕外，代码不报错。
> 细节见 `docs/gdd/11_房间空间设计.md §3.2`。

**生成器会在写文件之前做可达性验算**：从出生点按真实单跳能力（204px / 水平 4 格）
跑 BFS，**门跳不到就 `exit 1`，一个字节都不写**。这条挡住的是"房间看起来对、玩家卡死"。

**层高预算**（实测单跳 211.6px = 4.41 格，二段总高 331.1px = 6.90 格）：

| 用途 | 落差 |
|---|---|
| 台阶 | ≤ 1 格（48px） |
| 主路平台 | 3 格（144px），上限 4 格（192px） |
| 折叠专属 | 5–6 格（240–288px） |

> 改 `jump_velocity` / `gravity_scale` 必须重跑 `tests/test_jump_height.gd` ——
> 房间会看起来完全正常，但所有平台都跳不上去了。

蓝图语法、六间房的空间性格、判据，见 [`docs/gdd/11_房间空间设计.md`](../docs/gdd/11_房间空间设计.md)。

**改生成器前先知道两件事**（都写进注释了）：

1. 动态 `add_child` 的节点**必须设 `owner`**，否则 `pack()` 静默丢弃 —— 而
   `ResourceSaver.save` 照样成功、文件照样变，只有回读才知道节点不在里面。
2. 回读**必须 `CACHE_MODE_IGNORE`**：`load()` 命中缓存，刚存的路径读回来是旧的，
   于是自测自己报 FAIL 而文件其实是对的。验证手段比被验证的东西更不可靠。

### 旧 `Floor` 结构还在哪

`SafeHouse` 之外的老房已全部迁移。`Floor` + `GroundTiles` 的老写法还留在
`world/tiles/apply_ground.gd` 里作为历史（它给旧 40 高地板铺 14 块 96 宽瓦片，
`position (-640,-20)` 是为了让 tile 顶对齐 y=600 —— 这三个数都跟现行网格不搭，**不要再用**）。

## 敌人：会走、会起手、会打（`world/enemies/InvaderAI.gd`）

敌人根节点是 `Area2D + Hurtbox`（受击契约，玩家攻击靠它接住伤害）。
AI 是它的**子节点**，不是改根脚本 —— 否则"受击组件"就变成"敌人实体"，
以后任何可受伤物都得长一个敌人。

```
Invader (Area2D + Hurtbox.gd)
├─ CollisionShape2D  40×50
├─ Visual            Sprite2D + InvaderVisual.gd（三变体）
└─ AI                InvaderAI.gd
```

状态机 7 态：`PATROL → CHASE → WINDUP → ACTIVE → RECOVER`，外加 `HURT` / `DEAD`。
`WINDUP` 的 450ms 里**不移动**，并且有可读形变（压扁 1.28×0.76 + 后仰 6px），
判定帧反过来拉长前扑 —— 关掉音效、灰度截图也能看出"它要打你了"。

**为什么不用 `CharacterBody2D`**：根必须是 `Area2D`，玩家 `Hitbox.area_entered` 才认它。
地形是轴对齐网格，所以移动用射线做「贴地 / 撞墙 / 悬崖折返」三件事，
每帧向下 48px 有地就吸附，没有就自由下落（`GRAVITY`）——
少了这条重力，敌人被击退打出平台会**停在半空**，静止看不出来、动起来荒诞。

**为什么没有「接触伤害」**：基线 `src/game.js` 是碰到就掉血，那样玩家会觉得
"它自己撞上来的"。现在伤害只发生在判定窗口，一次挥击只结算一次（`_hit_done`）。

调参：`InvaderAI.gd` 顶部 `@export`，数值来源与依据在 `docs/gdd/10 §3.1`。
闸门：`tests/test_enemy_ai.gd`（巡逻 / 追击 / 形变帧数 / 单次结算 / 硬直打断 / 悬崖 / 真实房间）。

```bash
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot \
  --script res://tests/test_enemy_ai.gd
```

## 死亡与复活（S1）

**血量归零后故意停在 0，不立刻回满。** 这是刻意的：`health_changed(0)` 与
`health_changed(max)` 若发在同一帧，HUD 只渲染最终值 —— 玩家永远看不到血条见底，
死亡在屏幕上等于没发生，只是画面一闪人到了暗房。（旧实现就是这样，`_receive_damage`
里先 `hp = max_hp` 再 emit `respawn_requested`。）

现在分三段，三个责任方：

| 阶段 | 谁做 | 做什么 |
|---|---|---|
| 倒下 | `Player._enter_death()` | hp 停在 0、`died` 广播、停到 `hurt` 帧（坐地）+ 褪色、**物理与输入全部停摆**、0.7s 后 `respawn_requested` |
| 定位 | `BaseRoom._on_player_respawn_requested()` | 安全屋：挪回 `SpawnFromRest`；野外：`SceneTransition` 送到 `last_rest_scene_path` |
| 恢复 | `Player.revive()` | 满血、满瓶、清无敌源、视觉复位（野外不调用 —— 新场景 `_ready` 自己满血初始化） |

**倒地为什么不做形变**：`player_hurt_00_sprite.png` 本来就是「坐倒在地、闭眼皱眉」的姿势
（GDD 写的「像折纸般坐地」）。压成 1.45×0.32 会变成一条横线（像画面撕裂），
旋转 −72° 会让侧视小人变成一坨虫子 —— 两种都试过、都退回来了，实拍留在
`art/out/room/shot_hud_dead.png`。**已有资产画好了就不要用几何去毁它。**

**死亡态为什么要停 `_physics_process`**：只放行重力/位移会让玩家在倒地时被推着走
（实测喂一个向右的虚拟摇杆，倒下后仍会滑 81.5px），看上去像被打飞，不像倒下。

**安全屋的死亡循环**：如果暗房被占了（旧存档、或规则生效前），原地复活会变成
「爬起来 → 敌人还在 → 继续挨打 → 再死」。所以安全屋分支在复位时不只挪位置，
还会清掉残留敌人并 `purify_room`。正常情况下走不到这条：`WorldState.safe_room_ids`
已经让安全屋不参与入侵判定。

**已清房不复活**：`purify_room` 把房间写进 `purified_rooms`（跟着存档走），
`_try_trigger_gentle_invasion` 见到它就跳过。只有 `invaded_rooms` 一张表是不够的 ——
那只是「眼下被占」，房间一旦种上作物，下一轮判定会把它当普通候选重新占掉。

闸门：`tests/test_death_loop.gd`（死亡可见 / 输入锁 / 延时复活 / revive / 已清房 /
安全屋排除 / 安全屋防循环 / HUD 绑定与血条 / 端到端）。端到端那条是**真被敌人打死**：
Room01 站门口不按键，**第 15.9 秒**倒下（7 击 × 2.15s，与 18 伤 / 120 血吻合）。

## 血条与 HUD 绑定（`ui/HealthBar.tscn`）

**修之前有两个洞，都不报错、都不影响键盘试玩，所以一直没人发现：**

1. **正式房间的 `TouchHUD.player` 是 `null`。** 只有 `TestCombat` 调过 `bind_player`；
   Room01–05 和 SafeHouse 从来没绑过。`_input` 第一行就是 `if not player: return`
   —— 等于**手机上所有触屏操作都不响应**。键盘走 `Input` 单例，照样能玩。
   现在 `BaseRoom._bind_player_signals()` 统一绑 HUD。
2. **全项目没有血条。** `health_changed` 只有测试里的 `TestCombat` 打印。玩家挨打唯一的
   反馈是 0.35s 受击动画，血量和死亡都没有前兆。

血条本身就是 `UISkin` 意义上的灰盒件：心形是现有 `ui_heart_icon_00.png`，
条是两块 `ColorRect`（朱红 `#b23a2e` + 深褐半透明槽），**没有新增任何美术**。
四段刻痕对应 30 血一格，一次挨打 18 点 ≈ 半格。低于 30% 时心形与填充一起心跳。

位置在左上 `y=72`，**不能放 `y=18`**：手账按钮在 `(20,18)-(108,66)` 且
`TravelJournal` 的 `layer=90`，比 `TouchHUD`（layer 1）高，会直接把血条左端和心形压住
（第一版就是这么翻车的，实拍才看见）。

```bash
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot \
  --script res://tests/test_death_loop.gd
```

## 折叠：二段跳是能力，不是默认值（S2）

**改之前的状态很容易误判。** `can_double_jump` 初值是 `true`，看起来像"锁没上"，
但把它改成 `false` 什么都不解决 —— 它是「本次滞空还剩不剩一次二段」，
`_update_timers` 每帧 `is_on_floor()` 就无条件重置成 `true`。第一帧落地，锁就没了。

真正的锁在**落地充能**这一句：

```gdscript
if is_on_floor():
    can_double_jump = _fold_unlocked()   # 能力没解锁就永远充不上
```

`_fold_unlocked()` 每帧查 `WorldState.has_ability("fold")`，**不做缓存**。
缓存漏刷新会变成「玩家明明捡到了纸片却跳不起来」—— 这种 bug 日志里一个字都没有，
只能靠玩家投诉。

**能力怎么给**：Room03 地面上一张折纸（蓝图 `A` + `ability=fold`），按 `U` 拾取。
`AbilityPickup.gd` 的契约和 `RestBench` 一样：只认有 `interact_requested` 信号的 body，
不硬编码 `Player` 类型。视觉是纯 `Polygon2D`（两片纸 + 一道折痕），**零新增美术**。

**这个台是本切片唯一的能力门**：顶面 y=384，地面 624，落差 **240px**。
单跳 **211.4px** 上不去，二段总高 **331.1px** 上得去，余量 91px。

台面上放着 `VistaPoint`（`vista_at=13,7`）—— 这不是随手摆的：
折叠解锁前你连台上的标签都够不着，解锁后站上去才触发眺望。
**「能力 → 地图回报」的闭环，切片里就靠这一处立住。**

闸门 `tests/test_fold_lock.gd`（六段，含一条端到端真上台）：

```bash
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot \
  --script res://tests/test_fold_lock.gd
```

**四个坑，全在测试代码里等着复用**：

1. `player.get("is_on_floor")` 返回的是**方法 Callable**（`is_on_floor` 是方法），
   `== true` 不报错、永远 false。要 `p.call("is_on_floor")`。
2. `player.get("velocity.y")` 永远是 `null` —— `velocity` 是 `Vector2` 属性，没有 `.y` 子键。
3. `--script` 入口脚本里**不能直接写 `WorldState.xxx`**（编译期 autoload 还没注册），
   而且 `_initialize` 阶段连 `/root/xxx` 绝对路径都不让取 —— 先 `await process_frame`。
4. Godot 4.7 里 `bool()` / `float()` **不能当全局构造器调**（`Nonexistent 'bool' constructor`），
   `get()` 出来的 Variant 要用显式类型标注转换。

## 一间房：入口厅（`docs/gdd/12`，2026-11-27）

**范围收成 Room01 一间。** Room02–05 冻结，生长 / 投掷 / Boss 不在本轮。
判据是按「玩家在这间房里的 90 秒」排的，不是按系统排的。

### 空间：三级台阶，出口在右上角

```
第 3 级 (y=192)                    ┌── 门（纸封/开）
第 2 级 (y=336)          ┌────────┘
第 1 级 (y=480)   ┌──────┘
地面    (y=624) ──┴────────────────────────
```

- 每级 144px，单跳 204px 有余量 —— **不是跳得极限，是跳得确定**。
- **不跳走不到右门**（蓝图头 `require_jump_to_exit=1`，生成器用「不许上升」的 BFS 验）。
  实测按住右不跳：走到 x=1202 停住，y 仍是 624。
- 实测三段跳落点：(461,480) / (636,336) / (976,192)。

### 门：看得见、会锁、锁住有纸封

`world/interactables/RoomDoor.gd`：

| 之前 | 现在 |
|---|---|
| 隐形 Area2D，只有一个偏在角落的 Label | 两个 `Polygon2D` 画的纸门（暖框 + 深洞 + 门槛） |
| 玩家看到「房间右端有根灰条」 | 一眼认出是出口 |
| 被占/清完都能走 | **被占时出口贴两道交叉米白纸封**，清完撕掉并闪一下 |

- **只锁「往前走的门」**：目标是 `SafeHouse.tscn` 的门永远开着 ——
  死亡送回不能要求玩家先把这间房清干净。
- Label 改成「往房间内侧长」：居中版在边缘门会顶出屏幕（`→ 画页二` 右半截被裁）。

### 入场教学 / 清场结论

| 组件 | 做什么 | 为什么 |
|---|---|---|
| `ui/TutorialHint.gd` | 首访一行「A/D 移动 · 空格 跳 · J 攻击」，4.2s 淡出，`story_flags` 记一次 | 之前**零提示**；常驻提示会变噪音 |
| `ui/StatusBanner.gd` | 清场喊「入口厅 · 清空」（房间名来自 `BaseRoom.display_name`） | 光波是气氛、门开是功能，缺一句玩家能复述的话 |

### HUD 只在触屏设备显示按键

六颗动作键占右半屏 40%，桌面（键鼠）也一直显示 —— 台阶和门全在按钮后面。
现在 `_ready` 里判断 `DisplayServer.is_touchscreen_available()`，没有触摸就隐藏
`RightButtonsGroup` + `BtnHeal`。**摇杆和交互键本来就是按需显示的，不受影响。**

### 闸门 `tests/test_room01_complete.gd`

17 条断言 / 8 段：进房有敌人（F0）、清过不复活（F0）、敌人分层（F3）、
门的锁与开（F4）、不跳出不去（F1）、三段跳落点（F1）、提示只出现一次（F2）、
横幅结论（F5）。

三条反向验证：`invade_on_enter=false` → FAIL 4 条；不锁门 → FAIL 1 条；
删一级台阶 → 生成器 `GEN ROOM: FAIL`（孤岛 14 个）。

## 环境光：紫月（`world/shaders/env_light.gdshader`）

被侵占的房间是**紫月**，清完是**日光**。一个 shader 管全局，不给地面出两套图。

- 挂在 `PostProcessLayer/EnvLightRect`，**排在 `DesaturateRect` 之后**：
  先变灰、再上色，紫月才照得上去。写在前面会被去色层洗掉。
- `night` 由 `BaseRoom._setup_invasion_state()` 驱动（侵占 1.0 / 清完 0.0），
  净化时与 `wipe_radius` 并行补间。**实机按 `F3` 手动开关**，可直接对比两套光照。
- 参数含义见 `art/ASSET_RULES.md §3.2.6`；校验端 `art/tools/env_light.py --check` 六条断言，
  **参数名与 shader 的 uniform 一一对应，改一边必须改另一边**。

## 资产：镜像，不是真源

Godot 只能读 `res://`（= `godot/`），所以工程里必须有一份副本：

```
真源  art/approved/            （art/README §1 定的唯一真源）
  ↓   python art/tools/sync_godot.py
镜像  godot/art/approved/      （逐字节副本 + SYNC_STAMP.txt，禁止手改）
```

```bash
python art/tools/sync_godot.py           # 同步（新增/更新，不删）
python art/tools/sync_godot.py --check   # 只比对，有漂移 exit 1
python art/tools/sync_godot.py --prune   # 连镜像里多出的文件一起删（默认不删）
```

**改了美术不 sync，Godot 里还是旧图**，而且不会有任何报错。每次 `--approve` 之后跑一次。

工程里引用的是 `res://art/approved/...`（与真源同名同层），所以两边路径一一对应。

## 已知缺口（不是待办，是如实记录）

| 缺口 | 影响 | 现在怎么办 |
| --- | --- | --- |
| `art/experiments/` 不在本地 | 4 个 `test_e04_* / test_e05_*` 跑不了（读 `res://art/experiments/`） | CI 已排除；要跑先 `git checkout origin/master -- art/experiments`（95MB） |
| `addons/dialogue_manager` 引用 `tests/test_basic_dialogue.gd` | 那是插件自带的示例测试，远端也没有 | 不影响运行，不补 |
| **草皮贴片现在像异物** | `GrassDecor` 4 块是给 40 高纯色地面设计的（带石边的方形土台）。地形自带连续草皮后，它们变成"摆在草地上的砖" | 待定：删 / 下移埋进地形 / 改成稀疏草簇。**别直接删**，`test_world_visual_swap` 会拦 |
| **地形重复周期 192px** | mid 384 宽 = 两个镜像半，1280 屏幕上重复 6.7 次，凑近看得出"这是贴的" | 美术侧问题（`art/` 出 2–3 套中间段变体）。接线本身没做错 |
| **敌人只有地面型 AI** | 变体 2（蝙蝠）走的是"正弦漂浮 + 水平靠近"，不会绕过障碍，也不会追到高台 | S0 明确不做跳跃追击；等 Boss 再单独写一套 |
| TestCombat / WhiteboxTest 没铺地形 | 那两个是白盒调试场景，不继承 `BaseRoom`，也没环境光 | 故意不铺：它们用来单看手感，地形会干扰判断 |

## 改动纪律

- 这个工程是从远端整包搬来的，**别顺手重构目录**——下次从 `DualVectorFoil` 取更新时，结构一致才合得动。
- 新增 `res://art/` 引用前，先确认文件在 `art/approved/` 里、且已 sync。
- `tests/` 里新增断言要能被 CI 的 `ls tests/test_*.gd` 捡到，否则等于没写。
