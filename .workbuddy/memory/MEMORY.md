# 项目长期笔记：《二向箔》(Dual Vector Foil)

## 项目基准（以 GDD.md / AGENTS.md 为准，权威文档在根目录）
- 引擎：Godot 4.7.2-stable（2026-11-26 从 4.4.1 升级，实测 18 套/379 断言全绿零回归），GDScript 2.0 静态类型；禁 C#、禁 3.x / 4.0~4.2 废弃 API。可执行文件 `E:/godot/Godot_v4.7.2-stable_win64.exe`（4.7 起 Windows 只发单一 exe，headless 加 `--headless` 即可，无 `_console.exe`）。
- 平台：移动端（iOS/Android 触屏）优先；视口 1280x720，Stretch Mode = canvas_items，Aspect = expand。
- 体验：2D 蜡笔童趣绘本风箱庭探索 + 轻量《重生细胞》手感（低难度、高容错、零挫败）+ 原位种植转化战力 + 温和黑白入侵守护。

## 不可违反的铁律（AGENTS.md）
1. 通信用 Signal 解耦，禁止 `get_node("../../...")` 深层路径；跨房间状态统一走 `WorldState` 单例。
2. 作物生长只认**房间切换步数**，禁止绑定现实时间挂机。
3. 入侵**只暂停生长 + 灰度去色特效**，严禁销毁/永久扣除已种作物。
4. AI 协作流程：先输出节点树与信号设计 → 确认 → 再写 `.gd`；一次一模块 + 测试方法 + 零警告；手感参数全部 `@export`。

## 美术风格定稿（2026-11-26 白哥确认）
- 视觉基准图：`art/reference/character_style_sheet.jpg`（蜡笔风格少年游戏角色设定表，含主角三视图 / 动作展示 / 表情表 / 敌人设定 / 场景元素）。后续所有角色、敌人、场景美术以此图为准。
- 主角识别点：蓬松棕橙蜡笔短发、红围巾、白/米色上衣带黄色星星、蓝色斜挎包与短裤、棕色靴子；线条抖动笔触、米白纸纹底、高饱和蜡笔平涂。
- 完整规范：`ART_GUIDE.md`（**v1.3** 为唯一有效）。核心：密集蜡笔笔触是构成形体的绘画过程，非后期噪点；v1.0「简单大色块」已废止。正式前缀 `art/prompts/Master_v1.3.md`，项目名/前缀统一为《二向箔》/ DUAL VECTOR FOIL（SoulKeep 仅历史兼容，v1.2 prompt 已标废弃）。门禁 G0→E01→E02→E03→E04→G5，每阶段 ≥3 独立样本（禁一张裁三张）+ 6 项通用 + 阶段专项评分（关键项 <4 即 REWORK，N/A 不当通过），未过门禁不得进 `art/approved/`。**进度：G1/G2/G3/G4/G5 全 PASS（2026-11-26），生产准入已开放**。E04 已关闭 O1 石块观察项。G5 补齐主角 back/jump/attack/hurt/climb + 4 特效 + 3 UI，精灵帧 340×340 脚底锚点差 0，29 张入库 `art/approved/` + manifest。批量生产仍须走固定流程（单帧参考/STRICT 双肢/P1–P11/特效裁紧/Godot 尺寸链/入库终检），G5 开放≠免检。
- Godot 验证法（可重跑）：`tests/test_e04_game_scale.gd` 用真实 Godot 4.4.1 的 Image API 复现游戏缩放链（headless 下 SubViewport 截图不可靠）；尺寸主角72/敌人48/道具36/地形200px + 75%压力；结果洋红0/白边1px/色边无。G5 新增 `tests/test_e05_g5_sprites.gd`（精灵帧一致性+12资产尺寸链）与 `tests/test_e05_g5_scene.gd`（PackedScene 实例化 12 Sprite2D 走真实导入链）。两坑：① Dictionary 取值用 `:=` 触发 Variant 警告当错误，须 `var x: int = dict[...]`；② `--script` 不触发 PNG 导入，场景测试前须 `--editor --quit-after 3` 生成 .import，否则纹理全 null。正式抠图工具 `art/tools/extract_magenta.py`（P1/P4/P8-P11）。
- 🔴 F12（G5 实测）：生成器可能只让特效主体占画布极小比例（`fx_purify` 仅 16%），缩到游戏尺寸不可辨 → 入库前必须把特效裁紧到主体 bbox + 12% 边距，再走 Godot 尺寸链。静态大图看不到，与 F11 同类。
- 🔴 F13（G5 返工×2，白哥验收发现）：**角色精灵严禁烘焙场景元素**（墙/石柱/草/地面/梯子）。`climb` 首版带整面石墙+脚底草（参考图取自带墙母版格 + prompt 写了 "climbing a stone wall"）。**返工①纯文字去场景却丢了 `image1` 参考图 → 人物漂移（头变小、脸型发型全变），白哥二次指出。返工②（最终 v3）：空间分离把老带墙图 P 成纯人物攀爬参考图（墙右/人左、手区肤色判据、绿色判据删草），再 `image1` 参考 + NO-SCENERY prompt 重生成** → 人物回母版、无墙草、帧宽与其他帧一致。
  - 🔴🔴 **铁律：禁场景 ≠ 丢人物参考图**。动作资产即使禁场景也必须用参考图锁长相；参考图残留场景碎色会被生成器放大（手上灰绿轮廓），须先 P 干净。尺寸测试测不出长相漂移，靠人眼对比 5 帧接触单。prompt 写 `ABSOLUTE NO-SCENERY RULE` 显式列禁物 + 声明轮廓外只有洋红底。入库终检逐张确认角色轮廓外无场景色块 + 长相与已入库帧一致。
