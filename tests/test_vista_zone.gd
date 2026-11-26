extends SceneTree

## Phase 2 · VistaZone 眺望镜头专项测试（GDD 3.2）。
## 覆盖：事件总线幂等/复位、驻足触发、相机拉远、HUD 淡出退出恢复、
## 切场景兜底、两房间布置与室内不误放。全部走真实节点与真实时间。

var _errors: Array[String] = []

func _initialize() -> void:
	call_deferred("_run_tests")

func _check(ok: bool, message: String) -> void:
	if ok:
		print("[PASS] ", message)
	else:
		_errors.append(message)
		print("[FAIL] ", message)

func _wait(sec: float) -> void:
	await create_timer(sec).timeout

func _run_tests() -> void:
	var ws = root.get_node_or_null("WorldState")
	_check(ws != null, "Autoload WorldState 已注册")
	if ws == null:
		quit(1)
		return

	# ===== A. 事件总线：广播 / 幂等 / 复位 =====
	ws.reset_state()
	var captured: Array = []
	var cb: Callable = func(active: bool, tz: float, zd: float, hf: float, anim: String) -> void:
		captured.append([active, tz, zd, hf, anim])
	ws.vista_mode_changed.connect(cb)

	ws.set_vista_mode(true, 0.65, 0.8, 0.2, "side")
	_check(ws.vista_active, "进入眺望：状态置位")
	_check(captured.size() == 1, "进入眺望：广播一次")
	if captured.size() >= 1:
		var first: Array = captured[0]
		_check(bool(first[0]) and is_equal_approx(float(first[1]), 0.65)
			and str(first[4]) == "side", "广播参数完整（zoom/动画名）")

	ws.set_vista_mode(true, 0.65, 0.8, 0.2, "side")
	_check(captured.size() == 1, "重复进入不重复广播（幂等）")

	ws.set_vista_mode(false)
	_check(not ws.vista_active, "退出眺望：状态复位")
	_check(captured.size() == 2 and not bool(captured[1][0]), "退出眺望：广播一次")
	ws.vista_mode_changed.disconnect(cb)
	ws.reset_state()
	_check(not ws.vista_active, "reset_state 清除眺望状态（不进存档）")

	# ===== B. 真实房间：驻足触发 → 拉远 → 淡出 → 移动恢复 =====
	var room_scene: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	_check(room_scene != null, "Room01 场景可加载")
	if room_scene == null:
		quit(1)
		return
	var room: Node2D = room_scene.instantiate() as Node2D
	root.add_child(room)
	await _wait(0.25)  # 让物理初始化、主角落到地板

	var zone: Area2D = room.get_node_or_null("VistaPoint") as Area2D
	var player = room.get_node_or_null("Player")
	var hud = room.get_node_or_null("TouchHUD")
	_check(zone != null, "Room01 有眺望触发区")
	_check(zone != null and zone.has_signal("vista_activated"), "眺望区 VistaZone 脚本已挂载")
	_check(player != null and hud != null, "房间内 Player / TouchHUD 实例存在")
	if zone == null or not zone.has_signal("vista_activated") or player == null or hud == null:
		room.queue_free()
		quit(1)
		return

	var activated: Array = []
	zone.vista_activated.connect(func() -> void: activated.append(true))
	# 主角走进眺望区并站定（脚底落地后区域 y 范围覆盖）
	player.global_position = zone.global_position
	player.velocity = Vector2.ZERO
	player.virtual_move_vector = Vector2.ZERO

	await _wait(1.0)  # dwell_time 0.45 + 余量
	_check(activated.size() >= 1, "驻足达阈值 → 触发眺望")
	_check(ws.vista_active, "驻足触发后 WorldState 进入眺望态")
	_check(player.sprite.animation == &"back", "眺望时切 back 定格帧（预留资产派上用场）")

	await _wait(1.25)  # zoom_duration 1.1 + 余量
	_check(absf(player.camera.zoom.x - 0.72) < 0.05,
		"相机平滑拉远到 0.72（实际 %.3f）" % player.camera.zoom.x)
	_check(not hud.root_control.visible, "HUD 淡出后隐藏，不吞触摸事件")

	# 移动即退出（零挫败：不锁输入）
	player.virtual_move_vector = Vector2(1.0, 0.0)
	await _wait(1.6)
	_check(not ws.vista_active, "移动后退出眺望")
	_check(absf(player.camera.zoom.x - 1.0) < 0.05,
		"相机恢复常态 zoom=1（实际 %.3f）" % player.camera.zoom.x)
	_check(hud.root_control.visible and is_equal_approx(hud.root_control.modulate.a, 1.0),
		"HUD 恢复可见且不透明")

	room.queue_free()
	await _wait(0.15)
	_check(not ws.vista_active, "切场景时触发区 _exit_tree 兜底复位")

	# ===== C. 房间布置：野外房间有眺望点，安全屋不放 =====
	var room2: Node2D = (load("res://world/rooms/Room02.tscn") as PackedScene).instantiate() as Node2D
	root.add_child(room2)
	await _wait(0.1)
	var zone2 = room2.get_node_or_null("VistaPoint")
	_check(zone2 is Area2D and zone2.vista_anim == "side", "Room02 有侧眺眺望点（side 帧）")
	room2.queue_free()
	await _wait(0.1)

	var safe: Node2D = (load("res://world/rooms/SafeHouse.tscn") as PackedScene).instantiate() as Node2D
	root.add_child(safe)
	await _wait(0.1)
	_check(safe.get_node_or_null("VistaPoint") == null, "安全屋室内不放眺望点")
	safe.queue_free()
	await _wait(0.1)

	if _errors.is_empty():
		print("=== ALL VISTA ZONE TESTS PASSED ===")
		quit(0)
	else:
		print("=== %d TEST(S) FAILED ===" % _errors.size())
		quit(1)
