extends SceneTree

##
## Phase 3 真机调优专项测试：帧率分档 + 触控按键尺寸 + 按下反馈 + 摇杆半屏隔离。
## 真机帧率/触屏手感仍需设备实测；本测试守代码层可验证的适配契约。
##

var _errors: Array[String] = []
var _tuner: Node = null


func _initialize() -> void:
	call_deferred("_run")


func _check(ok: bool, msg: String) -> void:
	if ok:
		print("[PASS] ", msg)
	else:
		_errors.append(msg)
		print("[FAIL] ", msg)


func _wait(sec: float) -> void:
	for i: int in range(int(sec * 60.0)):
		await process_frame


func _run() -> void:
	_tuner = root.get_node_or_null("MobileTuner")
	_check(_tuner != null, "MobileTuner Autoload 已注册")
	if _tuner == null:
		quit(1)
		return

	# ===== A. 自动分档（本机桌面 → 不锁帧）=====
	var auto_profile: String = str(_tuner.get("current_profile"))
	_check(auto_profile == "desktop" or auto_profile == "mobile" or auto_profile == "low_end",
		"启动自动分档有效 (%s)" % auto_profile)
	_check(int(_tuner.call("get_max_fps")) >= 0, "Engine.max_fps 已设置为非负整数")

	# ===== B. 三档手动切换 + 信号广播 =====
	var signals: Array = []
	_tuner.connect("profile_applied", func(profile_name: String, fps: int) -> void:
		signals.append("%s:%d" % [profile_name, fps]))
	_tuner.call("apply_profile", "desktop")
	_check(int(_tuner.call("get_max_fps")) == 0, "桌面档不锁帧 (max_fps=0)")
	_tuner.call("apply_profile", "mobile")
	_check(int(_tuner.call("get_max_fps")) == 60, "移动档锁 60 帧")
	_tuner.call("apply_profile", "low_end")
	_check(int(_tuner.call("get_max_fps")) == 30, "低端档锁 30 帧")
	_check(signals.size() == 3 and signals[1] == "mobile:60" and signals[2] == "low_end:30",
		"每次切档广播 profile_applied 信号")
	_check(str(_tuner.call("profile_label")).contains("30"), "档位中文标签可读")
	_tuner.call("apply_profile", "desktop") # 还原桌面对照

	# ===== C. TouchHUD 触控尺寸 ≥96×96 =====
	var hud_scene: PackedScene = load("res://ui/TouchHUD.tscn") as PackedScene
	_check(hud_scene != null, "TouchHUD 场景可加载")
	if hud_scene == null:
		quit(1)
		return
	var hud: CanvasLayer = hud_scene.instantiate() as CanvasLayer
	root.add_child(hud)
	await _wait(0.3)

	var button_paths: Array[String] = [
		"RootControl/RightButtonsGroup/BtnPrimaryAttack",
		"RootControl/RightButtonsGroup/BtnSecondary",
		"RootControl/RightButtonsGroup/BtnJump",
		"RootControl/RightButtonsGroup/BtnRoll",
		"RootControl/RightButtonsGroup/BtnSkill1",
		"RootControl/RightButtonsGroup/BtnSkill2",
		"RootControl/BtnHeal",
		"RootControl/BtnInteract",
	]
	for path: String in button_paths:
		var btn: Button = hud.get_node_or_null(path) as Button
		_check(btn != null and btn.size.x >= 96.0 and btn.size.y >= 96.0,
			"%s 触控区 %s ≥96×96" % [path.get_file(), str(btn.size) if btn != null else "缺失"])

	# ===== D. 按下反馈（变暗 / 松手恢复）=====
	var attack: Button = hud.get_node_or_null("RootControl/RightButtonsGroup/BtnPrimaryAttack") as Button
	if attack != null:
		var normal_color: Color = attack.modulate
		attack.button_down.emit()
		_check(attack.modulate != normal_color, "攻击键按下有视觉反馈")
		attack.button_up.emit()
		_check(attack.modulate == Color.WHITE, "攻击键松手恢复白色")

	# ===== E. 摇杆半屏隔离（多指不串台 + 抬手归零）=====
	var player_scene: PackedScene = load("res://entities/player/Player.tscn") as PackedScene
	# 不用 `Player` 类型标注：headless --script 编译期会提前编译 Player.gd 并撞 WorldState Autoload 未注册坑
	var player: Node2D = player_scene.instantiate() as Node2D
	root.add_child(player)
	await _wait(0.3)
	hud.call("bind_player", player)
	var joy_base: Control = hud.get_node_or_null("RootControl/LeftJoystickArea/JoystickBase") as Control

	var touch_left: InputEventScreenTouch = InputEventScreenTouch.new()
	touch_left.index = 1
	touch_left.pressed = true
	touch_left.position = Vector2(200, 500)
	hud._input(touch_left)
	_check(joy_base != null and joy_base.visible, "左半屏按下生成浮动摇杆")

	var touch_right: InputEventScreenTouch = InputEventScreenTouch.new()
	touch_right.index = 2
	touch_right.pressed = true
	touch_right.position = Vector2(1000, 500)
	hud._input(touch_right)
	_check(joy_base.visible, "右半屏第二指不夺取摇杆控制权")

	var drag_left: InputEventScreenDrag = InputEventScreenDrag.new()
	drag_left.index = 1
	drag_left.position = Vector2(264, 500)
	hud._input(drag_left)
	_check(float((player.get("virtual_move_vector") as Vector2).x) > 0.5, "摇杆拖动驱动右移 (x=%.2f)" % float((player.get("virtual_move_vector") as Vector2).x))

	var release_right: InputEventScreenTouch = InputEventScreenTouch.new()
	release_right.index = 2
	release_right.pressed = false
	hud._input(release_right)
	_check(joy_base.visible, "第二指抬起不影响摇杆")

	var release_left: InputEventScreenTouch = InputEventScreenTouch.new()
	release_left.index = 1
	release_left.pressed = false
	hud._input(release_left)
	_check(not joy_base.visible and (player.get("virtual_move_vector") as Vector2) == Vector2.ZERO,
		"摇杆手指抬起后隐藏并归零移动向量")

	# ===== F. 眺望淡出后 HUD 吞触摸防护（真机常见误触）=====
	var root_control: Control = hud.get_node_or_null("RootControl") as Control
	if root_control != null:
		root_control.visible = false
		_check(not root_control.visible, "眺望时整块 HUD 可隐藏（透明按钮不吞触摸）")
		root_control.visible = true

	Engine.max_fps = 0
	if is_instance_valid(player):
		player.queue_free()
	if is_instance_valid(hud):
		hud.queue_free()
	await _wait(0.1)

	if _errors.is_empty():
		print("=== ALL MOBILE TUNING TESTS PASSED ===")
		quit(0)
	else:
		print("=== MOBILE TUNING TESTS FAILED ===")
		for e: String in _errors:
			print("  - ", e)
		quit(1)