- 🔴 P10/P11（E04 实测，静态评审看不到）：P9 背景采样必须排除右下水印区（四角会落在水印上污染 median）；**alpha=0 像素 RGB 残留洋红会被 Godot BILINEAR 插值混进半透明边缘造品红边**，必须对删除像素做最近邻颜色扩散。生成器每张洋红底色都不同，禁死阈值。
- 🔴 编译顺序坑（VistaZone 实测）：**`--script` 模式下，带 `class_name` 的新全局类脚本若在编译期直接引用 Autoload 标识符（`WorldState.xxx`），会 `Identifier not found: WorldState` 编译失败，场景静默退化为裸节点**。Player.gd 等既有场景脚本在编辑器注册后才编译，不受影响——只在「新全局类 + headless 测试」组合下暴露。修法：运行时 `get_tree().root.get_node_or_null("WorldState")` + `call()`；测试也别用 `is NewClass` 触发提前编译，改 `has_signal()` 运行时检查。
- 抠图铁律（9.6）：洋红 #FF00FF / 青 #00FFFF 只是生成辅助色，禁入正式资产；红围巾/粉脸颊同洋红色相区，必须 flood-fill 仅删边缘连通洋红 + 纸白间隙为颜料非洞 + despill 去品红边 + 三种背景/Godot 缩放复核；主角一律单资产单图，禁多格分隔线。
- 抠图实测（9.6.1/9.6.2，已两次验证）：生成器洋红底**每张颜色都不同**（如 239,29,168 / 240,12,138 / 244,45,155 / 247,14,159），禁死阈值，必须逐图四角实测 + flood-fill 容差 90；红围巾暖红像素与背景色距 <90，全局替换会整片误删，必须用连通域；生成工具强制右下角"AI生成"水印不与背景连通，抠图前按 x>84%/y>90% 强制透明剔除（P8/P9）。Godot 缩放复核按规范留 E04，不得提前冒充通过。
- 动作资产铁律（ART_GUIDE 1.1.1，E02 实测 F9）：**生成单帧动作/视图禁用多格派生图（如 6 格 character_actions.jpg）做 img2img**，会把相邻动作手臂混入同一人物产生多余肢体；必须单帧参考 + STRICT 双肢否定句 + 放大复核关节（缩略图看不出多余手肘）。E02 run 样本曾因此前伸拳头下多一截棕色手肘，已重生成修复。

