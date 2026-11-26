# Godot 4.7.2 工程 · 二向箔

**唯一开发主线**（2026-11-26 白哥定）。所有新功能只写这里。
`../src/`（web 原型）已**冻结为行为基线**，不再演进——它的 424 项断言与手感标定值是这边的对照物。

> **引擎版本已定版：Godot 4.7.2-stable（build `ed1daf0bf`）**，2026-11-26 从 4.4.1 升级。
> 与美术规范的验证环境（`art/ART_GUIDE.md` 头部）对齐，不再维护"规范 4.7 / 工程 4.4"的双口径。
> 定版理由、升级实测、拒绝其他版本的理由：`../docs/gdd/07 §9`。跑错版本会被
> `tests/env_check.gd` 拦住——**别用别的版本打开这个工程**，手感数字会静默失准。

> 为什么转过来、迁移顺序、代价（测试覆盖 424 → 44）：`../docs/gdd/07 §10`。

## 怎么打开

**Godot 编辑器里要选 `godot/` 这个目录**，不是仓库根目录：

```
E:\IdentityCard\game-soulkeep\godot\
```

本机编辑器：`E:\godot\Godot_v4.7.2-stable_win64.exe`

> 仓库根目录没有 `project.godot`，Godot 认不出来——那不是配置问题，是两套工程。

## 跑

```bash
# 0. 先验引擎对不对（2 秒，跑错版本后面全是白测）
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/env_check.gd

# 直接玩
"E:/godot/Godot_v4.7.2-stable_win64.exe" --path godot

# 手感验证（无头，量跳高/速度，跟 web 基线对账）
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/feel_smoke.gd

# 两套预设实测对照（满跳 / 轻点跳 / 加速帧数 / 翻滚位移）
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/feel_compare.gd

# F1 / F2 切换链路是否真的通
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/preset_key.gd

# 战斗组件 + 存档（无头）
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/combat_smoke.gd

# 沸腾线 shader：先出两帧，再比对（比对脚本是 Python）
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --path godot --script res://tests/boil_shot.gd
python godot/tests/boil_check.py

# 渲染快照（必须带窗口，headless 是 dummy 渲染器出不了图）
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --path godot --script res://tests/shot.gd
```

## 当前完成度

| 模块 | 状态 |
|---|---|
| 工程骨架 / 分辨率 960×540 / 120Hz 物理 | ✅ |
| **引擎版本定版 4.7.2 + 守卫测试** | ✅ `tests/env_check.gd` 8 项断言，跑错版本直接红 |
| 玩家：跑 / 摩擦 / 跳 / 二段跳 / 顶点滞空 / 松手切断 | ✅ 手感已标定 |
| 两套手感预设：F1 aos（定版）/ F2 crayon（参考） | ✅ 可热切换，HUD 显示实测峰值 |
| 翻滚 / 后跃（aos=后跃、crayon=前滚） | ✅ 可玩，无敌帧未接 Hurtbox |
| 动画状态机（stand/walk/jump/fall/crouch） | ✅ 5 个状态 |
| 背景 + 地面 + 平台 + 碰撞 | ✅ 单屏测试房 |
| 战斗组件：Hitbox / Hurtbox / 局部顿帧 | ✅ 组件就绪 + 有测试，**未接到玩家** |
| 全局状态 + 存档（WorldState） | ✅ 逻辑就绪 + 有测试，**未接 UI** |
| 沸腾线 shader | ✅ 已挂背景，两帧比对通过 |
| 相机跟随 / 多房间 | ❌ |
| 攻击 / 蹲 / 滑铲 / 冲刺 / 能力门 / 敌人 | ❌ |
| 存档 UI / 音频 | ❌ |

## 手感参数：为什么和 web 版不一样

参数逐字照抄 `src/game.js` 的 `aos` 预设，**只有跳跃初速改过**：

| | web 版 | Godot 版 |
|---|---|---|
| `P_JUMP_V` | 971.3 | **991.0** |
| 实测满跳 | 203.8 px | **203.9 px** |

原因：web 是半隐式欧拉，Godot 的 `move_and_slide` 积分次序不同，同一初速只跳到 195.8px。
按 √(203.8/195.8) 反算补到 991，实测差 0.1px。

**这就是"换积分器必须重新标定"**——原项目 `src/game.js` L83-89 写过同一件事。
改任何跳跃/重力数值后，必须重跑 `tests/feel_smoke.gd`，别看代码推。

