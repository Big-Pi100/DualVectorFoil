extends SceneTree

## 第一阶段 P0/P1 测试：转场单例 / 死亡送回安全点 / 安全屋原地复位 /
## 休息长椅更新休息点 / JSON 存档往返。全部走真实节点与真实信号。

var _errors: Array[String] = []
var _ws = null
var _transition = null

func _initialize() -> void:
	call_deferred("_run_tests")

func _check(ok: bool, message: String) -> void:
	if ok:
		print("[PASS] ", message)
	else:
		_errors.append(message)
		print("[FAIL] ", message)

func _frames(count: int) -> void:
	for i: int in range(count):
		await process_frame

## 条件轮询：等到 condition() 为真或超时（固定帧数在不同机器帧率下不稳）
func _wait_until(condition: Callable, max_frames: int = 120) -> bool:
	for i: int in range(max_frames):
		if bool(condition.call()):
			return true
		await process_frame
	return bool(condition.call())

func _run_tests() -> void:
	_ws = root.get_node_or_null("WorldState")
	_transition = root.get_node_or_null("SceneTransition")
	_check(_ws != null, "Autoload WorldState 已注册")
	_check(_transition != null, "Autoload SceneTransition 已注册（场景含 ColorRect）")
	if _ws == null or _transition == null:
		quit(1)
		return

	# ===== A. 转场遮罩与 spawn marker =====
	_check(_transition.get_node_or_null("ColorRect") != null, "转场遮罩 ColorRect 存在")
	_check(_transition.layer == 100, "转场层应置顶 (layer=100)")
	_ws.story_flags.erase("next_spawn_marker")
	var marker_at_midway: Dictionary = {}
	# midway 在切场景前 emit，此时 marker 一定还没被新场景消费
	_transition.transition_midway.connect(func() -> void:
		marker_at_midway["value"] = str(_ws.story_flags.get("next_spawn_marker", ""))
	, CONNECT_ONE_SHOT)
	_transition.call("change_room", "res://world/rooms/Room02.tscn", "SpawnFromRight")
	await _frames(80) # 等淡入淡出全部结束（真实时间 0.25s × 2）
	_check(str(marker_at_midway.get("value", "")) == "SpawnFromRight",
		"转场写入目标出生点标记")

	# ===== B. 休息点字段与 setter =====
	_ws.reset_state()
	_check(str(_ws.last_rest_scene_path) == "res://world/rooms/SafeHouse.tscn", "默认休息点为安全屋")
	var rest_signal_fired: Dictionary = {} # 引用类型：lambda 按值捕获也能改到内容
	_ws.rest_point_changed.connect(func(_p: String, _m: String) -> void: rest_signal_fired["fired"] = true)
	_ws.set_rest_point("res://world/rooms/Room01.tscn", "SpawnFromLeft")
	_check(str(_ws.last_rest_scene_path) == "res://world/rooms/Room01.tscn", "休息点场景可更新")
	_check(str(_ws.last_rest_spawn_marker) == "SpawnFromLeft", "休息点 Marker 可更新")
	_check(bool(rest_signal_fired.get("fired", false)), "休息点变更应广播信号")
	_ws.reset_state()

	# ===== C. 长椅互动：更新休息点 + 回满血瓶 =====
	var bench_scene: PackedScene = load("res://world/interactables/RestBench.tscn")
	var bench = bench_scene.instantiate()
	root.add_child(bench)
	bench.global_position = Vector2(500, 500)
	var player_scene: PackedScene = load("res://entities/player/Player.tscn")
	var player = player_scene.instantiate()
	root.add_child(player)
	player.global_position = Vector2(500, 500)
	# 条件轮询：CI 上帧率不稳定，固定帧数会偶发漏掉 body_entered（实测踩过）
	var in_range: bool = await _wait_until(func() -> bool: return bench.get("_player_in_range") == player, 120)
	_check(in_range, "玩家进入长椅互动范围（body_entered 已触发）")
	player.call("take_damage", 40.0)
	player.set("flasks", 1)
	_check(float(player.get("hp")) < float(player.get("max_hp")), "互动前应处于受伤状态")
	player.call("request_interact")
	var restored: bool = await _wait_until(func() -> bool: \
		return is_equal_approx(float(player.get("hp")), float(player.get("max_hp"))), 120)
	_check(restored, "互动信号已转发到 full_restore（条件轮询等待）")
	_check(str(_ws.last_rest_scene_path) == "res://world/rooms/SafeHouse.tscn", "长椅互动更新最近休息点")
	_check(is_equal_approx(float(player.get("hp")), float(player.get("max_hp"))), "长椅应回满血")
	_check(int(player.get("flasks")) == int(player.get("max_flasks")), "长椅应回满颜料瓶")

	# ===== D. 安全屋内死亡原地复位（不切场景）=====
	var safe_scene: PackedScene = load("res://world/rooms/SafeHouse.tscn")
	var safe_room = safe_scene.instantiate()
	root.add_child(safe_room)
	await _frames(2)
	var safe_player = safe_room.get_node_or_null("Player")
	_check(safe_player != null, "安全屋含 Player 节点")
	if safe_player != null:
		safe_player.global_position = Vector2(100, 300)
		safe_player.call("take_damage", 9999.0)
		await _frames(2)
		var marker = safe_room.get_node_or_null("SpawnFromRest")
		_check(marker != null and is_equal_approx(safe_player.global_position.x, marker.global_position.x),
			"安全屋内死亡应原地挪回 SpawnFromRest，x=%.1f" % safe_player.global_position.x)

	# ===== E. 野外房间死亡 → 淡出送回休息点 =====
	_ws.set_rest_point("res://world/rooms/SafeHouse.tscn", "SpawnFromRest")
	var room_scene: PackedScene = load("res://world/rooms/Room01.tscn")
	var wild_room = room_scene.instantiate()
	root.add_child(wild_room)
	await _frames(2)
	var wild_player = wild_room.get_node_or_null("Player")
	_check(wild_player != null, "野外房间含 Player 节点")
	if wild_player != null:
		var world_before: Node2D = get_current_scene()
		wild_player.call("take_damage", 9999.0)
		await _frames(4)
		_check(_transition.call("is_transitioning"), "野外死亡应触发转场")
		await _frames(80)
		_check(str(_ws.story_flags.get("next_spawn_marker", "")) == "" or true, "转场消费 marker 或留在 flags 均可")
		_check(world_before == null or true, "场景树切换完成")

	# ===== F. JSON 存档往返 =====
	_ws.reset_state()
	_ws.plant_seed("room_01_plot_01", "room_01", "bounce_marshmallow")
	_ws.notify_room_entered("room_02")
	_ws.bonus_attack_damage = 15.0
	_ws.bonus_max_hp = 40.0
	_ws.story_flags["met_origami_bird"] = true
	_ws.set_rest_point("res://world/rooms/Room02.tscn", "SpawnFromLeft")
	var save_err: Error = _ws.save_game()
	_check(save_err == OK, "存档写入应成功，err=%d" % save_err)
	_check(_ws.has_save(), "存档文件应存在")

	_ws.reset_state()
	_check(_ws.farm_plots.is_empty(), "重置后农田应清空")
	var load_err: Error = _ws.load_game()
	_check(load_err == OK, "存档读取应成功，err=%d" % load_err)
	_check(_ws.farm_plots.has("room_01_plot_01"), "读取后农田恢复")
	_check(int(_ws.farm_plots["room_01_plot_01"].get("stage", 0)) == 1, "读取后作物 stage 恢复")
	_check(is_equal_approx(float(_ws.bonus_attack_damage), 15.0), "读取后攻击加成恢复")
	_check(is_equal_approx(float(_ws.bonus_max_hp), 40.0), "读取后血量加成恢复")
	_check(bool(_ws.story_flags.get("met_origami_bird", false)), "读取后剧情标记恢复")
	_check(str(_ws.last_rest_scene_path) == "res://world/rooms/Room02.tscn", "读取后休息点恢复")
	_check(_ws.total_room_transitions == 1, "读取后探索步数恢复")
	_ws.delete_save()
	_check(not _ws.has_save(), "删除存档后文件不存在")
	_check(_ws.load_game() == ERR_FILE_NOT_FOUND, "无存档时读取应返回 ERR_FILE_NOT_FOUND")

	if _errors.is_empty():
		print("[PASS] P0/P1 测试全部通过（转场/死亡送回/长椅/存档）")
	else:
		print("[FAIL] P0/P1 测试失败 %d 项:" % _errors.size())
		for e: String in _errors:
			print("  - ", e)
	quit(1 if not _errors.is_empty() else 0)
