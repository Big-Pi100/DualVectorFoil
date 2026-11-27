extends SceneTree

## 房间地形生成器：把 ASCII 蓝图变成真正的场景地形。
##
## 为什么要有这一步（而不是手摆 tscn）：
##   1. 手摆的 1200×40 一个矩形，没法表达"层"—— 六间房实测全是单矩形，
##      所以六间房长得一模一样，只有一条水平路。
##   2. 手摆的坑/平台，跳不跳得上去要人肉试。这里在**写文件之前**就按
##      实测跳跃能力（单跳 204px、二段 331px）做可达性验算，跳不到就拒绝生成。
##   3. 地形一旦是文本，就能 diff、能 review、能在测试里断言。
##
## 用法：
##   godot --headless --path godot --script res://world/tools/gen_room_terrain.gd -- room_02
##   （末尾必须留一个空行：命令行 -- 之后的参数走 OS.get_cmdline_user_args）
##
## 蓝图：res://world/rooms/blueprints/<id>.txt
## 产物：res://world/rooms/<Scene>.tscn（路径写在蓝图头 scene=）
##
## 保留节点：Player / TouchHUD / PostProcessLayer / InvadersContainer / VistaPoint
## 重建节点：Floor（连同旧 GroundTiles/GrassDecor）/ SpawnFrom* / DoorTo* / Terrain / Doors

const TILE: int = 48
## 1280 视口里 26 格 = 1248，左右各留 16px。高度 720 = 15 格整。
const ORIGIN: Vector2 = Vector2(16.0, 0.0)

## 机关件的脚本。用 preload 而不是 `SwitchGate.new()`：
## 这是 `--headless --script` 直接跑的工具脚本，不走编辑器的类名扫描，
## 全局类表里可能还没有这两个 class_name（实测直接报 "Identifier not declared"）。
const GATE_SCRIPT: Script = preload("res://world/interactables/SwitchGate.gd")
const LEVER_SCRIPT: Script = preload("res://world/interactables/Lever.gd")
## 线框稿的实体占位（见 world/debug/WireOverlay.gd）。
## 同样用 preload：`--headless --script` 不走编辑器类名扫描。
const WIRE_OVERLAY_SCRIPT: Script = preload("res://world/debug/WireOverlay.gd")

const CH_SOLID: String = "#"
const CH_PLATFORM: String = "="
const CH_EMPTY: String = "."
const CH_DOOR_L: String = "L"
const CH_DOOR_R: String = "R"
## 上门 / 下门：垂直方向的出口。
##
## 为什么必须和左右门分开：横版关卡只有左右门时，关卡图只能是**一维的一条线**，
## 无论怎么换模板都摆脱不了"一条长走廊"。DC 的关卡是 2D 的 —— 走廊上挂竖井、
## 从一层掉到下一层。没有上下门，拼装器再聪明也只能横着排。
##
## 语义：`U` 贴在**顶行**（r=0），`D` 贴在**底行**（r=rows-1），
## 玩家从 U 掉进来、从 D 落下去。垂直门洞是按**列**对齐的接缝，
## 和左右门按行对齐是一组镜像。
const CH_DOOR_U: String = "U"
const CH_DOOR_D: String = "D"
const CH_SPAWN: String = "P"
## 敌人生成点：这一格必须是空的，敌人落在**该列最低的可站立面**上。
## 为什么放进蓝图而不是运行时写死坐标：坐标一旦写死，地形改一次就全错位 ——
## 2026-11-27 之前六间房统统生成在 (660+i*90, 568)，而地面顶从 600 变成了 624。
const CH_ENEMY: String = "E"
## 飞行敌人（蝙蝠 variant 2）。
## 为什么要有独立字符而不是"按索引轮换视觉"：Dead Cells 的敌人编成是**空间设计的一部分**
## （官方分享："有些敌人需要在有较大空间方便移动的地方出现"）。
## 按索引轮换等于"设计和战斗脱钩"—— 蓝图想在这个洞里放一只蝙蝠，做不到。
## 有了 `F`，生成器能数「这间房有几只飞行敌人」，也能把 variant 写进 marker。
const CH_FLYER: String = "F"
## 能力拾取点。位置进蓝图、能力 id 进头部 `ability=`：
## 手工往 tscn 里塞节点，下次生成就被冲掉了（这坑在 EnemySpawn 上已经踩过一次）。
const CH_ABILITY: String = "A"
## 机关门（闸门）格子。同一列的连续 `G` = 一扇门，高几格就是几格。
##
## 为什么这东西必须进蓝图而不是手摆节点：
##   "门挡在哪一列、有几格高"是**空间设计**本身 —— 它决定房间是不是一堵墙。
##   手摆的话，改一次地形就得重新对一次门的坐标（EnemySpawn 已经栽过一次）。
const CH_GATE: String = "G"
## 机关拉杆。`G` 和 `S` 必须成对出现：有门没开关 = 死房，有开关没门 = 装饰。
const CH_SWITCH: String = "S"

const VALID_CHARS: Array[String] = [CH_SOLID, CH_PLATFORM, CH_EMPTY, CH_DOOR_L, CH_DOOR_R, CH_DOOR_U, CH_DOOR_D, CH_SPAWN, CH_ENEMY, CH_FLYER, CH_ABILITY, CH_GATE, CH_SWITCH]

## 视觉变体编号，与 `InvaderVisual.set_variant` 的约定一致（0=史莱姆 1=尖刺球 2=蝙蝠）。
const VARIANT_GROUND: int = 0
const VARIANT_SPIKY: int = 1
const VARIANT_FLYER: int = 2

## 敌人碰撞盒半高（`Invader.tscn` 的 RectangleShape2D(40,50)）。
## 敌人原点在碰撞盒中心，所以要抬半个高度才能让底边落在地面上。
const INVADER_HALF_H: float = 25.0

## 实测值（tests/test_jump_height.gd）：单跳 211.6px、二段总高 331.1px。
## 这里取 204 作保守值 —— 验算要宽进严出，宁可误报不可漏报。
const JUMP_HEIGHT_PX: float = 204.0
const DOUBLE_JUMP_HEIGHT_PX: float = 331.0
## 滞空 950ms × 290px/s ≈ 275px，取 4 格（192px）作安全水平距离
const JUMP_HORIZONTAL_TILES: int = 4

## 对比度预算（依据 docs/ref/REF_ROOM_DESIGN.md §2 Hollow Knight 三层分工）：
##   · 背景最暗 —— 承载"这是哪儿"
##   · 玩法层最亮 —— 角色/敌人/平台，玩家眼睛停在这里
##
## 2026-11-27 修正：原来实心块是 0.58 暖灰、背景是 0.96 纸色 ——
## 墙比背景暗一点点，两者糊在一起，整间房读成"一张纸 + 几条线"。
## 现在把墙压到 0.34（纸的暗面），平台提到 0.80（受光面），
## 通过明暗把三层拉开，不新增任何美术。
#------------------------------------------------------------------------------
# 线框稿（2026-11-27 第六次）
#
# 白哥原话：「你把所有贴图都去掉，出单纯的线框设计稿，然后在这个线框设计稿玩，
# 被认可了以后完了以后把线框替换成贴图。不然现在贴图素材不全，看起来乱七八糟，
# 反而更麻烦」。
#
# 判据：蓝图头部 `wireframe=1` 时，`Terrain` 子树里**不允许存在任何**
# Sprite2D / TextureRect / Polygon2D。贴图不全时，美术会盖住设计缺陷 ——
# 线框只回答一个问题：**空间本身成立吗**。
#
# 配色照工程剖面的读法：实心涂淡、边线提亮、可站的东西用暖色。
# 深底 + 亮线不是为了好看，是为了让"哪是实心 / 哪是空 / 哪能站"这三种信息
# 在一眼之内可分 —— 这也正是这一轮要验证的东西。
const WIRE_BG := Color(0.072, 0.084, 0.102, 1.0)
## 实心填充必须和背景拉开足够距离：第一版给的是 0.118/0.137/0.165，
## 和背景只差 12/255 —— 俯瞰图里"墙"和"空"读起来是同一个颜色，
## 只能靠描边猜哪里有实体。提到 0.18/0.21/0.25（差 27/255）才一眼可分。
const WIRE_FILL := Color(0.180, 0.212, 0.251, 1.0)
const WIRE_EDGE := Color(0.502, 0.560, 0.639, 1.0)
const WIRE_PLATFORM := Color(0.941, 0.659, 0.235, 1.0)
const WIRE_LABEL := Color(0.784, 0.824, 0.878, 1.0)
const WIRE_EDGE_W := 2.0
const WIRE_PLATFORM_W := 3.0

const COLOR_SOLID := Color(0.34, 0.30, 0.25, 1.0)
## 薄台（1~2 行厚）顶面的亮边。地表贴图有 3 行高，套在薄台上会糊到台下面去。
const COLOR_GROUND_LIP := Color(0.62, 0.72, 0.34, 1.0)
const COLOR_PLATFORM := Color(0.80, 0.74, 0.61, 1.0)
## 平台的三段受光：顶面亮、立面中、底边暗。
## 一条 22px 的纯色横线在 1.5 屏宽的房间里读起来是"背景上的一道划痕"，
## 不是"能站人的台"。加暗底边之后，眼睛能分出"这是有厚度的东西"。
const COLOR_PLATFORM_BASE := Color(0.55, 0.48, 0.39, 1.0)
const COLOR_PLATFORM_SHADOW := Color(0.35, 0.30, 0.24, 0.13)
## 纸片描边。
## 这游戏的材质语言是「蜡笔绘本」：地面是带深色轮廓的贴图，所以它从纸色背景里跳得出来；
## 平台是纯色填充，没有轮廓，就永远糊在背景上 —— 加多少明暗差都没用，
## 因为同色系的明度差在 1.5 屏宽里读不出来。给它和地面同一套语言：深色描边。
const COLOR_PLATFORM_OUTLINE := Color(0.30, 0.25, 0.20, 1.0)
const PLATFORM_OUTLINE: float = 2.5

## 天花板岩笋：纯几何三角，不参与碰撞。
##
## 为什么要有：三层平台都在 y>=336，房间上半 250px 是纯背景 ——
## 1.5 屏宽的空间里，那块空读起来不是"洞窟顶部"，是"没画完"。
## 岩笋把顶部"啃"出形状，成本是 6 个 Polygon2D。
## 只放在玩家跳不到的高度（玩家从中台起跳最高到 y=276，岩笋底一律 <=210），
## 否则会出现"人从石头里穿过去"。
const COLOR_CEILING_ROCK := Color(0.31, 0.27, 0.22, 1.0)
## 顶面亮边：让「台」读得出是台，而不是一根悬在空中的灰线。
const COLOR_PLATFORM_LIP := Color(0.97, 0.94, 0.85, 1.0)
const PLATFORM_THICKNESS: float = 12.0
## 视觉厚度 ≠ 碰撞厚度。
## 碰撞必须薄（单向、可从下方跳穿）；但只画 12px 时整块台看起来像一根杆，
## 玩家读不出「这里能站」。视觉画厚一点，碰撞不变 —— 两者本来就不必相等。
##
## 32px = 亮边 6 + 立面 17 + 暗底 9。三段明暗才读得出「一块石板」；
## 单色 22px 在 1.5 屏宽里只是一道划痕（zoom 0.62 下剩 14px）。
const PLATFORM_VISUAL_H: float = 32.0
const PLATFORM_LIP_H: float = 6.0
const PLATFORM_BASE_H: float = 9.0
const PLATFORM_SHADOW_H: float = 7.0
const PLATFORM_LAYER: int = 2

var _fail: int = 0
## 线框稿模式。由蓝图头部 `wireframe=1` 决定，**不进 tscn** ——
## 它是一个"这版产物要不要美术"的开关，不是房间属性。
## 切回贴图只要把那一行改成 0 再生成一次，地形不动。
var _wire: bool = false

#------------------------------------------------------------------------------
# 入口
#------------------------------------------------------------------------------