## 开发路线图
- Phase 1（1~2 周）：白盒核心手感 + 播种-入侵最小闭环。✅ 全绿。
- Phase 2（3~4 周）：三套 Shader + VistaZone + 折叠手账 UI + Dialogue Manager 开篇剧情。**第 1~4 项全部 ✅，Phase 2 完成**：主角/敌人/地形/道具全换蜡笔资产，沸腾线/纸纹/去色扩散全接入；VistaZone 驻足触发→相机拉远+HUD 淡出+back/side 定格帧；TravelJournal 全局 Autoload（M 键开合、牛皮纸双页、房间印章+入侵标记+成熟度+一键转化、打开暂停世界、订阅 WorldState 信号自动重绘）；Dialogue Manager 开篇剧情（复用官方 v3.10.5 MIT，剔除 C#，StoryDirector 总线 + 蜡笔对话框 + SafeHouse 折纸鸟 NPC）。17 套断言测试全绿、累计 367+ 项 PASS、零脚本错误。
- 🔴 剧情复用纪律：Dialogue Manager 用官方 v3.10.5（main 分支是 v4 需 Godot 4.6，**必须 v3.x 分支**）。命令行外网被代理拦（git 超时/curl 502），**镜像 `https://ghproxy.net/<github-url>` 可下载**。复用前已做 GitNexus 索引（dvf-dm-v3，在 E:/DM_TMP）。仅 Autoload 注册 DialogueManager，**禁启用 editor_plugins**（plugin.gd 在 4.4 preload 语法错）；剧本 create_resource_from_text 运行时编译。分支选项必须 `- A => t_a` / `- B => t_b` 连续写 + 独立 `~ t_a`/`~ t_b` 段，**选项间夹 `=> END` 会让后续选项被吞成嵌套**。RefCounted 的 get() 只收 1 参数（禁 `get("x", default)`）。开篇自动播放仅 current_scene 匹配时触发。
- 测试集纪律：17 个 `tests/test_*.gd` 中 `test_e04_render_capability.gd` 是 SubViewport 截图能力探测脚本，`--script` 模式主循环不推进帧会永久挂起 → **不计入断言回归集、不参与全量循环**（其余 16 套用退出码判断）。全量跑偶发失败优先怀疑脆弱的 `_frames(2)` 等待，加大帧数再判（test_rest_and_transition 曾因此偶发，改 6 帧后连跑 3 次稳定）。
- Phase 3（第 5 周起，2026-11-26）：✅ 生态区三区全部交付——SafeHouse↔Room01↔Room02↔Room03(风车草地)↔Room04(折纸图书馆)↔Room05(糖果星光灯塔) 六房间连通；第二作物 `bounce_marshmallow`（+20HP）、SoilPlot 提示按 `CROP_LABELS` 动态化；Room05 差异化=双花坛（独立收共+40HP）+ 星光石碑一次性剧情（`lighthouse.dialogue`/flag `lighthouse_seen`）。✅ 真机调优代码层完成——`MobileTuner` Autoload 三档帧率（desktop 0/mobile 60/low_end 30，`mobile`/`low_end` feature 自动选档 + `profile_applied` 信号）、8 动作键统一≥96×96、按下变暗反馈、多指摇杆半屏锁定；`test_mobile_tuning.gd` 25 项 PASS。✅ **GitHub 出包链路打通（2026-11-26，参照 CoEvo）**：仓库 `github.com/Big-Pi100/DualVectorFoil`（public），`export_presets.cfg` + 三条 `workflow_dispatch` 流水线；Web/Android artifact 已 GitHub 实测产出并下载核验，iOS 就绪待 Apple 凭据。全量 21 套/473 项全绿。**剩余：真机帧率/手感实测（需设备）、完整结局与二周目。**

## 待核实 / 风险
- 文档称「第一阶段玩家控制器已完成初版代码」，但工作区初始为空，尚无代码落盘。
- **Godot 升级已完成（2026-11-26，白哥点头执行）**：4.4.1 → **4.7.2-stable**。下载坑：4.7 起官方 Windows 资产改为 `Godot_v4.7.2-stable_win64.exe.zip`（86MB，ghproxy 镜像约 6 分钟；旧的 `xxx_win64_console.exe` 裸文件名已不存在，直接 404），解压后单一 173MB exe 兼作编辑器/headless。升级验证：编辑器导入链零脚本错误 + 18 套断言/379 项全 PASS（含 Dialogue Manager v3.10.5 对话专项 30 项）——**v3.10.5 无需因升 4.7 换 v4**。`project.godot` 的 `config/features` 已从 `"4.4"` 改 `"4.7"`；GDD/AGENTS/ART_GUIDE 版本号同步。4.7 中间版本迁移指南正文 WebFetch 抓不全，以实测为准（比文档可靠）。
