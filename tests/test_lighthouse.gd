extends SceneTree

##
## Phase 3 生态区三（糖果星光灯塔）专项测试。
## 覆盖：房间实例化/双花坛/门闭环/星光石碑剧本编译与一次性 flag/
##       双花坛独立收获 +40 HP（攻击不变）/ 入侵零损失与净化 / 手账印章。
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
	paused = false

	# ===== A. Room05 实例化 + 关键节点 =====
	var r5_scene: PackedScene = load("res://world/rooms/Room05.tscn") as PackedScene
	_check(r5_scene != null, "Room05 糖果星光灯塔场景可加载")
	if r5_scene == null:
		quit(1)
		return
	var r5: Node2D = r5_scene.instantiate() as Node2D
	root.add_child(r5)
	await _wait(0.3)
	_check(str(r5.get("room_id")) == "room_05", "Room05 room_id=room_05")
	_check(int(r5.get("invader_count")) == 4, "Room05 终区入侵数=4")
	_check(r5.get_node_or_null("Lighthouse") != null, "Room05 含灯塔地标")
	_check(r5.get_node_or_null("VistaPoint") != null, "Room05 含眺望点")
	var beacon: Node = r5.get_node_or_null("StarBeacon")
	_check(beacon != null, "Room05 含星光石碑触发点")

	# ===== B. 双花坛差异化（终区 2 座，均棉花糖）=====
	var plot_a: Node = r5.get_node_or_null("SoilPlot")
	var plot_b: Node = r5.get_node_or_null("SoilPlot2")
	_check(plot_a != null and plot_b != null, "Room05 含两座花坛")
	if plot_a != null and plot_b != null:
		_check(str(plot_a.get("plot_id")) == "room_05_plot_01" and str(plot_b.get("plot_id")) == "room_05_plot_02",
			"两花坛 plot_id 独立不同")
		_check(str(plot_a.get("room_id")) == "room_05" and str(plot_b.get("room_id")) == "room_05",
			"两花坛 room_id 均为 room_05")
		_check(str(plot_a.get("default_seed_id")) == "bounce_marshmallow" and str(plot_b.get("default_seed_id")) == "bounce_marshmallow",
			"两花坛都种弹弹棉花糖（不发明新战力属性）")

	# ===== C. 门连接闭环（Room04 → Room05 → Room04）=====
	_check_door(r5, "DoorToRoom04", "res://world/rooms/Room04.tscn", "SpawnFromRight")
	var r4_scene: PackedScene = load("res://world/rooms/Room04.tscn") as PackedScene
	var r4: Node2D = r4_scene.instantiate() as Node2D
	root.add_child(r4)
	await _wait(0.3)
	_check_door(r4, "DoorToRoom05", "res://world/rooms/Room05.tscn", "SpawnFromLeft")

	# ===== D. 星光石碑剧本可编译 + 三分支选项 =====
	var dm: Node = root.get_node_or_null("DialogueManager")
	_check(dm != null, "DialogueManager Autoload 已注册")
	var script_file: FileAccess = FileAccess.open("res://dialogue/lighthouse.dialogue", FileAccess.READ)
	_check(script_file != null, "星光石碑剧本文本存在")
	if dm != null and script_file != null:
		var script_text: String = script_file.get_as_text()
		script_file.close()
		var resource = dm.call("create_resource_from_text", script_text)
		_check(resource != null, "星光石碑剧本运行时编译成功")
		if resource != null:
			var line = await dm.call("get_next_dialogue_line", resource, "start")
			_check(line != null, "剧本 start 标题可遍历")
			# Dialogue Manager 把选项挂在「最后一句对话」上：石碑有两行铺垫，
			# 需要沿 next_id 推进到带选项的那行（运行时玩家也是看完两行才见选项）。
			var responses: Array = []
			for i: int in range(4):
				if line == null:
					break
				responses = line.get("responses")
				if not responses.is_empty():
					break
				var next_id: String = str(line.get("next_id"))
				if next_id.is_empty():
					break
				line = await dm.call("get_next_dialogue_line", resource, next_id)
			_check(responses.size() == 3, "石碑两行铺垫后有 3 个选项（实测 %d）" % responses.size())
			var meaning_line = await dm.call("get_next_dialogue_line", resource, "meaning")
			_check(meaning_line != null and str(meaning_line.get("text")) != "", "meaning 分支标题可达")

	# ===== E. 石碑一次性 flag：靠近 + 互动后写入 lighthouse_seen =====
	_ws.reset_state()
	paused = false
	var director: Node = root.get_node_or_null("StoryDirector")
	_check(director != null, "StoryDirector Autoload 已注册")
	if director != null and beacon != null:
		var player: Node = r5.get_node_or_null("Player")
		_check(player != null and player.has_signal("interact_requested"), "Room05 内 Player 具备互动契约")
		beacon.call("_on_body_entered", player)
		player.call("request_interact")
		await _wait(0.15)
		_check(bool(director.call("is_active")), "石碑互动后对话已启动")
		_check(bool(_ws.story_flags.get("lighthouse_seen", false)), "石碑写入一次性 flag lighthouse_seen")
		_check(not bool(beacon.visible), "石碑播过后隐藏（一次性）")
		director.call("skip")
		await _wait(0.1)
		paused = false

	# ===== F. 双花坛独立成熟 + 分别转化 +40 HP / 攻击不变 =====
	_ws.reset_state()
	_ws.plant_seed("room_05_plot_01", "room_05", "bounce_marshmallow")
	_ws.plant_seed("room_05_plot_02", "room_05", "bounce_marshmallow")
	# 离开 room_05（进 room_04）推进；第 5/10 步可能入侵，净化守零损失契约
	for i: int in range(12):
		_ws.notify_room_entered("room_04")
		if bool(_ws.invaded_rooms.has("room_05")):
			_ws.call("purify_room", "room_05")
		var s1: int = int(_ws.farm_plots["room_05_plot_01"].get("stage", 0))
		var s2: int = int(_ws.farm_plots["room_05_plot_02"].get("stage", 0))
		if s1 >= 3 and s2 >= 3:
			break
		_ws.notify_room_entered("room_05")
	var stage_a: int = int(_ws.farm_plots["room_05_plot_01"].get("stage", 0))
	var stage_b: int = int(_ws.farm_plots["room_05_plot_02"].get("stage", 0))
	_check(stage_a == 3 and stage_b == 3, "双花坛同时成熟 (%d/%d)" % [stage_a, stage_b])

	var hp_before: float = float(_ws.bonus_max_hp)
	var atk_before: float = float(_ws.bonus_attack_damage)
	var crop_a: String = str(_ws.call("harvest_and_convert", "room_05_plot_01"))
	var crop_b: String = str(_ws.call("harvest_and_convert", "room_05_plot_02"))
	_check(crop_a == "bounce_marshmallow" and crop_b == "bounce_marshmallow", "两座花坛均可独立收割")
	_check(float(_ws.bonus_max_hp) == hp_before + 40.0, "双棉花糖累计 +40 最大生命")
	_check(float(_ws.bonus_attack_damage) == atk_before, "棉花糖不加攻击（属性不错加）")
	_check(int(_ws.farm_plots["room_05_plot_01"].get("stage", 0)) == 0 and int(_ws.farm_plots["room_05_plot_02"].get("stage", 0)) == 0,
		"收割后两花坛都重置为空地（花坛本身不销毁）")

	# ===== G. 入侵零损失 + 净化催熟 + 手账印章 =====
	_ws.reset_state()
	_ws.plant_seed("room_05_plot_01", "room_05", "bounce_marshmallow")
	_ws.notify_room_entered("room_05") # 实际进过灯塔才会盖手账印章
	var before_stage: int = int(_ws.farm_plots["room_05_plot_01"].get("stage", 0))
	_ws.invaded_rooms.append("room_05")
	_ws.notify_room_entered("room_04")
	var invaded_stage: int = int(_ws.farm_plots["room_05_plot_01"].get("stage", 0))
	_check(invaded_stage == before_stage, "灯塔被入侵时作物暂停不销毁 (stage=%d)" % invaded_stage)
	_check(_ws.farm_plots.has("room_05_plot_01"), "入侵不删除灯塔花坛数据")
	_ws.call("purify_room", "room_05")
	var purified_stage: int = int(_ws.farm_plots["room_05_plot_01"].get("stage", 0))
	_check(purified_stage > invaded_stage, "净化催熟灯塔作物 (%d→%d)" % [invaded_stage, purified_stage])
	_check(not bool(_ws.invaded_rooms.has("room_05")), "净化后灯塔脱离入侵列表")
	_check(_ws.visited_rooms.has("room_05"), "手账已记录 room_05 印章")

	# ===== H. 存档含灯塔状态 =====
	_ws.story_flags["lighthouse_seen"] = true
	var save_err: int = int(_ws.call("save_game"))
	_check(save_err == OK, "含灯塔 flag 的存档写入成功")
	var load_err: int = int(_ws.call("load_game"))
	_check(load_err == OK, "灯塔存档回读成功")
	_check(bool(_ws.story_flags.get("lighthouse_seen", false)), "灯塔 flag 存档回读保留")

	_ws.call("reset_state")
	paused = false
	for node: Node in [r5, r4]:
		if is_instance_valid(node):
			node.queue_free()
	await _wait(0.1)

	if _errors.is_empty():
		print("=== ALL LIGHTHOUSE TESTS PASSED ===")
		quit(0)
	else:
		print("=== LIGHTHOUSE TESTS FAILED ===")
		for e: String in _errors:
			print("  - ", e)
		quit(1)