func _initialize() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.is_empty():
		push_error("缺参数。用法：... --script res://world/tools/gen_room_terrain.gd -- room_02")
		quit(2)
		return

	var room_key: String = args[0].strip_edges()
	# --audit：只验算不写文件。S2 上锁前要用它把六间房逐间量一遍
	# 「关掉二段跳之后还有没有活路」——判据必须复用同一份 _reachability，
	# 不能另写一个审计脚本（那就是第二份判据，两边迟早对不上）。
	var audit_only: bool = args.has("--audit")
	var bp_path: String = "res://world/rooms/blueprints/%s.txt" % room_key
	var text: String = FileAccess.get_file_as_string(bp_path)
	if text.is_empty():
		push_error("蓝图读取失败或为空：%s" % bp_path)
		quit(2)
		return

	var parsed: Dictionary = _parse(text, bp_path)
	if _fail > 0:
		_report_fail()
		return

	var grid: Array = parsed["grid"]
	var meta: Dictionary = parsed["meta"]
	print("=== %s · %d 行 × %d 列（%d×%d px）==="
		% [room_key, grid.size(), String(grid[0]).length(), String(grid[0]).length() * TILE, grid.size() * TILE])

	_validate(grid, bp_path)
	if _fail > 0:
		_report_fail()
		return

	# ❗ 连通性按"门开着"算。理由：机关门是**可解的**障碍，不是墙。
	# 按关着算会把整间房判成"门不可达"，而那恰恰是设计意图。
	# "关着的时候有多难受"由 _check_mechanisms 单独量。
	var grid_open: Array = _grid_with_gates(grid, true)
	var report: Dictionary = _reachability(grid_open)
	_print_reach_report(report, grid_open)
	if _fail > 0:
		_report_fail()
		return

	# F1：蓝图声明「这间房必须靠跳才能到右门」
	if str(meta.get("require_jump_to_exit", "")).strip_edges() == "1":
		_check_jump_required(grid_open, report, meta)

	# F0：结构可玩性。2026-11-27 加 —— 「门能到」不等于「房间好玩」。
	_check_structure(grid_open, grid, report, meta)
	# F0b：机关门的三段论 —— 能不能解、解了有没有用、不解是不是真过不去。
	_check_mechanisms(grid, meta)
	# 必须在这里拦一次：--audit 分支原本不看 _fail，判据失败也会打印
	# "AUDIT: PASS" 并 exit 0 —— 那等于审计永远通过，反向验证白做。
	if _fail > 0:
		_report_fail()
		return

	if audit_only:
		# 孤岛清单已由 _print_reach_report 打出；这里只标记"没写文件"。
		print("AUDIT: PASS（未写入文件）")
		quit(0)
		return

	if not meta.has("scene"):
		push_error("蓝图头缺 scene=（例如 scene=res://world/rooms/Room02.tscn）")
		_report_fail()
		return

	_generate(grid, meta, bp_path)
	if _fail > 0:
		_report_fail()
		return

	print("GEN ROOM: PASS → %s" % meta["scene"])
	quit(0)

func _report_fail() -> void:
	print("GEN ROOM: FAIL (%d)" % _fail)
	quit(1)

#------------------------------------------------------------------------------
# 解析与校验
#------------------------------------------------------------------------------

func _parse(text: String, bp_path: String) -> Dictionary:
	var meta: Dictionary = {}
	var grid: Array = []
	var in_grid: bool = false
	for raw: String in text.split("\n"):
		var line: String = raw.strip_edges()
		if line.is_empty():
			continue
		if in_grid:
			grid.append(line)
			continue
		if line == "---":
			in_grid = true
			continue
		if line.begins_with("!"):
			continue
		var kv: PackedStringArray = line.split("=", true, 1)
		if kv.size() == 2:
			meta[kv[0].strip_edges()] = kv[1].strip_edges()
		else:
			push_error("%s 无法解析的头部行：%s" % [bp_path.get_file(), line])
			_fail += 1
	return {"meta": meta, "grid": grid}

func _validate(grid: Array, bp_path: String) -> void:
	if grid.is_empty():
		push_error("%s 没有任何地形行" % bp_path.get_file())
		_fail += 1
		return
	var cols: int = String(grid[0]).length()
	for i: int in range(grid.size()):
		var row: String = grid[i]
		if row.length() != cols:
			push_error("第 %d 行宽 %d，与其他行的 %d 不一致（地形必须矩形）" % [i, row.length(), cols])
			_fail += 1
		for c: int in range(row.length()):
			var ch: String = row[c]
			if not VALID_CHARS.has(ch):
				push_error("第 %d 行第 %d 列出现非法字符 '%s'" % [i, c, ch])
				_fail += 1
	# 门必须在左右边缘，否则玩家会卡在房间里
	for i: int in range(grid.size()):
		var row: String = grid[i]
		for c: int in range(row.length()):
			var ch: String = row[c]
			if ch == CH_DOOR_L and c != 0:
				push_error("左门 L 在第 %d 行第 %d 列 —— 必须在第 0 列" % [i, c])
				_fail += 1
			if ch == CH_DOOR_R and c != cols - 1:
				push_error("右门 R 在第 %d 行第 %d 列 —— 必须在最后一列（%d）" % [i, c, cols - 1])
				_fail += 1
			# 上下门必须在顶/底行。这是拼装器做垂直缝合的前提 ——
			# 允许 U 飘在半空，接缝就会挖出一个"天花板上的洞"，玩家从上面掉不进来。
			if ch == CH_DOOR_U and i != 0:
				push_error("上门 U 在第 %d 行第 %d 列 —— 必须在第 0 行（顶行）" % [i, c])
				_fail += 1
			if ch == CH_DOOR_D and i != grid.size() - 1:
				push_error("下门 D 在第 %d 行第 %d 列 —— 必须在最后一行（%d）" % [i, c, grid.size() - 1])
				_fail += 1
	# 上下门各最多一个：一个房间两个洞会让拼接器不知道该对哪个，
	# 而"两处通天"在 DC 里属于两个房间，不属于一间。
	var n_up: int = 0
	var n_down: int = 0
	for i: int in range(grid.size()):
		var row: String = grid[i]
		for c: int in range(row.length()):
			if row[c] == CH_DOOR_U:
				n_up += 1
			elif row[c] == CH_DOOR_D:
				n_down += 1
	if n_up > 1:
		push_error("上门 U 出现 %d 格 —— 一间房只能有一个上门" % n_up)
		_fail += 1
	if n_down > 1:
		push_error("下门 D 出现 %d 格 —— 一间房只能有一个下门" % n_down)
		_fail += 1
	# 能力拾取点必须站得住，否则纸片会悬在半空、玩家够不到
	for i: int in range(grid.size()):
		var row: String = grid[i]
		for c: int in range(row.length()):
			if row[c] != CH_ABILITY:
				continue
			if not _standable(grid, i, c):
				push_error("能力点 A (%d,%d) 脚下没有地面 —— 会悬空" % [c, i])
				_fail += 1

#------------------------------------------------------------------------------
# 可达性验算
#------------------------------------------------------------------------------

func _char_at(grid: Array, r: int, c: int) -> String:
	if r < 0 or r >= grid.size():
		return CH_SOLID
	var row: String = grid[r]
	if c < 0 or c >= row.length():
		return CH_SOLID
	return row[c]

## 实心 = 挡住去路。门和出生点按"空"处理（门洞本身可站人）。
##
## `G`（机关门）在这里按**实心**算 —— 门默认是关着的。
## 需要"门开着"的解算，用 `_grid_with_gates(grid, true)` 先换掉 `G`。
func _is_solid(grid: Array, r: int, c: int) -> bool:
	var ch: String = _char_at(grid, r, c)
	return ch == CH_SOLID or ch == CH_GATE

## 把 `G` 换成实心/空，得到一份"门关着 / 门开着"的网格副本。
##
## 为什么要副本而不是给 _is_solid 加参数：`_is_solid` 被站面、连通、敌人落点
## 十几处调用，加参数迟早漏一个；而"门开着"和"门关着"是两次**完整**的解算，
## 各算一遍最不容易错。
func _grid_with_gates(grid: Array, open: bool) -> Array:
	var out: Array = []
	for row: String in grid:
		if open:
			out.append(row.replace(CH_GATE, CH_EMPTY))
		else:
			out.append(row.replace(CH_GATE, CH_SOLID))
	return out

## 可站立：(r,c) 空、脚下实心或平台、头顶一格空
func _standable(grid: Array, r: int, c: int) -> bool:
	if _is_solid(grid, r, c):
		return false
	var below: String = _char_at(grid, r + 1, c)
	if below != CH_SOLID and below != CH_PLATFORM:
		return false
	if _is_solid(grid, r - 1, c):
		return false
	return true

func _reachability(grid: Array, allow_jump: bool = true, check_doors: bool = true) -> Dictionary:
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()

	var stands: Array[Vector2i] = []
	for r: int in range(rows):
		for c: int in range(cols):
			if _standable(grid, r, c):
				stands.append(Vector2i(c, r))

	# 起点：优先出生点，其次**左门**（玩家默认从左边进来），再次右门。
	var start := Vector2i(-1, -1)
	var doors: Array[Vector2i] = []
	for r: int in range(rows):
		for c: int in range(cols):
			var ch: String = _char_at(grid, r, c)
			if ch == CH_SPAWN and start.x < 0:
				start = Vector2i(c, r)
			if ch == CH_DOOR_L or ch == CH_DOOR_R or ch == CH_DOOR_U or ch == CH_DOOR_D:
				doors.append(Vector2i(c, r))
	if start.x < 0:
		for d: Vector2i in doors:
			if d.x == 0:
				start = d
				break
	if start.x < 0 and not doors.is_empty():
		start = doors[0]
	# 门格本身可能悬空（门洞 3 格高，网格只标中心那格），往下找第一块实地
	if start.x >= 0 and not _standable(grid, start.y, start.x):
		for rr: int in range(start.y + 1, rows):
			if _standable(grid, rr, start.x):
				start = Vector2i(start.x, rr)
				break

	var visited: Dictionary = {}
	if start.x >= 0 and _standable(grid, start.y, start.x):
		var queue: Array[Vector2i] = [start]
		visited[start] = true
		while not queue.is_empty():
			var cur: Vector2i = queue.pop_front()
			for nxt: Vector2i in stands:
				if visited.has(nxt):
					continue
				if _can_move(grid, stands, cur, nxt, allow_jump):
					visited[nxt] = true
					queue.append(nxt)

	# 门必须可达。注意门的网格标记只有**中心那一格**，而门洞是 3 格高：
	# 玩家只要站在门格或其下方两格内的任意可达站面，就能触到门。
	if check_doors:
		for d: Vector2i in doors:
			if not _door_reachable(grid, visited, d, rows):
				push_error("门 (%d,%d) 从出生点不可达 —— 这间房会把玩家卡死" % [d.x, d.y])
				_fail += 1

	return {
		"stands": stands,
		"visited": visited,
		"doors": doors,
		"start": start,
	}

## 门只有**中心那一格**在蓝图里，而门洞是 3 格高：玩家站在门格或下方两格内
## 任意可达站面，都能触到门。这个判定原本只写在 _reachability 里，
## 「不跳可达」审计要用同一套口径，所以抽出来。
##
## 上下门是**镜像**：`U` 在顶行，玩家从下方够到它（往**下**找站面）；
## `D` 在底行，玩家站在它上方那个站面往下掉（往**上**找站面）。
## 都不能按"往下找两格"一刀切 —— D 下方是地图外，那样判会永远 FAIL。
func _door_reachable(grid: Array, visited: Dictionary, d: Vector2i, rows: int) -> bool:
	if visited.has(d):
		return true
	var ch: String = _char_at(grid, d.y, d.x)
	var step: int = 1
	if ch == CH_DOOR_D:
		step = -1
	for k: int in range(1, 3):
		var rr: int = d.y + step * k
		if rr < 0 or rr >= rows:
			break
		if visited.has(Vector2i(d.x, rr)):
			return true
	return false

func _can_move(grid: Array, stands: Array[Vector2i], from: Vector2i, to: Vector2i, allow_jump: bool = true) -> bool:
	var dc: int = absi(to.x - from.x)
	# 站面高度：站在 (r,c) 时脚在 (r+1)*48
	var rise_px: float = float(from.y - to.y) * float(TILE)

	if dc > JUMP_HORIZONTAL_TILES:
		return false
	if rise_px > 0.0:
		# 「不跳」模式：任何上升都不可行。这是 F1 的判据基础 ——
		# 如果右门在「不跳可达」集合里，说明这间房的跳跃根本没被用到。
		if not allow_jump:
			return false
		# 上升：不能超过单跳高度（二段只影响"能不能到"，切片里二段要上锁，
		# 所以验算按单跳算 —— 宁可要求主路单跳可通）
		if rise_px > JUMP_HEIGHT_PX:
			return false
	# 中间不能穿过实心。
	#
	# 横向：逐列检查起点那一行（玩家是横着走的）。
	#
	# 纵向：只检查**人真正经过的那一列**，不是起终点的连线 ——
	# 版本一写成"沿连线逐行检查"，把正常跳跃也判死了（可达格从 873 掉到 414）：
	# 从台 A 跳到台 B，B 列的中间行本来就有台子，连线一穿就"不可达"。
	# 正确的口径：
	#   下落 → 查**落脚列**（最终落到哪儿，那一列中间不能有实心）
	#   上升 → 查**起跳列**（人从哪儿往上蹿，那一列头顶不能有实心）
	var step: int = 1 if to.x > from.x else -1
	for c: int in range(from.x + step, to.x, step):
		if _is_solid(grid, from.y, c):
			return false
	if to.y > from.y:
		for r: int in range(from.y + 1, to.y + 1):
			if _is_solid(grid, r, to.x):
				return false
	elif to.y < from.y:
		for r: int in range(to.y, from.y):
			if _is_solid(grid, r, from.x):
				return false
	# 落脚点上方要有一格净空（已经由 standable 保证）
	return true