其余参数（照抄未改）：`SPD_RUN 270`、`P_GRAV 2362`、`P_MAX_FALL 1260`、
`FRIC_G 1350`、`FRIC_A 675`、`APEX_LO/HI -22.5/67.5`、`APEX_MUL 0.2`、`CUT_V 400`、`JBUF 3 步`。

## 两套手感预设：F1 / F2

`player.gd` 里有**两套完整预设**，游戏内按键直接切，HUD 左上角显示当前数值和本次跳跃最高点：

| 键 | 预设 | 是什么 |
|---|---|---|
| `F1` | `aos` | 本项目定版，默认 |
| `F2` | `crayon` | 《色彩旅人》GDD 的 `@export` 值，逐字抄，**只用于对比** |

原文归档在 [`../docs/ref/CRAYON_ODYSSEY_GDD.md`](../docs/ref/CRAYON_ODYSSEY_GDD.md)。

### 实测对照（`tests/feel_compare.gd`，120Hz）

| 项目 | aos（定版） | crayon（参考） |
|---|---|---|
| 满跳高度 | 203.9 px | 85.2 px |
| 轻点跳（按 4 帧） | 56.1 px | 85.2 px（无松手切断，点一下就满） |
| 水平稳态速度 | 270 px/s | 280 px/s |
| 0 → 满速 | 1 帧（瞬间） | 15 帧（2200 px/s²） |
| 松手 → 停 | 24 帧 | 14 帧 |
| 翻滚位移 | 99.1 px | 146.0 px |
| 翻滚峰值速度 | 535（后跃，朝背后） | 460（前滚） |

crayon 理论跳高 480²/(2×1323) = 87.1，实测 85.2 —— 差的是离散积分误差，不是抄错。

### 差的不只是数字，还有模型

- aos 是**一帧到满速 + 松手摩擦**（`accel = 0`），crayon 是**加速到满速**（`accel = 2200`）。
  只抄 280 却保留"一帧到满速"，得到的是第三种手感，不是其中任何一套。
- aos 有**顶点滞空**（重力 ×0.2）和**松手切断**（上升速度压到 400），crayon 都没有。
  所以预设里带的是**开关**（`apex` / `cut` / `accel`），不是孤立数字。

### 两处故意没照抄（那是 bug，不是手感）

1. 翻滚时 `velocity.y = 0` —— 空中翻滚会悬停 0.26 秒。这里只在地面清零，空中继续下落。
2. 翻滚无敌只在本体记账（`is_invincible()`），**没接到 Hurtbox** —— 现在没有敌人，接了是空转。

## 目录

```
godot/
├─ project.godot      工程配置（960×540 / 120Hz / **linear 过滤**）
├─ core/              全局底层（新代码按此分层，旧的 scenes/ scripts/ 待统一迁）
│  ├─ world_state.gd  Autoload：flags / unlocked / visited / steps + JSON 存档
│  ├─ hitstop.gd      局部顿帧（不用 Engine.time_scale）
│  └─ components/
│     ├─ hitbox.gd    攻击判定：一次激活每个目标只结算一次
│     └─ hurtbox.gd   受击判定：只转发，扣血交给实体
├─ world/shaders/
│  └─ boiling_line.gdshader   手绘沸腾线（整帧微位移）
├─ scenes/
│  ├─ main.tscn       单屏测试房：渐变天 + 草板地面 + 两块石台 + 摆件 + HUD
│  └─ player.tscn     CharacterBody2D + Sprite2D + 碰撞盒 28×100
├─ scripts/
│  ├─ player.gd       玩家控制器（两套预设：aos / crayon，F1/F2 切）
│  └─ feel_hud.gd     左上角调试面板（英文，默认字体没有中文字形）
├─ tests/
│  ├─ feel_smoke.gd   手感对账：跳高 / 水平速度 / 摩擦 / 轻点跳
│  ├─ feel_compare.gd 两套预设实测对照
│  ├─ preset_key.gd   F1 / F2 切换链路
│  ├─ combat_smoke.gd 战斗组件 + 存档：单次结算 / 击退方向 / 顿帧 / 坏档
│  ├─ boil_shot.gd    沸腾线出两帧（挂在地面草板上）
│  ├─ boil_check.py   两帧比对（平坦区不动 / 边缘在动 / 无黑边）
│  ├─ asset_wiring.gd 资产接线守卫：旧路径清零 / ANIM 全可加载 / 镜像新鲜度
│  ├─ env_check.gd    引擎与渲染配置守卫
│  └─ shot.gd         渲染快照 → ../shots/godot_smoke.png
└─ assets/
   └─ art/             art/approved/ 的**单向镜像**（42 个文件，19 MB）。不要手改
```

