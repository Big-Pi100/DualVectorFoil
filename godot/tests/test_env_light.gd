extends SceneTree

## 环境光（紫月）专项：一份美术两套光照，替代「地面出 _dark / _ally 两张图」。
## 契约见 art/ASSET_RULES.md §3.2.6；校验端 art/tools/env_light.py --check。
##
## 为什么单独一个测试：这条链路有三处会静默失效 ——
##   1) EnvLightRect 没挂材质 → 按 F3 在 mat==null 处 return，界面毫无变化、不报错
##   2) 节点顺序写反 → 先上色再去色，紫月被 DesaturateRect 洗成灰，看起来"没生效"
##   3) night 没跟侵占状态走 → 房间明明被占，却是日光
## 三种都不报错，只能靠断言抓。
##
## 房间清单是**扫目录**出来的，不是硬编码：以前踩过三次"清单外的文件断言碰不到"
## （5 种敌人磁盘 3 种、空矩阵假通过）。新增房间漏挂 EnvLightRect 必须当场 FAIL。

var _fail: int = 0

## 房间状态准备（Room01 自 12 F0 起默认入侵，组件级用例要自己控制侵占状态）
const _ROOM_STATE = preload("res://tests/support/room_state.gd")

## 与 env_light.gdshader 的 uniform 逐一对应。改 shader 不改这里（或反之）→ 当场炸。
const CONTRACT_UNIFORMS: Array[String] = [
	"night", "moon_tint", "tint_pull", "veg_protect",
	"sat_scale", "sat_add", "val_mul", "val_add", "contrast_boost", "lift",
]

