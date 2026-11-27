extends SceneTree

##  Phase 1 第 2 步闭环测试：WorldState / 播种生长 / 入侵非惩罚 / 净化催熟 /
##  战力单一数据源 / 房间场景反复入侵不崩。全部走真实节点与真实信号。

var _errors: Array[String] = []

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

func _run_tests() -> void:
	var ws = root.get_node_or_null("WorldState")
	_check(ws != null, "Autoload WorldState 已注册")
	if ws == null:
		quit(1)
		return

	# ===== A. 步数生长（拒绝现实时间挂机）=====
	ws.reset_state()
	ws.plant_seed("room_01_plot_01", "room_01", "flame_pepper")
	_check(int(ws.farm_plots["room_01_plot_01"].get("stage", 0)) == 1, "播种后 stage=1")

	ws.notify_room_entered("room_01") # total=1，同房间不推进
	_check(int(ws.farm_plots["room_01_plot_01"].get("stage", 0)) == 1, "同房间切换不推进生长")
	ws.notify_room_entered("room_02") # total=2，steps=1
	_check(int(ws.farm_plots["room_01_plot_01"].get("steps", 0)) == 1, "离开房间 1 次 → steps=1")
	ws.notify_room_entered("room_01") # total=3，同房间不推进
	ws.notify_room_entered("room_02") # total=4，steps=2 → stage=2
	_check(int(ws.farm_plots["room_01_plot_01"].get("stage", 0)) == 2, "离开房间 2 次 → stage=2")

	# 等 1 秒现实时间，stage 不应变化（证明不绑定时间）
	await _frames(60)
	_check(int(ws.farm_plots["room_01_plot_01"].get("stage", 0)) == 2, "现实时间流逝不推进生长")

	# ===== B. 温和入侵：只暂停，不销毁 =====
	ws.notify_room_entered("room_02") # total=5 → 触发入侵 room_01
	_check(ws.invaded_rooms.has("room_01"), "第 5 次切换触发 room_01 入侵")
	_check(ws.farm_plots.has("room_01_plot_01"), "入侵后作物仍在（零永久损失）")
	var stage_before_purify: int = int(ws.farm_plots["room_01_plot_01"].get("stage", 0))
	ws.notify_room_entered("room_01") # 被入侵房间不生长
	_check(int(ws.farm_plots["room_01_plot_01"].get("stage", 0)) == stage_before_purify, "入侵期间作物暂停生长")

	ws.purify_room("room_01")
	_check(not ws.invaded_rooms.has("room_01"), "净化后移除入侵标记")
	_check(int(ws.farm_plots["room_01_plot_01"].get("stage", 0)) == stage_before_purify + 1, "净化奖励：作物催熟 1 阶段")
	ws.purify_room("room_01") # 重复调用不应重复催熟
	_check(int(ws.farm_plots["room_01_plot_01"].get("stage", 0)) == stage_before_purify + 1, "重复净化不重复催熟")

	# ===== C. 收割 → 战力按作物类型转化 =====
	ws.farm_plots["room_01_plot_01"]["stage"] = 3
	var harvested: String = ws.harvest_and_convert("room_01_plot_01")
	_check(harvested == "flame_pepper", "成熟辣椒收割成功")
	_check(is_equal_approx(ws.bonus_attack_damage, 5.0), "辣椒 → 攻击 +5")
	_check(is_equal_approx(ws.bonus_max_hp, 0.0), "辣椒不应加血")

	ws.plant_seed("room_02_plot_01", "room_02", "bounce_marshmallow")
	ws.farm_plots["room_02_plot_01"]["stage"] = 3
	ws.harvest_and_convert("room_02_plot_01")
	_check(is_equal_approx(ws.bonus_max_hp, 20.0), "棉花糖 → 最大血 +20")
	_check(is_equal_approx(ws.bonus_attack_damage, 5.0), "棉花糖不应加攻击")

	# ===== D. 跨场景战力同步（修双重来源 bug）=====
	var player_scene: PackedScene = load("res://entities/player/Player.tscn")
	var new_player = player_scene.instantiate()
	root.add_child(new_player)
	await _frames(2)
	_check(is_equal_approx(new_player.hitbox.damage, 15.0), "新场景 Player 读到攻击加成 10+5=15，实际 %.1f" % new_player.hitbox.damage)
	_check(is_equal_approx(new_player.max_hp, 140.0), "新场景 Player 读到血量加成 120+20=140，实际 %.1f" % new_player.max_hp)

	# WorldState 后续加成变化时，已存在 Player 自动同步
	ws.plant_seed("room_01_plot_02", "room_01", "flame_pepper")
	ws.farm_plots["room_01_plot_02"]["stage"] = 3
	ws.harvest_and_convert("room_01_plot_02")
	_check(is_equal_approx(new_player.hitbox.damage, 20.0), "WorldState 后续加成自动同步到已有 Player，实际 %.1f" % new_player.hitbox.damage)
	new_player.queue_free()

	# ===== E. 房间场景：入侵状态反复切换不崩（修 queue_free 容器 bug）=====
	ws.reset_state()
	var room_scene: PackedScene = load("res://world/rooms/Room01.tscn")
	var room = room_scene.instantiate()
	root.add_child(room)
	await _frames(3)

	var invaders = room.get_node("InvadersContainer")
	var filter_rect: ColorRect = room.get_node("PostProcessLayer/DesaturateRect")
	_check(invaders != null and filter_rect != null, "Room01 节点树完整（容器 + 后处理层）")

	# Room01 自 2026-11-27 起是 `invade_on_enter = true`（一进门就被占，这是关卡设计，
	# 不是 bug）。本用例要的是「和平状态 → 手动 append → erase」的状态机，
	# 所以先把它按回未入侵 —— 否则 `invaded_rooms` 里会有两个 room_01，
	# `erase()` 只删一个，后面 4 条断言会连锁失败。
	ws.invaded_rooms.erase("room_01")
	room.call("_setup_invasion_state")
	await _frames(2)
	_check(not ws.invaded_rooms.has("room_01"), "初始未入侵")

	ws.invaded_rooms.append("room_01")
	room._setup_invasion_state()
	# 数量来自蓝图（`E`/`F` 的个数 → invader_count），不写死。
	var want: int = int(room.get("invader_count"))
	_check(want > 0, "Room01 的 invader_count 合法（%d）" % want)
	_check(invaders.get_child_count() == want, "入侵状态生成 %d 只橡皮擦怪，实际 %d" % [want, invaders.get_child_count()])
	var mat: ShaderMaterial = filter_rect.material as ShaderMaterial
	_check(is_equal_approx(float(mat.get_shader_parameter("desaturate_amount")), 1.0), "入侵时灰度去色开启")

	ws.invaded_rooms.erase("room_01")
	room._setup_invasion_state()
	_check(invaders.get_child_count() == 0, "退出入侵状态清空敌人")
	_check(is_instance_valid(invaders), "容器本身未被 queue_free（二次入侵不会崩）")
	_check(is_equal_approx(float(mat.get_shader_parameter("desaturate_amount")), 0.0), "退出入侵恢复彩色")

	# 二次入侵：验证容器仍可用
	ws.invaded_rooms.append("room_01")
	room._setup_invasion_state()
	_check(invaders.get_child_count() == want, "二次入侵仍能生成 %d 只（实际 %d）" % [want, invaders.get_child_count()])

	# ===== F. 清怪触发净化（真实 health_depleted 信号）=====
	var invader = invaders.get_child(0)
	invader.take_damage(999.0, Vector2.ZERO)
	await _frames(2)
	_check(invaders.get_child_count() == want - 1, "击杀一只怪后剩 %d 只（实际 %d）" % [want - 1, invaders.get_child_count()])
	for child in invaders.get_children():
		child.take_damage(999.0, Vector2.ZERO)
	await _frames(3)
	_check(not ws.invaded_rooms.has("room_01"), "清空所有怪后自动净化房间")

	room.queue_free()
	await _frames(2)

	# ===== G. 互动播种走真实信号 =====
	ws.reset_state()
	var room2 = room_scene.instantiate()
	root.add_child(room2)
	await _frames(2)
	# 同上：Room01 一进门就被占，而「被占的房间不许播种」是设计规则。
	# 这个用例测的是播种信号链，不是入侵，所以先按回和平状态。
	ws.invaded_rooms.erase("room_01")
	room2.call("_setup_invasion_state")
	await _frames(2)
	var plot = room2.get_node("SoilPlot")
	var p2 = room2.get_node("Player")
	plot._on_body_entered(p2)
	p2.interact_requested.emit()
	await _frames(2)
	_check(ws.farm_plots.has("room_01_plot_01"), "互动信号触发生效播种")

	room2.queue_free()
	await _frames(2)

	if _errors.is_empty():
		print("=== ALL GAMEPLAY LOOP TESTS PASSED ===")
		quit(0)
	else:
		print("=== %d TEST(S) FAILED ===" % _errors.size())
		quit(1)
