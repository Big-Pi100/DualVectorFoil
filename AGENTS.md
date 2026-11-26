# 项目开发规范：《二向箔》 (Dual Vector Foil)

## 1. 核心定位与技术基准
- **项目名称**：《二向箔》 (Dual Vector Foil)
- **引擎版本**：Godot 4.7.2-stable（2026-11-26 从 4.4.1 升级，18 套断言/379 项全绿零回归；严格使用静态类型 GDScript 2.0，禁止混用 C#，禁止使用 Godot 3 或 4.0~4.2 已废弃 API）。可执行文件 `E:/godot/Godot_v4.7.2-stable_win64.exe`（4.7 起 Windows 只发单一 exe，headless 用同一二进制加 `--headless`，不再有单独的 `_console.exe`）。
- **核心体验**：2D 蜡笔彩色童趣风箱庭探索 + 轻量化《重生细胞》爽快动作手感（低难度、高容错、零挫败感）+ 原位种地生长转化战力 + 温和黑白入侵守护。
- **平台适配**：移动端（iOS/Android 触屏）优先，基础视口分辨率 `1280x720`，Stretch Mode 为 `canvas_items`，Aspect 为 `expand`。

## 2. 工程架构与解耦约定
- **目录结构**：
  - `res://core/`：全局单例（`WorldState.gd`, `SceneTransition.gd`, `AudioManager.gd`）与通用组件（`Hitbox.gd`, `Hurtbox.gd`, `StateMachine.gd`）。
  - `res://entities/player/` & `res://entities/enemies/`：角色与敌人实体。
  - `res://world/rooms/`：独立手工箱庭房间场景（`.tscn`）。
  - `res://world/interactables/`：魔法花坛（`SoilPlot`）、眺望点（`VistaZone`）、捷径门锁。
  - `res://world/shaders/`：手绘沸腾线、纸纹叠加与去色恢复着色器。
  - `res://data/`：自定义 `Resource`（`.tres`）武器与作物配置文件。
  - `res://ui/`：自适应触屏 HUD 与折叠画卷旅行手账。
- **通信原则**：优先使用 `Signal` 解耦，禁止深层硬编码路径（如 `get_node("../../...")`）。所有跨房间状态（剧情、农田进度、入侵标记）统一读写 `WorldState` 单例。
- **转场唯一入口**：任何房间切换（门、死亡送回、剧情传送）必须走 `SceneTransition.change_room()`，禁止直接 `get_tree().change_scene_to_file()`。`SceneTransition` 是 Autoload 场景（`CanvasLayer`+全屏 `ColorRect`）；因 Autoload 同名冲突，**禁止给它加 `class_name`**。死亡送回用 `force=true` 抢占进行中的转场。
- **零惩罚失败与休息点**：`Player.respawn_requested` 由 `BaseRoom` 统一接管——安全屋内原地复位，野外走 `SceneTransition` 送回 `WorldState.last_rest_scene_path` / `last_rest_spawn_marker`。最近休息点只由 `WorldState.set_rest_point()` 写入，长椅调用后回满血与颜料瓶并广播 `rested`，供存档 / 战力转化挂载。
- **存档**：`WorldState.save_game()/load_game()` 写 `user://save_data.json`，load 后必须重广播 `plot_updated` / `power_stat_changed` / `rest_point_changed` 同步已存在实体；JSON 反序列化后须显式恢复 `Array[String]` 与农田 Dictionary 类型。

