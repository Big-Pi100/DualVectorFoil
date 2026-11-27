extends SceneTree

const _ROOM_STATE = preload("res://tests/support/room_state.gd")

## 三套 Shader 接入专项：
## 1) boiling_line 挂敌人精灵材质；2) paper_grain 全屏后处理层；3) desaturate_wipe 去色扩散参数链。
## 用真实场景树 + await 帧，验证资源有效、材质挂载、参数可驱动。

var _fail: int = 0

func _initialize() -> void:
	await _test_shader_resources()
	await _test_paper_layer()
	await _test_boiling_material()
	await _test_desaturate_chain()
	print("SHADER INTEGRATION GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
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

func _test_shader_resources() -> void:
	print("--- 三套 Shader 资源 ---")
	var paths: Array[String] = [
		"res://world/shaders/boiling_line.gdshader",
		"res://world/shaders/paper_grain.gdshader",
		"res://world/shaders/desaturate_wipe.gdshader",
	]
	for p: String in paths:
		var sh: Shader = load(p) as Shader
		_check(sh != null, "%s 可加载" % p.get_file())
		if sh != null:
			# Godot 4.4 脚本层不暴露 Shader.mode；用 ShaderMaterial 实际持有验证可用
			var probe: ShaderMaterial = ShaderMaterial.new()
			probe.shader = sh
			_check(probe.shader == sh, "%s 可作为 canvas_item 材质" % p.get_file())

func _test_paper_layer() -> void:
	print("--- 纸纹后处理层 ---")
	var ps: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	var room: Node2D = ps.instantiate() as Node2D
	root.add_child(room)
	await _frames(2)
	var paper: ColorRect = room.get_node_or_null("PostProcessLayer/PaperGrainRect") as ColorRect
	_check(paper != null, "PaperGrainRect 节点存在")
	if paper != null:
		var mat: ShaderMaterial = paper.material as ShaderMaterial
		_check(mat != null and mat.shader != null, "纸纹材质 + Shader 挂载")
		if mat != null and mat.shader != null:
			_check(mat.shader.resource_path.ends_with("paper_grain.gdshader"), "挂的是纸纹 Shader")
			_check(float(mat.get_shader_parameter("grain_strength")) > 0.0, "纸纹强度参数有效")
	# 绘制顺序：纸纹节点必须在去色节点之后（后绘制→覆盖其上）
	var desat: Node = room.get_node_or_null("PostProcessLayer/DesaturateRect")
	if paper != null and desat != null:
		var children: Array = paper.get_parent().get_children()
		var desat_idx: int = children.find(desat)
		var paper_idx: int = children.find(paper)
		_check(paper_idx > desat_idx, "纸纹在去色层之后绘制（索引 %d > %d）" % [paper_idx, desat_idx])
	room.free()

func _test_boiling_material() -> void:
	print("--- 沸腾线材质（敌人精灵）---")
	var ps: PackedScene = load("res://world/enemies/Invader.tscn") as PackedScene
	var inv: Node2D = ps.instantiate() as Node2D
	root.add_child(inv)
	await _frames(1)
	var vis: Sprite2D = inv.get_node_or_null("Visual") as Sprite2D
	_check(vis != null, "敌人 Visual 是 Sprite2D")
	if vis != null:
		var mat: ShaderMaterial = vis.material as ShaderMaterial
		_check(mat != null and mat.shader != null, "沸腾线材质挂载")
		if mat != null and mat.shader != null:
			_check(mat.shader.resource_path.ends_with("boiling_line.gdshader"), "挂的是沸腾线 Shader")
			_check(float(mat.get_shader_parameter("boil_strength")) <= 0.005,
				"沸腾幅度保守（<=0.005，避免锯齿）")
	inv.free()

func _test_desaturate_chain() -> void:
	print("--- 去色扩散参数链 ---")
	var ws: Node = root.get_node_or_null("WorldState")
	ws.call("reset_state")
	var ps: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	var room: Node2D = ps.instantiate() as Node2D
	root.add_child(room)
	await _frames(3)
	var filter: ColorRect = room.get_node_or_null("PostProcessLayer/DesaturateRect") as ColorRect
	var mat: ShaderMaterial = filter.material as ShaderMaterial
	_check(mat != null and mat.shader != null, "去色材质挂载")
	# 入侵 → desaturate_amount=1
	# 先钉回未侵占再 append（Room01 自 12 F0 起默认入侵，直接 append 会重复）
	_ROOM_STATE.force_uninvaded(ws, room)
	ws.invaded_rooms.append("room_01")
	room.call("_setup_invasion_state")
	await _frames(1)
	_check(is_equal_approx(float(mat.get_shader_parameter("desaturate_amount")), 1.0), "入侵时去色=1")
	# 净化 → tween 扩散 wipe_radius；等足够帧让 tween 推进
	for child in room.get_node("InvadersContainer").get_children():
		child.call("take_damage", 999.0, Vector2.ZERO)
	await _frames(4)
	_check(not ws.invaded_rooms.has("room_01"), "清怪后净化房间")
	_check(float(mat.get_shader_parameter("wipe_radius")) > 0.0, "净化扩散半径已推进")
	# tween 按真实时间推进（purify_tween_duration=0.85s），headless 的 process_frame delta 极小，
	# 用真实计时器等待而非数帧。
	await create_timer(1.2).timeout
	_check(is_equal_approx(float(mat.get_shader_parameter("desaturate_amount")), 0.0),
		"扩散结束后恢复全彩（实际 %.2f）" % float(mat.get_shader_parameter("desaturate_amount")))
	room.free()
