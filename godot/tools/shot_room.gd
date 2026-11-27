extends SceneTree

## 房间实拍：加载场景、等相机稳定，把 viewport 存成 PNG。
##
## 用法（**不能加 --headless**，headless 没有 viewport，存出来是全黑）：
##   ... --script res://tools/shot_room.gd -- Room02
##   ... --script res://tools/shot_room.gd -- Room01 invade 312
##       第 2 个参数带 invade = 先开局入侵（否则房间是空的，看不见敌人）；
##       第 3 个参数 = 多等几帧再拍，用来卡到「起手」那一瞬。
##       注意：真敌人要 5 秒才走到门口，等 0 帧拍不到东西。
##   ... --script res://tools/shot_room.gd -- Room01 overview
##       overview = 关掉相机跟随、缩到 0.66，一张图装下整间房。
##       房间宽过一屏（Room01 是 40 格 = 1920px）之后，贴脸截图只能看见半间，
##       "结构对不对"必须看全貌 —— 这个模式就是为此加的。
##
## 产物：art/out/room/shot_<Room>.png / shot_<Room>_overview.png

const OUT_DIR := "res://art/out/room"

func _initialize() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	var room_name: String = args[0] if args.size() > 0 else "Room02"
	var overview: bool = args.size() > 1 and (args[1] == "overview" or args[1] == "overviewclear")
	var clear_sky: bool = args.size() > 1 and args[1] == "overviewclear"
	var invade: bool = args.size() > 1 and args[1] == "invade"
	## 多等几帧再拍。
	##
	## ❗ 不能无条件写 `int(args[2])`：GDScript 的 `String.to_int()` 会把字符串里
	## **所有数字拼起来** —— `sel=0,258,0,112` 解析出 2580152，
	## 于是"等 40 帧"变成等 258 万帧，表现是进程挂死、日志停在 `[nohud]` 之后一行。
	## 我按"渲染崩了"查了三轮，实际是这一行。只认纯数字参数，或显式 `wait=`。
	var extra_frames: int = 0
	for a: String in args:
		if a.begins_with("wait="):
			extra_frames = int(a.substr(5))
	if args.size() > 2 and args[2].is_valid_int():
		extra_frames = int(args[2])
	## 分段俯瞰的文件名后缀，避免 4 张段图互相覆盖。
	var seg_tag: String = ""
	if overview and not clear_sky:
		invade = true
	# 支持传整条 res:// 路径：拼装出来的关卡不在 world/rooms/ 下
	# （Level01 在 world/level/），写死前缀会让它加载不到。
	var path := (
		room_name if room_name.begins_with("res://")
		else "res://world/rooms/%s.tscn" % room_name
	)
	var ps: PackedScene = load(path) as PackedScene
	if ps == null:
		push_error("加载失败：%s" % path)
		quit(2)
		return
	var scene: Node = ps.instantiate()
	# 开篇旁白（StoryAutoStart，延迟 0.35s）会整屏盖住地形，结构图就废了。
	# 截图工具不需要剧情，先把"已看过"的标记写上 —— 比事后找气泡节点去 hide 可靠。
	var ws_flag: Node = root.get_node_or_null("WorldState")
	if ws_flag != null:
		(ws_flag.get("story_flags") as Dictionary)["prologue_seen"] = true
	root.add_child(scene)
	# 必须等一帧再开入侵：`_ready` 里的 @onready 引用（InvadersContainer 等）
	# 还没解析完，直接调 `_setup_invasion_state` 会拿到 null。
	await process_frame
	if invade:
		var ws: Node = root.get_node_or_null("WorldState")
		if ws != null:
			# 用场景自己的 room_id，而不是从文件名里数数字 ——
			# 拼装关叫 Level01，`room_name.substr(4)` 会算成 room_00。
			var rid: Variant = scene.get("room_id")
			var flag: Array = ws.get("invaded_rooms") as Array
			if rid != null and str(rid) != "" and not flag.has(str(rid)):
				flag.append(str(rid))
			# 拼装关（Level01.tscn）的根节点是裸 Node2D，没有这个方法。
			# 硬 call 会抛 "Invalid call" 并当场中断 _initialize，一张图都存不出来 ——
			# 而 overview 模式强制 invade=true，所以「拍拼装关全景」这条路是必炸的。
			if scene.has_method("_setup_invasion_state"):
				scene.call("_setup_invasion_state")

	# 可选 `at=<x>`：把人放到指定横坐标再拍。
	# 用途是"玩家站在闸门前到底看到什么" —— 整间房的俯瞰图看不出锁灯和拉杆够不够醒目。
	# 同时关掉两样东西：StoryDirector 的开场旁白（整屏对话框把地形盖死），
	# 和紫月环境光（结构图要看几何，不需要氛围）。
	#
	# ❗ 参数必须**先全部收进字典再消费**。
	# 原来是边遍历边用，`at=` 排在 `aty=` 前面时读到的还是默认 y=560 —— 人落到 (7100,1272)
	# 半空中，相机周围 0 条几何，拍出来只有背板色（#12151A）。
	# 我按"渲染坏了"查了两轮，实际是参数顺序问题。字典一次收完，这类坑绝迹。
	var opt: Dictionary = {}
	for a: String in OS.get_cmdline_user_args():
		var eq: int = a.find("=")
		if eq > 0:
			opt[a.substr(0, eq)] = a.substr(eq + 1)
	var at_shot: bool = false
	var fall_to_floor: bool = false
	var at_from_y: float = 0.0
	if opt.has("at") and not overview:
		var pl: Node2D = scene.get_node_or_null("Player") as Node2D
		if pl != null:
			var raw: String = str(opt["at"])
			var parts: PackedStringArray = raw.split(",")
			var at_x: float = float(parts[0])
			var at_y: float = NAN
			if parts.size() > 1:
				at_y = float(parts[1])
			if opt.has("aty"):
				at_y = float(str(opt["aty"]))
			if is_nan(at_y):
				# 不给 y 就「从这一列那间房的内部顶端掉下来」。
				# 试过两种写法，都不成立，记在这里免得再踩：
				#   ① 从关卡最顶上掉 —— 落在房间**屋顶**（实测 x=5700 停在 y=192，人在石头外面）；
				#   ② 用 `(row+rows-1)*48` 算地板再减两行 —— 各零件的床底厚度不一样
				#      （入口房地板在 row+rows-2、闸门房在 row+rows-3），没有统一公式。
				# 所以只取"房间顶边往下一行"这个必然在室内的点，剩下交给物理：
				# 落在这一列最高的那块东西上，就是玩家从上面进来会踩到的东西。
				at_y = _room_top_y(scene, at_x) + 48.0
				fall_to_floor = true
				at_from_y = at_y
			pl.global_position = Vector2(at_x, at_y)
			at_shot = true
	if at_shot and fall_to_floor:
		# 落下来本身要花时间（5376px 高约 140 物理帧），这段必须**在第 40 帧稳定之前**。
		var waited: int = 0
		var fell: Node2D = scene.get_node_or_null("Player") as Node2D
		while fell != null and not fell.is_on_floor() and waited < 900:
			await physics_frame
			waited += 1
		if fell != null:
			print("  [at] 从 y=%.0f 落到 y=%.0f（%d 帧）" % [at_from_y, fell.global_position.y, waited])
	if at_shot:
		# 传送几千像素之后相机还在原地缓动，直接拍 = 拍一片黑（实测 x=7100 全黑）。
		# 传送必须同时把相机的平滑重置掉，再等一帧让它按新位置定位。
		var cam0: Node = scene.get_node_or_null("Player/Camera2D")
		if cam0 is Camera2D:
			(cam0 as Camera2D).reset_smoothing()
		await process_frame
		await physics_frame
		var sd: Node = root.get_node_or_null("StoryDirector")
		if sd is CanvasLayer:
			(sd as CanvasLayer).visible = false
		if scene.has_method("_set_env_night"):
			scene.call("_set_env_night", 0.0, 0.0)
		var des: Node = scene.get_node_or_null("PostProcessLayer/DesaturateRect")
		if des != null and des.material is ShaderMaterial:
			(des.material as ShaderMaterial).set_shader_parameter("desaturate_amount", 0.0)

	if overview:
		var p: Node = scene.get_node_or_null("Player")
		# 房间实际多大，问房间自己（BaseRoom._derive_room_bounds 从地形碰撞算）。
		# 这里**不能**再写死 0.62 / (960,360)：那是 26 格一屏时代的常数，
		# 房间一改宽，俯瞰图就开始切墙 —— 图是用来判结构的，切了墙就判不了。
		var bounds: Rect2 = Rect2(0.0, 0.0, 1280.0, 720.0)
		if scene.has_method("_derive_room_bounds"):
			bounds = scene.call("_derive_room_bounds") as Rect2
		# `sel=<起格>,<止格>[,<起行>,<止行>]`：只框一段。
		# 拼装关可以到 258 格宽（12384px），整关塞进一屏会缩成 100px 高的细条，
		# 连"平台在哪一层"都看不出来。分段拍才判得了结构。
		#
		# ❗ 只给左右不给上下是不够的：整关 112 行高，`sel=162,206` 会拿全高去算 zoom
		# （0.126），2112px 宽的房间被压成一条 266px 的细带。要给行范围才拍得出房间内部。
		for a: String in OS.get_cmdline_user_args():
			if a.begins_with("sel="):
				var seg: PackedStringArray = a.substr(4).split(",")
				if seg.size() >= 2:
					var x0: float = float(seg[0])
					var x1: float = float(seg[1])
					var y0: float = bounds.position.y
					var y1: float = bounds.position.y + bounds.size.y
					if seg.size() >= 4:
						y0 = float(seg[2]) * 48.0
						y1 = float(seg[3]) * 48.0
					bounds = Rect2(x0 * 48.0, y0, (x1 - x0) * 48.0, y1 - y0)
					seg_tag = "_%d-%d" % [int(x0), int(x1)]
					if seg.size() >= 4:
						seg_tag += "_%d-%d" % [int(seg[2]), int(seg[3])]
		var vp: Vector2 = root.get_visible_rect().size
		var fit: Vector2 = vp / (bounds.size * 1.06)
		var z: float = minf(fit.x, fit.y)
		if p is Node2D:
			var cam: Camera2D = (p as Node2D).get_node_or_null("Camera2D") as Camera2D
			if cam != null:
				cam.zoom = Vector2(z, z)
				cam.position_smoothing_enabled = false
				# ❗ 必须把相机从玩家身上摘下来，并且清掉房间边界。
				# 之前只改 zoom + 把玩家挪到中线，结果：玩家还是会掉到地面，
				# 相机跟着掉；缩小后下半屏宽超过房间半宽，limit 无法满足，
				# Godot 把相机钳在一个怪位置 —— 右墙直接被切出画面。
				# 俯瞰图的唯一用途是"一眼看全"，相机就得由这一支完全接管。
				cam.reparent(scene, false)
				cam.limit_left = -100000
				cam.limit_right = 100000
				cam.limit_top = -100000
				cam.limit_bottom = 100000
				cam.global_position = bounds.get_center()
				cam.make_current()
			# 玩家站在地面层靠左，图上能看出"人在哪一层"。
			# y 不能写死：一屏时代的 560 在 1920 高的关卡里是岩层，人会被挤出去。
			(p as Node2D).global_position = Vector2(
				bounds.position.x + 320.0, bounds.position.y + bounds.size.y - 320.0)

		# 俯瞰图只用来读结构，关掉紫月与去饱和 ——
		# 否则整屏被 env_light 染成紫色（实测连草地都变成 191,184,203 淡紫），
		# 配色对不对根本看不出来。
		if scene.has_method("_set_env_night"):
			scene.call("_set_env_night", 0.0, 0.0)
		var desat: Node = scene.get_node_or_null("PostProcessLayer/DesaturateRect")
		if desat != null and desat.material is ShaderMaterial:
			(desat.material as ShaderMaterial).set_shader_parameter("desaturate_amount", 0.0)

	# 设计稿不该有 UI。
	#
	# 线框稿要回答的是"空间对不对"，浮在画面上的任何东西都是干扰：
	# 顶部血条、底部操作提示、旁白气泡、还有 PostProcessLayer 的调色
	# （紫月环境光 + 去饱和 + 纸纹）。全部关掉，只留几何。
	# 玩家视角（at=）同样关 —— 那张图是用来判"站在闸门前看得清吗"，
	# 被一条操作提示盖住下半屏就判不了。
	var nohud: bool = overview or at_shot or OS.get_cmdline_user_args().has("nohud")
	if nohud:
		_hide_ui(scene)

	# 等物理落定 + 相机 smoothing 收敛（8 的速度，40 帧足够）
	print("  [wait] frames=%d" % (40 + extra_frames))
	for i: int in range(40 + extra_frames):
		await process_frame
	# 再压一次：TouchHUD 的 _process 会按血量自己把 visible 设回 true，
	# 只在开头设一次的话，等了 40 帧它又回来了（实测血条就是这么漏进截图的）。
	# `process_mode = DISABLED` 是为了让它**不再改** visible，光设 false 不够。
	if nohud:
		_hide_ui(scene)
	await RenderingServer.frame_post_draw

	var img: Image = root.get_texture().get_image()
	if img == null:
		push_error("viewport 取图为空（是不是加了 --headless？）")
		quit(1)
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT_DIR))
	var suffix: String = ""
	if overview:
		suffix = "_clear" if clear_sky else "_overview"
	suffix += seg_tag
	# `at=<x>` 也要进文件名：同一个关拍三处特写，不带位置就只有最后一张留下。
	if opt.has("at"):
		suffix += "_x" + str(opt["at"]).replace(",", "_")
	var stem: String = room_name.get_file().get_basename()
	var out := ProjectSettings.globalize_path("%s/shot_%s%s.png" % [OUT_DIR, stem, suffix])
	var err: int = img.save_png(out)
	print("SHOT %s → %s (%dx%d)" % [room_name, out, img.get_width(), img.get_height()])
	quit(0 if err == OK else 1)