## 3. 玩法与系统死规矩
- **美术基准唯一性**：所有角色/敌人/场景资产以 `art/reference/character_style_sheet.jpg` 为唯一视觉基准，完整规范与实验门禁见根目录 `ART_GUIDE.md`（v1.3），正式生成固定前缀为 `art/prompts/Master_v1.3.md`，项目名与前缀统一为《二向箔》/ `DUAL VECTOR FOIL`（SoulKeep 仅为历史兼容代号，不得用于新资产）。未经确认不得引入第二张风格参考图；未通过对应门禁的实验素材不得进入 `art/approved/` 或游戏场景。洋红底与青色分隔线是生成/抠图临时技术色，不得进入正式资产；主角红围巾、粉脸颊抠图必须按 `ART_GUIDE.md` 9.6 防污染，避免误删主体细节。p5.brush 仅限离线制作，不得成为运行时依赖。
- **操作复刻《重生细胞》**：严格按照《重生细胞》移动版设计操作逻辑：左侧浮动摇杆（支持下蹲与单向平台下穿）+ 右侧 6 动作键（主攻击、副武器/格挡、跳跃、翻滚、技能1、技能2）+ 动态互动键 + 长按血瓶。翻滚与格挡必须能打断常规攻击后摇；**翻滚方向相关**（按当前输入方向翻滚，无输入才沿用朝向，支持攻击后摇中后撤），**格挡只挡身前**（判定体与盾牌视觉都在朝向侧，背后攻击可命中）；空中支持下砸攻击（下+跳），并兼容键盘全套快捷键调试。
- **PC 调试键位（左右手均衡，禁用 F/E/H/Shift）**：左手 `A/D/W/S` 移动（`S` 下穿/下砸）、`Space` 跳跃（拇指最高频）、`Q` 血瓶（小指补位）；右手 `J` 主攻击、`K` 格挡/副武器、`L` 翻滚、`U` 互动、`I` 技能1、`O` 技能2；`M` 折叠画卷手账开合（全局 Autoload `TravelJournal`，打开暂停世界、合上恢复）。方向键保留为移动别名、鼠标左右键保留为攻击/格挡别名。常用：`A/D/Space/J/K/L`；不常用：`W/S/Q/U/I/O/M`。新增 PC 键位必须同步 `project.godot` 的 Input Map、本条规范与 `tests/test_input_layout.gd` 三处。
- **移动端适配（真机调优）**：帧率分档统一走 `MobileTuner` Autoload（桌面 0 / 移动 60 / 低端 30，`mobile`/`low_end` feature 自动选档 + `apply_profile()` 手动覆盖 + `profile_applied` 信号），禁止在场景脚本里散写 `Engine.max_fps`。触屏动作键触控区一律 ≥96×96 视口单位（1280×720 基准），按下必须有视觉反馈；摇杆只认左半屏且按 `touch.index` 锁定，多指不得串台。真机帧率/手感须在导出设备上实测，headless 只守代码层契约。
- **出包（GitHub Actions）**：仓库 `github.com/Big-Pi100/DualVectorFoil`，`.github/workflows/` 三条流水线照 CoEvo 纪律——**只 `workflow_dispatch` 手动触发**（贵/不可回退管道不自动跑）、**钉死 `GODOT_VERSION=4.7.2-stable`** 与导出模板版本完全对齐、**体检断言产物本身**（`index.wasm`/`index.pck`/`classes.dex`/`Info.plist` + 大小下限）而非只看退出码，拒绝「绿但没包」的假绿。`export_presets.cfg` 预设名大小写/空格敏感，`--export-release "Web"` 必须逐字匹配；预设 `exclude_filter` 排除 `art/experiments/*` 等实验资产。**Android 必坑**：项目必须开 `rendering/textures/vram_compression/import_etc2_astc=true`，否则 Godot 拒绝导出 APK（本地与 CI 均实测）。**GitHub 私有仓库 Free 额度不足时 runner 秒失败且 steps=0**（无日志、runner_id=0），public 仓库不受影响——遇此现象先查可见性/额度，别误判为 workflow 语法问题（本仓库曾因此把 workflow touch 重推三次）。iOS 签名凭据只放 GitHub Secrets，禁入仓库。
- **原位种植（`SoilPlot`）**：作物生长监听全局房间切换步数推进，禁止绑定现实时间挂机。
- **温和入侵（Non-punitive Invasion）**：入侵仅暂停对应地块生长并触发房间灰度去色视觉特效，**严禁销毁或永久扣除玩家已种作物**。
- **剧情系统（Dialogue Manager 复用）**：复用官方 `nathanhoad/godot_dialogue_manager` **v3.10.5**（MIT，支持 Godot 4.4）置于 `addons/dialogue_manager/`，已剔除 4 个 `.cs` 文件守「禁 C#」铁律，保留 LICENSE 署名。仅以 Autoload 注册 `DialogueManager`（**不启用 editor_plugins**——其 `plugin.gd` 在 4.4 有 preload 语法不兼容，且运行时不需要）。**v3.10.5 已在 Godot 4.7.2 下全量实测通过（对话专项 30 项），无需因升级引擎而换成 v4。**剧本为 `dialogue/*.dialogue` 纯文本，由 `StoryDirector` 用 `create_resource_from_text()` 运行时编译，绕开未启用导入器时 `.dialogue` 不生成 Resource 的限制。剧情状态只写 `WorldState.story_flags`，开篇 flag 为 `prologue_seen`。
  - 🔴 **剧本语法坑（开篇实测）**：分支选项必须连续写 `- A => title_a` / `- B => title_b`，再各自定义 `~ title_a` / `~ title_b` 段落；**严禁在选项之间夹 `=> END`**，否则 Dialogue Manager 会把后续 `- ` 行归入前一个选项的嵌套分支，导致同一层只剩 1 个选项。
  - 🔴 **选项挂载位置坑（灯塔实测）**：Dialogue Manager 把一行中的选项挂在**最后一句对话**上，`get_next_dialogue_line(res, "start")` 返回的是第一行；若标题下有多行铺垫，首行 `responses` 为空属正常，需沿 `next_id` 推进到带选项的那行再断言/渲染（运行时玩家也是看完铺垫才见选项）。别误判为「剧本选项丢失」。
  - 🔴 **插件 API 坑**：`DialogueLine`/`DialogueResponse` 是 `RefCounted`，其 `get()` 是 `Object.get()` 只收 1 参数——取字段须 `obj.get("is_allowed")` 或直接属性访问，禁止 `obj.get("x", default)` 两参写法（会 SCRIPT ERROR）。
  - 开篇自动播放只在 `get_tree().current_scene == 宿主房间` 时触发（`StoryAutoStart`），headless 测试实例化的房间不是 current_scene → 零污染既有测试。

## 4. AI 协作执行流程
1. **先设计结构再写代码**：新建任何场景或功能前，必须先输出推荐的 Godot 4.7.2 节点树层级与信号连接说明，确认后再编写 `.gd` 代码。
2. **小步快跑**：每次仅实现或修改一个独立模块，附带测试方法，确保零语法警告。
3. **参数可视化**：所有移动手感、顿帧时长、镜头缩放与生长步数参数必须使用 `@export` 暴露到检查器。
