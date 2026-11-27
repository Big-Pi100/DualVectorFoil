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

## 跑

```bash
# 直接玩（主场景 SafeHouse）
"E:/godot/Godot_v4.7.2-stable_win64.exe" --path godot

# 无头跑单个测试
"E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/test_hitbox_contract.gd

# 全量（与 CI 同口径：19 套，排除 GPU/实验依赖的两类）
cd godot && for f in $(ls tests/test_*.gd | grep -vE "render_capability|test_e04_|test_e05_"); do
  "E:/godot/Godot_v4.7.2-stable_win64_console.exe" --headless --path . --script "res://$f" || echo "FAIL $f"
done
```

**本机没装 Godot 时**：本地验证只剩静态检查（引用扫描 + `sync_godot.py --check`），
真正的跑通要靠 CI（`.github/workflows/build-web.yml` 会先 `--import` 再跑 19 套断言，全绿才出包）。

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
│  └─ shaders/            boiling_line / desaturate_wipe / paper_grain / **env_light**
├─ ui/                    DialogueBalloon / TouchHUD / TravelJournal
├─ dialogue/              StoryDirector + 3 个 .dialogue 剧本
├─ addons/dialogue_manager/  第三方对话插件（118 文件，勿手改）
├─ tests/                 23 个 test_*.gd（CI 跑 19 个）
└─ art/approved/          ← 根 `art/approved/` 的**只读镜像**，不要手改
```

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
| 本机没有 Godot | 本地无法 `--import` / 跑测试 | 靠 CI 验证 |

## 改动纪律

- 这个工程是从远端整包搬来的，**别顺手重构目录**——下次从 `DualVectorFoil` 取更新时，结构一致才合得动。
- 新增 `res://art/` 引用前，先确认文件在 `art/approved/` 里、且已 sync。
- `tests/` 里新增断言要能被 CI 的 `ls tests/test_*.gd` 捡到，否则等于没写。
