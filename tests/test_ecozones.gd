extends SceneTree

##
## Phase 3 生态区扩展测试：Room03 风车蜡笔草地 / Room04 折纸图书馆
## 覆盖：新房间实例化、门连接双向闭环、棉花糖(bounce_marshmallow)转化加生命、
##       作物提示动态化、入侵/净化闭环、VistaZone、手账印章。
##

var _errors: Array[String] = []
var _ws: Node = null


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


func _load_room(path: String) -> PackedScene:
	return load(path) as PackedScene


## 校验一扇门的 target 指向
func _check_door(room: Node, door_name: String, expect_scene: String, expect_spawn: String) -> void:
	var door: Node = room.get_node_or_null(door_name)
	if door == null:
		_check(false, "%s 存在" % door_name)
		return
	var scene_path: String = str(door.get("target_scene_path"))
	var spawn_name: String = str(door.get("target_spawn_name"))
	_check(scene_path == expect_scene and spawn_name == expect_spawn,
		"%s → %s / %s" % [door_name, scene_path.get_file(), spawn_name])


func _run() -> void:
	_ws = root.get_node_or_null("WorldState")
	_check(_ws != null, "WorldState Autoload 已注册")
	if _ws == null:
		quit(1)
		return

	_ws.reset_state()

	# ===== A. 新房间可实例化 + 关键节点齐全 =====
	var r3_scene: PackedScene = _load_room("res://world/rooms/Room03.tscn")
	var r4_scene: PackedScene = _load_room("res://world/rooms/Room04.tscn")
	_check(r3_scene != null, "Room03 风车蜡笔草地场景可加载")
	_check(r4_scene != null, "Room04 折纸图书馆场景可加载")

	if r3_scene == null or r4_scene == null:
		quit(1)
		return

	var r3: Node2D = r3_scene.instantiate() as Node2D
	root.add_child(r3)
	await _wait(0.3)
	_check(str(r3.get("room_id")) == "room_03", "Room03 room_id=room_03")
	_check(r3.get_node_or_null("Windmill") != null, "Room03 含风车地标")
	_check(r3.get_node_or_null("VistaPoint") != null, "Room03 含眺望点")
	var r3_plot: Node = r3.get_node_or_null("SoilPlot")
	_check(r3_plot != null and str(r3_plot.get("default_seed_id")) == "bounce_marshmallow",
		"Room03 花坛播种弹弹棉花糖")

	var r4: Node2D = r4_scene.instantiate() as Node2D
	root.add_child(r4)
	await _wait(0.3)
	_check(str(r4.get("room_id")) == "room_04", "Room04 room_id=room_04")
	_check(r4.get_node_or_null("PaperBooks") != null, "Room04 含折纸书堆地标")
	_check(r4.get_node_or_null("VistaPoint") != null, "Room04 含眺望点")
	var r4_plot: Node = r4.get_node_or_null("SoilPlot")
	_check(r4_plot != null and str(r4_plot.get("default_seed_id")) == "bounce_marshmallow",
		"Room04 花坛播种弹弹棉花糖")

	# ===== B. 门连接双向闭环 =====
	_check_door(r3, "DoorToRoom02", "res://world/rooms/Room02.tscn", "SpawnFromRight")
	_check_door(r3, "DoorToRoom04", "res://world/rooms/Room04.tscn", "SpawnFromLeft")
	_check_door(r4, "DoorToRoom03", "res://world/rooms/Room03.tscn", "SpawnFromRight")

	var r2_scene: PackedScene = _load_room("res://world/rooms/Room02.tscn")
	var r2: Node2D = r2_scene.instantiate() as Node2D
	root.add_child(r2)
	await _wait(0.3)
	_check_door(r2, "DoorToRoom03", "res://world/rooms/Room03.tscn", "SpawnFromLeft")
	_check_door(r2, "DoorToRoom01", "res://world/rooms/Room01.tscn", "SpawnFromRight")

	# ===== C. 棉花糖转化加生命（非攻击）+ 手账印章 =====
	_ws.reset_state()
	_ws.plant_seed("room_03_plot_01", "room_03", "bounce_marshmallow")
	# 推进到成熟：离开 room_03 走 room_04（steps_per_growth_stage=2，需 4 次离开）。
	# 温和入侵可能在第 5/10 步触发并暂停生长——每次离开后检查，被入侵就净化（守零损失契约）。
	for i: int in range(8):
		_ws.notify_room_entered("room_04")
		if bool(_ws.invaded_rooms.has("room_03")):
			_ws.call("purify_room", "room_03")
		if int(_ws.farm_plots["room_03_plot_01"].get("stage", 0)) >= 3:
			break
		_ws.notify_room_entered("room_03")
	var stage: int = int(_ws.farm_plots["room_03_plot_01"].get("stage", 0))
	_check(stage == 3, "棉花糖经房间切换长到成熟 (stage=%d)" % stage)

	var hp_before: float = float(_ws.bonus_max_hp)
	var atk_before: float = float(_ws.bonus_attack_damage)
	var crop: String = str(_ws.call("harvest_and_convert", "room_03_plot_01"))
	_check(crop == "bounce_marshmallow", "收割作物是弹弹棉花糖")
	_check(float(_ws.bonus_max_hp) == hp_before + 20.0, "棉花糖 +20 最大生命")
	_check(float(_ws.bonus_attack_damage) == atk_before, "棉花糖不加攻击（作物属性不错加）")
	_check(_ws.visited_rooms.has("room_03") and _ws.visited_rooms.has("room_04"),
		"手账已记录 room_03/room_04 印章")

	# ===== D. 入侵只暂停不摧毁 + 净化催熟 =====
	_ws.reset_state()
	_ws.plant_seed("room_04_plot_01", "room_04", "bounce_marshmallow")
	var before_stage: int = int(_ws.farm_plots["room_04_plot_01"].get("stage", 0))
	_ws.invaded_rooms.append("room_04")
	_ws.call("notify_room_entered", "room_03")
	var invaded_stage: int = int(_ws.farm_plots["room_04_plot_01"].get("stage", 0))
	_check(invaded_stage == before_stage, "入侵期间作物不生长也不销毁 (stage=%d)" % invaded_stage)
	_check(_ws.farm_plots.has("room_04_plot_01"), "入侵不删除花坛数据")
	_ws.call("purify_room", "room_04")
	var purified_stage: int = int(_ws.farm_plots["room_04_plot_01"].get("stage", 0))
	_check(purified_stage > invaded_stage, "净化后作物催熟 (%d→%d)" % [invaded_stage, purified_stage])
	_check(not bool(_ws.invaded_rooms.has("room_04")), "净化后房间脱离入侵列表")

	# ===== E. 作物提示动态化（棉花糖不说火焰辣椒）=====
	var plot_script: Script = load("res://world/interactables/SoilPlot.gd") as Script
	_check(plot_script != null, "SoilPlot 脚本可加载")
	if plot_script != null:
		var crop_info: Dictionary = plot_script.get("CROP_LABELS")
		_check(str((crop_info.get("bounce_marshmallow", {}) as Dictionary).get("name", "")) == "弹弹棉花糖",
			"作物表含弹弹棉花糖显示名")
		_check(str((crop_info.get("bounce_marshmallow", {}) as Dictionary).get("stat", "")) == "生命",
			"作物表棉花糖加成标注生命")

	# ===== F. 存档包含新生态区状态 =====
	_ws.story_flags["eco_test"] = true
	var save_err: int = int(_ws.call("save_game"))
	_check(save_err == OK, "含新生态区状态的存档写入成功")
	var load_err: int = int(_ws.call("load_game"))
	_check(load_err == OK, "存档回读成功")

	_ws.call("reset_state")
	for node: Node in [r3, r4, r2]:
		if is_instance_valid(node):
			node.queue_free()
	await _wait(0.1)

	if _errors.is_empty():
		print("=== ALL ECOZONE TESTS PASSED ===")
		quit(0)
	else:
		print("=== ECOZONE TESTS FAILED ===")
		for e: String in _errors:
			print("  - ", e)
		quit(1)
