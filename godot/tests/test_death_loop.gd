extends SceneTree

## S1 闸门：玩家会死，而且「死」这件事在屏幕上发生过。
##
## 判据全部来自 docs/gdd/10_垂直切片.md 的 V2 / S1 出口：
##   1. 血条真的能见底（不是归零瞬间就被回满 → 玩家读不出自己死了）
##   2. 死后回到暗房、血满、敌人已清的不复活
##   3. 安全屋不会变成死亡循环（原地复活 → 继续挨打 → 再死）
##
## 用真实 Player.tscn / 真实房间场景，不 mock：
## 「死亡」横跨 Player、BaseRoom、WorldState 三层，桩掉任何一层测的就是另一套代码。

const SAFE_HOUSE: String = "res://world/rooms/SafeHouse.tscn"
const PLAYER_SCENE: String = "res://entities/player/Player.tscn"
const DEATH_WAIT_FRAMES: int = 180  # 0.7s 演出 + 富余；headless 逻辑帧 60Hz

var _fail: int = 0
var _root: Node = null

var _died: int = 0
var _respawns: int = 0

func _initialize() -> void:
	# Autoload 全局标识符晚于 _initialize 注册，推迟一帧再建含 WorldState 引用的节点
	call_deferred("_run")

func _run() -> void:
	_root = Node.new()
	root.add_child(_root)
	await _test_death_is_visible()
	await _test_revive_restores()
	await _test_purified_room_never_reinvaded()
	await _test_safe_room_excluded_from_invasion()
	await _test_safe_house_death_breaks_loop()
	await _test_hud_wired()
	await _test_real_room_kills_player()
	_root.queue_free()
	print("DEATH LOOP GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _check(ok: bool, msg: String) -> void:
	if ok:
		print("  ok   %s" % msg)
	else:
		_fail += 1
		print("  FAIL %s" % msg)

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

func _wait_until(cond: Callable, max_frames: int = DEATH_WAIT_FRAMES) -> bool:
	for i: int in range(max_frames):
		if bool(cond.call()):
			return true
		await physics_frame
	return bool(cond.call())

## 一块地板 + 一个真玩家。玩家不读输入（virtual 输入一直是零），
## 所以位置变化只可能来自「死亡后还在跑物理」——这正是要拦的东西。
func _make_floor(y: float = 620.0) -> void:
	var floor_body := StaticBody2D.new()
	floor_body.collision_layer = 1
	floor_body.collision_mask = 0
	var cs := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(2000, 40)
	cs.shape = rect
	cs.position = Vector2(0, 20)
	floor_body.add_child(cs)
	floor_body.position = Vector2(0, y)
	_root.add_child(floor_body)

func _spawn_player(pos: Vector2 = Vector2(0, 570)) -> Node:
	var p: Node = (load(PLAYER_SCENE) as PackedScene).instantiate()
	_root.add_child(p)
	p.global_position = pos
	_died = 0
	_respawns = 0
	p.connect("died", func() -> void: _died += 1)
	p.connect("respawn_requested", func() -> void: _respawns += 1)
	return p


func _test_death_is_visible() -> void:
	print("--- 死亡可见性：血条见底 → 停止响应 → 延时复活 ---")
	_make_floor()
	var p: Node = _spawn_player()
	await _frames(4)
	var max_hp: float = float(p.get("max_hp"))

	var hp_samples: Array[float] = []
	p.connect("health_changed", func(cur: float, _m: float) -> void: hp_samples.append(cur))

	p.call("take_damage", 9999.0)
	await _frames(1)

	_check(float(p.get("hp")) == 0.0,
		"死亡瞬间 hp 停在 0（不是被同一帧回满），实际 %.0f" % float(p.get("hp")))
	_check(bool(p.get("is_dead")), "is_dead 置位")
	_check(_died == 1, "died 广播一次，实际 %d" % _died)
	_check(_respawns == 0, "死亡瞬间不立刻 respawn（给倒地演出留时间），实际 %d" % _respawns)
	_check(hp_samples.size() >= 1 and is_equal_approx(hp_samples[hp_samples.size() - 1], 0.0),
		"HUD 收到的最后一个血量值是 0（样本 %s）" % str(hp_samples))

	# 死亡期间输入必须失效：喂一个持续向右的虚拟摇杆
	var x0: float = (p as Node2D).global_position.x
	p.set("virtual_move_vector", Vector2(1, 0))
	await _frames(20)
	var dx: float = absf((p as Node2D).global_position.x - x0)
	_check(dx < 1.0, "死亡演出期间不吃输入，位移 %.2fpx" % dx)
	_check(absf((p.get("velocity") as Vector2).x) < 0.01, "死亡演出期间速度为 0")

	# 死亡期间继续挨打不能重复触发死亡流程
	p.call("take_damage", 9999.0)
	await _frames(2)
	_check(float(p.get("hp")) == 0.0, "倒地后不再扣血（不会变成负数）")
	_check(_died == 1, "倒地后不重复广播 died，实际 %d" % _died)
	_check(_respawns == 0, "倒地后不重复请求复活，实际 %d" % _respawns)

	var waited: bool = await _wait_until(func() -> bool: return _respawns > 0)
	_check(waited, "演出结束后发出 respawn_requested（实际 %d 次）" % _respawns)
	_check(float(p.get("hp")) == 0.0,
		"respawn 时血量仍是 0 —— 回满是「复活」的事，不是「死亡」的事")
	_check(float(p.get("max_hp")) == max_hp, "max_hp 未被打乱")
	_check(is_instance_valid(p) and bool(p.get("is_dead")), "respawn 之后仍是死亡态，等宿主 revive")

	p.free()


func _test_revive_restores() -> void:
	print("--- 复活：满血满瓶、视觉复位、能再受伤 ---")
	var p: Node = _spawn_player()
	await _frames(4)
	p.set("flasks", 1)
	p.call("take_damage", 9999.0)
	await _frames(2)
	_check(bool(p.get("is_dead")), "前置：进入死亡态")

	p.call("revive")
	await _frames(1)
	_check(not bool(p.get("is_dead")), "revive 清除死亡态")
	_check(is_equal_approx(float(p.get("hp")), float(p.get("max_hp"))), "revive 回满血")
	_check(int(p.get("flasks")) == int(p.get("max_flasks")), "revive 回满颜料瓶")
	var vis: Node2D = p.get_node("Visuals") as Node2D
	_check(is_equal_approx(absf(vis.scale.x), 1.0) and is_equal_approx(vis.scale.y, 1.0),
		"倒地压扁已复位（scale=%s）" % str(vis.scale))
	_check(is_equal_approx(vis.modulate.r, 1.0), "褪色已复原（modulate=%s）" % str(vis.modulate))

	var hp_before: float = float(p.get("hp"))
	p.call("take_damage", 10.0)
	_check(float(p.get("hp")) < hp_before, "复活后能正常受伤（没被锁死）")
	p.free()


## 「已清房不复活」的真正缺口：purify_room 只是从 invaded_rooms 里删掉，
## 没有留下「这间房已经归我」的记录。之后该房一有作物，
## _try_trigger_gentle_invasion 会把整局打过的房重新占掉。
func _test_purified_room_never_reinvaded() -> void:
	print("--- 已清房不再被入侵 ---")
	var ws: Node = root.get_node("WorldState")
	ws.call("reset_state")

	# 对照组：没清过的房，步数到点会被占 —— 证明入侵系统本身在工作
	ws.call("plant_seed", "plot_ctrl", "room_07", "flame_pepper")
	var invaded_ctrl: bool = false
	for i: int in range(6):
		ws.call("notify_room_entered", "room_01")
		if (ws.get("invaded_rooms") as Array).has("room_07"):
			invaded_ctrl = true
			break
	_check(invaded_ctrl, "对照组：未清过的房会被温和入侵选中（入侵系统在跑）")

	# 实验组：同一间房先被清掉，再走到入侵判定点
	ws.call("reset_state")
	ws.call("plant_seed", "plot_ctrl", "room_07", "flame_pepper")
	(ws.get("invaded_rooms") as Array).append("room_07")
	ws.call("purify_room", "room_07")
	_check((ws.get("purified_rooms") as Array).has("room_07"), "purify 后留下「已清」记录")
	_check(not (ws.get("invaded_rooms") as Array).has("room_07"), "purify 后不再是入侵状态")

	var reinvaded: bool = false
	var steps: int = 0
	for i: int in range(12):
		ws.call("notify_room_entered", "room_01")
		steps = int(ws.get("total_room_transitions"))
		if steps % 5 == 0 and (ws.get("invaded_rooms") as Array).has("room_07"):
			reinvaded = true
			break
	_check(not reinvaded, "已清房在 12 次换房（含 2 个判定点）后仍未被重新入侵")

	# 存档往返：已清记录必须跟着存档走，否则读档就复活
	ws.call("save_game")
	ws.call("reset_state")
	_check(not (ws.get("purified_rooms") as Array).has("room_07"), "reset 后已清记录清空")
	ws.call("load_game")
	_check((ws.get("purified_rooms") as Array).has("room_07"), "读档后已清记录恢复")
	ws.call("delete_save")
	ws.call("reset_state")


func _test_safe_room_excluded_from_invasion() -> void:
	print("--- 安全屋不参与入侵 ---")
	var ws: Node = root.get_node("WorldState")
	ws.call("reset_state")
	_check((ws.get("safe_room_ids") as Array).has("safe_house"), "默认安全屋登记为 safe_house")

	# 就算历史农田里有一块 safe_house 的地，也不能被选中
	ws.call("plant_seed", "plot_safe", "safe_house", "bounce_marshmallow")
	var hit: bool = false
	for i: int in range(12):
		ws.call("notify_room_entered", "room_01")
		if (ws.get("invaded_rooms") as Array).has("safe_house"):
			hit = true
			break
	_check(not hit, "安全屋有作物也不会被入侵（12 次换房）")

	ws.call("register_safe_room", "safe_house")
	_check((ws.get("safe_room_ids") as Array).count("safe_house") == 1, "登记安全屋是幂等的")
	ws.call("reset_state")


## 真 bug 回归：安全屋若被占（旧存档 / 规则生效前），死亡会变成
## 「原地复活 → 敌人还在 → 继续挨打 → 再死」的循环，退出条件是放弃游戏。
func _test_safe_house_death_breaks_loop() -> void:
	print("--- 安全屋死亡不会变成死循环 ---")
	var ws: Node = root.get_node("WorldState")
	ws.call("reset_state")

	var room: Node = (load(SAFE_HOUSE) as PackedScene).instantiate()
	_root.add_child(room)
	await _frames(3)

	# 人为造出"暗房被占"的状态（模拟旧存档）
	(ws.get("invaded_rooms") as Array).append("safe_house")
	room.call("_setup_invasion_state")
	await _frames(3)
	var container: Node = room.get_node_or_null("InvadersContainer")
	_check(container != null and container.get_child_count() > 0,
		"前置：安全屋里确实刷出了敌人（%d 只）" % (container.get_child_count() if container else -1))

	var p: Node = room.get_node_or_null("Player")
	_check(p != null, "安全屋含 Player")
	if p != null:
		p.call("take_damage", 9999.0)
		var revived: bool = await _wait_until(func() -> bool: return not bool(p.get("is_dead")), DEATH_WAIT_FRAMES)
		await _frames(2)
		_check(revived, "安全屋死亡后完成原地复活（不需要切场景）")
		_check(is_equal_approx(float(p.get("hp")), float(p.get("max_hp"))), "原地复活回满血")
		_check(container.get_child_count() == 0,
			"复活时清掉残留敌人，实际剩 %d 只（否则是死亡循环）" % container.get_child_count())
		_check(not (ws.get("invaded_rooms") as Array).has("safe_house"),
			"安全屋被标记为已净化，重进不再刷怪")
		var marker: Node = room.get_node_or_null("SpawnFromRest")
		if marker is Marker2D:
			_check(absf((p as Node2D).global_position.x - (marker as Marker2D).global_position.x) < 2.0,
				"复活点落在 SpawnFromRest")

	room.free()
	ws.call("reset_state")


## 死亡必须「看得见」，所以得先有得看。
## 实测（11-27，改之前）：Room01 的 `TouchHUD.player` 是 `null` —— 正式 6 间房从没调用过
## `bind_player`。`_input` 里第一行就是 `if not player: return`，等于**手机上所有触屏操作都不响应**。
## 键盘走 Input 单例、照样能玩，所以这个洞一直没被任何测试或试玩暴露。
## 同时全项目没有血条：`health_changed` 只被测试里的 TestCombat 打印，玩家看不到自己剩多少血。
func _test_hud_wired() -> void:
	print("--- HUD 绑定与血条 ---")
	var ws: Node = root.get_node("WorldState")
	ws.call("reset_state")

	var room: Node = (load("res://world/rooms/Room01.tscn") as PackedScene).instantiate()
	_root.add_child(room)
	await _frames(4)
	var p: Node = room.get_node_or_null("Player")
	var hud: Node = room.get_node_or_null("TouchHUD")
	_check(p != null and hud != null, "房间含 Player 与 TouchHUD")
	_check(hud != null and hud.get("player") == p, "房间里的 HUD 已绑定玩家（否则触屏全部无响应）")

	var bar: Node = hud.get_node_or_null("RootControl/HealthBar") if hud != null else null
	_check(bar != null, "HUD 含血条")
	if bar != null and p != null:
		var track: Node = bar.get_node_or_null("Track")
		var fill: ColorRect = bar.get_node_or_null("Track/Fill") as ColorRect
		_check(track != null and fill != null, "血条含底板与填充")
		if track != null and fill != null:
			await _frames(2)
			var full_w: float = (track as Control).size.x
			_check(full_w > 100.0, "血条底板有宽度（%.0f px）" % full_w)
			_check(absf(fill.size.x - full_w) < 1.0, "满血时填充等于底板（%.0f）" % fill.size.x)

			p.call("take_damage", float(p.get("max_hp")) * 0.5)
			await _frames(3)
			_check(absf(fill.size.x - full_w * 0.5) < 2.0,
				"掉一半血后填充约一半（%.0f / %.0f）" % [fill.size.x, full_w])

			p.call("take_damage", 9999.0)
			await _frames(3)
			_check(fill.size.x <= 0.5, "血空时填充归零（实际 %.1f），玩家看得见自己空了" % fill.size.x)

	room.free()
	ws.call("reset_state")



## 端到端：不是「take_damage 能把人打死」，是「敌人真的能把人打死」。
## 前面所有段都是直接扣血；那只能证明结算分支会走，不能证明玩家在真实一局里有死的可能。
## 站门口不按键，等敌人自己把人咬死 —— 这一条过了，V2 的前半句才成立。
func _test_real_room_kills_player() -> void:
	print("--- 端到端：Room01 站桩不还手，被敌人打死 ---")
	var ws: Node = root.get_node("WorldState")
	ws.call("reset_state")

	var room: Node = (load("res://world/rooms/Room01.tscn") as PackedScene).instantiate()
	_root.add_child(room)
	await _frames(4)
	var p: Node = room.get_node_or_null("Player")
	var marker: Node2D = room.get_node_or_null("SpawnFromLeft") as Node2D
	if p == null or marker == null:
		_check(false, "Room01 有 Player 和 SpawnFromLeft")
		room.free()
		return
	(p as Node2D).global_position = marker.global_position
	var invaded: Array = ws.get("invaded_rooms")
	if not invaded.has("room_01"):
		invaded.append("room_01")
	room.call("_setup_invasion_state")
	await _frames(2)

	# 闭包按值捕获局部变量：直接 `deaths += 1` 改的是副本，外面永远读到 0
	# （踩过一次：玩家明明死了，断言却报"没被打死"）。用容器绕开。
	var stats: Dictionary = {"deaths": 0, "frame": -1}
	p.connect("died", func() -> void: stats["deaths"] = int(stats["deaths"]) + 1)
	var hp0: float = float(p.get("hp"))
	var transition: Node = root.get_node_or_null("SceneTransition")
	# ⚠️ 2026-11-27 第五次：不再"按着右键往前走等死"。
	# 关卡变成 4800px 之后，玩家一路小跑能从敌人身边穿过去 —— 敌人追不上，
	# 跑到闸门前站住也没人跟过来。实测 50 秒不死，判据直接失去意义。
	# 改成把玩家**放到一只敌人旁边**、不还手也不移动：这才是"站桩不还手"。
	var foe: Node2D = null
	for c: Node in room.get_node("InvadersContainer").get_children():
		if c is Node2D:
			foe = c
			break
	if foe != null:
		(p as Node2D).global_position = Vector2(foe.global_position.x - 36.0, foe.global_position.y)
		(p as CharacterBody2D).velocity = Vector2.ZERO
	for i: int in range(3000):  # 50s 上限；按 18 伤 / 2.15s 一击，理论约 15s
		await physics_frame
		if int(stats["deaths"]) > 0:
			stats["frame"] = i
			break
	_check(int(stats["deaths"]) > 0, "不还手会被打死（第 %.1fs 倒下，满血 %.0f）"
		% [float(int(stats["frame"])) / 60.0, hp0])
	_check(float(p.get("hp")) == 0.0, "倒下时血量是 0")
	_check(bool(p.get("is_dead")), "倒下时进入死亡态")

	if transition != null and int(stats["frame"]) >= 0:
		var started: bool = await _wait_until(func() -> bool: \
			return bool(transition.call("is_transitioning")), 180)
		_check(started, "倒地演出后触发送回转场（不是原地满血继续）")

	room.free()
	ws.call("reset_state")
