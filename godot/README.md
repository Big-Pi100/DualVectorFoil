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

# 全量（与 CI 同口径：20 套，排除 GPU/实验依赖的两类）
cd godot && for f in $(ls tests/test_*.gd | grep -vE "render_capability|test_e04_|test_e05_"); do
  "E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path . --script "res://$f" || echo "FAIL $f"
done
```

2026-11-27 在本机 4.7.2-stable 实测：`--import` 通过，20 套断言 **PASS=20 FAIL=0**。
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
│  ├─ interactables/      RestBench / RoomDoor / SoilPlot / VistaZone
│  ├─ tiles/              **gen_tileset.gd** 生成 ground_tileset.tres（96×144，3 source / 6 块）
│  │                      **apply_ground.gd** 给房间挂 TileMapLayer（幂等，可重跑）
│  └─ shaders/            boiling_line / desaturate_wipe / paper_grain / **env_light**
├─ ui/                    DialogueBalloon / TouchHUD / TravelJournal
├─ dialogue/              StoryDirector + 3 个 .dialogue 剧本
├─ addons/dialogue_manager/  第三方对话插件（118 文件，勿手改）
├─ tests/                 24 个 test_*.gd（CI 跑 20 个）
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

## 地面：真地形贴图 + 端头留给以后的坑

7 个房间的 `Floor` 原来只有一个 40 高的 `ColorRect` 纯色块，那批地形贴图一张没进游戏。
2026-11-27 换成 `TileMapLayer`：

```
Floor (640, 620)    碰撞 1200×40 → 地面顶 y=600
└─ Visual           原 ColorRect，保留作兜底与退路（摘掉图层就退回色块）
└─ GroundTiles       TileMapLayer，position (-640, -20) ⇒ tile(0,0) 左上角落在 (0,600)
└─ GrassDecor0..3    草皮贴片（旧设计遗留，见「已知缺口」）
```

- 全部用 **mid** 横铺 14 块 = 1344px，屏幕 1280 铺满，右侧 64 裁在屏外
- **不用 left / right**：7 个房间地面都是整条连续，没有坑或断崖。端头瓦片是圆石收口，
  插在连续地面中间会露出来。它们已经生成进 TileSet，留给以后做坑——那时就是坑的两壁
- 重跑：`python art/tools/seam_check.py --tile` 验接缝 → 改图后
  `godot --headless --path godot --script res://world/tiles/gen_tileset.gd` →
  `... --script res://world/tiles/apply_ground.gd`

**改这两个脚本前先知道两件事**（都写进注释了）：

1. 动态 `add_child` 的节点**必须设 `owner`**，否则 `pack()` 静默丢弃 —— 而
   `ResourceSaver.save` 照样成功、文件照样变，只有回读才知道节点不在里面。
2. 回读**必须 `CACHE_MODE_IGNORE`**：`load()` 命中缓存，刚存的路径读回来是旧的，
   于是自测自己报 FAIL 而文件其实是对的。验证手段比被验证的东西更不可靠。

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
| TestCombat / WhiteboxTest 没铺地形 | 那两个是白盒调试场景，不继承 `BaseRoom`，也没环境光 | 故意不铺：它们用来单看手感，地形会干扰判断 |

## 改动纪律

- 这个工程是从远端整包搬来的，**别顺手重构目录**——下次从 `DualVectorFoil` 取更新时，结构一致才合得动。
- 新增 `res://art/` 引用前，先确认文件在 `art/approved/` 里、且已 sync。
- `tests/` 里新增断言要能被 CI 的 `ls tests/test_*.gd` 捡到，否则等于没写。