func _print_reach_report(report: Dictionary, grid: Array) -> void:
	var stands: Array = report["stands"]
	var visited: Dictionary = report["visited"]
	var doors: Array = report["doors"]
	var orphans: Array[Vector2i] = []
	print("  可站立格 %d，从起点可达 %d，门 %d 个" % [stands.size(), visited.size(), doors.size()])
	print("  单跳验算按 %.0fpx（%.1f 格）/ 水平 %d 格" % [JUMP_HEIGHT_PX, JUMP_HEIGHT_PX / float(TILE), JUMP_HORIZONTAL_TILES])

	# 打一张连通性图：'o' 可站可达，'x' 可站但不可达，'·' 空，'#' 实心
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	print("  --- 可达性图（o=可达站面  x=孤岛  .=空  #=实心  =平台）---")
	for r: int in range(rows):
		var line: String = ""
		for c: int in range(cols):
			var p := Vector2i(c, r)
			var ch: String = _char_at(grid, r, c)
			if ch == CH_SOLID:
				line += "#"
			elif ch == CH_PLATFORM:
				line += "="
			elif ch == CH_DOOR_L or ch == CH_DOOR_R or ch == CH_DOOR_U or ch == CH_DOOR_D:
				line += "D"
			elif visited.has(p):
				line += "o"
			elif _standable(grid, r, c):
				line += "x"
			else:
				line += "."
		print("  " + line)
	for s: Vector2i in stands:
		if not visited.has(s):
			orphans.append(s)
	if orphans.is_empty():
		print("  无孤岛：所有站面都通")
	else:
		var shown: int = mini(orphans.size(), 6)
		var listed: Array[String] = []
		for i: int in range(shown):
			listed.append("(%d,%d)" % [orphans[i].x, orphans[i].y])
		var more: String = " …" if orphans.size() > shown else ""
		print("  孤岛 %d 个：%s%s（若是给二段跳留的奖励点，确认是故意的）"
			% [orphans.size(), ", ".join(listed), more])

## F1 判据：右门必须是「跳上去才到得了」的。
##
## 做法：跑一遍只许平移和下落（不许上升）的 BFS。
##   · 右门落在里面 → 跳跃是装饰，玩家可以一路走到出口 → FAIL
##   · 左门不在里面 → 玩家连回安全屋都要跳，那是另一种设计事故 → FAIL
##
## 为什么不只看「有没有平台」：平台可以摆着好看，玩家绕过去就行。
## 只有「出口本身够不到」才证明跳是必需的。
## 所以这条判据按房声明（蓝图头 `require_jump_to_exit=1`），不全局套 ——
## 别的房可能故意设计成"平地房"。
func _check_jump_required(grid: Array, _report: Dictionary, _meta: Dictionary) -> void:
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	var no_jump: Dictionary = _reachability(grid, false, false)
	var visited: Dictionary = no_jump["visited"]
	var left_door := Vector2i(-1, -1)
	var right_door := Vector2i(-1, -1)
	for d: Vector2i in no_jump["doors"]:
		if d.x == 0:
			left_door = d
		elif d.x == cols - 1:
			right_door = d

	print("  --- 不跳可达（F1 判据：出口必须靠跳）---")
	print("  不跳可达站面 %d / 共 %d 个" % [visited.size(), (no_jump["stands"] as Array).size()])

	if right_door.x < 0:
		push_error("require_jump_to_exit=1 但蓝图里没有右门")
		_fail += 1
	elif _door_reachable(grid, visited, right_door, rows):
		push_error("右门 (%d,%d) **不跳就能到** —— 这间房的跳跃是装饰（require_jump_to_exit=1）"
			% [right_door.x, right_door.y])
		_fail += 1
	else:
		print("  ✓ 右门必须跳才到得了")

	if left_door.x >= 0 and not _door_reachable(grid, visited, left_door, rows):
		push_error("左门 (%d,%d) 不跳都到不了 —— 玩家回不去安全屋" % [left_door.x, left_door.y])
		_fail += 1

## 结构可玩性判据（2026-11-27）。
##
## 为什么需要它：`require_jump_to_exit=1` 只能证明「跳是必需的」，
## 证明不了「房间有形状」。「一条平地 + 一级台阶」也能让右门必须跳着才到，
## 但玩家在里面只做一件事：往右走。这一组判据补上量的部分：
##
##   min_jump_to_exit  入口→出口**最少**要跳几次（0-1 BFS：上升边权 1，平移下落 0）
##   min_layers        可达站面有几种高度（去重）
##   min_detour_stands 不在「最少跳路径」上的站面数（= 支线，玩家可以不去的地方）
##   min_enemy_layers  敌人落在几种高度上（战斗有没有分层）
##
## 全部按房声明。旧蓝图不写就不验 —— Room02..05 还没重做，不能一刀切。
func _check_structure(grid: Array, raw_grid: Array, report: Dictionary, meta: Dictionary) -> void:
	# ⚠️ 2026-11-27 第二次反转。上一版这一组判据要求「层数多、必跳多、岔路多」，
	# 结果把房间逼成了跑酷塔 —— 判据全绿，房间更难看。
	#
	# 依据 docs/ref/REF_DEADCELLS_ROOM.md：Dead Cells 的房间是**战斗场**，
	# 「Platforming is just a means to move」（GDC 2019）。所以：
	#   · 出口必须**顺路**（上限），难度来自战斗而不是跳跃
	#   · 层数、平台数必须有**上限**（多了把战场切碎）
	#   · 平台必须**长**（小岛读不出路径）
	#   · 地面必须**开阔**（近战要展开）
	# 判据的方向从「要求更多」变成「要求更少、更开阔」。
	var max_jumps: int = int(str(meta.get("max_jump_to_exit", "0")).strip_edges())
	var max_layers: int = int(str(meta.get("max_layers", "0")).strip_edges())
	var min_layers: int = int(str(meta.get("min_layers", "0")).strip_edges())
	var max_platforms: int = int(str(meta.get("max_platforms", "0")).strip_edges())
	var min_span: int = int(str(meta.get("min_platform_span", "0")).strip_edges())
	var min_ground: int = int(str(meta.get("min_ground_span", "0")).strip_edges())
	var min_enemy_layers: int = int(str(meta.get("min_enemy_layers", "0")).strip_edges())
	var min_flyers: int = int(str(meta.get("min_flying_enemies", "0")).strip_edges())
	var min_optional: int = int(str(meta.get("min_optional_platforms", "0")).strip_edges())
	var min_walk: int = int(str(meta.get("min_walk_px", "0")).strip_edges())
	if max_jumps <= 0 and max_layers <= 0 and max_platforms <= 0 and min_span <= 0 \
			and min_ground <= 0 and min_enemy_layers <= 0 and min_flyers <= 0 \
			and min_layers <= 0 and min_optional <= 0 and min_walk <= 0:
		return

	var stands: Array = report["stands"]
	var visited: Dictionary = report["visited"]
	var start: Vector2i = report["start"]
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()

	var reach: Array[Vector2i] = []
	for s: Vector2i in stands:
		if visited.has(s):
			reach.append(s)

	print("  --- 战斗空间 ---")

	# ---- 层数（上限）----
	#
	# 按 96px（2 格）分桶，不按像素精确值 —— 玩家感知的是"我能上去的那一层"，
	# 不是"624 和 576 是两个高度"。地面做 1 格起伏（48px）不该算成多一层，
	# 否则"让地面别是直线"会和"层数上限"直接打架。
	var layer_map: Dictionary = {}
	for s: Vector2i in reach:
		var y: int = (s.y + 1) * TILE
		var bucket: int = int(floor(float(y) / 96.0))
		if not layer_map.has(bucket):
			layer_map[bucket] = y
	var layer_list: Array = layer_map.values()
	layer_list.sort()
	var heights: Array[String] = []
	for h: int in layer_list:
		heights.append(str(h))
	print("  高度层 %d：%s" % [layer_list.size(), " / ".join(heights)])
	if min_layers > 0 and layer_list.size() < min_layers:
		push_error("可达站面只有 %d 个高度层，蓝图要求 ≥ %d —— 房间是平的，没有纵向空间可玩"
			% [layer_list.size(), min_layers])
		_fail += 1
	elif min_layers > 0:
		print("  ✓ 层数 ≥ %d（有纵向结构）" % min_layers)
	if max_layers > 0 and layer_list.size() > max_layers:
		push_error("可达站面有 %d 个高度层，蓝图要求 ≤ %d —— 层多了会把战场切成竖井，玩家只能一路往上跳"
			% [layer_list.size(), max_layers])
		_fail += 1
	elif max_layers > 0:
		print("  ✓ 层数 ≤ %d" % max_layers)

	# ---- 到出口的跳数（上限）----
	var goal: Vector2i = _right_door_stand(grid, cols, rows)
	var jumps: int = -1
	if goal.x >= 0 and visited.has(goal):
		jumps = int(_min_jumps(grid, stands, reach, start, goal)["jumps"])
	print("  到右门最少跳 %d 次" % jumps)
	if max_jumps > 0:
		if jumps < 0:
			push_error("右门站面不可达")
			_fail += 1
		elif jumps > max_jumps:
			push_error("到出口要跳 %d 次，蓝图要求 ≤ %d —— 出口不该靠跑酷，难度应该来自战斗"
				% [jumps, max_jumps])
			_fail += 1
		else:
			print("  ✓ 出口跳数 ≤ %d（顺路）" % max_jumps)

	# ---- 到出口的最短步行距离（下限）----
	#
	# 为什么需要它：白哥第五次否定的原话是「你设计那个地图10秒都玩不了」。
	# 层数、平台数、跳数这些判据**都能量出"结构对不对"，量不出"够不够大"** ——
	# 上一版全部判据都绿，可它就是 1.3 屏，玩家 10 秒走完。
	# 这条判据直接量那个数：从出生点到右门，最短路径折成像素，够不够长。
	#
	# 口径：Dijkstra 跑在站面图上，边的代价 = (横向格差 + 纵向格差) × 48。
	# 不是纯水平距离 —— 竖井里那六跳也要算进去，否则"往上爬"不产生距离。
	if min_walk > 0:
		var walk_px: float = _shortest_walk_px(grid, stands, reach, start, goal)
		if walk_px < 0.0:
			push_error("算不出到右门的最短路径 —— 距离判据无法成立")
			_fail += 1
		elif walk_px < float(min_walk):
			push_error("到出口的最短路径只有 %.0fpx（约 %.1f 屏宽），蓝图要求 ≥ %dpx —— 这关卡太小，玩家会一路小跑就到底"
				% [walk_px, walk_px / 1280.0, min_walk])
			_fail += 1
		else:
			print("  ✓ 到出口最短路径 %.0fpx（%.1f 屏宽）≥ %dpx"
				% [walk_px, walk_px / 1280.0, min_walk])

	# ---- 平台：数量上限 + 单块宽度下限 ----
	var segs: Array = _platform_segments(grid)
	var widths: Array[String] = []
	for seg: Dictionary in segs:
		widths.append("%d格" % int(seg["span"]))
	print("  平台段 %d 块：%s" % [segs.size(), " / ".join(widths)])
	if max_platforms > 0 and segs.size() > max_platforms:
		push_error("平台有 %d 块，蓝图要求 ≤ %d —— 平台多而碎，空间会被切成浮岛"
			% [segs.size(), max_platforms])
		_fail += 1
	elif max_platforms > 0:
		print("  ✓ 平台块数 ≤ %d" % max_platforms)
	if min_span > 0:
		var too_short: Array[String] = []
		for seg: Dictionary in segs:
			if int(seg["span"]) < min_span:
				too_short.append("r%d c%d-c%d(%d格)"
					% [seg["row"], seg["from"], seg["to"], seg["span"]])
		if not too_short.is_empty():
			push_error("这些平台太短（要求 ≥ %d 格）：%s —— 2~3 格的小岛读不出路径，只是浮板"
				% [min_span, ", ".join(too_short)])
			_fail += 1
		else:
			print("  ✓ 每块平台 ≥ %d 格" % min_span)

	# ---- 地面：连续可走宽度下限 ----
	if min_ground > 0:
		var gsegs: Array = _ground_segments(stands)
		var widest: int = 0
		var report_parts: Array[String] = []
		for g: Dictionary in gsegs:
			widest = maxi(widest, int(g["span"]))
			report_parts.append("%d格" % int(g["span"]))
		print("  地面连续段 %d 段：%s（最宽 %d 格）"
			% [gsegs.size(), " / ".join(report_parts), widest])
		if widest < min_ground:
			push_error("地面最宽只有 %d 格，要求 ≥ %d —— 近战展不开，玩家只能贴墙打"
				% [widest, min_ground])
			_fail += 1
		else:
			print("  ✓ 地面最宽段 ≥ %d 格" % min_ground)

	# ---- 可去可不去的平台（= 岔路 / 死路）----
	#
	# 为什么量这个：前几版房间"太简单"的根因不是层数少，是**每块平台都是必经**。
	# 一条唯一的上升路径，无论摆多少块台，本质上还是一根梯子。
	#
	# 口径：在**门关着**的网格上，逐块删掉一段平台，看还能不能到开关。
	# 删了仍然到得了 = 这块是"可去可不去的"，玩家有选择。
	# 注意必须在关着的网格上量：门一开，地面直接通到出口，所有平台都会变成"可选"，
	# 判据当场失效 —— 这是这一版最容易写错的地方。
	if min_optional > 0:
		var sws: Array[Vector2i] = _cells_of(raw_grid, CH_SWITCH)
		if sws.is_empty():
			print("  · 没有开关，跳过「可选平台」判定")
		else:
			# ❗ 必须用 raw_grid 重建关门的网格。传进来的 `grid` 是"门开着"的版本，
			# 里面已经没有 `G` 了 —— 用它对 `_grid_with_gates(..., false)` 等于没关门，
			# 闸门另一侧的台子会被算成"可选"，判据当场变成摆设（这一版真踩过）。
			var base: Array = _grid_with_gates(raw_grid, false)
			var base_v: Dictionary = _reachability(base, true, false)["visited"]
			var target: Vector2i = sws[0]
			var opt: int = 0
			var considered: int = 0
			for seg: Dictionary in segs:
				# 只统计"门关着的时候玩家真能站上去"的台子。
				# 闸门另一侧的台子此刻根本到不了，删不删都对开关没影响 ——
				# 把它算成"可选"是假阳性，会把判据变成摆设。
				var stand_row: int = int(seg["row"]) - 1
				var on_this_side: bool = false
				for c: int in range(int(seg["from"]), int(seg["to"]) + 1):
					if base_v.has(Vector2i(c, stand_row)):
						on_this_side = true
						break
				if not on_this_side:
					continue
				considered += 1
				var cut: Array = base.duplicate()
				var row_i: int = int(seg["row"])
				var row_s: String = String(cut[row_i])
				var from_i: int = int(seg["from"])
				var span_i: int = int(seg["span"])
				cut[row_i] = row_s.substr(0, from_i) + ".".repeat(span_i) \
					+ row_s.substr(from_i + span_i)
				var rep: Dictionary = _reachability(cut, true, false)
				if _reachable_any(rep["visited"], target):
					opt += 1
			print("  可选平台 %d / %d 块（删掉它仍然够得着开关）" % [opt, considered])
			if opt < min_optional:
				push_error("可去可不去的平台只有 %d 块，要求 ≥ %d —— 每块都是必经，房间只有一条路，还是一根梯子"
					% [opt, min_optional])
				_fail += 1
			else:
				print("  ✓ 至少 %d 块平台可以不去（存在岔路 / 死路）" % min_optional)

	# ---- 敌人：分层 + 飞行编成 ----
	var enemy_layers: Dictionary = {}
	for r: int in range(rows):
		for c: int in range(cols):
			var ch: String = _char_at(grid, r, c)
			if ch != CH_ENEMY and ch != CH_FLYER:
				continue
			for rr: int in range(r, rows):
				if _standable(grid, rr, c):
					enemy_layers[(rr + 1) * TILE] = true
					break
	var ey: Array = enemy_layers.keys()
	ey.sort()
	var eys: Array[String] = []
	for h: int in ey:
		eys.append(str(h))
	var flyers: int = _count_char(grid, CH_FLYER)
	print("  敌人 %d 只（飞行 %d），高度层 %d：%s"
		% [_count_char(grid, CH_ENEMY) + flyers, flyers, ey.size(), " / ".join(eys)])
	if min_enemy_layers > 0 and ey.size() < min_enemy_layers:
		push_error("敌人只分布在 %d 个高度层，蓝图要求 ≥ %d —— 战斗退化成「同一层对劈」"
			% [ey.size(), min_enemy_layers])
		_fail += 1
	elif min_enemy_layers > 0:
		print("  ✓ 敌人高度层 ≥ %d" % min_enemy_layers)
	if min_flyers > 0:
		if flyers < min_flyers:
			push_error("飞行敌人只有 %d 只，蓝图要求 ≥ %d —— 没有空中威胁，玩家会一直待在地面平面"
				% [flyers, min_flyers])
			_fail += 1
		else:
			print("  ✓ 飞行敌人 ≥ %d" % min_flyers)