func _initialize() -> void:
	await _test_shader_resource()
	await _test_all_rooms_wired()
	await _test_draw_order()
	await _test_invasion_drives_night()
	await _test_f3_toggle()
	await _test_missing_rect_is_safe()
	print("ENV LIGHT GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _frames(count: int) -> void:
	for i: int in range(count):
		await process_frame

func _check(ok: bool, msg: String) -> void:
	if not ok:
		_fail += 1
		print("  FAIL %s" % msg)
	else:
		print("  ok   %s" % msg)

func _env_mat(room: Node) -> ShaderMaterial:
	var rect: ColorRect = room.get_node_or_null("PostProcessLayer/EnvLightRect") as ColorRect
	if rect == null:
		return null
	return rect.material as ShaderMaterial

func _night(room: Node) -> float:
	var mat: ShaderMaterial = _env_mat(room)
	if mat == null:
		return -1.0
	var v: Variant = mat.get_shader_parameter("night")
	return float(v) if v != null else -1.0

## 1) shader 声明的 uniform 与契约一致。
## 注意用 get_shader_uniform_list() 而不是 get_shader_parameter()：
## 后者对"材质没显式赋值"的参数返回 null，会把所有默认值误判成缺失。
func _test_shader_resource() -> void:
	print("--- 环境光 Shader ---")
	var sh: Shader = load("res://world/shaders/env_light.gdshader") as Shader
	_check(sh != null, "env_light.gdshader 可加载")
	if sh == null:
		return
	var declared: Array[String] = []
	for u: Dictionary in sh.get_shader_uniform_list():
		declared.append(str(u.get("name", "")))
	for p: String in CONTRACT_UNIFORMS:
		_check(declared.has(p), "uniform `%s` 已声明" % p)

	# 对比度补偿是上一轮实测定的：乘法会褪色，1.06 只剩 78%，1.30 回到 95% 且零过曝。
	# 默认值写在 shader 源码里，材质不覆盖，所以只能从源码文本验。
	var src: String = FileAccess.get_file_as_string("res://world/shaders/env_light.gdshader")
	var cb_line: String = ""
	for line: String in src.split("\n"):
		if line.begins_with("uniform float contrast_boost"):
			cb_line = line
			break
	_check(cb_line.contains("1.3"), "contrast_boost 默认 1.30（乘法褪色补偿，别改回 1.0）")

## 2) 扫 world/rooms/ 下所有 .tscn。
## 只要是 BaseRoom 系（有 room_id 属性）就必须挂 EnvLightRect —— 漏一个，
## 那个房间按 F3 毫无反应，而且不会有任何报错。
func _test_all_rooms_wired() -> void:
	print("--- 房间挂载（扫目录，不看清单）---")
	var dir: DirAccess = DirAccess.open("res://world/rooms")
	_check(dir != null, "world/rooms 可列目录")
	if dir == null:
		return
	var base_rooms: int = 0
	for file: String in dir.get_files():
		if not file.ends_with(".tscn"):
			continue
		var path: String = "res://world/rooms/" + file
		var ps: PackedScene = load(path) as PackedScene
		if ps == null:
			_check(false, "%s 可加载" % file)
			continue
		var room: Node2D = ps.instantiate() as Node2D
		root.add_child(room)
		await _frames(1)
		# BaseRoom.gd 有 @export room_id；TestCombat / WhiteboxTest 是独立脚本，没有这个属性
		if room.get("room_id") == null:
			print("  --   %s 非 BaseRoom 系，跳过" % file)
			room.free()
			continue
		base_rooms += 1
		var mat: ShaderMaterial = _env_mat(room)
		_check(mat != null, "%s EnvLightRect 挂了材质" % file)
		if mat != null:
			_check(mat.shader != null and mat.shader.resource_path.ends_with("env_light.gdshader"),
				"%s 挂的是 env_light" % file)
			# night 必须被显式赋值：否则 get_shader_parameter 返回 null，
			# F3 里 float(null) 直接抛错，整条切换链断掉
			_check(mat.get_shader_parameter("night") != null, "%s 材质显式设了 night" % file)
		room.free()
	_check(base_rooms >= 6, "至少扫到 6 个 BaseRoom 系场景（实际 %d 个）" % base_rooms)

## 3) 绘制顺序：EnvLight 必须在 Desaturate 之后。
## 写反 → 紫月先上色、再被整层去色洗掉，画面看起来"着色没生效"。
func _test_draw_order() -> void:
	print("--- 后处理顺序 ---")
	var room: Node2D = (load("res://world/rooms/Room01.tscn") as PackedScene).instantiate() as Node2D
	root.add_child(room)
	await _frames(1)
	var layer: Node = room.get_node_or_null("PostProcessLayer")
	var desat: Node = room.get_node_or_null("PostProcessLayer/DesaturateRect")
	var env: Node = room.get_node_or_null("PostProcessLayer/EnvLightRect")
	_check(layer != null and desat != null and env != null, "三个后处理节点齐备")
	if layer != null and desat != null and env != null:
		var children: Array = layer.get_children()
		var di: int = children.find(desat)
		var ei: int = children.find(env)
		_check(ei > di, "环境光在去色层之后绘制（索引 %d > %d）" % [ei, di])
	room.free()

## 4) night 跟着侵占状态走：被占=紫月(1.0)，清完=日光(0.0)
func _test_invasion_drives_night() -> void:
	print("--- 侵占 → 紫月 ---")
	var ws: Node = root.get_node_or_null("WorldState")
	_check(ws != null, "WorldState 可用")
	if ws == null:
		return
	ws.call("reset_state")
	var room: Node2D = (load("res://world/rooms/Room01.tscn") as PackedScene).instantiate() as Node2D
	root.add_child(room)
	await _frames(2)
	# Room01 现在默认入侵（12 F0）。这条用例要的是「侵占前」那一半，自己钉回去。
	_ROOM_STATE.force_uninvaded(ws, room)
	await _frames(1)
	_check(is_equal_approx(_night(room), 0.0),
		"未侵占时 night=0（实际 %.2f）" % _night(room))

	# invaded_rooms 是 Array[String]，用 append 而不是整体 set 一个无类型 Array
	var arr: Array = ws.get("invaded_rooms")
	arr.append("room_01")
	room.call("_setup_invasion_state")
	await _frames(1)
	_check(is_equal_approx(_night(room), 1.0),
		"被侵占时 night=1.0（实际 %.2f）" % _night(room))

	# 清完全部敌人 → 净化 → night 补间回 0（purify 0.85s，headless 用真实计时器等）
	for child: Node in room.get_node("InvadersContainer").get_children():
		child.call("take_damage", 999.0, Vector2.ZERO)
	await create_timer(1.4).timeout
	_check(is_equal_approx(_night(room), 0.0),
		"清完后 night=0.0（实际 %.2f）" % _night(room))
	room.free()

## 5) F3 真的能翻转 —— 这是「实机看两套光照」唯一的入口，断了就没法人工验收
func _test_f3_toggle() -> void:
	print("--- F3 调试开关 ---")
	var ws: Node = root.get_node_or_null("WorldState")
	if ws != null:
		ws.call("reset_state")
	var room: Node2D = (load("res://world/rooms/SafeHouse.tscn") as PackedScene).instantiate() as Node2D
	root.add_child(room)
	await _frames(2)
	var before: float = _night(room)

	room.call("_unhandled_input", _f3())
	await create_timer(0.6).timeout
	_check(not is_equal_approx(before, _night(room)),
		"按 F3 后 night 改变（%.2f → %.2f）" % [before, _night(room)])

	# 再按一次必须翻回来，否则只能单向切
	room.call("_unhandled_input", _f3())
	await create_timer(0.6).timeout
	_check(is_equal_approx(_night(room), before),
		"再按 F3 翻回原值（实际 %.2f）" % _night(room))
	room.free()

func _f3() -> InputEventKey:
	var ev := InputEventKey.new()
	ev.keycode = KEY_F3
	ev.physical_keycode = KEY_F3
	ev.pressed = true
	return ev

## 6) 非 BaseRoom 场景（TestCombat / WhiteboxTest）没有 EnvLightRect，
## BaseRoom 里 env_rect 用的是 get_node_or_null，不能崩。
func _test_missing_rect_is_safe() -> void:
	print("--- 无环境光节点的场景 ---")
	var ps: PackedScene = load("res://world/rooms/TestCombat.tscn") as PackedScene
	if ps == null:
		print("  --   TestCombat.tscn 不存在，跳过")
		return
	var room: Node2D = ps.instantiate() as Node2D
	root.add_child(room)
	await _frames(1)
	_check(room.get_node_or_null("PostProcessLayer/EnvLightRect") == null,
		"TestCombat 本来就没有 EnvLightRect")
	_check(room.get("room_id") == null, "TestCombat 不是 BaseRoom 系（独立脚本）")
	room.free()

	# BaseRoom 里 env_rect == null 时的早退分支：拿一个真 BaseRoom 场景，
	# 把它唯一的 EnvLightRect 删掉，再走一遍 _setup_invasion_state 和 F3。
	var sr: Node2D = (load("res://world/rooms/Room02.tscn") as PackedScene).instantiate() as Node2D
	root.add_child(sr)
	await _frames(1)
	var rect: ColorRect = sr.get_node_or_null("PostProcessLayer/EnvLightRect") as ColorRect
	_check(rect != null, "Room02 有 EnvLightRect 可拆")
	if rect != null:
		rect.free()
		await _frames(1)
		sr.call("_setup_invasion_state")
		sr.call("_unhandled_input", _f3())
		await _frames(1)
		_check(true, "EnvLightRect 缺失时 _setup_invasion_state / F3 均不崩")
	sr.free()