坐标约定：**节点原点 = 脚底中心**。碰撞盒在原点上方 `(0,-50)`。

精灵锚点按 `ART_GUIDE §12.2` 的唯一口径算，不要另推：素材帧框 340×340、
主体高 251、脚底基线 `y=295`，显示高取 128（web 原型 `P_SPRITE_H`）→

```
scale  = 128 / 251 = 0.51
offset = -(295 - 340/2) = -125     # 纹理像素，随 scale 一起缩
```

所以 `player.tscn` 里是 `scale=(0.51,0.51)` / `offset=(0,-125)`。**别用帧框中心对齐**：
帧框上下留白不对称（上 45 px、下 45 px 里主体只占 251），中心对齐会让脚陷进地面 22 px。

## 渲染设置：为什么是 linear 不是 nearest

`textures/canvas_textures/default_texture_filter=1`（Linear）。

蜡笔是**连续色调**，不是像素画。设成 nearest 会让笔触放大后出硬锯齿，
亚像素位移也会被切成孤立跳变（沸腾线实测成片率只有 31%）。改 linear 后
同一份 shader 平均差从 8.26 降到 1.90，笔触干净。

## 别人的 GDD 评审

收到过一份类似的 Godot 4.4 GDD/TDD（附完整 Player.gd + shader）。
**哪些能学、哪四处照抄会炸**，见 [`../docs/ref/OTHERS_GDD_REVIEW.md`](../docs/ref/OTHERS_GDD_REVIEW.md)。
要点：technical 骨架可学（Hitbox/Hurtbox、状态单例、数据驱动），
但它的**跳跃数值（87px）是我们的 2.3 分之一**、顿帧用 `Engine.time_scale`、
抓边直接改坐标、状态推进用 `await` —— 这四条搬进来会出真 bug。

**它的数值已经逐字抄成 `F2` 预设**，不是为了采用，是为了让你按键就能判断
"这套尺子在我们关里是什么感觉"——玩一下右上那块平台（离地 102px）就明白了：
aos 上得去，crayon 上不去。

## 资产同步

`assets/art/` 是 `art/approved/` 的**逐字节副本**，不是软链（Godot 只能读 `res://`，
软链在 Windows 要开发者模式、导出包里还会断）。方向永远单向：

```bash
python art/tools/sync_godot.py           # 同步（新增/更新，不删）
python art/tools/sync_godot.py --check   # 只比对，有漂移 exit 1
python art/tools/sync_godot.py --prune   # 连「镜像里多出的文件」一起删（默认不删）
```

每次同步重写 `assets/art/SYNC_STAMP.txt`（源 commit / 时间 / 文件数 / 清单）。
`tests/asset_wiring.gd` 会核对 stamp 与实际文件数 —— 美术重出但忘了 sync，这里会红。

**旧产线（`art/hero/` `art/tiles/` `art/bg/`）不进 Godot。** 2026-11-26 起全部换到
`art/approved/`，`assets/hero|tiles|bg` 三个目录已从工程里删除；旧 31 帧仍完整留在
`art/hero/` 作历史证据，需要回滚时从那里取。

## 下一步（按顺序）

1. 相机跟随 + 房间边界限制（单屏 → 滚动）
2. 攻击（`player_attack_00_sprite`）+ 受击（`player_hurt_00_sprite`）—— **图已有，只差状态机**
3. 补 4 个缺帧：蹲 / 下落 / 后跃 / 施法。现在靠回退（见 `player.gd` ANIM 注释）
4. 可平铺地形瓦片 —— `Terrain/` 全是立体摆件，铺 tilemap 会露缝（`ART_GUIDE §12.2.2`）
5. 房间数据化（把 web 版 `room.g` 字符地图搬过来，用 TileMapLayer）
6. 敌人（3 张 sprite 直接可用）+ 存档 + UI

移植顺序的理由：**先把手感钉死，再铺内容**。手感一旦在 Godot 里对不上，
后面所有关卡设计都会建立在错的跳跃距离上。