## 机关门三段论。为什么是三条而不是一条：
##
##   1. 门**关着**时，开关必须够得着 —— 否则这间房无解，玩家被卡死。
##   2. 门**关着**时，出口必须到不了 —— 否则这扇门是装饰，白摆。
##   3. 门**开着**时，出口必须到得了 —— 否则扳了开关也白搭。
##
## 三条缺一条，房间就从"谜题"退化成"墙"或者"布景"。
## 这也是反向验证的抓手：随便删一条，生成器必须当场报错。
func _check_mechanisms(grid: Array, meta: Dictionary) -> void:
	var gates: Array[Vector2i] = _cells_of(grid, CH_GATE)
	var switches: Array[Vector2i] = _cells_of(grid, CH_SWITCH)
	if gates.is_empty() and switches.is_empty():
		return
	print("  --- 机关门 ---")
	if gates.is_empty() or switches.is_empty():
		push_error("蓝图里只有 %s 没有 %s（或反之）—— 有门没开关是死房，有开关没门是布景"
			% [CH_GATE, CH_SWITCH])
		_fail += 1
		return

	var cols: Array[int] = []
	for g: Vector2i in gates:
		if not cols.has(g.x):
			cols.append(g.x)
	if cols.size() != 1:
		push_error("机关门跨了 %d 列 —— 必须全部在一列里，否则碰撞与视觉都会错位" % cols.size())
		_fail += 1
		return
	gates.sort_custom(func(a: Vector2i, b: Vector2i) -> bool: return a.y < b.y)
	var top: int = gates[0].y
	var bot: int = gates[gates.size() - 1].y
	if bot - top + 1 != gates.size():
		push_error("c%d 的机关门不连续（r%d..r%d，但只有 %d 格）" % [cols[0], top, bot, gates.size()])
		_fail += 1
		return
	print("  闸门 c%d r%d..r%d（%d 格 = %dpx）" % [cols[0], top, bot, gates.size(), gates.size() * TILE])

	var rows: int = grid.size()
	var cols_n: int = String(grid[0]).length()
	var closed_v: Dictionary = _reachability(_grid_with_gates(grid, false), true, false)["visited"]
	var open_v: Dictionary = _reachability(_grid_with_gates(grid, true), true, false)["visited"]

	# ---- 1. 关着时开关够得着 ----
	var sw: Vector2i = switches[0]
	var sw_stand := Vector2i(sw.x, sw.y)
	if not closed_v.has(sw_stand):
		if closed_v.has(Vector2i(sw.x, sw.y + 1)):
			sw_stand = Vector2i(sw.x, sw.y + 1)
		else:
			push_error("开关 (c%d,r%d) 在门关着时够不着 —— 这间房解不开，玩家会被卡死"
				% [sw.x, sw.y])
			_fail += 1
			return
	print("  ✓ 门关着时开关可达（站 c%d,r%d）" % [sw_stand.x, sw_stand.y])

	# ---- 2/3. 关着到不了出口、开着到得了 ----
	var goal: Vector2i = _right_door_stand(grid, cols_n, rows)
	var door_cell := Vector2i(cols_n - 1, goal.y if goal.x >= 0 else 0)
	if goal.x < 0:
		push_error("找不到右门的可站面")
		_fail += 1
		return
	var reachable_closed: bool = closed_v.has(goal) or _door_reachable(grid, closed_v, door_cell, rows)
	var reachable_open: bool = open_v.has(goal) or _door_reachable(grid, open_v, door_cell, rows)
	if reachable_closed:
		push_error("门关着也能走到出口 —— 这扇机关门是布景，玩家会直接绕过去或穿过去")
		_fail += 1
	else:
		print("  ✓ 门关着时到不了出口（门真的挡路）")
	if not reachable_open:
		push_error("门开着也到不了出口 —— 扳了开关也白搭")
		_fail += 1
	else:
		print("  ✓ 门开着时出口可达")

## 所有指定字符的格子坐标。
func _cells_of(grid: Array, ch: String) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for r: int in range(grid.size()):
		for c: int in range(String(grid[r]).length()):
			if _char_at(grid, r, c) == ch:
				out.append(Vector2i(c, r))
	return out

## 目标格"够得着"：目标本身是站面，或目标正下方一格是站面。
## 开关是站在台面上扳的，站面在开关格的下一格 —— 两种口径都认。
func _reachable_any(visited: Dictionary, target: Vector2i) -> bool:
	return visited.has(target) or visited.has(Vector2i(target.x, target.y + 1))

## 平台段：同一行里连续的 `=`，按水平方向切段。
##
## 为什么不用 `_clusters(stand)`：站面聚类会把地面也当成"一块"，
## 而这里要量的是「玩家眼里能看见的台子有几块」，地面不是台子。
func _platform_segments(grid: Array) -> Array:
	var out: Array = []
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	for r: int in range(rows):
		var c: int = 0
		while c < cols:
			if _char_at(grid, r, c) != CH_PLATFORM:
				c += 1
				continue
			var s: int = c
			while c < cols and _char_at(grid, r, c) == CH_PLATFORM:
				c += 1
			out.append({"row": r, "from": s, "to": c - 1, "span": c - s})
	return out


## 地面连续段：取最底部那一行可站面，按水平方向切段。
##
## "最底部"而不是"地面层"：这间房的地面就是全房最低的可站行，
## 不需要额外声明地面在哪 —— 声明了就多一个会跟蓝图不同步的常量。
func _ground_segments(stands: Array) -> Array:
	var max_r: int = -1

	for s: Vector2i in stands:
		max_r = maxi(max_r, int(s.y))
	if max_r < 0:
		return []
	var xs: Array[int] = []
	for s: Vector2i in stands:
		if int(s.y) == max_r:
			xs.append(int(s.x))
	xs.sort()
	var out: Array = []
	var i: int = 0
	while i < xs.size():
		var s: int = xs[i]
		var e: int = s
		while i + 1 < xs.size() and xs[i + 1] == e + 1:
			i += 1
			e = xs[i]
		out.append({"from": s, "to": e, "span": e - s + 1})
		i += 1
	return out


## 0-1 BFS：从 start 到 goal 的最少「上升跳数」，可封掉一个站面 `banned`。
##
## 边权不是格数，是**要按几次空格**：上升一条边记 1，平移/下落记 0。
## 玩家感知的是跳的次数，不是走了几步。
##
## 返回 {"jumps": int, "parent": Dictionary}；不可达时 jumps = -1。
## parent 用来回溯「最少跳路径」，也就是玩家实际会走的那条主路。
## `ban` 是禁止踩的站面集合（删掉一整块平台时用）。
## 站面图上的最短路径，折成像素。边权 = (|dc| + |dr|) * 48。
##
## 用 Dijkstra 而不是 BFS：一步跨 4 格和一格一格挪，玩家花的时间不一样，
## 而"要走多久"正是这条判据要量的东西。
func _shortest_walk_px(grid: Array, stands: Array, reach: Array,
		start: Vector2i, goal: Vector2i) -> float:
	if goal.x < 0 or not reach.has(goal):
		return -1.0
	# 可达集合转成字典：Dijkstra 内层每步都要查，数组的 has() 是线性扫
	var ok: Dictionary = {}
	for s: Vector2i in reach:
		ok[s] = true
	var dist: Dictionary = {start: 0.0}
	var open: Array[Vector2i] = [start]
	while not open.is_empty():
		# 取当前代价最小的（站面最多几百个，线性扫足够）
		var best_i: int = 0
		for i: int in range(open.size()):
			if float(dist[open[i]]) < float(dist[open[best_i]]):
				best_i = i
		var cur: Vector2i = open[best_i]
		open.remove_at(best_i)
		if cur == goal:
			return float(dist[cur])
		for nxt: Vector2i in stands:
			if not ok.has(nxt) or nxt == cur:
				continue
			if not _can_move(grid, stands, cur, nxt, true):
				continue
			var step: float = float(absi(nxt.x - cur.x) + absi(nxt.y - cur.y)) * float(TILE)
			var cand: float = float(dist[cur]) + step
			if not dist.has(nxt) or cand < float(dist[nxt]):
				dist[nxt] = cand
				if not open.has(nxt):
					open.append(nxt)
	return -1.0