## 这一列所属房间的顶边在世界的哪个 y（行号 × 48）。
##
## 数据源是拼装器写出的 `*.layout.json`（`rooms` 里每间房有 col/row/cols/rows）。
## 不读场景里的碰撞盒：那些盒子有天花板、有石柱、有平台，算术上分不出"这是地板"。
##
## 一列可能命中多间房（支线口袋就压在父房间下面），取**行号最小**的那间：
## 人在关卡里总是先走到上层那间，不该被支线的深坑先接住。
##
## 注意这里**只给顶边，不给地板**：床底厚度各零件不同（见调用处注释），
## 任何"行数减几"的公式都会在某些房间上差一到三行。
func _room_top_y(scene: Node, x: float) -> float:
	var dir_path: String = (scene.scene_file_path as String).get_base_dir()
	var json_name: String = ""
	var d: DirAccess = DirAccess.open(dir_path)
	if d != null:
		for f: String in d.get_files():
			if f.ends_with(".layout.json"):
				json_name = f
				break
	if json_name == "":
		push_warning("没找到 %s 下的 *.layout.json，退回关卡顶部" % dir_path)
		var bb: Rect2 = Rect2(0.0, 0.0, 1280.0, 720.0)
		if scene.has_method("_derive_room_bounds"):
			bb = scene.call("_derive_room_bounds") as Rect2
		return bb.position.y + 192.0
	var txt: String = FileAccess.get_file_as_string(dir_path + "/" + json_name)
	var data: Variant = JSON.parse_string(txt)
	if not (data is Dictionary):
		return 192.0
	var col: int = int(floor(x / 48.0))
	var tile: int = 48
	if data is Dictionary and (data as Dictionary).has("tile"):
		tile = int((data as Dictionary)["tile"])
		col = int(floor(x / float(tile)))
	var best_row: int = 1 << 30
	for r: Variant in (data as Dictionary).get("rooms", []):
		var it: Dictionary = r as Dictionary
		var c0: int = int(it.get("col", 0))
		var c1: int = c0 + int(it.get("cols", 0))
		if col < c0 or col >= c1:
			continue
		var row: int = int(it.get("row", 0))
		if row < best_row:
			best_row = row
	if best_row == (1 << 30):
		push_warning("x=%.0f（第 %d 列）不在任何房间里" % [x, col])
		return 192.0
	return float(best_row * tile)

## 关掉所有 UI 层。
##
## 递归找 CanvasLayer 而不是只看直接子节点：`TouchHUD` 是 CanvasLayer 实例，
## 但它内部的 HealthBar 在 `RootControl/HealthBar`，层级深浅不固定；
## 只扫一层的话，迟早有一个 HUD 藏在第二层，截图里就会莫名其妙多一条血条。
## `process_mode = DISABLED` 也必须设：TouchHUD 每帧按血量自己改 visible。
func _hide_ui(scene: Node) -> void:
	var stack: Array[Node] = [scene, root]
	var hits: int = 0
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is CanvasLayer:
			(n as CanvasLayer).visible = false
			n.process_mode = Node.PROCESS_MODE_DISABLED
			hits += 1
		stack.append_array(n.get_children())
	print("  [nohud] 隐藏 CanvasLayer %d 个" % hits)

