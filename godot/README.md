# Godot 4.4 工程 · 二向箔

web 原型（`../src/game.js`）的 Godot 移植。**这是正式发行形态的起点**。

## 怎么打开

**Godot 编辑器里要选 `godot/` 这个目录**，不是仓库根目录：

```
E:\IdentityCard\game-soulkeep\godot\
```

本机编辑器：`E:\godot\Godot_v4.4.1-stable_win64.exe`

> 仓库根目录没有 `project.godot`，Godot 认不出来——那不是配置问题，是两套工程。

## 跑

```bash
# 直接玩
"E:/godot/Godot_v4.4.1-stable_win64.exe" --path godot

# 手感验证（无头，量跳高/速度，跟 web 基线对账）
"E:/godot/Godot_v4.4.1-stable_win64_console.exe" --headless --path godot --script res://tests/feel_smoke.gd

# 渲染快照（必须带窗口，headless 是 dummy 渲染器出不了图）
"E:/godot/Godot_v4.4.1-stable_win64_console.exe" --path godot --script res://tests/shot.gd
```

## 当前完成度

| 模块 | 状态 |
|---|---|
| 工程骨架 / 分辨率 960×540 / 120Hz 物理 | ✅ |
| 玩家：跑 / 摩擦 / 跳 / 二段跳 / 顶点滞空 / 松手切断 | ✅ 手感已标定 |
| 动画状态机（stand/walk/jump/fall/crouch） | ✅ 5 个状态 |
| 背景 + 地面 + 平台 + 碰撞 | ✅ 单屏测试房 |
| 相机跟随 / 多房间 | ❌ |
| 攻击 / 冲刺 / 蹲 / 滑铲 / 能力门 / 敌人 | ❌ |
| 存档 / UI / 音频 | ❌ |

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

## 目录

```
godot/
├─ project.godot      工程配置（960×540 / 120Hz / nearest 过滤）
├─ scenes/
│  ├─ main.tscn       单屏测试房：背景 + 地面 + 两个平台
│  └─ player.tscn     CharacterBody2D + Sprite2D + 碰撞盒 28×100
├─ scripts/player.gd  玩家控制器（aos 手感）
├─ tests/
│  ├─ feel_smoke.gd   手感对账：跳高 / 水平速度 / 摩擦 / 轻点跳
│  └─ shot.gd         渲染快照 → ../shots/godot_smoke.png
└─ assets/            从 art/ 复制的 PNG（hero 10 状态 + 瓦片 + 背景）
```

坐标约定：**节点原点 = 脚底中心**。碰撞盒在原点上方 `(0,-50)`，精灵 `offset=(0,-64)`。

## 资产同步

`assets/` 是从 `../art/` 复制的副本，不是软链。美术重出后要重新复制：

```bash
cp ../art/hero/hero_*.png assets/hero/ && rm -f assets/hero/*_proof.png
cp ../art/tiles/{wall,floor}_*.png assets/tiles/
cp ../art/bg/bg_hall.png assets/bg/
```

## 下一步（按顺序）

1. 相机跟随 + 房间边界限制（单屏 → 滚动）
2. 攻击（`hero_attack` 4 帧）+ 受击
3. 蹲 / 滑铲 / 冲刺（贴图和状态机都已就位，只差逻辑）
4. 房间数据化（把 web 版 `room.g` 字符地图搬过来，用 TileMapLayer）
5. 敌人 / 存档 / UI

移植顺序的理由：**先把手感钉死，再铺内容**。手感一旦在 Godot 里对不上，
后面所有关卡设计都会建立在错的跳跃距离上。