func _min_jumps(grid: Array, stands: Array, reach: Array[Vector2i],
		start: Vector2i, goal: Vector2i, ban: Dictionary = {}) -> Dictionary:
	if ban.has(start) or ban.has(goal):
		return {"jumps": -1, "parent": {}}
	var dist: Dictionary = {start: 0}
	var parent: Dictionary = {}
	var dq: Array[Vector2i] = [start]
	while not dq.is_empty():
		var cur: Vector2i = dq.pop_front()
		var cd: int = int(dist[cur])
		for nxt: Vector2i in reach:
			if nxt == cur or ban.has(nxt):
				continue
			if not _can_move(grid, stands, cur, nxt, true):
				continue
			var w: int = 1 if nxt.y < cur.y else 0
			var nd: int = cd + w
			if dist.has(nxt) and nd >= int(dist[nxt]):
				continue
			dist[nxt] = nd
			parent[nxt] = cur
			if w == 0:
				dq.push_front(nxt)
			else:
				dq.push_back(nxt)
	if not dist.has(goal):
		return {"jumps": -1, "parent": parent}
	return {"jumps": int(dist[goal]), "parent": parent}


## 把可达站面按「同一行、左右相邻」聚成平台块。
## 分叉判据按块删，不按格删 —— 一条 6 格宽的台是一个整体，
## 删掉其中一格玩家挪半步就绕过去了，那不叫岔路。
func _clusters(reach: Array[Vector2i]) -> Array:
	var pool: Dictionary = {}
	for s: Vector2i in reach:
		pool[s] = true
	var seen: Dictionary = {}
	var out: Array = []
	for s: Vector2i in reach:
		if seen.has(s):
			continue
		var comp: Array[Vector2i] = []
		var q: Array[Vector2i] = [s]
		seen[s] = true
		while not q.is_empty():
			var cur: Vector2i = q.pop_front()
			comp.append(cur)
			for d: Vector2i in [Vector2i(-1, 0), Vector2i(1, 0)]:
				var nxt: Vector2i = cur + d
				if pool.has(nxt) and not seen.has(nxt):
					seen[nxt] = true
					q.append(nxt)
		out.append(comp)
	return out


## 右门对应的可站面：门格本身可站就用它，否则门下方两格内。
## 与 `_door_reachable` 同一口径 —— 玩家触到门靠的是"门格或门下方"。
func _right_door_stand(grid: Array, cols: int, rows: int) -> Vector2i:
	for r: int in range(rows):
		if _char_at(grid, r, cols - 1) != CH_DOOR_R:
			continue
		if _standable(grid, r, cols - 1):
			return Vector2i(cols - 1, r)
		for rr: int in range(r + 1, mini(r + 3, rows)):
			if _standable(grid, rr, cols - 1):
				return Vector2i(cols - 1, rr)
		return Vector2i(-1, -1)
	return Vector2i(-1, -1)

#------------------------------------------------------------------------------
# 生成场景
#------------------------------------------------------------------------------

func _generate(grid: Array, meta: Dictionary, bp_path: String) -> void:
	var scene_path: String = String(meta["scene"])
	var ps: PackedScene = load(scene_path) as PackedScene
	if ps == null:
		push_error("%s 加载失败（房间场景必须已存在，生成器只改地形不动逻辑）" % scene_path)
		_fail += 1
		return
	var room: Node2D = ps.instantiate() as Node2D
	if room == null:
		push_error("%s 不是 Node2D 场景" % scene_path)
		_fail += 1
		return

	_purge_old(room)

	var terrain := Node2D.new()
	terrain.name = "Terrain"
	terrain.z_index = -10
	room.add_child(terrain)
	terrain.owner = room

	# 线框模式从蓝图头读。默认 0 —— 不写这一行的房间还是出贴图版。
	_wire = str(meta.get("wireframe", "0")).strip_edges() == "1"

	_build_solids(grid, terrain, room)
	_build_platforms(grid, terrain, room)
	if _wire:
		# 线框：只铺一层深底。
		# 跳过地表贴图、径向光、顶部压暗、天花板岩笋 —— 这四样全是"好看"，
		# 而这一版要验的是"好不好玩"。留着它们，只会让人分不清是自己觉得
		# 空间不对，还是觉得美术不对。
		_build_wire_backdrop(grid, terrain, room)
	else:
		_build_ground_art(grid, terrain, room)
		_build_backdrop(grid, terrain, room)
		_build_ceiling_rocks(terrain, room)
	_build_doors(grid, meta, room)
	_build_mechanisms(grid, room)
	_build_spawns(grid, meta, room)
	_build_enemy_spawns(grid, room)
	_build_ability_pickups(grid, meta, room)
	_snap_props(grid, meta, room)

	# 顺序：Terrain 必须在最前（最底层），否则会盖住 Player
	room.move_child(terrain, 0)

	# 自检放在打包之前：带着贴图打包出去、事后再检查，等于允许坏产物落盘。
	if _wire:
		_build_wire_overlay(room)
		_check_wire(room)

	var out := PackedScene.new()
	var err: int = out.pack(room)
	if err != OK:
		push_error("%s pack 失败（%d）" % [scene_path, err])
		_fail += 1
		room.free()
		return
	err = ResourceSaver.save(out, scene_path)
	room.free()
	if err != OK:
		push_error("%s 保存失败（%d）" % [scene_path, err])
		_fail += 1
		return

	# 回读：保存成功 ≠ 存进去了；必须 CACHE_MODE_IGNORE，否则读到旧版
	var check: PackedScene = ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if check == null:
		push_error("%s 从磁盘重读失败" % scene_path)
		_fail += 1
		return
	var re: Node = check.instantiate()
	var re_terrain: Node = re.get_node_or_null("Terrain")
	if re_terrain == null:
		push_error("%s 回读没有 Terrain 节点 —— pack 丢了（owner 没设？）" % scene_path.get_file())
		re.free()
		_fail += 1
		return
	var solid_count: int = (re.get_node_or_null("Terrain/Solids") as Node).get_child_count() if re.get_node_or_null("Terrain/Solids") != null else -1
	var plat_count: int = (re.get_node_or_null("Terrain/Platforms") as Node).get_child_count() if re.get_node_or_null("Terrain/Platforms") != null else -1
	var art_node: Node = re.get_node_or_null("Terrain/GroundArt")
	var art_count: int = art_node.get_child_count() if art_node != null else -1
	var door_count: int = (re.get_node_or_null("Doors") as Node).get_child_count() if re.get_node_or_null("Doors") != null else -1
	re.free()
	print("  回读：Solids 子节点 %d / Platforms 子节点 %d / 地表贴图 %d / 门 %d"
		% [solid_count, plat_count, art_count, door_count])
	if solid_count <= 0:
		push_error("回读 Solids 为空")
		_fail += 1
	if door_count <= 0:
		push_error("回读 Doors 为空")
		_fail += 1

func _purge_old(room: Node) -> void:
	for name: String in ["Floor", "Terrain", "Doors", "Mechanisms", "WireOverlay"]:
		var node: Node = room.get_node_or_null(name)
		if node != null:
			room.remove_child(node)
			node.free()
	for child: Node in room.get_children():
		# 用节点名前缀而不是 `child is AbilityPickup`：--script 模式下 class_name
		# 的注册晚于脚本解析，类型判断在这里会静默失效（S1 血条已经踩过一次）。
		if child.name.begins_with("SpawnFrom") or child.name.begins_with("DoorTo") \
				or child.name.begins_with("EnemySpawn") or child.name.begins_with("AbilityPickup"):
			room.remove_child(child)
			child.free()

## 该列最低的可站立面（世界 y）。没有地面就返回 NAN —— 调用方必须处理。
## 取"最低"而不是"第一个"：摆件和敌人都属于地面层，
## 上面的平台是给玩家跳的，不是给它们站的。
func _floor_surface_y(grid: Array, c: int) -> float:
	var rows: int = grid.size()
	var found: int = -1
	for r: int in range(rows):
		if _standable(grid, r, c):
			found = r
	return NAN if found < 0 else ORIGIN.y + float(found + 1) * TILE

## `E` → `EnemySpawn0..n`。
##
## E 的**行号从此有意义**：敌人站在「从该行往下第一个可站面」上。
## 之前是「整列找最低站面」—— 那样无论 E 写在哪一行，敌人永远落在地面，
## 「把敌人放在中台上」这件事在蓝图里根本表达不出来（12 F3 需要它）。
## 兼容旧蓝图：E 都写在最底行，往下第一个可站面就是它自己。
func _build_enemy_spawns(grid: Array, room: Node) -> void:
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	var idx: int = 0
	for r: int in range(rows):
		for c: int in range(cols):
			var ch: String = _char_at(grid, r, c)
			if ch != CH_ENEMY and ch != CH_FLYER:
				continue
			if _is_solid(grid, r, c):
				push_error("敌人点 (%d,%d) 落在实心块里" % [c, r])
				_fail += 1
				continue

			# 飞行敌人不落地：marker 就是它的悬停中心，蓝图格子直接当坐标用。
			# 地面敌人往下找第一个站面，保证脚踩在地上。
			var pos: Vector2
			if ch == CH_FLYER:
				pos = Vector2(ORIGIN.x + float(c) * TILE + TILE * 0.5,
					ORIGIN.y + float(r) * TILE + TILE * 0.5)
			else:
				var found: int = -1
				for rr: int in range(r, rows):
					if _standable(grid, rr, c):
						found = rr
						break
				if found < 0:
					push_error("敌人点 (%d,%d) 往下找不到站面 —— 敌人会站在虚空里" % [c, r])
					_fail += 1
					continue
				var surface: float = ORIGIN.y + float(found + 1) * TILE
				pos = Vector2(ORIGIN.x + float(c) * TILE + TILE * 0.5, surface - INVADER_HALF_H)

			var m := Marker2D.new()
			m.name = "EnemySpawn%d" % idx
			m.position = pos
			# 变体写进 marker，`BaseRoom._spawn_invader` 读它 ——
			# 不再按 `index % 3` 轮换：轮换等于「蓝图管不了敌人类型」。
			m.set_meta("variant", VARIANT_FLYER if ch == CH_FLYER else VARIANT_GROUND)
			room.add_child(m)
			m.owner = room
			print("  EnemySpawn%d = %s（%s，蓝图 (%d,%d)）"
				% [idx, m.position, "飞行" if ch == CH_FLYER else "地面", c, r])
			idx += 1
	if idx > 0:
		# 蓝图里几个 E/F，这一房就几个入侵者 —— 单一真源，不再靠 @export 手填
		room.set("invader_count", idx)
		print("  invader_count = %d（来自蓝图）" % idx)

## 能力拾取点：蓝图 `A` + 头部 `ability=<id>`。
## 能力 id 写进头部而不是每格写一遍：一间房只会放一个能力点，
## 如果以后真的要放两个不同能力，那再来改语法也不迟。
func _build_ability_pickups(grid: Array, meta: Dictionary, room: Node) -> void:
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	var spots: Array[Vector2i] = []
	for r: int in range(rows):
		for c: int in range(cols):
			if _char_at(grid, r, c) == CH_ABILITY:
				spots.append(Vector2i(c, r))
	if spots.is_empty():
		return
	var ability_id: String = str(meta.get("ability", "")).strip_edges()
	if ability_id.is_empty():
		push_error("蓝图里有 A（能力点）但头部缺 ability=...，不知道要给哪个能力")
		_fail += 1
		return
	var ps: PackedScene = load("res://world/interactables/AbilityPickup.tscn") as PackedScene
	if ps == null:
		push_error("AbilityPickup.tscn 加载失败")
		_fail += 1
		return
	for i: int in range(spots.size()):
		var s: Vector2i = spots[i]
		var node: Node2D = ps.instantiate() as Node2D
		node.name = "AbilityPickup%d" % i
		node.set("ability_id", ability_id)
		# 原点在脚下：纸片自己往上长，不用再算半个身位
		node.position = Vector2(ORIGIN.x + float(s.x) * TILE + TILE * 0.5, float(s.y + 1) * TILE)
		room.add_child(node)
		node.owner = room
		print("  AbilityPickup%d = %s（%s @ 列 %d 行 %d）" % [i, node.position, ability_id, s.x, s.y])

## 摆件跟着地面走。
##
## 判据用**绝对目标位置**（地面 y − 固定偏移），不用"加一个 delta"：
## 增量写法每重跑一次就再挪一次，生成器不幂等，第二次生成整间房会歪。
## 偏移来自"它落在旧地面 600 上时是正确的那一版"：土块 578。
##
## VistaPoint 例外：它不一定贴地。Room03 的观景点就放在**高台上**
## （折叠解锁后站上去才够得到），强行吸回地面会把它从台上拽下来。
## 所以 vista 只在蓝图头写了 `vista_at=<列>,<行>` 时才按格摆；没写就保持原位。
const SOIL_ABOVE_GROUND: float = 22.0
## 观景点的悬空高度：与土块同理，摆件离站面一小段，别和碰撞体顶边重合。
const VISTA_ABOVE_GROUND: float = 40.0

func _snap_props(grid: Array, meta: Dictionary, room: Node) -> void:
	var moved: int = 0
	var skipped: int = 0
	var vista_spec: String = str(meta.get("vista_at", "")).strip_edges()
	for child: Node in room.get_children():
		var n2d := child as Node2D
		if n2d == null:
			continue
		if child.name.begins_with("VistaPoint"):
			if vista_spec.is_empty():
				continue
			var parts: PackedStringArray = vista_spec.split(",", false)
			if parts.size() != 2:
				push_error("蓝图头 vista_at 要写成 <列>,<行>，现在是 '%s'" % vista_spec)
				_fail += 1
				continue
			var vc: int = int(parts[0])
			var vr: int = int(parts[1])
			# 和土块一样：摆件离站面一小段，不直接坐在上面。
			# 精确重合会踩到射线检测的边界（起点压在碰撞体顶边上，hit_from_inside
			# 默认 false，射线直接漏检）—— 断言会报"下方没有地面"，而地形是对的。
			var vtarget := Vector2(ORIGIN.x + float(vc) * TILE + TILE * 0.5,
				float(vr + 1) * TILE - VISTA_ABOVE_GROUND)
			if n2d.position.distance_to(vtarget) > 0.5:
				print("  VistaPoint %s → %s（vista_at=%s）" % [n2d.position, vtarget, vista_spec])
				n2d.position = vtarget
				moved += 1
			continue
		if not child.name.begins_with("SoilPlot"):
			continue
		var c: int = int(floor((n2d.position.x - ORIGIN.x) / TILE))
		var surface: float = _floor_surface_y(grid, c)
		if is_nan(surface):
			print("  ⚠ %s 在列 %d 没有地面，保持原位（需人工确认）" % [n2d.name, c])
			skipped += 1
			continue
		var target: float = surface - SOIL_ABOVE_GROUND
		if absf(n2d.position.y - target) < 0.5:
			continue
		print("  %s y %.0f → %.0f（列 %d 地面 y=%.0f）"
			% [n2d.name, n2d.position.y, target, c, surface])
		n2d.position.y = target
		moved += 1
	if moved > 0 or skipped > 0:
		print("  摆件贴地：移动 %d 个，跳过 %d 个" % [moved, skipped])

## 贪心矩形合并：行优先向右扩，再向下扩。26×15 的地形通常合并成 10~20 个矩形，
## 逐个 grid 生成会有上百个碰撞体，物理窄相位的整理成本不值得。
func _build_solids(grid: Array, terrain: Node2D, owner_root: Node) -> void:
	var body := StaticBody2D.new()
	body.name = "Solids"
	body.collision_layer = 1
	body.collision_mask = 0
	terrain.add_child(body)
	body.owner = owner_root

	var visuals := Node2D.new()
	visuals.name = "Blocks"
	terrain.add_child(visuals)
	visuals.owner = owner_root

	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	var used: Array = []
	for r: int in range(rows):
		used.append([])
		for c: int in range(cols):
			used[r].append(false)

	var idx: int = 0
	for r: int in range(rows):
		for c: int in range(cols):
			if used[r][c] or _char_at(grid, r, c) != CH_SOLID:
				continue
			var w: int = 1
			while c + w < cols and not used[r][c + w] and _char_at(grid, r, c + w) == CH_SOLID:
				w += 1
			var h: int = 1
			while r + h < rows:
				var ok: bool = true
				for k: int in range(w):
					if used[r + h][c + k] or _char_at(grid, r + h, c + k) != CH_SOLID:
						ok = false
						break
				if not ok:
					break
				h += 1
			for rr: int in range(r, r + h):
				for cc: int in range(c, c + w):
					used[rr][cc] = true
			_emit_box(body, visuals, c, r, w, h, idx)
			idx += 1
	print("  实心合并：%d 个矩形（原始格 %d）" % [idx, _count_char(grid, CH_SOLID)])

func _emit_box(body: StaticBody2D, visuals: Node2D, c: int, r: int, w: int, h: int, idx: int) -> void:
	var pos := Vector2(ORIGIN.x + float(c) * TILE, ORIGIN.y + float(r) * TILE)
	var size := Vector2(float(w) * TILE, float(h) * TILE)

	var shape := CollisionShape2D.new()
	shape.name = "Box%d" % idx
	var rect := RectangleShape2D.new()
	rect.size = size
	shape.shape = rect
	shape.position = pos + size * 0.5
	body.add_child(shape)
	shape.owner = body.owner

	if _wire:
		# 线框：淡填充 + 亮描边。
		# 填充不是贴图，是为了让"实心 / 空腔"一眼可分 —— 只有描边的话，
		# 一整片墙内部和空腔在深底上读起来是同一个东西。
		var fill := ColorRect.new()
		fill.name = "BlockFill%d" % idx
		fill.position = pos
		fill.size = size
		fill.color = WIRE_FILL
		fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
		visuals.add_child(fill)
		fill.owner = body.owner

		# 描边用 Line2D 而不是四条 ColorRect：Line2D 有抗锯齿，
		# 4800px 的关卡缩到一屏时斜线和 1px 边会碎成虚线，ColorRect 更明显。
		var edge := Line2D.new()
		edge.name = "BlockEdge%d" % idx
		edge.width = WIRE_EDGE_W
		edge.default_color = WIRE_EDGE
		edge.antialiased = true
		edge.joint_mode = Line2D.LINE_JOINT_SHARP
		# Line2D 没有 closed 属性，把首点再附一次收口。
		edge.points = PackedVector2Array([
			pos,
			pos + Vector2(size.x, 0.0),
			pos + size,
			pos + Vector2(0.0, size.y),
			pos,
		])
		visuals.add_child(edge)
		edge.owner = body.owner
		return

	var vis := ColorRect.new()
	vis.name = "Block%d" % idx
	vis.position = pos
	vis.size = size
	vis.color = COLOR_SOLID
	vis.mouse_filter = Control.MOUSE_FILTER_IGNORE
	visuals.add_child(vis)
	vis.owner = body.owner

func _build_platforms(grid: Array, terrain: Node2D, owner_root: Node) -> void:
	var body := StaticBody2D.new()
	body.name = "Platforms"
	body.collision_layer = PLATFORM_LAYER
	body.collision_mask = 0
	terrain.add_child(body)
	body.owner = owner_root

	var visuals := Node2D.new()
	visuals.name = "PlatformVisuals"
	terrain.add_child(visuals)
	visuals.owner = owner_root

	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	var idx: int = 0
	for r: int in range(rows):
		var c: int = 0
		while c < cols:
			if _char_at(grid, r, c) != CH_PLATFORM:
				c += 1
				continue
			var w: int = 1
			while c + w < cols and _char_at(grid, r, c + w) == CH_PLATFORM:
				w += 1
			var pos := Vector2(ORIGIN.x + float(c) * TILE, ORIGIN.y + float(r) * TILE)
			var size := Vector2(float(w) * TILE, PLATFORM_THICKNESS)

			var shape := CollisionShape2D.new()
			shape.name = "Plat%d" % idx
			var rect := RectangleShape2D.new()
			rect.size = size
			shape.shape = rect
			shape.position = pos + size * 0.5
			shape.one_way_collision = true
			shape.one_way_collision_margin = 8.0
			body.add_child(shape)
			shape.owner = body.owner

			if _wire:
				# 线框平台 = 一条粗横线 + 两端短竖线。
				# 横线压在**台面**（pos.y）而不是视觉高度中线上：玩家关心的是
				# "脚落在哪"，不是"这块板多厚"。两端竖线是工程图里的支撑符号，
				# 用来和实心地形（闭合框）区分开 —— 单向平台不是墙。
				var bar := Line2D.new()
				bar.name = "PlatBar%d" % idx
				bar.width = WIRE_PLATFORM_W
				bar.default_color = WIRE_PLATFORM
				bar.antialiased = true
				bar.points = PackedVector2Array([
					Vector2(pos.x, pos.y),
					Vector2(pos.x + float(w) * TILE, pos.y),
				])
				visuals.add_child(bar)
				bar.owner = body.owner

				for end_x: float in [pos.x, pos.x + float(w) * TILE]:
					var tick := Line2D.new()
					tick.name = "PlatTick%d" % idx
					tick.width = WIRE_PLATFORM_W * 0.6
					tick.default_color = WIRE_PLATFORM
					tick.antialiased = true
					tick.points = PackedVector2Array([
						Vector2(end_x, pos.y),
						Vector2(end_x, pos.y + PLATFORM_VISUAL_H),
					])
					visuals.add_child(tick)
					tick.owner = body.owner
				idx += 1
				c += w
				continue

			# ① 台下投影：一条半透明暗带，让平台"浮"在背景上而不是"贴"在背景上
			var shadow := ColorRect.new()
			shadow.name = "PlatShadow%d" % idx
			shadow.position = Vector2(pos.x, pos.y + PLATFORM_VISUAL_H)
			shadow.size = Vector2(float(w) * TILE, PLATFORM_SHADOW_H)
			shadow.color = COLOR_PLATFORM_SHADOW
			shadow.mouse_filter = Control.MOUSE_FILTER_IGNORE
			visuals.add_child(shadow)
			shadow.owner = body.owner

			# ② 描边：比台面四边各多 2.5px，只从边缘露出一圈深色。
			#    必须在台面之前 add —— 同 z_index 下后加的盖前加的。
			var outline := ColorRect.new()
			outline.name = "PlatOutline%d" % idx
			outline.position = Vector2(pos.x - PLATFORM_OUTLINE, pos.y - PLATFORM_OUTLINE)
			outline.size = Vector2(float(w) * TILE + PLATFORM_OUTLINE * 2.0,
				PLATFORM_VISUAL_H + PLATFORM_OUTLINE * 2.0)
			outline.color = COLOR_PLATFORM_OUTLINE
			outline.mouse_filter = Control.MOUSE_FILTER_IGNORE
			visuals.add_child(outline)
			outline.owner = body.owner

			# ③ 台面
			var vis := ColorRect.new()
			vis.name = "PlatVis%d" % idx
			vis.position = pos
			vis.size = Vector2(float(w) * TILE, PLATFORM_VISUAL_H)
			vis.color = COLOR_PLATFORM
			vis.mouse_filter = Control.MOUSE_FILTER_IGNORE
			visuals.add_child(vis)
			vis.owner = body.owner

			# ④ 顶面：受光最亮，是玩家眼睛"落点"的参照
			var lip := ColorRect.new()
			lip.name = "PlatLip%d" % idx
			lip.position = Vector2.ZERO
			lip.size = Vector2(float(w) * TILE, PLATFORM_LIP_H)
			lip.color = COLOR_PLATFORM_LIP
			lip.mouse_filter = Control.MOUSE_FILTER_IGNORE
			vis.add_child(lip)
			lip.owner = body.owner

			# ⑤ 底边：暗一档，让平台有"厚度"而不是"色块"
			var base := ColorRect.new()
			base.name = "PlatBase%d" % idx
			base.position = Vector2(0.0, PLATFORM_VISUAL_H - PLATFORM_BASE_H)
			base.size = Vector2(float(w) * TILE, PLATFORM_BASE_H)
			base.color = COLOR_PLATFORM_BASE
			base.mouse_filter = Control.MOUSE_FILTER_IGNORE
			vis.add_child(base)
			base.owner = body.owner
			idx += 1
			c += w
	if idx > 0:
		print("  单向平台：%d 段" % idx)

## 地面贴图用 Sprite2D 逐块摆，**不用 TileMapLayer**。
##
## 原因是硬冲突：TileMapLayer 的一个 cell 等于 TileSet.tile_size，
## 而 ground_mid 被切成 96×144（2 格宽 × 3 格高）。我们的网格是 48，
## 于是 cell 坐标 (c,r) 落在 96c × 144r 上 —— 跟 48 网格、跟任意地表高度（624/672/528）
## 全部对不齐。第一版就是这么写的，瓦片被铺到 y=1872 的屏幕外，截图上完全看不见。
## Sprite2D 的位置是自由像素坐标，能精确压在任意一行地表上。
func _build_ground_art(grid: Array, terrain: Node2D, owner_root: Node) -> void:
	var tex: Texture2D = load("res://art/approved/Terrain/ground_mid.png") as Texture2D
	if tex == null:
		push_error("ground_mid.png 加载失败")
		_fail += 1
		return
	var art := Node2D.new()
	art.name = "GroundArt"
	terrain.add_child(art)
	art.owner = owner_root

	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	# ⚠️ 2026-11-27 第五次：不再只画最后 4 行。
	# 上一版房间只有 15 行、地面就在底部，写死 `rows-4` 没问题。
	# 这一版是 40 行多层的关卡，写死底部的结果是**所有高台都只剩一块棕色方块** ——
	# 俯瞰图里上层读作"墙上的洞"，玩家不知道哪里能站。
	# 现在按"顶面露出来的实心格"逐行找，不管它在第几行。
	var count: int = 0
	var lip_count: int = 0
	# ⚠️ 必须**从下往上**画。2026-11-27 踩的坑：原来是从上往下，r12 的台阶剖面先画、
	# r13 的地表后画，同 z_index 下后加的盖前加的 —— 结果一格高的碎石台只剩顶部
	# 一条草皮浮在空中，底下什么都没有，截图里读作"悬空草皮板"。
	# 地形高的地方本来就该挡住地形低的地方，所以高的后画。
	for r: int in range(rows - 1, 0, -1):
		var c: int = 0
		while c < cols:
			# 地表 = 实心 + 上方是空（不是实心也不是平台）
			var above: String = _char_at(grid, r - 1, c)
			if _char_at(grid, r, c) != CH_SOLID or above == CH_SOLID or above == CH_PLATFORM:
				c += 1
				continue
			var start: int = c
			while c < cols and _char_at(grid, r, c) == CH_SOLID:
				c += 1
			var cc: int = start
			var idx: int = 0
			while cc < c:
				# 这块实心往下连续几行？贴图是 96×144（3 行高），
				# 薄台（1~2 行）套上去会糊到台下的空腔里 —— 薄台改用一条亮边。
				var depth: int = 0
				while r + depth < rows and _char_at(grid, r + depth, cc) == CH_SOLID:
					depth += 1
				if depth >= 3:
					var spr := Sprite2D.new()
					spr.name = "Ground%d_%d" % [r, cc]
					spr.texture = tex
					spr.hframes = 4
					spr.frame = idx % 4
					# 图 96×144，锚点居中：左上角压在 (16 + cc*48, r*48)
					spr.position = Vector2(ORIGIN.x + float(cc) * TILE + 48.0,
						ORIGIN.y + float(r) * TILE + 72.0)
					art.add_child(spr)
					spr.owner = owner_root
					count += 1
				else:
					var lip := ColorRect.new()
					lip.name = "Ledge%d_%d" % [r, cc]
					lip.position = Vector2(ORIGIN.x + float(cc) * TILE,
						ORIGIN.y + float(r) * TILE)
					lip.size = Vector2(float(mini(2, c - cc)) * TILE, 6.0)
					lip.color = COLOR_GROUND_LIP
					lip.mouse_filter = Control.MOUSE_FILTER_IGNORE
					art.add_child(lip)
					lip.owner = owner_root
					lip_count += 1
				cc += 2
				idx += 1
	print("  地表贴图：%d 块（薄台亮边 %d 条）" % [count, lip_count])

## 背景层：径向渐变，没有别的。
##
## 三件事说清楚：
##   1. 底色必须铺满整间房 —— 原来写死 1280×720，房间改成 1920 宽后右边 640px
##      漏出 viewport 的深灰 clear color，截图里右门那段是黑的。
##   2. 径向渐变（中心亮、四角暗）—— 让"空"也是被光塑形的，
##      读作"这间房有光源"，而不是"没画的地方"。这是 REF_ROOM_DESIGN §2
##      说的"画好的安静区"。
##   3. 试过一排远景柱，**去掉了**：等距竖条在 1.5 屏宽里读起来像牢房栅栏。
##      柱影要么做成有透视的（需要真背板美术），要么不做。
## 线框稿的实体占位节点：把玩家/敌人换成几何符号。
##
## 节点存在 = 线框模式。房间脚本、玩家脚本、敌人脚本都**不知道**这个节点的存在，
## 也不该知道 —— 它是"这一版产物要不要美术"的表现层开关，
## 关掉线框时这个节点直接不生成，场景里一点痕迹都不留。
func _build_wire_overlay(room: Node) -> void:
	var overlay := Node2D.new()
	overlay.name = "WireOverlay"
	overlay.set_script(WIRE_OVERLAY_SCRIPT)
	room.add_child(overlay)
	overlay.owner = room
	print("  实体占位：WireOverlay 已挂（玩家/敌人换几何符号）")

## 线框模式的底：一整块深色，没有渐变、没有图。
##
## 为什么不干脆"背景留空"：清屏色来自 project.godot 的
## environment/defaults/default_clear_color，改它会作用到所有场景。
## 铺一块和房间同尺寸的 ColorRect，是唯一"只影响这间房"的做法。
func _build_wire_backdrop(grid: Array, terrain: Node2D, owner_root: Node) -> void:
	var cols: int = String(grid[0]).length()
	var rows: int = grid.size()
	# 比房间大一圈：俯瞰时房间外那一圈是 Godot 清屏色（浅灰），
	# 一圈浅灰会把整张图框成"截图"，读起来像没拍全。
	# 铺到房间外 1024px，图就是一张无边界的图纸。
	var pad: float = 1024.0
	var bg := ColorRect.new()
	bg.name = "WireBackdrop"
	bg.position = Vector2(-pad, -pad)
	bg.size = Vector2(float(cols) * TILE + pad * 2.0, float(rows) * TILE + pad * 2.0)
	bg.color = WIRE_BG
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	terrain.add_child(bg)
	bg.owner = owner_root
	terrain.move_child(bg, 0)
	print("  底板：线框稿 %d x %d px（无贴图 / 无渐变 / 无岩笋）"
		% [int(float(cols) * TILE), int(float(rows) * TILE)])

## 线框模式的自检：`Terrain` 子树里不许存在任何贴图节点。
##
## 这条判据存在的理由和项目里其他判据一样 —— **只写规则不算数，要能 FAIL**。
## 以后谁在 `_build_solids` 里顺手加回一张贴图、或者把 `_build_ground_art`
## 重新接到主流程上，这里必须当场红，而不是等某天有人看截图说"怎么又乱了"。
func _check_wire(room: Node) -> void:
	var terrain: Node = room.get_node_or_null("Terrain")
	if terrain == null:
		push_error("线框模式：房间没有 Terrain 节点")
		_fail += 1
		return
	var bad: Array[String] = []
	var stack: Array[Node] = [terrain]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is Sprite2D or n is TextureRect or n is Polygon2D:
			bad.append("%s(%s)" % [n.name, n.get_class()])
		stack.append_array(n.get_children())
	if bad.is_empty():
		print("  ✓ 线框自检：Terrain 内 0 个贴图节点")
	else:
		push_error("线框模式：Terrain 里还有 %d 个贴图节点 —— %s"
			% [bad.size(), str(bad.slice(0, 8))])
		_fail += 1

func _build_backdrop(grid: Array, terrain: Node2D, owner_root: Node) -> void:
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	var room_w: float = float(cols) * TILE
	var room_h: float = float(rows) * TILE

	var grad := Gradient.new()
	grad.set_color(0, Color(0.980, 0.950, 0.880, 1.0))
	grad.set_color(1, Color(0.620, 0.565, 0.470, 1.0))
	var gtex := GradientTexture2D.new()
	gtex.gradient = grad
	gtex.width = 256
	gtex.height = 256
	# 径向而不是垂直：Dead Cells 的房间是"中心有光、四边压暗"，
	# 空的地方也被光塑出形状。垂直渐变只能做出"上面暗"，读起来像天色，
	# 不像洞穴。径向渐变 = "这间房有一个光源"，四角自然沉下去。
	gtex.fill = GradientTexture2D.FILL_RADIAL
	# 光源压到下半部、略偏左（进门那一侧）。
	# 原来在正中心 (0.5,0.55)：上半屏整片是亮的，读作"这面墙没画完"。
	# 光源落地之后，上方自然收暗 —— 不用加任何形状就有纵深。
	# fill_to 推到格的边缘之外：相邻两格在交界处都是"最暗色"，接缝不可见。
	gtex.fill_from = Vector2(0.42, 0.62)
	gtex.fill_to = Vector2(0.98, 1.10)

	# ⚠️ 按**屏幕大小**平铺，不再一张拉伸到整间房。
	#
	# 一张径向光拉伸到 4800×1920 之后，光斑直径是 4800px —— 相当于整张图只有
	# 一个巨大的明暗过渡，走近看每一屏都是"一片平灰"，俯瞰图更像一块脏抹布。
	# 一格 1280×720 一盏灯，相邻格在边缘都收到同一个暗色，接缝看不出来，
	# 而每一屏都保留"中心亮、四边沉"的塑形。
	var tile_w: float = 1280.0
	var tile_h: float = 720.0
	var nx: int = int(ceil(room_w / tile_w))
	var ny: int = int(ceil(room_h / tile_h))
	for gy: int in range(ny):
		for gx: int in range(nx):
			var bg := TextureRect.new()
			bg.name = "Backdrop%d_%d" % [gx, gy]
			bg.texture = gtex
			bg.position = Vector2(float(gx) * tile_w, float(gy) * tile_h)
			bg.size = Vector2(tile_w, tile_h)
			bg.stretch_mode = TextureRect.STRETCH_SCALE
			bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
			terrain.add_child(bg)
			bg.owner = owner_root
			terrain.move_child(bg, 0)

	# 顶部压暗：一条纯垂直渐变，从天花板往下 45% 处化开。
	# 为什么需要它：房间 15 格高，玩的东西全在 y>330，上三分之一本来就是空的。
	# 空不要紧（Dead Cells 也有），但**亮**着就变成"没画完的墙"。
	# 压暗之后这块读作天花板以下的暗部，纵深就有了；不加任何形状，
	# 所以不会像上一次那排远景柱那样读成栅栏。
	var top_grad := Gradient.new()
	top_grad.set_color(0, Color(0.13, 0.10, 0.075, 0.55))
	top_grad.set_color(1, Color(0.13, 0.10, 0.075, 0.0))
	var tgtex := GradientTexture2D.new()
	tgtex.gradient = top_grad
	tgtex.width = 8
	tgtex.height = 128
	tgtex.fill = GradientTexture2D.FILL_LINEAR
	tgtex.fill_from = Vector2(0.5, 0.0)
	tgtex.fill_to = Vector2(0.5, 1.0)

	var shade := TextureRect.new()
	shade.name = "TopShade"
	shade.texture = tgtex
	shade.position = Vector2.ZERO
	shade.size = Vector2(room_w, room_h * 0.55)
	shade.stretch_mode = TextureRect.STRETCH_SCALE
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	terrain.add_child(shade)
	shade.owner = owner_root
	terrain.move_child(shade, 1)
	print("  背景：%d x %d px（%d×%d 格径向光 + 顶部压暗）" % [int(room_w), int(room_h), nx, ny])

## 从天花板垂下的岩笋。位置写死在这个函数里，而不是蓝图字符 ——
## 它们不参与玩法（无碰撞、不挡路），进蓝图只会让蓝图多一种要维护的字符。
## 如果以后需要"能站的岩笋"，那才升级成蓝图字符。
func _build_ceiling_rocks(terrain: Node2D, owner_root: Node) -> void:
	var layer := Node2D.new()
	layer.name = "CeilingRocks"
	terrain.add_child(layer)
	layer.owner = owner_root

	# c / 宽 / 高：全部避开 c16-c24（高台正上方，玩家站高台起跳会撞）
	var specs: Array = [
		{"c": 3, "w": 44.0, "h": 190.0},
		{"c": 8, "w": 62.0, "h": 148.0},
		{"c": 13, "w": 38.0, "h": 205.0},
		{"c": 25, "w": 52.0, "h": 172.0},
		{"c": 30, "w": 46.0, "h": 196.0},
		{"c": 36, "w": 58.0, "h": 158.0},
	]
	for i: int in range(specs.size()):
		var spec: Dictionary = specs[i]
		var w: float = float(spec["w"])
		var h: float = float(spec["h"])
		var cx: float = ORIGIN.x + float(spec["c"]) * TILE + TILE * 0.5
		var poly := Polygon2D.new()
		poly.name = "Rock%d" % i
		# 五边形：上宽下尖，两侧各有一个"折"，看起来像被削过的石头而不是三角形
		poly.polygon = PackedVector2Array([
			Vector2(-w * 0.5, 0.0),
			Vector2(w * 0.5, 0.0),
			Vector2(w * 0.20, h * 0.70),
			Vector2(0.0, h),
			Vector2(-w * 0.24, h * 0.64),
		])
		poly.position = Vector2(cx, 0.0)
		poly.color = COLOR_CEILING_ROCK
		layer.add_child(poly)
		poly.owner = owner_root
	print("  天花板岩笋：%d 根" % specs.size())

func _build_doors(grid: Array, meta: Dictionary, room: Node) -> void:
	var doors_root := Node2D.new()
	doors_root.name = "Doors"
	room.add_child(doors_root)
	doors_root.owner = room

	var rows: int = grid.size()
	var cols_all: int = String(grid[0]).length()
	# 扫全部格，不只看左右两列 —— 上下门可以在顶行/底行的任意列。
	# 一间房最大 100×40 = 4000 格，一次性扫完的代价可以忽略。
	for r: int in range(rows):
		for c: int in range(cols_all):
			var ch: String = _char_at(grid, r, c)
			var key: String = ""
			if ch == CH_DOOR_L:
				key = "door_L"
			elif ch == CH_DOOR_R:
				key = "door_R"
			elif ch == CH_DOOR_U:
				key = "door_U"
			elif ch == CH_DOOR_D:
				key = "door_D"
			else:
				continue
			if not meta.has(key):
				push_error("地形里有 %s 门，但头部没有 %s=path|spawn|label" % [ch, key])
				_fail += 1
				continue
			var parts: PackedStringArray = String(meta[key]).split("|", true)
			var target: String = parts[0] if parts.size() > 0 else ""
			var spawn: String = parts[1] if parts.size() > 1 else ""
			var label: String = parts[2] if parts.size() > 2 else ""

			var door := Area2D.new()
			door.name = "DoorTo%s" % target.get_file().get_basename()
			var center := Vector2(ORIGIN.x + float(c) * TILE + TILE * 0.5,
				ORIGIN.y + float(r) * TILE + TILE * 0.5)
			# 垂直门的触发区盖住「门格 + 内侧两格」：
			#   U 在顶行，人从下面够到 → 整体下移 1 格
			#   D 在底行，人站在上面往下掉 → 整体上移 1 格
			# 水平门不用移：碰撞盒本身 140 高，已覆盖上下各 1 格。
			if ch == CH_DOOR_U:
				center += Vector2(0.0, TILE)
			elif ch == CH_DOOR_D:
				center -= Vector2(0.0, TILE)
			door.position = center
			door.set_script(load("res://world/interactables/RoomDoor.gd"))
			door.set("target_scene_path", target)
			# spawn 留空时不要覆盖 —— RoomDoor.gd 的默认值是 SpawnFromLeft，
			# 写成 "" 会让目标房间定位不到入口。
			if not spawn.is_empty():
				door.set("target_spawn_name", spawn)
			doors_root.add_child(door)
			door.owner = room

			var shape := CollisionShape2D.new()
			shape.name = "CollisionShape2D"
			var rect := RectangleShape2D.new()
			# 水平门：窄而高（1 列宽 × 3 格高）；垂直门：宽而扁（3 格宽 × 1 格高）。
			# 这个不对称就是"门洞"和"地板洞"的物理差别。
			rect.size = (Vector2(140.0, 60.0) if (ch == CH_DOOR_U or ch == CH_DOOR_D)
				else Vector2(60.0, 140.0))
			shape.shape = rect
			door.add_child(shape)
			shape.owner = room

			if not label.is_empty():
				# 标签往房间内侧长，不是居中往两边长。
				# 居中版在边缘门上会顶出屏幕：Room01 实拍「→ 画页二」右半截被裁、
				# 「← 休息小屋」箭头被裁。门在 c0 就往右排，门在最后一列就往左排。
				var is_vert: bool = (ch == CH_DOOR_U or ch == CH_DOOR_D)
				var at_right_edge: bool = (c == cols_all - 1)
				var lbl := Label.new()
				lbl.name = "Label"
				if is_vert:
					# 同理：U 的标签往下排（房间在它下面），D 的标签往上排。
					lbl.offset_left = -90.0
					lbl.offset_right = 90.0
					lbl.offset_top = 18.0 if ch == CH_DOOR_U else -78.0
					lbl.offset_bottom = 48.0 if ch == CH_DOOR_U else -48.0
				else:
					lbl.offset_left = -180.0 if at_right_edge else 34.0
					lbl.offset_top = -96.0
					lbl.offset_right = -34.0 if at_right_edge else 180.0
					lbl.offset_bottom = -66.0
				lbl.add_theme_font_size_override("font_size", 20)
				# 线框稿是深底，深棕色标签等于看不见 —— 按模式换色。
				lbl.add_theme_color_override("font_color",
					WIRE_LABEL if _wire else Color(0.35, 0.2, 0.1, 1.0))
				lbl.text = label
				if is_vert:
					lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				else:
					lbl.horizontal_alignment = (
						HORIZONTAL_ALIGNMENT_RIGHT if at_right_edge else HORIZONTAL_ALIGNMENT_LEFT
					)
				lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
				door.add_child(lbl)
				lbl.owner = room
			print("  门 %s → %s (%s)" % [door.name, target.get_file(), spawn])

## 机关门 + 拉杆。位置全部来自蓝图（`G` / `S`），不手摆 —— 道理同 EnemySpawn。
##
## 产物是 `Mechanisms` 节点下的 `Gate`（SwitchGate）和 `Lever`（Lever）。
## 两者都不在这里建子节点：几何、碰撞、提示文字由脚本自己在 `_ready` 里长出来。
## 为什么：生成器跑的时候场景**不在树里**（只 instantiate 不 add_child），
## `_ready` 不会执行，所以子节点既不会重复生成，也不会被打包进 tscn。
## 这正是我们要的 —— tscn 里只留"门在哪、几格高"这一个契约。
func _build_mechanisms(grid: Array, room: Node) -> void:
	var gates: Array[Vector2i] = _cells_of(grid, CH_GATE)
	var switches: Array[Vector2i] = _cells_of(grid, CH_SWITCH)
	if gates.is_empty() or switches.is_empty():
		return

	var root := Node2D.new()
	root.name = "Mechanisms"
	room.add_child(root)
	root.owner = room

	gates.sort_custom(func(a: Vector2i, b: Vector2i) -> bool: return a.y < b.y)
	var gate: Node = GATE_SCRIPT.new()
	gate.name = "Gate"
	gate.cells = gates.size()
	gate.width_cells = 1
	gate.position = Vector2(ORIGIN.x + float(gates[0].x) * TILE,
		ORIGIN.y + float(gates[0].y) * TILE)
	gate.collision_layer = 1
	gate.collision_mask = 0
	root.add_child(gate)
	gate.owner = room

	var sw: Vector2i = switches[0]
	var lever: Node = LEVER_SCRIPT.new()
	lever.name = "Lever"
	# 原点在**脚下**：开关格下面那格是站面，所以 y 取 (sw.y + 1) 的上沿
	lever.position = Vector2(ORIGIN.x + float(sw.x) * TILE + TILE * 0.5,
		ORIGIN.y + float(sw.y + 1) * TILE)
	root.add_child(lever)
	lever.owner = room

	print("  机关：闸门 c%d r%d..r%d（%d 格）；开关 c%d r%d"
		% [gates[0].x, gates[0].y, gates[gates.size() - 1].y, gates.size(), sw.x, sw.y])

func _build_spawns(grid: Array, meta: Dictionary, room: Node) -> void:
	var rows: int = grid.size()
	var cols: int = String(grid[0]).length()
	var left_door := Vector2i(-1, -1)
	var right_door := Vector2i(-1, -1)
	for r: int in range(rows):
		if _char_at(grid, r, 0) == CH_DOOR_L:
			left_door = Vector2i(0, r)
		if _char_at(grid, r, cols - 1) == CH_DOOR_R:
			right_door = Vector2i(cols - 1, r)

	# 出生点放在门内侧：从 3 格开始往门口退，取第一个**真正站得住**的格。
	# 不能写死 ±3 —— Room02 右门内侧是 2 格高的台地，硬放会把玩家塞进实心块里。
	if left_door.x >= 0:
		_make_spawn(room, grid, "SpawnFromLeft", left_door, 1, cols)
	if right_door.x >= 0:
		_make_spawn(room, grid, "SpawnFromRight", right_door, -1, cols)

	# 上下门是纵向落点，不能套 _make_spawn —— 那个只往左右两侧找，
	# 放在顶行会沿着 r=0 横着扫，扫出去全是墙。
	var up_door := Vector2i(-1, -1)
	var down_door := Vector2i(-1, -1)
	for c: int in range(cols):
		if _char_at(grid, 0, c) == CH_DOOR_U:
			up_door = Vector2i(c, 0)
		if _char_at(grid, rows - 1, c) == CH_DOOR_D:
			down_door = Vector2i(c, rows - 1)
	# 从上一间的 D 掉进来 → 落点叫 SpawnFromUp（"从上面来的"）
	if up_door.x >= 0:
		_make_spawn_vert(room, grid, "SpawnFromUp", up_door, 1)
	# 从下一间往上走进来 → 落点叫 SpawnFromDown
	if down_door.x >= 0:
		_make_spawn_vert(room, grid, "SpawnFromDown", down_door, -1)

	# 安全屋专用：BaseRoom 死亡重生的 default_rest_marker 就是这个名字，
	# 少一个就是"在安全屋倒下 → 找不到 Marker → 玩家原地不动"。
	if meta.has("spawn_rest_c"):
		var c: int = int(meta["spawn_rest_c"])
		for r: int in range(rows - 1, -1, -1):
			if _standable(grid, r, c):
				var pos := Vector2(ORIGIN.x + float(c) * TILE + TILE * 0.5, ORIGIN.y + float(r) * TILE + TILE * 0.5)
				var m := Marker2D.new()
				m.name = "SpawnFromRest"
				m.position = pos
				room.add_child(m)
				m.owner = room
				print("  SpawnFromRest = %s" % pos)
				break

## 纵向落地：从门格沿 `dir` 方向逐行找第一个站得住的格。
##
## 为什么不复用 _make_spawn：那个函数只沿**同一行**往左右找，
## 而上下门的落点在**同一列**的不同行。两者是镜像操作，合并只会写出
## 一半横向一半纵向的 if 分支，比拆开更难读。
func _make_spawn_vert(room: Node, grid: Array, node_name: String, door: Vector2i, dir: int) -> void:
	var rows: int = grid.size()
	var best := Vector2i(-1, -1)
	var r: int = door.y
	while r >= 0 and r < rows:
		if _standable(grid, r, door.x):
			best = Vector2i(door.x, r)
			break
		r += dir
	if best.x < 0:
		push_error("%s：门 c%d r%d 沿垂直方向找不到可落脚的站面" % [node_name, door.x, door.y])
		_fail += 1
		return
	var pos := Vector2(ORIGIN.x + float(best.x) * TILE + TILE * 0.5,
		ORIGIN.y + float(best.y) * TILE + TILE * 0.5)
	var m := Marker2D.new()
	m.name = node_name
	m.position = pos
	room.add_child(m)
	m.owner = room
	print("  %s = %s（门在 %d,%d）" % [node_name, pos, door.x, door.y])

func _make_spawn(room: Node, grid: Array, node_name: String, door: Vector2i, dir: int, cols: int) -> void:
	var best := Vector2i(-1, -1)
	for k: int in [3, 2, 1]:
		var c: int = door.x + dir * k
		if c < 0 or c >= cols:
			continue
		if _standable(grid, door.y, c):
			best = Vector2i(c, door.y)
			break
	if best.x < 0:
		# 门洞内通常站得住；若悬空（3 格门洞只标了中心格），往下找第一块实地
		best = door
		for rr: int in range(door.y + 1, grid.size()):
			if _standable(grid, rr, door.x):
				best = Vector2i(door.x, rr)
				break
	var pos := Vector2(ORIGIN.x + float(best.x) * TILE + TILE * 0.5, ORIGIN.y + float(best.y) * TILE + TILE * 0.5)
	var m := Marker2D.new()
	m.name = node_name
	m.position = pos
	room.add_child(m)
	m.owner = room
	print("  %s = %s（门在 %d,%d）" % [node_name, pos, door.x, door.y])

#------------------------------------------------------------------------------
# 工具
#------------------------------------------------------------------------------

func _count_char(grid: Array, ch: String) -> int:
	var n: int = 0
	for row: String in grid:
		for c: int in range(row.length()):
			if row[c] == ch:
				n += 1
	return n
